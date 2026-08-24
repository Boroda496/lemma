/**
 * The generator registry and the generation pipeline.
 *
 * Every problem that reaches a student passes through `generateProblem`, which
 * verifies before returning: the derivation must validate step by step, and
 * the stated answer must be consistent with it. A generator that produces
 * something unsound costs a retry, not a wrong problem.
 *
 * Coverage is reported honestly by `coverage()`. A skill with no generator is
 * listed as such rather than quietly falling back to something adjacent, which
 * would tell a student they are practising one thing while they practise
 * another.
 */

import { Rng } from './../engine/random.ts';
import type { Generator, Problem } from './types.ts';
import { verifyProblem } from './check.ts';
import { ALL_SKILLS, getSkill } from './skills.ts';
import * as A from './generators/algebra.ts';
import * as G from './generators/geometry.ts';
import * as S from './generators/statistics.ts';
import * as F from './generators/functions.ts';

/** skill id -> the generators that can produce problems for it. */
const REGISTRY: Record<string, readonly Generator[]> = {
  // arithmetic
  'integer-arithmetic': [A.genIntegerArithmetic],
  'order-of-operations': [A.genOrderOfOperations],
  'fractions': [A.genFractions],
  'exponent-rules': [A.genExponentRules],
  'radicals': [A.genRadicals],
  'prime-factorization': [A.genPrimeFactorization],
  'decimals-percents': [A.genDecimalsPercents],

  // algebra
  'evaluate-expressions': [A.genEvaluateExpressions],
  'like-terms': [A.genLikeTerms],
  'distributive-property': [A.genDistribute],
  'simplifying': [A.genDistribute, A.genLikeTerms],
  'linear-equations': [A.genLinearEquations],
  'linear-equations-both-sides': [A.genLinearBothSides],
  'linear-inequalities': [A.genLinearInequalities],
  'literal-equations': [A.genLiteralEquations],
  'linear-systems': [A.genLinearSystems],
  'factoring-gcf': [A.genFactoringGcf],
  'multiply-binomials': [A.genMultiplyBinomials],
  'special-products': [A.genSpecialProducts],
  'factoring-quadratics': [A.genFactoringQuadratics],
  'zero-product-property': [A.genQuadraticByFactoring],
  'quadratic-equations': [A.genQuadraticByFactoring],
  'completing-the-square': [A.genCompletingTheSquare],
  'quadratic-formula': [A.genQuadraticFormula],
  'rational-expressions': [A.genRationalExpressions],
  'proportions': [A.genProportions],
  'absolute-value-equations': [A.genAbsoluteValue],
  'radical-equations': [A.genRadicalEquations],
  'rational-equations': [A.genRationalEquations],
  'polynomial-arithmetic': [A.genPolynomialArithmetic],
  'factoring-cubics': [A.genFactoringCubics],

  // geometry
  'angles': [G.genAngles],
  'triangle-angles': [G.genTriangleAngles],
  'perimeter-area': [G.genPerimeterArea],
  'pythagorean-theorem': [G.genPythagoras],
  'special-right-triangles': [G.genSpecialRightTriangles],
  'circles': [G.genCircles],
  'volume-surface-area': [G.genVolume],
  'coordinate-geometry': [G.genCoordinateGeometry],
  'lines-and-slope': [G.genLinesAndSlope],
  'similar-triangles': [G.genSimilarTriangles],
  'right-triangle-trig': [G.genRightTriangleTrig],
  'parallel-lines': [G.genParallelLines],
  'transformations': [G.genTransformations],

  // functions
  'function-notation': [F.genFunctionNotation],
  'domain-range': [F.genDomainRange],
  'graphing-linear': [F.genGraphingLinear],
  'graphing-quadratics': [F.genGraphingQuadratics],
  'inverse-functions': [F.genInverseFunctions],
  'exponential-functions': [F.genExponentialFunctions],
  'logarithms': [F.genLogarithms],
  'exponential-equations': [F.genExponentialEquations],
  'sequences-series': [F.genSequences],

  // statistics
  'mean-median-mode': [S.genCentreAndSpread],
  'probability-basics': [S.genProbability],
  'counting': [S.genCounting],
};

export const hasGenerator = (skillId: string): boolean => (REGISTRY[skillId]?.length ?? 0) > 0;

export const generatorsFor = (skillId: string): readonly Generator[] => REGISTRY[skillId] ?? [];

/** Which skills can actually be practised, and which are graph-only for now. */
export function coverage(): { playable: string[]; missing: string[] } {
  const playable: string[] = [];
  const missing: string[] = [];
  for (const s of ALL_SKILLS) (hasGenerator(s.id) ? playable : missing).push(s.id);
  return { playable, missing };
}

export interface GenerateOptions {
  readonly difficulty?: number;
  readonly seed?: number;
  /** Attempts before giving up. Generators legitimately reject their own draws. */
  readonly attempts?: number;
}

export class NoProblemAvailable extends Error {
  constructor(readonly skillId: string, readonly reasons: readonly string[]) {
    super(
      `Could not generate a verified problem for "${skillId}" after several attempts.` +
      (reasons.length ? ` Last faults: ${reasons.join('; ')}` : ''),
    );
    this.name = 'NoProblemAvailable';
  }
}

/**
 * Produce one verified problem for a skill.
 *
 * The seed fully determines the result, so a problem can be regenerated from
 * its id alone — which is how review and "show me that one again" work without
 * storing the whole problem.
 */
export function generateProblem(skillId: string, opts: GenerateOptions = {}): Problem {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`Unknown skill "${skillId}".`);
  const gens = generatorsFor(skillId);
  if (gens.length === 0) throw new NoProblemAvailable(skillId, ['no generator is registered']);

  const difficulty = clamp01(opts.difficulty ?? 0.5);
  const baseSeed = opts.seed ?? (Date.now() ^ Rng.hash(skillId)) >>> 0;
  const attempts = opts.attempts ?? 40;
  const faults: string[] = [];

  for (let i = 0; i < attempts; i++) {
    const seed = (baseSeed + i * 0x9e3779b1) >>> 0;
    const gen = gens[new Rng(seed ^ 0x5bf03635).int(0, gens.length - 1)]!;

    let draft: ReturnType<Generator>;
    try {
      draft = gen({ difficulty, seed });
    } catch (err) {
      // A throwing generator is a bug, but it must not take the app down.
      faults.push(`generator threw: ${(err as Error).message}`);
      continue;
    }
    if (!draft) continue;   // generator rejected its own draw; normal

    const problem: Problem = {
      ...draft,
      // The id has to carry everything the generator depended on. Seed alone
      // is not enough: the same seed at a different difficulty is a different
      // problem, so regenerating from the id would quietly produce another one.
      id: `${skillId}:${seed.toString(36)}:${Math.round(difficulty * 100)}`,
      skill: skillId,
      seed,
      difficulty,
    };

    const problems = verifyProblem(problem);
    if (problems.length === 0) return problem;
    faults.length = 0;
    faults.push(...problems);
  }

  throw new NoProblemAvailable(skillId, faults);
}

/**
 * Regenerate a problem from its id.
 *
 * This is how review works without storing problems: an attempt records only
 * the id, and the problem is rebuilt on demand, identically.
 */
export function problemFromId(id: string): Problem {
  const parts = id.split(':');
  if (parts.length < 3) throw new Error(`Malformed problem id "${id}".`);
  const difficultyPart = parts.pop()!;
  const seedPart = parts.pop()!;
  const skillId = parts.join(':');
  const seed = parseInt(seedPart, 36);
  const difficulty = Number(difficultyPart) / 100;
  if (!Number.isFinite(seed) || !Number.isFinite(difficulty)) {
    throw new Error(`Malformed problem id "${id}".`);
  }
  return generateProblem(skillId, { seed, difficulty, attempts: 1 });
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
