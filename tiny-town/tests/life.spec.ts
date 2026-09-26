/**
 * WP-10 Ambient life checks (cars on roads), through diagnostics and real input.
 *  1. 10 s video of cars driving the sample-town roads (desktop, zoomed in with the real mouse
 *     wheel). Every sampled car position is on a road cell, cars really move, and the video is
 *     copied to artifacts/wp-10/cars-sample-town.webm.
 *  2. Bulldozing the road under a car (real dock click + real canvas click) removes exactly that
 *     car, and every remaining car is still on a road cell. Cars are frozen with reduced motion
 *     first so the car can't drive off the cell between reading it and clicking.
 *  3. Draw calls: renderer.calls with cars shown minus with cars hidden (lil-gui `Life › cars
 *     visible`, ?debug) must be ≤ 6 and equal the layer's own drawCalls figure; main + shadow
 *     pass together (the shadow pass isn't in renderer.calls) must also be ≤ 6.
 *  4. Determinism + reduced motion: the same seed/state gives the same cars; with reduced motion
 *     the cars don't move.
 *
 * Life diagnostics come from `__THREE_GAME_DIAGNOSTICS__.life` or, until the integrator lands
 * the contract request, the WP-10 local shim `window.__THREE_GAME_LIFE_DIAGNOSTICS__`. If the
 * LifeSystem isn't constructed in Game.ts yet, every test here is skipped with that reason.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { LifeDiagnostics } from '../src/life/LifeSystem';
import { applyState, attachJson, clickCell, diagnostics, gotoTitle, selectTool, trackErrors, waitFrames } from './helpers';

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/wp-10');
const NOT_WIRED = 'LifeSystem is not constructed in Game.ts yet (WP-10 contract request pending)';

async function life(page: Page): Promise<LifeDiagnostics | null> {
  return page.evaluate(() => {
    const published = (window.__THREE_GAME_DIAGNOSTICS__ as unknown as { life?: LifeDiagnostics } | undefined)?.life;
    const value = published ?? window.__THREE_GAME_LIFE_DIAGNOSTICS__ ?? null;
    return value ? (JSON.parse(JSON.stringify(value)) as LifeDiagnostics) : null;
  });
}

async function requireLife(page: Page): Promise<LifeDiagnostics> {
  const value = await life(page);
  test.skip(value === null, NOT_WIRED);
  return value!;
}

/** Car positions don't leave the published cells; the town's road cells come from the sample layout. */
function sampleTownRoad(x: number, z: number): boolean {
  return (z === 12 && x >= 2 && x <= 21) || (x === 11 && z >= 4 && z <= 20);
}

async function sampleTown(page: Page): Promise<LifeDiagnostics> {
  await gotoTitle(page);
  await requireLife(page);
  await applyState(page, 'sample-town');
  await expect.poll(async () => (await life(page))?.loaded, { message: 'car models loaded' }).toBe(true);
  return (await life(page))!;
}

test('cars drive the sample-town roads (10 s video)', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'the recorded drive runs once, on desktop');
  test.setTimeout(60_000);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: testInfo.outputPath('video'), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const start = await sampleTown(page);
  expect(start.cars, 'sample town (36 drivable road cells) gets the full 6 cars').toBe(6);
  expect(start.target).toBe(6);

  // Zoom towards the crossroads with the real wheel so the cars read in the video.
  const centre = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(11, 12));
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(40);
  }

  const trail: Array<{ t: number; cells: LifeDiagnostics['carCells']; calls: number }> = [];
  const visited = new Set<string>();
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    const l = (await life(page))!;
    const d = await diagnostics(page);
    trail.push({ t: Date.now() - t0, cells: l.carCells, calls: d.renderer.calls });
    for (const c of l.carCells) {
      expect(sampleTownRoad(c.x, c.z), `car ${c.id} on a road cell (${c.x},${c.z})`).toBe(true);
      visited.add(`${c.id}:${c.x},${c.z}`);
    }
    await page.waitForTimeout(250);
  }
  const end = (await life(page))!;
  expect(end.cars).toBe(6);
  expect(end.despawned, 'nobody vanishes on an unchanged network').toBe(0);
  // 6 cars × ~1 cell/s × 10 s: they must have crossed plenty of distinct cells.
  expect(visited.size, 'distinct (car, cell) pairs visited in 10 s').toBeGreaterThan(30);
  await page.screenshot({ path: resolve(ARTIFACTS, 'cars-sample-town.png') });
  errors.expectNone();

  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(resolve(ARTIFACTS, 'cars-drive.json'), JSON.stringify({ visited: visited.size, end, trail }, null, 2));
  await attachJson(testInfo, 'cars-drive', { visited: visited.size, end });
  const video = page.video();
  await context.close();
  if (video) {
    const path = await video.path();
    copyFileSync(path, resolve(ARTIFACTS, 'cars-sample-town.webm'));
    await testInfo.attach('cars-sample-town', { path, contentType: 'video/webm' });
  }
});

test('bulldozing the road under a car removes that car cleanly', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const start = await sampleTown(page);
  // Freeze cars (reduced motion) so the target car stays on its cell until the click lands.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
  const frozen = (await life(page))!;
  // Pick the car nearest the middle of the view, well clear of the top bar and the dock.
  const victim = [...frozen.carCells].sort((a, b) => Math.abs(a.x - 11) + Math.abs(a.z - 11) - (Math.abs(b.x - 11) + Math.abs(b.z - 11)))[0];
  await selectTool(page, 'bulldoze');
  await clickCell(page, victim.x, victim.z);
  await expect.poll(async () => (await diagnostics(page)).town.roadTiles, { message: 'road tile bulldozed' }).toBe(35);
  const after = (await life(page))!;
  await waitFrames(page, 3);
  expect(after.carCells.find((c) => c.id === victim.id), `car ${victim.id} removed`).toBeUndefined();
  // The victim, plus any car that was about to drive into the removed cell.
  expect(after.despawned).toBeGreaterThanOrEqual(frozen.despawned + 1);
  for (const c of after.carCells) {
    expect(sampleTownRoad(c.x, c.z) && !(c.x === victim.x && c.z === victim.z), `car ${c.id} still on a road cell`).toBe(true);
  }
  // Remaining network: count follows the target (topped up or trimmed), never above 6.
  expect(after.cars).toBe(after.target);
  const d = await diagnostics(page);
  expect(d.render.objects).toBe(d.objects);
  await attachJson(testInfo, 'bulldoze-under-car', { start: start.carCells, victim, after });
  if (testInfo.project.name === 'desktop-chrome') {
    mkdirSync(ARTIFACTS, { recursive: true });
    writeFileSync(resolve(ARTIFACTS, 'bulldoze-under-car.json'), JSON.stringify({ victim, before: frozen, after }, null, 2));
    await page.screenshot({ path: resolve(ARTIFACTS, 'bulldoze-under-car.png') });
  }
  errors.expectNone();
});

test('cars add at most 6 draw calls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'draw-call budget measured on desktop');
  const errors = trackErrors(page);
  await page.goto('/?debug');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  await requireLife(page);
  await applyState(page, 'sample-town');
  await expect.poll(async () => (await life(page))?.loaded).toBe(true);
  // Same frame content both times: freeze the simulation, keep rendering.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(true));
  await waitFrames(page, 3);
  const shown = await diagnostics(page);
  const layer = (await life(page))!;
  const toggle = page.getByRole('checkbox', { name: 'cars visible' });
  await toggle.uncheck();
  await waitFrames(page, 3);
  const hidden = await diagnostics(page);
  expect((await life(page))!.drawCalls).toBe(0);
  const added = shown.renderer.calls - hidden.renderer.calls;
  const result = { withCars: shown.renderer.calls, withoutCars: hidden.renderer.calls, added, layerDrawCalls: layer.drawCalls, layerShadowDrawCalls: layer.shadowDrawCalls, cars: layer.cars, trianglesAdded: shown.renderer.triangles - hidden.renderer.triangles };
  await attachJson(testInfo, 'car-draw-calls', result);
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(resolve(ARTIFACTS, 'car-draw-calls.json'), JSON.stringify(result, null, 2));
  expect(added).toBe(layer.drawCalls);
  expect(added).toBeLessThanOrEqual(6);
  // Including the shadow pass (not in renderer.calls) the layer is still within budget.
  expect(layer.drawCalls + layer.shadowDrawCalls).toBeLessThanOrEqual(6);
  await toggle.check();
  errors.expectNone();
});

test('cars are deterministic per seed and freeze with reduced motion', async ({ page }) => {
  const errors = trackErrors(page);
  await sampleTown(page);
  // Reduced motion first, so no frame moves the cars between setState and the read.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
  await applyState(page, 'sample-town');
  const first = (await life(page))!;
  await applyState(page, 'sample-town');
  expect((await life(page))!.carCells, 'same seed + state ⇒ same cars').toEqual(first.carCells);
  const a = (await life(page))!.carCells;
  await page.waitForTimeout(800);
  expect((await life(page))!.carCells, 'reduced motion: exact world positions unchanged').toEqual(a);
  // And with motion back on, they drive.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(false));
  await page.waitForTimeout(800);
  expect((await life(page))!.carCells).not.toEqual(a);
  // A different seed gives a different layout.
  await applyState(page, 'sample-town', 777);
  expect((await life(page))!.carCells).not.toEqual(first.carCells);
  errors.expectNone();
});
