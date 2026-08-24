/**
 * The skill map.
 *
 * Grouped by strand and ordered by prerequisite depth, so the shape of the
 * subject is visible rather than implied. A locked skill shows what it is
 * waiting on, because "come back later" is not useful and "finish factoring
 * quadratics first" is.
 */

import { useMemo, useState } from 'react';
import { ALL_SKILLS, getSkill, topologicalOrder } from './../curriculum/skills.ts';
import { hasGenerator } from './../curriculum/registry.ts';
import { masteryOf, isUnlocked, type MasteryBand } from './../mastery/model.ts';
import { stateFor } from './../mastery/scheduler.ts';
import type { Strand } from './../curriculum/types.ts';
import type { Learner } from './useLearner.ts';

const STRAND_NAMES: Record<Strand, string> = {
  arithmetic: 'Number',
  algebra: 'Algebra',
  geometry: 'Geometry',
  functions: 'Functions',
  trigonometry: 'Trigonometry',
  statistics: 'Statistics and probability',
  calculus: 'Calculus',
};

const STRAND_ORDER: Strand[] = [
  'arithmetic', 'algebra', 'geometry', 'functions', 'trigonometry', 'statistics', 'calculus',
];

const BAND_COLOUR: Record<MasteryBand, string> = {
  locked: 'var(--border-strong)',
  new: 'var(--border-strong)',
  learning: 'var(--accent)',
  practised: 'var(--accent)',
  solid: 'var(--gold)',
  mastered: 'var(--correct)',
};

const BAND_LABEL: Record<MasteryBand, string> = {
  locked: 'Locked',
  new: 'Not started',
  learning: 'Learning',
  practised: 'Practising',
  solid: 'Solid',
  mastered: 'Mastered',
};

export function MapView({ learner, onPractise }: {
  learner: Learner;
  onPractise: (skillId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const ratings = useMemo(() => Object.fromEntries(ALL_SKILLS.map((s) => [s.id, s.rating])), []);
  const full = useMemo(
    () => Object.fromEntries(ALL_SKILLS.map((s) => [s.id, stateFor(learner.states, s.id)])),
    [learner.states],
  );

  const order = useMemo(() => topologicalOrder(), []);
  const byStrand = useMemo(() => {
    const groups = new Map<Strand, typeof ALL_SKILLS[number][]>();
    // Strands are presented in a fixed order. Following the topological order
    // alone put Geometry above Algebra, because angle-chasing happens to be
    // rated easier than combining like terms -- true, and not how anyone
    // expects a syllabus to be laid out.
    for (const strand of STRAND_ORDER) groups.set(strand, []);
    for (const s of order) groups.get(s.strand)!.push(s);
    for (const [k, v] of groups) if (v.length === 0) groups.delete(k);
    return groups;
  }, [order]);

  return (
    <div className="page page--wide">
      <h1>The map</h1>
      <p className="subtitle">
        Everything the app can teach, in the order it builds. A topic opens once what it
        stands on is going well — not once it is perfect.
      </p>

      {[...byStrand.entries()].map(([strand, skills]) => (
        <section className="strand" key={strand}>
          <div className="strand__head">
            <h2 style={{ margin: 0 }}>{STRAND_NAMES[strand]}</h2>
            <span className="small faint">{skills.length} topics</span>
          </div>
          <div className="skillgrid">
            {skills.map((skill) => {
              const state = full[skill.id]!;
              const unlocked = isUnlocked(skill.prerequisites, full, ratings);
              const mastery = masteryOf(state, skill.rating, unlocked);
              const playable = hasGenerator(skill.id);
              const locked = mastery.band === 'locked';
              const isOpen = open === skill.id;

              return (
                <button
                  key={skill.id}
                  className={`skillcard ${locked || !playable ? 'skillcard--locked' : ''}`}
                  onClick={() => setOpen(isOpen ? null : skill.id)}
                  aria-expanded={isOpen}
                >
                  <div className="row row--between" style={{ gap: 8 }}>
                    <span className="skillcard__name">{skill.name}</span>
                    <span className="chip" style={{ color: BAND_COLOUR[mastery.band] }}>
                      {playable ? BAND_LABEL[mastery.band] : 'Soon'}
                    </span>
                  </div>

                  <div className="meter">
                    <div
                      className="meter__fill"
                      style={{ width: `${Math.round(mastery.fraction * 100)}%`, background: BAND_COLOUR[mastery.band] }}
                    />
                  </div>

                  <div className="skillcard__desc">{skill.description}</div>

                  {isOpen && (
                    <div style={{ marginTop: 2 }}>
                      <p className="small muted" style={{ margin: '0 0 9px' }}>{skill.concept}</p>

                      {locked && skill.prerequisites.length > 0 && (
                        <p className="small faint" style={{ margin: '0 0 9px' }}>
                          Opens after: {skill.prerequisites.map((p) => getSkill(p)?.name ?? p).join(', ')}.
                        </p>
                      )}
                      {!playable && (
                        <p className="small faint" style={{ margin: '0 0 9px' }}>
                          This topic is in the map but has no problems yet.
                        </p>
                      )}
                      {state.attempts > 0 && (
                        <p className="small faint" style={{ margin: '0 0 9px' }}>
                          {state.correct} of {state.attempts} correct
                          {state.stability > 0 && ` · holds for about ${formatDays(state.stability)}`}
                          {state.streak > 0 && ` · ${state.streak} in a row`}
                        </p>
                      )}

                      {playable && !locked && (
                        <span
                          role="button"
                          tabIndex={0}
                          className="btn btn--sm btn--primary"
                          onClick={(ev) => { ev.stopPropagation(); onPractise(skill.id); }}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') { ev.stopPropagation(); onPractise(skill.id); }
                          }}
                        >
                          Practise this
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function formatDays(days: number): string {
  if (days < 1) return 'less than a day';
  if (days < 14) return `${Math.round(days)} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}
