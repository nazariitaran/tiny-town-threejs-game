/**
 * Flocks that now and then fly over the town: one InstancedMesh of a procedural 18-triangle bird with a
 * per-instance colour (the species) and `aFlap` (inner, outer wing angle) written every frame. The vertex
 * shader folds the wings; the shadow depth material has the same patch, so the shadow flaps too.
 */
import * as THREE from 'three';
import type { DebugTools } from '../debug/DebugTools';
import { createLitMaterial, type LitMaterial, type MaterialMode } from '../render/materials';
import type { DayPhase } from '../world/dayCycle';
import type { TownStateReader } from '../town/types';
import { BIRD_SPECIES, FlockSim, MAX_BIRDS, SPECIES, type BirdSpecies } from './FlockSim';

/** Where the wings fold (base-bird units, |x|): the shoulder and the wrist. */
const INNER_HINGE = 0.028;
const OUTER_HINGE = 0.1;
const BIRD_CACHE_KEY = 'tiny-town:bird-flap:v1';

export interface BirdDiagnostics {
  /** Spontaneous flocks on. */
  auto: boolean;
  flocks: number;
  birds: number;
  /** Flocks launched since the last reset. */
  spawned: number;
  /** Seconds. */
  nextFlockIn: number;
  species: BirdSpecies[];
  drawCalls: number;
  /** Not counted in renderer.calls. */
  shadowDrawCalls: number;
  /** Rounded to mm. */
  positions: Array<{ x: number; y: number; z: number }>;
}

export class BirdSystem {
  readonly sim: FlockSim;
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: LitMaterial;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private readonly flap: THREE.InstancedBufferAttribute;
  private colourVersion = -1;
  /** lil-gui `Birds` folder. */
  private readonly tuning = { visible: true, scale: 1 };
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    town: TownStateReader,
    seed: number,
    debug?: DebugTools,
    materialMode: MaterialMode = 'standard',
  ) {
    this.sim = new FlockSim(seed, () => town.stats().trees);
    this.geometry = createBirdGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 2), 2);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aFlap', this.flap);
    this.material = createLitMaterial(
      {
        name: 'life:birds',
        vertexColors: true,
        flatShading: true,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      },
      materialMode,
    );
    applyWingFlap(this.material);
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    applyWingFlap(this.depthMaterial);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_BIRDS);
    mesh.name = 'life:birds';
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // birds spread over the whole sky; ≤ 16 instances
    mesh.count = 0;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Up front, so the program is built once with instance colours (setColorAt would add it lazily).
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 3).fill(1), 3);
    this.mesh = mesh;
    scene.add(mesh);

    const folder = debug?.folder('Birds');
    if (folder) {
      folder.add(this.tuning, 'visible').name('birds visible').onChange(() => this.sync());
      folder.add(this.tuning, 'scale', 0.5, 2.5, 0.05).name('size').onChange(() => this.sync());
      folder.add(this.sim, 'speedScale', 0.25, 3, 0.05).name('speed');
      const actions = { spawn: () => this.spawnFlock() };
      folder.add(actions, 'spawn').name('spawn a flock');
    }
  }

  /** animDelta 0 freezes birds and the schedule. */
  update(animDelta: number): void {
    this.sim.step(Math.min(animDelta, 0.1));
    this.sync();
  }

  /** No new flocks at night, more at dawn and dusk. Called every frame. */
  setDaylight(night: number, phase: DayPhase): void {
    this.sim.setNight(night, phase === 'dawn' || phase === 'dusk');
  }

  /** Spontaneous flocks on/off. */
  setAuto(on: boolean): void {
    this.sim.auto = on;
  }

  /** `?debug&flock=N`: a fixed N-second wait between flocks; null = the normal schedule. */
  setIntervalOverride(seconds: number | null): void {
    this.sim.intervalOverride = seconds;
  }

  /** Clears the sky, re-seeds and restarts the schedule. */
  reset(seed: number): void {
    this.sim.reset(seed);
    this.sync();
  }

  /** Clears the sky for reduced motion: a bird frozen in mid-air looks broken. */
  settle(): void {
    this.sim.clear();
    this.sync();
  }

  /** Returns the flock's bird count; 0 when the sky is full. */
  spawnFlock(species?: BirdSpecies): number {
    const count = this.sim.spawn(species);
    this.sync();
    return count;
  }

  get castsShadows(): boolean {
    return this.mesh.visible && this.mesh.castShadow && this.mesh.count > 0;
  }

  getDiagnostics(): BirdDiagnostics {
    const stats = this.sim.stats;
    const drawn = this.mesh.visible ? 1 : 0;
    return {
      auto: stats.auto,
      flocks: stats.flocks,
      birds: stats.birds,
      spawned: stats.spawned,
      nextFlockIn: Math.round(stats.nextFlockIn * 100) / 100,
      species: this.sim.flocks.map((flock) => flock.species),
      drawCalls: drawn,
      shadowDrawCalls: drawn && this.mesh.castShadow ? 1 : 0,
      positions: this.sim.birds.map((b) => ({ x: round3(b.x), y: round3(b.y), z: round3(b.z) })),
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
  }

  /** Colours are rewritten only when the set of birds changed. */
  private sync(): void {
    const birds = this.sim.birds;
    const mesh = this.mesh;
    const recolour = this.colourVersion !== this.sim.version;
    this.colourVersion = this.sim.version;
    const flap = this.flap.array as Float32Array;
    for (let i = 0; i < birds.length; i += 1) {
      const bird = birds[i];
      this.position.set(bird.x, bird.y, bird.z);
      this.euler.set(0, bird.yaw, bird.bank);
      this.quaternion.setFromEuler(this.euler);
      this.scale.setScalar(Math.max(bird.scale * this.tuning.scale, 0.0001));
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(i, this.matrix);
      flap[i * 2] = bird.wingInner;
      flap[i * 2 + 1] = bird.wingOuter;
      if (recolour) mesh.setColorAt(i, this.colour.setHex(SPECIES[bird.species].color));
    }
    mesh.count = birds.length;
    mesh.visible = this.tuning.visible && birds.length > 0;
    if (birds.length > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      this.flap.needsUpdate = true;
      if (recolour && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

export function isBirdSpecies(name: unknown): name is BirdSpecies {
  return typeof name === 'string' && (BIRD_SPECIES as readonly string[]).includes(name);
}

/**
 * The base bird: wingspan 0.36 units, beak towards +Z, back up, +X = its left wing; non-indexed.
 * `color` is a grey shading pattern the species colour multiplies; `aWing` is the part
 * (0 body/tail, 1 inner wing, 2 outer wing).
 */
export function createBirdGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], shade: number, part: number) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i += 1) {
      colours.push(shade, shade, shade);
      wing.push(part);
    }
  };
  // Body: a faceted dart.
  const nose = [0, 0.005, 0.12];
  const tailRoot = [0, 0.01, -0.09];
  const top = [0, 0.035, 0];
  const belly = [0, -0.025, 0];
  const left = [0.032, 0.005, 0];
  const right = [-0.032, 0.005, 0];
  for (const tip of [nose, tailRoot]) {
    tri(tip, top, left, 0.82, 0);
    tri(tip, left, belly, 1, 0);
    tri(tip, belly, right, 1, 0);
    tri(tip, right, top, 0.82, 0);
  }
  // Tail fan.
  tri(tailRoot, [0.042, 0.01, -0.155], [0, 0.01, -0.13], 0.72, 0);
  tri(tailRoot, [0, 0.01, -0.13], [-0.042, 0.01, -0.155], 0.72, 0);
  // Wings (mirrored): inner panel shoulder → wrist, outer panel wrist → swept-back tip.
  for (const s of [1, -1]) {
    const y = 0.012;
    const rootLead = [s * INNER_HINGE, y, 0.035];
    const rootTrail = [s * INNER_HINGE, y, -0.035];
    const wristLead = [s * OUTER_HINGE, y, 0.03];
    const wristTrail = [s * OUTER_HINGE, y, -0.045];
    tri(rootLead, wristLead, wristTrail, 0.95, 1);
    tri(rootLead, wristTrail, rootTrail, 0.95, 1);
    tri(wristLead, [s * 0.15, y, 0.005], [s * 0.18, y, -0.05], 0.62, 2);
    tri(wristLead, [s * 0.18, y, -0.05], wristTrail, 0.62, 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Folds the wings: an outer-wing vertex turns about the wrist by aFlap.y, then every wing vertex turns
 * about the shoulder by aFlap.x (+ = tip up, mirrored per side). Needs a material with begin_vertex.
 */
function applyWingFlap(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aWing;\nattribute vec2 aFlap;`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
  float wingSide = transformed.x >= 0.0 ? 1.0 : -1.0;
  if (aWing > 1.5) {
    vec2 hinge = vec2(wingSide * ${OUTER_HINGE.toFixed(4)}, 0.012);
    float a = wingSide * aFlap.y;
    vec2 d = transformed.xy - hinge;
    transformed.xy = hinge + vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
  }
  if (aWing > 0.5) {
    vec2 hinge = vec2(wingSide * ${INNER_HINGE.toFixed(4)}, 0.012);
    float a = wingSide * aFlap.x;
    vec2 d = transformed.xy - hinge;
    transformed.xy = hinge + vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
  }
}`,
      );
  };
  material.customProgramCacheKey = () => BIRD_CACHE_KEY;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
