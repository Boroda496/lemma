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
  add, mul, num, int, sym, sub as subE, div as divE, rel, equation,
  key, isRelation, symbols, hasSymbol, E0,
} from './../expr.ts';
import * as R from './../rational.ts';
import { simplify } from './../canon.ts';
import { evalExact } from './../evaluate.ts';
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

  // 1. Clear brackets and collect on each side, if there is anything to do.
  const cleaned = expandBothSides(b, e);

  // 2. Read off the coefficients of (left − right).
  const [lhs, rhs] = (cleaned as Extract<Expr, { k: 'rel' }>).args;
  const diff = simplify(expand(subE(lhs!, rhs!)));
  const p = toRatPoly(diff, variable);

  if (p === null || degree(p) > 1) {
    b.stop(`This is not linear in ${variable}.`);
    return { derivation: b.build(), solutions: [] };
  }

  const a = p[1] ?? R.ZERO;   // coefficient of the variable
  const c = p[0] ?? R.ZERO;   // constant

  // Degenerate cases: the variable cancelled out entirely.
  if (R.isZero(a)) {
    if (R.isZero(c)) {
      b.apply(R_SIMPLIFY, rel(op, E0, E0),
        `Every term containing ${variable} cancels, leaving a statement that is always true.`,
        `See what happens to the ${variable} terms.`);
      return { derivation: b.build(), solutions: [], special: 'all-reals' };
    }
    b.apply(R_SIMPLIFY, rel(op, num(c), E0),
      `Every term containing ${variable} cancels, leaving ${R.toString(c)} ${op} 0, which is false.`,
      `See what happens to the ${variable} terms.`);
    return { derivation: b.build(), solutions: [], special: 'no-solution' };
  }

  // 3. Gather the variable on the left and the constants on the right.
  const rhsPoly = toRatPoly(simplify(expand(rhs!)), variable) ?? [R.ZERO];
  const rhsVarCoeff = rhsPoly[1] ?? R.ZERO;

  let current = cleaned;
  if (!R.isZero(rhsVarCoeff)) {
    const move = mul(num(rhsVarCoeff), X);
    const next = simplify(relMap(current, (side) => simplify(expand(subE(side, move)))));
    current = b.apply(
      R.isNeg(rhsVarCoeff) ? R_ADD_BOTH : R_SUB_BOTH,
      next,
      `${R.isNeg(rhsVarCoeff) ? 'Add' : 'Subtract'} ${toLatex(mul(num(R.abs(rhsVarCoeff)), X))} ` +
      `${R.isNeg(rhsVarCoeff) ? 'to' : 'from'} both sides to bring every ${variable} to the left.`,
      `The unknown appears on both sides.`,
    ).expr;
  }

  // Constant on the left moves right.
  const lhsNow = (current as Extract<Expr, { k: 'rel' }>).args[0]!;
  const lhsPoly = toRatPoly(simplify(expand(lhsNow)), variable) ?? [R.ZERO];
  const lhsConst = lhsPoly[0] ?? R.ZERO;
  if (!R.isZero(lhsConst)) {
    const next = simplify(relMap(current, (side) => simplify(expand(subE(side, num(lhsConst))))));
    current = b.apply(
      R.isNeg(lhsConst) ? R_ADD_BOTH : R_SUB_BOTH,
      next,
      `${R.isNeg(lhsConst) ? 'Add' : 'Subtract'} ${R.toString(R.abs(lhsConst))} ` +
      `${R.isNeg(lhsConst) ? 'to' : 'from'} both sides so only the ${variable} term is left.`,
      `There is a number sitting next to the ${variable} term.`,
    ).expr;
  }

  // 4. Divide by the coefficient.
  const answer = R.neg(R.div(c, a));
  if (!R.isOne(a)) {
    const finalOp = (op !== '=' && R.isNeg(a)) ? flipOp(op) : op;
    const next = rel(finalOp as never, X, num(answer));
    const flipNote = R.isNeg(a) && op !== '='
      ? ' Multiplying or dividing by a negative reverses the inequality.'
      : '';
    // A coefficient of 1/3 calls for multiplying by 3. "Divide both sides by
    // 1/3" is correct and nobody says it.
    const unitNumerator = R.abs(a).n === 1n && a.d !== 1n;
    const rule = unitNumerator ? R_MUL_BOTH : R_DIV_BOTH;
    const detail = unitNumerator
      ? `Multiply both sides by ${R.toString(R.rat(R.isNeg(a) ? -a.d : a.d))}.${flipNote}`
      : `Divide both sides by ${R.toString(a)}.${flipNote}`;
    b.apply(rule, next, detail, `The ${variable} still has a coefficient.`);
  } else {
    const next = rel(op, X, num(answer));
    b.apply(R_SIMPLIFY, next, 'Read off the answer.', 'This is nearly solved.');
  }

  const solutions = op === '=' ? [num(answer)] : [];
  return { derivation: b.build(), solutions };
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
