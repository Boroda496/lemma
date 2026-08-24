import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../src/engine/parse.ts';
import { toText } from '../src/engine/print.ts';
import { simplify, simplifyBest, factor, cancelFraction } from '../src/engine/canon.ts';
import { expand } from '../src/engine/polynomial.ts';
import { equivalent } from '../src/engine/equivalence.ts';

const s = (src: string) => toText(simplify(parse(src)));
const best = (src: string) => toText(simplifyBest(parse(src)));

describe('simplify does the arithmetic', () => {
  const cases: Array<[string, string]> = [
    ['2+3', '5'],
    ['1/2 + 1/3', '5/6'],
    ['2*3*4', '24'],
    ['x + x', '2*x'],
    ['3x + 5x', '8*x'],
    ['3x - 3x', '0'],
    ['x*x', 'x^2'],
    ['x^2*x^3', 'x^5'],
    ['x/x', '1'],
    ['2x/2', 'x'],
    ['0*x', '0'],
    ['1*x', 'x'],
    ['x^0', '1'],
    ['x^1', 'x'],
    ['sqrt(16)', '4'],
    ['sqrt(8)', '2*sqrt(2)'],
    ['sqrt(2)*sqrt(2)', '2'],
    ['sqrt(2)*sqrt(3)', 'sqrt(6)'],
    ['(x^2)^3', 'x^6'],
    ['2^10', '1024'],
    ['ln(1)', '0'],
    ['ln(e)', '1'],
    ['e^(ln(x))', 'x'],
    ['sin(0)', '0'],
    ['cos(0)', '1'],
    ['sin(pi)', '0'],
    ['cos(pi)', '-1'],
    ['sin(pi/6)', '1/2'],
    ['cos(pi/4)', 'sqrt(2)/2'],
    ['tan(pi/4)', '1'],
    ['sin(-x)', '-sin(x)'],
    ['cos(-x)', 'cos(x)'],
    ['5!', '120'],
    ['sqrt(-4)', '2*i'],
    ['abs(-7)', '7'],
  ];
  for (const [src, want] of cases) {
    it(`${src}  ->  ${want}`, () => expect(s(src)).toBe(want));
  }
});

describe('simplifyBest commits to expanded standard form', () => {
  const cases: Array<[string, string]> = [
    // Polynomials stay expanded, whether they arrived factored or not.
    ['x^2 - 4', 'x^2 - 4'],
    ['x^2 + 2x + 1', 'x^2 + 2*x + 1'],
    ['(x+1)(x+2)', 'x^2 + 3*x + 2'],
    ['2x^2 + 7x + 3', '2*x^2 + 7*x + 3'],
    // Fractions are the exception: factoring earns its place by cancelling.
    ['(x^2-1)/(x-1)', 'x + 1'],
    ['(x^2+5x+6)/(x+2)', 'x + 3'],
  ];
  for (const [src, want] of cases) {
    it(`${src}  ->  ${want}`, () => expect(best(src)).toBe(want));
  }
});

describe('factoring', () => {
  const cases: Array<[string, string]> = [
    ['x^2 - 9', '(x - 3)*(x + 3)'],
    ['x^2 + 5x + 6', '(x + 2)*(x + 3)'],
    ['2x^2 + 7x + 3', '(x + 3)*(2*x + 1)'],
    ['x^2 - 6x + 9', '(x - 3)^2'],
    ['x^3 - x', 'x*(x - 1)*(x + 1)'],
    ['x^2 + 1', 'x^2 + 1'],
    ['6x^2 - 6', '6*(x - 1)*(x + 1)'],
  ];
  for (const [src, want] of cases) {
    it(`${src}  ->  ${want}`, () => expect(toText(factor(parse(src)))).toBe(want));
  }
});

describe('every simplification preserves the value', () => {
  it('holds for 300 random rational expressions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -6, max: 6 }), fc.integer({ min: -6, max: 6 }),
        fc.integer({ min: -6, max: 6 }), fc.integer({ min: 1, max: 4 }),
        (a, b, c, n) => {
          const src = `(${a}x^2 + ${b}x + ${c})^${n}`;
          const e = parse(src);
          for (const variant of [simplify(e), simplifyBest(e), expand(e), factor(e)]) {
            if (!equivalent(e, variant).equal) return false;
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holds for random fractions, including the cancelling ones', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 5 }), fc.integer({ min: -5, max: 5 }),
        fc.integer({ min: -5, max: 5 }),
        (a, b, c) => {
          if (a === b) return true;
          const src = `((x - ${a})*(x - ${b}))/((x - ${a})*(x - ${c}))`;
          const e = parse(src);
          return equivalent(e, cancelFraction(e)).equal && equivalent(e, simplifyBest(e)).equal;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('holds for random trig and log expressions', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), (a, b) => {
        for (const src of [
          `sin(${a}x)*cos(${b}x)`, `ln(${a}x) + ln(${b}x)`, `sqrt(${a}x^2)`,
          `e^(${a}x)*e^(${b}x)`, `tan(${a}x)`,
        ]) {
          const e = parse(src);
          if (!equivalent(e, simplify(e)).equal) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe('simplify leaves the traps alone', () => {
  it('does not turn sqrt(x^2) into x, because it is |x|', () => {
    expect(equivalent(parse('sqrt(x^2)'), parse('x')).equal).toBe(false);
    expect(equivalent(simplify(parse('sqrt(x^2)')), parse('abs(x)')).equal).toBe(true);
  });
  it('does not cancel across an addition', () => {
    expect(equivalent(parse('(x+2)/2'), parse('x')).equal).toBe(false);
  });
  it('keeps 0^0 out of the answer path by treating it as 1 consistently', () => {
    expect(s('x^0')).toBe('1');
  });
});
