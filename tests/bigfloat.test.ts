import { describe, it, expect } from 'vitest';
import * as B from '../src/engine/bigfloat.ts';
import { rat } from '../src/engine/rational.ts';

const near = (x: B.BF, expected: number, tol = 1e-13) =>
  expect(Math.abs(B.toNumber(x) - expected)).toBeLessThan(tol * Math.max(1, Math.abs(expected)));

describe('bigfloat arithmetic', () => {
  it('adds, multiplies and divides exactly enough', () => {
    near(B.add(B.fromInt(1), B.fromInt(2)), 3);
    near(B.mul(B.fromRat(rat(1, 3)), B.fromInt(3)), 1);
    near(B.div(B.fromInt(1), B.fromInt(7)), 1 / 7);
    near(B.sub(B.fromRat(rat(1, 10)), B.fromRat(rat(1, 10))), 0);
  });

  it('represents 0.1 + 0.2 - 0.3 as exactly zero from rationals', () => {
    const s = B.sub(B.add(B.fromRat(rat(1, 10)), B.fromRat(rat(2, 10))), B.fromRat(rat(3, 10)));
    expect(B.isZero(s)).toBe(true);
  });

  it('takes square roots', () => {
    near(B.sqrt(B.fromInt(2)), Math.SQRT2);
    near(B.sqrt(B.fromInt(144)), 12);
    near(B.mul(B.sqrt(B.fromInt(3)), B.sqrt(B.fromInt(3))), 3, 1e-12);
  });
});

describe('bigfloat constants', () => {
  it('computes pi to well past double precision', () => {
    const s = B.toDecimalString(B.pi(), 40);
    expect(s.startsWith('3.14159265358979323846264338327950288419')).toBe(true);
  });
  it('computes e and ln2', () => {
    near(B.e(), Math.E);
    near(B.ln2(), Math.LN2);
    expect(B.toDecimalString(B.e(), 30).startsWith('2.718281828459045235360287471352')).toBe(true);
  });
});

describe('bigfloat elementary functions', () => {
  const cases: Array<[string, (x: B.BF) => B.BF, (x: number) => number, number[]]> = [
    ['exp', (x) => B.exp(x), Math.exp, [0, 1, -1, 2.5, -3.75, 10]],
    ['ln', (x) => B.ln(x), Math.log, [1, 2, 0.5, 10, 1234.5]],
    ['sin', (x) => B.sin(x), Math.sin, [0, 1, -1, 3, 10, 100, -50.25]],
    ['cos', (x) => B.cos(x), Math.cos, [0, 1, -1, 3, 10, 100, -50.25]],
    ['atan', (x) => B.atan(x), Math.atan, [0, 0.5, 1, -1, 5, -100]],
    ['sinh', (x) => B.sinh(x), Math.sinh, [0, 1, -2, 3.5]],
    ['tanh', (x) => B.tanh(x), Math.tanh, [0, 1, -2, 3.5]],
  ];
  for (const [name, f, ref, xs] of cases) {
    it(`${name} agrees with Math.${name} across the range`, () => {
      for (const x of xs) near(f(B.fromNumber(x)), ref(x), 1e-12);
    });
  }

  it('identities hold at high precision', () => {
    for (const x of [0.3, 1.7, -2.2, 5.5]) {
      const bx = B.fromNumber(x);
      // sin^2 + cos^2 = 1
      const s = B.sin(bx), c = B.cos(bx);
      expect(B.nearlyEqual(B.add(B.mul(s, s), B.mul(c, c)), B.fromInt(1))).toBe(true);
      // ln(exp(x)) = x
      expect(B.nearlyEqual(B.ln(B.exp(bx)), bx)).toBe(true);
    }
  });

  it('sin(pi) is zero to within the comparison threshold', () => {
    expect(B.nearlyEqual(B.sin(B.pi()), B.BF_ZERO)).toBe(true);
    expect(B.nearlyEqual(B.cos(B.pi()), B.fromInt(-1))).toBe(true);
  });

  it('separates values that differ far below double precision', () => {
    const a = B.fromInt(1);
    const b = B.add(B.fromInt(1), B.fromRat(rat(1n, 10n ** 25n)));
    expect(B.nearlyEqual(a, b)).toBe(false);
  });

  it('powers work for integer and fractional exponents', () => {
    near(B.pow(B.fromInt(2), B.fromInt(10)), 1024);
    near(B.pow(B.fromInt(2), B.fromRat(rat(1, 2))), Math.SQRT2);
    near(B.pow(B.fromInt(27), B.fromRat(rat(1, 3))), 3, 1e-12);
  });
});
