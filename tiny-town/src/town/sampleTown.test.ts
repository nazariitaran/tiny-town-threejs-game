import { describe, expect, it } from 'vitest';
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

  it('asset gallery places every kind and shows each of the 16 road masks exactly', () => {
    const editor = makeEditor();
    expect(buildAssetGallery(editor).rejected).toEqual([]);
    for (let mask = 0; mask < 16; mask += 1) {
      const centre = { x: 1 + (mask % 6) * 4, z: 1 + Math.floor(mask / 6) * 4 };
      expect(roadMask(editor.state, centre), `mask ${mask}`).toBe(mask);
    }
  });

  it('stress town fills the plot', () => {
    const editor = makeEditor();
    const { applied } = buildStressTown(editor);
    expect(applied).toBeGreaterThan(PLOT_WIDTH * PLOT_DEPTH * 0.9);
  });
});
