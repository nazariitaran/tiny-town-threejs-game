/**
 * CONTRACT FILE — world/grid constants and the ONLY cell↔world mapping.
 * Every module that converts between grid cells and world space must use these.
 */
import { ROAD_BLOCK, rotatedFootprint } from '../town/grid';
import type { Cell, Edge, Rotation } from '../town/types';

/** Plot size in cells (WP-12: 48 × 48 half-unit cells; the plot stays 24 × 24 world units). */
export const PLOT_WIDTH = 48;
export const PLOT_DEPTH = 48;

/**
 * World units per grid cell (WP-12: 0.5). Toy scale: 1 world unit ≈ 8 m, so a cell ≈ 4 m.
 * One Kenney road tile (1 world unit) covers an aligned 2 × 2 road block (ROAD_TILE_SIZE).
 */
export const CELL_SIZE = 0.5;

/** World-space centre of a cell (y = 0 ground plane). The plot is centred on the origin. */
export function cellToWorld(cell: Cell, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = (cell.x - PLOT_WIDTH / 2 + 0.5) * CELL_SIZE;
  out.z = (cell.z - PLOT_DEPTH / 2 + 0.5) * CELL_SIZE;
  return out;
}

/** Fractional grid coordinates of a world point: cell x covers [x, x + 1). For anchorForPointer. */
export function worldToGridPoint(x: number, z: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = x / CELL_SIZE + PLOT_WIDTH / 2;
  out.z = z / CELL_SIZE + PLOT_DEPTH / 2;
  return out;
}

/** World size of one road tile (it covers a ROAD_BLOCK × ROAD_BLOCK block of cells). */
export const ROAD_TILE_SIZE = CELL_SIZE * ROAD_BLOCK;

/** World-space centre of a (rotated) footprint anchored at its min corner. */
export function footprintCentreWorld(
  anchor: Cell,
  footprint: readonly [number, number],
  rotation: Rotation,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const [w, d] = rotatedFootprint(footprint, rotation);
  out.x = (anchor.x + w / 2 - PLOT_WIDTH / 2) * CELL_SIZE;
  out.z = (anchor.z + d / 2 - PLOT_DEPTH / 2) * CELL_SIZE;
  return out;
}

/** World-space centre of the road block containing `cell`. */
export function roadBlockCentreWorld(cell: Cell, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = (Math.floor(cell.x / ROAD_BLOCK) * ROAD_BLOCK + ROAD_BLOCK / 2 - PLOT_WIDTH / 2) * CELL_SIZE;
  out.z = (Math.floor(cell.z / ROAD_BLOCK) * ROAD_BLOCK + ROAD_BLOCK / 2 - PLOT_DEPTH / 2) * CELL_SIZE;
  return out;
}

/** Cell containing a world-space point (may be out of bounds — check with TownState.inBounds). */
export function worldToCell(x: number, z: number, out: Cell = { x: 0, z: 0 }): Cell {
  out.x = Math.floor(x / CELL_SIZE + PLOT_WIDTH / 2);
  out.z = Math.floor(z / CELL_SIZE + PLOT_DEPTH / 2);
  return out;
}

/** World-space midpoint of an edge, plus whether it runs along X (a north edge) or along Z (a west edge). */
export function edgeToWorld(edge: Edge): { x: number; z: number; alongX: boolean } {
  const x0 = (edge.x - PLOT_WIDTH / 2) * CELL_SIZE;
  const z0 = (edge.z - PLOT_DEPTH / 2) * CELL_SIZE;
  return edge.side === 'n'
    ? { x: x0 + CELL_SIZE / 2, z: z0, alongX: true }
    : { x: x0, z: z0 + CELL_SIZE / 2, alongX: false };
}

/** Nearest edge to a world point (used by the picker for fence tools). */
export function worldToNearestEdge(x: number, z: number): Edge {
  const cell = worldToCell(x, z);
  const localX = x / CELL_SIZE + PLOT_WIDTH / 2 - cell.x; // 0..1 inside the cell
  const localZ = z / CELL_SIZE + PLOT_DEPTH / 2 - cell.z;
  const distances = [localZ, 1 - localX, 1 - localZ, localX]; // N, E, S, W
  const side = distances.indexOf(Math.min(...distances));
  if (side === 0) return { x: cell.x, z: cell.z, side: 'n' };
  if (side === 1) return { x: cell.x + 1, z: cell.z, side: 'w' };
  if (side === 2) return { x: cell.x, z: cell.z + 1, side: 'n' };
  return { x: cell.x, z: cell.z, side: 'w' };
}

/**
 * Resolve a public asset path ("/assets/...") against Vite's base URL, so the game also works
 * when hosted under a sub-path with a relative `base` (WP-11). Use for EVERY runtime asset URL.
 */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

export type QualityTier = 'high' | 'low';

/** Max device pixel ratio per tier (see technical-art budgets). */
export const MAX_DPR: Readonly<Record<QualityTier, number>> = { high: 2, low: 1.5 };

export const SAVE_STORAGE_KEY = 'tiny-town:save:v1';
export const SETTINGS_STORAGE_KEY = 'tiny-town:settings:v1';
