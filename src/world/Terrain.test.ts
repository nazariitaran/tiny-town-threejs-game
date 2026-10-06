import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { CELL_SIZE, GROUND_Y, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createPlotBase, setFieldRaised } from './Terrain';
import { FIELD_Y, PLOT_HALF_X, PLOT_HALF_Z } from './terrainShape';

/** Heights of the six vertices of a cell's field quad, with the quad's XZ bounds. */
function cellQuad(mesh: THREE.Mesh, x: number, z: number): { ys: number[]; min: [number, number]; max: [number, number] } {
  const position = mesh.geometry.getAttribute('position');
  const first = (x * PLOT_DEPTH + z) * 6;
  const ys: number[] = [];
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  for (let i = first; i < first + 6; i += 1) {
    ys.push(position.getY(i));
    min[0] = Math.min(min[0], position.getX(i));
    min[1] = Math.min(min[1], position.getZ(i));
    max[0] = Math.max(max[0], position.getX(i));
    max[1] = Math.max(max[1], position.getZ(i));
  }
  return { ys, min, max };
}

describe('plot field', () => {
  it('starts at ground level everywhere, one quad per cell', () => {
    const mesh = createPlotBase();
    for (const [x, z] of [[0, 0], [5, 9], [PLOT_WIDTH - 1, PLOT_DEPTH - 1]]) {
      const quad = cellQuad(mesh, x, z);
      expect(quad.ys.every((y) => Math.abs(y - GROUND_Y) < 1e-6), `${x},${z}`).toBe(true);
      expect(quad.min[0]).toBeCloseTo(-PLOT_HALF_X + x * CELL_SIZE, 5);
      expect(quad.min[1]).toBeCloseTo(-PLOT_HALF_Z + z * CELL_SIZE, 5);
      expect(quad.max[0]).toBeCloseTo(-PLOT_HALF_X + (x + 1) * CELL_SIZE, 5);
      expect(quad.max[1]).toBeCloseTo(-PLOT_HALF_Z + (z + 1) * CELL_SIZE, 5);
    }
  });

  it('a painted cell drops to the bed and comes back, leaving its neighbours alone', () => {
    const mesh = createPlotBase();
    setFieldRaised(mesh, 5, 9, false);
    expect(cellQuad(mesh, 5, 9).ys.every((y) => Math.abs(y - FIELD_Y) < 1e-6)).toBe(true);
    for (const [x, z] of [[4, 9], [6, 9], [5, 8], [5, 10]]) expect(cellQuad(mesh, x, z).ys.every((y) => Math.abs(y - GROUND_Y) < 1e-6), `${x},${z}`).toBe(true);
    setFieldRaised(mesh, 5, 9, true);
    expect(cellQuad(mesh, 5, 9).ys.every((y) => Math.abs(y - GROUND_Y) < 1e-6)).toBe(true);
  });
});
