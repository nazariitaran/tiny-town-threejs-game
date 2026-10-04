/** Ambient cars, checked through diagnostics `life` and real input. Skipped when `life` is not published. */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PLOT_WIDTH } from '../src/game/config';
import type { LifeDiagnostics } from '../src/life/LifeSystem';
import { demoOffset } from '../src/town/sampleTown';
import { applyState, attachJson, clickCell, diagnostics, gotoTitle, selectTool, trackErrors, waitFrames } from './helpers';

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/life');
const NOT_WIRED = 'LifeSystem diagnostics are not available';

async function life(page: Page): Promise<LifeDiagnostics | null> {
  return page.evaluate(() => {
    const published = (window.__THREE_GAME_DIAGNOSTICS__ as unknown as { life?: LifeDiagnostics } | undefined)?.life;
    const value = published ?? null;
    return value ? (JSON.parse(JSON.stringify(value)) as LifeDiagnostics) : null;
  });
}

async function requireLife(page: Page): Promise<LifeDiagnostics> {
  const value = await life(page);
  test.skip(value === null, NOT_WIRED);
  return value!;
}

/**
 * Car positions don't leave the published cells; the town's road cells come from the sample layout
 * (buildSampleTown: main street rows 24–25, x 4–43; side street columns 22–23, z 8–41; 2×2 road
 * blocks; a roundabout on cells 20–25 × 22–27 where they cross, all of it road). Those are layout
 * cells: the town sits shifted by O = demoOffset() (8 on the 64 × 64 plot).
 */
const O = demoOffset(PLOT_WIDTH);
const onSampleRoundabout = (x: number, z: number) => x - O >= 20 && x - O <= 25 && z - O >= 22 && z - O <= 27;
function sampleTownRoad(x: number, z: number): boolean {
  const [lx, lz] = [x - O, z - O];
  return ((lz === 24 || lz === 25) && lx >= 4 && lx <= 43) || ((lx === 22 || lx === 23) && lz >= 8 && lz <= 41) || onSampleRoundabout(x, z);
}
/** The sample town's large car park: anchor (24, 14), rotation 3, so 6 × 4 cells with its entrance on the side street. */
const onSampleCarPark = (x: number, z: number) => x - O >= 24 && x - O <= 29 && z - O >= 14 && z - O <= 17;
type CarCell = LifeDiagnostics['carCells'][number];
const onTheRoad = (c: CarCell) => c.phase === 'drive' || c.phase === 'approach';
/** A driving car is on a road cell; a car on a lot route or in a stall may be on a car-park cell. */
const whereItBelongs = (c: CarCell) => sampleTownRoad(c.x, c.z) || (!onTheRoad(c) && onSampleCarPark(c.x, c.z));
/** Road blocks in the sample town (TownStats.roadTiles): 20 + 8 + 8 street blocks + 9 roundabout − 5 shared + 6 car park. */
const SAMPLE_ROAD_TILES = 46;

const sameBlock = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.floor(a.x / 2) === Math.floor(b.x / 2) && Math.floor(a.z / 2) === Math.floor(b.z / 2);

async function sampleTown(page: Page): Promise<LifeDiagnostics> {
  await gotoTitle(page);
  await requireLife(page);
  await applyState(page, 'sample-town');
  await expect.poll(async () => (await life(page))?.loaded, { message: 'car models loaded' }).toBe(true);
  return (await life(page))!;
}

test('cars drive the sample-town roads (10 s video)', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: testInfo.outputPath('video'), size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const start = await sampleTown(page);
  expect(start.cars, 'sample town gets the full 6 cars').toBe(6);
  expect(start.target).toBe(6);

  // Zoom towards the crossroads with the real wheel so the cars read in the video.
  const centre = await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(x, z), [22 + O, 24 + O] as const);
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
      expect(whereItBelongs(c), `car ${c.id} (${c.phase}) on a road cell, or in the car park when parking (${c.x},${c.z})`).toBe(true);
      visited.add(`${c.id}:${c.x},${c.z}`);
    }
    await page.waitForTimeout(250);
  }
  const end = (await life(page))!;
  expect(end.cars).toBe(6);
  expect(end.despawned, 'nobody vanishes on an unchanged network').toBe(0);
  // 6 cars × ~1 cell/s × 10 s: they must have crossed plenty of distinct cells, even with half of them
  // parked for the second half of the run (nobody parks in its first four blocks).
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
  // Pick the car nearest the middle of the view, well clear of the top bar and the dock, on a plain
  // road block (bulldozing a roundabout cell would remove the whole 3 × 3-block roundabout, and a
  // parked car's cell the whole car park).
  expect((await diagnostics(page)).town.roadTiles).toBe(SAMPLE_ROAD_TILES);
  const victim = [...frozen.carCells].filter((c) => c.phase === 'drive' && sampleTownRoad(c.x, c.z) && !onSampleRoundabout(c.x, c.z)).sort((a, b) => Math.abs(a.x - 22 - O) + Math.abs(a.z - 22 - O) - (Math.abs(b.x - 22 - O) + Math.abs(b.z - 22 - O)))[0];
  await selectTool(page, 'bulldoze');
  await clickCell(page, victim.x, victim.z);
  await expect.poll(async () => (await diagnostics(page)).town.roadTiles, { message: 'road tile bulldozed' }).toBe(SAMPLE_ROAD_TILES - 1);
  // `life` is published by the next frame's update.
  await waitFrames(page, 3);
  const after = (await life(page))!;
  expect(after.carCells.find((c) => c.id === victim.id), `car ${victim.id} removed`).toBeUndefined();
  // The victim, plus any car that was about to drive into the removed cell.
  expect(after.despawned).toBeGreaterThanOrEqual(frozen.despawned + 1);
  for (const c of after.carCells) {
    expect(whereItBelongs(c) && !sameBlock(c, victim), `car ${c.id} still on a road cell`).toBe(true);
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
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(false));
  await page.waitForTimeout(800);
  expect((await life(page))!.carCells).not.toEqual(a);
  await applyState(page, 'sample-town', 777);
  expect((await life(page))!.carCells).not.toEqual(first.carCells);
  errors.expectNone();
});
