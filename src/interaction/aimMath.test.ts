import { describe, expect, it } from 'vitest';
import { screenToGridSide, sideEdge, stepCell, stepEdge, type AimSide } from './aimMath';

const UP = [0, -1] as const;
const RIGHT = [1, 0] as const;
const DOWN = [0, 1] as const;
const LEFT = [-1, 0] as const;

function sides(azimuth: number): Array<AimSide | null> {
  return [UP, RIGHT, DOWN, LEFT].map(([dx, dy]) => screenToGridSide(dx, dy, azimuth));
}

describe('screenToGridSide', () => {
  it('looking north (azimuth 0): up is −z, right is +x', () => {
    expect(sides(0)).toEqual([0, 1, 2, 3]);
  });

  it('turns with the camera a quarter at a time', () => {
    // Camera at +x looking −x: up the screen is −x, right is −z.
    expect(sides(Math.PI / 2)).toEqual([3, 0, 1, 2]);
    expect(sides(Math.PI)).toEqual([2, 3, 0, 1]);
    expect(sides(-Math.PI / 2)).toEqual([1, 2, 3, 0]);
    expect(sides(3 * Math.PI / 2)).toEqual([1, 2, 3, 0]);
  });

  it('snaps to the nearest quarter', () => {
    expect(sides(0.3)).toEqual(sides(0));
    expect(sides(Math.PI / 2 - 0.3)).toEqual(sides(Math.PI / 2));
    expect(sides(2 * Math.PI + 0.1)).toEqual(sides(0));
  });

  it('on an exact diagonal (the default 45° camera) still gives four different directions', () => {
    for (const azimuth of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, 5 * Math.PI / 4]) {
      const result = sides(azimuth);
      expect(new Set(result).size, `azimuth ${azimuth}`).toBe(4);
      // Opposite screen directions give opposite grid directions.
      expect((result[0]! + 2) % 4).toBe(result[2]);
      expect((result[1]! + 2) % 4).toBe(result[3]);
    }
  });

  it('a diagonal screen step picks one axis; no step is null', () => {
    expect(screenToGridSide(1, -1, 0)).not.toBeNull();
    expect(screenToGridSide(0, 0, 1)).toBeNull();
  });
});

describe('stepCell', () => {
  it('moves one cell, or a block, and stays inside the plot', () => {
    expect(stepCell({ x: 5, z: 5 }, 1, 1, 10, 10)).toEqual({ x: 6, z: 5 });
    expect(stepCell({ x: 5, z: 5 }, 0, 1, 10, 10)).toEqual({ x: 5, z: 4 });
    expect(stepCell({ x: 4, z: 4 }, 2, 2, 10, 10)).toEqual({ x: 4, z: 6 });
    expect(stepCell({ x: 9, z: 5 }, 1, 1, 10, 10)).toEqual({ x: 9, z: 5 });
    expect(stepCell({ x: 0, z: 0 }, 3, 1, 10, 10)).toEqual({ x: 0, z: 0 });
    // A block step never leaves half a block outside.
    expect(stepCell({ x: 6, z: 0 }, 1, 2, 9, 9)).toEqual({ x: 6, z: 0 });
    expect(stepCell({ x: 6, z: 0 }, 1, 2, 10, 10)).toEqual({ x: 8, z: 0 });
  });
});

describe('sideEdge / stepEdge', () => {
  it('names the four sides of a cell', () => {
    expect(sideEdge({ x: 3, z: 4 }, 0)).toEqual({ x: 3, z: 4, side: 'n' });
    expect(sideEdge({ x: 3, z: 4 }, 1)).toEqual({ x: 4, z: 4, side: 'w' });
    expect(sideEdge({ x: 3, z: 4 }, 2)).toEqual({ x: 3, z: 5, side: 'n' });
    expect(sideEdge({ x: 3, z: 4 }, 3)).toEqual({ x: 3, z: 4, side: 'w' });
  });

  it('slides an edge along its line and steps it across one edge at a time', () => {
    const along = stepEdge({ x: 3, z: 4 }, 0, 1, 10, 10);
    expect(sideEdge(along.cell, along.edgeSide)).toEqual({ x: 4, z: 4, side: 'n' });
    const north = stepEdge({ x: 3, z: 4 }, 0, 0, 10, 10);
    expect(sideEdge(north.cell, north.edgeSide)).toEqual({ x: 3, z: 3, side: 'n' });
    const south = stepEdge({ x: 3, z: 4 }, 0, 2, 10, 10);
    expect(sideEdge(south.cell, south.edgeSide)).toEqual({ x: 3, z: 5, side: 'n' });
    const back = stepEdge(south.cell, south.edgeSide, 0, 10, 10);
    expect(sideEdge(back.cell, back.edgeSide)).toEqual({ x: 3, z: 4, side: 'n' });
  });
});
