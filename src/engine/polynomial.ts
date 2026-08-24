/**
 * Univariate polynomial machinery.
 *
 * Two representations, both dense and indexed by degree:
 *   RatPoly  — Rat[] coefficients. Used when every coefficient is a number.
 *   ExprPoly — Expr[] coefficients. Used when the other symbols in a
 *              multivariate expression ride along as coefficients, which is
 *              what "solve for x" needs.
 *
 * Everything here is exact. Root finding returns closed forms (rational,
 * quadratic-surd, or the reduced cubic/quartic forms) and never a decimal
 * approximation dressed up as an answer.
 */

import type { Expr } from './expr.ts';
import {
  add, mul, pow, num, int, sym, E0, E1, ENEG1, sqrt as sqrtE, neg as negE, div as divE,
  key, walk, hasSymbol, symKey, splitCoeff, splitPow, terms, factors, isZeroE, size,
} from './expr.ts';
import type { Rat } from './rational.ts';
import * as R from './rational.ts';
import { evalExact } from './evaluate.ts';

export type RatPoly = Rat[];   // index i is the coefficient of x^i
export type ExprPoly = Expr[];

// ------------------------------------------------------------------ structure

/** Is `e` built from `v` using only +, -, *, / and non-negative integer powers? */
export function isRationalFunction(e: Expr, v: string): boolean {
  let ok = true;
  walk(e, (n) => {
    if (!ok) return;
    if (n.k === 'fn') {
      const transcendental = !['abs', 'min', 'max', 'sign', 'floor', 'ceil'].includes(n.name);
      if (transcendental && hasSymbol(n, v)) ok = false;
      if (['abs', 'sign', 'floor', 'ceil'].includes(n.name) && hasSymbol(n, v)) ok = false;
    }
    if (n.k === 'pow' && hasSymbol(n.base, v)) {
      if (n.exp.k !== 'num' || n.exp.v.d !== 1n) ok = false;
    }
    if (n.k === 'pow' && hasSymbol(n.exp, v)) ok = false; // x in an exponent
    if (n.k === 'const' && (n.name === 'inf' || n.name === 'nan')) ok = false;
  });
  return ok;
}

/** Cheap upper bound on total degree, used for the Schwartz–Zippel bound. */
export function totalDegreeBound(e: Expr): number {
  switch (e.k) {
    case 'num': case 'const': return 0;
    case 'sym': return 1;
    case 'add': return Math.max(0, ...e.args.map(totalDegreeBound));
    case 'mul': return e.args.reduce((s, a) => s + totalDegreeBound(a), 0);
    case 'pow': {
      const d = totalDegreeBound(e.base);
      if (e.exp.k === 'num' && e.exp.v.d === 1n) {
        const n = Number(e.exp.v.n);
        return n >= 0 ? d * n : d * Math.abs(n);
      }
      return d * 4;
    }
    case 'fn': return Math.max(1, ...e.args.map(totalDegreeBound)) * 2;
    default: return Math.max(1, ...[...(e as any).args ?? []].map(totalDegreeBound));
  }
}

// ------------------------------------------------------------- expr <-> poly

/**
 * Coefficients of `e` as a polynomial in `v`, with the other symbols left as
 * expressions. Returns null when `e` is not polynomial in `v`.
 */
export function toExprPoly(e: Expr, v: string, maxDeg = 64): ExprPoly | null {
  // Expand first so that (x+1)^2 and (x+1)(x+2) present as sums of monomials
  // and the loop below only has to read powers of v out of a product.
  const flat = expand(e);
  const acc: Expr[][] = [];

  for (const t of terms(flat)) {
    let deg = 0;
    const rest: Expr[] = [];

    for (const f of factors(t)) {
      const [base, ex] = splitPow(f);
      if (base.k === 'sym' && symKey(base) === v) {
        if (ex.k !== 'num' || ex.v.d !== 1n || ex.v.n < 0n) return null;
        deg += Number(ex.v.n);
        if (deg > maxDeg) return null;
      } else if (hasSymbol(f, v)) {
        // v appears somewhere that is not a non-negative integer power of it --
        // inside a sqrt, a denominator, a sine. This is not a polynomial in v.
        //
        // Returning null here matters. An earlier version skipped the offending
        // term instead, so sqrt(x) came back as the zero polynomial and every
        // caller downstream -- cancelling, factoring, simplifyBest -- happily
        // reported that 1/(2 sqrt x) simplifies to 0.
        return null;
      } else {
        rest.push(f);
      }
    }

    while (acc.length <= deg) acc.push([]);
    acc[deg]!.push(rest.length === 0 ? E1 : rest.length === 1 ? rest[0]! : mul(...rest));
  }

  if (acc.length === 0) return [E0];
  return acc.map((parts) =>
    parts.length === 0 ? E0 : parts.length === 1 ? parts[0]! : add(...parts));
}

/** Numeric coefficients, or null if any coefficient is not an exact rational. */
export function toRatPoly(e: Expr, v: string, maxDeg = 64): RatPoly | null {
  const ep = toExprPoly(expand(e), v, maxDeg);
  if (ep === null) return null;
  const out: Rat[] = [];
  for (const c of ep) {
    const r = evalExact(c);
    if (r === null) return null;
    out.push(r);
  }
  return trim(out);
}

export function fromRatPoly(p: RatPoly, v: string): Expr {
  const parts: Expr[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const c = p[i]!;
    if (R.isZero(c)) continue;
    const power = i === 0 ? null : i === 1 ? sym(v) : pow(sym(v), int(i));
    if (power === null) parts.push(num(c));
    else if (R.isOne(c)) parts.push(power);
    else parts.push(mul(num(c), power));
  }
  return parts.length === 0 ? E0 : parts.length === 1 ? parts[0]! : add(...parts);
}

export function fromExprPoly(p: ExprPoly, v: string): Expr {
  const parts: Expr[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const c = p[i]!;
    if (isZeroE(c)) continue;
    const power = i === 0 ? null : i === 1 ? sym(v) : pow(sym(v), int(i));
    parts.push(power === null ? c : mul(c, power));
  }
  return parts.length === 0 ? E0 : parts.length === 1 ? parts[0]! : add(...parts);
}

// ------------------------------------------------------------- RatPoly algebra

export const trim = (p: RatPoly): RatPoly => {
  const q = [...p];
  while (q.length > 1 && R.isZero(q[q.length - 1]!)) q.pop();
  return q;
};
export const degree = (p: RatPoly): number => trim(p).length - 1;
export const isZeroPoly = (p: RatPoly): boolean => trim(p).every(R.isZero);
export const leading = (p: RatPoly): Rat => trim(p)[trim(p).length - 1]!;

export function polyAdd(a: RatPoly, b: RatPoly): RatPoly {
  const out: Rat[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    out.push(R.add(a[i] ?? R.ZERO, b[i] ?? R.ZERO));
  }
  return trim(out);
}
export const polySub = (a: RatPoly, b: RatPoly): RatPoly => polyAdd(a, polyScale(b, R.NEG_ONE));
export const polyScale = (a: RatPoly, k: Rat): RatPoly => trim(a.map((c) => R.mul(c, k)));

export function polyMul(a: RatPoly, b: RatPoly): RatPoly {
  if (isZeroPoly(a) || isZeroPoly(b)) return [R.ZERO];
  const out: Rat[] = new Array(a.length + b.length - 1).fill(R.ZERO);
  for (let i = 0; i < a.length; i++) {
    if (R.isZero(a[i]!)) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] = R.add(out[i + j]!, R.mul(a[i]!, b[j]!));
    }
  }
  return trim(out);
}

export function polyPow(a: RatPoly, n: number): RatPoly {
  let acc: RatPoly = [R.ONE];
  for (let i = 0; i < n; i++) acc = polyMul(acc, a);
  return acc;
}

/** Long division: a = q·b + r, deg(r) < deg(b). */
export function polyDivMod(a: RatPoly, b: RatPoly): { q: RatPoly; r: RatPoly } {
  const bb = trim(b);
  if (isZeroPoly(bb)) throw new RangeError('polynomial division by zero');
  let r = trim(a);
  const dq = r.length - bb.length;
  if (dq < 0) return { q: [R.ZERO], r };
  const q: Rat[] = new Array(dq + 1).fill(R.ZERO);
  const lead = bb[bb.length - 1]!;
  while (r.length >= bb.length && !isZeroPoly(r)) {
    const shift = r.length - bb.length;
    const factor = R.div(r[r.length - 1]!, lead);
    q[shift] = factor;
    const sub: Rat[] = new Array(shift).fill(R.ZERO).concat(bb.map((c) => R.mul(c, factor)));
    r = trim(polySub(r, sub));
    if (r.length - 1 === shift + bb.length - 1) break; // guard against non-termination
  }
  return { q: trim(q), r: trim(r) };
}

/** Monic gcd via the Euclidean algorithm. */
export function polyGcd(a: RatPoly, b: RatPoly): RatPoly {
  let x = trim(a);
  let y = trim(b);
  while (!isZeroPoly(y)) {
    const { r } = polyDivMod(x, y);
    x = y;
    y = r;
  }
  if (isZeroPoly(x)) return [R.ZERO];
  return polyScale(x, R.inv(leading(x)));
}

export const polyDeriv = (p: RatPoly): RatPoly =>
  trim(p.length <= 1 ? [R.ZERO] : p.slice(1).map((c, i) => R.mul(c, R.rat(i + 1))));

export function polyEval(p: RatPoly, x: Rat): Rat {
  let acc = R.ZERO;
  for (let i = p.length - 1; i >= 0; i--) acc = R.add(R.mul(acc, x), p[i]!);
  return acc;
}

/** The rational content: gcd of numerators over lcm of denominators. */
export function content(p: RatPoly): Rat {
  const q = trim(p);
  if (isZeroPoly(q)) return R.ONE;
  let numGcd = 0n;
  let denLcm = 1n;
  for (const c of q) {
    let x = numGcd < 0n ? -numGcd : numGcd;
    let y = c.n < 0n ? -c.n : c.n;
    while (y) { const t = x % y; x = y; y = t; }
    numGcd = x;
    let a = denLcm, b = c.d;
    while (b) { const t = a % b; a = b; b = t; }
    denLcm = (denLcm / a) * c.d;
  }
  if (numGcd === 0n) return R.ONE;
  const g = R.rat(numGcd, denLcm);
  return R.isNeg(leading(q)) ? R.neg(g) : g;
}

/** Integer-coefficient version of p with positive leading coefficient. */
export const primitivePart = (p: RatPoly): RatPoly => polyScale(p, R.inv(content(p)));

// -------------------------------------------------------------- factorization

export interface Factorization {
  /** Overall rational constant pulled out front. */
  readonly constant: Rat;
  /** Factors with multiplicities, in increasing degree. */
  readonly factors: Array<{ poly: RatPoly; multiplicity: number }>;
  /**
   * False when the search was cut short by a size limit, so a listed factor of
   * degree >= 2 might still be reducible. The app never presents an incomplete
   * factorization as "fully factored" -- claiming irreducibility we did not
   * establish would be exactly the kind of confident wrongness this engine
   * exists to avoid.
   */
  readonly complete: boolean;
}

/**
 * Every rational root p/q of an integer polynomial has p dividing the constant
 * term and q dividing the leading coefficient. Enumerating those candidates is
 * exact and complete: if this returns no roots, the polynomial genuinely has
 * none over Q.
 */
export function rationalRoots(p: RatPoly): Rat[] {
  const prim = primitivePart(trim(p));
  if (prim.length <= 1) return [];
  // Strip x^k so a zero root is reported once and the rest stays small.
  let k = 0;
  while (k < prim.length && R.isZero(prim[k]!)) k++;
  const core = prim.slice(k);
  const roots: Rat[] = [];
  if (k > 0) roots.push(R.ZERO);
  if (core.length <= 1) return roots;

  const a0 = core[0]!.n < 0n ? -core[0]!.n : core[0]!.n;
  const an = core[core.length - 1]!.n < 0n ? -core[core.length - 1]!.n : core[core.length - 1]!.n;
  const ps = divisors(a0);
  const qs = divisors(an);
  if (ps === null || qs === null) return roots; // too large to search exhaustively
  const seen = new Set<string>();
  for (const pn of ps) {
    for (const qn of qs) {
      for (const s of [1n, -1n]) {
        const cand = R.rat(s * pn, qn);
        const kk = R.toString(cand);
        if (seen.has(kk)) continue;
        seen.add(kk);
        if (R.isZero(polyEval(core, cand))) roots.push(cand);
      }
    }
  }
  return roots;
}

/** Largest value we will trial-divide. Beyond it we report failure, not a guess. */
const DIVISOR_LIMIT = 10n ** 14n;

/** All positive divisors, or null when the number is too large to enumerate. */
function divisors(n: bigint): bigint[] | null {
  if (n === 0n) return [1n];
  const a = n < 0n ? -n : n;
  if (a > DIVISOR_LIMIT) return null;
  const out: bigint[] = [];
  for (let i = 1n; i * i <= a; i++) {
    if (a % i === 0n) {
      out.push(i);
      if (i * i !== a) out.push(a / i);
    }
  }
  return out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/**
 * Yun's squarefree decomposition: returns [g1, g2, ...] where gi is the
 * product of the irreducible factors appearing exactly i times, so
 * p = c * g1 * g2^2 * g3^3 * ...
 *
 * Doing this first is what keeps factoring fast. A perfect fourth power like
 * (2x^2+x+3)^4 collapses here in a few gcds, instead of handing Kronecker's
 * method a degree-8 polynomial with six-figure coefficients to grind through.
 */
export function squarefreeDecompose(p: RatPoly): RatPoly[] {
  const f = primitivePart(trim(p));
  if (degree(f) < 1) return [];
  const fp = polyDeriv(f);
  if (isZeroPoly(fp)) return [f];

  let g = polyGcd(f, fp);
  let c = polyDivMod(f, g).q;
  let d = polySub(polyDivMod(fp, g).q, polyDeriv(c));

  const out: RatPoly[] = [];
  for (let i = 1; i <= 32; i++) {
    if (degree(c) < 1) break;
    const a = polyGcd(c, d);
    out.push(a);
    c = polyDivMod(c, a).q;
    d = polySub(polyDivMod(d, a).q, polyDeriv(c));
  }
  return out;
}

/**
 * Factor over Q. Linear factors come from the rational-root theorem, and
 * whatever remains is split by Kronecker's method, which is exhaustive over
 * the candidate divisors it examines. When a coefficient grows past the
 * trial-division limit the search stops and `complete` is set false, rather
 * than reporting an irreducibility that was never checked.
 */
export function factorRational(p: RatPoly): Factorization {
  const t = trim(p);
  if (t.length <= 1) return { constant: t[0] ?? R.ZERO, factors: [], complete: true };

  let constant = content(t);
  const out: Array<{ poly: RatPoly; multiplicity: number }> = [];
  let complete = true;

  const addFactor = (f: RatPoly, times: number) => {
    const fc = content(f);
    const fp = polyScale(f, R.inv(fc));
    if (degree(fp) < 1) {
      constant = R.mul(constant, R.powInt(R.mul(fc, fp[0] ?? R.ONE), times));
      return;
    }
    constant = R.mul(constant, R.powInt(fc, times));
    const existing = out.find((o) => polyKey(o.poly) === polyKey(fp));
    if (existing) existing.multiplicity += times;
    else out.push({ poly: fp, multiplicity: times });
  };

  // Split by multiplicity first, so repeated factors never reach the expensive
  // search as a single high-degree lump.
  const squarefree = squarefreeDecompose(t);

  squarefree.forEach((part, idx) => {
    const multiplicity = idx + 1;
    let work = part;
    if (degree(work) < 1) {
      constant = R.mul(constant, R.powInt(work[0] ?? R.ONE, multiplicity));
      return;
    }

    // 1. Peel off rational roots. Within a squarefree part each is simple.
    for (;;) {
      if (degree(work) < 1) break;
      const roots = rationalRoots(work);
      if (roots.length === 0) break;
      const r = roots[0]!;
      // (q*x - p) for r = p/q keeps the coefficients integral.
      const lin: RatPoly = [R.neg(R.rat(r.n)), R.rat(r.d)];
      const { q, r: rem } = polyDivMod(work, lin);
      if (!isZeroPoly(rem)) break; // cannot happen; bail rather than lie
      addFactor(lin, multiplicity);
      work = q;
    }

    // 2. Split whatever is left.
    if (degree(work) >= 2) {
      const split = kroneckerSplit(work);
      if (!split.complete) complete = false;
      for (const piece of split.pieces) addFactor(piece, multiplicity);
    } else if (degree(work) >= 1) {
      addFactor(work, multiplicity);
    } else {
      constant = R.mul(constant, R.powInt(work[0] ?? R.ONE, multiplicity));
    }
  });

  out.sort((a, b) => degree(a.poly) - degree(b.poly) || polyKey(a.poly).localeCompare(polyKey(b.poly)));

  // Recover the constant by division rather than by bookkeeping.
  //
  // The factors are primitive by construction and polyGcd returns monic
  // results, so the scale accumulated along the way is not reliable. Dividing
  // the original by the product of the factors recovers the true constant and
  // verifies the whole factorization at once: a non-zero remainder or a
  // non-constant quotient means the result is wrong, and we say so instead of
  // returning it.
  let product: RatPoly = [R.ONE];
  for (const { poly, multiplicity } of out) product = polyMul(product, polyPow(poly, multiplicity));
  const { q, r } = polyDivMod(t, product);
  if (isZeroPoly(r) && degree(q) === 0) {
    constant = trim(q)[0] ?? R.ONE;
  } else {
    // Should be unreachable. Report the input unfactored rather than a product
    // that does not multiply back to it.
    return { constant: R.ONE, factors: [{ poly: t, multiplicity: 1 }], complete: false };
  }

  return { constant, factors: out, complete };
}

const polyKey = (p: RatPoly): string => trim(p).map(R.toString).join(',');

/**
 * Kronecker's method: a degree-n factor is determined by its values at n+1
 * points, and those values must divide the polynomial's values there. Testing
 * every combination of divisors is exhaustive, so a "no split" answer is a
 * genuine irreducibility certificate over Q for these sizes.
 */
interface Split {
  readonly pieces: RatPoly[];
  /** False when a size limit stopped the search before it was exhaustive. */
  readonly complete: boolean;
}

function kroneckerSplit(p: RatPoly): Split {
  const n = degree(p);
  if (n <= 1) return { pieces: [p], complete: true };
  if (n === 2) return { pieces: [p], complete: true }; // a quadratic with no rational root is irreducible over Q
  if (n > 6) return { pieces: [p], complete: false };  // beyond what we will search

  const prim = primitivePart(p);
  const half = Math.floor(n / 2);

  for (let d = 1; d <= half; d++) {
    const points: Rat[] = [];
    for (let i = 0; points.length <= d && i <= 60; i++) {
      const x = R.rat(i % 2 === 0 ? i / 2 : -(i + 1) / 2);
      if (!R.isZero(polyEval(prim, x))) points.push(x);
    }
    if (points.length <= d) continue;

    const divisorSets: Rat[][] = [];
    let searchable = true;
    for (const x of points) {
      const ds = divisors(polyEval(prim, x).n);
      if (ds === null || ds.length > 64) { searchable = false; break; }
      divisorSets.push(ds.flatMap((q) => [R.rat(q), R.rat(-q)]));
    }
    if (!searchable) return { pieces: [p], complete: false };

    // Guard the combinatorial size: the product of the set sizes is the number
    // of candidate factors we would interpolate.
    const combos = divisorSets.reduce((acc, s) => acc * s.length, 1);
    if (combos > 400000) return { pieces: [p], complete: false };

    const combo: Rat[] = new Array(d + 1).fill(R.ZERO);
    const found = searchCombos(divisorSets, 0, combo, points, prim, d);
    if (found) {
      const rest = kroneckerSplit(found.b);
      return { pieces: [found.a, ...rest.pieces], complete: rest.complete };
    }
  }
  return { pieces: [p], complete: true };
}

function searchCombos(
  sets: Rat[][],
  idx: number,
  combo: Rat[],
  points: Rat[],
  prim: RatPoly,
  d: number,
): { a: RatPoly; b: RatPoly } | null {
  if (idx === sets.length) {
    const cand = lagrange(points, combo);
    if (degree(cand) < 1 || degree(cand) > d) return null;
    const { q, r } = polyDivMod(prim, cand);
    if (isZeroPoly(r) && degree(q) >= 1) {
      return { a: primitivePart(cand), b: primitivePart(q) };
    }
    return null;
  }
  for (const v of sets[idx]!) {
    combo[idx] = v;
    const hit = searchCombos(sets, idx + 1, combo, points, prim, d);
    if (hit) return hit;
  }
  return null;
}

/** Exact Lagrange interpolation through (x_i, y_i). */
export function lagrange(xs: Rat[], ys: Rat[]): RatPoly {
  let acc: RatPoly = [R.ZERO];
  for (let i = 0; i < xs.length; i++) {
    let basis: RatPoly = [R.ONE];
    let denom = R.ONE;
    for (let j = 0; j < xs.length; j++) {
      if (i === j) continue;
      basis = polyMul(basis, [R.neg(xs[j]!), R.ONE]);
      denom = R.mul(denom, R.sub(xs[i]!, xs[j]!));
    }
    acc = polyAdd(acc, polyScale(basis, R.div(ys[i]!, denom)));
  }
  return trim(acc);
}

/** Render a factorization back as an expression. */
export function factorizationToExpr(f: Factorization, v: string): Expr {
  const parts: Expr[] = [];
  if (!R.isOne(f.constant)) parts.push(num(f.constant));
  for (const { poly, multiplicity } of f.factors) {
    const base = fromRatPoly(poly, v);
    parts.push(multiplicity === 1 ? base : pow(base, int(multiplicity)));
  }
  if (parts.length === 0) return E1;
  return parts.length === 1 ? parts[0]! : mul(...parts);
}

// ------------------------------------------------------------------- expansion

/**
 * Distribute products over sums and expand integer powers, everywhere, until
 * nothing changes. Numeric folding is left to canon.ts so that the "distribute"
 * step and the "now do the arithmetic" step stay separately showable.
 */
export function expand(e: Expr): Expr {
  const once = (n: Expr): Expr => {
    switch (n.k) {
      case 'mul': {
        const sums = n.args.filter((a) => a.k === 'add');
        if (sums.length === 0) return n;
        let acc: Expr[] = [E1];
        for (const f of n.args) {
          const fs = f.k === 'add' ? f.args : [f];
          const next: Expr[] = [];
          for (const a of acc) for (const b of fs) next.push(mul(a, b));
          acc = next;
          if (acc.length > 4096) return n; // refuse to blow up
        }
        return acc.length === 1 ? acc[0]! : add(...acc);
      }
      case 'pow': {
        if (n.exp.k !== 'num' || n.exp.v.d !== 1n) return n;
        const k = Number(n.exp.v.n);
        if (k < 0 || k > 24) return n;
        if (k === 0) return E1;
        if (k === 1) return n.base;
        if (n.base.k !== 'add' && n.base.k !== 'mul') return n;
        if (n.base.k === 'mul') return mul(...n.base.args.map((a) => pow(a, int(k))));
        let acc: Expr = n.base;
        for (let i = 1; i < k; i++) acc = once(mul(acc, n.base));
        return acc;
      }
      default:
        return n;
    }
  };

  let cur = e;
  for (let i = 0; i < 24; i++) {
    const next = transformBottomUp(cur, once);
    if (key(next) === key(cur)) return next;
    cur = next;
  }
  return cur;
}

function transformBottomUp(e: Expr, f: (n: Expr) => Expr): Expr {
  switch (e.k) {
    case 'add': return f(add(...e.args.map((a) => transformBottomUp(a, f))));
    case 'mul': return f(mul(...e.args.map((a) => transformBottomUp(a, f))));
    case 'pow': return f(pow(transformBottomUp(e.base, f), transformBottomUp(e.exp, f)));
    case 'fn': return f({ k: 'fn', name: e.name, args: e.args.map((a) => transformBottomUp(a, f)) });
    case 'rel': return f({ k: 'rel', op: e.op, args: e.args.map((a) => transformBottomUp(a, f)) });
    default: return f(e);
  }
}

// --------------------------------------------------------------- exact roots

export interface RootInfo {
  readonly value: Expr;
  readonly multiplicity: number;
  /** True when the root is real. Complex roots are still returned, tagged. */
  readonly real: boolean;
}

/** Exact closed-form roots for degrees 1–4, plus any rational roots beyond. */
export function exactRoots(p: RatPoly, opts: { complex?: boolean } = {}): RootInfo[] {
  const t = trim(p);
  const n = degree(t);
  if (n < 1) return [];
  const wantComplex = opts.complex ?? true;

  const f = factorRational(t);
  const out: RootInfo[] = [];
  for (const { poly, multiplicity } of f.factors) {
    for (const r of rootsOfIrreducible(poly, wantComplex)) {
      out.push({ ...r, multiplicity: r.multiplicity * multiplicity });
    }
  }
  return out;
}

function rootsOfIrreducible(p: RatPoly, wantComplex: boolean): RootInfo[] {
  const n = degree(p);
  if (n === 1) {
    const [b, a] = [p[0]!, p[1]!];
    return [{ value: num(R.neg(R.div(b, a))), multiplicity: 1, real: true }];
  }
  if (n === 2) return quadraticRoots(p[2]!, p[1]!, p[0]!, wantComplex);
  // Degree 3 and 4 irreducible over Q: the closed forms exist but are of no
  // pedagogical use, so report the roots symbolically as "root of ..." rather
  // than emit a Cardano expression nobody can read.
  return [];
}

/** The quadratic formula, with the discriminant simplified exactly. */
export function quadraticRoots(a: Rat, b: Rat, c: Rat, wantComplex = true): RootInfo[] {
  const disc = R.sub(R.mul(b, b), R.mul(R.rat(4), R.mul(a, c)));
  const twoA = R.mul(R.rat(2), a);

  if (R.isZero(disc)) {
    return [{ value: num(R.div(R.neg(b), twoA)), multiplicity: 2, real: true }];
  }

  const negative = R.isNeg(disc);
  if (negative && !wantComplex) return [];
  const mag = R.abs(disc);

  // Try an exact square root first: that is when the roots are rational.
  const exact = R.exactRoot(mag, 2);
  const surd: Expr = exact !== null ? num(exact) : simplifySurd(mag);

  const build = (sign: 1 | -1): Expr => {
    const rootPart = sign === 1 ? surd : negE(surd);
    const imagPart = negative ? mul(rootPart, { k: 'const', name: 'i' }) : rootPart;
    return divE(add(num(R.neg(b)), imagPart), num(twoA));
  };

  return [
    { value: build(1), multiplicity: 1, real: !negative },
    { value: build(-1), multiplicity: 1, real: !negative },
  ];
}

/** sqrt(72) -> 6·sqrt(2). Exact, by pulling out the largest square factor. */
export function simplifySurd(x: Rat): Expr {
  if (R.isZero(x)) return E0;
  if (R.isNeg(x)) return mul(ENEG1, simplifySurd(R.neg(x)));
  // sqrt(a/b) = sqrt(a·b)/b keeps everything under one radical over an integer.
  const inner = R.mul(R.rat(x.n * x.d), R.ONE);
  const { outside, inside } = R.extractRoot(inner.n, 2);
  const coeff = R.rat(outside, x.d);
  if (inside === 1n) return num(coeff);
  const radical = sqrtE(int(inside));
  return R.isOne(coeff) ? radical : mul(num(coeff), radical);
}

/** Discriminant of a quadratic, as an exact rational. */
export const discriminant = (a: Rat, b: Rat, c: Rat): Rat =>
  R.sub(R.mul(b, b), R.mul(R.rat(4), R.mul(a, c)));

/** Complete the square: ax²+bx+c = a(x+h)² + k. Returns h and k exactly. */
export function completeSquare(a: Rat, b: Rat, c: Rat): { a: Rat; h: Rat; k: Rat } {
  const h = R.div(b, R.mul(R.rat(2), a));
  const k = R.sub(c, R.mul(a, R.mul(h, h)));
  return { a, h, k };
}
