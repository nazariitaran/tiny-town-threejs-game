/**
 * Night light sources, faked with additive instanced quads (no real PointLights): lamp pools on the
 * ground, lamp halos, headlight beams and fireflies, one draw call each; window / lamp / lens glow
 * masks are driven through `library.glow`. On a match night the stadium's floodlights add a spill
 * pool around each lot and a halo per mast, and light the stadium itself through its material
 * (`nightGlow.applyFloodlight`). All are hidden while night < VISIBLE_FROM, so daytime draw calls and
 * pixels are unchanged.
 * The first render after populate() draws each layer once with a zero-scale instance, so the
 * programs compile at load, not at the first dusk.
 */
import * as THREE from 'three';
import type { DebugTools } from '../debug/DebugTools';
import type { GameBus } from '../game/events';
import type { CarPose, LifeSystem } from '../life/LifeSystem';
import { StadiumSites } from '../life/matchSchedule';
import { MAX_CARS } from '../life/TrafficSim';
import type { TownStateReader } from '../town/types';
import type { DaySample } from '../world/dayCycle';
import { LampRegistry, measureCellCentroid, objectPointToWorld, type Vec3Like } from './lampRegistry';
import type { ModelLibrary } from './ModelLibrary';
import { windStrength, windTime } from '../fx/windSway';
import { Fireflies, FIREFLIES_FROM } from './fireflies';
import { FLOOD_LAMPS, GLOW_CELLS, smoothstep } from './nightGlow';
import { MODEL_STYLES } from './modelStyles';

export interface NightLightsDiagnostics {
  lamps: number;
  /** Main-pass draw calls this layer adds (0 by day). */
  drawCalls: number;
  stadiums: number;
  /** 0..1: how far the stadium floodlights are on (0 except on a match night). */
  floodlights: number;
}

/** Below this `night` the ground layers are hidden (daytime draw calls +0). */
export const VISIBLE_FROM = 0.05;
/** Lamp face centre in lamppost model space if the geometry can't be measured. */
const FALLBACK_HEAD: Vec3Like = { x: 0, y: 0.653, z: 0.154 };
/** Pools sit just above the tallest flat ground (road / pavement tops at 0.02). */
const POOL_Y = 0.028;
const BEAM_Y = 0.026;
const INITIAL_LAMP_CAPACITY = 32;
const INITIAL_STADIUM_CAPACITY = 2;
/** Mast lamp centres in stadium model space if the geometry can't be measured: x, y, z per mast. */
const FALLBACK_MASTS: readonly number[] = [-3.1, 2.7, -2.35, 3.1, 2.7, -2.35, -3.1, 2.7, 2.35, 3.1, 2.7, 2.35];
/** Half the stadium lot in model space (x, z) if the model isn't loaded. */
const FALLBACK_LOT = { x: 3.45, z: 2.72 };
/** Pool / halo brightness at night = 0 relative to full night. */
const DUSK_POOL_LEVEL = 0.55;

export interface NightLightsTuning {
  /** Model-space distance the light sits out from the lamp face's centre, along the arm (towards its tip). */
  lampOutset: number;
  poolRadius: number;
  poolStrength: number;
  poolColor: string;
  haloSize: number;
  haloStrength: number;
  haloColor: string;
  beamLength: number;
  beamWidth: number;
  beamStrength: number;
  beamColor: string;
  /** How far the floodlights' spill reaches past the stadium lot (world units). */
  floodReach: number;
  floodPoolStrength: number;
  floodPoolColor: string;
  floodHaloSize: number;
  floodHaloStrength: number;
  floodHaloColor: string;
}

export const DEFAULT_NIGHT_LIGHTS_TUNING: Readonly<NightLightsTuning> = {
  // The lamp face runs 0.11–0.23 along the arm (centre 0.17), so the light sits about three quarters out.
  lampOutset: 0.03,
  poolRadius: 1.05,
  poolStrength: 0.8,
  poolColor: '#ffcc66',
  haloSize: 0.34,
  haloStrength: 0.9,
  haloColor: '#ffe2b0',
  beamLength: 0.75,
  beamWidth: 0.34,
  beamStrength: 0.5,
  beamColor: '#fff1c8',
  floodReach: 2.4,
  floodPoolStrength: 0.34,
  floodPoolColor: '#e8ecff',
  floodHaloSize: 1.15,
  floodHaloStrength: 0.85,
  floodHaloColor: '#fff6e2',
};

type LayerKind = 'pool' | 'halo' | 'beam' | 'floodPool' | 'floodHalo';

interface Layer {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  capacity: number;
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export class NightLights {
  readonly tuning: NightLightsTuning = { ...DEFAULT_NIGHT_LIGHTS_TUNING };
  private readonly diag: NightLightsDiagnostics = { lamps: 0, drawCalls: 0, stadiums: 0, floodlights: 0 };
  private readonly registry = new LampRegistry();
  /** The stadiums on the plot: floodlit here, and the crowd's distance is measured to them. */
  readonly stadiums = new StadiumSites();
  private readonly group = new THREE.Group();
  private readonly unsubscribe: Array<() => void> = [];
  private readonly layers = new Map<LayerKind, Layer>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly head: Vec3Like = { ...FALLBACK_HEAD };
  /** `head` moved `lampOutset` along the arm: where the pool and halo are centred. */
  private readonly light: Vec3Like = { ...FALLBACK_HEAD };
  /** Mast lamp centres in stadium model space (x, y, z per mast) and half its lot. */
  private readonly masts: number[] = [...FALLBACK_MASTS];
  private readonly lot = { ...FALLBACK_LOT };
  private builtStadiums = -1;
  private matchLevel = 0;
  private readonly previousBeforeRender: THREE.Object3D['onBeforeRender'];
  private fireflies: Fireflies | null = null;
  private fireflyLevel = 0;
  private populated = false;
  private builtVersion = -1;
  private warmPending = false;
  private night = 0;
  private lampLevel = 0;
  /** Halos drawn at night (GraphicsProfile.lampHalos). The layer exists either way. */
  private lampHalos = true;
  // Scratch (no per-frame allocations).
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly world: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly pose: CarPose = { x: 0, y: 0, z: 0, yaw: 0, scale: 1, front: 0, beam: true };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly library: ModelLibrary,
    private readonly town: TownStateReader,
    bus: GameBus,
    private readonly life: LifeSystem,
    debug?: DebugTools,
  ) {
    this.group.name = 'night-lights';
    this.unsubscribe.push(
      bus.on('town:changed', ({ changes, cause }) => {
        this.registry.onTownChanged(changes, cause, this.town);
        this.stadiums.onTownChanged(changes, cause, this.town);
        this.fireflies?.invalidate();
      }),
    );
    this.registry.rebuild(town);
    this.stadiums.rebuild(town);
    // Chained, so any render (the frame loop, or a test hook while paused) draws the current lamps and cars.
    this.previousBeforeRender = scene.onBeforeRender;
    scene.onBeforeRender = (...args: Parameters<THREE.Object3D['onBeforeRender']>) => {
      this.previousBeforeRender.apply(scene, args);
      this.beforeRender();
    };
    this.installDebug(debug);
    this.publish();
  }

  /** Once, after models load (measures lamp heads, builds the instanced pools). */
  populate(): void {
    if (this.populated) return;
    this.measureHead();
    this.buildLayer('pool');
    this.buildLayer('halo');
    this.buildLayer('beam');
    this.measureMasts();
    this.buildLayer('floodPool');
    this.buildLayer('floodHalo');
    this.fireflies = new Fireflies();
    this.group.add(this.fireflies.mesh);
    this.applyColors();
    this.scene.add(this.group);
    this.registry.rebuild(this.town);
    this.stadiums.rebuild(this.town);
    this.builtVersion = -1;
    this.builtStadiums = -1;
    this.populated = true;
    this.warmPending = true;
    this.publish();
  }

  /** Per frame and from test hooks: drive every light source from the day sample and the stadium's match level (0..1). */
  update(sample: Readonly<DaySample>, match = 0): void {
    this.library.glow.update(sample, match);
    this.night = this.library.glow.levels.night;
    this.lampLevel = this.library.glow.levels.lamps;
    this.matchLevel = this.library.glow.levels.match;
    // No iterators here (per frame): three direct lookups.
    // Lamps are fully on from night ≈ 0.42, but the sky is still bright then: the ground pools and
    // halos grow into full night so they don't blow out over the lighter dusk / dawn pavement.
    const dark = DUSK_POOL_LEVEL + (1 - DUSK_POOL_LEVEL) * this.night;
    this.setLevel('pool', this.lampLevel * dark);
    this.setLevel('halo', this.lampLevel * dark);
    this.setLevel('beam', this.night);
    this.setLevel('floodPool', this.matchLevel * dark);
    this.setLevel('floodHalo', this.matchLevel * dark);
    if (this.fireflies) {
      // The wind clock: frozen under reduced motion / while paused, rest pose after stabilize().
      this.fireflyLevel = smoothstep(FIREFLIES_FROM, 1, this.night);
      this.fireflies.setState(this.fireflyLevel, windTime(), windStrength());
      if (this.fireflyLevel > 0 && this.populated) this.fireflies.refresh(this.town);
    }
    this.publish();
  }

  setLampHalos(on: boolean): void {
    if (on === this.lampHalos) return;
    this.lampHalos = on;
    this.publish();
  }

  get halosEnabled(): boolean {
    return this.lampHalos;
  }

  getDiagnostics(): NightLightsDiagnostics {
    return this.diag;
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.scene.onBeforeRender = this.previousBeforeRender;
    this.group.removeFromParent();
    for (const layer of this.layers.values()) {
      layer.mesh.dispose();
      layer.material.dispose();
    }
    this.layers.clear();
    this.fireflies?.dispose();
    this.fireflies = null;
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.populated = false;
  }

  private setLevel(kind: LayerKind, level: number): void {
    const layer = this.layers.get(kind);
    if (layer) layer.material.uniforms.uLevel.value = level;
  }

  private get shown(): boolean {
    return this.populated && this.night >= VISIBLE_FROM;
  }

  private publish(): void {
    this.diag.lamps = this.registry.count;
    this.diag.stadiums = this.stadiums.count;
    this.diag.floodlights = this.matchLevel;
    let calls = 0;
    if (this.shown) {
      if (this.matchLevel > 0 && this.stadiums.count > 0) calls += this.lampHalos ? 2 : 1;
      if (this.lampLevel > 0 && this.registry.count > 0) calls += this.lampHalos && this.layers.has('halo') ? 2 : 1;
      if (this.drawnCars() > 0) calls += 1;
      if (this.fireflyLevel > 0 && (this.fireflies?.count ?? 0) > 0) calls += 1;
    }
    this.diag.drawCalls = calls;
  }

  private drawnCars(): number {
    let cars = 0;
    const n = Math.min(this.life.carCount, MAX_CARS);
    for (let i = 0; i < n; i += 1) if (this.life.carPose(i, this.pose) && this.pose.beam && this.pose.scale > 0.01) cars += 1;
    return cars;
  }

  /** Right before each render: warm-up once, else current lamps / beams and visibility. */
  private beforeRender(): void {
    if (!this.populated) return;
    if (this.warmPending) {
      this.warmPending = false;
      for (const layer of this.layers.values()) {
        layer.mesh.setMatrixAt(0, ZERO_MATRIX);
        layer.mesh.instanceMatrix.needsUpdate = true;
        layer.mesh.count = 1;
        layer.mesh.visible = true;
      }
      if (this.fireflies) {
        const mesh = this.fireflies.mesh;
        mesh.setMatrixAt(0, ZERO_MATRIX);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = 1;
        mesh.visible = true;
        this.fireflies.invalidate();
      }
      this.builtVersion = -1; // slot 0 was overwritten: rewrite the lamps next time
      this.builtStadiums = -1;
      return;
    }
    const shown = this.shown;
    const pools = this.layers.get('pool')!;
    const halos = this.layers.get('halo');
    const lampsOn = shown && this.lampLevel > 0;
    if (lampsOn && this.builtVersion !== this.registry.version) this.writeLamps();
    pools.mesh.visible = lampsOn && pools.mesh.count > 0;
    if (halos) halos.mesh.visible = this.lampHalos && lampsOn && halos.mesh.count > 0;
    const beams = this.layers.get('beam')!;
    beams.mesh.visible = shown && this.writeBeams(beams) > 0;
    const floodPools = this.layers.get('floodPool')!;
    const floodHalos = this.layers.get('floodHalo')!;
    const floodsOn = shown && this.matchLevel > 0;
    if (floodsOn && this.builtStadiums !== this.stadiums.registry.version) this.writeFloodlights();
    floodPools.mesh.visible = floodsOn && floodPools.mesh.count > 0;
    floodHalos.mesh.visible = this.lampHalos && floodsOn && floodHalos.mesh.count > 0;
    if (this.fireflies) {
      const on = shown && this.fireflyLevel > 0;
      this.fireflies.mesh.visible = on && this.fireflies.refresh(this.town) > 0;
    }
    // What this render really draws (update()'s estimate can lag while paused: cars settle after it).
    this.diag.drawCalls =
      (pools.mesh.visible ? 1 : 0) +
      (halos?.mesh.visible ? 1 : 0) +
      (beams.mesh.visible ? 1 : 0) +
      (floodPools.mesh.visible ? 1 : 0) +
      (floodHalos.mesh.visible ? 1 : 0) +
      (this.fireflies?.mesh.visible ? 1 : 0);
  }

  /** A spill pool around each stadium lot and a halo on each of its masts. */
  private writeFloodlights(): void {
    const pools = this.layers.get('floodPool')!;
    const halos = this.layers.get('floodHalo')!;
    const count = this.stadiums.count;
    this.ensureCapacity(pools, count);
    this.ensureCapacity(halos, count * FLOOD_LAMPS);
    const t = this.tuning;
    this.scale.set((this.lot.x + t.floodReach) * 2, 1, (this.lot.z + t.floodReach) * 2);
    let i = 0;
    for (const stadium of this.stadiums.registry.values()) {
      this.light.x = 0;
      this.light.y = 0;
      this.light.z = 0;
      objectPointToWorld(stadium, this.light, this.world);
      this.position.set(this.world.x, POOL_Y, this.world.z);
      this.quaternion.setFromAxisAngle(this.up, (stadium.rotation * Math.PI) / 2);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      pools.mesh.setMatrixAt(i, this.matrix);
      for (let m = 0; m < FLOOD_LAMPS; m += 1) {
        this.light.x = this.masts[m * 3];
        this.light.y = this.masts[m * 3 + 1];
        this.light.z = this.masts[m * 3 + 2];
        objectPointToWorld(stadium, this.light, this.world);
        this.matrix.makeScale(t.floodHaloSize, t.floodHaloSize, t.floodHaloSize).setPosition(this.world.x, this.world.y, this.world.z);
        halos.mesh.setMatrixAt(i * FLOOD_LAMPS + m, this.matrix);
      }
      i += 1;
    }
    pools.mesh.count = i;
    pools.mesh.instanceMatrix.needsUpdate = true;
    halos.mesh.count = i * FLOOD_LAMPS;
    halos.mesh.instanceMatrix.needsUpdate = true;
    const uniforms = pools.material.uniforms;
    (uniforms.uLot.value as THREE.Vector2).set(this.lot.x, this.lot.z);
    uniforms.uReach.value = t.floodReach;
    this.builtStadiums = this.stadiums.registry.version;
  }

  private writeLamps(): void {
    const pools = this.layers.get('pool')!;
    const halos = this.layers.get('halo');
    this.ensureCapacity(pools, this.registry.count);
    if (halos) this.ensureCapacity(halos, this.registry.count);
    const t = this.tuning;
    let i = 0;
    const arm = Math.hypot(this.head.x, this.head.z) || 1;
    this.light.x = this.head.x + (this.head.x / arm) * t.lampOutset;
    this.light.y = this.head.y;
    this.light.z = this.head.z + (this.head.z / arm) * t.lampOutset;
    for (const lamp of this.registry.values()) {
      objectPointToWorld(lamp, this.light, this.world);
      this.matrix.makeScale(t.poolRadius * 2, 1, t.poolRadius * 2).setPosition(this.world.x, POOL_Y, this.world.z);
      pools.mesh.setMatrixAt(i, this.matrix);
      if (halos) {
        this.matrix.makeScale(t.haloSize, t.haloSize, t.haloSize).setPosition(this.world.x, this.world.y - 0.015, this.world.z);
        halos.mesh.setMatrixAt(i, this.matrix);
      }
      i += 1;
    }
    pools.mesh.count = i;
    pools.mesh.instanceMatrix.needsUpdate = true;
    if (halos) {
      halos.mesh.count = i;
      halos.mesh.instanceMatrix.needsUpdate = true;
    }
    this.builtVersion = this.registry.version;
  }

  /** Beam per drawn car: at the bonnet, turned with the car, scaled by its pop-in. Returns the count. */
  private writeBeams(beams: Layer): number {
    const t = this.tuning;
    const n = Math.min(this.life.carCount, beams.capacity);
    let count = 0;
    for (let i = 0; i < n; i += 1) {
      if (!this.life.carPose(i, this.pose) || !this.pose.beam || this.pose.scale <= 0.01) continue;
      const p = this.pose;
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      this.position.set(p.x + fx * p.front * 0.92, BEAM_Y, p.z + fz * p.front * 0.92);
      this.quaternion.setFromAxisAngle(this.up, p.yaw);
      this.scale.set(t.beamWidth * p.scale, 1, t.beamLength * p.scale);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      beams.mesh.setMatrixAt(count, this.matrix);
      count += 1;
    }
    beams.mesh.count = count;
    if (count > 0) beams.mesh.instanceMatrix.needsUpdate = true;
    return count;
  }

  private ensureCapacity(layer: Layer, needed: number): void {
    if (needed <= layer.capacity) return;
    let capacity = layer.capacity;
    while (capacity < needed) capacity *= 2;
    const old = layer.mesh;
    const mesh = new THREE.InstancedMesh(old.geometry, layer.material, capacity);
    mesh.name = old.name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = old.renderOrder;
    mesh.visible = old.visible;
    mesh.matrixAutoUpdate = false;
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    layer.mesh = mesh;
    layer.capacity = capacity;
  }

  /** Lamp face centre in lamppost model space: area centroid of its lamp-cell triangles, × style scale. */
  private measureHead(): void {
    const cell = GLOW_CELLS.lamp[0];
    let found: (Vec3Like & { triangles: number }) | null = null;
    if (this.library.has('lamppost')) {
      for (const part of this.library.get('lamppost').parts) {
        const position = part.geometry.getAttribute('position');
        const uv = part.geometry.getAttribute('uv');
        if (!position || !uv) continue;
        const index = part.geometry.index;
        const centroid = measureCellCentroid(
          attributeArray(position, 3),
          attributeArray(uv, 2),
          index ? (index.array as ArrayLike<number>) : null,
          cell.col,
          cell.row,
        );
        if (centroid && (!found || centroid.triangles > found.triangles)) found = centroid;
      }
    }
    if (!found) console.warn('[night] lamppost lamp face not found; using the measured fallback');
    const source = found ?? FALLBACK_HEAD;
    const style = MODEL_STYLES.lamppost?.scale ?? [1, 1, 1];
    this.head.x = source.x * style[0];
    this.head.y = source.y * style[1];
    this.head.z = source.z * style[2];
  }

  /**
   * The four mast heads in stadium model space (the lamp-cell triangles of each quadrant), handed to the
   * stadium material's floodlight uniforms; they aim at the middle of the pitch.
   */
  private measureMasts(): void {
    const cell = GLOW_CELLS.floodlight[0];
    if (this.library.has('stadium')) {
      const template = this.library.get('stadium');
      this.lot.x = (template.bounds.max.x - template.bounds.min.x) / 2;
      this.lot.z = (template.bounds.max.z - template.bounds.min.z) / 2;
      for (let m = 0; m < FLOOD_LAMPS; m += 1) {
        const sx = m % 2 === 0 ? -1 : 1;
        const sz = m < 2 ? -1 : 1;
        let found: (Vec3Like & { triangles: number }) | null = null;
        for (const part of template.parts) {
          const position = part.geometry.getAttribute('position');
          const uv = part.geometry.getAttribute('uv');
          if (!position || !uv) continue;
          const index = part.geometry.index;
          const centroid = measureCellCentroid(
            attributeArray(position, 3),
            attributeArray(uv, 2),
            index ? (index.array as ArrayLike<number>) : null,
            cell.col,
            cell.row,
            undefined,
            undefined,
            (x, _y, z) => x * sx > 0 && z * sz > 0,
          );
          if (centroid && (!found || centroid.triangles > found.triangles)) found = centroid;
        }
        if (!found) {
          console.warn('[night] stadium floodlight lamps not found; using the measured fallback');
          continue;
        }
        this.masts[m * 3] = found.x;
        this.masts[m * 3 + 1] = found.y;
        this.masts[m * 3 + 2] = found.z;
      }
    }
    const flood = this.library.glow.flood;
    let ax = 0;
    let az = 0;
    for (let m = 0; m < FLOOD_LAMPS; m += 1) {
      flood.uFloodLamps.value[m].set(this.masts[m * 3], this.masts[m * 3 + 1], this.masts[m * 3 + 2]);
      ax += this.masts[m * 3] / FLOOD_LAMPS;
      az += this.masts[m * 3 + 2] / FLOOD_LAMPS;
    }
    flood.uFloodAim.value.set(ax, 0, az);
  }

  private buildLayer(kind: LayerKind): void {
    const flat = kind === 'pool' || kind === 'floodPool';
    const billboard = kind === 'halo' || kind === 'floodHalo';
    const geometry = kind === 'beam' ? beamGeometry() : flat ? groundQuad() : new THREE.PlaneGeometry(1, 1);
    geometry.name = `night:${kind}`;
    this.geometries.push(geometry);
    const material = new THREE.ShaderMaterial({
      name: `night:${kind}`,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uLevel: { value: 0 },
        uPush: { value: kind === 'floodHalo' ? 0.3 : 0.12 },
        uLot: { value: new THREE.Vector2(FALLBACK_LOT.x, FALLBACK_LOT.z) },
        uReach: { value: 1 },
      },
      vertexShader: billboard ? BILLBOARD_VERTEX : FLAT_VERTEX,
      fragmentShader: FRAGMENT_PARS + FRAGMENTS[kind],
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    if (!billboard) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -2;
    }
    const capacity =
      kind === 'beam' ? MAX_CARS : kind === 'floodPool' ? INITIAL_STADIUM_CAPACITY : kind === 'floodHalo' ? INITIAL_STADIUM_CAPACITY * FLOOD_LAMPS : INITIAL_LAMP_CAPACITY;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `night:${kind}`;
    mesh.count = 0;
    mesh.frustumCulled = false; // a handful of quads; bounds would need refitting on every change
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = flat ? 1 : kind === 'beam' ? 2 : 3;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.layers.set(kind, { mesh, material, capacity });
  }

  private applyColors(): void {
    const t = this.tuning;
    const set = (kind: LayerKind, color: string, strength: number) => {
      const layer = this.layers.get(kind);
      if (layer) (layer.material.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(strength);
    };
    set('pool', t.poolColor, t.poolStrength);
    set('halo', t.haloColor, t.haloStrength);
    set('beam', t.beamColor, t.beamStrength);
    set('floodPool', t.floodPoolColor, t.floodPoolStrength);
    set('floodHalo', t.floodHaloColor, t.floodHaloStrength);
  }

  private installDebug(debug?: DebugTools): void {
    const folder = debug?.folder('Night lights');
    if (!folder) return;
    const glow = this.library.glow;
    const refreshGlow = () => glow.refresh();
    folder.add(glow.tuning, 'windows', 0, 5, 0.05).name('windows').onChange(refreshGlow);
    folder.add(glow.tuning, 'lamp', 0, 6, 0.05).name('lamp face').onChange(refreshGlow);
    folder.add(glow.tuning, 'traffic', 0, 5, 0.05).name('traffic lenses').onChange(refreshGlow);
    folder.add(glow.tuning, 'floodlight', 0, 6, 0.05).name('floodlight lamps').onChange(refreshGlow);
    folder.add(glow.tuning, 'floodLit', 0, 12, 0.1).name('floodlit stadium').onChange(refreshGlow);
    folder.add(this.life.headlightTuning, 'headlights', 0, 6, 0.05).name('head/tail lights');
    const relayout = () => {
      this.builtVersion = -1;
      this.builtStadiums = -1;
      this.applyColors();
    };
    folder.add(this.tuning, 'lampOutset', -0.1, 0.1, 0.005).name('lamp light outset').onChange(relayout);
    folder.add(this.tuning, 'poolRadius', 0.3, 2.5, 0.05).name('pool radius').onChange(relayout);
    folder.add(this.tuning, 'poolStrength', 0, 1.5, 0.01).name('pool strength').onChange(relayout);
    folder.addColor(this.tuning, 'poolColor').name('pool colour').onChange(relayout);
    folder.add(this.tuning, 'haloSize', 0.05, 1, 0.01).name('halo size').onChange(relayout);
    folder.add(this.tuning, 'haloStrength', 0, 2, 0.01).name('halo strength').onChange(relayout);
    folder.add(this.tuning, 'beamLength', 0.2, 1.5, 0.01).name('beam length').onChange(relayout);
    folder.add(this.tuning, 'beamWidth', 0.1, 0.8, 0.01).name('beam width').onChange(relayout);
    folder.add(this.tuning, 'beamStrength', 0, 1, 0.01).name('beam strength').onChange(relayout);
    folder.add(this.tuning, 'floodReach', 0.5, 6, 0.1).name('floodlight spill reach').onChange(relayout);
    folder.add(this.tuning, 'floodPoolStrength', 0, 1.5, 0.01).name('floodlight spill').onChange(relayout);
    folder.add(this.tuning, 'floodHaloSize', 0.2, 3, 0.05).name('floodlight halo size').onChange(relayout);
    folder.add(this.tuning, 'floodHaloStrength', 0, 2, 0.01).name('floodlight halo').onChange(relayout);
  }
}

/** 1 × 1 quad lying in XZ, facing up, centred on the origin. */
function groundQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
}

/** 1 × 1 quad lying in XZ from z = 0 (the bonnet) to z = 1 (ahead), x ∈ [−0.5, 0.5]; uv.y = along. */
function beamGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 0, 1, 0.5, 0, 1], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  return geometry;
}

function attributeArray(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): ArrayLike<number> {
  if ((attribute as THREE.BufferAttribute).isBufferAttribute && attribute.itemSize === size) return (attribute as THREE.BufferAttribute).array;
  const out = new Float32Array(attribute.count * size);
  for (let i = 0; i < attribute.count; i += 1) {
    out[i * size] = attribute.getX(i);
    out[i * size + 1] = attribute.getY(i);
    if (size > 2) out[i * size + 2] = attribute.getZ(i);
  }
  return out;
}

// Shader output is added straight onto the display-space framebuffer.

const FLAT_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const BILLBOARD_VERTEX = /* glsl */ `
uniform float uPush;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  mv.xy += position.xy * s;
  mv.z += uPush * step(1e-6, s); // towards the camera, so the lamp's own arm doesn't clip the halo
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying vec2 vUv;
// ±0.5/255 interleaved-gradient noise where there is light: breaks up banding of the soft gradients.
float glowDither(float lit) {
  return step(0.002, lit) * (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
}
`;

const POOL_FRAGMENT = /* glsl */ `
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * (0.35 + 0.65 * a) * uLevel;
  gl_FragColor = vec4(max(uColor * a + glowDither(a), 0.0), 1.0);
}
`;

// A street lamp shines down, so the glow fades out above the lamp face (vUv.y 0.5 is the face; up on
// screen is +y) and only the small bright core reaches just over the arm.
const HALO_FRAGMENT = /* glsl */ `
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  float below = 1.0 - smoothstep(0.47, 0.6, vUv.y);
  a = (a * a * a * below + 0.6 * pow(max(1.0 - d * 2.2, 0.0), 2.0) * mix(0.35, 1.0, below)) * uLevel;
  gl_FragColor = vec4(max(uColor * a + glowDither(a), 0.0), 1.0);
}
`;

const BEAM_FRAGMENT = /* glsl */ `
void main() {
  float along = vUv.y;
  float spread = mix(0.45, 1.0, along);
  float across = abs(vUv.x * 2.0 - 1.0) / spread;
  float side = 1.0 - smoothstep(0.55, 1.0, across);
  float fade = 1.0 - along;
  fade *= fade * smoothstep(0.0, 0.12, along);
  float a = side * fade * uLevel;
  gl_FragColor = vec4(max(uColor * a + glowDither(a), 0.0), 1.0);
}
`;

// The stadium's own floor is lit by its material, so the spill is 0 inside the lot and fades outwards
// from its walls (a rounded box distance in the lot's frame).
const FLOOD_POOL_FRAGMENT = /* glsl */ `
uniform vec2 uLot;
uniform float uReach;
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * (uLot + uReach);
  vec2 q = abs(p) - uLot;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float a = 1.0 - smoothstep(0.0, uReach, d);
  a = step(0.0, d) * a * a * uLevel;
  gl_FragColor = vec4(max(uColor * a + glowDither(a), 0.0), 1.0);
}
`;

// A mast head is a bank of lamps: a wide soft glow with a bright core, the same all round.
const FLOOD_HALO_FRAGMENT = /* glsl */ `
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = (0.45 * a * a * a + 0.75 * pow(max(1.0 - d * 3.0, 0.0), 2.0)) * uLevel;
  gl_FragColor = vec4(max(uColor * a + glowDither(a), 0.0), 1.0);
}
`;

const FRAGMENTS: Readonly<Record<LayerKind, string>> = {
  pool: POOL_FRAGMENT,
  halo: HALO_FRAGMENT,
  beam: BEAM_FRAGMENT,
  floodPool: FLOOD_POOL_FRAGMENT,
  floodHalo: FLOOD_HALO_FRAGMENT,
};
