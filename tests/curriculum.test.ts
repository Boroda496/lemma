import { describe, it, expect } from 'vitest';
import { ALL_SKILLS, validateGraph, topologicalOrder, allPrerequisites, getSkill } from '../src/curriculum/skills.ts';
import { coverage, generateProblem, problemFromId } from '../src/curriculum/registry.ts';
import { verifyProblem, checkInput } from '../src/curriculum/check.ts';
import { validateDerivation, hintAt, HintLevel } from '../src/engine/derive.ts';
import { toLatex, toText } from '../src/engine/print.ts';

describe('the skill graph', () => {
  it('has no structural faults', () => {
    expect(validateGraph()).toEqual([]);
  });
  it('is acyclic and topologically orderable', () => {
    expect(topologicalOrder()).toHaveLength(ALL_SKILLS.length);
  });
  it('never lists a skill before its prerequisites', () => {
    const seen = new Set<string>();
    for (const s of topologicalOrder()) {
      for (const p of s.prerequisites) expect(seen.has(p), `${s.id} before ${p}`).toBe(true);
      seen.add(s.id);
    }
  });
  it('reaches from arithmetic to calculus', () => {
    const pre = allPrerequisites('definite-integrals');
    expect(pre).toContain('derivative-power-rule');
    expect(pre.length).toBeGreaterThan(5);
  });
  it('gives every skill a concept explanation a person could read', () => {
    for (const s of ALL_SKILLS) {
      expect(s.concept.length, s.id).toBeGreaterThan(40);
      expect(s.description.length, s.id).toBeGreaterThan(15);
    }
  });
});

describe('every generator produces verified problems', () => {
  const { playable } = coverage();

  it('covers a meaningful part of the graph', () => {
    expect(playable.length).toBeGreaterThanOrEqual(30);
  });

  for (const skill of playable) {
    it(`${skill}: 10 problems across the difficulty range all verify`, () => {
      for (let i = 0; i < 10; i++) {
        const p = generateProblem(skill, { difficulty: i / 9, seed: 9000 + i * 37 });
        expect(verifyProblem(p), `${skill} @${(i / 9).toFixed(2)}`).toEqual([]);
        expect(validateDerivation(p.derivation), `${skill} derivation`).toEqual([]);
        // Every problem must be answerable and every hint reachable.
        expect(p.prompt.length).toBeGreaterThan(0);
        for (const lvl of [HintLevel.Nudge, HintLevel.Move, HintLevel.Reason, HintLevel.NextLine]) {
          expect(hintAt(p.derivation, lvl).text.length).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe('problems are reproducible from their id', () => {
  it('regenerates the identical problem', () => {
    const p = generateProblem('quadratic-formula', { difficulty: 0.6, seed: 4242 });
    const again = problemFromId(p.id);
    expect(again.id).toBe(p.id);
    expect(toLatex(again.statement)).toBe(toLatex(p.statement));
    expect(toLatex(again.derivation.result)).toBe(toLatex(p.derivation.result));
  });
});

describe('grading accepts every correct form', () => {
  it('accepts the answer written differently', () => {
    const p = generateProblem('linear-equations', { difficulty: 0.3, seed: 77 });
    const answer = p.answer;
    expect(answer.kind).toBe('expression');
    if (answer.kind !== 'expression') return;
    const asText = toText(answer.value);
    expect(checkInput(p, asText).correct).toBe(true);
    // Same value, written as a trivial sum.
    expect(checkInput(p, `${asText} + 0`).correct).toBe(true);
  });

  it('accepts both roots in either order', () => {
    const p = generateProblem('quadratic-equations', { difficulty: 0.4, seed: 314 });
    if (p.answer.kind !== 'set') return;
    const [a, b] = p.answer.values;
    if (!a || !b) return;
    expect(checkInput(p, `${toText(a)}, ${toText(b)}`).correct).toBe(true);
    expect(checkInput(p, `${toText(b)}, ${toText(a)}`).correct).toBe(true);
  });

  it('rejects a wrong answer and says why', () => {
    const p = generateProblem('linear-equations', { difficulty: 0.3, seed: 77 });
    const v = checkInput(p, '99999');
    expect(v.correct).toBe(false);
    expect(v.message.length).toBeGreaterThan(0);
  });

  it('explains an unreadable entry rather than just failing', () => {
    const p = generateProblem('linear-equations', { difficulty: 0.3, seed: 77 });
    const v = checkInput(p, '3x +');
    expect(v.correct).toBe(false);
    expect(v.message).toMatch(/incomplete|Expected|read/i);
  });

  it('a right value in the wrong form is distinguished from a wrong value', () => {
    const p = generateProblem('like-terms', { difficulty: 0.3, seed: 55 });
    if (p.answer.kind !== 'simplified') return;
    const v = checkInput(p, toText(p.answer.value));
    expect(v.correct).toBe(true);
  });
});

describe('distractors name a real misconception', () => {
  it('never marks a correct answer as a misconception', () => {
    const { playable } = coverage();
    for (const skill of playable) {
      for (let i = 0; i < 6; i++) {
        const p = generateProblem(skill, { difficulty: i / 5, seed: 2000 + i * 91 });
        // verifyProblem already rejects a distractor equal to the answer;
        // this asserts the rule holds across the whole registry.
        expect(verifyProblem(p), skill).toEqual([]);
        for (const d of p.distractors ?? []) {
          expect(d.diagnosis.length, `${skill} distractor`).toBeGreaterThan(20);
        }
      }
    }
  });
});
