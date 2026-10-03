/**
 * Car-park layout and routes against the real parking GLBs: the stalls sit on the painted bays, and a car box
 * swept along every route stays off the planters, the sign, the kerbs and the cars parked in the other stalls.
 * Obstacles are read from the models' faces (atlas texel + height), not from the layout formula.
 *
 * Set PARKING_REPORT=1 to print each route's length, time and tightest clearances.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODELS } from '../catalog/models';
import { OBJECTS } from '../catalog/objects';
import { worldToCell } from '../game/config';
import { objectOrigin } from '../render/objectPose';
import { createGlbLoader } from '../testing/gltfNode';
import { NEIGHBOURS, ROAD_BLOCK } from '../town/grid';
import { isFeatureArm } from '../town/roadTiles';
import type { PlacedObject, Rotation } from '../town/types';
import {
  AISLE_W,
  APRON_D,
  entryRoute,
  exitRoute,
  ISLAND_D,
  KERB_W,
  LOT_SPECS,
  LOT_W,
  lotFrame,
  lotToWorld,
  sampleLeg,
  STALL_D,
  STALL_W,
  stallCount,
  stallPose,
  type Approach,
  type ExitSide,
  type LotFrame,
  type LotRoute,
  type LotSample,
  type LotStyle,
} from './parkingLayout';

const SCRIPT = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-parking.py'), 'utf8');
const scriptNumber = (name: string): number => Number(new RegExp(`^${name} = ([\\d.]+)`, 'm').exec(SCRIPT)![1]);
/** The script's UV table: texel name → [u, v] (Blender, v up). */
const TEXELS = new Map([...SCRIPT.matchAll(/^ {4}'(\w+)': \(([\d.]+), ([\d.]+)\),/gm)].map((m) => [m[1], [Number(m[2]), Number(m[3])] as const]));
const ASPHALT_Z = scriptNumber('ASPHALT_Z');
const KERB_Z = scriptNumber('KERB_Z');

const STYLES: readonly LotStyle[] = [0, 1, 2];
const CAR_W = 0.255;
const CAR_L = 0.49;
const INFLATE = 0.015;
/** Half extents of the swept box. */
const HALF_L = CAR_L / 2 + INFLATE;
const HALF_W = CAR_W / 2 + INFLATE;
/** A flat kerb may reach this far under the swept box. */
const KERB_TOLERANCE = 0.06;
const STEP = 0.01;
const MAX_YAW_RATE = 1.2;
const LANE_IN = 0.68;
const LANE_OUT = 0.32;

/** A convex polygon in lot space (or world x, z), flat [x0, y0, ...]. */
interface Poly {
  pts: number[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function poly(pts: number[]): Poly {
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  return { pts, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => poly([x0, y0, x1, y0, x1, y1, x0, y1]);

interface Face {
  /** Model-space corners. */
  model: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** Lot-space outline. */
  lot: Poly;
  texel: string;
  /** Faces up. */
  up: boolean;
  minH: number;
  maxH: number;
}

interface Lot {
  style: LotStyle;
  depth: number;
  faces: Face[];
  /** Bay asphalt and its paint, at road height. */
  bays: Face[];
  paint: Face[];
  /** Flat kerb tops. */
  kerbs: Face[];
  /** Everything standing above kerb height: planter boxes, bushes, the sign. */
  solids: Face[];
}

const lots: Lot[] = [];

function texelOf(u: number, v: number): string {
  for (const [name, [tu, tv]] of TEXELS) if (Math.abs(u - tu) < 0.004 && Math.abs(1 - v - tv) < 0.004) return name;
  return '?';
}

beforeAll(async () => {
  const load = await createGlbLoader();
  for (const style of STYLES) {
    const id = OBJECTS.parking.models[style];
    const spec = MODELS[id];
    const gltf = await load(spec.url);
    // The renderer's normalisation (ModelLibrary): scale, quarter turns, footprint centre on the origin.
    const root = new THREE.Group();
    root.add(gltf.scene);
    gltf.scene.scale.setScalar(spec.scale);
    gltf.scene.rotation.y = (spec.rotationOffset * Math.PI) / 2;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const centre = bounds.getCenter(new THREE.Vector3());
    gltf.scene.position.set(-centre.x, -bounds.min.y, -centre.z);
    root.updateMatrixWorld(true);
    const depth = LOT_SPECS[style].depth;
    const faces: Face[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute('position');
      const uv = mesh.geometry.getAttribute('uv');
      const index = mesh.geometry.getIndex();
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        const at = (n: number) => (index ? index.getX(i + n) : i + n);
        const model = [0, 1, 2].map((n) => new THREE.Vector3().fromBufferAttribute(position, at(n)).applyMatrix4(mesh.matrixWorld)) as Face['model'];
        const normal = new THREE.Vector3().subVectors(model[1], model[0]).cross(new THREE.Vector3().subVectors(model[2], model[0])).normalize();
        faces.push({
          model,
          lot: poly(model.flatMap((p) => [p.x + LOT_W / 2, depth / 2 - p.z])),
          texel: texelOf(uv.getX(at(0)), uv.getY(at(0))),
          up: normal.y > 0.5,
          minH: Math.min(...model.map((p) => p.y)),
          maxH: Math.max(...model.map((p) => p.y)),
        });
      }
    });
    const flatAt = (face: Face, height: number) => face.up && Math.abs(face.minH - height) < 1e-3 && Math.abs(face.maxH - height) < 1e-3;
    lots.push({
      style,
      depth,
      faces,
      bays: faces.filter((face) => (face.texel === 'bay' || face.texel === 'paint') && flatAt(face, ASPHALT_Z)),
      paint: faces.filter((face) => face.texel === 'paint' && flatAt(face, ASPHALT_Z)),
      kerbs: faces.filter((face) => face.texel === 'walk_top' && flatAt(face, KERB_Z)),
      solids: faces.filter((face) => face.maxH > KERB_Z + 1e-3),
    });
  }
});

// --- 2D geometry ------------------------------------------------------------------------------------

function inTriangle(x: number, y: number, p: readonly number[]): boolean {
  const d0 = (p[2] - p[0]) * (y - p[1]) - (p[3] - p[1]) * (x - p[0]);
  const d1 = (p[4] - p[2]) * (y - p[3]) - (p[5] - p[3]) * (x - p[2]);
  const d2 = (p[0] - p[4]) * (y - p[5]) - (p[1] - p[5]) * (x - p[4]);
  const eps = 1e-7;
  return (d0 >= -eps && d1 >= -eps && d2 >= -eps) || (d0 <= eps && d1 <= eps && d2 <= eps);
}

const covered = (x: number, y: number, triangles: ReadonlyArray<readonly number[]>): boolean => triangles.some((p) => inTriangle(x, y, p));

/** Keeps the part of a polygon with sign · coordinate[axis] < limit. */
function clip(pts: number[], axis: 0 | 1, sign: number, limit: number): number[] {
  const out: number[] = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const a = sign * pts[i * 2 + axis] - limit;
    const b = sign * pts[j * 2 + axis] - limit;
    if (a < -1e-7) out.push(pts[i * 2], pts[i * 2 + 1]);
    if ((a < -1e-7 && b >= -1e-7) || (a >= -1e-7 && b < -1e-7)) {
      const t = (-1e-7 - a) / (b - a);
      out.push(pts[i * 2] + (pts[j * 2] - pts[i * 2]) * t, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * t);
    }
  }
  return out;
}

/** Does a box (centre and facing from `s`, half extents `hl` along the facing and `hw` across) overlap a polygon? */
function hits(p: Poly, s: LotSample, hl: number, hw: number): boolean {
  const reach = hl + hw;
  if (p.minX > s.x + reach || p.maxX < s.x - reach || p.minY > s.y + reach || p.maxY < s.y - reach) return false;
  let local: number[] = [];
  for (let i = 0; i < p.pts.length; i += 2) {
    const dx = p.pts[i] - s.x;
    const dy = p.pts[i + 1] - s.y;
    local.push(dx * s.hx + dy * s.hy, -dx * s.hy + dy * s.hx);
  }
  local = clip(local, 0, 1, hl);
  local = clip(local, 0, -1, hl);
  local = clip(local, 1, 1, hw);
  local = clip(local, 1, -1, hw);
  return local.length > 0;
}

function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

function corners(s: LotSample, hl: number, hw: number): number[] {
  const out: number[] = [];
  for (const [u, v] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) out.push(s.x + s.hx * hl * u - s.hy * hw * v, s.y + s.hy * hl * u + s.hx * hw * v);
  return out;
}

/** Gap between a box and a polygon (0 when they overlap), or `cap` when it is at least that. */
function gap(p: Poly, s: LotSample, hl: number, hw: number, cap: number): number {
  const reach = hl + hw + cap;
  if (p.minX > s.x + reach || p.maxX < s.x - reach || p.minY > s.y + reach || p.maxY < s.y - reach) return cap;
  if (hits(p, s, hl, hw)) return 0;
  const box = corners(s, hl, hw);
  let best = cap;
  const each = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i += 2) {
      for (let j = 0; j < b.length; j += 2) {
        const k = (j + 2) % b.length;
        best = Math.min(best, pointSegment(a[i], a[i + 1], b[j], b[j + 1], b[k], b[k + 1]));
      }
    }
  };
  each(box, p.pts);
  each(p.pts, box);
  return best;
}

// --- Obstacles --------------------------------------------------------------------------------------

function parkedBox(style: LotStyle, stall: number): Poly {
  const pose = stallPose(style, stall, { x: 0, y: 0, hx: 0, hy: 0 });
  return poly(corners(pose, CAR_L / 2, CAR_W / 2));
}

/** Everything outside the footprint, beside and behind the lot. */
function outside(depth: number): Poly[] {
  return [rect(-2, 0, 0, depth + 2), rect(LOT_W, 0, LOT_W + 2, depth + 2), rect(-2, depth, LOT_W + 2, depth + 2)];
}

/**
 * The street in front of the lot that a route may not use: everything at y < 0 except the gate block's
 * carriageway core (the part every road piece has), the lane the car arrives or leaves on (that lane's half
 * of the carriageway, to the block edge and beyond), and, with `blocks` bit 1, the other front block's core
 * and the carriageway between the two.
 */
function frontKerbs(gate: number, lane: Poly | null, blocks: number): Poly[] {
  const allowed: number[][] = [[gate + 0.1, -0.9, gate + 0.9, 0]];
  if (lane) allowed.push([lane.minX, lane.minY, lane.maxX, lane.maxY]);
  if (blocks & 2) allowed.push([1 - gate + 0.1, -0.9, 1 - gate + 0.9, 0], [0.9, -0.9, 1.1, -0.1]);
  const cuts = (values: number[], lo: number, hi: number) => [...new Set([lo, hi, ...values])].sort((a, b) => a - b);
  const xs = cuts(allowed.flatMap((r) => [r[0], r[2]]), -2, 4);
  const ys = cuts(allowed.flatMap((r) => [r[1], r[3]]), -3, 0);
  const out: Poly[] = [];
  for (let i = 0; i + 1 < xs.length; i += 1) {
    for (let j = 0; j + 1 < ys.length; j += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (!allowed.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3])) out.push(rect(xs[i], ys[j], xs[i + 1], ys[j + 1]));
    }
  }
  return out;
}

const ENTRY_LANES = (gate: number): Poly[] => [rect(gate - 0.5, -0.9, gate + 0.1, -0.5), rect(gate + 0.9, -0.5, gate + 1.5, -0.1), rect(gate + 0.5, -1.5, gate + 0.9, -0.9)];
const EXIT_LANES = (gate: number): Poly[] => [rect(gate - 0.5, -0.5, gate + 0.1, -0.1), rect(gate + 0.9, -0.9, gate + 1.5, -0.5), rect(gate + 0.1, -1.5, gate + 0.5, -0.9)];

// --- Routes -----------------------------------------------------------------------------------------

interface Case {
  name: string;
  style: LotStyle;
  stall: number;
  gate: 0 | 1;
  entry: boolean;
  /** Approach (entries) or exit side (exits). */
  side: 0 | 1 | 2;
  route: LotRoute | null;
}

const GATES: ReadonlyArray<0 | 1> = [0, 1];
const SIDES: ReadonlyArray<0 | 1 | 2> = [0, 1, 2];
const STYLE_NAMES = ['small', 'medium', 'large'];

function cases(style: LotStyle): Case[] {
  const out: Case[] = [];
  for (let stall = 0; stall < stallCount(style); stall += 1) {
    for (const gate of GATES) {
      for (const side of SIDES) {
        out.push({ name: `${STYLE_NAMES[style]} stall ${stall}: in from gate ${gate}, approach ${side}`, style, stall, gate, entry: true, side, route: entryRoute(style, gate, side as Approach, stall) });
        out.push({ name: `${STYLE_NAMES[style]} stall ${stall}: out through gate ${gate}, side ${side}`, style, stall, gate, entry: false, side, route: exitRoute(style, stall, gate, side as ExitSide) });
      }
    }
  }
  return out;
}

/** One case per distinct route: an aisle lot's routes do not depend on the approach or the exit side. */
const distinct = (style: LotStyle): Case[] => cases(style).filter((c) => c.route && (style === 0 || c.side === 0));

interface Step {
  leg: number;
  s: number;
  sample: LotSample;
}

/** The route sampled every STEP or finer, leg ends included. */
function sweep(route: LotRoute): Step[] {
  const out: Step[] = [];
  route.legs.forEach((leg, index) => {
    const count = Math.max(1, Math.ceil(leg.length / STEP));
    for (let i = 0; i <= count; i += 1) {
      const s = (leg.length * i) / count;
      out.push({ leg: index, s, sample: sampleLeg(leg, s, { x: 0, y: 0, hx: 0, hy: 0 }) });
    }
  });
  return out;
}

const bodyMinY = (s: LotSample): number => s.y - Math.abs(s.hy) * HALF_L - Math.abs(s.hx) * HALF_W;
const after = (a: Step, leg: number, s: number): boolean => a.leg > leg || (a.leg === leg && a.s >= s - 1e-6);

/** Where a route starts (entries) or ends (exits) on the street, with its heading. */
function streetEnd(c: Case): LotSample {
  if (c.style !== 0) return c.entry ? { x: c.gate + LANE_IN, y: 0, hx: 0, hy: 1 } : { x: c.gate + LANE_OUT, y: 0, hx: 0, hy: -1 };
  if (c.entry) {
    return c.side === 0 ? { x: c.gate, y: -LANE_IN, hx: 1, hy: 0 } : c.side === 1 ? { x: c.gate + 1, y: -LANE_OUT, hx: -1, hy: 0 } : { x: c.gate + LANE_IN, y: -1, hx: 0, hy: 1 };
  }
  return c.side === 0 ? { x: c.gate, y: -LANE_OUT, hx: -1, hy: 0 } : c.side === 1 ? { x: c.gate + 1, y: -LANE_IN, hx: 1, hy: 0 } : { x: c.gate + LANE_OUT, y: -1, hx: 0, hy: -1 };
}

function expectPose(actual: LotSample, expected: LotSample, what: string): void {
  expect(actual.x, `${what} x`).toBeCloseTo(expected.x, 5);
  expect(actual.y, `${what} y`).toBeCloseTo(expected.y, 5);
  expect(actual.hx, `${what} facing x`).toBeCloseTo(expected.hx, 5);
  expect(actual.hy, `${what} facing y`).toBeCloseTo(expected.hy, 5);
}

interface Obstacles {
  parked: Poly[];
  solids: Poly[];
  outside: Poly[];
  kerbs: Poly[];
  front: Poly[];
}

function obstaclesFor(c: Case): Obstacles {
  const lot = lots[c.style];
  const parked: Poly[] = [];
  for (let stall = 0; stall < stallCount(c.style); stall += 1) if (stall !== c.stall) parked.push(parkedBox(c.style, stall));
  const lane = c.style === 0 ? (c.entry ? ENTRY_LANES(c.gate) : EXIT_LANES(c.gate))[c.side] : null;
  return {
    parked,
    solids: lot.solids.map((face) => face.lot),
    outside: outside(lot.depth),
    kerbs: lot.kerbs.map((face) => face.lot),
    front: frontKerbs(c.gate, lane, 1),
  };
}

/** Sweeps one route; returns what it touches (empty when clean). */
function violations(c: Case): string[] {
  const route = c.route!;
  const o = obstaclesFor(c);
  const out = new Set<string>();
  const at = (step: Step) => `leg ${step.leg} s ${step.s.toFixed(2)} (${step.sample.x.toFixed(3)}, ${step.sample.y.toFixed(3)})`;
  for (const step of sweep(route)) {
    const s = step.sample;
    if (o.parked.some((p) => hits(p, s, HALF_L, HALF_W))) out.add(`a parked car at ${at(step)}`);
    if (o.solids.some((p) => hits(p, s, HALF_L, HALF_W))) out.add(`a planter, bush or sign at ${at(step)}`);
    if (o.outside.some((p) => hits(p, s, HALF_L, HALF_W))) out.add(`outside the footprint at ${at(step)}`);
    if (o.kerbs.some((p) => hits(p, s, HALF_L - KERB_TOLERANCE, HALF_W - KERB_TOLERANCE))) out.add(`a kerb at ${at(step)}`);
    if (o.front.some((p) => hits(p, s, HALF_L - KERB_TOLERANCE, HALF_W - KERB_TOLERANCE))) out.add(`off the carriageway at ${at(step)}`);
  }
  return [...out].slice(0, 4);
}

// --- Tests ------------------------------------------------------------------------------------------

describe('model sync', () => {
  it('mirrors the constants and variants of build-parking.py', () => {
    expect({ KERB_W, STALL_W, STALL_D, APRON_D, ISLAND_D, AISLE_W }).toEqual({
      KERB_W: scriptNumber('KERB_W'),
      STALL_W: scriptNumber('STALL_W'),
      STALL_D: scriptNumber('STALL_D'),
      APRON_D: scriptNumber('APRON_D'),
      ISLAND_D: scriptNumber('ISLAND_D'),
      AISLE_W: scriptNumber('AISLE_W'),
    });
    const variants = [...SCRIPT.matchAll(/'(parking-\w+)': dict\(blocks=\((\d+), (\d+)\), kind='(\w+)', groups=\(([\d, ]+)\)\)/g)];
    expect(variants.map((m) => m[1])).toEqual(OBJECTS.parking.models);
    expect(variants.map((m) => ({ width: Number(m[2]), depth: Number(m[3]), kind: m[4], groups: m[5].split(',').filter((n) => n.trim()).map(Number) }))).toEqual(
      LOT_SPECS.map((spec) => ({ width: LOT_W, depth: spec.depth, kind: spec.kind, groups: [...spec.groups] })),
    );
    // An aisle lot's two stall columns leave the aisle between them.
    expect(LOT_W - 2 * KERB_W - 2 * STALL_D).toBeCloseTo(AISLE_W, 9);
  });

  it('reads every upward face of the models as a known atlas texel', () => {
    for (const lot of lots) {
      expect(lot.faces.filter((face) => face.up && face.texel === '?').length, STYLE_NAMES[lot.style]).toBe(0);
      const solid = new Set(lot.solids.map((face) => face.texel));
      for (const texel of ['grass', 'leaf_lo', 'leaf_hi', 'pole', 'sign_blue']) {
        if (texel === 'grass' && lot.style === 1) continue; // the medium lot has no planter
        if (texel.startsWith('leaf') && lot.style === 1) continue;
        expect(solid.has(texel), `${STYLE_NAMES[lot.style]} ${texel}`).toBe(true);
      }
      expect(lot.kerbs.length, STYLE_NAMES[lot.style]).toBeGreaterThan(0);
      const box = new THREE.Box3();
      for (const face of lot.faces) for (const p of face.model) box.expandByPoint(p);
      expect(box.max.x - box.min.x).toBeCloseTo(LOT_W, 3);
      expect(box.max.z - box.min.z).toBeCloseTo(lot.depth, 3);
    }
  });

  it('has as many painted stalls as stallCount', () => {
    for (const lot of lots) {
      let area = 0;
      for (const { lot: p } of lot.bays) area += Math.abs((p.pts[2] - p.pts[0]) * (p.pts[5] - p.pts[1]) - (p.pts[4] - p.pts[0]) * (p.pts[3] - p.pts[1])) / 2;
      expect(area / (STALL_W * STALL_D), STYLE_NAMES[lot.style]).toBeCloseTo(stallCount(lot.style), 3);
      expect(stallCount(lot.style)).toBe([4, 8, 12][lot.style]);
    }
  });

  it('every stall pose is the middle of a painted bay, with dividers on both long sides', () => {
    for (const lot of lots) {
      const bays = lot.bays.map((face) => face.lot.pts);
      const paint = lot.paint.map((face) => face.lot.pts);
      for (let stall = 0; stall < stallCount(lot.style); stall += 1) {
        const pose = stallPose(lot.style, stall, { x: 0, y: 0, hx: 0, hy: 0 });
        expect(Math.hypot(pose.hx, pose.hy)).toBeCloseTo(1, 9);
        const at = (along: number, across: number): [number, number] => [pose.x + pose.hx * along - pose.hy * across, pose.y + pose.hy * along + pose.hx * across];
        const what = `${STYLE_NAMES[lot.style]} stall ${stall}`;
        for (let i = 0; i <= 12; i += 1) {
          const along = (i / 12 - 0.5) * (STALL_D - 0.004);
          for (let j = 0; j <= 8; j += 1) expect(covered(...at(along, (j / 8 - 0.5) * (STALL_W - 0.004)), bays), `${what} bay`).toBe(true);
        }
        for (let i = 0; i <= 8; i += 1) {
          const along = (i / 8 - 0.5) * STALL_D * 0.8;
          for (const side of [-1, 1]) expect(covered(...at(along, side * (STALL_W / 2 - 0.005)), paint), `${what} divider`).toBe(true);
        }
        // Past the nose is kerb; behind the tail is not a bay.
        expect(covered(...at(STALL_D / 2 + 0.02, 0), lot.kerbs.map((face) => face.lot.pts)), `${what} nose`).toBe(true);
        expect(covered(...at(-STALL_D / 2 - 0.02, 0), bays), `${what} tail`).toBe(false);
      }
    }
  });
});

describe('routes', () => {
  for (const style of STYLES) {
    it(`${STYLE_NAMES[style]}: every route starts and ends where it should, in one smooth piece`, () => {
      for (const c of distinct(style)) {
        const route = c.route!;
        const steps = sweep(route);
        const stall = stallPose(style, c.stall, { x: 0, y: 0, hx: 0, hy: 0 });
        expectPose(steps[0].sample, c.entry ? streetEnd(c) : stall, `${c.name} start`);
        expectPose(steps[steps.length - 1].sample, c.entry ? stall : streetEnd(c), `${c.name} end`);
        route.legs.forEach((leg, index) => {
          expect(leg.length, `${c.name} leg ${index}`).toBeGreaterThan(0.02);
          expect(leg.points.length, c.name).toBe(leg.cum.length * 2);
          expect(leg.speed, c.name).toBeGreaterThan(0.15);
          expect(leg.speed, c.name).toBeLessThanOrEqual(leg.reverse ? 0.3 : 0.45);
        });
        // An exit backs out first and then only drives forward; an entry never reverses.
        expect(route.legs.map((leg) => leg.reverse).join().replace(/(true,?)+/, 'R').replace(/(false,?)+/g, 'F'), c.name).toBe(c.entry ? 'F' : 'RF');
        for (let i = 1; i < steps.length; i += 1) {
          const a = steps[i - 1];
          const b = steps[i];
          const what = `${c.name} leg ${b.leg} s ${b.s.toFixed(3)}`;
          expect(Math.hypot(b.sample.hx, b.sample.hy), what).toBeCloseTo(1, 6);
          const turn = Math.acos(Math.min(1, a.sample.hx * b.sample.hx + a.sample.hy * b.sample.hy));
          const moved = Math.hypot(b.sample.x - a.sample.x, b.sample.y - a.sample.y);
          if (a.leg !== b.leg) {
            // A leg starts where the one before it ended, position and facing.
            expect(moved, what).toBeLessThan(1e-5);
            expect(turn, what).toBeLessThan(1e-3);
            continue;
          }
          expect(moved, what).toBeLessThanOrEqual(b.s - a.s + 1e-6);
          expect(b.s - a.s, what).toBeLessThanOrEqual(STEP + 1e-9);
          expect(turn, what).toBeLessThanOrEqual((MAX_YAW_RATE * (b.s - a.s)) / route.legs[b.leg].speed + 1e-9);
        }
      }
    });

    it(`${STYLE_NAMES[style]}: the swept car touches nothing`, () => {
      for (const c of distinct(style)) expect(violations(c), c.name).toEqual([]);
    });

    it(`${STYLE_NAMES[style]}: hold and clear points`, () => {
      for (const c of distinct(style)) {
        const route = c.route!;
        const steps = sweep(route);
        if (c.entry) {
          expect([route.holdLeg, route.holdS], c.name).toEqual([-1, 0]);
          expect(route.clearLeg, c.name).toBeGreaterThanOrEqual(0);
          expect(route.clearS, c.name).toBeLessThanOrEqual(route.legs[route.clearLeg].length);
          // Inside from the clear point on, and not yet inside shortly before it.
          for (const step of steps) if (after(step, route.clearLeg, route.clearS)) expect(bodyMinY(step.sample), `${c.name} leg ${step.leg} s ${step.s}`).toBeGreaterThanOrEqual(0);
          const before = steps.filter((step) => !after(step, route.clearLeg, route.clearS - 0.03));
          expect(Math.min(...before.map((step) => bodyMinY(step.sample))), c.name).toBeLessThan(0.05);
          continue;
        }
        expect([route.clearLeg, route.clearS], c.name).toEqual([-1, 0]);
        if (style === 0) {
          // The car waits in its stall.
          expect([route.holdLeg, route.holdS], c.name).toEqual([0, 0]);
          continue;
        }
        // The car waits inside the lot, nose at the edge, on its way out forwards.
        expect(route.legs[route.holdLeg].reverse, c.name).toBe(false);
        expect(route.holdS, c.name).toBeLessThanOrEqual(route.legs[route.holdLeg].length);
        const hold = sampleLeg(route.legs[route.holdLeg], route.holdS, { x: 0, y: 0, hx: 0, hy: 0 });
        expect(bodyMinY(hold), c.name).toBeGreaterThanOrEqual(0);
        expect(bodyMinY(hold), c.name).toBeLessThan(0.06);
        expect(hold.hy, c.name).toBeLessThan(0);
        for (const step of steps) if (!after(step, route.holdLeg, route.holdS + 1e-6)) expect(bodyMinY(step.sample), `${c.name} leg ${step.leg} s ${step.s}`).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('aisle lots use one route whatever the approach or the exit side', () => {
    for (const style of [1, 2] as const) {
      for (const c of cases(style)) {
        expect(c.route, c.name).toBe(c.entry ? entryRoute(style, c.gate, 0, c.stall) : exitRoute(style, c.stall, c.gate, 0));
      }
    }
  });

  it('coverage: every stall can be entered and left every way its lot allows', () => {
    // Entries that would be a loop in front of the stall are left out on purpose.
    const loop = (c: { style: number; entry: boolean; gate: number; stall: number; side: number }): boolean =>
      c.entry && (c.style === 0 ? (c.gate === 0 && c.stall === 1 && c.side === 1) || (c.gate === 1 && c.stall === 2 && c.side === 0) : c.gate === 1 && c.stall >= stallCount(c.style as LotStyle) / 2 && c.stall < stallCount(c.style as LotStyle) / 2 + 2);
    const all = STYLES.flatMap((style) => cases(style));
    expect(all.filter(loop).length).toBeGreaterThan(0);
    for (const c of all.filter(loop)) expect(c.route, c.name).toBeNull();
    const missing = all.filter((c) => !c.route && !loop(c)).map((c) => c.name);
    // The small lot's bays open onto one front block each: stalls 0, 1 on gate 0 and 2, 3 on gate 1.
    const expected: string[] = [];
    for (let stall = 0; stall < 4; stall += 1) {
      const gate = stall < 2 ? 1 : 0;
      for (const side of SIDES) expected.push(`small stall ${stall}: in from gate ${gate}, approach ${side}`, `small stall ${stall}: out through gate ${gate}, side ${side}`);
    }
    expect(missing).toEqual(expected);
    expect(entryRoute(1, 0, 0, 99)).toBeNull();
    expect(exitRoute(2, 99, 1, 2)).toBeNull();
  });

  it.runIf(process.env.PARKING_REPORT)('report: lengths, times and tightest clearances', () => {
    const rows: Record<string, unknown>[] = [];
    let routes = 0;
    let points = 0;
    for (const style of STYLES) {
      for (const c of distinct(style)) {
        const route = c.route!;
        const o = obstaclesFor(c);
        const least = { parked: 1, solids: 1, kerbs: 1, front: 1 };
        for (const { sample } of sweep(route)) {
          for (const p of o.parked) least.parked = Math.min(least.parked, gap(p, sample, HALF_L, HALF_W, least.parked));
          for (const p of o.solids) least.solids = Math.min(least.solids, gap(p, sample, HALF_L, HALF_W, least.solids));
          for (const p of o.kerbs) least.kerbs = Math.min(least.kerbs, gap(p, sample, HALF_L - KERB_TOLERANCE, HALF_W - KERB_TOLERANCE, least.kerbs));
          for (const p of o.front) least.front = Math.min(least.front, gap(p, sample, HALF_L - KERB_TOLERANCE, HALF_W - KERB_TOLERANCE, least.front));
        }
        routes += 1;
        points += route.legs.reduce((sum, leg) => sum + leg.cum.length, 0);
        rows.push({
          route: c.name,
          legs: route.legs.length,
          length: Number(route.legs.reduce((sum, leg) => sum + leg.length, 0).toFixed(2)),
          seconds: Number(route.legs.reduce((sum, leg) => sum + leg.length / leg.speed, 0).toFixed(1)),
          slowest: Math.min(...route.legs.map((leg) => leg.speed)).toFixed(2),
          parked: least.parked.toFixed(3),
          solids: least.solids.toFixed(3),
          kerbs: least.kerbs.toFixed(3),
          front: least.front.toFixed(3),
        });
      }
    }
    console.table(rows);
    console.log(`${routes} routes, ${points} points`);
  });
});

describe('lot to world', () => {
  const anchor = { x: 20, z: 28 };

  it('puts every stall on the drawn model at every rotation, nose away from the street', () => {
    const matrix = new THREE.Matrix4();
    const frame: LotFrame = { x: 0, z: 0, rotation: 0, style: 0, depth: 0 };
    const world = { x: 0, z: 0, hx: 0, hz: 0 };
    const v = new THREE.Vector3();
    for (const lot of lots) {
      for (const rotation of [0, 1, 2, 3] as Rotation[]) {
        const placed: PlacedObject = { id: 7, kind: 'parking', anchor, rotation, variant: lot.style };
        objectOrigin(placed, OBJECTS.parking, matrix);
        lotFrame(placed, frame);
        expect(frame).toMatchObject({ rotation, style: lot.style, depth: lot.depth });
        const drawn = (faces: readonly Face[]) => faces.map((face) => face.model.flatMap((p) => { v.copy(p).applyMatrix4(matrix); return [v.x, v.z]; }));
        const bays = drawn(lot.bays);
        const paint = drawn(lot.paint);
        const kerbs = drawn(lot.kerbs);
        const what = `${STYLE_NAMES[lot.style]} rotation ${rotation}`;

        // The street side: the block in front of gate 0 steps into the lot through a front arm.
        lotToWorld(frame, { x: 0.5, y: -0.5, hx: 0, hy: 1 }, world);
        const into = NEIGHBOURS.findIndex((n) => Math.abs(n.x - world.hx) < 1e-9 && Math.abs(n.z - world.hz) < 1e-9);
        expect(into, what).toBeGreaterThanOrEqual(0);
        const street = worldToCell(world.x, world.z);
        const first = { x: street.x + NEIGHBOURS[into].x * ROAD_BLOCK, z: street.z + NEIGHBOURS[into].z * ROAD_BLOCK };
        expect(isFeatureArm(placed, first, into), what).toBe(true);
        expect([0, 1, 2, 3].filter((side) => isFeatureArm(placed, first, side)), what).toEqual([into]);

        for (let stall = 0; stall < stallCount(lot.style); stall += 1) {
          lotToWorld(frame, stallPose(lot.style, stall, { x: 0, y: 0, hx: 0, hy: 0 }), world);
          expect(Math.hypot(world.hx, world.hz), what).toBeCloseTo(1, 9);
          const at = (along: number, across: number): [number, number] => [world.x + world.hx * along - world.hz * across, world.z + world.hz * along + world.hx * across];
          for (let i = 0; i <= 6; i += 1) {
            const along = (i / 6 - 0.5) * (STALL_D - 0.004);
            for (let j = 0; j <= 4; j += 1) expect(covered(...at(along, (j / 4 - 0.5) * (STALL_W - 0.004)), bays), `${what} stall ${stall} bay`).toBe(true);
            for (const side of [-1, 1]) expect(covered(...at(along * 0.8, side * (STALL_W / 2 - 0.005)), paint), `${what} stall ${stall} divider`).toBe(true);
          }
          expect(covered(...at(STALL_D / 2 + 0.02, 0), kerbs), `${what} stall ${stall} nose`).toBe(true);
          expect(covered(...at(-STALL_D / 2 - 0.02, 0), bays), `${what} stall ${stall} tail`).toBe(false);
          // The nose never points back at the street; in the small lot it points straight in.
          const inward = world.hx * NEIGHBOURS[into].x + world.hz * NEIGHBOURS[into].z;
          expect(inward, `${what} stall ${stall}`).toBeCloseTo(lot.style === 0 ? 1 : 0, 9);
        }
      }
    }
  });

  it('carries positions and facings like the model transform', () => {
    const matrix = new THREE.Matrix4();
    const frame: LotFrame = { x: 0, z: 0, rotation: 0, style: 0, depth: 0 };
    const world = { x: 0, z: 0, hx: 0, hz: 0 };
    for (const style of STYLES) {
      for (const rotation of [0, 1, 2, 3] as Rotation[]) {
        const placed: PlacedObject = { id: 7, kind: 'parking', anchor, rotation, variant: style };
        objectOrigin(placed, OBJECTS.parking, matrix);
        lotFrame(placed, frame);
        const sample: LotSample = { x: 0.37, y: 0.81, hx: 0.6, hy: -0.8 };
        lotToWorld(frame, sample, world);
        const depth = LOT_SPECS[style].depth;
        const p = new THREE.Vector3(sample.x - LOT_W / 2, 0, depth / 2 - sample.y).applyMatrix4(matrix);
        const h = new THREE.Vector3(sample.hx, 0, -sample.hy).transformDirection(matrix);
        expect([world.x, world.z, world.hx, world.hz].map((n) => Number(n.toFixed(9)))).toEqual([p.x, p.z, h.x, h.z].map((n) => Number(n.toFixed(9))));
      }
    }
  });
});
