/**
 * Step-by-step simplification of an expression.
 *
 * The engine can simplify an expression in one call, but a student needs to
 * see the moves. So instead of calling `simplify`, this walks the tree looking
 * for the *first* place a named move applies, performs only that move, and
 * records it. Repeating that gives a derivation whose lines look like the
 * lines a person writes.
 *
 * The order below is the order a person works in: brackets first, then like
 * terms, then the remaining arithmetic.
 */

import type { Expr } from './../expr.ts';
import {
  add, mul, pow, num, int, E1, key, children, withChildren, terms, factors,
  splitCoeff, splitPow, isOneE, isZeroE, size,
} from './../expr.ts';
import * as R from './../rational.ts';
import { simplify } from './../canon.ts';
import { expand } from './../polynomial.ts';
import { toLatex } from './../print.ts';
import {
  DerivationBuilder, type Derivation,
  R_ARITHMETIC, R_COMBINE_LIKE, R_DISTRIBUTE, R_SIMPLIFY,
} from './../derive.ts';

/** A single located move: what to replace, with what, and how to describe it. */
interface Move {
  readonly rule: typeof R_ARITHMETIC;
  readonly replaced: Expr;
  readonly replacement: Expr;
  readonly detail: string;
  readonly nudge: string;
}

/** Rewrite the first subtree matching `target`, bottom-up so the deepest wins. */
function replaceFirst(root: Expr, target: Expr, replacement: Expr): Expr {
  const targetKey = key(target);
  let done = false;
  const go = (n: Expr): Expr => {
    if (done) return n;
    if (key(n) === targetKey) { done = true; return replacement; }
    const kids = children(n);
    if (kids.length === 0) return n;
    let changed = false;
    const next = kids.map((c) => {
      const r = go(c);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? withChildren(n, next) : n;
  };
  return go(root);
}

/** Depth-first search for the first node where `find` yields a move. */
function firstMove(root: Expr, find: (n: Expr) => Move | null): Move | null {
  for (const c of children(root)) {
    const inner = firstMove(c, find);
    if (inner) return inner;
  }
  return find(root);
}

// ------------------------------------------------------------------- the moves

/** 2·(x + 3) → 2·x + 2·3 */
function findDistribute(n: Expr): Move | null {
  if (n.k !== 'mul') return null;
  const fs = factors(n);
  const sumIdx = fs.findIndex((f) => f.k === 'add');
  if (sumIdx === -1) return null;
  const sum = fs[sumIdx]!;
  if (sum.k !== 'add') return null;
  const rest = fs.filter((_, i) => i !== sumIdx);
  if (rest.length === 0) return null;
  const multiplier = rest.length === 1 ? rest[0]! : mul(...rest);
  const distributed = add(...sum.args.map((t) => mul(multiplier, t)));
  return {
    rule: R_DISTRIBUTE,
    replaced: n,
    replacement: distributed,
    detail:
      `Multiply ${toLatex(multiplier)} by each of the ${sum.args.length} terms inside the brackets.`,
    nudge: 'There are brackets that can be opened up.',
  };
}

/** (x + 2)² → (x + 2)(x + 2), so the distribution step has something to chew on. */
function findExpandPower(n: Expr): Move | null {
  if (n.k !== 'pow') return null;
  if (n.base.k !== 'add') return null;
  if (n.exp.k !== 'num' || n.exp.v.d !== 1n) return null;
  const e = n.exp.v.n;
  if (e < 2n || e > 6n) return null;
  const copies = Array.from({ length: Number(e) }, () => n.base);
  return {
    rule: R_DISTRIBUTE,
    replaced: n,
    replacement: mul(...copies),
    detail: `A power of a sum means repeated multiplication: write it out as ${e} factors.`,
    nudge: 'A bracket is being raised to a power.',
  };
}

/** 3x + 5x → 8x */
function findCombineLike(n: Expr): Move | null {
  if (n.k !== 'add') return null;
  const ts = terms(n);
  // Group by the non-numeric part; the first group with two members is the move.
  const groups = new Map<string, { body: Expr; idx: number[]; coeffs: R.Rat[] }>();
  ts.forEach((t, i) => {
    if (t.k === 'num') return;
    const [c, body] = splitCoeff(t);
    if (isOneE(body)) return;
    const k = key(body);
    const g = groups.get(k);
    if (g) { g.idx.push(i); g.coeffs.push(c); }
    else groups.set(k, { body, idx: [i], coeffs: [c] });
  });

  for (const g of groups.values()) {
    if (g.idx.length < 2) continue;
    const total = g.coeffs.reduce((a, b) => R.add(a, b), R.ZERO);
    const combined = R.isZero(total) ? null : R.isOne(total) ? g.body : mul(num(total), g.body);
    const keep = ts.filter((_, i) => !g.idx.includes(i));
    const nextTerms = combined ? [combined, ...keep] : keep;
    const replacement = nextTerms.length === 0 ? int(0) : nextTerms.length === 1 ? nextTerms[0]! : add(...nextTerms);
    const shown = g.coeffs.map((c) => R.toString(c)).join(' and ');
    return {
      rule: R_COMBINE_LIKE,
      replaced: n,
      replacement,
      detail: R.isZero(total)
        ? `The coefficients ${shown} of ${toLatex(g.body)} cancel, so those terms vanish.`
        : `${toLatex(g.body)} appears with coefficients ${shown}, which total ${R.toString(total)}.`,
      nudge: `More than one term contains ${toLatex(g.body)}.`,
    };
  }
  return null;
}

/** 2 + 3 → 5, and 2·3 → 6 */
function findArithmetic(n: Expr): Move | null {
  if (n.k === 'add') {
    const nums = terms(n).filter((t) => t.k === 'num');
    if (nums.length < 2) return null;
    const total = nums.reduce((acc, t) => R.add(acc, (t as { v: R.Rat }).v), R.ZERO);
    const keep = terms(n).filter((t) => t.k !== 'num');
    const nextTerms = R.isZero(total) && keep.length > 0 ? keep : [...keep, num(total)];
    const replacement = nextTerms.length === 1 ? nextTerms[0]! : add(...nextTerms);
    return {
      rule: R_ARITHMETIC,
      replaced: n,
      replacement,
      detail: `${nums.map((t) => R.toString((t as { v: R.Rat }).v)).join(' + ')} = ${R.toString(total)}.`,
      nudge: 'There are numbers here that can be added.',
    };
  }
  if (n.k === 'mul') {
    const fs = factors(n);
    const nums = fs.filter((f) => f.k === 'num');
    // (-1) * n is the internal spelling of a negative number, not a
    // multiplication the student wrote. Folding it is invisible work.
    const isStoredNegative = fs.length === 2 && nums.length === 2
      && fs.some((f) => f.k === 'num' && f.v.n === -1n && f.v.d === 1n);
    if (nums.length >= 2 && !isStoredNegative) {
      const total = nums.reduce((acc, f) => R.mul(acc, (f as { v: R.Rat }).v), R.ONE);
      const keep = fs.filter((f) => f.k !== 'num');
      const nextFactors = R.isOne(total) && keep.length > 0 ? keep : [num(total), ...keep];
      const replacement = nextFactors.length === 1 ? nextFactors[0]! : mul(...nextFactors);
      return {
        rule: R_ARITHMETIC,
        replaced: n,
        replacement,
        detail: `${nums.map((f) => R.toString((f as { v: R.Rat }).v)).join(' \u00d7 ')} = ${R.toString(total)}.`,
        nudge: 'There are numbers here that can be multiplied.',
      };
    }
    // No numbers to fold, but repeated bases still combine: x*x -> x^2.
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const [b1, e1] = splitPow(fs[i]!);
        const [b2, e2] = splitPow(fs[j]!);
        if (key(b1) !== key(b2) || b1.k === 'num') continue;
        const merged = pow(b1, simplify(add(e1, e2)));
        const keep = fs.filter((_, k) => k !== i && k !== j);
        const replacement = keep.length === 0 ? merged : mul(merged, ...keep);
        return {
          rule: R_ARITHMETIC,
          replaced: n,
          replacement,
          detail: `Multiplying powers of ${toLatex(b1)} adds the exponents.`,
          nudge: `${toLatex(b1)} appears as a factor more than once.`,
        };
      }
    }
    return null;
  }
  if (n.k === 'pow' && n.base.k === 'num' && n.exp.k === 'num' && R.isInt(n.exp.v)
      && R.abs(n.exp.v).n <= 20n && !R.isNeg(n.exp.v)) {
    const v = R.powInt(n.base.v, n.exp.v.n);
    return {
      rule: R_ARITHMETIC,
      replaced: n,
      replacement: num(v),
      detail: `${R.toString(n.base.v)} to the power ${R.toString(n.exp.v)} is ${R.toString(v)}.`,
      nudge: 'A number is raised to a power.',
    };
  }
  return null;
}

const MOVE_FINDERS = [findExpandPower, findDistribute, findCombineLike, findArithmetic];

/**
 * Simplify `e`, showing the work.
 *
 * Each pass takes the highest-priority move available anywhere in the tree,
 * so brackets are cleared before like terms are gathered, matching the order
 * a person would work in.
 */
export function simplifyDerivation(e: Expr, goal = 'Simplify'): Derivation {
  const b = new DerivationBuilder(goal, e);
  const seen = new Set<string>([key(e)]);

  for (let guard = 0; guard < 80; guard++) {
    let move: Move | null = null;
    for (const finder of MOVE_FINDERS) {
      move = firstMove(b.expr, finder);
      if (move) break;
    }
    if (!move) break;

    const next = replaceFirst(b.expr, move.replaced, move.replacement);
    if (key(next) === key(b.expr) || seen.has(key(next))) break; // no progress
    seen.add(key(next));
    b.apply(move.rule, next, move.detail, move.nudge);
  }

  // A final tidy, in case ordering or a fold was left over.
  const tidy = simplify(b.expr);
  if (key(tidy) !== key(b.expr) && size(tidy) <= size(b.expr)) {
    b.apply(R_SIMPLIFY, tidy, 'Write the result in standard form.', 'Tidy up what is left.');
  }
  return b.build();
}

/** Expand a product, showing the work. */
export function expandDerivation(e: Expr): Derivation {
  const d = simplifyDerivation(e, 'Expand');
  if (d.steps.length > 0) return d;
  // Nothing to distribute: state the expanded form directly.
  const b = new DerivationBuilder('Expand', e);
  const target = simplify(expand(e));
  if (key(target) !== key(e)) {
    b.apply(R_SIMPLIFY, target, 'Multiply out and collect the terms.', 'Look for brackets to open.');
  }
  return b.build();
}
