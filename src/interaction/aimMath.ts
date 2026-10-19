/**
 * Aim (point roughly, nudge cell by cell, Place): screen directions → grid steps, and how the aimed
 * cell and edge move. Pure; ToolController owns the state.
 */
import type { Cell, Edge } from '../town/types';

/** A grid direction, as an index into grid.NEIGHBOURS: 0 = −z (north), 1 = +x, 2 = +z, 3 = −x. */
export type AimSide = 0 | 1 | 2 | 3;

/** Breaks the tie when the camera looks exactly along a diagonal, always the same way round. */
const QUARTER_BIAS = 1e-4;

/**
 * The grid direction closest to a screen direction (dy −1 = up the screen) for a camera at `azimuth`
 * (radians, CameraPose.azimuth: the camera sits at +sin / +cos of it from its target in x / z).
 * Null for (0, 0). The four screen directions always map to four different grid directions.
 */
export function screenToGridSide(dx: number, dy: number, azimuth: number): AimSide | null {
  if (dx === 0 && dy === 0) return null;
  const s = Math.sin(azimuth);
  const c = Math.cos(azimuth);
  // Screen right on the ground is (c, −s), screen up is (−s, −c).
  const wx = dx * c + dy * s;
  const wz = -dx * s + dy * c;
  const quarter = Math.round(Math.atan2(wz, wx) / (Math.PI / 2) + QUARTER_BIAS);
  // atan2 quarters: 0 = +x, 1 = +z, ±2 = −x, −1 = −z.
  return QUARTER_TO_SIDE[((quarter % 4) + 4) % 4];
}

const QUARTER_TO_SIDE: readonly AimSide[] = [1, 2, 3, 0];

const SIDE_X = [0, 1, 0, -1] as const;
const SIDE_Z = [-1, 0, 1, 0] as const;

export function sideX(side: AimSide): number {
  return SIDE_X[side];
}

export function sideZ(side: AimSide): number {
  return SIDE_Z[side];
}

/**
 * The aimed cell after one step of `step` cells toward `side`, or `cell` itself when that leaves the
 * plot. `step` is ROAD_BLOCK for block-snapped tools (whose aim sits on a block anchor).
 */
export function stepCell(cell: Cell, side: AimSide, step: number, width: number, depth: number): Cell {
  const x = cell.x + SIDE_X[side] * step;
  const z = cell.z + SIDE_Z[side] * step;
  if (x < 0 || z < 0 || x + step > width || z + step > depth) return { x: cell.x, z: cell.z };
  return { x, z };
}

/** The cell side `side` of `cell` as an Edge (edges are stored as the north or west side of a cell). */
export function sideEdge(cell: Cell, side: AimSide): Edge {
  if (side === 0) return { x: cell.x, z: cell.z, side: 'n' };
  if (side === 1) return { x: cell.x + 1, z: cell.z, side: 'w' };
  if (side === 2) return { x: cell.x, z: cell.z + 1, side: 'n' };
  return { x: cell.x, z: cell.z, side: 'w' };
}

/**
 * Fence aim: the aimed edge (side `edgeSide` of `cell`) moves one step toward `side`: along its own
 * line, or across to the next parallel edge. It never changes direction (R turns it).
 */
export function stepEdge(cell: Cell, edgeSide: AimSide, side: AimSide, width: number, depth: number): { cell: Cell; edgeSide: AimSide } {
  if (side === edgeSide || side % 2 !== edgeSide % 2) return { cell: stepCell(cell, side, 1, width, depth), edgeSide };
  // Straight back across: the opposite side of the same cell is the next edge that way.
  return { cell: { x: cell.x, z: cell.z }, edgeSide: side };
}
