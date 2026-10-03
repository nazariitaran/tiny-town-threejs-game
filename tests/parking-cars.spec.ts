/**
 * Ambient cars use the car parks: a car passing a lot's entrance may drive into a free stall, stay a
 * while, reverse out and rejoin the street. Checked through diagnostics `life` and real input.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { footprintOf, objectDef } from '../src/catalog/objects';
import { PLOT_WIDTH } from '../src/game/config';
import type { LifeDiagnostics } from '../src/life/LifeSystem';
import { stallCount, type LotStyle } from '../src/life/parkingLayout';
import { MAX_CARS } from '../src/life/TrafficSim';
import { rotatedFootprint } from '../src/town/grid';
import { demoOffset } from '../src/town/sampleTown';
import type { Cell, Rotation } from '../src/town/types';
import { applyState, attachJson, byId, canvasPoint, diagnostics, dragCells, expectDiagnostics, footprintPoint, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS, waitFrames, type Point } from './helpers';

const ARTIFACTS = 'artifacts/parking-cars/visual';
/** Chance decides who parks and when: on these towns a car is in a stall within 10–55 s. */
const PARK_TIMEOUT = 120_000;
/** The longest stay (30 s), a wait for the street to clear, and the way out. */
const LEAVE_TIMEOUT = 100_000;

type CarCell = LifeDiagnostics['carCells'][number];
interface Lot {
  name: string;
  anchor: Cell;
  rotation: Rotation;
  style: LotStyle;
}

const O = demoOffset(PLOT_WIDTH);
/** The sample town's large car park, entrance facing west onto the side street (columns 22–23). */
const SAMPLE_LOT: Lot = { name: 'large', anchor: { x: 24 + O, z: 14 + O }, rotation: 3, style: 2 };
const sampleRoad = (x: number, z: number) => {
  const [lx, lz] = [x - O, z - O];
  return ((lz === 24 || lz === 25) && lx >= 4 && lx <= 43) || ((lx === 22 || lx === 23) && lz >= 8 && lz <= 41) || (lx >= 20 && lx <= 25 && lz >= 22 && lz <= 27);
};

function inLot(lot: Lot, c: { x: number; z: number }): boolean {
  const [w, d] = rotatedFootprint(footprintOf(objectDef('parking'), lot.style), lot.rotation);
  return c.x >= lot.anchor.x && c.x < lot.anchor.x + w && c.z >= lot.anchor.z && c.z < lot.anchor.z + d;
}

const inALot = (c: CarCell) => c.phase !== 'drive' && c.phase !== 'approach';
const parkedCars = (l: LifeDiagnostics) => l.carCells.filter((c) => c.phase === 'parked');

async function life(page: Page): Promise<LifeDiagnostics> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__!.life)) as LifeDiagnostics);
}

/** What holds at every instant: the car cap, one car per stall, and counters that match the cars. */
function expectConsistent(l: LifeDiagnostics): void {
  expect(l.cars, 'car count').toBeLessThanOrEqual(MAX_CARS);
  expect(l.carCells).toHaveLength(l.cars);
  const stalls = l.carCells.filter((c) => c.lot !== 0).map((c) => `${c.lot}:${c.stall}`);
  expect(new Set(stalls).size, `one car per stall (${stalls.join(' ')})`).toBe(stalls.length);
  expect(l.parked, 'life.parked').toBe(parkedCars(l).length);
  for (const c of l.carCells) expect(c.lot !== 0, `car ${c.id} (${c.phase}) names a lot only off the road`).toBe(c.phase !== 'drive');
}

/** Polls `life` until `pick` returns a value, checking the invariants at every poll. */
async function until<T>(page: Page, what: string, timeout: number, pick: (l: LifeDiagnostics) => T | null | undefined | false): Promise<{ value: T; life: LifeDiagnostics }> {
  const start = Date.now();
  for (;;) {
    const l = await life(page);
    expectConsistent(l);
    const value = pick(l);
    if (value) return { value, life: l };
    if (Date.now() - start > timeout) throw new Error(`${what}: not within ${timeout} ms; life = ${JSON.stringify(l)}`);
    await page.waitForTimeout(100);
  }
}

/** Waits for a car standing in a stall of one of `lots`, and checks where it stands. */
async function waitForParkedCar(page: Page, lots: readonly Lot[]): Promise<{ car: CarCell; lot: Lot; life: LifeDiagnostics }> {
  const { value: car, life: l } = await until(page, 'a car parks', PARK_TIMEOUT, (now) => parkedCars(now)[0]);
  const lot = lots.find((candidate) => inLot(candidate, car));
  expect(lot, `parked car ${car.id} at (${car.x},${car.z}) stands inside a car park`).toBeDefined();
  expect(car.lot, 'the car names its lot').toBeGreaterThan(0);
  expect(car.stall).toBeGreaterThanOrEqual(0);
  expect(car.stall, `stall index in the ${lot!.name} lot`).toBeLessThan(stallCount(lot!.style));
  expect(l.parked).toBeGreaterThanOrEqual(1);
  return { car, lot: lot!, life: l };
}

/** Some car on the road is somewhere else than it was in `before`. */
async function expectCarsDriving(page: Page, before: LifeDiagnostics, label: string): Promise<void> {
  const was = new Map(before.carCells.map((c) => [c.id, c]));
  await until(page, label, 5_000, (now) =>
    now.carCells.some((c) => {
      const old = was.get(c.id);
      return c.phase === 'drive' && old !== undefined && (old.px !== c.px || old.pz !== c.pz);
    }),
  );
}

async function sampleTown(page: Page): Promise<void> {
  await gotoTitle(page);
  await applyState(page, 'sample-town');
  await expect.poll(async () => (await life(page)).loaded, { message: 'car models loaded' }).toBe(true);
}

async function put(page: Page, p: Point, touch: boolean): Promise<void> {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
  }
}

async function pickStyle(page: Page, choice: number): Promise<void> {
  await byId(page, UI_TEST_IDS.variant(choice)).click();
  await expect.poll(async () => (await diagnostics(page)).variant).toEqual({ choice, count: 3 });
}

test('a car parks in the sample town\'s car park, then leaves', async ({ page }, testInfo) => {
  test.setTimeout(PARK_TIMEOUT + LEAVE_TIMEOUT + 30_000);
  const errors = trackErrors(page);
  mkdirSync(ARTIFACTS, { recursive: true });
  await sampleTown(page);
  expect((await life(page)).cars).toBe(MAX_CARS);

  const { car, life: parked } = await waitForParkedCar(page, [SAMPLE_LOT]);
  // The picture only: a close look at the stall while the car stands in it.
  const usual = (await diagnostics(page)).camera;
  await page.evaluate((c) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose({ targetX: c.px, targetZ: c.pz, azimuth: Math.PI / 4, polar: 0.6, distance: 7 }), car);
  await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-sample-parked.png` });
  await page.evaluate((pose) => window.__THREE_GAME_TEST_HOOKS__!.setCameraPose(pose), usual);

  const { value: back } = await until(page, `car ${car.id} leaves its stall and drives off`, LEAVE_TIMEOUT, (now) => {
    const me = now.carCells.find((c) => c.id === car.id);
    expect(me, `car ${car.id} stays in the town`).toBeDefined();
    if (inALot(me!)) expect(inLot(SAMPLE_LOT, me!) || sampleRoad(me!.x, me!.z), `car ${car.id} (${me!.phase}) in the lot or on its street (${me!.x},${me!.z})`).toBe(true);
    return me!.phase === 'drive' ? me : null;
  });
  expect(sampleRoad(back.x, back.z), `car ${car.id} back on a road cell (${back.x},${back.z})`).toBe(true);
  expect(back.lot).toBe(0);
  const end = await life(page);
  expect(end.cars).toBe(MAX_CARS);
  expect(end.despawned, 'nobody vanishes on an unchanged town').toBe(0);
  await attachJson(testInfo, 'parked-and-left', { car, parked, back, end });
  errors.expectNone();
});

test('cars park in car parks built with real input; bulldozing a lot takes its parked car', async ({ page }, testInfo) => {
  test.setTimeout(PARK_TIMEOUT + 60_000);
  const errors = trackErrors(page);
  const touch = testInfo.project.name.startsWith('mobile');
  mkdirSync(ARTIFACTS, { recursive: true });
  await gotoTitle(page);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.seed(12345));
  await startBuilding(page);

  // A street along rows 34–35 with a side street off it: 19 road blocks, enough for three cars.
  const ROW = 34;
  const MEDIUM: Lot = { name: 'medium', anchor: { x: 26, z: 30 }, rotation: 0, style: 1 };
  const SMALL: Lot = { name: 'small', anchor: { x: 34, z: 32 }, rotation: 0, style: 0 };
  await selectTool(page, 'road');
  await dragCells(page, [18, ROW], [43, ROW], 24);
  await expectDiagnostics(page, { town: { roadTiles: 13 } }, 'street x 18–43');
  await dragCells(page, [22, ROW - 1], [22, ROW - 12], 16);
  const street = await expectDiagnostics(page, { town: { roadTiles: 19 } }, 'side street z 22–33');
  await expect.poll(async () => (await life(page)).cars, { message: 'cars on the new street' }).toBe(3);

  await selectTool(page, 'parking');
  await pickStyle(page, 1);
  await put(page, await footprintPoint(page, 'parking', MEDIUM.anchor, 0, 1), touch);
  await expectDiagnostics(page, { objects: 1, town: { roadTiles: street.town.roadTiles + 4 } }, 'medium car park');
  await pickStyle(page, 0);
  await put(page, await footprintPoint(page, 'parking', SMALL.anchor, 0, 0), touch);
  const built = await expectDiagnostics(page, { objects: 2, town: { roadTiles: street.town.roadTiles + 6 } }, 'small car park');
  expect((await life(page)).cars, 'car parks add no cars').toBe(3);

  const { car, lot } = await waitForParkedCar(page, [MEDIUM, SMALL]);
  await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-built-parked-${lot.name}.png` });

  // Bulldoze that lot under the parked car.
  const target = await canvasPoint(page, lot.anchor.x + 1, lot.anchor.z + 1);
  await selectTool(page, 'bulldoze');
  const before = await life(page);
  const mine = before.carCells.find((c) => c.id === car.id);
  expect(mine, `car ${car.id} still parked when the bulldozer arrives`).toMatchObject({ phase: 'parked', lot: car.lot });
  const inThisLot = before.carCells.filter((c) => c.lot === car.lot);
  await put(page, target, touch);
  const lotTiles = lot.style === 1 ? 4 : 2;
  await expectDiagnostics(page, { objects: 1, town: { roadTiles: built.town.roadTiles - lotTiles } }, `${lot.name} car park bulldozed`);
  // `life` is published by the next frame's update; the town counters above are live.
  await waitFrames(page, 2);
  const after = await life(page);
  expectConsistent(after);
  expect(after.carCells.find((c) => c.id === car.id), `car ${car.id} goes with its lot`).toBeUndefined();
  expect(after.carCells.filter((c) => c.lot === car.lot), 'no car names the bulldozed lot').toEqual([]);
  expect(after.carCells.filter((c) => inLot(lot, c)), 'no car stands where the lot was').toEqual([]);
  // The other lot's cars are untouched; one of them may have just reached its stall.
  const others = before.carCells.filter((c) => c.lot !== 0 && c.lot !== car.lot);
  expect(after.parked, 'life.parked drops').toBeLessThanOrEqual(others.length);
  expect(after.parked).toBeLessThan(before.parked + others.filter((c) => c.phase !== 'parked').length);
  expect(after.despawned).toBeGreaterThanOrEqual(before.despawned + inThisLot.length);
  await expectCarsDriving(page, after, 'the other cars keep driving after the bulldoze');
  await page.screenshot({ path: `${ARTIFACTS}/${testInfo.project.name}-built-bulldozed-${lot.name}.png` });

  // Undo: the lot is back, and empty.
  await byId(page, UI_TEST_IDS.undo).click();
  await expectDiagnostics(page, { objects: 2, town: { roadTiles: built.town.roadTiles } }, 'bulldoze undone');
  await waitFrames(page, 2);
  const undone = await life(page);
  expectConsistent(undone);
  expect(undone.carCells.filter((c) => c.lot === car.lot || inLot(lot, c)), `the ${lot.name} lot is back without a car`).toEqual([]);
  await expectCarsDriving(page, undone, 'cars keep driving after the undo');
  await attachJson(testInfo, 'bulldoze-under-parked-car', { lot: lot.name, car, before, after, undone });
  errors.expectNone();
});

test('reduced motion freezes cars in a car park and releases them', async ({ page }) => {
  test.setTimeout(PARK_TIMEOUT + 30_000);
  const errors = trackErrors(page);
  await sampleTown(page);
  // The first car seen off the road is on its way in, so the freeze usually lands mid-manoeuvre.
  const { value: lotCar } = await until(page, 'a car enters the car park', PARK_TIMEOUT, (now) => now.carCells.find(inALot));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(true));
  const frozen = await life(page);
  expectConsistent(frozen);
  expect(frozen.carCells.find((c) => c.id === lotCar.id), `car ${lotCar.id} is still in the car park`).toMatchObject({ lot: lotCar.lot });
  expect(frozen.parked + frozen.manoeuvring, 'cars parked or manoeuvring').toBeGreaterThanOrEqual(1);
  for (let i = 0; i < 5; i += 1) {
    const frame = (await diagnostics(page)).frame;
    await page.waitForFunction((target) => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) >= target, frame + 4);
    expect((await life(page)).carCells, `reduced motion: every car where it was (check ${i})`).toEqual(frozen.carCells);
  }
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setReducedMotion(false));
  await expectCarsDriving(page, frozen, 'cars move again');
  // The frozen car carries on: it reaches its stall, or (already parked) leaves it in the end.
  if (frozen.carCells.find((c) => c.id === lotCar.id)!.phase !== 'parked') {
    await until(page, `car ${lotCar.id} finishes its way in`, 20_000, (now) => now.carCells.find((c) => c.id === lotCar.id)?.phase === 'parked');
  }
  errors.expectNone();
});
