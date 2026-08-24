/**
 * Drawing a geometry figure.
 *
 * The figure is generated from the same numbers as the answer, so what is on
 * screen is what the problem says. Where a figure is deliberately not to
 * scale, it says so under the drawing rather than inviting a student to
 * measure a picture that would mislead them.
 *
 * Everything is plain SVG with stroke colours from the theme tokens, so the
 * drawing follows light and dark without a second asset.
 */

import { useMemo } from 'react';
import type { Figure } from './../curriculum/types.ts';

const PAD = 34;
const SIZE = 320;

export function FigureView({ figure }: { figure: Figure }) {
  const view = useMemo(() => layout(figure), [figure]);
  if (!view) return null;

  return (
    <figure style={{ margin: '0 0 14px' }}>
      <svg
        className="figure"
        viewBox={`0 0 ${view.width} ${view.height}`}
        width={view.width}
        height={view.height}
        role="img"
        aria-label={figure.caption ?? 'Figure for this problem'}
      >
        {figure.kind === 'coordinate' && <Axes view={view} />}

        {view.circles.map((c, i) => (
          <g key={`c${i}`}>
            <circle cx={c.cx} cy={c.cy} r={c.r} className="figure-stroke figure-fill" strokeWidth={2} />
            <line x1={c.cx} y1={c.cy} x2={c.cx + c.r} y2={c.cy} className="figure-mark" strokeDasharray="4 3" />
            {c.label && (
              <text x={c.cx + c.r / 2} y={c.cy - 7} textAnchor="middle" className="figure-label">{c.label}</text>
            )}
            <circle cx={c.cx} cy={c.cy} r={2.5} className="figure-stroke" fill="currentColor" />
          </g>
        ))}

        {view.polygonPath && (
          <path d={view.polygonPath} className="figure-stroke figure-fill" strokeWidth={2} strokeLinejoin="round" />
        )}

        {view.segments.map((s, i) => (
          <line
            key={`s${i}`}
            x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            className="figure-stroke" strokeWidth={2} strokeLinecap="round"
          />
        ))}

        {view.rightAngles.map((r, i) => (
          <path key={`r${i}`} d={r} className="figure-mark" strokeWidth={1.5} />
        ))}

        {view.sideLabels.map((l, i) => (
          <text
            key={`sl${i}`}
            x={l.x} y={l.y}
            textAnchor="middle" dominantBaseline="middle"
            className={`figure-label ${l.unknown ? 'figure-label--unknown' : ''}`}
          >
            {l.text}
          </text>
        ))}

        {view.vertexLabels.map((l, i) => (
          <text
            key={`vl${i}`}
            x={l.x} y={l.y}
            textAnchor="middle" dominantBaseline="middle"
            className={`figure-label ${l.unknown ? 'figure-label--unknown' : ''}`}
          >
            {l.text}
          </text>
        ))}

        {view.points.map((p, i) => (
          <circle key={`p${i}`} cx={p.x} cy={p.y} r={3.5} className="figure-stroke" fill="currentColor" />
        ))}
      </svg>

      {(figure.caption || !figure.toScale) && (
        <figcaption className="figure__caption">
          {figure.caption}
          {!figure.toScale && (figure.caption ? ' ' : '') + 'Not drawn to scale.'}
        </figcaption>
      )}
    </figure>
  );
}

function Axes({ view }: { view: Layout }) {
  const { originX, originY, width, height } = view;
  return (
    <g>
      <line x1={0} y1={originY} x2={width} y2={originY} className="figure-axis" strokeWidth={1.5} />
      <line x1={originX} y1={0} x2={originX} y2={height} className="figure-axis" strokeWidth={1.5} />
    </g>
  );
}

// ---------------------------------------------------------------- layout

interface Layout {
  width: number;
  height: number;
  originX: number;
  originY: number;
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  polygonPath: string | null;
  sideLabels: Array<{ x: number; y: number; text: string; unknown: boolean }>;
  vertexLabels: Array<{ x: number; y: number; text: string; unknown: boolean }>;
  rightAngles: string[];
  circles: Array<{ cx: number; cy: number; r: number; label?: string }>;
  points: Array<{ x: number; y: number }>;
}

/**
 * Map the figure's own coordinates into the viewbox.
 *
 * The source coordinates use mathematical convention (y increasing upward);
 * SVG's y axis points down, so the transform flips it. Getting that wrong
 * silently mirrors every triangle, which looks plausible and is wrong.
 */
function layout(figure: Figure): Layout | null {
  const pts = figure.points ?? {};
  const names = Object.keys(pts);

  const circleRadii = (figure.circles ?? []).map((c) => c.radius);
  const maxCircle = circleRadii.length ? Math.max(...circleRadii) : 0;

  if (names.length === 0 && maxCircle === 0) return null;

  const xs = names.map((n) => pts[n]![0]);
  const ys = names.map((n) => pts[n]![1]);
  if (maxCircle > 0) {
    for (const c of figure.circles ?? []) {
      const centre = pts[c.center] ?? [0, 0];
      xs.push(centre[0] - c.radius, centre[0] + c.radius);
      ys.push(centre[1] - c.radius, centre[1] + c.radius);
    }
  }

  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((SIZE - PAD * 2) / spanX, (SIZE - PAD * 2) / spanY);

  const width = spanX * scale + PAD * 2;
  const height = spanY * scale + PAD * 2;

  const tx = (x: number) => (x - minX) * scale + PAD;
  const ty = (y: number) => height - PAD - (y - minY) * scale;

  const at = (name: string): [number, number] => {
    const p = pts[name];
    return p ? [tx(p[0]), ty(p[1])] : [width / 2, height / 2];
  };

  const segments = (figure.segments ?? []).map(([a, b]) => {
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    return { x1, y1, x2, y2 };
  });

  // A closed run of segments becomes a filled polygon, which reads better than
  // outlines alone for area problems.
  const polygonPath = closedPolygon(figure, at);

  const sideLabels = Object.entries(figure.sideLabels ?? {}).map(([edge, text]) => {
    const a = edge.slice(0, 1);
    const b = edge.slice(1);
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    // Nudge the label off the line, along its normal.
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const off = 15;
    const cx = (tx(centroidX(pts)) + 0);
    const cy = (ty(centroidY(pts)) + 0);
    // Push away from the figure's centre so labels land outside the shape.
    let nx = -dy / len;
    let ny = dx / len;
    if ((mx + nx * off - cx) ** 2 + (my + ny * off - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) {
      nx = -nx; ny = -ny;
    }
    return { x: mx + nx * off, y: my + ny * off, text, unknown: /^[a-z]$/.test(text) };
  });

  const vertexLabels = Object.entries(figure.angleLabels ?? {})
    .filter(([name]) => pts[name])
    .map(([name, text]) => {
      const [x, y] = at(name);
      const cx = tx(centroidX(pts));
      const cy = ty(centroidY(pts));
      const dx = cx - x;
      const dy = cy - y;
      const len = Math.hypot(dx, dy) || 1;
      // Inside the shape, a little way in from the vertex.
      return { x: x + (dx / len) * 30, y: y + (dy / len) * 30, text, unknown: /^[a-z]$/.test(text) };
    });

  const rightAngles = (figure.rightAngles ?? [])
    .filter((name) => pts[name])
    .map((name) => rightAngleMark(name, figure, at))
    .filter((d): d is string => d !== null);

  const circles = (figure.circles ?? []).map((c) => {
    const centre = pts[c.center] ?? [0, 0];
    return {
      cx: tx(centre[0]), cy: ty(centre[1]), r: c.radius * scale,
      ...(c.label ? { label: c.label } : {}),
    };
  });

  return {
    width, height,
    originX: tx(0), originY: ty(0),
    segments, polygonPath, sideLabels, vertexLabels, rightAngles, circles,
    points: figure.kind === 'coordinate' ? names.map((n) => { const [x, y] = at(n); return { x, y }; }) : [],
  };
}

function centroidX(pts: Record<string, readonly [number, number]>): number {
  const vs = Object.values(pts);
  return vs.length ? vs.reduce((s, p) => s + p[0], 0) / vs.length : 0;
}
function centroidY(pts: Record<string, readonly [number, number]>): number {
  const vs = Object.values(pts);
  return vs.length ? vs.reduce((s, p) => s + p[1], 0) / vs.length : 0;
}

function closedPolygon(figure: Figure, at: (n: string) => [number, number]): string | null {
  const segs = figure.segments ?? [];
  if (segs.length < 3) return null;
  // Walk the segments; if they form one closed loop, emit it as a path.
  const order: string[] = [segs[0]![0], segs[0]![1]];
  const used = new Set<number>([0]);
  for (let guard = 0; guard < segs.length; guard++) {
    const tail = order[order.length - 1]!;
    const nextIdx = segs.findIndex((s, i) => !used.has(i) && (s[0] === tail || s[1] === tail));
    if (nextIdx === -1) break;
    used.add(nextIdx);
    const seg = segs[nextIdx]!;
    order.push(seg[0] === tail ? seg[1] : seg[0]);
  }
  if (used.size !== segs.length || order[0] !== order[order.length - 1]) return null;
  const pts = order.slice(0, -1).map(at);
  return `M ${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;
}

/** A small square at a right-angled vertex, drawn between its two edges. */
function rightAngleMark(
  vertex: string, figure: Figure, at: (n: string) => [number, number],
): string | null {
  const neighbours = (figure.segments ?? [])
    .filter(([a, b]) => a === vertex || b === vertex)
    .map(([a, b]) => (a === vertex ? b : a));
  if (neighbours.length < 2) return null;

  const [vx, vy] = at(vertex);
  const dirs = neighbours.slice(0, 2).map((n) => {
    const [nx, ny] = at(n);
    const len = Math.hypot(nx - vx, ny - vy) || 1;
    return [(nx - vx) / len, (ny - vy) / len] as const;
  });
  const size = 13;
  const [d1, d2] = dirs as [readonly [number, number], readonly [number, number]];
  const p1 = [vx + d1[0] * size, vy + d1[1] * size];
  const p2 = [vx + (d1[0] + d2[0]) * size, vy + (d1[1] + d2[1]) * size];
  const p3 = [vx + d2[0] * size, vy + d2[1] * size];
  return `M ${p1[0]!.toFixed(1)} ${p1[1]!.toFixed(1)} L ${p2[0]!.toFixed(1)} ${p2[1]!.toFixed(1)} L ${p3[0]!.toFixed(1)} ${p3[1]!.toFixed(1)}`;
}
