import { describe, expect, it } from 'vitest';
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createGameBus } from '../game/events';
import { createSeededRandom } from '../utils/random';
import { buildAssetGallery, buildSampleTown, buildStressTown } from './sampleTown';
import { CURRENT_SAVE_VERSION, decodeGround, parseSave, serializeTown, type CameraPose } from './serialize';
import { TownEditor } from './TownEditor';
import { TownState } from './TownState';
import type { SavedTownV1 } from './types';

const makeEditor = (seed = 1) => new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(seed));
const camera: CameraPose = { targetX: 1.5, targetZ: -2, azimuth: 0.7, polar: 0.9, distance: 18 };

function ok(result: SavedTownV1 | Error): SavedTownV1 {
  if (result instanceof Error) throw result;
  return result;
}

/** A minimal valid v1 save for a w×d plot with all-field ground. */
function blank(w = PLOT_WIDTH, d = PLOT_DEPTH): SavedTownV1 {
  return { version: 1, width: w, depth: d, ground: [['field', w * d]], objects: [], edges: [], nextObjectId: 1 };
}

describe('serializeTown', () => {
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
      let result: SavedTownV1 | Error | undefined;
      expect(() => (result = parseSave(input))).not.toThrow();
      expect(result).toBeInstanceOf(Error);
    });
  }

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
    expect(ground.slice(0, 4)).toEqual(['field', 'field', 'field', 'road']);
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
          { id: 2, kind: 'tree-a', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 },
          { id: 3, kind: 'toString', anchor: { x: 3, z: 3 }, rotation: 0, variant: 0 },
        ],
        edges: [
          { kind: 'brick-wall', edge: { x: 1, z: 1, side: 'n' } },
          { kind: 'fence-small', edge: { x: 2, z: 2, side: 'w' } },
        ],
      }),
    );
    expect(save.objects.map((o) => o.kind)).toEqual(['tree-a']);
    expect(save.edges.map((e) => e.kind)).toEqual(['fence-small']);
  });

  it('drops malformed objects (bad id, anchor, rotation) and fixes out-of-range variants', () => {
    const base = { kind: 'tree-c', rotation: 0, variant: 0 };
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
      { id: 5, kind: 'tree-c', anchor: { x: 5, z: 0 }, rotation: 0, variant: 0 },
      { id: 6, kind: 'tree-c', anchor: { x: 6, z: 0 }, rotation: 3, variant: 1 },
    ]);
  });

  it('drops duplicate ids, overlapping objects and objects on disallowed ground', () => {
    const save = ok(
      parseSave({
        ...blank(),
        ground: [['road', 1], ['field', PLOT_WIDTH * PLOT_DEPTH - 1]],
        objects: [
          { id: 1, kind: 'postbox', anchor: { x: 5, z: 5 }, rotation: 0, variant: 0 },
          { id: 1, kind: 'postbox', anchor: { x: 6, z: 5 }, rotation: 0, variant: 0 }, // duplicate id
          { id: 2, kind: 'lamppost', anchor: { x: 5, z: 5 }, rotation: 0, variant: 0 }, // overlaps id 1
          { id: 3, kind: 'townhouse-a', anchor: { x: 0, z: 0 }, rotation: 0, variant: 0 }, // on road
        ],
      }),
    );
    expect(save.objects.map((o) => o.id)).toEqual([1]);
  });

  it('drops invalid, duplicate, out-of-plot and road-crossing edges', () => {
    const save = ok(
      parseSave({
        ...blank(),
        ground: [['road', 2], ['field', PLOT_WIDTH * PLOT_DEPTH - 2]],
        edges: [
          { kind: 'fence-small', edge: { x: 1, z: 0, side: 'w' } }, // between road (0,0) and road (1,0)
          { kind: 'fence-small', edge: { x: 0, z: 0, side: 'n' } }, // border next to road: fine
          { kind: 'fence-tall', edge: { x: 0, z: 0, side: 'n' } }, // duplicate key
          { kind: 'fence-tall', edge: { x: 5, z: 5, side: 'e' } }, // bad side
          { kind: 'fence-tall', edge: { x: PLOT_WIDTH + 1, z: 0, side: 'w' } }, // out of plot
          { kind: 'fence-tall', edge: { x: PLOT_WIDTH, z: 3, side: 'w' } }, // east border: fine
          { kind: 'fence-tall' },
        ],
      }),
    );
    expect(save.edges).toEqual([
      { kind: 'fence-small', edge: { x: 0, z: 0, side: 'n' } },
      { kind: 'fence-tall', edge: { x: PLOT_WIDTH, z: 3, side: 'w' } },
    ]);
  });

  it('clamps a bigger save to the plot (drops what lies outside)', () => {
    const w = PLOT_WIDTH + 6;
    const d = PLOT_DEPTH + 6;
    const ground = Array.from({ length: d }, () => [['grass', w]] as Array<[string, number]>).flat();
    const save = ok(
      parseSave({
        version: 1,
        width: w,
        depth: d,
        ground,
        objects: [
          { id: 1, kind: 'tree-a', anchor: { x: 1, z: 1 }, rotation: 0, variant: 0 },
          { id: 2, kind: 'tree-a', anchor: { x: PLOT_WIDTH + 2, z: 1 }, rotation: 0, variant: 0 },
        ],
        edges: [
          { kind: 'fence-small', edge: { x: 3, z: PLOT_DEPTH, side: 'n' } },
          { kind: 'fence-small', edge: { x: 3, z: PLOT_DEPTH + 2, side: 'n' } },
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

  it('pads a smaller save with field', () => {
    const save = ok(parseSave({ ...blank(10, 10), ground: [['meadow', 100]] }));
    expect([save.width, save.depth]).toEqual([PLOT_WIDTH, PLOT_DEPTH]);
    const ground = decodeGround(save);
    expect(ground[0]).toBe('meadow');
    expect(ground[9]).toBe('meadow');
    expect(ground[10]).toBe('field');
    expect(ground[PLOT_WIDTH * 9 + 9]).toBe('meadow');
    expect(ground[PLOT_WIDTH * 10]).toBe('field');
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
        { id: 3, kind: 'garage', anchor: { x: 1, z: 2 }, rotation: 1, variant: 0 },
        { id: 4, kind: 'garage', anchor: { x: 0, z: 1 }, rotation: 1, variant: 0 },
      ],
      edges: [{ kind: 'fence-small', edge: { x: 3, z: 1, side: 'n' } }],
      nextObjectId: -5,
    };
    const save = ok(parseSave(messy));
    expect(() => makeEditor().load(save)).not.toThrow();
  });
});

describe('migration hook', () => {
  it('runs migrations keyed on the version they upgrade from', () => {
    // Pretend version 0 stored ground as a flat list of kinds.
    const legacy = { version: 0, width: 2, depth: 1, cells: ['road', 'grass'], things: [] };
    const migrations = {
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
    expect(save.ground).toEqual([['road', 1], ['grass', 1]]);
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
