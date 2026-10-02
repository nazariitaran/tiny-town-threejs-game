/**
 * Parking: one Streets tool with three sizes in the style strip. A car park snaps to the road grid,
 * the road in front of it joins its entrance with a joint piece (no centre line into the lot), and it
 * is a road feature (Move can't carry it).
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SAVE_STORAGE_KEY } from '../src/game/config';
import { createGameBus } from '../src/game/events';
import { roadLook, roadMask } from '../src/town/roadTiles';
import { TownEditor } from '../src/town/TownEditor';
import { TownState } from '../src/town/TownState';
import type { Cell, SavedTown } from '../src/town/types';
import { createSeededRandom } from '../src/utils/random';
import { byId, canvasPoint, diagnostics, dragCells, expectDiagnostics, footprintPoint, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS, type Point } from './helpers';

const ARTIFACTS = 'artifacts/parking';
const ROAD_ROW = 34; // the street along rows 34–35
const MEDIUM: Cell = { x: 28, z: 30 }; // 4 × 4 cells, rows 30–33: its front meets the street
const SMALL: Cell = { x: 34, z: 32 }; // 4 × 2 cells, rows 32–33
const POSTBOX: Cell = { x: 35, z: 30 }; // in the way of a medium lot over SMALL, not of the small one

async function put(page: Page, p: Point, touch: boolean): Promise<void> {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
  }
}

async function savedTown(page: Page): Promise<SavedTown> {
  await expect.poll(async () => (await diagnostics(page)).save.pending, { timeout: 5_000 }).toBe(false);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_STORAGE_KEY);
}

async function pickStyle(page: Page, choice: number): Promise<void> {
  await byId(page, UI_TEST_IDS.variant(choice)).click();
  await expect.poll(async () => (await diagnostics(page)).variant).toEqual({ choice, count: 3 });
}

test('build a small and a medium car park on a street; the street joins their entrances', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const touch = testInfo.project.name.startsWith('mobile');
  mkdirSync(ARTIFACTS, { recursive: true });
  await gotoTitle(page);
  await startBuilding(page);

  await selectTool(page, 'road');
  await dragCells(page, [27, ROAD_ROW], [38, ROAD_ROW]);
  const street = await expectDiagnostics(page, { town: { roadTiles: 7 } }, 'street x 26–39');

  await selectTool(page, 'postbox');
  await put(page, await footprintPoint(page, 'postbox', POSTBOX), touch);
  await expectDiagnostics(page, { objects: 1 }, 'postbox');

  // One card, three styles, starting on the small lot.
  await selectTool(page, 'parking');
  await expect(byId(page, UI_TEST_IDS.tool('parking')).locator('.ui-card-variants i')).toHaveCount(3);
  await expect(byId(page, UI_TEST_IDS.variants).locator('.ui-chip')).toHaveCount(3);
  expect((await diagnostics(page)).variant).toEqual({ choice: 0, count: 3 });

  if (!touch) {
    // Changing the style under a still pointer re-anchors the ghost to the new footprint.
    const over = await footprintPoint(page, 'parking', SMALL, 0, 0);
    await page.mouse.move(over.x, over.y);
    await expect.poll(async () => (await diagnostics(page)).hover?.valid).toBe(true);
    await page.keyboard.press('v');
    await expect.poll(async () => (await diagnostics(page)).variant?.choice).toBe(1);
    await expect.poll(async () => (await diagnostics(page)).hover).toMatchObject({ valid: false, reason: 'Something is already here' });
    await page.keyboard.press('Shift+v');
    await expect.poll(async () => (await diagnostics(page)).hover?.valid).toBe(true);
    await page.keyboard.press('v');
    await page.keyboard.press('v');
    await expect.poll(async () => (await diagnostics(page)).variant?.choice).toBe(2);
    await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-ghost-large.png` });
  }

  await pickStyle(page, 1);
  await put(page, await footprintPoint(page, 'parking', MEDIUM, 0, 1), touch);
  await expectDiagnostics(page, { objects: 2, town: { roadTiles: street.town.roadTiles + 4 } }, 'medium car park');
  await pickStyle(page, 0);
  await put(page, await footprintPoint(page, 'parking', SMALL, 0, 0), touch);
  await expectDiagnostics(page, { objects: 3, town: { roadTiles: street.town.roadTiles + 6 } }, 'small car park');

  // The saved town has both styles; every street block in front of a lot tees into it (N bit).
  const save = await savedTown(page);
  expect(save.objects.filter((o) => o.kind === 'parking').map((o) => [o.anchor, o.variant])).toEqual([[MEDIUM, 1], [SMALL, 0]]);
  const editor = new TownEditor(new TownState(save.width, save.depth), createGameBus(), createSeededRandom(1));
  editor.load(save);
  for (const x of [28, 30, 34, 36]) expect(roadMask(editor.state, { x, z: ROAD_ROW }) & 1, `street block at x ${x}`).toBe(1);
  for (const x of [26, 32, 38]) expect(roadMask(editor.state, { x, z: ROAD_ROW }) & 1, `street block at x ${x}`).toBe(0);

  // The four street blocks in front of the two lots draw car-park joints.
  for (const x of [28, 30, 34, 36]) expect(roadLook(editor.state, { x, z: ROAD_ROW }).model, `street block at x ${x}`).toBe('road-joint-tee-s');
  await expect.poll(async () => (await diagnostics(page)).render.roadJoints).toBe(4);

  const lot = await canvasPoint(page, 31, 31);
  await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-built.png` });

  // A road feature: Move can't pick it up; Bulldoze takes it and its road away.
  await selectTool(page, 'move');
  const invalid = (await diagnostics(page)).invalidCount;
  await put(page, lot, touch);
  await expect.poll(async () => (await diagnostics(page)).invalidCount).toBe(invalid + 1);
  expect((await diagnostics(page)).selection).toBeNull();
  await selectTool(page, 'bulldoze');
  await put(page, lot, touch);
  await expectDiagnostics(page, { objects: 2, town: { roadTiles: street.town.roadTiles + 2 } }, 'medium car park bulldozed');
  // Its two street blocks are plain tees again, and undo brings the joints back.
  await expect.poll(async () => (await diagnostics(page)).render.roadJoints).toBe(2);
  await byId(page, UI_TEST_IDS.undo).click();
  await expectDiagnostics(page, { objects: 3, town: { roadTiles: street.town.roadTiles + 6 } }, 'bulldoze undone');
  await expect.poll(async () => (await diagnostics(page)).render.roadJoints).toBe(4);
  errors.expectNone();
});
