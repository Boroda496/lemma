/**
 * Local-first storage on IndexedDB.
 *
 * Everything lives on the device. There is no account, no server, and nothing
 * to configure before the app works — open it and it runs, offline included.
 * The trade-off is that progress does not follow you between devices on its
 * own, so export/import is a first-class feature rather than an afterthought.
 *
 * Attempts store only the problem id, never the problem. Ids regenerate the
 * problem exactly, so the history stays small and reviewing an old problem
 * rebuilds it rather than reading a stale copy.
 */

import type { SkillState, Attempt } from './../mastery/model.ts';

const DB_NAME = 'lemma';
const DB_VERSION = 1;

const STORE_SKILLS = 'skillStates';
const STORE_ATTEMPTS = 'attempts';
const STORE_SETTINGS = 'settings';

export interface Settings {
  /** Preferred session length. */
  sessionLength: number;
  /** Show the decimal approximation under exact answers. */
  showApproximations: boolean;
  /** Reduce animation. */
  reducedMotion: boolean;
  /** 'system' follows the device. */
  theme: 'system' | 'light' | 'dark';
  /** Skip the tutorial once it has been seen. */
  seenIntro: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sessionLength: 10,
  showApproximations: true,
  reducedMotion: false,
  theme: 'system',
  seenIntro: false,
};

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SKILLS)) {
        db.createObjectStore(STORE_SKILLS, { keyPath: 'skillId' });
      }
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        const store = db.createObjectStore(STORE_ATTEMPTS, { autoIncrement: true });
        store.createIndex('at', 'at');
        store.createIndex('skillId', 'skillId');
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database.'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Storage request failed.'));
      }),
  );
}

// ------------------------------------------------------------------ skill states

export async function loadSkillStates(): Promise<Record<string, SkillState>> {
  const all = await tx<SkillState[]>(STORE_SKILLS, 'readonly', (s) => s.getAll() as IDBRequest<SkillState[]>);
  return Object.fromEntries(all.map((s) => [s.skillId, s]));
}

export async function saveSkillState(state: SkillState): Promise<void> {
  await tx(STORE_SKILLS, 'readwrite', (s) => s.put(state));
}

// --------------------------------------------------------------------- attempts

export async function recordAttempt(a: Attempt): Promise<void> {
  await tx(STORE_ATTEMPTS, 'readwrite', (s) => s.add(a));
}

export async function loadAttempts(limit = 2000): Promise<Attempt[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out: Attempt[] = [];
    const t = db.transaction(STORE_ATTEMPTS, 'readonly');
    // Newest first, so a partial read is still the useful part.
    const req = t.objectStore(STORE_ATTEMPTS).index('at').openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) { resolve(out); return; }
      out.push(cursor.value as Attempt);
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error('Could not read attempts.'));
  });
}

// --------------------------------------------------------------------- settings

export async function loadSettings(): Promise<Settings> {
  const stored = await tx<Partial<Settings> | undefined>(
    STORE_SETTINGS, 'readonly', (s) => s.get('settings') as IDBRequest<Partial<Settings> | undefined>,
  );
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await tx(STORE_SETTINGS, 'readwrite', (s) => s.put(settings, 'settings'));
}

// ------------------------------------------------------------- export / import

export interface Backup {
  readonly version: 1;
  readonly exportedAt: string;
  readonly skillStates: SkillState[];
  readonly attempts: Attempt[];
  readonly settings: Settings;
}

export async function exportAll(): Promise<Backup> {
  const [states, attempts, settings] = await Promise.all([
    loadSkillStates(), loadAttempts(100000), loadSettings(),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    skillStates: Object.values(states),
    attempts,
    settings,
  };
}

/**
 * Restore a backup.
 *
 * Merges rather than replaces: a skill present in both keeps whichever record
 * has more attempts behind it. Overwriting wholesale would let restoring an
 * old export silently discard newer work.
 */
export async function importAll(backup: Backup): Promise<{ skills: number; attempts: number }> {
  if (backup.version !== 1) throw new Error('That backup was made by a different version.');

  const existing = await loadSkillStates();
  let skills = 0;
  for (const incoming of backup.skillStates) {
    const current = existing[incoming.skillId];
    if (!current || incoming.attempts > current.attempts) {
      await saveSkillState(incoming);
      skills++;
    }
  }

  const known = new Set((await loadAttempts(100000)).map((a) => `${a.at}:${a.problemId}`));
  let attempts = 0;
  for (const a of backup.attempts) {
    if (known.has(`${a.at}:${a.problemId}`)) continue;
    await recordAttempt(a);
    attempts++;
  }
  return { skills, attempts };
}

/** Wipe everything. Used by the reset control, which confirms first. */
export async function clearAll(): Promise<void> {
  const db = await open();
  await Promise.all([STORE_SKILLS, STORE_ATTEMPTS, STORE_SETTINGS].map(
    (name) => new Promise<void>((resolve, reject) => {
      const t = db.transaction(name, 'readwrite');
      const req = t.objectStore(name).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }),
  ));
}

/**
 * Is storage actually usable? Private windows and locked-down browsers can
 * refuse IndexedDB entirely, and the app should say so rather than silently
 * losing every session.
 */
export async function storageAvailable(): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- durability

export interface StorageStatus {
  /** IndexedDB is reachable at all. */
  readonly available: boolean;
  /**
   * The browser has promised not to evict this data automatically. Without
   * this, IndexedDB is "best-effort" and can be cleared under storage
   * pressure without warning — which for this app means losing every session.
   */
  readonly persistent: boolean;
  /** Bytes in use, when the browser will say. */
  readonly usedBytes: number | null;
  readonly quotaBytes: number | null;
  /** Why persistence was not granted, when we can tell. */
  readonly note: string;
}

/**
 * Ask the browser to make storage durable.
 *
 * Chrome grants this to installed PWAs and to sites with enough engagement,
 * and refuses silently otherwise. Firefox prompts. Calling it repeatedly is
 * harmless and is worth doing on every load, because the answer changes once
 * the app is installed to the home screen.
 */
export async function requestPersistence(): Promise<StorageStatus> {
  const available = await storageAvailable();
  let persistent = false;
  let usedBytes: number | null = null;
  let quotaBytes: number | null = null;
  let note = '';

  try {
    if (navigator.storage?.persisted) {
      persistent = await navigator.storage.persisted();
      if (!persistent && navigator.storage.persist) {
        persistent = await navigator.storage.persist();
      }
    } else {
      note = 'This browser does not support durable storage, so data is kept on a best-effort basis.';
    }
  } catch {
    note = 'The browser refused the durable-storage request.';
  }

  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usedBytes = est.usage ?? null;
      quotaBytes = est.quota ?? null;
    }
  } catch {
    // Estimates are a nicety; their absence is not a problem.
  }

  if (!persistent && !note) {
    note = 'Install the app (Add to home screen, or the install icon in the address bar) and this is granted automatically.';
  }

  return { available, persistent, usedBytes, quotaBytes, note };
}

// ---------------------------------------------------------- safety snapshot

const SNAPSHOT_KEY = 'lemma:snapshot';
const SNAPSHOT_META_KEY = 'lemma:snapshot:meta';

/**
 * A second copy of everything, in localStorage.
 *
 * IndexedDB and localStorage fail independently: a corrupted object store, a
 * half-finished upgrade, or an eviction that takes one does not usually take
 * the other. The snapshot is small — attempts store only a problem id, never
 * a problem — so keeping a whole duplicate costs little and turns "everything
 * is gone" into "the last few problems are gone".
 */
export async function writeSnapshot(): Promise<boolean> {
  try {
    const backup = await exportAll();
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(backup, bigintReplacer));
    localStorage.setItem(SNAPSHOT_META_KEY, JSON.stringify({
      at: Date.now(),
      skills: backup.skillStates.length,
      attempts: backup.attempts.length,
    }));
    return true;
  } catch {
    // A full localStorage or a private window; the app carries on regardless.
    return false;
  }
}

export function readSnapshotMeta(): { at: number; skills: number; attempts: number } | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Restore from the local snapshot. Merges, so it cannot lose newer work. */
export async function restoreFromSnapshot(): Promise<{ skills: number; attempts: number } | null> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return await importAll(JSON.parse(raw, bigintReviver) as Backup);
  } catch {
    return null;
  }
}

/**
 * If IndexedDB is empty but a snapshot exists, put it back.
 *
 * This is the case that matters: the browser evicted the database between
 * sessions and the app would otherwise open looking brand new, with the real
 * history sitting untouched in localStorage.
 */
export async function recoverIfEmpty(): Promise<{ skills: number; attempts: number } | null> {
  try {
    const states = await loadSkillStates();
    if (Object.keys(states).length > 0) return null;
    const meta = readSnapshotMeta();
    if (!meta || meta.skills === 0) return null;
    return await restoreFromSnapshot();
  } catch {
    return null;
  }
}

/** BigInt does not survive JSON on its own; tag it so a backup round-trips. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { __bigint: value.toString() } : value;
}
export function bigintReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__bigint' in (value as Record<string, unknown>)) {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}

/** Which build and origin this is, so two copies are never confused. */
export function buildIdentity(): { origin: string; label: string; isDev: boolean } {
  const origin = typeof location === 'undefined' ? 'unknown' : location.origin;
  const isDev = /localhost|127\.0\.0\.1|\[::1\]/.test(origin);
  return {
    origin,
    label: isDev ? 'Development copy' : 'Installed app',
    isDev,
  };
}
