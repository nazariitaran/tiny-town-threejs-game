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
 *    Burst guard: when more than BURST_EVENTS town:changed events or BURST_CHANGES changes
 *    arrive within one frame (scripted test states and sample towns, which WP-02's applyBatch
 *    sends as ONE big 'edit'; undo of a huge stroke), everything settles instantly, so
 *    screenshots taken right after setState() never catch half-grown instances even while paused.
 *    Anything arriving in the same frame after a 'reset'/'load' (setState = reset + build) is
 *    also drawn without animation.
 *    Object ids are reused after reset/load (TownState.clear): removes free the old visual before
 *    the add with the same id, and addObject() defensively frees any visual under that id.
 *  - Variants: PlacedObject.variant picks from ObjectDef.models; trees get a stable scale/yaw
 *    jitter from hash(id) (never the RNG, so it survives reloads). ObjectDef.height stretches a
 *    tree's Y on top of that (pine ×2); the crown width is unchanged.
 *  - Ground: road auto-tiles per 2 × 2 road BLOCK (WP-12: one tile per block, owned by the block's
 *    anchor cell and drawn at the block centre; the other 3 cells draw nothing; roadTiles.ts; a lone
 *    tile = two squashed round caps); pavement = kit
 *    tile; grass/meadow = slightly raised lawn slab with a soft darker lip; meadow adds a
 *    deterministic flower/tuft scatter, one clump per cell (hidden under objects); walkway = a half-cell-wide sandstone
 *    paving hub + an arm towards every walkway/pavement neighbour (procedural slabs).
 *  - Look overrides (MODEL_STYLES, M1 review): the roads atlas's periwinkle kerb/paving texels are
 *    re-tinted to warm stone (one recoloured atlas copy shared by all road pieces); the tall fence is
 *    cream and 1.8× taller, the low fence dark wood; the lamppost is dark iron and stouter.
 */
import * as THREE from 'three';
import { EDGE_MODELS, GROUND_MODELS, ROAD_PIECE_MODELS, ZEBRA_PIECE_MODELS, type ModelId } from '../catalog/models';
import { heightScale, objectDef } from '../catalog/objects';
import { CELL_SIZE, cellToWorld, edgeToWorld, ROAD_TILE_SIZE, roadBlockCentreWorld } from '../game/config';
import type { DebugTools } from '../debug/DebugTools';
import type { GameBus } from '../game/events';
import { cellKey, edgeKey, footprintCells, NEIGHBOURS, ROAD_BLOCK, roadBlockAnchor, rotatedFootprint } from '../town/grid';
import type { Cell, GroundKind, PlacedEdge, PlacedObject, TownChange, TownStateReader } from '../town/types';
import { InstancePool, type PoolSlot } from './InstancePool';
import type { ModelLibrary } from './ModelLibrary';
import { roadMask, roadTileFor, underRoadFeature } from './roadTiles';
import { easeOutBack, easeOutBackPeak, easeShrink, hash01 } from './tween';

const QUARTER = Math.PI / 2;
/** More town:changed events than this in one frame ⇒ scripted batch ⇒ no animation. */
const BURST_EVENTS = 24;
/** More changes than this in one frame ⇒ scripted batch / huge undo ⇒ no animation. */
const BURST_CHANGES = 64;
/** Lawn slab (grass/meadow) top height; matches the road/pavement tile tops (y = 0.02). */
const LAWN_HEIGHT = 0.016;
/** Side (lip) shade of the lawn slab relative to its top. */
const LAWN_LIP_SHADE = 0.86;
/** Garden path (walkway): paving width (half a cell so it reads as a path, not a fence). */
const WALKWAY_WIDTH = 0.5 * CELL_SIZE;
const WALKWAY_HEIGHT = 0.016;
const WALKWAY_LIP_SHADE = 0.78;
/**
 * Per-model look overrides (M1 review). `color` replaces the atlas colour (map dropped): the Kenney
 * roads atlas pavement is periwinkle, the composed tall fence is the same brown as the low one.
 * `scale` is a non-uniform local scale (fences must stay exactly one cell long, so only Y grows).
 */
export interface ModelStyle {
  color?: string;
  /** Warm the atlas's light periwinkle texels (kerb, paving, lane paint) to cream-grey stone. */
  warmAtlas?: boolean;
  scale?: readonly [number, number, number];
}
/** Warm-stone multipliers applied to a light periwinkle texel's luminance (M1 review). */
const WARM_STONE: readonly [number, number, number] = [1.17, 1.15, 1.1];
export const MODEL_STYLES: Readonly<Partial<Record<ModelId, ModelStyle>>> = {
  // WP-12: the tile is scaled 0.5 to one cell; doubling Y keeps its top at the road kerb (y = 0.02).
  'pavement-tile': { warmAtlas: true, scale: [1, 2, 1] },
  'road-straight': { warmAtlas: true },
  'road-corner': { warmAtlas: true },
  'road-tee': { warmAtlas: true },
  'road-cross': { warmAtlas: true },
  'road-end': { warmAtlas: true },
  'road-single': { warmAtlas: true },
  'road-crossing': { warmAtlas: true },
  'road-tee-zebra': { warmAtlas: true },
  'road-cross-zebra': { warmAtlas: true },
  // WP-12: fences are 0.5 long (scale 0.5); Y restores a readable height: ≈ 1.65 m / 0.8 m at toy scale.
  'fence-tall': { color: '#f2eadb', scale: [1, 1.8, 1] },
  'fence-low': { color: '#9a6a42', scale: [1, 1.4, 1] },
  // v0.3: the hedge is 0.5 long; a little longer so neighbouring runs close up at corners.
  hedge: { scale: [1.12, 1, 1] },
  // v0.3: the oak canopy squashed into a low round shrub (the model's offset sinks the trunk).
  bush: { scale: [1, 0.58, 1] },
  // The roundabout is a road tile: same warm stone kerbs as the other road pieces.
  roundabout: { warmAtlas: true },
  // Thin grey hook → darker, slightly stouter iron lamp that reads against the field.
  lamppost: { color: '#46505e', scale: [1.5, 1, 1.15] },
};
/** Edge-layer models (their pools go on the edge layer). */
const EDGE_MODEL_IDS: ReadonlySet<string> = new Set(Object.values(EDGE_MODELS));

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
  /** Road markings (zebra crossings) on the town: no visual of their own, the road tile draws them. */
  private readonly markingIds = new Set<number>();
  private readonly edgesByKey = new Map<string, Visual>();
  /** Visuals currently popping in or shrinking out (shrinking ones are in no map). */
  private readonly animating = new Set<Visual>();
  private readonly pools = new Map<string, InstancePool>();
  private readonly modelSources = new Map<ModelId, PieceSource>();
  private readonly lawnSources = new Map<string, PieceSource>();
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly warmMaterials = new Map<THREE.Material, THREE.Material>();
  private readonly off: () => void;
  private eventsThisFrame = 0;
  private changesThisFrame = 0;
  /** A 'reset'/'load' happened this frame: whatever follows in the same frame is a scripted rebuild. */
  private quietFrame = false;
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
    this.markingIds.clear();
    for (let z = 0; z < this.town.depth; z += 1) for (let x = 0; x < this.town.width; x += 1) this.refreshGround({ x, z }, false);
    for (const object of this.town.objects()) this.addObject(object, false);
    for (const placed of this.town.edges()) this.addEdge(placed, false);
    this.flush();
  }

  /**
   * What is actually drawn (NOT derived from TownState), so tests can compare the two.
   * objects/groundTiles/edges count live visuals (not ones shrinking out, see `dying`).
   * drawCallsEstimate = the town's share of the MAIN pass (one call per non-empty pool), the same
   * pass three's renderer.info.render.calls counts (info is reset after the shadow pass, so shadow
   * draws never show up there). renderer.calls = drawCallsEstimate + non-town meshes (terrain, sky,
   * decor, ghost, fx). shadowCallsEstimate = extra shadow-pass calls from shadow-casting pools.
   */
  getDiagnostics(): {
    objects: number;
    groundTiles: number;
    edges: number;
    instances: number;
    pools: number;
    drawCallsEstimate: number;
    shadowCallsEstimate: number;
    trianglesEstimate: number;
    animating: number;
    dying: number;
    materials: number;
  } {
    let instances = 0;
    let pools = 0;
    let drawCalls = 0;
    let shadowCalls = 0;
    let triangles = 0;
    for (const pool of this.pools.values()) {
      if (pool.count === 0) continue;
      instances += pool.count;
      pools += 1;
      drawCalls += 1;
      if (pool.castShadow) shadowCalls += 1;
      triangles += pool.count * pool.trianglesPerInstance;
    }
    let dying = 0;
    for (const visual of this.animating) if (visual.mode === 'out') dying += 1;
    return {
      objects: this.objectsById.size + this.markingIds.size,
      groundTiles: this.groundByCell.size,
      edges: this.edgesByKey.size,
      instances,
      pools,
      drawCallsEstimate: drawCalls,
      shadowCallsEstimate: shadowCalls,
      trianglesEstimate: triangles,
      animating: this.animating.size,
      dying,
      materials: this.library.materialCount + this.ownedMaterials.length,
    };
  }

  /** Per-frame animation hook. delta 0 (reduced motion) settles every tween immediately. */
  update(delta: number): void {
    this.eventsThisFrame = 0;
    this.changesThisFrame = 0;
    this.quietFrame = false;
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
    for (const material of this.ownedMaterials) {
      this.library.glow.unregister(material);
      material.dispose();
    }
    for (const texture of this.ownedTextures) texture.dispose();
    this.groundByCell.clear();
    this.objectsById.clear();
    this.markingIds.clear();
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
    if (cause === 'load' || cause === 'reset') this.quietFrame = true;
    let animate = this.tuning.animate && !this.quietFrame;
    this.eventsThisFrame += 1;
    this.changesThisFrame += changes.length;
    if (this.eventsThisFrame > BURST_EVENTS || this.changesThisFrame > BURST_CHANGES) {
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
      // Road tiles belong to block anchors: re-tile this block and the 4 neighbouring blocks.
      const anchor = roadBlockAnchor(cell);
      touchedCells.set(cellKey(anchor), anchor);
      for (const offset of NEIGHBOURS) {
        const neighbour = { x: anchor.x + offset.x * ROAD_BLOCK, z: anchor.z + offset.z * ROAD_BLOCK };
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
        // Meadow scatter hides under objects: refresh the covered cells. A road feature also hides
        // the road tiles under it and changes how the neighbouring road blocks join up.
        const def = objectDef(change.object.kind);
        for (const cell of footprintCells(change.object.anchor, def.footprint, change.object.rotation)) {
          if (!this.town.inBounds(cell)) continue;
          touchedCells.set(cellKey(cell), cell);
          if (def.roadFeature) touch(cell);
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
    // A road block draws one tile, owned by its anchor (min corner) cell; the other cells draw nothing,
    // and nor does a block under a road feature (the roundabout model draws the road there).
    const roadFiller = kind === 'road' && (cell.x % ROAD_BLOCK !== 0 || cell.z % ROAD_BLOCK !== 0 || underRoadFeature(this.town, cell));
    const spec = kind === 'field' || roadFiller ? null : this.describeGround(kind, cell);
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
    const world = kind === 'road' ? roadBlockCentreWorld(cell) : cellToWorld(cell);
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
      // A zebra crossing on this block (straight / tee / cross) swaps in the marked piece.
      const marking = this.town.getObjectAt(cell);
      const zebra = marking && objectDef(marking.kind).roadMarking ? ZEBRA_PIECE_MODELS[tile.piece] : undefined;
      if (zebra) {
        return {
          sig: `road:${tile.piece}:${tile.rotation}:zebra`,
          rotation: tile.rotation,
          pieces: [{ source: this.modelSource(zebra, false), local: new THREE.Matrix4() }],
        };
      }
      if (tile.piece === 'single') {
        // Isolated road: two round dead-end caps squashed to half a cell each, back to back, so a
        // lone tile matches the rounded ends of every other dead end (road-square looked like a slab).
        const end = this.modelSource(ROAD_PIECE_MODELS.end, false);
        const north = new THREE.Matrix4().makeTranslation(0, 0, -0.25 * ROAD_TILE_SIZE).multiply(new THREE.Matrix4().makeScale(1, 1, 0.5));
        const south = new THREE.Matrix4().makeRotationY(Math.PI).multiply(north);
        return { sig: 'road:single:0', rotation: 0, pieces: [{ source: end, local: north }, { source: end, local: south }] };
      }
      return {
        sig: `road:${tile.piece}:${tile.rotation}`,
        rotation: tile.rotation,
        pieces: [{ source: this.modelSource(ROAD_PIECE_MODELS[tile.piece], false), local: new THREE.Matrix4() }],
      };
    }
    if (kind === 'walkway') return this.describeWalkway(cell);
    const visual = GROUND_MODELS[kind];
    if (visual.type === 'model') {
      const style = MODEL_STYLES[visual.model]?.scale;
      const local = style ? new THREE.Matrix4().makeScale(style[0], style[1], style[2]) : new THREE.Matrix4();
      return { sig: kind, rotation: 0, pieces: [{ source: this.modelSource(visual.model, false), local }] };
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
    // A lone walkway still reads as a short path (north–south) rather than a square pad.
    const arms = mask === 0 ? 0b0101 : mask;
    const color = GROUND_MODELS.walkway.type === 'flat' ? GROUND_MODELS.walkway.color : '#c9b99a';
    const hub = this.slabSource('walkway-hub', color, WALKWAY_WIDTH, WALKWAY_HEIGHT, WALKWAY_WIDTH, WALKWAY_LIP_SHADE);
    const armLength = (CELL_SIZE - WALKWAY_WIDTH) / 2;
    const arm = this.slabSource('walkway-arm', color, WALKWAY_WIDTH, WALKWAY_HEIGHT, armLength, WALKWAY_LIP_SHADE);
    const pieces: PieceSpec[] = [{ source: hub, local: new THREE.Matrix4() }];
    // Arms run along Z, from the hub edge to the cell edge, towards each connected neighbour (N, E, S, W).
    const reach = WALKWAY_WIDTH / 2 + armLength / 2;
    NEIGHBOURS.forEach((offset, i) => {
      if (!(arms & (1 << i))) return;
      const local = new THREE.Matrix4().makeRotationY(offset.x !== 0 ? QUARTER : 0);
      local.setPosition(offset.x * reach, 0, offset.z * reach);
      pieces.push({ source: arm, local });
    });
    return { sig: `walkway:${arms}`, rotation: 0, pieces };
  }

  /** WP-12: one hashed clump per (half-unit) cell, so the density per area matches v0.1's 4 per unit cell. */
  private meadowScatter(cell: Cell): PieceSpec[] {
    const pick = hash01(cell.x, cell.z, 1);
    const model: ModelId = pick < 0.45 ? 'meadow-flowers' : pick < 0.72 ? 'meadow-flowers-tall' : 'grass-tuft';
    const x = (hash01(cell.x, cell.z, 2) - 0.5) * 0.36 * CELL_SIZE;
    const z = (hash01(cell.x, cell.z, 3) - 0.5) * 0.36 * CELL_SIZE;
    const yaw = hash01(cell.x, cell.z, 4) * Math.PI * 2;
    const scale = 0.8 + hash01(cell.x, cell.z, 5) * 0.4;
    const local = new THREE.Matrix4().makeRotationY(yaw).scale(new THREE.Vector3(scale, scale, scale));
    local.setPosition(x, LAWN_HEIGHT, z);
    return [{ source: this.modelSource(model, false), local }];
  }

  // ---------------------------------------------------------------------------------------------
  // Objects and edges

  private addObject(placed: PlacedObject, animate: boolean): void {
    this.removeObject(placed.id, false);
    const def = objectDef(placed.kind);
    if (def.roadMarking) {
      // Drawn by the road tile under it (describeGround), re-tiled by the caller.
      this.markingIds.add(placed.id);
      return;
    }
    const model = def.models[placed.variant % def.models.length];
    // Centre of the rotated footprint.
    const cells = footprintCells(placed.anchor, def.footprint, placed.rotation);
    const [w, d] = rotatedFootprint(def.footprint, placed.rotation);
    const first = cellToWorld(cells[0]);
    const origin = new THREE.Matrix4().makeRotationY(placed.rotation * QUARTER);
    if (def.group === 'tree' || def.group === 'plant') {
      // Stable per-tree jitter (survives reloads): any yaw, ±12% size. ObjectDef.height stretches Y
      // only, so a tall tree keeps its crown inside its one cell.
      const yaw = hash01(placed.id, 11) * Math.PI * 2;
      const scale = 0.88 + hash01(placed.id, 12) * 0.24;
      origin.makeRotationY(yaw).scale(new THREE.Vector3(scale, scale * heightScale(def), scale));
    }
    origin.setPosition(first.x + ((w - 1) * CELL_SIZE) / 2, 0, first.z + ((d - 1) * CELL_SIZE) / 2);
    const style = MODEL_STYLES[model]?.scale;
    const local = style ? new THREE.Matrix4().makeScale(style[0], style[1], style[2]) : new THREE.Matrix4();
    const visual = this.createVisual(`object:${model}`, origin, [{ source: this.modelSource(model, true), local }], animate);
    this.objectsById.set(placed.id, visual);
  }

  private removeObject(id: number, animate: boolean): void {
    this.markingIds.delete(id);
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
    const scale = MODEL_STYLES[model]?.scale;
    const local = scale ? new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]) : new THREE.Matrix4();
    const visual = this.createVisual(`edge:${model}`, origin, [{ source: this.modelSource(model, true), local }], animate);
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
      const layer = source.castShadow ? (EDGE_MODEL_IDS.has(source.key) ? this.edgeLayer : this.objectLayer) : this.groundLayer;
      pool = new InstancePool(key, geometry, material, layer, source.castShadow, source.triangles[part] ?? 0);
      this.pools.set(key, pool);
    }
    return pool;
  }

  private modelSource(id: ModelId, castShadow: boolean): PieceSource {
    let source = this.modelSources.get(id);
    if (!source) {
      const template = this.library.get(id);
      const style = MODEL_STYLES[id];
      const parts = style?.warmAtlas
        ? template.parts.map((part) => ({ geometry: part.geometry, material: this.warmAtlasMaterial(part.material) }))
        : style?.color
        ? template.parts.map((part) => {
            // Private recoloured clone (one per styled model, shared by all its instances).
            const material = part.material.clone() as THREE.MeshStandardMaterial;
            material.map = null;
            material.color.set(style.color!);
            material.name = `${part.material.name}:style:${id}`;
            material.needsUpdate = true;
            this.ownedMaterials.push(material);
            // WP-16: clone() keeps a glow clone's emissiveMap (the lamppost's lamp face; its UVs
            // remain although the map is dropped), so the style clone joins the night intensity updates.
            this.library.glow.register(material);
            return { geometry: part.geometry, material };
          })
        : template.parts;
      source = {
        key: id,
        parts,
        castShadow,
        triangles: template.parts.map((p) => (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count) / 3),
      };
      this.modelSources.set(id, source);
    }
    return source;
  }

  /** Procedural lawn slab: 1×1 top at LAWN_HEIGHT, softly darker lip so painted lawns read against the field. */
  private lawnSource(kind: string, color: string): PieceSource {
    return this.slabSource(`lawn-${kind}`, color, CELL_SIZE, LAWN_HEIGHT, CELL_SIZE, LAWN_LIP_SHADE);
  }

  /** A flat box (base on y = 0) with vertex-colour shading: top 1, sides `lipShade`. Cached by key. */
  private slabSource(key: string, color: string, width: number, height: number, depth: number, lipShade: number): PieceSource {
    let source = this.lawnSources.get(key);
    if (!source) {
      const geometry = new THREE.BoxGeometry(width, height, depth).translate(0, height / 2, 0);
      geometry.name = `slab:${key}`;
      const normals = geometry.getAttribute('normal');
      const colors = new Float32Array(normals.count * 3);
      for (let i = 0; i < normals.count; i += 1) {
        const shade = normals.getY(i) > 0.5 ? 1 : lipShade;
        colors[i * 3] = shade;
        colors[i * 3 + 1] = shade;
        colors[i * 3 + 2] = shade;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.ownedGeometries.push(geometry);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 1, vertexColors: true });
      material.name = `slab:${key}`;
      this.ownedMaterials.push(material);
      source = { key, parts: [{ geometry, material }], castShadow: false, triangles: [12] };
      this.lawnSources.set(key, source);
    }
    return source;
  }

  /**
   * A clone of `base` whose colour atlas has its light periwinkle texels (blue ≫ red, luminance > 130:
   * kerbs, paving, lane paint) re-tinted to warm stone at the same luminance. Dark blue-grey asphalt
   * and every saturated colour are untouched. Cached per base material, so all road pieces still share
   * one material + one texture.
   */
  private warmAtlasMaterial(base: THREE.Material): THREE.Material {
    const cached = this.warmMaterials.get(base);
    if (cached) return cached;
    const source = (base as THREE.MeshStandardMaterial).map;
    const image = source?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!source || !image || typeof document === 'undefined') return base;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return base;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = 0.3 * r + 0.59 * g + 0.11 * b;
      if (b - r < 20 || b - g < 10 || luminance < 130) continue;
      data[i] = Math.min(255, luminance * WARM_STONE[0]);
      data[i + 1] = Math.min(255, luminance * WARM_STONE[1]);
      data[i + 2] = Math.min(255, luminance * WARM_STONE[2]);
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = source.flipY;
    texture.colorSpace = source.colorSpace;
    texture.anisotropy = source.anisotropy;
    texture.wrapS = source.wrapS;
    texture.wrapT = source.wrapT;
    texture.magFilter = source.magFilter;
    texture.minFilter = source.minFilter;
    this.ownedTextures.push(texture);
    const material = base.clone() as THREE.MeshStandardMaterial;
    material.map = texture;
    material.name = `${base.name}:warm`;
    this.ownedMaterials.push(material);
    this.warmMaterials.set(base, material);
    return material;
  }

  private ready(): boolean {
    return this.library.has('road-straight');
  }
}
