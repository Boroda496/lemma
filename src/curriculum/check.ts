/**
 * Grading an answer.
 *
 * Every verdict here comes from the oracle, and every verdict carries the
 * oracle's own account of how it decided, which the app can show. Nothing is
 * graded by string comparison, so a student who writes 1/2 where the answer
 * is 0.5, or x+1 where the answer is 1+x, is right, and told why.
 */

import type { Expr } from './../engine/expr.ts';
import { isRelation, symbols, sub as subExpr, subst as substExpr } from './../engine/expr.ts';
import { equivalent, equivalentSets } from './../engine/equivalence.ts';
import { validateDerivation } from './../engine/derive.ts';
import { simplifyBest, isSimplified } from './../engine/canon.ts';
import { toLatex } from './../engine/print.ts';
import { parseAnswer, ParseError } from './../engine/parse.ts';
import type { AnswerSpec, Distractor, Problem, Verdict } from './types.ts';

/** Grade raw input text against a problem. */
export function checkInput(problem: Problem, input: string): Verdict {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { correct: false, message: 'Nothing entered yet.' };
  }

  // The special answers are words, not expressions.
  const special = matchSpecialWords(trimmed);
  if (problem.answer.kind === 'special') {
    if (special === problem.answer.value) {
      return { correct: true, message: correctMessage(problem.answer) };
    }
    if (special) {
      return {
        correct: false,
        message: problem.answer.value === 'no-solution'
          ? 'Not quite — check what happens to the variable terms. There is no value that works here.'
          : 'Not quite — every value works here, so the equation is an identity.',
      };
    }
  }
  if (special && problem.answer.kind !== 'special') {
    return {
      correct: false,
      message: special === 'no-solution'
        ? 'There is a solution to find here.'
        : 'This equation does not hold for every value.',
    };
  }

  if (problem.answer.kind === 'choice') {
    const idx = problem.answer.options.findIndex(
      (o) => o.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (idx === -1) return { correct: false, message: 'Pick one of the options.' };
    return idx === problem.answer.correct
      ? { correct: true, message: 'Correct.' }
      : { correct: false, message: 'Not that one.' };
  }

  let parsed: Expr[];
  try {
    parsed = parseAnswer(trimmed);
  } catch (err) {
    const msg = err instanceof ParseError ? err.message : 'I could not read that.';
    return { correct: false, message: `${msg} Check the brackets and symbols.` };
  }

  return checkParsed(problem, parsed);
}

/** Grade an already-parsed answer. */
export function checkParsed(problem: Problem, given: readonly Expr[]): Verdict {
  const spec = problem.answer;

  switch (spec.kind) {
    case 'expression':
    case 'simplified':
    case 'number': {
      if (given.length !== 1) {
        return { correct: false, message: `This problem wants a single value, not ${given.length}.` };
      }
      const student = given[0]!;
      const result = equivalent(student, spec.value);
      if (!result.equal) {
        const d = diagnose(problem, student);
        return {
          correct: false,
          message: d ? d.diagnosis : 'Not equal to the correct answer.',
          evidence: result,
          ...(d?.reviewSkill ? { reviewSkill: d.reviewSkill } : {}),
          ...(d ? { diagnosis: d.diagnosis } : {}),
        };
      }
      // Right value. For a "simplify" problem the form matters too.
      if (spec.kind === 'simplified' && !isSimplified(student)) {
        return {
          correct: false,
          needsSimplifying: true,
          message: `That is equal to the answer, but not yet in simplest form. Keep going — try ${toLatex(simplifyBest(student))}.`,
          evidence: result,
        };
      }
      return { correct: true, message: correctMessage(spec), evidence: result };
    }

    case 'set': {
      const result = equivalentSets(spec.values, given);
      if (result.equal) return { correct: true, message: correctMessage(spec), evidence: result };

      // Partial credit is informative even when the verdict is "not yet".
      const found = given.filter((g) => spec.values.some((v) => equivalent(g, v).equal)).length;
      const extra = given.length - found;
      const missing = spec.values.length - found;
      const parts: string[] = [];
      if (found > 0) parts.push(`${found} of the ${spec.values.length} correct`);
      if (missing > 0) parts.push(`${missing} still to find`);
      if (extra > 0) parts.push(`${extra} that ${extra === 1 ? 'does' : 'do'} not satisfy the equation`);
      const d = given.length === 1 ? diagnose(problem, given[0]!) : null;
      return {
        correct: false,
        message: d ? d.diagnosis : parts.length ? `You have ${parts.join(', ')}.` : 'Not the right values.',
        evidence: result,
        ...(d?.reviewSkill ? { reviewSkill: d.reviewSkill } : {}),
      };
    }

    case 'tuple': {
      if (given.length !== spec.values.length) {
        const want = spec.labels?.join(', ') ?? `${spec.values.length} values`;
        return { correct: false, message: `This wants ${want}.` };
      }
      for (let i = 0; i < spec.values.length; i++) {
        const r = equivalent(given[i]!, spec.values[i]!);
        if (!r.equal) {
          const label = spec.labels?.[i] ?? `value ${i + 1}`;
          return { correct: false, message: `The ${label} is not right.`, evidence: r };
        }
      }
      return { correct: true, message: correctMessage(spec) };
    }

    case 'special':
      return {
        correct: false,
        message: spec.value === 'no-solution'
          ? 'There is no value that satisfies this — say so rather than giving a number.'
          : 'Every value satisfies this — say so rather than giving a number.',
      };

    case 'choice':
      // Multiple choice is answered by selection, not by typing math.
      return { correct: false, message: 'Choose one of the options above.' };
  }
}

/** "no solution" / "all reals", in the several ways a student writes them. */
function matchSpecialWords(s: string): 'no-solution' | 'all-reals' | null {
  const t = s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/(no solution|none|empty|no answer|nothing|impossible|no real solution)/.test(t)) return 'no-solution';
  if (/(all reals|all real numbers|any value|every value|all values|infinite|identity|always true)/.test(t)) {
    return 'all-reals';
  }
  return null;
}

/** Does the student's answer match a misconception this problem anticipates? */
function diagnose(problem: Problem, student: Expr): Distractor | null {
  for (const d of problem.distractors ?? []) {
    if (typeof d.value === 'string') continue;
    if (equivalent(student, d.value).equal) return d;
  }
  return null;
}

function correctMessage(spec: AnswerSpec): string {
  switch (spec.kind) {
    case 'set': return spec.values.length > 1 ? 'Both roots, correct.' : 'Correct.';
    case 'special': return 'Correct — and spotting that is the whole problem.';
    default: return 'Correct.';
  }
}

/**
 * Is the student's entry a legitimate intermediate line rather than a final
 * answer? Used to keep the input field encouraging instead of marking honest
 * work in progress as wrong.
 */
export function looksLikeWorkInProgress(problem: Problem, input: string): boolean {
  try {
    const parsed = parseAnswer(input);
    if (parsed.length !== 1) return false;
    const e = parsed[0]!;
    // An equation entered where a value was asked for is almost always working.
    if (isRelation(e) && problem.answer.kind !== 'special') return true;
    // Still contains the unknown when the answer should not.
    if (problem.variable && symbols(e).includes(problem.variable)) {
      const spec = problem.answer;
      const answerHasVar = spec.kind === 'expression' || spec.kind === 'simplified'
        ? symbols(spec.value).includes(problem.variable)
        : false;
      return !answerHasVar;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Verify a problem before it is ever shown.
 *
 * The generator pipeline calls this on everything it produces. It trusts
 * nothing the generator claimed: the derivation must validate step by step,
 * and the stated answer must be consistent with the derivation's own result.
 * A problem that fails is discarded and a new seed is tried, so a generator
 * bug shows up as a slightly slower queue rather than as a wrong problem.
 */
export function verifyProblem(problem: Problem): string[] {
  const faults: string[] = [];

  const chain = validateDerivation(problem.derivation);
  for (const c of chain) faults.push(`step ${c.index + 1}: ${c.message}`);

  const spec = problem.answer;
  const result = problem.derivation.result;

  // The answer must agree with where the derivation ended up. Comparing the
  // two catches a generator that solved the problem correctly but recorded the
  // wrong answer, and the reverse.
  switch (spec.kind) {
    case 'expression':
    case 'simplified':
    case 'number': {
      if (!problem.derivation.incomplete && !isRelation(result)) {
        if (!equivalent(spec.value, result).equal) {
          faults.push('the stated answer does not match the end of the worked solution');
        }
      }
      break;
    }
    case 'set': {
      if (spec.values.length === 0) faults.push('a solution set with no values');
      // Each stated root must be a root of the stated problem.
      if (isRelation(problem.statement) && problem.variable) {
        for (const v of spec.values) {
          const residual = substituteInto(problem.statement, problem.variable, v);
          if (residual && !equivalent(residual, ZERO_EXPR).equal) {
            faults.push(`the stated root ${toLatex(v)} does not satisfy the equation`);
          }
        }
      }
      break;
    }
    case 'tuple': {
      if (spec.labels && spec.labels.length !== spec.values.length) {
        faults.push('tuple labels do not match the number of values');
      }
      break;
    }
    case 'choice': {
      if (spec.correct < 0 || spec.correct >= spec.options.length) {
        faults.push('the correct option is out of range');
      }
      break;
    }
    case 'special':
      break;
  }

  // A distractor equal to the right answer would mark a correct answer wrong.
  if (spec.kind === 'expression' || spec.kind === 'simplified' || spec.kind === 'number') {
    for (const d of problem.distractors ?? []) {
      if (typeof d.value !== 'string' && equivalent(d.value, spec.value).equal) {
        faults.push(`the distractor ${toLatex(d.value)} is equal to the correct answer`);
      }
    }
  }

  return faults;
}

const ZERO_EXPR: Expr = { k: 'num', v: { n: 0n, d: 1n } };

/** left - right of a relation, with `v` replaced by `value`. */
function substituteInto(statement: Expr, v: string, value: Expr): Expr | null {
  if (statement.k !== 'rel') return null;
  const diff = subExpr(statement.args[0]!, statement.args[1]!);
  return substExpr(diff, { [v]: value });
}
