/**
 * Linear equations and inequalities, solved the way they are taught: undo the
 * operations around the unknown, one side at a time, showing each move.
 *
 * The solver works from the polynomial coefficients rather than by pattern
 * matching on the tree, so 3(x−2) = 5x + 1 and −2x − 6 − 1 = 0 take the same
 * path. The steps it reports are the moves a person makes; the coefficients
 * are only how it decides which move comes next.
 */

import type { Expr } from './../expr.ts';
import {
  add, mul, num, int, sym, sub as subE, div, neg, rel, equation,
  key, isRelation, symbols, isZeroE, isOneE, splitCoeff, hasSymbol, E0,
} from './../expr.ts';
import * as R from './../rational.ts';
import { simplify, simplifyBest } from './../canon.ts';
import { evalExact } from './../evaluate.ts';
import { isZeroExpr } from './../equivalence.ts';
import { expand, toRatPoly, toExprPoly, degree } from './../polynomial.ts';
import { toLatex } from './../print.ts';
import {
  DerivationBuilder, type Derivation,
  R_SIMPLIFY, R_DISTRIBUTE, R_ADD_BOTH, R_SUB_BOTH, R_MUL_BOTH, R_DIV_BOTH, R_COLLECT_VAR, R_SUBSTITUTE,
} from './../derive.ts';

const R_SUBSTITUTE_LOCAL = R_SUBSTITUTE;
import { simplifyDerivation } from './steps.ts';

export interface SolveResult {
  readonly derivation: Derivation;
  /** The solutions found. Empty means no solution; see `special`. */
  readonly solutions: Expr[];
  /** Set when the equation is an identity or a contradiction. */
  readonly special?: 'all-reals' | 'no-solution';
}

const flipOp = (op: string): string =>
  ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' } as Record<string, string>)[op] ?? op;

/** Is this a linear equation or inequality in `v`? */
export function isLinearIn(e: Expr, v: string): boolean {
  if (!isRelation(e)) return false;
  const diff = subE(e.args[0]!, e.args[1]!);
  const p = toRatPoly(diff, v);
  return p !== null && degree(p) === 1;
}

/**
 * Solve a linear relation for `v`.
 *
 * Steps are emitted only when they do something: an equation already in the
 * form 2x = 6 goes straight to the division, with no ceremonial "simplify
 * both sides" line first.
 */
export function solveLinear(e: Expr, v?: string): SolveResult {
  if (!isRelation(e)) throw new Error('solveLinear needs an equation or inequality.');
  const variable = v ?? symbols(e)[0];
  if (!variable) throw new Error('There is no variable to solve for.');

  const op = e.op;
  const goal = op === '=' ? `Solve for ${variable}` : `Solve the inequality for ${variable}`;
  const b = new DerivationBuilder(goal, e);
  const X = sym(variable);

  // 0. Work on whichever side already holds the unknown.
  //
  // Without this, "P = 2l + 2w" solved for l drags the 2l leftward and then
  // divides by -2, which is correct and is not what anyone writes. Swapping
  // first keeps the coefficient positive and the working short.
  const oriented = orientForVariable(b, e, variable);

  // 1. Clear brackets and collect on each side, if there is anything to do.
  const cleaned = expandBothSides(b, oriented);

  // 2. Read off the coefficients of (left - right).
  //
  // Coefficients are expressions, not numbers, because "solve A = lw for w" is
  // the same problem as "solve 12 = 3w for w" and should take the same path.
  // The only difference is that the answer contains letters.
  const [lhs, rhs] = (cleaned as Extract<Expr, { k: 'rel' }>).args;
  const diff = simplify(expand(subE(lhs!, rhs!)));
  const p = toExprPoly(diff, variable);

  if (p === null || p.length - 1 > 1) {
    b.stop(`This is not linear in ${variable}.`);
    return { derivation: b.build(), solutions: [] };
  }

  const a = simplify(p[1] ?? E0);   // coefficient of the variable
  const c = simplify(p[0] ?? E0);   // everything else

  // Degenerate cases: the variable cancelled out entirely.
  if (isZeroE(a)) {
    if (isZeroExpr(c)) {
      b.apply(R_SIMPLIFY, rel(op, E0, E0),
        `Every term containing ${variable} cancels, leaving a statement that is always true.`,
        `See what happens to the ${variable} terms.`);
      return { derivation: b.build(), solutions: [], special: 'all-reals' };
    }
    b.apply(R_SIMPLIFY, rel(op, c, E0),
      `Every term containing ${variable} cancels, leaving ${toLatex(c)} ${op} 0, which cannot hold.`,
      `See what happens to the ${variable} terms.`);
    return { derivation: b.build(), solutions: [], special: 'no-solution' };
  }

  // 3. Gather the variable on the left and everything else on the right.
  const rhsPoly = toExprPoly(simplify(expand(rhs!)), variable) ?? [E0];
  const rhsVarCoeff = simplify(rhsPoly[1] ?? E0);

  let current = cleaned;
  if (!isZeroE(rhsVarCoeff)) {
    const move = mul(rhsVarCoeff, X);
    const next = simplify(relMap(current, (side) => simplify(expand(subE(side, move)))));
    const negated = isNegativeLead(rhsVarCoeff);
    current = b.apply(
      negated ? R_ADD_BOTH : R_SUB_BOTH,
      next,
      `${negated ? 'Add' : 'Subtract'} ${toLatex(mul(absLead(rhsVarCoeff), X))} ` +
      `${negated ? 'to' : 'from'} both sides to bring every ${variable} to the left.`,
      'The unknown appears on both sides.',
    ).expr;
  }

  // Anything on the left without the variable moves right.
  const lhsNow = (current as Extract<Expr, { k: 'rel' }>).args[0]!;
  const lhsPoly = toExprPoly(simplify(expand(lhsNow)), variable) ?? [E0];
  const lhsConst = simplify(lhsPoly[0] ?? E0);
  if (!isZeroE(lhsConst)) {
    const next = simplify(relMap(current, (side) => simplify(expand(subE(side, lhsConst)))));
    const negated = isNegativeLead(lhsConst);
    current = b.apply(
      negated ? R_ADD_BOTH : R_SUB_BOTH,
      next,
      `${negated ? 'Add' : 'Subtract'} ${toLatex(absLead(lhsConst))} ` +
      `${negated ? 'to' : 'from'} both sides so only the ${variable} term is left.`,
      `There is something other than ${variable} on that side.`,
    ).expr;
  }

  // 4. Divide by the coefficient.
  //
  // With numeric coefficients the answer is a number and the usual
  // presentation search applies. With symbolic ones the answer is a fraction,
  // and that search pulls it apart: (P - 2w)/2 scores as two smaller pieces
  // and comes back as -w + P/2, which is the same value written worse.
  const bothNumeric = a.k === 'num' && c.k === 'num';
  const answer = bothNumeric
    ? simplifyBest(neg(div(c, a)))
    : simplify(div(simplify(neg(c)), a));
  if (!isOneE(a)) {
    const numericA = a.k === 'num' ? a.v : null;
    const negativeCoeff = numericA ? R.isNeg(numericA) : isNegativeLead(a);
    const finalOp = (op !== '=' && negativeCoeff) ? flipOp(op) : op;
    const next = rel(finalOp as never, X, answer);

    const flipNote = negativeCoeff && op !== '='
      ? ' Multiplying or dividing by a negative reverses the inequality.'
      : '';
    // A coefficient of 1/3 calls for multiplying by 3. "Divide both sides by
    // 1/3" is correct and nobody says it.
    const unitNumerator = numericA !== null && R.abs(numericA).n === 1n && numericA.d !== 1n;
    const rule = unitNumerator ? R_MUL_BOTH : R_DIV_BOTH;
    const detail = unitNumerator && numericA
      ? `Multiply both sides by ${R.toString(R.rat(R.isNeg(numericA) ? -numericA.d : numericA.d))}.${flipNote}`
      : `Divide both sides by ${toLatex(a)}.${flipNote}` +
        (numericA === null ? ` This assumes ${toLatex(a)} is not zero.` : '');

    if (numericA === null) {
      // Dividing by a symbolic coefficient is not an equivalence and the
      // oracle is right to reject it: A = lw and w = A/l disagree when l is
      // zero, where the first is satisfied by every w and the second is
      // undefined. The division is still the correct move, so it is recorded
      // as a declared narrowing with the assumption stated rather than
      // asserted as an equivalence that does not hold.
      b.applyUnverified(rule, next,
        `Dividing by ${toLatex(a)} assumes it is not zero, which excludes a case the original allowed.`,
        detail, `The ${variable} still has a coefficient.`);
    } else {
      b.apply(rule, next, detail, `The ${variable} still has a coefficient.`);
    }
  } else {
    b.apply(R_SIMPLIFY, rel(op, X, answer), 'Read off the answer.', 'This is nearly solved.');
  }

  const solutions = op === '=' ? [answer] : [];
  return { derivation: b.build(), solutions };
}

/** True when the two expressions are the same terms in a different order. */
function onlyReorders(from: Expr, to: Expr): boolean {
  if (from.k !== 'add' || to.k !== 'add') return false;
  if (from.args.length !== to.args.length) return false;
  const a = from.args.map(key).sort().join('|');
  const b = to.args.map(key).sort().join('|');
  return a === b;
}

/**
 * Put the side that carries the unknown on the left, swapping if the left has
 * none of it and the right does. Swapping the two sides of an inequality
 * reverses its direction; for an equation it changes nothing.
 */
function orientForVariable(b: DerivationBuilder, e: Expr, variable: string): Expr {
  if (e.k !== 'rel') return e;
  const [lhs, rhs] = e.args;
  if (!lhs || !rhs) return e;
  const leftHas = hasSymbol(lhs, variable);
  const rightHas = hasSymbol(rhs, variable);
  if (leftHas || !rightHas) return e;

  const swappedOp = (({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' } as Record<string, string>)[e.op] ?? e.op);
  const swapped = rel(swappedOp as never, rhs, lhs);
  b.apply(R_SIMPLIFY, swapped,
    `Write the side containing ${variable} on the left. ` +
    (e.op === '=' ? 'An equation reads the same either way.' : 'Swapping the sides reverses the inequality.'),
    `Which side is ${variable} on?`);
  return swapped;
}

/** Does this expression print with a leading minus? Drives "add" versus "subtract". */
function isNegativeLead(e: Expr): boolean {
  if (e.k === 'num') return R.isNeg(e.v);
  const [coeff] = splitCoeff(e);
  return R.isNeg(coeff);
}

/** The same expression with any leading minus removed, for phrasing. */
function absLead(e: Expr): Expr {
  if (e.k === 'num') return num(R.abs(e.v));
  const [coeff, body] = splitCoeff(e);
  if (!R.isNeg(coeff)) return e;
  return simplify(mul(num(R.neg(coeff)), body));
}

/** Apply a function to both sides of a relation. */
function relMap(e: Expr, f: (side: Expr) => Expr): Expr {
  if (e.k !== 'rel') return e;
  return rel(e.op, ...e.args.map(f));
}

/**
 * Clear brackets and collect like terms on each side, emitting the same
 * moves the expression simplifier would, so the equation work reads
 * continuously rather than jumping to a tidied form.
 */
function expandBothSides(b: DerivationBuilder, e: Expr): Expr {
  if (e.k !== 'rel') return e;
  let current: Extract<Expr, { k: 'rel' }> = e;

  for (let side = 0; side < 2; side++) {
    const d = simplifyDerivation(current.args[side]!);
    for (const s of d.steps) {
      const args = [...current.args];
      args[side] = s.to;
      const rebuilt = rel(current.op, ...args) as Extract<Expr, { k: 'rel' }>;
      if (key(rebuilt) === key(current)) continue;
      // Reordering terms is not a move worth a line of working.
      if (onlyReorders(s.from, s.to)) { current = rebuilt; continue; }
      b.apply(s.rule === 'distribute' ? R_DISTRIBUTE : R_SIMPLIFY, rebuilt, s.detail, s.nudge);
      current = rebuilt;
    }
  }
  return current;
}

/**
 * Solve a two-variable linear system by elimination.
 * Elimination rather than substitution because it generalises and because the
 * arithmetic stays in whole numbers more often, which is easier to follow.
 */
export function solveLinearSystem(
  eqs: readonly Expr[],
  vars: readonly string[],
): { derivation: Derivation; solutions: Record<string, Expr> | null; special?: 'no-solution' | 'infinite' } {
  if (eqs.length !== 2 || vars.length !== 2) {
    throw new Error('solveLinearSystem handles two equations in two unknowns.');
  }
  const [vx, vy] = vars as [string, string];
  const start: Expr = { k: 'and', args: [...eqs] };
  const b = new DerivationBuilder(`Solve for ${vx} and ${vy}`, start);

  // Read each equation as ax + by = c.
  //
  // Rather than pick the tree apart, evaluate the difference of the two sides
  // at three points. For an expression that is linear in x and y this recovers
  // the coefficients exactly: the value at the origin is the constant, and
  // each unit step gives the corresponding coefficient.
  const rows: Array<{ a: R.Rat; b: R.Rat; c: R.Rat }> = [];
  for (const eq of eqs) {
    if (eq.k !== 'rel') throw new Error('Each entry must be an equation.');
    const diff = simplify(expand(subE(eq.args[0]!, eq.args[1]!)));
    // Degree check only. toRatPoly would fail here for a legitimate system:
    // read as a polynomial in y, the coefficient of y^0 in 2x + 3y - 12 is
    // "2x - 12", which is not a number. toExprPoly keeps such coefficients as
    // expressions, which is all the degree check needs.
    for (const v of [vx, vy]) {
      const p = toExprPoly(diff, v);
      if (!p || p.length - 1 > 1) throw new Error('The system is not linear.');
    }
    const at = (x: R.Rat, y: R.Rat): R.Rat => {
      const val = evalExact(diff, { [vx]: x, [vy]: y });
      if (val === null) throw new Error('The system has coefficients I cannot evaluate exactly.');
      return val;
    };
    const origin = at(R.ZERO, R.ZERO);
    rows.push({
      a: R.sub(at(R.ONE, R.ZERO), origin),
      b: R.sub(at(R.ZERO, R.ONE), origin),
      c: R.neg(origin),
    });
  }

  const [r1, r2] = rows as [typeof rows[0], typeof rows[0]];
  const det = R.sub(R.mul(r1.a, r2.b), R.mul(r2.a, r1.b));

  if (R.isZero(det)) {
    const proportional = R.isZero(R.sub(R.mul(r1.a, r2.c), R.mul(r2.a, r1.c)))
      && R.isZero(R.sub(R.mul(r1.b, r2.c), R.mul(r2.b, r1.c)));
    b.stop(proportional
      ? 'The two equations describe the same line, so every point on it is a solution.'
      : 'The two lines are parallel, so there is no point on both.');
    return {
      derivation: b.build(),
      solutions: null,
      special: proportional ? 'infinite' : 'no-solution',
    };
  }

  // Eliminate y by scaling each equation so the y coefficients match.
  const scale1 = r2.b;
  const scale2 = r1.b;
  const combinedA = R.sub(R.mul(r1.a, scale1), R.mul(r2.a, scale2));
  const combinedC = R.sub(R.mul(r1.c, scale1), R.mul(r2.c, scale2));

  const eliminated = equation(mul(num(combinedA), sym(vx)), num(combinedC));
  b.applyUnverified(
    R_COLLECT_VAR,
    eliminated,
    'Combining two equations produces a consequence of the pair, not a restatement of either one.',
    `Multiply the first equation by ${R.toString(scale1)} and the second by ${R.toString(scale2)} ` +
    `so the ${vy} terms match, then subtract to remove ${vy}.`,
    `The two equations can be combined to remove one unknown.`,
  );

  const xVal = R.div(combinedC, combinedA);
  b.apply(R_DIV_BOTH, equation(sym(vx), num(xVal)),
    `Divide both sides by ${R.toString(combinedA)}.`, `Only ${vx} is left.`);

  // Back-substitute for y.
  const yVal = R.isZero(r1.b)
    ? R.div(R.sub(r2.c, R.mul(r2.a, xVal)), r2.b)
    : R.div(R.sub(r1.c, R.mul(r1.a, xVal)), r1.b);

  b.applyUnverified(
    R_SUBSTITUTE_LOCAL,
    { k: 'and', args: [equation(sym(vx), num(xVal)), equation(sym(vy), num(yVal))] },
    'Back-substitution adds the second coordinate, which the previous line did not mention.',
    `Put ${vx} = ${R.toString(xVal)} back into one of the original equations and solve for ${vy}.`,
    `Now that ${vx} is known, one of the originals gives ${vy}.`,
  );

  return {
    derivation: b.build(),
    solutions: { [vx]: num(xVal), [vy]: num(yVal) },
  };
}
