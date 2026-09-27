/**
 * WP-07 audio checks, all through real input (clicks, mouse drags) and the published diagnostics.
 *  - Start unlocks the AudioContext and decodes every SFX file with no load/decode warnings.
 *  - A 30-tile road drag is rate-limited: audio.starts rises by 10..30.
 *  - Mute persists across a reload (SETTINGS_STORAGE_KEY) and the mute button reflects it (aria-pressed).
 *  - Hiding the page suspends the context; showing it resumes.
 *  - A broken sound file produces exactly one console warning and the game keeps going.
 */
import { expect, test, type Page } from '@playwright/test';

const SETTINGS_KEY = 'tiny-town:settings:v1';

type Diag = NonNullable<Window['__THREE_GAME_DIAGNOSTICS__']>;

function collectConsole(page: Page) {
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return { warnings, errors, audioWarnings: () => warnings.filter((w) => w.includes('[audio]')) };
}

const diag = (page: Page): Promise<Diag> => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);

async function startGame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building');
}

async function waitForAudio(page: Page, minLoaded: number): Promise<void> {
  await expect
    .poll(async () => (await diag(page)).audio, { timeout: 10_000 })
    .toMatchObject({ unlocked: true, loaded: expect.any(Number) });
  await expect.poll(async () => (await diag(page)).audio.loaded, { timeout: 10_000 }).toBeGreaterThanOrEqual(minLoaded);
}

const cellPoint = (page: Page, x: number, z: number) =>
  page.evaluate(([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz), [x, z] as const);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.removeItem(key), SETTINGS_KEY);
  await page.reload();
});

test('Start unlocks audio and decodes every SFX without warnings', async ({ page }) => {
  const log = collectConsole(page);
  await startGame(page);
  await waitForAudio(page, 13);
  // give any straggling decode a moment to report
  await page.waitForTimeout(300);
  const audio = (await diag(page)).audio;
  console.log('audio diagnostics after Start:', JSON.stringify(audio));
  expect(audio.unlocked).toBe(true);
  expect(audio.loaded).toBeGreaterThanOrEqual(13);
  expect(log.audioWarnings()).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('a 30-tile road drag is rate-limited to 10..30 sound starts', async ({ page }) => {
  const log = collectConsole(page);
  await startGame(page);
  await waitForAudio(page, 13);
  await page.locator('#cat-paths').click();
  await page.locator('#tool-road').click();
  await expect.poll(async () => (await diag(page)).tool).toBe('road');
  await page.waitForTimeout(200);

  // An L-shaped stroke (WP-12: one point per 2×2 road block): 20 blocks along z=12, then 10 more
  // down x=42 → 30 road tiles.
  const path: Array<[number, number]> = [];
  for (let x = 4; x <= 42; x += 2) path.push([x, 12]);
  for (let z = 14; z <= 32; z += 2) path.push([42, z]);
  const points = [];
  for (const [x, z] of path) points.push(await cellPoint(page, x, z));

  const before = await diag(page);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  // A brisk human drag, paced by wall clock: one cell every ~35 ms (about 1 s for the stroke).
  const t0 = Date.now();
  for (let i = 1; i < points.length; i += 1) {
    await page.mouse.move(points[i].x, points[i].y, { steps: 2 });
    const wait = t0 + i * 35 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
  await page.mouse.up();
  const strokeMs = Date.now() - t0;
  await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(before.town.roadTiles + 30);
  await page.waitForTimeout(200);
  const after = await diag(page);
  const delta = after.audio.starts - before.audio.starts;
  console.log(`road drag (${strokeMs} ms): +${after.town.roadTiles - before.town.roadTiles} tiles, audio.starts ${before.audio.starts} → ${after.audio.starts} (+${delta})`);
  expect(delta).toBeGreaterThanOrEqual(10);
  expect(delta).toBeLessThanOrEqual(30);
  expect(log.audioWarnings()).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('mute persists across reloads and silences playback', async ({ page }) => {
  await startGame(page);
  await waitForAudio(page, 13);
  await page.locator('#btn-mute').click();
  await expect.poll(async () => (await diag(page)).audio.muted).toBe(true);
  await expect(page.locator('#btn-mute')).toHaveAttribute('aria-pressed', 'true');
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SETTINGS_KEY);
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ muted: true });

  // muted: a UI click starts no sources
  const startsMuted = (await diag(page)).audio.starts;
  await page.locator('#cat-nature').click();
  await page.waitForTimeout(100);
  expect((await diag(page)).audio.starts).toBe(startsMuted);

  await page.reload();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  expect((await diag(page)).audio.muted).toBe(true);
  await expect(page.locator('#btn-mute')).toHaveAttribute('aria-pressed', 'true');

  // unmute again → persisted as false, other settings keys are kept
  await page.evaluate((key) => {
    const s = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    window.localStorage.setItem(key, JSON.stringify({ ...s, grid: false }));
  }, SETTINGS_KEY);
  await startGame(page);
  await page.locator('#btn-mute').click();
  await expect.poll(async () => (await diag(page)).audio.muted).toBe(false);
  await expect(page.locator('#btn-mute')).toHaveAttribute('aria-pressed', 'false');
  const stored2 = JSON.parse((await page.evaluate((key) => window.localStorage.getItem(key), SETTINGS_KEY)) ?? '{}');
  expect(stored2).toMatchObject({ muted: false, grid: false });
});

test('hiding the page suspends audio and showing it resumes', async ({ page }) => {
  await startGame(page);
  await waitForAudio(page, 13);
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await expect.poll(async () => (await diag(page)).audio.unlocked).toBe(false);
  await setHidden(false);
  await expect.poll(async () => (await diag(page)).audio.unlocked).toBe(true);
});

test('a broken sound file is reported once and never throws', async ({ page }) => {
  const log = collectConsole(page);
  await page.route('**/assets/audio/rotate.mp3', (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'not an mp3' }));
  await page.route('**/assets/audio/invalid.mp3', (route) => route.fulfill({ status: 404, body: '' }));
  await page.reload();
  await startGame(page);
  await expect.poll(() => log.audioWarnings().length, { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(300);
  expect(log.audioWarnings()).toHaveLength(1);
  expect(log.audioWarnings()[0]).toContain('rotate.mp3');
  expect(log.audioWarnings()[0]).toContain('invalid.mp3');
  const audio = (await diag(page)).audio;
  expect(audio.unlocked).toBe(true);
  expect(audio.loaded).toBeGreaterThanOrEqual(13);
  // the browser itself logs the 404 as a resource error; nothing else may error
  expect(log.errors.filter((e) => !e.startsWith('Failed to load resource'))).toEqual([]);
  // the game still plays sounds that did load
  const before = audio.starts;
  await page.locator('#cat-nature').click();
  await expect.poll(async () => (await diag(page)).audio.starts).toBeGreaterThan(before);
});

// ---- WP-13: background music -------------------------------------------------------------------

const MUSIC_PATH = '/assets/music/foundation-of-gold.mp3';
type MusicDiag = { enabled: boolean; volume: number; playing: boolean; loaded: boolean; requested: boolean; ducked: boolean; time: number; loops: number };
/** audio.music is published by AudioManager.state (vite-env.d.ts type update requested in the WP-13 hand-off). */
const music = async (page: Page): Promise<MusicDiag> => ((await diag(page)).audio as unknown as { music: MusicDiag }).music;

test('music is not requested before Start, then streams, plays and advances', async ({ page }) => {
  const log = collectConsole(page);
  const requests: Array<{ url: string; at: number }> = [];
  page.on('request', (request) => requests.push({ url: request.url(), at: Date.now() }));
  await page.reload();
  const t0 = Date.now();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  await page.waitForTimeout(1500); // idle on the title screen: still nothing
  const atTitle = requests.length;
  expect(requests.filter((r) => r.url.includes('/assets/music/'))).toEqual([]);
  expect((await music(page)).requested).toBe(false);

  const clickAt = Date.now();
  await startGame(page);
  await expect.poll(async () => (await music(page)).playing, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await music(page)).loaded, { timeout: 10_000 }).toBe(true);
  const musicRequests = requests.filter((r) => r.url.includes(MUSIC_PATH));
  expect(musicRequests.length).toBeGreaterThan(0);
  expect(musicRequests[0].at).toBeGreaterThanOrEqual(clickAt);
  console.log(
    `requests before Start: ${atTitle} (none for music); first music request ${musicRequests[0].at - clickAt} ms after the Start click ` +
      `(${musicRequests[0].at - t0} ms after reload); music requests: ${musicRequests.length}`,
  );

  const first = (await music(page)).time;
  await page.waitForTimeout(1200);
  const m = await music(page);
  console.log('music diagnostics after Start:', JSON.stringify(m));
  expect(m.time).toBeGreaterThan(first + 0.5);
  expect(m).toMatchObject({ enabled: true, volume: 0.5, playing: true, ducked: false });
  expect(log.audioWarnings()).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('music off stops playback; music on/volume persist across reload; menu ducks', async ({ page }) => {
  await startGame(page);
  await expect.poll(async () => (await music(page)).playing, { timeout: 10_000 }).toBe(true);

  await page.locator('#btn-menu').click();
  await expect(page.locator('#ui-menu')).toBeVisible();
  await expect.poll(async () => (await music(page)).ducked).toBe(true);
  await expect(page.locator('#chk-music')).toBeChecked();
  await expect(page.locator('#range-music')).toHaveValue('0.5');

  await page.locator('#range-music').fill('0.2');
  await expect.poll(async () => (await music(page)).volume).toBe(0.2);
  await page.locator('#chk-music').click();
  await expect.poll(async () => (await music(page)).enabled).toBe(false);
  await expect.poll(async () => (await music(page)).playing).toBe(false);
  await expect(page.locator('#range-music')).toBeDisabled();
  const stored = JSON.parse((await page.evaluate((key) => window.localStorage.getItem(key), SETTINGS_KEY)) ?? '{}');
  expect(stored).toMatchObject({ music: false, musicVolume: 0.2 });

  await page.locator('#btn-resume').click();
  await expect.poll(async () => (await music(page)).ducked).toBe(false);

  await page.reload();
  await startGame(page);
  await page.waitForTimeout(500);
  expect(await music(page)).toMatchObject({ enabled: false, volume: 0.2, playing: false, requested: false });
  await page.locator('#btn-menu').click();
  await expect(page.locator('#chk-music')).not.toBeChecked();
  await expect(page.locator('#range-music')).toHaveValue('0.2');

  // switching it back on streams and plays, and persists
  await page.locator('#chk-music').click();
  await expect.poll(async () => (await music(page)).playing, { timeout: 10_000 }).toBe(true);
  const stored2 = JSON.parse((await page.evaluate((key) => window.localStorage.getItem(key), SETTINGS_KEY)) ?? '{}');
  expect(stored2).toMatchObject({ music: true, musicVolume: 0.2 });
});

test('old settings without music fields load with the defaults', async ({ page }) => {
  await page.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ muted: false, volume: 0.6, grid: true })), SETTINGS_KEY);
  await page.reload();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  expect(await music(page)).toMatchObject({ enabled: true, volume: 0.5, playing: false, requested: false });
  expect((await diag(page)).audio.volume).toBe(0.6);
});

test('master mute and a hidden page silence music; unmute/show resume it', async ({ page }) => {
  await startGame(page);
  await expect.poll(async () => (await music(page)).playing, { timeout: 10_000 }).toBe(true);
  await page.locator('#btn-mute').click();
  await expect.poll(async () => (await diag(page)).audio.muted).toBe(true);
  await expect.poll(async () => (await music(page)).playing).toBe(false);
  const pausedAt = (await music(page)).time;
  await page.waitForTimeout(600);
  expect((await music(page)).time).toBe(pausedAt);
  expect((await music(page)).enabled).toBe(true); // the music setting itself is untouched
  await page.locator('#btn-mute').click();
  await expect.poll(async () => (await music(page)).playing).toBe(true);

  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await expect.poll(async () => (await music(page)).playing).toBe(false);
  await setHidden(false);
  await expect.poll(async () => (await music(page)).playing).toBe(true);
});
