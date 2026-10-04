import { expect, test } from '@playwright/test';
import { cellToWorld } from '../src/game/config';
import { applyState, canvasPoint, diagnostics, expectDiagnostics, gotoTitle, selectTool, startBuilding, trackErrors, waitFrames } from './helpers';

/** The gallery's roundabout stands on cells 8–13 × 30–35; its corner blocks are 2 × 2 cells. */
const NW = { x: 8, z: 30 };
const SE = { x: 12, z: 34 };

test('the roundabout corners take pavement, and grass or road puts the wedge back', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await applyState(page, 'asset-gallery');
  const centre = cellToWorld({ x: 11, z: 33 });
  await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose({ targetX: x, targetZ: z, azimuth: 0.3, polar: 0.5, distance: 8 }), [centre.x, centre.z] as const);
  await waitFrames(page, 6);
  const depth = (await diagnostics(page)).history.undoDepth;
  const click = async (cell: { x: number; z: number }) => {
    const point = await canvasPoint(page, cell.x, cell.z);
    await page.mouse.click(point.x, point.y);
  };

  await selectTool(page, 'pavement');
  await click(NW);
  await expectDiagnostics(page, { history: { undoDepth: depth + 1 } }, 'a corner paved');
  await click({ x: NW.x + 1, z: NW.z + 1 }); // the same block again: nothing to do
  await click(SE);
  await expectDiagnostics(page, { history: { undoDepth: depth + 2 } }, 'a second corner paved');
  const objects = (await diagnostics(page)).objects;

  await click({ x: 10, z: 32 }); // the island: refused, nothing changes
  await expectDiagnostics(page, { history: { undoDepth: depth + 2 } }, 'the centre refuses pavement');

  await selectTool(page, 'grass');
  await click(NW);
  await expectDiagnostics(page, { history: { undoDepth: depth + 3 } }, 'grass paints the wedge back');
  expect((await diagnostics(page)).objects).toBe(objects);

  await page.keyboard.press('Control+z');
  await expectDiagnostics(page, { history: { undoDepth: depth + 2 } }, 'undo');
  await waitFrames(page, 10);
  errors.expectNone();
});
