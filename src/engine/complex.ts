/**
 * Complex arbitrary-precision numbers, built as pairs of BF.
 *
 * The equivalence oracle probes expressions at random points. Probing over the
 * complex plane rather than the real line removes the domain holes that make
 * real probing fragile: sqrt of a negative, log of a negative, and the roots of
 * a quadratic with negative discriminant all evaluate cleanly here instead of
 * forcing the prober to discard the point and retry.
 *
 * Branch cuts follow the standard principal values (arg in (-pi, pi]), which is
 * what the printer and the solvers assume everywhere else.
 */

import * as B from './bigfloat.ts';
import type { BF } from './bigfloat.ts';
import type { Rat } from './rational.ts';

export interface C {
  readonly re: BF;
  readonly im: BF;
}

export const C_ZERO: C = { re: B.BF_ZERO, im: B.BF_ZERO };
export const C_ONE: C = { re: B.fromInt(1), im: B.BF_ZERO };
export const C_I: C = { re: B.BF_ZERO, im: B.fromInt(1) };

export const real = (x: BF): C => ({ re: x, im: B.BF_ZERO });
export const fromInt = (n: number | bigint): C => real(B.fromInt(n));
export const fromRat = (r: Rat, prec?: number): C => real(B.fromRat(r, prec));
export const isReal = (z: C): boolean => B.isZero(z.im);
export const isZero = (z: C): boolean => B.isZero(z.re) && B.isZero(z.im);

export const add = (a: C, b: C, p?: number): C => ({ re: B.add(a.re, b.re, p), im: B.add(a.im, b.im, p) });
export const sub = (a: C, b: C, p?: number): C => ({ re: B.sub(a.re, b.re, p), im: B.sub(a.im, b.im, p) });
export const neg = (a: C): C => ({ re: B.negate(a.re), im: B.negate(a.im) });
export const conj = (a: C): C => ({ re: a.re, im: B.negate(a.im) });

export function mul(a: C, b: C, p?: number): C {
  return {
    re: B.sub(B.mul(a.re, b.re, p), B.mul(a.im, b.im, p), p),
    im: B.add(B.mul(a.re, b.im, p), B.mul(a.im, b.re, p), p),
  };
}

export function div(a: C, b: C, p?: number): C {
  const d = B.add(B.mul(b.re, b.re, p), B.mul(b.im, b.im, p), p);
  if (B.isZero(d)) throw new RangeError('complex division by zero');
  return {
    re: B.div(B.add(B.mul(a.re, b.re, p), B.mul(a.im, b.im, p), p), d, p),
    im: B.div(B.sub(B.mul(a.im, b.re, p), B.mul(a.re, b.im, p), p), d, p),
  };
}

/** |z| */
export const abs = (z: C, p?: number): BF =>
  B.sqrt(B.add(B.mul(z.re, z.re, p), B.mul(z.im, z.im, p), p), p);

/** arg(z) in (-pi, pi] */
export const arg = (z: C, p?: number): BF => B.atan2(z.im, z.re, p);

export function exp(z: C, p?: number): C {
  const m = B.exp(z.re, p);
  return { re: B.mul(m, B.cos(z.im, p), p), im: B.mul(m, B.sin(z.im, p), p) };
}

/** Principal log. */
export function log(z: C, p?: number): C {
  if (isZero(z)) throw new RangeError('log of zero');
  return { re: B.ln(abs(z, p), p), im: arg(z, p) };
}

export function powC(z: C, w: C, p?: number): C {
  if (isZero(z)) {
    if (isZero(w)) return C_ONE;
    if (B.isNeg(w.re)) throw new RangeError('zero to a negative power');
    return C_ZERO;
  }
  return exp(mul(w, log(z, p), p), p);
}

/** Integer powers stay exact — no log/exp round trip and no branch-cut choice. */
export function powInt(z: C, n: number, p?: number): C {
  if (n === 0) return C_ONE;
  let k = Math.abs(n);
  let base = z;
  let acc = C_ONE;
  while (k > 0) {
    if (k & 1) acc = mul(acc, base, p);
    base = mul(base, base, p);
    k >>= 1;
  }
  return n < 0 ? div(C_ONE, acc, p) : acc;
}

export const sqrt = (z: C, p?: number): C =>
  isReal(z) && !B.isNeg(z.re) ? real(B.sqrt(z.re, p)) : powC(z, { re: B.fromRat({ n: 1n, d: 2n }, p), im: B.BF_ZERO }, p);

export function sin(z: C, p?: number): C {
  if (isReal(z)) return real(B.sin(z.re, p));
  const iz = mul(C_I, z, p);
  return div(sub(exp(iz, p), exp(neg(iz), p), p), mul(fromInt(2), C_I, p), p);
}
export function cos(z: C, p?: number): C {
  if (isReal(z)) return real(B.cos(z.re, p));
  const iz = mul(C_I, z, p);
  return div(add(exp(iz, p), exp(neg(iz), p), p), fromInt(2), p);
}
export function tan(z: C, p?: number): C {
  const c = cos(z, p);
  if (isZero(c)) throw new RangeError('tan at a pole');
  return div(sin(z, p), c, p);
}
export const sinh = (z: C, p?: number): C => div(sub(exp(z, p), exp(neg(z), p), p), fromInt(2), p);
export const cosh = (z: C, p?: number): C => div(add(exp(z, p), exp(neg(z), p), p), fromInt(2), p);
export const tanh = (z: C, p?: number): C => div(sinh(z, p), cosh(z, p), p);

export const asin = (z: C, p?: number): C =>
  mul(neg(C_I), log(add(mul(C_I, z, p), sqrt(sub(C_ONE, powInt(z, 2, p), p), p), p), p), p);
export const acos = (z: C, p?: number): C =>
  sub(real(B.div(B.pi(p), B.fromInt(2), p)), asin(z, p), p);
export const atan = (z: C, p?: number): C =>
  isReal(z)
    ? real(B.atan(z.re, p))
    : div(mul(C_I, log(div(add(C_I, z, p), sub(C_I, z, p), p), p), p), fromInt(2), p);

/** Agreement to within the shared comparison threshold on both components. */
export const nearlyEqual = (a: C, b: C, bits?: number): boolean => {
  const d = sub(a, b);
  const scale = B.add(B.abs(a.re), B.abs(a.im));
  const magnitude = B.cmp(scale, B.fromInt(1)) > 0 ? scale : B.fromInt(1);
  return (
    B.nearlyEqual(B.div(d.re, magnitude), B.BF_ZERO, bits) &&
    B.nearlyEqual(B.div(d.im, magnitude), B.BF_ZERO, bits)
  );
};

export const toString = (z: C, digits = 12): string =>
  B.isZero(z.im)
    ? B.toDecimalString(z.re, digits)
    : `${B.toDecimalString(z.re, digits)} ${B.isNeg(z.im) ? '-' : '+'} ${B.toDecimalString(B.abs(z.im), digits)}i`;
