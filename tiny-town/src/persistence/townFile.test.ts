import { describe, expect, it } from 'vitest';
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createGameBus } from '../game/events';
import { buildSampleTown } from '../town/sampleTown';
import { TownEditor } from '../town/TownEditor';
import { TownState } from '../town/TownState';
import type { SavedTown } from '../town/types';
import { createSeededRandom } from '../utils/random';
import { decodeTownFile, encodeTownFile, TOWN_FILE_ERRORS, TOWN_FILE_MAX_BYTES, townFileName, type DecodedTownFile } from './townFile';

const camera = { targetX: 1.5, targetZ: -2, azimuth: 0.7, polar: 0.9, distance: 18 };

function sampleSave(): SavedTown {
  const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(7));
  buildSampleTown(editor);
  editor.rename('Bumbleford');
  return editor.serialize(camera);
}

function ok(result: DecodedTownFile | Error): DecodedTownFile {
  if (result instanceof Error) throw result;
  return result;
}

const message = (result: DecodedTownFile | Error) => (result instanceof Error ? result.message : 'decoded');

describe('town files', () => {
  it('round-trip the whole town: objects, ground, edges, name and camera', () => {
    const save = sampleSave();
    const when = new Date(Date.UTC(2026, 8, 29, 14, 32));
    const text = encodeTownFile(save, when);
    const file = JSON.parse(text);
    expect(file).toMatchObject({ app: 'tiny-town', kind: 'town', format: 1, exportedAt: '2026-09-29T14:32:00.000Z' });
    const decoded = ok(decodeTownFile(text));
    expect(decoded.town).toEqual(save);
    expect(decoded.town.name).toBe('Bumbleford');
    expect(decoded.town.camera).toEqual(camera);
    expect(decoded.exportedAt?.toISOString()).toBe('2026-09-29T14:32:00.000Z');
  });

  it('open a bare save (what the game keeps in localStorage) too', () => {
    const save = sampleSave();
    const decoded = ok(decodeTownFile(JSON.stringify(save)));
    expect(decoded.town).toEqual(save);
    expect(decoded.exportedAt).toBeNull();
  });

  it("refuse what isn't a town file", () => {
    expect(message(decodeTownFile('not json'))).toBe(TOWN_FILE_ERRORS.notTown);
    expect(message(decodeTownFile('[1, 2]'))).toBe(TOWN_FILE_ERRORS.notTown);
    expect(message(decodeTownFile('{"hello": "world"}'))).toBe(TOWN_FILE_ERRORS.notTown);
    const file = JSON.parse(encodeTownFile(sampleSave(), new Date()));
    expect(message(decodeTownFile(JSON.stringify({ ...file, app: 'other-game' })))).toBe(TOWN_FILE_ERRORS.notTown);
    expect(message(decodeTownFile(JSON.stringify({ ...file, kind: 'photo' })))).toBe(TOWN_FILE_ERRORS.notTown);
    expect(message(decodeTownFile(JSON.stringify({ ...file, town: { ...file.town, ground: 'x' } })))).toBe(TOWN_FILE_ERRORS.notTown);
  });

  it('tell newer and older versions apart', () => {
    const file = JSON.parse(encodeTownFile(sampleSave(), new Date()));
    expect(message(decodeTownFile(JSON.stringify({ ...file, town: { ...file.town, version: 5 } })))).toBe(TOWN_FILE_ERRORS.newer);
    expect(message(decodeTownFile(JSON.stringify({ ...file, format: 2 })))).toBe(TOWN_FILE_ERRORS.newer);
    expect(message(decodeTownFile(JSON.stringify({ ...file, town: { ...file.town, version: 3 } })))).toBe(TOWN_FILE_ERRORS.older);
  });

  it('refuse a file over the size limit before parsing it', () => {
    expect(message(decodeTownFile(' '.repeat(TOWN_FILE_MAX_BYTES + 1)))).toBe(TOWN_FILE_ERRORS.tooBig);
  });

  it('centre a town from a smaller plot, like the autosave does', () => {
    const small: SavedTown = { version: 4, width: 48, depth: 48, ground: [['field', 48 * 48]], objects: [], edges: [], nextObjectId: 1, name: 'Little' };
    const decoded = ok(decodeTownFile(JSON.stringify(small)));
    expect([decoded.town.width, decoded.town.depth]).toEqual([PLOT_WIDTH, PLOT_DEPTH]);
    expect(decoded.town.name).toBe('Little');
  });

  it('ignore a bad exportedAt', () => {
    const file = JSON.parse(encodeTownFile(sampleSave(), new Date()));
    expect(ok(decodeTownFile(JSON.stringify({ ...file, exportedAt: 'yesterday' }))).exportedAt).toBeNull();
  });

  it('are named after the town, like the photo', () => {
    expect(townFileName('Bumbleford', new Date(2026, 8, 29, 14, 32))).toBe('bumbleford-2026-09-29-1432.tinytown.json');
    expect(townFileName('東京', new Date(2026, 0, 5, 7, 3))).toBe('tiny-town-2026-01-05-0703.tinytown.json');
  });
});
