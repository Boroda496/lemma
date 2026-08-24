import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/random.ts';
import { ALL_SKILLS, getSkill } from '../src/curriculum/skills.ts';
import { hasGenerator } from '../src/curriculum/registry.ts';
import {
  initialState, applyAttempt, masteryOf, expectedScore, ratingForTarget,
  retrievability, scoreOf, type SkillState, type Attempt,
} from '../src/mastery/model.ts';
import {
  chooseNext, planSession, progressSummary, problemRating, difficultyFor,
  stateFor, availableSkills, TARGET_SUCCESS,
} from '../src/mastery/scheduler.ts';

const DAY = 86_400_000;

describe('the rating model', () => {
  it('expected score is 50% against an equal rating', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
  });
  it('a 400 point gap is about 90%', () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 2);
  });
  it('ratingForTarget inverts expectedScore', () => {
    for (const target of [0.6, 0.7, 0.8, 0.9]) {
      const r = ratingForTarget(1200, target);
      expect(expectedScore(1200, r)).toBeCloseTo(target, 6);
    }
  });
  it('hints reduce credit without erasing it', () => {
    const base: Attempt = {
      skillId: 's', problemId: 'p', correct: true, hintLevel: -1,
      wrongTries: 0, seconds: 30, at: 0, problemRating: 1000,
    };
    expect(scoreOf(base)).toBe(1);
    expect(scoreOf({ ...base, hintLevel: 0 })).toBeGreaterThan(0.8);
    expect(scoreOf({ ...base, hintLevel: 2 })).toBeGreaterThan(0.4);
    expect(scoreOf({ ...base, hintLevel: 4 })).toBe(0);
    expect(scoreOf({ ...base, correct: false })).toBe(0);
  });
  it('a wrong answer never scores above a right one', () => {
    const a: Attempt = {
      skillId: 's', problemId: 'p', correct: false, hintLevel: -1,
      wrongTries: 0, seconds: 30, at: 0, problemRating: 1000,
    };
    expect(scoreOf(a)).toBeLessThan(scoreOf({ ...a, correct: true, hintLevel: 3 }));
  });
});

describe('retention', () => {
  it('a skill just practised is fully retrievable', () => {
    let s = initialState('x', 800);
    s = applyAttempt(s, attempt(0, true), 0);
    expect(retrievability(s, 0)).toBeCloseTo(1, 3);
  });
  it('retrievability decays over time', () => {
    let s = initialState('x', 800);
    s = applyAttempt(s, attempt(0, true), 0);
    const a = retrievability(s, 2 * DAY);
    const b = retrievability(s, 20 * DAY);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeLessThan(0.6);
  });
  it('repeated successes lengthen the interval', () => {
    let s = initialState('x', 800);
    let now = 0;
    const intervals: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = applyAttempt(s, attempt(now, true), now);
      intervals.push((s.dueAt! - now) / DAY);
      now = s.dueAt!;
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]!, `interval ${i}`).toBeGreaterThan(intervals[i - 1]!);
    }
    expect(intervals[intervals.length - 1]).toBeGreaterThan(10);
  });
  it('a lapse cuts the interval back sharply but does not reset it', () => {
    let s = initialState('x', 800);
    let now = 0;
    for (let i = 0; i < 5; i++) { s = applyAttempt(s, attempt(now, true), now); now = s.dueAt!; }
    const before = s.stability;
    s = applyAttempt(s, attempt(now, false), now);
    expect(s.stability).toBeLessThan(before * 0.5);
    expect(s.stability).toBeGreaterThan(0);
  });
});

describe('mastery is only claimed when the skill is both strong and durable', () => {
  it('does not call a crammed skill mastered', () => {
    let s = initialState('x', 800);
    // Ten correct answers in one sitting: high rating, no durability.
    for (let i = 0; i < 10; i++) s = applyAttempt(s, attempt(i * 1000, true, 1100), i * 1000);
    const m = masteryOf(s, 800, true);
    expect(m.band).not.toBe('mastered');
  });
  it('reaches mastery with spaced successes over time', () => {
    let s = initialState('x', 800);
    let now = 0;
    for (let i = 0; i < 12; i++) {
      s = applyAttempt(s, attempt(now, true, 950), now);
      now = Math.max(s.dueAt!, now + DAY);
    }
    expect(masteryOf(s, 800, true).band).toBe('mastered');
  });
});

// ------------------------------------------------------------------ simulation

/**
 * A simulated learner with a true latent ability per skill, who succeeds with
 * a probability the scheduler does not know. This is the test that matters:
 * does the engine actually move someone forward?
 */
function simulate(opts: { days: number; perDay: number; trueAbility: (s: string) => number; seed: number }) {
  const rng = new Rng(opts.seed);
  const states: Record<string, SkillState> = {};
  const log: Array<{ day: number; skill: string; correct: boolean; kind: string; expected: number }> = [];

  for (let day = 0; day < opts.days; day++) {
    const now = day * DAY + 12 * 3600_000;
    const recent: string[] = [];
    for (let i = 0; i < opts.perDay; i++) {
      const choice = chooseNext(states, { now, recent });
      if (!choice) break;
      const skill = getSkill(choice.skillId)!;
      const pr = problemRating(skill, choice.difficulty);
      const trueP = expectedScore(opts.trueAbility(choice.skillId), pr);
      const correct = rng.next() < trueP;

      const st = stateFor(states, choice.skillId);
      states[choice.skillId] = applyAttempt(st, {
        skillId: choice.skillId, problemId: `${choice.skillId}:sim`,
        correct, hintLevel: correct ? -1 : 2, wrongTries: correct ? 0 : 1,
        seconds: 45, at: now, problemRating: pr,
      }, now);

      recent.push(choice.skillId);
      log.push({ day, skill: choice.skillId, correct, kind: choice.kind, expected: choice.expectedSuccess });
    }
  }
  return { states, log };
}

const attempt = (at: number, correct: boolean, problemRating = 900): Attempt => ({
  skillId: 'x', problemId: 'p', correct, hintLevel: correct ? -1 : 1,
  wrongTries: correct ? 0 : 1, seconds: 40, at, problemRating,
});

describe('the scheduler guides a simulated learner', () => {
  it('starts with only the skills that have no prerequisites', () => {
    const open = availableSkills({});
    expect(open.length).toBeGreaterThan(0);
    for (const s of open) expect(s.prerequisites).toHaveLength(0);
  });

  it('a capable learner progresses from nothing to a broad base', () => {
    const { states, log } = simulate({
      days: 120, perDay: 12, seed: 7,
      // Comfortably able at everything up to about intermediate algebra.
      trueAbility: (id) => (getSkill(id)?.rating ?? 500) + 200,
    });
    const summary = progressSummary(states);
    expect(summary.mastered + summary.solid).toBeGreaterThan(12);
    expect(log.length).toBeGreaterThan(800);

    // Prerequisites were always respected.
    const firstSeen = new Map<string, number>();
    log.forEach((e, i) => { if (!firstSeen.has(e.skill)) firstSeen.set(e.skill, i); });
    for (const [skillId, idx] of firstSeen) {
      for (const p of getSkill(skillId)!.prerequisites) {
        if (!hasGenerator(p)) continue;
        const pIdx = firstSeen.get(p);
        expect(pIdx === undefined || pIdx < idx, `${skillId} appeared before ${p}`).toBe(true);
      }
    }
  });

  it('keeps the success rate near the target rather than drifting easy or brutal', () => {
    const { log } = simulate({
      days: 90, perDay: 10, seed: 11,
      trueAbility: (id) => (getSkill(id)?.rating ?? 500) + 150,
    });
    const settled = log.slice(Math.floor(log.length / 3));
    const rate = settled.filter((e) => e.correct).length / settled.length;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.95);
  });

  it('a struggling learner is not dragged into material they cannot do', () => {
    const { states, log } = simulate({
      days: 60, perDay: 10, seed: 13,
      // Weak: about 300 points below every skill's nominal rating.
      trueAbility: (id) => (getSkill(id)?.rating ?? 500) - 300,
    });
    const rate = log.filter((e) => e.correct).length / log.length;
    // They should still succeed some of the time, because difficulty adapts down.
    expect(rate).toBeGreaterThan(0.3);
    // And they should not have been pushed deep into the graph.
    const reached = Object.keys(states).map((id) => getSkill(id)!.rating);
    expect(Math.max(...reached)).toBeLessThan(1400);
  });

  it('interleaves rather than blocking on one skill', () => {
    const { log } = simulate({
      days: 30, perDay: 10, seed: 17,
      trueAbility: (id) => (getSkill(id)?.rating ?? 500) + 150,
    });
    let immediateRepeats = 0;
    for (let i = 1; i < log.length; i++) {
      if (log[i]!.skill === log[i - 1]!.skill && log[i]!.day === log[i - 1]!.day) immediateRepeats++;
    }
    expect(immediateRepeats / log.length).toBeLessThan(0.05);
  });

  it('brings old skills back for review', () => {
    const { log } = simulate({
      days: 120, perDay: 10, seed: 19,
      trueAbility: (id) => (getSkill(id)?.rating ?? 500) + 200,
    });
    const reviews = log.filter((e) => e.kind === 'review').length;
    expect(reviews).toBeGreaterThan(log.length * 0.1);
  });
});

describe('session planning', () => {
  it('produces a plan of the requested length', () => {
    const plan = planSession({}, 8);
    expect(plan).toHaveLength(8);
    for (const c of plan) {
      expect(c.difficulty).toBeGreaterThanOrEqual(0);
      expect(c.difficulty).toBeLessThanOrEqual(1);
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });
  it('does not put the same skill back to back', () => {
    const plan = planSession({}, 10);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.skillId).not.toBe(plan[i - 1]!.skillId);
    }
  });
});

describe('difficulty mapping is consistent in both directions', () => {
  it('difficultyFor inverts problemRating within the band', () => {
    const skill = getSkill('linear-equations')!;
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      const r = problemRating(skill, d);
      expect(difficultyFor(skill, r)).toBeCloseTo(d, 6);
    }
  });
});
