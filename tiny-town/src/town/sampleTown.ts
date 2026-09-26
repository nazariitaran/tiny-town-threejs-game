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
import type { BuildAction, Rotation } from './types';

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

export function buildSampleTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => `${item.toolId}@${JSON.stringify(item.action)}`);
  const paint = (kind: 'road' | 'pavement' | 'walkway' | 'grass' | 'meadow', x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) run(kind, { type: 'paint-ground', kind, cell: { x, z } });
  };
  const place = (kind: Extract<ToolId, `tree-${string}` | `townhouse-${string}` | 'garage' | 'bus-stop' | 'postbox' | 'lamppost'>, x: number, z: number, rotation: Rotation = 0) =>
    run(kind, { type: 'place-object', kind, cell: { x, z }, rotation });

  // Main street (east–west) and a side street (north–south) meeting in a T and a crossroads.
  paint('road', 2, 12, 21, 12);
  paint('road', 11, 4, 11, 11);
  paint('road', 11, 13, 11, 20);
  // Pavements either side of the main street.
  paint('pavement', 2, 11, 10, 11);
  paint('pavement', 12, 11, 21, 11);
  paint('pavement', 2, 13, 10, 13);
  paint('pavement', 12, 13, 21, 13);
  // Gardens, a meadow and a walkway.
  paint('grass', 3, 7, 9, 10);
  paint('grass', 13, 14, 20, 17);
  paint('meadow', 3, 16, 8, 20);
  paint('walkway', 5, 14, 5, 18);

  // Houses north of the main street face south (+z, rotation 0); south side faces north (rotation 2).
  place('townhouse-a', 3, 9);
  place('townhouse-b', 6, 9);
  place('townhouse-c', 14, 9);
  place('garage', 17, 9);
  place('townhouse-b', 14, 15, 2);
  place('townhouse-a', 17, 15, 2);
  place('bus-stop', 9, 13, 2);
  place('postbox', 12, 11);
  for (const x of [4, 8, 13, 19]) place('lamppost', x, 11);
  // Trees and a fenced garden.
  place('tree-a', 3, 5);
  place('tree-b', 6, 4);
  place('tree-c', 8, 6);
  place('tree-a', 19, 5);
  place('tree-b', 15, 19);
  for (let x = 3; x <= 9; x += 1) run('fence-small', { type: 'place-edge', kind: 'fence-small', edge: { x, z: 7, side: 'n' } });
  for (let z = 14; z <= 17; z += 1) run('fence-tall', { type: 'place-edge', kind: 'fence-tall', edge: { x: 21, z, side: 'w' } });

  return commit();
}

/**
 * Every road connection mask (16) as isolated little road clusters (4-cell spacing so arms
 * never touch), plus each object kind at rotation 0 (front should face the default camera,
 * i.e. +z), ground kinds and both fence kinds, for visual verification of tiling/orientation.
 * Layout (z): road clusters centred at z = 1, 5, 9 (mask = row * 6 + column, column x = 1 + 4c);
 * objects at z = 12 and 16; ground swatches + fences at z = 21.
 */
export function buildAssetGallery(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => item.toolId);
  const road = (x: number, z: number) => run('road', { type: 'paint-ground', kind: 'road', cell: { x, z } });
  // 16 masks: a centre cell at (cx, cz) with arms N/E/S/W according to the mask bits.
  for (let mask = 0; mask < 16; mask += 1) {
    const cx = 1 + (mask % 6) * 4;
    const cz = 1 + Math.floor(mask / 6) * 4;
    road(cx, cz);
    if (mask & 1) road(cx, cz - 1);
    if (mask & 2) road(cx + 1, cz);
    if (mask & 4) road(cx, cz + 1);
    if (mask & 8) road(cx - 1, cz);
  }
  const kinds = ['townhouse-a', 'townhouse-b', 'townhouse-c', 'garage', 'bus-stop', 'postbox', 'lamppost', 'tree-a', 'tree-b', 'tree-c'] as const;
  kinds.forEach((kind, i) => {
    const x = 1 + (i % 5) * 4;
    const z = 12 + Math.floor(i / 5) * 4;
    if (kind === 'bus-stop') road(x, z - 1);
    run(kind, { type: 'place-object', kind, cell: { x, z }, rotation: 0 });
  });
  for (const kind of ['pavement', 'walkway', 'grass', 'meadow'] as const) {
    const x = 1 + ['pavement', 'walkway', 'grass', 'meadow'].indexOf(kind) * 3;
    for (let dx = 0; dx < 2; dx += 1) run(kind, { type: 'paint-ground', kind, cell: { x: x + dx, z: 21 } });
  }
  for (let x = 14; x <= 17; x += 1) run('fence-small', { type: 'place-edge', kind: 'fence-small', edge: { x, z: 21, side: 'n' } });
  for (let x = 18; x <= 21; x += 1) run('fence-tall', { type: 'place-edge', kind: 'fence-tall', edge: { x, z: 21, side: 'n' } });
  return commit();
}

/** A dense, fully built plot for performance budgets (every cell used). Deterministic. */
export function buildStressTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => item.toolId);
  const { width, depth } = editor.state;
  const houses = ['townhouse-a', 'townhouse-b', 'townhouse-c', 'garage'] as const;
  const trees = ['tree-a', 'tree-b', 'tree-c'] as const;
  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = { x, z };
      if (z % 4 === 0 || x % 6 === 0) run('road', { type: 'paint-ground', kind: 'road', cell });
      else if (z % 4 === 1 || z % 4 === 3) run('pavement', { type: 'paint-ground', kind: 'pavement', cell });
      else if ((x + z) % 3 === 0) run(trees[x % 3], { type: 'place-object', kind: trees[x % 3], cell, rotation: 0 });
      else run(houses[x % 4], { type: 'place-object', kind: houses[x % 4], cell, rotation: ((z / 2) % 2 === 0 ? 0 : 2) as Rotation });
    }
  }
  for (let x = 0; x < width; x += 1) run('fence-small', { type: 'place-edge', kind: 'fence-small', edge: { x, z: 0, side: 'n' } });
  return commit();
}
