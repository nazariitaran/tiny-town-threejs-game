/**
 * WP-09b bot playtest: a seeded "builder bot" plays 200 steps through REAL input only.
 *
 * Each step it either undoes (dock button, or Ctrl+Z on desktop) or picks a random tool from
 * the dock and clicks / drags random on-screen cells found via `cellToClient`. After every step
 * it checks, from diagnostics only (no pixels):
 *  - a stroke that changed the town committed exactly one undo entry and cleared redo;
 *  - no stuck stroke: moving the mouse with no button held afterwards changes nothing;
 *  - undo pops exactly one entry onto the redo stack.
 * At the end: no console/page errors, frames advanced, ≥ 50 accepted placements,
 * `render.objects === objects`. The metrics JSON is attached and logged.
 *
 * Randomness comes from a seeded PRNG local to this spec (BOT_SEED), and the game itself is
 * seeded through the test hook, so a failing run replays exactly.
 */
import { expect, test, type Page } from '@playwright/test';
import { TOOLS, toolDef, type ToolId } from '../src/catalog/tools';
import { PLOT_DEPTH, PLOT_WIDTH } from '../src/game/config';
import { attachJson, byId, diagnostics, gotoTitle, selectTool, startBuilding, trackErrors, UI_TEST_IDS, waitFrames, type Diagnostics, type Point } from './helpers';

const STEPS = 200;
const BOT_SEED = 0x7a11;
const GAME_SEED = 12345;
const UNDO_CHANCE = 0.12;
const ROTATE_CHANCE = 0.1;
const MIN_PLACEMENTS = 50;

/** mulberry32: small deterministic PRNG so the bot's choices replay exactly. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Content = Pick<Diagnostics['town'], 'homes' | 'residents' | 'trees' | 'roadTiles' | 'props' | 'fences'> & {
  objects: number;
  groundTiles: number;
  edges: number;
};

const content = (d: Diagnostics): Content => ({
  ...d.town,
  objects: d.objects,
  groundTiles: d.render.groundTiles,
  edges: d.render.edges,
});

const sameContent = (a: Content, b: Content) => JSON.stringify(a) === JSON.stringify(b);

/** Sum of positive count deltas (objects + ground tiles + edges): a lower bound on items added. */
const itemsAdded = (before: Content, after: Content) =>
  Math.max(0, after.objects - before.objects) + Math.max(0, after.groundTiles - before.groundTiles) + Math.max(0, after.edges - before.edges);

/**
 * Client point for a cell centre, or null when it is off-screen or covered by UI. Unlike
 * helpers.canvasPoint this doesn't fail: the bot just re-rolls the cell.
 */
async function probeCell(page: Page, x: number, z: number): Promise<Point | null> {
  return page.evaluate(([cx, cz]) => {
    const p = window.__THREE_GAME_TEST_HOOKS__!.cellToClient(cx, cz);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < 2 || p.y < 2 || p.x > window.innerWidth - 2 || p.y > window.innerHeight - 2) return null;
    return document.elementFromPoint(p.x, p.y)?.id === 'game-canvas' ? p : null;
  }, [x, z] as const);
}

test('builder bot: 200 seeded real-input steps keep the town consistent', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name.startsWith('mobile');
  const errors = trackErrors(page);
  const rng = createRng(BOT_SEED);
  const int = (n: number) => Math.floor(rng() * n);
  const clampX = (v: number) => Math.max(0, Math.min(PLOT_WIDTH - 1, v));
  const clampZ = (v: number) => Math.max(0, Math.min(PLOT_DEPTH - 1, v));

  await gotoTitle(page);
  await page.evaluate(async (seed) => window.__THREE_GAME_TEST_HOOKS__!.seed(seed), GAME_SEED);
  await startBuilding(page);

  /** A random cell whose centre is visible on the canvas (re-rolled when UI covers it). */
  const visibleCell = async (near?: { x: number; z: number; radius: number }): Promise<{ x: number; z: number; p: Point } | null> => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const x = near ? clampX(near.x + int(near.radius * 2 + 1) - near.radius) : int(PLOT_WIDTH);
      const z = near ? clampZ(near.z + int(near.radius * 2 + 1) - near.radius) : int(PLOT_DEPTH);
      const p = await probeCell(page, x, z);
      if (p) return { x, z, p };
      metrics.cellRerolls += 1;
    }
    return null;
  };

  const metrics = {
    project: testInfo.project.name,
    botSeed: BOT_SEED,
    gameSeed: GAME_SEED,
    steps: STEPS,
    framesBefore: 0,
    framesAfter: 0,
    framesAdvanced: 0,
    wallMs: 0,
    toolSteps: 0,
    clicks: 0,
    drags: 0,
    rotations: 0,
    undos: 0,
    placements: 0, // accepted placing strokes (committed one undo entry)
    itemsAddedLowerBound: 0,
    rejectedStrokes: 0, // placing strokes that changed nothing (occupied / invalid / no-op)
    bulldozeStrokes: 0,
    bulldozeRemovals: 0,
    invalidEvents: 0,
    stuckStrokeChecks: 0,
    stuckStrokes: 0,
    skippedSteps: 0,
    cellRerolls: 0,
    toolUse: {} as Record<string, number>,
    final: null as null | {
      objects: number;
      render: Diagnostics['render'];
      town: Diagnostics['town'];
      history: Diagnostics['history'];
      invalidCount: number;
      drawCalls: number;
      triangles: number;
    },
    consoleErrors: errors.consoleErrors,
    pageErrors: errors.pageErrors,
  };

  const start = await diagnostics(page);
  metrics.framesBefore = start.frame;
  const invalidAtStart = start.invalidCount;
  const startedAt = Date.now();
  const placingTools = TOOLS.map((t) => t.id);

  for (let step = 0; step < STEPS; step += 1) {
    const before = await diagnostics(page);
    const label = `step ${step}`;

    // --- Undo (occasionally) -------------------------------------------------------------
    if (before.history.canUndo && rng() < UNDO_CHANCE) {
      if (!mobile && rng() < 0.5) await page.keyboard.press('Control+z');
      else await byId(page, UI_TEST_IDS.undo).click();
      await expect
        .poll(async () => (await diagnostics(page)).history.undoDepth, { message: `${label}: undo pops one entry` })
        .toBe(before.history.undoDepth - 1);
      const after = await diagnostics(page);
      expect(after.history.redoDepth, `${label}: undo pushes onto redo`).toBe(before.history.redoDepth + 1);
      metrics.undos += 1;
      continue;
    }

    // --- Tool stroke -------------------------------------------------------------------
    const toolId = placingTools[int(placingTools.length)] as ToolId;
    await selectTool(page, toolId);
    metrics.toolUse[toolId] = (metrics.toolUse[toolId] ?? 0) + 1;
    const def = toolDef(toolId);
    if (!mobile && def.layer === 'object' && rng() < ROTATE_CHANCE) {
      await page.keyboard.press('KeyR');
      metrics.rotations += 1;
    }

    const from = await visibleCell();
    if (!from) {
      metrics.skippedSteps += 1;
      continue;
    }
    const drag =
      def.drag === 'paint' || def.drag === 'line' ? rng() < 0.8 : def.drag === 'scatter' ? rng() < 0.5 : false;
    const settled = await diagnostics(page); // after tool select/rotate, before the stroke
    if (drag) {
      // Paint/line strokes run along one axis most of the time, like a player would draw them.
      const axisLocked = def.drag === 'line' || rng() < 0.7;
      const len = 1 + int(5);
      const horizontal = rng() < 0.5;
      const sign = rng() < 0.5 ? -1 : 1;
      let target = axisLocked
        ? { x: clampX(from.x + (horizontal ? sign * len : 0)), z: clampZ(from.z + (horizontal ? 0 : sign * len)) }
        : { x: clampX(from.x + int(9) - 4), z: clampZ(from.z + int(9) - 4) };
      let to = await probeCell(page, target.x, target.z);
      if (!to) {
        const alt = await visibleCell({ x: from.x, z: from.z, radius: 3 });
        if (alt) {
          target = alt;
          to = alt.p;
        }
      }
      await page.mouse.move(from.p.x, from.p.y);
      await page.mouse.down();
      if (to) await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      metrics.drags += 1;
    } else {
      await page.mouse.move(from.p.x, from.p.y);
      await page.mouse.down();
      await page.mouse.up();
      metrics.clicks += 1;
    }
    metrics.toolSteps += 1;

    await waitFrames(page, 2);
    const after = await diagnostics(page);
    const changed = !sameContent(content(settled), content(after));
    const committed = after.history.undoDepth === settled.history.undoDepth + 1;

    if (changed) {
      // A stroke that altered the town must be closed and committed as exactly one undo entry.
      expect(committed, `${label} (${toolId}): town changed, so the stroke must commit one undo entry`).toBe(true);
    }
    if (committed) {
      expect(after.history.redoDepth, `${label}: a new stroke clears redo`).toBe(0);
      if (toolId === 'bulldoze') {
        metrics.bulldozeStrokes += 1;
        metrics.bulldozeRemovals += Math.max(0, content(settled).objects - after.objects) + Math.max(0, content(settled).groundTiles - after.render.groundTiles) + Math.max(0, content(settled).edges - after.render.edges);
      } else {
        metrics.placements += 1;
        metrics.itemsAddedLowerBound += itemsAdded(content(settled), content(after));
      }
    } else {
      expect(after.history.undoDepth, `${label}: an empty stroke leaves history alone`).toBe(settled.history.undoDepth);
      if (toolId !== 'bulldoze') metrics.rejectedStrokes += 1;
    }

    // No stuck stroke: hovering elsewhere with no button held must not paint anything.
    const hover = await visibleCell();
    if (hover) {
      await page.mouse.move(hover.p.x, hover.p.y, { steps: 4 });
      await waitFrames(page, 2);
      const idle = await diagnostics(page);
      metrics.stuckStrokeChecks += 1;
      const stuck = !sameContent(content(after), content(idle)) || idle.history.undoDepth !== after.history.undoDepth;
      if (stuck) metrics.stuckStrokes += 1;
      expect(stuck, `${label} (${toolId}): hovering after mouse-up must not keep editing (stuck stroke)`).toBe(false);
    }
  }

  // Leave build mode's tool so nothing is mid-gesture, then let pop-in animations finish.
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => {
      const d = await diagnostics(page);
      return d.render.objects === d.objects && d.render.animating === 0;
    }, { message: 'renderer settles and matches TownState', timeout: 10_000 })
    .toBe(true);

  const end = await diagnostics(page);
  metrics.framesAfter = end.frame;
  metrics.framesAdvanced = end.frame - metrics.framesBefore;
  metrics.wallMs = Date.now() - startedAt;
  metrics.invalidEvents = end.invalidCount - invalidAtStart;
  metrics.final = {
    objects: end.objects,
    render: end.render,
    town: end.town,
    history: end.history,
    invalidCount: end.invalidCount,
    drawCalls: end.renderer.calls,
    triangles: end.renderer.triangles,
  };

  await attachJson(testInfo, `${testInfo.project.name}-bot-playtest-metrics`, metrics);
  await testInfo.attach(`${testInfo.project.name}-bot-playtest-end`, { body: await page.screenshot(), contentType: 'image/png' });
  console.log(`bot playtest metrics ${JSON.stringify(metrics)}`);

  errors.expectNone();
  expect(metrics.framesAdvanced, 'render loop kept running').toBeGreaterThan(STEPS);
  expect(metrics.placements, `≥ ${MIN_PLACEMENTS} accepted placements`).toBeGreaterThanOrEqual(MIN_PLACEMENTS);
  expect(metrics.stuckStrokes, 'no stuck strokes').toBe(0);
  expect(metrics.skippedSteps, 'bot found a visible cell on (almost) every step').toBeLessThanOrEqual(STEPS * 0.05);
  expect(end.render.objects, 'render.objects === objects').toBe(end.objects);
  expect(end.render.edges, 'render.edges === fences in TownState').toBe(end.town.fences);
});
