/**
 * Deterministic demo layout used by the 'sample-town' / 'active-play' test states
 * (screenshots, perf baselines) and a future "Load example town" menu item.
 * Uses only real BuildActions through the editor, so it also exercises the rules.
 * WP-02 owns this file; keep buildSampleTown using every placing tool at least once with ZERO
 * rejections (sampleTown.test.ts asserts it).
 *
 * All builders queue their actions and apply them with `editor.applyBatch(items, { silent: true })`:
 * one town:changed, one undo entry, and no per-item build:* events (no sound/FX spam).
 */
import type { ToolId } from '../catalog/tools';
import type { BatchItem, TownEditor } from './TownEditor';
import { ROAD_BLOCK, roadBlockAnchor } from './grid';
import type { BuildAction, ObjectKind, Rotation } from './types';

export interface DemoTownResult {
  applied: number;
  /** Human-readable description of each rejected action (empty for a correct layout). */
  rejected: string[];
}

/** Collects actions, then applies them as one silent batch. */
function demoBuilder(editor: TownEditor, describe: (item: BatchItem) => string) {
  const items: BatchItem[] = [];
  return {
    run: (toolId: ToolId, action: BuildAction): void => {
      items.push({ toolId, action });
    },
    commit: (): DemoTownResult => {
      const result = editor.applyBatch(items, { silent: true });
      return { applied: result.applied, rejected: result.rejected.map((r) => `${describe(r.item)}: ${r.message || r.reason}`) };
    },
  };
}

/** Queue road on every block of the inclusive cell rectangle (one paint per 2 × 2 block, skipping road). */
function roadRect(run: (toolId: ToolId, action: BuildAction) => void, x0: number, z0: number, x1: number, z1: number): void {
  const seen = new Set<string>();
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const anchor = roadBlockAnchor({ x, z });
      const key = `${anchor.x},${anchor.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      run('road', { type: 'paint-ground', kind: 'road', cell: anchor });
    }
  }
}

/**
 * The v0.1 sample town at WP-12 scale (48 × 48 half-unit cells): a main street (rows 24–25) and a side
 * street (columns 22–23) crossing it, 1-cell pavements on rows 23 and 26, 3×3 / 2×3 houses facing
 * the street, a fenced lawn, a meadow crossed by a walkway, a tall-fence run and 5 trees.
 */
export function buildSampleTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => `${item.toolId}@${JSON.stringify(item.action)}`);
  const paint = (kind: 'pavement' | 'walkway' | 'grass' | 'meadow', x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) run(kind, { type: 'paint-ground', kind, cell: { x, z } });
  };
  const place = (kind: Extract<ToolId, `tree-${string}` | `townhouse-${string}` | 'garage' | 'bus-stop' | 'postbox' | 'lamppost'>, x: number, z: number, rotation: Rotation = 0) =>
    run(kind, { type: 'place-object', kind, cell: { x, z }, rotation });

  // Main street (east–west) and a side street (north–south) crossing it; each road paint is one block.
  roadRect(run, 4, 24, 43, 25);
  roadRect(run, 22, 8, 23, 23);
  roadRect(run, 22, 26, 23, 41);
  // 1-cell pavements either side of the main street.
  paint('pavement', 4, 23, 21, 23);
  paint('pavement', 24, 23, 43, 23);
  paint('pavement', 4, 26, 21, 26);
  paint('pavement', 24, 26, 43, 26);
  // Gardens, a meadow and a walkway.
  paint('grass', 6, 14, 19, 22);
  paint('grass', 26, 27, 41, 34);
  paint('meadow', 6, 32, 17, 41);
  paint('walkway', 10, 27, 10, 37);

  // Houses north of the main street face south (+z, rotation 0); south side faces north (rotation 2).
  place('townhouse-a', 6, 20);
  place('townhouse-b', 12, 20);
  place('townhouse-c', 28, 20);
  place('garage', 34, 21);
  place('townhouse-b', 28, 27, 2);
  place('townhouse-a', 34, 27, 2);
  place('bus-stop', 16, 26, 2);
  place('postbox', 24, 23);
  for (const x of [8, 16, 26, 38]) place('lamppost', x, 23);
  // Trees, a fenced lawn and a tall-fence run.
  place('tree-a', 6, 10);
  place('tree-b', 12, 8);
  place('tree-c', 16, 12);
  place('tree-a', 38, 10);
  place('tree-b', 30, 38);
  for (let x = 6; x <= 19; x += 1) run('fence-small', { type: 'place-edge', kind: 'fence-small', edge: { x, z: 14, side: 'n' } });
  for (let z = 28; z <= 35; z += 1) run('fence-tall', { type: 'place-edge', kind: 'fence-tall', edge: { x: 42, z, side: 'w' } });

  return commit();
}

/** Asset gallery: centre road block of each of the 16 masks, as a cell (block coords (1 + 4c, 1 + 4r)). */
export function galleryMaskBlock(mask: number): { x: number; z: number } {
  return { x: ROAD_BLOCK * (1 + (mask % 6) * 4), z: ROAD_BLOCK * (1 + Math.floor(mask / 6) * 4) };
}

/**
 * Every road connection mask (16) as isolated little clusters of road blocks (4-block spacing so arms
 * never touch), plus each object kind at rotation 0 (front should face the default camera, i.e. +z),
 * ground kinds and both fence kinds, for visual verification of tiling/orientation/proportions.
 * Layout (cells, 48 × 48): mask centres at block coords (1 + 4c, 1 + 4r), mask = r * 6 + c;
 * objects at 9-cell spacing on rows z = 26 and 36; ground swatches + fences on rows 42–43.
 */
export function buildAssetGallery(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => item.toolId);
  const road = (x: number, z: number) => run('road', { type: 'paint-ground', kind: 'road', cell: { x, z } });
  for (let mask = 0; mask < 16; mask += 1) {
    const { x: cx, z: cz } = galleryMaskBlock(mask);
    road(cx, cz);
    if (mask & 1) road(cx, cz - ROAD_BLOCK);
    if (mask & 2) road(cx + ROAD_BLOCK, cz);
    if (mask & 4) road(cx, cz + ROAD_BLOCK);
    if (mask & 8) road(cx - ROAD_BLOCK, cz);
  }
  const kinds = ['townhouse-a', 'townhouse-b', 'townhouse-c', 'garage', 'bus-stop', 'postbox', 'lamppost', 'tree-a', 'tree-b', 'tree-c'] as const;
  kinds.forEach((kind, i) => {
    const x = 2 + (i % 5) * 9;
    const z = 26 + Math.floor(i / 5) * 10;
    if (kind === 'bus-stop') road(x, z - ROAD_BLOCK);
    run(kind, { type: 'place-object', kind, cell: { x, z }, rotation: 0 });
  });
  const swatches = ['pavement', 'walkway', 'grass', 'meadow'] as const;
  swatches.forEach((kind, k) => {
    for (let z = 42; z <= 43; z += 1) for (let dx = 0; dx < 4; dx += 1) run(kind, { type: 'paint-ground', kind, cell: { x: 2 + k * 6 + dx, z } });
  });
  for (let x = 28; x <= 35; x += 1) run('fence-small', { type: 'place-edge', kind: 'fence-small', edge: { x, z: 42, side: 'n' } });
  for (let x = 36; x <= 43; x += 1) run('fence-tall', { type: 'place-edge', kind: 'fence-tall', edge: { x, z: 42, side: 'n' } });
  return commit();
}

/**
 * A dense, fully built plot for performance budgets. Deterministic. A 12 × 10 cell repeat: road
 * rows at z 0/10/20/30/40 and road columns at x 0/12/24/36 (2 × 2 blocks), a pavement row either
 * side of every road row, and between them two rows of 3-deep lots facing opposite ways, each lot
 * (10 cells wide) holding a cottage, a family home, a townhouse, a garage and (mostly birch) trees on
 * open field. Lampposts and postboxes stand on the pavements. The last road row has a pavement, then
 * a tree-lined lawn.
 */
export function buildStressTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => item.toolId);
  const { width, depth } = editor.state;
  const PERIOD_X = 12;
  const PERIOD_Z = 10;
  const isRoadColumn = (x: number) => x % PERIOD_X < ROAD_BLOCK;
  // Birch and pine (42 / 204 triangles; an oak is 408) so the 96-home plot fits the mobile budget.
  const trees = ['tree-c', 'tree-b', 'tree-c', 'tree-c'] as const;
  const place = (kind: ObjectKind, x: number, z: number, rotation: Rotation) => run(kind, { type: 'place-object', kind, cell: { x, z }, rotation });
  // Roads: one paint per block.
  for (let z = 0; z < depth; z += ROAD_BLOCK) {
    for (let x = 0; x < width; x += ROAD_BLOCK) {
      if (z % PERIOD_Z === 0 || isRoadColumn(x)) run('road', { type: 'paint-ground', kind: 'road', cell: { x, z } });
    }
  }
  for (let z0 = 0; z0 < depth; z0 += PERIOD_Z) {
    const fullPeriod = z0 + PERIOD_Z <= depth;
    for (let x0 = ROAD_BLOCK; x0 < width; x0 += PERIOD_X) {
      const x1 = Math.min(x0 + PERIOD_X - ROAD_BLOCK, width) - 1; // last lot column
      // Pavement below this road row, and above the next one.
      const pavementRows = fullPeriod ? [z0 + 2, z0 + PERIOD_Z - 1] : [z0 + 2, depth - 1];
      for (const z of pavementRows) {
        for (let x = x0; x <= x1; x += 1) run('pavement', { type: 'paint-ground', kind: 'pavement', cell: { x, z } });
        place('lamppost', x0 + 4, z, 0);
        if (z === z0 + 2) place('postbox', x0 + 9, z, 0);
      }
      if (!fullPeriod) {
        // Leftover rows: a lawn with a row of trees.
        for (let z = z0 + 3; z < depth - 1; z += 1) {
          for (let x = x0; x <= x1; x += 1) {
            run('grass', { type: 'paint-ground', kind: 'grass', cell: { x, z } });
            if (z === z0 + 4 && (x - x0) % 3 === 1) place(trees[((x - x0 - 1) / 3) % trees.length], x, z, 0);
          }
        }
        continue;
      }
      // Two lot rows: rows z0+3..z0+5 face north (rotation 2), z0+6..z0+8 face south (rotation 0).
      for (const [top, rotation] of [[z0 + 3, 2], [z0 + 6, 0]] as const) {
        place('townhouse-a', x0, top, rotation);
        place('townhouse-c', x0 + 3, top, rotation);
        place('townhouse-b', x0 + 6, top, rotation);
        // Garage (1×2) flush to the street side; a tree behind it; a column of trees at the end.
        const garageZ = rotation === 2 ? top : top + 1;
        place('garage', x0 + 8, garageZ, rotation);
        place(trees[(x0 + top) % trees.length], x0 + 8, rotation === 2 ? top + 2 : top, 0);
        for (let dz = 0; dz < 3; dz += 1) place(trees[(x0 + top + dz + 1) % trees.length], x0 + 9, top + dz, 0);
      }
    }
  }
  for (let x = 0; x < width; x += 1) run('fence-small', { type: 'place-edge', kind: 'fence-small', edge: { x, z: 0, side: 'n' } });
  return commit();
}
