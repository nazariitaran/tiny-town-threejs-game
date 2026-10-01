/**
 * Bird flocks, through diagnostics `birds` and the `spawnFlock` hook. Test states never launch a flock
 * by themselves, so screenshot baselines stay bird-free.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { BirdDiagnostics } from '../src/life/BirdSystem';
import { ALTITUDE } from '../src/life/FlockSim';
import { applyState, attachJson, clickStart, gotoTitle, trackErrors, waitFrames } from './helpers';

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/birds');

async function birds(page: Page): Promise<BirdDiagnostics> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__!.birds)) as BirdDiagnostics);
}

const spawnFlock = (page: Page, species?: string) =>
  page.evaluate((kind) => window.__THREE_GAME_TEST_HOOKS__!.spawnFlock(kind), species);

async function callsNow(page: Page): Promise<number> {
  await waitFrames(page, 2);
  return page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.renderer.calls);
}

test('a flock crosses the sample town: in the band, moving, +1 draw call, then gone', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'desktop-chrome';
  test.setTimeout(desktop ? 75_000 : 30_000);
  const errors = trackErrors(page);
  await gotoTitle(page);
  await applyState(page, 'sample-town');
  expect((await birds(page)).birds).toBe(0);
  const before = await callsNow(page);

  expect(await spawnFlock(page, 'goose')).toBeGreaterThanOrEqual(5);
  const start = await birds(page);
  expect(start.flocks).toBe(1);
  expect(start.species).toEqual(['goose']);
  expect(start.drawCalls).toBe(1);
  expect(start.shadowDrawCalls).toBe(1);
  expect(await callsNow(page)).toBe(before + 1);

  await page.waitForTimeout(1500);
  const later = await birds(page);
  expect(later.birds).toBe(start.birds);
  for (const p of later.positions) {
    expect(p.y).toBeGreaterThanOrEqual(ALTITUDE[0]);
    expect(p.y).toBeLessThanOrEqual(ALTITUDE[1]);
  }
  const moved = Math.hypot(later.positions[0].x - start.positions[0].x, later.positions[0].z - start.positions[0].z);
  expect(moved, 'the leader flew on').toBeGreaterThan(1);
  await attachJson(testInfo, 'birds', { start, later });
  if (!desktop) return errors.expectNone();

  // Desktop: watch the crossing (evidence shots when the flock is over the town) until the sky is empty.
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.waitForFunction(
    () => {
      const p = window.__THREE_GAME_DIAGNOSTICS__!.birds.positions[0];
      return p !== undefined && Math.hypot(p.x, p.z) < 10;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.screenshot({ path: resolve(ARTIFACTS, 'e2e-goose-over-town.png') });
  await expect.poll(async () => (await birds(page)).birds, { timeout: 40_000, intervals: [1000] }).toBe(0);
  const end = await birds(page);
  expect(end.drawCalls).toBe(0);
  expect(await callsNow(page)).toBe(before);
  errors.expectNone();
});

test('test states never launch a flock by themselves', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?debug&flock=1');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  await applyState(page, 'sample-town');
  const after = await birds(page);
  expect(after.auto).toBe(false);
  expect(after.spawned).toBe(0);
  await page.waitForTimeout(3000); // three "due" flocks at the debug interval
  expect((await birds(page)).spawned).toBe(0);
  errors.expectNone();
});

test('flocks come by themselves over the title and the town (?debug&flock=3)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'the schedule is the same on phones; once is enough');
  test.setTimeout(45_000);
  const errors = trackErrors(page);
  await page.goto('/?debug&flock=3');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  expect((await birds(page)).auto).toBe(true);
  await expect.poll(async () => (await birds(page)).spawned, { timeout: 10_000, message: 'a flock over the title' }).toBeGreaterThanOrEqual(1);
  expect((await birds(page)).birds).toBeGreaterThan(0);
  await clickStart(page);
  const atStart = (await birds(page)).spawned;
  await expect.poll(async () => (await birds(page)).spawned, { timeout: 10_000, message: 'a flock while building' }).toBeGreaterThan(atStart);
  errors.expectNone();
});

test('no new flock at night; one comes once it is day again', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'pure schedule logic; once is enough');
  test.setTimeout(45_000);
  const errors = trackErrors(page);
  await page.goto('/?debug&flock=2');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setTimeOfDay(0.82));
  const atNight = (await birds(page)).spawned;
  await page.waitForTimeout(6000);
  expect((await birds(page)).spawned, 'nothing launched at night').toBe(atNight);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setTimeOfDay(0.55));
  await expect.poll(async () => (await birds(page)).spawned, { timeout: 16_000, message: 'a flock after dawn' }).toBeGreaterThan(atNight);
  errors.expectNone();
});

test('reduced motion clears the sky', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await applyState(page, 'sample-town');
  expect(await spawnFlock(page, 'pigeon')).toBeGreaterThan(0);
  expect((await birds(page)).birds).toBeGreaterThan(0);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
  const after = await birds(page);
  expect(after.birds).toBe(0);
  expect(after.drawCalls).toBe(0);
  errors.expectNone();
});

test('spawnFlock rejects an unknown species', async ({ page }) => {
  await gotoTitle(page);
  await applyState(page, 'empty-build');
  const message = await page.evaluate(() => {
    try {
      window.__THREE_GAME_TEST_HOOKS__!.spawnFlock('dragon');
      return 'no error';
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain('unknown species');
});
