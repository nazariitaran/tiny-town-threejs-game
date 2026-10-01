/** Frame budget and the on-demand shadow map, through real input and diagnostics `perf`. */
import { expect, test, type Page } from '@playwright/test';
import { applyState, clickCell, diagnostics, selectTool, trackErrors, gotoTitle, waitFrames } from './helpers';

/** An empty cell in the middle of the plot (the empty-build camera frames the whole plot). */
const TREE: [number, number] = [32, 30];
const PARK: [number, number] = [40, 36];

async function perf(page: Page) {
  return (await diagnostics(page)).perf;
}

async function parkPointer(page: Page): Promise<void> {
  const p = await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(x, z), PARK);
  await page.mouse.move(p.x, p.y);
}

test('idle frame cap and on-demand shadow map', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  await gotoTitle(page);
  // A test state: no cars (no roads) and no spontaneous flocks, so nothing moves that casts.
  await applyState(page, 'empty-build');
  await parkPointer(page);

  await expect.poll(async () => (await perf(page)).idle, { timeout: 15_000, message: 'idles without input' }).toBe(true);
  expect((await perf(page)).targetFps).toBe(30);

  const still = (await perf(page)).shadowRenders;
  await waitFrames(page, 20);
  expect((await perf(page)).shadowRenders, 'a still town never redraws the shadow map').toBe(still);

  await page.keyboard.press('Shift');
  // Diagnostics are published per frame: the next frame reports the active cap.
  await expect.poll(async () => (await perf(page)).targetFps, { message: 'input restores the active cap' }).toBe(60);
  expect((await perf(page)).idle).toBe(false);

  await selectTool(page, 'pine');
  const before = (await perf(page)).shadowRenders;
  await clickCell(page, ...TREE);
  await expect.poll(async () => (await diagnostics(page)).objects, { message: 'the tree is placed' }).toBe(1);
  await expect.poll(async () => (await perf(page)).shadowRenders, { message: 'placing redraws the shadow map' }).toBeGreaterThan(before);
  errors.expectNone();
});

test.describe('Retina screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test('Medium (the default preset) renders at DPR 1.5', async ({ page }) => {
    await gotoTitle(page);
    await applyState(page, 'empty-build');
    await waitFrames(page, 2);
    const { canvas, quality } = await diagnostics(page);
    expect(canvas.dpr, `${quality} tier`).toBe(1.5);
    expect(canvas.width).toBe(Math.floor(canvas.clientWidth * 1.5));
  });
});
