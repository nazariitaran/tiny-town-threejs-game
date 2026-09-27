/**
 * CONTRACT FILE — pure grid helpers shared by town logic, renderer, picker and fx.
 * Pure functions only; no three.js. Unit-tested in src/town/grid.test.ts.
 */
import type { Cell, Edge, Rotation } from './types';

export const cellKey = (cell: Cell): string => `${cell.x},${cell.z}`;

export const edgeKey = (edge: Edge): string => `${edge.side}:${edge.x},${edge.z}`;

export const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined): boolean =>
  !!a && !!b && a.x === b.x && a.z === b.z;

export const sameEdge = (a: Edge | null | undefined, b: Edge | null | undefined): boolean =>
  !!a && !!b && a.x === b.x && a.z === b.z && a.side === b.side;

/** 4-neighbour offsets in N, E, S, W order (bit order used by road auto-tiling: N=1, E=2, S=4, W=8). */
export const NEIGHBOURS: ReadonlyArray<Readonly<Cell>> = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

/** Footprint in cells after rotation (odd quarter turns swap width/depth). */
export function rotatedFootprint(footprint: readonly [number, number], rotation: Rotation): [number, number] {
  return rotation % 2 === 0 ? [footprint[0], footprint[1]] : [footprint[1], footprint[0]];
}

/** All cells covered by an object anchored at its min corner. */
export function footprintCells(anchor: Cell, footprint: readonly [number, number], rotation: Rotation): Cell[] {
  const [w, d] = rotatedFootprint(footprint, rotation);
  const cells: Cell[] = [];
  for (let dz = 0; dz < d; dz += 1) {
    for (let dx = 0; dx < w; dx += 1) cells.push({ x: anchor.x + dx, z: anchor.z + dz });
  }
  return cells;
}

/** The two cells an edge separates (either may be out of bounds on the plot border). */
export function edgeCells(edge: Edge): [Cell, Cell] {
  return edge.side === 'n'
    ? [{ x: edge.x, z: edge.z - 1 }, { x: edge.x, z: edge.z }]
    : [{ x: edge.x - 1, z: edge.z }, { x: edge.x, z: edge.z }];
}

/** Canonical edge for a cell side given as a NEIGHBOURS index (0=N, 1=E, 2=S, 3=W). */
export function edgeOfCellSide(cell: Cell, sideIndex: 0 | 1 | 2 | 3): Edge {
  switch (sideIndex) {
    case 0:
      return { x: cell.x, z: cell.z, side: 'n' };
    case 1:
      return { x: cell.x + 1, z: cell.z, side: 'w' };
    case 2:
      return { x: cell.x, z: cell.z + 1, side: 'n' };
    default:
      return { x: cell.x, z: cell.z, side: 'w' };
  }
}

/** Is the edge on or inside the plot (width × depth)? */
export function edgeInBounds(edge: Edge, width: number, depth: number): boolean {
  if (edge.side === 'n') return edge.x >= 0 && edge.x < width && edge.z >= 0 && edge.z <= depth;
  return edge.x >= 0 && edge.x <= width && edge.z >= 0 && edge.z < depth;
}

/**
 * Cells visited by a straight segment between two cells, inclusive and gap-free
 * (4-connected supercover), so fast drags never skip cells.
 */
export function cellsOnLine(from: Cell, to: Cell): Cell[] {
  const cells: Cell[] = [{ x: from.x, z: from.z }];
  let x = from.x;
  let z = from.z;
  const dx = Math.abs(to.x - from.x);
  const dz = Math.abs(to.z - from.z);
  const sx = Math.sign(to.x - from.x);
  const sz = Math.sign(to.z - from.z);
  let ix = 0;
  let iz = 0;
  while (ix < dx || iz < dz) {
    // Step along whichever axis is further behind the ideal line.
    if ((0.5 + ix) / dx < (0.5 + iz) / dz || dz === 0) {
      x += sx;
      ix += 1;
    } else {
      z += sz;
      iz += 1;
    }
    cells.push({ x, z });
  }
  return cells;
}

/**
 * Roads are laid in aligned ROAD_BLOCK × ROAD_BLOCK cell blocks (min corner at even x, z): one road
 * tile covers a whole block, and a block is either all road or has no road at all (WP-12).
 */
export const ROAD_BLOCK = 2;

/** Min-corner cell of the road block containing `cell`. */
export function roadBlockAnchor(cell: Cell, out: Cell = { x: 0, z: 0 }): Cell {
  out.x = Math.floor(cell.x / ROAD_BLOCK) * ROAD_BLOCK;
  out.z = Math.floor(cell.z / ROAD_BLOCK) * ROAD_BLOCK;
  return out;
}

/** The ROAD_BLOCK² cells of the block containing `cell`, row-major from the anchor. */
export function roadBlockCells(cell: Cell): Cell[] {
  const anchor = roadBlockAnchor(cell);
  const cells: Cell[] = [];
  for (let dz = 0; dz < ROAD_BLOCK; dz += 1) {
    for (let dx = 0; dx < ROAD_BLOCK; dx += 1) cells.push({ x: anchor.x + dx, z: anchor.z + dz });
  }
  return cells;
}

/**
 * Min-corner anchor that centres a (rotated) footprint on a pointer at fractional grid coordinates
 * (gx, gz) (cell x covers [x, x + 1)), clamped so the whole footprint stays inside W × D.
 * Odd sizes centre on the hovered cell; even sizes snap to the nearest cell corner.
 */
export function anchorForPointer(
  gx: number,
  gz: number,
  footprint: readonly [number, number],
  rotation: Rotation,
  width: number,
  depth: number,
  out: Cell = { x: 0, z: 0 },
): Cell {
  const [w, d] = rotatedFootprint(footprint, rotation);
  out.x = Math.min(Math.max(Math.floor(gx - w / 2 + 0.5), 0), Math.max(0, width - w));
  out.z = Math.min(Math.max(Math.floor(gz - d / 2 + 0.5), 0), Math.max(0, depth - d));
  return out;
}

export const nextRotation = (rotation: Rotation, direction: 1 | -1): Rotation =>
  (((rotation + direction) % 4) + 4) % 4 as Rotation;
