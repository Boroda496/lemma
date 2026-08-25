/**
 * The shell.
 *
 * One layout that becomes a bottom bar on a phone and a side rail from tablet
 * width up, driven entirely by CSS. There is no separate mobile build and no
 * device sniffing: a tablet in portrait gets the phone layout and the same
 * tablet rotated gets the rail, which is the behaviour a person expects.
 */

import { useCallback, useState } from 'react';
import { Practice } from './Practice.tsx';
import { Sandbox } from './Sandbox.tsx';
import { MapView } from './MapView.tsx';
import { HistoryView } from './HistoryView.tsx';
import { ProgressView } from './ProgressView.tsx';
import { useLearner, useTheme } from './useLearner.ts';
import { buildIdentity } from './../store/db.ts';

type Tab = 'practice' | 'map' | 'sandbox' | 'history' | 'progress';

/**
 * Icons are inline SVG rather than unicode glyphs. Symbol characters fall back
 * to whatever font has them, so the same glyph renders at a different weight
 * and size on each platform -- the progress icon came out as a speck.
 */
const ICONS: Record<Tab, JSX.Element> = {
  practice: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="M14.5 5.5l3 3" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2.6" /><circle cx="18" cy="6" r="2.6" />
      <circle cx="12" cy="18" r="2.6" />
      <path d="M8 7.6 10.6 15.8M16 7.6 13.4 15.8M8.6 6h6.8" />
    </svg>
  ),
  sandbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h14L11 12l8 8H5" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.2 2" />
    </svg>
  ),
  progress: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'practice', label: 'Practise' },
  { id: 'map', label: 'Map' },
  { id: 'sandbox', label: 'Scratchpad' },
  { id: 'history', label: 'History' },
  { id: 'progress', label: 'Progress' },
];

export function App() {
  const learner = useLearner();
  useTheme(learner.settings.theme);
  // Two copies on two addresses keep two separate histories, which is
  // invisible and maddening. The development copy says so, permanently.
  const identity = buildIdentity();

  const [tab, setTab] = useState<Tab>('practice');
  const [focusSkill, setFocusSkill] = useState<string | undefined>(undefined);

  const practise = useCallback((skillId: string) => {
    setFocusSkill(skillId);
    setTab('practice');
  }, []);

  return (
    <div className="app">
      <nav className="nav" aria-label="Sections">
        <div className="brand">
          Lemma
          <small>verified mathematics</small>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className="nav__item"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => { setTab(t.id); if (t.id === 'practice' && tab === 'practice') setFocusSkill(undefined); }}
          >
            <span className="nav__glyph" aria-hidden="true">{ICONS[t.id]}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="app__body">
        {identity.isDev && (
          <div className="devbar" role="note">
            Development copy — its history is separate from the installed app.
          </div>
        )}
        {tab === 'practice' && (
          <Practice
            learner={learner}
            {...(focusSkill ? { focusSkill } : {})}
            onClearFocus={() => setFocusSkill(undefined)}
          />
        )}
        {tab === 'map' && <MapView learner={learner} onPractise={practise} />}
        {tab === 'sandbox' && <Sandbox />}
        {tab === 'history' && <HistoryView learner={learner} onRetry={practise} />}
        {tab === 'progress' && <ProgressView learner={learner} />}
      </main>
    </div>
  );
}
