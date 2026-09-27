/**
 * WP-10 (Ambient life) — pure lane geometry. NO three.js, NO DOM (unit-tested in Node).
 *
 * A car crosses one road TILE at a time (WP-12: a 2 × 2 cell road block, ROAD_TILE_SIZE = 1 world
 * unit; below "cell" means that tile) along a "manoeuvre": it enters through the edge it
 * is travelling across (`inDir`) and leaves through `outDir`. Traffic keeps to the RIGHT, so
 * every manoeuvre starts and ends on the right-hand lane centre (LANE_OFFSET from the middle
 * of the road; Kenney road tiles have two ≈0.37-wide lanes between the kerbs).
 *
 *  - straight  (out == in):      a line through the cell.
 *  - right turn (out == in + 1): a tight quarter arc around the near corner.
 *  - left turn  (out == in + 3): a wide quarter arc that crosses the oncoming lane.
 *  - U-turn     (out == in + 2): only at dead ends; drive to the middle, loop round, drive back.
 *
 * Paths are pre-sampled polylines in tile-local coordinates (tile centre = origin,
 * world units), so sampling is allocation-free.
 */
import { ROAD_TILE_SIZE } from '../game/config';

/** 0 = north (−z), 1 = east (+x), 2 = south (+z), 3 = west (−x). Clockwise seen from above. */
export type Dir = 0 | 1 | 2 | 3;

export const DIR_X: readonly number[] = [0, 1, 0, -1];
export const DIR_Z: readonly number[] = [-1, 0, 1, 0];

/** Distance of the lane centre from the road's middle line, in world units. */
export const LANE_OFFSET = 0.18 * ROAD_TILE_SIZE;

export const opposite = (dir: Dir): Dir => ((dir + 2) % 4) as Dir;

export type ManoeuvreKind = 'straight' | 'right' | 'left' | 'uturn';

export function manoeuvreKind(inDir: Dir, outDir: Dir): ManoeuvreKind {
  const turn = (outDir - inDir + 4) % 4;
  return turn === 0 ? 'straight' : turn === 1 ? 'right' : turn === 3 ? 'left' : 'uturn';
}

export interface LanePath {
  kind: ManoeuvreKind;
  /** Flat [x0, z0, x1, z1, ...] polyline, cell-local. */
  points: Float32Array;
  /** Cumulative arc length at each point (cum[0] = 0). */
  cum: Float32Array;
  length: number;
}

export interface PathSample {
  x: number;
  z: number;
  /** Unit heading (direction of travel). */
  hx: number;
  hz: number;
}

const ARC_STEPS = 16;
const HALF = ROAD_TILE_SIZE / 2;

function buildPath(inDir: Dir, outDir: Dir): LanePath {
  const kind = manoeuvreKind(inDir, outDir);
  const dix = DIR_X[inDir];
  const diz = DIR_Z[inDir];
  const dox = DIR_X[outDir];
  const doz = DIR_Z[outDir];
  // Right-hand vector of a heading (dx, dz) in the x-right / z-down top view is (−dz, dx).
  const rix = -diz;
  const riz = dix;
  const rox = -doz;
  const roz = dox;
  const pts: number[] = [];
  const startX = -dix * HALF + rix * LANE_OFFSET;
  const startZ = -diz * HALF + riz * LANE_OFFSET;
  const endX = dox * HALF + rox * LANE_OFFSET;
  const endZ = doz * HALF + roz * LANE_OFFSET;
  pts.push(startX, startZ);
  if (kind === 'straight') {
    pts.push(endX, endZ);
  } else if (kind === 'uturn') {
    // Drive to the middle, then a half circle (radius = lane offset) through the forward point.
    for (let i = 0; i <= ARC_STEPS; i += 1) {
      const t = (i / ARC_STEPS) * Math.PI;
      pts.push(Math.cos(t) * rix * LANE_OFFSET + Math.sin(t) * dix * LANE_OFFSET, Math.cos(t) * riz * LANE_OFFSET + Math.sin(t) * diz * LANE_OFFSET);
    }
    pts.push(endX, endZ);
  } else {
    // Quarter arc around the corner shared by the entry and exit edges.
    const cx = -dix * HALF + dox * HALF;
    const cz = -diz * HALF + doz * HALF;
    const a0 = Math.atan2(startZ - cz, startX - cx);
    let a1 = Math.atan2(endZ - cz, endX - cx);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    a1 = a0 + sweep;
    const radius = Math.hypot(startX - cx, startZ - cz);
    for (let i = 1; i < ARC_STEPS; i += 1) {
      const a = a0 + (sweep * i) / ARC_STEPS;
      pts.push(cx + Math.cos(a) * radius, cz + Math.sin(a) * radius);
    }
    pts.push(endX, endZ);
  }
  const points = new Float32Array(pts);
  const count = points.length / 2;
  const cum = new Float32Array(count);
  for (let i = 1; i < count; i += 1) {
    cum[i] = cum[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
  }
  return { kind, points, cum, length: cum[count - 1] };
}

/** All 16 manoeuvres, indexed [inDir * 4 + outDir]. */
const PATHS: readonly LanePath[] = Array.from({ length: 16 }, (_, i) => buildPath((i >> 2) as Dir, (i & 3) as Dir));

export function lanePath(inDir: Dir, outDir: Dir): LanePath {
  return PATHS[inDir * 4 + outDir];
}

/** Cell-local position + heading at arc length `s` (clamped to the path). Writes into `out`. */
export function samplePath(path: LanePath, s: number, out: PathSample): PathSample {
  const { points, cum } = path;
  const last = cum.length - 1;
  const d = Math.min(Math.max(s, 0), path.length);
  let i = 0;
  while (i < last - 1 && cum[i + 1] < d) i += 1;
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (d - cum[i]) / segLen : 0;
  const x0 = points[i * 2];
  const z0 = points[i * 2 + 1];
  const x1 = points[i * 2 + 2];
  const z1 = points[i * 2 + 3];
  out.x = x0 + (x1 - x0) * t;
  out.z = z0 + (z1 - z0) * t;
  const inv = segLen > 0 ? 1 / segLen : 0;
  out.hx = (x1 - x0) * inv;
  out.hz = (z1 - z0) * inv;
  return out;
}
