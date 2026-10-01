import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SAVE_STORAGE_KEY } from '../src/game/config';
import { TOWN_NAMES_PATH } from '../src/town/townName';
import { byId, diagnostics, gotoTitle, openMenuTab, trackErrors, UI_TEST_IDS } from './helpers';

const OUT = 'artifacts/town-name';
const NAMES: string[] = JSON.parse(readFileSync(`public/${TOWN_NAMES_PATH}`, 'utf8'));
const LONG_NAME = 'Bobbington-on-Wobble Downs XY'; // 29 characters

const input = (page: Page) => byId(page, UI_TEST_IDS.nameInput);
const submit = (page: Page) => byId(page, UI_TEST_IDS.nameSubmit);
const townName = async (page: Page) => (await diagnostics(page)).townName;
const phase = async (page: Page) => (await diagnostics(page)).phase;

/** Title → Start → the name dialog (no save yet). */
async function openNewTownDialog(page: Page): Promise<void> {
  await byId(page, UI_TEST_IDS.start).click();
  await expect(byId(page, UI_TEST_IDS.namePanel)).toBeVisible();
  await expect(byId(page, UI_TEST_IDS.namePanel)).toHaveAttribute('data-mode', 'new');
}

async function nameAndStart(page: Page, name: string): Promise<void> {
  await openNewTownDialog(page);
  await input(page).fill(name);
  await submit(page).click();
  await expect.poll(() => phase(page)).toBe('building');
}

async function waitForSave(page: Page): Promise<void> {
  await expect.poll(async () => (await diagnostics(page)).save.pending, { timeout: 5_000 }).toBe(false);
}

test.describe('name your town', () => {
  test('a new town is named first: suggestion, die, counter, typed name in the top bar', async ({ page }, info) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await openNewTownDialog(page);
    expect(await phase(page)).toBe('title');

    const suggested = await input(page).inputValue();
    expect(NAMES).toContain(suggested);
    await expect(page.locator('#ui-name-count')).toHaveText(`${Array.from(suggested).length} / 30`);
    await expect(submit(page)).toHaveText('Start building');
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/e2e-dialog-${info.project.name}.png` });

    // The die draws another name from the list, never the same one twice in a row.
    let previous = suggested;
    for (let i = 0; i < 5; i += 1) {
      await byId(page, UI_TEST_IDS.nameShuffle).click();
      const next = await input(page).inputValue();
      expect(NAMES).toContain(next);
      expect(next).not.toBe(previous);
      previous = next;
    }

    // Typing: 30 characters at most; a blank name can't be submitted; spaces are tidied.
    await input(page).fill('');
    await input(page).pressSequentially('x'.repeat(35));
    await expect(input(page)).toHaveValue('x'.repeat(30));
    await expect(page.locator('#ui-name-count')).toHaveText('30 / 30');
    await input(page).fill('   ');
    await expect(submit(page)).toBeDisabled();
    await input(page).fill('  Puddleton   Parva ');
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();

    await expect.poll(() => phase(page)).toBe('building');
    expect(await townName(page)).toBe('Puddleton Parva');
    const pill = byId(page, UI_TEST_IDS.townName);
    await expect(pill).toHaveAttribute('aria-label', 'Puddleton Parva, rename town');
    await expect(pill.locator('.ui-town-name')).toHaveText('Puddleton Parva');
    if (info.project.name === 'desktop-chrome') await expect(pill.locator('.ui-town-name')).toBeVisible();
    // The dialog's click starts the game, so it unlocks audio.
    await expect.poll(async () => (await diagnostics(page)).audio.unlocked).toBe(true);
    errors.expectNone();
  });

  test('Cancel and Esc go back to the title; Enter starts', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await openNewTownDialog(page);
    await byId(page, UI_TEST_IDS.nameCancel).click();
    await expect(byId(page, UI_TEST_IDS.namePanel)).toBeHidden();
    expect(await phase(page)).toBe('title');

    await openNewTownDialog(page);
    await input(page).focus();
    await page.keyboard.press('Escape'); // from inside the text field
    await expect(byId(page, UI_TEST_IDS.namePanel)).toBeHidden();
    expect(await phase(page)).toBe('title');

    await openNewTownDialog(page);
    await input(page).fill('Muffin Heath');
    await input(page).press('Enter');
    await expect.poll(() => phase(page)).toBe('building');
    expect(await townName(page)).toBe('Muffin Heath');
    errors.expectNone();
  });

  test('rename from the top bar and from the menu; the name survives a reload and Continue', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await nameAndStart(page, 'Puddleton');

    // Top-bar pill → rename dialog (menu phase) with the current name; Esc keeps it.
    await byId(page, UI_TEST_IDS.townName).click();
    await expect(byId(page, UI_TEST_IDS.namePanel)).toHaveAttribute('data-mode', 'rename');
    await expect.poll(() => phase(page)).toBe('menu');
    await expect(input(page)).toHaveValue('Puddleton');
    await expect(submit(page)).toHaveText('Save');
    await input(page).fill('Something else');
    await page.keyboard.press('Escape');
    await expect.poll(() => phase(page)).toBe('building'); // straight back, like the photo view
    expect(await townName(page)).toBe('Puddleton');

    // Rename for real: the pill and the menu heading follow; the rename is saved.
    await byId(page, UI_TEST_IDS.townName).click();
    await input(page).fill('Bumbleford');
    await submit(page).click();
    await expect.poll(() => phase(page)).toBe('building');
    expect(await townName(page)).toBe('Bumbleford');
    await waitForSave(page);

    // Menu → Rename town; Cancel returns to the menu, Save back to it too.
    await byId(page, UI_TEST_IDS.menu).click();
    await expect(page.locator('#ui-menu-h')).toHaveText('Bumbleford');
    await openMenuTab(page, 'town');
    await byId(page, UI_TEST_IDS.renameTown).click();
    await expect(input(page)).toHaveValue('Bumbleford');
    await byId(page, UI_TEST_IDS.nameCancel).click();
    await expect(byId(page, UI_TEST_IDS.menuPanel)).toBeVisible();
    await byId(page, UI_TEST_IDS.renameTown).click();
    await input(page).fill('Teacup Green');
    await submit(page).click();
    await expect(byId(page, UI_TEST_IDS.menuPanel)).toBeVisible();
    await expect(page.locator('#ui-menu-h')).toHaveText('Teacup Green');
    await byId(page, UI_TEST_IDS.resume).click();
    await waitForSave(page);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_STORAGE_KEY);
    expect(stored?.name).toBe('Teacup Green');

    // Reload: Continue goes straight in (no dialog) with the saved name.
    await gotoTitle(page);
    await expect(page.locator('.ui-start-label')).toHaveText('Continue');
    await byId(page, UI_TEST_IDS.start).click();
    await expect.poll(() => phase(page)).toBe('building');
    await expect(byId(page, UI_TEST_IDS.namePanel)).toBeHidden();
    expect(await townName(page)).toBe('Teacup Green');
    errors.expectNone();
  });

  test('New town from the menu: confirm, then a new name; Cancel keeps the old town', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await nameAndStart(page, 'Puddleton');

    await openMenuTab(page, 'town');
    await byId(page, UI_TEST_IDS.newTown).click();
    await byId(page, UI_TEST_IDS.confirmClear).click();
    await expect(byId(page, UI_TEST_IDS.namePanel)).toHaveAttribute('data-mode', 'new');
    const suggested = await input(page).inputValue();
    expect(NAMES).toContain(suggested);
    await byId(page, UI_TEST_IDS.nameCancel).click();
    await expect(byId(page, UI_TEST_IDS.menuPanel)).toBeVisible();
    expect(await townName(page)).toBe('Puddleton');

    await byId(page, UI_TEST_IDS.newTown).click();
    await byId(page, UI_TEST_IDS.confirmClear).click();
    await input(page).fill('Crumpet Cross');
    await submit(page).click();
    await expect.poll(() => phase(page)).toBe('building');
    expect(await townName(page)).toBe('Crumpet Cross');
    errors.expectNone();
  });

  test('the photo card and its file carry the town name (a long name still frames)', async ({ page }, info) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await nameAndStart(page, LONG_NAME);
    await byId(page, UI_TEST_IDS.photo).click();
    await expect(page.locator(`#${UI_TEST_IDS.photoPanel} .ui-print`)).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
    await expect(byId(page, UI_TEST_IDS.photoImage)).toHaveAttribute('alt', `A photo of ${LONG_NAME} in a Polaroid frame`);
    const [file] = await Promise.all([page.waitForEvent('download'), byId(page, UI_TEST_IDS.photoDownload).click()]);
    expect(file.suggestedFilename()).toMatch(/^bobbington-on-wobble-downs-xy-\d{4}-\d{2}-\d{2}-\d{4}\.jpg$/);
    mkdirSync(OUT, { recursive: true });
    const path = `${OUT}/e2e-${info.project.name}-${file.suggestedFilename()}`;
    await file.saveAs(path);
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.length).toBe((await diagnostics(page)).photo.last?.bytes);
    errors.expectNone();
  });

  test('the top bar stays one row with a 30-character name', async ({ page }) => {
    await gotoTitle(page);
    await nameAndStart(page, 'W'.repeat(30));
    const bar = await page.evaluate(() => {
      const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      // Visible actions only: the Town file button is display:none on phones.
      const buttons = [...document.querySelectorAll('.ui-actions button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0);
      return { brand: rect('#btn-town-name'), actions: rect('.ui-actions'), buttons, width: window.innerWidth };
    });
    expect(bar.brand.right).toBeLessThanOrEqual(bar.actions.left);
    expect(bar.actions.right).toBeLessThanOrEqual(bar.width);
    expect(Math.abs(bar.brand.top - bar.actions.top)).toBeLessThan(1);
    for (const b of bar.buttons) expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(40);
  });
});
