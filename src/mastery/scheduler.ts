/**
 * Choosing what to practise next.
 *
 * The scheduler balances three demands that pull against each other:
 *   - keep what has been learned from decaying (spaced review),
 *   - push the edge of what is currently possible (the frontier),
 *   - open new ground when there is room for it.
 *
 * Two constraints shape the result. Problems are aimed at roughly an 80%
 * success rate, because that is where practice is neither discouraging nor
 * idle. And the same skill is not served twice in a row when an alternative
 * exists: interleaving feels harder and produces better retention than
 * grinding one topic, which is why blocked practice is avoided even though a
 * learner usually prefers it in the moment.
 */

import { ALL_SKILLS, getSkill } from './../curriculum/skills.ts';
import { hasGenerator } from './../curriculum/registry.ts';
import type { Skill } from './../curriculum/types.ts';
import {
  type SkillState, initialState, masteryOf, isUnlocked, retrievability,
  ratingForTarget, expectedScore, STARTING_RATING,
} from './model.ts';

/** Success rate the scheduler aims for. */
export const TARGET_SUCCESS = 0.8;
/** How many skills may be actively being learned at once. */
const MAX_IN_PROGRESS = 4;
/** How wide a skill's difficulty band is, in rating points. */
const DIFFICULTY_SPAN = 300;

export interface Choice {
  readonly skillId: string;
  /** 0..1, passed straight to the generator. */
  readonly difficulty: number;
  /** Why this was chosen, shown to the learner. */
  readonly reason: string;
  readonly kind: 'review' | 'frontier' | 'new' | 'stretch';
  /** Estimated chance of getting it right, for the session summary. */
  readonly expectedSuccess: number;
}

export type StateMap = Readonly<Record<string, SkillState>>;

/** The rating of a problem at a given difficulty within a skill. */
export function problemRating(skill: Skill, difficulty: number): number {
  return skill.rating + (difficulty - 0.5) * DIFFICULTY_SPAN;
}

/** The difficulty that produces a problem of the requested rating. */
export function difficultyFor(skill: Skill, targetRating: number): number {
  const raw = 0.5 + (targetRating - skill.rating) / DIFFICULTY_SPAN;
  return clamp(raw, 0, 1);
}

/** State for a skill, creating a fresh one if it has never been seen. */
export function stateFor(states: StateMap, skillId: string): SkillState {
  const existing = states[skillId];
  if (existing) return existing;
  return initialState(skillId, getSkill(skillId)?.rating ?? STARTING_RATING);
}

const ratingsMap = (): Record<string, number> =>
  Object.fromEntries(ALL_SKILLS.map((s) => [s.id, s.rating]));

/** Skills that can actually be served: unlocked, and with a generator. */
export function availableSkills(states: StateMap): Skill[] {
  const ratings = ratingsMap();
  return ALL_SKILLS.filter((s) => {
    if (!hasGenerator(s.id)) return false;
    return isUnlocked(s.prerequisites, materialize(states), ratings);
  });
}

/** Fill in missing states so the unlock check sees a complete picture. */
function materialize(states: StateMap): Record<string, SkillState> {
  const out: Record<string, SkillState> = {};
  for (const s of ALL_SKILLS) out[s.id] = stateFor(states, s.id);
  return out;
}

/**
 * Pick the next thing to practise.
 *
 * `recent` is the tail of the session so far, used to avoid serving the same
 * skill twice running.
 */
export function chooseNext(
  states: StateMap,
  opts: { now?: number; recent?: readonly string[]; focusSkill?: string } = {},
): Choice | null {
  const now = opts.now ?? Date.now();
  const recent = opts.recent ?? [];
  const full = materialize(states);
  const ratings = ratingsMap();

  // A skill the learner asked to drill overrides the scheduler entirely.
  if (opts.focusSkill) {
    const skill = getSkill(opts.focusSkill);
    if (skill && hasGenerator(skill.id)) return aim(skill, full[skill.id]!, 'frontier',
      `Practising ${skill.name} because you chose it.`);
    return null;
  }

  const available = availableSkills(states);
  if (available.length === 0) return null;

  // Every skill gets exactly one classification. An earlier version let a
  // mastered skill that was not yet due fall through all the branches and be
  // scored as though it were new, which meant the scheduler spent a third of
  // its choices "introducing" topics that were already finished.
  const inProgress = ALL_SKILLS.filter((s) => {
    const t = full[s.id]!;
    if (!t.introduced) return false;
    const m = masteryOf(t, s.rating, true);
    return m.band === 'learning' || m.band === 'practised';
  }).length;
  const roomForNew = inProgress < MAX_IN_PROGRESS;
  const average = averageRating(full, ratings);

  const scored = available.map((skill) => {
    const st = full[skill.id]!;
    const mastery = masteryOf(st, skill.rating, true);
    const lastIndex = recent.lastIndexOf(skill.id);
    // Recency penalty: strongest for the immediately preceding item, fading out.
    const recencyPenalty = lastIndex === -1 ? 0
      : recent.length - lastIndex <= 1 ? 1000
      : 240 / (recent.length - lastIndex);

    if (!st.introduced) {
      // Opening too many fronts at once means none of them consolidate.
      const readiness = 300 - Math.abs(skill.rating - average) * 0.25;
      return {
        skill, st, kind: 'new' as const,
        score: (roomForNew ? readiness : -500) - recencyPenalty,
        reason: `Starting ${skill.name}.`,
      };
    }

    const due = st.dueAt !== null && now >= st.dueAt;
    if (due) {
      const r = retrievability(st, now);
      const overdueDays = (now - st.dueAt!) / 86_400_000;
      // The more it has faded the more urgent, since a review at the point of
      // nearly forgetting is worth several done too early.
      const urgency = 600 + (1 - r) * 500 + Math.min(overdueDays, 30) * 12;
      return {
        skill, st, kind: 'review' as const, score: urgency - recencyPenalty,
        reason: `${skill.name} is due for review — it has been ${describeGap(now - (st.lastSeen ?? now))}.`,
      };
    }

    switch (mastery.band) {
      case 'mastered':
        // Finished and still fresh. Nothing to gain from serving it now.
        return {
          skill, st, kind: 'review' as const, score: -300 - recencyPenalty,
          reason: `${skill.name} is resting until its next review.`,
        };
      case 'solid':
        return {
          skill, st, kind: 'stretch' as const, score: 180 - recencyPenalty,
          reason: `Pushing ${skill.name} a little harder.`,
        };
      default:
        return {
          skill, st, kind: 'frontier' as const,
          score: 420 - mastery.fraction * 120 - recencyPenalty,
          reason: `Building on ${skill.name}.`,
        };
    }
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  return aim(best.skill, best.st, best.kind, best.reason);
}

/** Set the difficulty for a chosen skill, aiming at the target success rate. */
function aim(skill: Skill, st: SkillState, kind: Choice['kind'], reason: string): Choice {
  // A stretch item deliberately aims lower than the comfortable rate.
  const target = kind === 'stretch' ? 0.65 : kind === 'new' ? 0.9 : TARGET_SUCCESS;
  const wanted = ratingForTarget(st.rating, target);
  const difficulty = difficultyFor(skill, wanted);
  return {
    skillId: skill.id,
    difficulty,
    reason,
    kind,
    expectedSuccess: expectedScore(st.rating, problemRating(skill, difficulty)),
  };
}

function averageRating(full: Record<string, SkillState>, ratings: Record<string, number>): number {
  const active = Object.values(full).filter((s) => s.introduced);
  if (active.length === 0) return STARTING_RATING;
  return active.reduce((sum, s) => sum + s.rating, 0) / active.length;
}

function describeGap(ms: number): string {
  const days = ms / 86_400_000;
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} hours`;
  if (days < 14) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

/**
 * A session plan.
 *
 * Built by walking `chooseNext` forward with an assumed outcome, so the mix of
 * review and new material is decided up front and the learner can see the
 * shape of the session before starting it.
 */
export function planSession(states: StateMap, length = 10, now = Date.now()): Choice[] {
  const plan: Choice[] = [];
  const recent: string[] = [];
  const working: Record<string, SkillState> = materialize(states);

  for (let i = 0; i < length; i++) {
    const choice = chooseNext(working, { now, recent });
    if (!choice) break;
    plan.push(choice);
    recent.push(choice.skillId);
    // Assume the expected outcome so the plan does not stack the same review
    // repeatedly. This is planning only; real attempts update the real state.
    const st = working[choice.skillId]!;
    working[choice.skillId] = {
      ...st,
      introduced: true,
      lastSeen: now,
      dueAt: now + Math.max(1, st.stability) * 86_400_000,
    };
  }
  return plan;
}

/** A short, honest account of where things stand overall. */
export function progressSummary(states: StateMap): {
  mastered: number; solid: number; inProgress: number; available: number; total: number; dueNow: number;
} {
  const now = Date.now();
  const full = materialize(states);
  let mastered = 0, solid = 0, inProgress = 0, dueNow = 0;

  for (const skill of ALL_SKILLS) {
    const st = full[skill.id]!;
    if (st.introduced && st.dueAt !== null && now >= st.dueAt) dueNow++;
    const m = masteryOf(st, skill.rating, true);
    if (m.band === 'mastered') mastered++;
    else if (m.band === 'solid') solid++;
    else if (st.introduced) inProgress++;
  }

  return {
    mastered, solid, inProgress,
    available: availableSkills(states).length,
    total: ALL_SKILLS.filter((s) => hasGenerator(s.id)).length,
    dueNow,
  };
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
