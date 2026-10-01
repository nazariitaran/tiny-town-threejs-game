/**
 * Move tool, through real input. Positions are read back from the autosave, the carried object from
 * diagnostics `selection`.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SAVE_STORAGE_KEY } from '../src/game/config';
import type { Cell, ObjectKind, Rotation, SavedTown } from '../src/town/types';
import {
  byId,
  clickFootprint,
  clickStart,
  diagnostics,
  dragCells,
  expectDiagnostics,
  footprintPoint,
  gotoTitle,
  selectTool,
  startBuilding,
  trackErrors,
  UI_TEST_IDS,
} from './helpers';

const ARTIFACTS = 'artifacts/move-objects';
const HOUSE_A = { x: 22, z: 20 } as const;
const HOUSE_B = { x: 30, z: 20 } as const;
const HOUSE_A_NEW = { x: 22, z: 28 } as const;
const OAK = { x: 36, z: 28 } as const;

const isMobile = (name: string) => name.startsWith('mobile');

/** The town as saved (after the 1 s autosave debounce has run). */
async function savedTown(page: Page): Promise<SavedTown> {
  await expect.poll(async () => (await diagnostics(page)).save.pending, { timeout: 5_000 }).toBe(false);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_STORAGE_KEY);
}

async function objectsByKind(page: Page, kind: ObjectKind): Promise<Array<{ id: number; anchor: Cell; rotation: number }>> {
  const town = await savedTown(page);
  return town.objects.filter((o) => o.kind === kind).map((o) => ({ id: o.id, anchor: o.anchor, rotation: o.rotation }));
}

/** Click (or, on touch, tap) the client point that puts `kind` turned `rotation` down on `anchor`. */
async function pointAt(page: Page, kind: ObjectKind, anchor: Cell, rotation: Rotation = 0, touch = false): Promise<void> {
  if (!touch) {
    await clickFootprint(page, kind, anchor, rotation);
    return;
  }
  const p = await footprintPoint(page, kind, anchor, rotation);
  await page.touchscreen.tap(p.x, p.y);
}

async function hoverAt(page: Page, kind: ObjectKind, anchor: Cell, rotation: Rotation = 0): Promise<void> {
  const p = await footprintPoint(page, kind, anchor, rotation);
  await page.mouse.move(p.x, p.y, { steps: 3 });
}

async function setUpTown(page: Page): Promise<void> {
  await gotoTitle(page);
  await startBuilding(page);
  await selectTool(page, 'cottage');
  await clickFootprint(page, 'cottage', HOUSE_A);
  await clickFootprint(page, 'cottage', HOUSE_B);
  await selectTool(page, 'oak');
  await clickFootprint(page, 'oak', OAK);
  await expectDiagnostics(page, { objects: 3, history: { undoDepth: 3 } }, 'two cottages and an oak');
}

test('pick up a cottage, a refused drop, turn it, put it down, undo / redo, reload', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const mobile = isMobile(testInfo.project.name);
  mkdirSync(ARTIFACTS, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-${name}.png` });
  await setUpTown(page);
  const [houseA] = (await objectsByKind(page, 'cottage')).filter((o) => o.anchor.x === HOUSE_A.x);
  expect(houseA, 'cottage A saved where it was placed').toMatchObject({ anchor: HOUSE_A, rotation: 0 });

  // The dock's Move button (desktop also checks the M key further down).
  await selectTool(page, 'move');
  await expect(byId(page, UI_TEST_IDS.move)).toHaveAttribute('aria-pressed', 'true');
  if (!mobile) {
    await hoverAt(page, 'cottage', HOUSE_A);
    await shot('1-hover-highlight');
  }

  await pointAt(page, 'cottage', HOUSE_A);
  await expect.poll(async () => (await diagnostics(page)).selection).toEqual({ id: houseA.id, kind: 'cottage', rotation: 0 });
  await expect(byId(page, UI_TEST_IDS.hint)).toContainText(mobile ? 'Tap where it goes' : 'Click where it goes');

  // A drop onto the other cottage is refused: the reason shows and it stays in hand.
  const invalidBefore = (await diagnostics(page)).invalidCount;
  await hoverAt(page, 'cottage', HOUSE_B);
  await expect.poll(async () => (await diagnostics(page)).hover).toMatchObject({ valid: false, reason: 'Something is already here' });
  if (!mobile) await shot('2-carry-invalid');
  await pointAt(page, 'cottage', HOUSE_B);
  await expect(page.locator(`#${UI_TEST_IDS.tooltip}`)).toContainText('Something is already here');
  const afterRefusal = await diagnostics(page);
  expect(afterRefusal.invalidCount).toBe(invalidBefore + 1);
  expect(afterRefusal.selection?.id, 'still carrying after a refused drop').toBe(houseA.id);
  expect(afterRefusal.history.undoDepth).toBe(3);

  // Turn it: R on desktop, the dock's Rotate button on touch screens. Clockwise = rotation 3.
  if (mobile) await byId(page, UI_TEST_IDS.rotate).click();
  else await page.keyboard.press('KeyR');
  await expect.poll(async () => (await diagnostics(page)).selection?.rotation).toBe(3);

  // Put it down on free field: one undo entry, still three objects, same id.
  await hoverAt(page, 'cottage', HOUSE_A_NEW, 3);
  await expect.poll(async () => (await diagnostics(page)).hover?.valid).toBe(true);
  if (!mobile) await shot('3-carry-valid');
  await pointAt(page, 'cottage', HOUSE_A_NEW, 3);
  await expectDiagnostics(page, { objects: 3, history: { undoDepth: 4, redoDepth: 0 } }, 'moved: one undo entry');
  expect((await diagnostics(page)).selection, 'nothing in hand after the drop').toBeNull();
  await expect(byId(page, UI_TEST_IDS.hint), 'the carry hint goes with the drop').not.toHaveClass(/is-visible/);
  if (!mobile) {
    // The hop is 0.3 s: catch it on the way, then landed.
    await shot('4-hop');
    await page.waitForTimeout(500);
    await shot('5-landed');
  }
  expect(await diagnostics(page).then((d) => d.render.objects)).toBe(3);
  expect((await objectsByKind(page, 'cottage')).find((o) => o.id === houseA.id)).toEqual({ id: houseA.id, anchor: HOUSE_A_NEW, rotation: 3 });
  expect(await diagnostics(page).then((d) => d.tool), 'the Move tool stays selected for the next pick').toBe('move');

  await byId(page, UI_TEST_IDS.undo).click();
  await expect.poll(async () => (await objectsByKind(page, 'cottage')).find((o) => o.id === houseA.id)).toEqual({ id: houseA.id, anchor: HOUSE_A, rotation: 0 });
  await byId(page, UI_TEST_IDS.redo).click();
  await expect.poll(async () => (await objectsByKind(page, 'cottage')).find((o) => o.id === houseA.id)).toEqual({ id: houseA.id, anchor: HOUSE_A_NEW, rotation: 3 });

  await page.reload();
  await gotoTitle(page);
  await clickStart(page);
  await expect.poll(async () => (await objectsByKind(page, 'cottage')).find((o) => o.id === houseA.id)).toEqual({ id: houseA.id, anchor: HOUSE_A_NEW, rotation: 3 });
  expect((await diagnostics(page)).objects).toBe(3);
  errors.expectNone();
});

test('put back with Esc and right-click; trees move but do not turn; the roundabout cannot be picked up', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'keyboard and right-click: desktop only');
  const errors = trackErrors(page);
  await setUpTown(page);
  const [houseB] = (await objectsByKind(page, 'cottage')).filter((o) => o.anchor.x === HOUSE_B.x);

  // M selects Move; Esc puts the carried thing back, a second Esc puts the tool away.
  await page.keyboard.press('KeyM');
  await expect.poll(async () => (await diagnostics(page)).tool).toBe('move');
  await pointAt(page, 'cottage', HOUSE_B);
  await expect.poll(async () => (await diagnostics(page)).selection?.id).toBe(houseB.id);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await diagnostics(page)).selection).toBeNull();
  expect((await diagnostics(page)).tool).toBe('move');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await diagnostics(page)).tool).toBeNull();

  // A right click puts it back too (and keeps the tool).
  await selectTool(page, 'move');
  await pointAt(page, 'cottage', HOUSE_B);
  await expect.poll(async () => (await diagnostics(page)).selection?.id).toBe(houseB.id);
  const p = await footprintPoint(page, 'cottage', { x: 22, z: 34 });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect.poll(async () => (await diagnostics(page)).selection).toBeNull();
  expect((await diagnostics(page)).tool).toBe('move');
  expect((await diagnostics(page)).history.undoDepth, 'putting back changes nothing').toBe(3);

  // The oak moves, but R doesn't turn it (its look comes from its id).
  const [oak] = await objectsByKind(page, 'oak');
  await pointAt(page, 'oak', OAK);
  await expect.poll(async () => (await diagnostics(page)).selection?.kind).toBe('oak');
  await page.keyboard.press('KeyR');
  expect((await diagnostics(page)).selection?.rotation).toBe(oak.rotation);
  await pointAt(page, 'oak', { x: 40, z: 32 });
  await expect.poll(async () => (await objectsByKind(page, 'oak'))[0]).toEqual({ id: oak.id, anchor: { x: 40, z: 32 }, rotation: oak.rotation });

  // The roundabout belongs to the road: clicking it says so and picks nothing up.
  await selectTool(page, 'roundabout');
  await clickFootprint(page, 'roundabout', { x: 8, z: 40 });
  await expectDiagnostics(page, { objects: 4 }, 'roundabout placed');
  await selectTool(page, 'move');
  const invalidBefore = (await diagnostics(page)).invalidCount;
  await pointAt(page, 'roundabout', { x: 8, z: 40 });
  await expect(page.locator(`#${UI_TEST_IDS.tooltip}`)).toContainText("Roundabout can't be moved");
  expect((await diagnostics(page)).selection).toBeNull();
  expect((await diagnostics(page)).invalidCount).toBe(invalidBefore + 1);

  // Ground never moves: clicking a road does nothing.
  await selectTool(page, 'road');
  await dragCells(page, [8, 50], [14, 50]);
  await selectTool(page, 'move');
  const before = await diagnostics(page);
  await pointAt(page, 'bench', { x: 10, z: 50 });
  const after = await diagnostics(page);
  expect(after.selection).toBeNull();
  expect(after.invalidCount).toBe(before.invalidCount);
  errors.expectNone();
});

test('touch: tap a thing, tap where it goes', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo.project.name), 'touch taps: mobile only');
  const errors = trackErrors(page);
  await setUpTown(page);
  const [houseB] = (await objectsByKind(page, 'cottage')).filter((o) => o.anchor.x === HOUSE_B.x);
  await selectTool(page, 'move');
  await pointAt(page, 'cottage', HOUSE_B, 0, true);
  await expect.poll(async () => (await diagnostics(page)).selection?.id).toBe(houseB.id);
  await expect(byId(page, UI_TEST_IDS.hint)).toContainText('Tap where it goes');
  await pointAt(page, 'cottage', { x: 30, z: 28 }, 0, true);
  await expectDiagnostics(page, { objects: 3, history: { undoDepth: 4 } }, 'moved by two taps');
  expect((await diagnostics(page)).selection).toBeNull();
  expect((await objectsByKind(page, 'cottage')).find((o) => o.id === houseB.id)?.anchor).toEqual({ x: 30, z: 28 });
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-dock.png` });
  errors.expectNone();
});
