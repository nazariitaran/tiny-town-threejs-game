/**
 * WP-19 town photo. Real input only: the top-bar camera button, the P key, the preview's Download
 * button and Esc; `applyState` is setup. State comes from __THREE_GAME_DIAGNOSTICS__.photo and the
 * downloaded file itself (a JPEG whose size must match diagnostics).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PHOTO_LONG_EDGE } from '../src/photo/photoLayout';
import { applyState, byId, canvasPoint, diagnostics, gotoTitle, selectTool, trackErrors, UI_TEST_IDS, waitFrames } from './helpers';

const OUT = 'artifacts/wp-19';
// Test states reset the name to "Tiny Town" (WP-20: the file name starts with the town's slug).
const FILE_NAME = /^tiny-town-\d{4}-\d{2}-\d{2}-\d{4}\.jpg$/;

const photo = async (page: Page) => (await diagnostics(page)).photo;
const print = (page: Page) => page.locator(`#${UI_TEST_IDS.photoPanel} .ui-print`);

/** Width × height from a JPEG's SOF0/SOF2 marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 2).toString('hex'), 'JPEG SOI marker').toBe('ffd8');
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  throw new Error('no SOF marker in the photo');
}

/**
 * Largest mean RGB difference over 24 × 24 px blocks between two images (decoded in the page),
 * inside `rect` only. JPEG noise stays around 1; a ghost or footprint frame lifts its blocks far higher.
 */
async function maxBlockDiff(page: Page, a: Buffer, b: Buffer, rect?: { x: number; y: number; width: number; height: number }): Promise<number> {
  return page.evaluate(
    async ([aUrl, bUrl, area]) => {
      const pixels = async (url: string) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const r = area ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
        const canvas = new OffscreenCanvas(r.width, r.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, -r.x, -r.y);
        return { data: ctx.getImageData(0, 0, r.width, r.height).data, width: r.width, height: r.height };
      };
      const [pa, pb] = await Promise.all([pixels(aUrl), pixels(bUrl)]);
      const B = 24;
      let worst = 0;
      for (let by = 0; by + B <= pa.height; by += B) {
        for (let bx = 0; bx + B <= pa.width; bx += B) {
          let sum = 0;
          for (let y = by; y < by + B; y += 1) {
            for (let x = bx; x < bx + B; x += 1) {
              const i = (y * pa.width + x) * 4;
              sum += Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
            }
          }
          worst = Math.max(worst, sum / (B * B * 3));
        }
      }
      return worst;
    },
    [`data:image/jpeg;base64,${a.toString('base64')}`, `data:image/jpeg;base64,${b.toString('base64')}`, rect ?? null] as const,
  );
}

async function waitForPrint(page: Page): Promise<void> {
  await expect(byId(page, UI_TEST_IDS.photoPanel)).toBeVisible();
  await expect(print(page)).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(byId(page, UI_TEST_IDS.photoImage)).toBeVisible();
  await expect.poll(() => byId(page, UI_TEST_IDS.photoImage).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Diagnostics are republished each frame, so they can trail the photo:ready fact by one frame.
  await expect.poll(async () => (await photo(page)).developing).toBe(false);
}

async function download(page: Page): Promise<Download> {
  const [file] = await Promise.all([page.waitForEvent('download'), byId(page, UI_TEST_IDS.photoDownload).click()]);
  return file;
}

test.describe('town photo', () => {
  test('camera button → framed JPEG download, back to the same tool', async ({ page }, info) => {
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'sample-town');
    await selectTool(page, 'oak');
    if (info.project.name === 'desktop-chrome') {
      // Hover a cell so the ghost and its footprint frame are up when the shutter fires.
      const point = await canvasPoint(page, 8, 44);
      await page.mouse.move(point.x, point.y);
      await expect.poll(async () => (await diagnostics(page)).hover).not.toBeNull();
    }
    const before = await diagnostics(page);
    expect(before.photo).toEqual({ taken: 0, developing: false, last: null });

    await byId(page, UI_TEST_IDS.photo).click();
    // The view pauses under the preview (menu phase) while the photo develops.
    await expect.poll(async () => (await diagnostics(page)).phase).toBe('menu');
    await waitForPrint(page);
    const shot = await photo(page);
    expect(shot.taken).toBe(1);
    expect(shot.developing).toBe(false);
    expect(shot.last).not.toBeNull();
    const last = shot.last!;
    // The capture's long edge reaches PHOTO_LONG_EDGE (before the frame is added).
    expect(Math.max(last.width, last.height)).toBeGreaterThan(PHOTO_LONG_EDGE);
    expect(last.pixelRatio).toBeGreaterThanOrEqual(before.canvas.dpr);
    // Captured at the canvas's own aspect: the frame adds equal side borders and a deeper bottom.
    expect(last.height > last.width).toBe(before.canvas.clientHeight > before.canvas.clientWidth);

    const file = await download(page);
    expect(file.suggestedFilename()).toMatch(FILE_NAME);
    mkdirSync(OUT, { recursive: true });
    const path = `${OUT}/e2e-${info.project.name}-${file.suggestedFilename()}`;
    await file.saveAs(path);
    const bytes = readFileSync(path);
    expect(jpegSize(bytes)).toEqual({ width: last.width, height: last.height });
    expect(bytes.length).toBe(last.bytes);
    await expect(page.locator('.ui-photo-status')).toContainText(file.suggestedFilename());
    await page.screenshot({ path: `${OUT}/e2e-preview-${info.project.name}.png` });

    // Esc (or Back to town) returns straight to building, tool still in hand, camera unmoved.
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await diagnostics(page)).phase).toBe('building');
    await expect(byId(page, UI_TEST_IDS.photoPanel)).toBeHidden();
    const after = await diagnostics(page);
    expect(after.tool).toBe('oak');
    expect(after.camera).toEqual(before.camera);
    expect(after.canvas).toEqual(before.canvas);
    errors.expectNone();
  });

  test('the photo leaves out the ghost and its footprint frame', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chrome', 'needs a hovering mouse');
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'sample-town');
    // Freeze cars, clouds, wind and the clock (delta 0) while input and tools keep working, so two
    // photos of the same view are the same picture.
    await page.evaluate(async () => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
    await page.waitForTimeout(300); // camera damping settles
    const canvas = page.locator('#game-canvas');
    const noGhost = await canvas.screenshot({ type: 'jpeg', quality: 95 });

    await selectTool(page, 'supermarket');
    const point = await canvasPoint(page, 30, 48);
    await page.mouse.move(point.x, point.y);
    await expect.poll(async () => (await diagnostics(page)).hover).not.toBeNull();
    await page.waitForTimeout(150);
    const withGhost = await canvas.screenshot({ type: 'jpeg', quality: 95 });
    // Control: the measure sees the ghost on screen.
    const control = await maxBlockDiff(page, noGhost, withGhost);
    expect(control, 'ghost visible on screen').toBeGreaterThan(20);

    await page.keyboard.press('KeyP');
    await waitForPrint(page);
    const a = readFileSync(await (await download(page)).path());
    const { width, height } = (await photo(page)).last!;
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await diagnostics(page)).phase).toBe('building');
    await page.keyboard.press('Escape'); // put the tool away: no ghost at all
    await expect.poll(async () => (await diagnostics(page)).tool).toBeNull();
    await page.mouse.move(5, 300);
    await page.keyboard.press('KeyP');
    await waitForPrint(page);
    const b = readFileSync(await (await download(page)).path());
    expect((await photo(page)).last).toMatchObject({ width, height });

    // Same picture above the caption strip (the caption's clock may tick over between the two);
    // the strip is at most 20 % of the card (landscape), so the top 80 % holds only photo and border.
    const diff = await maxBlockDiff(page, a, b, { x: 0, y: 0, width, height: Math.floor(height * 0.8) });
    console.log(`ghost control ${control.toFixed(1)}, photo with vs without ghost ${diff.toFixed(2)}`);
    expect(diff, 'ghost left out of the photo').toBeLessThan(4);
    errors.expectNone();
  });

  test('P takes a photo; Ctrl/Cmd+P and P outside the build view do not', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chrome', 'keyboard shortcut');
    const errors = trackErrors(page);
    await gotoTitle(page);
    await page.keyboard.press('KeyP');
    await waitFrames(page);
    expect((await photo(page)).taken, 'no photo from the title screen').toBe(0);

    await applyState(page, 'sample-town');
    await page.keyboard.press('Control+KeyP').catch(() => undefined);
    await page.keyboard.press('Meta+KeyP').catch(() => undefined);
    await waitFrames(page);
    expect((await photo(page)).taken, 'modified P is not the photo key').toBe(0);

    await page.keyboard.press('KeyP');
    await waitForPrint(page);
    expect((await photo(page)).taken).toBe(1);
    // P again while the preview is open does nothing (the build view is paused).
    await page.keyboard.press('KeyP');
    await waitFrames(page);
    expect((await photo(page)).taken).toBe(1);

    await byId(page, UI_TEST_IDS.photoClose).click();
    await expect.poll(async () => (await diagnostics(page)).phase).toBe('building');
    // A second photo gets a fresh print (developing → ready).
    await page.keyboard.press('KeyP');
    await waitForPrint(page);
    expect((await photo(page)).taken).toBe(2);
    errors.expectNone();
  });

  test('night photo keeps the night look (moon in the caption)', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chrome', 'one night capture is enough');
    const errors = trackErrors(page);
    await gotoTitle(page);
    await applyState(page, 'night-town');
    await byId(page, UI_TEST_IDS.photo).click();
    await waitForPrint(page);
    expect((await diagnostics(page)).daytime.phase).toBe('night');
    const file = await download(page);
    mkdirSync(OUT, { recursive: true });
    await file.saveAs(`${OUT}/e2e-night-${file.suggestedFilename()}`);
    errors.expectNone();
  });

  test('help lists the photo shortcut', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chrome', 'keyboard shortcut');
    await gotoTitle(page);
    await applyState(page, 'sample-town');
    await page.keyboard.press('Shift+Slash');
    await expect(byId(page, UI_TEST_IDS.helpPanel)).toContainText('Take a photo');
  });
});
