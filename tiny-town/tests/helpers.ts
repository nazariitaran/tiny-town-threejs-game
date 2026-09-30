/**
 * Shared Playwright helpers for Tiny Town specs (WP-09 owns this file; other WPs may import it).
 *
 * Rules these helpers enforce:
 *  - Gameplay steps use REAL input only: DOM clicks on UI_TEST_IDS buttons, and mouse
 *    clicks/drags at `cellToClient` coordinates. `setState` is for setup, never for faking
 *    a step a test asserts.
 *  - Before any canvas click, `canvasPoint` checks the point actually hits the canvas, so a
 *    UI panel covering a cell fails loudly instead of silently eating the click.
 *  - Assert diagnostics (`window.__THREE_GAME_DIAGNOSTICS__`), not pixels.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { ToolCategory, ToolId } from '../src/catalog/tools';
import { toolDef } from '../src/catalog/tools';
import { objectDef } from '../src/catalog/objects';
import { footprintCells, rotatedFootprint } from '../src/town/grid';
import type { Cell, ObjectKind, Rotation } from '../src/town/types';
import { UI_TEST_IDS } from '../src/ui/UiRoot';
import type { MenuTab } from '../src/ui/testIds';

export { UI_TEST_IDS };

export type Diagnostics = ThreeGameDiagnostics;
export type Point = { x: number; y: number };

/** Collects console errors and uncaught page errors for the page's whole life. */
export function trackErrors(page: Page): { consoleErrors: string[]; pageErrors: string[]; expectNone(): void } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return {
    consoleErrors,
    pageErrors,
    expectNone() {
      expect(consoleErrors, 'console errors').toEqual([]);
      expect(pageErrors, 'page errors').toEqual([]);
    },
  };
}

export const byId = (page: Page, id: string) => page.locator(`#${id}`);

export async function diagnostics(page: Page): Promise<Diagnostics> {
  const diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  if (!diag) throw new Error('window.__THREE_GAME_DIAGNOSTICS__ is not published');
  return diag;
}

/** Wait until the render loop has published `frames` more frames than it had when called. */
export async function waitFrames(page: Page, frames = 3): Promise<void> {
  const start = (await diagnostics(page)).frame;
  await page.waitForFunction((target) => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) >= target, start + frames);
}

export async function gotoTitle(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 15_000 });
}

/**
 * Title → building through the real Start button. A new town is named first (WP-20): the name
 * dialog opens with a suggested name, which is accepted as it is. Continue goes straight in.
 */
export async function startBuilding(page: Page): Promise<void> {
  await clickStart(page);
}

/** Click Start; if the name dialog opens (no save), accept its suggestion; wait for building. */
export async function clickStart(page: Page): Promise<void> {
  await page.locator(`#${UI_TEST_IDS.start}`).click();
  await page.waitForFunction(
    (panelId) => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building' || !document.getElementById(panelId)?.hidden,
    UI_TEST_IDS.namePanel,
  );
  const panel = page.locator(`#${UI_TEST_IDS.namePanel}`);
  if (await panel.isVisible()) {
    await expect(page.locator(`#${UI_TEST_IDS.nameInput}`)).not.toHaveValue('');
    await page.locator(`#${UI_TEST_IDS.nameSubmit}`).click();
  }
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building');
}

/** Select a tool through the dock (category tab → tool button, or the bulldoze button). */
export async function selectTool(page: Page, toolId: ToolId): Promise<void> {
  if ((await diagnostics(page)).tool === toolId) return; // clicking an active tool toggles it off
  if (toolId === 'bulldoze') {
    await byId(page, UI_TEST_IDS.bulldoze).click();
  } else {
    await byId(page, UI_TEST_IDS.category(toolDef(toolId).category as ToolCategory)).click();
    await byId(page, UI_TEST_IDS.tool(toolId)).click();
  }
  await expect.poll(async () => (await diagnostics(page)).tool).toBe(toolId);
}

/** Client point of a cell centre, verified to land on the game canvas (not on UI). */
export async function canvasPoint(page: Page, x: number, z: number): Promise<Point> {
  const result = await page.evaluate(([cx, cz]) => {
    const point = window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz);
    const hit = document.elementFromPoint(point.x, point.y);
    return { point, hitId: hit?.id ?? hit?.tagName ?? null };
  }, [x, z] as const);
  expect(result.hitId, `cell (${x},${z}) at ${JSON.stringify(result.point)} must be on the canvas, not UI`).toBe('game-canvas');
  return result.point;
}

/**
 * Client point of a fractional grid position (cell x spans [x, x + 1), so cell centres sit at
 * x + 0.5), bilinearly interpolated between the four surrounding cell centres from `cellToClient`
 * (the perspective error over one cell is far below a pixel), verified to land on the canvas.
 */
export async function gridPoint(page: Page, gx: number, gz: number): Promise<Point> {
  const cx = Math.floor(gx - 0.5);
  const cz = Math.floor(gz - 0.5);
  const tx = gx - 0.5 - cx;
  const tz = gz - 0.5 - cz;
  const result = await page.evaluate(
    ([x, z, fx, fz]) => {
      const at = (a: number, b: number) => window.__THREE_GAME_TEST_HOOKS__!.cellToClient(a, b);
      const [p00, p10, p01, p11] = [at(x, z), at(x + 1, z), at(x, z + 1), at(x + 1, z + 1)];
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const point = {
        x: lerp(lerp(p00.x, p10.x, fx), lerp(p01.x, p11.x, fx), fz),
        y: lerp(lerp(p00.y, p10.y, fx), lerp(p01.y, p11.y, fx), fz),
      };
      const hit = document.elementFromPoint(point.x, point.y);
      return { point, hitId: hit?.id ?? hit?.tagName ?? null };
    },
    [cx, cz, tx, tz] as const,
  );
  expect(result.hitId, `grid (${gx},${gz}) at ${JSON.stringify(result.point)} must be on the canvas, not UI`).toBe('game-canvas');
  return result.point;
}

/**
 * Where to point so an object tool lands on `anchor` (WP-17 footprints). ToolController centres the
 * footprint on the pointer (grid.anchorForPointer): on an odd axis the pointer sits on the middle
 * cell's centre; on an even axis the footprint centre is a cell CORNER, and a cell-centre pointer
 * is exactly on the rounding boundary (it may land either side). So on even axes we aim a quarter
 * cell short of that corner (inside cell anchor + size/2 − 1), which rounds to `anchor` with ±¼ cell
 * of slack. `cell` is the hovered cell (diagnostics.hover), `grid` the fractional pointer.
 */
export function footprintPointer(kind: ObjectKind, anchor: Cell, rotation: Rotation = 0): { cell: Cell; grid: { x: number; z: number } } {
  const [w, d] = rotatedFootprint(objectDef(kind).footprint, rotation);
  const axis = (start: number, size: number) =>
    size % 2 === 1 ? { cell: start + (size - 1) / 2, g: start + size / 2 } : { cell: start + size / 2 - 1, g: start + size / 2 - 0.25 };
  const x = axis(anchor.x, w);
  const z = axis(anchor.z, d);
  return { cell: { x: x.cell, z: z.cell }, grid: { x: x.g, z: z.g } };
}

/** Client point that places `kind` (at `rotation`) with its min corner on `anchor`. */
export async function footprintPoint(page: Page, kind: ObjectKind, anchor: Cell, rotation: Rotation = 0): Promise<Point> {
  const { grid } = footprintPointer(kind, anchor, rotation);
  return gridPoint(page, grid.x, grid.z);
}

/** Real click that places `kind` on `anchor` (the tool must already be selected and rotated to `rotation`). */
export async function clickFootprint(page: Page, kind: ObjectKind, anchor: Cell, rotation: Rotation = 0): Promise<void> {
  const p = await footprintPoint(page, kind, anchor, rotation);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** Every cell `kind` covers when anchored at `anchor` (grid.footprintCells). */
export const footprintOf = (kind: ObjectKind, anchor: Cell, rotation: Rotation = 0): Cell[] =>
  footprintCells(anchor, objectDef(kind).footprint, rotation);

export async function clickCell(page: Page, x: number, z: number): Promise<void> {
  const p = await canvasPoint(page, x, z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

export async function dragCells(page: Page, from: [number, number], to: [number, number], steps = 12): Promise<void> {
  const a = await canvasPoint(page, from[0], from[1]);
  const b = await canvasPoint(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

/**
 * Setup only: seed + apply a named test state and assert the acknowledgement.
 * Never use this to skip a gameplay step a test is asserting.
 */
export async function applyState(page: Page, name: string, seed = 12345): Promise<{ state: string }> {
  const ack = await page.evaluate(
    async ([stateName, seedValue]) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      if (!hooks) throw new Error('__THREE_GAME_TEST_HOOKS__ missing');
      await hooks.seed(seedValue);
      return hooks.setState(stateName);
    },
    [name, seed] as const,
  );
  expect(ack, `setState(${name}) acknowledgement`).toEqual({ state: name });
  return ack;
}

/**
 * Setup for screenshot baselines / canvas captures (WP-09b): load, reduce motion, pause,
 * then seed + apply the state (already frozen), hide debug UI and let two frames render.
 * Used by tests/visual-regression.spec.ts (the capture procedure for baselines).
 */
export async function prepareDeterministicState(page: Page, name: string, seed = 12345): Promise<void> {
  await gotoTitle(page);
  // Order matters (WP-09b): freeze time BEFORE the state exists, so nothing (ambient cars,
  // title orbit, clouds) advances between setState and the capture.
  //  1. Reduced motion while still running: the next frames tick every animation with
  //     delta/elapsed 0 (clouds back to t=0, wind at rest, particles cleared).
  //  2. Pause: simulation stops entirely; rendering continues.
  //  3. Seed + setState: the state is built and settled while already frozen.
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await hooks.setPausedForScreenshot(false);
    await hooks.setReducedMotion(true);
    await frames();
    await hooks.setPausedForScreenshot(true);
  });
  await applyState(page, name, seed);
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    // Re-apply after setState so its settle() pass also runs on the new town.
    await hooks.setReducedMotion(true);
    await hooks.hideDebugUi(true);
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** Poll until the town/render/history diagnostics match `expected` (a partial deep match). */
export async function expectDiagnostics(page: Page, expected: DiagnosticsExpectation, label: string): Promise<Diagnostics> {
  await expect
    .poll(async () => pick(await diagnostics(page), expected), { message: label })
    .toEqual(expected);
  return diagnostics(page);
}

export type DiagnosticsExpectation = {
  phase?: Diagnostics['phase'];
  tool?: Diagnostics['tool'];
  objects?: number;
  town?: Partial<Diagnostics['town']>;
  render?: Partial<Diagnostics['render']>;
  history?: Partial<Diagnostics['history']>;
};

function pick(diag: Diagnostics, expected: DiagnosticsExpectation): DiagnosticsExpectation {
  const out: DiagnosticsExpectation = {};
  if ('phase' in expected) out.phase = diag.phase;
  if ('tool' in expected) out.tool = diag.tool;
  if ('objects' in expected) out.objects = diag.objects;
  if (expected.town) out.town = subset(diag.town, expected.town);
  if (expected.render) out.render = subset(diag.render, expected.render);
  if (expected.history) out.history = subset(diag.history, expected.history);
  return out;
}

function subset<T extends object>(source: T, keys: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(keys) as Array<keyof T>) out[key] = source[key];
  return out;
}

/** Attach a JSON blob (metrics, diagnostics trail) to the test report. */
export async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
}

/**
 * Menu tabs (WP-25): open the menu if it is closed (☰, building phase), then select `tab` with a real
 * click and wait for its panel. Every menu control lives on one tab (Town / Graphics / Sound / Help).
 */
export async function openMenuTab(page: Page, tab: MenuTab): Promise<void> {
  const menu = page.locator(`#${UI_TEST_IDS.menuPanel}`);
  if (!(await menu.isVisible())) {
    await page.locator(`#${UI_TEST_IDS.menu}`).click();
    await expect(menu).toBeVisible();
  }
  const button = page.locator(`#${UI_TEST_IDS.menuTab(tab)}`);
  if ((await button.getAttribute('aria-selected')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`#${UI_TEST_IDS.menuTabPanel(tab)}`)).toBeVisible();
}
