import { describe, expect, it, vi } from 'vitest';
import { TOOLS } from '../catalog/tools';
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createGameBus } from '../game/events';
import { roadMask } from './roadTiles';
import { createSeededRandom } from '../utils/random';
import { OBJECT_KINDS, OBJECTS } from '../catalog/objects';
import { buildAssetGallery, buildSampleTown, buildStressTown, demoOffset, GALLERY_OBJECTS, galleryMaskBlock } from './sampleTown';
import { TownEditor } from './TownEditor';
import { TownState } from './TownState';

/** The 48 × 48 demo layouts sit centred on the plot. */
const O = demoOffset(PLOT_WIDTH);

const makeEditor = () => new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(1));

describe('demo towns', () => {
  it('sample town builds with zero rejections and one undo entry', () => {
    const editor = makeEditor();
    const result = buildSampleTown(editor);
    expect(result.rejected).toEqual([]);
    expect(editor.state.stats()).toMatchObject({ homes: 8, amenities: 9, trees: 5 });
    const kinds = [...editor.state.objects()].map((o) => o.kind);
    for (const kind of ['cottage', 'townhouse', 'bungalow', 'family-home', 'garage-house', 'big-house', 'corner-shop', 'supermarket', 'church'] as const) expect(kinds, kind).toContain(kind);
    editor.undo();
    expect([...editor.state.objects()]).toHaveLength(0);
  });

  it('sample town uses every placing tool (all but the Move and Bulldoze modes) at least once', () => {
    const editor = makeEditor();
    const spy = vi.spyOn(editor, 'applyBatch');
    buildSampleTown(editor);
    const used = new Set(spy.mock.calls.flatMap(([items]) => items.map((item) => item.toolId)));
    const placing = TOOLS.filter((t) => t.category !== 'mode').map((t) => t.id);
    expect(placing).toHaveLength(41);
    expect(placing.filter((id) => !used.has(id))).toEqual([]);
  });

  it('demo towns are silent (no build:* events) and publish one town:changed each', () => {
    for (const build of [buildSampleTown, buildAssetGallery, buildStressTown]) {
      const bus = createGameBus();
      const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), bus, createSeededRandom(1));
      const seen: string[] = [];
      bus.on('build:placed', () => seen.push('placed'));
      bus.on('build:removed', () => seen.push('removed'));
      bus.on('town:changed', () => seen.push('changed'));
      build(editor);
      expect(seen).toEqual(['changed']);
      expect(editor.history.undoDepth).toBe(1);
    }
  });

  it('asset gallery places every kind and shows each of the 16 road block masks exactly', () => {
    const editor = makeEditor();
    expect(buildAssetGallery(editor).rejected).toEqual([]);
    const kinds = new Set([...editor.state.objects()].map((o) => o.kind));
    expect(kinds).toEqual(new Set(OBJECT_KINDS));
    expect(kinds.size).toBe(35);
    expect(new Set(GALLERY_OBJECTS.map(([kind]) => kind)).size).toBe(OBJECT_KINDS.length);
    // Every style of the car park, each joined to the road in front of it.
    const lots = [...editor.state.objects()].filter((o) => o.kind === 'parking');
    expect(lots.map((o) => o.variant)).toEqual([0, 1, 2]);
    for (const lot of lots) {
      const [, d] = OBJECTS.parking.footprints![lot.variant];
      expect(roadMask(editor.state, { x: lot.anchor.x, z: lot.anchor.z + d }) & 1, `style ${lot.variant}`).toBe(1);
    }
    for (let mask = 0; mask < 16; mask += 1) {
      const block = galleryMaskBlock(mask);
      const centre = { x: block.x + O, z: block.z + O };
      expect(centre.x % 2 === 0 && centre.z % 2 === 0).toBe(true);
      expect(editor.state.getGround(centre)).toBe('road');
      // Any cell of the block reports the block's mask.
      expect(roadMask(editor.state, centre), `mask ${mask}`).toBe(mask);
      expect(roadMask(editor.state, { x: centre.x + 1, z: centre.z + 1 }), `mask ${mask} (other cell)`).toBe(mask);
    }
  });

  it('stress town fills the plot with zero rejections (100 homes, 50 mailboxes)', () => {
    const editor = makeEditor();
    const { rejected } = buildStressTown(editor);
    expect(rejected).toEqual([]);
    const objects = [...editor.state.objects()];
    const count = (kind: string) => objects.filter((o) => o.kind === kind).length;
    // 64 × 64: 5 × 5 lot blocks (the leftover 4-cell strips east and south hold a road and field).
    expect(editor.state.stats().homes).toBe(100);
    expect(count('mailbox')).toBe(50);
    expect(count('garage-house')).toBe(50);
    expect(count('cottage')).toBe(25);
    expect(count('townhouse')).toBe(25);
    expect(count('family-home')).toBe(0);
    // Nearly every cell is used: road, pavement, lawn or an object.
    let used = 0;
    for (let z = 0; z < PLOT_DEPTH; z += 1) for (let x = 0; x < PLOT_WIDTH; x += 1) if (editor.state.getGround({ x, z }) !== 'field' || editor.state.getObjectAt({ x, z })) used += 1;
    expect(used).toBeGreaterThan(PLOT_WIDTH * PLOT_DEPTH * 0.9);
  });

  it('sample town has a roundabout where the main and side streets meet', () => {
    const editor = makeEditor();
    buildSampleTown(editor);
    const roundabouts = [...editor.state.objects()].filter((o) => o.kind === 'roundabout');
    expect(roundabouts.map((o) => o.anchor)).toEqual([{ x: 20 + O, z: 22 + O }]);
    // Streets arrive at all four arms (middle block of each side).
    for (const [x, z] of [[22, 20], [26, 24], [22, 28], [18, 24]]) expect(editor.state.getGround({ x: x + O, z: z + O })).toBe('road');
  });

  it('every demo town keeps roads in whole aligned 2 × 2 blocks', () => {
    for (const build of [buildSampleTown, buildAssetGallery, buildStressTown]) {
      const editor = makeEditor();
      build(editor);
      for (let z = 0; z < PLOT_DEPTH; z += 2) {
        for (let x = 0; x < PLOT_WIDTH; x += 2) {
          const roads = [editor.state.getGround({ x, z }), editor.state.getGround({ x: x + 1, z }), editor.state.getGround({ x, z: z + 1 }), editor.state.getGround({ x: x + 1, z: z + 1 })].filter((g) => g === 'road').length;
          expect(roads === 0 || roads === 4, `block ${x},${z}`).toBe(true);
        }
      }
    }
  });
});
