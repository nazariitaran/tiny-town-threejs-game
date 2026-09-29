import { describe, expect, it } from 'vitest';
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createGameBus } from '../game/events';
import { createSeededRandom } from '../utils/random';
import { buildAssetGallery, buildSampleTown, buildStressTown } from './sampleTown';
import { CURRENT_SAVE_VERSION, decodeGround, parseSave, SAVE_MIGRATIONS, serializeTown, type CameraPose } from './serialize';
import { TownEditor } from './TownEditor';
import { TownState } from './TownState';
import type { SavedTown } from './types';

const makeEditor = (seed = 1) => new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(seed));
const camera: CameraPose = { targetX: 1.5, targetZ: -2, azimuth: 0.7, polar: 0.9, distance: 18 };

function ok(result: SavedTown | Error): SavedTown {
  if (result instanceof Error) throw result;
  return result;
}

/** A minimal valid current (v4) save for a w×d plot with all-field ground. */
function blank(w = PLOT_WIDTH, d = PLOT_DEPTH): SavedTown {
  return { version: 4, width: w, depth: d, ground: [['field', w * d]], objects: [], edges: [], nextObjectId: 1 };
}

/** Ground with the 2 × 2 road block at (0, 0)..(1, 1) and field elsewhere. */
function roadBlockAtOrigin(): Array<[string, number]> {
  return [['road', 2], ['field', PLOT_WIDTH - 2], ['road', 2], ['field', PLOT_WIDTH * PLOT_DEPTH - PLOT_WIDTH - 2]];
}

/** RLE ground with road on the rectangle [x0, x0 + w) × [z0, z0 + d) and field elsewhere. */
function groundWithRoad(x0: number, z0: number, w: number, d: number): Array<[string, number]> {
  const runs: Array<[string, number]> = [];
  for (let z = 0; z < PLOT_DEPTH; z += 1) {
    for (let x = 0; x < PLOT_WIDTH; x += 1) {
      const kind = x >= x0 && x < x0 + w && z >= z0 && z < z0 + d ? 'road' : 'field';
      const last = runs[runs.length - 1];
      if (last && last[0] === kind) last[1] += 1;
      else runs.push([kind, 1]);
    }
  }
  return runs;
}

const roundabout = (id: number, x: number, z: number) => ({ id, kind: 'roundabout', anchor: { x, z }, rotation: 0, variant: 0 });

describe('serializeTown', () => {
  it('writes save version 4', () => {
    expect(CURRENT_SAVE_VERSION).toBe(4);
    expect(serializeTown(new TownState(PLOT_WIDTH, PLOT_DEPTH)).version).toBe(4);
  });

  it('encodes an empty plot as one RLE run', () => {
    expect(serializeTown(new TownState(PLOT_WIDTH, PLOT_DEPTH))).toEqual(blank());
  });

  it('run-length encodes row-major ground (z * width + x)', () => {
    const state = new TownState(4, 2);
    state.applyChanges([
      { layer: 'ground', cell: { x: 1, z: 0 }, before: 'field', after: 'road' },
      { layer: 'ground', cell: { x: 2, z: 0 }, before: 'field', after: 'road' },
      { layer: 'ground', cell: { x: 0, z: 1 }, before: 'field', after: 'grass' },
    ]);
    const save = serializeTown(state);
    expect(save.ground).toEqual([['field', 1], ['road', 2], ['field', 1], ['grass', 1], ['field', 3]]);
    expect(decodeGround(save)).toEqual(['field', 'road', 'road', 'field', 'grass', 'field', 'field', 'field']);
  });

  it('includes the camera pose only when given', () => {
    const state = new TownState(PLOT_WIDTH, PLOT_DEPTH);
    expect('camera' in serializeTown(state)).toBe(false);
    expect(serializeTown(state, camera).camera).toEqual(camera);
  });

  it('includes the town name only when given, sanitised (WP-20)', () => {
    const state = new TownState(PLOT_WIDTH, PLOT_DEPTH);
    expect('name' in serializeTown(state)).toBe(false);
    expect('name' in serializeTown(state, undefined, ' ')).toBe(false);
    expect(serializeTown(state, undefined, ' Puddleton ').name).toBe('Puddleton');
  });

  it('is deterministic: objects sorted by id, edges by position', () => {
    const editor = makeEditor();
    buildSampleTown(editor);
    const save = serializeTown(editor.state);
    const ids = save.objects.map((o) => o.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(serializeTown(editor.state)).toEqual(save);
  });
});

describe('round trip serialize → JSON → parseSave → load', () => {
  for (const [name, build] of [
    ['sample town', buildSampleTown],
    ['asset gallery', buildAssetGallery],
    ['stress town', buildStressTown],
  ] as const) {
    it(`${name} round-trips to an identical snapshot`, () => {
      const source = makeEditor(7);
      expect(build(source).rejected).toEqual([]);
      const saved = serializeTown(source.state, camera);
      const json = JSON.stringify(saved);

      const parsed = ok(parseSave(json));
      expect(parsed).toEqual(saved);

      const target = makeEditor(99);
      target.load(parsed);
      expect(serializeTown(target.state, camera)).toEqual(saved);
      expect(target.state.stats()).toEqual(source.state.stats());
      expect(target.state.nextObjectId).toBe(source.state.nextObjectId);
    });
  }

  it('parseSave accepts an already-parsed object as well as a JSON string', () => {
    const editor = makeEditor();
    buildSampleTown(editor);
    const saved = serializeTown(editor.state);
    expect(ok(parseSave(JSON.parse(JSON.stringify(saved))))).toEqual(saved);
  });
});

describe('parseSave rejects corrupted / foreign data without throwing', () => {
  const bad: Array<[string, unknown]> = [
    ['empty string', ''],
    ['truncated JSON', '{"version":1,"width":24'],
    ['garbage text', 'not json at all'],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['JSON number', '42'],
    ['JSON string', '"hello"'],
    ['undefined', undefined],
    ['null', null],
    ['number', 3],
    ['array', [1, 2, 3]],
    ['empty object', {}],
    ['foreign app data', { user: 'bob', theme: 'dark', items: [1, 2] }],
    ['version as string', { ...blank(), version: '1' }],
    ['fractional version', { ...blank(), version: 1.5 }],
    ['negative version', { ...blank(), version: -1 }],
    ['version 0 without a migration', { ...blank(), version: 0 }],
    ['a v1 (v0.1) save', { ...blank(24, 24), version: 1 }],
    ['a v2 (v0.2) save', { ...blank(), version: 2 }],
    ['a v3 (v0.3) save', { ...blank(), version: 3 }],
    ['future version', { ...blank(), version: CURRENT_SAVE_VERSION + 1 }],
    ['missing width', { ...blank(), width: undefined }],
    ['zero depth', { ...blank(), depth: 0 }],
    ['fractional width', { ...blank(), width: 2.5 }],
    ['huge width', { ...blank(), width: 1e9 }],
    ['ground not a list', { ...blank(), ground: 'field' }],
    ['ground run not a pair', { ...blank(), ground: [['field']] }],
    ['ground run negative count', { ...blank(), ground: [['field', -3]] }],
    ['ground run NaN count', { ...blank(), ground: [['field', Number.NaN]] }],
    ['objects not a list', { ...blank(), objects: {} }],
    ['edges not a list', { ...blank(), edges: null }],
  ];
  for (const [name, input] of bad) {
    it(`rejects ${name}`, () => {
      let result: SavedTown | Error | undefined;
      expect(() => (result = parseSave(input))).not.toThrow();
      expect(result).toBeInstanceOf(Error);
    });
  }

  it('rejects a v2 save with "No migration from save version 2" (no backward compatibility)', () => {
    const v2 = { ...blank(), version: 2, objects: [{ id: 1, kind: 'tree-a', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 }], nextObjectId: 2 };
    const result = parseSave(JSON.stringify(v2));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('No migration from save version 2');
  });

  it('rejects a v3 save with "No migration from save version 3" (WP-17: bigger footprints, fresh town)', () => {
    // A v0.3 town: a 3 × 3 cottage next to a 3 × 3 family home would overlap as 4 × 4 lots.
    const objects = [
      { id: 1, kind: 'cottage', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 },
      { id: 2, kind: 'family-home', anchor: { x: 5, z: 2 }, rotation: 0, variant: 0 },
    ];
    const v3 = { ...blank(), version: 3, objects, nextObjectId: 3 };
    const result = parseSave(JSON.stringify(v3));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('No migration from save version 3');
    // The same town as v4 loads, minus the overlapping home (parseSave drops overlaps).
    const v4 = ok(parseSave(JSON.stringify({ ...v3, version: 4 })));
    expect(v4.objects.map((o) => o.kind)).toEqual(['cottage']);
  });

  it('accepts a v4 save of the WP-17 footprints (a 5 × 4 big house turned beside a 3 × 4 church)', () => {
    const objects = [
      { id: 1, kind: 'big-house', anchor: { x: 2, z: 2 }, rotation: 1, variant: 1 },
      { id: 2, kind: 'church', anchor: { x: 6, z: 2 }, rotation: 2, variant: 0 },
    ];
    const save = ok(parseSave(JSON.stringify({ ...blank(), objects, nextObjectId: 3 })));
    expect(save.version).toBe(4);
    expect(save.objects).toEqual(objects);
  });

  it('rejects hostile objects whose getters throw', () => {
    const hostile = Object.defineProperty({}, 'version', {
      get() {
        throw new Error('boom');
      },
    });
    expect(parseSave(hostile)).toBeInstanceOf(Error);
  });
});

describe('parseSave sanitises and clamps', () => {
  it('maps unknown ground kinds to field and caps oversized runs', () => {
    const save = ok(parseSave({ ...blank(), ground: [['lava', 3], ['road', 1_000_000_000]] }));
    const ground = decodeGround(save);
    // (3, 0) is road but its block (2..3, 0..1) is not all road → demoted to field.
    expect(ground.slice(0, 5)).toEqual(['field', 'field', 'field', 'field', 'road']);
    expect(ground).toHaveLength(PLOT_WIDTH * PLOT_DEPTH);
  });

  it('pads short ground with field', () => {
    const save = ok(parseSave({ ...blank(), ground: [['grass', 5]] }));
    const ground = decodeGround(save);
    expect(ground.filter((g) => g === 'grass')).toHaveLength(5);
    expect(ground.filter((g) => g === 'field')).toHaveLength(PLOT_WIDTH * PLOT_DEPTH - 5);
  });

  it('drops unknown object kinds and fence kinds', () => {
    const save = ok(
      parseSave({
        ...blank(),
        objects: [
          { id: 1, kind: 'castle', anchor: { x: 1, z: 1 }, rotation: 0, variant: 0 },
          { id: 2, kind: 'oak', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 },
          { id: 3, kind: 'toString', anchor: { x: 3, z: 3 }, rotation: 0, variant: 0 },
        ],
        edges: [
          { kind: 'brick-wall', edge: { x: 1, z: 1, side: 'n' } },
          { kind: 'fence-low', edge: { x: 2, z: 2, side: 'w' } },
        ],
      }),
    );
    expect(save.objects.map((o) => o.kind)).toEqual(['oak']);
    expect(save.edges.map((e) => e.kind)).toEqual(['fence-low']);
  });

  it('drops malformed objects (bad id, anchor, rotation) and fixes out-of-range variants', () => {
    const base = { kind: 'birch', rotation: 0, variant: 0 };
    const save = ok(
      parseSave({
        ...blank(),
        objects: [
          { ...base, id: 0, anchor: { x: 0, z: 0 } },
          { ...base, id: 1.5, anchor: { x: 1, z: 0 } },
          { ...base, id: 2, anchor: { x: '2', z: 0 } },
          { ...base, id: 3, anchor: { x: 3, z: 0 }, rotation: 4 },
          { ...base, id: 4, anchor: null },
          'not an object',
          { ...base, id: 5, anchor: { x: 5, z: 0 }, variant: 9 },
          { ...base, id: 6, anchor: { x: 6, z: 0 }, variant: 1, rotation: 3 },
        ],
      }),
    );
    expect(save.objects).toEqual([
      { id: 5, kind: 'birch', anchor: { x: 5, z: 0 }, rotation: 0, variant: 0 },
      { id: 6, kind: 'birch', anchor: { x: 6, z: 0 }, rotation: 3, variant: 1 },
    ]);
  });

  it('drops duplicate ids, overlapping objects and objects on disallowed ground', () => {
    const save = ok(
      parseSave({
        ...blank(),
        ground: roadBlockAtOrigin(),
        objects: [
          { id: 1, kind: 'postbox', anchor: { x: 5, z: 5 }, rotation: 0, variant: 0 },
          { id: 1, kind: 'postbox', anchor: { x: 6, z: 5 }, rotation: 0, variant: 0 }, // duplicate id
          { id: 2, kind: 'lamppost', anchor: { x: 5, z: 5 }, rotation: 0, variant: 0 }, // overlaps id 1
          { id: 3, kind: 'cottage', anchor: { x: 0, z: 0 }, rotation: 0, variant: 0 }, // on road
        ],
      }),
    );
    expect(save.objects.map((o) => o.id)).toEqual([1]);
  });

  it('drops invalid, duplicate, out-of-plot and road-crossing edges', () => {
    const save = ok(
      parseSave({
        ...blank(),
        ground: roadBlockAtOrigin(),
        edges: [
          { kind: 'fence-low', edge: { x: 1, z: 0, side: 'w' } }, // between road (0,0) and road (1,0)
          { kind: 'fence-low', edge: { x: 0, z: 0, side: 'n' } }, // border next to road: fine
          { kind: 'fence-tall', edge: { x: 0, z: 0, side: 'n' } }, // duplicate key
          { kind: 'fence-tall', edge: { x: 5, z: 5, side: 'e' } }, // bad side
          { kind: 'fence-tall', edge: { x: PLOT_WIDTH + 1, z: 0, side: 'w' } }, // out of plot
          { kind: 'fence-tall', edge: { x: PLOT_WIDTH, z: 3, side: 'w' } }, // east border: fine
          { kind: 'fence-tall' },
        ],
      }),
    );
    expect(save.edges).toEqual([
      { kind: 'fence-low', edge: { x: 0, z: 0, side: 'n' } },
      { kind: 'fence-tall', edge: { x: PLOT_WIDTH, z: 3, side: 'w' } },
    ]);
  });

  it('clamps a bigger save to the plot (drops what lies outside)', () => {
    const w = PLOT_WIDTH + 6;
    const d = PLOT_DEPTH + 6;
    const ground = Array.from({ length: d }, () => [['grass', w]] as Array<[string, number]>).flat();
    const save = ok(
      parseSave({
        version: 4,
        width: w,
        depth: d,
        ground,
        objects: [
          { id: 1, kind: 'oak', anchor: { x: 1, z: 1 }, rotation: 0, variant: 0 },
          { id: 2, kind: 'oak', anchor: { x: PLOT_WIDTH + 2, z: 1 }, rotation: 0, variant: 0 },
        ],
        edges: [
          { kind: 'fence-low', edge: { x: 3, z: PLOT_DEPTH, side: 'n' } },
          { kind: 'fence-low', edge: { x: 3, z: PLOT_DEPTH + 2, side: 'n' } },
        ],
        nextObjectId: 3,
      }),
    );
    expect([save.width, save.depth]).toEqual([PLOT_WIDTH, PLOT_DEPTH]);
    expect(save.ground).toEqual([['grass', PLOT_WIDTH * PLOT_DEPTH]]);
    expect(save.objects.map((o) => o.id)).toEqual([1]);
    expect(save.edges).toHaveLength(1);
    makeEditor().load(save); // loadable
  });

  it('centres a smaller save on the plot (whole road blocks) and pads it with field', () => {
    const save = ok(parseSave({ ...blank(10, 10), ground: [['meadow', 100]] }, { width: 20, depth: 20 }));
    expect([save.width, save.depth]).toEqual([20, 20]);
    const ground = decodeGround(save);
    const at = (x: number, z: number): string => ground[z * 20 + x];
    // Offset floor(5 / 2) · 2 = 4 (not 5), so road blocks stay aligned: meadow covers 4..13.
    expect(at(3, 3)).toBe('field');
    expect(at(4, 4)).toBe('meadow');
    expect(at(13, 13)).toBe('meadow');
    expect(at(14, 13)).toBe('field');
    expect(at(13, 14)).toBe('field');
  });

  it('shifts a 48 × 48 save by 8 cells onto the 64 × 64 plot (same world position)', () => {
    const save = ok(
      parseSave({
        ...blank(48, 48),
        ground: [['road', 2], ['field', 46], ['road', 2], ['field', 48 * 48 - 50]],
        objects: [{ id: 1, kind: 'postbox', anchor: { x: 3, z: 5 }, rotation: 0, variant: 0 }],
        edges: [{ kind: 'hedge', edge: { x: 10, z: 11, side: 'n' } }],
        nextObjectId: 2,
      }, { width: 64, depth: 64 }),
    );
    const ground = decodeGround(save);
    expect(ground[8 * 64 + 8]).toBe('road');
    expect(ground[9 * 64 + 9]).toBe('road');
    expect(ground[0]).toBe('field');
    expect(save.objects[0].anchor).toEqual({ x: 11, z: 13 });
    expect(save.edges[0].edge).toEqual({ x: 18, z: 19, side: 'n' });
  });

  it('honours an explicit plot size option', () => {
    const save = ok(parseSave(blank(), { width: 8, depth: 6 }));
    expect([save.width, save.depth]).toEqual([8, 6]);
  });

  it('repairs nextObjectId below the highest id', () => {
    const save = ok(
      parseSave({ ...blank(), objects: [{ id: 41, kind: 'postbox', anchor: { x: 1, z: 1 }, rotation: 0, variant: 0 }], nextObjectId: 2 }),
    );
    expect(save.nextObjectId).toBe(42);
    expect(ok(parseSave({ ...blank(), nextObjectId: 'x' })).nextObjectId).toBe(1);
  });

  it('keeps the town name (sanitised) and drops a missing, non-string or blank one (WP-20)', () => {
    expect(ok(parseSave({ ...blank(), name: 'Puddleton' })).name).toBe('Puddleton');
    expect(ok(parseSave({ ...blank(), name: '  Little \n Snorting ' })).name).toBe('Little Snorting');
    expect(ok(parseSave({ ...blank(), name: 'x'.repeat(40) })).name).toBe('x'.repeat(30));
    expect('name' in ok(parseSave(blank()))).toBe(false);
    expect('name' in ok(parseSave({ ...blank(), name: 42 }))).toBe(false);
    expect('name' in ok(parseSave({ ...blank(), name: '   ' }))).toBe(false);
  });

  it('keeps a valid camera pose and drops a malformed one', () => {
    expect(ok(parseSave({ ...blank(), camera })).camera).toEqual(camera);
    expect('camera' in ok(parseSave({ ...blank(), camera: { ...camera, distance: 'far' } }))).toBe(false);
    expect('camera' in ok(parseSave({ ...blank(), camera: { ...camera, polar: Number.POSITIVE_INFINITY } }))).toBe(false);
    expect('camera' in ok(parseSave({ ...blank(), camera: { ...camera, distance: -1 } }))).toBe(false);
  });

  it('every sanitised result loads without throwing', () => {
    const messy = {
      ...blank(),
      ground: [['road', 30], ['pavement', 20]],
      objects: [
        { id: 3, kind: 'bus-stop', anchor: { x: 0, z: 2 }, rotation: 1, variant: 0 },
        { id: 3, kind: 'swing', anchor: { x: 1, z: 2 }, rotation: 1, variant: 0 },
        { id: 4, kind: 'swing', anchor: { x: 0, z: 1 }, rotation: 1, variant: 0 },
      ],
      edges: [{ kind: 'fence-low', edge: { x: 3, z: 1, side: 'n' } }],
      nextObjectId: -5,
    };
    const save = ok(parseSave(messy));
    expect(() => makeEditor().load(save)).not.toThrow();
  });
});

describe('parseSave and road features', () => {
  it('a version 4 save with a roundabout on its road round-trips through JSON unchanged', () => {
    const editor = makeEditor();
    expect(editor.apply({ type: 'place-object', kind: 'roundabout', cell: { x: 10, z: 10 }, rotation: 0 }, 'roundabout').ok).toBe(true);
    const saved = serializeTown(editor.state, camera);
    expect(saved.version).toBe(4);
    expect(saved.objects.map((o) => o.kind)).toEqual(['roundabout']);
    const parsed = ok(parseSave(JSON.stringify(saved)));
    expect(parsed).toEqual(saved);
    const target = makeEditor(5);
    target.load(parsed);
    expect(target.state.stats()).toEqual(editor.state.stats());
    expect(target.state.stats().roadTiles).toBe(9);
  });

  it('keeps a block-aligned roundabout that stands on road', () => {
    const save = ok(parseSave({ ...blank(), ground: groundWithRoad(4, 4, 6, 6), objects: [roundabout(1, 4, 4)], nextObjectId: 2 }));
    expect(save.objects.map((o) => o.kind)).toEqual(['roundabout']);
  });

  it('drops a roundabout whose anchor is not block aligned (its road stays)', () => {
    const save = ok(parseSave({ ...blank(), ground: groundWithRoad(4, 4, 8, 6), objects: [roundabout(1, 5, 4)], nextObjectId: 2 }));
    expect(save.objects).toEqual([]);
    expect(decodeGround(save).filter((g) => g === 'road')).toHaveLength(48);
  });

  it('drops a roundabout standing on non-road ground (even partly)', () => {
    const onField = ok(parseSave({ ...blank(), objects: [roundabout(1, 4, 4)], nextObjectId: 2 }));
    expect(onField.objects).toEqual([]);
    const partly = ok(parseSave({ ...blank(), ground: groundWithRoad(4, 4, 6, 4), objects: [roundabout(1, 4, 4)], nextObjectId: 2 }));
    expect(partly.objects).toEqual([]);
  });

  it('non-feature objects still may not stand on road', () => {
    const save = ok(parseSave({ ...blank(), ground: groundWithRoad(4, 4, 2, 2), objects: [{ id: 1, kind: 'fountain', anchor: { x: 4, z: 4 }, rotation: 0, variant: 0 }] }));
    expect(save.objects).toEqual([]);
  });
});

describe('migration hook', () => {
  it('has no built-in migrations (v0.3 dropped v1/v2 support; WP-17 has no v3 → v4 either)', () => {
    expect(SAVE_MIGRATIONS).toEqual({});
  });

  it('runs migrations keyed on the version they upgrade from', () => {
    // Pretend version 0 stored ground as a flat list of kinds.
    const legacy = { version: 0, width: 2, depth: 1, cells: ['road', 'grass'], things: [] };
    const migrations = {
      3: (raw: Record<string, unknown>) => ({ ...raw, version: 4 }),
      2: (raw: Record<string, unknown>) => ({ ...raw, version: 3 }),
      1: (raw: Record<string, unknown>) => ({ ...raw, version: 2 }),
      0: (raw: Record<string, unknown>) => ({
        version: 1,
        width: raw.width,
        depth: raw.depth,
        ground: (raw.cells as string[]).map((k) => [k, 1]),
        objects: raw.things,
        edges: [],
        nextObjectId: 1,
      }),
    };
    const save = ok(parseSave(legacy, { width: 2, depth: 1, migrations }));
    // The lone road cell is a partial 2 × 2 block (the plot is 1 deep) → demoted to field.
    expect(save.ground).toEqual([['field', 1], ['grass', 1]]);
  });

  it('fails cleanly when a migration produces the wrong version or throws', () => {
    const legacy = { version: 0 };
    expect(parseSave(legacy, { migrations: { 0: (raw) => ({ ...raw, version: 5 }) } })).toBeInstanceOf(Error);
    expect(
      parseSave(legacy, {
        migrations: {
          0: () => {
            throw new Error('bad');
          },
        },
      }),
    ).toBeInstanceOf(Error);
  });
});

describe('parseSave and the WP-23 catalog change (no version bump)', () => {
  it('a version 4 save with a garage (a removed kind) still opens: the garage is dropped, the rest kept', () => {
    const save = {
      ...blank(),
      objects: [
        { id: 1, kind: 'cottage', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 },
        { id: 2, kind: 'garage', anchor: { x: 7, z: 2 }, rotation: 0, variant: 0 },
        { id: 3, kind: 'bench', anchor: { x: 9, z: 2 }, rotation: 0, variant: 0 },
      ],
      edges: [{ kind: 'fence-low', edge: { x: 3, z: 8, side: 'n' } }],
      nextObjectId: 4,
    };
    const parsed = ok(parseSave(JSON.stringify(save)));
    expect(parsed.version).toBe(4);
    expect(parsed.objects.map((o) => o.kind)).toEqual(['cottage', 'bench']);
    expect(parsed.edges).toHaveLength(1);
    const editor = makeEditor();
    editor.load(parsed);
    expect(editor.state.stats()).toMatchObject({ homes: 1, props: 1, fences: 1 });
  });

  it('gates and the new objects round-trip through JSON unchanged', () => {
    const editor = makeEditor();
    const placed = [
      editor.apply({ type: 'place-edge', kind: 'fence-gate', edge: { x: 4, z: 4, side: 'n' } }, 'fence-gate'),
      editor.apply({ type: 'place-object', kind: 'tulips', cell: { x: 6, z: 6 }, rotation: 0 }, 'tulips'),
      editor.apply({ type: 'place-object', kind: 'slide', cell: { x: 8, z: 6 }, rotation: 1 }, 'slide'),
      editor.apply({ type: 'place-object', kind: 'donut-shop', cell: { x: 12, z: 6 }, rotation: 2 }, 'donut-shop'),
    ];
    expect(placed.every((r) => r.ok)).toBe(true);
    const saved = serializeTown(editor.state, camera);
    expect(saved.edges.map((e) => e.kind)).toEqual(['fence-gate']);
    const parsed = ok(parseSave(JSON.stringify(saved)));
    expect(parsed).toEqual(saved);
  });
});
