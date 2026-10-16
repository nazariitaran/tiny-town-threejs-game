/**
 * Where rain rings land: a map of the plot, 4 × 4 texels per cell, each texel holding the id of the
 * surface a ring there lies on (an index into SPLASH_SURFACES). Pure: no three.js, no DOM.
 *
 * Ground cells give the ground, road and pond surfaces; a few models add their own (SURFACE_SHAPES):
 * a land shape claims the texels whose centre it covers, a water shape every texel it touches, since the
 * rim around water stands higher and hides a ring that spills onto it. Where two waters meet, the lower wins.
 * Texel (tx, tz) covers grid x ∈ [tx / 4, (tx + 1) / 4), z likewise; the map is indexed `tz · stride + tx`.
 */
import type { ModelId } from '../catalog/models';
import { footprintOf, OBJECTS } from '../catalog/objects';
import { CELL_SIZE, GROUND_Y, TOWN_PLOTS } from '../game/config';
import type { GameEvents } from '../game/events';
import type { Cell, TownChange, TownStateReader } from '../town/types';

export interface SplashSurface {
  /** Height (world y) of the surface itself. */
  top: number;
  /** Height the ring is drawn at, a little above `top`. */
  y: number;
  /** Ring size, relative to a ring on the ground. */
  size: number;
  water: boolean;
}

export const SPLASH_GROUND = 0;
export const SPLASH_ROAD = 1;
export const SPLASH_POND = 2;
export const SPLASH_POOL = 3;
export const SPLASH_POOL_TERRACE = 4;
export const SPLASH_FOUNTAIN = 5;
export const SPLASH_TIERED_FOUNTAIN = 6;
export const SPLASH_PITCH = 7;

/** Indexed by surface id. */
export const SPLASH_SURFACES: readonly SplashSurface[] = [
  { top: GROUND_Y, y: GROUND_Y + 0.006, size: 1, water: false },
  { top: 0.01, y: 0.015, size: 1, water: false },
  { top: 0.008, y: 0.012, size: 1.25, water: true },
  { top: 0.028, y: 0.033, size: 1.25, water: true },
  { top: 0.056, y: 0.062, size: 1, water: false },
  { top: 0.063, y: 0.068, size: 0.7, water: true },
  { top: 0.085, y: 0.09, size: 0.7, water: true },
  { top: 0.03, y: 0.035, size: 1, water: false },
];

/** In normalised model space at rotation 0 (world units, front towards +z): `rect` [x0, z0, x1, z1], `circle` [cx, cz, r]. */
export type SurfaceShape =
  | { readonly id: number; readonly rect: readonly [number, number, number, number] }
  | { readonly id: number; readonly circle: readonly [number, number, number] };

export const SURFACE_SHAPES: Readonly<Partial<Record<ModelId, readonly SurfaceShape[]>>> = {
  'swimming-pool': [
    { id: SPLASH_POOL_TERRACE, rect: [-1, -0.75, 1, 0.25] },
    { id: SPLASH_POOL, rect: [-0.7, -0.6, 0.7, 0.1] },
  ],
  // The pedestal and the upper bowl stand above the basin's inner part and hide its rings.
  fountain: [{ id: SPLASH_FOUNTAIN, circle: [0, 0, 0.315] }],
  'tiered-fountain': [{ id: SPLASH_TIERED_FOUNTAIN, circle: [0, 0, 0.568] }],
  stadium: [{ id: SPLASH_PITCH, rect: [-2.03, -1.34, 2.03, 1.22] }],
};

export const SPLASH_TEXELS_PER_CELL = 4;
/** Row length (and row count) of a map that fits every town size. */
export const SPLASH_SURFACE_STRIDE =
  Math.max(...Object.values(TOWN_PLOTS).map((p) => Math.max(p.width, p.depth))) * SPLASH_TEXELS_PER_CELL;

const T = SPLASH_TEXELS_PER_CELL;
/** Texels per world unit. */
const TEXELS_PER_UNIT = T / CELL_SIZE;
const EPS = 1e-6;
const IS_WATER = Uint8Array.from(SPLASH_SURFACES, (s) => (s.water ? 1 : 0));
const RING_Y = Float32Array.from(SPLASH_SURFACES, (s) => s.y);

const scratchCell: Cell = { x: 0, z: 0 };
const scratchPoint = { x: 0, z: 0 };
/** The object being drawn: its centre and the texels it may write ([x0, x1) × [z0, z1)), set per object. */
const target = { cx: 0, cz: 0, x0: 0, x1: 0, z0: 0, z1: 0, rotation: 0 };
let waterTexels = 0;

/**
 * Fills `out` (at least `stride²` long) with the town's surface ids and returns how many texels are water.
 * Texels beyond the town's plot are cleared.
 */
export function rasterSplashSurface(town: TownStateReader, out: Uint8Array, stride: number): number {
  const width = town.width * T;
  const depth = town.depth * T;
  if (width > stride || depth > stride || out.length < stride * stride) {
    throw new RangeError(`splash surface: a ${town.width} × ${town.depth} plot does not fit stride ${stride} (map of ${out.length})`);
  }
  waterTexels = 0;

  for (let z = 0; z < town.depth; z += 1) {
    scratchCell.z = z;
    for (let x = 0; x < town.width; x += 1) {
      scratchCell.x = x;
      const ground = town.getGround(scratchCell);
      const id = ground === 'road' ? SPLASH_ROAD : ground === 'pond' ? SPLASH_POND : SPLASH_GROUND;
      if (id === SPLASH_POND) waterTexels += T * T;
      for (let row = z * T * stride + x * T, r = 0; r < T; r += 1, row += stride) {
        for (let c = 0; c < T; c += 1) out[row + c] = id;
      }
    }
  }
  if (width < stride) for (let tz = 0; tz < depth; tz += 1) out.fill(SPLASH_GROUND, tz * stride + width, (tz + 1) * stride);
  out.fill(SPLASH_GROUND, depth * stride, stride * stride);

  for (const object of town.objects()) {
    const def = OBJECTS[object.kind];
    const shapes = SURFACE_SHAPES[def.models[object.variant]];
    if (!shapes) continue;
    const footprint = footprintOf(def, object.variant);
    const odd = object.rotation % 2 === 1;
    const w = odd ? footprint[1] : footprint[0];
    const d = odd ? footprint[0] : footprint[1];
    target.cx = (object.anchor.x + w / 2) * T;
    target.cz = (object.anchor.z + d / 2) * T;
    target.x0 = Math.max(0, object.anchor.x * T);
    target.x1 = Math.min(width, (object.anchor.x + w) * T);
    target.z0 = Math.max(0, object.anchor.z * T);
    target.z1 = Math.min(depth, (object.anchor.z + d) * T);
    target.rotation = object.rotation;
    for (const shape of shapes) if (!IS_WATER[shape.id]) drawShape(shape, out, stride);
    for (const shape of shapes) if (IS_WATER[shape.id]) drawShape(shape, out, stride);
  }
  return waterTexels;
}

/** Whether these changes can move a surface in the map. */
export function affectsSplashSurface(changes: readonly TownChange[], cause: GameEvents['town:changed']['cause']): boolean {
  if (cause === 'load' || cause === 'reset') return true;
  for (const change of changes) {
    if (change.layer === 'ground') {
      if (change.before === 'pond' || change.before === 'road' || change.after === 'pond' || change.after === 'road') return true;
    } else if (change.layer === 'object') {
      if (SURFACE_SHAPES[OBJECTS[change.object.kind].models[change.object.variant]]) return true;
    }
  }
  return false;
}

/** Texel coordinates of model point (x, z) on the current target: R_y(rotation · π/2), as the renderer turns it. */
function toTexels(x: number, z: number): void {
  const rotation = target.rotation;
  const rx = rotation === 0 ? x : rotation === 1 ? z : rotation === 2 ? -x : -z;
  const rz = rotation === 0 ? z : rotation === 1 ? -x : rotation === 2 ? -z : x;
  scratchPoint.x = target.cx + rx * TEXELS_PER_UNIT;
  scratchPoint.z = target.cz + rz * TEXELS_PER_UNIT;
}

function drawShape(shape: SurfaceShape, out: Uint8Array, stride: number): void {
  const water = IS_WATER[shape.id] === 1;
  if ('rect' in shape) {
    const rect = shape.rect;
    toTexels(rect[0], rect[1]);
    const ax = scratchPoint.x;
    const az = scratchPoint.z;
    toTexels(rect[2], rect[3]);
    const bx = scratchPoint.x;
    const bz = scratchPoint.z;
    const lx = Math.min(ax, bx);
    const hx = Math.max(ax, bx);
    const lz = Math.min(az, bz);
    const hz = Math.max(az, bz);
    // Water: every texel the rect overlaps. Land: every texel whose centre it covers (half-open).
    const tx0 = Math.max(target.x0, water ? Math.floor(lx + EPS) : Math.ceil(lx - 0.5));
    const tx1 = Math.min(target.x1, water ? Math.ceil(hx - EPS) : Math.ceil(hx - 0.5));
    const tz0 = Math.max(target.z0, water ? Math.floor(lz + EPS) : Math.ceil(lz - 0.5));
    const tz1 = Math.min(target.z1, water ? Math.ceil(hz - EPS) : Math.ceil(hz - 0.5));
    for (let tz = tz0; tz < tz1; tz += 1) {
      for (let tx = tx0; tx < tx1; tx += 1) put(out, tz * stride + tx, shape.id);
    }
    return;
  }
  const circle = shape.circle;
  toTexels(circle[0], circle[1]);
  const cx = scratchPoint.x;
  const cz = scratchPoint.z;
  const r = circle[2] * TEXELS_PER_UNIT;
  const r2 = r * r - EPS;
  const tx0 = Math.max(target.x0, Math.floor(cx - r));
  const tx1 = Math.min(target.x1, Math.ceil(cx + r));
  const tz0 = Math.max(target.z0, Math.floor(cz - r));
  const tz1 = Math.min(target.z1, Math.ceil(cz + r));
  for (let tz = tz0; tz < tz1; tz += 1) {
    const dz = water ? Math.max(tz - cz, 0, cz - tz - 1) : tz + 0.5 - cz;
    for (let tx = tx0; tx < tx1; tx += 1) {
      const dx = water ? Math.max(tx - cx, 0, cx - tx - 1) : tx + 0.5 - cx;
      if (dx * dx + dz * dz < r2) put(out, tz * stride + tx, shape.id);
    }
  }
}

function put(out: Uint8Array, index: number, id: number): void {
  const old = out[index];
  if (IS_WATER[old]) {
    if (IS_WATER[id] && RING_Y[old] <= RING_Y[id]) return;
    waterTexels -= 1;
  }
  if (IS_WATER[id]) waterTexels += 1;
  out[index] = id;
}
