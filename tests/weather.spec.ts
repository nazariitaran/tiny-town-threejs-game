/**
 * Rain, through diagnostics `weather` and the `setWeather` / `setCameraPose` hooks. The layout of the rain
 * itself (drops anchored to the world, octaves cross-fading) is unit-tested in src/weather/rainField.test.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { RAIN_TUNING } from '../src/weather/rainField';
import { applyState, gotoTitle, startBuilding, trackErrors, waitFrames } from './helpers';

/** Both meshes hold two octaves' worth of instances. */
const MAX_INSTANCES = 2 * (RAIN_TUNING.maxStreaks + RAIN_TUNING.maxSplashes);

const weather = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__!.weather!)) as NonNullable<ThreeGameDiagnostics['weather']>);

const setWeather = (page: Page, kind: string | null) => page.evaluate((k) => window.__THREE_GAME_TEST_HOOKS__!.setWeather!(k), kind);

const pose = (page: Page, distance: number) =>
  page.evaluate((d) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose({ targetX: 4, targetZ: -3, azimuth: Math.PI / 4, polar: (52 * Math.PI) / 180, distance: d }), distance);

async function sampleTown(page: Page): Promise<void> {
  await gotoTitle(page);
  await startBuilding(page);
  await applyState(page, 'sample-town');
}

test('a storm draws its rain in two calls, within budget at every zoom; clear removes it', async ({ page }) => {
  const errors = trackErrors(page);
  await sampleTown(page);
  expect((await weather(page)).drawCalls).toBe(0);

  await setWeather(page, 'storm');
  for (const distance of [6, 20, 60]) {
    await pose(page, distance);
    await waitFrames(page, 2);
    const rain = await weather(page);
    expect(rain.drawCalls, `draw calls at ${distance}`).toBe(2);
    expect(rain.streaks, `streaks at ${distance}`).toBe(RAIN_TUNING.maxStreaks);
    expect(rain.instances, `instances at ${distance}`).toBeGreaterThan(0);
    expect(rain.instances, `instances at ${distance}`).toBeLessThanOrEqual(MAX_INSTANCES);
  }

  // The hook applies at once, with no fade.
  await setWeather(page, 'clear');
  expect(await weather(page)).toMatchObject({ drawCalls: 0, instances: 0, streaks: 0, splashes: 0 });
  errors.expectNone();
});

test('the rain fits the camera of every render, even while paused', async ({ page }) => {
  const errors = trackErrors(page);
  await sampleTown(page);
  await setWeather(page, 'storm');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(true));
  // setCameraPose renders at once, with no update in between.
  await pose(page, 6);
  const closest = await weather(page);
  expect(closest.octave).toBe(0);
  expect(closest.octaveMix).toBeCloseTo(0, 5);
  await pose(page, 6 * Math.SQRT2);
  const between = await weather(page);
  expect(between.octave).toBe(0);
  expect(between.octaveMix).toBeCloseTo(0.5, 5);
  await pose(page, 60);
  expect((await weather(page)).octave).toBe(3);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(false));
  errors.expectNone();
});

test('the Low preset draws half the rain', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page, '?graphics=low');
  await startBuilding(page);
  await applyState(page, 'sample-town');
  await setWeather(page, 'storm');
  await pose(page, 20);
  expect((await weather(page)).streaks).toBe(RAIN_TUNING.maxStreaks / 2);
  errors.expectNone();
});
