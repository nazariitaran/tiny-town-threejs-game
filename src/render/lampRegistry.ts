import { CELL_SIZE, cellToWorld } from '../game/config';
import { footprintOf, objectDef } from '../catalog/objects';
import { rotatedFootprint } from '../town/grid';
import type { ObjectKind, PlacedObject, TownChange, TownStateReader } from '../town/types';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export const LAMP_KIND: ObjectKind = 'lamppost';

export class LampRegistry {
  private readonly lamps = new Map<number, PlacedObject>();
  /** Bumped on every change, so consumers rebuild their instances only when needed. */
  version = 0;

  constructor(private readonly kind: ObjectKind = LAMP_KIND) {}

  get count(): number {
    return this.lamps.size;
  }

  /** Lamps in insertion order (stable). */
  values(): IterableIterator<PlacedObject> {
    return this.lamps.values();
  }

  rebuild(town: TownStateReader): void {
    this.lamps.clear();
    for (const placed of town.objects()) if (placed.kind === this.kind) this.lamps.set(placed.id, { ...placed, anchor: { ...placed.anchor } });
    this.version += 1;
  }

  /** True when the lamp set changed. */
  onTownChanged(changes: readonly TownChange[], cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset', town: TownStateReader): boolean {
    if (cause === 'reset' || cause === 'load') {
      const before = this.lamps.size;
      this.rebuild(town);
      return before > 0 || this.lamps.size > 0;
    }
    let changed = false;
    for (const change of changes) {
      if (change.layer !== 'object' || change.object.kind !== this.kind) continue;
      if (change.op === 'add') this.lamps.set(change.object.id, { ...change.object, anchor: { ...change.object.anchor } });
      else this.lamps.delete(change.object.id);
      changed = true;
    }
    if (changed) this.version += 1;
    return changed;
  }
}

/**
 * World position of a point given in an object's model space (rotation-0 frame, footprint-centred,
 * base at y = 0, after any MODEL_STYLES scale): the object's footprint centre plus the point turned
 * by the object's rotation (r quarter turns CCW from above = three's +Y rotation).
 */
export function objectPointToWorld(
  placed: Pick<PlacedObject, 'kind' | 'anchor' | 'rotation'> & { variant?: number },
  point: Vec3Like,
  out: Vec3Like,
): Vec3Like {
  const [w, d] = rotatedFootprint(footprintOf(objectDef(placed.kind), placed.variant), placed.rotation);
  const first = cellToWorld(placed.anchor);
  const cx = first.x + ((w - 1) * CELL_SIZE) / 2;
  const cz = first.z + ((d - 1) * CELL_SIZE) / 2;
  const angle = (placed.rotation * Math.PI) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = point.x * cos + point.z * sin;
  const z = -point.x * sin + point.z * cos;
  out.x = cx + x;
  out.y = point.y;
  out.z = cz + z;
  return out;
}

/**
 * Area-weighted centroid of the triangles whose UV centroid falls in atlas cell (col, row) of a
 * `columns × rows` atlas (glTF UVs: v = 0 at the top). Null when no triangle samples that cell.
 */
export function measureCellCentroid(
  positions: ArrayLike<number>,
  uvs: ArrayLike<number>,
  index: ArrayLike<number> | null,
  col: number,
  row: number,
  columns = 16,
  rows = 4,
  /** Only triangles whose centroid passes (e.g. one quadrant of the model). */
  accept?: (x: number, y: number, z: number) => boolean,
): (Vec3Like & { triangles: number }) | null {
  const count = index ? index.length : positions.length / 3;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let area = 0;
  let triangles = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = index ? index[t] : t;
    const b = index ? index[t + 1] : t + 1;
    const c = index ? index[t + 2] : t + 2;
    const u = (uvs[a * 2] + uvs[b * 2] + uvs[c * 2]) / 3;
    const v = (uvs[a * 2 + 1] + uvs[b * 2 + 1] + uvs[c * 2 + 1]) / 3;
    if (Math.floor(u * columns) !== col || Math.floor(v * rows) !== row) continue;
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const e1x = positions[b * 3] - ax;
    const e1y = positions[b * 3 + 1] - ay;
    const e1z = positions[b * 3 + 2] - az;
    const e2x = positions[c * 3] - ax;
    const e2y = positions[c * 3 + 1] - ay;
    const e2z = positions[c * 3 + 2] - az;
    if (accept && !accept(ax + (e1x + e2x) / 3, ay + (e1y + e2y) / 3, az + (e1z + e2z) / 3)) continue;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    // Degenerate triangles still count (weight epsilon) so a cell of slivers isn't lost.
    const weight = Math.max(Math.hypot(cx, cy, cz) / 2, 1e-9);
    sx += ((ax * 3 + e1x + e2x) / 3) * weight;
    sy += ((ay * 3 + e1y + e2y) / 3) * weight;
    sz += ((az * 3 + e1z + e2z) / 3) * weight;
    area += weight;
    triangles += 1;
  }
  if (triangles === 0) return null;
  return { x: sx / area, y: sy / area, z: sz / area, triangles };
}
