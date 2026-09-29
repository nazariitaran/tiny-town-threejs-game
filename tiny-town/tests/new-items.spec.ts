/**
 * WP-23 acceptance: the new build items place from the dock with real clicks, the removed garage (and,
 * after the owner's review, the gate) is gone from the dock, the pool is in Garden, and tools past the
 * ninth in a category show no digit badge.
 * State is read from __THREE_GAME_DIAGNOSTICS__ (desktop + mobile projects).
 */
import { expect, test } from '@playwright/test';
import type { ObjectKind } from '../src/town/types';
import { toolsInCategory } from '../src/catalog/tools';
import { byId, clickFootprint, diagnostics, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS } from './helpers';

/** Near the plot centre (32, 32), so every spot is on screen on a phone as well. */
const OBJECTS: ReadonlyArray<[ObjectKind, number, number]> = [
  ['mailbox', 26, 28],
  ['tiered-fountain', 28, 28],
  ['donut-shop', 32, 28],
  ['tulips', 36, 28],
  ['long-bench', 26, 32],
  ['garden-table', 28, 32],
  ['slide', 30, 32],
];

test('the new items place from the dock, and the garage is gone', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await expect(byId(page, UI_TEST_IDS.category('homes'))).toBeVisible();
  await byId(page, UI_TEST_IDS.category('homes')).click();
  await expect(page.locator('[data-tool="garage"]')).toHaveCount(0);

  let count = (await diagnostics(page)).objects;
  for (const [kind, x, z] of OBJECTS) {
    await selectTool(page, kind);
    await clickFootprint(page, kind, { x, z });
    await expect.poll(async () => (await diagnostics(page)).objects, kind).toBe(count + 1);
    count += 1;
  }
  expect((await diagnostics(page)).render.objects).toBe(count);
  // The gate was removed at the owner's review; the pool moved to Garden.
  await byId(page, UI_TEST_IDS.category('garden')).click();
  await expect(page.locator('[data-tool="fence-gate"]')).toHaveCount(0);
  await expect(byId(page, UI_TEST_IDS.tool('swimming-pool'))).toBeVisible();
  errors.expectNone();
});

test('digit badges stop at 9: the Garden tray has 12 tools and the last three have none', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await byId(page, UI_TEST_IDS.category('garden')).click();
  const garden = toolsInCategory('garden');
  expect(garden).toHaveLength(12);
  for (const [i, tool] of garden.entries()) {
    const badge = byId(page, UI_TEST_IDS.tool(tool.id)).locator('kbd');
    if (i < 9) await expect(badge, tool.id).toHaveText(String(i + 1));
    else await expect(badge, tool.id).toHaveCount(0);
  }
  // Digit 9 still selects the ninth Garden tool (the table).
  await page.keyboard.press('9');
  await expect.poll(async () => (await diagnostics(page)).tool).toBe(garden[8].id);
  // A tool past the ninth is reached by clicking (the tray scrolls it into view).
  await selectTool(page, 'slide');
  errors.expectNone();
});
