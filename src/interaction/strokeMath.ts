/**
 * Pure stroke/gesture helpers. "Grid units" are continuous plot coordinates:
 * gx = worldX / CELL_SIZE + PLOT_WIDTH / 2, so cell (x, z) spans [x, x + 1) × [z, z + 1) and edge
 * lines sit on integer values.
 */
import type { Cell, Edge } from '../town/types';

export interface GridPoint {
  x: number;
  z: number;
}

export type LineAxis = 'x' | 'z';

/** Distance (grid units) from a point to the line segment of an edge's own grid line. */
export function edgeDistance(point: GridPoint, edge: Edge): number {
  return edge.side === 'n' ? Math.abs(point.z - edge.z) : Math.abs(point.x - edge.x);
}

/** Bulldoze only targets an edge when the pointer is within `maxDistance` cells of it. */
export function isNearEdge(point: GridPoint, edge: Edge, maxDistance = 0.3): boolean {
  return edgeDistance(point, edge) <= maxDistance;
}

/**
 * Axis lock for fence 'line' drags: null until the pointer has moved `threshold` grid units
 * from the press point, then the dominant movement axis.
 */
export function lockAxis(start: GridPoint, current: GridPoint, threshold = 0.4): LineAxis | null {
  const dx = current.x - start.x;
  const dz = current.z - start.z;
  if (Math.hypot(dx, dz) < threshold) return null;
  return Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
}

/**
 * Edges of a straight fence run from the press point to the current point along `axis`.
 * Axis x: north edges on the grid line nearest the press point, one per crossed column.
 * Axis z: west edges on the nearest vertical grid line, one per crossed row.
 * Clamped to the plot (border edges allowed). Ordered from the press point outwards.
 */
export function lineEdges(start: GridPoint, current: GridPoint, axis: LineAxis, width: number, depth: number): Edge[] {
  const edges: Edge[] = [];
  if (axis === 'x') {
    const row = clampInt(Math.round(start.z), 0, depth);
    const from = clampInt(Math.floor(start.x), 0, width - 1);
    const to = clampInt(Math.floor(current.x), 0, width - 1);
    const step = to >= from ? 1 : -1;
    for (let x = from; ; x += step) {
      edges.push({ x, z: row, side: 'n' });
      if (x === to) break;
    }
  } else {
    const column = clampInt(Math.round(start.x), 0, width);
    const from = clampInt(Math.floor(start.z), 0, depth - 1);
    const to = clampInt(Math.floor(current.z), 0, depth - 1);
    const step = to >= from ? 1 : -1;
    for (let z = from; ; z += step) {
      edges.push({ x: column, z, side: 'w' });
      if (z === to) break;
    }
  }
  return edges;
}

/**
 * Evenly spaced sample points from `from` (exclusive) to `to` (inclusive), at most `step` grid
 * units apart, so fast bulldoze drags never skip a cell or an edge.
 */
export function segmentSamples(from: GridPoint, to: GridPoint, step = 0.25): GridPoint[] {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const count = Math.max(1, Math.ceil(length / step));
  const points: GridPoint[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / count;
    points.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
  }
  return points;
}

/** Clamp a (possibly far off-plot) cell to the plot plus a one-cell margin, so line walks stay short. */
export function clampCellNearPlot(cell: Cell, width: number, depth: number): Cell {
  return { x: clampInt(cell.x, -1, width), z: clampInt(cell.z, -1, depth) };
}

/** Smallest signed angle (radians) that turns `from` into `to`, in (−π, π]. */
export function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** At most one event per `intervalMs` per key (build:invalid throttling, per reason). */
export class KeyedThrottle {
  private readonly last = new Map<string, number>();

  constructor(private readonly intervalMs = 400) {}

  shouldEmit(key: string, nowMs: number): boolean {
    const previous = this.last.get(key);
    if (previous !== undefined && nowMs - previous < this.intervalMs) return false;
    this.last.set(key, nowMs);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
