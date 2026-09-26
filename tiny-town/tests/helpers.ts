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
import { UI_TEST_IDS } from '../src/ui/UiRoot';

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

/** Title → building through the real Start button. */
export async function startBuilding(page: Page): Promise<void> {
  await byId(page, UI_TEST_IDS.start).click();
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
 * Setup for screenshot baselines / canvas captures (WP-09b): load, seed, apply the state,
 * then freeze simulation, reduce motion, hide debug UI and let two frames render.
 * Ported from tests/visual-regression.template.ts, adapted to Tiny Town's state names.
 */
export async function prepareDeterministicState(page: Page, name: string, seed = 12345): Promise<void> {
  await gotoTitle(page);
  await page.evaluate(async () => window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(false));
  await applyState(page, name, seed);
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    await hooks.setPausedForScreenshot(true);
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
