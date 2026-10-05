/**
 * Hands-free controls (`?gestures`): off by default and free when off; with the flag, the panel opens a
 * camera (Chromium's fake one: a test pattern, no hand) and MediaPipe starts tracking in its worker.
 * Real tracking with real hands is checked by scripts/gesture-smoke.mjs.
 * The tracking test fetches the models: from public/assets/mediapipe/ (node scripts/fetch-mediapipe-models.mjs)
 * or, without them, from Google's model bucket.
 */
import { expect, test } from '@playwright/test';
import { gotoTitle, trackErrors } from './helpers';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

test('without ?gestures nothing of it loads', async ({ page }) => {
  const errors = trackErrors(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await gotoTitle(page);
  await expect(page.locator('#hf-root')).toHaveCount(0);
  expect(requests.filter((url) => /mediapipe|vision_wasm|tracker\.worker|HandsFree/i.test(url))).toEqual([]);
  errors.expectNone();
});

test('?gestures adds the panel; Start camera tracks, Stop releases the camera', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await gotoTitle(page, '?gestures');
  const root = page.locator('#hf-root');
  await expect(root).toHaveAttribute('data-status', 'off');
  await expect(page.locator('#hf-mode-hand')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
  await expect(page.locator('#hf-start')).toHaveText('Stop camera');
  // Frames go through the worker (the fake camera shows no hand, so nobody is tracked).
  await expect.poll(async () => Number(await root.getAttribute('data-frames')), { timeout: 60_000 }).toBeGreaterThan(2);
  await expect(root).toHaveAttribute('data-present', 'false');
  await expect(page.locator('#hf-cursor')).toBeHidden();

  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-status', 'off');
  const live = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('.hf-video');
    return video?.srcObject !== null && video?.srcObject !== undefined;
  });
  expect(live, 'the camera stream is released').toBe(false);
  // MediaPipe logs to the console through console.error ("INFO: Created TensorFlow Lite XNNPACK delegate").
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((text) => !/^INFO:|XNNPACK/.test(text))).toEqual([]);
});

test('switching mode while tracking restarts with the face model', async ({ page }) => {
  test.setTimeout(150_000);
  await gotoTitle(page, '?gestures');
  const root = page.locator('#hf-root');
  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
  await page.locator('#hf-mode-head').click();
  await expect(root).toHaveAttribute('data-mode', 'head');
  await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
  await expect.poll(async () => (await root.getAttribute('data-models')) ?? '', { timeout: 30_000 }).toContain('face_landmarker.task');
  await expect(page.locator('#hf-recentre')).toBeVisible();
});
