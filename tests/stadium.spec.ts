/**
 * The stadium, through real input: build it from the Town tray, carry it with Move and turn it on the
 * way, undo / redo, bulldoze. Positions are read back from the autosave.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { OBJECTS } from '../src/catalog/objects';
import { SAVE_STORAGE_KEY } from '../src/game/config';
import type { Cell, Rotation, SavedTown } from '../src/town/types';
import { byId, canvasPoint, diagnostics, expectDiagnostics, footprintPoint, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS } from './helpers';

const ARTIFACTS = 'artifacts/stadium-xl';
const BUILT: Cell = { x: 25, z: 26 }; // 14 × 11 cells: x 25–38, z 26–36
const MOVED: Cell = { x: 27, z: 25 }; // turned a quarter, 11 × 14: x 27–37, z 25–38

async function savedStadiums(page: Page): Promise<Array<{ id: number; anchor: Cell; rotation: number }>> {
  await expect.poll(async () => (await diagnostics(page)).save.pending, { timeout: 5_000 }).toBe(false);
  const town: SavedTown = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_STORAGE_KEY);
  return town.objects.filter((o) => o.kind === 'stadium').map((o) => ({ id: o.id, anchor: o.anchor, rotation: o.rotation }));
}

async function pointAt(page: Page, anchor: Cell, rotation: Rotation, touch: boolean): Promise<void> {
  const p = await footprintPoint(page, 'stadium', anchor, rotation);
  if (touch) {
    await page.touchscreen.tap(p.x, p.y);
    return;
  }
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

test('build the stadium, move and turn it, undo / redo, bulldoze it', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const touch = testInfo.project.name.startsWith('mobile');
  mkdirSync(ARTIFACTS, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-${name}.png` });
  await gotoTitle(page);
  await startBuilding(page);

  expect(OBJECTS.stadium.footprint).toEqual([14, 11]);
  await selectTool(page, 'stadium');
  await expect(byId(page, UI_TEST_IDS.tool('stadium'))).toContainText('Stadium');
  expect((await diagnostics(page)).variant, 'one style, no strip').toBeNull();

  if (!touch) {
    // The ghost covers the whole lot at every rotation.
    const over = await footprintPoint(page, 'stadium', BUILT, 0);
    await page.mouse.move(over.x, over.y, { steps: 3 });
    await expect.poll(async () => (await diagnostics(page)).hover?.valid).toBe(true);
    await page.waitForTimeout(150);
    await shot('ghost-r0');
    for (const rotation of [3, 2, 1, 0]) {
      await page.keyboard.press('r');
      await expect.poll(async () => (await diagnostics(page)).rotation).toBe(rotation);
      await expect.poll(async () => (await diagnostics(page)).hover?.valid, { message: `ghost at rotation ${rotation}` }).toBe(true);
      await page.waitForTimeout(150);
      if (rotation !== 0) await shot(`ghost-r${rotation}`);
    }
  }

  await pointAt(page, BUILT, 0, touch);
  await expectDiagnostics(page, { objects: 1, town: { amenities: 1 }, history: { undoDepth: 1 } }, 'stadium built');
  const [built] = await savedStadiums(page);
  expect(built).toMatchObject({ anchor: BUILT, rotation: 0 });
  await page.waitForTimeout(400); // pop-in settles
  await shot('built');

  // A second one over it is refused.
  const invalidBefore = (await diagnostics(page)).invalidCount;
  await pointAt(page, { x: BUILT.x + 4, z: BUILT.z + 2 }, 0, touch);
  await expect.poll(async () => (await diagnostics(page)).invalidCount).toBe(invalidBefore + 1);
  await expect(page.locator(`#${UI_TEST_IDS.tooltip}`)).toContainText('Something is already here');
  await expectDiagnostics(page, { objects: 1 }, 'still one stadium');

  // Move: pick it up, turn it clockwise (rotation 3), put it down overlapping its old lot.
  await selectTool(page, 'move');
  await pointAt(page, BUILT, 0, touch);
  await expect.poll(async () => (await diagnostics(page)).selection).toEqual({ id: built.id, kind: 'stadium', rotation: 0 });
  if (touch) await byId(page, UI_TEST_IDS.rotate).click();
  else await page.keyboard.press('KeyR');
  await expect.poll(async () => (await diagnostics(page)).selection?.rotation).toBe(3);
  await pointAt(page, MOVED, 3, touch);
  await expect.poll(async () => (await diagnostics(page)).selection).toBeNull();
  await expectDiagnostics(page, { objects: 1, history: { undoDepth: 2 } }, 'moved in one undo step');
  expect(await savedStadiums(page)).toEqual([{ id: built.id, anchor: MOVED, rotation: 3 }]);
  await page.waitForTimeout(500); // the slide-and-hop settles
  await shot('moved');

  await byId(page, UI_TEST_IDS.undo).click();
  await expect.poll(async () => savedStadiums(page)).toEqual([{ id: built.id, anchor: BUILT, rotation: 0 }]);
  await byId(page, UI_TEST_IDS.redo).click();
  await expect.poll(async () => savedStadiums(page)).toEqual([{ id: built.id, anchor: MOVED, rotation: 3 }]);

  // Bulldoze: one click anywhere on the lot removes the whole stadium.
  await selectTool(page, 'bulldoze');
  const corner = await canvasPoint(page, MOVED.x + 7, MOVED.z + 1);
  if (touch) await page.touchscreen.tap(corner.x, corner.y);
  else await page.mouse.click(corner.x, corner.y);
  await expectDiagnostics(page, { objects: 0, town: { amenities: 0 } }, 'stadium bulldozed');
  expect(await savedStadiums(page)).toEqual([]);
  errors.expectNone();
});
