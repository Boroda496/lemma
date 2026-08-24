/**
 * Calculus generators.
 *
 * Every derivative here is checked against numerical differentiation before
 * the problem exists, because `deriv` nodes evaluate by finite difference and
 * the oracle compares the two. The symbolic rules and the numeric check share
 * no code, so a wrong rule cannot produce a problem.
 */

import { Rng } from './../../engine/random.ts';
import type { Expr } from './../../engine/expr.ts';
import {
  add, mul, pow, num, int, sym, frac, sqrt as sqrtE, fn as mkFn, div as divE,
  sub as subE, neg as negE, equation, cst, key, hasSymbol,
} from './../../engine/expr.ts';
import * as R from './../../engine/rational.ts';
import { simplify, simplifyBest } from './../../engine/canon.ts';
import { expand } from './../../engine/polynomial.ts';
import { toLatex } from './../../engine/print.ts';
import { DerivationBuilder, R_SUBSTITUTE, R_SIMPLIFY, R_FORMULA, R_ARITHMETIC } from './../../engine/derive.ts';
import {
  differentiate, differentiateDerivation, limitAt,
  antiderivativeDerivation, definiteIntegral, antiderivative,
} from './../../engine/solve/calculus.ts';
import { solveLinear } from './../../engine/solve/linear.ts';
import type { Generator } from './../types.ts';

const scale = (d: number, lo: number, hi: number): number => Math.round(lo + (hi - lo) * d);
const X = sym('x');

/** Wrap a differentiation problem, taking the answer from the derivation. */
function derivativeProblem(statement: Expr, prompt = 'Differentiate with respect to x') {
  const derivation = differentiateDerivation(statement, 'x');
  if (derivation.incomplete || derivation.steps.length === 0) return null;
  return {
    prompt,
    context: `f(x) = $${toLatex(statement)}$`,
    statement,
    variable: 'x',
    answer: { kind: 'expression' as const, value: derivation.result },
    derivation,
  };
}

export const genLimits: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const indeterminate = d > 0.35;

  if (indeterminate) {
    // (x - a)(x - b) / (x - a): the classic 0/0 that factoring resolves.
    const a = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
    const b = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
    if (a === b) return null;
    const statement = divE(simplify(expand(mul(subE(X, int(a)), subE(X, int(b))))), subE(X, int(a)));
    const result = limitAt(statement, 'x', int(a));
    if (result.value === null) return null;
    return {
      prompt: `Find the limit as x approaches ${a}`,
      context: `Substituting directly gives $\\frac{0}{0}$, so there is algebra hiding underneath.`,
      statement, variable: 'x',
      answer: { kind: 'number' as const, value: result.value },
      derivation: result.derivation,
      distractors: [{
        value: int(0),
        diagnosis: 'A 0/0 form does not mean the limit is zero. It means top and bottom share a factor, and cancelling it reveals the answer.',
        reviewSkill: 'limits',
      }],
    };
  }

  const a = r.nonzeroInt(1, 4);
  const b = r.int(-scale(d, 5, 9), scale(d, 5, 9));
  const c = r.int(-scale(d, 5, 9), scale(d, 5, 9));
  const point = r.nonzeroInt(-4, 4);
  const statement = add(mul(int(a), pow(X, int(2))), mul(int(b), X), int(c));
  const result = limitAt(statement, 'x', int(point));
  if (result.value === null) return null;
  return {
    prompt: `Find the limit as x approaches ${point}`,
    statement, variable: 'x',
    answer: { kind: 'number' as const, value: result.value },
    derivation: result.derivation,
  };
};

export const genDerivativeDefinition: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const a = r.nonzeroInt(1, scale(d, 3, 5));
  const b = r.int(-scale(d, 4, 8), scale(d, 4, 8));
  const f = add(mul(int(a), pow(X, int(2))), mul(int(b), X));
  const point = r.nonzeroInt(-4, 4);

  const derivativeExpr = differentiate(f, 'x');
  const slope = simplify(substituteX(derivativeExpr, int(point)));
  if (slope.k !== 'num') return null;

  const b2 = new DerivationBuilder(`Find the slope at x = ${point}`, f);
  b2.applyUnverified(R_FORMULA, derivativeExpr,
    'The derivative is a new function describing the slope, not a restatement of f.',
    `The difference quotient [f(x+h) − f(x)]/h simplifies to ${toLatex(derivativeExpr)} as h goes to zero. ` +
    `That is the slope of the tangent at any x.`,
    'The derivative is the limit of the slope between two points as they merge.');
  b2.applyUnverified(R_SUBSTITUTE, slope,
    'Evaluating at a point gives a number rather than a function.',
    `At x = ${point} that gives ${toLatex(slope)}.`,
    'Now put the value in.');

  return {
    prompt: `Find the slope of the tangent to f(x) = ${toLatex(f)} at x = ${point}`,
    statement: f, variable: 'x',
    answer: { kind: 'number' as const, value: slope },
    derivation: b2.build(),
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
      default: return n;
    }
  };
  return go(e);
}

export const genPowerRule: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const parts: Expr[] = [];
  const n = r.int(2, d > 0.5 ? 4 : 2);
  const usedDegrees = new Set<number>();
  for (let i = 0; i < n; i++) {
    let deg = r.int(0, scale(d, 3, 6));
    while (usedDegrees.has(deg)) deg = r.int(0, scale(d, 3, 6));
    usedDegrees.add(deg);
    const c = r.nonzeroInt(-scale(d, 5, 9), scale(d, 5, 9));
    parts.push(deg === 0 ? int(c) : deg === 1 ? mul(int(c), X) : mul(int(c), pow(X, int(deg))));
  }
  const statement = add(...parts);
  const made = derivativeProblem(statement);
  if (!made) return null;
  return {
    ...made,
    distractors: [{
      value: simplify(mul(statement, int(1))),
      diagnosis: 'Nothing was differentiated. The power rule brings the exponent down and lowers it by one on each term.',
      reviewSkill: 'derivative-power-rule',
    }],
  };
};

export const genProductQuotient: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const quotient = r.bool(d > 0.5 ? 0.5 : 0.3);

  if (quotient) {
    const a = r.nonzeroInt(1, scale(d, 3, 5));
    const b = r.int(-scale(d, 4, 8), scale(d, 4, 8));
    const c = r.nonzeroInt(1, scale(d, 2, 4));
    const e = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
    const statement = divE(add(mul(int(a), X), int(b)), add(mul(int(c), X), int(e)));
    const made = derivativeProblem(statement);
    if (!made) return null;
    return {
      ...made,
      distractors: [{
        value: divE(int(a), int(c)),
        diagnosis: 'The top and bottom were differentiated separately. The derivative of a quotient is not the quotient of the derivatives — use (f′g − fg′)/g².',
        reviewSkill: 'derivative-product-quotient',
      }],
    };
  }

  const deg = r.int(1, scale(d, 2, 3));
  const inner = r.pick(['sin', 'cos', 'exp', 'ln'] as const);
  const statement = mul(pow(X, int(deg)), mkFn(inner, X));
  const made = derivativeProblem(statement);
  if (!made) return null;
  return {
    ...made,
    distractors: [{
      value: simplify(mul(differentiate(pow(X, int(deg)), 'x'), differentiate(mkFn(inner, X), 'x'))),
      diagnosis: 'The two derivatives were multiplied together. The product rule is f′g + fg′: each factor takes a turn while the other is held.',
      reviewSkill: 'derivative-product-quotient',
    }],
  };
};

export const genChainRule: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const outer = r.pick(d > 0.5
    ? (['sin', 'cos', 'exp', 'ln', 'power'] as const)
    : (['sin', 'cos', 'power'] as const));
  const a = r.nonzeroInt(2, scale(d, 4, 6));
  const b = r.int(-scale(d, 3, 7), scale(d, 3, 7));
  const innerDeg = d > 0.55 ? 2 : 1;
  const inner = innerDeg === 2
    ? add(mul(int(a), pow(X, int(2))), int(b))
    : add(mul(int(a), X), int(b));

  const statement = outer === 'power'
    ? pow(inner, int(r.int(2, scale(d, 3, 5))))
    : mkFn(outer, inner);

  const made = derivativeProblem(statement);
  if (!made) return null;
  return {
    ...made,
    distractors: [{
      value: outer === 'power'
        ? simplify(mul(int(2), inner))
        : simplify(replaceOuterOnly(statement)),
      diagnosis: 'The inside function was left out. The chain rule multiplies by the derivative of what is inside.',
      reviewSkill: 'derivative-chain-rule',
    }],
  };
};

/** The outer derivative alone, which is the classic chain-rule omission. */
function replaceOuterOnly(statement: Expr): Expr {
  if (statement.k !== 'fn') return statement;
  const inner = statement.args[0]!;
  switch (statement.name) {
    case 'sin': return mkFn('cos', inner);
    case 'cos': return negE(mkFn('sin', inner));
    case 'exp': return mkFn('exp', inner);
    case 'ln': return pow(inner, int(-1));
    default: return statement;
  }
}

export const genDerivativeApplications: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const want = r.pick(d > 0.45 ? (['tangent', 'turning'] as const) : (['tangent'] as const));
  const a = r.nonzeroInt(1, scale(d, 2, 4));
  const b = r.int(-scale(d, 5, 10), scale(d, 5, 10)) * 2;   // even keeps the vertex rational
  const c = r.int(-scale(d, 5, 10), scale(d, 5, 10));
  const f = add(mul(int(a), pow(X, int(2))), mul(int(b), X), int(c));
  const fPrime = differentiate(f, 'x');

  if (want === 'turning') {
    const solved = solveLinear(equation(fPrime, int(0)), 'x');
    if (solved.solutions.length !== 1) return null;
    const at = solved.solutions[0]!;
    const bd = new DerivationBuilder('Find the turning point', f);
    bd.applyUnverified(R_FORMULA, fPrime,
      'The derivative is a new function, not a restatement of f.',
      `Differentiate: f′(x) = ${toLatex(fPrime)}.`,
      'What is true about the slope at a maximum or minimum?');
    bd.applyUnverified(R_SUBSTITUTE, equation(fPrime, int(0)),
      'Setting the derivative to zero asks a new question: where is the slope flat?',
      'At a turning point the tangent is horizontal, so set the derivative to zero.',
      'A turning point has zero slope.');
    bd.absorb(solved.derivation.steps);
    return {
      prompt: 'At what x does the turning point occur?',
      context: `f(x) = $${toLatex(f)}$`,
      statement: f, variable: 'x',
      answer: { kind: 'number' as const, value: at },
      derivation: bd.build(),
    };
  }

  const point = r.nonzeroInt(-4, 4);
  const slope = simplify(substituteX(fPrime, int(point)));
  if (slope.k !== 'num') return null;
  const bd = new DerivationBuilder(`Find the slope at x = ${point}`, f);
  bd.applyUnverified(R_FORMULA, fPrime,
    'The derivative is a new function, not a restatement of f.',
    `Differentiate: f′(x) = ${toLatex(fPrime)}.`,
    'The slope of the tangent is the derivative.');
  bd.applyUnverified(R_SUBSTITUTE, slope,
    'Evaluating at a point gives a number rather than a function.',
    `At x = ${point}: f′(${point}) = ${toLatex(slope)}.`,
    'Now substitute the value.');
  return {
    prompt: `Find the gradient of the tangent at x = ${point}`,
    context: `f(x) = $${toLatex(f)}$`,
    statement: f, variable: 'x',
    answer: { kind: 'number' as const, value: slope },
    derivation: bd.build(),
  };
};

export const genAntiderivatives: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const parts: Expr[] = [];
  const n = r.int(1, d > 0.5 ? 3 : 2);
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let deg = r.int(0, scale(d, 3, 5));
    while (used.has(deg)) deg = r.int(0, scale(d, 3, 5));
    used.add(deg);
    const c = r.nonzeroInt(-scale(d, 4, 8), scale(d, 4, 8));
    parts.push(deg === 0 ? int(c) : deg === 1 ? mul(int(c), X) : mul(int(c), pow(X, int(deg))));
  }
  const statement = add(...parts);
  const derivation = antiderivativeDerivation(statement, 'x');
  if (derivation.incomplete) return null;

  return {
    prompt: 'Find the antiderivative. Include the constant of integration as C.',
    statement, variable: 'x',
    answer: { kind: 'expression' as const, value: derivation.result },
    derivation,
    distractors: [{
      value: simplify(differentiate(statement, 'x')),
      diagnosis: 'That is the derivative. Integrating goes the other way: raise each exponent by one and divide by the new exponent.',
      reviewSkill: 'antiderivatives',
    }],
  };
};

export const genDefiniteIntegrals: Generator = ({ difficulty: d, seed }) => {
  const r = new Rng(seed);
  const deg = r.int(1, scale(d, 2, 4));
  const coefficient = r.nonzeroInt(1, scale(d, 3, 6));
  const constant = d > 0.5 ? r.int(-6, 6) : 0;
  const integrand = constant === 0
    ? mul(int(coefficient), pow(X, int(deg)))
    : add(mul(int(coefficient), pow(X, int(deg))), int(constant));

  const lower = r.int(0, 2);
  const upper = lower + r.int(1, scale(d, 3, 5));
  const result = definiteIntegral(integrand, 'x', int(lower), int(upper));
  if (result.value === null) return null;

  return {
    prompt: `Evaluate the integral of ${toLatex(integrand)} from ${lower} to ${upper}`,
    statement: integrand, variable: 'x',
    answer: { kind: 'number' as const, value: result.value },
    derivation: result.derivation,
    distractors: [{
      value: simplify(substituteX(antiderivative(integrand, 'x')!, int(upper))),
      diagnosis: `That is the antiderivative at ${upper} only. A definite integral subtracts its value at the lower limit as well.`,
      reviewSkill: 'definite-integrals',
    }],
  };
};
