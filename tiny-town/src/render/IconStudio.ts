/**
 * Offline icon renderer (WP-03). NOT imported by the game: `scripts/render-icons.mjs` loads it in a
 * browser through the dev server and writes the PNGs to public/assets/icons/.
 *
 * Every icon is drawn through the real in-game pipeline — ModelLibrary + TownRenderer on a tiny fake
 * town — so MODEL_STYLES, the warmed roads atlas, the procedural walkway/lawn slabs and the catalog
 * scales/offsets all match what the player places. Same 3/4 angle (front-right, 30° elevation),
 * orthographic, transparent background, the game's sun/hemisphere colours and tone mapping.
 */
import * as THREE from 'three';
import { objectDef } from '../catalog/objects';
import { TOOLS } from '../catalog/tools';
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import type { GameBus } from '../game/events';
import { cellKey, footprintCells } from '../town/grid';
import type { Cell, Edge, EdgeKind, GroundKind, ObjectKind, PlacedEdge, PlacedObject, TownStateReader, TownStats } from '../town/types';
import { LIGHTING } from '../world/Environment';
import { ModelLibrary } from './ModelLibrary';
import { TownRenderer } from './TownRenderer';

/** What to build for one icon: ground cells, objects, fences, and the cell the camera frames. */
interface IconScene {
  ground?: Array<[number, number, GroundKind]>;
  object?: ObjectKind;
  edge?: EdgeKind;
  /** Clip everything to this cell (roads/walkways continue out of frame instead of capping). */
  clipToCentre?: boolean;
  /** Frame with a shared box instead of the scene's own bounds (keeps fence heights comparable). */
  frame?: THREE.Box3;
}

const C = 12; // centre cell (x and z)
const line = (kind: GroundKind): Array<[number, number, GroundKind]> => [
  [C - 1, C, kind],
  [C, C, kind],
  [C + 1, C, kind],
];

/** Fence icons share one frame, so the tall fence visibly towers over the low one. */
const FENCE_FRAME = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.05), new THREE.Vector3(0.5, 0.36, 0.05));

function sceneForTool(toolId: string): IconScene | null {
  switch (toolId) {
    case 'road':
    case 'walkway':
      return { ground: line(toolId), clipToCentre: true };
    case 'pavement':
    case 'grass':
    case 'meadow':
      return { ground: [[C, C, toolId]] };
    case 'fence-tall':
    case 'fence-small':
      return { edge: toolId, frame: FENCE_FRAME };
    case 'bus-stop':
      return { object: 'bus-stop' };
    default:
      return toolId in OBJECT_TOOLS ? { object: toolId as ObjectKind } : null;
  }
}
const OBJECT_TOOLS: Record<string, true> = {
  'tree-a': true, 'tree-b': true, 'tree-c': true, 'townhouse-a': true, 'townhouse-b': true,
  'townhouse-c': true, garage: true, postbox: true, lamppost: true,
};

class FakeTown implements TownStateReader {
  readonly width = PLOT_WIDTH;
  readonly depth = PLOT_DEPTH;
  private readonly ground = new Map<string, GroundKind>();
  private readonly objectList: PlacedObject[] = [];
  private readonly edgeList: PlacedEdge[] = [];

  constructor(scene: IconScene) {
    for (const [x, z, kind] of scene.ground ?? []) this.ground.set(cellKey({ x, z }), kind);
    if (scene.object) this.objectList.push({ id: 7, kind: scene.object, anchor: { x: C, z: C }, rotation: 0, variant: 0 });
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
    return { homes: 0, residents: 0, trees: 0, roadTiles: 0, props: 0, fences: this.edgeList.length };
  }
}

const NO_BUS = { on: () => () => {} } as unknown as GameBus;

/** Render every tool icon; returns { '/assets/icons/<id>.png': 'data:image/png;base64,…' }. */
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
  for (const tool of TOOLS) {
    const spec = sceneForTool(tool.id);
    if (!spec) continue;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity + 0.35));
    const sun = new THREE.DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity * 0.9);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const town = new FakeTown(spec);
    const townRenderer = new TownRenderer(scene, library, town, NO_BUS);
    townRenderer.rebuildAll();
    // Recentre on the framed cell.
    const centre = new THREE.Vector3((C - PLOT_WIDTH / 2 + 0.5), 0, (C - PLOT_DEPTH / 2 + 0.5));
    townRenderer.root.position.sub(centre);
    if (spec.edge) townRenderer.root.position.z += 0.5; // the fence sits on the cell's north edge
    scene.updateMatrixWorld(true);

    const clip = new THREE.Box3(new THREE.Vector3(-0.5, -1, -0.5), new THREE.Vector3(0.5, 3, 0.5));
    renderer.clippingPlanes = spec.clipToCentre
      ? [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), 0.5),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.5),
          new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.5),
          new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.5),
        ]
      : [];
    let bounds = spec.frame ?? instancedBounds(townRenderer.root);
    if (spec.clipToCentre) bounds = bounds.clone().intersect(clip);

    const camera = framedCamera(bounds);
    renderer.render(scene, camera);
    context.clearRect(0, 0, size, size);
    context.drawImage(canvas, 0, 0, size, size);
    result[tool.icon] = out.toDataURL('image/png');
    townRenderer.dispose();
  }
  renderer.dispose();
  library.dispose();
  return result;
}

/** World-space bounds of every instance drawn under `root`. */
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
