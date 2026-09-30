/**
 * WP-25c: the Graphics tab end to end, with the real engine and real input only (dock and menu
 * clicks / taps, the keyboard, the Continue button; no test hooks, no DOM forcing).
 *
 *  - Medium (the default) → Low in the menu: the live parts apply at once (DPR cap 1, 30 / 30 fps,
 *    1024 shadows, 60% decor, no halos), the choice is saved, and the reload notice offers
 *    "Reload now" because MSAA and the material change → Reload now → Continue: the same town,
 *    booted on Low with no MSAA and Lambert, no notice → Medium → notice → reload → Standard + MSAA.
 *  - Medium → High (and back) applies live with no notice: MSAA and the material don't change.
 *
 * The desktop project runs at DPR 2 here so the DPR cap visibly moves (Medium 1.5 → Low 1 → High 2);
 * the phone keeps Pixel 7's 2.625.
 */
import { mkdirSync } from 'node:fs';
import { devices, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { GRAPHICS_PRESETS, GRAPHICS_PROFILES, GRAPHICS_UI, type GraphicsPreset } from '../src/game/graphics';
import {
  byId,
  clickFootprint,
  clickStart,
  diagnostics,
  dragCells,
  expectDiagnostics,
  gotoTitle,
  openMenuTab,
  selectTool,
  startBuilding,
  trackErrors,
  UI_TEST_IDS as ids,
} from './helpers';

const SETTINGS_KEY = 'tiny-town:settings:v1';
const OUT = 'artifacts/wp-25/menu';

test.use({ deviceScaleFactor: async ({ isMobile }, use) => use(isMobile ? devices['Pixel 7'].deviceScaleFactor : 2) });

const notice = (page: Page) => page.locator('.ui-graphics-reload');
const description = (page: Page) => page.locator('#ui-graphics-desc');
const segment = (page: Page, preset: GraphicsPreset) =>
  byId(page, ids.graphicsGroup).locator('.ui-seg-opt', { has: page.locator(`#${ids.graphicsOption(preset)}`) });

async function press(info: TestInfo, target: Locator): Promise<void> {
  if (info.project.name === 'mobile-chrome') await target.tap();
  else await target.click();
}

/** The Graphics tab shows `preset` checked, its description, and the notice iff `reloadRequired`. */
async function expectTab(page: Page, preset: GraphicsPreset, reloadRequired: boolean): Promise<void> {
  for (const p of GRAPHICS_PRESETS) {
    if (p === preset) await expect(byId(page, ids.graphicsOption(p)), p).toBeChecked();
    else await expect(byId(page, ids.graphicsOption(p)), p).not.toBeChecked();
  }
  await expect(description(page)).toHaveText(GRAPHICS_UI[preset].description);
  if (reloadRequired) {
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText('Some changes apply after a reload');
    await expect(byId(page, ids.graphicsReload)).toBeVisible();
    await expect(byId(page, ids.graphicsReload)).toHaveText('Reload now');
  } else {
    await expect(notice(page)).toBeHidden();
    await expect(byId(page, ids.graphicsReload)).toBeHidden();
  }
}

/** The live parts of `preset` are applied (diagnostics), whatever the page booted with. */
async function expectLive(page: Page, preset: GraphicsPreset, booted: GraphicsPreset): Promise<void> {
  const p = GRAPHICS_PROFILES[preset];
  const b = GRAPHICS_PROFILES[booted];
  await expect
    .poll(async () => (await diagnostics(page)).graphics, { message: `${preset} (booted ${booted}) applied` })
    .toMatchObject({
      preset,
      booted,
      reloadRequired: p.antialias !== b.antialias || p.material !== b.material,
      antialias: b.antialias,
      material: b.material,
      maxDpr: p.maxDpr,
      shadowMapSize: p.shadowMapSize,
      decorFraction: p.decorFraction,
      skyOctaves: p.skyOctaves,
      activeFps: p.activeFps,
      idleFps: p.idleFps,
      lampHalos: p.lampHalos,
    });
  const d = await diagnostics(page);
  expect(d.quality).toBe(preset);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  expect(d.canvas.dpr, 'the canvas follows the DPR cap at once').toBe(Math.min(dpr, p.maxDpr));
  expect(d.canvas.width).toBe(Math.floor(d.canvas.clientWidth * Math.min(dpr, p.maxDpr)));
}

const savedGraphics = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').graphics as unknown, SETTINGS_KEY);

/** What the real WebGL context was created with. */
const contextAntialias = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    return (canvas.getContext('webgl2') as WebGL2RenderingContext).getContextAttributes()?.antialias;
  });

/** Menu → Reload now: the page reloads to the title, whose button now says Continue. */
async function reloadNow(page: Page, info: TestInfo): Promise<void> {
  const loaded = page.waitForEvent('load');
  await press(info, byId(page, ids.graphicsReload));
  await loaded;
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  await expect(page.locator('.ui-start-label')).toHaveText('Continue');
}

test('Medium → Low → Reload now → the same town on Low (no MSAA, Lambert) → Medium → reload → back', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);

  // A small town, so the reload has something to keep: one road stroke and a cottage.
  await selectTool(page, 'road');
  await dragCells(page, [16, 24], [31, 24]);
  await selectTool(page, 'cottage');
  await clickFootprint(page, 'cottage', { x: 22, z: 20 });
  const built = await expectDiagnostics(page, { objects: 1, town: { roadTiles: 8, homes: 1 } }, 'road + cottage');

  // 1. Graphics tab on a fresh start: Medium, its description, no notice.
  await openMenuTab(page, 'graphics');
  await expectTab(page, 'medium', false);
  await expectLive(page, 'medium', 'medium');
  expect((await diagnostics(page)).graphics).toMatchObject({ antialias: true, material: 'standard' });

  // 2. Low: live parts at once, saved, and the notice asks for a reload (MSAA + material).
  await press(info, segment(page, 'low'));
  await expectLive(page, 'low', 'medium');
  await expectTab(page, 'low', true);
  expect((await diagnostics(page)).perf.targetFps).toBe(30);
  expect(await savedGraphics(page)).toBe('low');
  // Evidence: the Graphics tab on Low with the reload notice, as the engine left it.
  await expect.poll(() => byId(page, ids.menuPanel).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/graphics-low-reload-${info.project.name}.png` });

  // 3. Reload now → Continue: the town survived, and the page booted on Low.
  await reloadNow(page, info);
  await clickStart(page);
  await expectDiagnostics(page, { objects: built.objects, town: { roadTiles: built.town.roadTiles, homes: built.town.homes } }, 'the town persisted');
  await expectLive(page, 'low', 'low');
  expect((await diagnostics(page)).graphics).toMatchObject({ booted: 'low', antialias: false, material: 'lambert', reloadRequired: false });
  expect(await contextAntialias(page), 'the real context has no MSAA').toBe(false);
  await openMenuTab(page, 'graphics');
  await expectTab(page, 'low', false);

  // 4. Back to Medium: the live parts return, and the notice asks for a reload again.
  await press(info, segment(page, 'medium'));
  await expectLive(page, 'medium', 'low');
  await expectTab(page, 'medium', true);
  expect(await savedGraphics(page)).toBe('medium');

  // 5. Reload now → Continue: Standard materials and MSAA again.
  await reloadNow(page, info);
  await clickStart(page);
  await expectDiagnostics(page, { objects: built.objects, town: { roadTiles: built.town.roadTiles, homes: built.town.homes } }, 'the town persisted again');
  await expectLive(page, 'medium', 'medium');
  expect((await diagnostics(page)).graphics).toMatchObject({ booted: 'medium', antialias: true, material: 'standard', reloadRequired: false });
  expect(await contextAntialias(page), 'the real context has MSAA').toBe(true);
  await openMenuTab(page, 'graphics');
  await expectTab(page, 'medium', false);
  errors.expectNone();
});

test('Medium → High applies live with no reload notice; the keyboard moves between presets', async ({ page }, info) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await openMenuTab(page, 'graphics');
  await expectTab(page, 'medium', false);

  await press(info, segment(page, 'high'));
  await expectLive(page, 'high', 'medium');
  await expectTab(page, 'high', false);
  expect((await diagnostics(page)).graphics).toMatchObject({ reloadRequired: false, antialias: true, material: 'standard' });
  expect(await savedGraphics(page)).toBe('high');

  if (info.project.name !== 'mobile-chrome') {
    // Keyboard: Shift+Tab back to the Graphics tab, Tab into the panel lands on the checked radio
    // (High); the arrows move the choice like any radio group.
    await page.keyboard.press('Shift+Tab');
    await expect(byId(page, ids.menuTab('graphics'))).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(byId(page, ids.graphicsOption('high'))).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expectLive(page, 'medium', 'medium');
    await expectTab(page, 'medium', false);
    await page.keyboard.press('ArrowLeft');
    await expectLive(page, 'low', 'medium');
    await expectTab(page, 'low', true);
    await page.keyboard.press('ArrowRight');
    await expectLive(page, 'medium', 'medium');
    await expectTab(page, 'medium', false);
    expect(await savedGraphics(page)).toBe('medium');
    // The menu is still open (the arrows stayed in the radio group).
    expect((await diagnostics(page)).phase).toBe('menu');
  } else {
    await press(info, segment(page, 'medium'));
    await expectLive(page, 'medium', 'medium');
    await expectTab(page, 'medium', false);
  }
  errors.expectNone();
});
