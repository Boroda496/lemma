/**
 * Exact rational arithmetic over BigInt.
 *
 * This is the floor of the whole engine. No IEEE floats are ever used to
 * compute or compare an answer, so 0.1 + 0.2 === 0.3 here, and
 * (1/3) * 3 is exactly 1. Floats appear only in graphing and in the
 * high-precision numeric fallback used for transcendental equivalence,
 * and never leak into a graded result.
 *
 * Invariant, enforced by construction: den > 0, gcd(|num|, den) === 1.
 */

export interface Rat {
  readonly n: bigint; // numerator, carries the sign
  readonly d: bigint; // denominator, strictly positive
}

function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** The only constructor. Normalizes sign and reduces to lowest terms. */
export function rat(n: bigint | number, d: bigint | number = 1n): Rat {
  let nn = typeof n === 'bigint' ? n : BigInt(Math.trunc(n));
  let dd = typeof d === 'bigint' ? d : BigInt(Math.trunc(d));
  if (dd === 0n) throw new RangeError('rational with zero denominator');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  if (nn === 0n) return { n: 0n, d: 1n };
  const g = gcdBig(nn, dd);
  return { n: nn / g, d: dd / g };
}

export const ZERO: Rat = { n: 0n, d: 1n };
export const ONE: Rat = { n: 1n, d: 1n };
export const NEG_ONE: Rat = { n: -1n, d: 1n };
export const TWO: Rat = { n: 2n, d: 1n };
export const HALF: Rat = { n: 1n, d: 2n };

export const add = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export const div = (a: Rat, b: Rat): Rat => {
  if (b.n === 0n) throw new RangeError('division by zero');
  return rat(a.n * b.d, a.d * b.n);
};
export const neg = (a: Rat): Rat => ({ n: -a.n, d: a.d });
export const abs = (a: Rat): Rat => (a.n < 0n ? { n: -a.n, d: a.d } : a);
export const inv = (a: Rat): Rat => div(ONE, a);

/** Integer exponent only. Rational exponents are handled symbolically upstream. */
export function powInt(a: Rat, e: bigint | number): Rat {
  let k = typeof e === 'bigint' ? e : BigInt(Math.trunc(e));
  if (k === 0n) return ONE;
  let base = a;
  if (k < 0n) {
    if (a.n === 0n) throw new RangeError('0 raised to a negative power');
    base = inv(a);
    k = -k;
  }
  let resultN = 1n;
  let resultD = 1n;
  let bn = base.n;
  let bd = base.d;
  while (k > 0n) {
    if (k & 1n) {
      resultN *= bn;
      resultD *= bd;
    }
    bn *= bn;
    bd *= bd;
    k >>= 1n;
  }
  return rat(resultN, resultD);
}

export const eq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;
export const isZero = (a: Rat): boolean => a.n === 0n;
export const isOne = (a: Rat): boolean => a.n === 1n && a.d === 1n;
export const isNeg = (a: Rat): boolean => a.n < 0n;
export const isPos = (a: Rat): boolean => a.n > 0n;
export const isInt = (a: Rat): boolean => a.d === 1n;
export const sign = (a: Rat): -1 | 0 | 1 => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);

/** -1, 0, or 1. Exact — no float comparison. */
export function cmp(a: Rat, b: Rat): -1 | 0 | 1 {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export const lt = (a: Rat, b: Rat) => cmp(a, b) < 0;
export const lte = (a: Rat, b: Rat) => cmp(a, b) <= 0;
export const gt = (a: Rat, b: Rat) => cmp(a, b) > 0;
export const gte = (a: Rat, b: Rat) => cmp(a, b) >= 0;
export const min = (a: Rat, b: Rat) => (lte(a, b) ? a : b);
export const max = (a: Rat, b: Rat) => (gte(a, b) ? a : b);

/** Floor division toward negative infinity. */
export function floor(a: Rat): bigint {
  const q = a.n / a.d;
  return a.n < 0n && q * a.d !== a.n ? q - 1n : q;
}
export function ceil(a: Rat): bigint {
  const q = a.n / a.d;
  return a.n > 0n && q * a.d !== a.n ? q + 1n : q;
}

/**
 * Exact nth root when one exists, otherwise null.
 * Used to decide whether sqrt(x) simplifies to a rational or stays symbolic —
 * we never approximate and call it equal.
 */
export function exactRoot(a: Rat, n: number): Rat | null {
  if (n <= 0) return null;
  if (a.n < 0n && n % 2 === 0) return null;
  const rn = integerRoot(a.n < 0n ? -a.n : a.n, n);
  if (rn === null) return null;
  const rd = integerRoot(a.d, n);
  if (rd === null) return null;
  const signed = a.n < 0n ? -rn : rn;
  return rat(signed, rd);
}

/** Exact integer nth root via Newton iteration on BigInt, or null. */
export function integerRoot(x: bigint, n: number): bigint | null {
  if (x < 0n) return null;
  if (x === 0n) return 0n;
  if (x === 1n) return 1n;
  const nb = BigInt(n);
  // Seed from bit length so Newton converges in a handful of steps.
  let r = 1n << BigInt(Math.ceil(x.toString(2).length / n) + 1);
  for (;;) {
    const next = ((nb - 1n) * r + x / powBig(r, nb - 1n)) / nb;
    if (next >= r) break;
    r = next;
  }
  while (powBig(r + 1n, nb) <= x) r += 1n;
  while (r > 0n && powBig(r, nb) > x) r -= 1n;
  return powBig(r, nb) === x ? r : null;
}

export function powBig(b: bigint, e: bigint): bigint {
  let result = 1n;
  let base = b;
  let k = e;
  while (k > 0n) {
    if (k & 1n) result *= base;
    base *= base;
    k >>= 1n;
  }
  return result;
}

/** Largest perfect-nth-power factor of a positive integer: sqrt(72) -> {outside:6, inside:2}. */
export function extractRoot(x: bigint, n: number): { outside: bigint; inside: bigint } {
  if (x <= 0n) return { outside: 1n, inside: x };
  let outside = 1n;
  let inside = x;
  const nb = BigInt(n);
  for (let p = 2n; powBig(p, nb) <= inside; p += 1n) {
    for (;;) {
      const pk = powBig(p, nb);
      if (inside % pk === 0n) {
        inside /= pk;
        outside *= p;
      } else break;
    }
    if (p > 100000n) break; // guard: problem numbers are small by construction
  }
  return { outside, inside };
}

/** Decimal string with at most `places` digits, trailing zeros trimmed. Display only. */
export function toDecimalString(a: Rat, places = 10): string {
  const negative = a.n < 0n;
  const n = negative ? -a.n : a.n;
  const whole = n / a.d;
  let rem = n % a.d;
  if (rem === 0n) return (negative ? '-' : '') + whole.toString();
  let frac = '';
  for (let i = 0; i < places && rem !== 0n; i++) {
    rem *= 10n;
    frac += (rem / a.d).toString();
    rem %= a.d;
  }
  frac = frac.replace(/0+$/, '');
  return (negative ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

export const toNumber = (a: Rat): number => Number(a.n) / Number(a.d);

export function toString(a: Rat): string {
  return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
}

/** Parse "3", "-7/2", "1.25" exactly. Decimals become exact rationals, not floats. */
export function parseRat(s: string): Rat | null {
  const t = s.trim();
  let m = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(t);
  if (m) return rat(BigInt(m[1]!), BigInt(m[2]!));
  m = /^([+-]?)(\d*)\.(\d+)$/.exec(t);
  if (m) {
    const sgn = m[1] === '-' ? -1n : 1n;
    const whole = m[2] ? BigInt(m[2]) : 0n;
    const fracDigits = m[3]!;
    const scale = 10n ** BigInt(fracDigits.length);
    return rat(sgn * (whole * scale + BigInt(fracDigits)), scale);
  }
  m = /^([+-]?\d+)$/.exec(t);
  if (m) return rat(BigInt(m[1]!));
  return null;
}

/** Continued-fraction convergents — used to show "0.3333... = 1/3" style hints. */
export function bestRationalApprox(x: number, maxDen = 10000): Rat {
  let h1 = 1n, h0 = 0n, k1 = 0n, k0 = 1n;
  let b = x;
  for (let i = 0; i < 64; i++) {
    const a = BigInt(Math.floor(b));
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > BigInt(maxDen)) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    const frac = b - Math.floor(b);
    if (frac < 1e-12) break;
    b = 1 / frac;
  }
  return rat(h1, k1 === 0n ? 1n : k1);
}
