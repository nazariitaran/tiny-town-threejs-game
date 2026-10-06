import { expect, test } from '@playwright/test';
import { toolsInCategory } from '../src/catalog/tools';
import { ducksForPond } from '../src/life/DuckSim';
import { byId, clickCell, diagnostics, dragCells, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS } from './helpers';

/** Rows of the pond the test digs: x 27–32 on z 27–30 (24 cells), near the plot centre so every cell is on screen. */
const POND_X: readonly [number, number] = [27, 32];
const POND_Z: readonly [number, number] = [27, 30];
const POND_CELLS = (POND_X[1] - POND_X[0] + 1) * (POND_Z[1] - POND_Z[0] + 1);

test('dig a pond, plant it, float a bird house, and ducks arrive for its size', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);

  await selectTool(page, 'pond');
  for (let z = POND_Z[0]; z <= POND_Z[1]; z += 1) await dragCells(page, [POND_X[0], z], [POND_X[1], z]);
  await expect.poll(async () => (await diagnostics(page)).render.groundTiles).toBe(POND_CELLS);
  await expect.poll(async () => (await diagnostics(page)).ducks?.ducks).toBe(ducksForPond(POND_CELLS));
  expect((await diagnostics(page)).ducks?.ponds).toBe(1);

  // Pond plants refuse dry land and take the water.
  await selectTool(page, 'lily-pads');
  const invalid = (await diagnostics(page)).invalidCount;
  await clickCell(page, 24, 24);
  await expect.poll(async () => (await diagnostics(page)).invalidCount).toBe(invalid + 1);
  await expect(byId(page, UI_TEST_IDS.tooltip)).toContainText('Lily pads must go in a pond');
  await clickCell(page, 28, 28);
  await expect.poll(async () => (await diagnostics(page)).objects).toBe(1);

  await selectTool(page, 'reeds');
  await dragCells(page, [27, 30], [29, 30]);
  await expect.poll(async () => (await diagnostics(page)).objects).toBe(4);

  await selectTool(page, 'bird-house');
  await clickCell(page, 31, 28);
  await expect.poll(async () => (await diagnostics(page)).objects).toBe(5);
  expect((await diagnostics(page)).render.objects).toBe(5);

  // Nothing else goes in the water.
  await selectTool(page, 'pine');
  await clickCell(page, 30, 29);
  await expect(byId(page, UI_TEST_IDS.tooltip)).toContainText("Pine can't go in a pond");

  // Filling the pond in sends the ducks away.
  await selectTool(page, 'bulldoze');
  for (let z = POND_Z[0]; z <= POND_Z[1]; z += 1) await dragCells(page, [POND_X[0], z], [POND_X[1], z]);
  await expect.poll(async () => (await diagnostics(page)).ducks?.ducks).toBe(0);
  errors.expectNone();
});

test('the tray shows arrows when its cards overflow, and they scroll it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 900, height: 640 });
  await gotoTitle(page);
  await startBuilding(page);
  await byId(page, UI_TEST_IDS.category('nature')).click();
  const prev = byId(page, UI_TEST_IDS.trayPrev);
  const next = byId(page, UI_TEST_IDS.trayNext);
  const last = byId(page, UI_TEST_IDS.tool(toolsInCategory('nature').at(-1)!.id));
  await expect(prev).toBeHidden();
  await expect(next).toBeVisible();
  await expect(last).not.toBeInViewport({ ratio: 0.9 });

  await next.click();
  await expect(last).toBeInViewport({ ratio: 0.9 });
  await expect(prev).toBeVisible();
  await expect(next).toBeHidden();

  await prev.click();
  await expect(next).toBeVisible();
  await expect(prev).toBeHidden();
  await expect(byId(page, UI_TEST_IDS.tool('grass'))).toBeInViewport({ ratio: 0.9 });

  // A short tray (Streets) fits and has no arrows.
  await byId(page, UI_TEST_IDS.category('streets')).click();
  await expect(prev).toBeHidden();
  await expect(next).toBeHidden();
  errors.expectNone();
});
