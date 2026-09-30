/**
 * WP-25b: the tabbed menu (Town · Graphics · Sound · Help) and the Graphics tab UI.
 *
 * Covered here: WAI-ARIA tabs (click / tap, arrows, Home / End, roving tabindex, automatic
 * activation), the tab remembered for the page session, sub-views returning to the same tab, a
 * steady panel size, the Graphics radios / description / reload notice rendering from the last
 * `graphics:changed` fact, and the phone layout (390 × 844 and Pixel 7).
 *
 * The Graphics checks compare the tab with what the engine last said (diagnostics `graphics`,
 * WP-25a): picking Low must come back as Low with the reload notice. The full flow (Low → saved →
 * reload → MSAA off + Lambert → Medium → reload) is `graphics-menu.spec.ts` (WP-25c).
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { DEFAULT_GRAPHICS, GRAPHICS_PRESETS, GRAPHICS_UI, type GraphicsPreset } from '../src/game/graphics';
import { MENU_TABS, type MenuTab } from '../src/ui/testIds';
import { byId, diagnostics, gotoTitle, openMenuTab, startBuilding, trackErrors, UI_TEST_IDS } from './helpers';

const OUT = 'artifacts/wp-25/menu';
const ids = UI_TEST_IDS;
const LABELS: Record<MenuTab, string> = { town: 'Town', graphics: 'Graphics', sound: 'Sound', help: 'Help' };
/** The controls each tab must carry (every menu id kept from before WP-25). */
const CONTENT: Record<MenuTab, string[]> = {
  town: [ids.timeModeGroup, ids.renameTown, ids.newTown, ids.townFileMenu],
  graphics: [ids.graphicsGroup, ids.graphicsReload, ids.grid],
  sound: [ids.volume, ids.music, ids.musicVolume],
  help: [ids.help, ids.resetView, ids.credits],
};

const tab = (page: Page, t: MenuTab) => byId(page, ids.menuTab(t));
const panel = (page: Page, t: MenuTab) => byId(page, ids.menuTabPanel(t));
const phase = async (page: Page) => (await diagnostics(page)).phase;

/** What the engine last said (diagnostics.graphics, WP-25a). */
async function engineGraphics(page: Page): Promise<{ preset: GraphicsPreset; reloadRequired: boolean }> {
  const { preset, reloadRequired } = (await diagnostics(page)).graphics;
  return { preset, reloadRequired };
}

async function press(info: TestInfo, target: Locator): Promise<void> {
  if (info.project.name === 'mobile-chrome') await target.tap();
  else await target.click();
}

/** Exactly `t` is selected: aria-selected, roving tabindex, its panel shown and the others hidden. */
async function expectSelected(page: Page, t: MenuTab): Promise<void> {
  for (const other of MENU_TABS) {
    const selected = other === t;
    await expect(tab(page, other)).toHaveAttribute('aria-selected', String(selected));
    await expect(tab(page, other)).toHaveAttribute('tabindex', selected ? '0' : '-1');
    if (selected) {
      await expect(panel(page, other)).toBeVisible();
      await expect(panel(page, other)).not.toHaveAttribute('hidden', /.*/);
    } else {
      await expect(panel(page, other)).toBeHidden();
      await expect(panel(page, other)).toHaveAttribute('hidden', /.*/);
    }
  }
}

async function openMenu(page: Page): Promise<void> {
  await byId(page, ids.menu).click();
  await expect(byId(page, ids.menuPanel)).toBeVisible();
  await expect.poll(() => phase(page)).toBe('menu');
  // Measure after the panel's pop-in (a scale animation) has finished.
  await expect.poll(() => byId(page, ids.menuPanel).evaluate((el) => el.getAnimations().length)).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await gotoTitle(page);
  await startBuilding(page);
});

test('tabs: roles, contents, click / tap switching and a steady panel size', async ({ page }, info) => {
  const errors = trackErrors(page);
  await openMenu(page);
  await expect(byId(page, ids.resume)).toBeFocused();
  await expect(page.locator('#ui-menu-tabs')).toHaveAttribute('role', 'tablist');
  for (const t of MENU_TABS) {
    await expect(tab(page, t)).toHaveAttribute('role', 'tab');
    await expect(tab(page, t)).toHaveText(LABELS[t]);
    await expect(tab(page, t)).toHaveAttribute('aria-controls', ids.menuTabPanel(t));
    await expect(panel(page, t)).toHaveAttribute('role', 'tabpanel');
    await expect(panel(page, t)).toHaveAttribute('aria-labelledby', ids.menuTab(t));
    for (const control of CONTENT[t]) await expect(panel(page, t).locator(`#${control}`)).toHaveCount(1);
  }
  // The heading and Resume stay above the tabs.
  const menuBox = (await byId(page, ids.menuPanel).boundingBox())!;
  const resumeBox = (await byId(page, ids.resume).boundingBox())!;
  const tabsBox = (await page.locator('#ui-menu-tabs').boundingBox())!;
  expect(resumeBox.y + resumeBox.height).toBeLessThanOrEqual(tabsBox.y);

  // Opens on Town (the default).
  await expectSelected(page, 'town');

  const heights: number[] = [];
  for (const t of ['graphics', 'sound', 'help', 'town'] as const) {
    await press(info, tab(page, t));
    await expectSelected(page, t);
    await expect(tab(page, t)).toBeFocused();
    const box = (await byId(page, ids.menuPanel).boundingBox())!;
    heights.push(box.height);
    expect(Math.abs(box.y - menuBox.y), `${t}: the menu does not move`).toBeLessThanOrEqual(1);
  }
  expect(Math.max(...heights) - Math.min(...heights), `panel heights ${heights.join(', ')}`).toBeLessThanOrEqual(1);
  expect(Math.abs(heights[0] - menuBox.height)).toBeLessThanOrEqual(1);

  // A control on a hidden tab can't be clicked through.
  expect(await byId(page, ids.volume).isVisible()).toBe(false);
  errors.expectNone();
});

test('tabs: keyboard (arrows wrap, Home / End, roving tabindex, Tab into the panel, Esc closes)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-chrome', 'keyboard navigation is checked on desktop');
  const errors = trackErrors(page);
  await openMenu(page);
  // Resume → Tab → the selected tab (the only tab in the Tab order).
  await page.keyboard.press('Tab');
  await expect(tab(page, 'town')).toBeFocused();

  const steps: Array<[string, MenuTab]> = [
    ['ArrowRight', 'graphics'],
    ['ArrowRight', 'sound'],
    ['ArrowRight', 'help'],
    ['ArrowRight', 'town'], // wraps
    ['ArrowLeft', 'help'], // wraps back
    ['ArrowLeft', 'sound'],
    ['Home', 'town'],
    ['End', 'help'],
  ];
  for (const [key, expected] of steps) {
    await page.keyboard.press(key);
    await expect(tab(page, expected), `${key} → ${expected}`).toBeFocused();
    await expectSelected(page, expected);
  }
  // The arrows never reach the camera (the menu is paused; the view doesn't pan).
  expect(await phase(page)).toBe('menu');

  // Tab leaves the tab bar into the open panel: Help's first control.
  await page.keyboard.press('Tab');
  await expect(byId(page, ids.help)).toBeFocused();
  // Shift+Tab comes back to the selected tab, not the first one.
  await page.keyboard.press('Shift+Tab');
  await expect(tab(page, 'help')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect.poll(() => phase(page)).toBe('building');
  errors.expectNone();
});

test('the last tab is remembered on reopen; Back from a sub-view returns to the same tab', async ({ page }, info) => {
  const errors = trackErrors(page);
  await openMenuTab(page, 'sound');
  await byId(page, ids.resume).click();
  await expect.poll(() => phase(page)).toBe('building');
  await openMenu(page);
  await expectSelected(page, 'sound');

  // Help → Controls → "Got it" → the menu, still on Help, focus back on Controls.
  await openMenuTab(page, 'help');
  await press(info, byId(page, ids.help));
  await expect(byId(page, ids.helpPanel)).toBeVisible();
  await byId(page, ids.helpClose).click();
  await expect(byId(page, ids.menuPanel)).toBeVisible();
  await expectSelected(page, 'help');
  await expect(byId(page, ids.help)).toBeFocused();

  // Credits → Back → Help.
  await byId(page, ids.credits).click();
  await expect(byId(page, ids.creditsPanel)).toBeVisible();
  await byId(page, ids.creditsClose).click();
  await expectSelected(page, 'help');
  await expect(byId(page, ids.credits)).toBeFocused();

  // Town → New town → Cancel → Town; Rename → Cancel → Town.
  await openMenuTab(page, 'town');
  await byId(page, ids.newTown).click();
  await expect(byId(page, ids.confirmPanel)).toBeVisible();
  await byId(page, ids.confirmCancel).click();
  await expectSelected(page, 'town');
  await byId(page, ids.renameTown).click();
  await expect(byId(page, ids.namePanel)).toBeVisible();
  await byId(page, ids.nameCancel).click();
  await expectSelected(page, 'town');

  if (info.project.name !== 'mobile-chrome') {
    // Esc from a sub-view is Back too; `?` opens Controls straight from building, and Esc from
    // there lands on the menu's remembered tab.
    await openMenuTab(page, 'graphics');
    await byId(page, ids.resume).click();
    await expect.poll(() => phase(page)).toBe('building');
    await page.keyboard.press('Shift+Slash');
    await expect(byId(page, ids.helpPanel)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(byId(page, ids.menuPanel)).toBeVisible();
    await expectSelected(page, 'graphics');
    await page.keyboard.press('Escape');
    await expect.poll(() => phase(page)).toBe('building');
  }

  // A reload starts on Town again (the tab is kept for the page session only).
  await page.reload();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
  await startBuilding(page);
  await openMenu(page);
  await expectSelected(page, 'town');
  errors.expectNone();
});

test('Graphics tab: Quality radios, description and reload notice follow the last graphics:changed fact', async ({ page }, info) => {
  const errors = trackErrors(page);
  await openMenuTab(page, 'graphics');
  await expect.poll(() => byId(page, ids.menuPanel).evaluate((el) => el.getAnimations().length)).toBe(0);
  const group = byId(page, ids.graphicsGroup);
  await expect(group).toHaveAttribute('role', 'radiogroup');
  await expect(group).toHaveAccessibleName('Quality');
  const description = page.locator('#ui-graphics-desc');
  const notice = page.locator('.ui-graphics-reload');

  /** The radios show the engine's last fact. */
  const expectRendered = async (label: string) => {
    const fact = await engineGraphics(page);
    const shown = fact.preset;
    for (const preset of GRAPHICS_PRESETS) {
      const radio = byId(page, ids.graphicsOption(preset));
      if (preset === shown) await expect(radio, `${label}: ${preset}`).toBeChecked();
      else await expect(radio, `${label}: ${preset}`).not.toBeChecked();
    }
    await expect(description).toHaveText(GRAPHICS_UI[shown].description);
    await expect(group).toHaveAttribute('aria-describedby', 'ui-graphics-desc');
    if (fact.reloadRequired) {
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('Some changes apply after a reload');
      await expect(byId(page, ids.graphicsReload)).toHaveText('Reload now');
    } else {
      await expect(notice).toBeHidden();
      await expect(byId(page, ids.graphicsReload)).toBeHidden();
    }
    return fact;
  };

  // Default: Medium checked, its description, no reload notice (nothing to reload for yet).
  expect(await expectRendered('boot')).toEqual({ preset: DEFAULT_GRAPHICS, reloadRequired: false });

  // Segments: labels from GRAPHICS_UI, inside the panel, ≥ 44 px on touch.
  const menu = (await byId(page, ids.menuPanel).boundingBox())!;
  for (const preset of GRAPHICS_PRESETS) {
    const seg = group.locator('.ui-seg-opt', { has: page.locator(`#${ids.graphicsOption(preset)}`) });
    await expect(seg).toHaveText(GRAPHICS_UI[preset].label);
    const box = (await seg.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(menu.x);
    expect(box.x + box.width).toBeLessThanOrEqual(menu.x + menu.width + 0.5);
    expect(box.height).toBeGreaterThanOrEqual(info.project.name === 'mobile-chrome' ? 44 : 36);
  }

  // Picking Low emits intent:set-graphics; the engine answers Low with the reload notice (Low
  // changes MSAA and the material), and the radios render that answer.
  await press(info, group.locator('.ui-seg-opt', { hasText: GRAPHICS_UI.low.label }));
  await expect.poll(() => engineGraphics(page)).toEqual({ preset: 'low', reloadRequired: true });
  await expectRendered('after Low');
  await expect(notice).toBeVisible();

  await press(info, group.locator('.ui-seg-opt', { hasText: GRAPHICS_UI.medium.label }));
  await expect.poll(() => engineGraphics(page)).toEqual({ preset: 'medium', reloadRequired: false });
  await expectRendered('after Medium');
  await expect(notice).toBeHidden();

  // Show grid moved here and still works.
  const grid = byId(page, ids.grid);
  const before = await grid.isChecked();
  await grid.click();
  await expect(grid).toBeChecked({ checked: !before });
  await grid.click();
  await expect(grid).toBeChecked({ checked: before });
  errors.expectNone();
});

/** Layout of the open menu at the current viewport: overflow, clipped labels, small targets. */
async function menuLayoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ menuId }) => {
      const problems: string[] = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (document.documentElement.scrollWidth > vw) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
      const menu = document.getElementById(menuId)!;
      const m = menu.getBoundingClientRect();
      if (m.left < 0 || m.right > vw + 0.5 || m.top < 0 || m.bottom > vh + 0.5) problems.push(`menu outside the viewport ${JSON.stringify(m)}`);
      if (menu.scrollWidth > menu.clientWidth + 1) problems.push(`menu scrolls sideways ${menu.scrollWidth} > ${menu.clientWidth}`);
      const pages = menu.querySelector<HTMLElement>('.ui-menu-pages')!;
      if (pages.scrollWidth > pages.clientWidth + 1) problems.push(`pages scroll sideways ${pages.scrollWidth} > ${pages.clientWidth}`);
      // Touch-size targets where the phone layout applies (desktop keeps its 36 px segments).
      const phone = vw <= 760 || window.matchMedia('(pointer: coarse)').matches;
      const visible = (el: Element) => el.checkVisibility({ visibilityProperty: true });
      for (const el of menu.querySelectorAll<HTMLElement>('button, .ui-field, .ui-seg-opt, [role="tab"]')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        const name = el.id || el.className;
        if (phone && r.height < 40) problems.push(`small target ${name}: ${Math.round(r.height)} px tall`);
        if (r.left < m.left - 0.5 || r.right > m.right + 0.5) problems.push(`${name} sticks out of the menu`);
      }
      // Every label shows in full: no ellipsis, nothing wider than its box.
      for (const el of menu.querySelectorAll<HTMLElement>('[role="tab"] span, .ui-btn span, .ui-seg-opt span, .ui-seg-label span, .ui-field label span, .ui-check > span')) {
        if (!visible(el)) continue;
        if (el.scrollWidth > el.clientWidth + 1) problems.push(`clipped label "${el.textContent}" ${el.scrollWidth} > ${el.clientWidth}`);
        // Control labels stay on one line (a wrapped inline label has one box per line).
        if (!el.closest('.ui-field-sub') && el.getClientRects().length > 1) problems.push(`label "${el.textContent}" wraps`);
        const r = el.getBoundingClientRect();
        const box = el.closest<HTMLElement>('button, .ui-field, .ui-seg-opt, label')!.getBoundingClientRect();
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5) problems.push(`label "${el.textContent}" outside its control`);
      }
      return problems;
    },
    { menuId: UI_TEST_IDS.menuPanel },
  );
}

test('phone layout: every tab fits 390 × 844 and the project viewport, no clipped labels, ≥ 40 px targets; screenshots', async ({ page }, info) => {
  const errors = trackErrors(page);
  mkdirSync(OUT, { recursive: true });
  const native = page.viewportSize()!;
  const sizes = [native, { width: 390, height: 844 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await openMenu(page);
    for (const t of MENU_TABS) {
      await openMenuTab(page, t);
      // The pop-in and the tabs' colour transitions have finished (screenshots show the settled state).
      await expect.poll(() => byId(page, ids.menuPanel).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
      const problems = await menuLayoutProblems(page);
      expect(problems, `${t} at ${size.width}×${size.height}`).toEqual([]);
      await page.screenshot({ path: `${OUT}/${t}-${info.project.name}-${size.width}x${size.height}.png` });
    }
    await byId(page, ids.resume).click();
    await expect.poll(() => phase(page)).toBe('building');
  }
  errors.expectNone();
});
