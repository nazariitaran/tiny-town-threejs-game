/**
 * Pure lane geometry. A car crosses one road tile ("cell" below) per manoeuvre: it enters through the
 * edge it is travelling across (`inDir`) and leaves through `outDir`. Traffic keeps to the right, so
 * every manoeuvre starts and ends on the right-hand lane centre.
 *  - straight  (out == in):      a line through the cell.
 *  - right turn (out == in + 1): a tight quarter arc around the near corner.
 *  - left turn  (out == in + 3): a wide quarter arc that crosses the oncoming lane.
 *  - U-turn     (out == in + 2): drive to the middle, loop round, drive back.
 *  - ring (roundabout centre): counter-clockwise round the island; see buildRingPath.
 *
 * Paths are pre-sampled polylines in tile-local world units (tile centre = origin), so sampling is
 * allocation-free.
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
/** Radius of the lane round a roundabout island (Kenney road-roundabout: island kerb ≈ 0.3, outer kerb ≈ 0.73). */
export const RING_RADIUS = 0.5 * ROAD_TILE_SIZE;

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
  return finishPath(kind, pts);
}

function finishPath(kind: ManoeuvreKind, pts: readonly number[]): LanePath {
  const points = new Float32Array(pts);
  const count = points.length / 2;
  const cum = new Float32Array(count);
  for (let i = 1; i < count; i += 1) {
    cum[i] = cum[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
  }
  return { kind, points, cum, length: cum[count - 1] };
}

/** Chaikin corner cutting, keeping both end points (rounds the kinks where lanes join the ring). */
function smooth(pts: readonly number[], passes: number): number[] {
  let cur = [...pts];
  for (let p = 0; p < passes; p += 1) {
    const next = [cur[0], cur[1]];
    for (let i = 0; i + 3 < cur.length; i += 2) {
      const [x0, z0, x1, z1] = [cur[i], cur[i + 1], cur[i + 2], cur[i + 3]];
      next.push(0.75 * x0 + 0.25 * x1, 0.75 * z0 + 0.25 * z1, 0.25 * x0 + 0.75 * x1, 0.25 * z0 + 0.75 * z1);
    }
    next.push(cur[cur.length - 2], cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/**
 * Roundabout centre tile: from the entry lane onto the ring (radius RING_RADIUS), counter-clockwise
 * seen from above with north up (right-hand traffic), off onto the exit lane. Straight on is half a
 * lap, a U-turn nearly a full one. Kind 'right' so cars take it at turning speed.
 */
function buildRingPath(inDir: Dir, outDir: Dir): LanePath {
  const dix = DIR_X[inDir];
  const diz = DIR_Z[inDir];
  const dox = DIR_X[outDir];
  const doz = DIR_Z[outDir];
  const startX = -dix * HALF - diz * LANE_OFFSET;
  const startZ = -diz * HALF + dix * LANE_OFFSET;
  const endX = dox * HALF - doz * LANE_OFFSET;
  const endZ = doz * HALF + dox * LANE_OFFSET;
  // Where each lane line meets the ring (the lane is LANE_OFFSET off a line through the centre).
  const along = Math.sqrt(RING_RADIUS * RING_RADIUS - LANE_OFFSET * LANE_OFFSET);
  const inX = -dix * along - diz * LANE_OFFSET;
  const inZ = -diz * along + dix * LANE_OFFSET;
  const outX = dox * along - doz * LANE_OFFSET;
  const outZ = doz * along + dox * LANE_OFFSET;
  // Screen angle (north up): φ = atan2(−z, x); counter-clockwise = increasing φ.
  const a0 = Math.atan2(-inZ, inX);
  let sweep = Math.atan2(-outZ, outX) - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(4, Math.ceil((sweep / (Math.PI / 2)) * ARC_STEPS));
  const pts: number[] = [startX, startZ];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + (sweep * i) / steps;
    pts.push(Math.cos(a) * RING_RADIUS, -Math.sin(a) * RING_RADIUS);
  }
  pts.push(endX, endZ);
  return finishPath('right', smooth(pts, 2));
}

/** All 16 manoeuvres, indexed [inDir * 4 + outDir]. */
const PATHS: readonly LanePath[] = Array.from({ length: 16 }, (_, i) => buildPath((i >> 2) as Dir, (i & 3) as Dir));
const RING_PATHS: readonly LanePath[] = Array.from({ length: 16 }, (_, i) => buildRingPath((i >> 2) as Dir, (i & 3) as Dir));

export function lanePath(inDir: Dir, outDir: Dir): LanePath {
  return PATHS[inDir * 4 + outDir];
}

/** The manoeuvre across a roundabout's centre tile (see buildRingPath). */
export function ringPath(inDir: Dir, outDir: Dir): LanePath {
  return RING_PATHS[inDir * 4 + outDir];
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
