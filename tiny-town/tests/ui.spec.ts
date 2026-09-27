/**
 * WP-06 UI acceptance checks (owned by WP-06). Real clicks/keys only; state is read from
 * __THREE_GAME_DIAGNOSTICS__. Screenshots land in artifacts/wp-06/.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TOOL_CATEGORIES, toolsInCategory } from '../src/catalog/tools';
import { UI_TEST_IDS } from '../src/ui/UiRoot';
import { clickCell } from './helpers';

// UI_RUN_ID picks the evidence folder, e.g. UI_RUN_ID=wp06-fix1 → artifacts/wp06-fix1.
const OUT = `artifacts/${process.env.UI_RUN_ID ?? 'wp-06'}`;
const id = (x: string) => `#${x}`;

const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function start(page: Page): Promise<void> {
  await boot(page);
  await page.locator(id(UI_TEST_IDS.start)).click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building');
}

const cellPoint = (page: Page, x: number, z: number) =>
  page.evaluate(([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz), [x, z] as const);

test('every category shows its tools and selecting one sets diagnostics.tool', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  for (const category of TOOL_CATEGORIES) {
    await page.locator(id(UI_TEST_IDS.category(category.id))).click();
    await expect(page.locator(id(UI_TEST_IDS.category(category.id)))).toHaveAttribute('aria-pressed', 'true');
    const tools = toolsInCategory(category.id);
    await expect(page.locator(`#${UI_TEST_IDS.tray} [data-tool]`)).toHaveCount(tools.length);
    for (const tool of tools) {
      const button = page.locator(id(UI_TEST_IDS.tool(tool.id)));
      await expect(button).toBeVisible();
      await button.click();
      await expect.poll(async () => (await diag(page)).tool).toBe(tool.id);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }
  // Clicking the active item again puts the tool away.
  const last = page.locator(id(UI_TEST_IDS.tool('lamppost')));
  await last.click();
  await expect.poll(async () => (await diag(page)).tool).toBeNull();
  // Bulldoze mode button toggles.
  await page.locator(id(UI_TEST_IDS.bulldoze)).click();
  await expect.poll(async () => (await diag(page)).tool).toBe('bulldoze');
  await page.locator(id(UI_TEST_IDS.bulldoze)).click();
  await expect.poll(async () => (await diag(page)).tool).toBeNull();
  expect(errors).toEqual([]);
});

test('digit shortcuts: 1–9 pick a tool in the active category, Shift+1–4 switch category', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-chrome', 'keyboard shortcuts are a desktop affordance');
  await start(page);
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await diag(page)).tool).toBe('road');
  await page.keyboard.press('Shift+Digit3');
  await expect(page.locator(id(UI_TEST_IDS.category('buildings')))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await diag(page)).tool).toBe('townhouse-c');
  await expect(page.locator(id(UI_TEST_IDS.tool('townhouse-c')))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit3'); // same digit again deselects
  await expect.poll(async () => (await diag(page)).tool).toBeNull();
  await page.keyboard.press('Shift+Digit2');
  await page.keyboard.press('Digit4');
  await expect.poll(async () => (await diag(page)).tool).toBe('tree-b');
});

test('undo/redo disabled states follow history', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  const undo = page.locator(id(UI_TEST_IDS.undo));
  const redo = page.locator(id(UI_TEST_IDS.redo));
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.locator(id(UI_TEST_IDS.category('paths'))).click();
  await page.locator(id(UI_TEST_IDS.tool('road'))).click();
  const from = await cellPoint(page, 16, 22);
  const to = await cellPoint(page, 26, 22);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await diag(page)).history.canUndo).toBe(true);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  await undo.click();
  await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(0);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect.poll(async () => (await diag(page)).town.roadTiles).toBeGreaterThan(0);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  expect(errors).toEqual([]);
});

test('refusal tooltip shows on an invalid click and is gone after the next successful placement', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  const tip = page.locator(id(UI_TEST_IDS.tooltip));
  await page.locator(id(UI_TEST_IDS.category('buildings'))).click();
  await page.locator(id(UI_TEST_IDS.tool('townhouse-a'))).click();

  await clickCell(page, 18, 18);
  await expect.poll(async () => (await diag(page)).town.homes).toBe(1);
  const invalidBefore = (await diag(page)).invalidCount;
  await clickCell(page, 18, 18); // occupied → refused
  await expect.poll(async () => (await diag(page)).invalidCount).toBe(invalidBefore + 1);
  await expect(tip).toBeVisible();
  await expect(tip).not.toHaveText('');

  await clickCell(page, 28, 18); // valid → placed
  await expect.poll(async () => (await diag(page)).town.homes).toBe(2);
  await expect(tip).toBeHidden();

  // A refusal followed by a tool switch also clears it. (build:invalid is throttled to one per
  // 400 ms per reason, so wait before refusing the same reason again.)
  await page.waitForTimeout(450);
  await clickCell(page, 28, 18);
  await expect(tip).toBeVisible();
  await page.locator(id(UI_TEST_IDS.tool('garage'))).click();
  await expect(tip).toBeHidden();
  expect(errors).toEqual([]);
});

test('refusal tooltip never overlaps the dock, top bar or hint (refusal right above the dock)', async ({ page }, info) => {
  const errors = trackErrors(page);
  await start(page);
  await page.locator(id(UI_TEST_IDS.category('buildings'))).click();
  await page.locator(id(UI_TEST_IDS.tool('townhouse-c'))).click();
  // The on-canvas cell closest above the dock: the worst case for a tooltip near the finger.
  const target = await page.evaluate(() => {
    const dockTop = document.querySelector('#ui-dock')!.getBoundingClientRect().top;
    let best: { x: number; z: number; px: number; py: number } | null = null;
    for (let z = 0; z < 48; z += 1)
      for (let x = 0; x < 48; x += 1) {
        const p = window.__THREE_GAME_TEST_HOOKS__!.cellToClient(x, z);
        if (p.y > dockTop - 24 || document.elementFromPoint(p.x, p.y)?.id !== 'game-canvas') continue;
        if (!best || p.y > best.py) best = { x, z, px: p.x, py: p.y };
      }
    return best;
  });
  expect(target, 'a canvas cell above the dock').not.toBeNull();
  const tap = async () => {
    if (info.project.name === 'mobile-chrome') await page.touchscreen.tap(target!.px, target!.py);
    else await page.mouse.click(target!.px, target!.py);
  };
  await tap();
  await expect.poll(async () => (await diag(page)).town.homes).toBe(1);
  const before = (await diag(page)).invalidCount;
  await tap(); // occupied → refused
  await expect.poll(async () => (await diag(page)).invalidCount).toBe(before + 1);
  const tip = page.locator(id(UI_TEST_IDS.tooltip));
  await expect(tip).toBeVisible();
  const rects = await page.evaluate(() => {
    const r = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const visible = el.classList.contains('ui-hint') ? el.classList.contains('is-visible') && !!el.textContent : true;
      const b = el.getBoundingClientRect();
      return visible && b.width > 0 ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null;
    };
    return { tip: r('#ui-tooltip')!, dock: r('#ui-dock')!, topbar: r('.ui-topbar')!, stats: r('#ui-stats')!, hint: r('#ui-hint') };
  });
  const hits = (a: typeof rects.tip, b: typeof rects.tip | null) =>
    !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  console.log(`${info.project.name} tooltip ${JSON.stringify(rects.tip)} dock top ${rects.dock.top}`);
  expect(hits(rects.tip, rects.dock), 'tooltip × dock').toBe(false);
  expect(hits(rects.tip, rects.topbar), 'tooltip × top bar').toBe(false);
  expect(hits(rects.tip, rects.stats), 'tooltip × stats').toBe(false);
  expect(hits(rects.tip, rects.hint), 'tooltip × hint').toBe(false);
  await page.screenshot({ path: `${OUT}/tooltip-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('stat label and number keep a gap in every frame of the count-up and punch', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-chrome', 'labels are hidden on phones');
  await start(page);
  const setState = page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('stress-town'));
  const result = await page.evaluate(
    () =>
      new Promise<{ frames: number; minGap: number; animatedFrames: number }>((resolve) => {
        let frames = 0;
        let animatedFrames = 0;
        let minGap = Infinity;
        const t0 = performance.now();
        const tick = () => {
          frames += 1;
          for (const stat of document.querySelectorAll('.ui-stat')) {
            const label = stat.querySelector('.ui-stat-label')!.getBoundingClientRect();
            const num = stat.querySelector('.ui-stat-num')!;
            if (stat.classList.contains('is-punch')) animatedFrames += 1;
            minGap = Math.min(minGap, num.getBoundingClientRect().left - label.right);
          }
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else resolve({ frames, minGap, animatedFrames });
        };
        requestAnimationFrame(tick);
      }),
  );
  await setState;
  console.log(`stat gap: ${JSON.stringify(result)}`);
  expect(result.animatedFrames).toBeGreaterThan(0);
  expect(result.minGap).toBeGreaterThanOrEqual(2);
});

test('mute toggle flips diagnostics audio.muted', async ({ page }) => {
  await start(page);
  const mute = page.locator(id(UI_TEST_IDS.mute));
  const before = (await diag(page)).audio.muted;
  await mute.click();
  await expect.poll(async () => (await diag(page)).audio.muted).toBe(!before);
  await expect(mute).toHaveAttribute('aria-pressed', String(!before));
  await mute.click();
  await expect.poll(async () => (await diag(page)).audio.muted).toBe(before);
});

test('menu opens and closes; New town asks for confirmation', async ({ page }, info) => {
  const errors = trackErrors(page);
  await start(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('sample-town'));
  const homes = (await diag(page)).town.homes;
  expect(homes).toBeGreaterThan(0);

  // Open via ☰, close via Resume.
  await page.locator(id(UI_TEST_IDS.menu)).click();
  await expect.poll(async () => (await diag(page)).phase).toBe('menu');
  await expect(page.locator(id(UI_TEST_IDS.menuPanel))).toBeVisible();
  await page.locator(id(UI_TEST_IDS.resume)).click();
  await expect.poll(async () => (await diag(page)).phase).toBe('building');
  await expect(page.locator(id(UI_TEST_IDS.menuPanel))).toBeHidden();

  if (info.project.name !== 'mobile-chrome') {
    // Esc closes the menu (and does not immediately reopen it).
    await page.locator(id(UI_TEST_IDS.menu)).click();
    await expect.poll(async () => (await diag(page)).phase).toBe('menu');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await diag(page)).phase).toBe('building');
    // `?` opens controls help directly.
    await page.keyboard.press('Shift+Slash');
    await expect(page.locator(id(UI_TEST_IDS.helpPanel))).toBeVisible();
    await page.keyboard.press('Escape'); // help → menu
    await expect(page.locator(id(UI_TEST_IDS.menuPanel))).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await diag(page)).phase).toBe('building');
  }

  // New town → confirm → Cancel keeps the town.
  await page.locator(id(UI_TEST_IDS.menu)).click();
  await page.locator(id(UI_TEST_IDS.newTown)).click();
  await expect(page.locator(id(UI_TEST_IDS.confirmPanel))).toBeVisible();
  await expect(page.locator(id(UI_TEST_IDS.confirmPanel))).toContainText('Start a new town?');
  await page.locator(id(UI_TEST_IDS.confirmCancel)).click();
  await expect(page.locator(id(UI_TEST_IDS.menuPanel))).toBeVisible();
  expect((await diag(page)).town.homes).toBe(homes);

  // New town → confirm → Clear empties it and returns to building.
  await page.locator(id(UI_TEST_IDS.newTown)).click();
  await page.locator(id(UI_TEST_IDS.confirmClear)).click();
  await expect.poll(async () => (await diag(page)).town.homes).toBe(0);
  await expect.poll(async () => (await diag(page)).phase).toBe('building');
  expect(errors).toEqual([]);
});

test('keyboard only: Tab reaches every dock button with a visible focus ring', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-chrome', 'keyboard navigation is checked on desktop');
  await start(page);
  await page.locator(id(UI_TEST_IDS.category('buildings'))).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const dockIds = await page.$$eval(`#${UI_TEST_IDS.dock} button`, (els) => els.map((e) => e.id));
  expect(dockIds.length).toBeGreaterThanOrEqual(13);
  const seen = new Map<string, string>();
  for (let i = 0; i < 40 && seen.size < dockIds.length; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest('#ui-dock')) return null;
      const style = getComputedStyle(el);
      return { id: el.id, ring: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, visible: el.matches(':focus-visible') };
    });
    if (focused) {
      expect(focused.visible, focused.id).toBe(true);
      expect(focused.ring, focused.id).toMatch(/^solid 3px/);
      seen.set(focused.id, focused.ring);
    }
  }
  expect([...seen.keys()].sort()).toEqual([...dockIds].sort());
  await page.keyboard.press('Shift+Tab');
  await page.screenshot({ path: `${OUT}/focus-ring-1280x720.png` });
});

test('dock is ≤ 150 px tall on desktop and clear of the plot centre', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-chrome', 'desktop budget');
  await start(page);
  await page.locator(id(UI_TEST_IDS.category('buildings'))).click();
  const dock = (await page.locator(id(UI_TEST_IDS.dock)).boundingBox())!;
  const a = await cellPoint(page, 23, 23);
  const b = await cellPoint(page, 24, 24);
  const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const topbar = (await page.locator('.ui-topbar').boundingBox())!;
  console.log(`dock height ${dock.height}px, dock top ${dock.y}, plot centre ${JSON.stringify(centre)}, topbar bottom ${topbar.y + topbar.height}`);
  expect(dock.height).toBeLessThanOrEqual(150);
  expect(centre.y).toBeLessThan(dock.y);
  expect(centre.y).toBeGreaterThan(topbar.y + topbar.height);
});

const SIZES: ReadonlyArray<[number, number]> = [
  [1280, 720],
  [1024, 768],
  [390, 844],
  [360, 640],
];

test('stress-town screenshots: no overlap or clipping at 4 sizes', async ({ browser }, info) => {
  test.skip(info.project.name === 'mobile-chrome', 'runs its own viewports once');
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  for (const [width, height] of SIZES) {
    const mobile = width < 760;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await start(page);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('stress-town'));
    await page.locator(id(UI_TEST_IDS.category('buildings'))).click();
    await page.locator(id(UI_TEST_IDS.tool('townhouse-c'))).click();
    await page.waitForTimeout(700); // stat count-up + tray slide settle

    const report = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const problems: string[] = [];
      const visible = (el: Element) => {
        const r = rect(el);
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
      };
      const blocks = ['.ui-brand', '#ui-stats', '.ui-actions', '#ui-dock', '#ui-hint'].map((s) => document.querySelector(s)!).filter(visible);
      for (const el of blocks) {
        const r = rect(el);
        if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) problems.push(`${el.className || el.id} off-screen ${JSON.stringify(r)}`);
      }
      for (let i = 0; i < blocks.length; i += 1)
        for (let j = i + 1; j < blocks.length; j += 1) {
          const p = rect(blocks[i]);
          const q = rect(blocks[j]);
          if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) problems.push(`overlap ${blocks[i].className || blocks[i].id} × ${blocks[j].className || blocks[j].id}`);
        }
      // Text that is visible must not be truncated.
      for (const el of document.querySelectorAll<HTMLElement>('.ui-card-label, .ui-tab span, .ui-stat-num, .ui-mode-label, #ui-hint, .ui-brand .ui-mark-text')) {
        if (!visible(el) || getComputedStyle(el).display === 'none') continue;
        if (el.scrollWidth > el.clientWidth + 1) problems.push(`clipped text "${el.textContent}" (${el.scrollWidth} > ${el.clientWidth})`);
      }
      // Stat numerals: tabular + ≥ 4ch reserved.
      for (const el of document.querySelectorAll<HTMLElement>('.ui-stat-num')) {
        const s = getComputedStyle(el);
        if (!s.fontVariantNumeric.includes('tabular-nums')) problems.push('stat numerals not tabular');
        // Probe: a clone of the numeral holding "0000", laid out in the same context.
        const ch = el.cloneNode() as HTMLElement;
        ch.style.cssText = 'position:absolute;visibility:hidden;min-width:0;animation:none';
        ch.textContent = '0000';
        el.parentElement!.append(ch);
        if (el.getBoundingClientRect().width + 0.5 < ch.getBoundingClientRect().width) problems.push(`stat ${el.textContent} narrower than 4ch`);
        ch.remove();
      }
      // Touch targets on phones.
      if (vw < 760) {
        for (const el of document.querySelectorAll<HTMLElement>('.ui-actions button, #ui-dock button')) {
          const r = rect(el);
          if (r.width > 0 && (r.width < 44 || r.height < 44)) problems.push(`small target ${el.id} ${r.width}×${r.height}`);
        }
      }
      const dock = rect(document.querySelector('#ui-dock')!);
      const stats = [...document.querySelectorAll('.ui-stat-num')].map((e) => e.textContent).join('/');
      return { problems, dockHeight: Math.round(dock.height), stats };
    });
    const file = `${OUT}/stress-town-buildings-${width}x${height}.png`;
    await page.screenshot({ path: file });
    await info.attach(`stress-town-${width}x${height}`, { path: file, contentType: 'image/png' });
    console.log(`${width}x${height}: dock ${report.dockHeight}px, stats ${report.stats}, problems ${JSON.stringify(report.problems)}`);
    expect(report.problems, `${width}x${height}`).toEqual([]);
    expect(errors).toEqual([]);

    // Extra evidence for the other states at this size.
    await page.locator(id(UI_TEST_IDS.menu)).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/menu-${width}x${height}.png` });
    await page.locator(id(UI_TEST_IDS.help)).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/help-${width}x${height}.png` });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('title'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/title-${width}x${height}.png` });
    await context.close();
  }
});
