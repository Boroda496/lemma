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
import {
  exportAll, importAll, clearAll, restoreFromSnapshot, readSnapshotMeta,
  writeSnapshot, buildIdentity, requestPersistence, isFirefox,
  bigintReplacer, bigintReviver, type Backup, type StorageStatus,
} from './../store/db.ts';
import type { Learner } from './useLearner.ts';
import {
  link, unlink, loadConfig, syncNow, forgetRemote, type SyncStatus,
} from './../sync/client.ts';
import { DEFAULT_ENDPOINT } from './../sync/endpoint.ts';

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
      const blob = new Blob([JSON.stringify(data, bigintReplacer, 2)], { type: 'application/json' });
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
      const parsed = JSON.parse(text, bigintReviver) as Backup;
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

      {learner.recovered && (
        <div className="verdict verdict--partial" style={{ marginBottom: 14 }}>
          <span className="verdict__glyph">↻</span>
          <span>
            The browser had cleared the database, so {learner.recovered.attempts} attempts and{' '}
            {learner.recovered.skills} topics were restored from the local backup.
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

      <SyncPanel learner={learner} onMessage={setMessage} />

      <StoragePanel learner={learner} onMessage={setMessage} />

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
          A backup file is a complete copy you keep yourself — useful before a big change,
          or to move onto a device you would rather not link.
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
          <button
            className="btn btn--sm"
            onClick={async () => {
              try {
                const data = await exportAll();
                await navigator.clipboard.writeText(JSON.stringify(data, bigintReplacer));
                setMessage('Copied. Paste it into the other copy with "Paste transfer".');
              } catch {
                setMessage('The browser would not give access to the clipboard. Use the file export instead.');
              }
            }}
          >
            Copy transfer
          </button>
          <button
            className="btn btn--sm"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                const result = await importAll(JSON.parse(text, bigintReviver) as Backup);
                learner.reload();
                setMessage(`Merged in ${result.skills} topics and ${result.attempts} attempts.`);
              } catch {
                setMessage('Nothing usable on the clipboard. Copy from the other copy first.');
              }
            }}
          >
            Paste transfer
          </button>
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

/**
 * Durability, stated plainly.
 *
 * Two copies of this app on two origins have two separate databases, which is
 * the single most confusing thing about running it from both a dev server and
 * an installed URL. Naming the copy you are looking at, and offering a
 * one-press transfer, is cheaper than explaining browser origins.
 */
function StoragePanel({ learner, onMessage }: {
  learner: Learner;
  onMessage: (m: string) => void;
}) {
  const identity = buildIdentity();
  const snapshot = readSnapshotMeta();
  // The panel can update the status itself, without waiting for a reload.
  const [localStatus, setLocalStorageStatus] = useState<StorageStatus | null>(null);
  const storage = localStatus ?? learner.storage;

  return (
    <div className="card">
      <h2>Storage</h2>

      <div className="stack" style={{ gap: 10 }}>
        <div className="row row--between">
          <span>This copy</span>
          <span className={`chip ${identity.isDev ? 'chip--gold' : 'chip--accent'}`}>
            {identity.label}
          </span>
        </div>
        <p className="small faint" style={{ margin: '-4px 0 0' }}>
          {identity.origin}. Each address keeps its own separate history — the browser
          does not share data between them.
        </p>

        <div className="row row--between">
          <span>Durable</span>
          <span className={`chip ${storage?.persistent ? 'chip--correct' : 'chip--gold'}`}>
            {storage === null ? 'checking…' : storage.persistent ? 'Yes' : 'Best effort'}
          </span>
        </div>
        {storage && !storage.persistent && (
          <>
            <p className="small faint" style={{ margin: '-4px 0 0' }}>{storage.note}</p>
            <button
              className="btn btn--sm btn--primary"
              onClick={async () => {
                // Firefox only shows its prompt in response to a click, so the
                // request on page load can never succeed there. This button is
                // the only path to permanent storage in that browser.
                const next = await requestPersistence();
                setLocalStorageStatus(next);
                onMessage(next.persistent
                  ? 'Storage is now permanent — the browser will not clear it.'
                  : 'The browser declined. Your work is still backed up locally and can be exported.');
              }}
            >
              Make storage permanent
            </button>
            {isFirefox() && (
              <p className="small faint" style={{ margin: '-2px 0 0' }}>
                Also check that Firefox is not set to clear cookies and site data on exit,
                under Settings → Privacy &amp; Security.
              </p>
            )}
          </>
        )}

        {storage?.usedBytes != null && (
          <div className="row row--between">
            <span className="small muted">Using</span>
            <span className="small faint">
              {formatBytes(storage.usedBytes)}
              {storage.quotaBytes ? ` of ${formatBytes(storage.quotaBytes)} available` : ''}
            </span>
          </div>
        )}

        <hr className="divider" style={{ margin: '4px 0' }} />

        <div className="row row--between">
          <span>Local backup</span>
          <span className="small faint">
            {snapshot
              ? `${snapshot.attempts} attempts, saved ${relativeDay(snapshot.at)}`
              : 'none yet'}
          </span>
        </div>
        <p className="small faint" style={{ margin: '-4px 0 0' }}>
          A second copy is kept separately from the main database and put back automatically
          if the browser ever clears it.
        </p>
        <div className="row row--wrap" style={{ gap: 8 }}>
          <button
            className="btn btn--sm"
            onClick={async () => {
              const ok = await writeSnapshot();
              onMessage(ok ? 'Local backup updated.' : 'Could not write the local backup.');
            }}
          >
            Back up now
          </button>
          <button
            className="btn btn--sm"
            onClick={async () => {
              const result = await restoreFromSnapshot();
              learner.reload();
              onMessage(result
                ? `Restored ${result.attempts} attempts and ${result.skills} topics.`
                : 'There is no local backup to restore.');
            }}
          >
            Restore from backup
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Linking devices.
 *
 * The whole of the setup is one passphrase, typed the same on each device.
 * There is no account to make and no address to copy, because the address is
 * built in and the passphrase is what proves the devices are the same
 * person's. The one thing this panel has to be honest about is that a
 * forgotten passphrase cannot be reset by anyone, including us — nothing that
 * could reverse it exists.
 */
function SyncPanel({ learner, onMessage }: {
  learner: Learner;
  onMessage: (m: string) => void;
}) {
  const [config, setConfig] = useState(() => loadConfig());
  const [passphrase, setPassphrase] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [endpoint, setEndpoint] = useState(() => loadConfig()?.endpoint || DEFAULT_ENDPOINT);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const status = learner.sync;

  const linked = config !== null;
  const mismatch = confirmPhrase.length > 0 && confirmPhrase !== passphrase;
  const canLink = passphrase.trim().length >= 8 && !mismatch && endpoint.trim().length > 0 && !busy;

  const doLink = async () => {
    setBusy(true);
    try {
      const cfg = await link(endpoint, passphrase);
      setConfig(cfg);
      setPassphrase('');
      setConfirmPhrase('');
      const result = await syncNow();
      learner.reload();
      onMessage(
        result.wrongPassphrase
          ? 'There is already data saved under a different passphrase at this address.'
          : result.phase === 'idle'
            ? 'Linked. This device is now in sync.'
            : 'Linked, but the first sync did not complete. It will retry on its own.',
      );
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not link this device.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Sync across devices</h2>

      {!linked && (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            Type the same passphrase on your phone, tablet and desktop and they share one
            history. Progress merges both ways — you can answer problems on any of them,
            in any order, offline included.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Passphrase (at least 8 characters)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Type it again"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
            />
            {mismatch && <p className="small faint" style={{ margin: 0 }}>Those do not match.</p>}
            <p className="small faint" style={{ margin: 0 }}>
              Your progress is encrypted with this passphrase before it leaves the device, so
              the service that stores it cannot read it. Nobody can reset it for you — if it is
              forgotten, the stored copy is unreadable and you start again from whatever is on
              your devices.
            </p>
            <div className="row row--wrap" style={{ gap: 8 }}>
              <button className="btn btn--sm btn--primary" disabled={!canLink} onClick={doLink}>
                {busy ? 'Linking…' : 'Link this device'}
              </button>
              <button className="btn btn--sm btn--ghost" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide address' : 'Change address'}
              </button>
            </div>
            {showAdvanced && (
              <input
                className="input"
                type="url"
                placeholder="https://lemma-sync.…workers.dev"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            )}
          </div>
        </>
      )}

      {linked && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row row--between">
            <span>Status</span>
            <span className={`chip ${chipFor(status)}`}>{describe(status)}</span>
          </div>
          {status.lastSyncedAt && (
            <p className="small faint" style={{ margin: '-4px 0 0' }}>
              Last synced {relativeTime(status.lastSyncedAt)}.
            </p>
          )}
          {status.wrongPassphrase && (
            <p className="small faint" style={{ margin: '-4px 0 0' }}>
              The stored copy was written with a different passphrase. Unlink and link again with
              the one you used on your other devices.
            </p>
          )}
          {status.error && !status.wrongPassphrase && (
            <p className="small faint" style={{ margin: '-4px 0 0' }}>{status.error}</p>
          )}
          {status.phase === 'offline' && (
            <p className="small faint" style={{ margin: '-4px 0 0' }}>
              Keep practising — everything is saved here and goes up when you are back online.
            </p>
          )}

          <div className="row row--wrap" style={{ gap: 8 }}>
            <button
              className="btn btn--sm btn--primary"
              disabled={status.phase === 'syncing'}
              onClick={async () => {
                const result = await syncNow();
                learner.reload();
                onMessage(
                  result.pulled
                    ? `Brought in ${result.pulled.attempts} attempts from your other devices.`
                    : result.phase === 'idle'
                      ? 'Up to date.'
                      : 'Could not reach the sync service. It will retry on its own.',
                );
              }}
            >
              Sync now
            </button>
            <button
              className="btn btn--sm"
              onClick={() => {
                if (!confirm('Stop syncing on this device? Your progress here is kept.')) return;
                unlink();
                setConfig(null);
                onMessage('This device no longer syncs. Nothing was deleted.');
              }}
            >
              Unlink this device
            </button>
            <span className="spacer" />
            <button
              className="btn btn--sm btn--ghost"
              onClick={async () => {
                if (!confirm('Delete the shared copy for every device? Progress on this device is kept.')) return;
                await forgetRemote();
                unlink();
                setConfig(null);
                onMessage('The shared copy is gone. This device kept its own progress.');
              }}
            >
              Delete shared copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function chipFor(s: SyncStatus): string {
  if (s.phase === 'idle') return 'chip--correct';
  if (s.phase === 'error') return 'chip--gold';
  return 'chip--accent';
}

function describe(s: SyncStatus): string {
  switch (s.phase) {
    case 'idle': return 'In sync';
    case 'syncing': return 'Syncing…';
    case 'offline': return 'Offline';
    case 'error': return 'Needs attention';
    default: return 'Not linked';
  }
}

function relativeTime(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return relativeDay(at);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
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
  if (days < -1) return `${Math.round(-days)} days ago`;
  if (days < 0) return 'today';
  if (days < 1) return 'today';
  if (days < 2) return 'tomorrow';
  if (days < 14) return `in ${Math.round(days)} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

