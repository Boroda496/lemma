/**
 * A small function plotter.
 *
 * Sampling is dense and the curve is broken wherever the function leaves the
 * view or becomes undefined, so an asymptote shows as a gap rather than as a
 * near-vertical line joining two branches that are not connected — which is
 * the standard way a plot lies about a rational function.
 */

import { useMemo, useState } from 'react';
import type { Expr } from './../engine/expr.ts';
import { evalPlot } from './../engine/evaluate.ts';

const W = 560;
const H = 340;
const SAMPLES = 900;

export function Plot({ expr, variable }: { expr: Expr; variable: string }) {
  const [span, setSpan] = useState(10);

  const { paths, yMin, yMax } = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const x = -span + (2 * span * i) / SAMPLES;
      xs.push(x);
      ys.push(evalPlot(expr, { [variable]: x }));
    }

    // Choose a vertical window from the middle of the data, so one spike near
    // an asymptote does not flatten the whole curve into the axis.
    const finite = ys.filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
    let lo = -span, hi = span;
    if (finite.length > 8) {
      const q = (p: number) => finite[Math.min(finite.length - 1, Math.floor(p * finite.length))]!;
      const a = q(0.04), b = q(0.96);
      const pad = Math.max(1, (b - a) * 0.15);
      lo = a - pad;
      hi = b + pad;
      if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    }

    const px = (x: number) => ((x + span) / (2 * span)) * W;
    const py = (y: number) => H - ((y - lo) / (hi - lo)) * H;

    const out: string[] = [];
    let cur: string[] = [];
    let prevY: number | null = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const y = ys[i]!;
      const inView = Number.isFinite(y) && y >= lo - (hi - lo) && y <= hi + (hi - lo);
      // A jump larger than a third of the window between adjacent samples is a
      // discontinuity, not a steep segment.
      const jumped = prevY !== null && Number.isFinite(y) && Math.abs(y - prevY) > (hi - lo) * 0.34;
      if (!inView || jumped) {
        if (cur.length > 1) out.push(cur.join(' '));
        cur = [];
        prevY = Number.isFinite(y) ? y : null;
        if (!inView) continue;
      }
      cur.push(`${cur.length === 0 ? 'M' : 'L'} ${px(xs[i]!).toFixed(1)} ${py(y).toFixed(1)}`);
      prevY = y;
    }
    if (cur.length > 1) out.push(cur.join(' '));

    return { paths: out, yMin: lo, yMax: hi };
  }, [expr, variable, span]);

  const zeroY = H - ((0 - yMin) / (yMax - yMin)) * H;
  const zeroX = W / 2;

  return (
    <div>
      <div className="scroll-x">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img"
             aria-label={`Graph against ${variable}`}>
          {zeroY >= 0 && zeroY <= H && (
            <line x1={0} y1={zeroY} x2={W} y2={zeroY} className="figure-axis" strokeWidth={1.5} />
          )}
          <line x1={zeroX} y1={0} x2={zeroX} y2={H} className="figure-axis" strokeWidth={1.5} />
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinecap="round" />
          ))}
        </svg>
      </div>
      <div className="row row--wrap" style={{ marginTop: 10, gap: 7 }}>
        <span className="small faint">
          {variable} from {(-span).toFixed(0)} to {span.toFixed(0)}, value from {yMin.toFixed(2)} to {yMax.toFixed(2)}
        </span>
        <span className="spacer" />
        <button className="btn btn--sm" onClick={() => setSpan((s) => Math.min(200, s * 2))}>Zoom out</button>
        <button className="btn btn--sm" onClick={() => setSpan((s) => Math.max(1, s / 2))}>Zoom in</button>
      </div>
    </div>
  );
}
