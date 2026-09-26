import { describe, expect, it } from 'vitest';
import {
  cellsOnLine,
  edgeCells,
  edgeInBounds,
  edgeOfCellSide,
  footprintCells,
  nextRotation,
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
});
