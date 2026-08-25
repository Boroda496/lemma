/**
 * Cross-device sync.
 *
 * The device stays the source of truth. Syncing is a background errand: pull
 * whatever the other devices left, merge it into the local database, and push
 * the result back. The app never waits on it and never blocks on it being
 * available — offline, the practice session is exactly as good, and the work
 * goes up on the next connection.
 *
 * Merging is a union, deliberately. Attempts are matched on time and problem,
 * and per-skill progress keeps whichever record has more attempts behind it.
 * Two devices used in the same hour therefore end up with the sum of both,
 * and no ordering of syncs can lose an answer. The cost of that choice is
 * that this system has no concept of deletion: clearing progress on one
 * device and then syncing pulls it back from the others. Wiping everywhere
 * means unlinking first, which is what the UI offers.
 */

import { exportAll, importAll, bigintReplacer, bigintReviver, type Backup } from './../store/db.ts';
import { deriveKeys, seal, open as unseal, WrongPassphrase, type Envelope } from './crypto.ts';

const CONFIG_KEY = 'lemma:sync:config';

export interface SyncConfig {
  /** Base URL of the worker, no trailing slash. */
  readonly endpoint: string;
  readonly access: string;
  readonly secret: string;
  readonly linkedAt: number;
}

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly lastSyncedAt: number | null;
  /** Plain-language problem, when there is one. */
  readonly error: string | null;
  /** Set when the stored data will not decrypt: the passphrase does not match. */
  readonly wrongPassphrase: boolean;
  /** Counts from the most recent successful merge. */
  readonly pulled: { skills: number; attempts: number } | null;
}

const IDLE: SyncStatus = {
  phase: 'off', lastSyncedAt: null, error: null, wrongPassphrase: false, pulled: null,
};

let status: SyncStatus = IDLE;
const listeners = new Set<(s: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

export function getStatus(): SyncStatus { return status; }

export function onStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// -------------------------------------------------------------------- config

export function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as SyncConfig;
    return cfg.endpoint && cfg.access && cfg.secret ? cfg : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: SyncConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

/**
 * Link this device.
 *
 * The passphrase is turned into keys here and then dropped; only the derived
 * keys are stored. That is no stronger against someone holding the unlocked
 * device — they can sync either way — but it does mean the passphrase itself
 * is not sitting in browser storage to be read back and tried elsewhere.
 */
export async function link(endpoint: string, passphrase: string): Promise<SyncConfig> {
  const clean = endpoint.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(clean)) throw new Error('The sync address should start with https://');
  const { access, secret } = await deriveKeys(passphrase);
  const cfg: SyncConfig = { endpoint: clean, access, secret, linkedAt: Date.now() };
  saveConfig(cfg);
  setStatus({ phase: 'idle', error: null, wrongPassphrase: false });
  return cfg;
}

/** Stop syncing here. Leaves the local database and the server copy alone. */
export function unlink(): void {
  localStorage.removeItem(CONFIG_KEY);
  status = IDLE;
  for (const fn of listeners) fn(status);
}

/** Delete the server copy outright. The local database is untouched. */
export async function forgetRemote(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;
  await fetch(`${cfg.endpoint}/v1/${cfg.access}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- the errand

interface Remote { backup: Backup; rev: string | null }

async function pull(cfg: SyncConfig): Promise<Remote | null> {
  const res = await fetch(`${cfg.endpoint}/v1/${cfg.access}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The sync service answered ${res.status}.`);
  const envelope = (await res.json()) as Envelope;
  const plain = await unseal(cfg.secret, envelope);
  return { backup: JSON.parse(plain, bigintReviver) as Backup, rev: res.headers.get('etag') };
}

async function push(cfg: SyncConfig, backup: Backup, rev: string | null): Promise<void> {
  const envelope = await seal(cfg.secret, JSON.stringify(backup, bigintReplacer));
  const res = await fetch(`${cfg.endpoint}/v1/${cfg.access}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(rev ? { 'if-match': rev } : {}) },
    body: JSON.stringify(envelope),
  });
  if (res.status === 412) throw new Stale();
  if (!res.ok) throw new Error(`The sync service refused the upload (${res.status}).`);
}

class Stale extends Error {}

/**
 * A cheap description of a database, to decide whether a push is worth making.
 *
 * Three devices that are merely open, not being used, should cost nothing.
 * Comparing counts and the newest timestamp catches every change this app can
 * make to its own history, and a false match would only delay a push to the
 * next sync rather than lose it.
 */
function fingerprint(b: Backup): string {
  const newest = b.attempts.reduce((m, a) => (a.at > m ? a.at : m), 0);
  const work = b.skillStates.reduce((n, s) => n + s.attempts, 0);
  return `${b.attempts.length}:${b.skillStates.length}:${work}:${newest}`;
}

let running: Promise<SyncStatus> | null = null;

/**
 * Pull, merge, push. Safe to call as often as you like: overlapping calls
 * share the one in flight rather than racing each other.
 */
export function syncNow(): Promise<SyncStatus> {
  if (running) return running;
  running = runSync().finally(() => { running = null; });
  return running;
}

async function runSync(attempt = 0): Promise<SyncStatus> {
  const cfg = loadConfig();
  if (!cfg) { setStatus({ phase: 'off' }); return status; }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ phase: 'offline', error: null });
    return status;
  }

  setStatus({ phase: 'syncing', error: null });
  try {
    const remote = await pull(cfg);

    let pulled: { skills: number; attempts: number } | null = null;
    if (remote) pulled = await importAll(remote.backup);

    // After the merge the local database contains both sides, so what is on
    // this device now *is* the merged copy — there is no second merge to do.
    const merged = await exportAll();

    if (!remote || fingerprint(remote.backup) !== fingerprint(merged)) {
      await push(cfg, merged, remote?.rev ?? null);
    }

    setStatus({
      phase: 'idle',
      lastSyncedAt: Date.now(),
      error: null,
      wrongPassphrase: false,
      pulled: pulled && (pulled.skills || pulled.attempts) ? pulled : null,
    });
    return status;
  } catch (err) {
    // Another device wrote between our read and our write. Its copy already
    // contains its own work; going round again merges ours on top of it.
    if (err instanceof Stale && attempt < 3) return runSync(attempt + 1);

    if (err instanceof WrongPassphrase) {
      setStatus({ phase: 'error', wrongPassphrase: true, error: err.message });
      return status;
    }
    // A failed fetch is almost always the network rather than the service,
    // and saying "offline" is both likelier to be true and more use.
    const offline = err instanceof TypeError;
    setStatus({
      phase: offline ? 'offline' : 'error',
      error: offline ? null : err instanceof Error ? err.message : String(err),
    });
    return status;
  }
}

// ------------------------------------------------------------------ scheduling

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Push soon, but not now.
 *
 * Called after every answer. Waiting a few seconds turns a ten-problem
 * session into one or two uploads instead of ten, which matters only because
 * staying far inside a free tier is the point of the whole design.
 */
export function syncSoon(delayMs = 6000): void {
  if (!loadConfig()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, delayMs);
}

/** Flush a pending push immediately — used when the app is being closed. */
export function syncNowIfPending(): void {
  if (timer) { clearTimeout(timer); timer = null; void syncNow(); }
}

/**
 * Sync on launch, when the app comes back to the foreground, and when the
 * network returns. Those three cover every way a phone actually gets used:
 * picked up, unlocked, walked back into signal.
 */
export function startAutoSync(onMerged: () => void): () => void {
  if (!loadConfig()) return () => {};

  const run = () => {
    void syncNow().then((s) => { if (s.pulled) onMerged(); });
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
    else syncNowIfPending();
  };

  run();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', run);
  window.addEventListener('pagehide', syncNowIfPending);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', run);
    window.removeEventListener('pagehide', syncNowIfPending);
  };
}
