/**
 * Normalization and simplification.
 *
 * `simplify` is the single place that turns a raw tree into the form a human
 * would write. It is deliberately separate from the constructors in expr.ts:
 * teaching requires holding "2x + 3x" as a real object, so folding happens
 * only when someone asks for it.
 *
 * Two levels:
 *   simplify(e)     — sound, local, fast. Never changes value.
 *   simplifyBest(e) — also tries expanded and factored forms and keeps the
 *                     smallest. Used for presenting a final answer.
 *
 * Every transformation here is value-preserving on the expression's domain.
 * The test suite checks that against the oracle on randomized input, so a rule
 * that quietly changes a value fails the build rather than reaching a student.
 */

import type { Expr, FnName } from './expr.ts';
import {
  add, mul, pow, num, int, sym, E0, E1, ENEG1, fn as mkFn, cst,
  key, compareExpr, splitCoeff, splitPow, terms, factors, numerDenom,
  isZeroE, isOneE, size, symbols, withChildren, children,
} from './expr.ts';
import type { Rat } from './rational.ts';
import * as R from './rational.ts';
import {
  expand, toRatPoly, fromRatPoly, factorRational, factorizationToExpr,
  polyDivMod, polyGcd, isZeroPoly, degree, trim, simplifySurd,
} from './polynomial.ts';

// ------------------------------------------------------------- exact function values

/** sin/cos/tan at the standard angles, exact. Keyed by the multiple of pi. */
const TRIG_TABLE: Record<string, { sin: Expr; cos: Expr }> = (() => {
  const half = num(R.rat(1, 2));
  const rt2 = mul(num(R.rat(1, 2)), mkFn('sqrt', int(2)));
  const rt3 = mul(num(R.rat(1, 2)), mkFn('sqrt', int(3)));
  const nHalf = num(R.rat(-1, 2));
  const nRt2 = mul(num(R.rat(-1, 2)), mkFn('sqrt', int(2)));
  const nRt3 = mul(num(R.rat(-1, 2)), mkFn('sqrt', int(3)));
  const t: Record<string, { sin: Expr; cos: Expr }> = {
    '0': { sin: E0, cos: E1 },
    '1/6': { sin: half, cos: rt3 },
    '1/4': { sin: rt2, cos: rt2 },
    '1/3': { sin: rt3, cos: half },
    '1/2': { sin: E1, cos: E0 },
    '2/3': { sin: rt3, cos: nHalf },
    '3/4': { sin: rt2, cos: nRt2 },
    '5/6': { sin: half, cos: nRt3 },
    '1': { sin: E0, cos: ENEG1 },
    '7/6': { sin: nHalf, cos: nRt3 },
    '5/4': { sin: nRt2, cos: nRt2 },
    '4/3': { sin: nRt3, cos: nHalf },
    '3/2': { sin: ENEG1, cos: E0 },
    '5/3': { sin: nRt3, cos: half },
    '7/4': { sin: nRt2, cos: rt2 },
    '11/6': { sin: nHalf, cos: rt3 },
  };
  return t;
})();

/** If `e` is a rational multiple of pi, return that multiple reduced into [0, 2). */
function piMultiple(e: Expr): Rat | null {
  const [coeff, rest] = splitCoeff(e);
  if (rest.k === 'const' && rest.name === 'pi') {
    // Reduce modulo 2.
    const two = R.rat(2);
    const k = R.floor(R.div(coeff, two));
    return R.sub(coeff, R.mul(two, R.rat(k)));
  }
  if (isZeroE(e)) return R.ZERO;
  return null;
}

function exactTrig(name: FnName, arg: Expr): Expr | null {
  const m = piMultiple(arg);
  if (m === null) return null;
  const entry = TRIG_TABLE[R.toString(m)];
  if (!entry) return null;
  switch (name) {
    case 'sin': return entry.sin;
    case 'cos': return entry.cos;
    case 'tan': return isZeroE(entry.cos) ? null : simplify(mul(entry.sin, pow(entry.cos, ENEG1)));
    case 'csc': return isZeroE(entry.sin) ? null : simplify(pow(entry.sin, ENEG1));
    case 'sec': return isZeroE(entry.cos) ? null : simplify(pow(entry.cos, ENEG1));
    case 'cot': return isZeroE(entry.sin) ? null : simplify(mul(entry.cos, pow(entry.sin, ENEG1)));
    default: return null;
  }
}

// ------------------------------------------------------------------- simplify

const MEMO = new Map<string, Expr>();

/**
 * Bottom-up local simplification, iterated to a fixed point.
 * Sound by construction: every branch below preserves value on the domain.
 */
export function simplify(e: Expr): Expr {
  const k = key(e);
  const hit = MEMO.get(k);
  if (hit) return hit;
  let cur = e;
  for (let i = 0; i < 12; i++) {
    const next = simplifyOnce(cur);
    if (key(next) === key(cur)) break;
    cur = next;
  }
  if (MEMO.size > 20000) MEMO.clear();
  MEMO.set(k, cur);
  return cur;
}

function simplifyOnce(e: Expr): Expr {
  const kids = children(e);
  const node = kids.length
    ? withChildren(e, kids.map(simplifyOnce))
    : e;
  return simplifyNode(node);
}

function simplifyNode(e: Expr): Expr {
  switch (e.k) {
    case 'add': return simplifyAdd(e.args);
    case 'mul': return simplifyMul(e.args);
    case 'pow': return simplifyPow(e.base, e.exp);
    case 'fn': return simplifyFn(e.name, e.args);
    case 'rel': {
      const [l, r] = e.args;
      return l && r ? { k: 'rel', op: e.op, args: [l, r] } : e;
    }
    default: return e;
  }
}

/** Fold constants, collect like terms, drop zeros, sort. */
function simplifyAdd(args: readonly Expr[]): Expr {
  const flat: Expr[] = [];
  for (const a of args) {
    if (a.k === 'add') flat.push(...a.args);
    else flat.push(a);
  }

  let constant = R.ZERO;
  // Map from the non-numeric part of a term to its accumulated coefficient.
  const collected = new Map<string, { coeff: Rat; body: Expr }>();

  for (const t of flat) {
    if (t.k === 'num') { constant = R.add(constant, t.v); continue; }
    const [c, body] = splitCoeff(t);
    if (isOneE(body)) { constant = R.add(constant, c); continue; }
    const bk = key(body);
    const prev = collected.get(bk);
    if (prev) prev.coeff = R.add(prev.coeff, c);
    else collected.set(bk, { coeff: c, body });
  }

  const out: Expr[] = [];
  for (const { coeff, body } of collected.values()) {
    if (R.isZero(coeff)) continue;
    out.push(R.isOne(coeff) ? body : mul(num(coeff), body));
  }
  if (!R.isZero(constant)) out.push(num(constant));

  if (out.length === 0) return E0;
  if (out.length === 1) return out[0]!;
  out.sort(termOrder);
  return { k: 'add', args: out };
}

/** Numbers last so sums read "3x^2 + 2x + 1", highest degree first. */
function termOrder(a: Expr, b: Expr): number {
  const da = degreeHint(a);
  const db = degreeHint(b);
  if (da !== db) return db - da;
  return compareExpr(a, b);
}

function degreeHint(e: Expr): number {
  switch (e.k) {
    case 'num': return -1;
    case 'sym': case 'const': return 1;
    case 'pow': {
      if (e.exp.k === 'num' && e.exp.v.d === 1n) return Number(e.exp.v.n) * degreeHint(e.base);
      return 2;
    }
    case 'mul': return e.args.reduce((s, a) => s + Math.max(0, degreeHint(a)), 0);
    case 'add': return Math.max(...e.args.map(degreeHint));
    case 'fn': return 1;
    default: return 0;
  }
}

/** Fold constants, collect equal bases into single powers, drop ones. */
function simplifyMul(args: readonly Expr[]): Expr {
  const flat: Expr[] = [];
  for (const a of args) {
    if (a.k === 'mul') flat.push(...a.args);
    else flat.push(a);
  }

  let constant = R.ONE;
  const bases = new Map<string, { base: Expr; exps: Expr[] }>();

  for (const f of flat) {
    if (f.k === 'num') {
      if (R.isZero(f.v)) return E0;
      constant = R.mul(constant, f.v);
      continue;
    }
    const [base, ex] = splitPow(f);
    const bk = key(base);
    const prev = bases.get(bk);
    if (prev) prev.exps.push(ex);
    else bases.set(bk, { base, exps: [ex] });
  }

  const out: Expr[] = [];
  for (const { base, exps } of bases.values()) {
    const total = exps.length === 1 ? exps[0]! : simplifyAdd(exps);
    if (isZeroE(total)) continue;             // b^0 = 1
    if (isOneE(total)) { out.push(base); continue; }
    // A numeric base with an integer exponent folds into the constant.
    if (base.k === 'num' && total.k === 'num' && R.isInt(total.v) && R.abs(total.v).n <= 512n) {
      constant = R.mul(constant, R.powInt(base.v, total.v.n));
      continue;
    }
    out.push(simplifyPow(base, total));
  }

  // Radicals with the same index merge: sqrt(2)*sqrt(3) = sqrt(6).
  mergeRadicals(out);

  if (!R.isOne(constant)) out.unshift(num(constant));
  if (out.length === 0) return E1;
  if (out.length === 1) return out[0]!;
  out.sort(factorOrder);
  return { k: 'mul', args: out };
}

function mergeRadicals(out: Expr[]): void {
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (!a || a.k !== 'fn' || a.name !== 'sqrt') continue;
    for (let j = i + 1; j < out.length; j++) {
      const b = out[j];
      if (!b || b.k !== 'fn' || b.name !== 'sqrt') continue;
      const inner = simplify(mul(a.args[0]!, b.args[0]!));
      out[i] = simplifyFn('sqrt', [inner]);
      out.splice(j, 1);
      j--;
    }
  }
}

/** Numbers first, then symbols, then everything else — how people write products. */
function factorOrder(a: Expr, b: Expr): number {
  const rank = (e: Expr) => (e.k === 'num' ? 0 : e.k === 'const' ? 1 : e.k === 'sym' ? 2 : e.k === 'pow' ? 3 : 5);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  return compareExpr(a, b);
}

function simplifyPow(base: Expr, exp: Expr): Expr {
  if (isZeroE(exp)) return isZeroE(base) ? E1 : E1;   // 0^0 is taken as 1 here
  if (isOneE(exp)) return base;
  if (isOneE(base)) return E1;
  if (isZeroE(base)) return E0;

  // Numeric base and integer exponent: evaluate.
  if (base.k === 'num' && exp.k === 'num') {
    if (R.isInt(exp.v) && R.abs(exp.v).n <= 512n) {
      if (R.isZero(base.v) && R.isNeg(exp.v)) return { k: 'const', name: 'nan' };
      return num(R.powInt(base.v, exp.v.n));
    }
    // Rational exponent on a rational base: extract whatever comes out exactly.
    if (!R.isNeg(base.v) && R.abs(exp.v).n <= 64n && exp.v.d <= 8n) {
      const root = R.exactRoot(base.v, Number(exp.v.d));
      if (root !== null) return num(R.powInt(root, exp.v.n));
      if (exp.v.d === 2n) {
        // Keep it as a simplified surd rather than an inert power.
        const surd = simplifySurd(base.v);
        if (key(surd) !== key(mkFn('sqrt', base))) {
          return R.isNeg(exp.v) ? simplify(pow(surd, int(Number(exp.v.n)))) : simplify(pow(surd, int(Number(exp.v.n))));
        }
      }
    }
  }

  // sqrt(a)^n folds: even powers give a^(n/2), odd ones leave one radical.
  // The split must use floor division, not BigInt's truncation: for n = -1 the
  // answer is a^-1 * sqrt(a), and truncating turns that into sqrt(a) itself.
  if (base.k === 'fn' && base.name === 'sqrt' && exp.k === 'num' && R.isInt(exp.v) && R.abs(exp.v).n <= 64n) {
    const inner = base.args[0]!;
    const n = exp.v.n;
    const whole = n >= 0n ? n / 2n : -((-n + 1n) / 2n);   // floor(n / 2)
    const leftover = n - 2n * whole;                       // 0 or 1
    const wholePart = whole === 0n ? E1 : simplifyPow(inner, int(whole));
    return leftover === 0n ? wholePart : simplifyMul([wholePart, base]);
  }

  // (a^m)^n = a^(mn), sound when m is an integer or a is non-negative.
  if (base.k === 'pow') {
    const inner = base.exp;
    const outerInt = exp.k === 'num' && R.isInt(exp.v);
    const innerInt = inner.k === 'num' && R.isInt(inner.v);
    const baseNonNeg = base.base.k === 'num' && !R.isNeg(base.base.v);
    if (innerInt || baseNonNeg || outerInt) {
      return simplifyPow(base.base, simplifyMul([inner, exp]));
    }
  }

  // (ab)^n = a^n b^n for integer n.
  if (base.k === 'mul' && exp.k === 'num' && R.isInt(exp.v)) {
    return simplifyMul(base.args.map((a) => simplifyPow(a, exp)));
  }

  // e^(ln u) = u
  if (base.k === 'const' && base.name === 'e' && exp.k === 'fn' && exp.name === 'ln') {
    return exp.args[0]!;
  }

  return { k: 'pow', base, exp };
}

function simplifyFn(name: FnName, args: readonly Expr[]): Expr {
  const a = args[0];

  switch (name) {
    case 'sqrt': {
      if (!a) break;
      if (a.k === 'num') {
        if (R.isNeg(a.v)) {
          const inner = simplifySurd(R.neg(a.v));
          return simplifyMul([inner, cst('i')]);
        }
        return simplifySurd(a.v);
      }
      // sqrt(x^2) stays put: it is |x|, not x, and collapsing it would be wrong.
      if (a.k === 'pow' && a.exp.k === 'num' && a.exp.v.d === 1n) {
        const n = a.exp.v.n;
        if (n % 2n === 0n && n !== 2n) {
          return simplifyPow(mkFn('abs', a.base), int(n / 2n));
        }
      }
      break;
    }
    case 'abs': {
      if (!a) break;
      if (a.k === 'num') return num(R.abs(a.v));
      if (a.k === 'fn' && a.name === 'abs') return a;
      // |x^2| = x^2 for an even power of a real base.
      if (a.k === 'pow' && a.exp.k === 'num' && a.exp.v.d === 1n && a.exp.v.n % 2n === 0n) return a;
      break;
    }
    case 'exp': {
      if (!a) break;
      if (isZeroE(a)) return E1;
      if (a.k === 'fn' && a.name === 'ln') return a.args[0]!;
      if (isOneE(a)) return cst('e');
      break;
    }
    case 'ln': {
      if (!a) break;
      if (isOneE(a)) return E0;
      if (a.k === 'const' && a.name === 'e') return E1;
      if (a.k === 'fn' && a.name === 'exp') return a.args[0]!;
      if (a.k === 'pow' && a.base.k === 'const' && a.base.name === 'e') return a.exp;
      break;
    }
    case 'log': {
      // log(x) base 10; log(b, x) base b.
      if (args.length === 2) {
        const [b, x] = args;
        if (b && x && key(b) === key(x)) return E1;
        if (x && isOneE(x)) return E0;
        if (b && x && x.k === 'pow' && key(x.base) === key(b)) return x.exp;
      } else if (a) {
        if (isOneE(a)) return E0;
        if (a.k === 'num' && R.isInt(a.v) && a.v.n > 0n) {
          // log10 of a power of ten is an integer; otherwise leave it alone.
          let v = a.v.n, k = 0;
          while (v % 10n === 0n) { v /= 10n; k++; }
          if (v === 1n) return int(k);
        }
      }
      break;
    }
    case 'sin': case 'cos': case 'tan': case 'sec': case 'csc': case 'cot': {
      if (!a) break;
      const exact = exactTrig(name, a);
      if (exact) return exact;
      // Odd/even symmetry: sin(-x) = -sin(x), cos(-x) = cos(x).
      const [c, body] = splitCoeff(a);
      if (R.isNeg(c)) {
        const positive = simplifyMul([num(R.neg(c)), body]);
        const inner = simplifyFn(name, [positive]);
        if (name === 'cos' || name === 'sec') return inner;
        return simplifyMul([ENEG1, inner]);
      }
      break;
    }
    case 'asin': case 'atan': case 'sinh': case 'tanh': case 'asinh': case 'atanh': {
      if (a && isZeroE(a)) return E0;
      break;
    }
    case 'acos': {
      if (a && isOneE(a)) return E0;
      if (a && isZeroE(a)) return mul(num(R.rat(1, 2)), cst('pi'));
      break;
    }
    case 'cosh': {
      if (a && isZeroE(a)) return E1;
      break;
    }
    case 'factorial': {
      if (a && a.k === 'num' && R.isInt(a.v) && !R.isNeg(a.v) && a.v.n <= 170n) {
        let acc = 1n;
        for (let i = 2n; i <= a.v.n; i++) acc *= i;
        return int(acc);
      }
      break;
    }
    case 'root': {
      const [x, n] = args;
      if (x && n && n.k === 'num' && R.isInt(n.v)) {
        if (n.v.n === 2n) return simplifyFn('sqrt', [x]);
        if (x.k === 'num') {
          const r = R.exactRoot(x.v, Number(n.v.n));
          if (r !== null) return num(r);
        }
      }
      break;
    }
    default:
      break;
  }

  // Fall through: fold any all-numeric call the exact evaluator can handle.
  return { k: 'fn', name, args };
}

// -------------------------------------------------------------- rational forms

/**
 * Put a rational expression over a single denominator and cancel the common
 * polynomial factor. Sound: the cancelled factor is a genuine gcd, so the
 * result agrees with the original everywhere the original is defined.
 */
export function cancelFraction(e: Expr): Expr {
  const s = simplify(e);
  const [n, d] = numerDenom(s);
  if (isOneE(d)) return s;
  const vars = symbols(s);
  if (vars.length !== 1) return s;
  const v = vars[0]!;
  const np = toRatPoly(n, v);
  const dp = toRatPoly(d, v);
  if (!np || !dp || isZeroPoly(dp)) return s;
  const g = polyGcd(np, dp);
  if (degree(g) < 1) return s;
  const { q: nq } = polyDivMod(np, g);
  const { q: dq } = polyDivMod(dp, g);
  if (degree(dq) === 0) {
    return simplify(mul(fromRatPoly(nq, v), pow(num(trim(dq)[0]!), ENEG1)));
  }
  return simplify(mul(fromRatPoly(nq, v), pow(fromRatPoly(dq, v), ENEG1)));
}

/** Factor a single-variable polynomial expression over Q. */
export function factor(e: Expr): Expr {
  const s = simplify(expand(e));
  const vars = symbols(s);
  if (vars.length !== 1) return s;
  const v = vars[0]!;
  const p = toRatPoly(s, v);
  if (!p || degree(p) < 1) return s;
  const f = factorRational(p);
  const out = factorizationToExpr(f, v);
  return size(out) <= size(s) + 2 ? simplify(out) : s;
}

/**
 * The presentation form for an answer.
 *
 * The preference is expanded standard form, because that is what "simplify"
 * conventionally means for a polynomial and because a stable rule beats a
 * clever one: picking whichever of factored and expanded happened to have
 * fewer nodes made (x+1)(x+2) stay factored while 2x^2+7x+3 got factored,
 * which reads as the app being arbitrary. Factoring is its own operation, run
 * when a problem asks for it.
 *
 * The exception is a fraction, where factoring earns its place by cancelling.
 * Candidates are listed best-first and a later one has to be strictly smaller
 * to win, so ties fall to the expanded form.
 */
export function simplifyBest(e: Expr): Expr {
  const plain = simplify(e);
  const [, denom] = numerDenom(plain);

  // No denominator: expanded standard form, unconditionally. Letting a node
  // count decide would keep (x+1)(x+2) factored while expanding (x+1)(x+3),
  // which reads as the app having no rule at all.
  if (isOneE(denom)) return simplify(expand(e));

  // With a denominator, cancelling is the point, and factoring is what makes
  // it possible. Candidates are best-first; a later one must be strictly
  // smaller to win, so ties fall to the earlier, more expanded form.
  const candidates: Expr[] = [];
  const push = (x: Expr) => { try { candidates.push(simplify(x)); } catch { /* candidate skipped */ } };
  push(cancelFraction(e));
  push(expand(e));
  push(plain);
  try { push(expand(cancelFraction(e))); } catch { /* candidate skipped */ }
  try { push(factor(cancelFraction(e))); } catch { /* candidate skipped */ }

  let best = candidates[0] ?? plain;
  let bestWeight = weight(best);
  for (const c of candidates.slice(1)) {
    const w = weight(c);
    if (w < bestWeight) { best = c; bestWeight = w; }
  }
  return best;
}

/** Smaller is better; fractions and radicals cost a little extra. */
function weight(e: Expr): number {
  let w = 0;
  const visit = (n: Expr) => {
    w += 1;
    if (n.k === 'pow' && n.exp.k === 'num' && R.isNeg(n.exp.v)) w += 2;
    if (n.k === 'num' && n.v.d !== 1n) w += 1;
    if (n.k === 'num') w += Math.min(4, Math.floor(R.toString(n.v).length / 4));
    if (n.k === 'fn' && (n.name === 'sqrt' || n.name === 'root')) w += 1;
    for (const c of children(n)) visit(c);
  };
  visit(e);
  return w;
}

/** True when `e` is already in the form the app would present as final. */
export function isSimplified(e: Expr): boolean {
  return key(e) === key(simplifyBest(e));
}
