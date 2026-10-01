/**
 * Offline icon renderer, loaded by `scripts/render-icons.mjs` through the dev server (the game never imports it).
 * Icons are drawn by the real ModelLibrary + TownRenderer on a tiny fake town, so they match what the player places.
 */
import * as THREE from 'three';
import { OBJECTS, objectDef } from '../catalog/objects';
import { TOOLS, variantIcon } from '../catalog/tools';
import { CELL_SIZE, cellToWorld, footprintCentreWorld, PLOT_DEPTH, PLOT_WIDTH, ROAD_TILE_SIZE, roadBlockCentreWorld } from '../game/config';
import type { GameBus } from '../game/events';
import { cellKey, footprintCells, ROAD_BLOCK } from '../town/grid';
import type { Cell, Edge, EdgeKind, GroundKind, ObjectKind, PlacedEdge, PlacedObject, TownStateReader, TownStats } from '../town/types';
import { LIGHTING } from '../world/Environment';
import { ModelLibrary } from './ModelLibrary';
import { meadowScatterModel, TownRenderer } from './TownRenderer';

interface IconScene {
  ground?: Array<[number, number, GroundKind]>;
  object?: ObjectKind;
  /** Model index, for the variant picker's chip icons; default 0. */
  variant?: number;
  edge?: EdgeKind;
  /** Clip to the framed cell / road block, so roads and walkways run out of frame instead of capping. */
  clipToCentre?: boolean;
  /** Frame the centre road block (2 × 2 cells) instead of the centre cell. */
  roadBlock?: boolean;
  /** Frame with a shared box instead of the scene's own bounds (keeps fence heights comparable). */
  frame?: THREE.Box3;
}

const C = PLOT_WIDTH / 2; // centre cell (x and z); even, so it is also a road-block anchor
const line = (kind: GroundKind): Array<[number, number, GroundKind]> => [
  [C - 1, C, kind],
  [C, C, kind],
  [C + 1, C, kind],
];
const roadLine = (): Array<[number, number, GroundKind]> => {
  const cells: Array<[number, number, GroundKind]> = [];
  for (let bx = C - ROAD_BLOCK; bx <= C + ROAD_BLOCK; bx += ROAD_BLOCK) {
    for (let dz = 0; dz < ROAD_BLOCK; dz += 1) for (let dx = 0; dx < ROAD_BLOCK; dx += 1) cells.push([bx + dx, C + dz, 'road']);
  }
  return cells;
};

/** Edge icons (hedge, fences) share one frame, so the tall fence visibly towers over the low one. */
const FENCE_FRAME = new THREE.Box3(
  new THREE.Vector3(-0.5 * CELL_SIZE, 0, -0.05 * CELL_SIZE),
  new THREE.Vector3(0.5 * CELL_SIZE, 0.52 * CELL_SIZE, 0.05 * CELL_SIZE),
);
/** The hedge is much thicker than a fence: same height scale, room for its depth. */
const HEDGE_FRAME = new THREE.Box3(
  new THREE.Vector3(-0.5 * CELL_SIZE, 0, -0.18 * CELL_SIZE),
  new THREE.Vector3(0.5 * CELL_SIZE, 0.52 * CELL_SIZE, 0.18 * CELL_SIZE),
);

function sceneForTool(toolId: string): IconScene | null {
  switch (toolId) {
    case 'road':
      return { ground: roadLine(), clipToCentre: true, roadBlock: true };
    case 'zebra-crossing':
      // The zebra is the middle block of a short straight road (the tile draws the marking).
      return { ground: roadLine(), object: 'zebra-crossing', clipToCentre: true, roadBlock: true };
    case 'walkway':
      return { ground: line(toolId), clipToCentre: true };
    case 'pavement':
    case 'grass':
      return { ground: [[C, C, toolId]] };
    case 'meadow': {
      // The clump is hashed per cell: use the first cell from the centre that grows flowers.
      let x = C;
      while (meadowScatterModel({ x, z: C }) !== 'meadow-flowers') x += 1;
      return { ground: [[x, C, 'meadow']] };
    }
    case 'hedge':
      return { edge: toolId, frame: HEDGE_FRAME };
    case 'fence-low':
    case 'fence-tall':
      return { edge: toolId, frame: FENCE_FRAME };
    default: {
      if (!Object.prototype.hasOwnProperty.call(OBJECTS, toolId)) return null;
      const kind = toolId as ObjectKind;
      const def = objectDef(kind);
      // A road feature stands on road: pave its footprint so the fake town is a valid one.
      const ground = def.roadFeature
        ? footprintCells({ x: C, z: C }, def.footprint, 0).map((c): [number, number, GroundKind] => [c.x, c.z, 'road'])
        : undefined;
      return { object: kind, ground };
    }
  }
}

class FakeTown implements TownStateReader {
  readonly width = PLOT_WIDTH;
  readonly depth = PLOT_DEPTH;
  private readonly ground = new Map<string, GroundKind>();
  private readonly objectList: PlacedObject[] = [];
  private readonly edgeList: PlacedEdge[] = [];

  constructor(scene: IconScene) {
    for (const [x, z, kind] of scene.ground ?? []) this.ground.set(cellKey({ x, z }), kind);
    // One id for every model, so a tree's hashed yaw and size match between its tool and variant icons.
    if (scene.object) this.objectList.push({ id: 7, kind: scene.object, anchor: { x: C, z: C }, rotation: 0, variant: scene.variant ?? 0 });
    if (scene.edge) this.edgeList.push({ kind: scene.edge, edge: { x: C, z: C, side: 'n' } });
  }
  inBounds(cell: Cell): boolean {
    return cell.x >= 0 && cell.z >= 0 && cell.x < this.width && cell.z < this.depth;
  }
  getGround(cell: Cell): GroundKind {
    return this.ground.get(cellKey(cell)) ?? 'field';
  }
  getObjectAt(cell: Cell): PlacedObject | undefined {
    return this.objectList.find((o) =>
      footprintCells(o.anchor, objectDef(o.kind).footprint, o.rotation).some((c) => c.x === cell.x && c.z === cell.z),
    );
  }
  getObject(id: number): PlacedObject | undefined {
    return this.objectList.find((o) => o.id === id);
  }
  getEdge(edge: Edge): PlacedEdge | undefined {
    return this.edgeList.find((e) => e.edge.x === edge.x && e.edge.z === edge.z && e.edge.side === edge.side);
  }
  objects(): Iterable<PlacedObject> {
    return this.objectList;
  }
  edges(): Iterable<PlacedEdge> {
    return this.edgeList;
  }
  stats(): TownStats {
    return { homes: 0, residents: 0, amenities: 0, trees: 0, roadTiles: 0, props: 0, fences: this.edgeList.length };
  }
}

const ABOVE_GROUND = new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 100, 100));
const NO_BUS = { on: () => () => {} } as unknown as GameBus;

/** Every tool icon plus one per extra model of a multi-model tool, as { icon path: PNG data URL }. */
export async function renderToolIcons(size = 128, supersample = 2): Promise<Record<string, string>> {
  const library = new ModelLibrary();
  await library.loadAll();
  const px = size * supersample;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(px, px, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const context = out.getContext('2d')!;
  context.imageSmoothingQuality = 'high';

  const result: Record<string, string> = {};
  const jobs: Array<{ path: string; spec: IconScene }> = [];
  for (const tool of TOOLS) {
    const spec = sceneForTool(tool.id);
    if (!spec) continue;
    jobs.push({ path: tool.icon, spec });
    const models = spec.object ? objectDef(spec.object).variants : 1;
    for (let n = 1; n < models; n++) jobs.push({ path: variantIcon(tool.id, n), spec: { ...spec, variant: n } });
  }
  for (const { path, spec } of jobs) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity + 0.35));
    const sun = new THREE.DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity * 0.9);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const town = new FakeTown(spec);
    const townRenderer = new TownRenderer(scene, library, town, NO_BUS);
    townRenderer.rebuildAll();
    const anchor = { x: C, z: C };
    const world = spec.roadBlock
      ? roadBlockCentreWorld(anchor)
      : spec.object
      ? footprintCentreWorld(anchor, objectDef(spec.object).footprint, 0)
      : cellToWorld(anchor);
    townRenderer.root.position.set(-world.x, 0, -world.z);
    if (spec.edge) townRenderer.root.position.z += CELL_SIZE / 2; // the fence sits on the cell's north edge
    scene.updateMatrixWorld(true);

    const half = (spec.roadBlock ? ROAD_TILE_SIZE : CELL_SIZE) / 2;
    const clip = new THREE.Box3(new THREE.Vector3(-half, -1, -half), new THREE.Vector3(half, 3, half));
    // Nothing below the ground shows in game (e.g. the bush's buried trunk), so clip it here too.
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    renderer.clippingPlanes = spec.clipToCentre
      ? [
          ground,
          new THREE.Plane(new THREE.Vector3(1, 0, 0), half),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), half),
          new THREE.Plane(new THREE.Vector3(0, 0, 1), half),
          new THREE.Plane(new THREE.Vector3(0, 0, -1), half),
        ]
      : [ground];
    let bounds = spec.frame ?? instancedBounds(townRenderer.root);
    if (spec.clipToCentre) bounds = bounds.clone().intersect(clip);
    else bounds = bounds.clone().intersect(ABOVE_GROUND);

    const camera = framedCamera(bounds);
    renderer.render(scene, camera);
    context.clearRect(0, 0, size, size);
    context.drawImage(canvas, 0, 0, size, size);
    result[path] = out.toDataURL('image/png');
    townRenderer.dispose();
  }
  renderer.dispose();
  library.dispose();
  return result;
}

function instancedBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const instance = new THREE.Matrix4();
  const part = new THREE.Box3();
  root.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || !mesh.visible) return;
    mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, instance);
      instance.premultiply(mesh.matrixWorld);
      part.copy(mesh.geometry.boundingBox!).applyMatrix4(instance);
      box.union(part);
    }
  });
  return box;
}

/** Orthographic 3/4 camera (front-right, 30° up) fitted to `bounds` with a margin. */
function framedCamera(bounds: THREE.Box3): THREE.OrthographicCamera {
  const azimuth = THREE.MathUtils.degToRad(35);
  const elevation = THREE.MathUtils.degToRad(30);
  const direction = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );
  const target = bounds.getCenter(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  camera.position.copy(target).addScaledVector(direction, 10);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  // Extent of the 8 corners in view space.
  const view = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i += 1) {
    corner.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
    view.expandByPoint(corner.applyMatrix4(camera.matrixWorldInverse));
  }
  const half = (Math.max(view.max.x - view.min.x, view.max.y - view.min.y) / 2) * 1.12;
  const cx = (view.max.x + view.min.x) / 2;
  const cy = (view.max.y + view.min.y) / 2;
  camera.left = cx - half;
  camera.right = cx + half;
  camera.top = cy + half;
  camera.bottom = cy - half;
  camera.updateProjectionMatrix();
  return camera;
}
