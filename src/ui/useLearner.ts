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
  type Settings, DEFAULT_SETTINGS,
} from './../store/db.ts';

export interface Learner {
  states: Record<string, SkillState>;
  attempts: Attempt[];
  settings: Settings;
  ready: boolean;
  persistent: boolean;
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
  const mounted = useRef(true);

  const load = useCallback(() => {
    let cancelled = false;
    (async () => {
      const ok = await storageAvailable();
      if (cancelled) return;
      setPersistent(ok);
      if (!ok) { setReady(true); return; }
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
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next).catch(() => setPersistent(false));
      return next;
    });
  }, []);

  return { states, attempts, settings, ready, persistent, submit, updateSettings, reload: load };
}

/** Apply the theme choice to the document, so CSS tokens follow it. */
export function useTheme(theme: Settings['theme']): void {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}
