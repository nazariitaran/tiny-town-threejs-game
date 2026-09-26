/**
 * Draws the town from TownState, incrementally, driven by 'town:changed'.
 *
 * SCAFFOLD BASELINE — WP-03 (Rendering) owns this file. The baseline is deliberately
 * naive (one Object3D per tile/object/edge, no animation) but correct, so the vertical
 * slice works. TODO(WP-03):
 *  - InstancedMesh pools per (model, part) for ground tiles, fences and repeated objects
 *    (target: ≤ 150 draw calls for a full 24×24 town, see docs/PLAN.md budgets);
 *  - pop-in (easeOutBack ~220 ms) on add, shrink-out (~150 ms) on remove, skipped for cause 'load'/'reset';
 *  - variant tinting / tree scale jitter from PlacedObject.variant;
 *  - meadow flower scatter, ground tile blending, diagnostics counts.
 */
import * as THREE from 'three';
import { EDGE_MODELS, GROUND_MODELS, ROAD_PIECE_MODELS, type GroundVisual } from '../catalog/models';
import { objectDef } from '../catalog/objects';
import { CELL_SIZE, cellToWorld, edgeToWorld } from '../game/config';
import type { DebugTools } from '../debug/DebugTools';
import type { GameBus } from '../game/events';
import { cellKey, edgeKey, footprintCells, NEIGHBOURS, rotatedFootprint } from '../town/grid';
import type { Cell, GroundKind, PlacedEdge, PlacedObject, TownChange, TownStateReader } from '../town/types';
import type { ModelLibrary } from './ModelLibrary';
import { roadMask, roadTileFor } from './roadTiles';

const QUARTER = Math.PI / 2;

export class TownRenderer {
  readonly root = new THREE.Group();
  private readonly groundLayer = new THREE.Group();
  private readonly objectLayer = new THREE.Group();
  private readonly edgeLayer = new THREE.Group();
  private readonly groundByCell = new Map<string, THREE.Object3D>();
  private readonly objectsById = new Map<number, THREE.Object3D>();
  private readonly edgesByKey = new Map<string, THREE.Object3D>();
  private readonly flatTile = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE).rotateX(-QUARTER);
  private readonly flatMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly off: () => void;

  constructor(
    scene: THREE.Scene,
    private readonly library: ModelLibrary,
    private readonly town: TownStateReader,
    bus: GameBus,
    _debug?: DebugTools,
  ) {
    this.root.name = 'town';
    this.groundLayer.name = 'town-ground';
    this.objectLayer.name = 'town-objects';
    this.edgeLayer.name = 'town-edges';
    this.root.add(this.groundLayer, this.objectLayer, this.edgeLayer);
    scene.add(this.root);
    this.off = bus.on('town:changed', ({ changes }) => this.applyChanges(changes));
  }

  /** Full rebuild from state (after load). */
  rebuildAll(): void {
    for (const map of [this.groundByCell, this.objectsById, this.edgesByKey]) {
      for (const object of map.values()) object.removeFromParent();
      map.clear();
    }
    for (let z = 0; z < this.town.depth; z += 1) for (let x = 0; x < this.town.width; x += 1) this.refreshGround({ x, z });
    for (const object of this.town.objects()) this.addObject(object);
    for (const placed of this.town.edges()) this.addEdge(placed);
  }

  /**
   * What is actually drawn (NOT derived from TownState), so tests can compare the two.
   * WP-03: add pools / instance counts / drawCallsEstimate when instancing lands.
   */
  getDiagnostics(): { objects: number; groundTiles: number; edges: number } {
    return { objects: this.objectsById.size, groundTiles: this.groundByCell.size, edges: this.edgesByKey.size };
  }

  /** Per-frame animation hook (pop-in tweens etc.). */
  update(_delta: number): void {}

  dispose(): void {
    this.off();
    this.root.removeFromParent();
    this.flatTile.dispose();
    for (const material of this.flatMaterials.values()) material.dispose();
  }

  private applyChanges(changes: readonly TownChange[]): void {
    const dirtyGround = new Map<string, Cell>();
    for (const change of changes) {
      if (change.layer === 'ground') {
        dirtyGround.set(cellKey(change.cell), change.cell);
        if (change.before === 'road' || change.after === 'road') {
          for (const offset of NEIGHBOURS) {
            const neighbour = { x: change.cell.x + offset.x, z: change.cell.z + offset.z };
            if (this.town.inBounds(neighbour)) dirtyGround.set(cellKey(neighbour), neighbour);
          }
        }
      } else if (change.layer === 'object') {
        if (change.op === 'add') this.addObject(change.object);
        else this.removeObject(change.object.id);
      } else if (change.op === 'add') this.addEdge(change.placed);
      else this.removeEdge(change.placed);
    }
    for (const cell of dirtyGround.values()) this.refreshGround(cell);
  }

  private refreshGround(cell: Cell): void {
    const key = cellKey(cell);
    this.groundByCell.get(key)?.removeFromParent();
    this.groundByCell.delete(key);
    const kind = this.town.getGround(cell);
    if (kind === 'field') return;

    let object: THREE.Object3D;
    let rotation = 0;
    if (kind === 'road') {
      const tile = roadTileFor(roadMask(this.town, cell));
      object = this.library.createObject(ROAD_PIECE_MODELS[tile.piece]);
      rotation = tile.rotation;
    } else {
      object = this.createGroundVisual(kind, GROUND_MODELS[kind]);
    }
    const world = cellToWorld(cell);
    object.position.set(world.x, 0, world.z);
    object.rotation.y = rotation * QUARTER;
    object.name = `ground:${kind}:${key}`;
    this.groundLayer.add(object);
    this.groundByCell.set(key, object);
  }

  private createGroundVisual(kind: Exclude<GroundKind, 'field' | 'road'>, visual: GroundVisual): THREE.Object3D {
    if (visual.type === 'model') return this.library.createObject(visual.model);
    let material = this.flatMaterials.get(kind);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: visual.color, roughness: 1 });
      this.flatMaterials.set(kind, material);
    }
    const mesh = new THREE.Mesh(this.flatTile, material);
    mesh.position.y = visual.height;
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  private addObject(placed: PlacedObject): void {
    const def = objectDef(placed.kind);
    const object = this.library.createObject(def.models[placed.variant % def.models.length]);
    // Centre of the rotated footprint.
    const cells = footprintCells(placed.anchor, def.footprint, placed.rotation);
    const [w, d] = rotatedFootprint(def.footprint, placed.rotation);
    const first = cellToWorld(cells[0]);
    object.position.set(first.x + ((w - 1) * CELL_SIZE) / 2, 0, first.z + ((d - 1) * CELL_SIZE) / 2);
    object.rotation.y = placed.rotation * QUARTER;
    object.name = `object:${placed.kind}:${placed.id}`;
    this.objectLayer.add(object);
    this.objectsById.set(placed.id, object);
  }

  private removeObject(id: number): void {
    this.objectsById.get(id)?.removeFromParent();
    this.objectsById.delete(id);
  }

  private addEdge(placed: PlacedEdge): void {
    const object = this.library.createObject(EDGE_MODELS[placed.kind]);
    const world = edgeToWorld(placed.edge);
    object.position.set(world.x, 0, world.z);
    object.rotation.y = world.alongX ? 0 : QUARTER;
    object.name = `edge:${placed.kind}:${edgeKey(placed.edge)}`;
    this.edgeLayer.add(object);
    this.edgesByKey.set(edgeKey(placed.edge), object);
  }

  private removeEdge(placed: PlacedEdge): void {
    const key = edgeKey(placed.edge);
    this.edgesByKey.get(key)?.removeFromParent();
    this.edgesByKey.delete(key);
  }
}
