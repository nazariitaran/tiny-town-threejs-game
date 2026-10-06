/**
 * Pure shape functions for the world around the plot: deterministic value noise, the terrain height
 * field and the plot/border dimensions. Shared by the terrain mesh and the decor ring so trees sit
 * exactly on the ground.
 */
import { CELL_SIZE, GROUND_Y, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';

/** Half extents of the buildable plot in world units. */
export const PLOT_HALF_X = (PLOT_WIDTH * CELL_SIZE) / 2;
export const PLOT_HALF_Z = (PLOT_DEPTH * CELL_SIZE) / 2;

/** Diorama border around the plot: a cream kerb on top of a soil slab. */
export const KERB_WIDTH = 0.24;
export const KERB_TOP_Y = 0.035;
/** The bed under painted cells, whose tiles stand on y = 0 above it; bare field is drawn at GROUND_Y. */
export const FIELD_Y = -0.005;
export { GROUND_Y };
/** Level of the surrounding meadow right next to the plot: the plot is a raised slab. */
export const MEADOW_BASE_Y = -0.32;
/** Bottom of the soil faces (below MEADOW_BASE_Y so no gap shows). */
export const SLAB_BOTTOM_Y = -0.5;
/** Outer radius of the terrain disc (inside the sky dome and the camera far plane). */
export const TERRAIN_RADIUS = 380;

/** Integer hash → [0, 1). Deterministic across platforms (32-bit integer math). */
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Fractal value noise in [0, 1]. */
export function fbm(x: number, z: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * f, z * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Distance from (x, z) to the plot rectangle (0 inside it). */
export function distanceToPlot(x: number, z: number): number {
  const dx = Math.max(Math.abs(x) - PLOT_HALF_X, 0);
  const dz = Math.max(Math.abs(z) - PLOT_HALF_Z, 0);
  return Math.hypot(dx, dz);
}

/**
 * Height of the surrounding meadow: flat next to the plot so the slab reads cleanly, undulating a few
 * cells out, and rolling hills far away for the title shot's horizon.
 */
export function terrainHeight(x: number, z: number): number {
  const d = distanceToPlot(x, z);
  const r = Math.hypot(x, z);
  const near = smoothstep(1.5, 12, d);
  const gentle = (fbm(x * 0.07, z * 0.07, 3, 11) - 0.45) * 1.6 * near;
  const bowl = smoothstep(12, 140, d) * 3.5;
  const hillMask = smoothstep(150, 330, r);
  const hills = Math.pow(fbm(x * 0.012 + 5.3, z * 0.012 - 2.1, 4, 23), 1.3) * 26 * hillMask;
  return MEADOW_BASE_Y + gentle + bowl + hills;
}
