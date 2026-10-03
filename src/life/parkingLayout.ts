/**
 * Pure car-park geometry: where the stalls are and how a car drives into and out of one.
 *
 * Lot space: x ∈ [0, 2], y ∈ [0, depth], world units, y = 0 the open front and +y into the lot (the frame of
 * scripts/build-parking.py layout()). The front block of gate e ∈ {0, 1} is x ∈ [e, e + 1], y ∈ [−1, 0].
 * Angles are degrees counter-clockwise from +x, seen from above with +y up.
 *
 * A route is a list of legs, each a pre-sampled polyline driven at one speed in one direction, so sampling is
 * allocation-free. Routes are arcs and lines; every arc's radius caps its leg's speed (yaw rate ≤ 1.2 rad/s).
 *  - Aisle lots (medium, large): an entry runs from the gate's street lane at the lot edge to the stall; an
 *    exit reverses into the aisle and drives to the gate's outbound lane at the lot edge.
 *  - The small lot's bays open onto the street, so its routes include the manoeuvre inside the front block.
 * The numbers in the route tables are tuned against the models; parkingLayout.test.ts sweeps every route.
 */
import { placedFootprint } from '../catalog/objects';
import { footprintCentreWorld } from '../game/config';
import type { PlacedObject, Rotation } from '../town/types';

export type LotStyle = 0 | 1 | 2;
/** Lot-frame travel direction of a car entering the front block: 0 = +x, 1 = −x, 2 = +y. */
export type Approach = 0 | 1 | 2;
/** Lot-frame side through which a car leaves the front block: 0 = −x, 1 = +x, 2 = −y. */
export type ExitSide = 0 | 1 | 2;

export interface LotLeg {
  /** Flat [x0, y0, x1, y1, ...] polyline in lot space, in travel order. */
  readonly points: Float32Array;
  readonly cum: Float32Array;
  readonly length: number;
  /** The car travels tail first: its facing is the opposite of the travel tangent. */
  readonly reverse: boolean;
  /** Top speed on this leg, world units per second. */
  readonly speed: number;
  /** Unit travel tangent at each point, flat like `points`. */
  readonly tangents: Float32Array;
}

export interface LotRoute {
  readonly legs: readonly LotLeg[];
  /** Exit routes: the car waits here until the gate's front block is free (leg index, arc length). Entry routes: −1, 0. */
  readonly holdLeg: number;
  readonly holdS: number;
  /** Entry routes: the front block is free once the car passes here (its whole body is inside the lot). Exit routes: −1, 0. */
  readonly clearLeg: number;
  readonly clearS: number;
}

/** Position and unit facing (bonnet direction) in lot space. */
export interface LotSample {
  x: number;
  y: number;
  hx: number;
  hy: number;
}

// Mirrors of scripts/build-parking.py (the test reads the script and compares).
export const KERB_W = 0.1;
export const STALL_W = 0.35;
export const STALL_D = 0.6;
export const APRON_D = 0.5;
export const ISLAND_D = 0.3;
export const AISLE_W = 0.6;
export const LOT_W = 2;

export interface LotSpec {
  /** Lot depth in road blocks (= world units). */
  readonly depth: number;
  /** 'bays': one row of nose-in bays off the street. 'aisle': two columns of stalls along a middle aisle. */
  readonly kind: 'bays' | 'aisle';
  /** Stalls per group; an aisle column's groups are separated by planter islands. */
  readonly groups: readonly number[];
}

export const LOT_SPECS: readonly LotSpec[] = [
  { depth: 1, kind: 'bays', groups: [4] },
  { depth: 2, kind: 'aisle', groups: [4] },
  { depth: 3, kind: 'aisle', groups: [3, 3] },
];

/** Half length and half width of the box a route keeps clear: the largest car plus 0.015. */
const BODY_L = 0.26;
const BODY_W = 0.1425;
/** The body counts as inside the lot once every corner is this far behind the front edge. */
const INSIDE_Y = 0.035;

const FORWARD_SPEED = 0.45;
const REVERSE_SPEED = 0.3;
/** Speed per unit of arc radius: just under the 1.2 rad/s yaw limit. */
const YAW_RATE = 1.15;
/** Degrees of arc per polyline segment, at most. */
const ARC_STEP = 3;

const MIN_LEG = 0.03;

const RAD = Math.PI / 180;

interface Pose {
  x: number;
  y: number;
  /** Facing, degrees. */
  deg: number;
}

/** Stall poses per style: bays left to right; aisle lots the left column front to back, then the right one. */
function layoutStalls(spec: LotSpec): Pose[] {
  const out: Pose[] = [];
  if (spec.kind === 'bays') {
    const n = spec.groups[0];
    const side = (LOT_W - 2 * KERB_W - n * STALL_W) / 2;
    for (let i = 0; i < n; i += 1) out.push({ x: KERB_W + side + (i + 0.5) * STALL_W, y: STALL_D / 2, deg: 90 });
    return out;
  }
  const columns: ReadonlyArray<readonly [number, number]> = [
    [KERB_W + STALL_D / 2, 180],
    [LOT_W - KERB_W - STALL_D / 2, 0],
  ];
  for (const [x, deg] of columns) {
    let y = APRON_D;
    spec.groups.forEach((n, group) => {
      for (let k = 0; k < n; k += 1) out.push({ x, y: y + (k + 0.5) * STALL_W, deg });
      y += n * STALL_W + (group < spec.groups.length - 1 ? ISLAND_D : 0);
    });
  }
  return out;
}

const STALLS: ReadonlyArray<readonly Pose[]> = LOT_SPECS.map(layoutStalls);

export function stallCount(style: LotStyle): number {
  return STALLS[style].length;
}

/** The parked pose: stall centre, nose in. */
export function stallPose(style: LotStyle, stall: number, out: LotSample): LotSample {
  const pose = STALLS[style][stall];
  out.x = pose.x;
  out.y = pose.y;
  out.hx = pose.deg === 0 ? 1 : pose.deg === 180 ? -1 : 0;
  out.hy = pose.deg === 90 ? 1 : 0;
  return out;
}

// --- Route building ---------------------------------------------------------------------------------

/**
 * One step of a manoeuvre: a line (length null = solved so the route ends on its target; at most two per
 * route), an arc (radius, signed change of facing in degrees) or a switch to reverse / forward gear.
 */
type Step = { readonly line: number | null } | { readonly arc: number; readonly turn: number } | 'reverse' | 'forward';

const line = (length: number): Step => ({ line: length });
const FREE: Step = { line: null };
const arc = (radius: number, turn: number): Step => ({ arc: radius, turn });

/** Fills in the free line lengths so the steps lead from `start` to `end`; null when they cannot. */
function solve(steps: readonly Step[], start: Pose, end: Pose): Step[] | null {
  let x = start.x;
  let y = start.y;
  let heading = start.deg * RAD;
  let gear = 1;
  const free: number[] = [];
  for (const step of steps) {
    if (step === 'reverse') gear = -1;
    else if (step === 'forward') gear = 1;
    else if ('line' in step) {
      const dx = Math.cos(heading) * gear;
      const dy = Math.sin(heading) * gear;
      if (step.line === null) free.push(dx, dy);
      else {
        x += dx * step.line;
        y += dy * step.line;
      }
    } else if (step.turn !== 0) {
      const travel = heading + (gear < 0 ? Math.PI : 0);
      const side = Math.sign(step.turn);
      const cx = x - side * step.arc * Math.sin(travel);
      const cy = y + side * step.arc * Math.cos(travel);
      const turn = step.turn * RAD;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const rx = x - cx;
      const ry = y - cy;
      x = cx + rx * c - ry * s;
      y = cy + rx * s + ry * c;
      heading += turn;
    }
  }
  const off = (((heading / RAD - end.deg) % 360) + 540) % 360 - 180;
  if (Math.abs(off) > 1e-6) return null;
  const rx = end.x - x;
  const ry = end.y - y;
  const lengths: number[] = [];
  if (free.length === 4) {
    const det = free[0] * free[3] - free[2] * free[1];
    if (Math.abs(det) < 1e-6) return null;
    lengths.push((rx * free[3] - free[2] * ry) / det, (free[0] * ry - free[1] * rx) / det);
  } else if (free.length === 2) {
    const along = rx * free[0] + ry * free[1];
    if (Math.hypot(rx - along * free[0], ry - along * free[1]) > 1e-6) return null;
    lengths.push(along);
  } else if (free.length !== 0 || Math.hypot(rx, ry) > 1e-6) return null;
  if (lengths.some((length) => length < -1e-9)) return null;
  let next = 0;
  return steps.map((step) => (typeof step === 'object' && 'line' in step && step.line === null ? line(Math.max(0, lengths[next++])) : step));
}

interface LegDraft {
  points: number[];
  tangents: number[];
  reverse: boolean;
  speed: number;
}

function finishLeg(draft: LegDraft): LotLeg {
  const points = new Float32Array(draft.points);
  const count = points.length / 2;
  const cum = new Float32Array(count);
  for (let i = 1; i < count; i += 1) {
    cum[i] = cum[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
  }
  return { points, cum, length: cum[count - 1], reverse: draft.reverse, speed: draft.speed, tangents: new Float32Array(draft.tangents) };
}

/** Traces solved steps into legs: a new leg wherever the gear or the speed changes. */
function trace(steps: readonly Step[], start: Pose): LotLeg[] {
  let x = start.x;
  let y = start.y;
  let heading = start.deg * RAD;
  let gear = 1;
  const drafts: LegDraft[] = [];
  const legFor = (speed: number): LegDraft => {
    const last = drafts[drafts.length - 1];
    if (last && last.reverse === gear < 0 && Math.abs(last.speed - speed) < 1e-9) return last;
    const travel = heading + (gear < 0 ? Math.PI : 0);
    const draft: LegDraft = { points: [x, y], tangents: [Math.cos(travel), Math.sin(travel)], reverse: gear < 0, speed };
    drafts.push(draft);
    return draft;
  };
  for (const step of steps) {
    if (step === 'reverse') gear = -1;
    else if (step === 'forward') gear = 1;
    else if ('line' in step) {
      const length = step.line ?? 0;
      if (length < 1e-6) continue;
      // A very short line joins the leg before it rather than making a leg of its own.
      const last = drafts[drafts.length - 1];
      const draft = length < MIN_LEG && last && last.reverse === gear < 0 ? last : legFor(gear < 0 ? REVERSE_SPEED : FORWARD_SPEED);
      const tx = Math.cos(heading) * gear;
      const ty = Math.sin(heading) * gear;
      x += tx * length;
      y += ty * length;
      draft.points.push(x, y);
      draft.tangents.push(tx, ty);
    } else if (step.turn !== 0) {
      const draft = legFor(Math.min(gear < 0 ? REVERSE_SPEED : FORWARD_SPEED, YAW_RATE * step.arc));
      const travel = heading + (gear < 0 ? Math.PI : 0);
      const side = Math.sign(step.turn);
      const cx = x - side * step.arc * Math.sin(travel);
      const cy = y + side * step.arc * Math.cos(travel);
      const rx = x - cx;
      const ry = y - cy;
      const turn = step.turn * RAD;
      const count = Math.ceil(Math.abs(step.turn) / ARC_STEP);
      for (let i = 1; i <= count; i += 1) {
        const a = (turn * i) / count;
        const c = Math.cos(a);
        const s = Math.sin(a);
        x = cx + rx * c - ry * s;
        y = cy + rx * s + ry * c;
        draft.points.push(x, y);
        draft.tangents.push(Math.cos(travel + a), Math.sin(travel + a));
      }
      heading += turn;
    }
  }
  return drafts.map(finishLeg);
}

const scratchSample: LotSample = { x: 0, y: 0, hx: 0, hy: 0 };

/** Is the whole body behind the lot's front edge at this sample? */
function bodyInside(sample: LotSample): boolean {
  return sample.y - Math.abs(sample.hy) * BODY_L - Math.abs(sample.hx) * BODY_W >= INSIDE_Y;
}

const MARK_STEP = 0.005;

/** Entry: the first point after which the body stays inside the lot. Exit: the last point up to which it has. */
function markInside(legs: readonly LotLeg[], entry: boolean): { leg: number; s: number } {
  const mark = { leg: entry ? legs.length - 1 : 0, s: entry ? legs[legs.length - 1].length : 0 };
  for (let n = 0; n < legs.length; n += 1) {
    const index = entry ? legs.length - 1 - n : n;
    const leg = legs[index];
    const count = Math.ceil(leg.length / MARK_STEP);
    for (let i = 0; i <= count; i += 1) {
      const s = (leg.length * (entry ? count - i : i)) / count;
      if (!bodyInside(sampleLeg(leg, s, scratchSample))) return mark;
      mark.leg = index;
      mark.s = s;
    }
  }
  return mark;
}

function buildRoute(start: Pose, end: Pose, steps: readonly Step[], entry: boolean, holdInStall: boolean): LotRoute | null {
  const solved = solve(steps, start, end);
  if (!solved) return null;
  const legs = trace(solved, start);
  if (entry) {
    const clear = markInside(legs, true);
    return { legs, holdLeg: -1, holdS: 0, clearLeg: clear.leg, clearS: clear.s };
  }
  const hold = holdInStall ? { leg: 0, s: 0 } : markInside(legs, false);
  return { legs, holdLeg: hold.leg, holdS: hold.s, clearLeg: -1, clearS: 0 };
}

// --- Route tables -----------------------------------------------------------------------------------
// Radii and lengths in world units, turns in degrees (+ = the facing turns counter-clockwise).

/** Offset of a lane centre from its block's edge: the right-hand lane heading +x or +y sits at 0.68, the other at 0.32. */
const LANE_IN = 0.68;
const LANE_OUT = 0.32;

type Row = readonly number[];

/** Three arcs joined by two solved lines, then a straight run: [r0, turn0, r1, turn1, r2, straight]; the last arc makes up `total`. */
const swingIn = (p: Row, total: number): Step[] => [arc(p[0], p[1]), FREE, arc(p[2], p[3]), FREE, arc(p[4], total - p[1] - p[3]), line(p[5])];

/** An S onto the aisle, up the aisle, a quarter turn into the stall: [r0, turn0, straight, r1, r2]. */
const aisleIn = (p: Row, quarter: number): Step[] => [arc(p[0], p[1]), line(p[2]), arc(p[3], -p[1]), FREE, arc(p[4], quarter), FREE, line(0.1)];

/**
 * Back out and turn until the nose points at the street, down the aisle, an S to the gate:
 * [straight back, reverse radius, reverse turn, forward radius, r3, turn3, r4]. The forward arc makes up the quarter turn.
 */
const aisleOut = (p: Row, quarter: number): Step[] => [
  'reverse', line(p[0]), arc(p[1], p[2]),
  'forward', arc(p[3], quarter - p[2]), FREE, arc(p[4], p[5]), FREE, arc(p[6], -p[5]),
];

/**
 * Out of a bay: back (line, arc, solved line, arc), then forward (arc, line, arc, solved line to the block edge):
 * [back, r0, turn0, r1, turn1, r2, turn2, straight, r3]; the last arc makes up `total`.
 */
const bayOut = (p: Row, total: number): Step[] => [
  'reverse', line(p[0]), arc(p[1], p[2]), FREE, arc(p[3], p[4]),
  'forward', arc(p[5], p[6]), line(p[7]), arc(p[8], total - p[2] - p[4] - p[6]), FREE,
];

/** Aisle entries [gate][column][0 = first stall, 1 = second stall (swingIn rows), 2 = further in (an aisleIn row)]. */
const AISLE_IN: ReadonlyArray<ReadonlyArray<readonly Row[]>> = [
  [
    [[0.399, -33.52, 0.204, 95.414, 0.509, 0.1], [0.458, -32.838, 0.378, 98.935, 0.509, 0.1], [0.396, -53.178, 0.141, 0.433, 0.625]],
    [[0.392, -54.393, 0.696, -20.136, 0.392, 0.1], [0.392, -30.969, 0.499, -43.556, 0.392, 0.1], [0.678, -21.558, 0.287, 0.602, 0.625]],
  ],
  [
    [[0.304, 67.121, 0.638, -10, 0.51, 0.1], [0.304, 63.424, 0.632, -27.203, 0.508, 0.1], [0.261, 90, 0, 0.294, 0.625]],
    [[0.245, 97.425, 0.2, -159.164, 0.509, 0.1], [0.3, 71.068, 0.347, -145.684, 0.39, 0.1], [0.305, 90, 0.056, 0.444, 0.625]],
  ],
];

/**
 * Aisle exits (aisleOut rows) [column][room behind the stall][gate]. Room 0: two stalls or more, a wide reverse
 * arc. Room 1: one stall or a planter island, a short one. Room 2: the last stall backs onto the rear kerb, so it
 * reverses straight and drives off with a tight turn.
 */
const AISLE_OUT: ReadonlyArray<ReadonlyArray<readonly Row[]>> = [
  [
    [[0.037, 0.631, 90, 0.2, 0.7, -62.993, 0.304], [0.037, 0.631, 90, 0.2, 0.7, 20, 0.7]],
    [[0.4, 0.28, 90, 0.2, 0.7, -62.762, 0.304], [0.4, 0.28, 90, 0.2, 0.7, 20, 0.7]],
    [[0.672, 0.2, 0, 0.171, 0.41, -63.396, 0.313], [0.672, 0.2, 0, 0.171, 0.7, 20, 0.7]],
  ],
  [
    [[0.037, 0.631, -90, 0.2, 0.455, -63.55, 0.304], [0.037, 0.631, -90, 0.2, 0.661, 20.001, 0.7]],
    [[0.4, 0.28, -90, 0.2, 0.45, -64.399, 0.305], [0.4, 0.28, -90, 0.2, 0.7, 20, 0.7]],
    [[0.672, 0.2, 0, 0.171, 0.7, -62.155, 0.313], [0.672, 0.2, 0, 0.171, 0.7, 20, 0.7]],
  ],
];

/** Small-lot entries (swingIn rows) [stall][approach]. */
const BAY_IN: ReadonlyArray<readonly Row[]> = [
  [[0.391, 28.674, 0.392, 51.622, 0.392, 0.1], [0.828, 4.133, 0.405, -70.216, 0.632, 0.1], [0.392, 10.354, 0.9, -4, 0.392, 0.1]],
  [[0.518, 38.419, 0.394, 38.619, 0.417, 0], [0.294, 55.514, 0.16, -200, 0.672, 0.009], [0.392, -6.229, 0.9, -4, 0.392, 0]],
  [[0.165, 28.978, 0.391, 72.483, 0.435, 0.009], [0.869, 17.763, 0.316, -94.825, 0.405, 0.001], [0.392, 26.585, 0.892, -16.405, 0.392, 0]],
  [[0.391, 58.753, 0.392, 14.878, 0.62, 0.1], [0.392, -40.875, 0.9, -4.011, 0.508, 0.1], [0.392, 11.557, 0.834, -4.019, 0.392, 0.1]],
];
const BAY_IN_TURN: Row = [90, -90, 0];

/** Small-lot exits (bayOut rows) [stall][exit], and which way round the car turns to face south. */
const BAY_OUT: ReadonlyArray<readonly Row[]> = [
  [[0.033, 0.759, 11.023, 0.261, 50.568, 0.392, 59.892, 0.015, 0.48], [0.492, 0.269, -15.8, 0.261, -44.122, 0.227, -77.1, 0.126, 0.396], [0.064, 0.766, 26.994, 0.261, 31.799, 0.16, 73.485, 0, 0.444]],
  [[0.005, 0.312, -12.542, 0.261, 33.247, 0.304, 87.202, 0.231, 0.395], [0.002, 0.376, -8.559, 0.261, -73.024, 0.392, -28.596, 0.172, 0.392], [0.008, 0.263, -12.412, 0.261, 30.844, 0.16, 113.836, 0, 0.391]],
  [[0.001, 0.468, 11.965, 0.261, 46.006, 0.391, 39.032, 0.035, 0.797], [0.005, 0.345, 12.746, 0.261, -42.251, 0.229, -96.373, 0.083, 0.509], [0.004, 0.376, 12.914, 0.261, 90, 0.295, 25.48, 0, 0.392]],
  [[0.408, 0.262, 31.95, 0.261, 19.032, 0.391, 66.251, 0.02, 0.391], [0.595, 0.432, -4.622, 0.261, -65.545, 0.391, -48.354, 0.069, 0.561], [0.012, 0.747, -21.02, 0.293, -31.107, 0.209, -170.184, 0.303, 0.374]],
];
const BAY_OUT_SOUTH_TURN: Row = [180, 180, 180, -180];

function aisleEntry(style: number, gate: number, stall: number): LotRoute | null {
  const perColumn = STALLS[style].length / 2;
  const column = stall < perColumn ? 0 : 1;
  const k = stall % perColumn;
  // From the right-hand gate the first two right-hand stalls are a loop round the sign: not offered.
  if (gate === 1 && column === 1 && k < 2) return null;
  const quarter = column === 0 ? 90 : -90;
  const row = AISLE_IN[gate][column][Math.min(k, 2)];
  return buildRoute({ x: gate + LANE_IN, y: 0, deg: 90 }, STALLS[style][stall], k < 2 ? swingIn(row, quarter) : aisleIn(row, quarter), true, false);
}

function aisleExit(style: number, stall: number, gate: number): LotRoute | null {
  const spec = LOT_SPECS[style];
  const perColumn = STALLS[style].length / 2;
  const column = stall < perColumn ? 0 : 1;
  const k = stall % perColumn;
  let first = 0;
  let group = 0;
  while (k >= first + spec.groups[group]) {
    first += spec.groups[group];
    group += 1;
  }
  // Stalls behind this one before a kerb: a planter island, or the rear kerb after the last group.
  const behind = first + spec.groups[group] - 1 - k;
  const lastGroup = group === spec.groups.length - 1;
  const room = behind === 0 ? (lastGroup ? 2 : 1) : behind === 1 && lastGroup ? 1 : 0;
  return buildRoute(STALLS[style][stall], { x: gate + LANE_OUT, y: 0, deg: 270 }, aisleOut(AISLE_OUT[column][room][gate], column === 0 ? 90 : -90), false, false);
}

function smallEntry(gate: number, approach: number, stall: number): LotRoute | null {
  if (stall >> 1 !== gate) return null;
  // Stalls 1 and 2 sit right over the lane a car arrives on from the other front block: only a hairpin reaches them.
  if ((stall === 1 && approach === 1) || (stall === 2 && approach === 0)) return null;
  const start: Pose = approach === 0 ? { x: gate, y: -LANE_IN, deg: 0 } : approach === 1 ? { x: gate + 1, y: -LANE_OUT, deg: 180 } : { x: gate + LANE_IN, y: -1, deg: 90 };
  return buildRoute(start, STALLS[0][stall], swingIn(BAY_IN[stall][approach], BAY_IN_TURN[approach]), true, false);
}

function smallExit(stall: number, gate: number, exit: number): LotRoute | null {
  if (stall >> 1 !== gate) return null;
  const end: Pose = exit === 0 ? { x: gate, y: -LANE_OUT, deg: 180 } : exit === 1 ? { x: gate + 1, y: -LANE_IN, deg: 0 } : { x: gate + LANE_OUT, y: -1, deg: 270 };
  const total = exit === 0 ? 90 : exit === 1 ? -90 : BAY_OUT_SOUTH_TURN[stall];
  return buildRoute(STALLS[0][stall], end, bayOut(BAY_OUT[stall][exit], total), false, true);
}

/** Entry routes [style][gate][approach][stall] and exit routes [style][stall][gate][exit]; aisle lots share one route across approaches / exits. */
const ENTRIES: Array<LotRoute | null>[][][] = [];
const EXITS: Array<LotRoute | null>[][][] = [];

for (let style = 0; style < LOT_SPECS.length; style += 1) {
  const count = STALLS[style].length;
  ENTRIES.push([0, 1].map((gate) => {
    if (style === 0) return [0, 1, 2].map((approach) => STALLS[style].map((_, stall) => smallEntry(gate, approach, stall)));
    const routes = STALLS[style].map((_, stall) => aisleEntry(style, gate, stall));
    return [routes, routes, routes];
  }));
  EXITS.push(Array.from({ length: count }, (_, stall) => [0, 1].map((gate) => {
    if (style === 0) return [0, 1, 2].map((exit) => smallExit(stall, gate, exit));
    const route = aisleExit(style, stall, gate);
    return [route, route, route];
  })));
}

/** The drive from the street into `stall`, or null when it cannot be driven cleanly from there. */
export function entryRoute(style: LotStyle, gate: 0 | 1, approach: Approach, stall: number): LotRoute | null {
  return ENTRIES[style][gate][approach][stall] ?? null;
}

/** The drive out of `stall` to the street through `gate`, or null when it cannot be driven cleanly. */
export function exitRoute(style: LotStyle, stall: number, gate: 0 | 1, exit: ExitSide): LotRoute | null {
  return EXITS[style][stall]?.[gate][exit] ?? null;
}

/** Position and facing at arc length `s` along a leg (clamped). The facing turns smoothly between points. Writes into `out`. */
export function sampleLeg(leg: LotLeg, s: number, out: LotSample): LotSample {
  const { points, cum, tangents } = leg;
  const last = cum.length - 1;
  const d = Math.min(Math.max(s, 0), leg.length);
  let i = 0;
  while (i < last - 1 && cum[i + 1] < d) i += 1;
  const segment = cum[i + 1] - cum[i];
  const t = segment > 0 ? Math.min((d - cum[i]) / segment, 1) : 0;
  const a = i * 2;
  out.x = points[a] + (points[a + 2] - points[a]) * t;
  out.y = points[a + 1] + (points[a + 3] - points[a + 1]) * t;
  const tx = tangents[a] + (tangents[a + 2] - tangents[a]) * t;
  const ty = tangents[a + 1] + (tangents[a + 3] - tangents[a + 1]) * t;
  const inv = (leg.reverse ? -1 : 1) / Math.hypot(tx, ty);
  out.hx = tx * inv;
  out.hy = ty * inv;
  return out;
}

// --- Lot ↔ world ------------------------------------------------------------------------------------

export interface LotFrame {
  /** World centre of the lot's footprint. */
  x: number;
  z: number;
  rotation: Rotation;
  style: LotStyle;
  depth: number;
}

const QUARTER_COS: readonly number[] = [1, 0, -1, 0];
const QUARTER_SIN: readonly number[] = [0, 1, 0, -1];

export function lotFrame(object: Pick<PlacedObject, 'anchor' | 'rotation' | 'variant' | 'kind'>, out: LotFrame): LotFrame {
  footprintCentreWorld(object.anchor, placedFootprint(object), object.rotation, out);
  out.rotation = object.rotation;
  out.style = (object.variant >= 0 && object.variant < LOT_SPECS.length ? object.variant : 0) as LotStyle;
  out.depth = LOT_SPECS[out.style].depth;
  return out;
}

/** A lot-space position and facing in world space (the model turns `rotation` quarter turns counter-clockwise about +Y). */
export function lotToWorld(frame: LotFrame, sample: LotSample, out: { x: number; z: number; hx: number; hz: number }): void {
  const c = QUARTER_COS[frame.rotation];
  const s = QUARTER_SIN[frame.rotation];
  const mx = sample.x - LOT_W / 2;
  const mz = frame.depth / 2 - sample.y;
  out.x = frame.x + mx * c + mz * s;
  out.z = frame.z - mx * s + mz * c;
  out.hx = sample.hx * c - sample.hy * s;
  out.hz = -sample.hx * s - sample.hy * c;
}
