/**
 * Rendering LaTeX with KaTeX.
 *
 * Wide expressions scroll inside their own box rather than pushing the page
 * sideways, which is the difference between a usable phone layout and one
 * that shifts under your thumb.
 */

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function MathView({
  latex, display = false, size = 'md', className = '',
}: {
  latex: string;
  display?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
        trust: false,
        output: 'html',
      });
    } catch {
      // Never let a rendering failure blank the screen; show the source.
      return `<code>${escapeHtml(latex)}</code>`;
    }
  }, [latex, display]);

  const sizeClass = size === 'lg' ? 'math--lg' : size === 'sm' ? 'math--sm' : '';
  return (
    <div
      className={`math ${sizeClass} ${className}`.trim()}
      // KaTeX output is generated from our own expressions, never from user
      // input, and `trust: false` blocks the commands that could inject.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
