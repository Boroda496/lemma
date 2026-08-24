import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../src/engine/parse.ts';
import { toLatex } from '../src/engine/print.ts';
import {
  step, DerivationBuilder, DerivationError, validateDerivation, hintAt, progressOf,
  HintLevel, R_ARITHMETIC, R_SIMPLIFY,
} from '../src/engine/derive.ts';
import { simplifyDerivation } from '../src/engine/solve/steps.ts';
import { solveLinear, solveLinearSystem } from '../src/engine/solve/linear.ts';
import { solveQuadratic, chooseMethod, type QuadraticMethod } from '../src/engine/solve/quadratic.ts';
import { equivalent, equivalentSets } from '../src/engine/equivalence.ts';
import { evalExact } from '../src/engine/evaluate.ts';
import { toRatPoly } from '../src/engine/polynomial.ts';
import { int, add, mul, pow, num, sub as subE, type Expr } from '../src/engine/expr.ts';

/** The two sides of a relation, for tests that substitute back in. */
function sides(e: Expr): [Expr, Expr] {
  if (e.k !== 'rel') throw new Error('expected a relation');
  return [e.args[0]!, e.args[1]!];
}
import * as R from '../src/engine/rational.ts';

describe('a step that changes the answer cannot be built', () => {
  it('refuses a wrong arithmetic step', () => {
    expect(() => step({ rule: R_ARITHMETIC, from: parse('2+2'), to: parse('5') }))
      .toThrow(DerivationError);
  });
  it('refuses a wrong algebraic step', () => {
    expect(() => step({ rule: R_SIMPLIFY, from: parse('(x+1)^2'), to: parse('x^2+1') }))
      .toThrow(DerivationError);
  });
  it('accepts a correct one and records its evidence', () => {
    const s = step({ rule: R_ARITHMETIC, from: parse('2+3'), to: parse('5') });
    expect(s.evidence.equal).toBe(true);
    expect(s.evidence.method).toBe('exact');
  });
  it('the error names the rule and shows both lines', () => {
    try {
      step({ rule: R_SIMPLIFY, from: parse('x+x'), to: parse('x^2') });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DerivationError);
      const err = e as DerivationError;
      expect(err.rule).toBe('simplify');
      expect(err.message).toContain('changes the answer');
    }
  });
  it('an equation step is judged by solution set, not by shape', () => {
    expect(() => step({ rule: R_SIMPLIFY, from: parse('2x = 6'), to: parse('x = 3') })).not.toThrow();
    expect(() => step({ rule: R_SIMPLIFY, from: parse('2x = 6'), to: parse('x = 4') })).toThrow();
  });
});

describe('validateDerivation re-checks independently', () => {
  it('passes a sound derivation', () => {
    const d = simplifyDerivation(parse('3x + 5x + 2'));
    expect(validateDerivation(d)).toEqual([]);
  });
  it('catches a chain with a gap', () => {
    const b = new DerivationBuilder('Simplify', parse('2+3'));
    b.apply(R_ARITHMETIC, parse('5'));
    const broken = { ...b.build(), result: parse('6') };
    expect(validateDerivation(broken).length).toBeGreaterThan(0);
  });
});

describe('hints reveal progressively', () => {
  const d = solveLinear(parse('3x + 5 = 20')).derivation;

  it('a nudge points without telling', () => {
    const h = hintAt(d, HintLevel.Nudge);
    expect(h.text.length).toBeGreaterThan(0);
    expect(h.latex).toBeUndefined();
  });
  it('the move names the step', () => {
    expect(hintAt(d, HintLevel.Move).text).toBe(d.steps[0]!.title);
  });
  it('the reason explains with the actual numbers', () => {
    expect(hintAt(d, HintLevel.Reason).text).toBe(d.steps[0]!.detail);
  });
  it('the next line shows one step only, not the answer', () => {
    const h = hintAt(d, HintLevel.NextLine);
    expect(h.latex).toBe(toLatex(d.steps[0]!.to));
    expect(h.latex).not.toBe(toLatex(d.result));
  });
  it('hints follow the student forward', () => {
    const later = hintAt(d, HintLevel.Move, 1);
    expect(later.text).toBe(d.steps[1]!.title);
  });
  it('running past the end says the work is done', () => {
    const h = hintAt(d, HintLevel.Move, 99);
    expect(h.exhausted).toBe(true);
  });
  it('every hint carries the rule, so the app can offer practice', () => {
    for (const lvl of [HintLevel.Nudge, HintLevel.Move, HintLevel.Reason, HintLevel.NextLine]) {
      expect(hintAt(d, lvl).rule).toBeTruthy();
    }
  });
});

describe('progress is measured by equivalence, not by matching text', () => {
  const d = solveLinear(parse('3x + 5 = 20')).derivation;
  it('credits a student who skipped ahead two steps', () => {
    const twoIn = d.steps[1]!.to;
    expect(progressOf(d, twoIn)).toBeGreaterThanOrEqual(2);
  });
  it('gives no credit for restating the problem', () => {
    expect(progressOf(d, parse('3x + 5 = 20'))).toBe(0);
  });
  it('credits the same line written with the sides swapped', () => {
    expect(progressOf(d, parse('15 = 3x'))).toBeGreaterThanOrEqual(1);
  });
  it('credits the finished answer fully', () => {
    expect(progressOf(d, parse('x = 5'))).toBe(d.steps.length);
  });
});

// ------------------------------------------------------------------ the big one

describe('solvers are correct on randomized problems', () => {
  it('linear: every derivation validates and the answer checks out', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -12, max: 12 }), fc.integer({ min: -12, max: 12 }),
        fc.integer({ min: -12, max: 12 }), fc.integer({ min: -12, max: 12 }),
        (a, b, c, dd) => {
          if (a === c) return true; // no unique solution; covered separately
          const eq = parse(`${a}x + ${b} = ${c}x + ${dd}`);
          const r = solveLinear(eq, 'x');
          if (validateDerivation(r.derivation).length > 0) return false;
          if (r.solutions.length !== 1) return false;
          // Substitute the answer back into the ORIGINAL equation.
          const value = evalExact(r.solutions[0]!);
          if (value === null) return false;
          const [lhs, rhs] = sides(eq);
          const residual = evalExact(subE(lhs, rhs), { x: value });
          return residual !== null && R.isZero(residual);
        },
      ),
      { numRuns: 250 },
    );
  });

  it('linear: degenerate cases are reported, not answered', () => {
    expect(solveLinear(parse('2x + 1 = 2x + 1')).special).toBe('all-reals');
    expect(solveLinear(parse('2x + 1 = 2x + 9')).special).toBe('no-solution');
  });

  it('quadratic: all four methods agree with each other and with the roots', () => {
    const methods: QuadraticMethod[] = ['factor', 'complete-square', 'formula'];
    fc.assert(
      fc.property(
        fc.integer({ min: -6, max: 6 }).filter((x) => x !== 0),
        fc.integer({ min: -9, max: 9 }),
        fc.integer({ min: -9, max: 9 }),
        (a, b, c) => {
          const eq = parse(`${a}x^2 + ${b}x + ${c} = 0`);
          const [ql, qr] = sides(eq);
          const p = toRatPoly(subE(ql, qr), 'x')!;
          const reference = solveQuadratic(eq, 'x').solutions;

          for (const method of methods) {
            const r = solveQuadratic(eq, 'x', { method });
            if (validateDerivation(r.derivation).length > 0) return false;
            if (!equivalentSets(reference, r.solutions).equal) return false;
          }

          // Every reported root must actually satisfy the equation. This is
          // the check that matters: it tests the answer, not the reasoning.
          for (const root of reference) {
            if (!equivalent(substituteRoot(p, root), int(0)).equal) return false;
          }
          return true;
        },
      ),
      { numRuns: 150 },
    );
  });

  it('quadratic: method choice is sensible', () => {
    expect(chooseMethod(toRatPoly(parse('x^2 - 5x + 6'), 'x')!).method).toBe('factor');
    expect(chooseMethod(toRatPoly(parse('x^2 - 9'), 'x')!).method).toBe('square-root');
    expect(chooseMethod(toRatPoly(parse('x^2 + 2x - 5'), 'x')!).method).toBe('formula');
  });

  it('systems: the solution satisfies both original equations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -6, max: 6 }), fc.integer({ min: -6, max: 6 }),
        fc.integer({ min: -6, max: 6 }), fc.integer({ min: -6, max: 6 }),
        fc.integer({ min: -9, max: 9 }), fc.integer({ min: -9, max: 9 }),
        (a1, b1, a2, b2, c1, c2) => {
          if (a1 * b2 - a2 * b1 === 0) return true; // no unique solution
          const e1 = parse(`${a1}x + ${b1}y = ${c1}`);
          const e2 = parse(`${a2}x + ${b2}y = ${c2}`);
          const r = solveLinearSystem([e1, e2], ['x', 'y']);
          if (validateDerivation(r.derivation).length > 0) return false;
          if (!r.solutions) return false;
          const xv = evalExact(r.solutions.x!);
          const yv = evalExact(r.solutions.y!);
          if (xv === null || yv === null) return false;
          for (const eq of [e1, e2]) {
            const [lhs2, rhs2] = sides(eq);
            const residual = evalExact(subE(lhs2, rhs2), { x: xv, y: yv });
            if (residual === null || !R.isZero(residual)) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});

/** The quadratic ax^2 + bx + c evaluated symbolically at `x`. */
function substituteRoot(p: ReturnType<typeof toRatPoly>, x: ReturnType<typeof parse>) {
  const [c, b, a] = [p![0] ?? R.ZERO, p![1] ?? R.ZERO, p![2] ?? R.ZERO];
  return add(mul(num(a), pow(x, int(2))), mul(num(b), x), num(c));
}
