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
import type { BuildAction, Cell, EdgeKind, ObjectKind, Rotation } from './types';

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
 * The sample town (48 × 48 half-unit cells): a main street (rows 24–25) and a side street
 * (columns 22–23) meeting at a roundabout (cells 20–25 × 22–27), 1-cell pavements on rows 23 and 26
 * with street furniture, homes of every kind facing the street, shops and a church, a back garden
 * (bench, barbecue, swing, planter, bushes behind a hedge and a low fence), a meadow with a pool, a
 * fountain by the garden path, a tall-fence run and five trees. Uses every placing tool.
 */
export function buildSampleTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => `${item.toolId}@${JSON.stringify(item.action)}`);
  const paint = (kind: 'pavement' | 'walkway' | 'grass' | 'meadow', x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) run(kind, { type: 'paint-ground', kind, cell: { x, z } });
  };
  const place = (kind: ObjectKind, x: number, z: number, rotation: Rotation = 0) => run(kind, { type: 'place-object', kind, cell: { x, z }, rotation });
  const edgeRun = (kind: EdgeKind, side: 'n' | 'w', from: Cell, length: number) => {
    for (let i = 0; i < length; i += 1) {
      const edge = side === 'n' ? { x: from.x + i, z: from.z, side } : { x: from.x, z: from.z + i, side };
      run(kind, { type: 'place-edge', kind, edge });
    }
  };

  // Streets: main street (east–west) and a side street (north–south), one paint per block; the
  // roundabout then sits on their crossing (it paints the rest of its 3 × 3 blocks itself).
  roadRect(run, 4, 24, 43, 25);
  roadRect(run, 22, 8, 23, 23);
  roadRect(run, 22, 26, 23, 41);
  paint('pavement', 4, 23, 19, 23);
  paint('pavement', 26, 23, 43, 23);
  paint('pavement', 4, 26, 19, 26);
  paint('pavement', 26, 26, 43, 26);
  place('roundabout', 20, 22);
  place('traffic-light', 19, 23);
  place('traffic-light', 26, 26, 2);
  for (const x of [8, 16, 27, 38]) place('lamppost', x, 23);
  place('postbox', 31, 23);
  place('bus-stop', 16, 26, 2);

  // Nature and garden ground.
  paint('grass', 6, 14, 19, 22);
  paint('grass', 26, 27, 41, 34);
  paint('meadow', 6, 32, 17, 41);
  paint('walkway', 10, 27, 10, 37);

  // Homes north of the main street face south (+z, rotation 0).
  place('cottage', 6, 20);
  place('townhouse', 12, 20);
  place('bungalow', 15, 20);
  place('family-home', 28, 20);
  place('garage', 34, 21);
  place('garage-house', 36, 20);
  place('big-house', 39, 20);
  // South of it everything faces north (rotation 2): homes and shops.
  place('townhouse', 28, 27, 2);
  place('corner-shop', 30, 27, 2);
  place('cottage', 34, 27, 2);
  place('supermarket', 37, 27, 2);
  // Civic corner by the garden path: church, fountain with a bench, pool in the meadow.
  place('church', 6, 27, 2);
  place('fountain', 12, 28);
  place('bench', 11, 30, 3);
  place('swimming-pool', 13, 33, 2);

  // Back garden behind the north-west homes: low fence to the north, hedge to the west.
  edgeRun('fence-low', 'n', { x: 6, z: 14 }, 14);
  edgeRun('hedge', 'w', { x: 6, z: 15 }, 5);
  place('bench', 8, 16);
  place('barbecue', 11, 16);
  place('swing', 13, 16);
  place('planter', 17, 16);
  place('bush', 7, 18);
  place('bush', 18, 18);
  // Trees and a tall-fence run.
  place('oak', 6, 10);
  place('pine', 12, 8);
  place('birch', 16, 12);
  place('oak', 38, 10);
  place('pine', 30, 38);
  edgeRun('fence-tall', 'w', { x: 42, z: 28 }, 8);

  return commit();
}

/** Asset gallery: centre road block of each of the 16 masks, as a cell (block coords (1 + 4c, 1 + 4r)). */
export function galleryMaskBlock(mask: number): { x: number; z: number } {
  return { x: ROAD_BLOCK * (1 + (mask % 6) * 4), z: ROAD_BLOCK * (1 + Math.floor(mask / 6) * 4) };
}

/** Where each object kind stands in the asset gallery (rotation 0), as its anchor cell. */
export const GALLERY_OBJECTS: ReadonlyArray<readonly [ObjectKind, number, number]> = [
  // Row 1 (z 22–27): the big pieces.
  ['roundabout', 0, 22], ['supermarket', 7, 22], ['swimming-pool', 12, 22], ['big-house', 17, 22],
  ['church', 22, 22], ['cottage', 25, 22], ['family-home', 29, 22], ['garage-house', 33, 22],
  ['bungalow', 37, 22], ['townhouse', 41, 22], ['garage', 44, 22], ['corner-shop', 46, 22],
  // Row 2 (z 26–28): small things; the bus stop and traffic light stand behind a stub of road.
  ['fountain', 7, 26], ['swing', 10, 26], ['bench', 13, 26], ['barbecue', 15, 26], ['planter', 17, 26],
  ['postbox', 19, 26], ['lamppost', 21, 26], ['oak', 23, 26], ['pine', 25, 26], ['birch', 27, 26],
  ['bush', 29, 26], ['bus-stop', 32, 28], ['traffic-light', 35, 28],
];

/**
 * Every road connection mask (16) as isolated little clusters of road blocks (4-block spacing so arms
 * never touch), plus every object kind at rotation 0 (front should face the default camera, i.e. +z),
 * ground kinds and every edge kind, for visual verification of tiling/orientation/proportions.
 * Layout (cells, 48 × 48): mask centres at block coords (1 + 4c, 1 + 4r), mask = r * 6 + c;
 * objects per GALLERY_OBJECTS on rows 22–28; ground swatches + edge runs on rows 42–43.
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
  road(32, 26);
  road(34, 26);
  for (const [kind, x, z] of GALLERY_OBJECTS) run(kind, { type: 'place-object', kind, cell: { x, z }, rotation: 0 });
  const swatches = ['pavement', 'walkway', 'grass', 'meadow'] as const;
  swatches.forEach((kind, k) => {
    for (let z = 42; z <= 43; z += 1) for (let dx = 0; dx < 4; dx += 1) run(kind, { type: 'paint-ground', kind, cell: { x: 2 + k * 6 + dx, z } });
  });
  const edges = ['hedge', 'fence-low', 'fence-tall'] as const;
  edges.forEach((kind, k) => {
    for (let x = 26 + k * 6; x < 32 + k * 6; x += 1) run(kind, { type: 'place-edge', kind, edge: { x, z: 42, side: 'n' } });
  });
  return commit();
}

/**
 * A dense, fully built plot for performance budgets. Deterministic. A 12 × 10 cell repeat: road
 * rows at z 0/10/20/30/40 and road columns at x 0/12/24/36 (2 × 2 blocks), a pavement row either
 * side of every road row, and between them two rows of 3-deep lots facing opposite ways, each lot
 * (10 cells wide) holding a cottage, a suburban home, a townhouse, a garage and (mostly birch) trees on
 * open field. (Suburban homes, 800–1 330 triangles, not family homes, 1 731: the mobile budget.) Lampposts and postboxes stand on the pavements. The last road row has a pavement, then
 * a tree-lined lawn.
 */
export function buildStressTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => item.toolId);
  const { width, depth } = editor.state;
  const PERIOD_X = 12;
  const PERIOD_Z = 10;
  const isRoadColumn = (x: number) => x % PERIOD_X < ROAD_BLOCK;
  // Birch and pine (42 / 204 triangles; an oak is 408) so the 96-home plot fits the mobile budget.
  const trees = ['birch', 'pine', 'birch', 'birch'] as const;
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
        place('cottage', x0, top, rotation);
        place('garage-house', x0 + 3, top, rotation);
        place('townhouse', x0 + 6, top, rotation);
        // Garage (1×2) flush to the street side; a tree behind it; a column of trees at the end.
        const garageZ = rotation === 2 ? top : top + 1;
        place('garage', x0 + 8, garageZ, rotation);
        place(trees[(x0 + top) % trees.length], x0 + 8, rotation === 2 ? top + 2 : top, 0);
        for (let dz = 0; dz < 3; dz += 1) place(trees[(x0 + top + dz + 1) % trees.length], x0 + 9, top + dz, 0);
      }
    }
  }
  for (let x = 0; x < width; x += 1) run('fence-low', { type: 'place-edge', kind: 'fence-low', edge: { x, z: 0, side: 'n' } });
  return commit();
}
