/**
 * Pure lane geometry. A car crosses one road tile ("cell" below) per manoeuvre: it enters through the
 * edge it is travelling across (`inDir`) and leaves through `outDir`. Traffic keeps to the right, so
 * every manoeuvre starts and ends on the right-hand lane centre.
 *  - straight  (out == in):      a line through the cell.
 *  - right turn (out == in + 1): a tight quarter arc around the near corner.
 *  - left turn  (out == in + 3): a wide quarter arc that crosses the oncoming lane.
 *  - U-turn     (out == in + 2): drive to the middle, loop round, drive back.
 *  - roundabout: counter-clockwise on the outer lane of the ring road; see the roundabout section.
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
/**
 * Radius of the roundabout's outer lane, from the island centre. The road model (3 × 3 tiles) has the
 * island kerb at r 0.25-0.45, the lane marking at 0.755, the gutter from about 1.05 and the outer
 * kerb at 1.15-1.25: the lane centre sits between the marking and the gutter.
 */
export const RING_RADIUS = 0.93;
/** Distance along an arm (from the island centre) where the lane starts to bend onto or off the ring. */
const ARM_JOIN = 1.15;
/** Angle round the ring, past the arm's lane line, where a car joining from an arm is on the ring (mirrored for leaving). */
const MERGE_ANGLE = (22 * Math.PI) / 180;
const ENTRY_ANGLE = Math.asin(LANE_OFFSET / RING_RADIUS) + MERGE_ANGLE;
const CURVE_STEPS = 12;

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

/*
 * Roundabout. Everything is worked out in island-centre coordinates (x east, z south) and shifted into
 * the block that owns each stretch. Arm `d` points from the island towards direction d. "a" is the
 * distance along the arm and "l" the offset to the right of a car driving in, so the entry lane is at
 * +LANE_OFFSET and the exit lane at -LANE_OFFSET. A car bends right onto the ring and right off it;
 * the ring itself runs counter-clockwise (right-hand traffic) on its outer lane.
 *  - arm block, driving in:  the straight lane, then a curve tangent to the ring (armPath).
 *  - centre block:           the ring arc from one arm's merge point to the next exit (ringPath).
 *  - arm block, driving out: the mirror image of driving in.
 *  - arm block, turning round (an arm with no road beyond it): out, a half circle, in.
 */

/** Appends the island-centre point at arm distance `a` and lateral offset `l`. */
function armPoint(out: number[], d: Dir, a: number, l: number): void {
  out.push(DIR_X[d] * a + DIR_Z[d] * l, DIR_Z[d] * a - DIR_X[d] * l);
}

/** Appends the point of the outer lane at angle `psi` from arm d's axis (positive towards its entry side). */
function ringPoint(out: number[], d: Dir, psi: number): void {
  armPoint(out, d, RING_RADIUS * Math.cos(psi), RING_RADIUS * Math.sin(psi));
}

/** Counter-clockwise direction of travel at `ringPoint(_, d, psi)`. */
function ringTangent(d: Dir, psi: number): [number, number] {
  return [-DIR_X[d] * Math.sin(psi) + DIR_Z[d] * Math.cos(psi), -DIR_Z[d] * Math.sin(psi) - DIR_X[d] * Math.cos(psi)];
}

/** Appends a cubic Hermite from p0 to p1 with unit end tangents t0 and t1, every point after p0. */
function hermite(out: number[], p0: readonly number[], t0: readonly number[], p1: readonly number[], t1: readonly number[]): void {
  const k = 0.5 * Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  for (let i = 1; i <= CURVE_STEPS; i += 1) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    for (let c = 0; c < 2; c += 1) out.push(w0 * p0[c] + w1 * (p0[c] + t0[c] * k) + w2 * (p1[c] - t1[c] * k) + w3 * p1[c]);
  }
}

/** Appends the bend from the entry lane (at ARM_JOIN along arm d) onto the ring; the lane point is not repeated. */
function mergeCurve(out: number[], d: Dir): void {
  const lane: number[] = [];
  armPoint(lane, d, ARM_JOIN, LANE_OFFSET);
  const ring: number[] = [];
  ringPoint(ring, d, ENTRY_ANGLE);
  hermite(out, lane, [-DIR_X[d], -DIR_Z[d]], ring, ringTangent(d, ENTRY_ANGLE));
}

/** Appends the bend from the ring (starting at its diverge point, not repeated) to the exit lane at ARM_JOIN along arm d. */
function divergeCurve(out: number[], d: Dir): void {
  const ring: number[] = [];
  ringPoint(ring, d, -ENTRY_ANGLE);
  const lane: number[] = [];
  armPoint(lane, d, ARM_JOIN, -LANE_OFFSET);
  hermite(out, ring, ringTangent(d, -ENTRY_ANGLE), lane, [DIR_X[d], DIR_Z[d]]);
}

const armAngle = (d: Dir): number => Math.atan2(-DIR_Z[d], DIR_X[d]);

type ArmManoeuvre = 'in' | 'out' | 'turn';

/** An arm block's path, in its own frame: its centre is one tile out from the island centre. */
function buildArmPath(d: Dir, manoeuvre: ArmManoeuvre): LanePath {
  const pts: number[] = [];
  const edge = HALF + ROAD_TILE_SIZE;
  if (manoeuvre === 'in') {
    armPoint(pts, d, edge, LANE_OFFSET);
    armPoint(pts, d, ARM_JOIN, LANE_OFFSET);
    mergeCurve(pts, d);
  } else {
    ringPoint(pts, d, -ENTRY_ANGLE);
    divergeCurve(pts, d);
    if (manoeuvre === 'out') {
      armPoint(pts, d, edge, -LANE_OFFSET);
    } else {
      // Half circle round the arm's axis, from the exit lane over the far side to the entry lane.
      for (let i = 1; i < ARC_STEPS; i += 1) {
        const t = (i / ARC_STEPS) * Math.PI;
        armPoint(pts, d, ARM_JOIN + Math.sin(t) * LANE_OFFSET, -Math.cos(t) * LANE_OFFSET);
      }
      armPoint(pts, d, ARM_JOIN, LANE_OFFSET);
      mergeCurve(pts, d);
    }
  }
  for (let i = 0; i < pts.length; i += 2) {
    pts[i] -= DIR_X[d] * ROAD_TILE_SIZE;
    pts[i + 1] -= DIR_Z[d] * ROAD_TILE_SIZE;
  }
  return finishPath(manoeuvre === 'turn' ? 'uturn' : 'right', pts);
}

/**
 * Centre block: the outer-lane arc from the merge point of the arm the car came in by (it travels
 * towards `inDir`) to the diverge point of the arm it leaves by (`outDir`), counter-clockwise.
 * Straight on is about a third of a lap, leaving by the arm it came in on most of one. The points lie
 * outside the centre block's own tile: the ring runs through the arm and corner blocks. Kind 'right'
 * so cars take it at turning speed.
 */
function buildRingPath(inDir: Dir, outDir: Dir): LanePath {
  const a0 = armAngle(opposite(inDir)) + ENTRY_ANGLE;
  let sweep = armAngle(outDir) - ENTRY_ANGLE - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(4, Math.ceil((sweep / (Math.PI / 2)) * ARC_STEPS));
  const pts: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + (sweep * i) / steps;
    pts.push(Math.cos(a) * RING_RADIUS, -Math.sin(a) * RING_RADIUS);
  }
  return finishPath('right', pts);
}

/** All 16 manoeuvres, indexed [inDir * 4 + outDir]. */
const PATHS: readonly LanePath[] = Array.from({ length: 16 }, (_, i) => buildPath((i >> 2) as Dir, (i & 3) as Dir));
const RING_PATHS: readonly LanePath[] = Array.from({ length: 16 }, (_, i) => buildRingPath((i >> 2) as Dir, (i & 3) as Dir));
const ARM_MANOEUVRES: readonly ArmManoeuvre[] = ['in', 'out', 'turn'];
/** Indexed [arm * 3 + manoeuvre]. */
const ARM_PATHS: readonly LanePath[] = Array.from({ length: 12 }, (_, i) => buildArmPath(Math.floor(i / 3) as Dir, ARM_MANOEUVRES[i % 3]));

export function lanePath(inDir: Dir, outDir: Dir): LanePath {
  return PATHS[inDir * 4 + outDir];
}

/** The manoeuvre across a roundabout's centre block (see buildRingPath). */
export function ringPath(inDir: Dir, outDir: Dir): LanePath {
  return RING_PATHS[inDir * 4 + outDir];
}

/**
 * The manoeuvre across the roundabout arm block that lies towards `arm` from the island: driving in
 * (travelling against `arm`), driving out (travelling along it) or turning round (in along `arm`, out
 * against it). The path is in the arm block's own frame.
 */
export function armPath(arm: Dir, inDir: Dir, outDir: Dir): LanePath {
  return ARM_PATHS[arm * 3 + (inDir !== outDir ? 2 : inDir === arm ? 1 : 0)];
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
