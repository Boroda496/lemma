/**
 * Differentiation, limits and integration.
 *
 * The differentiator is checked against something that shares none of its
 * code: `deriv` nodes evaluate numerically by finite difference, so every
 * step of every derivation is compared symbolic-against-numeric at random
 * points before it exists. A wrong rule does not produce a wrong answer here;
 * it throws.
 *
 * Steps apply one named rule at a time to the outermost remaining derivative,
 * which is how the work is written by hand: the product rule first, then the
 * pieces it left behind.
 */

import type { Expr, FnName } from './../expr.ts';
import {
  add, mul, pow, num, int, sym, div as divE, sub as subE, neg as negE,
  fn as mkFn, cst, equation, key, symbols, hasSymbol, symKey,
  children, withChildren, factors, terms, splitCoeff, isZeroE, isOneE, E0, E1,
} from './../expr.ts';
import * as R from './../rational.ts';
import { simplify, simplifyBest, cancelFraction } from './../canon.ts';
import { expand, toRatPoly, degree, fromRatPoly, polyDivMod, polyGcd } from './../polynomial.ts';
import { toLatex } from './../print.ts';
import { evalExact, UndefinedAtPoint } from './../evaluate.ts';
import {
  DerivationBuilder, type Derivation,
  R_POWER_RULE, R_SUM_RULE, R_PRODUCT_RULE, R_QUOTIENT_RULE, R_CHAIN_RULE,
  R_SIMPLIFY, R_ARITHMETIC, R_SUBSTITUTE, R_CANCEL, R_FORMULA,
} from './../derive.ts';

/** An unevaluated derivative node. */
export const deriv = (body: Expr, v: string): Expr => mkFn('deriv', body, sym(v));

// -------------------------------------------------------------- differentiate

/**
 * The symbolic derivative. Total for the functions the curriculum uses;
 * anything unrecognised is left as an unevaluated `deriv` node rather than
 * guessed at.
 */
export function differentiate(e: Expr, v: string): Expr {
  return simplify(diff(e, v));
}

function diff(e: Expr, v: string): Expr {
  if (!hasSymbol(e, v)) return E0;

  switch (e.k) {
    case 'sym':
      return symKey(e) === v ? E1 : E0;

    case 'add':
      return add(...e.args.map((a) => diff(a, v)));

    case 'mul': {
      const fs = factors(e);
      // Constants come straight out front.
      const constants = fs.filter((f) => !hasSymbol(f, v));
      const varying = fs.filter((f) => hasSymbol(f, v));
      if (varying.length === 0) return E0;
      const coefficient = constants.length ? mul(...constants) : E1;
      if (varying.length === 1) return mul(coefficient, diff(varying[0]!, v));
      // Product rule, extended across however many varying factors there are.
      const parts = varying.map((f, i) =>
        mul(diff(f, v), ...varying.filter((_, j) => j !== i)));
      return mul(coefficient, add(...parts));
    }

    case 'pow': {
      const baseHas = hasSymbol(e.base, v);
      const expHas = hasSymbol(e.exp, v);
      if (baseHas && !expHas) {
        // Power rule with the chain rule folded in: (u^n)' = n u^(n-1) u'
        const nextExp = simplify(subE(e.exp, E1));
        return mul(e.exp, pow(e.base, nextExp), diff(e.base, v));
      }
      if (!baseHas && expHas) {
        // (a^u)' = a^u ln(a) u'
        return mul(e, mkFn('ln', e.base), diff(e.exp, v));
      }
      // Both vary: differentiate exp(g ln f).
      const rewritten = mkFn('exp', mul(e.exp, mkFn('ln', e.base)));
      return diff(rewritten, v);
    }

    case 'fn':
      return diffFn(e.name, e.args, v);

    default:
      return deriv(e, v);
  }
}

/** Outer derivative times inner derivative, for every function we know. */
function diffFn(name: FnName, args: readonly Expr[], v: string): Expr {
  const u = args[0];
  if (!u) return E0;
  const du = diff(u, v);
  const chain = (outer: Expr): Expr => mul(outer, du);

  switch (name) {
    case 'sin': return chain(mkFn('cos', u));
    case 'cos': return chain(negE(mkFn('sin', u)));
    case 'tan': return chain(pow(mkFn('sec', u), int(2)));
    case 'sec': return chain(mul(mkFn('sec', u), mkFn('tan', u)));
    case 'csc': return chain(negE(mul(mkFn('csc', u), mkFn('cot', u))));
    case 'cot': return chain(negE(pow(mkFn('csc', u), int(2))));
    case 'exp': return chain(mkFn('exp', u));
    case 'ln': return chain(pow(u, int(-1)));
    case 'log': {
      if (args.length === 2) {
        const [base, inner] = args;
        return mul(pow(mul(inner!, mkFn('ln', base!)), int(-1)), diff(inner!, v));
      }
      return chain(pow(mul(u, mkFn('ln', int(10))), int(-1)));
    }
    case 'sqrt': return chain(pow(mul(int(2), mkFn('sqrt', u)), int(-1)));
    case 'asin': return chain(pow(mkFn('sqrt', subE(E1, pow(u, int(2)))), int(-1)));
    case 'acos': return chain(negE(pow(mkFn('sqrt', subE(E1, pow(u, int(2)))), int(-1))));
    case 'atan': return chain(pow(add(E1, pow(u, int(2))), int(-1)));
    case 'sinh': return chain(mkFn('cosh', u));
    case 'cosh': return chain(mkFn('sinh', u));
    case 'tanh': return chain(subE(E1, pow(mkFn('tanh', u), int(2))));
    case 'abs': return chain(mkFn('sign', u));
    default:
      return deriv(mkFn(name, ...args), v);
  }
}

// ------------------------------------------------------- step-by-step version

interface DiffMove {
  readonly rule: typeof R_POWER_RULE;
  readonly replaced: Expr;
  readonly replacement: Expr;
  readonly detail: string;
  readonly nudge: string;
}

/** The first `deriv` node in the tree, outermost first. */
function findDeriv(e: Expr): Expr | null {
  if (e.k === 'fn' && e.name === 'deriv') return e;
  for (const c of children(e)) {
    const hit = findDeriv(c);
    if (hit) return hit;
  }
  return null;
}

function replaceNode(root: Expr, target: Expr, replacement: Expr): Expr {
  const k = key(target);
  const go = (n: Expr): Expr => {
    if (key(n) === k) return replacement;
    const kids = children(n);
    if (kids.length === 0) return n;
    let changed = false;
    const next = kids.map((c) => { const r = go(c); if (r !== c) changed = true; return r; });
    return changed ? withChildren(n, next) : n;
  };
  return go(root);
}

/** Which named rule applies to this derivative, and what it produces. */
function moveFor(node: Expr, v: string): DiffMove | null {
  if (node.k !== 'fn' || node.name !== 'deriv') return null;
  const body = node.args[0]!;

  if (!hasSymbol(body, v)) {
    return {
      rule: R_POWER_RULE, replaced: node, replacement: E0,
      detail: `${toLatex(body)} does not depend on ${v}, so its rate of change is zero.`,
      nudge: 'Is this piece constant?',
    };
  }

  if (body.k === 'sym') {
    return {
      rule: R_POWER_RULE, replaced: node, replacement: E1,
      detail: `The derivative of ${v} with respect to itself is 1.`,
      nudge: 'How fast does x change with x?',
    };
  }

  if (body.k === 'add') {
    return {
      rule: R_SUM_RULE, replaced: node,
      replacement: add(...body.args.map((t) => deriv(t, v))),
      detail: `Differentiate each of the ${body.args.length} terms separately.`,
      nudge: 'A sum can be taken apart.',
    };
  }

  if (body.k === 'mul') {
    const fs = factors(body);
    const constants = fs.filter((f) => !hasSymbol(f, v));
    const varying = fs.filter((f) => hasSymbol(f, v));

    // A quotient written as f * g^-1 deserves the quotient rule by name.
    const denominatorFactor = varying.find(
      (f) => f.k === 'pow' && f.exp.k === 'num' && R.isNeg(f.exp.v) && hasSymbol(f.base, v),
    );
    if (denominatorFactor && varying.length === 2 && denominatorFactor.k === 'pow'
        && denominatorFactor.exp.k === 'num' && denominatorFactor.exp.v.n === -1n) {
      const g = denominatorFactor.base;
      const f = varying.find((x) => key(x) !== key(denominatorFactor))!;
      const top = subE(mul(deriv(f, v), g), mul(f, deriv(g, v)));
      const replacement = mul(
        constants.length ? mul(...constants) : E1,
        top, pow(g, int(-2)),
      );
      return {
        rule: R_QUOTIENT_RULE, replaced: node, replacement,
        detail: `With f = ${toLatex(f)} and g = ${toLatex(g)}, the quotient rule gives ` +
          `(f′g − fg′)/g².`,
        nudge: 'This is a fraction with the variable on the bottom.',
      };
    }

    if (constants.length > 0 && varying.length > 0) {
      const coefficient = mul(...constants);
      const rest = varying.length === 1 ? varying[0]! : mul(...varying);
      return {
        rule: R_SIMPLIFY, replaced: node,
        replacement: mul(coefficient, deriv(rest, v)),
        detail: `${toLatex(coefficient)} is a constant, so it comes outside the derivative.`,
        nudge: 'Constants can be pulled out front.',
      };
    }

    if (varying.length >= 2) {
      const [f, ...others] = varying;
      const g = others.length === 1 ? others[0]! : mul(...others);
      return {
        rule: R_PRODUCT_RULE, replaced: node,
        replacement: add(mul(deriv(f!, v), g), mul(f!, deriv(g, v))),
        detail: `With f = ${toLatex(f!)} and g = ${toLatex(g)}, the product rule gives f′g + fg′.`,
        nudge: 'Two things depending on x are multiplied.',
      };
    }
  }

  // a^u: an exponential, where the variable is upstairs.
  if (body.k === 'pow' && !hasSymbol(body.base, v) && hasSymbol(body.exp, v)) {
    const base = body.base;
    const isE = base.k === 'const' && base.name === 'e';
    const outer = isE ? body : mul(body, mkFn('ln', base));
    const innerIsPlainVariable = body.exp.k === 'sym';
    return {
      rule: innerIsPlainVariable ? R_FORMULA : R_CHAIN_RULE,
      replaced: node,
      replacement: innerIsPlainVariable ? outer : mul(outer, deriv(body.exp, v)),
      detail: isE
        ? `e to a power is its own derivative` +
          (innerIsPlainVariable ? '.' : `, times the derivative of the exponent.`)
        : `The derivative of ${toLatex(base)}^u is ${toLatex(base)}^u·ln(${toLatex(base)})` +
          (innerIsPlainVariable ? '.' : ', times the derivative of the exponent.'),
      nudge: 'The variable is in the exponent.',
    };
  }

  if (body.k === 'pow' && hasSymbol(body.base, v) && !hasSymbol(body.exp, v)) {
    const n = body.exp;
    const nextExp = simplify(subE(n, E1));
    const innerIsPlainVariable = body.base.k === 'sym';
    const replacement = innerIsPlainVariable
      ? mul(n, pow(body.base, nextExp))
      : mul(n, pow(body.base, nextExp), deriv(body.base, v));
    return {
      rule: innerIsPlainVariable ? R_POWER_RULE : R_CHAIN_RULE,
      replaced: node, replacement,
      detail: innerIsPlainVariable
        ? `The power rule: bring the ${toLatex(n)} down and drop the exponent by one.`
        : `The outside is a power, so bring ${toLatex(n)} down and reduce the exponent, ` +
          `then multiply by the derivative of the inside.`,
      nudge: innerIsPlainVariable ? 'This is a plain power of x.' : 'There is a function inside the power.',
    };
  }

  if (body.k === 'fn') {
    const inner = body.args[0]!;
    const outer = simplify(replaceNode(diffFn(body.name, body.args, v), deriv(inner, v), E1));
    const innerIsPlainVariable = inner.k === 'sym';
    const derivativeOfOuter = simplify(divideOutInner(diffFn(body.name, body.args, v), inner, v));
    void outer;
    return {
      rule: innerIsPlainVariable ? R_FORMULA : R_CHAIN_RULE,
      replaced: node,
      replacement: innerIsPlainVariable
        ? derivativeOfOuter
        : mul(derivativeOfOuter, deriv(inner, v)),
      detail: innerIsPlainVariable
        ? `The derivative of ${body.name}(${toLatex(inner)}) is ${toLatex(derivativeOfOuter)}.`
        : `Differentiate the outside function, leaving ${toLatex(inner)} alone, then multiply ` +
          `by the derivative of the inside.`,
      nudge: innerIsPlainVariable
        ? `What is the derivative of ${body.name}?`
        : 'There is a function inside another function.',
    };
  }

  return null;
}

/** The outer derivative alone: the full result with the inner factor removed. */
function divideOutInner(full: Expr, inner: Expr, v: string): Expr {
  const du = diff(inner, v);
  if (isOneE(simplify(du))) return simplify(full);
  return simplify(mul(full, pow(du, int(-1))));
}

/** Differentiate, showing each named rule as its own line. */
export function differentiateDerivation(e: Expr, v = 'x'): Derivation {
  const start = deriv(e, v);
  const b = new DerivationBuilder(`Differentiate with respect to ${v}`, start);

  for (let guard = 0; guard < 60; guard++) {
    const node = findDeriv(b.expr);
    if (!node) break;
    const move = moveFor(node, v);
    if (!move) {
      b.stop(`I do not have a rule for ${toLatex(node)}.`);
      return b.build();
    }
    const next = replaceNode(b.expr, move.replaced, move.replacement);
    if (key(next) === key(b.expr)) break;
    b.apply(move.rule, next, move.detail, move.nudge);
  }

  const tidy = simplifyBest(b.expr);
  if (key(tidy) !== key(b.expr)) {
    b.apply(R_SIMPLIFY, tidy, 'Tidy the result.', 'Collect what is left.');
  }
  return b.build();
}

// --------------------------------------------------------------------- limits

export interface LimitResult {
  readonly derivation: Derivation;
  readonly value: Expr | null;
  readonly indeterminate: boolean;
}

/**
 * The limit of `e` as `v` approaches `point`.
 *
 * Substitution first; if that gives 0/0 the algebra is hiding a cancellation,
 * so factor and cancel and try again. That is exactly the method taught, and
 * it is complete for the rational functions this curriculum uses.
 */
export function limitAt(e: Expr, v: string, point: Expr): LimitResult {
  const b = new DerivationBuilder(`Find the limit as ${v} approaches ${toLatex(point)}`, e);

  const pointValue = evalExact(point);
  const direct = pointValue === null ? null : trySubstitute(e, v, pointValue);

  if (direct !== null) {
    b.applyUnverified(R_SUBSTITUTE, direct,
      'Substituting the limit point gives a value, not a restatement of the expression.',
      `The expression is defined at ${v} = ${toLatex(point)}, so the limit is just its value there.`,
      'Try putting the value straight in.');
    return { derivation: b.build(), value: direct, indeterminate: false };
  }

  // Indeterminate. Cancel the common factor and substitute again.
  //
  // The cancel step is emitted only when it visibly changes the expression,
  // but the substitution is attempted either way: `simplify` may already have
  // cancelled x/x on its own, and gating the whole branch on the expression
  // having changed made those limits report no answer at all.
  const cancelled = cancelFraction(e);
  const after = pointValue === null ? null : trySubstitute(cancelled, v, pointValue);

  if (after !== null) {
    if (key(cancelled) !== key(e)) {
      b.apply(R_CANCEL, cancelled,
        `Substituting gives 0/0, which means the top and bottom share a factor. ` +
        `Cancelling it leaves an expression that agrees with the original everywhere except at ${v} = ${toLatex(point)} — ` +
        `and a limit never asks about the point itself.`,
        'Both top and bottom vanish there. What do they have in common?');
    }
    b.applyUnverified(R_SUBSTITUTE, after,
      'Substituting the limit point gives a value, not a restatement of the expression.',
      `Now substitution works: the limit is ${toLatex(after)}.`,
      'Try substituting again.');
    return { derivation: b.build(), value: after, indeterminate: false };
  }

  b.stop('This limit needs a method beyond factor-and-cancel.');
  return { derivation: b.build(), value: null, indeterminate: true };
}

function trySubstitute(e: Expr, v: string, at: R.Rat): Expr | null {
  try {
    const value = evalExact(e, { [v]: at });
    return value === null ? null : num(value);
  } catch (err) {
    if (err instanceof UndefinedAtPoint) return null;
    return null;
  }
}

// ----------------------------------------------------------------- integration

/**
 * The antiderivative, for the forms the curriculum covers: sums, constant
 * multiples, powers of the variable (including 1/x), and the standard
 * exponential and trigonometric functions. Anything else returns null rather
 * than a guess.
 */
export function antiderivative(e: Expr, v: string): Expr | null {
  if (!hasSymbol(e, v)) return mul(e, sym(v));

  if (e.k === 'add') {
    const parts = e.args.map((t) => antiderivative(t, v));
    if (parts.some((p) => p === null)) return null;
    return simplify(add(...(parts as Expr[])));
  }

  if (e.k === 'mul') {
    const fs = factors(e);
    const constants = fs.filter((f) => !hasSymbol(f, v));
    const varying = fs.filter((f) => hasSymbol(f, v));
    if (varying.length !== 1) return null;
    const inner = antiderivative(varying[0]!, v);
    if (inner === null) return null;
    return simplify(mul(...constants, inner));
  }

  if (e.k === 'sym' && symKey(e) === v) return simplify(mul(num(R.rat(1, 2)), pow(e, int(2))));

  if (e.k === 'pow' && e.base.k === 'sym' && symKey(e.base) === v
      && e.exp.k === 'num' && !hasSymbol(e.exp, v)) {
    const n = e.exp.v;
    // The power rule in reverse fails at n = -1, where the answer is a log.
    if (R.eq(n, R.rat(-1))) return mkFn('ln', mkFn('abs', e.base));
    const next = R.add(n, R.ONE);
    return simplify(mul(num(R.inv(next)), pow(e.base, num(next))));
  }

  // e^x arrives as a power of the constant e, not as exp(x).
  if (e.k === 'pow' && e.base.k === 'const' && e.base.name === 'e'
      && e.exp.k === 'sym' && symKey(e.exp) === v) {
    return e;
  }

  if (e.k === 'fn' && e.args[0] && e.args[0].k === 'sym' && symKey(e.args[0]) === v) {
    switch (e.name) {
      case 'sin': return negE(mkFn('cos', e.args[0]));
      case 'cos': return mkFn('sin', e.args[0]);
      case 'exp': return mkFn('exp', e.args[0]);
      default: return null;
    }
  }

  return null;
}

/** Antidifferentiate, showing the work, with the constant of integration named. */
export function antiderivativeDerivation(e: Expr, v = 'x'): Derivation {
  const start = mkFn('integral', e, sym(v));
  const b = new DerivationBuilder(`Integrate with respect to ${v}`, start);
  const result = antiderivative(e, v);
  if (result === null) {
    b.stop('I do not have a rule for this integral.');
    return b.build();
  }

  const withConstant = add(result, sym('C'));
  b.applyUnverified(R_POWER_RULE, withConstant,
    'An antiderivative is a different object from the integrand, and it is only determined up to a constant.',
    'Reverse the power rule: raise each exponent by one and divide by the new exponent. ' +
    'The constant of integration is there because a constant leaves no trace in a derivative.',
    'What would differentiate to give this?');

  // Verify by differentiating back. This is the check a student is told to do.
  const back = differentiate(result, v);
  b.applyUnverified(R_SIMPLIFY, withConstant,
    'This line restates the answer after checking it, rather than deriving something new.',
    `Check by differentiating: d/d${v} of ${toLatex(result)} gives ${toLatex(back)}, which is what we started with.`,
    'Differentiate your answer and see if you get back.');

  return b.build();
}

/** A definite integral by the fundamental theorem. */
export function definiteIntegral(e: Expr, v: string, lower: Expr, upper: Expr): {
  derivation: Derivation; value: Expr | null;
} {
  const start = mkFn('integral', e, sym(v));
  const b = new DerivationBuilder(
    `Evaluate the integral from ${toLatex(lower)} to ${toLatex(upper)}`, start);

  const F = antiderivative(e, v);
  if (F === null) {
    b.stop('I do not have a rule for this integral.');
    return { derivation: b.build(), value: null };
  }

  b.applyUnverified(R_POWER_RULE, F,
    'An antiderivative is a different object from the integrand.',
    `First find an antiderivative: ${toLatex(F)}. No constant is needed here — ` +
    'it cancels when the two ends are subtracted.',
    'What differentiates to give the integrand?');

  const atUpper = substituteValue(F, v, upper);
  const atLower = substituteValue(F, v, lower);
  const value = simplifyBest(subE(atUpper, atLower));

  b.applyUnverified(R_SUBSTITUTE, value,
    'Evaluating at the two ends produces a number, not a restatement of the antiderivative.',
    `The fundamental theorem says the integral is the antiderivative at ${toLatex(upper)} ` +
    `minus its value at ${toLatex(lower)}: ${toLatex(simplifyBest(atUpper))} − ${toLatex(simplifyBest(atLower))}.`,
    'Evaluate at the top limit, then subtract the value at the bottom.');

  return { derivation: b.build(), value };
}

function substituteValue(e: Expr, v: string, value: Expr): Expr {
  const go = (n: Expr): Expr => {
    if (n.k === 'sym' && symKey(n) === v) return value;
    const kids = children(n);
    if (kids.length === 0) return n;
    return withChildren(n, kids.map(go));
  };
  return simplify(go(e));
}
