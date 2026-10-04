import { expect, test } from '@playwright/test';
import { cellToWorld } from '../src/game/config';
import { applyState, byId, canvasPoint, diagnostics, expectDiagnostics, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS, waitFrames } from './helpers';

test('the postbox has no style strip: its cypher is rolled for each placement', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  await applyState(page, 'asset-gallery');
  const centre = cellToWorld({ x: 53, z: 36 });
  await page.evaluate(([x, z]) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose({ targetX: x, targetZ: z, azimuth: 0.3, polar: 0.6, distance: 10 }), [centre.x, centre.z] as const);
  await waitFrames(page, 6);
  const before = (await diagnostics(page)).objects;

  await selectTool(page, 'postbox');
  expect((await diagnostics(page)).variant, 'no style choice for the postbox').toBeNull();
  await expect(byId(page, UI_TEST_IDS.variants)).toBeHidden();
  await page.keyboard.press('v'); // V has no styles to step through
  expect((await diagnostics(page)).variant).toBeNull();

  const cells = [[50, 38], [52, 38], [54, 38]] as const;
  for (const [x, z] of cells) {
    const point = await canvasPoint(page, x, z);
    await page.mouse.click(point.x, point.y);
  }
  await expectDiagnostics(page, { objects: before + cells.length }, 'three postboxes built');
  errors.expectNone();
});
