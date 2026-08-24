import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  add, mul, pow, sub, div, num, int, sym, sqrt, fn, cst, neg, equation, rel,
} from '../src/engine/expr.ts';
import { equivalent, equivalentSets, equivalentRelations, constantRatio } from '../src/engine/equivalence.ts';
import { rat } from '../src/engine/rational.ts';

const x = sym('x'), y = sym('y');

describe('equivalence: things that ARE equal', () => {
  const pairs: Array<[string, any, any]> = [
    ['2+3 = 5', add(int(2), int(3)), int(5)],
    ['x+x = 2x', add(x, x), mul(int(2), x)],
    ['(x+1)^2 = x^2+2x+1', pow(add(x, int(1)), int(2)), add(pow(x, int(2)), mul(int(2), x), int(1))],
    ['(x+2)(x-2) = x^2-4', mul(add(x, int(2)), sub(x, int(2))), sub(pow(x, int(2)), int(4))],
    ['x/x = 1 off the pole', div(x, x), int(1)],
    ['(x^2-1)/(x-1) = x+1', div(sub(pow(x, int(2)), int(1)), sub(x, int(1))), add(x, int(1))],
    ['1/2+1/3 = 5/6', add(num(rat(1, 2)), num(rat(1, 3))), num(rat(5, 6))],
    ['sqrt(8) = 2 sqrt(2)', sqrt(int(8)), mul(int(2), sqrt(int(2)))],
    ['sin^2+cos^2 = 1', add(pow(fn('sin', x), int(2)), pow(fn('cos', x), int(2))), int(1)],
    ['ln(ab) = ln a + ln b', fn('ln', mul(x, y)), add(fn('ln', x), fn('ln', y))],
    ['e^(ln x) = x', fn('exp', fn('ln', x)), x],
    ['cos(2x) = 1-2sin^2 x', fn('cos', mul(int(2), x)), sub(int(1), mul(int(2), pow(fn('sin', x), int(2))))],
    ['(x+y)^3 expanded', pow(add(x, y), int(3)),
      add(pow(x, int(3)), mul(int(3), pow(x, int(2)), y), mul(int(3), x, pow(y, int(2))), pow(y, int(3)))],
    ['golden ratio identity', pow(div(add(int(1), sqrt(int(5))), int(2)), int(2)),
      add(div(add(int(1), sqrt(int(5))), int(2)), int(1))],
    ['e^(i pi) = -1', fn('exp', mul(cst('i'), cst('pi'))), int(-1)],
  ];
  for (const [name, a, b] of pairs) {
    it(name, () => {
      const r = equivalent(a, b);
      expect(r.equal, `${name}: ${r.detail}`).toBe(true);
    });
  }
});

describe('equivalence: things that are NOT equal', () => {
  const pairs: Array<[string, any, any]> = [
    ['2+3 != 6', add(int(2), int(3)), int(6)],
    ['x+x != x^2', add(x, x), pow(x, int(2))],
    ['(x+1)^2 != x^2+1  (the classic)', pow(add(x, int(1)), int(2)), add(pow(x, int(2)), int(1))],
    ['sqrt(x^2+y^2) != x+y', sqrt(add(pow(x, int(2)), pow(y, int(2)))), add(x, y)],
    ['1/(x+y) != 1/x + 1/y', div(int(1), add(x, y)), add(div(int(1), x), div(int(1), y))],
    ['ln(x+y) != ln x + ln y', fn('ln', add(x, y)), add(fn('ln', x), fn('ln', y))],
    ['sin(2x) != 2 sin x', fn('sin', mul(int(2), x)), mul(int(2), fn('sin', x))],
    ['off by a tiny amount', num(rat(1, 3)), num(rat(33333333333n, 100000000000n))],
    ['x^2 != x^3', pow(x, int(2)), pow(x, int(3))],
    ['2x+1 != 2x+2', add(mul(int(2), x), int(1)), add(mul(int(2), x), int(2))],
  ];
  for (const [name, a, b] of pairs) {
    it(name, () => {
      const r = equivalent(a, b);
      expect(r.equal, `${name} was wrongly accepted: ${r.detail}`).toBe(false);
    });
  }
});

describe('equivalence reports its method honestly', () => {
  it('uses exact arithmetic for numeric constants', () => {
    expect(equivalent(add(num(rat(1, 3)), num(rat(1, 6))), num(rat(1, 2))).method).toBe('exact');
  });
  it('uses exact probing for polynomial identities', () => {
    const r = equivalent(pow(add(x, int(3)), int(2)), add(pow(x, int(2)), mul(int(6), x), int(9)));
    expect(r.method).toBe('probe-exact');
    expect(r.probes).toBeGreaterThanOrEqual(12);
    expect(r.falsePositiveBound).toMatch(/^below 1e-/);
  });
  it('falls back to numeric probing for transcendentals', () => {
    const r = equivalent(fn('sin', mul(int(2), x)), mul(int(2), fn('sin', x), fn('cos', x)));
    expect(r.equal).toBe(true);
    expect(r.method).toBe('probe-numeric');
  });
});

describe('relations compare by solution set', () => {
  it('2x = 6 is the same statement as x = 3', () => {
    expect(equivalentRelations(equation(mul(int(2), x), int(6)), equation(x, int(3))).equal).toBe(true);
  });
  it('x = 3 is the same as 3 = x', () => {
    expect(equivalentRelations(equation(x, int(3)), equation(int(3), x)).equal).toBe(true);
  });
  it('x = 3 differs from x = 4', () => {
    expect(equivalentRelations(equation(x, int(3)), equation(x, int(4))).equal).toBe(false);
  });
  it('multiplying an inequality by a negative flips it', () => {
    const a = rel('<', x, int(3));
    const b = rel('<', mul(int(-2), x), int(-6));
    expect(equivalentRelations(a, b).equal).toBe(false);
  });
  it('multiplying an inequality by a positive does not', () => {
    expect(equivalentRelations(rel('<', x, int(3)), rel('<', mul(int(2), x), int(6))).equal).toBe(true);
  });
  it('finds the constant ratio between two forms', () => {
    const k = constantRatio(mul(int(6), x), mul(int(2), x));
    expect(k && Number(k.n) / Number(k.d)).toBe(3);
  });
});

describe('solution sets ignore order', () => {
  it('{2,-3} equals {-3,2}', () => {
    expect(equivalentSets([int(2), int(-3)], [int(-3), int(2)]).equal).toBe(true);
  });
  it('{2,-3} differs from {2,3}', () => {
    expect(equivalentSets([int(2), int(-3)], [int(2), int(3)]).equal).toBe(false);
  });
  it('a missing root is caught', () => {
    expect(equivalentSets([int(2), int(-3)], [int(2)]).equal).toBe(false);
  });
});

describe('property: expansion never changes value', () => {
  it('random polynomial identities survive 200 random cases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -9, max: 9 }), fc.integer({ min: -9, max: 9 }),
        fc.integer({ min: -9, max: 9 }), fc.integer({ min: -9, max: 9 }),
        (a, b, c, d) => {
          // (ax+b)(cx+d) = acx^2 + (ad+bc)x + bd, always
          const lhs = mul(add(mul(int(a), x), int(b)), add(mul(int(c), x), int(d)));
          const rhs = add(mul(int(a * c), pow(x, int(2))), mul(int(a * d + b * c), x), int(b * d));
          return equivalent(lhs, rhs).equal;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a deliberately wrong coefficient is always rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 9 }),
        (a, b) => {
          const lhs = pow(add(mul(int(a), x), int(b)), int(2));
          const wrong = add(mul(int(a * a), pow(x, int(2))), mul(int(a * b), x), int(b * b)); // missing the 2
          return !equivalent(lhs, wrong).equal;
        },
      ),
      { numRuns: 100 },
    );
  });
});
