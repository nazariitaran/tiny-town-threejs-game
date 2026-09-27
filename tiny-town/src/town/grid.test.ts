import { describe, expect, it } from 'vitest';
import { CELL_SIZE, cellToWorld, footprintCentreWorld, roadBlockCentreWorld, ROAD_TILE_SIZE } from '../game/config';
import {
  anchorForPointer,
  cellsOnLine,
  edgeCells,
  edgeInBounds,
  edgeOfCellSide,
  footprintCells,
  nextRotation,
  ROAD_BLOCK,
  roadBlockAnchor,
  roadBlockCells,
  rotatedFootprint,
} from './grid';

describe('grid helpers', () => {
  it('rotates footprints by swapping axes on odd turns', () => {
    expect(rotatedFootprint([2, 1], 0)).toEqual([2, 1]);
    expect(rotatedFootprint([2, 1], 1)).toEqual([1, 2]);
    expect(rotatedFootprint([2, 1], 2)).toEqual([2, 1]);
  });

  it('lists footprint cells from the min-corner anchor', () => {
    expect(footprintCells({ x: 3, z: 4 }, [2, 1], 1)).toEqual([
      { x: 3, z: 4 },
      { x: 3, z: 5 },
    ]);
  });

  it('canonicalises cell sides to north/west edges', () => {
    const cell = { x: 2, z: 2 };
    expect(edgeOfCellSide(cell, 0)).toEqual({ x: 2, z: 2, side: 'n' });
    expect(edgeOfCellSide(cell, 1)).toEqual({ x: 3, z: 2, side: 'w' });
    expect(edgeOfCellSide(cell, 2)).toEqual({ x: 2, z: 3, side: 'n' });
    expect(edgeOfCellSide(cell, 3)).toEqual({ x: 2, z: 2, side: 'w' });
    expect(edgeCells({ x: 3, z: 2, side: 'w' })).toEqual([
      { x: 2, z: 2 },
      { x: 3, z: 2 },
    ]);
  });

  it('accepts border edges but rejects edges outside the plot', () => {
    expect(edgeInBounds({ x: 4, z: 0, side: 'w' }, 4, 4)).toBe(true);
    expect(edgeInBounds({ x: 0, z: 4, side: 'n' }, 4, 4)).toBe(true);
    expect(edgeInBounds({ x: 4, z: 0, side: 'n' }, 4, 4)).toBe(false);
    expect(edgeInBounds({ x: 5, z: 0, side: 'w' }, 4, 4)).toBe(false);
  });

  it('walks gap-free 4-connected lines', () => {
    const line = cellsOnLine({ x: 0, z: 0 }, { x: 3, z: 2 });
    expect(line[0]).toEqual({ x: 0, z: 0 });
    expect(line.at(-1)).toEqual({ x: 3, z: 2 });
    expect(line).toHaveLength(3 + 2 + 1);
    for (let i = 1; i < line.length; i += 1) {
      const step = Math.abs(line[i].x - line[i - 1].x) + Math.abs(line[i].z - line[i - 1].z);
      expect(step).toBe(1);
    }
    expect(cellsOnLine({ x: 2, z: 2 }, { x: 2, z: 2 })).toEqual([{ x: 2, z: 2 }]);
    expect(cellsOnLine({ x: 2, z: 5 }, { x: 2, z: 2 })).toHaveLength(4);
  });

  it('wraps rotation both ways', () => {
    expect(nextRotation(3, 1)).toBe(0);
    expect(nextRotation(0, -1)).toBe(3);
  });

  it('finds aligned road blocks', () => {
    expect(ROAD_BLOCK).toBe(2);
    expect(roadBlockAnchor({ x: 5, z: 4 })).toEqual({ x: 4, z: 4 });
    expect(roadBlockAnchor({ x: 0, z: 1 })).toEqual({ x: 0, z: 0 });
    expect(roadBlockCells({ x: 7, z: 3 })).toEqual([
      { x: 6, z: 2 },
      { x: 7, z: 2 },
      { x: 6, z: 3 },
      { x: 7, z: 3 },
    ]);
  });

  it('centres footprints of size 1, 2 and 3 on the pointer', () => {
    // Size 1: the hovered cell, wherever inside it the pointer is.
    expect(anchorForPointer(5.1, 7.9, [1, 1], 0, 48, 48)).toEqual({ x: 5, z: 7 });
    // Size 2: snaps to the nearest cell corner (pointer 5.9 → corner 6 → anchor 5).
    expect(anchorForPointer(5.9, 5.2, [2, 2], 0, 48, 48)).toEqual({ x: 5, z: 4 });
    expect(anchorForPointer(5.4, 5.6, [2, 1], 0, 48, 48)).toEqual({ x: 4, z: 5 });
    // Size 3: centred on the hovered cell.
    expect(anchorForPointer(10.5, 10.5, [3, 3], 0, 48, 48)).toEqual({ x: 9, z: 9 });
    expect(anchorForPointer(10.99, 10.01, [3, 3], 0, 48, 48)).toEqual({ x: 9, z: 9 });
    // 2×3 at rotation 1 is 3 wide × 2 deep.
    expect(anchorForPointer(10.5, 10.9, [2, 3], 1, 48, 48)).toEqual({ x: 9, z: 10 });
  });

  it('snaps road-feature anchors to the road-block grid (snap = ROAD_BLOCK)', () => {
    // A 6 × 6 roundabout: the nearest even anchor that centres it on the pointer.
    expect(anchorForPointer(10.5, 10.5, [6, 6], 0, 48, 48, undefined, 2)).toEqual({ x: 8, z: 8 });
    expect(anchorForPointer(11.9, 12.1, [6, 6], 0, 48, 48, undefined, 2)).toEqual({ x: 8, z: 10 });
    // Clamped inside the plot and still aligned, even on an odd-sized plot.
    expect(anchorForPointer(-3, 47.9, [6, 6], 0, 48, 48, undefined, 2)).toEqual({ x: 0, z: 42 });
    expect(anchorForPointer(46.9, 46.9, [6, 6], 0, 47, 47, undefined, 2)).toEqual({ x: 40, z: 40 });
    // snap defaults to 1 (unchanged behaviour).
    expect(anchorForPointer(10.5, 10.5, [6, 6], 0, 48, 48)).toEqual({ x: 8, z: 8 });
    expect(anchorForPointer(11.5, 11.5, [6, 6], 0, 48, 48)).toEqual({ x: 9, z: 9 });
  });

  it('clamps pointer anchors so the footprint stays in the plot', () => {
    expect(anchorForPointer(0.2, 0.2, [3, 3], 0, 48, 48)).toEqual({ x: 0, z: 0 });
    expect(anchorForPointer(-4, 60, [3, 3], 0, 48, 48)).toEqual({ x: 0, z: 45 });
    expect(anchorForPointer(47.9, 47.9, [2, 3], 1, 48, 48)).toEqual({ x: 45, z: 46 });
  });

  it('maps footprint and road-block centres to world space', () => {
    expect(ROAD_TILE_SIZE).toBeCloseTo(2 * CELL_SIZE);
    const one = footprintCentreWorld({ x: 3, z: 4 }, [1, 1], 0);
    const cell = cellToWorld({ x: 3, z: 4 });
    expect(one.x).toBeCloseTo(cell.x);
    expect(one.z).toBeCloseTo(cell.z);
    const wide = footprintCentreWorld({ x: 3, z: 4 }, [2, 3], 1); // 3 wide, 2 deep
    expect(wide.x).toBeCloseTo(cell.x + CELL_SIZE);
    expect(wide.z).toBeCloseTo(cell.z + CELL_SIZE / 2);
    const block = roadBlockCentreWorld({ x: 5, z: 5 });
    const corner = cellToWorld({ x: 4, z: 4 });
    expect(block.x).toBeCloseTo(corner.x + CELL_SIZE / 2);
    expect(block.z).toBeCloseTo(corner.z + CELL_SIZE / 2);
  });
});
