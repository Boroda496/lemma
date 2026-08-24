/**
 * Derivations: chains of individually verified steps.
 *
 * This is where hints come from, and the reason they cannot be wrong. A hint
 * is never generated text about what the student should do; it is a prefix of
 * a chain that the oracle has already checked. Every `step` call verifies that
 * its `from` and `to` denote the same thing (or, for equations, have the same
 * solution set) before the step exists at all. A rule with a bug throws at
 * generation time, which fails the test suite, rather than reaching a student
 * as a confidently wrong suggestion.
 *
 * The rule catalogue below carries the human-readable names and explanations,
 * so the same move is described the same way everywhere it appears.
 */

import type { Expr } from './expr.ts';
import { key, isRelation, size } from './expr.ts';
import { equivalent, equivalentRelations, type EquivResult } from './equivalence.ts';
import { simplify } from './canon.ts';
import { toLatex } from './print.ts';

export class DerivationError extends Error {
  constructor(
    message: string,
    readonly rule: string,
    readonly from: Expr,
    readonly to: Expr,
    readonly evidence: EquivResult,
  ) {
    super(message);
    this.name = 'DerivationError';
  }
}

/** How much of the answer a hint gives away. */
export enum HintLevel {
  /** Points at the right part of the expression without naming the move. */
  Nudge = 0,
  /** Names the move: "combine like terms". */
  Move = 1,
  /** Explains why the move applies, with the specific numbers involved. */
  Reason = 2,
  /** Shows the result of the next step only. */
  NextLine = 3,
  /** The whole derivation. */
  Full = 4,
}

export interface Rule {
  readonly id: string;
  /** Imperative, short: "Combine like terms". */
  readonly title: string;
  /** What the rule is, in general terms, for the concept panel. */
  readonly summary: string;
  /** The skill this move belongs to, linking a mistake back to practice. */
  readonly skill?: string;
}

export interface Step {
  readonly rule: string;
  readonly title: string;
  /** Specific to this application: "3x and 5x are both multiples of x". */
  readonly detail: string;
  /** Where to look, without saying what to do. Drives the Nudge level. */
  readonly nudge: string;
  readonly from: Expr;
  readonly to: Expr;
  /** Proof that this step preserves the answer. */
  readonly evidence: EquivResult;
}

export interface Derivation {
  /** What this derivation is for: "Solve for x". */
  readonly goal: string;
  readonly start: Expr;
  readonly steps: readonly Step[];
  readonly result: Expr;
  /** Set when the solver could not finish; the steps present are still valid. */
  readonly incomplete?: string;
}

// ------------------------------------------------------------- rule catalogue

const RULES: Record<string, Rule> = {};

export function defineRule(r: Rule): Rule {
  RULES[r.id] = r;
  return r;
}

export const getRule = (id: string): Rule | undefined => RULES[id];
export const allRules = (): Rule[] => Object.values(RULES);

// The moves an algebra student actually makes, named once so that hints,
// mistake diagnosis, and the concept panel all use the same words.
export const R_ARITHMETIC = defineRule({
  id: 'arithmetic', title: 'Do the arithmetic',
  summary: 'Evaluate the numbers that can be combined.', skill: 'arithmetic',
});
export const R_COMBINE_LIKE = defineRule({
  id: 'combine-like-terms', title: 'Combine like terms',
  summary: 'Terms with the same variable part add by adding their coefficients.',
  skill: 'like-terms',
});
export const R_DISTRIBUTE = defineRule({
  id: 'distribute', title: 'Distribute',
  summary: 'Multiply the factor across each term inside the parentheses.',
  skill: 'distributive-property',
});
export const R_FACTOR_OUT = defineRule({
  id: 'factor-out', title: 'Factor out the common factor',
  summary: 'Pull the shared factor to the front of a sum.', skill: 'factoring-gcf',
});
export const R_ADD_BOTH = defineRule({
  id: 'add-both-sides', title: 'Add to both sides',
  summary: 'Adding the same quantity to both sides keeps an equation true.',
  skill: 'linear-equations',
});
export const R_SUB_BOTH = defineRule({
  id: 'subtract-both-sides', title: 'Subtract from both sides',
  summary: 'Subtracting the same quantity from both sides keeps an equation true.',
  skill: 'linear-equations',
});
export const R_MUL_BOTH = defineRule({
  id: 'multiply-both-sides', title: 'Multiply both sides',
  summary: 'Multiplying both sides by a nonzero number keeps an equation true.',
  skill: 'linear-equations',
});
export const R_DIV_BOTH = defineRule({
  id: 'divide-both-sides', title: 'Divide both sides',
  summary: 'Dividing both sides by a nonzero number keeps an equation true.',
  skill: 'linear-equations',
});
export const R_COLLECT_VAR = defineRule({
  id: 'collect-variable', title: 'Gather the variable on one side',
  summary: 'Move every term containing the variable to the same side.',
  skill: 'linear-equations',
});
export const R_SIMPLIFY = defineRule({
  id: 'simplify', title: 'Simplify',
  summary: 'Reduce the expression to its standard form.', skill: 'simplifying',
});
export const R_ZERO_PRODUCT = defineRule({
  id: 'zero-product', title: 'Use the zero-product property',
  summary: 'If a product is zero then at least one factor is zero.',
  skill: 'zero-product-property',
});
export const R_FACTOR_QUADRATIC = defineRule({
  id: 'factor-quadratic', title: 'Factor the quadratic',
  summary: 'Write the quadratic as a product of two linear factors.',
  skill: 'factoring-quadratics',
});
export const R_QUADRATIC_FORMULA = defineRule({
  id: 'quadratic-formula', title: 'Apply the quadratic formula',
  summary: 'For ax² + bx + c = 0, x = (−b ± √(b² − 4ac)) / 2a.',
  skill: 'quadratic-formula',
});
export const R_COMPLETE_SQUARE = defineRule({
  id: 'complete-the-square', title: 'Complete the square',
  summary: 'Add the constant that turns x² + bx into a perfect square.',
  skill: 'completing-the-square',
});
export const R_STANDARD_FORM = defineRule({
  id: 'standard-form', title: 'Move everything to one side',
  summary: 'Rewrite the equation with zero on the right.', skill: 'quadratic-equations',
});
export const R_SQUARE_ROOT_BOTH = defineRule({
  id: 'square-root-both-sides', title: 'Take the square root of both sides',
  summary: 'Both the positive and negative root satisfy the equation.',
  skill: 'square-roots',
});
export const R_SUBSTITUTE = defineRule({
  id: 'substitute', title: 'Substitute',
  summary: 'Replace a variable with an equal expression.', skill: 'substitution',
});
export const R_COMMON_DENOMINATOR = defineRule({
  id: 'common-denominator', title: 'Put over a common denominator',
  summary: 'Rewrite the fractions so they share a denominator.', skill: 'fractions',
});
export const R_CANCEL = defineRule({
  id: 'cancel', title: 'Cancel the common factor',
  summary: 'A factor shared by numerator and denominator divides out.',
  skill: 'rational-expressions',
});
export const R_CROSS_MULTIPLY = defineRule({
  id: 'cross-multiply', title: 'Clear the denominators',
  summary: 'Multiply through by the denominators to remove the fractions.',
  skill: 'rational-equations',
});
export const R_POWER_RULE = defineRule({
  id: 'power-rule', title: 'Apply the power rule',
  summary: 'The derivative of xⁿ is n·xⁿ⁻¹.', skill: 'derivative-power-rule',
});
export const R_SUM_RULE = defineRule({
  id: 'sum-rule', title: 'Differentiate term by term',
  summary: 'The derivative of a sum is the sum of the derivatives.', skill: 'derivative-rules',
});
export const R_PRODUCT_RULE = defineRule({
  id: 'product-rule', title: 'Apply the product rule',
  summary: '(fg)′ = f′g + fg′.', skill: 'derivative-product-rule',
});
export const R_QUOTIENT_RULE = defineRule({
  id: 'quotient-rule', title: 'Apply the quotient rule',
  summary: '(f/g)′ = (f′g − fg′) / g².', skill: 'derivative-quotient-rule',
});
export const R_CHAIN_RULE = defineRule({
  id: 'chain-rule', title: 'Apply the chain rule',
  summary: 'The derivative of f(g(x)) is f′(g(x))·g′(x).', skill: 'derivative-chain-rule',
});
export const R_PYTHAGORAS = defineRule({
  id: 'pythagoras', title: 'Use the Pythagorean theorem',
  summary: 'In a right triangle, a² + b² = c².', skill: 'pythagorean-theorem',
});
export const R_FORMULA = defineRule({
  id: 'apply-formula', title: 'Apply the formula',
  summary: 'Substitute the known values into the relevant formula.', skill: 'formulas',
});
export const R_ISOLATE = defineRule({
  id: 'isolate', title: 'Isolate the unknown',
  summary: 'Undo the operations around the unknown, outermost first.',
  skill: 'isolating-variables',
});
export const R_LOG_BOTH = defineRule({
  id: 'log-both-sides', title: 'Take the logarithm of both sides',
  summary: 'A logarithm turns an unknown exponent into a coefficient.',
  skill: 'exponential-equations',
});
export const R_EXPONENTIATE = defineRule({
  id: 'exponentiate', title: 'Undo the logarithm',
  summary: 'Raising the base to both sides removes a logarithm.',
  skill: 'logarithmic-equations',
});
export const R_TRIG_IDENTITY = defineRule({
  id: 'trig-identity', title: 'Use a trigonometric identity',
  summary: 'Rewrite using a standard identity.', skill: 'trig-identities',
});

// ------------------------------------------------------------- step building

export interface StepInput {
  readonly rule: Rule;
  readonly from: Expr;
  readonly to: Expr;
  /** Specific explanation. Falls back to the rule summary. */
  readonly detail?: string;
  /** Where to look. Falls back to a generic prompt. */
  readonly nudge?: string;
  /**
   * Declares that this step deliberately changes the statement rather than
   * preserving it, and why. The reason is surfaced in the UI, not hidden.
   */
  readonly unverified?: string;
}

/**
 * Build a step, verifying it first.
 *
 * Expressions must denote the same value; equations must have the same
 * solutions. The one legitimate exception is a step that deliberately narrows
 * a statement -- splitting a product into cases, say -- which passes
 * `unverified` with a reason that is surfaced rather than hidden.
 */
export function step(input: StepInput): Step {
  const { rule, from, to } = input;

  let evidence: EquivResult;
  if (input.unverified) {
    evidence = { equal: true, method: 'undecided', detail: input.unverified };
  } else {
    evidence = isRelation(from) || isRelation(to)
      ? equivalentRelations(from, to)
      : equivalent(from, to);

    if (!evidence.equal) {
      throw new DerivationError(
        `Rule "${rule.id}" produced a step that changes the answer.\n` +
        `  from: ${toLatex(from)}\n` +
        `  to:   ${toLatex(to)}\n` +
        `  why:  ${evidence.detail}`,
        rule.id, from, to, evidence,
      );
    }
  }

  return {
    rule: rule.id,
    title: rule.title,
    detail: input.detail ?? rule.summary,
    nudge: input.nudge ?? 'Look at what is left to simplify.',
    from,
    to,
    evidence,
  };
}

/**
 * Accumulates steps while tracking the current expression, so a solver reads
 * as a sequence of moves rather than a pile of plumbing.
 */
export class DerivationBuilder {
  private readonly steps: Step[] = [];
  private current: Expr;
  private incompleteReason?: string;

  constructor(readonly goal: string, readonly start: Expr) {
    this.current = start;
  }

  get expr(): Expr { return this.current; }
  get length(): number { return this.steps.length; }

  /**
   * Apply a move.
   *
   * A step the reader cannot see is dropped. Structural equality is not enough
   * to catch these: subtraction is stored as multiplication by -1, so folding
   * (-1)*9 into -9 changes the tree while the printed line stays "- 9", and
   * showing it produces a step that looks like the app did nothing.
   */
  apply(rule: Rule, to: Expr, detail?: string, nudge?: string): this {
    if (key(to) === key(this.current)) return this;
    if (toLatex(to) === toLatex(this.current)) return this;
    this.steps.push(step({ rule, from: this.current, to, detail, nudge }));
    this.current = to;
    return this;
  }

  /** A step that narrows the statement rather than preserving it. */
  applyUnverified(rule: Rule, to: Expr, reason: string, detail?: string, nudge?: string): this {
    this.steps.push(step({ rule, from: this.current, to, detail, nudge, unverified: reason }));
    this.current = to;
    return this;
  }

  /** Record that the solver stopped early. The steps so far remain valid. */
  stop(reason: string): this {
    this.incompleteReason = reason;
    return this;
  }

  build(): Derivation {
    return {
      goal: this.goal,
      start: this.start,
      steps: [...this.steps],
      result: this.current,
      ...(this.incompleteReason ? { incomplete: this.incompleteReason } : {}),
    };
  }
}

// ---------------------------------------------------------------- validation

export interface ValidationProblem {
  readonly index: number;
  readonly message: string;
}

/**
 * Re-check a whole derivation independently of how it was built.
 *
 * Generators run this before a problem is ever stored, so a solver bug turns
 * into a rejected problem at build time instead of a wrong hint at practice
 * time. It re-verifies each step rather than trusting the recorded evidence.
 */
export function validateDerivation(d: Derivation): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  if (d.steps.length > 0) {
    if (key(d.steps[0]!.from) !== key(d.start)) {
      problems.push({ index: 0, message: 'The first step does not begin at the stated problem.' });
    }
    if (key(d.steps[d.steps.length - 1]!.to) !== key(d.result)) {
      problems.push({ index: d.steps.length - 1, message: 'The last step does not end at the stated result.' });
    }
  } else if (key(d.start) !== key(d.result)) {
    problems.push({ index: 0, message: 'The derivation has no steps but the result differs from the start.' });
  }

  d.steps.forEach((s, i) => {
    if (i > 0 && key(d.steps[i - 1]!.to) !== key(s.from)) {
      problems.push({ index: i, message: `Step ${i + 1} does not continue from step ${i}.` });
    }
    if (s.evidence.method === 'undecided' && s.evidence.equal) return; // declared narrowing
    const check = isRelation(s.from) || isRelation(s.to)
      ? equivalentRelations(s.from, s.to)
      : equivalent(s.from, s.to);
    if (!check.equal) {
      problems.push({ index: i, message: `Step ${i + 1} ("${s.title}") changes the answer: ${check.detail}` });
    }
  });

  return problems;
}

// --------------------------------------------------------------------- hints

export interface Hint {
  readonly level: HintLevel;
  readonly text: string;
  /** LaTeX to show alongside, when the level reveals a line. */
  readonly latex?: string;
  /** The rule being pointed at, so the app can offer "practise this". */
  readonly rule?: string;
  /** True when this is the last hint available. */
  readonly exhausted: boolean;
}

/**
 * The hint for a given level, given how far the student has already got.
 *
 * `stepsDone` is how many steps of the derivation the student's own work has
 * already covered, so hints track their actual position instead of restarting
 * from the top.
 */
export function hintAt(d: Derivation, level: HintLevel, stepsDone = 0): Hint {
  const idx = stepsDone;
  const next = idx >= 0 && idx < d.steps.length ? d.steps[idx] : undefined;

  if (!next) {
    return {
      level,
      text: d.incomplete
        ? `There is no further step to show: ${d.incomplete}`
        : 'The work is finished — this is the answer.',
      latex: toLatex(d.result),
      exhausted: true,
    };
  }

  switch (level) {
    case HintLevel.Nudge:
      return { level, text: next.nudge, rule: next.rule, exhausted: false };
    case HintLevel.Move:
      return { level, text: next.title, rule: next.rule, exhausted: false };
    case HintLevel.Reason:
      return { level, text: next.detail, rule: next.rule, exhausted: false };
    case HintLevel.NextLine:
      return {
        level, text: `${next.title}: ${next.detail}`, latex: toLatex(next.to),
        rule: next.rule, exhausted: idx >= d.steps.length - 1,
      };
    case HintLevel.Full:
    default:
      return {
        level: HintLevel.Full,
        text: 'Here is the whole derivation.',
        latex: toLatex(d.result),
        rule: next.rule,
        exhausted: true,
      };
  }
}

/**
 * How far into the derivation a student's current line has got.
 *
 * Equations need a different test from expressions, and the reason is worth
 * spelling out: solving an equation preserves its solution set, so every line
 * of a correct derivation is *equivalent* to every other one. Asking the
 * oracle "is this line equivalent to step 3" answers yes for the original
 * problem statement too, and the student gets credit for having written
 * nothing down. So for a relation, progress is measured by the shape of the
 * two sides, tolerating a swap (15 = 3x is the same line as 3x = 15) but not
 * a rescaling, which is a different line.
 *
 * Expressions are the opposite case: there the value is what is preserved and
 * the shape is what changes, so equivalence plus a size check is exactly right.
 */
export function progressOf(d: Derivation, studentLine: Expr): number {
  for (let i = d.steps.length - 1; i >= 0; i--) {
    if (linesMatch(d.steps[i]!.to, studentLine)) return i + 1;
  }
  return 0;
}

function linesMatch(target: Expr, line: Expr): boolean {
  if (isRelation(target) && isRelation(line)) {
    if (target.op !== line.op && flipRel(target.op) !== line.op) return false;
    const [tl, tr] = [simplify(target.args[0]!), simplify(target.args[1]!)];
    const [sl, sr] = [simplify(line.args[0]!), simplify(line.args[1]!)];
    const straight = key(tl) === key(sl) && key(tr) === key(sr);
    const swapped = key(tl) === key(sr) && key(tr) === key(sl);
    return straight || swapped;
  }
  if (isRelation(target) !== isRelation(line)) return false;
  const same = equivalent(target, line);
  // Equivalent but messier means the simplifying move has not been made yet.
  return same.equal && size(line) <= size(target) + 2;
}

const flipRel = (op: string): string =>
  ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' } as Record<string, string>)[op] ?? op;

/** A flat, readable transcript. Used by the solution view and by tests. */
export function transcript(d: Derivation): string {
  const lines = [`${d.goal}:  ${toLatex(d.start)}`];
  d.steps.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s.title} — ${s.detail}`);
    lines.push(`     ${toLatex(s.to)}`);
  });
  if (d.incomplete) lines.push(`  (stopped: ${d.incomplete})`);
  return lines.join('\n');
}
