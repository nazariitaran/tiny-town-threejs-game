/**
 * Day/night controls. `setState`, `setTimeOfDay` and `setReducedMotion` are used for setup, or are
 * themselves the hook under test; everything else is real input.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TIME_MODES, T_AFTERNOON, T_MORNING, T_NIGHT, type TimeMode } from '../src/world/dayCycle';
import { applyState, byId, canvasPoint, diagnostics, gotoTitle, openMenuTab, selectTool, startBuilding, trackErrors, UI_TEST_IDS, waitFrames } from './helpers';

const NIGHT_LOOK = true;
const NIGHT_LOOK_REASON = 'needs the real night look (WP-16a/16b), enabled in WP-16c phase 2';

/** buildSampleTown places exactly 4 lampposts. */
const SAMPLE_TOWN_LAMPPOSTS = 4;
const OUT = 'artifacts/wp-16c';
const LABEL: Record<TimeMode, string> = { auto: 'Auto', day: 'Day', night: 'Night' };

const daytime = async (page: Page) => (await diagnostics(page)).daytime;
const timeButton = (page: Page) => byId(page, UI_TEST_IDS.timeMode);

async function expectButtonShows(page: Page, mode: TimeMode): Promise<void> {
  const button = timeButton(page);
  await expect(button).toHaveAttribute('data-mode', mode);
  await expect(button).toHaveAttribute('aria-label', `Time of day: ${LABEL[mode]}`);
  await expect(button).toHaveAttribute('title', `Time: ${LABEL[mode]} (T)`);
}

async function expectMode(page: Page, mode: TimeMode): Promise<void> {
  await expect.poll(async () => (await daytime(page)).mode, { message: `daytime.mode → ${mode}` }).toBe(mode);
  await expectButtonShows(page, mode);
}

/** Top-bar facts: the time button's place and size, one row, nothing off-screen or overlapping. */
const topBarLayout = (page: Page) =>
  page.evaluate(
    (ids) => {
      const button = document.getElementById(ids.timeMode)!;
      const r = (el: Element) => el.getBoundingClientRect();
      const brand = r(document.querySelector('.ui-brand')!);
      const actions = r(document.querySelector('.ui-actions')!);
      // The Town file button is display:none on phones (it lives in the menu there).
      const shown = [...document.querySelectorAll('.ui-actions button')].filter((b) => r(b).width > 0);
      return {
        parent: button.parentElement!.classList.contains('ui-actions'),
        next: button.nextElementSibling?.id,
        order: shown.map((b) => b.id),
        size: [r(button).width, r(button).height],
        oneRow: !(brand.bottom <= actions.top || actions.bottom <= brand.top),
        inViewport: actions.right <= window.innerWidth + 0.5 && brand.left >= -0.5,
        overlap: brand.right > actions.left,
        targets: shown.map((b) => Math.min(r(b).width, r(b).height)),
      };
    },
    { timeMode: UI_TEST_IDS.timeMode },
  );

test.describe('time button (top bar)', () => {
  test('sits in the action pill left of mute, one row, ≥ 44 px on touch', async ({ page }, info) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await startBuilding(page);
    const layout = await topBarLayout(page);
    expect(layout.parent).toBe(true);
    expect(layout.next).toBe(UI_TEST_IDS.mute);
    // The Town file button shows on screens wider than 440 px only (phones reach it through the menu).
    const file = info.project.name === 'mobile-chrome' ? [] : [UI_TEST_IDS.townFile];
    expect(layout.order).toEqual([UI_TEST_IDS.undo, UI_TEST_IDS.redo, ...file, UI_TEST_IDS.photo, UI_TEST_IDS.timeMode, UI_TEST_IDS.mute, UI_TEST_IDS.menu]);
    expect(layout.oneRow, 'top bar is one row').toBe(true);
    expect(layout.inViewport).toBe(true);
    expect(layout.overlap, 'brand × actions').toBe(false);
    if (info.project.name === 'mobile-chrome') {
      expect(layout.size[0]).toBeGreaterThanOrEqual(44);
      expect(layout.size[1]).toBeGreaterThanOrEqual(44);
      expect(Math.min(...layout.targets), 'every top-bar target ≥ 44 px').toBeGreaterThanOrEqual(44);
    }
    mkdirSync(OUT, { recursive: true });
    await page.locator('.ui-topbar').screenshot({ path: `${OUT}/topbar-${info.project.name}.png` });
    errors.expectNone();
  });

  test('one row with 44 px targets on narrow phones (390 × 844, 360 × 640)', async ({ browser }, info) => {
    test.skip(info.project.name === 'mobile-chrome', 'runs its own phone viewports once');
    for (const [width, height] of [
      [390, 844],
      [360, 640],
    ] as const) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await gotoTitle(page);
      await startBuilding(page);
      const layout = await topBarLayout(page);
      expect(layout.oneRow, `${width}: one row`).toBe(true);
      expect(layout.inViewport, `${width}: in viewport`).toBe(true);
      expect(layout.overlap, `${width}: brand × actions`).toBe(false);
      expect(Math.min(...layout.targets), `${width}: targets ≥ 44 px`).toBeGreaterThanOrEqual(44);
      mkdirSync(OUT, { recursive: true });
      await page.locator('.ui-topbar').screenshot({ path: `${OUT}/topbar-${width}x${height}.png` });
      errors.expectNone();
      await context.close();
    }
  });

  test('clicking cycles auto → day → night → auto', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await startBuilding(page);
    await expectMode(page, 'auto');
    for (const mode of [...TIME_MODES.slice(1), TIME_MODES[0]]) {
      await timeButton(page).click();
      await expectMode(page, mode);
    }
    // Day and Night pin their fixed times once the switch has settled (the sweep is ≤ 2.5 s).
    await timeButton(page).click();
    await expectMode(page, 'day');
    await expect.poll(async () => (await daytime(page)).t, { timeout: 5_000 }).toBeCloseTo(T_AFTERNOON, 5);
    await timeButton(page).click();
    await expectMode(page, 'night');
    await expect.poll(async () => (await daytime(page)).t, { timeout: 5_000 }).toBeCloseTo(T_NIGHT, 5);
    expect((await daytime(page)).phase).toBe('night');
    errors.expectNone();
  });

  test('the chosen mode survives a reload: restored before Start, applied on Start', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await startBuilding(page);
    await timeButton(page).click(); // day
    await timeButton(page).click(); // night
    await expectMode(page, 'night');

    await page.reload();
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
    // Restored from settings at boot; the title screen itself always shows the afternoon.
    await expect.poll(async () => (await daytime(page)).mode).toBe('night');
    await expectButtonShows(page, 'night');
    await expect(byId(page, UI_TEST_IDS.timeModeOption('night'))).toBeChecked();
    const title = await daytime(page);
    expect(title.t).toBeCloseTo(T_AFTERNOON, 5);
    expect(title.phase).toBe('day');
    expect(title.pinned).toBe(false);

    await startBuilding(page);
    await expect.poll(async () => (await daytime(page)).t).toBeCloseTo(T_NIGHT, 5);
    expect((await daytime(page)).phase).toBe('night');
    await expect(timeButton(page)).toBeVisible();
    await expectButtonShows(page, 'night');

    // Back to Auto: a new session starts in the morning.
    await timeButton(page).click();
    await expectMode(page, 'auto');
    await page.reload();
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
    await expect.poll(async () => (await daytime(page)).mode).toBe('auto');
    await startBuilding(page);
    const t = (await daytime(page)).t;
    expect(t).toBeGreaterThanOrEqual(T_MORNING);
    expect(t).toBeLessThan(T_MORNING + 0.01);
    errors.expectNone();
  });

  test('T cycles the mode while building (not on the title screen)', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chrome', 'keyboard shortcuts are a desktop affordance');
    const errors = trackErrors(page);
    await gotoTitle(page);
    await page.keyboard.press('KeyT');
    await waitFrames(page, 3);
    expect((await daytime(page)).mode, 'T is ignored on the title screen').toBe('auto');
    await startBuilding(page);
    await page.locator('#game-canvas').focus();
    for (const mode of ['day', 'night', 'auto'] as const) {
      await page.keyboard.press('KeyT');
      await expectMode(page, mode);
    }
    // Paused in the menu: T does nothing.
    await byId(page, UI_TEST_IDS.menu).click();
    await expect.poll(async () => (await diagnostics(page)).phase).toBe('menu');
    await page.keyboard.press('KeyT');
    await waitFrames(page, 3);
    expect((await daytime(page)).mode).toBe('auto');
    errors.expectNone();
  });
});

test('menu "Time of day" row sets the mode and follows the button', async ({ page }, info) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await openMenuTab(page, 'town');
  const group = byId(page, UI_TEST_IDS.timeModeGroup);
  await expect(group).toBeVisible();
  // Measure after the panel's pop-in (a scale animation) has finished.
  await expect.poll(() => byId(page, UI_TEST_IDS.menuPanel).evaluate((el) => el.getAnimations().length)).toBe(0);
  await expect(group).toHaveAttribute('role', 'radiogroup');
  await expect(byId(page, UI_TEST_IDS.timeModeOption('auto'))).toBeChecked();

  // Row + segments: ≥ 44 px row, segments inside the panel, ≥ 44 px segments on touch.
  const panel = (await byId(page, UI_TEST_IDS.menuPanel).boundingBox())!;
  const row = (await group.locator('xpath=ancestor::*[contains(@class,"ui-field")][1]').boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(44);
  for (const mode of TIME_MODES) {
    const seg = (await byId(page, UI_TEST_IDS.timeModeOption(mode)).locator('xpath=..').boundingBox())!;
    expect(seg.x).toBeGreaterThanOrEqual(panel.x);
    expect(seg.x + seg.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    if (info.project.name === 'mobile-chrome') expect(seg.height).toBeGreaterThanOrEqual(44);
  }

  for (const mode of ['night', 'day', 'auto'] as const) {
    // A real click on the segment (the invisible radio covers it, so it takes the click).
    await group.locator('.ui-seg-opt', { hasText: LABEL[mode] }).click();
    await expectMode(page, mode);
    await expect(byId(page, UI_TEST_IDS.timeModeOption(mode))).toBeChecked();
  }

  if (info.project.name !== 'mobile-chrome') {
    // Native radiogroup keyboard: arrows move the choice; Esc still closes the menu from a radio.
    await byId(page, UI_TEST_IDS.timeModeOption('auto')).focus();
    await page.keyboard.press('ArrowRight');
    await expectMode(page, 'day');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await diagnostics(page)).phase).toBe('building');
    await openMenuTab(page, 'town');
  }

  // The row follows a change made elsewhere (the top-bar button, via daytime:changed).
  await byId(page, UI_TEST_IDS.resume).click();
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('building');
  const before = (await daytime(page)).mode;
  await timeButton(page).click();
  const after = TIME_MODES[(TIME_MODES.indexOf(before) + 1) % TIME_MODES.length];
  await expectMode(page, after);
  await openMenuTab(page, 'town');
  await expect(byId(page, UI_TEST_IDS.timeModeOption(after))).toBeChecked();
  mkdirSync(OUT, { recursive: true });
  await byId(page, UI_TEST_IDS.menuPanel).screenshot({ path: `${OUT}/menu-time-of-day-${info.project.name}.png` });
  errors.expectNone();
});

test('help lists the T key', async ({ page }) => {
  await gotoTitle(page);
  await startBuilding(page);
  await openMenuTab(page, 'help');
  await byId(page, UI_TEST_IDS.help).click();
  const help = byId(page, UI_TEST_IDS.helpPanel);
  await expect(help).toBeVisible();
  await expect(help.locator('dt', { hasText: /^T$/ })).toHaveCount(1);
  await expect(help.locator('dt', { hasText: /^T$/ }).locator('xpath=following-sibling::dd[1]')).toContainText('Time of day');
});

test('setTimeOfDay pins and releases the clock', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  const setTime = (t: number | null) => page.evaluate((value) => window.__THREE_GAME_TEST_HOOKS__!.setTimeOfDay(value), t);

  await setTime(0.3);
  let d = await daytime(page);
  expect(d.pinned).toBe(true);
  expect(d.t).toBeCloseTo(0.3, 6);
  await waitFrames(page, 10);
  expect((await daytime(page)).t, 'a pin holds while the Auto clock runs').toBeCloseTo(0.3, 6);

  await setTime(T_NIGHT);
  d = await daytime(page);
  expect(d).toMatchObject({ pinned: true, phase: 'night' });
  expect(d.t).toBeCloseTo(T_NIGHT, 6);

  await setTime(1.7); // wraps into [0, 1)
  expect((await daytime(page)).t).toBeCloseTo(0.7, 6);

  await setTime(null);
  d = await daytime(page);
  expect(d.pinned).toBe(false);
  expect(d.mode).toBe('auto');
  // Released: back to the running Auto clock (started in the morning a moment ago).
  expect(d.t).toBeGreaterThanOrEqual(T_MORNING);
  expect(d.t).toBeLessThan(T_MORNING + 0.02);

  const bad = await page.evaluate(() => {
    try {
      window.__THREE_GAME_TEST_HOOKS__!.setTimeOfDay(Number.NaN);
      return false;
    } catch {
      return true;
    }
  });
  expect(bad, 'setTimeOfDay(NaN) throws').toBe(true);
  errors.expectNone();
});

test('night-town state: sample town pinned at T_NIGHT', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await applyState(page, 'night-town');
  const d = await diagnostics(page);
  expect(d.phase).toBe('building');
  expect(d.objects).toBeGreaterThan(0);
  expect(d.daytime.pinned).toBe(true);
  expect(d.daytime.t).toBeCloseTo(T_NIGHT, 5);
  expect(d.daytime.phase).toBe('night');
  // Every other state pins the afternoon.
  await applyState(page, 'sample-town');
  const s = (await diagnostics(page)).daytime;
  expect(s.pinned).toBe(true);
  expect(s.t).toBeCloseTo(T_AFTERNOON, 5);
  expect(s.night).toBe(0);
  expect(s.drawCalls).toBe(0);
  errors.expectNone();
});

test('reduced motion: the clock is frozen and mode switches snap', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  // Normal motion: the Auto clock runs while building.
  const t0 = (await daytime(page)).t;
  await expect.poll(async () => (await daytime(page)).t, { message: 'Auto clock advances' }).toBeGreaterThan(t0);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
  const frozen = (await daytime(page)).t;
  await page.waitForTimeout(1_000);
  await waitFrames(page, 5);
  expect((await daytime(page)).t, 'clock frozen under reduced motion').toBe(frozen);

  // Mode switches land on their target at once (no 2.5 s sweep).
  await timeButton(page).click(); // → day
  await expect.poll(async () => (await daytime(page)).t, { timeout: 500 }).toBeCloseTo(T_AFTERNOON, 6);
  await timeButton(page).click(); // → night
  await expect.poll(async () => (await daytime(page)).t, { timeout: 500 }).toBeCloseTo(T_NIGHT, 6);
  expect((await daytime(page)).phase).toBe('night');
  if (NIGHT_LOOK) expect((await daytime(page)).night).toBeGreaterThan(0.95);
  await timeButton(page).click(); // → auto: continues from the current t, still frozen
  await expectMode(page, 'auto');
  await page.waitForTimeout(500);
  expect((await daytime(page)).t).toBeCloseTo(T_NIGHT, 6);
  errors.expectNone();
});

test.describe('night look (phase 2)', () => {
  test.skip(!NIGHT_LOOK, NIGHT_LOOK_REASON);

  test('night-town: full night, lit windows, a light per lamppost', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'night-town');
    await waitFrames(page, 2);
    const d = (await diagnostics(page)).daytime;
    expect(d.night).toBeGreaterThan(0.95);
    expect(d.lightsOn).toBeGreaterThan(0.9);
    expect(d.lamps).toBe(SAMPLE_TOWN_LAMPPOSTS);
    expect(d.drawCalls, 'pools (+ halos on high tier) drawn at night').toBeGreaterThanOrEqual(1);
    // Back to afternoon: every light source is off and adds no draw calls.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setTimeOfDay(0.55));
    const day = (await diagnostics(page)).daytime;
    expect(day.night).toBe(0);
    expect(day.drawCalls).toBe(0);
    errors.expectNone();
  });

  test('a lamppost placed at night is tracked; undo removes it', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'empty-build');
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setTimeOfDay(0.82));
    expect((await daytime(page)).lamps).toBe(0);
    await selectTool(page, 'lamppost');
    const p = await canvasPoint(page, 24, 20);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await daytime(page)).lamps).toBe(1);
    await byId(page, UI_TEST_IDS.undo).click();
    await expect.poll(async () => (await daytime(page)).lamps).toBe(0);
    errors.expectNone();
  });

  test('without reduced motion a mode switch sweeps forward over ~2.5 s', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await startBuilding(page);
    await timeButton(page).click(); // → day (sweeps from the morning)
    await expect.poll(async () => (await daytime(page)).t, { timeout: 6_000 }).toBeCloseTo(T_AFTERNOON, 5);
    await timeButton(page).click(); // → night: 0.55 → 0.82 through dusk
    const seen = new Set<string>();
    const samples: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const d = await daytime(page);
      samples.push(d.t);
      seen.add(d.phase);
      if (Math.abs(d.t - T_NIGHT) < 1e-6) break;
      await page.waitForTimeout(100);
    }
    expect(samples.some((t) => t > T_AFTERNOON + 0.01 && t < T_NIGHT - 0.01), `in-between t: ${samples.join(', ')}`).toBe(true);
    expect(seen.has('dusk'), 'passes through dusk').toBe(true);
    for (let i = 1; i < samples.length; i += 1) expect(samples[i], 'forward only').toBeGreaterThanOrEqual(samples[i - 1]);
    await expect.poll(async () => (await daytime(page)).t, { timeout: 5_000 }).toBeCloseTo(T_NIGHT, 5);
    errors.expectNone();
  });
});
