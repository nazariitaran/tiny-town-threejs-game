/**
 * Draws the town from TownState, incrementally, driven by 'town:changed'. WP-03 (Rendering).
 *
 *  - Everything is drawn through InstancedMesh pools keyed by (model, part) — see InstancePool.
 *    A "visual" (one ground tile, object or fence) owns one pool slot per part of each of its
 *    pieces; it never owns a mesh. Draw calls scale with distinct (model, part)s, not with cells.
 *  - Incremental: only changed cells, their 4 neighbours (road / walkway re-tiling, meadow scatter
 *    hidden under objects), changed objects and changed edges are touched. A cell whose visual
 *    signature did not change is left alone.
 *  - Pop-in on add (0 → 1.08 → 1, easeOutBack), shrink-out on remove. No animation for cause
 *    'load'/'reset', for neighbour re-tiles, or while reduced motion is on (update(0) settles).
 *    Burst guard: when more than BURST_EVENTS town:changed events arrive within one frame
 *    (scripted test states, sample towns), everything settles instantly, so screenshots taken
 *    right after setState() never catch half-grown instances even while paused.
 *  - Variants: PlacedObject.variant picks from ObjectDef.models; trees get a stable scale/yaw
 *    jitter from hash(id) (never the RNG, so it survives reloads).
 *  - Ground: road auto-tiles (roadTiles.ts); pavement = kit tile; grass/meadow = slightly raised
 *    lawn slab with a darker lip; meadow adds a deterministic flower/tuft scatter (hidden under
 *    objects); walkway = hub + an arm towards every walkway/pavement neighbour.
 */
import * as THREE from 'three';
import { EDGE_MODELS, GROUND_MODELS, ROAD_PIECE_MODELS, type ModelId } from '../catalog/models';
import { objectDef } from '../catalog/objects';
import { CELL_SIZE, cellToWorld, edgeToWorld } from '../game/config';
import type { DebugTools } from '../debug/DebugTools';
import type { GameBus } from '../game/events';
import { cellKey, edgeKey, footprintCells, NEIGHBOURS, rotatedFootprint } from '../town/grid';
import type { Cell, GroundKind, PlacedEdge, PlacedObject, TownChange, TownStateReader } from '../town/types';
import { InstancePool, type PoolSlot } from './InstancePool';
import type { ModelLibrary } from './ModelLibrary';
import { roadMask, roadTileFor } from './roadTiles';
import { easeOutBack, easeOutBackPeak, easeShrink, hash01 } from './tween';

const QUARTER = Math.PI / 2;
/** More town:changed events than this in one frame ⇒ scripted batch ⇒ no animation. */
const BURST_EVENTS = 24;
/** Lawn slab (grass/meadow) top height; matches the road/pavement tile tops (y = 0.02). */
const LAWN_HEIGHT = 0.02;
/** Side (lip) shade of the lawn slab relative to its top. */
const LAWN_LIP_SHADE = 0.72;
const TREE_KINDS = new Set(['tree-a', 'tree-b', 'tree-c']);

/** Something that can be instanced: a model's merged parts or a procedural tile. */
interface PieceSource {
  key: string;
  parts: ReadonlyArray<{ geometry: THREE.BufferGeometry; material: THREE.Material }>;
  castShadow: boolean;
  triangles: number[];
}

interface PieceSpec {
  source: PieceSource;
  /** Transform relative to the visual's origin. */
  local: THREE.Matrix4;
}

interface Piece extends PieceSpec {
  slots: PoolSlot[];
}

type AnimMode = 'idle' | 'in' | 'out';

interface Visual {
  /** Identity of what is drawn (e.g. "road:corner:1"); equal signature ⇒ nothing to redraw. */
  sig: string;
  origin: THREE.Matrix4;
  pieces: Piece[];
  mode: AnimMode;
  /** Seconds into the current animation. */
  t: number;
  /** Scale when a shrink-out started (a pop-in can be interrupted). */
  from: number;
  scale: number;
}

export interface RenderTuning {
  popInSeconds: number;
  shrinkOutSeconds: number;
  /** easeOutBack c1: 1.5 ⇒ peak 1.08. */
  overshoot: number;
  animate: boolean;
}

export class TownRenderer {
  readonly root = new THREE.Group();
  readonly tuning: RenderTuning = { popInSeconds: 0.22, shrinkOutSeconds: 0.15, overshoot: 1.5, animate: true };
  private readonly groundLayer = new THREE.Group();
  private readonly objectLayer = new THREE.Group();
  private readonly edgeLayer = new THREE.Group();
  private readonly groundByCell = new Map<string, Visual>();
  private readonly objectsById = new Map<number, Visual>();
  private readonly edgesByKey = new Map<string, Visual>();
  /** Visuals currently popping in or shrinking out (shrinking ones are in no map). */
  private readonly animating = new Set<Visual>();
  private readonly pools = new Map<string, InstancePool>();
  private readonly modelSources = new Map<ModelId, PieceSource>();
  private readonly lawnSources = new Map<string, PieceSource>();
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly off: () => void;
  private eventsThisFrame = 0;
  private pendingRebuild = false;
  // Scratch (no per-frame allocations).
  private readonly scratch = new THREE.Matrix4();
  private readonly scaleMatrix = new THREE.Matrix4();

  constructor(
    scene: THREE.Scene,
    private readonly library: ModelLibrary,
    private readonly town: TownStateReader,
    bus: GameBus,
    debug?: DebugTools,
  ) {
    this.root.name = 'town';
    this.groundLayer.name = 'town-ground';
    this.objectLayer.name = 'town-objects';
    this.edgeLayer.name = 'town-edges';
    this.root.add(this.groundLayer, this.objectLayer, this.edgeLayer);
    scene.add(this.root);
    this.off = bus.on('town:changed', ({ changes, cause }) => this.applyChanges(changes, cause));
    const folder = debug?.folder('Render');
    if (folder) {
      folder.add(this.tuning, 'animate');
      folder.add(this.tuning, 'popInSeconds', 0.05, 1, 0.01);
      folder.add(this.tuning, 'shrinkOutSeconds', 0.05, 1, 0.01);
      folder.add(this.tuning, 'overshoot', 0, 3, 0.05).name('overshoot c1 (1.5 ⇒ 1.08)');
    }
  }

  /** Full rebuild from state (after load). Never animates. */
  rebuildAll(): void {
    if (!this.ready()) {
      this.pendingRebuild = true;
      return;
    }
    this.pendingRebuild = false;
    for (const visual of this.animating) if (visual.mode === 'out') this.freeVisual(visual);
    this.animating.clear();
    for (const map of [this.groundByCell, this.objectsById, this.edgesByKey] as Array<Map<unknown, Visual>>) {
      for (const visual of map.values()) this.freeVisual(visual);
      map.clear();
    }
    for (let z = 0; z < this.town.depth; z += 1) for (let x = 0; x < this.town.width; x += 1) this.refreshGround({ x, z }, false);
    for (const object of this.town.objects()) this.addObject(object, false);
    for (const placed of this.town.edges()) this.addEdge(placed, false);
    this.flush();
  }

  /**
   * What is actually drawn (NOT derived from TownState), so tests can compare the two.
   * objects/groundTiles/edges count live visuals (not ones shrinking out, see `dying`).
   */
  getDiagnostics(): {
    objects: number;
    groundTiles: number;
    edges: number;
    instances: number;
    pools: number;
    drawCallsEstimate: number;
    trianglesEstimate: number;
    animating: number;
    dying: number;
    materials: number;
  } {
    let instances = 0;
    let pools = 0;
    let drawCalls = 0;
    let triangles = 0;
    for (const pool of this.pools.values()) {
      if (pool.count === 0) continue;
      instances += pool.count;
      pools += 1;
      drawCalls += pool.castShadow ? 2 : 1;
      triangles += pool.count * pool.trianglesPerInstance;
    }
    let dying = 0;
    for (const visual of this.animating) if (visual.mode === 'out') dying += 1;
    return {
      objects: this.objectsById.size,
      groundTiles: this.groundByCell.size,
      edges: this.edgesByKey.size,
      instances,
      pools,
      drawCallsEstimate: drawCalls,
      trianglesEstimate: triangles,
      animating: this.animating.size,
      dying,
      materials: this.library.materialCount + this.ownedMaterials.length,
    };
  }

  /** Per-frame animation hook. delta 0 (reduced motion) settles every tween immediately. */
  update(delta: number): void {
    this.eventsThisFrame = 0;
    if (this.pendingRebuild && this.ready()) this.rebuildAll();
    if (this.animating.size === 0) return;
    if (delta <= 0 || !this.tuning.animate) {
      this.settle();
      return;
    }
    const { popInSeconds, shrinkOutSeconds, overshoot } = this.tuning;
    for (const visual of this.animating) {
      visual.t += delta;
      if (visual.mode === 'in') {
        const u = visual.t / popInSeconds;
        if (u >= 1) {
          this.finishPopIn(visual);
          continue;
        }
        this.writeVisual(visual, easeOutBack(u, overshoot));
      } else {
        const u = visual.t / shrinkOutSeconds;
        if (u >= 1) {
          this.freeVisual(visual);
          this.animating.delete(visual);
          continue;
        }
        this.writeVisual(visual, visual.from * easeShrink(u));
      }
    }
    this.flush();
  }

  /** Finish every running pop-in/shrink-out now (screenshots, reduced motion, scripted batches). */
  settle(): void {
    for (const visual of this.animating) {
      if (visual.mode === 'in') this.finishPopIn(visual);
      else this.freeVisual(visual);
    }
    this.animating.clear();
    this.flush();
  }

  /** Peak pop-in scale for the current tuning (debug/diagnostics). */
  get popPeak(): number {
    return easeOutBackPeak(this.tuning.overshoot);
  }

  dispose(): void {
    this.off();
    this.root.removeFromParent();
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.groundByCell.clear();
    this.objectsById.clear();
    this.edgesByKey.clear();
    this.animating.clear();
  }

  // ---------------------------------------------------------------------------------------------
  // Change handling

  private applyChanges(changes: readonly TownChange[], cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset'): void {
    if (!this.ready()) {
      this.pendingRebuild = true;
      return;
    }
    let animate = this.tuning.animate && cause !== 'load' && cause !== 'reset';
    this.eventsThisFrame += 1;
    if (this.eventsThisFrame > BURST_EVENTS) {
      if (this.animating.size > 0) this.settle();
      animate = false;
    }

    // Cells whose own ground changed (animate), and neighbours that may need re-tiling (don't).
    const changedCells = new Map<string, Cell>();
    const touchedCells = new Map<string, Cell>();
    const touch = (cell: Cell) => {
      for (const offset of NEIGHBOURS) {
        const neighbour = { x: cell.x + offset.x, z: cell.z + offset.z };
        if (this.town.inBounds(neighbour)) touchedCells.set(cellKey(neighbour), neighbour);
      }
    };
    for (const change of changes) {
      if (change.layer === 'ground') {
        changedCells.set(cellKey(change.cell), change.cell);
        touch(change.cell);
      } else if (change.layer === 'object') {
        if (change.op === 'add') this.addObject(change.object, animate);
        else this.removeObject(change.object.id, animate);
        // Meadow scatter hides under objects: refresh the covered cells.
        const def = objectDef(change.object.kind);
        for (const cell of footprintCells(change.object.anchor, def.footprint, change.object.rotation)) {
          if (this.town.inBounds(cell)) touchedCells.set(cellKey(cell), cell);
        }
      } else if (change.op === 'add') this.addEdge(change.placed, animate);
      else this.removeEdge(change.placed, animate);
    }
    for (const [key, cell] of changedCells) {
      touchedCells.delete(key);
      this.refreshGround(cell, animate);
    }
    for (const cell of touchedCells.values()) this.refreshGround(cell, false);
    this.flush();
  }

  // ---------------------------------------------------------------------------------------------
  // Ground

  private refreshGround(cell: Cell, animate: boolean): void {
    const key = cellKey(cell);
    const current = this.groundByCell.get(key);
    const kind = this.town.getGround(cell);
    const spec = kind === 'field' ? null : this.describeGround(kind, cell);
    if (current && spec && current.sig === spec.sig) return;
    const kindChanged = !current || !spec || current.sig.split(':')[0] !== spec.sig.split(':')[0];

    let inherit: Visual | null = null;
    if (current) {
      this.groundByCell.delete(key);
      if (animate && kindChanged) this.retire(current);
      else {
        // Re-tile (same kind, new shape): swap instantly but keep any running pop-in going.
        inherit = current.mode === 'in' ? current : null;
        this.animating.delete(current);
        this.freeVisual(current);
      }
    }
    if (!spec) return;
    const world = cellToWorld(cell);
    const origin = new THREE.Matrix4().makeRotationY(spec.rotation * QUARTER).setPosition(world.x, 0, world.z);
    const visual = this.createVisual(spec.sig, origin, spec.pieces, animate && kindChanged);
    if (inherit) {
      visual.mode = 'in';
      visual.t = inherit.t;
      this.animating.add(visual);
      this.writeVisual(visual, inherit.scale);
    }
    this.groundByCell.set(key, visual);
  }

  private describeGround(kind: Exclude<GroundKind, 'field'>, cell: Cell): { sig: string; rotation: number; pieces: PieceSpec[] } {
    if (kind === 'road') {
      const tile = roadTileFor(roadMask(this.town, cell));
      return {
        sig: `road:${tile.piece}:${tile.rotation}`,
        rotation: tile.rotation,
        pieces: [{ source: this.modelSource(ROAD_PIECE_MODELS[tile.piece], false), local: new THREE.Matrix4() }],
      };
    }
    if (kind === 'walkway') return this.describeWalkway(cell);
    const visual = GROUND_MODELS[kind];
    if (visual.type === 'model') {
      return { sig: kind, rotation: 0, pieces: [{ source: this.modelSource(visual.model, false), local: new THREE.Matrix4() }] };
    }
    const pieces: PieceSpec[] = [{ source: this.lawnSource(kind, visual.color), local: new THREE.Matrix4() }];
    if (kind !== 'meadow') return { sig: kind, rotation: 0, pieces };
    // Meadow: deterministic scatter per cell, hidden when an object stands here.
    const occupied = this.town.getObjectAt(cell) !== undefined;
    if (!occupied) pieces.push(...this.meadowScatter(cell));
    return { sig: `meadow:${occupied ? 'covered' : 'open'}`, rotation: 0, pieces };
  }

  private describeWalkway(cell: Cell): { sig: string; rotation: number; pieces: PieceSpec[] } {
    let mask = 0;
    NEIGHBOURS.forEach((offset, i) => {
      const ground = this.town.getGround({ x: cell.x + offset.x, z: cell.z + offset.z });
      if (ground === 'walkway' || ground === 'pavement') mask |= 1 << i;
    });
    // A lone walkway still reads as a short path (north–south) rather than a tiny slab.
    const arms = mask === 0 ? 0b0101 : mask;
    const hub = this.modelSource('walkway-hub', false);
    const arm = this.modelSource('walkway-arm', false);
    const pieces: PieceSpec[] = [{ source: hub, local: new THREE.Matrix4() }];
    // Arms are 0.5 long along Z, centred: push each 0.25 towards its neighbour (N, E, S, W).
    NEIGHBOURS.forEach((offset, i) => {
      if (!(arms & (1 << i))) return;
      const local = new THREE.Matrix4().makeRotationY(offset.x !== 0 ? QUARTER : 0);
      local.setPosition(offset.x * 0.25 * CELL_SIZE, 0, offset.z * 0.25 * CELL_SIZE);
      pieces.push({ source: arm, local });
    });
    return { sig: `walkway:${arms}`, rotation: 0, pieces };
  }

  private meadowScatter(cell: Cell): PieceSpec[] {
    const pieces: PieceSpec[] = [];
    const quarter = CELL_SIZE / 4;
    for (let k = 0; k < 4; k += 1) {
      const pick = hash01(cell.x, cell.z, k * 7 + 1);
      const model: ModelId = pick < 0.45 ? 'meadow-flowers' : pick < 0.72 ? 'meadow-flowers-tall' : 'grass-tuft';
      const x = (k % 2 === 0 ? -quarter : quarter) + (hash01(cell.x, cell.z, k * 7 + 2) - 0.5) * 0.18;
      const z = (k < 2 ? -quarter : quarter) + (hash01(cell.x, cell.z, k * 7 + 3) - 0.5) * 0.18;
      const yaw = hash01(cell.x, cell.z, k * 7 + 4) * Math.PI * 2;
      const scale = 0.8 + hash01(cell.x, cell.z, k * 7 + 5) * 0.4;
      const local = new THREE.Matrix4().makeRotationY(yaw).scale(new THREE.Vector3(scale, scale, scale));
      local.setPosition(x, LAWN_HEIGHT, z);
      pieces.push({ source: this.modelSource(model, false), local });
    }
    return pieces;
  }

  // ---------------------------------------------------------------------------------------------
  // Objects and edges

  private addObject(placed: PlacedObject, animate: boolean): void {
    this.removeObject(placed.id, false);
    const def = objectDef(placed.kind);
    const model = def.models[placed.variant % def.models.length];
    // Centre of the rotated footprint.
    const cells = footprintCells(placed.anchor, def.footprint, placed.rotation);
    const [w, d] = rotatedFootprint(def.footprint, placed.rotation);
    const first = cellToWorld(cells[0]);
    const origin = new THREE.Matrix4().makeRotationY(placed.rotation * QUARTER);
    if (TREE_KINDS.has(placed.kind)) {
      // Stable per-tree jitter (survives reloads): any yaw, ±12% size.
      const yaw = hash01(placed.id, 11) * Math.PI * 2;
      const scale = 0.88 + hash01(placed.id, 12) * 0.24;
      origin.makeRotationY(yaw).scale(new THREE.Vector3(scale, scale, scale));
    }
    origin.setPosition(first.x + ((w - 1) * CELL_SIZE) / 2, 0, first.z + ((d - 1) * CELL_SIZE) / 2);
    const visual = this.createVisual(`object:${model}`, origin, [{ source: this.modelSource(model, true), local: new THREE.Matrix4() }], animate);
    this.objectsById.set(placed.id, visual);
  }

  private removeObject(id: number, animate: boolean): void {
    const visual = this.objectsById.get(id);
    if (!visual) return;
    this.objectsById.delete(id);
    if (animate) this.retire(visual);
    else {
      this.animating.delete(visual);
      this.freeVisual(visual);
    }
  }

  private addEdge(placed: PlacedEdge, animate: boolean): void {
    const key = edgeKey(placed.edge);
    this.removeEdgeByKey(key, false);
    const world = edgeToWorld(placed.edge);
    const origin = new THREE.Matrix4().makeRotationY(world.alongX ? 0 : QUARTER).setPosition(world.x, 0, world.z);
    const model = EDGE_MODELS[placed.kind];
    const visual = this.createVisual(`edge:${model}`, origin, [{ source: this.modelSource(model, true), local: new THREE.Matrix4() }], animate);
    this.edgesByKey.set(key, visual);
  }

  private removeEdge(placed: PlacedEdge, animate: boolean): void {
    this.removeEdgeByKey(edgeKey(placed.edge), animate);
  }

  private removeEdgeByKey(key: string, animate: boolean): void {
    const visual = this.edgesByKey.get(key);
    if (!visual) return;
    this.edgesByKey.delete(key);
    if (animate) this.retire(visual);
    else {
      this.animating.delete(visual);
      this.freeVisual(visual);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Visuals ↔ pools

  private createVisual(sig: string, origin: THREE.Matrix4, specs: PieceSpec[], animate: boolean): Visual {
    const visual: Visual = { sig, origin, pieces: [], mode: animate ? 'in' : 'idle', t: 0, from: 1, scale: animate ? 0 : 1 };
    for (const spec of specs) {
      const piece: Piece = { ...spec, slots: [] };
      this.composeInto(this.scratch, origin, visual.scale, spec.local);
      spec.source.parts.forEach((part, i) => {
        piece.slots.push(this.pool(spec.source, i, part.geometry, part.material).add(this.scratch));
      });
      visual.pieces.push(piece);
    }
    if (animate) this.animating.add(visual);
    return visual;
  }

  /** Start a shrink-out; the visual's slots are freed when it finishes. */
  private retire(visual: Visual): void {
    visual.from = visual.scale;
    visual.mode = 'out';
    visual.t = 0;
    this.animating.add(visual);
  }

  private finishPopIn(visual: Visual): void {
    visual.mode = 'idle';
    this.animating.delete(visual);
    this.writeVisual(visual, 1);
  }

  private freeVisual(visual: Visual): void {
    for (const piece of visual.pieces) for (const slot of piece.slots) slot.pool.remove(slot);
    visual.pieces.length = 0;
  }

  private writeVisual(visual: Visual, scale: number): void {
    visual.scale = scale;
    for (const piece of visual.pieces) {
      this.composeInto(this.scratch, visual.origin, scale, piece.local);
      for (const slot of piece.slots) slot.pool.set(slot, this.scratch);
    }
  }

  /** out = origin · S(scale) · local */
  private composeInto(out: THREE.Matrix4, origin: THREE.Matrix4, scale: number, local: THREE.Matrix4): void {
    if (scale === 1) {
      out.multiplyMatrices(origin, local);
      return;
    }
    const s = Math.max(scale, 1e-4);
    this.scaleMatrix.makeScale(s, s, s);
    out.multiplyMatrices(origin, this.scaleMatrix).multiply(local);
  }

  private flush(): void {
    for (const pool of this.pools.values()) pool.flush();
  }

  private pool(source: PieceSource, part: number, geometry: THREE.BufferGeometry, material: THREE.Material): InstancePool {
    const key = `${source.key}#${part}`;
    let pool = this.pools.get(key);
    if (!pool) {
      const layer = source.castShadow ? (source.key.startsWith('fence') ? this.edgeLayer : this.objectLayer) : this.groundLayer;
      pool = new InstancePool(key, geometry, material, layer, source.castShadow, source.triangles[part] ?? 0);
      this.pools.set(key, pool);
    }
    return pool;
  }

  private modelSource(id: ModelId, castShadow: boolean): PieceSource {
    let source = this.modelSources.get(id);
    if (!source) {
      const template = this.library.get(id);
      source = {
        key: id,
        parts: template.parts,
        castShadow,
        triangles: template.parts.map((p) => (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count) / 3),
      };
      this.modelSources.set(id, source);
    }
    return source;
  }

  /** Procedural lawn slab: 1×1 top at LAWN_HEIGHT, darker vertical lip so painted lawns read against the field. */
  private lawnSource(kind: string, color: string): PieceSource {
    let source = this.lawnSources.get(kind);
    if (!source) {
      let geometry = this.ownedGeometries.find((g) => g.name === 'lawn-slab');
      if (!geometry) {
        geometry = new THREE.BoxGeometry(CELL_SIZE, LAWN_HEIGHT, CELL_SIZE).translate(0, LAWN_HEIGHT / 2, 0);
        geometry.name = 'lawn-slab';
        const normals = geometry.getAttribute('normal');
        const colors = new Float32Array(normals.count * 3);
        for (let i = 0; i < normals.count; i += 1) {
          const shade = normals.getY(i) > 0.5 ? 1 : LAWN_LIP_SHADE;
          colors.set([shade, shade, shade], i * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.ownedGeometries.push(geometry);
      }
      const material = new THREE.MeshStandardMaterial({ color, roughness: 1, vertexColors: true });
      material.name = `lawn:${kind}`;
      this.ownedMaterials.push(material);
      source = { key: `lawn-${kind}`, parts: [{ geometry, material }], castShadow: false, triangles: [12] };
      this.lawnSources.set(kind, source);
    }
    return source;
  }

  private ready(): boolean {
    return this.library.has('road-straight');
  }
}
