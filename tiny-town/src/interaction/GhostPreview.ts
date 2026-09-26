/**
 * Ghost preview for the active tool (WP-05). Owned by ToolController, built from the
 * ModelLibrary it already receives (createObject API only). Never shares materials with the town:
 * each source material gets one translucent clone, re-tinted in place when the state changes.
 *
 *  - model: translucent model at the hovered footprint/edge, tinted valid (soft white-green),
 *    invalid (red) or remove (bulldoze target, brick red, slightly enlarged)
 *  - tile:  flat tinted tile (ground tools, bulldoze on ground, plain pointer highlight)
 *
 * It follows the cursor with a light lerp, animates rotation over 100 ms, shakes on an invalid
 * click (±0.05 for 150 ms) and is hidden off-plot / outside the build phase.
 */
import * as THREE from 'three';
import type { ModelId } from '../catalog/models';
import { CELL_SIZE } from '../game/config';
import type { ModelLibrary } from '../render/ModelLibrary';
import { shortestAngle } from './strokeMath';

export type GhostState = 'valid' | 'invalid' | 'remove' | 'neutral';

const TINTS: Readonly<Record<GhostState, string>> = {
  valid: '#d9ffe0',
  invalid: '#ff4a3d',
  remove: '#e0473f',
  neutral: '#ffffff',
};

const TILE_OPACITY: Readonly<Record<GhostState, number>> = { valid: 0.5, invalid: 0.5, remove: 0.7, neutral: 0.22 };

export class GhostPreview {
  readonly root = new THREE.Group();
  readonly tuning = { followRate: 28, rotateDuration: 0.1, shakeAmplitude: 0.05, shakeDuration: 0.15, modelOpacity: 0.6 };

  private readonly tile: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly modelHolder = new THREE.Group();
  private readonly models = new Map<ModelId, THREE.Group>();
  private readonly ghostMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private readonly baseColors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private readonly tint = new THREE.Color();
  private currentModel: THREE.Group | null = null;
  private modelState: GhostState | null = null;

  private readonly targetPosition = new THREE.Vector3();
  private targetYaw = 0;
  private yawFrom = 0;
  private yawProgress = 1;
  private yaw = 0;
  private shakeTime = 0;
  private pulseTime = 0;
  private visible = false;

  constructor(
    scene: THREE.Scene,
    private readonly library: ModelLibrary,
  ) {
    this.root.name = 'ghost-preview';
    this.tile = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: TINTS.neutral, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.tile.name = 'ghost-tile';
    this.tile.position.y = 0.035;
    this.tile.renderOrder = 10;
    this.root.add(this.tile, this.modelHolder);
    this.root.visible = false;
    scene.add(this.root);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    this.visible = false;
    this.root.visible = false;
  }

  /**
   * Show at world (x, z) with a yaw in quarter turns. `model` null = tile only. `tileColor`
   * overrides the tile tint (ground tools show their own colour when valid). `showTile` false
   * hides the footprint tile under a model (fences).
   */
  show(options: {
    x: number;
    z: number;
    quarterTurns: number;
    state: GhostState;
    model: ModelId | null;
    tileColor?: string;
    showTile?: boolean;
    /** Tile size in cells along [x, z] (e.g. a thin strip under a fence). */
    tileScale?: readonly [number, number];
    snap?: boolean;
  }): void {
    const wasVisible = this.visible;
    this.visible = true;
    this.root.visible = true;
    this.targetPosition.set(options.x, 0, options.z);
    if (!wasVisible || options.snap) this.root.position.copy(this.targetPosition);

    const yaw = (options.quarterTurns * Math.PI) / 2;
    if (!wasVisible || options.snap) {
      this.yaw = yaw;
      this.targetYaw = yaw;
      this.yawProgress = 1;
    } else if (Math.abs(shortestAngle(this.targetYaw, yaw)) > 1e-4) {
      this.yawFrom = this.yaw;
      this.targetYaw = this.yaw + shortestAngle(this.yaw, yaw);
      this.yawProgress = 0;
    }

    this.setModel(options.model, options.state);
    this.tile.visible = options.showTile ?? true;
    this.tile.scale.set(options.tileScale?.[0] ?? 1, 1, options.tileScale?.[1] ?? 1);
    this.tile.material.color.set(options.tileColor ?? TINTS[options.state]);
    this.tile.material.opacity = options.model ? TILE_OPACITY[options.state] * 0.6 : TILE_OPACITY[options.state];
  }

  /** Invalid click feedback: a quick sideways shake. */
  shake(): void {
    this.shakeTime = this.tuning.shakeDuration;
  }

  update(delta: number): void {
    if (!this.visible) return;
    const follow = 1 - Math.exp(-this.tuning.followRate * delta);
    this.root.position.x += (this.targetPosition.x - this.root.position.x) * follow;
    this.root.position.z += (this.targetPosition.z - this.root.position.z) * follow;

    if (this.yawProgress < 1) {
      this.yawProgress = Math.min(1, this.yawProgress + delta / this.tuning.rotateDuration);
      const k = 1 - (1 - this.yawProgress) ** 2;
      this.yaw = this.yawFrom + (this.targetYaw - this.yawFrom) * k;
    } else {
      this.yaw = this.targetYaw;
    }
    this.modelHolder.rotation.y = this.yaw;

    let shakeOffset = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      const t = this.tuning.shakeDuration - this.shakeTime;
      const decay = this.shakeTime / this.tuning.shakeDuration;
      shakeOffset = Math.sin(t * 90) * this.tuning.shakeAmplitude * decay;
    }
    this.modelHolder.position.x = shakeOffset;
    if (this.modelState === 'remove') {
      // A gentle pulse so "this will be removed" reads even on red-brown models (fences, roofs).
      this.pulseTime += delta;
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * 9);
      for (const material of this.ghostMaterials.values()) material.emissiveIntensity = 0.45 + 0.5 * pulse;
    }
    this.tile.position.x = shakeOffset;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.tile.geometry.dispose();
    this.tile.material.dispose();
    for (const material of this.ghostMaterials.values()) material.dispose();
    this.ghostMaterials.clear();
    this.models.clear();
  }

  private setModel(id: ModelId | null, state: GhostState): void {
    const next = id && this.library.has(id) ? this.modelFor(id) : null;
    if (next !== this.currentModel) {
      if (this.currentModel) this.currentModel.visible = false;
      if (next) next.visible = true;
      this.currentModel = next;
    }
    if (next) next.scale.setScalar(state === 'remove' ? 1.08 : 1);
    if (state !== this.modelState) {
      this.modelState = state;
      this.tint.set(TINTS[state]);
      for (const material of this.ghostMaterials.values()) this.applyTint(material, state);
    }
  }

  private modelFor(id: ModelId): THREE.Group {
    let group = this.models.get(id);
    if (group) return group;
    group = this.library.createObject(id);
    group.name = `ghost:${id}`;
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 11;
      mesh.material = this.ghostMaterial(mesh.material as THREE.Material);
    });
    group.visible = false;
    this.models.set(id, group);
    this.modelHolder.add(group);
    return group;
  }

  private ghostMaterial(source: THREE.Material): THREE.MeshStandardMaterial {
    let ghost = this.ghostMaterials.get(source);
    if (ghost) return ghost;
    const standard = source as THREE.MeshStandardMaterial;
    ghost = new THREE.MeshStandardMaterial({
      map: standard.map ?? null,
      color: standard.color ? standard.color.clone() : new THREE.Color('#ffffff'),
      roughness: 0.8,
      metalness: 0,
      transparent: true,
      opacity: this.tuning.modelOpacity,
      depthWrite: false,
    });
    ghost.name = `ghost:${source.name}`;
    this.baseColors.set(ghost, ghost.color.clone());
    this.ghostMaterials.set(source, ghost);
    if (this.modelState) this.applyTint(ghost, this.modelState);
    return ghost;
  }

  private applyTint(material: THREE.MeshStandardMaterial, state: GhostState): void {
    const base = this.baseColors.get(material);
    const calm = state === 'valid' || state === 'neutral';
    if (base) material.color.copy(base).lerp(this.tint, calm ? 0.25 : state === 'remove' ? 0.9 : 0.65);
    material.emissive.copy(this.tint);
    material.emissiveIntensity = calm ? 0.18 : 0.45;
    material.opacity = state === 'invalid' ? this.tuning.modelOpacity * 0.85 : state === 'remove' ? 0.8 : this.tuning.modelOpacity;
  }
}
