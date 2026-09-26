import { describe, expect, it, vi } from 'vitest';
import { TOOLS } from '../catalog/tools';
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createGameBus } from '../game/events';
import { roadMask } from '../render/roadTiles';
import { createSeededRandom } from '../utils/random';
import { buildAssetGallery, buildSampleTown, buildStressTown } from './sampleTown';
import { TownEditor } from './TownEditor';
import { TownState } from './TownState';

const makeEditor = () => new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(1));

describe('demo towns', () => {
  it('sample town builds with zero rejections and one undo entry', () => {
    const editor = makeEditor();
    const result = buildSampleTown(editor);
    expect(result.rejected).toEqual([]);
    expect(editor.state.stats()).toMatchObject({ homes: 5, trees: 5 });
    editor.undo();
    expect([...editor.state.objects()]).toHaveLength(0);
  });

  it('sample town uses every placing tool (all but bulldoze) at least once', () => {
    const editor = makeEditor();
    const spy = vi.spyOn(editor, 'applyBatch');
    buildSampleTown(editor);
    const used = new Set(spy.mock.calls.flatMap(([items]) => items.map((item) => item.toolId)));
    const placing = TOOLS.map((t) => t.id).filter((id) => id !== 'bulldoze');
    expect(placing).toHaveLength(17);
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

  it('asset gallery places every kind and shows each of the 16 road masks exactly', () => {
    const editor = makeEditor();
    expect(buildAssetGallery(editor).rejected).toEqual([]);
    for (let mask = 0; mask < 16; mask += 1) {
      const centre = { x: 1 + (mask % 6) * 4, z: 1 + Math.floor(mask / 6) * 4 };
      expect(roadMask(editor.state, centre), `mask ${mask}`).toBe(mask);
    }
  });

  it('stress town fills the plot with zero rejections', () => {
    const editor = makeEditor();
    const { applied, rejected } = buildStressTown(editor);
    expect(rejected).toEqual([]);
    expect(applied).toBeGreaterThan(PLOT_WIDTH * PLOT_DEPTH * 0.9);
  });
});
