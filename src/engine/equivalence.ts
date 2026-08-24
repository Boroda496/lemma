/**
 * The equivalence oracle.
 *
 * Everything the app claims about a student's answer routes through here, so
 * this file is where "the math is correct" is either true or false. Four
 * methods, tried in order of strength:
 *
 *   1. structural   — identical trees. Trivially sound.
 *   2. exact        — both sides evaluate to exact rationals. Decisive.
 *   3. probe-exact  — both sides are rational functions; evaluate the
 *                     difference in exact rational arithmetic at random
 *                     points. This is the Schwartz–Zippel test: a nonzero
 *                     polynomial of total degree d vanishes on at most a
 *                     d/|S| fraction of a sample set S. With |S| ≈ 2^40 and
 *                     the degrees this app produces, a single agreeing probe
 *                     already means a false positive below 1e-10, and we
 *                     require twelve independent ones.
 *   4. probe-numeric— arbitrary-precision complex evaluation at random
 *                     points, agreeing to ~30 significant digits, twelve
 *                     times over. Not a proof, and reported as such, but the
 *                     failure mode would require two different closed forms
 *                     to agree to 30 digits at twelve unrelated points.
 *
 * No step in this file consults a language model, a lookup table of expected
 * answers, or a heuristic about what the student "probably meant".
 */

import type { Expr } from './expr.ts';
import { key, symbols, isRelation, sub as subExpr, size } from './expr.ts';
import type { Rat } from './rational.ts';
import * as R from './rational.ts';
import * as B from './bigfloat.ts';
import * as CX from './complex.ts';
import type { C } from './complex.ts';
import { evalExact, evalNumeric, UndefinedAtPoint } from './evaluate.ts';
import { isRationalFunction, totalDegreeBound } from './polynomial.ts';
import { Rng } from './random.ts';

export type EquivMethod = 'structural' | 'exact' | 'probe-exact' | 'probe-numeric' | 'undecided';

export interface EquivResult {
  readonly equal: boolean;
  readonly method: EquivMethod;
  /** Human-readable justification, shown in the app's "why" panel. */
  readonly detail: string;
  /** Probes that agreed, for the probe methods. */
  readonly probes?: number;
  /** Upper bound on the chance this 'equal' verdict is wrong, as a string. */
  readonly falsePositiveBound?: string;
  /** True when the two agree everywhere both are defined but their domains differ. */
  readonly domainCaveat?: boolean;
}

const PROBES_REQUIRED = 12;
const MAX_ATTEMPTS = 200;
/** Sample-set half-width for exact probing. 2^40 gives a decisive S-Z bound. */
const EXACT_RANGE_BITS = 40;

/** Deterministic default so the same comparison always takes the same path. */
function proberFor(a: Expr, b: Expr, seed?: number): Rng {
  return new Rng(seed ?? Rng.hash(key(a) + '|' + key(b)));
}

/**
 * Are these two expressions the same mathematical object?
 *
 * `a` and `b` must be expressions, not relations — use `equivalentRelations`
 * for equations and inequalities, whose equality is about solution sets.
 */
export function equivalent(a: Expr, b: Expr, opts: { seed?: number; probes?: number } = {}): EquivResult {
  if (isRelation(a) || isRelation(b)) return equivalentRelations(a, b, opts);

  if (key(a) === key(b)) {
    return { equal: true, method: 'structural', detail: 'The two expressions are the identical tree.' };
  }

  const vars = [...new Set([...symbols(a), ...symbols(b)])];
  const need = opts.probes ?? PROBES_REQUIRED;
  const rng = proberFor(a, b, opts.seed);

  // ---- constants: no variables, so one evaluation settles it
  if (vars.length === 0) {
    const ea = evalExact(a);
    const eb = evalExact(b);
    if (ea !== null && eb !== null) {
      const same = R.eq(ea, eb);
      return {
        equal: same,
        method: 'exact',
        detail: same
          ? `Both sides are exactly ${R.toString(ea)}.`
          : `Exact values differ: ${R.toString(ea)} vs ${R.toString(eb)}.`,
      };
    }
    try {
      const na = evalNumeric(a, {}, B.PREC);
      const nb = evalNumeric(b, {}, B.PREC);
      const same = CX.nearlyEqual(na, nb);
      return {
        equal: same,
        method: 'probe-numeric',
        probes: 1,
        detail: same
          ? `Both sides evaluate to ${CX.toString(na, 20)} to 30 significant digits.`
          : `Values differ: ${CX.toString(na, 20)} vs ${CX.toString(nb, 20)}.`,
        falsePositiveBound: same ? '< 1e-30 relative disagreement' : undefined,
      };
    } catch (err) {
      if (err instanceof UndefinedAtPoint) {
        return { equal: false, method: 'undecided', detail: `One side is undefined: ${err.message}` };
      }
      throw err;
    }
  }

  // ---- rational functions: probe in exact arithmetic
  if (vars.every((v) => isRationalFunction(a, v)) && vars.every((v) => isRationalFunction(b, v))) {
    const res = probeExact(a, b, vars, need, rng);
    if (res) return res;
    // Fell through because too many points hit poles; the numeric prober is
    // better at dodging those, so let it try.
  }

  return probeNumeric(a, b, vars, need, rng);
}

/** Exact rational probing. Returns null if it could not gather enough usable points. */
function probeExact(a: Expr, b: Expr, vars: string[], need: number, rng: Rng): EquivResult | null {
  let agreed = 0;
  let attempts = 0;
  let sawUsable = false;
  const span = 1n << BigInt(EXACT_RANGE_BITS);

  while (agreed < need && attempts < MAX_ATTEMPTS) {
    attempts++;
    const env: Record<string, Rat> = {};
    for (const v of vars) {
      // Odd denominators keep the points off the small-integer lattice where
      // hand-written expressions tend to have their poles and roots.
      const n = rng.bigint(EXACT_RANGE_BITS) - span / 2n;
      const d = rng.bigint(8) * 2n + 1n;
      env[v] = R.rat(n === 0n ? 1n : n, d);
    }
    let va: Rat | null, vb: Rat | null;
    try {
      va = evalExact(a, env);
      vb = evalExact(b, env);
    } catch (err) {
      if (err instanceof UndefinedAtPoint) continue; // pole: try another point
      throw err;
    }
    if (va === null || vb === null) return null; // not actually exact-evaluable
    sawUsable = true;
    if (!R.eq(va, vb)) {
      return {
        equal: false,
        method: 'probe-exact',
        probes: agreed + 1,
        detail: `They differ at ${vars.map((v) => `${v} = ${R.toString(env[v]!)}`).join(', ')}: ` +
          `${R.toString(va)} vs ${R.toString(vb)}.`,
      };
    }
    agreed++;
  }

  if (!sawUsable || agreed < need) return null;

  const d = Math.max(totalDegreeBound(a), totalDegreeBound(b), 1);
  const perProbe = d / Math.pow(2, EXACT_RANGE_BITS);
  const bound = Math.pow(perProbe, agreed);
  return {
    equal: true,
    method: 'probe-exact',
    probes: agreed,
    detail:
      `Both are rational functions of ${vars.join(', ')}. Their difference was evaluated in exact ` +
      `rational arithmetic at ${agreed} random points and was exactly zero every time.`,
    falsePositiveBound: formatBound(bound),
  };
}

type ProbeDomain = 'real' | 'complex';

interface ProbeSweep {
  /** A definite verdict was reached and no further probing is warranted. */
  readonly decided: EquivResult | null;
  readonly agreed: number;
  readonly oneUndefined: number;
}

/**
 * Probe over one domain.
 *
 * Real points come first everywhere it matters, because the standard
 * identities students learn are real-domain statements. ln(ab) = ln a + ln b
 * is true for positive reals and false on the complex plane, where the two
 * sides can differ by 2*pi*i across a branch cut. Grading a student's log rule
 * as wrong on that technicality would be correct and useless. Complex probing
 * stays as the fallback for expressions with no real domain to speak of.
 */
function probeOver(
  a: Expr, b: Expr, vars: string[], need: number, rng: Rng, domain: ProbeDomain,
): ProbeSweep {
  let agreed = 0;
  let attempts = 0;
  let oneUndefined = 0;

  const samplePoint = (): Record<string, C> => {
    const env: Record<string, C> = {};
    for (const v of vars) {
      // A moderate range keeps exp() in bounds; odd denominators keep the
      // point off the integer lattice where roots and poles cluster.
      const magnitude = R.rat(rng.bigint(18) + 1n, (rng.bigint(5) * 2n + 1n) * (1n << 13n));
      // Positive most of the time: it is where log-like functions are defined,
      // so usable points are found quickly instead of by luck.
      const signed = rng.bool(0.7) ? magnitude : R.neg(magnitude);
      const re = B.fromRat(signed);
      const im = domain === 'real'
        ? B.BF_ZERO
        : B.fromRat(R.rat(rng.bigint(16) - (1n << 15n), rng.bigint(5) * 2n + 1n));
      env[v] = { re, im };
    }
    return env;
  };

  while (agreed < need && attempts < MAX_ATTEMPTS) {
    attempts++;
    const env = samplePoint();
    let va: C | null = null;
    let vb: C | null = null;
    let aUndef = false;
    let bUndef = false;
    try { va = evalNumeric(a, env); } catch (e) { if (e instanceof UndefinedAtPoint) aUndef = true; else throw e; }
    try { vb = evalNumeric(b, env); } catch (e) { if (e instanceof UndefinedAtPoint) bUndef = true; else throw e; }

    if (aUndef && bUndef) continue;
    if (aUndef !== bUndef) { oneUndefined++; continue; }
    if (!va || !vb) continue;

    // On the real domain a complex result means the expression left its real
    // branch (sqrt of a negative). That point is outside the domain we mean.
    if (domain === 'real' && !(CX.isReal(va) && CX.isReal(vb))) {
      if (CX.isReal(va) !== CX.isReal(vb)) oneUndefined++;
      continue;
    }

    if (!CX.nearlyEqual(va, vb)) {
      return {
        decided: {
          equal: false,
          method: 'probe-numeric',
          probes: agreed + 1,
          detail:
            `They differ at ${vars.map((v) => `${v} = ${CX.toString(env[v]!, 8)}`).join(', ')}: ` +
            `${CX.toString(va, 12)} vs ${CX.toString(vb, 12)}.`,
        },
        agreed,
        oneUndefined,
      };
    }
    agreed++;
  }

  if (agreed >= need) {
    return {
      decided: {
        equal: true,
        method: 'probe-numeric',
        probes: agreed,
        detail:
          `Evaluated at ${agreed} random ${domain} points in ${B.PREC}-bit arithmetic; the two agreed ` +
          `to 30 significant digits at every one.`,
        domainCaveat: oneUndefined > 0,
        falsePositiveBound: formatBound(Math.pow(1e-30, agreed)),
      },
      agreed,
      oneUndefined,
    };
  }

  return { decided: null, agreed, oneUndefined };
}

function probeNumeric(a: Expr, b: Expr, vars: string[], need: number, rng: Rng): EquivResult {
  const real = probeOver(a, b, vars, need, rng, 'real');
  if (real.decided) return real.decided;

  // Not enough real points where both sides live. Widen to the complex plane,
  // where the only expressions that survive are the ones with no real domain.
  const cx = probeOver(a, b, vars, need, rng, 'complex');
  if (cx.decided) {
    if (cx.decided.equal) return { ...cx.decided, domainCaveat: true };
    return {
      ...cx.decided,
      detail:
        cx.decided.detail +
        ' (Compared on the complex plane because too few real points were in the domain of both.)',
    };
  }

  const best = real.agreed >= cx.agreed ? real : cx;
  if (best.agreed === 0) {
    return {
      equal: false,
      method: 'undecided',
      detail:
        'No point could be found where both expressions are defined, so they could not be compared.' +
        (best.oneUndefined > 0 ? ' Their domains appear to differ.' : ''),
    };
  }

  return {
    equal: true,
    method: 'probe-numeric',
    probes: best.agreed,
    detail:
      `Agreed to 30 significant digits at every point where both were defined, but only ` +
      `${best.agreed} of ${MAX_ATTEMPTS} attempted points were usable — the two have different domains.`,
    domainCaveat: true,
    falsePositiveBound: formatBound(Math.pow(1e-30, best.agreed)),
  };
}

function formatBound(p: number): string {
  if (p === 0 || !Number.isFinite(p)) return 'below 1e-300';
  if (p < 1e-300) return 'below 1e-300';
  const exp = Math.floor(Math.log10(p));
  return `below 1e${exp + 1}`;
}

/**
 * Equations and inequalities compare by solution set, not by shape.
 * 2x = 6 and x = 3 are the same statement; x = 3 and 3 = x likewise.
 */
export function equivalentRelations(a: Expr, b: Expr, opts: { seed?: number } = {}): EquivResult {
  if (key(a) === key(b)) {
    return { equal: true, method: 'structural', detail: 'Identical statements.' };
  }
  if (a.k !== 'rel' || b.k !== 'rel') {
    return { equal: false, method: 'undecided', detail: 'Only one side is a statement.' };
  }
  const flip = (op: string) => ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' } as Record<string, string>)[op] ?? op;
  const normOp = a.op === b.op ? a.op : flip(a.op) === b.op ? a.op : null;
  if (normOp === null) {
    return { equal: false, method: 'undecided', detail: `Different relations: ${a.op} versus ${b.op}.` };
  }

  // Compare as "difference of sides", up to a nonzero scale factor. For an
  // equality any nonzero multiple is the same equation; for an inequality the
  // multiple must be positive or the direction is reversed.
  const da = subExpr(a.args[0]!, a.args[1]!);
  const db0 = subExpr(b.args[0]!, b.args[1]!);
  const db = a.op === b.op ? db0 : subExpr(b.args[1]!, b.args[0]!);

  const direct = equivalent(da, db, opts);
  if (direct.equal) {
    return { ...direct, detail: `Both statements reduce to the same expression set to zero. ${direct.detail}` };
  }

  // Try a constant ratio: da = k * db.
  const ratio = constantRatio(da, db, opts.seed);
  if (ratio !== null) {
    const positive = R.isPos(ratio);
    const okForOp = a.op === '=' || a.op === '!=' ? true : positive;
    if (okForOp) {
      return {
        equal: true,
        method: 'probe-exact',
        detail:
          `One statement is ${R.toString(ratio)} times the other, which does not change ` +
          (a.op === '=' || a.op === '!=' ? 'the solutions.' : 'the direction because the factor is positive.'),
      };
    }
    return {
      equal: false,
      method: 'probe-exact',
      detail: `One is ${R.toString(ratio)} times the other; a negative factor reverses ${a.op}.`,
    };
  }

  return { equal: false, method: direct.method, detail: direct.detail };
}

/** If a = k·b for a nonzero rational constant k, return k; else null. */
export function constantRatio(a: Expr, b: Expr, seed?: number): Rat | null {
  const vars = [...new Set([...symbols(a), ...symbols(b)])];
  const rng = new Rng(seed ?? Rng.hash('ratio:' + key(a) + '|' + key(b)));
  let candidate: Rat | null = null;
  let confirmed = 0;

  for (let attempt = 0; attempt < 60 && confirmed < 6; attempt++) {
    const env: Record<string, Rat> = {};
    for (const v of vars) env[v] = R.rat(rng.bigint(24) - (1n << 23n) || 1n, rng.bigint(6) * 2n + 1n);
    let va: Rat | null, vb: Rat | null;
    try {
      va = evalExact(a, env);
      vb = evalExact(b, env);
    } catch { continue; }
    if (va === null || vb === null) return null;
    if (R.isZero(vb)) continue;
    const k = R.div(va, vb);
    if (candidate === null) candidate = k;
    else if (!R.eq(candidate, k)) return null;
    confirmed++;
  }
  return confirmed >= 6 && candidate !== null && !R.isZero(candidate) ? candidate : null;
}

/**
 * Set equality for solution sets: {2, -3} equals {-3, 2}, and duplicates do
 * not count. Used to grade "solve" problems, where order is meaningless.
 */
export function equivalentSets(a: readonly Expr[], b: readonly Expr[], opts: { seed?: number } = {}): EquivResult {
  const unmatchedB = [...b];
  const missing: Expr[] = [];

  for (const x of a) {
    const idx = unmatchedB.findIndex((y) => equivalent(x, y, opts).equal);
    if (idx === -1) missing.push(x);
    else unmatchedB.splice(idx, 1);
  }

  if (missing.length === 0 && unmatchedB.length === 0) {
    return {
      equal: true,
      method: 'probe-exact',
      detail: `Both sets contain the same ${a.length} value${a.length === 1 ? '' : 's'}.`,
    };
  }
  const parts: string[] = [];
  if (missing.length) parts.push(`${missing.length} value(s) present on one side only`);
  if (unmatchedB.length) parts.push(`${unmatchedB.length} value(s) present on the other side only`);
  return { equal: false, method: 'probe-exact', detail: parts.join('; ') + '.' };
}

/** Is this expression identically zero? */
export function isZeroExpr(e: Expr, opts: { seed?: number } = {}): boolean {
  return equivalent(e, { k: 'num', v: R.ZERO }, opts).equal;
}

/** Rough "which form is simpler" score, for choosing between equal answers. */
export function complexityScore(e: Expr): number {
  let score = size(e);
  let penalty = 0;
  const walkPenalty = (n: Expr): void => {
    if (n.k === 'pow' && n.exp.k === 'num' && R.isNeg(n.exp.v)) penalty += 2;
    if (n.k === 'fn' && (n.name === 'sqrt' || n.name === 'root')) penalty += 1;
    if (n.k === 'num' && n.v.d !== 1n) penalty += 1;
    for (const c of n.k === 'add' || n.k === 'mul' || n.k === 'fn' ? n.args : n.k === 'pow' ? [n.base, n.exp] : []) {
      walkPenalty(c);
    }
  };
  walkPenalty(e);
  return score + penalty;
}
