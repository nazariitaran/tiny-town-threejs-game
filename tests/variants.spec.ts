/**
 * Variant picker: a multi-model tool opens a strip of style chips over its card, and every placement
 * builds exactly the model the ghost shows. What was built is read back from the autosave.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SAVE_STORAGE_KEY } from '../src/game/config';
import type { Cell, ObjectKind, SavedTown } from '../src/town/types';
import { byId, canvasPoint, diagnostics, expectDiagnostics, footprintPoint, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS } from './helpers';

const ARTIFACTS = 'artifacts/variant-picker';
const TOWNHOUSES: readonly Cell[] = [
  { x: 22, z: 20 },
  { x: 27, z: 20 },
  { x: 32, z: 20 },
];

const isMobile = (name: string) => name.startsWith('mobile');

/** The town as saved (after the 1 s autosave debounce has run). */
async function savedTown(page: Page): Promise<SavedTown> {
  await expect.poll(async () => (await diagnostics(page)).save.pending, { timeout: 5_000 }).toBe(false);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_STORAGE_KEY);
}

async function savedVariants(page: Page, kind: ObjectKind): Promise<number[]> {
  const town = await savedTown(page);
  return town.objects.filter((o) => o.kind === kind).sort((a, b) => a.id - b.id).map((o) => o.variant);
}

/** Click (or, on touch, tap) the point that puts `kind` down on `anchor`. */
async function place(page: Page, kind: ObjectKind, anchor: Cell, touch: boolean): Promise<void> {
  const p = await footprintPoint(page, kind, anchor);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
  }
}

async function pressedChip(page: Page): Promise<string | null> {
  return page.locator(`#${UI_TEST_IDS.variants} [aria-pressed="true"]`).getAttribute('data-variant');
}

/** The strip and every chip are on screen, and every chip is a ≥ 44 px target. */
async function expectStripFits(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  const strip = await byId(page, UI_TEST_IDS.variants).boundingBox();
  expect(strip, 'strip laid out').not.toBeNull();
  expect(strip!.x).toBeGreaterThanOrEqual(0);
  expect(strip!.x + strip!.width).toBeLessThanOrEqual(viewport.width);
  expect(strip!.y).toBeGreaterThanOrEqual(0);
  // Layout size (offsetWidth/Height): the pressed chip's lift and the slide-up are transforms.
  const sizes = await page.locator(`#${UI_TEST_IDS.variants} .ui-chip`).evaluateAll((chips) => chips.map((c) => [(c as HTMLElement).offsetWidth, (c as HTMLElement).offsetHeight]));
  for (const [width, height] of sizes) {
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
}

test('pick a style: the ghost and every click build it; the choice is remembered', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const touch = isMobile(testInfo.project.name);
  mkdirSync(ARTIFACTS, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-${name}.png` });
  await gotoTitle(page);
  await startBuilding(page);

  // Cards with several models carry the dot badge; one-model cards don't.
  await byId(page, UI_TEST_IDS.category('homes')).click();
  await expect(byId(page, UI_TEST_IDS.tool('townhouse')).locator('.ui-card-variants i')).toHaveCount(2);
  await expect(byId(page, UI_TEST_IDS.tool('garage-house')).locator('.ui-card-variants i')).toHaveCount(4);
  await expect(byId(page, UI_TEST_IDS.tool('cottage')).locator('.ui-card-variants')).toHaveCount(0);

  await selectTool(page, 'townhouse');
  const strip = byId(page, UI_TEST_IDS.variants);
  await expect(strip).toBeVisible();
  await expect(strip.locator('.ui-chip')).toHaveCount(2); // one chip per model, nothing random
  expect(await pressedChip(page)).toBe('0');
  expect((await diagnostics(page)).variant).toEqual({ choice: 0, count: 2 });
  await expectStripFits(page);

  await place(page, 'townhouse', TOWNHOUSES[0], touch);
  await expectDiagnostics(page, { objects: 1 }, 'first townhouse');

  // Style 2: the ghost, the card's icon and the next two clicks all switch to it.
  await byId(page, UI_TEST_IDS.variant(1)).click();
  await expect.poll(async () => (await diagnostics(page)).variant).toEqual({ choice: 1, count: 2 });
  expect(await pressedChip(page)).toBe('1');
  await expect(byId(page, UI_TEST_IDS.tool('townhouse')).locator('img')).toHaveAttribute('src', /tool-townhouse-v1\.png$/);
  if (!touch) {
    const p = await footprintPoint(page, 'townhouse', TOWNHOUSES[1]);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('townhouse-style-2-ghost');
  }
  await place(page, 'townhouse', TOWNHOUSES[1], touch);
  await place(page, 'townhouse', TOWNHOUSES[2], touch);
  await expectDiagnostics(page, { objects: 3 }, 'three townhouses');
  expect(await savedVariants(page, 'townhouse')).toEqual([0, 1, 1]);
  await shot('townhouses-built');

  // A one-model tool: no strip, no variant state.
  await selectTool(page, 'cottage');
  await expect(strip).toBeHidden();
  expect((await diagnostics(page)).variant).toBeNull();
  if (!touch) {
    await page.keyboard.press('v');
    expect((await diagnostics(page)).variant).toBeNull();
  }

  // Back to the townhouse: style 2 is still chosen.
  await selectTool(page, 'townhouse');
  await expect(strip).toBeVisible();
  expect(await pressedChip(page)).toBe('1');
  expect((await diagnostics(page)).variant).toEqual({ choice: 1, count: 2 });

  // The strip goes with the tool: another category, Bulldoze, deselecting.
  await byId(page, UI_TEST_IDS.category('nature')).click();
  await expect(strip).toBeHidden();
  await byId(page, UI_TEST_IDS.category('homes')).click();
  await expect(strip).toBeVisible();
  await byId(page, UI_TEST_IDS.bulldoze).click();
  await expect(strip).toBeHidden();
  await selectTool(page, 'townhouse');
  await byId(page, UI_TEST_IDS.tool('townhouse')).click(); // clicking the active card puts it away
  await expect.poll(async () => (await diagnostics(page)).tool).toBeNull();
  await expect(strip).toBeHidden();
  errors.expectNone();
});

test('tulips: every placement builds the picked style; V / Shift+V step through the styles', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const touch = isMobile(testInfo.project.name);
  mkdirSync(ARTIFACTS, { recursive: true });
  await gotoTitle(page);
  await startBuilding(page);

  await selectTool(page, 'tulips');
  await expect(byId(page, UI_TEST_IDS.variants).locator('.ui-chip')).toHaveCount(3);
  expect(await pressedChip(page)).toBe('0'); // the first model until the player picks
  const picked: number[] = [];
  for (let i = 0; i < 6; i++) {
    const style = i % 3;
    await byId(page, UI_TEST_IDS.variant(style)).click();
    await expect.poll(async () => (await diagnostics(page)).variant?.choice).toBe(style);
    picked.push(style);
    const p = await canvasPoint(page, 26 + i, 30);
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
    }
    await expectDiagnostics(page, { objects: i + 1 }, `tulips ${i + 1}`);
  }
  expect(await savedVariants(page, 'tulips'), 'every tulip is the picked style').toEqual(picked);
  await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-tulips-picked.png` });

  if (!touch) {
    // V steps forward and wraps; Shift+V steps back. The pressed chip follows.
    await byId(page, UI_TEST_IDS.variant(0)).click();
    await page.keyboard.press('v');
    await expect.poll(async () => (await diagnostics(page)).variant).toEqual({ choice: 1, count: 3 });
    expect(await pressedChip(page)).toBe('1');
    await page.keyboard.press('v');
    await page.keyboard.press('v');
    await expect.poll(async () => (await diagnostics(page)).variant?.choice).toBe(0);
    await page.keyboard.press('Shift+V');
    await expect.poll(async () => (await diagnostics(page)).variant?.choice).toBe(2);
    expect(await pressedChip(page)).toBe('2');
  }
  errors.expectNone();
});

test('phone widths: the four Suburban chips fit on screen as 44 px targets', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo.project.name), 'phone layout');
  mkdirSync(ARTIFACTS, { recursive: true });
  await gotoTitle(page);
  await startBuilding(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 780 },
  ]) {
    await page.setViewportSize(viewport);
    await selectTool(page, 'garage-house');
    await expect(byId(page, UI_TEST_IDS.variants).locator('.ui-chip')).toHaveCount(4);
    await expectStripFits(page);
    await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-${viewport.width}-suburban-strip.png` });
    await byId(page, UI_TEST_IDS.tool('garage-house')).click(); // put it away for the next width
  }
});
