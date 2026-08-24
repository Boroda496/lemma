/**
 * Problem generators for arithmetic and algebra.
 *
 * The pattern throughout: build the problem, then solve it with the engine and
 * take the answer from the derivation's own result. The generator never states
 * an answer it computed separately, so a generator and its answer key cannot
 * drift apart. Anything degenerate returns null and the caller redraws.
 *
 * `difficulty` runs 0..1 within the skill and controls the size of numbers and
 * which variant appears, not whether the problem is well formed.
 */

import { Rng } from './../../engine/random.ts';
import type { Expr } from './../../engine/expr.ts';
import {
  add, mul, pow, num, int, sym, frac, sqrt as sqrtE, fn as mkFn, div as divE,
  sub as subE, neg as negE, equation, rel, key, symbols, cst,
} from './../../engine/expr.ts';
import * as R from './../../engine/rational.ts';
import { simplify, simplifyBest, factor } from './../../engine/canon.ts';
import { expand, toRatPoly, fromRatPoly, factorRational, degree } from './../../engine/polynomial.ts';
import { toLatex } from './../../engine/print.ts';
import { DerivationBuilder, R_SIMPLIFY, R_FACTOR_OUT, R_FORMULA, R_SUBSTITUTE } from './../../engine/derive.ts';
import { simplifyDerivation, expandDerivation } from './../../engine/solve/steps.ts';
import { solveLinear, solveLinearSystem } from './../../engine/solve/linear.ts';
import { solveQuadratic } from './../../engine/solve/quadratic.ts';
import { solveAbsolute, solveRadical, solveRational } from './../../engine/solve/equations.ts';
import type { Generator, GeneratorContext, Distractor } from './../types.ts';

/** Scale a range by difficulty: easy problems use small numbers. */
const scale = (d: number, lo: number, hi: number): number => Math.round(lo + (hi - lo) * d);

/** A nonzero integer whose magnitude grows with difficulty. */
const coef = (r: Rng, d: number, max = 12): number => r.nonzeroInt(-scale(d, 3, max), scale(d, 5, max));

const X = sym('x');

/** Build a "simplify this expression" problem from any expression. */
function simplifyProblem(prompt: string, statement: Expr, distractors?: readonly Distractor[]) {
  const derivation = simplifyDerivation(statement, prompt);
  if (derivation.steps.length === 0) return null;   // nothing to do
  return {
    prompt,
    statement,
    answer: { kind: 'simplified' as const, value: derivation.result },
    derivation,
    ...(distractors ? { distractors } : {}),
  };
}

// ------------------------------------------------------------------ arithmetic

export const genIntegerArithmetic: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const hi = scale(d, 12, 99);
  const a = r.nonzeroInt(-hi, hi);
  const b = r.nonzeroInt(-hi, hi);
  const op = r.pick(['+', '-', '*'] as const);
  const statement = op === '+' ? add(int(a), int(b))
    : op === '-' ? subE(int(a), int(b))
    : mul(int(a), int(b));

  const derivation = simplifyDerivation(statement, 'Work it out');
  if (derivation.steps.length === 0) return null;

  const distractors: Distractor[] = [];
  if (op === '-' && b < 0) {
    distractors.push({
      value: int(a + b),
      diagnosis: 'It looks like the two minus signs were read as one. Subtracting a negative moves you to the right, so it adds.',
      reviewSkill: 'integer-arithmetic',
    });
  }
  if (op === '*' && a < 0 && b < 0) {
    distractors.push({
      value: int(-Math.abs(a * b)),
      diagnosis: 'The sign is the issue: a negative times a negative is positive.',
      reviewSkill: 'integer-arithmetic',
    });
  }
  return { prompt: 'Work it out', statement, answer: { kind: 'number' as const, value: derivation.result }, derivation, distractors };
};

export const genOrderOfOperations: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.int(2, scale(d, 6, 12));
  const b = r.int(2, scale(d, 5, 9));
  const c = r.int(2, scale(d, 4, 8));
  const shape = r.int(0, d > 0.5 ? 3 : 1);

  const statement =
    shape === 0 ? add(int(a), mul(int(b), int(c)))
    : shape === 1 ? mul(add(int(a), int(b)), int(c))
    : shape === 2 ? add(int(a), mul(int(b), pow(int(c), int(2))))
    : subE(mul(int(a), pow(add(int(b), int(c)), int(2))), int(a));

  const derivation = simplifyDerivation(statement, 'Evaluate');
  if (derivation.steps.length === 0) return null;

  const distractors: Distractor[] = [];
  if (shape === 0) {
    distractors.push({
      value: int((a + b) * c),
      diagnosis: 'The addition was done first. Multiplication comes before addition unless brackets say otherwise.',
      reviewSkill: 'order-of-operations',
    });
  }
  if (shape === 2) {
    distractors.push({
      value: int(a + Math.pow(b * c, 2)),
      diagnosis: 'The power applies only to the number it sits on, not to the product.',
      reviewSkill: 'order-of-operations',
    });
  }
  return { prompt: 'Evaluate', statement, answer: { kind: 'number' as const, value: derivation.result }, derivation, distractors };
};

export const genFractions: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const cap = scale(d, 6, 12);
  const [n1, d1] = [r.nonzeroInt(1, cap), r.int(2, cap)];
  const [n2, d2] = [r.nonzeroInt(1, cap), r.int(2, cap)];
  if (d1 === 1 || d2 === 1) return null;
  const op = r.pick(['+', '-', '*', '/'] as const);
  const f1 = frac(n1, d1);
  const f2 = frac(n2, d2);
  const statement = op === '+' ? add(f1, f2) : op === '-' ? subE(f1, f2)
    : op === '*' ? mul(f1, f2) : divE(f1, f2);

  const value = simplify(statement);
  if (value.k !== 'num') return null;

  const b = new DerivationBuilder('Work it out', statement);
  if (op === '+' || op === '-') {
    const common = R.rat(BigInt(d1) * BigInt(d2) / gcdNum(d1, d2));
    const cd = Number(common.n);
    const lhs = frac(n1 * (cd / d1), cd);
    const rhs = frac(n2 * (cd / d2), cd);
    b.apply(R_SIMPLIFY, op === '+' ? add(lhs, rhs) : subE(lhs, rhs),
      `Rewrite both fractions over ${cd}, the least common denominator.`,
      'The two fractions are cut into different sized pieces.');
    b.apply(R_SIMPLIFY, value,
      `${op === '+' ? 'Add' : 'Subtract'} the numerators and reduce.`,
      'Now the denominators match.');
  } else if (op === '*') {
    b.apply(R_SIMPLIFY, value, 'Multiply the numerators and the denominators, then reduce.',
      'Multiplying fractions needs no common denominator.');
  } else {
    b.apply(R_SIMPLIFY, mul(f1, frac(d2, n2)),
      'Dividing by a fraction is multiplying by its reciprocal.',
      'What does dividing by a fraction do?');
    b.apply(R_SIMPLIFY, value, 'Multiply across and reduce.', 'Now it is a multiplication.');
  }

  const distractors: Distractor[] = [];
  if (op === '+') {
    distractors.push({
      value: frac(n1 + n2, d1 + d2),
      diagnosis: 'Numerators and denominators were added separately. Fractions have to share a denominator before the numerators can be added.',
      reviewSkill: 'fractions',
    });
  }
  return {
    prompt: 'Work it out', statement,
    answer: { kind: 'number' as const, value }, derivation: b.build(), distractors,
  };
};

const gcdNum = (a: number, b: number): bigint => {
  let x = BigInt(Math.abs(a)), y = BigInt(Math.abs(b));
  while (y) { const t = x % y; x = y; y = t; }
  return x || 1n;
};

export const genExponentRules: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.int(2, scale(d, 5, 9));
  const b = r.int(2, scale(d, 5, 9));
  const shape = r.int(0, d > 0.5 ? 2 : 1);
  const statement =
    shape === 0 ? mul(pow(X, int(a)), pow(X, int(b)))
    : shape === 1 ? pow(pow(X, int(a)), int(b))
    : divE(pow(X, int(a + b)), pow(X, int(b)));

  const value = simplify(statement);
  const b2 = new DerivationBuilder('Simplify', statement);
  const detail =
    shape === 0 ? `Multiplying powers of the same base adds the exponents: ${a} + ${b} = ${a + b}.`
    : shape === 1 ? `A power of a power multiplies the exponents: ${a} × ${b} = ${a * b}.`
    : `Dividing powers of the same base subtracts the exponents: ${a + b} − ${b} = ${a}.`;
  b2.apply(R_SIMPLIFY, value, detail, 'Look at what is happening to the exponents.');
  if (b2.length === 0) return null;

  const wrong =
    shape === 0 ? pow(X, int(a * b))
    : shape === 1 ? pow(X, int(a + b))
    : pow(X, int(a + b + b));
  return {
    prompt: 'Simplify', statement,
    answer: { kind: 'simplified' as const, value },
    derivation: b2.build(),
    distractors: [{
      value: wrong,
      diagnosis: shape === 0
        ? 'The exponents were multiplied. Multiplying the powers themselves adds the exponents; multiplying the exponents is what a power of a power does.'
        : shape === 1
          ? 'The exponents were added. A power raised to a power multiplies them.'
          : 'The exponents were added rather than subtracted.',
      reviewSkill: 'exponent-rules',
    }],
  };
};

export const genRadicals: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const outside = r.int(2, scale(d, 4, 9));
  const inside = r.pick(d > 0.4 ? [2, 3, 5, 6, 7, 10, 11] : [2, 3, 5]);
  const n = outside * outside * inside;
  const statement = sqrtE(int(n));
  const value = simplify(statement);
  if (key(value) === key(statement)) return null;

  const b = new DerivationBuilder('Simplify', statement);
  b.apply(R_SIMPLIFY, sqrtE(mul(int(outside * outside), int(inside))),
    `${n} = ${outside * outside} × ${inside}, and ${outside * outside} is a perfect square.`,
    'Is there a perfect square hiding inside?');
  b.apply(R_SIMPLIFY, value,
    `The square root of ${outside * outside} is ${outside}, which comes outside the radical.`,
    'A perfect square factor can come out.');

  return {
    prompt: 'Simplify', statement,
    answer: { kind: 'simplified' as const, value },
    derivation: b.build(),
    distractors: [{
      value: int(outside * inside),
      diagnosis: 'The radical was dropped entirely. Only the perfect square factor comes out; the rest stays under the root.',
      reviewSkill: 'radicals',
    }],
  };
};

// -------------------------------------------------------------------- algebra

export const genEvaluateExpressions: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = coef(r, d, 6);
  const b = coef(r, d, 9);
  const c = r.int(-9, 9);
  const at = r.nonzeroInt(-scale(d, 3, 7), scale(d, 3, 7));
  const poly = d > 0.4
    ? add(mul(int(a), pow(X, int(2))), mul(int(b), X), int(c))
    : add(mul(int(a), X), int(c));

  const value = simplify(substituteX(poly, int(at)));
  if (value.k !== 'num') return null;

  const b2 = new DerivationBuilder(`Evaluate at x = ${at}`, poly);
  const substituted = substituteX(poly, int(at));
  // Substitution is not an equivalence: the expression before it holds for
  // every x and the one after holds only at this one. Declaring that keeps the
  // step honest instead of asserting a falsehood the oracle would reject.
  b2.applyUnverified(R_SUBSTITUTE, substituted,
    'Substituting a value narrows the expression from every x to this one.',
    `Replace every x with ${at < 0 ? `(${at})` : at}.`,
    'Put the value in wherever x appears.');
  for (const s of simplifyDerivation(substituted).steps) b2.apply(ruleOf(s.rule), s.to, s.detail, s.nudge);

  return {
    prompt: `Evaluate when x = ${at}`, statement: poly,
    answer: { kind: 'number' as const, value }, derivation: b2.build(),
    variable: 'x',
    ...(at < 0 && d > 0.4 ? {
      distractors: [{
        value: simplify(substituteX(poly, int(-at))),
        diagnosis: `The sign of ${at} was dropped. Squaring a negative gives a positive, but the linear term keeps its sign.`,
        reviewSkill: 'integer-arithmetic',
      }],
    } : {}),
  };
};

function substituteX(e: Expr, v: Expr): Expr {
  const go = (n: Expr): Expr => {
    if (n.k === 'sym' && n.name === 'x' && !n.sub) return v;
    switch (n.k) {
      case 'add': return add(...n.args.map(go));
      case 'mul': return mul(...n.args.map(go));
      case 'pow': return pow(go(n.base), go(n.exp));
      case 'fn': return mkFn(n.name, ...n.args.map(go));
      case 'rel': return rel(n.op, ...n.args.map(go));
      default: return n;
    }
  };
  return go(e);
}

/** Map a recorded rule id back to a rule object for re-emission. */
function ruleOf(id: string) {
  return id === 'distribute' ? R_SIMPLIFY : R_SIMPLIFY;
}

export const genLikeTerms: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const parts: Expr[] = [];
  const nx = r.int(2, d > 0.5 ? 4 : 3);
  for (let i = 0; i < nx; i++) parts.push(mul(int(coef(r, d, 9)), X));
  if (d > 0.35) {
    const ny = r.int(1, 2);
    for (let i = 0; i < ny; i++) parts.push(int(coef(r, d, 9)));
  }
  if (d > 0.65) {
    for (let i = 0; i < 2; i++) parts.push(mul(int(coef(r, d, 6)), pow(X, int(2))));
  }
  r.shuffle(parts);
  const statement = add(...parts);
  const made = simplifyProblem('Simplify', statement, [{
    value: simplify(add(...parts.map((p) => (p.k === 'num' ? p : mul(int(1), X))))),
    diagnosis: 'Terms with different powers of x were treated as alike. Only terms with exactly the same variable part combine.',
    reviewSkill: 'like-terms',
  }]);
  if (!made) return null;
  return { ...made, variable: 'x' };
};

export const genDistribute: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const k = int(coef(r, d, 8));
  const inner = add(mul(int(coef(r, d, 7)), X), int(coef(r, d, 9)));
  const statement = d > 0.55
    ? add(mul(k, inner), mul(int(coef(r, d, 6)), add(X, int(coef(r, d, 7)))))
    : mul(k, inner);

  const made = simplifyProblem('Expand and simplify', statement);
  if (!made) return null;

  // The classic slip: multiplying only the first term inside the bracket.
  const partial = statement.k === 'mul'
    ? add(mul(k, inner.k === 'add' ? inner.args[0]! : inner), inner.k === 'add' ? inner.args[1]! : int(0))
    : null;
  return {
    ...made,
    variable: 'x',
    ...(partial ? {
      distractors: [{
        value: simplify(partial),
        diagnosis: 'Only the first term inside the bracket was multiplied. The factor outside multiplies every term inside.',
        reviewSkill: 'distributive-property',
      }],
    } : {}),
  };
};

export const genMultiplyBinomials: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = d > 0.6 ? r.nonzeroInt(2, 4) : 1;
  const b = coef(r, d, 9);
  const c = d > 0.75 ? r.nonzeroInt(2, 3) : 1;
  const e = coef(r, d, 9);
  const statement = mul(add(mul(int(a), X), int(b)), add(mul(int(c), X), int(e)));

  const derivation = expandDerivation(statement);
  if (derivation.steps.length === 0) return null;

  return {
    prompt: 'Expand', statement, variable: 'x',
    answer: { kind: 'simplified' as const, value: derivation.result },
    derivation,
    distractors: [{
      value: simplify(add(mul(int(a * c), pow(X, int(2))), int(b * e))),
      diagnosis: 'Only the first terms and the last terms were multiplied. The two cross terms are missing.',
      reviewSkill: 'multiply-binomials',
    }],
  };
};

export const genSpecialProducts: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = d > 0.6 ? r.nonzeroInt(2, 5) : 1;
  const b = r.nonzeroInt(2, scale(d, 7, 12));
  const isDifference = r.bool();
  const statement = isDifference
    ? mul(add(mul(int(a), X), int(b)), subE(mul(int(a), X), int(b)))
    : pow(add(mul(int(a), X), int(b)), int(2));

  const derivation = expandDerivation(statement);
  if (derivation.steps.length === 0) return null;

  return {
    prompt: 'Expand', statement, variable: 'x',
    answer: { kind: 'simplified' as const, value: derivation.result },
    derivation,
    distractors: isDifference ? [] : [{
      value: simplify(add(mul(int(a * a), pow(X, int(2))), int(b * b))),
      diagnosis: 'The middle term is missing. Squaring a bracket is not squaring each term: (a+b)² = a² + 2ab + b².',
      reviewSkill: 'special-products',
    }],
  };
};

export const genFactoringGcf: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const g = r.int(2, scale(d, 5, 12));
  const p = r.nonzeroInt(1, 6);
  const q = r.nonzeroInt(1, 9);
  const deg = d > 0.5 ? 2 : 1;
  const statement = deg === 2
    ? add(mul(int(g * p), pow(X, int(2))), mul(int(g * q), X))
    : add(mul(int(g * p), X), int(g * q));

  const value = factor(statement);
  if (key(value) === key(simplify(statement))) return null;

  const b = new DerivationBuilder('Factor', statement);
  b.apply(R_FACTOR_OUT, value,
    `Every term is divisible by ${deg === 2 ? `${g}x` : g}, so that comes outside the bracket.`,
    'What do both terms have in common?');

  return {
    prompt: 'Factor completely', statement, variable: 'x',
    answer: { kind: 'expression' as const, value }, derivation: b.build(),
  };
};

export const genFactoringQuadratics: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  // Build from the roots so the quadratic is guaranteed to factor over Q.
  const lead = d > 0.65 ? r.nonzeroInt(2, 3) : 1;
  const r1 = r.nonzeroInt(-scale(d, 5, 11), scale(d, 5, 11));
  const r2 = r.nonzeroInt(-scale(d, 5, 11), scale(d, 5, 11));
  const statement = simplify(expand(mul(int(lead), subE(X, int(r1)), subE(X, int(r2)))));
  const p = toRatPoly(statement, 'x');
  if (!p || degree(p) !== 2) return null;

  const value = factor(statement);
  if (key(value) === key(statement)) return null;

  const b = new DerivationBuilder('Factor', statement);
  const c = p[0] ?? R.ZERO;
  const mid = p[1] ?? R.ZERO;
  b.apply(R_SIMPLIFY, value,
    lead === 1
      ? `Two numbers that multiply to ${R.toString(c)} and add to ${R.toString(mid)}: ${-r1} and ${-r2}.`
      : `With a leading coefficient of ${lead}, look for factors whose product gives ${R.toString(R.mul(R.rat(lead), c))} and whose sum gives ${R.toString(mid)}.`,
    'Can this be written as two brackets multiplied?');

  return {
    prompt: 'Factor completely', statement, variable: 'x',
    answer: { kind: 'expression' as const, value }, derivation: b.build(),
    distractors: [{
      value: simplify(mul(int(lead), add(X, int(r1)), add(X, int(r2)))),
      diagnosis: 'The signs inside the brackets are flipped. A root of 3 comes from a factor of (x − 3), not (x + 3).',
      reviewSkill: 'factoring-quadratics',
    }],
  };
};

// ------------------------------------------------------------------ equations

export const genLinearEquations: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.nonzeroInt(2, scale(d, 5, 12));
  const answer = r.nonzeroInt(-scale(d, 6, 15), scale(d, 6, 15));
  const b = r.nonzeroInt(-scale(d, 8, 20), scale(d, 8, 20));
  const statement = equation(add(mul(int(a), X), int(b)), int(a * answer + b));

  const solved = solveLinear(statement, 'x');
  if (solved.solutions.length !== 1) return null;

  // The classic slip: adding b to both sides instead of subtracting it, which
  // lands on (target + b)/a. Computed exactly, and dropped if it happens to
  // coincide with the real answer -- a distractor equal to the right answer
  // would mark a correct response wrong.
  const slip = R.rat(BigInt(a * answer + 2 * b), BigInt(a));
  const distractors: Distractor[] = R.eq(slip, R.rat(answer)) ? [] : [{
    value: num(slip),
    diagnosis: `It looks like ${Math.abs(b)} was ${b > 0 ? 'added' : 'subtracted'} on both sides where the opposite was needed. To undo ${b > 0 ? 'adding' : 'subtracting'} ${Math.abs(b)}, do the reverse.`,
    reviewSkill: 'linear-equations',
  }];

  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'expression' as const, value: solved.solutions[0]! },
    derivation: solved.derivation,
    distractors,
  };
};

export const genLinearBothSides: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const answer = r.nonzeroInt(-scale(d, 5, 12), scale(d, 5, 12));
  const a = r.nonzeroInt(2, scale(d, 5, 9));
  let c = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
  if (c === a) c = a + 1;
  const b = r.int(-scale(d, 8, 15), scale(d, 8, 15));
  const rhsConst = (a - c) * answer + b;

  const useBracket = d > 0.5;
  const lhs = useBracket && a % 2 === 0
    ? mul(int(a / 2), add(mul(int(2), X), int(b)))
    : add(mul(int(a), X), int(b));
  const statement = equation(
    useBracket && a % 2 === 0 ? lhs : add(mul(int(a), X), int(b)),
    add(mul(int(c), X), int(rhsConst)),
  );

  const solved = solveLinear(statement, 'x');
  if (solved.solutions.length !== 1) return null;
  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'expression' as const, value: solved.solutions[0]! },
    derivation: solved.derivation,
  };
};

export const genLinearInequalities: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.nonzeroInt(2, scale(d, 5, 9)) * (d > 0.4 && r.bool() ? -1 : 1);
  const answer = r.nonzeroInt(-scale(d, 5, 12), scale(d, 5, 12));
  const b = r.int(-scale(d, 6, 14), scale(d, 6, 14));
  const op = r.pick(['<', '>', '<=', '>='] as const);
  const statement = rel(op, add(mul(int(a), X), int(b)), int(a * answer + b));

  const solved = solveLinear(statement, 'x');
  const final = solved.derivation.result;
  if (final.k !== 'rel') return null;

  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'expression' as const, value: final },
    derivation: solved.derivation,
    ...(a < 0 ? {
      distractors: [{
        value: rel(op, X, int(answer)),
        diagnosis: 'The inequality sign needs to turn around. Dividing both sides by a negative reverses it.',
        reviewSkill: 'linear-inequalities',
      }],
    } : {}),
  };
};

export const genQuadraticByFactoring: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const lead = d > 0.7 ? r.nonzeroInt(2, 3) : 1;
  const r1 = r.nonzeroInt(-scale(d, 4, 9), scale(d, 4, 9));
  const r2 = r.int(-scale(d, 4, 9), scale(d, 4, 9));
  const lhs = simplify(expand(mul(int(lead), subE(X, int(r1)), subE(X, int(r2)))));
  const statement = equation(lhs, int(0));

  const solved = solveQuadratic(statement, 'x', { method: 'factor' });
  if (solved.solutions.length === 0) return null;

  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'set' as const, values: solved.solutions },
    derivation: solved.derivation,
    distractors: [{
      value: int(r1 === 0 ? r2 : r1),
      diagnosis: 'That is one of the two roots. A quadratic has two, one from each factor.',
      reviewSkill: 'zero-product-property',
    }],
  };
};

export const genQuadraticFormula: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = d > 0.6 ? r.nonzeroInt(1, 3) : 1;
  const b = r.nonzeroInt(-scale(d, 5, 11), scale(d, 5, 11));
  const c = r.nonzeroInt(-scale(d, 6, 12), scale(d, 6, 12));
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;                       // keep this generator real-valued
  if (Number.isInteger(Math.sqrt(disc))) return null; // that would factor; different skill

  const statement = equation(add(mul(int(a), pow(X, int(2))), mul(int(b), X), int(c)), int(0));
  const solved = solveQuadratic(statement, 'x', { method: 'formula' });
  if (solved.solutions.length !== 2) return null;

  return {
    prompt: 'Solve for x, exactly', statement, variable: 'x',
    answer: { kind: 'set' as const, values: solved.solutions },
    derivation: solved.derivation,
  };
};

export const genCompletingTheSquare: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  // An even middle coefficient keeps the completed square free of halves.
  const b = r.nonzeroInt(-scale(d, 3, 7), scale(d, 3, 7)) * 2;
  const c = r.int(-scale(d, 6, 14), scale(d, 6, 14));
  const statement = equation(add(pow(X, int(2)), mul(int(b), X), int(c)), int(0));
  const solved = solveQuadratic(statement, 'x', { method: 'complete-square' });
  if (solved.solutions.length === 0) return null;

  return {
    prompt: 'Solve by completing the square', statement, variable: 'x',
    answer: { kind: 'set' as const, values: solved.solutions },
    derivation: solved.derivation,
    distractors: [{
      value: int(-b / 2),
      diagnosis: 'That is the value that completes the square, not a solution. After forming the square you still have to take the root and undo the shift.',
      reviewSkill: 'completing-the-square',
    }],
  };
};

export const genLinearSystems: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const xv = r.nonzeroInt(-scale(d, 4, 9), scale(d, 4, 9));
  const yv = r.nonzeroInt(-scale(d, 4, 9), scale(d, 4, 9));
  const a1 = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const b1 = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const a2 = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const b2 = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  if (a1 * b2 - a2 * b1 === 0) return null;

  const Y = sym('y');
  const e1 = equation(add(mul(int(a1), X), mul(int(b1), Y)), int(a1 * xv + b1 * yv));
  const e2 = equation(add(mul(int(a2), X), mul(int(b2), Y)), int(a2 * xv + b2 * yv));

  const solved = solveLinearSystem([e1, e2], ['x', 'y']);
  if (!solved.solutions) return null;

  return {
    prompt: 'Solve the system', statement: { k: 'and' as const, args: [e1, e2] },
    answer: {
      kind: 'tuple' as const,
      values: [solved.solutions.x!, solved.solutions.y!],
      labels: ['x', 'y'],
    },
    derivation: solved.derivation,
  };
};

export const genRationalExpressions: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const common = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
  const other = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
  const bottom = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
  if (other === bottom || common === other || common === bottom) return null;

  const numerator = simplify(expand(mul(subE(X, int(common)), subE(X, int(other)))));
  const denominator = simplify(expand(mul(subE(X, int(common)), subE(X, int(bottom)))));
  const statement = divE(numerator, denominator);
  const value = simplifyBest(statement);

  const b = new DerivationBuilder('Simplify', statement);
  b.apply(R_SIMPLIFY, divE(mul(subE(X, int(common)), subE(X, int(other))), mul(subE(X, int(common)), subE(X, int(bottom)))),
    'Factor the top and the bottom.', 'Neither part is factored yet.');
  b.apply(R_SIMPLIFY, value,
    `Both share a factor of (x ${common < 0 ? '+' : '−'} ${Math.abs(common)}), which cancels. ` +
    `Note that x = ${common} is excluded, since it made the original denominator zero.`,
    'Is there a factor common to top and bottom?');

  return {
    prompt: 'Simplify', statement, variable: 'x',
    answer: { kind: 'simplified' as const, value }, derivation: b.build(),
  };
};

export const genLiteralEquations: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const formulas: Array<{ eq: Expr; solveFor: string; context: string }> = [
    { eq: equation(sym('A'), mul(sym('l'), sym('w'))), solveFor: 'w', context: 'Area of a rectangle' },
    { eq: equation(sym('C'), mul(int(2), cst('pi'), sym('r'))), solveFor: 'r', context: 'Circumference of a circle' },
    { eq: equation(sym('P'), add(mul(int(2), sym('l')), mul(int(2), sym('w')))), solveFor: 'l', context: 'Perimeter of a rectangle' },
    { eq: equation(sym('A'), mul(frac(1, 2), sym('b'), sym('h'))), solveFor: 'h', context: 'Area of a triangle' },
    { eq: equation(sym('v'), add(sym('u'), mul(sym('a'), sym('t')))), solveFor: 't', context: 'Velocity under constant acceleration' },
    { eq: equation(sym('F'), add(mul(frac(9, 5), sym('C')), int(32))), solveFor: 'C', context: 'Fahrenheit from Celsius' },
  ];
  const chosen = r.pick(d > 0.5 ? formulas : formulas.slice(0, 4));
  const solved = solveLinear(chosen.eq, chosen.solveFor);
  if (solved.derivation.steps.length === 0) return null;

  return {
    prompt: `Solve for ${chosen.solveFor}`,
    context: chosen.context,
    statement: chosen.eq,
    variable: chosen.solveFor,
    answer: { kind: 'expression' as const, value: solved.derivation.result },
    derivation: solved.derivation,
  };
};

// ------------------------------------------------- second wave of generators

export const genPrimeFactorization: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const want = r.pick(d > 0.4 ? (['factorize', 'gcf', 'lcm'] as const) : (['factorize', 'gcf'] as const));
  const primes = [2, 3, 5, 7, 11, 13];

  if (want === 'factorize') {
    const n = r.int(2, d > 0.5 ? 5 : 3);
    let value = 1;
    const used: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = r.pick(primes.slice(0, d > 0.5 ? 6 : 3));
      value *= p;
      used.push(p);
    }
    if (value < 8 || value > 4000) return null;
    used.sort((a, b) => a - b);
    const answer = mul(...used.map((p) => int(p)));
    const b = new DerivationBuilder('Factor into primes', int(value));
    b.apply(R_FACTOR_OUT, answer,
      `Divide out the smallest prime repeatedly: ${value} = ${used.join(' × ')}.`,
      'Start dividing by 2, then 3, then 5, and so on.');
    return {
      prompt: 'Write as a product of primes', statement: int(value),
      answer: { kind: 'expression' as const, value: answer }, derivation: b.build(),
    };
  }

  const a = r.int(2, scale(d, 8, 14)) * r.pick([2, 3, 4, 6]);
  const b2 = r.int(2, scale(d, 8, 14)) * r.pick([2, 3, 4, 6]);
  if (a === b2) return null;
  const g = Number(gcdNum(a, b2));
  const l = (a * b2) / g;
  const value = want === 'gcf' ? g : l;
  const statement = mkFn(want === 'gcf' ? 'gcd' : 'lcm', int(a), int(b2));

  const bd = new DerivationBuilder(want === 'gcf' ? 'Find the GCF' : 'Find the LCM', statement);
  bd.apply(R_SIMPLIFY, int(value),
    want === 'gcf'
      ? `The largest number dividing both ${a} and ${b2} is ${g}.`
      : `The smallest number both ${a} and ${b2} divide into is ${l}. It equals ${a} × ${b2} ÷ ${g}.`,
    want === 'gcf' ? 'What do they share?' : 'What do they both divide into?');

  return {
    prompt: want === 'gcf'
      ? `Find the greatest common factor of ${a} and ${b2}`
      : `Find the least common multiple of ${a} and ${b2}`,
    statement,
    answer: { kind: 'number' as const, value: int(value) },
    derivation: bd.build(),
    distractors: want === 'gcf' ? [{
      value: int(l),
      diagnosis: 'That is the least common multiple — the smallest number they both go into. The greatest common factor is the largest number that goes into both.',
      reviewSkill: 'prime-factorization',
    }] : [],
  };
};

export const genDecimalsPercents: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const kind = r.pick(d > 0.45 ? (['of', 'increase', 'convert'] as const) : (['of', 'convert'] as const));

  if (kind === 'convert') {
    const den = r.pick([2, 4, 5, 8, 10, 20, 25]);
    const numr = r.nonzeroInt(1, den - 1);
    const percent = R.mul(R.rat(numr, den), R.rat(100));
    const statement = frac(numr, den);
    const b = new DerivationBuilder('Convert to a percentage', statement);
    b.apply(R_SIMPLIFY, num(percent),
      `Multiply by 100: ${numr}/${den} × 100 = ${R.toString(percent)}.`,
      'A percentage is the fraction out of 100.');
    return {
      prompt: 'Write this as a percentage (just the number)',
      statement,
      answer: { kind: 'number' as const, value: num(percent), unit: '%' },
      derivation: b.build(),
    };
  }

  const percent = r.pick([5, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75]);
  const base = r.int(2, scale(d, 12, 40)) * r.pick([4, 5, 10, 20]);
  const fraction = R.rat(percent, 100);

  if (kind === 'of') {
    const value = R.mul(fraction, R.rat(base));
    const statement = mul(num(fraction), int(base));
    const b = new DerivationBuilder(`Find ${percent}% of ${base}`, statement);
    b.apply(R_SIMPLIFY, num(value),
      `${percent}% is ${R.toString(fraction)}, and ${R.toString(fraction)} × ${base} = ${R.toString(value)}.`,
      'Turn the percentage into a fraction first.');
    return {
      prompt: `What is ${percent}% of ${base}?`, statement,
      answer: { kind: 'number' as const, value: num(value) }, derivation: b.build(),
    };
  }

  const grown = R.mul(R.add(R.ONE, fraction), R.rat(base));
  const statement = mul(add(int(1), num(fraction)), int(base));
  const b = new DerivationBuilder(`Increase ${base} by ${percent}%`, statement);
  b.apply(R_SIMPLIFY, num(grown),
    `An increase of ${percent}% multiplies by ${R.toString(R.add(R.ONE, fraction))}, ` +
    `giving ${R.toString(grown)}.`,
    'An increase multiplies by more than 1.');
  return {
    prompt: `Increase ${base} by ${percent}%`, statement,
    answer: { kind: 'number' as const, value: num(grown) }, derivation: b.build(),
    distractors: [{
      value: num(R.mul(fraction, R.rat(base))),
      diagnosis: `That is ${percent}% of ${base}, which is the increase itself. The question asks for the new total, so add it on.`,
      reviewSkill: 'decimals-percents',
    }],
  };
};

export const genProportions: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const k = r.int(2, scale(d, 4, 8));
  const a = r.int(2, scale(d, 6, 11));
  const b2 = r.int(2, scale(d, 6, 11));
  if (a === b2) return null;
  const statement = equation(divE(int(a), int(b2)), divE(X, int(b2 * k)));
  const solved = solveLinear(statement, 'x');
  if (solved.solutions.length !== 1) return null;

  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'expression' as const, value: solved.solutions[0]! },
    derivation: solved.derivation,
    distractors: [{
      value: int(a + (b2 * k - b2)),
      diagnosis: 'The two sides were compared by adding rather than by scaling. A proportion says the ratios match, so both parts multiply by the same factor.',
      reviewSkill: 'proportions',
    }],
  };
};

export const genAbsoluteValue: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.nonzeroInt(1, scale(d, 3, 5));
  const b = r.int(-scale(d, 6, 12), scale(d, 6, 12));
  const target = r.bool(0.15) ? -r.int(1, 9) : r.int(0, scale(d, 9, 20));
  const statement = equation(mkFn('abs', add(mul(int(a), X), int(b))), int(target));

  const solved = solveAbsolute(statement, 'x');
  if (solved.special === 'no-solution') {
    return {
      prompt: 'Solve for x', statement, variable: 'x',
      answer: { kind: 'special' as const, value: 'no-solution' as const },
      derivation: solved.derivation,
    };
  }
  if (solved.solutions.length === 0) return null;

  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'set' as const, values: solved.solutions },
    derivation: solved.derivation,
    ...(solved.solutions.length === 2 ? {
      distractors: [{
        value: solved.solutions[0]!,
        diagnosis: 'That is one of the two answers. Absolute value measures distance from zero, so there are two values the same distance away.',
        reviewSkill: 'absolute-value-equations',
      }],
    } : {}),
  };
};

export const genRadicalEquations: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  // Build from a known root so the equation has a clean answer, and let the
  // squaring introduce an extraneous one about half the time.
  const withExtraneous = d > 0.5 && r.bool(0.5);
  if (withExtraneous) {
    const shift = r.int(2, scale(d, 4, 7));
    const statement = equation(sqrtE(add(X, int(shift))), subE(X, int(shift)));
    const solved = solveRadical(statement, 'x');
    if (solved.solutions.length !== 1) return null;
    return {
      prompt: 'Solve for x. Check your answer.', statement, variable: 'x',
      answer: { kind: 'set' as const, values: solved.solutions },
      derivation: solved.derivation,
    };
  }

  const root = r.int(2, scale(d, 7, 14));
  const a = r.int(1, scale(d, 3, 5));
  const b = r.int(-scale(d, 4, 9), scale(d, 4, 9));
  const inner = a * root * root + b;
  if (inner < 0) return null;
  const statement = equation(sqrtE(add(mul(int(a), X), int(b))), int(root));
  const solved = solveRadical(statement, 'x');
  if (solved.solutions.length !== 1) return null;

  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'expression' as const, value: solved.solutions[0]! },
    derivation: solved.derivation,
  };
};

export const genRationalEquations: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const shape = r.pick(d > 0.5 ? (['cross', 'sum', 'extraneous'] as const) : (['cross', 'sum'] as const));

  let statement: Expr;
  if (shape === 'cross') {
    const a = r.nonzeroInt(1, scale(d, 4, 8));
    const b = r.nonzeroInt(1, scale(d, 4, 8));
    const p = r.nonzeroInt(-scale(d, 4, 7), scale(d, 4, 7));
    const q = r.nonzeroInt(-scale(d, 4, 7), scale(d, 4, 7));
    if (p === q) return null;
    statement = equation(divE(int(a), add(X, int(p))), divE(int(b), add(X, int(q))));
  } else if (shape === 'sum') {
    const a = r.nonzeroInt(1, scale(d, 4, 8));
    const den = r.nonzeroInt(2, scale(d, 4, 8));
    const total = r.nonzeroInt(1, scale(d, 4, 8));
    statement = equation(add(divE(int(a), X), frac(1, den)), frac(total, den * 2));
  } else {
    // A denominator that vanishes at the candidate: the classic extraneous case.
    const c = r.nonzeroInt(1, scale(d, 4, 8));
    statement = equation(divE(X, subE(X, int(c))), divE(int(c), subE(X, int(c))));
  }

  const solved = solveRational(statement, 'x');
  if (solved.special === 'no-solution' || solved.solutions.length === 0) {
    if (shape !== 'extraneous') return null;
    return {
      prompt: 'Solve for x. Check for values that are not allowed.', statement, variable: 'x',
      answer: { kind: 'special' as const, value: 'no-solution' as const },
      derivation: solved.derivation,
    };
  }
  if (solved.solutions.length !== 1) return null;

  return {
    prompt: 'Solve for x', statement, variable: 'x',
    answer: { kind: 'expression' as const, value: solved.solutions[0]! },
    derivation: solved.derivation,
  };
};

export const genPolynomialArithmetic: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const op = r.pick(d > 0.55 ? (['add', 'multiply', 'divide'] as const) : (['add', 'multiply'] as const));

  const p1 = add(mul(int(coef(r, d, 6)), pow(X, int(2))), mul(int(coef(r, d, 8)), X), int(coef(r, d, 9)));
  const p2 = add(mul(int(coef(r, d, 5)), X), int(coef(r, d, 8)));

  if (op === 'divide') {
    // Build a clean division by multiplying first, so the quotient is exact.
    const quotient = add(mul(int(r.nonzeroInt(1, 4)), X), int(coef(r, d, 7)));
    const product = simplify(expand(mul(quotient, p2)));
    const statement = divE(product, p2);
    const derivation = simplifyDerivation(statement, 'Divide');
    const value = simplifyBest(statement);
    if (key(value) === key(statement)) return null;
    const b = new DerivationBuilder('Divide', statement);
    b.apply(R_SIMPLIFY, mul(quotient, divE(p2, p2)),
      `The numerator factors as (${toLatex(quotient)})(${toLatex(p2)}).`,
      'Can the top be written with the bottom as a factor?');
    b.apply(R_SIMPLIFY, simplify(quotient),
      `The two copies of ${toLatex(p2)} cancel.`, 'What cancels?');
    void derivation;
    return {
      prompt: 'Divide and simplify', statement, variable: 'x',
      answer: { kind: 'simplified' as const, value: simplify(quotient) },
      derivation: b.build(),
    };
  }

  const statement = op === 'add' ? add(p1, p2) : mul(p1, p2);
  const made = simplifyProblem(op === 'add' ? 'Simplify' : 'Expand', statement);
  if (!made) return null;
  return { ...made, variable: 'x' };
};

export const genFactoringCubics: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const r1 = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const r2 = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const r3 = r.int(-scale(d, 3, 6), scale(d, 3, 6));
  const statement = simplify(expand(mul(subE(X, int(r1)), subE(X, int(r2)), subE(X, int(r3)))));
  const p = toRatPoly(statement, 'x');
  if (!p || degree(p) !== 3) return null;

  const value = factor(statement);
  if (key(value) === key(statement)) return null;

  const b = new DerivationBuilder('Factor', statement);
  const constant = p[0] ?? R.ZERO;
  b.apply(R_SIMPLIFY, value,
    `Any rational root divides the constant term ${R.toString(constant)}. ` +
    `Testing those candidates finds ${r1}, and dividing out gives the rest.`,
    'Try small factors of the constant term as roots.');

  return {
    prompt: 'Factor completely', statement, variable: 'x',
    answer: { kind: 'expression' as const, value }, derivation: b.build(),
  };
};
