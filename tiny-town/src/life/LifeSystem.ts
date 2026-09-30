/**
 * WP-10 (Ambient life) — cars wandering the road network.
 *
 * Owns: src/life/**. Logic lives in TrafficSim (pure, unit-tested); this class only loads the car
 * models, listens to town:changed and draws the cars.
 *
 * Rendering: ONE THREE.BatchedMesh holds the four Kenney Car Kit models (sedan, hatchback, van,
 * taxi; all share Textures/colormap.png, so one material) with MAX_CARS pre-allocated instances.
 * Cost: 1 draw call + 1 shadow-map draw call, whatever the car count (renderer.calls counts
 * only the main pass: three resets renderer.info after rendering the shadow map).
 * Cars sit on the road tile top (ROAD_TOP_Y) and keep to the right-hand lane.
 *
 * Game.ts wiring (integrator; see the WP-10 hand-off):
 *   this.life = new LifeSystem(this.scene, this.town, this.bus, fxRand, this.debug);
 *   load():   await this.life.load();                       (after library.loadAll)
 *   update(): this.life.update(animDelta);                  (after townRenderer.update)
 *   applyTestState / setReducedMotion(true): this.life.settle();
 *   dispose(): this.life.dispose();
 *   diagnostics: life: this.life.getDiagnostics()
 * Reduced motion (animDelta 0) freezes the cars; setPausedForScreenshot skips update entirely.
 *
 * Diagnostics are published by Game as __THREE_GAME_DIAGNOSTICS__.life (getDiagnostics()).
 *
 * Night (WP-16b): setNight(night) thins the traffic (TrafficSim.setDensity(1 − 0.5·night)) and drives
 * the car material's head/tail-light glow (the `headlights` mask of render/nightGlow.ts as its
 * emissiveMap; intensity exactly 0 by day). carPose() hands NightLights what it needs for the
 * headlight beams (position, smoothed heading, pop-in scale, bonnet distance).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DebugTools } from '../debug/DebugTools';
import { assetUrl, worldToCell } from '../game/config';
import { ROAD_BLOCK } from '../town/grid';
import type { GameBus } from '../game/events';
import type { TownStateReader } from '../town/types';
import { createGlowMask, DEFAULT_GLOW_TUNING, glowIntensity } from '../render/nightGlow';
import { CAR_MODELS, MAX_CARS, TrafficSim, type Car } from './TrafficSim';

/** Car Kit files in model-index order (TrafficSim picks 0..CAR_MODELS-1). */
export const CAR_FILES = ['sedan', 'hatchback-sports', 'van', 'taxi'] as const;
/** Kenney Car Kit → world units (WP-12: 0.255 wide × 0.43–0.48 long, fits one 0.37 lane). */
export const CAR_SCALE = 0.17;
/**
 * Car Kit models already face +Z natively (yellow headlights and the raked windscreen at +Z, red
 * tail lights at −Z; re-measured from UVs for WP-16), which is our "forward": no turn. Until WP-16b
 * this was π and every car drove backwards.
 */
const FRONT_ROTATION = 0;
/** Road / pavement tile top (docs/PLAN.md §1). */
export const ROAD_TOP_Y = 0.02;
const POP_IN_S = 0.32;
/** Visual heading smoothing (1/s); polyline headings step a few degrees per sample. */
const YAW_FOLLOW = 18;

export interface LifeDiagnostics {
  loaded: boolean;
  cars: number;
  target: number;
  drivableCells: number;
  spawned: number;
  despawned: number;
  waiting: number;
  /**
   * Main-pass draw calls this layer adds (what diagnostics renderer.calls counts; three resets
   * renderer.info after the shadow pass), 0 when nothing is drawn.
   */
  drawCalls: number;
  /** Extra shadow-map draw calls (not included in renderer.calls). */
  shadowDrawCalls: number;
  /** Every car: fine road cell under it (tests bulldoze under a car with real input) + world position (px, pz). */
  carCells: Array<{ id: number; x: number; z: number; px: number; pz: number }>;
}

/** Where a drawn car is (NightLights' headlight beams). Written in place by carPose(). */
export interface CarPose {
  x: number;
  y: number;
  z: number;
  /** Heading as a +Y rotation (the car's +Z is its bonnet). */
  yaw: number;
  /** Pop-in scale (1 when fully grown). */
  scale: number;
  /** Distance from the car's centre to its bonnet tip, world units (already × scale). */
  front: number;
}

/** Share of the traffic that stays out at full night (plan §5: f = 1 − 0.5·night). */
export const NIGHT_TRAFFIC_DROP = 0.5;

interface CarVisual {
  slot: number;
  yaw: number;
}

export class LifeSystem {
  readonly sim: TrafficSim;
  private mesh: THREE.BatchedMesh | null = null;
  private material: THREE.Material | null = null;
  private glowMask: THREE.Texture | null = null;
  private night = 0;
  /** Bonnet distance (+Z half-length) per car model, from the normalised geometry. */
  private readonly frontZ: number[] = [];
  private readonly geometryIds: number[] = [];
  private readonly visuals = new Map<number, CarVisual>();
  private readonly freeSlots: number[] = [];
  private readonly unsubscribe: Array<() => void> = [];
  /** Debug toggle (lil-gui `Life` folder). */
  private readonly tuning = { visible: true };
  private disposed = false;
  private readonly matrix = new THREE.Matrix4();
  private readonly carCell = { x: 0, z: 0 };
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly diag: LifeDiagnostics = {
    loaded: false,
    cars: 0,
    target: 0,
    drivableCells: 0,
    spawned: 0,
    despawned: 0,
    waiting: 0,
    drawCalls: 0,
    shadowDrawCalls: 0,
    carCells: [],
  };

  constructor(
    private readonly scene: THREE.Scene,
    town: TownStateReader,
    bus: GameBus,
    rng: () => number,
    debug?: DebugTools,
  ) {
    this.sim = new TrafficSim(town, rng);
    this.sim.onRemove = (car) => this.releaseVisual(car);
    this.unsubscribe.push(bus.on('town:changed', ({ changes, cause }) => this.sim.onTownChanged(changes, cause)));
    const folder = debug?.folder('Life');
    if (folder) {
      folder.add(this.tuning, 'visible').name('cars visible').onChange(() => this.sync(0));
    }
    this.publish();
  }

  /** Load the car models (≈0.7 MB). Cars simulate before this resolves; they just aren't drawn. */
  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const gltfs = await Promise.all(CAR_FILES.map((name) => loader.loadAsync(assetUrl(`/assets/models/cars/${name}.glb`))));
    if (this.disposed) return;
    const geometries: THREE.BufferGeometry[] = [];
    let material: THREE.Material | null = null;
    const extraMaterials = new Set<THREE.Material>();
    for (const gltf of gltfs) {
      const { geometry, material: own } = normaliseCar(gltf.scene);
      geometries.push(geometry);
      this.frontZ.push(geometry.boundingBox?.max.z ?? 0.24);
      if (!material) material = own;
      else if (own !== material) extraMaterials.add(own);
    }
    // Every car shares the same atlas; keep one material, free the duplicates' textures.
    for (const extra of extraMaterials) {
      (extra as THREE.MeshStandardMaterial).map?.dispose();
      extra.dispose();
    }
    const shared = material as THREE.MeshStandardMaterial;
    if (shared.map) {
      shared.map.colorSpace = THREE.SRGBColorSpace;
      shared.map.anisotropy = 8;
      shared.map.needsUpdate = true;
    }
    shared.side = THREE.FrontSide;
    // Head/tail lights (WP-16b): glow mask as emissiveMap; intensity follows setNight (0 by day).
    this.glowMask = createGlowMask('headlights');
    shared.emissiveMap = this.glowMask;
    shared.emissive.setRGB(1, 1, 1);
    shared.emissiveIntensity = glowIntensity('headlights', this.night, DEFAULT_GLOW_TUNING);
    shared.needsUpdate = true;
    const vertexCount = geometries.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const indexCount = geometries.reduce((n, g) => n + (g.index?.count ?? 0), 0);
    const mesh = new THREE.BatchedMesh(MAX_CARS, vertexCount, indexCount, shared);
    mesh.name = 'life:cars';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // per-instance culling still applies (perObjectFrustumCulled)
    for (const geometry of geometries) {
      this.geometryIds.push(mesh.addGeometry(geometry));
      geometry.dispose(); // BatchedMesh copied the data
    }
    for (let i = 0; i < MAX_CARS; i += 1) {
      const slot = mesh.addInstance(this.geometryIds[0]);
      mesh.setVisibleAt(slot, false);
      this.freeSlots.push(slot);
    }
    this.freeSlots.reverse(); // pop() hands out slot 0 first
    this.mesh = mesh;
    this.material = shared;
    this.scene.add(mesh);
    this.diag.loaded = true;
    this.sync(0);
  }

  /** Per-frame. animDelta 0 (reduced motion) freezes cars and finishes any pop-in. */
  update(animDelta: number): void {
    if (animDelta <= 0) this.settle();
    else this.sim.step(Math.min(animDelta, 0.1));
    this.sync(animDelta);
  }

  /**
   * Day/night (WP-16): 0 day .. 1 full night. Fewer cars at night (newest leave first, they come
   * back with a pop-in at dawn) and head/tail lights. Called every frame; cheap when nothing changes.
   */
  setNight(night: number): void {
    const n = Math.min(1, Math.max(0, Number.isFinite(night) ? night : 0));
    this.night = n;
    const before = this.sim.cars.length;
    this.sim.setDensity(1 - NIGHT_TRAFFIC_DROP * n);
    if (this.material) (this.material as THREE.MeshStandardMaterial).emissiveIntensity = glowIntensity('headlights', n, this.headlightTuning);
    // Draw the new car set at once (test hooks render without an update while paused).
    if (this.sim.cars.length !== before) this.sync(0);
  }

  /** Headlight glow tunable (lil-gui `Night lights`, set by NightLights). */
  readonly headlightTuning = { ...DEFAULT_GLOW_TUNING };

  /** Cars in the simulation (drawn or not). */
  get carCount(): number {
    return this.sim.cars.length;
  }

  /** Pose of car `index` for the headlight beams; false when it isn't drawn. No allocation. */
  carPose(index: number, out: CarPose): boolean {
    const car = this.sim.cars[index];
    if (!car || !this.mesh || !this.tuning.visible) return false;
    const visual = this.visuals.get(car.id);
    const scale = car.instant ? 1 : easeOutBack(Math.min(1, car.age / POP_IN_S));
    out.x = car.x;
    out.y = ROAD_TOP_Y;
    out.z = car.z;
    out.yaw = visual ? visual.yaw : Math.atan2(car.hx, car.hz);
    out.scale = Math.max(scale, 0);
    out.front = (this.frontZ[car.model % CAR_MODELS] ?? 0.24) * out.scale;
    return true;
  }

  /** Finish pop-ins and snap headings (test states, reduced motion). */
  settle(): void {
    for (const car of this.sim.cars) car.age = Math.max(car.age, POP_IN_S);
    for (const car of this.sim.cars) {
      const visual = this.visuals.get(car.id);
      if (visual) visual.yaw = Math.atan2(car.hx, car.hz);
    }
    this.sync(0);
  }

  /** Cars are drawn into the sun's shadow map (WP-24: it refreshes at its own rate while they drive). */
  get castsShadows(): boolean {
    return this.mesh !== null && this.mesh.castShadow && this.tuning.visible && this.sim.cars.length > 0;
  }

  getDiagnostics(): LifeDiagnostics {
    return { ...this.diag, carCells: this.diag.carCells.map((c) => ({ ...c })) };
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.sim.onRemove = null;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    if (this.material) {
      (this.material as THREE.MeshStandardMaterial).map?.dispose();
      this.material.dispose();
    }
    this.glowMask?.dispose();
    this.glowMask = null;
    this.mesh = null;
    this.material = null;
    this.visuals.clear();
  }

  // ---------------------------------------------------------------------------------------

  /** Write every car's instance matrix; allocate/release BatchedMesh slots as cars come and go. */
  private sync(dt: number): void {
    const mesh = this.mesh;
    if (mesh) {
      for (const car of this.sim.cars) {
        let visual = this.visuals.get(car.id);
        if (!visual) {
          const slot = this.freeSlots.pop();
          if (slot === undefined) continue; // cannot happen: sim never exceeds MAX_CARS
          visual = { slot, yaw: Math.atan2(car.hx, car.hz) };
          this.visuals.set(car.id, visual);
          mesh.setGeometryIdAt(slot, this.geometryIds[car.model % CAR_MODELS]);
        }
        const targetYaw = Math.atan2(car.hx, car.hz);
        if (dt > 0) {
          let delta = targetYaw - visual.yaw;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          visual.yaw += delta * Math.min(1, dt * YAW_FOLLOW);
        } else if (car.age >= POP_IN_S) {
          visual.yaw = targetYaw;
        }
        const grow = car.instant ? 1 : easeOutBack(Math.min(1, car.age / POP_IN_S));
        this.position.set(car.x, ROAD_TOP_Y, car.z);
        this.quaternion.setFromAxisAngle(this.up, visual.yaw);
        this.scale.setScalar(Math.max(grow, 0.0001));
        this.matrix.compose(this.position, this.quaternion, this.scale);
        mesh.setMatrixAt(visual.slot, this.matrix);
        mesh.setVisibleAt(visual.slot, this.tuning.visible);
      }
    }
    this.publish();
  }

  private releaseVisual(car: Car): void {
    const visual = this.visuals.get(car.id);
    if (!visual) return;
    this.visuals.delete(car.id);
    this.mesh?.setVisibleAt(visual.slot, false);
    this.freeSlots.push(visual.slot);
  }

  private publish(): void {
    const stats = this.sim.stats;
    const d = this.diag;
    d.cars = stats.cars;
    d.target = stats.target;
    d.drivableCells = stats.drivableCells;
    d.spawned = stats.spawned;
    d.despawned = stats.despawned;
    d.waiting = stats.waiting;
    const drawn = this.mesh !== null && this.tuning.visible && stats.cars > 0;
    d.drawCalls = drawn ? 1 : 0;
    d.shadowDrawCalls = drawn && this.mesh!.castShadow ? 1 : 0;
    const cells = d.carCells;
    cells.length = this.sim.cars.length;
    this.sim.cars.forEach((car, i) => {
      const entry = cells[i] ?? (cells[i] = { id: 0, x: 0, z: 0, px: 0, pz: 0 });
      entry.id = car.id;
      // The fine (0.5) cell under the car, inside its 2 × 2 road block (car.cx/cz are block coords).
      worldToCell(car.x, car.z, this.carCell);
      entry.x = Math.min(Math.max(this.carCell.x, car.cx * ROAD_BLOCK), car.cx * ROAD_BLOCK + ROAD_BLOCK - 1);
      entry.z = Math.min(Math.max(this.carCell.z, car.cz * ROAD_BLOCK), car.cz * ROAD_BLOCK + ROAD_BLOCK - 1);
      entry.px = Math.round(car.x * 1000) / 1000;
      entry.pz = Math.round(car.z * 1000) / 1000;
    });
  }
}

/** Bake a Car Kit scene into one geometry: scaled, bonnet towards +Z, footprint-centred, base at y = 0. */
function normaliseCar(scene: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  const root = new THREE.Group();
  root.add(scene);
  scene.scale.setScalar(CAR_SCALE);
  scene.rotation.y = FRONT_ROTATION;
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    material ??= Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    geometry.morphAttributes = {};
    parts.push(geometry);
    mesh.geometry.dispose();
  });
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged || !material) throw new Error('[life] could not build car geometry');
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  merged.translate(-centre.x, -box.min.y, -centre.z);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return { geometry: merged, material };
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
