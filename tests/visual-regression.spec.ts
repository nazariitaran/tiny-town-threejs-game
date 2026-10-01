/**
 * Screenshot baselines for every state in STATES, on every project. Before comparing pixels the
 * scene must be settled and frozen, no cell hovered (the hover highlight fades on real time), no DOM
 * UI animation running (they run on real time, not the paused game clock) and two captures 400 ms
 * apart byte-identical.
 *
 * A missing baseline FAILS. Regenerate deliberately after an approved look change, then review every PNG:
 *   PORT=5210 npx playwright test tests/visual-regression.spec.ts --update-snapshots
 * Baselines are per OS (GPU raster and font hinting differ); only darwin baselines exist.
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
  { name: 'night-town', phase: 'building', minObjects: 1 },
] as const;

const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css' } as const;

const twoFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** CSS animations/transitions still running inside the DOM UI (real time, unaffected by pause). */
const runningUiAnimations = (page: Page) =>
  page.evaluate(() => {
    const root = document.getElementById('ui-root');
    return document
      .getAnimations()
      .filter((a) => a.playState === 'running' || a.pending)
      .map((a) => (a.effect as KeyframeEffect | null)?.target)
      .filter((el): el is Element => !!el && !!root?.contains(el))
      .map((el) => el.id || el.className);
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

    // DOM UI transitions run on real time: wait until none is still in flight.
    await expect.poll(() => runningUiAnimations(page), { message: 'UI animations settled' }).toEqual([]);

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
    await page.screenshot({ ...SHOT, path: `artifacts/visual-regression/visual-${state.name}-${testInfo.project.name}.png` });
    // The top-bar rectangle (CSS px) for masked baseline diffs (tests/tools/maskedDiff.ts).
    const topbar = await page.evaluate(() => {
      const el = document.querySelector('.ui-topbar');
      if (!el || (el as HTMLElement).hidden) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (topbar) console.log(`${state.name} ${testInfo.project.name} topbar ${JSON.stringify(topbar)}`);
    await testInfo.attach(`${state.name}-${testInfo.project.name}-diagnostics`, {
      body: JSON.stringify({ phase: b.phase, objects: b.objects, render: b.render, renderer: b.renderer, camera: b.camera, canvas: b.canvas, cars: b.life.cars, daytime: b.daytime, topbar }, null, 2),
      contentType: 'application/json',
    });
    errors.expectNone();
  });
}
