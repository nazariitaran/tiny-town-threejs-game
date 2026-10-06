/**
 * Pond auto-tiling. Every pond cell is drawn as a water slab plus one shore piece per quarter (a
 * 0.25 × 0.25 square), chosen from the quarter's two side neighbours and the diagonal between them:
 *
 *   open   both sides and the diagonal are pond: nothing on top of the water
 *   edge   land on one side: a straight bank along that side
 *   outer  land on both sides: a rounded convex corner
 *   inner  pond on both sides, land on the diagonal: a small concave notch
 *
 * Each piece is made for the NORTH-WEST quarter (edge: land to the north, −z; corners: land towards
 * north-west) with its origin at the quarter's centre, and is turned about that centre by `rotation`
 * quarter turns counter-clockwise from above, which carries north → west → south → east.
 * Quarters are listed NW, NE, SE, SW.
 */
import type { Cell, Rotation, TownStateReader } from './types';

export type PondPiece = 'open' | 'edge' | 'outer' | 'inner';

export interface PondQuarter {
  piece: PondPiece;
  rotation: Rotation;
}

/** The four quarters of a cell as (sx, sz) corner directions, in NW, NE, SE, SW order. */
export const POND_QUARTERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Turns that carry the north-west corner onto a quarter's corner (NW, NE, SE, SW). */
const CORNER_TURNS: readonly Rotation[] = [0, 3, 2, 1];

/** Turn that carries north onto the land side of an edge quarter. */
function edgeTurn(dx: number, dz: number): Rotation {
  if (dz < 0) return 0;
  if (dx < 0) return 1;
  if (dz > 0) return 2;
  return 3;
}

export const isPond = (town: TownStateReader, x: number, z: number): boolean => {
  const cell = { x, z };
  return town.inBounds(cell) && town.getGround(cell) === 'pond';
};

/** The piece for quarter `q` (POND_QUARTERS index) of a pond cell. */
export function pondQuarter(town: TownStateReader, cell: Cell, q: number): PondQuarter {
  const [sx, sz] = POND_QUARTERS[q];
  const sideZ = isPond(town, cell.x, cell.z + sz);
  const sideX = isPond(town, cell.x + sx, cell.z);
  if (!sideZ && !sideX) return { piece: 'outer', rotation: CORNER_TURNS[q] };
  if (!sideZ) return { piece: 'edge', rotation: edgeTurn(0, sz) };
  if (!sideX) return { piece: 'edge', rotation: edgeTurn(sx, 0) };
  if (!isPond(town, cell.x + sx, cell.z + sz)) return { piece: 'inner', rotation: CORNER_TURNS[q] };
  return { piece: 'open', rotation: 0 };
}

/** All four quarters of a pond cell, NW, NE, SE, SW. */
export function pondQuarters(town: TownStateReader, cell: Cell): PondQuarter[] {
  return POND_QUARTERS.map((_, q) => pondQuarter(town, cell, q));
}

/** Ponds: 4-connected groups of pond cells, each listed in row-major order; ponds ordered by their first cell. */
export function findPonds(town: TownStateReader): Cell[][] {
  const seen = new Uint8Array(town.width * town.depth);
  const ponds: Cell[][] = [];
  for (let z = 0; z < town.depth; z += 1) {
    for (let x = 0; x < town.width; x += 1) {
      if (seen[z * town.width + x] || !isPond(town, x, z)) continue;
      const pond: Cell[] = [];
      const stack: Cell[] = [{ x, z }];
      seen[z * town.width + x] = 1;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        pond.push(cell);
        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = cell.x + dx;
          const nz = cell.z + dz;
          if (!isPond(town, nx, nz) || seen[nz * town.width + nx]) continue;
          seen[nz * town.width + nx] = 1;
          stack.push({ x: nx, z: nz });
        }
      }
      pond.sort((a, b) => a.z - b.z || a.x - b.x);
      ponds.push(pond);
    }
  }
  return ponds;
}
