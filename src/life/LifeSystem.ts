/**
 * Draws TrafficSim's cars: the four Car Kit models share one atlas material in one BatchedMesh with
 * MAX_CARS pre-allocated instances, so the cost is 1 draw call + 1 shadow draw call whatever the count.
 * At night the traffic thins and the head/tail lights glow through the `headlights` emissive mask.
 * Cars in a car park are the same instances: a parked car keeps its lamps (one material for the batch)
 * but casts no beam.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { litMaterial, type LitMaterial, type MaterialMode } from '../render/materials';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DebugTools } from '../debug/DebugTools';
import { assetUrl, worldToCell } from '../game/config';
import { ROAD_BLOCK } from '../town/grid';
import type { GameBus } from '../game/events';
import type { TownStateReader } from '../town/types';
import { createGlowMask, DEFAULT_GLOW_TUNING, glowIntensity } from '../render/nightGlow';
import { CAR_MODELS, MAX_CARS, TrafficSim, type Car, type CarPhase } from './TrafficSim';

/** Car Kit files in model-index order (TrafficSim picks 0..CAR_MODELS-1). */
export const CAR_FILES = ['sedan', 'hatchback-sports', 'van', 'taxi'] as const;
/** Kenney Car Kit → world units: 0.255 wide × 0.43–0.48 long, fits one 0.37 lane. */
export const CAR_SCALE = 0.17;
/** Car Kit models already face +Z (headlights at +Z, tail lights at −Z), which is our forward. */
const FRONT_ROTATION = 0;
/** Road / pavement tile top. */
export const ROAD_TOP_Y = 0.02;
const POP_IN_S = 0.32;
/** Visual heading smoothing (1/s); polyline headings step a few degrees per sample. */
const YAW_FOLLOW = 18;
/** On a lot route the car passes centimetres from kerbs and parked cars: almost no lag. */
const YAW_FOLLOW_LOT = 60;
/** The shadow map keeps redrawing this long after the last car moved, came or went (its yaw and pop-in settle). */
const SHADOW_SETTLE_S = 0.5;

export interface LifeDiagnostics {
  loaded: boolean;
  cars: number;
  target: number;
  drivableCells: number;
  spawned: number;
  despawned: number;
  waiting: number;
  /** Cars standing in a car-park stall. */
  parked: number;
  /** Cars driving into or out of a car park. */
  manoeuvring: number;
  /** Main-pass draw calls, what renderer.calls counts: three resets renderer.info after the shadow pass. */
  drawCalls: number;
  /** Not included in renderer.calls; 0 while every car stands parked (their shadows stay in the map). */
  shadowDrawCalls: number;
  /** Each car's fine cell (a road cell, or a car-park cell for a car in a lot), world position (px, pz) and phase. */
  carCells: Array<{ id: number; x: number; z: number; px: number; pz: number; phase: CarPhase; lot: number; stall: number }>;
}

/** A drawn car's pose for the headlight beams; written in place by carPose(). */
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
  /** Headlight beam on the ground (off while parked). */
  beam: boolean;
}

/** Traffic density is 1 − NIGHT_TRAFFIC_DROP · night. */
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
  /** Seconds of shadow redraws still owed since a car last moved, appeared or left. */
  private shadowSettle = 0;
  /** Bonnet distance (+Z half-length) per car model, from the normalised geometry. */
  private readonly frontZ: number[] = [];
  private readonly geometryIds: number[] = [];
  private readonly visuals = new Map<number, CarVisual>();
  private readonly freeSlots: number[] = [];
  private readonly unsubscribe: Array<() => void> = [];
  /** lil-gui `Life` folder. */
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
    parked: 0,
    manoeuvring: 0,
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
    private readonly materialMode: MaterialMode = 'standard',
  ) {
    this.sim = new TrafficSim(town, rng);
    this.sim.onRemove = (car) => this.releaseVisual(car);
    this.unsubscribe.push(bus.on('town:changed', ({ changes, cause }) => this.sim.onTownChanged(changes, cause)));
    const folder = debug?.folder('Life');
    if (folder) {
      folder.add(this.tuning, 'visible').name('cars visible').onChange(() => {
        this.shadowSettle = SHADOW_SETTLE_S;
        this.sync(0);
      });
      folder.add(this.sim.parking, 'parkChance', 0, 1, 0.05).name('park chance');
      folder.add(this.sim.parking, 'dwellMin', 0, 60, 1).name('parked min s');
      folder.add(this.sim.parking, 'dwellMax', 0, 120, 1).name('parked max s');
      folder.add(this.sim.parking, 'parkedShare', 0, 1, 0.05).name('parked share');
    }
    this.publish();
  }

  /** Cars simulate before this resolves but aren't drawn. */
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
    // Lambert on the Low preset.
    const shared = litMaterial(material as THREE.Material, this.materialMode) as LitMaterial;
    if (shared.map) {
      shared.map.colorSpace = THREE.SRGBColorSpace;
      shared.map.anisotropy = 8;
      shared.map.needsUpdate = true;
    }
    shared.side = THREE.FrontSide;
    // Head/tail lights: intensity follows setNight, 0 by day.
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

  /** animDelta 0 freezes cars and finishes any pop-in. */
  update(animDelta: number): void {
    if (animDelta <= 0) this.settle();
    else this.sim.step(Math.min(animDelta, 0.1));
    this.shadowSettle = Math.max(0, this.shadowSettle - animDelta);
    this.sync(animDelta);
  }

  /** 0 day .. 1 full night: fewer cars (newest leave first) and head/tail lights. Called every frame. */
  setNight(night: number): void {
    const n = Math.min(1, Math.max(0, Number.isFinite(night) ? night : 0));
    this.night = n;
    const before = this.sim.cars.length;
    this.sim.setDensity(1 - NIGHT_TRAFFIC_DROP * n);
    if (this.material) (this.material as LitMaterial).emissiveIntensity = glowIntensity('headlights', n, this.headlightTuning);
    // Draw the new car set at once (test hooks render without an update while paused).
    if (this.sim.cars.length !== before) this.sync(0);
  }

  /** Set by NightLights (lil-gui `Night lights`). */
  readonly headlightTuning = { ...DEFAULT_GLOW_TUNING };

  /** Drawn or not. */
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
    out.beam = car.phase !== 'parked';
    return true;
  }

  /** Finishes pop-ins and snaps headings. */
  settle(): void {
    for (const car of this.sim.cars) car.age = Math.max(car.age, POP_IN_S);
    for (const car of this.sim.cars) {
      const visual = this.visuals.get(car.id);
      if (visual) visual.yaw = Math.atan2(car.hx, car.hz);
    }
    this.sync(0);
  }

  /** Cars' shadows may be changing: false once every car has stood parked for a moment, so a still town draws no shadow pass. */
  get castsShadows(): boolean {
    return this.mesh !== null && this.mesh.castShadow && this.tuning.visible && this.shadowSettle > 0;
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
      (this.material as LitMaterial).map?.dispose();
      this.material.dispose();
    }
    this.glowMask?.dispose();
    this.glowMask = null;
    this.mesh = null;
    this.material = null;
    this.visuals.clear();
  }

  /** Allocates and releases BatchedMesh slots as cars come and go. */
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
          this.shadowSettle = SHADOW_SETTLE_S;
          mesh.setGeometryIdAt(slot, this.geometryIds[car.model % CAR_MODELS]);
        }
        if (car.phase !== 'parked' || car.age < POP_IN_S) this.shadowSettle = SHADOW_SETTLE_S;
        const targetYaw = Math.atan2(car.hx, car.hz);
        if (dt > 0) {
          let delta = targetYaw - visual.yaw;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          const onRoad = car.phase === 'drive' || car.phase === 'approach';
          visual.yaw += delta * Math.min(1, dt * (onRoad ? YAW_FOLLOW : YAW_FOLLOW_LOT));
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
    this.shadowSettle = SHADOW_SETTLE_S;
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
    d.parked = stats.parked;
    d.manoeuvring = stats.manoeuvring;
    const drawn = this.mesh !== null && this.tuning.visible && stats.cars > 0;
    d.drawCalls = drawn ? 1 : 0;
    d.shadowDrawCalls = drawn && this.castsShadows ? 1 : 0;
    const cells = d.carCells;
    cells.length = this.sim.cars.length;
    this.sim.cars.forEach((car, i) => {
      const entry = cells[i] ?? (cells[i] = { id: 0, x: 0, z: 0, px: 0, pz: 0, phase: 'drive', lot: 0, stall: 0 });
      entry.id = car.id;
      entry.phase = car.phase;
      entry.lot = car.lot;
      entry.stall = car.lot === 0 ? 0 : car.stall;
      // The fine (0.5) cell under the car: inside its 2 × 2 road block (car.cx/cz are block coords) on the
      // road, the cell itself on a lot route (car.cx/cz are then the lot's front block).
      worldToCell(car.x, car.z, this.carCell);
      const onRoad = car.phase === 'drive' || car.phase === 'approach';
      entry.x = onRoad ? Math.min(Math.max(this.carCell.x, car.cx * ROAD_BLOCK), car.cx * ROAD_BLOCK + ROAD_BLOCK - 1) : this.carCell.x;
      entry.z = onRoad ? Math.min(Math.max(this.carCell.z, car.cz * ROAD_BLOCK), car.cz * ROAD_BLOCK + ROAD_BLOCK - 1) : this.carCell.z;
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
