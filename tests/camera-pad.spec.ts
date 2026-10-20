/**
 * On-screen camera controls (CameraPad): off by default, the menu switch shows them and is remembered,
 * real clicks turn, zoom, move and reset the camera (read from diagnostics `camera`), a held button
 * repeats, the Aim group follows the active tool, and head or Palms tracking shows the pad with the setting off.
 */
import { expect, test, type Page } from '@playwright/test';
import type { CameraStep } from '../src/game/events';
import type { Cell } from '../src/town/types';
import {
  byId,
  canvasPoint,
  diagnostics,
  expectDiagnostics,
  gotoTitle,
  groundAt,
  openMenuTab,
  savedTown,
  selectTool,
  startBuilding,
  trackErrors,
  UI_TEST_IDS,
  waitFrames,
} from './helpers';

// Chromium's fake camera for the tracking tests (a test pattern, no face or hand).
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

const ids = UI_TEST_IDS;
const FOV = (35 * Math.PI) / 180;
const DEG = Math.PI / 180;
/** Looking north (azimuth 0): screen right is +x, screen up is −z. */
const NORTH = { targetX: 0, targetZ: 0, azimuth: 0, polar: 52 * DEG, distance: 30 };

const camera = async (page: Page) => (await diagnostics(page)).camera;
const pad = (page: Page) => byId(page, ids.cameraPad);
const stepButton = (page: Page, step: CameraStep) => byId(page, ids.cameraStep(step));

/** Waits until the camera holds still for a few rendered frames and 150 ms, then returns its pose. */
async function settledCamera(page: Page): Promise<Diagnostics['camera']> {
  let last = JSON.stringify(await camera(page));
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(150);
        await waitFrames(page, 4);
        const now = JSON.stringify(await camera(page));
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  return JSON.parse(last);
}

type Diagnostics = ThreeGameDiagnostics;

async function turnPadOn(page: Page): Promise<void> {
  await openMenuTab(page, 'graphics');
  const toggle = byId(page, ids.cameraPadSwitch);
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('building');
  await expect(pad(page)).toBeVisible();
}

/** Screen-direction components of a target move: right = (cosθ, −sinθ), forward = (−sinθ, −cosθ). */
function screenMove(from: Diagnostics['camera'], to: Diagnostics['camera']): { right: number; forward: number } {
  const dx = to.targetX - from.targetX;
  const dz = to.targetZ - from.targetZ;
  const theta = from.azimuth;
  return { right: dx * Math.cos(theta) - dz * Math.sin(theta), forward: -dx * Math.sin(theta) - dz * Math.cos(theta) };
}

test('the pad is off by default; the menu switch shows it, and it is remembered after a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await expect(pad(page)).toBeHidden();
  await startBuilding(page);
  await expect(pad(page)).toBeHidden();

  await turnPadOn(page);
  // Every pad button is a big target with a name and a key in its tooltip.
  for (const button of await pad(page).locator('button:visible').all()) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(64);
    expect(box.height).toBeGreaterThanOrEqual(64);
    await expect(button).toHaveAttribute('aria-label', /\S/);
    await expect(button).toHaveAttribute('title', /\S/);
  }
  await expect(stepButton(page, 'orbit-left')).toHaveAttribute('title', 'Rotate left (Q)');
  for (const step of ['orbit-left', 'orbit-right', 'zoom-in', 'zoom-out', 'pan-up', 'pan-down', 'pan-left', 'pan-right'] as const) {
    await expect(stepButton(page, step)).toHaveAttribute('data-repeat', '');
  }
  await expect(byId(page, ids.cameraReset)).not.toHaveAttribute('data-repeat', /.*/);

  // The panels between the buttons let clicks through to the map.
  const group = (await pad(page).locator('.ui-pad-group').first().boundingBox())!;
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: group.x + 3, y: group.y + group.height / 2 });
  expect(hit).toBe('game-canvas');

  // Hidden in the menu, back in the building phase.
  await byId(page, ids.menu).click();
  await expect(pad(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(pad(page)).toBeVisible();

  await gotoTitle(page);
  await expect(pad(page)).toBeHidden();
  await startBuilding(page);
  await expect(pad(page)).toBeVisible();
  await openMenuTab(page, 'graphics');
  await expect(byId(page, ids.cameraPadSwitch)).toBeChecked();
  await byId(page, ids.cameraPadSwitch).click();
  await page.keyboard.press('Escape');
  await expect(pad(page)).toBeHidden();
  errors.expectNone();
});

test('clicks on the pad turn, zoom, move and reset the camera', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await turnPadOn(page);
  const home = await settledCamera(page);

  await stepButton(page, 'orbit-right').click();
  let pose = await settledCamera(page);
  expect(pose.azimuth - home.azimuth).toBeCloseTo(45 * DEG, 3);
  await stepButton(page, 'orbit-left').click();
  await stepButton(page, 'orbit-left').click();
  pose = await settledCamera(page);
  expect(pose.azimuth - home.azimuth).toBeCloseTo(-45 * DEG, 3);

  await stepButton(page, 'zoom-in').click();
  pose = await settledCamera(page);
  expect(pose.distance).toBeCloseTo(home.distance / 1.25, 3);
  await stepButton(page, 'zoom-out').click();
  pose = await settledCamera(page);
  expect(pose.distance).toBeCloseTo(home.distance, 3);

  // One pan step: a quarter of the visible height, in the screen direction of the button.
  const quarter = 0.25 * 2 * pose.distance * Math.tan(FOV / 2);
  const checks: Array<[CameraStep, 'right' | 'forward', number]> = [
    ['pan-up', 'forward', 1],
    ['pan-down', 'forward', -1],
    ['pan-right', 'right', 1],
    ['pan-left', 'right', -1],
  ];
  for (const [step, axis, sign] of checks) {
    const before = await settledCamera(page);
    await stepButton(page, step).click();
    const after = await settledCamera(page);
    const move = screenMove(before, after);
    const expected = axis === 'forward' ? quarter / Math.cos(before.polar) : quarter;
    expect(move[axis] * sign, step).toBeCloseTo(expected, 1);
    expect(Math.abs(axis === 'forward' ? move.right : move.forward), step).toBeLessThan(0.01);
  }

  // Keyboard Enter on a focused button: exactly one step.
  const before = await settledCamera(page);
  await stepButton(page, 'orbit-right').focus();
  await page.keyboard.press('Enter');
  pose = await settledCamera(page);
  expect(pose.azimuth - before.azimuth).toBeCloseTo(45 * DEG, 3);

  await byId(page, ids.cameraReset).click();
  pose = await settledCamera(page);
  expect(pose.targetX).toBeCloseTo(home.targetX, 2);
  expect(pose.targetZ).toBeCloseTo(home.targetZ, 2);
  expect(pose.distance).toBeCloseTo(home.distance, 2);
  expect(Math.cos(pose.azimuth - home.azimuth)).toBeCloseTo(1, 4);
  errors.expectNone();
});

test('holding a pan button repeats it until release', async ({ page }) => {
  await gotoTitle(page);
  await startBuilding(page);
  await turnPadOn(page);
  // Closer in, so the held pan stays inside the plot's limits.
  for (let i = 0; i < 3; i += 1) await stepButton(page, 'zoom-in').click();
  const start = await settledCamera(page);
  const quarter = 0.25 * 2 * start.distance * Math.tan(FOV / 2);

  const box = (await stepButton(page, 'pan-right').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1300); // at once, at 450 ms, then every 250 ms: 5 steps
  await page.mouse.up();
  const held = await settledCamera(page);
  const steps = screenMove(start, held).right / quarter;
  expect(steps).toBeGreaterThan(3.5);
  expect(steps).toBeLessThan(6.5);

  // Nothing more after the release.
  await page.waitForTimeout(600);
  expect(await camera(page)).toEqual(held);

  // Leaving the button while held stops the repeat.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + box.height / 2);
  await page.waitForTimeout(1000);
  await page.mouse.up();
  const left = await settledCamera(page);
  expect(screenMove(held, left).right / quarter).toBeCloseTo(1, 1);
});

test('the Aim group shows only while a tool is active', async ({ page }) => {
  await gotoTitle(page);
  await startBuilding(page);
  await turnPadOn(page);
  const aim = byId(page, ids.aimGroup);
  await expect(aim).toBeHidden();
  await selectTool(page, 'road');
  await expect(aim).toBeVisible();
  for (const direction of ['up', 'down', 'left', 'right'] as const) {
    await expect(byId(page, ids.aimNudge(direction))).toHaveAttribute('data-repeat', '');
  }
  await expect(byId(page, ids.aimPlace)).toBeEnabled();
  await expect(byId(page, ids.aimPlace)).not.toHaveAttribute('data-repeat', /.*/);
  await page.keyboard.press('Escape'); // puts the tool away
  await expect.poll(async () => (await diagnostics(page)).tool).toBeNull();
  await expect(aim).toBeHidden();
  await selectTool(page, 'move');
  await expect(aim).toBeVisible();
});

test.describe('head tracking', () => {
  test('head tracking shows the pad with the setting off; stopping the camera hides it', async ({ page }) => {
    test.setTimeout(150_000);
    await gotoTitle(page, '?gestures');
    await startBuilding(page);
    await expect(pad(page)).toBeHidden();
    const root = page.locator('#hf-root');
    if ((await root.getAttribute('data-panel')) === 'closed') await page.locator('#hf-toggle').click();
    await page.locator('#hf-mode-head').click();
    await page.locator('#hf-start').click();
    await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
    await expect(pad(page)).toBeVisible();
    await openMenuTab(page, 'graphics');
    await expect(byId(page, ids.cameraPadSwitch), 'the setting stays off').not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(pad(page)).toBeVisible();

    await page.locator('#hf-start').click();
    await expect(root).toHaveAttribute('data-status', 'off');
    await expect(pad(page)).toBeHidden();
  });

  test('Palms tracking shows the pad with the setting off; stopping the camera hides it', async ({ page }) => {
    test.setTimeout(150_000);
    await gotoTitle(page, '?gestures=palms');
    await startBuilding(page);
    await expect(pad(page)).toBeHidden();
    const root = page.locator('#hf-root');
    if ((await root.getAttribute('data-panel')) === 'closed') await page.locator('#hf-toggle').click();
    await page.locator('#hf-start').click();
    await expect(root).toHaveAttribute('data-status', 'tracking', { timeout: 90_000 });
    await expect(pad(page)).toBeVisible();
    await openMenuTab(page, 'graphics');
    await expect(byId(page, ids.cameraPadSwitch), 'the setting stays off').not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(pad(page)).toBeVisible();

    await page.locator('#hf-start').click();
    await expect(root).toHaveAttribute('data-status', 'off');
    await expect(pad(page)).toBeHidden();
  });
});

test('the Aim buttons nudge and place with real clicks', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await turnPadOn(page);
  await page.evaluate((pose) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose(pose), NORTH);
  await settledCamera(page);
  await selectTool(page, 'pavement');

  const clickCenter = async (locator: ReturnType<Page['locator']>) => {
    const box = (await locator.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };

  // Rest the real mouse on (30, 30), then jump straight onto the pad: one move, so no other cell is crossed.
  const start: Cell = { x: 30, z: 30 };
  const point = await canvasPoint(page, start.x, start.z);
  await page.mouse.move(point.x, point.y);
  await expect.poll(async () => (await diagnostics(page)).hover).toMatchObject({ x: start.x, z: start.z });
  const right = byId(page, ids.aimNudge('right'));
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await diagnostics(page)).hover).toBeNull();

  // Screen right twice, screen down once: +2 in x, +1 in z.
  await clickCenter(right);
  await clickCenter(right);
  await clickCenter(byId(page, ids.aimNudge('down')));
  const aimed: Cell = { x: start.x + 2, z: start.z + 1 };
  await expect.poll(async () => (await diagnostics(page)).aim).toEqual(aimed);
  await expect(byId(page, ids.aimGroup)).toHaveAttribute('data-aimed', 'true');

  await clickCenter(byId(page, ids.aimPlace));
  await expectDiagnostics(page, { history: { undoDepth: 1 } }, 'one pavement stroke');
  expect(groundAt(await savedTown(page), aimed)).toBe('pavement');
  expect(groundAt(await savedTown(page), start)).toBe('field');

  // Placing again on the same cell changes nothing: no new undo step.
  await clickCenter(byId(page, ids.aimPlace));
  await page.waitForTimeout(100);
  expect((await diagnostics(page)).history.undoDepth).toBe(1);
  expect((await diagnostics(page)).aim).toEqual(aimed);

  // A camera button keeps the aim.
  const before = await settledCamera(page);
  await clickCenter(stepButton(page, 'orbit-left'));
  const after = await settledCamera(page);
  expect(after.azimuth - before.azimuth).toBeCloseTo(-45 * DEG, 3);
  expect((await diagnostics(page)).aim).toEqual(aimed);
  errors.expectNone();
});
