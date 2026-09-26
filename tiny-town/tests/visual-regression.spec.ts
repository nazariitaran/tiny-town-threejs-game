/**
 * WP-09b visual regression: screenshot baselines for `title`, `sample-town` and `asset-gallery`
 * on every project (desktop-chrome 1280×720, mobile-chrome Pixel 7).
 *
 * Capture procedure (prepareDeterministicState in helpers.ts): load → unpause → seed(12345) →
 * setState (acknowledged) → pause → reduced motion → hide debug UI → fonts ready → 2 frames.
 * Then we assert the diagnostics are settled (no pop-in animations, renderer matches TownState,
 * no autosave pending) before comparing pixels, so a failing diff means the LOOK changed,
 * not that the capture raced the scene.
 *
 * Baselines are generated explicitly and never implicitly on a normal run:
 *   PORT=5210 npx playwright test tests/visual-regression.spec.ts --update-snapshots
 * With no baseline on disk and no --update-snapshots, a test is SKIPPED with a visible reason
 * (not failed), so `npm run test:e2e` stays green until the integrator commits baselines.
 * Baselines are per platform (GPU raster differs), e.g. `title-desktop-chrome-darwin.png`.
 */
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { diagnostics, prepareDeterministicState, trackErrors } from './helpers';

const SEED = 12345;
/** WebGL antialiasing may shift a few edge pixels between runs; layout/asset breaks are far larger. */
const MAX_DIFF_PIXEL_RATIO = 0.01;

const STATES = [
  { name: 'title', phase: 'title', minObjects: 0 },
  { name: 'sample-town', phase: 'building', minObjects: 1 },
  { name: 'asset-gallery', phase: 'building', minObjects: 1 },
] as const;

for (const state of STATES) {
  test(`visual baseline: ${state.name}`, async ({ page }, testInfo) => {
    const snapshot = `${state.name}.png`;
    const baseline = testInfo.snapshotPath(snapshot, { kind: 'screenshot' });
    const updating = testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed';
    test.skip(!updating && !existsSync(baseline), `no baseline yet at ${baseline}; generate with --update-snapshots`);

    const errors = trackErrors(page);
    await prepareDeterministicState(page, state.name, SEED);

    // The scene must be fully settled and frozen before a pixel comparison means anything.
    await expect
      .poll(async () => {
        const d = await diagnostics(page);
        return {
          phase: d.phase,
          matches: d.render.objects === d.objects,
          animating: d.render.animating ?? 0,
          dying: d.render.dying ?? 0,
          hasObjects: d.objects >= state.minObjects,
          savePending: d.save.pending,
        };
      }, { message: `${state.name} settled before capture` })
      .toEqual({ phase: state.phase, matches: true, animating: 0, dying: 0, hasObjects: true, savePending: false });

    // Paused means paused: the frame counter may tick (rendering continues) but the camera
    // and town must not move between two reads.
    const a = await diagnostics(page);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const b = await diagnostics(page);
    expect(b.camera, 'camera frozen while paused').toEqual(a.camera);
    expect(b.town, 'town frozen while paused').toEqual(a.town);

    await expect(page).toHaveScreenshot(snapshot, {
      maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      animations: 'disabled',
      caret: 'hide',
    });

    // Evidence copy (artifacts/ is gitignored) with the same settings as the baseline capture
    // (CSS animations finished, CSS-pixel scale), so the title's fade-in is never caught mid-way.
    await page.screenshot({
      path: `artifacts/wp-09b/visual-${state.name}-${testInfo.project.name}.png`,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });

    await testInfo.attach(`${state.name}-${testInfo.project.name}-diagnostics`, {
      body: JSON.stringify({ phase: b.phase, objects: b.objects, render: b.render, renderer: b.renderer, camera: b.camera, canvas: b.canvas }, null, 2),
      contentType: 'application/json',
    });
    errors.expectNone();
  });
}
