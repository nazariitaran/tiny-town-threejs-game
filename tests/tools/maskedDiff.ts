/**
 * Masked PNG diff (WP-16c): proves a baseline change is confined to given rectangles (e.g. the
 * top bar after the day/night time button was added).
 *
 * Counts pixels whose largest channel difference (RGBA, 0–255) exceeds `threshold`, split into
 * inside vs outside the allowed rectangles, and writes an optional diff image:
 *   red = changed outside the mask, yellow = changed inside it, dimmed greyscale = unchanged,
 *   blue outline = the mask rectangles.
 *
 * CLI (Node ≥ 22.18 runs .ts directly by stripping types):
 *   node tests/tools/maskedDiff.ts <before.png> <after.png> --rect x,y,w,h [--rect ...]
 *        [--pad 0] [--scale 1] [--threshold 0] [--out diff.png] [--json report.json] [--max-outside 0]
 *   node tests/tools/maskedDiff.ts --self-test
 * Rectangles are in CSS px; --pad grows each one on every side (e.g. by a box-shadow's reach:
 * the top-bar pills cast `0 3px 8px`, so their shadow reaches ~11 px past the pill), --scale
 * multiplies them (device-pixel screenshots). Rect edges are
 * expanded outwards to whole pixels. Exit code 1 if more than --max-outside pixels changed outside
 * the rectangles (or the image sizes differ), else 0.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MaskedDiffReport {
  width: number;
  height: number;
  threshold: number;
  rects: Rect[];
  /** Pixel rectangles actually masked (after scale + outward rounding + clamping). */
  pixelRects: Rect[];
  changed: number;
  changedInside: number;
  changedOutside: number;
  /** Largest channel delta seen outside the mask (0 = identical there). */
  maxDeltaOutside: number;
  /** Bounding box of the outside changes, or null when there are none. */
  outsideBounds: Rect | null;
  /** Up to 20 sample outside pixels: [x, y, delta]. */
  outsideSamples: Array<[number, number, number]>;
}

interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

function toPixelRect(rect: Rect, scale: number, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.floor(rect.x * scale));
  const y0 = Math.max(0, Math.floor(rect.y * scale));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * scale));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * scale));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/** Compare two same-size RGBA images. `diff`, if given, receives the visualisation (same size). */
export function maskedDiff(
  before: Image,
  after: Image,
  rects: Rect[],
  options: { scale?: number; threshold?: number; diff?: Uint8Array } = {},
): MaskedDiffReport {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`size mismatch: ${before.width}×${before.height} vs ${after.width}×${after.height}`);
  }
  const { width, height } = before;
  const threshold = options.threshold ?? 0;
  const pixelRects = rects.map((r) => toPixelRect(r, options.scale ?? 1, width, height));
  const diff = options.diff;
  let changed = 0;
  let changedInside = 0;
  let maxDeltaOutside = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  const outsideSamples: Array<[number, number, number]> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let delta = 0;
      for (let c = 0; c < 4; c += 1) delta = Math.max(delta, Math.abs(before.data[i + c] - after.data[i + c]));
      const masked = pixelRects.some((r) => inside(r, x, y));
      const isChanged = delta > threshold;
      if (isChanged) {
        changed += 1;
        if (masked) changedInside += 1;
        else {
          maxDeltaOutside = Math.max(maxDeltaOutside, delta);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          if (outsideSamples.length < 20) outsideSamples.push([x, y, delta]);
        }
      }
      if (diff) {
        const grey = Math.round((after.data[i] * 0.3 + after.data[i + 1] * 0.59 + after.data[i + 2] * 0.11) * 0.35 + 160);
        const edge = pixelRects.some(
          (r) => inside(r, x, y) && (x === r.x || y === r.y || x === r.x + r.width - 1 || y === r.y + r.height - 1),
        );
        const [r, g, b] = isChanged ? (masked ? [255, 200, 0] : [255, 0, 0]) : edge ? [40, 110, 255] : [grey, grey, grey];
        diff[i] = r;
        diff[i + 1] = g;
        diff[i + 2] = b;
        diff[i + 3] = 255;
      }
    }
  }
  return {
    width,
    height,
    threshold,
    rects,
    pixelRects,
    changed,
    changedInside,
    changedOutside: changed - changedInside,
    maxDeltaOutside,
    outsideBounds: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    outsideSamples,
  };
}

const readPng = (file: string): PNG => PNG.sync.read(readFileSync(file));

function parseRect(value: string): Rect {
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error(`--rect wants x,y,w,h, got "${value}"`);
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

function selfTest(): void {
  const make = (w: number, h: number): Image => ({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(200) });
  const a = make(10, 10);
  const b = make(10, 10);
  const set = (img: Image, x: number, y: number, v: number) => img.data.fill(v, (y * 10 + x) * 4, (y * 10 + x) * 4 + 3);
  set(b, 1, 1, 0); // inside the mask
  set(b, 2, 2, 0); // inside (rect edge rounds outwards: 1.5 + 1 → 3)
  set(b, 8, 8, 190); // outside, small delta 10
  const r = maskedDiff(a, b, [{ x: 0.5, y: 0.5, width: 2.5, height: 2.5 }]);
  const check = (label: string, ok: boolean) => {
    if (!ok) throw new Error(`self-test failed: ${label} (${JSON.stringify(r)})`);
  };
  check('changed', r.changed === 3);
  check('inside', r.changedInside === 2);
  check('outside', r.changedOutside === 1 && r.maxDeltaOutside === 10);
  check('bounds', JSON.stringify(r.outsideBounds) === JSON.stringify({ x: 8, y: 8, width: 1, height: 1 }));
  const t = maskedDiff(a, b, [{ x: 0.5, y: 0.5, width: 2.5, height: 2.5 }], { threshold: 10 });
  check('threshold', t.changedOutside === 0 && t.changedInside === 2);
  let threw = false;
  try {
    maskedDiff(a, make(9, 10), []);
  } catch {
    threw = true;
  }
  check('size mismatch throws', threw);
  console.log('maskedDiff self-test: ok');
}

function main(argv: string[]): number {
  if (argv.includes('--self-test')) {
    selfTest();
    return 0;
  }
  const files: string[] = [];
  const rects: Rect[] = [];
  let scale = 1;
  let pad = 0;
  let threshold = 0;
  let maxOutside = 0;
  let out: string | null = null;
  let json: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    if (arg === '--rect') rects.push(parseRect(next()));
    else if (arg === '--scale') scale = Number(next());
    else if (arg === '--pad') pad = Number(next());
    else if (arg === '--threshold') threshold = Number(next());
    else if (arg === '--max-outside') maxOutside = Number(next());
    else if (arg === '--out') out = next();
    else if (arg === '--json') json = next();
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else files.push(arg);
  }
  if (files.length !== 2) throw new Error('usage: maskedDiff.ts <before.png> <after.png> --rect x,y,w,h [...]');
  const before = readPng(files[0]);
  const after = readPng(files[1]);
  const diffPng = out ? new PNG({ width: after.width, height: after.height }) : null;
  const padded = rects.map((r) => ({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad }));
  const report = { before: files[0], after: files[1], pad, ...maskedDiff(before, after, padded, { scale, threshold, diff: diffPng?.data }) };
  if (diffPng && out) writeFileSync(out, PNG.sync.write(diffPng));
  const text = JSON.stringify(report, null, 2);
  if (json) writeFileSync(json, text);
  console.log(text);
  const pass = report.changedOutside <= maxOutside;
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${report.changedOutside} px changed outside the mask (allowed ${maxOutside}), ${report.changedInside} inside, of ${report.width * report.height}`,
  );
  return pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
