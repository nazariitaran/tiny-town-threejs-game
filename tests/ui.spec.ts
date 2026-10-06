import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TOOL_CATEGORIES, toolsInCategory } from '../src/catalog/tools';
import { PLOT_DEPTH, PLOT_WIDTH } from '../src/game/config';
import { UI_TEST_IDS } from '../src/ui/testIds';
import { clickFootprint, clickStart, openMenuTab, trackErrors } from './helpers';

// UI_RUN_ID picks the evidence folder, e.g. UI_RUN_ID=ui-retry → artifacts/ui-retry.
const OUT = `artifacts/${process.env.UI_RUN_ID ?? 'ui'}`;
const id = (x: string) => `#${x}`;

const diag = (page: Page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function start(page: Page): Promise<void> {
  await boot(page);
  await clickStart(page);
}

const cellPoint = (page: Page, x: number, z: number) =>
  page.evaluate(([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz), [x, z] as const);

/** The on-canvas cell closest above the dock: the worst case for a tooltip near the finger. */
const cellAboveDock = (page: Page) =>
  page.evaluate(([width, depth]) => {
    const dockTop = document.querySelector('#ui-dock')!.getBoundingClientRect().top;
    let best: { x: number; z: number; px: number; py: number } | null = null;
    for (let z = 0; z < depth; z += 1)
      for (let x = 0; x < width; x += 1) {
        const p = window.__THREE_GAME_TEST_HOOKS__!.cellToClient(x, z);
        if (p.y > dockTop - 24 || document.elementFromPoint(p.x, p.y)?.id !== 'game-canvas') continue;
        if (!best || p.y > best.py) best = { x, z, px: p.x, py: p.y };
      }
    return best;
  }, [PLOT_WIDTH, PLOT_DEPTH] as const);

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
  // Clicking the active item again puts the tool away (the last tool of the last category).
  const lastCategory = TOOL_CATEGORIES[TOOL_CATEGORIES.length - 1].id;
  const lastTools = toolsInCategory(lastCategory);
  const last = page.locator(id(UI_TEST_IDS.tool(lastTools[lastTools.length - 1].id)));
  await last.click();
  await expect.poll(async () => (await diag(page)).tool).toBeNull();
  await page.locator(id(UI_TEST_IDS.bulldoze)).click();
  await expect.poll(async () => (await diag(page)).tool).toBe('bulldoze');
  await page.locator(id(UI_TEST_IDS.bulldoze)).click();
  await expect.poll(async () => (await diag(page)).tool).toBeNull();
  errors.expectNone();
});

test('the five category tabs render their tools in catalog order, each with a loaded tool icon', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  expect(TOOL_CATEGORIES.map((c) => c.id)).toEqual(['streets', 'homes', 'town', 'nature', 'garden']);
  await expect(page.locator(`#${UI_TEST_IDS.dock} [data-category]`)).toHaveCount(5);
  await expect(page.locator(id(UI_TEST_IDS.category('streets')))).toHaveAttribute('aria-pressed', 'true');
  const counts: Record<string, number> = {};
  for (const category of TOOL_CATEGORIES) {
    await page.locator(id(UI_TEST_IDS.category(category.id))).click();
    const expected = toolsInCategory(category.id).map((t) => t.id);
    const cards = page.locator(`#${UI_TEST_IDS.tray} [data-tool]`);
    await expect(cards).toHaveCount(expected.length);
    expect(await cards.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tool))).toEqual(expected);
    // Every card's icon is /assets/icons/tool-<id>.png and actually decoded.
    await expect
      .poll(() =>
        cards.evaluateAll((els) =>
          els.map((el) => {
            const img = el.querySelector('img')!;
            return `${(el as HTMLElement).dataset.tool}:${new URL(img.src).pathname.endsWith(`/assets/icons/tool-${(el as HTMLElement).dataset.tool}.png`)}:${img.complete && img.naturalWidth > 0}`;
          }),
        ),
      )
      .toEqual(expected.map((tool) => `${tool}:true:true`));
    counts[category.id] = expected.length;
  }
  expect(counts).toEqual({ streets: 6, homes: 7, town: 10, nature: 12, garden: 11 });
  errors.expectNone();
});

test('digit shortcuts: 1–9 pick a tool in the active category, Shift+1–5 switch category', async ({ page }) => {
  await start(page);
  // Streets is open by default: 1 = road, 3 = roundabout.
  await expect(page.locator(id(UI_TEST_IDS.category('streets')))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await diag(page)).tool).toBe('road');
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await diag(page)).tool).toBe('roundabout');
  // Shift+2 = Homes: 3 = bungalow.
  await page.keyboard.press('Shift+Digit2');
  await expect(page.locator(id(UI_TEST_IDS.category('homes')))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await diag(page)).tool).toBe('bungalow');
  await expect(page.locator(id(UI_TEST_IDS.tool('bungalow')))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit3'); // same digit again deselects
  await expect.poll(async () => (await diag(page)).tool).toBeNull();
  // Shift+3 = Town: 1 = tiered fountain.
  await page.keyboard.press('Shift+Digit3');
  await expect(page.locator(id(UI_TEST_IDS.category('town')))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await diag(page)).tool).toBe('tiered-fountain');
  // Shift+4 = Nature: 6 = pine.
  await page.keyboard.press('Shift+Digit4');
  await page.keyboard.press('Digit6');
  await expect.poll(async () => (await diag(page)).tool).toBe('pine');
  // Shift+5 = Garden: 1 = hedge.
  await page.keyboard.press('Shift+Digit5');
  await expect(page.locator(id(UI_TEST_IDS.category('garden')))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await diag(page)).tool).toBe('hedge');
});

test('undo/redo disabled states follow history', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  const undo = page.locator(id(UI_TEST_IDS.undo));
  const redo = page.locator(id(UI_TEST_IDS.redo));
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.locator(id(UI_TEST_IDS.category('streets'))).click();
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
  errors.expectNone();
});

test('refusal tooltip shows on an invalid click and is gone after the next successful placement', async ({ page }) => {
  const errors = trackErrors(page);
  await start(page);
  const tip = page.locator(id(UI_TEST_IDS.tooltip));
  await page.locator(id(UI_TEST_IDS.category('homes'))).click();
  await page.locator(id(UI_TEST_IDS.tool('cottage'))).click();

  // Cottages are 4 × 4: the first on x 17–20, rows 16–19; the second on x 27–30, rows 16–19.
  await clickFootprint(page, 'cottage', { x: 17, z: 16 });
  await expect.poll(async () => (await diag(page)).town.homes).toBe(1);
  const invalidBefore = (await diag(page)).invalidCount;
  await clickFootprint(page, 'cottage', { x: 17, z: 16 }); // occupied → refused
  await expect.poll(async () => (await diag(page)).invalidCount).toBe(invalidBefore + 1);
  await expect(tip).toBeVisible();
  await expect(tip).not.toHaveText('');

  await clickFootprint(page, 'cottage', { x: 27, z: 16 }); // valid → placed
  await expect.poll(async () => (await diag(page)).town.homes).toBe(2);
  await expect(tip).toBeHidden();

  // A refusal followed by a tool switch also clears it. (build:invalid is throttled to one per
  // 400 ms per reason, so wait before refusing the same reason again.)
  await page.waitForTimeout(450);
  await clickFootprint(page, 'cottage', { x: 27, z: 16 });
  await expect(tip).toBeVisible();
  await page.locator(id(UI_TEST_IDS.tool('bungalow'))).click();
  await expect(tip).toBeHidden();
  errors.expectNone();
});

test('refusal tooltip never overlaps the dock, top bar or hint (refusal right above the dock)', async ({ page }, info) => {
  const errors = trackErrors(page);
  await start(page);
  await page.locator(id(UI_TEST_IDS.category('homes'))).click();
  await page.locator(id(UI_TEST_IDS.tool('family-home'))).click();
  const target = await cellAboveDock(page);
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
    return { tip: r('#ui-tooltip')!, dock: r('#ui-dock')!, topbar: r('.ui-topbar')!, hint: r('#ui-hint') };
  });
  const hits = (a: typeof rects.tip, b: typeof rects.tip | null) =>
    !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  console.log(`${info.project.name} tooltip ${JSON.stringify(rects.tip)} dock top ${rects.dock.top}`);
  expect(hits(rects.tip, rects.dock), 'tooltip × dock').toBe(false);
  expect(hits(rects.tip, rects.topbar), 'tooltip × top bar').toBe(false);
  expect(hits(rects.tip, rects.hint), 'tooltip × hint').toBe(false);
  await page.screenshot({ path: `${OUT}/tooltip-${info.project.name}.png` });
  errors.expectNone();
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
  await openMenuTab(page, 'town');
  await page.locator(id(UI_TEST_IDS.newTown)).click();
  await expect(page.locator(id(UI_TEST_IDS.confirmPanel))).toBeVisible();
  await expect(page.locator(id(UI_TEST_IDS.confirmPanel))).toContainText('Start a new town?');
  await page.locator(id(UI_TEST_IDS.confirmCancel)).click();
  await expect(page.locator(id(UI_TEST_IDS.menuPanel))).toBeVisible();
  expect((await diag(page)).town.homes).toBe(homes);

  // New town → confirm → Clear → name the new town empties it and returns to building.
  await page.locator(id(UI_TEST_IDS.newTown)).click();
  await page.locator(id(UI_TEST_IDS.confirmClear)).click();
  await expect(page.locator(id(UI_TEST_IDS.namePanel))).toBeVisible();
  expect((await diag(page)).town.homes).toBe(homes); // nothing is cleared before the name is confirmed
  await page.locator(id(UI_TEST_IDS.nameSubmit)).click();
  await expect.poll(async () => (await diag(page)).town.homes).toBe(0);
  await expect.poll(async () => (await diag(page)).phase).toBe('building');
  errors.expectNone();
});

test('keyboard only: Tab reaches every dock button with a visible focus ring', async ({ page }) => {
  await start(page);
  await page.locator(id(UI_TEST_IDS.category('homes'))).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Rendered buttons only: Rotate is hidden with a mouse and keyboard (R rotates).
  await expect(page.locator(id(UI_TEST_IDS.rotate))).toBeHidden();
  const dockIds = await page.$$eval(`#${UI_TEST_IDS.dock} button`, (els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.id),
  );
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

test('dock is ≤ 150 px tall on desktop and clear of the plot centre', async ({ page }) => {
  await start(page);
  await page.locator(id(UI_TEST_IDS.category('homes'))).click();
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

test('stress-town screenshots: no overlap or clipping at 4 sizes (Buildings tray, hint and refusal tooltip up)', async ({ browser }, info) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  for (const [width, height] of SIZES) {
    const mobile = width < 760;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await start(page);
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('stress-town'));
    await page.locator(id(UI_TEST_IDS.category('homes'))).click();
    await page.locator(id(UI_TEST_IDS.tool('family-home'))).click(); // shows the hint for 3.5 s
    await page.waitForTimeout(300); // tray slide settles
    // Provoke a refusal tooltip right above the dock (a free cell takes one tap to fill, then refuses).
    const target = await cellAboveDock(page);
    expect(target, `${width}x${height}: a canvas cell above the dock`).not.toBeNull();
    const refusedBefore = (await diag(page)).invalidCount;
    for (let i = 0; i < 3 && (await diag(page)).invalidCount === refusedBefore; i += 1) {
      if (mobile) await page.touchscreen.tap(target!.px, target!.py);
      else await page.mouse.click(target!.px, target!.py);
      await page.waitForTimeout(450); // build:invalid is throttled per reason
    }
    await expect(page.locator(id(UI_TEST_IDS.tooltip)), `${width}x${height}: refusal tooltip`).toBeVisible();
    await expect(page.locator(id(UI_TEST_IDS.hint)), `${width}x${height}: hint`).toHaveClass(/is-visible/);

    const report = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const problems: string[] = [];
      const visible = (el: Element) => {
        const r = rect(el);
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
      };
      const blocks = ['.ui-brand', '.ui-actions', '#ui-dock', '#ui-hint', '#ui-tooltip'].map((s) => document.querySelector(s)!).filter(visible);
      if (blocks.length !== 5) problems.push(`expected 5 visible blocks, got ${blocks.map((el) => el.className || el.id).join(', ')}`);
      // The top bar is a single row: brand and actions share one line.
      const brand = rect(document.querySelector('.ui-brand')!);
      const actions = rect(document.querySelector('.ui-actions')!);
      if (brand.bottom <= actions.top || actions.bottom <= brand.top) problems.push('top bar wraps to two rows');
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
      for (const el of document.querySelectorAll<HTMLElement>('.ui-card-label, .ui-tab span, .ui-mode-label, #ui-hint, .ui-brand .ui-mark-text')) {
        if (!visible(el) || getComputedStyle(el).display === 'none') continue;
        if (el.scrollWidth > el.clientWidth + 1) problems.push(`clipped text "${el.textContent}" (${el.scrollWidth} > ${el.clientWidth})`);
      }
      // Touch targets on phones.
      if (vw < 760) {
        for (const el of document.querySelectorAll<HTMLElement>('.ui-actions button, #ui-dock button')) {
          const r = rect(el);
          if (r.width > 0 && (r.width < 44 || r.height < 44)) problems.push(`small target ${el.id} ${r.width}×${r.height}`);
        }
      }
      const dock = rect(document.querySelector('#ui-dock')!);
      const topbar = rect(document.querySelector('.ui-topbar')!);
      return { problems, dockHeight: Math.round(dock.height), topbarBottom: Math.round(topbar.bottom) };
    });
    const file = `${OUT}/stress-town-buildings-${width}x${height}.png`;
    await page.screenshot({ path: file });
    await info.attach(`stress-town-${width}x${height}`, { path: file, contentType: 'image/png' });
    console.log(`${width}x${height}: dock ${report.dockHeight}px, top bar bottom ${report.topbarBottom}px, problems ${JSON.stringify(report.problems)}`);
    expect(report.problems, `${width}x${height}`).toEqual([]);
    errors.expectNone();

    // Extra evidence for the other states at this size.
    await page.locator(id(UI_TEST_IDS.menu)).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/menu-${width}x${height}.png` });
    await openMenuTab(page, 'help');
    await page.locator(id(UI_TEST_IDS.help)).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/help-${width}x${height}.png` });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('title'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/title-${width}x${height}.png` });
    await context.close();
  }
});

test('menu music rows: ≥ 44 px targets inside the panel, keyboard reachable, screenshot', async ({ page }, info) => {
  const errors = trackErrors(page);
  await start(page);
  await page.locator(id(UI_TEST_IDS.menu)).click();
  const panel = page.locator(id(UI_TEST_IDS.menuPanel));
  await expect(panel).toBeVisible();
  await openMenuTab(page, 'sound');
  const box = (await panel.boundingBox())!;
  for (const control of [UI_TEST_IDS.volume, UI_TEST_IDS.music, UI_TEST_IDS.musicVolume]) {
    const row = page.locator(id(control)).locator('xpath=ancestor::*[contains(@class,"ui-field")][1]');
    await row.scrollIntoViewIfNeeded();
    const r = (await row.boundingBox())!;
    expect(r.height, `${control} row height`).toBeGreaterThanOrEqual(44);
    expect(r.x).toBeGreaterThanOrEqual(box.x);
    expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  // The Music label toggles the switch (whole row is the target).
  await page.getByLabel('Sound', { exact: true }).getByText('Music', { exact: true }).click();
  await expect(page.locator(id(UI_TEST_IDS.music))).not.toBeChecked();
  await expect(page.locator(id(UI_TEST_IDS.musicVolume))).toBeDisabled();
  await page.locator(id(UI_TEST_IDS.music)).click();
  await expect(page.locator(id(UI_TEST_IDS.musicVolume))).toBeEnabled();
  if (info.project.name !== 'mobile-chrome') {
    // Tab from the master volume slider reaches the music switch, then the music volume slider.
    await page.locator(id(UI_TEST_IDS.volume)).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(id(UI_TEST_IDS.music))).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator(id(UI_TEST_IDS.musicVolume))).toBeFocused();
  }
  mkdirSync(OUT, { recursive: true });
  await panel.screenshot({ path: `${OUT}/menu-music-${info.project.name}.png` });
  errors.expectNone();
});
