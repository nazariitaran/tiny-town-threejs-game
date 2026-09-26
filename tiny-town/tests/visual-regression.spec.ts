/**
 * WP-09b visual regression: screenshot baselines for `title`, `sample-town` and `asset-gallery`
 * on every project (desktop-chrome 1280×720, mobile-chrome Pixel 7).
 *
 * Capture procedure (prepareDeterministicState in helpers.ts): load → reduced motion → pause →
 * seed(12345) → setState (acknowledged, built while already frozen) → hide debug UI → fonts →
 * 2 frames. Before comparing pixels we also require:
 *  - settled diagnostics (renderer matches TownState, no pop-in/dying, no particles, no autosave
 *    pending) and a frozen camera, town and car set across frames;
 *  - no hovered cell (the hover highlight fades on real time; the mouse never enters the canvas);
 *  - the stats HUD count-up (real-time rAF) finished: every HUD number equals diagnostics.town;
 *  - two captures 400 ms apart are byte-identical, so nothing on screen is still moving.
 *
 * Baselines are committed under tests/visual-regression.spec.ts-snapshots/. A missing baseline
 * FAILS. Regenerate deliberately after an approved look change:
 *   PORT=5210 npx playwright test tests/visual-regression.spec.ts --update-snapshots
 * and review every PNG before committing.
 *
 * Platform caveat: baselines are per OS (Playwright appends the platform, e.g.
 * `title-desktop-chrome-darwin.png`) because GPU raster and font hinting differ. Only darwin
 * baselines exist; a Linux CI job would fail on missing `-linux` files until it generates and
 * commits its own set (ideally from the same pinned Playwright/Chromium Docker image it runs in).
 */
import { expect, test, type Page } from '@playwright/test';
import { diagnostics, prepareDeterministicState, trackErrors } from './helpers';

const SEED = 12345;
/** WebGL antialiasing may shift a few edge pixels between runs; layout/asset breaks are far larger. */
const MAX_DIFF_PIXEL_RATIO = 0.01;

const STATES = [
  { name: 'title', phase: 'title', minObjects: 0 },
  { name: 'sample-town', phase: 'building', minObjects: 1 },
  { name: 'asset-gallery', phase: 'building', minObjects: 1 },
] as const;

const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css' } as const;

const twoFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Numbers shown by the stats HUD (WP-06), keyed by data-stat. */
const hudNumbers = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const el of document.querySelectorAll<HTMLElement>('#ui-stats [data-stat]')) {
      out[el.dataset.stat!] = Number(el.querySelector('.ui-stat-num')?.textContent ?? NaN);
    }
    return out;
  });

for (const state of STATES) {
  test(`visual baseline: ${state.name}`, async ({ page }, testInfo) => {
    const snapshot = `${state.name}.png`;
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
          particles: d.fx.active,
          hover: d.hover,
          hasObjects: d.objects >= state.minObjects,
          savePending: d.save.pending,
        };
      }, { message: `${state.name} settled before capture` })
      .toEqual({ phase: state.phase, matches: true, animating: 0, dying: 0, particles: 0, hover: null, hasObjects: true, savePending: false });

    // Stats HUD count-up runs on real time: wait until it shows the final town stats.
    if (state.phase === 'building') {
      const town = (await diagnostics(page)).town;
      await expect
        .poll(() => hudNumbers(page), { message: 'stats HUD finished counting' })
        .toEqual({ homes: town.homes, residents: town.residents, trees: town.trees, roadTiles: town.roadTiles });
    }

    // Paused means paused: frames still render, but camera, town and cars must not move.
    const a = await diagnostics(page);
    await twoFrames(page);
    const b = await diagnostics(page);
    expect(b.frame, 'rendering continues while paused').toBeGreaterThan(a.frame);
    expect(b.camera, 'camera frozen while paused').toEqual(a.camera);
    expect(b.town, 'town frozen while paused').toEqual(a.town);
    expect(b.life.carCells, 'cars frozen while paused').toEqual(a.life.carCells);

    // Pixel stability independent of the baseline: two captures 400 ms apart are identical.
    const first = await page.screenshot(SHOT);
    await page.waitForTimeout(400);
    const second = await page.screenshot(SHOT);
    expect(Buffer.compare(first, second), `${state.name}: screen still changing while frozen`).toBe(0);

    await expect(page).toHaveScreenshot(snapshot, { maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO, animations: 'disabled', caret: 'hide' });

    // Evidence copy (artifacts/ is gitignored) for hand-offs.
    await page.screenshot({ ...SHOT, path: `artifacts/wp-09b/visual-${state.name}-${testInfo.project.name}.png` });
    await testInfo.attach(`${state.name}-${testInfo.project.name}-diagnostics`, {
      body: JSON.stringify({ phase: b.phase, objects: b.objects, render: b.render, renderer: b.renderer, camera: b.camera, canvas: b.canvas, cars: b.life.cars }, null, 2),
      contentType: 'application/json',
    });
    errors.expectNone();
  });
}
