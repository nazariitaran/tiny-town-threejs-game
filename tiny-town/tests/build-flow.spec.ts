/**
 * WP-09a build flow: a real-input journey through the core loop, asserting diagnostics at
 * every step: select road → drag a road → place a house → undo → redo → bulldoze.
 * Only real input (dock clicks by UI_TEST_IDS, mouse at cellToClient); no setState.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { objectDef } from '../src/catalog/objects';
import { rotatedFootprint } from '../src/town/grid';
import type { Cell, ObjectKind, Rotation } from '../src/town/types';
import {
  attachJson,
  byId,
  canvasPoint,
  clickCell,
  clickFootprint,
  diagnostics,
  dragCells,
  expectDiagnostics,
  footprintPoint,
  footprintPointer,
  gotoTitle,
  selectTool,
  startBuilding,
  trackErrors,
  UI_TEST_IDS,
  type Diagnostics,
} from './helpers';

// WP-12 (48×48 half-unit cells, roads in 2×2 blocks): a road along rows 24–25 from x=16..31
// (8 road blocks). WP-17: the cottage is 4 × 4, anchored at (22, 20) on the verge just north of the
// road (x 22–25, rows 20–23, touching row 24). An even footprint centres on a cell corner, so the
// click aims at the footprint centre (helpers.footprintPointer), not at a cell centre.
const ROAD_FROM: [number, number] = [16, 24];
const ROAD_TO: [number, number] = [31, 24];
const ROAD_TILES = 8;
const HOUSE = { x: 22, z: 20 } as const;
const COTTAGE_RESIDENTS = 2; // objects.ts: cottage residents

test('road → house → undo → redo → bulldoze, through real input', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const trail: Array<{ step: string } & Pick<Diagnostics, 'town' | 'objects' | 'render' | 'history' | 'invalidCount'>> = [];
  const record = async (step: string) => {
    const d = await diagnostics(page);
    trail.push({ step, town: d.town, objects: d.objects, render: d.render, history: d.history, invalidCount: d.invalidCount });
  };

  await gotoTitle(page);
  await startBuilding(page);
  await expectDiagnostics(page, { objects: 0, town: { roadTiles: 0, homes: 0 }, history: { undoDepth: 0 } }, 'empty start');
  const invalidAtStart = (await diagnostics(page)).invalidCount;
  await record('start');

  // 1. Select road and drag one stroke.
  await selectTool(page, 'road');
  await dragCells(page, ROAD_FROM, ROAD_TO);
  await expectDiagnostics(
    page,
    { town: { roadTiles: ROAD_TILES, homes: 0 }, objects: 0, history: { undoDepth: 1, canRedo: false } },
    'road stroke lays 8 tiles as one undo entry',
  );
  await expect(byId(page, UI_TEST_IDS.undo)).toBeEnabled();
  await record('road');

  // 2. Place a cottage next to the road with a single click.
  await selectTool(page, 'cottage');
  await clickFootprint(page, 'cottage', HOUSE);
  await expectDiagnostics(
    page,
    {
      objects: 1,
      render: { objects: 1 },
      town: { homes: 1, residents: COTTAGE_RESIDENTS, roadTiles: ROAD_TILES },
      history: { undoDepth: 2, canRedo: false },
    },
    'cottage placed and rendered',
  );
  await record('house');

  // 3. Undo (dock button) removes the house only.
  await byId(page, UI_TEST_IDS.undo).click();
  await expectDiagnostics(
    page,
    { objects: 0, render: { objects: 0 }, town: { homes: 0, residents: 0, roadTiles: ROAD_TILES }, history: { undoDepth: 1, redoDepth: 1, canRedo: true } },
    'undo removes the cottage, keeps the road',
  );
  await expect(byId(page, UI_TEST_IDS.redo)).toBeEnabled();
  await record('undo');

  // 4. Redo (dock button) brings it back.
  await byId(page, UI_TEST_IDS.redo).click();
  await expectDiagnostics(
    page,
    { objects: 1, render: { objects: 1 }, town: { homes: 1, residents: COTTAGE_RESIDENTS, roadTiles: ROAD_TILES }, history: { undoDepth: 2, redoDepth: 0, canRedo: false } },
    'redo restores the cottage',
  );
  await record('redo');

  // Keyboard shortcuts drive the same history (desktop only: phones have no keyboard).
  if (!testInfo.project.name.startsWith('mobile')) {
    await page.keyboard.press('Control+z');
    await expectDiagnostics(page, { objects: 0, town: { homes: 0 }, history: { canRedo: true } }, 'Ctrl+Z undoes');
    await page.keyboard.press('Control+Shift+z');
    await expectDiagnostics(page, { objects: 1, town: { homes: 1 }, history: { canRedo: false } }, 'Ctrl+Shift+Z redoes');
    await record('keyboard undo/redo');
  }

  // 5. Bulldoze: clicking the house removes the object first (object > edge > ground).
  await selectTool(page, 'bulldoze');
  await clickFootprint(page, 'cottage', HOUSE);
  await expectDiagnostics(
    page,
    { objects: 0, render: { objects: 0 }, town: { homes: 0, residents: 0, roadTiles: ROAD_TILES }, history: { undoDepth: 3 } },
    'bulldoze removes the cottage, not the road',
  );
  await record('bulldoze house');

  // 6. Bulldoze-drag half the road in one stroke.
  await dragCells(page, [16, 24], [23, 24]);
  await expectDiagnostics(page, { town: { roadTiles: ROAD_TILES - 4 }, history: { undoDepth: 4 } }, 'bulldoze drag clears 4 road tiles');
  await record('bulldoze road');

  // That stroke undoes as one entry.
  await byId(page, UI_TEST_IDS.undo).click();
  await expectDiagnostics(page, { town: { roadTiles: ROAD_TILES }, objects: 0, history: { undoDepth: 3, canRedo: true } }, 'undo restores the road');
  await record('undo bulldoze');

  const end = await diagnostics(page);
  expect(end.render.objects, 'renderer matches TownState').toBe(end.objects);
  expect(end.invalidCount - invalidAtStart, 'no invalid placements in a valid journey').toBe(0);

  await attachJson(testInfo, `${testInfo.project.name}-build-flow`, trail);
  await testInfo.attach(`${testInfo.project.name}-build-flow-end`, { body: await page.screenshot(), contentType: 'image/png' });
  errors.expectNone();
});

// A roundabout is a road feature: a 6 × 6-cell (3 × 3 road blocks) object that paints its whole
// footprint to road when placed and turns it back to field when bulldozed.
const ROUNDABOUT_CELL: [number, number] = [24, 24];
const ROUNDABOUT_BLOCKS = 9;

test('roundabout: Streets tab → place on the field → bulldoze, through real input', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await gotoTitle(page);
  await startBuilding(page);
  const before = await expectDiagnostics(page, { objects: 0, town: { roadTiles: 0 }, history: { undoDepth: 0 } }, 'empty start');

  // Pick it from the Streets tab (real clicks on the tab and the tool card).
  await byId(page, UI_TEST_IDS.category('streets')).click();
  await expect(byId(page, UI_TEST_IDS.category('streets'))).toHaveAttribute('aria-pressed', 'true');
  await byId(page, UI_TEST_IDS.tool('roundabout')).click();
  await expect.poll(async () => (await diagnostics(page)).tool).toBe('roundabout');

  await clickCell(page, ...ROUNDABOUT_CELL);
  const placed = await expectDiagnostics(
    page,
    {
      objects: before.objects + 1,
      render: { objects: before.render.objects + 1 },
      town: { roadTiles: before.town.roadTiles + ROUNDABOUT_BLOCKS, homes: 0 },
      history: { undoDepth: 1, canRedo: false },
    },
    'roundabout paints 9 road blocks and adds one object',
  );
  expect(placed.invalidCount, 'no refusal').toBe(before.invalidCount);
  await testInfo.attach(`${testInfo.project.name}-roundabout`, { body: await page.screenshot(), contentType: 'image/png' });

  // Bulldoze one click on it: the object goes and its road goes with it.
  await selectTool(page, 'bulldoze');
  await clickCell(page, ...ROUNDABOUT_CELL);
  await expectDiagnostics(
    page,
    { objects: before.objects, render: { objects: before.render.objects }, town: { roadTiles: before.town.roadTiles }, history: { undoDepth: 2 } },
    'bulldozing the roundabout removes the object and its 9 road blocks',
  );
  errors.expectNone();
});

// WP-17c: every grown building (WP-17 footprints) placed by real input on an empty verge next to a
// road, at the DEFAULT build zoom, on both projects. A road along rows 24–25 (x 8–39); the square
// buildings north of it at rotation 0, the non-square ones south of it after one Rotate press
// (4 × 3 / 4 × 5 rotated). One free cell between neighbours. All plots are on the canvas on desktop
// and on the Pixel 7 (probed with cellToClient + elementFromPoint).
const GROWN: ReadonlyArray<{ kind: ObjectKind; anchor: Cell; rotated: boolean }> = [
  { kind: 'cottage', anchor: { x: 10, z: 20 }, rotated: false },
  { kind: 'bungalow', anchor: { x: 15, z: 20 }, rotated: false },
  { kind: 'family-home', anchor: { x: 20, z: 20 }, rotated: false },
  { kind: 'garage-house', anchor: { x: 25, z: 20 }, rotated: false },
  { kind: 'corner-shop', anchor: { x: 30, z: 21 }, rotated: false },
  { kind: 'townhouse', anchor: { x: 10, z: 26 }, rotated: true },
  { kind: 'big-house', anchor: { x: 15, z: 26 }, rotated: true },
  { kind: 'supermarket', anchor: { x: 20, z: 26 }, rotated: true },
  { kind: 'church', anchor: { x: 25, z: 26 }, rotated: true },
];
const PLACEMENT_OUT = 'artifacts/wp-17c/placement';

type Hover = { x: number; z: number; valid: boolean; reason: string | null } | null;
const hoverOf = async (page: Page): Promise<Hover> => (await diagnostics(page)).hover as Hover;

test('every grown building lands on the footprint its ghost shows (real input, default zoom)', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = trackErrors(page);
  const mobile = testInfo.project.name.startsWith('mobile');
  const project = testInfo.project.name;
  mkdirSync(PLACEMENT_OUT, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: `${PLACEMENT_OUT}/${project}-${name}.png` });
  const press = async (p: { x: number; y: number }) => {
    if (mobile) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  };

  await gotoTitle(page);
  await startBuilding(page);
  await selectTool(page, 'road');
  await dragCells(page, [8, 24], [39, 24], 20);
  await expectDiagnostics(page, { town: { roadTiles: 16 }, history: { undoDepth: 1 } }, 'road along rows 24–25, x 8–39');

  // The dock's Rotate button is a touch control; with a mouse and keyboard it is hidden and R rotates.
  if (mobile) await expect(byId(page, UI_TEST_IDS.rotate)).toBeVisible();
  else await expect(byId(page, UI_TEST_IDS.rotate)).toBeHidden();
  const placed: Array<{ kind: ObjectKind; anchor: Cell; rotation: Rotation }> = [];
  for (const { kind, anchor, rotated } of GROWN) {
    await selectTool(page, kind);
    // Rotation persists across tools: squares stay at 0; the first non-square one rotates once.
    if (rotated && (await diagnostics(page)).rotation === 0) {
      if (mobile) await byId(page, UI_TEST_IDS.rotate).click();
      else await page.keyboard.press('r');
    }
    // Wait for the rotation to show up in the diagnostics.
    await expect.poll(async () => (await diagnostics(page)).rotation % 2, { message: `${kind}: ${rotated ? 'turned a quarter' : 'unrotated'}` }).toBe(rotated ? 1 : 0);
    const rotation = (await diagnostics(page)).rotation as Rotation;
    const [w, d] = rotatedFootprint(objectDef(kind).footprint, rotation);
    const pointer = footprintPointer(kind, anchor, rotation);
    const p = await footprintPoint(page, kind, anchor, rotation);

    // Ghost: valid, over the intended footprint.
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await expect.poll(() => hoverOf(page), { message: `${kind}: ghost over ${w}×${d} at (${anchor.x},${anchor.z})` }).toEqual({ ...pointer.cell, valid: true, reason: null });
    await page.waitForTimeout(150); // ghost lerp settles
    await shot(`${kind}-ghost`);

    const before = await diagnostics(page);
    await press(p);
    await expectDiagnostics(page, { objects: before.objects + 1, render: { objects: before.render.objects + 1 }, history: { undoDepth: before.history.undoDepth + 1 } }, `${kind} placed`);
    expect((await diagnostics(page)).invalidCount, `${kind}: no refusal`).toBe(before.invalidCount);
    placed.push({ kind, anchor, rotation });

    // One cell east of it overlaps the building just placed: a sensible refusal on hover. (Cells
    // just built on read as calm until the pointer leaves them, so step off the footprint first.)
    const off = await canvasPoint(page, anchor.x - 1, anchor.z);
    await page.mouse.move(off.x, off.y, { steps: 3 });
    await expect.poll(async () => { const h = await hoverOf(page); return h && { x: h.x, z: h.z }; }).toEqual({ x: anchor.x - 1, z: anchor.z });
    const overlap = await footprintPoint(page, kind, { x: anchor.x + 1, z: anchor.z }, rotation);
    await page.mouse.move(overlap.x, overlap.y, { steps: 3 });
    await expect
      .poll(() => hoverOf(page), { message: `${kind}: overlapping hover` })
      .toMatchObject({ valid: false, reason: 'Something is already here' });
    await page.waitForTimeout(150);
    await shot(`${kind}-overlap`);
  }
  await page.mouse.move(5, 5);
  await shot('all-placed');

  // Probe what was really placed with a 1 × 1 tool (lamppost): every footprint corner is occupied,
  // and the field cell just outside each free side is not, so the placed footprint is exactly the
  // w × d rectangle at the intended anchor.
  await selectTool(page, 'lamppost');
  const probe = async (cell: Cell) => {
    const q = await canvasPoint(page, cell.x, cell.z);
    await page.mouse.move(q.x, q.y, { steps: 2 });
    await expect.poll(async () => { const h = await hoverOf(page); return h && { x: h.x, z: h.z }; }).toEqual(cell);
    return (await hoverOf(page))!;
  };
  const report: Array<{ kind: ObjectKind; anchor: Cell; rotation: Rotation; size: [number, number] }> = [];
  for (const { kind, anchor, rotation } of placed) {
    const [w, d] = rotatedFootprint(objectDef(kind).footprint, rotation);
    const north = anchor.z < 24;
    const inside = [anchor, { x: anchor.x + w - 1, z: anchor.z }, { x: anchor.x, z: anchor.z + d - 1 }, { x: anchor.x + w - 1, z: anchor.z + d - 1 }];
    for (const cell of inside) {
      expect((await probe(cell)).reason, `${kind}: footprint corner (${cell.x},${cell.z}) occupied`).toBe('Something is already here');
    }
    const midX = anchor.x + Math.floor(w / 2);
    const midZ = anchor.z + Math.floor(d / 2);
    // The side facing the road touches it; the other three sides border open field.
    const outside = [{ x: anchor.x - 1, z: midZ }, { x: anchor.x + w, z: midZ }, north ? { x: midX, z: anchor.z - 1 } : { x: midX, z: anchor.z + d }];
    for (const cell of outside) {
      expect(await probe(cell), `${kind}: (${cell.x},${cell.z}) just outside the footprint is free`).toMatchObject({ valid: true, reason: null });
    }
    // And the road-facing edge really touches the road (rows 24–25).
    expect(north ? anchor.z + d : anchor.z - 1, `${kind}: fronts the road`).toBe(north ? 24 : 25);
    report.push({ kind, anchor, rotation, size: [w, d] });
  }
  const end = await diagnostics(page);
  expect(end.objects).toBe(GROWN.length);
  expect(end.render.objects).toBe(end.objects);
  await attachJson(testInfo, `${project}-grown-buildings`, report);
  errors.expectNone();
});
