/**
 * WP-23 acceptance: the new build items place from the dock with real clicks, the removed garage is
 * gone from the dock, and tools past the ninth in a category show no digit badge.
 * State is read from __THREE_GAME_DIAGNOSTICS__ (desktop + mobile projects).
 */
import { expect, test, type Page } from '@playwright/test';
import type { ObjectKind } from '../src/town/types';
import { toolsInCategory } from '../src/catalog/tools';
import { byId, canvasPoint, clickFootprint, diagnostics, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS } from './helpers';

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

async function northEdgePoint(page: Page, x: number, z: number) {
  const a = await canvasPoint(page, x, z - 1);
  const b = await canvasPoint(page, x, z);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

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

  // The gate is an edge piece: one click on a cell edge puts one in.
  await selectTool(page, 'fence-gate');
  const edge = await northEdgePoint(page, 34, 32);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await diagnostics(page)).town.fences).toBe(1);
  expect((await diagnostics(page)).render.edges).toBe(1);
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
