/**
 * Arbitrary-precision binary floating point: value = m * 2^e.
 *
 * Why this exists instead of `number`: the equivalence oracle decides whether a
 * student's answer is correct. For algebraic expressions we can decide that
 * exactly with rationals. For transcendental ones we have to evaluate, and a
 * double gives ~15 digits with no error control — enough for cancellation to
 * produce a confident wrong answer. Here we evaluate at ~50 digits and compare
 * at ~30, so the slack absorbs accumulated rounding by an enormous margin
 * while still separating genuinely different values.
 *
 * All series below use argument reduction first, so every Taylor evaluation
 * runs on a small argument and converges in a bounded number of terms.
 */

import type { Rat } from './rational.ts';

export interface BF {
  readonly m: bigint; // mantissa
  readonly e: number; // binary exponent
}

/** Default working precision in bits. ~50 decimal digits. */
export const PREC = 168;
/** Bits that must agree for two values to be called equal. ~30 decimal digits. */
export const COMPARE_BITS = 100;

export const BF_ZERO: BF = { m: 0n, e: 0 };

const bitLength = (x: bigint): number => {
  if (x === 0n) return 0;
  const a = x < 0n ? -x : x;
  return a.toString(2).length;
};

/** Round to `prec` significant bits, half-away-from-zero. */
export function round(m: bigint, e: number, prec: number = PREC): BF {
  if (m === 0n) return BF_ZERO;
  const bits = bitLength(m);
  if (bits <= prec) return { m, e };
  const drop = bits - prec;
  const neg = m < 0n;
  const a = neg ? -m : m;
  const half = 1n << BigInt(drop - 1);
  let q = a >> BigInt(drop);
  if ((a & ((1n << BigInt(drop)) - 1n)) >= half) q += 1n;
  return { m: neg ? -q : q, e: e + drop };
}

/** Trim trailing zero bits so mantissas stay small. */
export function normalize(x: BF): BF {
  if (x.m === 0n) return BF_ZERO;
  let m = x.m, e = x.e;
  while ((m & 1n) === 0n) { m >>= 1n; e += 1; }
  return { m, e };
}

export function fromInt(n: bigint | number): BF {
  return normalize({ m: typeof n === 'bigint' ? n : BigInt(Math.trunc(n)), e: 0 });
}

export function fromRat(r: Rat, prec: number = PREC): BF {
  if (r.n === 0n) return BF_ZERO;
  // Scale the numerator up so the integer division keeps `prec` good bits.
  const shift = prec + bitLength(r.d) - bitLength(r.n) + 2;
  const s = shift > 0 ? shift : 0;
  const q = (r.n << BigInt(s)) / r.d;
  return round(q, -s, prec);
}

export function fromNumber(x: number, prec: number = PREC): BF {
  if (!Number.isFinite(x)) throw new RangeError('non-finite');
  if (x === 0) return BF_ZERO;
  // Exact: split the double into mantissa and exponent, no rounding introduced.
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0), lo = buf.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const exp = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mant = (mantHi << 32n) | BigInt(lo);
  if (exp === 0) return round(sign * mant, -1074, prec);
  return round(sign * (mant | (1n << 52n)), exp - 1075, prec);
}

export const toNumber = (x: BF): number => {
  if (x.m === 0n) return 0;
  // Reduce the mantissa first so Number() does not overflow on huge BigInts.
  const bits = bitLength(x.m);
  if (bits > 64) {
    const drop = bits - 64;
    return Number(x.m >> BigInt(drop)) * Math.pow(2, x.e + drop);
  }
  return Number(x.m) * Math.pow(2, x.e);
};

export const isZero = (x: BF): boolean => x.m === 0n;
export const isNeg = (x: BF): boolean => x.m < 0n;
export const negate = (x: BF): BF => ({ m: -x.m, e: x.e });
export const abs = (x: BF): BF => (x.m < 0n ? { m: -x.m, e: x.e } : x);

export function add(a: BF, b: BF, prec: number = PREC): BF {
  if (a.m === 0n) return b;
  if (b.m === 0n) return a;
  const e = Math.min(a.e, b.e);
  const m = (a.m << BigInt(a.e - e)) + (b.m << BigInt(b.e - e));
  return normalize(round(m, e, prec));
}

export const sub = (a: BF, b: BF, prec: number = PREC): BF => add(a, negate(b), prec);

export function mul(a: BF, b: BF, prec: number = PREC): BF {
  if (a.m === 0n || b.m === 0n) return BF_ZERO;
  return normalize(round(a.m * b.m, a.e + b.e, prec));
}

export function div(a: BF, b: BF, prec: number = PREC): BF {
  if (b.m === 0n) throw new RangeError('bigfloat division by zero');
  if (a.m === 0n) return BF_ZERO;
  const shift = prec + bitLength(b.m) - bitLength(a.m) + 2;
  const s = shift > 0 ? shift : 0;
  const q = (a.m << BigInt(s)) / b.m;
  return normalize(round(q, a.e - b.e - s, prec));
}

export function cmp(a: BF, b: BF): -1 | 0 | 1 {
  const d = sub(a, b);
  return d.m < 0n ? -1 : d.m > 0n ? 1 : 0;
}

/** Integer power by squaring. Exact exponent, no exp/ln round trip. */
export function powInt(x: BF, n: number, prec: number = PREC): BF {
  if (n === 0) return fromInt(1);
  let k = Math.abs(n);
  let base = x;
  let acc = fromInt(1);
  while (k > 0) {
    if (k & 1) acc = mul(acc, base, prec + 8);
    base = mul(base, base, prec + 8);
    k >>= 1;
  }
  return n < 0 ? div(fromInt(1), acc, prec) : round(acc.m, acc.e, prec);
}

/** Newton iteration on y^2 = x. Doubles correct bits each pass. */
export function sqrt(x: BF, prec: number = PREC): BF {
  if (x.m < 0n) throw new RangeError('sqrt of a negative bigfloat');
  if (x.m === 0n) return BF_ZERO;
  const w = prec + 16;
  // Integer sqrt of the mantissa scaled to an even exponent gives the seed.
  let e = x.e;
  let m = x.m;
  const extra = w * 2 - bitLength(m);
  const s = extra > 0 ? extra : 0;
  m <<= BigInt(s);
  e -= s;
  if (e % 2 !== 0) { m <<= 1n; e -= 1; }
  let r = 1n << BigInt(Math.ceil(bitLength(m) / 2));
  for (;;) {
    const next = (r + m / r) >> 1n;
    if (next >= r) break;
    r = next;
  }
  return normalize(round(r, e / 2, prec));
}

// ------------------------------------------------------------------ constants

const constCache = new Map<string, BF>();
function cached(name: string, prec: number, make: (p: number) => BF): BF {
  const k = `${name}:${prec}`;
  const hit = constCache.get(k);
  if (hit) return hit;
  const v = make(prec);
  constCache.set(k, v);
  return v;
}

/** atan(1/n) by the alternating series, exact rational terms. */
function atanInvInt(n: bigint, prec: number): BF {
  const w = prec + 32;
  const one = 1n << BigInt(w);
  const n2 = n * n;
  let term = one / n;
  let acc = term;
  let k = 1n;
  let sign = -1n;
  while (term !== 0n) {
    term = term / n2;
    const contribution = term / (2n * k + 1n);
    if (contribution === 0n) break;
    acc += sign * contribution;
    sign = -sign;
    k += 1n;
  }
  return normalize(round(acc, -w, prec));
}

/** Machin's formula: pi/4 = 4·atan(1/5) − atan(1/239). */
export const pi = (prec: number = PREC): BF =>
  cached('pi', prec, (p) => {
    const w = p + 32;
    const a = mul(fromInt(4), atanInvInt(5n, w), w);
    const b = atanInvInt(239n, w);
    const quarter = sub(a, b, w);
    const full = mul(fromInt(4), quarter, w);
    return normalize(round(full.m, full.e, prec));
  });

/** ln 2 = 2·atanh(1/3), which converges fast. */
export const ln2 = (prec: number = PREC): BF =>
  cached('ln2', prec, (p) => {
    const w = p + 32;
    const one = 1n << BigInt(w);
    let term = one / 3n;
    let acc = term;
    let k = 1n;
    while (term !== 0n) {
      term = term / 9n;
      const c = term / (2n * k + 1n);
      if (c === 0n) break;
      acc += c;
      k += 1n;
    }
    return normalize(round(2n * acc, -w, prec));
  });

export const e = (prec: number = PREC): BF => cached('e', prec, (p) => exp(fromInt(1), p));

// --------------------------------------------------------- elementary functions

/** exp via range reduction x = k·ln2 + r then a Taylor series on the small r. */
export function exp(x: BF, prec: number = PREC): BF {
  if (x.m === 0n) return fromInt(1);
  const w = prec + 32;
  const L2 = ln2(w);
  const kf = toNumber(div(x, L2, 64));
  if (!Number.isFinite(kf) || Math.abs(kf) > 1e9) throw new RangeError('exp argument out of range');
  const k = Math.round(kf);
  const r = sub(x, mul(fromInt(k), L2, w), w);
  // |r| <= ln2/2 < 0.35, so the series converges in ~40 terms at this precision.
  let term = fromInt(1);
  let acc = fromInt(1);
  for (let i = 1; i < 400; i++) {
    term = div(mul(term, r, w), fromInt(i), w);
    if (term.m === 0n) break;
    acc = add(acc, term, w);
    if (bitLength(term.m) + term.e < acc.e - 8) break; // term below the noise floor
  }
  return normalize(round(acc.m, acc.e + k, prec));
}

/** ln via ln(m·2^e) = e·ln2 + ln(m), with ln(m) = 2·atanh((m−1)/(m+1)). */
export function ln(x: BF, prec: number = PREC): BF {
  if (x.m <= 0n) throw new RangeError('ln of a non-positive bigfloat');
  const w = prec + 32;
  // Split off the exponent so the series argument sits in [1, 2).
  const bits = bitLength(x.m);
  const shift = x.e + bits;
  const mantissa: BF = { m: x.m, e: -bits }; // in [0.5, 1)
  const t = div(sub(mantissa, fromInt(1), w), add(mantissa, fromInt(1), w), w);
  const t2 = mul(t, t, w);
  let term = t;
  let acc = t;
  for (let i = 1; i < 4000; i++) {
    term = mul(term, t2, w);
    if (term.m === 0n) break;
    const c = div(term, fromInt(2 * i + 1), w);
    if (c.m === 0n) break;
    acc = add(acc, c, w);
    if (bitLength(c.m) + c.e < acc.e - 8) break;
  }
  const lnMant = mul(fromInt(2), acc, w);
  const result = add(lnMant, mul(fromInt(shift), ln2(w), w), w);
  return normalize(round(result.m, result.e, prec));
}

/** Reduce an angle into [−pi, pi] so the Taylor series stays accurate. */
function reduceAngle(x: BF, prec: number): BF {
  const w = prec + 32;
  const P = pi(w);
  const twoPi = mul(fromInt(2), P, w);
  const kf = toNumber(div(x, twoPi, 64));
  if (!Number.isFinite(kf) || Math.abs(kf) > 1e12) throw new RangeError('angle out of range');
  const k = Math.round(kf);
  if (k === 0) return x;
  // Recompute the multiple at working precision, not from the double estimate.
  return sub(x, mul(fromInt(k), twoPi, w), w);
}

export function sin(x: BF, prec: number = PREC): BF {
  const w = prec + 32;
  const r = reduceAngle(x, w);
  const r2 = mul(r, r, w);
  let term = r;
  let acc = r;
  for (let i = 1; i < 400; i++) {
    term = div(mul(term, r2, w), fromInt((2 * i) * (2 * i + 1)), w);
    term = negate(term);
    if (term.m === 0n) break;
    acc = add(acc, term, w);
    if (bitLength(term.m) + term.e < acc.e - 8 && i > 4) break;
  }
  return normalize(round(acc.m, acc.e, prec));
}

export function cos(x: BF, prec: number = PREC): BF {
  const w = prec + 32;
  const r = reduceAngle(x, w);
  const r2 = mul(r, r, w);
  let term = fromInt(1);
  let acc = fromInt(1);
  for (let i = 1; i < 400; i++) {
    term = div(mul(term, r2, w), fromInt((2 * i - 1) * (2 * i)), w);
    term = negate(term);
    if (term.m === 0n) break;
    acc = add(acc, term, w);
    if (bitLength(term.m) + term.e < acc.e - 8 && i > 4) break;
  }
  return normalize(round(acc.m, acc.e, prec));
}

export function tan(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  const c = cos(x, w);
  if (isZero(c)) throw new RangeError('tan at a pole');
  return div(sin(x, w), c, prec);
}

/** atan with halving reduction: atan(x) = 2·atan(x / (1 + sqrt(1 + x²))). */
export function atan(x: BF, prec: number = PREC): BF {
  const w = prec + 32;
  let t = x;
  let doublings = 0;
  // Shrink |t| below 1/8 so the series needs few terms.
  while (cmp(abs(t), { m: 1n, e: -3 }) > 0 && doublings < 80) {
    const inner = sqrt(add(fromInt(1), mul(t, t, w), w), w);
    t = div(t, add(fromInt(1), inner, w), w);
    doublings++;
  }
  const t2 = mul(t, t, w);
  let term = t;
  let acc = t;
  let sign = -1;
  for (let i = 1; i < 4000; i++) {
    term = mul(term, t2, w);
    if (term.m === 0n) break;
    const c = div(term, fromInt(2 * i + 1), w);
    if (c.m === 0n) break;
    acc = add(acc, sign > 0 ? c : negate(c), w);
    sign = -sign;
    if (bitLength(c.m) + c.e < acc.e - 8) break;
  }
  const out = mul(fromInt(1 << Math.min(doublings, 30)), acc, w);
  const scaled = doublings > 30 ? mul(fromInt(2 ** (doublings - 30)), out, w) : out;
  return normalize(round(scaled.m, scaled.e, prec));
}

export function asin(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  const one = fromInt(1);
  const c = cmp(abs(x), one);
  if (c > 0) throw new RangeError('asin outside [-1, 1]');
  if (c === 0) {
    const h = div(pi(w), fromInt(2), prec);
    return isNeg(x) ? negate(h) : h;
  }
  return atan(div(x, sqrt(sub(one, mul(x, x, w), w), w), w), prec);
}

export function acos(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  return sub(div(pi(w), fromInt(2), w), asin(x, w), prec);
}

export function sinh(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  const ex = exp(x, w);
  return div(sub(ex, div(fromInt(1), ex, w), w), fromInt(2), prec);
}
export function cosh(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  const ex = exp(x, w);
  return div(add(ex, div(fromInt(1), ex, w), w), fromInt(2), prec);
}
export function tanh(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  return div(sinh(x, w), cosh(x, w), prec);
}
export function atanh(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  const one = fromInt(1);
  if (cmp(abs(x), one) >= 0) throw new RangeError('atanh outside (-1, 1)');
  return div(ln(div(add(one, x, w), sub(one, x, w), w), w), fromInt(2), prec);
}
export function asinh(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  return ln(add(x, sqrt(add(mul(x, x, w), fromInt(1), w), w), w), prec);
}
export function acosh(x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  if (cmp(x, fromInt(1)) < 0) throw new RangeError('acosh below 1');
  return ln(add(x, sqrt(sub(mul(x, x, w), fromInt(1), w), w), w), prec);
}

/** General power. Integer exponents stay exact; otherwise exp(y·ln x). */
export function pow(x: BF, y: BF, prec: number = PREC): BF {
  const yn = toNumber(y);
  if (Number.isInteger(yn) && Math.abs(yn) < 1e6) return powInt(x, yn, prec);
  if (x.m < 0n) throw new RangeError('negative base with a non-integer exponent');
  if (x.m === 0n) return BF_ZERO;
  const w = prec + 24;
  return exp(mul(y, ln(x, w), w), prec);
}

/**
 * Equality within COMPARE_BITS significant bits.
 * The scale term keeps the test relative for large values and absolute near
 * zero, so cancellation down to ~1e-30 still reads as zero rather than noise.
 */
export function nearlyEqual(a: BF, b: BF, bits: number = COMPARE_BITS): boolean {
  const d = abs(sub(a, b));
  if (d.m === 0n) return true;
  const scale = cmp(abs(a), abs(b)) > 0 ? abs(a) : abs(b);
  const dMag = bitLength(d.m) + d.e;
  const sMag = scale.m === 0n ? 0 : bitLength(scale.m) + scale.e;
  // Absolute floor: anything below 2^-bits counts as zero.
  if (dMag < -bits) return true;
  return dMag - sMag < -bits;
}

export function toDecimalString(x: BF, digits = 20): string {
  if (x.m === 0n) return '0';
  const neg = x.m < 0n;
  const m = neg ? -x.m : x.m;
  const scale = 10n ** BigInt(digits + 5);
  const scaled = x.e >= 0 ? m * (1n << BigInt(x.e)) * scale : (m * scale) >> BigInt(-x.e);
  let s = scaled.toString().padStart(digits + 6, '0');
  const intPart = s.slice(0, s.length - (digits + 5)) || '0';
  let frac = s.slice(s.length - (digits + 5)).slice(0, digits).replace(/0+$/, '');
  return (neg ? '-' : '') + intPart + (frac ? '.' + frac : '');
}

/** Quadrant-correct angle of (x, y). Needed for complex log. */
export function atan2(y: BF, x: BF, prec: number = PREC): BF {
  const w = prec + 24;
  if (isZero(x)) {
    if (isZero(y)) return BF_ZERO;
    const h = div(pi(w), fromInt(2), prec);
    return isNeg(y) ? negate(h) : h;
  }
  const base = atan(div(y, x, w), w);
  if (!isNeg(x)) return round(base.m, base.e, prec);
  const P = pi(w);
  return isNeg(y) || isZero(y) ? sub(base, P, prec) : add(base, P, prec);
}
