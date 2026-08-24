/**
 * Function-strand generators: notation, domain, graphs, inverses,
 * exponentials, logarithms and sequences.
 *
 * Domain answers are relations (x ≠ 3, x ≥ 5) rather than prose, so the
 * oracle can grade them by solution set and accept any equivalent phrasing a
 * student writes.
 */

import { Rng } from './../../engine/random.ts';
import type { Expr } from './../../engine/expr.ts';
import {
  add, mul, pow, num, int, sym, frac, sqrt as sqrtE, fn as mkFn, div as divE,
  sub as subE, neg as negE, equation, rel, tuple, cst, key, symbols,
} from './../../engine/expr.ts';
import * as R from './../../engine/rational.ts';
import { simplify, simplifyBest } from './../../engine/canon.ts';
import { expand, toRatPoly, completeSquare, degree } from './../../engine/polynomial.ts';
import { toLatex } from './../../engine/print.ts';
import {
  DerivationBuilder, R_SIMPLIFY, R_SUBSTITUTE, R_FORMULA, R_ISOLATE,
  R_COMPLETE_SQUARE, R_ARITHMETIC,
} from './../../engine/derive.ts';
import { solveLinear } from './../../engine/solve/linear.ts';
import { solveQuadratic } from './../../engine/solve/quadratic.ts';
import { solveExponential, solveLogarithmic, exactLog } from './../../engine/solve/exponential.ts';
import { simplifyDerivation } from './../../engine/solve/steps.ts';
import type { Generator, Distractor } from './../types.ts';

const scale = (d: number, lo: number, hi: number): number => Math.round(lo + (hi - lo) * d);
const X = sym('x');

/** Replace x throughout, for evaluating f at a value. */
function at(e: Expr, v: Expr): Expr {
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

export const genFunctionNotation: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const b = r.int(-scale(d, 5, 10), scale(d, 5, 10));
  const c = r.int(-scale(d, 5, 10), scale(d, 5, 10));
  const quadratic = d > 0.4;
  const f = quadratic
    ? add(mul(int(a), pow(X, int(2))), mul(int(b), X), int(c))
    : add(mul(int(a), X), int(b));

  const input = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const substituted = at(f, int(input));
  const value = simplify(substituted);
  if (value.k !== 'num') return null;

  const bd = new DerivationBuilder(`Find f(${input})`, f);
  bd.applyUnverified(R_SUBSTITUTE, substituted,
    'Substituting an input narrows the rule to a single value.',
    `f(${input}) means put ${input < 0 ? `(${input})` : input} wherever x appears.`,
    'The number in the brackets is the input.');
  bd.absorb(simplifyDerivation(substituted).steps);

  return {
    prompt: `Find f(${input})`,
    context: `f(x) = ${'$'}${toLatex(f)}${'$'}`,
    statement: f,
    variable: 'x',
    answer: { kind: 'number' as const, value },
    derivation: bd.build(),
    ...(quadratic && input < 0 ? {
      distractors: [{
        value: simplify(at(f, int(-input))),
        diagnosis: `The sign of ${input} was dropped. Squaring a negative gives a positive, but the linear term keeps its sign.`,
        reviewSkill: 'integer-arithmetic',
      }],
    } : {}),
  };
};

export const genDomainRange: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const kind = r.pick(d > 0.45 ? (['rational', 'radical'] as const) : (['rational'] as const));
  const c = r.nonzeroInt(-scale(d, 5, 10), scale(d, 5, 10));
  const a = r.nonzeroInt(1, scale(d, 2, 4));

  if (kind === 'rational') {
    const f = divE(int(1), add(mul(int(a), X), int(c)));
    const excluded = R.rat(-c, a);
    const answer = rel('!=', X, num(excluded));
    const b = new DerivationBuilder('Find the domain', f);
    b.applyUnverified(R_FORMULA, equation(add(mul(int(a), X), int(c)), int(0)),
      'Finding where the function fails is a different question from the function itself.',
      'Division by zero is the only thing to avoid, so find where the denominator is zero.',
      'What is the one thing you are not allowed to do?');
    b.absorb(solveLinear(equation(add(mul(int(a), X), int(c)), int(0)), 'x').derivation.steps);
    b.applyUnverified(R_SIMPLIFY, answer,
      'The excluded value becomes a statement about every other value.',
      `The denominator vanishes at x = ${R.toString(excluded)}, so every other real number is allowed.`,
      'Exclude that one value.');
    return {
      prompt: 'Give the domain as an inequality (use ≠)',
      statement: f, variable: 'x',
      answer: { kind: 'expression' as const, value: answer },
      derivation: b.build(),
    };
  }

  const f = sqrtE(add(mul(int(a), X), int(c)));
  const boundary = R.rat(-c, a);
  const answer = rel('>=', X, num(boundary));
  const b = new DerivationBuilder('Find the domain', f);
  b.applyUnverified(R_FORMULA, rel('>=', add(mul(int(a), X), int(c)), int(0)),
    'Stating the condition for the root to be real is a new statement, not a restatement of f.',
    'A square root needs a non-negative argument, so require what is inside to be at least zero.',
    'What has to be true inside a square root?');
  b.absorb(solveLinear(rel('>=', add(mul(int(a), X), int(c)), int(0)), 'x').derivation.steps);
  return {
    prompt: 'Give the domain as an inequality',
    statement: f, variable: 'x',
    answer: { kind: 'expression' as const, value: answer },
    derivation: b.build(),
  };
};

export const genGraphingLinear: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const m = r.nonzeroInt(-scale(d, 3, 6), scale(d, 3, 6));
  const c = r.int(-scale(d, 5, 10), scale(d, 5, 10));
  const line = add(mul(int(m), X), int(c));
  const want = r.pick(d > 0.4 ? (['x-intercept', 'slope-intercept', 'point'] as const) : (['slope-intercept'] as const));

  if (want === 'slope-intercept') {
    const b = new DerivationBuilder('Read off the slope and intercept', equation(sym('y'), line));
    b.applyUnverified(R_FORMULA, tuple(int(m), int(c)),
      'Reading the coefficients off produces a pair of numbers, not a restatement of the line.',
      `In y = mx + b the slope is the coefficient of x, ${m}, and the y-intercept is the constant, ${c}.`,
      'Compare it with y = mx + b.');
    return {
      prompt: 'Give the slope and the y-intercept, in that order',
      statement: equation(sym('y'), line), variable: 'x',
      figure: { kind: 'coordinate', toScale: true, points: { A: [0, c], B: [1, m + c] }, segments: [['A', 'B']], caption: `y = ${toLatex(line)}` },
      answer: { kind: 'tuple' as const, values: [int(m), int(c)], labels: ['slope', 'y-intercept'] },
      derivation: b.build(),
      distractors: [],
    };
  }

  if (want === 'x-intercept') {
    const solved = solveLinear(equation(line, int(0)), 'x');
    if (solved.solutions.length !== 1) return null;
    const b = new DerivationBuilder('Find the x-intercept', equation(sym('y'), line));
    b.applyUnverified(R_SUBSTITUTE, equation(line, int(0)),
      'Setting y to zero picks out one point on the line rather than describing all of it.',
      'The graph crosses the x-axis where y is zero, so set the expression to zero.',
      'What is y at the moment the line crosses the x-axis?');
    b.absorb(solved.derivation.steps);
    return {
      prompt: 'Find the x-intercept (just the x-value)',
      statement: equation(sym('y'), line), variable: 'x',
      answer: { kind: 'number' as const, value: solved.solutions[0]! },
      derivation: b.build(),
      distractors: [{
        value: int(c),
        diagnosis: 'That is the y-intercept, where the line crosses the vertical axis. The x-intercept is where y is zero.',
        reviewSkill: 'graphing-linear',
      }],
    };
  }

  const px = r.nonzeroInt(-6, 6);
  const py = m * px + c;
  const substituted = at(line, int(px));
  const b = new DerivationBuilder(`Find y when x = ${px}`, equation(sym('y'), line));
  b.applyUnverified(R_SUBSTITUTE, equation(sym('y'), substituted),
    'Substituting an input picks out one point rather than describing the line.',
    `Put ${px < 0 ? `(${px})` : px} in for x.`, 'Substitute and evaluate.');
  b.absorb(simplifyDerivation(equation(sym('y'), substituted)).steps);
  return {
    prompt: `The line is y = ${toLatex(line)}. What is y when x = ${px}?`,
    statement: equation(sym('y'), line), variable: 'x',
    answer: { kind: 'number' as const, value: int(py) },
    derivation: b.build(),
  };
};

export const genGraphingQuadratics: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.nonzeroInt(1, scale(d, 2, 3)) * (d > 0.5 && r.bool(0.3) ? -1 : 1);
  const h = r.nonzeroInt(-scale(d, 3, 7), scale(d, 3, 7));
  const k = r.int(-scale(d, 5, 12), scale(d, 5, 12));
  // Built from vertex form so the vertex is exact.
  const standard = simplify(expand(add(mul(int(a), pow(subE(X, int(h)), int(2))), int(k))));
  const p = toRatPoly(standard, 'x');
  if (!p || degree(p) !== 2) return null;

  const want = r.pick(d > 0.5 ? (['vertex', 'axis'] as const) : (['vertex'] as const));
  const bCoeff = p[1] ?? R.ZERO;
  const aCoeff = p[2] ?? R.ZERO;

  const b = new DerivationBuilder(want === 'vertex' ? 'Find the vertex' : 'Find the axis of symmetry',
    equation(sym('y'), standard));
  b.applyUnverified(R_FORMULA, equation(sym('x'), num(R.rat(h))),
    'The axis is a property of the parabola, not a restatement of its equation.',
    `The axis of symmetry sits at x = −b/2a = −(${R.toString(bCoeff)})/(2·${R.toString(aCoeff)}) = ${h}.`,
    'Where is the parabola symmetric?');

  if (want === 'axis') {
    return {
      prompt: 'Find the axis of symmetry (just the x-value)',
      statement: equation(sym('y'), standard), variable: 'x',
      answer: { kind: 'number' as const, value: int(h) },
      derivation: b.build(),
    };
  }

  b.applyUnverified(R_SUBSTITUTE, tuple(int(h), int(k)),
    'Evaluating at the axis gives the vertex, a point rather than a line.',
    `Put x = ${h} back in: y = ${k}. So the vertex is (${h}, ${k}).`,
    'The vertex sits on the axis of symmetry.');

  return {
    prompt: 'Find the vertex, as x then y',
    statement: equation(sym('y'), standard), variable: 'x',
    answer: { kind: 'tuple' as const, values: [int(h), int(k)], labels: ['x', 'y'] },
    derivation: b.build(),
    distractors: [{
      value: tuple(int(-h), int(k)),
      diagnosis: `The sign of the x-coordinate is flipped. In vertex form y = a(x − h)² + k, the vertex is at x = h, and the form here has (x ${h < 0 ? '+' : '−'} ${Math.abs(h)}).`,
      reviewSkill: 'graphing-quadratics',
    }],
  };
};

export const genInverseFunctions: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.nonzeroInt(2, scale(d, 4, 7));
  const b = r.int(-scale(d, 5, 10), scale(d, 5, 10));
  const f = add(mul(int(a), X), int(b));

  // y = ax + b, swap, solve for the new y.
  const swapped = equation(X, add(mul(int(a), sym('y')), int(b)));
  const solved = solveLinear(swapped, 'y');
  if (solved.solutions.length !== 1) return null;
  const inverse = solved.solutions[0]!;

  const bd = new DerivationBuilder('Find the inverse', equation(sym('y'), f));
  bd.applyUnverified(R_SIMPLIFY, swapped,
    'Swapping the variables defines a different relation — that is what taking an inverse does.',
    'Swap x and y: the inverse reverses which is the input.',
    'What does an inverse undo?');
  bd.absorb(solved.derivation.steps);

  return {
    prompt: `If f(x) = ${toLatex(f)}, find the inverse. Write it in terms of x.`,
    statement: equation(sym('y'), f), variable: 'x',
    answer: { kind: 'expression' as const, value: at(inverse, X) },
    derivation: bd.build(),
    distractors: [{
      value: divE(int(1), f),
      diagnosis: 'That is the reciprocal, 1/f(x). An inverse function undoes f; it is not one divided by f.',
      reviewSkill: 'inverse-functions',
    }],
  };
};

export const genExponentialFunctions: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const base = r.pick([2, 3, 5, 10]);
  const initial = r.int(2, scale(d, 6, 20));
  const steps = r.int(2, scale(d, 4, 6));
  const f = mul(int(initial), pow(int(base), X));
  const value = initial * Math.pow(base, steps);
  if (!Number.isSafeInteger(value)) return null;

  const substituted = at(f, int(steps));
  const b = new DerivationBuilder(`Find the value after ${steps} steps`, f);
  b.applyUnverified(R_SUBSTITUTE, substituted,
    'Substituting narrows the rule to a single step count.',
    `Put x = ${steps} in: ${initial} × ${base}^${steps}.`,
    'The exponent counts the steps.');
  b.apply(R_ARITHMETIC, int(value),
    `${base}^${steps} = ${Math.pow(base, steps)}, and ${initial} × ${Math.pow(base, steps)} = ${value}.`,
    'Work out the power first.');

  return {
    prompt: `A quantity starts at ${initial} and multiplies by ${base} each step. What is it after ${steps} steps?`,
    context: `The rule is f(x) = ${initial} · ${base}^x.`,
    statement: f, variable: 'x',
    answer: { kind: 'number' as const, value: int(value) },
    derivation: b.build(),
    distractors: [{
      value: int(initial * base * steps),
      diagnosis: 'That multiplies by the base once and then by the number of steps. Exponential growth multiplies by the base every step, so the base is raised to a power.',
      reviewSkill: 'exponential-functions',
    }],
  };
};

export const genLogarithms: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const base = r.pick([2, 3, 5, 10]);
  const k = r.int(d > 0.5 ? -3 : 1, scale(d, 4, 6));
  if (k === 0) return null;
  const argument = R.powInt(R.rat(base), BigInt(k));
  const statement = mkFn('log', int(base), num(argument));
  const value = int(k);

  const b = new DerivationBuilder('Evaluate', statement);
  b.apply(R_SIMPLIFY, value,
    `A logarithm asks what exponent is needed: ${base}^${k} = ${R.toString(argument)}, so the answer is ${k}.`,
    'What power of the base gives that number?');

  return {
    prompt: 'Evaluate', statement,
    answer: { kind: 'number' as const, value },
    derivation: b.build(),
    distractors: [{
      value: num(R.div(argument, R.rat(base))),
      diagnosis: 'The number was divided by the base. A logarithm returns the exponent, not the quotient.',
      reviewSkill: 'logarithms',
    }],
  };
};

export const genExponentialEquations: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const exact = d < 0.6 || r.bool(0.5);
  const base = r.pick([2, 3, 5]);

  if (exact) {
    const k = r.int(2, scale(d, 4, 6));
    const a = r.nonzeroInt(1, 3);
    const shift = r.int(-4, 4);
    const target = R.powInt(R.rat(base), BigInt(k));
    const statement = equation(pow(int(base), add(mul(int(a), X), int(shift))), num(target));
    const solved = solveExponential(statement, 'x');
    if (solved.solutions.length !== 1) return null;
    return {
      prompt: 'Solve for x', statement, variable: 'x',
      answer: { kind: 'expression' as const, value: solved.solutions[0]! },
      derivation: solved.derivation,
    };
  }

  const argument = r.int(2, scale(d, 20, 60));
  if (exactLog(R.rat(base), R.rat(argument)) !== null) return null;  // that is the exact case
  const statement = equation(pow(int(base), X), int(argument));
  const solved = solveExponential(statement, 'x');
  if (solved.solutions.length !== 1) return null;
  return {
    prompt: 'Solve for x. Leave your answer in terms of logarithms.',
    statement, variable: 'x',
    answer: { kind: 'expression' as const, value: solved.solutions[0]! },
    derivation: solved.derivation,
  };
};

export const genSequences: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const geometric = d > 0.45 && r.bool(0.45);
  const first = r.nonzeroInt(-scale(d, 5, 10), scale(d, 5, 10));
  const n = r.int(5, scale(d, 9, 14));

  if (geometric) {
    const ratio = r.pick([2, 3, -2]);
    const terms = [first, first * ratio, first * ratio * ratio, first * ratio ** 3];
    const value = first * Math.pow(ratio, n - 1);
    if (!Number.isSafeInteger(value)) return null;
    const statement = mul(int(first), pow(int(ratio), subE(sym('n'), int(1))));
    const b = new DerivationBuilder(`Find the ${n}th term`, statement);
    b.applyUnverified(R_SUBSTITUTE, mul(int(first), pow(int(ratio), int(n - 1))),
      'Substituting a term number narrows the rule to one term.',
      `Each term multiplies by ${ratio}. The ${n}th term is ${first} × ${ratio}^${n - 1}.`,
      'What do you multiply by each time?');
    b.apply(R_ARITHMETIC, int(value), `That comes to ${value}.`, 'Work out the power.');
    return {
      prompt: `Find the ${n}th term of: ${terms.join(', ')}, …`,
      statement, variable: 'n',
      answer: { kind: 'number' as const, value: int(value) },
      derivation: b.build(),
    };
  }

  const step = r.nonzeroInt(-scale(d, 4, 9), scale(d, 4, 9));
  const terms = [first, first + step, first + 2 * step, first + 3 * step];
  const value = first + (n - 1) * step;
  const statement = add(int(first), mul(subE(sym('n'), int(1)), int(step)));
  const b = new DerivationBuilder(`Find the ${n}th term`, statement);
  b.applyUnverified(R_SUBSTITUTE, add(int(first), mul(int(n - 1), int(step))),
    'Substituting a term number narrows the rule to one term.',
    `The sequence goes up by ${step} each time, so the ${n}th term is ${first} + ${n - 1} × ${step}.`,
    'How much does it change each step?');
  b.apply(R_ARITHMETIC, int(value), `That comes to ${value}.`, 'Finish the arithmetic.');
  return {
    prompt: `Find the ${n}th term of: ${terms.join(', ')}, …`,
    statement, variable: 'n',
    answer: { kind: 'number' as const, value: int(value) },
    derivation: b.build(),
    distractors: [{
      value: int(first + n * step),
      diagnosis: `The step was counted ${n} times instead of ${n - 1}. The first term needs no step at all, so the ${n}th needs ${n - 1}.`,
      reviewSkill: 'sequences-series',
    }],
  };
};
