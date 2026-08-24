/**
 * The learner model.
 *
 * Two numbers per skill, tracking two different things that are easy to
 * conflate:
 *
 *   rating    — how hard a problem in this skill you can currently do. Moves
 *               on an Elo update against the problem's own rating, so it
 *               reflects difficulty faced, not volume attempted.
 *   stability — how long the skill will stay usable without practice, in days.
 *               Grows on each successful recall and collapses on a lapse.
 *
 * Keeping them separate matters: someone can be able to do hard problems in a
 * skill they will have forgotten in a week, and the scheduler needs to know
 * both. Mastery is only claimed when both are high.
 */

export interface SkillState {
  readonly skillId: string;
  /** Elo-style rating on the same scale as skill ratings. */
  readonly rating: number;
  /** How confident we are in the rating. Rises with attempts; damps the update. */
  readonly confidence: number;
  readonly attempts: number;
  readonly correct: number;
  /** Consecutive unaided correct answers. Resets on any wrong answer. */
  readonly streak: number;
  /** Days this skill is expected to remain retrievable. */
  readonly stability: number;
  /** How hard this skill is for this person, 1 (easy) to 10 (hard). */
  readonly difficulty: number;
  readonly lastSeen: number | null;
  readonly dueAt: number | null;
  /** Set once the skill has been presented, so it is no longer "locked". */
  readonly introduced: boolean;
}

export interface Attempt {
  readonly skillId: string;
  readonly problemId: string;
  readonly correct: boolean;
  /** Highest hint level opened, or -1 if none. */
  readonly hintLevel: number;
  /** Wrong answers before the right one. */
  readonly wrongTries: number;
  readonly seconds: number;
  readonly at: number;
  /** The rating of the problem faced. */
  readonly problemRating: number;
}

export const STARTING_RATING = 400;
const MIN_RATING = 200;
const MAX_RATING = 2600;

/** A skill not yet attempted. */
export function initialState(skillId: string, skillRating: number): SkillState {
  return {
    skillId,
    // Start a notch below the skill's own rating: the assumption is that a new
    // skill is not yet within reach, which makes the first problems easy and
    // the first success informative.
    rating: Math.max(MIN_RATING, skillRating - 250),
    confidence: 0,
    attempts: 0,
    correct: 0,
    streak: 0,
    stability: 0,
    difficulty: 5,
    lastSeen: null,
    dueAt: null,
    introduced: false,
  };
}

/**
 * Credit for an attempt, between 0 and 1.
 *
 * Hints are not free and not fatal. Getting there after a nudge is real
 * progress and scores most of the credit; being shown the next line scores
 * little; being shown the whole solution scores none. Wrong tries before a
 * correct answer cost a slice each, because arriving after three guesses is
 * not the same as arriving first time.
 */
export function scoreOf(a: Attempt): number {
  if (!a.correct) return 0;
  const hintPenalty = a.hintLevel < 0 ? 1
    : a.hintLevel === 0 ? 0.9    // nudge
    : a.hintLevel === 1 ? 0.75   // named the move
    : a.hintLevel === 2 ? 0.55   // explained it
    : a.hintLevel === 3 ? 0.25   // showed the next line
    : 0;                         // showed the whole thing
  const tryPenalty = Math.max(0.4, 1 - 0.2 * a.wrongTries);
  return hintPenalty * tryPenalty;
}

/**
 * Elo update.
 *
 * K falls as confidence rises, so early attempts move quickly and later ones
 * refine. It falls to a floor rather than to zero: with an unbounded decay a
 * rating stops responding after a few dozen attempts, and in simulation that
 * was enough to stall the whole system. Skills never climbed to their own
 * rating, so none became solid, so the cap on concurrent learning never
 * released and the learner ground the same four topics indefinitely.
 */
const K_FLOOR = 24;
const K_INITIAL = 90;

export function updateRating(state: SkillState, a: Attempt): number {
  const expected = expectedScore(state.rating, a.problemRating);
  const k = K_FLOOR + (K_INITIAL - K_FLOOR) / (1 + state.confidence * 0.3);
  const next = state.rating + k * (scoreOf(a) - expected);
  return clamp(next, MIN_RATING, MAX_RATING);
}

/** Probability of success against a problem of this rating. */
export function expectedScore(learner: number, problem: number): number {
  return 1 / (1 + Math.pow(10, (problem - learner) / 400));
}

/** The problem rating at which success is `target` likely. */
export function ratingForTarget(learner: number, target: number): number {
  const t = clamp(target, 0.05, 0.95);
  return learner - 400 * Math.log10(t / (1 - t));
}

// ------------------------------------------------------------------ retention

const DAY_MS = 86_400_000;

/**
 * Retrievability now, from stability and time elapsed.
 *
 * Stability is defined as the number of days until recall falls to 90%, so
 * R(t) = 0.9^(t/S). Defining it that way makes the number mean something a
 * person can read: a stability of 21 says "still there three weeks from now",
 * and the next review interval is simply the stability itself rather than
 * some fraction of it.
 */
const TARGET_RECALL = 0.9;

export function retrievability(state: SkillState, now: number): number {
  if (state.stability <= 0 || state.lastSeen === null) return 0;
  const days = (now - state.lastSeen) / DAY_MS;
  return Math.pow(TARGET_RECALL, days / state.stability);
}

/**
 * Update stability and per-person difficulty after an attempt.
 *
 * A success multiplies stability, and by more when the recall was harder —
 * remembering something you had nearly forgotten teaches more than reviewing
 * something fresh, which is the whole reason to space practice out. A lapse
 * does not zero stability but cuts it back sharply, because relearning is
 * faster than learning.
 */
export function updateRetention(
  state: SkillState, a: Attempt, now: number,
): { stability: number; difficulty: number; dueAt: number } {
  const score = scoreOf(a);
  const passed = score >= 0.5;
  const r = state.lastSeen === null ? 1 : retrievability(state, now);

  // Difficulty drifts toward what this person's results imply, slowly.
  const target = passed ? state.difficulty - 0.7 : state.difficulty + 1.4;
  const difficulty = clamp(state.difficulty * 0.8 + target * 0.2, 1, 10);

  let stability: number;
  if (state.stability <= 0) {
    // First exposure. A confident first success is worth more than a shaky one.
    stability = passed ? 0.5 + 1.0 * score : 0.25;
  } else if (passed) {
    const easeFromDifficulty = 1 + (10 - difficulty) * 0.14;
    // Growth is driven by how much had been forgotten. Answering something you
    // just answered teaches almost nothing about how long you will keep it, so
    // the gain there is nearly zero; recalling something that had faded is
    // what actually extends retention. Without this term, ten repetitions in
    // one sitting inflate stability past the mastery threshold, and cramming
    // reads as mastery.
    // Tuned so a review taken at the scheduled moment roughly doubles the
    // interval -- the familiar 1, 3, 5, 9, 16 day progression -- while a
    // review taken immediately barely moves it.
    const spacingGain = 0.05 + 3.2 * (1 - r);
    const hintDamping = 0.55 + 0.45 * score;
    stability = state.stability * (1 + easeFromDifficulty * spacingGain * hintDamping);
  } else {
    stability = Math.max(0.3, state.stability * 0.35);
  }

  // Cap the interval at six months. Beyond that the schedule is asserting
  // more about a person's memory than the model can support, and a skill that
  // resurfaces twice a year costs almost nothing to keep.
  stability = clamp(stability, 0.2, 180);

  // Stability is by definition the point at which recall reaches 90%, so it is
  // the interval.
  return {
    stability,
    difficulty,
    dueAt: now + Math.max(0.02, stability) * DAY_MS,
  };
}

/** Fold an attempt into the state. */
export function applyAttempt(state: SkillState, a: Attempt, now = a.at): SkillState {
  const rating = updateRating(state, a);
  const { stability, difficulty, dueAt } = updateRetention(state, a, now);
  const unaided = a.correct && a.hintLevel < 0 && a.wrongTries === 0;
  return {
    ...state,
    rating,
    confidence: state.confidence + 1,
    attempts: state.attempts + 1,
    correct: state.correct + (a.correct ? 1 : 0),
    streak: unaided ? state.streak + 1 : a.correct ? state.streak : 0,
    stability,
    difficulty,
    lastSeen: now,
    dueAt,
    introduced: true,
  };
}

// -------------------------------------------------------------------- mastery

export type MasteryBand = 'locked' | 'new' | 'learning' | 'practised' | 'solid' | 'mastered';

export interface Mastery {
  readonly band: MasteryBand;
  /** 0..1, for progress bars. */
  readonly fraction: number;
  /** Plain-language statement of where this skill stands. */
  readonly summary: string;
}

/**
 * Where a skill stands.
 *
 * Both halves must be true to claim mastery: the rating has to have cleared
 * the skill's own difficulty, and the material has to be durable enough to
 * still be there in a couple of weeks. Rating alone would call a skill
 * mastered the day it was crammed.
 */
export function masteryOf(state: SkillState, skillRating: number, unlocked: boolean): Mastery {
  if (!unlocked && !state.introduced) {
    return { band: 'locked', fraction: 0, summary: 'Not yet available — finish what it builds on first.' };
  }
  if (state.attempts === 0) {
    return { band: 'new', fraction: 0, summary: 'Not started.' };
  }

  const ratingProgress = clamp((state.rating - (skillRating - 300)) / 400, 0, 1);
  const durability = clamp(state.stability / 21, 0, 1);
  const accuracy = state.attempts > 0 ? state.correct / state.attempts : 0;
  const fraction = clamp(ratingProgress * 0.5 + durability * 0.3 + clamp(state.streak / 5, 0, 1) * 0.2, 0, 1);

  if (state.rating >= skillRating + 100 && state.stability >= 21 && state.streak >= 3) {
    return { band: 'mastered', fraction: 1, summary: 'Mastered — it will come back for occasional review.' };
  }
  if (state.rating >= skillRating && state.stability >= 7) {
    return { band: 'solid', fraction, summary: 'Solid. A few more spaced reviews will lock it in.' };
  }
  if (state.attempts >= 3 && accuracy >= 0.5) {
    return { band: 'practised', fraction, summary: 'Coming together. Keep going.' };
  }
  return { band: 'learning', fraction, summary: 'Just started — expect it to feel effortful.' };
}

/** Is this skill available, given how its prerequisites are going? */
export function isUnlocked(
  prerequisites: readonly string[],
  states: Readonly<Record<string, SkillState>>,
  ratings: Readonly<Record<string, number>>,
): boolean {
  return prerequisites.every((p) => {
    const st = states[p];
    if (!st) return false;
    const m = masteryOf(st, ratings[p] ?? STARTING_RATING, true);
    // "Practised" is enough to move on. Requiring mastery of every prerequisite
    // would stall a learner on foundations long after they were ready, and the
    // spaced reviews keep the earlier skills alive anyway.
    return m.band === 'practised' || m.band === 'solid' || m.band === 'mastered';
  });
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
