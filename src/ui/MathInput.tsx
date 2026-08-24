/**
 * The math input field.
 *
 * MathLive gives a real editable formula on every platform, which is the whole
 * game for touch: entering (-3 ± √5)/2 on a phone keyboard is miserable, and
 * entering it in a formula field is not. The virtual keyboard is narrowed to
 * the symbols the current problem could plausibly need, so an algebra problem
 * does not offer integrals.
 */

import { useEffect, useRef, useCallback } from 'react';
import 'mathlive';
import type { MathfieldElement } from 'mathlive';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        ref?: React.Ref<MathfieldElement>;
      };
    }
  }
}

export type KeyboardFlavour = 'numeric' | 'algebra' | 'geometry' | 'full';

export function MathInput({
  value, onChange, onSubmit, placeholder, flavour = 'algebra', status, autoFocus,
}: {
  value: string;
  onChange: (latex: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  flavour?: KeyboardFlavour;
  status?: 'correct' | 'wrong' | null;
  autoFocus?: boolean;
}) {
  const ref = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  const attach = useCallback((el: MathfieldElement | null) => {
    ref.current = el;
    if (!el) return;

    el.smartMode = true;
    el.smartFence = true;
    // Menus and shortcuts that belong in a CAS, not a practice field.
    el.mathVirtualKeyboardPolicy = 'auto';
    if (placeholder) el.setAttribute('placeholder', placeholder);

    el.addEventListener('input', () => onChangeRef.current(el.value));
    el.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        onSubmitRef.current?.();
      }
    });
    if (autoFocus && window.matchMedia('(min-width: 860px)').matches) {
      // Autofocus on desktop only: on a phone it throws the virtual keyboard
      // up before the reader has seen the problem.
      queueMicrotask(() => el.focus());
    }
  }, [placeholder, autoFocus]);

  // Keep the field in step when the value is changed from outside (cleared
  // between problems, or filled by "put my answer back").
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const layers = KEYBOARDS[flavour];
    try {
      (window as unknown as { mathVirtualKeyboard?: { layouts: unknown } }).mathVirtualKeyboard!.layouts = layers;
    } catch {
      // An older MathLive without configurable layouts still works; it just
      // shows the default keyboard.
    }
  }, [flavour]);

  // The status ring is set on the element directly: math-field is a custom
  // element, so React's className does not reach it reliably.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.toggle('is-correct', status === 'correct');
    el.classList.toggle('is-wrong', status === 'wrong');
  }, [status]);

  return <math-field ref={attach} aria-label="Your answer" />;
}

/**
 * Keyboard layouts per problem family. Offering every symbol at once makes the
 * common ones harder to hit, which on a phone is the difference between fluent
 * and fiddly.
 */
const KEYBOARDS: Record<KeyboardFlavour, unknown[]> = {
  numeric: ['numeric'],
  algebra: [
    {
      label: 'algebra',
      rows: [
        [
          '[7]', '[8]', '[9]', '[/]', { latex: '\\pm', shift: '\\mp' },
          'x', 'y', { latex: '(' }, { latex: ')' },
        ],
        [
          '[4]', '[5]', '[6]', '[*]', { latex: '#@^{2}', label: 'x²' },
          { latex: '#@^{#?}', label: 'xⁿ' }, { latex: '\\sqrt{#0}' },
          { latex: '\\frac{#0}{#?}' }, '[=]',
        ],
        [
          '[1]', '[2]', '[3]', '[-]', { latex: '\\lt' }, { latex: '\\gt' },
          { latex: '\\le' }, { latex: '\\ge' }, '[backspace]',
        ],
        [
          '[0]', '[.]', '[+]', { latex: ',' }, { latex: '\\pi' },
          { latex: '\\left|#0\\right|', label: '|x|' },
          '[left]', '[right]', '[return]',
        ],
      ],
    },
    'numeric',
  ],
  geometry: [
    {
      label: 'geometry',
      rows: [
        ['[7]', '[8]', '[9]', '[/]', { latex: '\\pi' }, { latex: '\\sqrt{#0}' }, '[backspace]'],
        ['[4]', '[5]', '[6]', '[*]', { latex: '#@^{2}', label: 'x²' }, { latex: '\\degree' }, '[left]'],
        ['[1]', '[2]', '[3]', '[-]', { latex: '\\frac{#0}{#?}' }, 'x', '[right]'],
        ['[0]', '[.]', '[+]', { latex: '(' }, { latex: ')' }, { latex: ',' }, '[return]'],
      ],
    },
    'numeric',
  ],
  full: ['numeric', 'symbols', 'alphabetic', 'greek'],
};
