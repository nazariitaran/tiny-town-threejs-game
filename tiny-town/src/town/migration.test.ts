/**
 * v1 → v2 save migration (WP-12): 24 × 24 one-unit cells → 48 × 48 half-unit cells.
 * Fixtures are the v0.1 sample and stress towns, serialized before the grid changed.
 */
import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../catalog/objects';
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createGameBus } from '../game/events';
import { createSeededRandom } from '../utils/random';
import v1Sample from './fixtures/v1-sample.json';
import v1Stress from './fixtures/v1-stress.json';
import { cellKey, footprintCells } from './grid';
import { decodeGround, parseSave, serializeTown } from './serialize';
import { TownEditor } from './TownEditor';
import { TownState } from './TownState';
import type { GroundKind, PlacedObject, SavedTown } from './types';

interface V1Save {
  version: 1;
  width: number;
  depth: number;
  ground: Array<[GroundKind, number]>;
  objects: PlacedObject[];
  edges: Array<{ kind: string; edge: { x: number; z: number; side: 'n' | 'w' } }>;
  nextObjectId: number;
  camera?: Record<string, number>;
}

const sample = v1Sample as unknown as V1Save;
const stress = v1Stress as unknown as V1Save;

function ok(result: SavedTown | Error): SavedTown {
  if (result instanceof Error) throw result;
  return result;
}

const makeEditor = () => new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(1));

function v1Ground(save: V1Save): GroundKind[] {
  return decodeGround(save);
}

function expectNoOverlaps(save: SavedTown): void {
  const seen = new Set<string>();
  for (const object of save.objects) {
    for (const cell of footprintCells(object.anchor, OBJECTS[object.kind].footprint, object.rotation)) {
      expect(seen.has(cellKey(cell)), `overlap at ${cellKey(cell)} (object ${object.id})`).toBe(false);
      seen.add(cellKey(cell));
    }
  }
}

describe('v1 → v2 migration', () => {
  it('fixtures are real v1 saves', () => {
    for (const save of [sample, stress]) expect([save.version, save.width, save.depth]).toEqual([1, 24, 24]);
  });

  it('sample town: 0 drops, same ids/variants/nextObjectId/camera, ground ×4, same road tile count', () => {
    const migrated = ok(parseSave(JSON.stringify(sample)));
    expect([migrated.version, migrated.width, migrated.depth]).toEqual([2, 48, 48]);
    expect(migrated.objects.map((o) => [o.id, o.kind, o.variant])).toEqual(sample.objects.map((o) => [o.id, o.kind, o.variant]));
    expect(migrated.nextObjectId).toBe(sample.nextObjectId);
    expect(migrated.camera).toEqual(sample.camera);

    const oldGround = v1Ground(sample);
    const newGround = decodeGround(migrated);
    for (let z = 0; z < 48; z += 1) {
      for (let x = 0; x < 48; x += 1) expect(newGround[z * 48 + x]).toBe(oldGround[Math.floor(z / 2) * 24 + Math.floor(x / 2)]);
    }
    expect(migrated.edges).toHaveLength(sample.edges.length * 2);

    const editor = makeEditor();
    editor.load(migrated);
    const v1Roads = oldGround.filter((g) => g === 'road').length;
    expect(editor.state.stats().roadTiles).toBe(v1Roads);
    expect(editor.state.stats()).toMatchObject({ homes: 5, trees: 5, props: 6 });
    expectNoOverlaps(migrated);
  });

  it('objects that fit the 2 × 2 area sit on its front row/column; houses flush to the front', () => {
    const migrated = ok(parseSave(sample));
    const byId = new Map(migrated.objects.map((o) => [o.id, o]));
    for (const old of sample.objects) {
      const now = byId.get(old.id)!;
      const [w, d] = old.rotation % 2 === 0 ? OBJECTS[now.kind].footprint : [OBJECTS[now.kind].footprint[1], OBJECTS[now.kind].footprint[0]];
      if (old.rotation === 0) expect(now.anchor.z + d, `${old.kind}#${old.id} front`).toBe(old.anchor.z * 2 + 2);
      if (old.rotation === 2) expect(now.anchor.z, `${old.kind}#${old.id} front`).toBe(old.anchor.z * 2);
      // Across the facing axis the object overlaps its old area.
      expect(now.anchor.x <= old.anchor.x * 2 + 1 && now.anchor.x + w > old.anchor.x * 2, `${old.kind}#${old.id} x`).toBe(true);
    }
  });

  it('stress town: deterministic, no overlaps, loads, keeps ≥ 50% of its homes', () => {
    const a = ok(parseSave(JSON.stringify(stress)));
    const b = ok(parseSave(JSON.stringify(stress)));
    expect(a).toEqual(b);
    expectNoOverlaps(a);
    const editor = makeEditor();
    expect(() => editor.load(a)).not.toThrow();
    const oldHomes = stress.objects.filter((o) => OBJECTS[o.kind].residents > 0).length;
    const newHomes = editor.state.stats().homes;
    expect(newHomes).toBeGreaterThanOrEqual(Math.ceil(oldHomes * 0.5));
    // Everything that is not a house survives (it fits its own 2 × 2 area).
    const oldOthers = stress.objects.filter((o) => OBJECTS[o.kind].residents === 0).length;
    expect(a.objects.filter((o) => OBJECTS[o.kind].residents === 0)).toHaveLength(oldOthers);
    // Ids are a subset of the old ones; nextObjectId kept.
    const oldIds = new Set(stress.objects.map((o) => o.id));
    expect(a.objects.every((o) => oldIds.has(o.id))).toBe(true);
    expect(a.nextObjectId).toBe(stress.nextObjectId);
    console.info(`[migration] stress town: homes ${oldHomes} → ${newHomes}, objects ${stress.objects.length} → ${a.objects.length}`);
  });

  it('migrated saves round-trip through serialize → parseSave → load', () => {
    for (const fixture of [sample, stress]) {
      const migrated = ok(parseSave(fixture));
      const editor = makeEditor();
      editor.load(migrated);
      const again = serializeTown(editor.state, migrated.camera);
      expect(again).toEqual(migrated);
      expect(ok(parseSave(JSON.stringify(again)))).toEqual(migrated);
    }
  });

  it('a house with no room is substituted by a townhouse, else dropped', () => {
    const W = 24;
    const ground: Array<[GroundKind, number]> = [];
    // Row 5: road at x 4 and 6 (so a 3-wide cottage at x 5 can overhang neither side);
    // row 6 is road under x 10 (so nothing 3 deep fits at (10, 7) facing north... see below).
    const cells: GroundKind[] = new Array<GroundKind>(W * W).fill('field');
    cells[5 * W + 4] = 'road';
    cells[5 * W + 6] = 'road';
    cells[3 * W + 10] = 'road'; // behind (10, 4) facing south: the 3rd row back is road
    cells[4 * W + 9] = 'road';
    cells[4 * W + 11] = 'road';
    for (const kind of cells) {
      const last = ground[ground.length - 1];
      if (last && last[0] === kind) last[1] += 1;
      else ground.push([kind, 1]);
    }
    const v1 = {
      version: 1,
      width: W,
      depth: W,
      ground,
      objects: [
        // Cottage between two roads: 3-wide can't fit, a 2-wide townhouse does (same id, rotation).
        { id: 1, kind: 'townhouse-a', anchor: { x: 5, z: 5 }, rotation: 0, variant: 0 },
        // Family home at (10, 4) facing south: the rows behind reach the road at (10, 3) → dropped.
        { id: 2, kind: 'townhouse-c', anchor: { x: 10, z: 4 }, rotation: 0, variant: 1 },
      ],
      edges: [],
      nextObjectId: 3,
    };
    const migrated = ok(parseSave(v1));
    expect(migrated.objects).toEqual([{ id: 1, kind: 'townhouse-b', anchor: { x: 10, z: 9 }, rotation: 0, variant: 0 }]);
    expect(migrated.nextObjectId).toBe(3);
  });

  it('edges become two half-edges each', () => {
    const v1 = {
      version: 1,
      width: 24,
      depth: 24,
      ground: [['field', 576]],
      objects: [],
      edges: [
        { kind: 'fence-small', edge: { x: 3, z: 4, side: 'n' } },
        { kind: 'fence-tall', edge: { x: 24, z: 2, side: 'w' } },
      ],
      nextObjectId: 1,
    };
    expect(ok(parseSave(v1)).edges).toEqual([
      { kind: 'fence-tall', edge: { x: 48, z: 4, side: 'w' } },
      { kind: 'fence-tall', edge: { x: 48, z: 5, side: 'w' } },
      { kind: 'fence-small', edge: { x: 6, z: 8, side: 'n' } },
      { kind: 'fence-small', edge: { x: 7, z: 8, side: 'n' } },
    ]);
  });

  it('broken v1 saves are still rejected (the migration does not hide corruption)', () => {
    const base = { version: 1, width: 24, depth: 24, ground: [['field', 576]], objects: [], edges: [], nextObjectId: 1 };
    for (const broken of [{ ...base, ground: 'field' }, { ...base, ground: [['field']] }, { ...base, objects: {} }, { ...base, edges: null }, { ...base, width: 0 }]) {
      expect(parseSave(broken)).toBeInstanceOf(Error);
    }
  });
});
