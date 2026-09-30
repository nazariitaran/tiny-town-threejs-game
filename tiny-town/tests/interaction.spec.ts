/**
 * WP-05 interaction acceptance checks. Everything is driven through REAL input (Playwright mouse /
 * keyboard / touchscreen, CDP Input.dispatchTouchEvent for multi-touch) at cells located with the
 * cellToClient test hook; diagnostics are only read, never written.
 */
import { expect, test, type Page } from '@playwright/test';
import { clickStart, footprintPoint, footprintPointer } from './helpers';

/** `hover` also carries the validity the UI shows (ToolController.hovered); typed narrower in vite-env.d.ts. */
type Diagnostics = Omit<NonNullable<Window['__THREE_GAME_DIAGNOSTICS__']>, 'hover'> & {
  hover: { x: number; z: number; valid?: boolean; reason?: string | null } | null;
};

/** Diagnostics are published once per frame, so wait for a fresh frame before reading them. */
const diag = (page: Page): Promise<Diagnostics> =>
  page.evaluate(
    () =>
      new Promise<Diagnostics>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__THREE_GAME_DIAGNOSTICS__!))),
      ),
  );

/** Fails loudly if a UI panel (dock, top bar) covers the point, instead of silently eating the input. */
async function assertOnCanvas(page: Page, point: { x: number; y: number }, label: string) {
  const id = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id ?? null, [point.x, point.y] as const);
  expect(id, `${label} at (${point.x.toFixed(0)}, ${point.y.toFixed(0)}) must hit the canvas`).toBe('game-canvas');
  return point;
}

/** Id of the element at a cell centre (no assertion), for picking on-canvas cells. */
const canvasId = (page: Page, x: number, z: number) =>
  page.evaluate(([cx, cz]) => {
    const p = window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz);
    return document.elementFromPoint(p.x, p.y)?.id ?? null;
  }, [x, z] as const);

const cellPoint = async (page: Page, x: number, z: number) =>
  assertOnCanvas(
    page,
    await page.evaluate(([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz), [x, z] as const),
    `cell (${x}, ${z})`,
  );

/** Screen point on the north edge of cell (x, z): halfway between the two cell centres it separates. */
async function northEdgePoint(page: Page, x: number, z: number) {
  const a = await cellPoint(page, x, z - 1);
  const b = await cellPoint(page, x, z);
  return assertOnCanvas(page, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, `north edge of (${x}, ${z})`);
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
  await clickStart(page);
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

  test('road drag, invalid house, rotate, fences, bulldoze, undo', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await startBuilding(page);

    // 1. Road drag (4,24) → (24,24): 11 road blocks (WP-12: 2×2 cells each), one undo entry.
    await selectTool(page, 'streets', 'road');
    const before = await diag(page);
    await drag(page, await cellPoint(page, 4, 24), await cellPoint(page, 24, 24));
    await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(11);
    const afterRoad = await diag(page);
    expect(afterRoad.history.undoDepth).toBe(before.history.undoDepth + 1);
    console.log(`[road] roadTiles=${afterRoad.town.roadTiles} undoDepth ${before.history.undoDepth}→${afterRoad.history.undoDepth}`);

    // 2. Cottage on a valid plot, then over the road: rejected, invalidCount +1. WP-17: the cottage is
    //    4 × 4 and centres on a cell corner, so the pointer aims at the footprint centre
    //    (footprintPointer): anchor (11, 14) covers x 11–14, rows 14–17; the pointer is in cell (12, 15).
    await selectTool(page, 'homes', 'cottage');
    const plot = footprintPointer('cottage', { x: 11, z: 14 });
    const valid = await assertOnCanvas(page, await footprintPoint(page, 'cottage', { x: 11, z: 14 }), 'cottage plot');
    await page.mouse.move(valid.x, valid.y);
    await page.mouse.click(valid.x, valid.y);
    await expect.poll(async () => (await diag(page)).objects).toBe(1);
    // M1 fix: the cell we just built on is NOT reported invalid ("Something is already here").
    await diag(page);
    await diag(page);
    const afterPlace = await diag(page);
    expect(afterPlace.hover).toEqual({ ...plot.cell, valid: true, reason: null });
    await expect(page.locator('#ui-tooltip')).toBeHidden();
    console.log(`[place] hover after successful click = ${JSON.stringify(afterPlace.hover)}; tooltip hidden`);
    // Moving away and back does re-evaluate it: now it really is occupied.
    const neighbour = await cellPoint(page, 16, 15); // outside the 4 × 4 footprint
    await page.mouse.move(neighbour.x, neighbour.y, { steps: 3 });
    await page.mouse.move(valid.x, valid.y, { steps: 3 });
    await expect.poll(async () => (await diag(page)).hover).toMatchObject({ ...plot.cell, valid: false, reason: 'Something is already here' });
    const beforeInvalid = await diag(page);
    // Anchor (11, 23): rows 23–26 would cover the road on rows 24–25; the pointer is in cell (12, 24).
    const onRoad = await assertOnCanvas(page, await footprintPoint(page, 'cottage', { x: 11, z: 23 }), 'cottage over the road');
    await page.mouse.move(onRoad.x, onRoad.y);
    await expect.poll(async () => (await diag(page)).hover).toMatchObject({ x: 12, z: 24, valid: false, reason: "Cottage can't go on a road" });
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

    // Scatter stroke (trees): the cells it just filled don't read as invalid under the pointer.
    await selectTool(page, 'nature', 'oak');
    const objectsBeforeTrees = (await diag(page)).objects;
    await drag(page, await cellPoint(page, 6, 4), await cellPoint(page, 16, 4), 24);
    await expect.poll(async () => (await diag(page)).objects).toBeGreaterThan(objectsBeforeTrees + 2);
    await diag(page);
    const afterTrees = await diag(page);
    expect(afterTrees.hover).toMatchObject({ x: 16, z: 4, valid: true, reason: null });
    await expect(page.locator('#ui-tooltip')).toBeHidden();
    console.log(`[scatter] trees placed=${afterTrees.objects - objectsBeforeTrees}; hover at stroke end=${JSON.stringify(afterTrees.hover)}`);

    // 4. Fence drag along 4 edges (north edges of cells x = 10..13, z = 10).
    await selectTool(page, 'garden', 'fence-tall');
    const fenceFrom = await northEdgePoint(page, 10, 10);
    const fenceTo = await northEdgePoint(page, 13, 10);
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
    expect(afterBulldoze.objects).toBe(afterFence.objects);
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
    await selectTool(page, 'streets', 'road');
    const depth0 = (await diag(page)).history.undoDepth;

    // a) Drag, leave the window, release out there.
    const from = await cellPoint(page, 6, 32);
    const to = await cellPoint(page, 16, 32);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.move(-40, -40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await diag(page)).history.undoDepth).toBe(depth0 + 1);
    const roadsA = (await diag(page)).town.roadTiles;

    // The next click is a NEW undo entry, and moving the mouse afterwards paints nothing.
    const click = await cellPoint(page, 6, 36);
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
    const b0 = await cellPoint(page, 28, 6);
    const b1 = await cellPoint(page, 36, 6);
    await drag(page, b0, b1, 8);
    await page.evaluate(() => {
      window.removeEventListener('pointerup', (window as unknown as { __swallow: EventListener }).__swallow, { capture: true });
    });
    const roadsB = (await diag(page)).town.roadTiles;
    const b2 = await cellPoint(page, 36, 12);
    await page.mouse.move(b2.x, b2.y, { steps: 6 });
    expect((await diag(page)).town.roadTiles).toBe(roadsB);
    await page.mouse.click(b2.x, b2.y);
    await expect.poll(async () => (await diag(page)).history.undoDepth).toBe(depth1 + 2);
    console.log(`[swallowed-up] undoDepth ${depth1}→${depth1 + 2}, no paint while hovering after release`);

    // c) Window blur mid-stroke ends it too.
    const depth2 = (await diag(page)).history.undoDepth;
    const c0 = await cellPoint(page, 28, 16);
    const c1 = await cellPoint(page, 36, 16);
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
    await selectTool(page, 'streets', 'road');
    await drag(page, await cellPoint(page, 18, 24), await cellPoint(page, 28, 24));
    let p = await cellPoint(page, 22, 20);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('ghost-road-tile');
    await selectTool(page, 'streets', 'pavement');
    await page.mouse.move(p.x + 2, p.y, { steps: 2 });
    await shot('ghost-pavement-tile');
    await selectTool(page, 'nature', 'meadow');
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await shot('ghost-meadow-tile');

    // WP-17 townhouse 3 × 4: anchor (23, 19) = x 23–25, rows 19–22 on the verge north of the road
    // (pointer in cell (24, 20)); anchor (23, 23) would cover the road (pointer in cell (24, 24)).
    await selectTool(page, 'homes', 'townhouse');
    p = await assertOnCanvas(page, await footprintPoint(page, 'townhouse', { x: 23, z: 19 }), 'townhouse plot');
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await expect.poll(async () => (await diag(page)).hover).toMatchObject({ x: 24, z: 20, valid: true });
    await shot('ghost-house-valid');
    p = await assertOnCanvas(page, await footprintPoint(page, 'townhouse', { x: 23, z: 23 }), 'townhouse over the road');
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await expect.poll(async () => (await diag(page)).hover).toMatchObject({ x: 24, z: 24, valid: false });
    await shot('ghost-house-invalid');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(40);
    await page.screenshot({ path: testInfo.outputPath('ghost-house-shake.png') });

    await selectTool(page, 'garden', 'fence-low');
    await drag(page, await northEdgePoint(page, 20, 18), await northEdgePoint(page, 23, 18));
    p = await northEdgePoint(page, 22, 16);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('ghost-fence');

    await page.keyboard.press('b');
    p = await northEdgePoint(page, 21, 18);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await shot('bulldoze-fence');
    p = await cellPoint(page, 24, 24);
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
    expect(pose3.targetX).toBeCloseTo(pose0.targetX, 2);
    expect(pose3.targetZ).toBeCloseTo(pose0.targetZ, 2);
    expect(pose3.distance).toBeCloseTo(pose0.distance, 1);
    console.log(`[camera] pan Δ=${Math.hypot(pose1.targetX - pose0.targetX, pose1.targetZ - pose0.targetZ).toFixed(2)} orbit Δ=${(pose2.azimuth - pose1.azimuth).toFixed(3)} reset target=(${pose3.targetX.toFixed(3)}, ${pose3.targetZ.toFixed(3)})`);
    expect(errors).toEqual([]);
  });
});

test.describe('mobile touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch checks run on mobile-chrome');

  test('a tap places; a two-finger pan moves the camera without building', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await startBuilding(page);
    await selectTool(page, 'streets', 'road');

    const before = await diag(page);
    const target = await cellPoint(page, 24, 22);
    await page.touchscreen.tap(target.x, target.y);
    await expect.poll(async () => (await diag(page)).town.roadTiles).toBe(before.town.roadTiles + 1);
    const afterTap = await diag(page);
    expect(afterTap.history.undoDepth).toBe(before.history.undoDepth + 1);
    console.log(`[tap] roadTiles ${before.town.roadTiles}→${afterTap.town.roadTiles}`);

    // Two-finger pan through CDP (Playwright's touchscreen API is single-touch only).
    const cdp = await page.context().newCDPSession(page);
    const centre = await cellPoint(page, 24, 28);
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
    // The pan moved the view, so find a 5-block run (9 cells) that is still on the canvas (not under the dock / top bar).
    let run: [number, number] | null = null;
    for (const [x, z] of [[18, 18], [16, 24], [20, 28], [12, 20], [24, 32], [8, 28]] as const) {
      if ((await canvasId(page, x, z)) === 'game-canvas' && (await canvasId(page, x + 8, z)) === 'game-canvas') {
        run = [x, z];
        break;
      }
    }
    expect(run, 'a 5-block run on the canvas after the pan').not.toBeNull();
    const d0 = await cellPoint(page, run![0], run![1]);
    const d1 = await cellPoint(page, run![0] + 8, run![1]);
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

// Evidence for the M3 "valid ghost reads on the green field" fix, at the DEFAULT zoom on both
// projects. On mobile the ghost is shown via a mouse hover (touch has no hover; on a phone the
// same ghost shows while the finger is down).
test('valid ghost at default zoom: house, road tile, fence (screenshots)', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await startBuilding(page);
  const project = testInfo.project.name;
  const hoverAndShoot = async (point: { x: number; y: number }, name: string) => {
    await page.mouse.move(point.x, point.y, { steps: 3 });
    await diag(page);
    await page.waitForTimeout(200); // ghost lerp settles
    const clip = { x: Math.max(0, point.x - 160), y: Math.max(0, point.y - 120), width: 320, height: 200 };
    await page.screenshot({ path: testInfo.outputPath(`${project}-${name}.png`) });
    await page.screenshot({ path: testInfo.outputPath(`${project}-${name}-crop.png`), clip });
  };

  // WP-17 townhouse 3 × 4 anchored at (23, 19): the pointer sits in cell (24, 20) (footprintPointer).
  await selectTool(page, 'homes', 'townhouse');
  const house = await assertOnCanvas(page, await footprintPoint(page, 'townhouse', { x: 23, z: 19 }), 'townhouse plot');
  await hoverAndShoot(house, 'ghost-valid-house');
  await expect.poll(async () => (await diag(page)).hover).toMatchObject({ x: 24, z: 20, valid: true });

  await selectTool(page, 'streets', 'road');
  const road = await cellPoint(page, 20, 24);
  await hoverAndShoot(road, 'ghost-valid-road');
  await expect.poll(async () => (await diag(page)).hover).toMatchObject({ x: 20, z: 24, valid: true });

  await selectTool(page, 'garden', 'fence-tall');
  const fence = await northEdgePoint(page, 26, 24);
  await hoverAndShoot(fence, 'ghost-valid-fence');
  expect((await diag(page)).hover?.valid).toBe(true);

  // Nothing was built by hovering.
  const final = await diag(page);
  expect(final.objects).toBe(0);
  expect(final.town.roadTiles).toBe(0);
  expect(final.town.fences).toBe(0);
  expect(errors).toEqual([]);
});
