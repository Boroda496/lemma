/**
 * What a problem is, and what counts as answering it.
 *
 * Two things make a problem trustworthy, and both happen before a student
 * ever sees it:
 *   - the derivation is validated, so the worked solution and every hint
 *     drawn from it are correct;
 *   - the stated answer is checked against the problem independently of the
 *     generator that produced it.
 *
 * A generator that gets either wrong produces a problem that fails
 * verification and is discarded, rather than a wrong problem in the queue.
 */

import type { Expr } from './../engine/expr.ts';
import type { Derivation } from './../engine/derive.ts';
import type { EquivResult } from './../engine/equivalence.ts';

/** Where a topic sits. Used for ordering and for the map view. */
export type Strand =
  | 'arithmetic' | 'algebra' | 'geometry' | 'functions'
  | 'trigonometry' | 'statistics' | 'calculus';

export interface Skill {
  readonly id: string;
  readonly name: string;
  /** One sentence a student would recognise. */
  readonly description: string;
  readonly strand: Strand;
  /** Skills that should be comfortable before this one is introduced. */
  readonly prerequisites: readonly string[];
  /**
   * Nominal difficulty on the same scale as a student's rating, so the
   * scheduler can compare them directly. 400 is early arithmetic; 2000+ is
   * calculus.
   */
  readonly rating: number;
  /** Short explainer shown in the concept panel. Plain language, no jargon. */
  readonly concept: string;
  /** Worked example rendered on the skill page, as source text. */
  readonly example?: string;
}

// ------------------------------------------------------------------- answers

export type AnswerSpec =
  /** Any expression equal to `value`. 2/4 is accepted for 1/2. */
  | { readonly kind: 'expression'; readonly value: Expr }
  /** Equal to `value` AND already in simplest form. For "simplify" problems. */
  | { readonly kind: 'simplified'; readonly value: Expr }
  /** A set of values, order irrelevant. For "solve" problems. */
  | { readonly kind: 'set'; readonly values: readonly Expr[] }
  /** An ordered tuple. For coordinates and systems. */
  | { readonly kind: 'tuple'; readonly values: readonly Expr[]; readonly labels?: readonly string[] }
  /** A single exact number, with optional units. */
  | { readonly kind: 'number'; readonly value: Expr; readonly unit?: string }
  /** One of several offered options. */
  | { readonly kind: 'choice'; readonly options: readonly string[]; readonly correct: number }
  /** No solution, or every value. */
  | { readonly kind: 'special'; readonly value: 'no-solution' | 'all-reals' };

/** A wrong answer worth naming, with what it means. */
export interface Distractor {
  /** The wrong answer, as an expression or as literal text. */
  readonly value: Expr | string;
  /** What the student most likely did. Written as an observation, not a scold. */
  readonly diagnosis: string;
  /** The skill to revisit, if this mistake points at one. */
  readonly reviewSkill?: string;
}

export interface Problem {
  readonly id: string;
  readonly skill: string;
  /** The seed that produced it, so any problem can be regenerated exactly. */
  readonly seed: number;
  /** 0..1 within the skill's band. Drives which variant the generator makes. */
  readonly difficulty: number;
  /** The instruction: "Solve for x", "Factor completely". */
  readonly prompt: string;
  /** The problem itself, rendered as math. */
  readonly statement: Expr;
  /** Extra context above the statement, for word problems. */
  readonly context?: string;
  /** A figure to draw, for geometry. */
  readonly figure?: Figure;
  readonly answer: AnswerSpec;
  /** The verified worked solution. Hints are read from this. */
  readonly derivation: Derivation;
  readonly distractors?: readonly Distractor[];
  /** Which variable the student is solving for, when it matters. */
  readonly variable?: string;
}

export interface Verdict {
  readonly correct: boolean;
  /** Why, in the student's terms. */
  readonly message: string;
  /** The oracle's own account, for the "show me why" panel. */
  readonly evidence?: EquivResult;
  /** Set when the answer is right but not in the form asked for. */
  readonly needsSimplifying?: boolean;
  /** Set when a named misconception matches. */
  readonly diagnosis?: string;
  readonly reviewSkill?: string;
}

// ------------------------------------------------------------------- figures

/**
 * A geometric figure, described by its parts rather than by drawing commands,
 * so the same description can be rendered, measured, and verified numerically.
 */
export interface Figure {
  readonly kind: 'triangle' | 'rectangle' | 'circle' | 'polygon' | 'angles' | 'coordinate' | 'composite';
  /** Named points with exact coordinates, when the figure is placed. */
  readonly points?: Record<string, readonly [number, number]>;
  /** Segments to draw, as point-name pairs. */
  readonly segments?: readonly (readonly [string, string])[];
  /** Labels on segments: side length, or an unknown marker. */
  readonly sideLabels?: Record<string, string>;
  /** Labels at vertices: angle measures. */
  readonly angleLabels?: Record<string, string>;
  /** Right-angle markers at these vertices. */
  readonly rightAngles?: readonly string[];
  /** Tick marks showing congruent sides, grouped. */
  readonly congruent?: readonly (readonly string[])[];
  readonly circles?: readonly { readonly center: string; readonly radius: number; readonly label?: string }[];
  /** Free-form notes rendered beside the figure. */
  readonly caption?: string;
  /** Whether the drawing is to scale. Stated so a student is never misled. */
  readonly toScale: boolean;
}

// ------------------------------------------------------- generator contract

export interface GeneratorContext {
  readonly difficulty: number;
  readonly seed: number;
}

/**
 * A generator makes one problem, or returns null if the parameters it drew
 * are degenerate. Returning null is normal and the caller simply retries with
 * a new seed; it is how a generator avoids emitting "solve 0x = 0".
 */
export type Generator = (ctx: GeneratorContext) => Omit<Problem, 'id' | 'skill' | 'seed' | 'difficulty'> | null;

export interface SkillContent {
  readonly skill: Skill;
  readonly generators: readonly Generator[];
}
