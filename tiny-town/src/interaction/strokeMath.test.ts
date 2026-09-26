import { describe, expect, it } from 'vitest';
import {
  clampCellNearPlot,
  edgeDistance,
  isNearEdge,
  KeyedThrottle,
  lineEdges,
  lockAxis,
  segmentSamples,
  shortestAngle,
} from './strokeMath';

describe('edge proximity (bulldoze)', () => {
  it('measures distance to the edge grid line', () => {
    expect(edgeDistance({ x: 3.5, z: 5.2 }, { x: 3, z: 5, side: 'n' })).toBeCloseTo(0.2);
    expect(edgeDistance({ x: 4.9, z: 5.5 }, { x: 5, z: 5, side: 'w' })).toBeCloseTo(0.1);
  });
  it('only passes edges within 0.3 cell', () => {
    expect(isNearEdge({ x: 3.5, z: 5.29 }, { x: 3, z: 5, side: 'n' })).toBe(true);
    expect(isNearEdge({ x: 3.5, z: 5.31 }, { x: 3, z: 5, side: 'n' })).toBe(false);
    expect(isNearEdge({ x: 3.5, z: 5.5 }, { x: 3, z: 5, side: 'n' })).toBe(false);
  });
});

describe('fence line drags', () => {
  it('does not lock an axis before the threshold', () => {
    expect(lockAxis({ x: 5, z: 5 }, { x: 5.2, z: 5.1 })).toBeNull();
  });
  it('locks the dominant axis of the first movement', () => {
    expect(lockAxis({ x: 5, z: 5 }, { x: 6, z: 5.3 })).toBe('x');
    expect(lockAxis({ x: 5, z: 5 }, { x: 5.2, z: 3.9 })).toBe('z');
  });
  it('builds a run of north edges along x on the nearest grid line', () => {
    expect(lineEdges({ x: 5.5, z: 5.1 }, { x: 8.5, z: 5.4 }, 'x', 24, 24)).toEqual([
      { x: 5, z: 5, side: 'n' },
      { x: 6, z: 5, side: 'n' },
      { x: 7, z: 5, side: 'n' },
      { x: 8, z: 5, side: 'n' },
    ]);
  });
  it('builds a run of west edges along z, backwards too', () => {
    expect(lineEdges({ x: 2.9, z: 4.5 }, { x: 3.4, z: 2.5 }, 'z', 24, 24)).toEqual([
      { x: 3, z: 4, side: 'w' },
      { x: 3, z: 3, side: 'w' },
      { x: 3, z: 2, side: 'w' },
    ]);
  });
  it('clamps to the plot, keeping border edges', () => {
    const edges = lineEdges({ x: 22.5, z: 23.9 }, { x: 40, z: 23.9 }, 'x', 24, 24);
    expect(edges).toEqual([
      { x: 22, z: 24, side: 'n' },
      { x: 23, z: 24, side: 'n' },
    ]);
  });
});

describe('segment sampling', () => {
  it('samples at most `step` apart and ends on the target', () => {
    const points = segmentSamples({ x: 0, z: 0 }, { x: 2, z: 0 }, 0.25);
    expect(points).toHaveLength(8);
    expect(points.at(-1)).toEqual({ x: 2, z: 0 });
  });
  it('returns the target for a zero-length segment', () => {
    expect(segmentSamples({ x: 1, z: 1 }, { x: 1, z: 1 })).toEqual([{ x: 1, z: 1 }]);
  });
});

describe('misc', () => {
  it('clamps far-away cells to a one-cell margin around the plot', () => {
    expect(clampCellNearPlot({ x: 500, z: -40 }, 24, 24)).toEqual({ x: 24, z: -1 });
  });
  it('finds the shortest signed angle', () => {
    expect(shortestAngle(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(shortestAngle(Math.PI * 1.75, Math.PI / 4)).toBeCloseTo(Math.PI / 2);
  });
  it('throttles per key', () => {
    const throttle = new KeyedThrottle(400);
    expect(throttle.shouldEmit('occupied', 0)).toBe(true);
    expect(throttle.shouldEmit('occupied', 399)).toBe(false);
    expect(throttle.shouldEmit('blocked-by-road', 100)).toBe(true);
    expect(throttle.shouldEmit('occupied', 400)).toBe(true);
  });
});
