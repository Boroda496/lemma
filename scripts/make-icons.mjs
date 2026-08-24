/**
 * Generate the PWA launcher icons.
 *
 * No image library and no build-time browser: the icon is simple enough to
 * rasterise directly and encode with Node's own zlib, which keeps the
 * toolchain to `node` and makes the icons reproducible from source.
 *
 * Run with: node scripts/make-icons.mjs
 */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [13, 17, 23];
const INK = [124, 140, 255];
const GOLD = [240, 180, 41];

/** Distance from a point to a line segment, for stroking a path. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Coverage of a rounded rectangle at a point, antialiased over one pixel. */
function roundedRect(px, py, size, radius) {
  const inset = 0;
  const x = Math.min(px - inset, size - inset - px);
  const y = Math.min(py - inset, size - inset - py);
  if (x > radius && y > radius) return 1;
  const cx = x < radius ? radius : x;
  const cy = y < radius ? radius : y;
  const d = radius - Math.hypot(cx - x, cy - y);
  return Math.max(0, Math.min(1, d + 0.5));
}

function render(size) {
  const s = size / 64;             // the source artwork is 64x64
  const px = Buffer.alloc(size * size * 4);

  // The mark: an L-shaped axis pair, with a point marking a plotted value.
  const strokeW = 6 * s;
  const segments = [[20 * s, 16 * s, 20 * s, 48 * s], [20 * s, 48 * s, 44 * s, 48 * s]];
  const dot = { x: 44 * s, y: 20 * s, r: 5 * s };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const i = (y * size + x) * 4;

      const bgA = roundedRect(cx, cy, size, 14 * s);
      let [r, g, b] = BG;
      let a = bgA;

      // The stroke, antialiased by distance.
      let strokeCov = 0;
      for (const [x1, y1, x2, y2] of segments) {
        const d = distToSegment(cx, cy, x1, y1, x2, y2);
        strokeCov = Math.max(strokeCov, Math.min(1, Math.max(0, strokeW / 2 - d + 0.5)));
      }
      if (strokeCov > 0) {
        r = Math.round(r * (1 - strokeCov) + INK[0] * strokeCov);
        g = Math.round(g * (1 - strokeCov) + INK[1] * strokeCov);
        b = Math.round(b * (1 - strokeCov) + INK[2] * strokeCov);
      }

      const dotCov = Math.min(1, Math.max(0, dot.r - Math.hypot(cx - dot.x, cy - dot.y) + 0.5));
      if (dotCov > 0) {
        r = Math.round(r * (1 - dotCov) + GOLD[0] * dotCov);
        g = Math.round(g * (1 - dotCov) + GOLD[1] * dotCov);
        b = Math.round(b * (1 - dotCov) + GOLD[2] * dotCov);
      }

      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha
  // Each scanline is prefixed with a filter byte; 0 means no filtering.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const out = encodePng(render(size), size);
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), out);
  console.log(`public/icon-${size}.png  ${out.length} bytes`);
}
