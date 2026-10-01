/** Smoke: boot without errors, the phase machine and the test-hook contract. Diagnostics only, no pixels. */
import { expect, test } from '@playwright/test';
import { applyState, attachJson, byId, diagnostics, gotoTitle, prepareDeterministicState, startBuilding, trackErrors, UI_TEST_IDS, waitFrames } from './helpers';

// Mirrors Game.TEST_STATES. Type-only reference (no runtime import of Game.ts into Node);
// the two checks below make `tsc` fail if a state is added to or removed from Game.ts.
type GameTestState = (typeof import('../src/game/Game'))['TEST_STATES'][number];
const TEST_STATES = ['title', 'empty-build', 'sample-town', 'active-play', 'asset-gallery', 'stress-town', 'night-town'] as const satisfies readonly GameTestState[];
type MissingStates = Exclude<GameTestState, (typeof TEST_STATES)[number]>;
export const allTestStatesCovered: [MissingStates] extends [never] ? true : false = true;

test('boots to title with no errors, and Start enters building', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);

  const title = await diagnostics(page);
  expect(title.phase).toBe('title');
  expect(title.tool).toBeNull();
  expect(title.objects).toBe(0);
  expect(title.canvas.clientWidth).toBeGreaterThan(0);
  expect(title.canvas.clientHeight).toBeGreaterThan(0);
  await expect(byId(page, UI_TEST_IDS.start)).toBeVisible();

  // The loop keeps running on the title screen.
  await waitFrames(page, 5);

  await startBuilding(page);
  const building = await diagnostics(page);
  expect(building.phase).toBe('building');
  expect(building.history).toMatchObject({ canUndo: false, canRedo: false });
  await waitFrames(page, 3);

  errors.expectNone();
});

test('every setState name is acknowledged; unknown states throw', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await gotoTitle(page);

  const summary: Record<string, unknown> = {};
  for (const name of TEST_STATES) {
    await applyState(page, name);
    await waitFrames(page, 2);
    const diag = await diagnostics(page);
    expect(diag.phase, `${name} phase`).toBe(name === 'title' ? 'title' : 'building');
    expect(diag.render.objects, `${name}: renderer draws every object in TownState`).toBe(diag.objects);
    // A state is a fresh setup: no undo history leaks in from a previous state.
    expect(diag.history.canRedo, `${name} redo`).toBe(false);
    if (name === 'title' || name === 'empty-build') {
      expect(diag.objects, `${name} objects`).toBe(0);
      expect(diag.town.roadTiles, `${name} roads`).toBe(0);
    } else {
      expect(diag.objects, `${name} objects`).toBeGreaterThan(0);
    }
    summary[name] = { phase: diag.phase, objects: diag.objects, town: diag.town, render: diag.render, calls: diag.renderer.calls };
  }

  // Same seed + same state → identical town (setState reseeds).
  await applyState(page, 'sample-town', 777);
  const first = (await diagnostics(page)).town;
  await applyState(page, 'stress-town', 777);
  await applyState(page, 'sample-town', 777);
  expect((await diagnostics(page)).town, 'sample-town is deterministic').toEqual(first);

  const unknown = await page.evaluate(async () => {
    try {
      await window.__THREE_GAME_TEST_HOOKS__!.setState('definitely-not-a-state');
      return { threw: false, message: '' };
    } catch (error) {
      return { threw: true, message: error instanceof Error ? error.message : String(error) };
    }
  });
  expect(unknown.threw, 'unknown setState must throw').toBe(true);
  expect(unknown.message).toContain('definitely-not-a-state');

  await attachJson(testInfo, `${testInfo.project.name}-states`, summary);
  errors.expectNone();
});

test('screenshot hooks freeze the scene while rendering continues', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await prepareDeterministicState(page, 'sample-town');
  const before = await diagnostics(page);
  await waitFrames(page, 10);
  const after = await diagnostics(page);
  expect(after.frame, 'loop keeps publishing while paused').toBeGreaterThan(before.frame);
  expect(after.camera, 'paused camera is still').toEqual(before.camera);
  expect(after.town).toEqual(before.town);
  expect(after.renderer.calls, 'paused scene still renders').toBeGreaterThan(0);
  await testInfo.attach(`${testInfo.project.name}-sample-town`, { body: await page.screenshot(), contentType: 'image/png' });
  errors.expectNone();
});
