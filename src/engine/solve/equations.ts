/**
 * Equation types whose defining feature is that solving them can invent
 * answers: absolute value, radicals, and algebraic fractions.
 *
 * All three work by transforming into something solvable — splitting into
 * cases, squaring, clearing denominators — and each of those transformations
 * can produce candidates that do not satisfy the original. Checking every
 * candidate against the *original* equation is not a tidying step at the end;
 * it is the part of the method students skip and the reason they get these
 * wrong. So the check is a visible step in the derivation, with the arithmetic
 * shown, and a rejected candidate is named rather than quietly dropped.
 */

import type { Expr } from './../expr.ts';
import {
  add, mul, pow, num, int, sym, sub as subE, div as divE, neg as negE,
  equation, or as orE, rel, key, symbols, isRelation, hasSymbol,
  walk, numerDenom, E0,
} from './../expr.ts';
import * as R from './../rational.ts';
import { simplify, simplifyBest } from './../canon.ts';
import { expand, toRatPoly, degree, fromRatPoly } from './../polynomial.ts';
import { toLatex } from './../print.ts';
import { equivalent } from './../equivalence.ts';
import { evalNumeric, UndefinedAtPoint } from './../evaluate.ts';
import * as CX from './../complex.ts';
import * as B from './../bigfloat.ts';
import {
  DerivationBuilder, type Derivation,
  R_SIMPLIFY, R_ISOLATE, R_SQUARE_BOTH, R_CROSS_MULTIPLY, R_SPLIT_CASES, R_SUBSTITUTE,
} from './../derive.ts';
import { solveLinear, type SolveResult } from './linear.ts';
import { solveQuadratic } from './quadratic.ts';

/**
 * Does `candidate` actually satisfy `original`?
 *
 * Numeric rather than symbolic, because the candidate may be a surd and the
 * original may contain a radical whose branch matters. A point where the
 * original is undefined — a zero denominator — counts as failing, which is
 * exactly the extraneous case.
 */
export function satisfies(original: Expr, variable: string, candidate: Expr): boolean {
  if (original.k !== 'rel') return false;
  const diff = subE(original.args[0]!, original.args[1]!);
  try {
    const value = evalNumeric(candidate, {}, 120);
    // Only real candidates are solutions to these equation types.
    if (!CX.isReal(value)) return false;
    const residual = evalNumeric(diff, { [variable]: value }, 120);
    return CX.nearlyEqual(residual, CX.C_ZERO, 70);
  } catch (err) {
    if (err instanceof UndefinedAtPoint) return false;
    return false;
  }
}

/** Solve whatever remains once the hard part has been transformed away. */
function solveInner(e: Expr, variable: string): Expr[] {
  if (e.k !== 'rel') return [];
  const diff = simplify(expand(subE(e.args[0]!, e.args[1]!)));
  const poly = toRatPoly(diff, variable);
  if (poly && degree(poly) === 1) return solveLinear(e, variable).solutions;
  if (poly && degree(poly) === 2) {
    return solveQuadratic(e, variable, { complex: false }).solutions;
  }
  return [];
}

/** Add the "check every candidate" step, returning only the survivors. */
function checkCandidates(
  b: DerivationBuilder, original: Expr, variable: string, candidates: readonly Expr[],
  why: string,
): Expr[] {
  const X = sym(variable);
  const kept: Expr[] = [];
  const rejected: Expr[] = [];
  for (const c of candidates) (satisfies(original, variable, c) ? kept : rejected).push(c);

  const detail = rejected.length === 0
    ? `Both sides agree for ${kept.length === 1 ? 'this value' : 'each of these'}, so ${kept.length === 1 ? 'it is a genuine solution' : 'they are genuine solutions'}.`
    : `${rejected.map((r) => toLatex(r)).join(' and ')} ${rejected.length === 1 ? 'does' : 'do'} not satisfy the original equation, so ${rejected.length === 1 ? 'it is' : 'they are'} extraneous — introduced by ${why}, not present in the problem.`;

  const shown = kept.length === 0
    ? rel('=', X, { k: 'const', name: 'nan' })
    : kept.length === 1 ? equation(X, kept[0]!) : orE(...kept.map((k2) => equation(X, k2)));

  b.applyUnverified(R_SUBSTITUTE, shown,
    'Checking candidates against the original equation discards the ones the transformation invented.',
    `Put each candidate back into the original equation. ${detail}`,
    'Which of these actually work in the equation you started with?');

  return kept;
}

// ------------------------------------------------------------- absolute value

/** |ax + b| = c splits into two equations, one for each sign. */
export function solveAbsolute(e: Expr, v?: string): SolveResult {
  if (!isRelation(e)) throw new Error('solveAbsolute needs an equation.');
  const variable = v ?? symbols(e)[0];
  if (!variable) throw new Error('There is no variable to solve for.');
  const X = sym(variable);
  const b = new DerivationBuilder(`Solve for ${variable}`, e);

  const absNode = findAbs(e, variable);
  if (!absNode) {
    b.stop('There is no absolute value here to split.');
    return { derivation: b.build(), solutions: [] };
  }

  // Get the equation into |stuff| = rest.
  const [lhs, rhs] = e.args;
  const isolated = key(lhs!) === key(absNode)
    ? e
    : equation(absNode, simplify(subE(rhs!, simplify(subE(lhs!, absNode)))));
  if (key(isolated) !== key(e)) {
    b.apply(R_ISOLATE, isolated,
      'Get the absolute value on its own before splitting it.',
      'The bars need to be alone on one side.');
  }

  const inner = absNode.k === 'fn' ? absNode.args[0]! : absNode;
  // Simplify before inspecting: unary minus builds mul(-1, 5), so a literal
  // -5 is not a `num` node and a test for one silently misses it.
  const target = simplify((isolated as Extract<Expr, { k: 'rel' }>).args[1]!);

  // A negative right-hand side has no solutions: a distance is never negative.
  const targetValue = target.k === 'num' ? target.v : null;
  if (targetValue && R.isNeg(targetValue)) {
    // Nothing follows from here, so there is no step to take. Inventing one
    // would mean asserting a statement the original does not imply.
    b.stop(
      `An absolute value is a distance from zero, so it is never negative. ` +
      `Nothing has absolute value ${R.toString(targetValue)}, so this equation has no solution.`,
    );
    return { derivation: b.build(), solutions: [], special: 'no-solution' };
  }

  const positiveCase = equation(inner, target);
  const negativeCase = equation(inner, negExpr(target));
  b.applyUnverified(R_SPLIT_CASES, { k: 'or', args: [positiveCase, negativeCase] },
    'Splitting the bars replaces one equation with the two cases it stands for.',
    `${toLatex(inner)} is either ${toLatex(target)} or ${toLatex(negExpr(target))}: ` +
    'both are the same distance from zero.',
    'What two things could be inside the bars?');

  const solutions: Expr[] = [];
  for (const branch of [positiveCase, negativeCase]) {
    for (const s of solveInner(branch, variable)) solutions.push(s);
  }
  const distinct = dedupe(solutions);
  if (distinct.length === 0) {
    b.stop('Neither case has a solution.');
    return { derivation: b.build(), solutions: [] };
  }

  const shown = distinct.length === 1
    ? equation(X, distinct[0]!)
    : orE(...distinct.map((s) => equation(X, s)));
  b.applyUnverified(R_SIMPLIFY, shown,
    'Solving each case separately produces the combined answer.',
    'Solve each case as an ordinary equation.',
    'Each case is now straightforward.');

  return { derivation: b.build(), solutions: distinct };
}

function findAbs(e: Expr, variable: string): Expr | null {
  let found: Expr | null = null;
  walk(e, (n) => {
    if (!found && n.k === 'fn' && n.name === 'abs' && hasSymbol(n, variable)) found = n;
  });
  return found;
}

const negExpr = (e: Expr): Expr => simplify(mul(int(-1), e));

// -------------------------------------------------------------------- radical

/** sqrt(f(x)) = g(x): isolate, square, solve, then discard what squaring invented. */
export function solveRadical(e: Expr, v?: string): SolveResult {
  if (!isRelation(e)) throw new Error('solveRadical needs an equation.');
  const variable = v ?? symbols(e)[0];
  if (!variable) throw new Error('There is no variable to solve for.');
  const b = new DerivationBuilder(`Solve for ${variable}`, e);

  const root = findRoot(e, variable);
  if (!root) {
    b.stop('There is no radical here.');
    return { derivation: b.build(), solutions: [] };
  }

  const [lhs, rhs] = e.args;
  const isolated = key(lhs!) === key(root)
    ? e
    : equation(root, simplify(subE(rhs!, simplify(subE(lhs!, root)))));
  if (key(isolated) !== key(e)) {
    b.apply(R_ISOLATE, isolated,
      'Get the radical on its own so squaring removes it cleanly.',
      'The root needs to be alone on one side.');
  }

  const inner = root.k === 'fn' ? root.args[0]! : root;
  const other = (isolated as Extract<Expr, { k: 'rel' }>).args[1]!;
  const squared = equation(simplify(expand(inner)), simplify(expand(pow(other, int(2)))));

  b.applyUnverified(R_SQUARE_BOTH, squared,
    'Squaring both sides can add solutions, because two numbers with the same square need not be equal.',
    `Square both sides. The root disappears on the left, and the right becomes ${toLatex(simplify(expand(pow(other, int(2)))))}.`,
    'What undoes a square root?');

  const candidates = solveInner(squared, variable);
  if (candidates.length === 0) {
    b.stop('The squared equation has no real solutions.');
    return { derivation: b.build(), solutions: [] };
  }

  const kept = checkCandidates(b, e, variable, candidates, 'squaring');
  return {
    derivation: b.build(),
    solutions: kept,
    ...(kept.length === 0 ? { special: 'no-solution' as const } : {}),
  };
}

function findRoot(e: Expr, variable: string): Expr | null {
  let found: Expr | null = null;
  walk(e, (n) => {
    if (found) return;
    if (n.k === 'fn' && (n.name === 'sqrt' || n.name === 'root') && hasSymbol(n, variable)) found = n;
    if (n.k === 'pow' && n.exp.k === 'num' && n.exp.v.d !== 1n && hasSymbol(n.base, variable)) found = n;
  });
  return found;
}

// ------------------------------------------------------------------- rational

/** Clear denominators, solve, then discard anything that makes one zero. */
export function solveRational(e: Expr, v?: string): SolveResult {
  if (!isRelation(e)) throw new Error('solveRational needs an equation.');
  const variable = v ?? symbols(e)[0];
  if (!variable) throw new Error('There is no variable to solve for.');
  const b = new DerivationBuilder(`Solve for ${variable}`, e);

  const diff = simplify(subE(e.args[0]!, e.args[1]!));
  const [numerator, denominator] = numerDenom(combineOverCommonDenominator(diff));

  if (!hasSymbol(denominator, variable)) {
    b.stop('There is no variable in a denominator, so this is not a rational equation.');
    return { derivation: b.build(), solutions: [] };
  }

  // Multiplying through by a denominator is not an equivalence: the new
  // equation is satisfied wherever the denominator vanishes, and the original
  // is not even defined there. That gap is the whole reason the check step
  // below exists, so it is declared rather than asserted.
  b.applyUnverified(R_CROSS_MULTIPLY, equation(simplify(expand(numerator)), E0),
    'Multiplying by the denominator admits the values that make it zero, which the original excludes.',
    `Multiply through by ${toLatex(denominator)} to clear the fractions. ` +
    `A fraction is zero exactly when its numerator is, so only the top matters now.`,
    'The fractions can be cleared by multiplying through.');

  const cleared = equation(simplify(expand(numerator)), E0);
  const candidates = solveInner(cleared, variable);
  if (candidates.length === 0) {
    b.stop('The cleared equation has no solutions.');
    return { derivation: b.build(), solutions: [] };
  }

  const excluded = excludedValues(denominator, variable);
  const kept = checkCandidates(
    b, e, variable, candidates,
    excluded.length
      ? `multiplying by ${toLatex(denominator)}, which is zero at ${excluded.map((x) => toLatex(x)).join(' and ')}`
      : 'clearing the denominators',
  );

  return {
    derivation: b.build(),
    solutions: kept,
    ...(kept.length === 0 ? { special: 'no-solution' as const } : {}),
  };
}

/** Where the denominator vanishes — the values the original forbids. */
export function excludedValues(denominator: Expr, variable: string): Expr[] {
  const p = toRatPoly(simplify(expand(denominator)), variable);
  if (!p) return [];
  if (degree(p) === 1) return solveLinear(equation(fromRatPoly(p, variable), E0), variable).solutions;
  if (degree(p) === 2) {
    return solveQuadratic(equation(fromRatPoly(p, variable), E0), variable, { complex: false }).solutions;
  }
  return [];
}

/**
 * Put a sum of fractions over one denominator.
 * Uses the product of the denominators rather than their lcm: it is always
 * correct, and any surplus factor cancels when the numerator is reduced.
 */
function combineOverCommonDenominator(e: Expr): Expr {
  const terms = e.k === 'add' ? e.args : [e];
  const denominators: Expr[] = [];
  for (const t of terms) {
    const [, d] = numerDenom(t);
    if (d.k === 'num' && R.isOne(d.v)) continue;
    if (!denominators.some((x) => key(x) === key(d))) denominators.push(d);
  }
  if (denominators.length === 0) return e;
  const common = denominators.length === 1 ? denominators[0]! : mul(...denominators);
  // Simplify before expanding, not after. Expanding first distributes the
  // product across the common denominator's factors and leaves each piece
  // still over its original denominator, so nothing cancels and the
  // "numerator" comes back as the sum of fractions we started with.
  const scaled = terms.map((t) => simplify(expand(simplify(mul(t, common)))));
  return simplify(mul(add(...scaled), pow(common, int(-1))));
}

function dedupe(xs: readonly Expr[]): Expr[] {
  const seen = new Set<string>();
  const out: Expr[] = [];
  for (const x of xs) {
    const k = key(simplifyBest(x));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
