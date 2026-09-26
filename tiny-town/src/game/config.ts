/**
 * CONTRACT FILE — world/grid constants and the ONLY cell↔world mapping.
 * Every module that converts between grid cells and world space must use these.
 */
import type { Cell, Edge } from '../town/types';

/** Plot size in cells. */
export const PLOT_WIDTH = 24;
export const PLOT_DEPTH = 24;

/** World units per grid cell. One Kenney road tile == one cell (see docs/assets/models.md). */
export const CELL_SIZE = 1;

/** World-space centre of a cell (y = 0 ground plane). The plot is centred on the origin. */
export function cellToWorld(cell: Cell, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = (cell.x - PLOT_WIDTH / 2 + 0.5) * CELL_SIZE;
  out.z = (cell.z - PLOT_DEPTH / 2 + 0.5) * CELL_SIZE;
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
