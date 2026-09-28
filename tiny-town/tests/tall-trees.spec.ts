/**
 * Tall trees: the Height button / H key picks a tier (normal · tall · towering) for oak, pine and
 * birch; the tree keeps its one cell and the tier lands in the save. Real input only (dock clicks,
 * mouse / touch at cellToClient); the placed tier is read back from the autosave in localStorage.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SAVE_STORAGE_KEY } from '../src/game/config';
import type { SavedTown } from '../src/town/types';
import { byId, canvasPoint, diagnostics, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS, waitFrames } from './helpers';

const ARTIFACTS = 'artifacts/tall-trees';

async function tap(page: Page, mobile: boolean, x: number, z: number): Promise<void> {
  const p = await canvasPoint(page, x, z);
  if (mobile) await page.touchscreen.tap(p.x, p.y);
  else {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
  }
}

async function savedObjects(page: Page): Promise<SavedTown['objects']> {
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.save.pending === false);
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), SAVE_STORAGE_KEY);
  return (JSON.parse(raw ?? '{"objects":[]}') as SavedTown).objects;
}

test('Height button steps the tier of a tree tool and the tree lands with it (real input)', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const mobile = testInfo.project.name.startsWith('mobile');
  mkdirSync(ARTIFACTS, { recursive: true });
  await gotoTitle(page);
  await page.evaluate((key) => window.localStorage.removeItem(key), SAVE_STORAGE_KEY);
  await startBuilding(page);

  const height = byId(page, UI_TEST_IDS.height);
  const tier = () => height.locator('.ui-tier');

  // No tool, and tools without tiers: Rotate holds the slot and Height is not shown.
  const rotate = byId(page, UI_TEST_IDS.rotate);
  await expect(height).toBeHidden();
  await expect(rotate).toBeVisible();
  await selectTool(page, 'cottage');
  await expect(height).toBeHidden();
  await expect(rotate).toBeVisible();
  expect((await diagnostics(page)).height).toBe(0);

  // A tree tool wakes it up; each press steps the tier and wraps after the third.
  for (const kind of ['pine', 'oak', 'birch'] as const) {
    await selectTool(page, kind);
    await expect(height, kind).toBeVisible();
    await expect(rotate, kind).toBeHidden();
    await expect(tier(), kind).toHaveText('1');
    for (const [presses, expected] of [[1, 1], [1, 2], [1, 0]] as const) {
      for (let i = 0; i < presses; i += 1) await height.click();
      await expect.poll(async () => (await diagnostics(page)).height, `${kind} tier`).toBe(expected);
      await expect(tier(), kind).toHaveText(String(expected + 1));
    }
  }

  // Plant one tree per tier; the bush has no tiers and must not pick one up.
  await selectTool(page, 'pine');
  const cells: Array<[number, number, number]> = [[20, 20, 0], [24, 20, 1], [28, 20, 2]];
  for (const [x, z, want] of cells) {
    // Diagnostics are published per frame: wait for each step instead of looping on a stale read.
    const now = (await diagnostics(page)).height;
    for (let i = now; i !== want; i = (i + 1) % 3) await height.click();
    await expect.poll(async () => (await diagnostics(page)).height).toBe(want);
    await tap(page, mobile, x, z);
  }
  await selectTool(page, 'bush');
  await expect(height).toBeHidden();
  await expect(rotate).toBeVisible();
  expect((await diagnostics(page)).height).toBe(0);
  await tap(page, mobile, 32, 20);
  await waitFrames(page, 4);
  await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-tiers.png` });

  const objects = await savedObjects(page);
  const byX = new Map(objects.map((o) => [o.anchor.x, o]));
  expect(objects, 'three pines and a bush').toHaveLength(4);
  expect(byX.get(20)?.height).toBeUndefined();
  expect(byX.get(24)?.height).toBe(1);
  expect(byX.get(28)?.height).toBe(2);
  expect(byX.get(32)?.kind).toBe('bush');
  expect(byX.get(32)?.height).toBeUndefined();
  // A tall tree is still one cell: its neighbour cell is free, so a normal tree fits right beside it.
  const diag = await diagnostics(page);
  expect(diag.objects).toBe(4);
  expect(diag.render.objects).toBe(4);
  errors.expectNone();
});

test('H / Shift+H step the tier on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'phones have no keyboard');
  await gotoTitle(page);
  await startBuilding(page);
  await selectTool(page, 'birch');
  await page.keyboard.press('KeyH');
  await expect.poll(async () => (await diagnostics(page)).height).toBe(1);
  await page.keyboard.press('Shift+KeyH');
  await page.keyboard.press('Shift+KeyH');
  await expect.poll(async () => (await diagnostics(page)).height).toBe(2);
  // Another tree tool keeps the picked tier; a tool without tiers reports 0 and ignores H.
  await selectTool(page, 'oak');
  expect((await diagnostics(page)).height).toBe(2);
  await selectTool(page, 'lamppost');
  expect((await diagnostics(page)).height).toBe(0);
  await page.keyboard.press('KeyH');
  expect((await diagnostics(page)).height).toBe(0);
});
