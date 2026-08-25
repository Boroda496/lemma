/**
 * The learner's state, held in React and persisted to IndexedDB.
 *
 * Writes go to storage in the background; the UI never waits on them. If
 * storage is unavailable — a private window, a locked-down browser — the app
 * still works for the session and says so, rather than silently discarding
 * everything at the end of it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SkillState, Attempt } from './../mastery/model.ts';
import { applyAttempt } from './../mastery/model.ts';
import { stateFor } from './../mastery/scheduler.ts';
import {
  loadSkillStates, saveSkillState, recordAttempt, loadAttempts,
  loadSettings, saveSettings, storageAvailable,
  requestPersistence, recoverIfEmpty, writeSnapshot,
  type Settings, type StorageStatus, DEFAULT_SETTINGS,
} from './../store/db.ts';
import { startAutoSync, syncSoon, getStatus, onStatus, type SyncStatus } from './../sync/client.ts';

export interface Learner {
  states: Record<string, SkillState>;
  attempts: Attempt[];
  settings: Settings;
  ready: boolean;
  persistent: boolean;
  /** Full storage picture, for the durability panel. */
  storage: StorageStatus | null;
  /** Set when the app restored itself from the local snapshot on startup. */
  recovered: { skills: number; attempts: number } | null;
  /** Cross-device sync, or phase 'off' when this device is not linked. */
  sync: SyncStatus;
  submit: (a: Attempt) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  reload: () => void;
}

export function useLearner(): Learner {
  const [states, setStates] = useState<Record<string, SkillState>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [recovered, setRecovered] = useState<{ skills: number; attempts: number } | null>(null);
  const [sync, setSync] = useState<SyncStatus>(getStatus);
  const mounted = useRef(true);
  const sinceSnapshot = useRef(0);

  const load = useCallback(() => {
    let cancelled = false;
    (async () => {
      const ok = await storageAvailable();
      if (cancelled) return;
      setPersistent(ok);
      if (!ok) { setReady(true); return; }

      // Ask for durable storage every load: the answer changes once the app is
      // installed to the home screen, and until it is granted the browser may
      // evict everything without warning.
      void requestPersistence().then((s) => { if (!cancelled) setStorage(s); });

      // If the database came back empty but a snapshot exists, the browser
      // evicted it between sessions. Put it back before rendering, or the app
      // opens looking brand new with the real history sitting in localStorage.
      try {
        const restored = await recoverIfEmpty();
        if (restored && !cancelled) setRecovered(restored);
      } catch {
        // Recovery is best-effort; a failure here must not block startup.
      }

      try {
        const [s, a, cfg] = await Promise.all([loadSkillStates(), loadAttempts(600), loadSettings()]);
        if (cancelled) return;
        setStates(s);
        setAttempts(a);
        setSettings(cfg);
      } catch {
        setPersistent(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    mounted.current = true;
    const cleanup = load();
    return () => { mounted.current = false; cleanup(); };
  }, [load]);

  const submit = useCallback((a: Attempt) => {
    setStates((prev) => {
      const next = applyAttempt(stateFor(prev, a.skillId), a, a.at);
      // Persist without blocking the interaction. A failed write is not worth
      // interrupting a practice session over; the next reload reveals it.
      void saveSkillState(next).catch(() => setPersistent(false));
      return { ...prev, [a.skillId]: next };
    });
    setAttempts((prev) => [a, ...prev].slice(0, 600));
    void recordAttempt(a).catch(() => setPersistent(false));

    // Snapshot to localStorage every few problems. Often enough that an
    // eviction costs a couple of answers rather than a week, rare enough that
    // it never runs during the interaction itself.
    sinceSnapshot.current += 1;
    if (sinceSnapshot.current >= 3) {
      sinceSnapshot.current = 0;
      setTimeout(() => { void writeSnapshot(); }, 1200);
    }

    // Batched, so a ten-problem session is one upload rather than ten. Does
    // nothing at all when this device is not linked.
    syncSoon();
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next).catch(() => setPersistent(false));
      return next;
    });
  }, []);

  // Sync on launch, on returning to the app, and when the network comes back.
  // When a sync brings work down from another device, reload so the screen
  // shows it — otherwise the map and history would sit there stale.
  useEffect(() => onStatus(setSync), []);
  useEffect(() => startAutoSync(() => load()), [load]);

  // A snapshot on the way out catches whatever the counter has not yet.
  useEffect(() => {
    const flush = () => { void writeSnapshot(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  return {
    states, attempts, settings, ready, persistent, storage, recovered, sync,
    submit, updateSettings, reload: load,
  };
}

/** Apply the theme choice to the document, so CSS tokens follow it. */
export function useTheme(theme: Settings['theme']): void {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}
