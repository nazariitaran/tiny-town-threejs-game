/**
 * Draws DuckSim's ducks: one InstancedMesh per part of the `duck` model (ModelLibrary), drakes plain,
 * hens tinted brown through instance colours. Ducks cast no shadow, so they never wake the shadow map.
 */
import * as THREE from 'three';
import { GROUND_MODELS } from '../catalog/models';
import type { DebugTools } from '../debug/DebugTools';
import type { GameBus } from '../game/events';
import type { ModelLibrary } from '../render/ModelLibrary';
import type { TownStateReader } from '../town/types';
import { DuckSim, MAX_DUCKS } from './DuckSim';

/** How far the duck model sits below the water top (world units). */
const DRAFT = 0.008;
const WATER_TOP = GROUND_MODELS.pond.type === 'flat' ? GROUND_MODELS.pond.height : 0.008;
const HEN_TINT = new THREE.Color(0.86, 0.68, 0.5);
const DRAKE_TINT = new THREE.Color(1, 1, 1);

export interface DuckDiagnostics {
  /** Ducks paddle on their own (off in test states until a reload). */
  auto: boolean;
  /** Ponds big enough for a duck. */
  ponds: number;
  ducks: number;
  wanted: number;
  drawCalls: number;
  /** Rounded to mm. */
  positions: Array<{ x: number; z: number }>;
}

export class DuckSystem {
  readonly sim: DuckSim;
  private readonly root = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private dirty = true;
  private settledSync = true;
  private readonly tuning = { visible: true, scale: 1 };
  private readonly off: () => void;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly scale = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly library: ModelLibrary,
    private readonly town: TownStateReader,
    bus: GameBus,
    seed: number,
    debug?: DebugTools,
  ) {
    this.sim = new DuckSim(seed);
    this.root.name = 'life:ducks';
    scene.add(this.root);
    this.off = bus.on('town:changed', ({ cause }) => {
      this.dirty = true;
      // A loaded or reset town starts with its ducks already on the water.
      if (cause === 'load' || cause === 'reset') this.settledSync = true;
    });
    const folder = debug?.folder('Ducks');
    if (folder) {
      folder.add(this.tuning, 'visible').name('ducks visible');
      folder.add(this.tuning, 'scale', 0.5, 2.5, 0.05).name('size');
    }
  }

  update(animDelta: number): void {
    this.syncTown();
    this.sim.step(Math.min(animDelta, 0.1));
    this.draw();
  }

  setNight(night: number): void {
    this.sim.setNight(night);
  }

  setAuto(on: boolean): void {
    this.sim.auto = on;
  }

  /** Re-seeds and puts every duck back at once (test states). */
  reset(seed: number): void {
    this.sim.reset(seed);
    this.dirty = true;
    this.settledSync = true;
    this.syncTown();
    this.draw();
  }

  /** Finishes pops (reduced motion, test states). */
  settle(): void {
    this.syncTown();
    this.sim.settle();
    this.draw();
  }

  getDiagnostics(): DuckDiagnostics {
    const live = this.sim.ducks.filter((duck) => !duck.leaving);
    return {
      auto: this.sim.auto,
      ponds: this.sim.ponds,
      ducks: live.length,
      wanted: this.sim.wanted,
      drawCalls: this.meshes.filter((mesh) => mesh.visible).length,
      positions: live.map((duck) => ({ x: round3(duck.x), z: round3(duck.z) })),
    };
  }

  dispose(): void {
    this.off();
    this.root.removeFromParent();
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];
  }

  private syncTown(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.sim.sync(this.town, this.settledSync);
    this.settledSync = false;
  }

  /** The meshes are made once the model library has the duck (shared geometry and material). */
  private ensureMeshes(): boolean {
    if (this.meshes.length > 0) return true;
    if (!this.library.has('duck')) return false;
    for (const part of this.library.get('duck').parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, MAX_DUCKS);
      mesh.name = 'life:ducks';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // spread over the plot; ≤ MAX_DUCKS instances
      mesh.count = 0;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DUCKS * 3).fill(1), 3);
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    return true;
  }

  private draw(): void {
    if (!this.ensureMeshes()) return;
    const ducks = this.sim.ducks;
    const count = Math.min(ducks.length, MAX_DUCKS);
    for (let i = 0; i < count; i += 1) {
      const duck = ducks[i];
      this.position.set(duck.x, WATER_TOP - DRAFT + duck.bob, duck.z);
      this.euler.set(duck.pitch, duck.yaw, 0);
      this.quaternion.setFromEuler(this.euler);
      this.scale.setScalar(Math.max(duck.scale * this.tuning.scale, 0.0001));
      this.matrix.compose(this.position, this.quaternion, this.scale);
      for (const mesh of this.meshes) {
        mesh.setMatrixAt(i, this.matrix);
        mesh.setColorAt(i, duck.hen ? HEN_TINT : DRAKE_TINT);
      }
    }
    for (const mesh of this.meshes) {
      mesh.count = count;
      mesh.visible = this.tuning.visible && count > 0;
      if (count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
