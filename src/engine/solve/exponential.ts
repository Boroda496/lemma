/**
 * Equations with the unknown in an exponent, or inside a logarithm.
 *
 * Both directions are the same move seen from opposite sides: a logarithm
 * brings an exponent down to where it can be solved for, and exponentiating
 * cancels a logarithm. The solvers keep answers exact — log_2(8) is 3, not
 * 2.9999999 — and fall back to a symbolic log only when the answer genuinely
 * is not rational.
 */

import type { Expr } from './../expr.ts';
import {
  add, mul, pow, num, int, sym, div as divE, sub as subE, fn as mkFn, cst,
  equation, key, symbols, isRelation, hasSymbol, walk,
} from './../expr.ts';
import * as R from './../rational.ts';
import { simplify, simplifyBest } from './../canon.ts';
import { toLatex } from './../print.ts';
import { evalExact } from './../evaluate.ts';
import {
  DerivationBuilder, type Derivation,
  R_LOG_BOTH, R_EXPONENTIATE, R_SIMPLIFY, R_ISOLATE,
} from './../derive.ts';
import { solveLinear, type SolveResult } from './linear.ts';
import { satisfies } from './equations.ts';

/** Is `b^k` exactly `target` for an integer k? Returns k, or null. */
export function exactLog(base: R.Rat, target: R.Rat): R.Rat | null {
  if (R.isZero(target) || !R.isPos(target)) return null;
  if (R.isOne(base) || !R.isPos(base)) return null;
  // Search a sensible range of integer exponents in both directions.
  for (let k = -40; k <= 40; k++) {
    if (R.eq(R.powInt(base, BigInt(k)), target)) return R.rat(k);
  }
  // Fractional exponents that come from a common root, e.g. 8^(2/3) = 4.
  for (let den = 2; den <= 6; den++) {
    const root = R.exactRoot(base, den);
    if (root === null) continue;
    for (let k = -30; k <= 30; k++) {
      if (R.eq(R.powInt(root, BigInt(k)), target)) return R.rat(k, den);
    }
  }
  return null;
}

/** a·b^(cx+d) = e — solve for x. */
export function solveExponential(e: Expr, v?: string): SolveResult {
  if (!isRelation(e)) throw new Error('solveExponential needs an equation.');
  const variable = v ?? symbols(e)[0];
  if (!variable) throw new Error('There is no variable to solve for.');
  const X = sym(variable);
  const b = new DerivationBuilder(`Solve for ${variable}`, e);

  const power = findPowerWithVariableExponent(e, variable);
  if (!power || power.k !== 'pow') {
    b.stop(`There is no power with ${variable} in the exponent.`);
    return { derivation: b.build(), solutions: [] };
  }

  // Isolate the power on the left.
  const [lhs, rhs] = e.args;
  const isolated = key(lhs!) === key(power)
    ? e
    : isolatePower(e, power);
  if (isolated === null) {
    b.stop('I could not get the power on its own.');
    return { derivation: b.build(), solutions: [] };
  }
  if (key(isolated) !== key(e)) {
    b.apply(R_ISOLATE, isolated,
      'Get the power by itself before taking logarithms.',
      'The power needs to be alone on one side.');
  }

  const base = power.base;
  const exponent = power.exp;
  const target = (isolated as Extract<Expr, { k: 'rel' }>).args[1]!;

  const baseValue = evalExact(base);
  const targetValue = evalExact(target);

  // Exact route: when both sides are powers of the same base, read off the
  // exponents. This is how these are actually done by hand.
  if (baseValue && targetValue) {
    const k = exactLog(baseValue, targetValue);
    if (k !== null) {
      b.applyUnverified(R_SIMPLIFY, equation(exponent, num(k)),
        'Matching the bases lets the exponents be equated, which the previous line does not state on its own.',
        `${toLatex(target)} is ${toLatex(base)} to the power ${R.toString(k)}. ` +
        `With the bases equal, the exponents must be equal too.`,
        'Can both sides be written as powers of the same base?');
      const inner = solveLinear(equation(exponent, num(k)), variable);
      b.absorb(inner.derivation.steps);
      return { derivation: b.build(), solutions: inner.solutions };
    }
  }

  // General route: take logarithms of both sides.
  const logged = equation(mul(exponent, mkFn('ln', base)), mkFn('ln', target));
  b.applyUnverified(R_LOG_BOTH, logged,
    'Taking logarithms is reversible for positive values, but the step assumes both sides are positive.',
    `Take the natural log of both sides. The exponent comes down as a coefficient: ` +
    `ln(${toLatex(base)}^${toLatex(exponent)}) = ${toLatex(exponent)}·ln(${toLatex(base)}).`,
    'How do you get the unknown out of the exponent?');

  const inner = solveLinear(logged, variable);
  b.absorb(inner.derivation.steps);
  return { derivation: b.build(), solutions: inner.solutions.map((s) => simplifyBest(s)) };
}

/** log_b(f(x)) = c — solve for x. */
export function solveLogarithmic(e: Expr, v?: string): SolveResult {
  if (!isRelation(e)) throw new Error('solveLogarithmic needs an equation.');
  const variable = v ?? symbols(e)[0];
  if (!variable) throw new Error('There is no variable to solve for.');
  const X = sym(variable);
  const b = new DerivationBuilder(`Solve for ${variable}`, e);

  const logNode = findLog(e, variable);
  if (!logNode || logNode.k !== 'fn') {
    b.stop(`There is no logarithm containing ${variable}.`);
    return { derivation: b.build(), solutions: [] };
  }

  const [lhs, rhs] = e.args;
  const isolated = key(lhs!) === key(logNode) ? e : null;
  if (isolated === null) {
    b.stop('The logarithm needs to be on its own for this method.');
    return { derivation: b.build(), solutions: [] };
  }

  // log(x) is base 10; log(b, x) is base b; ln(x) is base e.
  const [base, inner] = logNode.name === 'ln'
    ? [cst('e'), logNode.args[0]!]
    : logNode.args.length === 2
      ? [logNode.args[0]!, logNode.args[1]!]
      : [int(10), logNode.args[0]!];

  const target = (isolated as Extract<Expr, { k: 'rel' }>).args[1]!;
  const exponentiated = equation(inner, simplify(pow(base, target)));

  b.applyUnverified(R_EXPONENTIATE, exponentiated,
    'Exponentiating admits values where the original logarithm is undefined, so the answers need checking.',
    `Raise ${toLatex(base)} to both sides. That undoes the logarithm and leaves ` +
    `${toLatex(inner)} = ${toLatex(simplify(pow(base, target)))}.`,
    'What undoes a logarithm?');

  const candidates = solveLinear(exponentiated, variable).solutions;
  const kept = candidates.filter((c) => satisfies(e, variable, c));

  if (kept.length === candidates.length && kept.length > 0) {
    b.apply(R_SIMPLIFY, equation(X, kept[0]!), 'Read off the answer.', 'Almost there.');
    return { derivation: b.build(), solutions: kept };
  }

  b.applyUnverified(R_SIMPLIFY,
    kept.length ? equation(X, kept[0]!) : equation(X, cst('nan')),
    'Discarding candidates outside the logarithm\'s domain narrows the answer set.',
    kept.length
      ? 'Check the answer is inside the logarithm\'s domain: the argument must be positive.'
      : 'The candidate makes the logarithm\'s argument non-positive, so there is no solution.',
    'A logarithm only accepts positive arguments.');
  return {
    derivation: b.build(),
    solutions: kept,
    ...(kept.length === 0 ? { special: 'no-solution' as const } : {}),
  };
}

function findPowerWithVariableExponent(e: Expr, variable: string): Expr | null {
  let found: Expr | null = null;
  walk(e, (n) => {
    if (!found && n.k === 'pow' && hasSymbol(n.exp, variable) && !hasSymbol(n.base, variable)) found = n;
  });
  return found;
}

function findLog(e: Expr, variable: string): Expr | null {
  let found: Expr | null = null;
  walk(e, (n) => {
    if (!found && n.k === 'fn' && (n.name === 'ln' || n.name === 'log') && hasSymbol(n, variable)) found = n;
  });
  return found;
}

/** Move everything except the power to the other side, when that is possible. */
function isolatePower(e: Expr, power: Expr): Expr | null {
  if (e.k !== 'rel') return null;
  const [lhs, rhs] = e.args;
  if (!lhs || !rhs) return null;
  // Only the shape a·b^u + c = d is handled, which covers the curriculum.
  const rest = simplify(subE(lhs, power));
  if (hasSymbol(rest, 'x') && key(rest) !== key(int(0))) {
    // A coefficient rather than an added term: a·b^u = d.
    const quotient = simplify(divE(lhs, power));
    if (quotient.k === 'num') {
      return equation(power, simplify(divE(rhs, quotient)));
    }
    return null;
  }
  return equation(power, simplify(subE(rhs, rest)));
}

