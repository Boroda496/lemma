/**
 * Quadratic equations, by whichever of the three standard methods fits.
 *
 * Method choice matters pedagogically, so it is explicit rather than always
 * reaching for the formula:
 *   - factoring, when the quadratic factors over the rationals. Fastest by
 *     hand and the method a student should reach for first.
 *   - the square-root method, when there is no linear term.
 *   - completing the square, on request, and as the derivation that explains
 *     where the formula comes from.
 *   - the quadratic formula, which always works, as the fallback.
 *
 * The caller can force a method, which is what the curriculum does when the
 * skill being practised *is* one particular method.
 */

import type { Expr } from './../expr.ts';
import {
  add, mul, pow, num, int, sym, sqrt as sqrtE, div as divE, sub as subE, neg as negE,
  rel, equation, or as orE, key, symbols, isRelation, E0, E1,
} from './../expr.ts';
import * as R from './../rational.ts';
import { simplify, simplifyBest } from './../canon.ts';
import {
  expand, toRatPoly, degree, factorRational, factorizationToExpr, fromRatPoly,
  quadraticRoots, discriminant, completeSquare, simplifySurd, type RatPoly,
} from './../polynomial.ts';
import { toLatex } from './../print.ts';
import { equivalentSets } from './../equivalence.ts';
import {
  DerivationBuilder, type Derivation,
  R_STANDARD_FORM, R_FACTOR_QUADRATIC, R_ZERO_PRODUCT, R_QUADRATIC_FORMULA,
  R_COMPLETE_SQUARE, R_SQUARE_ROOT_BOTH, R_SIMPLIFY, R_ARITHMETIC, R_DIV_BOTH,
} from './../derive.ts';
import type { SolveResult } from './linear.ts';

export type QuadraticMethod = 'factor' | 'square-root' | 'complete-square' | 'formula';

export interface QuadraticOptions {
  readonly method?: QuadraticMethod;
  /** Include complex roots. Default true; set false for a real-only course. */
  readonly complex?: boolean;
}

export function isQuadraticIn(e: Expr, v: string): boolean {
  if (!isRelation(e)) return false;
  const p = toRatPoly(subE(e.args[0]!, e.args[1]!), v);
  return p !== null && degree(p) === 2;
}

/** Which method the app would choose on its own, and why. */
export function chooseMethod(p: RatPoly): { method: QuadraticMethod; because: string } {
  const [c, b, a] = [p[0] ?? R.ZERO, p[1] ?? R.ZERO, p[2] ?? R.ZERO];
  if (R.isZero(b)) {
    return { method: 'square-root', because: 'There is no linear term, so the square root method is quickest.' };
  }
  const f = factorRational(p);
  const factorsOverQ = f.complete && f.factors.filter((x) => degree(x.poly) === 1).length >= 2;
  if (factorsOverQ) {
    return { method: 'factor', because: 'It factors over the rationals, which is the quickest route by hand.' };
  }
  const disc = discriminant(a, b, c);
  return {
    method: 'formula',
    because: R.isNeg(disc)
      ? 'It does not factor and the discriminant is negative, so the formula gives the complex roots.'
      : 'It does not factor over the rationals, so the formula is the reliable route.',
  };
}

export function solveQuadratic(e: Expr, v?: string, opts: QuadraticOptions = {}): SolveResult {
  if (!isRelation(e)) throw new Error('solveQuadratic needs an equation.');
  const variable = v ?? symbols(e)[0];
  if (!variable) throw new Error('There is no variable to solve for.');
  const X = sym(variable);

  const b = new DerivationBuilder(`Solve for ${variable}`, e);

  // 1. Standard form: everything on the left, zero on the right.
  const diff = simplify(expand(subE(e.args[0]!, e.args[1]!)));
  const p = toRatPoly(diff, variable);
  if (p === null || degree(p) !== 2) {
    b.stop(`This is not quadratic in ${variable}.`);
    return { derivation: b.build(), solutions: [] };
  }

  const standard = equation(fromRatPoly(p, variable), E0);
  if (key(standard) !== key(e)) {
    b.apply(R_STANDARD_FORM, standard,
      'Bring every term to the left so the right-hand side is zero.',
      'A quadratic is easiest to handle with zero on one side.');
  }

  const method = opts.method ?? chooseMethod(p).method;
  switch (method) {
    case 'square-root': return viaSquareRoot(b, p, variable, X, opts);
    case 'factor': return viaFactoring(b, p, variable, X, opts);
    case 'complete-square': return viaCompletingTheSquare(b, p, variable, X, opts);
    case 'formula': default: return viaFormula(b, p, variable, X, opts);
  }
}

// ------------------------------------------------------------------- methods

function rootsOf(p: RatPoly, complex: boolean): Expr[] {
  const [c, b, a] = [p[0] ?? R.ZERO, p[1] ?? R.ZERO, p[2] ?? R.ZERO];
  return quadraticRoots(a, b, c, complex).map((r) => simplifyBest(r.value));
}

function finish(b: DerivationBuilder, roots: Expr[]): SolveResult {
  return { derivation: b.build(), solutions: roots };
}

/** ax² + c = 0 → x = ±√(−c/a) */
function viaSquareRoot(
  b: DerivationBuilder, p: RatPoly, variable: string, X: Expr, opts: QuadraticOptions,
): SolveResult {
  const [c, , a] = [p[0] ?? R.ZERO, p[1] ?? R.ZERO, p[2] ?? R.ZERO];
  const target = R.neg(R.div(c, a));

  b.apply(R_SIMPLIFY, equation(pow(X, int(2)), num(target)),
    `Move the constant across and divide by ${R.toString(a)}, leaving ${variable} squared on its own.`,
    'Get the squared term by itself.');

  const roots = rootsOf(p, opts.complex ?? true);
  if (roots.length === 0) {
    b.stop('There is no real number whose square is negative.');
    return finish(b, []);
  }
  const shown = roots.length === 2
    ? orE(equation(X, roots[0]!), equation(X, roots[1]!))
    : equation(X, roots[0]!);
  b.applyUnverified(R_SQUARE_ROOT_BOTH, shown,
    'Taking a square root splits one equation into the two cases the ± stands for.',
    `Take the square root of both sides. Both the positive and the negative root square to ${toLatex(num(target))}.`,
    'What number squared gives that?');
  return finish(b, roots);
}

/** Factor, then read a root off each factor. */
function viaFactoring(
  b: DerivationBuilder, p: RatPoly, variable: string, X: Expr, opts: QuadraticOptions,
): SolveResult {
  const f = factorRational(p);
  const factored = factorizationToExpr(f, variable);
  const [c, bb, a] = [p[0] ?? R.ZERO, p[1] ?? R.ZERO, p[2] ?? R.ZERO];

  if (f.factors.filter((x) => degree(x.poly) === 1).length < 2 || !f.complete) {
    // Not actually factorable; say so rather than pretending, and switch method.
    b.apply(R_SIMPLIFY, b.expr,
      'This one does not factor over the rationals, so the formula is the way through.',
      'Try to factor first; if it resists, reach for the formula.');
    return viaFormula(b, p, variable, X, opts);
  }

  b.apply(R_FACTOR_QUADRATIC, equation(factored, E0),
    `Find two numbers that multiply to ${R.toString(R.mul(a, c))} and add to ${R.toString(bb)}; ` +
    `they give the split that factors the quadratic.`,
    'Can the left-hand side be written as a product?');

  const roots = rootsOf(p, opts.complex ?? true);
  const cases = roots.map((r) => equation(X, r));
  const distinct = dedupe(cases);
  b.applyUnverified(R_ZERO_PRODUCT,
    distinct.length === 1 ? distinct[0]! : orE(...distinct),
    'The zero-product property replaces one equation with the separate cases it allows.',
    'A product is zero exactly when one of its factors is zero, so set each factor to zero in turn.',
    'What has to be true for a product to equal zero?');
  return finish(b, roots);
}

/** Complete the square: the derivation the quadratic formula is made of. */
function viaCompletingTheSquare(
  b: DerivationBuilder, p: RatPoly, variable: string, X: Expr, opts: QuadraticOptions,
): SolveResult {
  const [c, bb, a] = [p[0] ?? R.ZERO, p[1] ?? R.ZERO, p[2] ?? R.ZERO];

  if (!R.isOne(a)) {
    const divided: RatPoly = p.map((k) => R.div(k, a));
    b.apply(R_DIV_BOTH, equation(fromRatPoly(divided, variable), E0),
      `Divide through by ${R.toString(a)} so the squared term has coefficient 1.`,
      'Completing the square wants a leading coefficient of 1.');
    return viaCompletingTheSquare(b, divided, variable, X, opts);
  }

  const { h, k } = completeSquare(a, bb, c);
  const half = R.div(bb, R.rat(2));

  // (x + h)² + k = 0
  const squared = add(pow(add(X, num(h)), int(2)), num(k));
  b.apply(R_COMPLETE_SQUARE, equation(squared, E0),
    `Half of ${R.toString(bb)} is ${R.toString(half)}, and ${R.toString(half)} squared is ` +
    `${R.toString(R.mul(half, half))}. Adding and subtracting that makes a perfect square.`,
    `Look at the coefficient of ${variable} and halve it.`);

  const target = R.neg(k);
  b.apply(R_SIMPLIFY, equation(pow(add(X, num(h)), int(2)), num(target)),
    'Move the constant to the right.', 'Isolate the squared bracket.');

  const roots = rootsOf(p, opts.complex ?? true);
  if (roots.length === 0) {
    b.stop('The square of a real number cannot be negative, so there is no real solution.');
    return finish(b, []);
  }
  const cases = dedupe(roots.map((r) => equation(X, r)));
  b.applyUnverified(R_SQUARE_ROOT_BOTH,
    cases.length === 1 ? cases[0]! : orE(...cases),
    'Taking a square root splits one equation into the two cases the ± stands for.',
    `Take the square root of both sides, keeping both signs, then subtract ${R.toString(h)}.`,
    'Undo the square, then undo the addition.');
  return finish(b, roots);
}

/** The formula, with the discriminant computed as its own visible step. */
function viaFormula(
  b: DerivationBuilder, p: RatPoly, variable: string, X: Expr, opts: QuadraticOptions,
): SolveResult {
  const [c, bb, a] = [p[0] ?? R.ZERO, p[1] ?? R.ZERO, p[2] ?? R.ZERO];
  const disc = discriminant(a, bb, c);

  // Show the substitution into the formula before evaluating anything.
  const formula = divE(
    add(negE(num(bb)), sqrtE(subE(pow(num(bb), int(2)), mul(int(4), num(a), num(c))))),
    mul(int(2), num(a)),
  );
  b.applyUnverified(R_QUADRATIC_FORMULA, equation(X, formula),
    'The formula names one of the two roots; the ± is spelled out in the next step.',
    `With a = ${R.toString(a)}, b = ${R.toString(bb)} and c = ${R.toString(c)}, ` +
    `substitute into x = (−b ± √(b² − 4ac)) / 2a.`,
    'Identify a, b and c, then use the formula.');

  const discNote = R.isZero(disc)
    ? 'The discriminant is zero, so there is exactly one (repeated) root.'
    : R.isNeg(disc)
      ? 'The discriminant is negative, so the two roots are complex conjugates.'
      : R.exactRoot(disc, 2) !== null
        ? 'The discriminant is a perfect square, so the roots are rational.'
        : 'The discriminant is positive but not a perfect square, so the roots are irrational.';

  b.applyUnverified(R_ARITHMETIC, equation(X, divE(add(negE(num(bb)), sqrtE(num(disc))), mul(int(2), num(a)))),
    'This line evaluates the discriminant inside the formula.',
    `b² − 4ac = ${signed(R.mul(bb, bb))} − ${signed(R.mul(R.rat(4), R.mul(a, c)))} ` +
    `= ${R.toString(disc)}. ${discNote}`,
    'Work out what is under the square root first.');

  const roots = rootsOf(p, opts.complex ?? true);
  if (roots.length === 0) {
    b.stop('The discriminant is negative, so there is no real solution.');
    return finish(b, []);
  }
  const cases = dedupe(roots.map((r) => equation(X, r)));
  b.applyUnverified(R_SIMPLIFY,
    cases.length === 1 ? cases[0]! : orE(...cases),
    'The ± becomes the two separate roots.',
    cases.length === 1
      ? 'The discriminant is zero, so both signs give the same root.'
      : 'Take the plus and the minus in turn, and simplify each.',
    'Split the ± into its two cases.');
  return finish(b, roots);
}

/** Bracket a negative number so "4 - -20" reads as "4 - (-20)". */
function signed(v: R.Rat): string {
  return R.isNeg(v) ? `(${R.toString(v)})` : R.toString(v);
}

function dedupe(xs: Expr[]): Expr[] {
  const seen = new Set<string>();
  const out: Expr[] = [];
  for (const x of xs) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/**
 * Check a student's roots against the true ones.
 * Set comparison, so order does not matter and a duplicate is not a second root.
 */
export function checkRoots(p: RatPoly, given: readonly Expr[], complex = true) {
  return equivalentSets(rootsOf(p, complex), given);
}
