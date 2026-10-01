/**
 * Graphics presets, through diagnostics `graphics`. `?graphics=` boots a preset without saving it; a
 * saved setting boots as that preset; nothing saved = Medium.
 */
import { expect, test, type Page } from '@playwright/test';
import { applyState, diagnostics, gotoTitle, trackErrors, waitFrames } from './helpers';

const SETTINGS_KEY = 'tiny-town:settings:v1';

async function graphicsAt(page: Page, query: string, state = 'sample-town') {
  await gotoTitle(page, query);
  await applyState(page, state);
  await waitFrames(page, 2);
  return diagnostics(page);
}

test('Low: DPR 1, no MSAA, Lambert, 1024 shadows, 60% decor spread, 3 octaves, 30/30 fps, no halos', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  const medium = await graphicsAt(page, '?graphics=medium');
  const d = await graphicsAt(page, '?graphics=low');
  expect(d.quality).toBe('low');
  expect(d.graphics).toMatchObject({
    preset: 'low',
    booted: 'low',
    reloadRequired: false,
    antialias: false,
    material: 'lambert',
    maxDpr: 1,
    renderScale: 0.75,
    shadowMapSize: 1024,
    decorFraction: 0.6,
    skyOctaves: 3,
    activeFps: 30,
    idleFps: 30,
    lampHalos: false,
  });
  // Low renders at min(devicePixelRatio × 0.75, 1): 0.75 on a DPR-1 screen (a 1080p laptop, the
  // desktop project), the cap of 1 on the phone (DPR 2.625).
  const screenDpr = await page.evaluate(() => window.devicePixelRatio);
  const lowRatio = Math.min(screenDpr * 0.75, 1);
  expect(d.canvas.dpr).toBe(lowRatio);
  expect(d.canvas.width).toBe(Math.floor(d.canvas.clientWidth * lowRatio));
  // Decor: 60% of every decor mesh (rounded down per mesh), against the full ring on Medium.
  const share = d.graphics.decorInstances / medium.graphics.decorInstances;
  expect(share).toBeGreaterThan(0.58);
  expect(share).toBeLessThanOrEqual(0.6);
  expect(d.perf.targetFps).toBe(30);
  // Presets change how things are drawn, not what.
  expect(d.objects).toBe(medium.objects);
  errors.expectNone();
});

test('Medium: the default desktop look (DPR 1.5, MSAA, Standard, 2048, full decor, 60/30 fps)', async ({ page }) => {
  const errors = trackErrors(page);
  const d = await graphicsAt(page, '');
  expect(d.quality).toBe('medium');
  expect(d.graphics).toMatchObject({
    preset: 'medium',
    booted: 'medium',
    reloadRequired: false,
    antialias: true,
    material: 'standard',
    maxDpr: 1.5,
    shadowMapSize: 2048,
    decorFraction: 1,
    skyOctaves: 5,
    activeFps: 60,
    idleFps: 30,
    lampHalos: true,
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  expect(d.canvas.dpr).toBe(Math.min(dpr, 1.5));
  errors.expectNone();
});

test('High: DPR cap 2, MSAA, Standard, 2048, full decor, halos', async ({ page }) => {
  const errors = trackErrors(page);
  const d = await graphicsAt(page, '?graphics=high');
  expect(d.graphics).toMatchObject({
    preset: 'high',
    booted: 'high',
    antialias: true,
    material: 'standard',
    maxDpr: 2,
    shadowMapSize: 2048,
    decorFraction: 1,
    skyOctaves: 5,
    activeFps: 60,
    idleFps: 30,
    lampHalos: true,
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  expect(d.canvas.dpr).toBe(Math.min(dpr, 2));
  expect(d.canvas.width).toBe(Math.floor(d.canvas.clientWidth * Math.min(dpr, 2)));
  errors.expectNone();
});

test('night: Low draws no lamp halos, Medium does', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  const medium = await graphicsAt(page, '?graphics=medium', 'night-town');
  const low = await graphicsAt(page, '?graphics=low', 'night-town');
  expect(medium.daytime.lamps).toBeGreaterThan(0);
  expect(low.daytime.lamps).toBe(medium.daytime.lamps);
  // NightLights' main-pass calls: pools (+ halos) + fireflies (+ beams); halos are the only difference.
  expect(medium.daytime.drawCalls - low.daytime.drawCalls).toBe(1);
  errors.expectNone();
});

test('a saved preset boots as that preset; the URL override is not saved', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = trackErrors(page);
  await page.addInitScript(([key]) => {
    // Only on the first load of this test: later loads keep whatever the game stored.
    if (!sessionStorage.getItem('wp25-seeded')) {
      sessionStorage.setItem('wp25-seeded', '1');
      localStorage.setItem(key, JSON.stringify({ graphics: 'low' }));
    }
  }, [SETTINGS_KEY]);
  await gotoTitle(page);
  let d = await diagnostics(page);
  expect(d.graphics).toMatchObject({ preset: 'low', booted: 'low', antialias: false, material: 'lambert', maxDpr: 1, shadowMapSize: 1024 });
  const antialias = await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    return (canvas.getContext('webgl2') as WebGL2RenderingContext).getContextAttributes()?.antialias;
  });
  expect(antialias, 'the real WebGL context has no MSAA').toBe(false);

  // An override boots High but leaves the saved Low alone.
  await gotoTitle(page, '?graphics=high');
  d = await diagnostics(page);
  expect(d.graphics).toMatchObject({ preset: 'high', booted: 'high', antialias: true, material: 'standard' });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').graphics, SETTINGS_KEY)).toBe('low');

  // A bad override or a bad saved value falls back (saved Low; then the default Medium).
  await gotoTitle(page, '?graphics=ultra');
  expect((await diagnostics(page)).graphics.preset).toBe('low');
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ graphics: 'ultra' })), SETTINGS_KEY);
  await gotoTitle(page);
  expect((await diagnostics(page)).graphics).toMatchObject({ preset: 'medium', antialias: true, material: 'standard' });
  errors.expectNone();
});

test.describe('Retina screen (DPR 2)', () => {
  test.use({ deviceScaleFactor: 2 });
  test.skip(({ isMobile }) => isMobile, 'the phone project already runs at DPR 2.625');

  test('the DPR cap follows the preset: Low 1, Medium 1.5, High 2', async ({ page }) => {
    test.setTimeout(60_000);
    for (const [preset, cap] of [['low', 1], ['medium', 1.5], ['high', 2]] as const) {
      const d = await graphicsAt(page, `?graphics=${preset}`, 'empty-build');
      expect(d.canvas.dpr, preset).toBe(cap);
      expect(d.canvas.width, preset).toBe(Math.floor(d.canvas.clientWidth * cap));
    }
  });
});
