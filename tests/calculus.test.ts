import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../src/engine/parse.ts';
import { toText, toLatex } from '../src/engine/print.ts';
import { sym, int, fn as mkFn, mul, pow, add } from '../src/engine/expr.ts';
import { equivalent } from '../src/engine/equivalence.ts';
import { evalNumeric } from '../src/engine/evaluate.ts';
import { validateDerivation } from '../src/engine/derive.ts';
import {
  differentiate, differentiateDerivation, limitAt, antiderivative,
  definiteIntegral, deriv,
} from '../src/engine/solve/calculus.ts';

const x = sym('x');

describe('derivatives are checked against numerical differentiation', () => {
  it('the evaluator can differentiate numerically at all', () => {
    // This is what makes the symbolic differentiator checkable: the two share
    // no code, so agreement is evidence rather than tautology.
    expect(equivalent(deriv(pow(x, int(3)), 'x'), mul(int(3), pow(x, int(2)))).equal).toBe(true);
    expect(equivalent(deriv(pow(x, int(3)), 'x'), mul(int(2), pow(x, int(2)))).equal).toBe(false);
    expect(equivalent(deriv(mkFn('sin', x), 'x'), mkFn('cos', x)).equal).toBe(true);
    expect(equivalent(deriv(mkFn('ln', x), 'x'), pow(x, int(-1))).equal).toBe(true);
  });

  const cases: Array<[string, string]> = [
    ['3x^4 - 2x', '12x^3 - 2'],
    ['x^2', '2x'],
    ['5', '0'],
    ['x*sin(x)', 'sin(x) + x*cos(x)'],
    ['sin(3x^2)', '6x*cos(3x^2)'],
    ['e^(2x)', '2e^(2x)'],
    ['ln(x^2+1)', '2x/(x^2+1)'],
    ['(2x+1)/(x-3)', '-7/(x-3)^2'],
    ['sqrt(x)', '1/(2sqrt(x))'],
    ['cos(x)/x', '(-x*sin(x) - cos(x))/x^2'],
    ['2^x', '2^x*ln(2)'],
    ['tan(x)', 'sec(x)^2'],
    ['x^3*e^x', '3x^2*e^x + x^3*e^x'],
  ];

  for (const [src, expected] of cases) {
    it(`d/dx ${src} = ${expected}`, () => {
      const got = differentiate(parse(src), 'x');
      expect(equivalent(got, parse(expected)).equal, `got ${toText(got)}`).toBe(true);
    });
  }

  it('every step of every derivation verifies', () => {
    for (const [src] of cases) {
      const d = differentiateDerivation(parse(src), 'x');
      expect(validateDerivation(d), src).toEqual([]);
      expect(d.incomplete, src).toBeUndefined();
    }
  });

  it('random polynomials differentiate correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -8, max: 8 }), fc.integer({ min: -8, max: 8 }),
        fc.integer({ min: -8, max: 8 }), fc.integer({ min: 2, max: 5 }),
        (a, b, c, n) => {
          const f = parse(`${a}x^${n} + ${b}x^2 + ${c}x`);
          const expected = parse(`${a * n}x^${n - 1} + ${2 * b}x + ${c}`);
          const got = differentiate(f, 'x');
          if (!equivalent(got, expected).equal) return false;
          return validateDerivation(differentiateDerivation(f, 'x')).length === 0;
        },
      ),
      { numRuns: 120 },
    );
  });

  it('the chain rule is not skipped', () => {
    // The classic omission: forgetting to multiply by the inner derivative.
    const got = differentiate(parse('sin(5x)'), 'x');
    expect(equivalent(got, parse('5cos(5x)')).equal).toBe(true);
    expect(equivalent(got, parse('cos(5x)')).equal).toBe(false);
  });

  it('the product rule is not the product of derivatives', () => {
    const got = differentiate(parse('x^2*sin(x)'), 'x');
    expect(equivalent(got, parse('2x*cos(x)')).equal).toBe(false);
  });
});

describe('limits', () => {
  it('evaluates by substitution where the function is defined', () => {
    const r = limitAt(parse('x^2 + 3x'), 'x', int(2));
    expect(r.value && toText(r.value)).toBe('10');
    expect(validateDerivation(r.derivation)).toEqual([]);
  });

  it('resolves 0/0 by cancelling', () => {
    const r = limitAt(parse('(x^2-1)/(x-1)'), 'x', int(1));
    expect(r.value && toText(r.value)).toBe('2');
    expect(validateDerivation(r.derivation)).toEqual([]);
  });

  it('does not report 0/0 as zero', () => {
    // A product must not short-circuit past an undefined factor: 0 * (1/0) is
    // not 0, and treating it as such turns an indeterminate form into an answer.
    const r = limitAt(parse('(x^2-4)/(x-2)'), 'x', int(2));
    expect(r.value && toText(r.value)).toBe('4');
  });

  it('random cancelling limits come out right', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -7, max: 7 }), fc.integer({ min: -7, max: 7 }),
        (a, b) => {
          if (a === b) return true;
          const r = limitAt(parse(`((x - ${a})*(x - ${b}))/(x - ${a})`), 'x', int(a));
          return r.value !== null && toText(r.value) === String(a - b);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('integration', () => {
  it('antiderivatives differentiate back to the integrand', () => {
    for (const src of ['3x^2', 'x', '5', '4x^3 - 2x', 'sin(x)', 'cos(x)', 'e^x', '1/x']) {
      const F = antiderivative(parse(src), 'x');
      expect(F, src).not.toBeNull();
      if (!F) continue;
      const back = differentiate(F, 'x');
      expect(equivalent(back, parse(src)).equal, `${src}: got ${toText(back)}`).toBe(true);
    }
  });

  it('the power rule in reverse handles the n = -1 exception', () => {
    const F = antiderivative(parse('1/x'), 'x');
    expect(F && toText(F)).toContain('ln');
  });

  it('definite integrals match the fundamental theorem', () => {
    const r = definiteIntegral(parse('x^2'), 'x', int(0), int(3));
    expect(r.value && toText(r.value)).toBe('9');
    expect(validateDerivation(r.derivation)).toEqual([]);
  });

  it('random definite integrals of powers are exact', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 5 }),
        (coefficient, degree, upper) => {
          const r = definiteIntegral(parse(`${coefficient}x^${degree}`), 'x', int(0), int(upper));
          if (!r.value) return false;
          // c * u^(n+1) / (n+1), exactly.
          const expected = parse(`${coefficient}*${upper}^${degree + 1}/${degree + 1}`);
          return equivalent(r.value, expected).equal
            && validateDerivation(r.derivation).length === 0;
        },
      ),
      { numRuns: 100 },
    );
  });
});
