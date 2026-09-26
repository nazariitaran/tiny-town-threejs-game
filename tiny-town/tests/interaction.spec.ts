/**
 * WP-05 interaction acceptance checks. Everything is driven through REAL input (Playwright mouse /
 * keyboard / touchscreen, CDP Input.dispatchTouchEvent for multi-touch) at cells located with the
 * cellToClient test hook; diagnostics are only read, never written.
 */
import { expect, test, type Page } from '@playwright/test';

type Diagnostics = NonNullable<Window['__THREE_GAME_DIAGNOSTICS__']>;

/** Diagnostics are published once per frame, so wait for a fresh frame before reading them. */
const diag = (page: Page): Promise<Diagnostics> =>
  page.evaluate(
    () =>
      new Promise<Diagnostics>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__THREE_GAME_DIAGNOSTICS__!))),
      ),
  );

const cellPoint = (page: Page, x: number, z: number) =>
  page.evaluate(([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz), [x, z] as const);

/** Screen point on the north edge of cell (x, z): halfway between the two cell centres it separates. */
async function northEdgePoint(page: Page, x: number, z: number) {
  const a = await cellPoint(page, x, z - 1);
  const b = await cellPoint(page, x, z);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function startBuilding(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 20_000 });
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building');
}

async function selectTool(page: Page, category: string, tool: string): Promise<void> {
  await page.locator(`#cat-${category}`).click();
  await page.locator(`#tool-${tool}`).click();
  await expect.poll(async () => (await diag(page)).tool).toBe(tool);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 20): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

test.describe('desktop mouse + keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse checks run on desktop-chrome');

  test('road drag, invalid townhouse, rotate, fences, bulldoze, undo', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await startBuilding(page);

    // 1. Road drag (2,12) → (12,12): 11 tiles, one undo entry.
    await selectTool(page, 'paths', 'road');
    const before = await diag(page);
    await drag(page, await cellPoint(page, 2, 12), await cellPoint(page, 12, 12));
    await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(11);
    const afterRoad = await diag(page);
    expect(afterRoad.history.undoDepth).toBe(before.history.undoDepth + 1);
    console.log(`[road] roadTiles=${afterRoad.town.roadTiles} undoDepth ${before.history.undoDepth}→${afterRoad.history.undoDepth}`);

    // 2. Townhouse on a valid cell, then on a road cell: rejected, invalidCount +1.
    await selectTool(page, 'buildings', 'townhouse-a');
    const valid = await cellPoint(page, 6, 8);
    await page.mouse.move(valid.x, valid.y);
    await page.mouse.click(valid.x, valid.y);
    await expect.poll(async () => (await diag(page)).objects).toBe(1);
    const beforeInvalid = await diag(page);
    const onRoad = await cellPoint(page, 6, 12);
    await page.mouse.move(onRoad.x, onRoad.y);
    await expect.poll(async () => (await diag(page)).hover).toEqual({ x: 6, z: 12 });
    await page.mouse.click(onRoad.x, onRoad.y);
    await expect.poll(async () => (await diag(page)).invalidCount).toBe(beforeInvalid.invalidCount + 1);
    const afterInvalid = await diag(page);
    expect(afterInvalid.objects).toBe(1);
    expect(afterInvalid.history.undoDepth).toBe(beforeInvalid.history.undoDepth);
    console.log(`[invalid] objects=${afterInvalid.objects} invalidCount ${beforeInvalid.invalidCount}→${afterInvalid.invalidCount}`);

    // 3. R rotates the ghost (clockwise = one CCW quarter turn back), Shift+R turns it back.
    await page.mouse.move(valid.x + 40, valid.y);
    expect((await diag(page)).rotation).toBe(0);
    await page.keyboard.press('r');
    await expect.poll(async () => (await diag(page)).rotation).toBe(3);
    await page.screenshot({ path: testInfo.outputPath('ghost-rotated.png') });
    await page.keyboard.press('Shift+R');
    await expect.poll(async () => (await diag(page)).rotation).toBe(0);
    await page.keyboard.press('r');
    console.log(`[rotate] rotation after R=${(await diag(page)).rotation}`);

    // 4. Fence drag along 4 edges (north edges of cells x = 5..8, z = 5).
    await selectTool(page, 'buildings', 'fence-tall');
    const fenceFrom = await northEdgePoint(page, 5, 5);
    const fenceTo = await northEdgePoint(page, 8, 5);
    const beforeFence = await diag(page);
    await drag(page, fenceFrom, fenceTo);
    await expect.poll(async () => (await diag(page)).town.fences).toBe(4);
    const afterFence = await diag(page);
    expect(afterFence.render.edges).toBe(4);
    expect(afterFence.history.undoDepth).toBe(beforeFence.history.undoDepth + 1);
    await page.screenshot({ path: testInfo.outputPath('fences.png') });
    console.log(`[fence] fences=${afterFence.town.fences} render.edges=${afterFence.render.edges}`);

    // 5. Bulldoze (B) along the same edges removes them — and only them.
    await page.keyboard.press('b');
    await expect.poll(async () => (await diag(page)).tool).toBe('bulldoze');
    await page.mouse.move(fenceFrom.x, fenceFrom.y);
    await page.screenshot({ path: testInfo.outputPath('bulldoze-hover.png') });
    await drag(page, fenceFrom, fenceTo);
    await expect.poll(async () => (await diag(page)).town.fences).toBe(0);
    const afterBulldoze = await diag(page);
    expect(afterBulldoze.town.roadTiles).toBe(11);
    expect(afterBulldoze.objects).toBe(1);
    console.log(`[bulldoze] fences=${afterBulldoze.town.fences} roads=${afterBulldoze.town.roadTiles} objects=${afterBulldoze.objects}`);

    // 6. Ctrl+Z restores the fences in one step.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await diag(page)).town.fences).toBe(4);
    expect((await diag(page)).render.edges).toBe(4);
    console.log(`[undo] fences=${(await diag(page)).town.fences}`);

    // Esc with a tool deselects; with none it opens the menu.
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await diag(page)).tool).toBeNull();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await diag(page)).phase).toBe('menu');

    expect(errors).toEqual([]);
  });

  test('a release outside the window leaves no stuck stroke', async ({ page }) => {
    const errors = collectErrors(page);
    await startBuilding(page);
    await selectTool(page, 'paths', 'road');
    const depth0 = (await diag(page)).history.undoDepth;

    // a) Drag, leave the window, release out there.
    const from = await cellPoint(page, 3, 16);
    const to = await cellPoint(page, 8, 16);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.move(-40, -40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await diag(page)).history.undoDepth).toBe(depth0 + 1);
    const roadsA = (await diag(page)).town.roadTiles;

    // The next click is a NEW undo entry, and moving the mouse afterwards paints nothing.
    const click = await cellPoint(page, 3, 18);
    await page.mouse.move(click.x, click.y, { steps: 3 });
    const roadsBeforeClick = (await diag(page)).town.roadTiles;
    expect(roadsBeforeClick).toBe(roadsA);
    await page.mouse.click(click.x, click.y);
    await expect.poll(async () => (await diag(page)).history.undoDepth).toBe(depth0 + 2);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(roadsA);
    console.log(`[outside] strokeA roads=${roadsA} undoDepth after click=${depth0 + 2}, undo restored roads=${roadsA}`);

    // b) The pointerup never reaches the page at all (swallowed): the next move with no button
    //    held ends the stroke, and the following click is its own entry.
    const depth1 = (await diag(page)).history.undoDepth;
    await page.evaluate(() => {
      const swallow = (event: Event) => event.stopImmediatePropagation();
      (window as unknown as { __swallow: typeof swallow }).__swallow = swallow;
      window.addEventListener('pointerup', swallow, { capture: true });
    });
    const b0 = await cellPoint(page, 14, 3);
    const b1 = await cellPoint(page, 18, 3);
    await drag(page, b0, b1, 8);
    await page.evaluate(() => {
      window.removeEventListener('pointerup', (window as unknown as { __swallow: EventListener }).__swallow, { capture: true });
    });
    const roadsB = (await diag(page)).town.roadTiles;
    const b2 = await cellPoint(page, 18, 6);
    await page.mouse.move(b2.x, b2.y, { steps: 6 });
    expect((await diag(page)).town.roadTiles).toBe(roadsB);
    await page.mouse.click(b2.x, b2.y);
    await expect.poll(async () => (await diag(page)).history.undoDepth).toBe(depth1 + 2);
    console.log(`[swallowed-up] undoDepth ${depth1}→${depth1 + 2}, no paint while hovering after release`);

    // c) Window blur mid-stroke ends it too.
    const depth2 = (await diag(page)).history.undoDepth;
    const c0 = await cellPoint(page, 14, 20);
    const c1 = await cellPoint(page, 18, 20);
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    await page.mouse.move(c1.x, c1.y, { steps: 6 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await diag(page)).history.undoDepth).toBe(depth2 + 1);
    await page.mouse.up();
    expect((await diag(page)).history.undoDepth).toBe(depth2 + 1);

    expect(errors).toEqual([]);
  });

  test('ghost preview states (screenshots)', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await startBuilding(page);
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Equal');
      await page.waitForTimeout(260);
    }
    const shot = async (name: string) => {
      await diag(page);
      await page.waitForTimeout(150); // ghost lerp settles
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    };
    await selectTool(page, 'paths', 'road');
    await drag(page, await cellPoint(page, 9, 12), await cellPoint(page, 14, 12));
    let p = await cellPoint(page, 11, 10);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('ghost-road-tile');

    await selectTool(page, 'buildings', 'townhouse-b');
    p = await cellPoint(page, 12, 10);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await expect.poll(async () => (await diag(page)).hover).toEqual({ x: 12, z: 10 });
    await shot('ghost-house-valid');
    p = await cellPoint(page, 12, 12);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('ghost-house-invalid');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(40);
    await page.screenshot({ path: testInfo.outputPath('ghost-house-shake.png') });

    await selectTool(page, 'buildings', 'fence-small');
    await drag(page, await northEdgePoint(page, 10, 9), await northEdgePoint(page, 13, 9));
    p = await northEdgePoint(page, 11, 8);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('ghost-fence');

    await page.keyboard.press('b');
    p = await northEdgePoint(page, 11, 9);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('bulldoze-fence');
    p = await cellPoint(page, 12, 12);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('bulldoze-road');

    // Off-plot: the ghost hides and hover is null.
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await diag(page)).hover).toBeNull();
    expect(errors).toEqual([]);
  });

  test('camera keys: WASD pan, Q/E orbit, F reset', async ({ page }) => {
    const errors = collectErrors(page);
    await startBuilding(page);
    const pose0 = (await diag(page)).camera;
    await page.keyboard.down('d');
    await page.waitForTimeout(400);
    await page.keyboard.up('d');
    await page.waitForTimeout(300);
    const pose1 = (await diag(page)).camera;
    expect(Math.hypot(pose1.targetX - pose0.targetX, pose1.targetZ - pose0.targetZ)).toBeGreaterThan(2);
    await page.keyboard.press('e');
    await page.waitForTimeout(500);
    const pose2 = (await diag(page)).camera;
    expect(Math.abs(pose2.azimuth - pose1.azimuth - Math.PI / 4)).toBeLessThan(0.02);
    await page.keyboard.press('f');
    await page.waitForTimeout(900);
    const pose3 = (await diag(page)).camera;
    expect(pose3.targetX).toBeCloseTo(0, 2);
    expect(pose3.targetZ).toBeCloseTo(0, 2);
    expect(pose3.distance).toBeCloseTo(30, 1);
    console.log(`[camera] pan Δ=${Math.hypot(pose1.targetX - pose0.targetX, pose1.targetZ - pose0.targetZ).toFixed(2)} orbit Δ=${(pose2.azimuth - pose1.azimuth).toFixed(3)} reset target=(${pose3.targetX.toFixed(3)}, ${pose3.targetZ.toFixed(3)})`);
    expect(errors).toEqual([]);
  });
});

test.describe('mobile touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch checks run on mobile-chrome');

  test('a tap places; a two-finger pan moves the camera without building', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await startBuilding(page);
    await selectTool(page, 'paths', 'road');

    const before = await diag(page);
    const target = await cellPoint(page, 12, 11);
    await page.touchscreen.tap(target.x, target.y);
    await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(before.town.roadTiles + 1);
    const afterTap = await diag(page);
    expect(afterTap.history.undoDepth).toBe(before.history.undoDepth + 1);
    console.log(`[tap] roadTiles ${before.town.roadTiles}→${afterTap.town.roadTiles}`);

    // Two-finger pan through CDP (Playwright's touchscreen API is single-touch only).
    const cdp = await page.context().newCDPSession(page);
    const centre = await cellPoint(page, 12, 14);
    const points = (dx: number) => [
      { x: centre.x - 60 + dx, y: centre.y, id: 1 },
      { x: centre.x + 60 + dx, y: centre.y, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step * 10) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);

    const afterPan = await diag(page);
    const moved = Math.hypot(afterPan.camera.targetX - afterTap.camera.targetX, afterPan.camera.targetZ - afterTap.camera.targetZ);
    expect(moved).toBeGreaterThan(0.5);
    expect(afterPan.town.roadTiles).toBe(afterTap.town.roadTiles);
    expect(afterPan.history.undoDepth).toBe(afterTap.history.undoDepth);
    expect(afterPan.objects).toBe(afterTap.objects);
    expect(afterPan.invalidCount).toBe(afterTap.invalidCount);
    console.log(
      `[two-finger pan] target (${afterTap.camera.targetX.toFixed(2)}, ${afterTap.camera.targetZ.toFixed(2)}) → (${afterPan.camera.targetX.toFixed(2)}, ${afterPan.camera.targetZ.toFixed(2)}) moved=${moved.toFixed(2)}; roads=${afterPan.town.roadTiles} undoDepth=${afterPan.history.undoDepth}`,
    );
    await page.screenshot({ path: testInfo.outputPath('mobile-after-pan.png') });

    // A one-finger drag with the tool paints (and is one undo entry).
    const d0 = await cellPoint(page, 9, 9);
    const d1 = await cellPoint(page, 13, 9);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: d0.x, y: d0.y, id: 3 }] });
    for (let step = 1; step <= 10; step += 1) {
      const t = step / 10;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: d0.x + (d1.x - d0.x) * t, y: d0.y + (d1.y - d0.y) * t, id: 3 }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(afterPan.town.roadTiles + 5);
    expect((await diag(page)).history.undoDepth).toBe(afterPan.history.undoDepth + 1);

    expect(errors).toEqual([]);
  });
});
