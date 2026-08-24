/**
 * Prose with inline mathematics.
 *
 * A problem's context is a sentence, and sentences about mathematics contain
 * mathematics: "f(x) = 3x² − 2x + 1" reads badly as plain text and fine when
 * the formula is typeset. Anything between single dollar signs is rendered as
 * LaTeX, the rest as text.
 */

import { Fragment, useMemo } from 'react';
import { MathView } from './MathView.tsx';

export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => splitMath(text), [text]);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.math ? (
          <span
            key={i}
            style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 1px' }}
          >
            <MathView latex={part.text} size="sm" />
          </span>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </span>
  );
}

/** Split on $…$, tolerating an unmatched dollar rather than swallowing the rest. */
function splitMath(text: string): Array<{ text: string; math: boolean }> {
  const out: Array<{ text: string; math: boolean }> = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf('$');
    if (open === -1) break;
    const close = rest.indexOf('$', open + 1);
    if (close === -1) break;
    if (open > 0) out.push({ text: rest.slice(0, open), math: false });
    out.push({ text: rest.slice(open + 1, close), math: true });
    rest = rest.slice(close + 1);
  }
  if (rest) out.push({ text: rest, math: false });
  return out.length ? out : [{ text, math: false }];
}
