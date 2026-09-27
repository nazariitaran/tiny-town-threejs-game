/**
 * WP-09a build flow: a real-input journey through the core loop, asserting diagnostics at
 * every step: select road → drag a road → place a house → undo → redo → bulldoze.
 * Only real input (dock clicks by UI_TEST_IDS, mouse at cellToClient); no setState.
 */
import { expect, test } from '@playwright/test';
import {
  attachJson,
  byId,
  clickCell,
  diagnostics,
  dragCells,
  expectDiagnostics,
  gotoTitle,
  selectTool,
  startBuilding,
  trackErrors,
  UI_TEST_IDS,
  type Diagnostics,
} from './helpers';

// WP-12 (48×48 half-unit cells, roads in 2×2 blocks): a road along row z=24 from x=16..31
// (8 road blocks), a 3×3 cottage centred on (23, 22) on the verge just north of it (rows 21–23).
const ROAD_FROM: [number, number] = [16, 24];
const ROAD_TO: [number, number] = [31, 24];
const ROAD_TILES = 8;
const HOUSE: [number, number] = [23, 22];
const COTTAGE_RESIDENTS = 2; // objects.ts: townhouse-a residents

test('road → house → undo → redo → bulldoze, through real input', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const trail: Array<{ step: string } & Pick<Diagnostics, 'town' | 'objects' | 'render' | 'history' | 'invalidCount'>> = [];
  const record = async (step: string) => {
    const d = await diagnostics(page);
    trail.push({ step, town: d.town, objects: d.objects, render: d.render, history: d.history, invalidCount: d.invalidCount });
  };

  await gotoTitle(page);
  await startBuilding(page);
  await expectDiagnostics(page, { objects: 0, town: { roadTiles: 0, homes: 0 }, history: { undoDepth: 0 } }, 'empty start');
  const invalidAtStart = (await diagnostics(page)).invalidCount;
  await record('start');

  // 1. Select road and drag one stroke.
  await selectTool(page, 'road');
  await dragCells(page, ROAD_FROM, ROAD_TO);
  await expectDiagnostics(
    page,
    { town: { roadTiles: ROAD_TILES, homes: 0 }, objects: 0, history: { undoDepth: 1, canRedo: false } },
    'road stroke lays 8 tiles as one undo entry',
  );
  await expect(byId(page, UI_TEST_IDS.undo)).toBeEnabled();
  await record('road');

  // 2. Place a cottage next to the road with a single click.
  await selectTool(page, 'townhouse-a');
  await clickCell(page, ...HOUSE);
  await expectDiagnostics(
    page,
    {
      objects: 1,
      render: { objects: 1 },
      town: { homes: 1, residents: COTTAGE_RESIDENTS, roadTiles: ROAD_TILES },
      history: { undoDepth: 2, canRedo: false },
    },
    'cottage placed and rendered',
  );
  await record('house');

  // 3. Undo (dock button) removes the house only.
  await byId(page, UI_TEST_IDS.undo).click();
  await expectDiagnostics(
    page,
    { objects: 0, render: { objects: 0 }, town: { homes: 0, residents: 0, roadTiles: ROAD_TILES }, history: { undoDepth: 1, redoDepth: 1, canRedo: true } },
    'undo removes the cottage, keeps the road',
  );
  await expect(byId(page, UI_TEST_IDS.redo)).toBeEnabled();
  await record('undo');

  // 4. Redo (dock button) brings it back.
  await byId(page, UI_TEST_IDS.redo).click();
  await expectDiagnostics(
    page,
    { objects: 1, render: { objects: 1 }, town: { homes: 1, residents: COTTAGE_RESIDENTS, roadTiles: ROAD_TILES }, history: { undoDepth: 2, redoDepth: 0, canRedo: false } },
    'redo restores the cottage',
  );
  await record('redo');

  // Keyboard shortcuts drive the same history (desktop only: phones have no keyboard).
  if (!testInfo.project.name.startsWith('mobile')) {
    await page.keyboard.press('Control+z');
    await expectDiagnostics(page, { objects: 0, town: { homes: 0 }, history: { canRedo: true } }, 'Ctrl+Z undoes');
    await page.keyboard.press('Control+Shift+z');
    await expectDiagnostics(page, { objects: 1, town: { homes: 1 }, history: { canRedo: false } }, 'Ctrl+Shift+Z redoes');
    await record('keyboard undo/redo');
  }

  // 5. Bulldoze: clicking the house removes the object first (object > edge > ground).
  await selectTool(page, 'bulldoze');
  await clickCell(page, ...HOUSE);
  await expectDiagnostics(
    page,
    { objects: 0, render: { objects: 0 }, town: { homes: 0, residents: 0, roadTiles: ROAD_TILES }, history: { undoDepth: 3 } },
    'bulldoze removes the cottage, not the road',
  );
  await record('bulldoze house');

  // 6. Bulldoze-drag half the road in one stroke.
  await dragCells(page, [16, 24], [23, 24]);
  await expectDiagnostics(page, { town: { roadTiles: ROAD_TILES - 4 }, history: { undoDepth: 4 } }, 'bulldoze drag clears 4 road tiles');
  await record('bulldoze road');

  // That stroke undoes as one entry.
  await byId(page, UI_TEST_IDS.undo).click();
  await expectDiagnostics(page, { town: { roadTiles: ROAD_TILES }, objects: 0, history: { undoDepth: 3, canRedo: true } }, 'undo restores the road');
  await record('undo bulldoze');

  const end = await diagnostics(page);
  expect(end.render.objects, 'renderer matches TownState').toBe(end.objects);
  expect(end.invalidCount - invalidAtStart, 'no invalid placements in a valid journey').toBe(0);

  await attachJson(testInfo, `${testInfo.project.name}-build-flow`, trail);
  await testInfo.attach(`${testInfo.project.name}-build-flow-end`, { body: await page.screenshot(), contentType: 'image/png' });
  errors.expectNone();
});
