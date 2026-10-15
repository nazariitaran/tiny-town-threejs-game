// World/grid constants and the only cell↔world mapping: every cell↔world conversion goes through here.
import { ROAD_BLOCK, rotatedFootprint } from '../town/grid';
import type { Cell, Edge, Rotation, TownSize } from '../town/types';

export const TOWN_SIZES: readonly TownSize[] = ['small', 'large'];
/** Plot in cells per town size; even, so road blocks tile it from its corner. The large plot's centre is a cell corner, not a block corner. */
export const TOWN_PLOTS: Readonly<Record<TownSize, Readonly<{ width: number; depth: number }>>> = {
  small: { width: 64, depth: 64 },
  large: { width: 78, depth: 78 },
};
export const DEFAULT_TOWN_SIZE: TownSize = 'small';

export function isTownSize(value: unknown): value is TownSize {
  return typeof value === 'string' && (TOWN_SIZES as readonly string[]).includes(value);
}

/** The size whose plot is `width × depth`; any other plot counts as small. */
export function townSizeFor(width: number, depth: number): TownSize {
  const large = TOWN_PLOTS.large;
  return width === large.width && depth === large.depth ? 'large' : 'small';
}

/** The small plot in cells (32 × 32 world units): the plot of a town with no size given. */
export const PLOT_WIDTH = TOWN_PLOTS.small.width;
export const PLOT_DEPTH = TOWN_PLOTS.small.depth;

const livePlot = { width: PLOT_WIDTH, depth: PLOT_DEPTH };
/** The plot the world is drawn for, centred on the origin; every mapping below reads it. TownEditor sets it when it resizes the town. */
export const plot: Readonly<{ width: number; depth: number }> = livePlot;

export function setPlotSize(width: number, depth: number): void {
  livePlot.width = width;
  livePlot.depth = depth;
}

/**
 * World units per grid cell. Toy scale: 1 world unit ≈ 8 m, so a cell ≈ 4 m.
 * One Kenney road tile (1 world unit) covers an aligned 2 × 2 road block.
 */
export const CELL_SIZE = 0.5;
/** Ground level: bare field, lawns, pavement, kerbs and building slabs all top out here; road asphalt and pond water lie below it. */
export const GROUND_Y = 0.02;
/** Height (world units) the plot's content stays under: the stadium floodlights (2.85) and the birds above them. The sun-shadow frustum encloses it. */
export const PLOT_CONTENT_HEIGHT = 4.5;

/** World-space centre of a cell (y = 0 ground plane). The plot is centred on the origin. */
export function cellToWorld(cell: Cell, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = (cell.x - plot.width / 2 + 0.5) * CELL_SIZE;
  out.z = (cell.z - plot.depth / 2 + 0.5) * CELL_SIZE;
  return out;
}

/** Fractional grid coordinates of a world point: cell x covers [x, x + 1). */
export function worldToGridPoint(x: number, z: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = x / CELL_SIZE + plot.width / 2;
  out.z = z / CELL_SIZE + plot.depth / 2;
  return out;
}

export const ROAD_TILE_SIZE = CELL_SIZE * ROAD_BLOCK;

/** World-space centre of a (rotated) footprint anchored at its min corner. */
export function footprintCentreWorld(
  anchor: Cell,
  footprint: readonly [number, number],
  rotation: Rotation,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const [w, d] = rotatedFootprint(footprint, rotation);
  out.x = (anchor.x + w / 2 - plot.width / 2) * CELL_SIZE;
  out.z = (anchor.z + d / 2 - plot.depth / 2) * CELL_SIZE;
  return out;
}

export function roadBlockCentreWorld(cell: Cell, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  out.x = (Math.floor(cell.x / ROAD_BLOCK) * ROAD_BLOCK + ROAD_BLOCK / 2 - plot.width / 2) * CELL_SIZE;
  out.z = (Math.floor(cell.z / ROAD_BLOCK) * ROAD_BLOCK + ROAD_BLOCK / 2 - plot.depth / 2) * CELL_SIZE;
  return out;
}

/** May return an out-of-bounds cell; check with TownState.inBounds. */
export function worldToCell(x: number, z: number, out: Cell = { x: 0, z: 0 }): Cell {
  out.x = Math.floor(x / CELL_SIZE + plot.width / 2);
  out.z = Math.floor(z / CELL_SIZE + plot.depth / 2);
  return out;
}

/** World-space midpoint of an edge, plus whether it runs along X (a north edge) or along Z (a west edge). */
export function edgeToWorld(edge: Edge): { x: number; z: number; alongX: boolean } {
  const x0 = (edge.x - plot.width / 2) * CELL_SIZE;
  const z0 = (edge.z - plot.depth / 2) * CELL_SIZE;
  return edge.side === 'n'
    ? { x: x0 + CELL_SIZE / 2, z: z0, alongX: true }
    : { x: x0, z: z0 + CELL_SIZE / 2, alongX: false };
}

export function worldToNearestEdge(x: number, z: number): Edge {
  const cell = worldToCell(x, z);
  const localX = x / CELL_SIZE + plot.width / 2 - cell.x; // 0..1 inside the cell
  const localZ = z / CELL_SIZE + plot.depth / 2 - cell.z;
  const distances = [localZ, 1 - localX, 1 - localZ, localX]; // N, E, S, W
  const side = distances.indexOf(Math.min(...distances));
  if (side === 0) return { x: cell.x, z: cell.z, side: 'n' };
  if (side === 1) return { x: cell.x + 1, z: cell.z, side: 'w' };
  if (side === 2) return { x: cell.x, z: cell.z + 1, side: 'n' };
  return { x: cell.x, z: cell.z, side: 'w' };
}

/** Resolves a public asset path ("/assets/...") against Vite's relative base; use for every runtime asset URL. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

export const SAVE_STORAGE_KEY = 'tiny-town:save:v1';
export const SETTINGS_STORAGE_KEY = 'tiny-town:settings:v1';
/** Where the background music resumes on the next visit: `{ track, time }`. */
export const MUSIC_POSITION_STORAGE_KEY = 'tiny-town:music:v1';
