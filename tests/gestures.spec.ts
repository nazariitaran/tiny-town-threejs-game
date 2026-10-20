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

test('head mode: presets, bindings and timing are buttons, and they persist in this browser', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page, '?gestures=head');
  const root = page.locator('#hf-root');
  await expect(root).toHaveAttribute('data-preset', 'low-effort');
  // Dwell can't operate a select or drag a slider.
  await expect(page.locator('#hf-panel select, #hf-panel input[type="range"]')).toHaveCount(0);

  await page.locator('#hf-bindings summary').click();
  await expect(page.locator('#hf-bind-blink')).toHaveText('Click');
  await expect(page.locator('#hf-bind-long-blink')).toHaveText('Pause');
  // Winks wait for the eye test.
  await expect(page.locator('#hf-bind-wink-left')).toBeDisabled();
  await expect(page.locator('#hf-bind-wink-left')).toHaveText('Needs eye test');
  await expect(page.locator('#hf-bind-note')).toBeVisible();

  await page.locator('#hf-preset-classic').click();
  await expect(root).toHaveAttribute('data-preset', 'classic');
  await expect(page.locator('#hf-bind-mouth')).toHaveText('Hold to drag');
  await expect(page.locator('#hf-legend')).toContainText('Open your mouth');
  await page.locator('#hf-bind-smile').click();
  await expect(root).toHaveAttribute('data-preset', 'custom');

  await page.locator('#hf-set-key').click();
  await expect(page.locator('#hf-set-key')).toHaveText('Press a key…');
  await page.keyboard.press('KeyJ');
  await expect(page.locator('#hf-bind-name-key')).toHaveText('Key: J');

  await page.locator('#hf-timing summary').click();
  await expect(page.locator('#hf-bindings')).not.toHaveAttribute('open', '');
  await page.locator('[data-step="blinkMinS"][data-dir="1"]').click();
  await expect(page.locator('#hf-step-blinkMinS')).toHaveText('0.40 s');

  await page.reload();
  await expect(page.locator('#hf-root')).toHaveAttribute('data-preset', 'custom');
  await expect(page.locator('#hf-step-blinkMinS')).toHaveText('0.40 s');
  await expect(page.locator('#hf-bind-name-key')).toHaveText('Key: J');
  errors.expectNone();
});

test('head mode: tracking announces hands-free:changed, the eye test starts and cancels, Stop announces null', async ({ page }) => {
  test.setTimeout(150_000);
  await gotoTitle(page, '?gestures=head');
  const root = page.locator('#hf-root');
  await page.locator('#hf-eye-test summary').click();
  await page.locator('#hf-eye-test-start').click();
  await expect(page.locator('#hf-eye-test-text')).toContainText('Start the camera');

  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
  await expect(root).toHaveAttribute('data-announced', 'head');
  await page.locator('#hf-eye-test-start').click();
  await expect(root).toHaveAttribute('data-eye-test', 'open');
  await expect(page.locator('#hf-eye-test-text')).toContainText('eyes open');
  await page.locator('#hf-eye-test-cancel').click();
  await expect(root).toHaveAttribute('data-eye-test', 'idle');
  await expect(page.locator('#hf-eye-test-text')).toContainText('cancelled');

  // A mode change restarts the camera without announcing a stop in between.
  await page.locator('#hf-mode-head-hand').click();
  await expect(root).toHaveAttribute('data-announced', 'head-hand');
  await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-announced', 'none');
});

test('head mode: the Pointer section cycles source and style, they persist, and the fit starts and cancels', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await gotoTitle(page, '?gestures=head');
  const root = page.locator('#hf-root');
  // Collapsed by default: the panel already needs scrolling on short screens.
  await expect(page.locator('#hf-pointer')).not.toHaveAttribute('open', '');
  await page.locator('#hf-pointer summary').click();
  await expect(page.locator('#hf-pointer-source')).toHaveText('Nose');
  await expect(page.locator('#hf-pointer-style')).toHaveText('Direct');
  await expect(page.locator('#hf-fit-summary')).toContainText('not fitted');
  await expect(page.locator('#hf-fit-reset')).toBeDisabled();
  await page.locator('#hf-pointer-source').click();
  await page.locator('#hf-pointer-style').click();
  await expect(root).toHaveAttribute('data-pointer', 'angle joystick');
  await page.locator('#hf-fit-start').click();
  await expect(page.locator('#hf-fit-text')).toContainText('Start the camera');

  await page.reload();
  await expect(root).toHaveAttribute('data-pointer', 'angle joystick');
  await page.locator('#hf-pointer summary').click();
  await expect(page.locator('#hf-pointer-source')).toHaveText('Head angle');
  await expect(page.locator('#hf-pointer-style')).toHaveText('Joystick');
  await expect(page.locator('#hf-panel select, #hf-panel input[type="range"]')).toHaveCount(0);

  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
  await page.locator('#hf-fit-start').click();
  await expect(root).toHaveAttribute('data-fit', 'centre');
  await expect(page.locator('#hf-fit-text')).toContainText('middle of the screen');
  await expect(page.locator('#hf-fit-start')).toBeHidden();
  await expect(page.locator('#hf-fit-back')).toBeVisible();
  await page.locator('#hf-fit-cancel').click();
  await expect(root).toHaveAttribute('data-fit', 'idle');
  await expect(page.locator('#hf-fit-text')).toContainText('cancelled');
  await expect(page.locator('#hf-fit-start')).toBeVisible();
  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-status', 'off');
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((text) => !/^INFO:|XNNPACK/.test(text))).toEqual([]);
});

test('palms mode: the Hands section cycles and persists, and only the controls Palms uses show', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page, '?gestures=palms');
  const root = page.locator('#hf-root');
  await expect(page.locator('#hf-mode-palms')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#hf-mode-palms')).toHaveAttribute('title', /no finger gestures/);
  await expect(root).toHaveAttribute('data-family', 'palms');
  await expect(page.locator('#hf-panel select, #hf-panel input[type="range"]')).toHaveCount(0);

  // Face-only controls hide; the pointer's controls stay.
  await expect(page.locator('#hf-preset-low-effort')).toBeHidden();
  await expect(page.locator('#hf-eye-test')).toBeHidden();
  await expect(page.locator('#hf-step-sensitivity')).toBeVisible();
  await expect(page.locator('#hf-recentre')).toBeVisible();
  await expect(page.locator('#hf-dwell')).toBeVisible();
  await expect(page.locator('#hf-pointer')).toBeVisible();
  await expect(page.locator('#hf-legend')).toContainText('Move your right hand');
  await expect(page.locator('#hf-legend')).toContainText('Move your other hand up to click');

  await page.locator('#hf-hands summary').click();
  await expect(page.locator('#hf-pointing')).toHaveText('Right hand');
  await expect(page.locator('#hf-bind-lift')).toHaveText('Hold to drag');
  await expect(page.locator('#hf-rest-text')).toContainText('camera off');
  await expect(page.locator('#hf-click-fit-reset')).toBeDisabled();
  await page.locator('#hf-pointing').click();
  await page.locator('#hf-bind-lift').click();
  await expect(root).toHaveAttribute('data-pointing', 'left');
  await expect(root).toHaveAttribute('data-lift', 'drag-toggle');
  await expect(page.locator('#hf-legend')).toContainText('Move your left hand');
  await page.locator('#hf-click-fit-start').click();
  await expect(page.locator('#hf-click-fit-text')).toContainText('Start the camera');
  await expect(root).toHaveAttribute('data-click-fit', 'idle');

  await page.locator('#hf-pointer summary').click();
  await expect(page.locator('#hf-hands')).not.toHaveAttribute('open', '');
  await expect(page.locator('#hf-pointer-source')).toBeHidden();
  await expect(page.locator('#hf-pointer-style')).toBeVisible();
  await expect(root).toHaveAttribute('data-pointer', 'palm direct');
  await page.locator('#hf-bindings summary').click();
  await expect(page.locator('#hf-bind-key')).toBeVisible();
  await expect(page.locator('#hf-bind-blink')).toBeHidden();
  await page.locator('#hf-timing summary').click();
  await expect(page.locator('#hf-step-dwellS')).toBeVisible();
  await expect(page.locator('#hf-step-blinkMinS')).toBeHidden();

  await page.reload();
  await expect(root).toHaveAttribute('data-pointing', 'left');
  await expect(root).toHaveAttribute('data-lift', 'drag-toggle');
  await page.locator('#hf-hands summary').click();
  await expect(page.locator('#hf-pointing')).toHaveText('Left hand');
  await expect(page.locator('#hf-bind-lift')).toHaveText('Drag on / off');
  // One hand has no other hand to click with.
  await page.locator('#hf-pointing').click();
  await expect(page.locator('#hf-pointing')).toHaveText('One hand');
  await expect(page.locator('#hf-bind-lift')).toBeDisabled();
  await expect(page.locator('#hf-rest-text')).toContainText('One hand');
  await expect(page.locator('#hf-click-fit-start')).toBeHidden();
  await expect(page.locator('#hf-legend')).toContainText('Move either hand');
  errors.expectNone();
});

test('palms mode: tracking loads the hand model only, announces palms, and Fit my click starts and cancels', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await gotoTitle(page, '?gestures=palms');
  const root = page.locator('#hf-root');
  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
  await expect(root).toHaveAttribute('data-announced', 'palms');
  const models = (await root.getAttribute('data-models')) ?? '';
  expect(models).toContain('gesture_recognizer.task');
  expect(models).not.toContain('face_landmarker');
  await expect(page.locator('#hf-status')).toContainText('Show your hands');

  await page.locator('#hf-hands summary').click();
  await expect(page.locator('#hf-rest-text')).toHaveText('Other hand: not seen.');
  await expect(root).toHaveAttribute('data-rest', 'none');
  await page.locator('#hf-click-fit-start').click();
  await expect(root).toHaveAttribute('data-click-fit', 'rest');
  await expect(page.locator('#hf-click-fit-text')).toContainText('Rest your other hand');
  await expect(page.locator('#hf-click-fit-text')).toContainText("can't see your other hand");
  await expect(page.locator('#hf-click-fit-start')).toBeHidden();
  await expect(page.locator('#hf-click-fit-back')).toBeVisible();
  await page.locator('#hf-click-fit-cancel').click();
  await expect(root).toHaveAttribute('data-click-fit', 'idle');
  await expect(page.locator('#hf-click-fit-text')).toContainText('cancelled');

  await page.locator('#hf-pointer summary').click();
  await page.locator('#hf-fit-start').click();
  await expect(root).toHaveAttribute('data-fit', 'centre');
  await expect(page.locator('#hf-fit-text')).toContainText('Rest your pointing hand');
  await page.locator('#hf-fit-cancel').click();
  await expect(root).toHaveAttribute('data-fit', 'idle');

  await page.locator('#hf-start').click();
  await expect(root).toHaveAttribute('data-announced', 'none');
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((text) => !/^INFO:|XNNPACK/.test(text))).toEqual([]);
});
