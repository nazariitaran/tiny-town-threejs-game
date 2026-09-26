/**
 * Event-driven placement VFX and the wind clock.
 *
 *  - build:placed  → dust ring sized by what was built (path small, building large), leaves for
 *                    trees/lawn, petals for wildflowers, and a sparkle ring when a building's
 *                    pop-in lands (fxRecipes.ts).
 *  - build:removed → a "poof" plus debris chips sized by layer/kind.
 *  - Wind sway     → advances the shared foliage uniform (windSway.ts) from the animation delta.
 *
 * Budget: TWO InstancedMeshes (≤ 2 draw calls, 0 when idle — meshes hide when empty), no shadow
 * casting, preallocated pools and scratch math objects: update() allocates nothing.
 * Randomness only from the injected seeded rng.
 *
 * Reduced motion: Game passes delta 0 and calls stabilize() when the test hook enables it; the OS
 * `prefers-reduced-motion: reduce` setting is honoured too. Either way particles are cleared and
 * not spawned, and foliage returns to its rest pose (wind strength 0), so screenshots are stable.
 * The first update with delta > 0 after stabilize() resumes FX and eases the wind back in.
 *
 * The invalid-placement "shake" lives in GhostPreview (WP-05).
 *
 * WP-08 (Feel & VFX).
 */
import * as THREE from 'three';
import type { GameBus } from '../game/events';
import { emitPlaced, emitRemoved, type FxPools } from './fxRecipes';
import { Curve, ParticlePool } from './particlePool';
import { setWindStrength, updateWindSway, windStrength, windTime } from './windSway';

/** Pool sizes: a 30-tile drag at ~3 puffs/tile with 0.6 s lives peaks well under this. */
const SOLID_CAPACITY = 384;
const GLINT_CAPACITY = 96;
/** Seconds for the breeze to ease back in after reduced motion / stabilize. */
const WIND_EASE_IN = 1.2;
/** Wind clock step cap, so a backgrounded tab doesn't jump the foliage. */
const MAX_WIND_STEP = 0.1;

export interface FxDiagnostics {
  /** Live particles (including scheduled, not yet started ones). */
  active: number;
  /** Draw calls the FX layer issues this frame (visible FX meshes; no shadow pass). */
  drawCalls: number;
  /** Particles spawned since start / dropped because a pool was full. */
  spawned: number;
  dropped: number;
  /** True while reduced motion (test hook or OS setting) suppresses FX. */
  reducedMotion: boolean;
  windTime: number;
  windStrength: number;
}

// LOCAL SHIM (WP-08) until the integrator adds `fx: this.fx.getDiagnostics()` to
// __THREE_GAME_DIAGNOSTICS__ (see hand-off contract request). Read by tests/fx.spec.ts.
declare global {
  interface Window {
    __THREE_GAME_FX_DIAGNOSTICS__?: FxDiagnostics;
  }
}

export class PlacementFx {
  private readonly unsubscribers: Array<() => void> = [];
  private readonly pools: FxPools = {
    solid: new ParticlePool(SOLID_CAPACITY),
    glint: new ParticlePool(GLINT_CAPACITY),
  };
  private readonly solidMesh: THREE.InstancedMesh;
  private readonly glintMesh: THREE.InstancedMesh;
  private readonly reducedMotionQuery: MediaQueryList | null;
  /** Set by stabilize(); cleared by the next update with delta > 0. */
  private suppressed = false;
  private wind = 0;
  private windLevel = 1;
  private readonly diag: FxDiagnostics = {
    active: 0,
    drawCalls: 0,
    spawned: 0,
    dropped: 0,
    reducedMotion: false,
    windTime: 0,
    windStrength: 1,
  };

  // Scratch objects reused every frame (zero per-frame allocations).
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    bus: GameBus,
    private readonly rng: () => number,
  ) {
    this.reducedMotionQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    // Solid: dust puffs, chips, leaves and petals share one faceted low-poly mesh (flat-shaded
    // Lambert reads as Kenney-style chunky dust under the warm key light).
    this.solidMesh = this.createMesh(
      'fx:solid',
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      SOLID_CAPACITY,
    );
    // Glint: unlit gold diamonds for the "building complete" sparkle ring.
    this.glintMesh = this.createMesh(
      'fx:glint',
      new THREE.OctahedronGeometry(1, 0),
      // Opaque and un-tonemapped: additive washed out to white against the bright field.
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      GLINT_CAPACITY,
    );

    this.unsubscribers.push(
      bus.on('build:placed', ({ toolId, worldX, worldZ, strokeIndex }) => {
        if (this.motionOff()) return;
        emitPlaced(this.pools, this.rng, toolId, worldX, worldZ, strokeIndex);
      }),
      bus.on('build:removed', ({ layer, kind, worldX, worldZ, strokeIndex }) => {
        if (this.motionOff()) return;
        emitRemoved(this.pools, this.rng, layer, kind, worldX, worldZ, strokeIndex);
      }),
    );
    if (typeof window !== 'undefined') window.__THREE_GAME_FX_DIAGNOSTICS__ = this.diag;
  }

  /** Advance particles and the wind clock. `delta` is 0 while reduced motion is on. */
  update(delta: number): void {
    if (delta > 0) this.suppressed = false;
    if (this.motionOff()) {
      this.freeze();
      this.writeDiagnostics();
      return;
    }
    const step = Math.min(delta, MAX_WIND_STEP);
    this.wind += step;
    updateWindSway(this.wind);
    if (this.windLevel < 1) {
      this.windLevel = Math.min(1, this.windLevel + step / WIND_EASE_IN);
      // Smoothstep so the breeze fades in rather than snapping.
      setWindStrength(this.windLevel * this.windLevel * (3 - 2 * this.windLevel));
    }
    this.pools.solid.step(delta);
    this.pools.glint.step(delta);
    this.writeInstances(this.pools.solid, this.solidMesh, false);
    this.writeInstances(this.pools.glint, this.glintMesh, true);
    this.writeDiagnostics();
  }

  /** Snap all effects to a stable end state (screenshots, reduced motion): no particles, foliage at rest. */
  stabilize(): void {
    this.suppressed = true;
    this.freeze();
    this.writeDiagnostics();
  }

  /** FX counters for __THREE_GAME_DIAGNOSTICS__ (a live object, updated every frame). */
  getDiagnostics(): Readonly<FxDiagnostics> {
    return this.diag;
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    for (const mesh of [this.solidMesh, this.glintMesh]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.pools.solid.clear();
    this.pools.glint.clear();
    setWindStrength(1);
    if (typeof window !== 'undefined' && window.__THREE_GAME_FX_DIAGNOSTICS__ === this.diag) {
      window.__THREE_GAME_FX_DIAGNOSTICS__ = undefined;
    }
  }

  private motionOff(): boolean {
    return this.suppressed || (this.reducedMotionQuery?.matches ?? false);
  }

  /** Clear particles, hide meshes and put foliage in its rest pose. */
  private freeze(): void {
    this.pools.solid.clear();
    this.pools.glint.clear();
    this.solidMesh.visible = false;
    this.solidMesh.count = 0;
    this.glintMesh.visible = false;
    this.glintMesh.count = 0;
    if (this.windLevel !== 0) {
      this.windLevel = 0;
      this.wind = 0;
      updateWindSway(0);
      setWindStrength(0);
    }
  }

  private createMesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Instances roam the whole plot; the static bounding sphere would cull them wrongly.
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  private writeInstances(pool: ParticlePool, mesh: THREE.InstancedMesh, upright: boolean): void {
    const count = pool.count;
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    for (let i = 0; i < count; i += 1) {
      const size = pool.sizeAt(i);
      if (upright) this.euler.set(0, pool.rotA[i], 0);
      else this.euler.set(pool.rotA[i], pool.rotB[i], pool.rotA[i] * 0.5);
      this.quaternion.setFromEuler(this.euler);
      this.position.set(pool.px[i], pool.py[i] + (pool.curve[i] === Curve.Puff ? size * 0.6 : 0), pool.pz[i]);
      this.scale.set(size, size * pool.flat[i], size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(i, this.matrix);
      this.colour.setRGB(pool.r[i], pool.g[i], pool.b[i]);
      mesh.setColorAt(i, this.colour);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private writeDiagnostics(): void {
    const { solid, glint } = this.pools;
    this.diag.active = solid.count + glint.count;
    this.diag.drawCalls = (this.solidMesh.visible ? 1 : 0) + (this.glintMesh.visible ? 1 : 0);
    this.diag.spawned = solid.spawned + glint.spawned;
    this.diag.dropped = solid.dropped + glint.dropped;
    this.diag.reducedMotion = this.motionOff();
    this.diag.windTime = windTime();
    this.diag.windStrength = windStrength();
  }
}
