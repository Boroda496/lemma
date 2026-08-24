/**
 * Progress, and the settings that belong next to it.
 *
 * The numbers shown are the ones that reflect learning rather than activity:
 * how much is durable, what is due, how the last stretch of attempts went.
 * Total problems answered is in there too, but it is deliberately not the
 * headline — it is the number that goes up whether or not anything is sinking in.
 */

import { useMemo, useRef, useState } from 'react';
import { ALL_SKILLS, getSkill } from './../curriculum/skills.ts';
import { progressSummary, stateFor } from './../mastery/scheduler.ts';
import { masteryOf } from './../mastery/model.ts';
import { exportAll, importAll, clearAll, type Backup } from './../store/db.ts';
import type { Learner } from './useLearner.ts';

export function ProgressView({ learner }: { learner: Learner }) {
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => progressSummary(learner.states), [learner.states]);

  const recent = learner.attempts.slice(0, 40);
  const recentRate = recent.length
    ? Math.round((recent.filter((a) => a.correct).length / recent.length) * 100)
    : null;

  const dueSoon = useMemo(() => {
    const now = Date.now();
    return ALL_SKILLS
      .map((s) => ({ skill: s, state: stateFor(learner.states, s.id) }))
      .filter((x) => x.state.introduced && x.state.dueAt !== null)
      .sort((a, b) => (a.state.dueAt ?? 0) - (b.state.dueAt ?? 0))
      .slice(0, 6)
      .map((x) => ({
        name: x.skill.name,
        due: x.state.dueAt!,
        overdue: x.state.dueAt! <= now,
      }));
  }, [learner.states]);

  const strongest = useMemo(() => {
    return ALL_SKILLS
      .map((s) => ({ skill: s, state: stateFor(learner.states, s.id) }))
      .filter((x) => x.state.attempts > 0)
      .sort((a, b) => b.state.rating - a.state.rating)
      .slice(0, 5);
  }, [learner.states]);

  const doExport = async () => {
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data, replacer, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lemma-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Backup saved.');
    } catch (err) {
      setMessage(`Could not export: ${(err as Error).message}`);
    }
  };

  const doImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text, reviver) as Backup;
      const result = await importAll(parsed);
      learner.reload();
      setMessage(`Restored ${result.skills} topics and ${result.attempts} attempts.`);
    } catch (err) {
      setMessage(`Could not import: ${(err as Error).message}`);
    }
  };

  return (
    <div className="page">
      <h1>Progress</h1>
      <p className="subtitle">Where things stand, and what is coming back around.</p>

      {!learner.persistent && (
        <div className="verdict verdict--wrong" style={{ marginBottom: 14 }}>
          <span className="verdict__glyph">!</span>
          <span>
            This browser will not let the app store anything, so nothing from this session
            will be here next time. A private window is the usual cause.
          </span>
        </div>
      )}

      <div className="stats">
        <Stat value={summary.mastered} label="Mastered" />
        <Stat value={summary.solid} label="Solid" />
        <Stat value={summary.inProgress} label="In progress" />
        <Stat value={summary.dueNow} label="Due now" />
      </div>

      <div className="card">
        <h2>Recent form</h2>
        {recentRate === null ? (
          <p className="muted" style={{ margin: 0 }}>Nothing answered yet.</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {recentRate}% right over the last {recent.length} problems.
              {recentRate >= 90 && ' The problems are coming a little easy — expect them to get harder.'}
              {recentRate < 55 && ' That is a hard stretch. The difficulty adjusts down automatically.'}
              {recentRate >= 55 && recentRate < 90 && ' That is about the right level to be working at.'}
            </p>
            <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
              {recent.slice().reverse().map((a, i) => (
                <span
                  key={i}
                  title={`${getSkill(a.skillId)?.name ?? a.skillId} — ${a.correct ? 'correct' : 'missed'}`}
                  style={{
                    width: 11, height: 11, borderRadius: 3,
                    background: a.correct ? 'var(--correct)' : 'var(--wrong)',
                    opacity: a.hintLevel >= 0 ? 0.5 : 1,
                  }}
                />
              ))}
            </div>
            <p className="small faint" style={{ marginBottom: 0, marginTop: 8 }}>
              Faded squares are ones where you used a hint.
            </p>
          </>
        )}
      </div>

      {dueSoon.length > 0 && (
        <div className="card">
          <h2>Coming up for review</h2>
          <div className="stack" style={{ gap: 8 }}>
            {dueSoon.map((d) => (
              <div className="row row--between" key={d.name}>
                <span>{d.name}</span>
                <span className={`chip ${d.overdue ? 'chip--gold' : ''}`}>
                  {d.overdue ? 'Due now' : relativeDay(d.due)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {strongest.length > 0 && (
        <div className="card">
          <h2>Strongest topics</h2>
          <div className="stack" style={{ gap: 8 }}>
            {strongest.map(({ skill, state }) => {
              const m = masteryOf(state, skill.rating, true);
              return (
                <div key={skill.id}>
                  <div className="row row--between">
                    <span>{skill.name}</span>
                    <span className="small faint">{m.summary}</span>
                  </div>
                  <div className="meter" style={{ marginTop: 4 }}>
                    <div className="meter__fill" style={{ width: `${Math.round(m.fraction * 100)}%`, background: 'var(--accent)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Settings</h2>
        <div className="stack">
          <label className="row row--between">
            <span>Theme</span>
            <select
              className="btn btn--sm"
              value={learner.settings.theme}
              onChange={(e) => learner.updateSettings({ theme: e.target.value as 'system' | 'light' | 'dark' })}
            >
              <option value="system">Match the device</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className="row row--between">
            <span>Show decimal approximations</span>
            <input
              type="checkbox"
              checked={learner.settings.showApproximations}
              onChange={(e) => learner.updateSettings({ showApproximations: e.target.checked })}
              style={{ width: 20, height: 20 }}
            />
          </label>
        </div>

        <hr className="divider" />

        <h3>Your data</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Everything is stored on this device only. Export a backup to move to another one.
        </p>
        <div className="row row--wrap" style={{ gap: 8 }}>
          <button className="btn btn--sm" onClick={doExport}>Export backup</button>
          <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>Import backup</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }}
          />
          <span className="spacer" />
          <button
            className="btn btn--sm btn--ghost"
            onClick={async () => {
              if (!confirm('Delete all progress on this device? This cannot be undone.')) return;
              await clearAll();
              learner.reload();
              setMessage('Everything cleared.');
            }}
          >
            Reset everything
          </button>
        </div>
        {message && <p className="small muted" style={{ marginBottom: 0 }}>{message}</p>}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function relativeDay(at: number): string {
  const days = (at - Date.now()) / 86_400_000;
  if (days < 1) return 'today';
  if (days < 2) return 'tomorrow';
  if (days < 14) return `in ${Math.round(days)} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** BigInt does not survive JSON on its own; tag it so a backup round-trips. */
function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { __bigint: value.toString() } : value;
}
function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__bigint' in (value as Record<string, unknown>)) {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}
