/**
 * The practice loop — the screen the app exists for.
 *
 * Three things are deliberate here:
 *
 * Hints are a ladder, not a switch. A nudge points at the right part of the
 * expression; the next rung names the move; then explains it; then shows one
 * line. Only the last rung gives the answer away, and each rung costs a little
 * credit, so asking is never free and never ruinous.
 *
 * Work in progress is not marked wrong. Typing an intermediate line into the
 * answer box is what a person does, and treating it as a failed attempt
 * punishes exactly the behaviour worth encouraging. Those lines are checked as
 * work instead, against the derivation.
 *
 * The next problem is generated while the current one is being answered, so
 * "Next" is instant even on a phone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Problem, Verdict } from './../curriculum/types.ts';
import { generateProblem, NoProblemAvailable } from './../curriculum/registry.ts';
import { checkInput, looksLikeWorkInProgress } from './../curriculum/check.ts';
import { getSkill } from './../curriculum/skills.ts';
import { chooseNext, problemRating, type Choice } from './../mastery/scheduler.ts';
import type { Attempt } from './../mastery/model.ts';
import { hintAt, HintLevel, progressOf, type Hint } from './../engine/derive.ts';
import { toLatex, approximate } from './../engine/print.ts';
import { tryParse } from './../engine/parse.ts';
import { MathView } from './MathView.tsx';
import { MathInput, type KeyboardFlavour } from './MathInput.tsx';
import { FigureView } from './FigureView.tsx';
import type { Learner } from './useLearner.ts';

interface Loaded {
  problem: Problem;
  choice: Choice;
}

export function Practice({ learner, focusSkill, onClearFocus }: {
  learner: Learner;
  focusSkill?: string;
  onClearFocus?: () => void;
}) {
  const [current, setCurrent] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [solved, setSolved] = useState(false);          // the problem is finished with
  const [gotItRight, setGotItRight] = useState(false);  // and it was answered correctly
  const [showSolution, setShowSolution] = useState(false);
  const [wrongTries, setWrongTries] = useState(0);
  const [workNote, setWorkNote] = useState<string | null>(null);

  const startedAt = useRef(Date.now());
  const recent = useRef<string[]>([]);
  const prefetched = useRef<Loaded | null>(null);

  const build = useCallback((): Loaded | null => {
    const choice = chooseNext(learner.states, {
      recent: recent.current,
      ...(focusSkill ? { focusSkill } : {}),
    });
    if (!choice) return null;
    try {
      const problem = generateProblem(choice.skillId, { difficulty: choice.difficulty });
      return { problem, choice };
    } catch (err) {
      if (err instanceof NoProblemAvailable) return null;
      throw err;
    }
  }, [learner.states, focusSkill]);

  const load = useCallback(() => {
    setAnswer('');
    setVerdict(null);
    setHints([]);
    setSolved(false);
    setGotItRight(false);
    setShowSolution(false);
    setWrongTries(0);
    setWorkNote(null);
    startedAt.current = Date.now();

    const next = prefetched.current ?? build();
    prefetched.current = null;
    if (!next) {
      setCurrent(null);
      setError('Nothing is available to practise right now.');
      return;
    }
    setError(null);
    setCurrent(next);
    recent.current = [...recent.current, next.choice.skillId].slice(-8);
  }, [build]);

  useEffect(() => { if (learner.ready) load(); }, [learner.ready, focusSkill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate the following problem in the background so "Next" never waits.
  useEffect(() => {
    if (!current || prefetched.current) return;
    const id = window.setTimeout(() => {
      try { prefetched.current = build(); } catch { prefetched.current = null; }
    }, 400);
    return () => window.clearTimeout(id);
  }, [current, build]);

  const skill = current ? getSkill(current.problem.skill) : undefined;

  const flavour: KeyboardFlavour = useMemo(() => {
    if (!skill) return 'algebra';
    if (skill.strand === 'geometry') return 'geometry';
    if (skill.strand === 'arithmetic') return 'numeric';
    return 'algebra';
  }, [skill]);

  const check = useCallback(() => {
    if (!current || solved || !answer.trim()) return;

    // An intermediate line is work, not a wrong answer.
    if (looksLikeWorkInProgress(current.problem, answer)) {
      const parsed = tryParse(answer);
      if ('expr' in parsed) {
        const done = progressOf(current.problem.derivation, parsed.expr);
        setWorkNote(done > 0
          ? `That line is right — you are ${done} step${done === 1 ? '' : 's'} in. Keep going.`
          : 'That looks like working rather than a final answer. Carry on, or enter the value you end up with.');
        return;
      }
    }
    setWorkNote(null);

    const v = checkInput(current.problem, answer);
    setVerdict(v);

    if (v.correct) {
      setSolved(true);
      setGotItRight(true);
      const highestHint = hints.length ? Math.max(...hints.map((h) => h.level)) : -1;
      const attempt: Attempt = {
        skillId: current.problem.skill,
        problemId: current.problem.id,
        correct: true,
        hintLevel: highestHint,
        wrongTries,
        seconds: Math.round((Date.now() - startedAt.current) / 1000),
        at: Date.now(),
        problemRating: problemRating(getSkill(current.problem.skill)!, current.choice.difficulty),
      };
      learner.submit(attempt);
    } else if (!v.needsSimplifying) {
      setWrongTries((n) => n + 1);
    }
  }, [current, answer, solved, hints, wrongTries, learner]);

  const nextHint = useCallback(() => {
    if (!current) return;
    const done = progressOfCurrent(current, answer);
    const level = (hints.length ? Math.max(...hints.map((h) => h.level)) + 1 : HintLevel.Nudge) as HintLevel;
    if (level > HintLevel.Full) return;
    setHints((prev) => [...prev, hintAt(current.problem.derivation, level, done)]);
    if (level >= HintLevel.Full) setShowSolution(true);
  }, [current, hints, answer]);

  const giveUp = useCallback(() => {
    if (!current || solved) return;
    setShowSolution(true);
    const attempt: Attempt = {
      skillId: current.problem.skill,
      problemId: current.problem.id,
      correct: false,
      hintLevel: HintLevel.Full,
      wrongTries,
      seconds: Math.round((Date.now() - startedAt.current) / 1000),
      at: Date.now(),
      problemRating: problemRating(getSkill(current.problem.skill)!, current.choice.difficulty),
    };
    learner.submit(attempt);
    setSolved(true);
  }, [current, solved, wrongTries, learner]);

  if (!learner.ready) return <div className="page"><p className="muted">Loading…</p></div>;

  if (error || !current) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty__glyph">✓</div>
          <h2>Nothing due right now</h2>
          <p className="muted">
            Everything available is fresh. Open the map to start a new topic, or come back
            when a review falls due.
          </p>
          {focusSkill && (
            <button className="btn" onClick={onClearFocus} style={{ marginTop: 12 }}>
              Back to the full mix
            </button>
          )}
        </div>
      </div>
    );
  }

  const { problem, choice } = current;
  const approx = learner.settings.showApproximations && solved ? approximationFor(problem) : null;

  return (
    <div className="page">
      <div className="row row--between row--wrap" style={{ marginBottom: 14 }}>
        <div className="row row--wrap" style={{ gap: 7 }}>
          <span className={`chip ${choice.kind === 'review' ? 'chip--gold' : 'chip--accent'}`}>
            {choice.kind === 'review' ? 'Review' : choice.kind === 'new' ? 'New' : choice.kind === 'stretch' ? 'Stretch' : 'Practice'}
          </span>
          <span className="chip">{skill?.name ?? problem.skill}</span>
        </div>
        {focusSkill && (
          <button className="btn btn--ghost btn--sm" onClick={onClearFocus}>Leave focus</button>
        )}
      </div>

      <div className="card">
        <div className="problem__prompt">{problem.prompt}</div>
        {problem.context && <div className="problem__context">{problem.context}</div>}
        {problem.figure && <FigureView figure={problem.figure} />}
        <div className="problem__statement">
          <MathView latex={toLatex(problem.statement)} size="lg" />
        </div>

        <MathInput
          value={answer}
          onChange={(v) => { setAnswer(v); setWorkNote(null); if (verdict && !verdict.correct) setVerdict(null); }}
          onSubmit={solved ? load : check}
          flavour={flavour}
          // Finishing by revealing the solution is not the same as getting it
          // right, and a green ring around a wrong answer says it was.
          status={gotItRight ? 'correct' : verdict && !verdict.correct ? 'wrong' : null}
          autoFocus
        />

        {workNote && (
          <div className="verdict verdict--partial" style={{ marginTop: 12 }}>
            <span className="verdict__glyph">↻</span>
            <span>{workNote}</span>
          </div>
        )}

        {verdict && (
          <div
            className={`verdict ${verdict.correct ? 'verdict--correct' : verdict.needsSimplifying ? 'verdict--partial' : 'verdict--wrong'}`}
            style={{ marginTop: 12 }}
            role="status"
          >
            <span className="verdict__glyph">{verdict.correct ? '✓' : verdict.needsSimplifying ? '≈' : '✗'}</span>
            <div>
              <div>{verdict.message}</div>
              {approx && <div className="small faint" style={{ marginTop: 3 }}>≈ {approx}</div>}
              {verdict.evidence && !verdict.correct && (
                <details style={{ marginTop: 6 }}>
                  <summary className="small faint" style={{ cursor: 'pointer' }}>How this was checked</summary>
                  <div className="small faint" style={{ marginTop: 4 }}>{verdict.evidence.detail}</div>
                </details>
              )}
            </div>
          </div>
        )}

        <div className="row row--wrap" style={{ marginTop: 15, gap: 9 }}>
          {!solved && (
            <button className="btn btn--primary" onClick={check} disabled={!answer.trim()}>
              Check
            </button>
          )}
          {solved && (
            <button className="btn btn--primary" onClick={load}>Next problem</button>
          )}
          {!solved && hints.length <= HintLevel.Full && (
            <button className="btn" onClick={nextHint}>
              {hints.length === 0 ? 'Hint' : 'More help'}
            </button>
          )}
          {!solved && (
            <button className="btn btn--ghost" onClick={giveUp}>Show the solution</button>
          )}
          {solved && !showSolution && (
            <button className="btn" onClick={() => setShowSolution(true)}>See the working</button>
          )}
        </div>
      </div>

      {hints.length > 0 && (
        <div className="card">
          <h2>Help</h2>
          <div className="hints">
            {hints.map((h, i) => (
              <div className="hint" key={i}>
                <div className="hint__label">{HINT_LABELS[h.level] ?? 'Hint'}</div>
                <div>{h.text}</div>
                {h.latex && h.level >= HintLevel.NextLine && (
                  <div style={{ marginTop: 7 }}><MathView latex={h.latex} /></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showSolution && !gotItRight && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>The answer</div>
          <MathView latex={answerLatex(problem)} size="lg" />
        </div>
      )}

      {showSolution && <Solution problem={problem} />}

      {skill && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 5 }}>The idea</div>
          <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>{skill.concept}</p>
        </div>
      )}
    </div>
  );
}

const HINT_LABELS: Record<number, string> = {
  [HintLevel.Nudge]: 'Where to look',
  [HintLevel.Move]: 'The move',
  [HintLevel.Reason]: 'Why',
  [HintLevel.NextLine]: 'The next line',
  [HintLevel.Full]: 'Full solution',
};

function Solution({ problem }: { problem: Problem }) {
  const d = problem.derivation;
  return (
    <div className="card">
      <h2>Worked solution</h2>
      <div className="steps">
        <div className="step">
          <div className="step__n">·</div>
          <div>
            <div className="step__title">{d.goal}</div>
            <div className="step__math"><MathView latex={toLatex(d.start)} /></div>
          </div>
        </div>
        {d.steps.map((s, i) => (
          <div className="step" key={i}>
            <div className="step__n">{i + 1}</div>
            <div>
              <div className="step__title">{s.title}</div>
              <div className="step__detail">{s.detail}</div>
              <div className="step__math"><MathView latex={toLatex(s.to)} /></div>
              <div className="step__proof" title={s.evidence.detail}>
                <span>{s.evidence.method === 'undecided' ? '△' : '✓'}</span>
                <span>
                  {s.evidence.method === 'undecided'
                    ? 'Changes the statement — see note'
                    : `Verified (${s.evidence.method}${s.evidence.probes ? `, ${s.evidence.probes} probes` : ''})`}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {d.incomplete && (
        <p className="small muted" style={{ marginTop: 10 }}>{d.incomplete}</p>
      )}
    </div>
  );
}

function progressOfCurrent(current: Loaded, answer: string): number {
  if (!answer.trim()) return 0;
  const parsed = tryParse(answer);
  if (!('expr' in parsed)) return 0;
  return progressOf(current.problem.derivation, parsed.expr);
}

/** The stated answer, rendered for the "you gave up" panel. */
function answerLatex(problem: Problem): string {
  const spec = problem.answer;
  switch (spec.kind) {
    case 'expression': case 'simplified': case 'number':
      return toLatex(spec.value);
    case 'set':
      return spec.values.map((v) => toLatex(v)).join(', \\; ');
    case 'tuple':
      return spec.values.map((v, i) => `${spec.labels?.[i] ?? ''} = ${toLatex(v)}`).join(', \\; ');
    case 'choice':
      return `\\text{${spec.options[spec.correct] ?? ''}}`;
    case 'special':
      return spec.value === 'no-solution' ? '\\text{no solution}' : '\\text{every value}';
  }
}

function approximationFor(problem: Problem): string | null {
  const spec = problem.answer;
  const value = spec.kind === 'expression' || spec.kind === 'simplified' || spec.kind === 'number'
    ? spec.value : null;
  if (!value) return null;
  const approx = approximate(value, 4);
  const exact = toLatex(value);
  // Only worth showing when the exact form is not already a plain decimal.
  return approx && approx !== exact.replace(/[{}\\]/g, '') ? approx : null;
}
