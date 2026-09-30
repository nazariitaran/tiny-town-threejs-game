/**
 * WP-21 town file: download the town, open a file back (with a confirm), from the game and from the
 * title. Real input only: the top-bar Town file button (desktop) or the menu row (phones), the file
 * chooser, the panel and confirm buttons; `applyState` is setup. Test files are made in Node from
 * the real sample town (encodeTownFile), so no fixture can drift from the save format.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PLOT_DEPTH, PLOT_WIDTH } from '../src/game/config';
import { createGameBus } from '../src/game/events';
import { encodeTownFile, TOWN_FILE_ERRORS } from '../src/persistence/townFile';
import { buildSampleTown } from '../src/town/sampleTown';
import { TownEditor } from '../src/town/TownEditor';
import { TownState } from '../src/town/TownState';
import { createSeededRandom } from '../src/utils/random';
import { applyState, byId, diagnostics, gotoTitle, openMenuTab, trackErrors, UI_TEST_IDS } from './helpers';

const OUT = 'artifacts/wp-21';
const CAMERA = { targetX: 2, targetZ: -3, azimuth: 1.1, polar: 0.95, distance: 24 };

/** A town file made in Node: the sample town called `name`, with a camera pose. */
function sampleTownFile(name: string): { text: string; stats: ReturnType<TownState['stats']> } {
  const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(3));
  buildSampleTown(editor);
  editor.rename(name);
  return { text: encodeTownFile(editor.serialize(CAMERA), new Date(2026, 8, 29, 12, 0)), stats: editor.state.stats() };
}

const asUpload = (text: string, name = 'bumbleford-2026-09-29-1200.tinytown.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
const phase = async (page: Page) => (await diagnostics(page)).phase;
const status = (page: Page) => page.locator(`#${UI_TEST_IDS.filePanel} .ui-file-status`);

/** The Town file panel: the top-bar button on desktop, Menu → Town file on phones. */
async function openFilePanel(page: Page, info: TestInfo): Promise<void> {
  if (info.project.name === 'mobile-chrome') {
    await expect(byId(page, UI_TEST_IDS.townFile)).toBeHidden();
    await openMenuTab(page, 'town');
    await byId(page, UI_TEST_IDS.townFileMenu).click();
  } else {
    await expect(byId(page, UI_TEST_IDS.townFileMenu)).toBeHidden();
    await byId(page, UI_TEST_IDS.townFile).click();
  }
  await expect(byId(page, UI_TEST_IDS.filePanel)).toBeVisible();
  await expect.poll(() => phase(page)).toBe('menu');
}

/** Click something that opens the file chooser and give it `file`. */
async function pickFile(page: Page, opener: string, file: ReturnType<typeof asUpload>): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), byId(page, opener).click()]);
  await chooser.setFiles(file);
}

async function newEmptyTown(page: Page, name: string): Promise<void> {
  await openMenuTab(page, 'town');
  await byId(page, UI_TEST_IDS.newTown).click();
  await byId(page, UI_TEST_IDS.confirmClear).click();
  await byId(page, UI_TEST_IDS.nameInput).fill(name);
  await byId(page, UI_TEST_IDS.nameSubmit).click();
  await expect.poll(async () => (await diagnostics(page)).town.homes).toBe(0);
  await expect.poll(() => phase(page)).toBe('building');
}

test.describe('town file', () => {
  test('download the live town, open it back over a new town, and Continue it after a reload', async ({ page }, info) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'sample-town');
    await byId(page, UI_TEST_IDS.townName).click();
    await byId(page, UI_TEST_IDS.nameInput).fill('Bumbleford');
    await byId(page, UI_TEST_IDS.nameSubmit).click();
    await expect.poll(() => phase(page)).toBe('building');
    const before = await diagnostics(page);

    // Download: a file named after the town, holding the live town.
    await openFilePanel(page, info);
    const [download] = await Promise.all([page.waitForEvent('download'), byId(page, UI_TEST_IDS.fileDownload).click()]);
    expect(download.suggestedFilename()).toMatch(/^bumbleford-\d{4}-\d{2}-\d{2}-\d{4}\.tinytown\.json$/);
    await expect(status(page)).toHaveText(`Saved as ${download.suggestedFilename()}`);
    mkdirSync(OUT, { recursive: true });
    const path = `${OUT}/e2e-${info.project.name}-${download.suggestedFilename()}`;
    await download.saveAs(path);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file).toMatchObject({ app: 'tiny-town', kind: 'town', format: 1 });
    expect(file.town.name).toBe('Bumbleford');
    expect(file.town.objects.length).toBe(before.objects);
    expect(file.town.camera).toEqual(before.camera);
    await page.keyboard.press('Escape');
    if (info.project.name === 'mobile-chrome') await page.keyboard.press('Escape'); // panel → menu → building
    await expect.poll(() => phase(page)).toBe('building');

    // A new, empty town; then open the file: the confirm names both towns.
    await newEmptyTown(page, 'Empty Acres');
    await openFilePanel(page, info);
    await pickFile(page, UI_TEST_IDS.fileOpen, { name: download.suggestedFilename(), mimeType: 'application/json', buffer: readFileSync(path) });
    const confirm = byId(page, UI_TEST_IDS.fileConfirmPanel);
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('h2')).toHaveText('Open Bumbleford?');
    await expect(confirm).toContainText('Empty Acres will be replaced');
    await expect(byId(page, UI_TEST_IDS.fileConfirmOpen)).toHaveText('Replace town');
    await expect(byId(page, UI_TEST_IDS.fileConfirmCancel)).toBeFocused();
    await page.screenshot({ path: `${OUT}/e2e-confirm-${info.project.name}.png` });
    await byId(page, UI_TEST_IDS.fileConfirmOpen).click();

    await expect.poll(() => phase(page)).toBe('building');
    await expect.poll(async () => (await diagnostics(page)).townName).toBe('Bumbleford');
    const after = await diagnostics(page);
    expect(after.town).toEqual(before.town);
    expect(after.objects).toBe(before.objects);
    expect(after.camera.distance).toBeCloseTo(before.camera.distance, 3);
    expect(after.history.undoDepth, 'opening a file is not undoable').toBe(0);
    // Written at once (even after a test state): a reload continues the opened town.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tiny-town:save:v1') ?? 'null'));
    expect(stored?.name).toBe('Bumbleford');

    await gotoTitle(page);
    await expect(page.locator('.ui-start-label')).toHaveText('Continue');
    await byId(page, UI_TEST_IDS.start).click();
    await expect.poll(() => phase(page)).toBe('building');
    await expect.poll(async () => (await diagnostics(page)).town).toEqual(before.town);
    expect((await diagnostics(page)).townName).toBe('Bumbleford');
    errors.expectNone();
  });

  test('Cancel keeps the town; a broken file or one from a newer version changes nothing', async ({ page }, info) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'sample-town');
    const before = await diagnostics(page);
    const { text } = sampleTownFile('Bumbleford');

    await openFilePanel(page, info);
    await pickFile(page, UI_TEST_IDS.fileOpen, asUpload(text));
    await expect(byId(page, UI_TEST_IDS.fileConfirmPanel)).toBeVisible();
    await byId(page, UI_TEST_IDS.fileConfirmCancel).click();
    await expect(byId(page, UI_TEST_IDS.filePanel)).toBeVisible(); // back to the panel
    expect((await diagnostics(page)).townName).toBe(before.townName);

    await pickFile(page, UI_TEST_IDS.fileOpen, asUpload('{"not": "a town"}', 'notes.json'));
    await expect(status(page)).toHaveText(TOWN_FILE_ERRORS.notTown);
    await expect(status(page)).toHaveAttribute('data-state', 'error');

    const newer = JSON.parse(text);
    newer.town.version = 99;
    await pickFile(page, UI_TEST_IDS.fileOpen, asUpload(JSON.stringify(newer)));
    await expect(status(page)).toHaveText(TOWN_FILE_ERRORS.newer);
    await expect(byId(page, UI_TEST_IDS.fileConfirmPanel)).toBeHidden();

    // "Download … first" in the confirm saves the current town before it goes.
    await pickFile(page, UI_TEST_IDS.fileOpen, asUpload(text));
    const keep = byId(page, UI_TEST_IDS.fileConfirmKeep);
    await expect(keep).toHaveText(`Download ${before.townName} first`);
    const [download] = await Promise.all([page.waitForEvent('download'), keep.click()]);
    expect(download.suggestedFilename()).toMatch(/^tiny-town-.*\.tinytown\.json$/);
    await expect(keep).toHaveText(`Saved as ${download.suggestedFilename()}`);
    await page.keyboard.press('Escape'); // confirm → panel
    await expect(byId(page, UI_TEST_IDS.filePanel)).toBeVisible();

    const after = await diagnostics(page);
    expect(after.town).toEqual(before.town);
    expect(after.townName).toBe(before.townName);
    errors.expectNone();
  });

  test('title link: open a town with no save, and ask before replacing a saved one', async ({ page }) => {
    const errors = trackErrors(page);
    const { text, stats } = sampleTownFile('Teacup Green');
    await gotoTitle(page);

    // No save: nothing is replaced, so the button just opens the town (and starts the game).
    await pickFile(page, UI_TEST_IDS.titleOpenFile, asUpload(text));
    const confirm = byId(page, UI_TEST_IDS.fileConfirmPanel);
    await expect(confirm.locator('h2')).toHaveText('Open Teacup Green?');
    await expect(confirm).toContainText('Saved on');
    await expect(byId(page, UI_TEST_IDS.fileConfirmOpen)).toHaveText('Open town');
    await expect(byId(page, UI_TEST_IDS.fileConfirmKeep)).toBeHidden();
    await byId(page, UI_TEST_IDS.fileConfirmOpen).click();
    await expect.poll(() => phase(page)).toBe('building');
    await expect.poll(async () => (await diagnostics(page)).town).toEqual(stats);
    expect((await diagnostics(page)).townName).toBe('Teacup Green');
    await expect.poll(async () => (await diagnostics(page)).audio.unlocked).toBe(true);

    // Now there is a save: the title asks first; Cancel leaves it; a broken file says so.
    await gotoTitle(page);
    await pickFile(page, UI_TEST_IDS.titleOpenFile, asUpload(sampleTownFile('Crumpet Cross').text));
    await expect(confirm).toContainText('Your saved town will be replaced.');
    await expect(byId(page, UI_TEST_IDS.fileConfirmOpen)).toHaveText('Replace town');
    await byId(page, UI_TEST_IDS.fileConfirmCancel).click();
    await expect(confirm).toBeHidden();
    expect(await phase(page)).toBe('title');
    await pickFile(page, UI_TEST_IDS.titleOpenFile, asUpload('garbage', 'photo.jpg'));
    await expect(status(page)).toHaveText(TOWN_FILE_ERRORS.notTown);
    await expect(byId(page, UI_TEST_IDS.fileDownload)).toBeHidden(); // no town to download on the title
    await byId(page, UI_TEST_IDS.fileClose).click();
    await byId(page, UI_TEST_IDS.start).click(); // Continue: still Teacup Green
    await expect.poll(async () => (await diagnostics(page)).townName).toBe('Teacup Green');
    errors.expectNone();
  });
});
