/**
 * Night light sources (WP-16b, docs/plans/wp-16-day-night.md §3–§4). No real PointLights.
 *
 *  - Glow masks on windows / lamp faces / traffic lenses live on ModelLibrary's glow clones
 *    (render/nightGlow.ts); update() drives them through `library.glow` (a few number writes).
 *  - Pools of lamplight: ONE InstancedMesh of flat additive quads on the ground under every lamp
 *    head (+1 draw call at night, whatever the lamp count).
 *  - Halos: ONE InstancedMesh of camera-facing additive sprites at the lamp heads (+1). Always built;
 *    drawn only while `lampHalos` (the graphics preset's GraphicsProfile.lampHalos, WP-25; off on Low).
 *  - Headlight beams: ONE InstancedMesh of short additive cones on the road ahead of each car
 *    (≤ MAX_CARS; +1), from LifeSystem.carPose().
 *  - Fireflies (stretch, render/fireflies.ts): ≤ 24 sprites over meadow cells in full night (+1).
 *  - All of them are `visible = false` while night < VISIBLE_FROM, so daytime draw calls and pixels
 *    are unchanged.
 *  - Lamp registry (render/lampRegistry.ts): from `town:changed` and the grid helpers, so it is
 *    scale-agnostic. The lamp head is measured once at populate() from the lamppost's lamp-cell UV
 *    triangles, then MODEL_STYLES.lamppost.scale is applied (rotation/offset come from the object).
 *  - Instance writes happen in a chained `scene.onBeforeRender`, so whatever renders (the frame loop,
 *    or a test hook while paused for a screenshot) draws the current lamps and cars.
 *  - Shader warm-up: the first render after populate() draws each layer once with a zero-scale
 *    instance (no fragments), so the three programs compile at load, not at the first dusk.
 *
 * Game.ts wiring (integrator, contract commit):
 *   new NightLights(scene, library, town, bus, life, debug)
 *   applyGraphics(): nightLights.setLampHalos(profile.lampHalos)   (at boot and on every preset change)
 *   load():   nightLights.populate()                 (after library.loadAll + life.load)
 *   update(): nightLights.update(daySample)          (every frame, after environment.applyDaylight)
 *             and at once from setTimeOfDay / setState while paused for screenshots
 *   diagnostics: daytime.lamps / daytime.drawCalls ← getDiagnostics()
 *   dispose()
 */
import * as THREE from 'three';
import type { DebugTools } from '../debug/DebugTools';
import type { GameBus } from '../game/events';
import type { CarPose, LifeSystem } from '../life/LifeSystem';
import { MAX_CARS } from '../life/TrafficSim';
import type { TownStateReader } from '../town/types';
import type { DaySample } from '../world/dayCycle';
import { LampRegistry, measureCellCentroid, objectPointToWorld, type Vec3Like } from './lampRegistry';
import type { ModelLibrary } from './ModelLibrary';
import { windStrength, windTime } from '../fx/windSway';
import { Fireflies, FIREFLIES_FROM } from './fireflies';
import { GLOW_CELLS, smoothstep } from './nightGlow';
import { MODEL_STYLES } from './modelStyles';

export interface NightLightsDiagnostics {
  /** Lampposts currently tracked. */
  lamps: number;
  /** Main-pass draw calls this layer adds (0 by day). */
  drawCalls: number;
}

/** Below this `night` the ground layers are hidden (daytime draw calls +0). */
export const VISIBLE_FROM = 0.05;
/** Lamp face centre in lamppost model space if the geometry can't be measured (facts table). */
const FALLBACK_HEAD: Vec3Like = { x: 0, y: 0.653, z: 0.154 };
/** Pools sit just above the tallest flat ground (road / pavement tops at 0.02). */
const POOL_Y = 0.028;
const BEAM_Y = 0.026;
const INITIAL_LAMP_CAPACITY = 32;
/** Pool / halo brightness at night = 0 relative to full night (see update()). */
const DUSK_POOL_LEVEL = 0.55;

export interface NightLightsTuning {
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
}

export const DEFAULT_NIGHT_LIGHTS_TUNING: Readonly<NightLightsTuning> = {
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
};

type LayerKind = 'pool' | 'halo' | 'beam';

interface Layer {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  capacity: number;
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export class NightLights {
  readonly tuning: NightLightsTuning = { ...DEFAULT_NIGHT_LIGHTS_TUNING };
  private readonly diag: NightLightsDiagnostics = { lamps: 0, drawCalls: 0 };
  private readonly registry = new LampRegistry();
  private readonly group = new THREE.Group();
  private readonly unsubscribe: Array<() => void> = [];
  private readonly layers = new Map<LayerKind, Layer>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly head: Vec3Like = { ...FALLBACK_HEAD };
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
  private readonly pose: CarPose = { x: 0, y: 0, z: 0, yaw: 0, scale: 1, front: 0 };

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
        this.fireflies?.invalidate();
      }),
    );
    this.registry.rebuild(town);
    // Chained: instance writes + warm-up right before every render (frame loop or test hook).
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
    this.fireflies = new Fireflies();
    this.group.add(this.fireflies.mesh);
    this.applyColors();
    this.scene.add(this.group);
    this.registry.rebuild(this.town);
    this.builtVersion = -1;
    this.populated = true;
    this.warmPending = true;
    this.publish();
  }

  /** Per frame and from test hooks: drive every light source from the day sample. */
  update(sample: Readonly<DaySample>): void {
    this.library.glow.update(sample);
    this.night = this.library.glow.levels.night;
    this.lampLevel = this.library.glow.levels.lamps;
    // No iterators here (per frame): three direct lookups.
    // Lamps are fully on from night ≈ 0.42, but the sky is still bright then: the ground pools and
    // halos grow into full night so they don't blow out over the lighter dusk / dawn pavement.
    const dark = DUSK_POOL_LEVEL + (1 - DUSK_POOL_LEVEL) * this.night;
    this.setLevel('pool', this.lampLevel * dark);
    this.setLevel('halo', this.lampLevel * dark);
    this.setLevel('beam', this.night);
    if (this.fireflies) {
      // The wind clock: frozen under reduced motion / while paused, rest pose after stabilize().
      this.fireflyLevel = smoothstep(FIREFLIES_FROM, 1, this.night);
      this.fireflies.setState(this.fireflyLevel, windTime(), windStrength());
      if (this.fireflyLevel > 0 && this.populated) this.fireflies.refresh(this.town);
    }
    this.publish();
  }

  /** Show the lamp halos at night (WP-25 graphics presets; live). */
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

  // ---------------------------------------------------------------------------------------------

  private setLevel(kind: LayerKind, level: number): void {
    const layer = this.layers.get(kind);
    if (layer) layer.material.uniforms.uLevel.value = level;
  }

  private get shown(): boolean {
    return this.populated && this.night >= VISIBLE_FROM;
  }

  private publish(): void {
    this.diag.lamps = this.registry.count;
    let calls = 0;
    if (this.shown) {
      if (this.lampLevel > 0 && this.registry.count > 0) calls += this.lampHalos && this.layers.has('halo') ? 2 : 1;
      if (this.drawnCars() > 0) calls += 1;
      if (this.fireflyLevel > 0 && (this.fireflies?.count ?? 0) > 0) calls += 1;
    }
    this.diag.drawCalls = calls;
  }

  private drawnCars(): number {
    let cars = 0;
    const n = Math.min(this.life.carCount, MAX_CARS);
    for (let i = 0; i < n; i += 1) if (this.life.carPose(i, this.pose) && this.pose.scale > 0.01) cars += 1;
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
    if (this.fireflies) {
      const on = shown && this.fireflyLevel > 0;
      this.fireflies.mesh.visible = on && this.fireflies.refresh(this.town) > 0;
    }
    // What this render really draws (update()'s estimate can lag while paused: cars settle after it).
    this.diag.drawCalls =
      (pools.mesh.visible ? 1 : 0) + (halos?.mesh.visible ? 1 : 0) + (beams.mesh.visible ? 1 : 0) + (this.fireflies?.mesh.visible ? 1 : 0);
  }

  private writeLamps(): void {
    const pools = this.layers.get('pool')!;
    const halos = this.layers.get('halo');
    this.ensureCapacity(pools, this.registry.count);
    if (halos) this.ensureCapacity(halos, this.registry.count);
    const t = this.tuning;
    let i = 0;
    for (const lamp of this.registry.values()) {
      objectPointToWorld(lamp, this.head, this.world);
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
      if (!this.life.carPose(i, this.pose) || this.pose.scale <= 0.01) continue;
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

  private buildLayer(kind: LayerKind): void {
    const geometry = kind === 'beam' ? beamGeometry() : kind === 'pool' ? groundQuad() : new THREE.PlaneGeometry(1, 1);
    geometry.name = `night:${kind}`;
    this.geometries.push(geometry);
    const material = new THREE.ShaderMaterial({
      name: `night:${kind}`,
      uniforms: { uColor: { value: new THREE.Color() }, uLevel: { value: 0 }, uPush: { value: 0.12 } },
      vertexShader: kind === 'halo' ? BILLBOARD_VERTEX : FLAT_VERTEX,
      fragmentShader: FRAGMENT_PARS + (kind === 'pool' ? POOL_FRAGMENT : kind === 'halo' ? HALO_FRAGMENT : BEAM_FRAGMENT),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    if (kind !== 'halo') {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -2;
    }
    const capacity = kind === 'beam' ? MAX_CARS : INITIAL_LAMP_CAPACITY;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `night:${kind}`;
    mesh.count = 0;
    mesh.frustumCulled = false; // a handful of quads; bounds would need refitting on every change
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = kind === 'pool' ? 1 : kind === 'beam' ? 2 : 3;
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
  }

  private installDebug(debug?: DebugTools): void {
    const folder = debug?.folder('Night lights');
    if (!folder) return;
    const glow = this.library.glow;
    const refreshGlow = () => glow.refresh();
    folder.add(glow.tuning, 'windows', 0, 5, 0.05).name('windows').onChange(refreshGlow);
    folder.add(glow.tuning, 'lamp', 0, 6, 0.05).name('lamp face').onChange(refreshGlow);
    folder.add(glow.tuning, 'traffic', 0, 5, 0.05).name('traffic lenses').onChange(refreshGlow);
    folder.add(this.life.headlightTuning, 'headlights', 0, 6, 0.05).name('head/tail lights');
    const relayout = () => {
      this.builtVersion = -1;
      this.applyColors();
    };
    folder.add(this.tuning, 'poolRadius', 0.3, 2.5, 0.05).name('pool radius').onChange(relayout);
    folder.add(this.tuning, 'poolStrength', 0, 1.5, 0.01).name('pool strength').onChange(relayout);
    folder.addColor(this.tuning, 'poolColor').name('pool colour').onChange(relayout);
    folder.add(this.tuning, 'haloSize', 0.05, 1, 0.01).name('halo size').onChange(relayout);
    folder.add(this.tuning, 'haloStrength', 0, 2, 0.01).name('halo strength').onChange(relayout);
    folder.add(this.tuning, 'beamLength', 0.2, 1.5, 0.01).name('beam length').onChange(relayout);
    folder.add(this.tuning, 'beamWidth', 0.1, 0.8, 0.01).name('beam width').onChange(relayout);
    folder.add(this.tuning, 'beamStrength', 0, 1, 0.01).name('beam strength').onChange(relayout);
  }
}

// ---- Geometry ----------------------------------------------------------------------------------

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

// ---- Shaders (output is added straight onto the display-space framebuffer) ---------------------

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

const HALO_FRAGMENT = /* glsl */ `
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = (a * a * a + 0.6 * pow(max(1.0 - d * 2.2, 0.0), 2.0)) * uLevel;
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
