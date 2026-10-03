/**
 * Match nights at the stadium: the floodlights light it and the crowd is heard by distance on a match
 * night, and neither happens otherwise. The stadium is built with real input; the match is pinned with
 * `setMatchNight`, and one desktop test runs the real schedule through the time-mode button.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { CROWD_DUCK_DB, CROWD_TRIM } from '../src/audio/CrowdLoop';
import { CROWD_CUTOFF_DISTANCE, crowdGainAt } from '../src/life/matchSchedule';
import { cellToWorld } from '../src/game/config';
import type { Cell } from '../src/town/types';
import { byId, canvasPoint, diagnostics, expectDiagnostics, footprintPoint, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS, waitFrames } from './helpers';

const ARTIFACTS = 'artifacts/stadium-match';
const BUILT: Cell = { x: 25, z: 26 }; // 14 × 11 cells: x 25–38, z 26–36
const first = cellToWorld(BUILT);
/** World centre of the lot. */
const CENTRE = { x: first.x + 6.5 * 0.5, z: first.z + 5 * 0.5 };
const T_NIGHT = 0.82;

const pose = (targetX: number, targetZ: number, distance = 16) => ({ targetX, targetZ, azimuth: 0.6, polar: 0.9, distance });

async function buildStadium(page: Page, touch: boolean): Promise<void> {
  await selectTool(page, 'stadium');
  const p = await footprintPoint(page, 'stadium', BUILT, 0);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await expectDiagnostics(page, { objects: 1, town: { amenities: 1 } }, 'stadium built');
  await page.waitForTimeout(500); // pop-in settles
}

/** Sets the match override and returns the mean brightness (0..255) of the canvas around the stadium, read in the same task as the render. */
async function matchBrightness(page: Page, on: boolean | null): Promise<number> {
  const centre = await canvasPoint(page, BUILT.x + 7, BUILT.z + 5);
  return page.evaluate(
    ([match, x, y]) => {
      window.__THREE_GAME_TEST_HOOKS__!.setMatchNight(match as boolean | null);
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const size = Math.round(90 * scale);
      const copy = document.createElement('canvas');
      copy.width = size;
      copy.height = size;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(canvas, ((x as number) - rect.left) * scale - size / 2, ((y as number) - rect.top) * scale - size / 2, size, size, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      return sum / (data.length / 4);
    },
    [on, centre.x, centre.y] as const,
  );
}

const setPose = (page: Page, p: ReturnType<typeof pose>) => page.evaluate((value) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose(value), p);
const setTime = (page: Page, t: number | null) => page.evaluate((value) => window.__THREE_GAME_TEST_HOOKS__!.setTimeOfDay(value), t);

test('a match night lights the stadium and plays the crowd by distance; no match, no light, no sound', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const touch = testInfo.project.name.startsWith('mobile');
  mkdirSync(ARTIFACTS, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: `${ARTIFACTS}/e2e-${testInfo.project.name}-${name}.png` });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('stadium-crowd')) requests.push(request.url());
  });
  await gotoTitle(page);
  await startBuilding(page);
  await buildStadium(page, touch);
  await selectTool(page, 'bulldoze'); // no ghost over the lot; used at the end
  await setPose(page, pose(CENTRE.x, CENTRE.z));

  // A night without a match: dark, silent, nothing fetched.
  await setTime(page, T_NIGHT);
  await waitFrames(page, 3);
  let d = await diagnostics(page);
  expect(d.match).toMatchObject({ level: 0, playing: false, forced: null, stadiums: 1 });
  expect(d.match.distance).toBeCloseTo(0, 3);
  expect(d.daytime).toMatchObject({ night: 1, floodlights: 0, stadiums: 1 });
  expect(d.audio.crowd).toMatchObject({ level: 0, gain: 0, requested: false, playing: false });
  const quietCalls = d.daytime.drawCalls;
  const textures = d.renderer.textures;
  const dark = await matchBrightness(page, false);
  await shot('night-no-match');

  // Match night: the floodlights light the bowl (a spill pool and mast halos are the only extra draw calls, no texture).
  const lit = await matchBrightness(page, true);
  expect(lit, `lit ${lit.toFixed(1)} vs dark ${dark.toFixed(1)}`).toBeGreaterThan(dark * 2);
  await waitFrames(page, 3);
  d = await diagnostics(page);
  expect(d.match).toMatchObject({ level: 1, playing: true, forced: true });
  expect(d.daytime.floodlights).toBe(1);
  expect(d.daytime.drawCalls).toBe(quietCalls + 2);
  expect(d.renderer.textures).toBe(textures);
  await shot('night-match');

  // The crowd: fetched only now, full at the stadium.
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.playing, { timeout: 10_000 }).toBe(true);
  d = await diagnostics(page);
  expect(requests.length).toBe(1);
  expect(d.audio.crowd.level).toBeCloseTo(1, 3);
  expect(d.audio.crowd.gain).toBeCloseTo(CROWD_TRIM, 2);

  // Further away it is quieter, by the one fixed curve; beyond the cutoff it is silent and the loop stops.
  for (const away of [6, 11.75, 16]) {
    await setPose(page, pose(CENTRE.x - away, CENTRE.z));
    await waitFrames(page, 3);
    d = await diagnostics(page);
    expect(d.match.distance).toBeCloseTo(away, 3);
    expect(d.audio.crowd.level, `at ${away}`).toBeCloseTo(crowdGainAt(away), 3);
    expect(d.audio.crowd.gain, `gain at ${away}`).toBeCloseTo(crowdGainAt(away) * CROWD_TRIM, 2);
  }
  expect(crowdGainAt(11.75)).toBeCloseTo(0.25, 6);
  await setPose(page, pose(CENTRE.x - 14, CENTRE.z + 16)); // a far corner of the plot
  await waitFrames(page, 3);
  d = await diagnostics(page);
  expect(d.match.distance!).toBeGreaterThan(CROWD_CUTOFF_DISTANCE);
  expect(d.match.level, 'the lights stay on').toBe(1);
  expect(d.audio.crowd).toMatchObject({ level: 0, gain: 0 });
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.playing, { timeout: 5_000 }).toBe(false);

  // Back at the stadium: mute silences it, the menu ducks it.
  await setPose(page, pose(CENTRE.x, CENTRE.z));
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.gain).toBeCloseTo(CROWD_TRIM, 2);
  await byId(page, UI_TEST_IDS.mute).click();
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.gain).toBe(0);
  await byId(page, UI_TEST_IDS.mute).click();
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.gain).toBeCloseTo(CROWD_TRIM, 2);
  await byId(page, UI_TEST_IDS.menu).click();
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('menu');
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.gain).toBeCloseTo(CROWD_TRIM * 10 ** (CROWD_DUCK_DB / 20), 2);
  expect((await diagnostics(page)).match.level, 'lights stay on behind the menu').toBe(1);
  await byId(page, UI_TEST_IDS.resume).click();
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.gain).toBeCloseTo(CROWD_TRIM, 2);

  // By day a match shows and sounds nothing.
  await setTime(page, 0.55);
  await waitFrames(page, 3);
  d = await diagnostics(page);
  expect(d.match.level).toBe(0);
  expect(d.daytime).toMatchObject({ floodlights: 0, drawCalls: 0 });
  expect(d.audio.crowd).toMatchObject({ level: 0, gain: 0 });

  // Bulldozing the stadium mid-match takes the light and the crowd with it.
  await setTime(page, T_NIGHT);
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.gain).toBeCloseTo(CROWD_TRIM, 2);
  const corner = await canvasPoint(page, BUILT.x + 7, BUILT.z + 5);
  if (touch) await page.touchscreen.tap(corner.x, corner.y);
  else await page.mouse.click(corner.x, corner.y);
  await expectDiagnostics(page, { objects: 0 }, 'stadium bulldozed');
  await waitFrames(page, 3);
  d = await diagnostics(page);
  expect(d.match).toMatchObject({ stadiums: 0, distance: null });
  expect(d.daytime.drawCalls).toBe(quietCalls);
  expect(d.audio.crowd).toMatchObject({ level: 0, gain: 0 });
  expect(requests.length, 'one fetch for the whole session').toBe(1);
  errors.expectNone();
});

test('Low preset (Lambert, no halos): the floodlights still light the stadium, with one extra draw call', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'the preset is the same on both');
  const errors = trackErrors(page);
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await gotoTitle(page, '?graphics=low');
  await startBuilding(page);
  await buildStadium(page, false);
  await selectTool(page, 'bulldoze');
  await setPose(page, pose(CENTRE.x, CENTRE.z));
  await setTime(page, T_NIGHT);
  await waitFrames(page, 3);
  const before = await diagnostics(page);
  expect(before.graphics).toMatchObject({ material: 'lambert', lampHalos: false });
  const dark = await matchBrightness(page, false);
  const lit = await matchBrightness(page, true);
  expect(lit, `lit ${lit.toFixed(1)} vs dark ${dark.toFixed(1)}`).toBeGreaterThan(dark * 2);
  await waitFrames(page, 3);
  const after = await diagnostics(page);
  expect(after.daytime.drawCalls).toBe(before.daytime.drawCalls + 1);
  expect(after.renderer.textures).toBe(before.renderer.textures);
  await page.screenshot({ path: `${ARTIFACTS}/e2e-low-night-match.png` });
  expect(warnings, 'no shader warnings').toEqual([]);
  errors.expectNone();
});

test('the schedule: the first night is a match night for 30 s of night, the second is not', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'runs in real time; once is enough');
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await buildStadium(page, false);
  await selectTool(page, 'bulldoze');
  await setPose(page, pose(CENTRE.x, CENTRE.z));
  const cycleTo = async (mode: 'auto' | 'day' | 'night') => {
    await byId(page, UI_TEST_IDS.timeMode).click();
    await expect.poll(async () => (await diagnostics(page)).daytime.mode).toBe(mode);
  };
  expect((await diagnostics(page)).match).toMatchObject({ night: 0, playing: false, level: 0 });

  // Morning → Day mode: no night. Day → Night mode: the first night begins as the clock passes sunset.
  await cycleTo('day');
  await page.waitForTimeout(3_000);
  expect((await diagnostics(page)).match).toMatchObject({ night: 0, playing: false, level: 0 });
  await cycleTo('night');
  const kickoff = Date.now();
  await expect.poll(async () => (await diagnostics(page)).match.night, { timeout: 6_000 }).toBe(1);
  expect((await diagnostics(page)).match).toMatchObject({ matchNight: true, playing: true });
  await expect.poll(async () => (await diagnostics(page)).match.level, { timeout: 10_000 }).toBe(1);
  let d = await diagnostics(page);
  expect(d.daytime.floodlights).toBe(1);
  await expect.poll(async () => (await diagnostics(page)).audio.crowd.playing, { timeout: 10_000 }).toBe(true);
  await page.screenshot({ path: `${ARTIFACTS}/e2e-schedule-first-night.png` });

  // Still on 20 s into the night; off, lights and crowd, soon after 30 s.
  await page.waitForTimeout(Math.max(0, 20_000 - (Date.now() - kickoff)));
  expect((await diagnostics(page)).match.level).toBe(1);
  await expect.poll(async () => (await diagnostics(page)).match.level, { timeout: 25_000 }).toBe(0);
  const lasted = (Date.now() - kickoff) / 1000;
  expect(lasted).toBeGreaterThan(30);
  expect(lasted).toBeLessThan(60); // the game clock runs slow under 20 fps
  d = await diagnostics(page);
  expect(d.match).toMatchObject({ night: 1, playing: false });
  expect(d.daytime.floodlights).toBe(0);
  expect(d.audio.crowd).toMatchObject({ level: 0, gain: 0 });

  // The second night: no match.
  await cycleTo('auto');
  await cycleTo('day');
  await cycleTo('night');
  await expect.poll(async () => (await diagnostics(page)).match.night, { timeout: 6_000 }).toBe(2);
  await page.waitForTimeout(4_000);
  d = await diagnostics(page);
  expect(d.match).toMatchObject({ matchNight: false, playing: false, level: 0 });
  expect(d.daytime).toMatchObject({ phase: 'night', floodlights: 0 });
  expect(d.audio.crowd).toMatchObject({ level: 0, gain: 0 });
  await page.screenshot({ path: `${ARTIFACTS}/e2e-schedule-second-night.png` });
  errors.expectNone();
});
