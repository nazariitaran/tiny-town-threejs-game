/**
 * Ghost preview for the active tool (WP-05). Owned by ToolController, built from the
 * ModelLibrary it already receives (createObject API only). Never shares materials with the town:
 * each source material gets one translucent clone, re-tinted in place when the state changes.
 *
 *  - parts: one or more translucent models (an object, a fence, or the pieces of a ground tile:
 *    the auto-tiled road piece, the pavement tile, walkway hub + arms, lawn tufts / flowers),
 *    tinted valid (soft white-green), invalid (brick red) or remove (bulldoze target, pulsing)
 *  - tile:  a flat fill (ground colour, or the state tint) with a crisp square frame on top
 *
 * It follows the cursor with a light lerp, animates rotation over 100 ms, shakes on an invalid
 * click (±0.05 for 150 ms) and is hidden off-plot / outside the build phase.
 * Tints are not tone-mapped, so brick red stays brick red over the green field.
 */
import * as THREE from 'three';
import type { ModelId } from '../catalog/models';
import { CELL_SIZE } from '../game/config';
import type { ModelLibrary } from '../render/ModelLibrary';
import { shortestAngle } from './strokeMath';

export type GhostState = 'valid' | 'invalid' | 'remove' | 'neutral';

/** Brick red (design doc §6 accent) for both invalid and remove, on tiles and models alike. */
export const GHOST_TINTS: Readonly<Record<GhostState, string>> = {
  valid: '#dcffe2',
  invalid: '#d8392b',
  remove: '#d8392b',
  neutral: '#ffffff',
};

/** Tile fill opacity per state (fill = ground colour for ground tools, else the tint). */
const FILL_OPACITY: Readonly<Record<GhostState, number>> = { valid: 0.45, invalid: 0.62, remove: 0.62, neutral: 0.16 };
const FRAME_OPACITY: Readonly<Record<GhostState, number>> = { valid: 0.85, invalid: 0.95, remove: 0.95, neutral: 0.45 };

/** A model placed inside the ghost, in cell-local coordinates (before the ghost's own yaw). */
export interface GhostPart {
  model: ModelId;
  x?: number;
  y?: number;
  z?: number;
  quarterTurns?: number;
  scale?: number;
}

export interface GhostShowOptions {
  x: number;
  z: number;
  /** Yaw of the whole ghost in quarter turns (objects rotate with R; ground tiles use 0). */
  quarterTurns: number;
  state: GhostState;
  parts: readonly GhostPart[];
  /** Fill colour of the tile (ground tools show their own colour); defaults to the state tint. */
  fillColor?: string;
  /** Fill opacity override. */
  fillOpacity?: number;
  showTile?: boolean;
  /** Ground tiles: keep the parts' real colours and draw them nearly opaque (valid/neutral only). */
  solid?: boolean;
  /** Tile size in cells along [x, z] (e.g. a thin strip under a fence). */
  tileScale?: readonly [number, number];
  snap?: boolean;
}

export class GhostPreview {
  readonly root = new THREE.Group();
  readonly tuning = { followRate: 28, rotateDuration: 0.1, shakeAmplitude: 0.05, shakeDuration: 0.15, modelOpacity: 0.62 };

  private readonly tileGroup = new THREE.Group();
  private readonly fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly frame: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly modelHolder = new THREE.Group();
  /** Pooled model instances per id (a walkway ghost needs several arms). */
  private readonly pool = new Map<ModelId, THREE.Group[]>();
  private readonly active: THREE.Group[] = [];
  private readonly ghostMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private readonly baseColors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private readonly tint = new THREE.Color();
  private modelState: GhostState | null = null;
  private modelSolid = false;

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
    this.fill = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL_SIZE * 0.98, CELL_SIZE * 0.98).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GHOST_TINTS.neutral, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }),
    );
    this.fill.name = 'ghost-fill';
    this.fill.position.y = 0.036;
    this.fill.renderOrder = 10;
    // RingGeometry with 4 segments is a diamond; turned 45° it is a square frame (outer half-size 0.49, inner 0.43).
    this.frame = new THREE.Mesh(
      new THREE.RingGeometry(CELL_SIZE * 0.43 * Math.SQRT2, CELL_SIZE * 0.49 * Math.SQRT2, 4, 1)
        .rotateZ(Math.PI / 4)
        .rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GHOST_TINTS.neutral, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
    );
    this.frame.name = 'ghost-frame';
    this.frame.position.y = 0.04;
    this.frame.renderOrder = 12;
    this.tileGroup.add(this.fill, this.frame);
    this.root.add(this.tileGroup, this.modelHolder);
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

  show(options: GhostShowOptions): void {
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

    this.setParts(options.parts, options.state, options.solid ?? false);
    const tint = GHOST_TINTS[options.state];
    this.tileGroup.visible = options.showTile ?? true;
    this.tileGroup.scale.set(options.tileScale?.[0] ?? 1, 1, options.tileScale?.[1] ?? 1);
    this.fill.material.color.set(options.fillColor ?? tint);
    const baseFill = options.fillOpacity ?? FILL_OPACITY[options.state];
    this.fill.material.opacity = options.parts.length > 0 && !options.fillColor ? baseFill * 0.6 : baseFill;
    this.frame.material.color.set(tint);
    this.frame.material.opacity = FRAME_OPACITY[options.state];
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
    this.tileGroup.position.x = shakeOffset;
    if (this.modelState === 'remove') {
      // A gentle pulse so "this will be removed" reads even on red-brown models (fences, roofs).
      this.pulseTime += delta;
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * 9);
      for (const material of this.ghostMaterials.values()) material.emissiveIntensity = 0.4 + 0.45 * pulse;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.fill.geometry.dispose();
    this.fill.material.dispose();
    this.frame.geometry.dispose();
    this.frame.material.dispose();
    for (const material of this.ghostMaterials.values()) material.dispose();
    this.ghostMaterials.clear();
    this.pool.clear();
  }

  private setParts(parts: readonly GhostPart[], state: GhostState, solid: boolean): void {
    for (const group of this.active) group.visible = false;
    this.active.length = 0;
    const used = new Map<ModelId, number>();
    for (const part of parts) {
      if (!this.library.has(part.model)) continue;
      const index = used.get(part.model) ?? 0;
      used.set(part.model, index + 1);
      const group = this.instance(part.model, index);
      group.visible = true;
      group.position.set(part.x ?? 0, part.y ?? 0, part.z ?? 0);
      group.rotation.y = ((part.quarterTurns ?? 0) * Math.PI) / 2;
      group.scale.setScalar((part.scale ?? 1) * (state === 'remove' ? 1.08 : 1));
      this.active.push(group);
    }
    if (state !== this.modelState || solid !== this.modelSolid) {
      this.modelState = state;
      this.modelSolid = solid;
      this.tint.set(GHOST_TINTS[state]);
      for (const material of this.ghostMaterials.values()) this.applyTint(material, state);
    }
  }

  private instance(id: ModelId, index: number): THREE.Group {
    let list = this.pool.get(id);
    if (!list) {
      list = [];
      this.pool.set(id, list);
    }
    while (list.length <= index) {
      const group = this.library.createObject(id);
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
      this.modelHolder.add(group);
      list.push(group);
    }
    return list[index];
  }

  private ghostMaterial(source: THREE.Material): THREE.MeshStandardMaterial {
    let ghost = this.ghostMaterials.get(source);
    if (ghost) return ghost;
    const standard = source as THREE.MeshStandardMaterial;
    ghost = new THREE.MeshStandardMaterial({
      map: standard.map ?? null,
      color: standard.color ? standard.color.clone() : new THREE.Color('#ffffff'),
      vertexColors: standard.vertexColors ?? false,
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
    const solid = calm && this.modelSolid;
    // Red states replace most of the texture colour so every model reads the same brick red.
    if (base) material.color.copy(base).lerp(this.tint, solid ? 0 : calm ? 0.2 : 0.88);
    material.emissive.copy(this.tint);
    material.emissiveIntensity = solid ? 0.06 : calm ? 0.12 : 0.5;
    material.opacity = solid ? 0.95 : calm ? this.tuning.modelOpacity : 0.78;
  }
}
