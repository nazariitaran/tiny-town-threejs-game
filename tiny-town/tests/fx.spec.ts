/**
 * WP-08 Feel & VFX checks, through real input (dock clicks, mouse at cellToClient) and diagnostics.
 *  1. Journey video (recordVideo): road stroke → house → tree → bulldoze the house. Every step
 *     must spawn particles; the video is attached and copied to artifacts/wp-08/fx-journey.webm.
 *  2. FX draw calls ≤ 3: renderer.calls with a live house burst (sim paused) minus renderer.calls
 *     after reduced motion clears the FX must equal the FX layer's own count, and be ≤ 3.
 *  3. setReducedMotion(true) hides particles and freezes wind sway: two canvas captures 700 ms apart
 *     (simulation NOT paused) are pixel-identical. With motion on, the same captures differ.
 *
 * FX counters come from `__THREE_GAME_DIAGNOSTICS__.fx` (published by Game).
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { FxDiagnostics } from '../src/fx/PlacementFx';
import { attachJson, clickCell, diagnostics, dragCells, gotoTitle, selectTool, startBuilding, trackErrors, waitFrames } from './helpers';

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/wp-08');

const ROAD_FROM: [number, number] = [8, 12];
const ROAD_TO: [number, number] = [15, 12];
const HOUSE: [number, number] = [11, 11];
const TREE: [number, number] = [13, 10];
/** An empty cell to park the pointer on so the ghost/tooltip don't cover the effects. */
const PARK: [number, number] = [18, 8];

async function fx(page: Page): Promise<FxDiagnostics> {
  const value = await page.evaluate(() => {
    const published = (window.__THREE_GAME_DIAGNOSTICS__ as unknown as { fx?: FxDiagnostics } | undefined)?.fx;
    return published ?? null;
  });
  if (!value) throw new Error('FX diagnostics are not published');
  return { ...value };
}

async function parkPointer(page: Page): Promise<void> {
  const p = await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(x, z), PARK);
  await page.mouse.move(p.x, p.y);
}

async function waitFxIdle(page: Page): Promise<void> {
  await expect.poll(async () => (await fx(page)).active, { timeout: 5_000, message: 'FX settle to idle' }).toBe(0);
}

/** Wait until an action spawned particles; returns the peak drawCalls seen while polling. */
async function expectBurst(page: Page, spawnedBefore: number, label: string): Promise<FxDiagnostics> {
  await expect.poll(async () => (await fx(page)).spawned, { message: `${label}: particles spawned` }).toBeGreaterThan(spawnedBefore);
  const now = await fx(page);
  expect(now.active, `${label}: particles alive`).toBeGreaterThan(0);
  return now;
}

function diffPixels(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return Number.POSITIVE_INFINITY;
  let diff = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    if (pa.data[i] !== pb.data[i] || pa.data[i + 1] !== pb.data[i + 1] || pa.data[i + 2] !== pb.data[i + 2]) diff += 1;
  }
  return diff;
}

test('FX journey video: road, house, tree, bulldoze — and FX draw calls ≤ 3', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'the recorded journey runs once, on desktop');
  test.setTimeout(60_000);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: testInfo.outputPath('video'), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const trail: Array<{ step: string; fx: FxDiagnostics; calls: number; objects: number }> = [];
  const record = async (step: string) => {
    const d = await diagnostics(page);
    trail.push({ step, fx: await fx(page), calls: d.renderer.calls, objects: d.objects });
  };

  await gotoTitle(page);
  await startBuilding(page);
  await waitFrames(page, 10);
  const idle = await fx(page);
  expect(idle.active).toBe(0);
  expect(idle.drawCalls).toBe(0);
  expect(idle.windStrength).toBeGreaterThan(0);
  await record('start (idle)');

  // 1. Road stroke: small kerb-level dust per tile.
  await selectTool(page, 'road');
  let before = (await fx(page)).spawned;
  await dragCells(page, ROAD_FROM, ROAD_TO);
  await parkPointer(page);
  await expectBurst(page, before, 'road stroke');
  await record('road stroke');
  await page.waitForTimeout(700);
  await waitFxIdle(page);

  // 2. House: wide dust ring + chips + sparkle ring. Measure FX draw calls on this burst.
  await selectTool(page, 'townhouse-a');
  before = (await fx(page)).spawned;
  await clickCell(page, ...HOUSE);
  await parkPointer(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(true));
  await waitFrames(page, 3);
  const withFx = await fx(page);
  const callsWithFx = (await diagnostics(page)).renderer.calls;
  expect(withFx.spawned, 'house spawned particles').toBeGreaterThan(before);
  expect(withFx.drawCalls, 'house burst uses all three FX meshes (dust, chips, sparkles)').toBe(3);
  await testInfo.attach('house-burst', { body: await page.screenshot(), contentType: 'image/png' });
  // Reduced motion clears the FX and re-renders immediately; the call delta is the FX cost.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
  const callsWithoutFx = (await diagnostics(page)).renderer.calls;
  const cleared = await fx(page);
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(false);
    window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(false);
  });
  const fxCalls = { callsWithFx, callsWithoutFx, delta: callsWithFx - callsWithoutFx, fxReported: withFx.drawCalls, afterClear: cleared.drawCalls };
  await attachJson(testInfo, 'fx-draw-calls', fxCalls);
  expect(cleared.drawCalls).toBe(0);
  expect(fxCalls.delta, 'renderer.calls delta equals the FX layer count').toBe(withFx.drawCalls);
  expect(fxCalls.delta, 'FX draw calls budget').toBeLessThanOrEqual(3);
  await record('house (then cleared by reduced motion)');

  // Place a second house with motion on so the video shows the full burst.
  before = (await fx(page)).spawned;
  await clickCell(page, 13, 11);
  await parkPointer(page);
  await expectBurst(page, before, 'second house');
  await record('second house');
  await page.waitForTimeout(900);
  await waitFxIdle(page);

  // 3. Tree: leaf burst.
  await selectTool(page, 'tree-a');
  before = (await fx(page)).spawned;
  await clickCell(page, ...TREE);
  await parkPointer(page);
  await expectBurst(page, before, 'tree');
  await record('tree');
  await page.waitForTimeout(1_000);
  await waitFxIdle(page);

  // 4. Bulldoze the first house: poof + debris.
  await selectTool(page, 'bulldoze');
  const objectsBefore = (await diagnostics(page)).objects;
  before = (await fx(page)).spawned;
  await clickCell(page, ...HOUSE);
  await parkPointer(page);
  const poof = await expectBurst(page, before, 'bulldoze');
  expect(poof.drawCalls).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await diagnostics(page)).objects).toBe(objectsBefore - 1);
  await record('bulldoze house');
  await page.waitForTimeout(1_200);
  await waitFxIdle(page);
  const end = await fx(page);
  expect(end.drawCalls, 'idle FX issue no draw calls').toBe(0);
  expect(end.dropped, 'no pool overflow').toBe(0);
  await record('end (idle)');

  const peak = Math.max(...trail.map((t) => t.fx.drawCalls));
  expect(peak).toBeLessThanOrEqual(3);
  await attachJson(testInfo, 'fx-trail', trail);
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(resolve(ARTIFACTS, 'fx-journey.json'), JSON.stringify({ fxCalls, trail }, null, 2));
  errors.expectNone();

  const video = page.video();
  await context.close();
  if (video) {
    const path = await video.path();
    mkdirSync(ARTIFACTS, { recursive: true });
    copyFileSync(path, resolve(ARTIFACTS, 'fx-journey.webm'));
    await testInfo.attach('fx-journey', { path, contentType: 'video/webm' });
  }
});

test('reduced motion hides particles and freezes wind sway (stable captures)', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.hideDebugUi(true));
  const canvas = page.locator('#game-canvas');

  // Real input: a wildflower strip and a row of trees, so there is foliage to sway.
  await selectTool(page, 'meadow');
  await dragCells(page, [10, 9], [13, 9]);
  await selectTool(page, 'tree-a');
  for (const x of [10, 11, 12]) await clickCell(page, x, 8);
  await page.keyboard.press('Escape'); // no tool ⇒ no ghost in the captures
  await parkPointer(page);
  await waitFxIdle(page);

  // Control: with motion on, the foliage (and clouds) move between captures.
  await page.waitForTimeout(1_000);
  const moving1 = await canvas.screenshot();
  await page.waitForTimeout(700);
  const moving2 = await canvas.screenshot();
  const movingDiff = diffPixels(moving1, moving2);

  // A real placement right before enabling reduced motion: its burst must vanish.
  await selectTool(page, 'tree-a');
  const before = (await fx(page)).spawned;
  await clickCell(page, 11, 10);
  await page.keyboard.press('Escape');
  await parkPointer(page);
  await expect.poll(async () => (await fx(page)).spawned).toBeGreaterThan(before);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
  const reduced = await fx(page);
  expect(reduced.reducedMotion).toBe(true);
  expect(reduced.active, 'particles hidden').toBe(0);
  expect(reduced.drawCalls).toBe(0);
  expect(reduced.windStrength, 'foliage at rest pose').toBe(0);

  // Simulation keeps running (not paused): nothing may move. Let non-FX UI settle first (the
  // stats count-up and the hover-cell fade run on real time, not the animation delta) and hide
  // the DOM overlay so the captures compare the 3D view only.
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.waitForTimeout(1_000);
  await waitFrames(page, 20);
  const still1 = await canvas.screenshot();
  const windTime1 = (await fx(page)).windTime;
  await page.waitForTimeout(700);
  await waitFrames(page, 10);
  const still2 = await canvas.screenshot();
  const later = await fx(page);
  const stillDiff = diffPixels(still1, still2);

  // A placement while reduced motion is on spawns nothing.
  await page.addStyleTag({ content: '#ui-root { visibility: visible !important; }' });
  await selectTool(page, 'tree-a');
  const spawnedBefore = later.spawned;
  await clickCell(page, 12, 10);
  await waitFrames(page, 5);
  const afterPlace = await fx(page);

  const report = {
    movingDiffPixels: movingDiff,
    reducedMotionDiffPixels: stillDiff,
    windTime: [windTime1, later.windTime],
    spawnedWhileReduced: afterPlace.spawned - spawnedBefore,
  };
  await attachJson(testInfo, `${testInfo.project.name}-reduced-motion`, report);
  await testInfo.attach(`${testInfo.project.name}-reduced-a`, { body: still1, contentType: 'image/png' });
  await testInfo.attach(`${testInfo.project.name}-reduced-b`, { body: still2, contentType: 'image/png' });
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(resolve(ARTIFACTS, `${testInfo.project.name}-reduced-motion-a.png`), still1);
  writeFileSync(resolve(ARTIFACTS, `${testInfo.project.name}-reduced-motion-b.png`), still2);
  writeFileSync(resolve(ARTIFACTS, `${testInfo.project.name}-reduced-motion.json`), JSON.stringify(report, null, 2));

  expect(movingDiff, 'with motion on, sway/clouds change pixels').toBeGreaterThan(0);
  expect(later.windTime, 'wind clock frozen').toBe(windTime1);
  expect(stillDiff, 'reduced-motion captures are pixel-identical').toBe(0);
  expect(afterPlace.spawned - spawnedBefore, 'no spawns under reduced motion').toBe(0);
  expect(afterPlace.active).toBe(0);

  // Motion resumes and the breeze eases back in.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(false));
  await expect.poll(async () => (await fx(page)).windStrength).toBeGreaterThan(0.5);
  errors.expectNone();
});
