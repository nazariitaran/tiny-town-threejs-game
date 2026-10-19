/**
 * Aim (point roughly, nudge, Place), driven as the on-screen Aim buttons and head tracking drive it: through
 * `emitIntent`. The aimed cell is read from diagnostics `hover`, which follows the aim; what Place built,
 * from the autosave.
 */
import { expect, test, type Page } from '@playwright/test';
import { SAVE_STORAGE_KEY } from '../src/game/config';
import type { Cell, Edge, GroundKind, ObjectKind, SavedTown } from '../src/town/types';
import { canvasPoint, diagnostics, expectDiagnostics, gotoTitle, selectTool, startBuilding, trackErrors } from './helpers';

/** The camera looking north (azimuth 0): screen right is +x, screen up is −z. */
const NORTH = { targetX: 0, targetZ: 0, azimuth: 0, polar: (52 * Math.PI) / 180, distance: 30 };

async function setPose(page: Page, azimuth: number): Promise<void> {
  await page.evaluate((pose) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose(pose), { ...NORTH, azimuth });
}

async function emit(page: Page, type: string, payload?: unknown): Promise<void> {
  await page.evaluate(([t, p]) => window.__THREE_GAME_TEST_HOOKS__!.emitIntent!(t as string, p), [type, payload] as const);
}

const nudge = (page: Page, dx: -1 | 0 | 1, dy: -1 | 0 | 1) => emit(page, 'intent:aim-nudge', { dx, dy });
const place = (page: Page) => emit(page, 'intent:aim-place');

async function hovered(page: Page): Promise<Cell | null> {
  const hover = (await diagnostics(page)).hover;
  return hover ? { x: hover.x, z: hover.z } : null;
}

/** The head pointer rests on a cell, then leaves the canvas for the Aim buttons. */
async function pointThenLeave(page: Page, cell: Cell): Promise<void> {
  const p = await canvasPoint(page, cell.x, cell.z);
  await emit(page, 'intent:virtual-pointer', { phase: 'move', clientX: p.x, clientY: p.y });
  await expect.poll(() => hovered(page)).toEqual(cell);
  await emit(page, 'intent:virtual-pointer', { phase: 'leave', clientX: p.x, clientY: p.y });
  await expect.poll(() => hovered(page)).toBeNull();
}

async function savedTown(page: Page): Promise<SavedTown> {
  await expect.poll(async () => (await diagnostics(page)).save.pending, { timeout: 5_000 }).toBe(false);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_STORAGE_KEY);
}

function groundAt(town: SavedTown, cell: Cell): GroundKind {
  let index = cell.z * town.width + cell.x;
  for (const [kind, count] of town.ground) {
    if (index < count) return kind;
    index -= count;
  }
  return 'field';
}

async function objectsOf(page: Page, kind: ObjectKind): Promise<Array<{ id: number; anchor: Cell; rotation: number }>> {
  const town = await savedTown(page);
  return town.objects.filter((o) => o.kind === kind).map((o) => ({ id: o.id, anchor: o.anchor, rotation: o.rotation }));
}

async function begin(page: Page): Promise<void> {
  await gotoTitle(page);
  await startBuilding(page);
  await setPose(page, 0);
}

test('road: nudges step a block at a time, Place lays the aimed block, again is a no-op', async ({ page }) => {
  const errors = trackErrors(page);
  await begin(page);
  await selectTool(page, 'road');
  await pointThenLeave(page, { x: 31, z: 31 });

  // From the hovered cell's block (30, 30), one block right.
  await nudge(page, 1, 0);
  await expect.poll(() => hovered(page)).toEqual({ x: 32, z: 30 });
  // A virtual pointer leaving again keeps the aim (and its ghost).
  await emit(page, 'intent:virtual-pointer', { phase: 'leave', clientX: 0, clientY: 0 });
  await page.waitForTimeout(100);
  expect(await hovered(page)).toEqual({ x: 32, z: 30 });

  await place(page);
  await expectDiagnostics(page, { town: { roadTiles: 1 }, history: { undoDepth: 1 } }, 'one road block');
  let town = await savedTown(page);
  for (const cell of [{ x: 32, z: 30 }, { x: 33, z: 30 }, { x: 32, z: 31 }, { x: 33, z: 31 }]) expect(groundAt(town, cell)).toBe('road');
  expect(groundAt(town, { x: 30, z: 30 })).toBe('field');

  // The aim stays: Place again on the same block changes nothing and reports nothing.
  const invalid = (await diagnostics(page)).invalidCount;
  await place(page);
  await page.waitForTimeout(100);
  const again = await diagnostics(page);
  expect(again.history.undoDepth).toBe(1);
  expect(again.invalidCount).toBe(invalid);
  expect(await hovered(page)).toEqual({ x: 32, z: 30 });

  // Block by block: up, Place; each Place is one undo step.
  await nudge(page, 0, -1);
  await expect.poll(() => hovered(page)).toEqual({ x: 32, z: 28 });
  await place(page);
  await expectDiagnostics(page, { town: { roadTiles: 2 }, history: { undoDepth: 2 } }, 'two road blocks');
  town = await savedTown(page);
  expect(groundAt(town, { x: 33, z: 29 })).toBe('road');
  errors.expectNone();
});

test('object tools place on the aimed cell with the current rotation; bulldoze removes it', async ({ page }) => {
  const errors = trackErrors(page);
  await begin(page);
  await selectTool(page, 'cottage');
  await emit(page, 'intent:rotate', { direction: 1 });
  await expect.poll(async () => (await diagnostics(page)).rotation).toBe(3);
  await pointThenLeave(page, { x: 20, z: 20 });
  await nudge(page, 0, 1);
  await expect.poll(() => hovered(page)).toEqual({ x: 20, z: 21 });
  await place(page);
  await expectDiagnostics(page, { objects: 1, history: { undoDepth: 1 } }, 'a cottage');
  // A 4 × 4 footprint centres on the aimed cell's lower-right corner, as for a pointer on that cell.
  expect(await objectsOf(page, 'cottage')).toEqual([{ id: expect.any(Number), anchor: { x: 19, z: 20 }, rotation: 3 }]);

  await selectTool(page, 'bulldoze');
  await nudge(page, 1, 0);
  await expect.poll(() => hovered(page)).toEqual({ x: 21, z: 21 });
  await place(page);
  await expectDiagnostics(page, { objects: 0, history: { undoDepth: 2 } }, 'bulldozed');
  errors.expectNone();
});

test('Move: Place picks up, nudges carry, Place drops', async ({ page }) => {
  const errors = trackErrors(page);
  await begin(page);
  await selectTool(page, 'cottage');
  await pointThenLeave(page, { x: 20, z: 20 });
  await place(page);
  await expectDiagnostics(page, { objects: 1 }, 'a cottage');
  const [house] = await objectsOf(page, 'cottage');

  await selectTool(page, 'move');
  // Place with no aim yet acts on the last hovered cell.
  await place(page);
  await expect.poll(async () => (await diagnostics(page)).selection?.id).toBe(house.id);
  // The aim sits on the cell that puts it back where it stands.
  await expect.poll(async () => (await diagnostics(page)).hover).toMatchObject({ x: house.anchor.x + 1, z: house.anchor.z + 1, valid: true });
  for (let i = 0; i < 6; i += 1) await nudge(page, 1, 0);
  await expect.poll(async () => (await diagnostics(page)).hover).toMatchObject({ x: house.anchor.x + 7, valid: true });
  await place(page);
  await expect.poll(async () => (await diagnostics(page)).selection).toBeNull();
  expect(await objectsOf(page, 'cottage')).toEqual([{ id: house.id, anchor: { x: house.anchor.x + 6, z: house.anchor.z }, rotation: 0 }]);
  expect((await diagnostics(page)).history.undoDepth).toBe(2);
  errors.expectNone();
});

test('hedges: the aimed edge slides along its line and Place grows one edge each', async ({ page }) => {
  const errors = trackErrors(page);
  await begin(page);
  await selectTool(page, 'hedge');
  await pointThenLeave(page, { x: 24, z: 24 });
  // The first aimed edge is the cell's side up the screen (north); right slides it along that line.
  await place(page);
  await nudge(page, 1, 0);
  await place(page);
  // Down steps across to the next parallel edge: the same cell's south side.
  await nudge(page, 0, 1);
  await place(page);
  await expectDiagnostics(page, { town: { fences: 3 }, history: { undoDepth: 3 } }, 'three hedges');
  const edges: Edge[] = (await savedTown(page)).edges.map((e) => e.edge);
  expect(edges).toEqual(
    expect.arrayContaining([
      { x: 24, z: 24, side: 'n' },
      { x: 25, z: 24, side: 'n' },
      { x: 25, z: 25, side: 'n' },
    ]),
  );
  errors.expectNone();
});

test('directions stay screen-relative after the camera turns, and a camera move keeps the aim', async ({ page }) => {
  await begin(page);
  await selectTool(page, 'pavement');
  await setPose(page, Math.PI / 2);
  await pointThenLeave(page, { x: 30, z: 30 });
  // Camera at +x looking −x: up the screen is −x, right is −z.
  await nudge(page, 0, -1);
  await expect.poll(() => hovered(page)).toEqual({ x: 29, z: 30 });
  await nudge(page, 1, 0);
  await expect.poll(() => hovered(page)).toEqual({ x: 29, z: 29 });
  await emit(page, 'intent:camera-step', { step: 'zoom-in' });
  await emit(page, 'intent:pan-camera', { dx: 40, dy: 10 });
  await page.waitForTimeout(300);
  expect(await hovered(page)).toEqual({ x: 29, z: 29 });
  await nudge(page, -1, 0);
  await expect.poll(() => hovered(page)).toEqual({ x: 29, z: 30 });
});

test('a pointer moving over the map, Esc and a tool change end the aim', async ({ page }) => {
  const errors = trackErrors(page);
  await begin(page);
  await selectTool(page, 'pavement');
  await pointThenLeave(page, { x: 30, z: 30 });
  await nudge(page, 1, 0);
  await expect.poll(() => hovered(page)).toEqual({ x: 31, z: 30 });

  // A real mouse over the canvas takes over.
  const p = await canvasPoint(page, 20, 22);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await expect.poll(() => hovered(page)).toEqual({ x: 20, z: 22 });
  // Place then starts from that hovered cell.
  await place(page);
  await expectDiagnostics(page, { history: { undoDepth: 1 } }, 'pavement under the mouse cell');
  expect(groundAt(await savedTown(page), { x: 20, z: 22 })).toBe('pavement');

  // A virtual pointer moving over the canvas ends it too.
  await nudge(page, 0, 1);
  await expect.poll(() => hovered(page)).toEqual({ x: 20, z: 23 });
  const q = await canvasPoint(page, 26, 26);
  await emit(page, 'intent:virtual-pointer', { phase: 'move', clientX: q.x, clientY: q.y });
  await expect.poll(() => hovered(page)).toEqual({ x: 26, z: 26 });
  await emit(page, 'intent:virtual-pointer', { phase: 'leave', clientX: q.x, clientY: q.y });
  await expect.poll(() => hovered(page)).toBeNull();

  // A tool change ends it: nothing stays aimed once the pointer is off the canvas.
  await nudge(page, 1, 0);
  await expect.poll(() => hovered(page)).toEqual({ x: 27, z: 26 });
  await selectTool(page, 'grass');
  await expect.poll(() => hovered(page)).toBeNull();

  // Esc ends it (and, as ever, puts the tool away).
  await nudge(page, 1, 0);
  await expect.poll(() => hovered(page)).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(() => hovered(page)).toBeNull();
  expect((await diagnostics(page)).tool).toBeNull();
  errors.expectNone();
});
