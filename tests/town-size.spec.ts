/**
 * Town size: chosen in the new-town dialog, fixed for the town's life, saved by name in the autosave and
 * the town file, and validated on the way back in. Large-town files are made in Node through the real
 * editor and save format, so no fixture can drift from them.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PLOT_DEPTH, PLOT_WIDTH, setPlotSize } from '../src/game/config';
import { createGameBus } from '../src/game/events';
import { encodeTownFile } from '../src/persistence/townFile';
import { TownEditor } from '../src/town/TownEditor';
import { TownState } from '../src/town/TownState';
import { createSeededRandom } from '../src/utils/random';
import { applyState, byId, canvasPoint, diagnostics, gotoTitle, openMenuTab, reloadWhenLoaded, selectTool, trackErrors, UI_TEST_IDS } from './helpers';

const OUT = 'artifacts/town-size';
const SMALL = { size: 'small', width: 64, depth: 64 };
const LARGE = { size: 'large', width: 84, depth: 84 };

const plotOf = async (page: Page) => (await diagnostics(page)).plot;
const phase = async (page: Page) => (await diagnostics(page)).phase;
const sizeRadio = (page: Page, size: 'small' | 'large') => byId(page, UI_TEST_IDS.townSizeOption(size));

/**
 * A large town made in Node: a road block in the middle 64 × 64 (12, 12), one in the outer ring (80, 80),
 * and an oak in each ring. Its save goes through the real editor, so only `size` is tampered with.
 */
function largeTownSave(): Record<string, unknown> {
  const editor = new TownEditor(new TownState(64, 64), createGameBus(), createSeededRandom(3));
  editor.reset('Broadmeadow', 'large');
  for (const cell of [{ x: 12, z: 12 }, { x: 80, z: 80 }]) editor.apply({ type: 'paint-ground', kind: 'road', cell }, 'road');
  editor.apply({ type: 'place-object', kind: 'oak', cell: { x: 40, z: 40 }, rotation: 0 }, 'oak');
  editor.apply({ type: 'place-object', kind: 'oak', cell: { x: 2, z: 40 }, rotation: 0 }, 'oak');
  const save = editor.serialize() as unknown as Record<string, unknown>;
  setPlotSize(PLOT_WIDTH, PLOT_DEPTH); // the editor moved this worker's mapping
  return save;
}

const asUpload = (text: string) => ({ name: 'broadmeadow.tinytown.json', mimeType: 'application/json', buffer: Buffer.from(text) });

/** Look straight at a cell from close by, so a real click can reach it anywhere on the plot. */
async function lookAt(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(
    ([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose({ targetX: (cx + 0.5 - 42) * 0.5, targetZ: (cz + 0.5 - 42) * 0.5, azimuth: Math.PI / 4, polar: 0.9, distance: 14 }),
    [x, z] as const,
  );
}

test.describe('town size', () => {
  test('a large town from the title: chosen in the dialog, built to its far corner, downloaded and continued', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    expect(await plotOf(page)).toEqual(SMALL);
    await byId(page, UI_TEST_IDS.start).click();
    await expect(byId(page, UI_TEST_IDS.townSizeGroup)).toBeVisible();
    await expect(sizeRadio(page, 'small')).toBeChecked();
    await expect(byId(page, UI_TEST_IDS.townSizeGroup)).toHaveText('SmallLarge');
    await sizeRadio(page, 'large').check();
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/e2e-dialog.png` });
    await byId(page, UI_TEST_IDS.nameInput).fill('Broadmeadow');
    await byId(page, UI_TEST_IDS.nameInput).press('Enter');
    await expect.poll(() => phase(page)).toBe('building');
    expect(await plotOf(page)).toEqual(LARGE);
    await page.screenshot({ path: `${OUT}/e2e-large-home.png` });

    // The far corner is in the plot: a real click paints its road block; the camera can get there.
    await lookAt(page, 83, 83);
    expect((await diagnostics(page)).camera).toMatchObject({ targetX: 20.75, targetZ: 20.75 });
    await selectTool(page, 'road');
    const corner = await canvasPoint(page, 83, 83);
    await page.mouse.click(corner.x, corner.y);
    await expect.poll(async () => (await diagnostics(page)).town.roadTiles).toBe(1);
    await page.screenshot({ path: `${OUT}/e2e-large-corner.png` });

    // The town file names the size, not the dimensions.
    await byId(page, UI_TEST_IDS.townFile).click();
    const [download] = await Promise.all([page.waitForEvent('download'), byId(page, UI_TEST_IDS.fileDownload).click()]);
    const path = `${OUT}/e2e-${download.suggestedFilename()}`;
    await download.saveAs(path);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file.town).toMatchObject({ version: 5, size: 'large', name: 'Broadmeadow' });
    await page.keyboard.press('Escape');
    await expect.poll(() => phase(page)).toBe('building');

    // Continue after a reload: still large, road and all.
    await expect.poll(async () => (await diagnostics(page)).save.pending, { timeout: 5_000 }).toBe(false);
    await reloadWhenLoaded(page);
    expect(await plotOf(page)).toEqual(SMALL); // the title shows the bare small plot until Continue
    await byId(page, UI_TEST_IDS.start).click();
    await expect.poll(() => phase(page)).toBe('building');
    expect(await plotOf(page)).toEqual(LARGE);
    expect((await diagnostics(page)).town.roadTiles).toBe(1);
    expect((await diagnostics(page)).townName).toBe('Broadmeadow');
    errors.expectNone();
  });

  test('renaming offers no size; Menu → New town changes it both ways; a test state is small again', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'empty-build');
    await byId(page, UI_TEST_IDS.townName).click();
    await expect(byId(page, UI_TEST_IDS.namePanel)).toHaveAttribute('data-mode', 'rename');
    await expect(byId(page, UI_TEST_IDS.townSizeGroup)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect.poll(() => phase(page)).toBe('building');

    for (const size of ['large', 'small', 'large'] as const) {
      await openMenuTab(page, 'town');
      await byId(page, UI_TEST_IDS.newTown).click();
      await byId(page, UI_TEST_IDS.confirmClear).click();
      await expect(sizeRadio(page, 'small')).toBeChecked(); // every new town starts from Small
      await sizeRadio(page, size).check();
      await byId(page, UI_TEST_IDS.nameSubmit).click();
      await expect.poll(() => phase(page)).toBe('building');
      expect(await plotOf(page)).toEqual(size === 'large' ? LARGE : SMALL);
    }
    await applyState(page, 'sample-town');
    expect(await plotOf(page)).toEqual(SMALL);
    errors.expectNone();
  });

  test('opened files and loaded saves take their size; an unknown size opens as small without the outer ring', async ({ page }) => {
    const errors = trackErrors(page);
    const save = largeTownSave();
    await gotoTitle(page);

    // The loadTown hook adopts a large save as is.
    const kept = await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__!.loadTown(s), save);
    expect(kept.objects).toBe(2);
    expect(await plotOf(page)).toEqual(LARGE);
    expect((await diagnostics(page)).town.roadTiles).toBe(2);

    // A file whose size is not a size: opened from the title as a small town, keeping its middle.
    await gotoTitle(page);
    const text = encodeTownFile({ ...save, size: 'huge' } as never, new Date(2026, 9, 15, 12, 0));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), byId(page, UI_TEST_IDS.titleOpenFile).click()]);
    await chooser.setFiles(asUpload(text));
    await byId(page, UI_TEST_IDS.fileConfirmOpen).click();
    await expect.poll(() => phase(page)).toBe('building');
    expect(await plotOf(page)).toEqual(SMALL);
    const diag = await diagnostics(page);
    expect(diag.townName).toBe('Broadmeadow');
    expect(diag.objects, 'the oak at x 2 lies outside the middle 64 × 64').toBe(1);
    expect(diag.town.roadTiles, 'the road block at (80, 80) lies outside it').toBe(1);

    // The same file, size intact, opened from the menu over the small town: large again.
    await byId(page, UI_TEST_IDS.townFile).click();
    const [again] = await Promise.all([page.waitForEvent('filechooser'), byId(page, UI_TEST_IDS.fileOpen).click()]);
    await again.setFiles(asUpload(encodeTownFile(save as never, new Date(2026, 9, 15, 12, 0))));
    await byId(page, UI_TEST_IDS.fileConfirmOpen).click();
    await expect.poll(() => phase(page)).toBe('building');
    expect(await plotOf(page)).toEqual(LARGE);
    expect((await diagnostics(page)).objects).toBe(2);
    errors.expectNone();
  });
});
