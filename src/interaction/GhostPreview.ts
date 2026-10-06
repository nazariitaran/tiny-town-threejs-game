/**
 * Translucent preview of the active tool's target. Each source material gets its own ghost clone,
 * never shared with the town, re-tinted in place when the state changes.
 *
 *  - parts: models posed exactly as the town draws them. A remove or selected ghost lies on the
 *    object itself and is pulled towards the camera in depth, so it paints that object's visible
 *    surfaces without hidden faces showing through.
 *  - tile: a flat fill with a rectangular frame of constant border width, sized in cells.
 *
 * Tints are not tone-mapped, so brick red stays brick red over the green field.
 */
import * as THREE from 'three';
import type { ModelId } from '../catalog/models';
import type { ObjectDef } from '../catalog/objects';
import { applyWindSway } from '../fx/windSway';
import { CELL_SIZE, GROUND_Y } from '../game/config';
import { createLitMaterial, type LitMaterial } from '../render/materials';
import type { ModelLibrary } from '../render/ModelLibrary';
import { objectPose, styleScale } from '../render/objectPose';
import type { Rotation } from '../town/types';
import { shortestAngle } from './strokeMath';

export type GhostState = 'valid' | 'invalid' | 'remove' | 'selected' | 'neutral';

/** Model tint / rim per state. Valid is a cool mint that separates from the warm yellow-green field. */
export const GHOST_TINTS: Readonly<Record<GhostState, string>> = {
  valid: '#7dffc0',
  invalid: '#d8392b',
  remove: '#d8392b',
  selected: '#4a9be8',
  neutral: '#ffffff',
};

/** Tile fill colour when no ground colour is given. */
const FILL_COLORS: Readonly<Record<GhostState, string>> = { valid: '#c4ffe4', invalid: '#d8392b', remove: '#d8392b', selected: '#4a9be8', neutral: '#ffffff' };
const FRAME_COLORS: Readonly<Record<GhostState, string>> = { valid: '#f4fffa', invalid: '#d8392b', remove: '#d8392b', selected: '#4a9be8', neutral: '#ffffff' };
const FILL_OPACITY: Readonly<Record<GhostState, number>> = { valid: 0.5, invalid: 0.62, remove: 0.62, selected: 0.45, neutral: 0.16 };
const FRAME_OPACITY: Readonly<Record<GhostState, number>> = { valid: 1, invalid: 0.95, remove: 0.95, selected: 0.95, neutral: 0.45 };
const GLOW_COLOR = '#56f5a8';
const GLOW_OPACITY = 0.42;
const RIM_STRENGTH: Readonly<Record<GhostState, number>> = { valid: 1.1, invalid: 0.5, remove: 0.6, selected: 0.8, neutral: 0.3 };
/**
 * Red states (invalid, remove): how far the surface colour goes to the tint. Applied in the shader
 * after the colour atlas and vertex colours, so a green roof turns red, not red × green = brown.
 */
const RED_RECOLOR = 0.88;
const REMOVE_OPACITY = 0.9;
/** Lighter than RED_RECOLOR, so the object's own colours still show through. */
const SELECTED_RECOLOR = 0.6;
const SELECTED_OPACITY = 0.7;

/** States drawn exactly on a town object (bulldoze target, Move selection). */
const onObject = (state: GhostState): boolean => state === 'remove' || state === 'selected';

/** A model placed inside the ghost, in cell-local coordinates (before the ghost's own yaw). */
/** Lift of a ghost whose own ground lies at or below ground level (road pieces, slabs), so the field under it does not cover it. */
export const GROUND_GHOST_LIFT = GROUND_Y + 0.002;

export interface GhostPart {
  model: ModelId;
  x?: number;
  y?: number;
  z?: number;
  quarterTurns?: number;
  /** Yaw in radians; overrides quarterTurns (a placed tree's hashed yaw). */
  yaw?: number;
  scale?: number;
  /** Extra vertical stretch (a tree taller than its kit model). */
  scaleY?: number;
}

/**
 * The ghost part of an object's model, posed as TownRenderer draws it, with the ghost root at the
 * footprint centre. A placement preview passes rotation 0 and id null and turns the root instead (so
 * R animates); a bulldoze target passes the placed object's rotation and id (a tree's own yaw and size).
 */
export function objectGhostPart(def: ObjectDef, model: ModelId, rotation: Rotation, id: number | null): GhostPart {
  const pose = objectPose(def, rotation, id);
  return { model, yaw: pose.yaw, scale: pose.scale, scaleY: pose.scaleY, y: def.roadFeature || def.coversGround ? GROUND_GHOST_LIFT : undefined };
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
  fillOpacity?: number;
  showTile?: boolean;
  /** Ground tiles: keep the parts' real colours and draw them nearly opaque (valid/neutral only). */
  solid?: boolean;
  /** Tile size in cells along [x, z] (a footprint, a road block, a thin strip under a fence). */
  tileScale?: readonly [number, number];
  snap?: boolean;
}

export class GhostPreview {
  readonly root = new THREE.Group();
  readonly tuning = { followRate: 28, rotateDuration: 0.1, shakeAmplitude: 0.05, shakeDuration: 0.15, modelOpacity: 0.82 };

  private readonly tileGroup = new THREE.Group();
  private readonly fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly frame: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private tileW = 0;
  private tileD = 0;
  /** Shared by every ghost material's shader patch, updated in place. */
  private readonly ghostUniforms = {
    uGhostRimColor: { value: new THREE.Color(GHOST_TINTS.valid) },
    uGhostRimStrength: { value: 1 },
    uGhostRecolor: { value: 0 },
  };
  private glowTime = 0;
  private tileState: GhostState = 'neutral';
  private readonly modelHolder = new THREE.Group();
  /** Pooled model instances per id (a walkway ghost needs several arms). */
  private readonly pool = new Map<ModelId, THREE.Group[]>();
  private readonly active: THREE.Group[] = [];
  private readonly ghostMaterials = new Map<THREE.Material, LitMaterial>();
  private readonly baseColors = new Map<LitMaterial, THREE.Color>();
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
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GHOST_TINTS.neutral, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }),
    );
    this.fill.name = 'ghost-fill';
    this.fill.position.y = 0.036;
    this.fill.renderOrder = 10;
    this.frame = new THREE.Mesh(
      rectRingGeometry(),
      new THREE.MeshBasicMaterial({ color: GHOST_TINTS.neutral, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
    );
    this.frame.name = 'ghost-frame';
    this.frame.position.y = 0.04;
    this.frame.renderOrder = 12;
    // Additive, so the glow brightens the field rather than covering it.
    this.glow = new THREE.Mesh(
      rectRingGeometry(),
      new THREE.MeshBasicMaterial({
        color: GLOW_COLOR,
        transparent: true,
        opacity: GLOW_OPACITY,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.name = 'ghost-glow';
    this.glow.position.y = 0.038;
    this.glow.renderOrder = 11;
    this.tileGroup.add(this.fill, this.glow, this.frame);
    this.setTileSize(1, 1);
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
    const state = options.state;
    this.tileState = state;
    this.tileGroup.visible = options.showTile ?? true;
    this.setTileSize(options.tileScale?.[0] ?? 1, options.tileScale?.[1] ?? 1);
    this.fill.material.color.set(options.fillColor ?? FILL_COLORS[state]);
    const baseFill = options.fillOpacity ?? FILL_OPACITY[state];
    this.fill.material.opacity = options.parts.length > 0 && !options.fillColor ? baseFill * 0.6 : baseFill;
    this.frame.material.color.set(FRAME_COLORS[state]);
    this.frame.material.opacity = FRAME_OPACITY[state];
    this.glow.visible = state === 'valid';
  }

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
    if (this.tileState === 'valid') {
      this.glowTime += delta;
      this.glow.material.opacity = GLOW_OPACITY * (0.75 + 0.25 * Math.sin(this.glowTime * 4));
    }
    if (this.modelState === 'remove') {
      // A gentle pulse so "this will be removed" reads even on red-brown models (fences, roofs).
      this.pulseTime += delta;
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * 9);
      for (const material of this.ghostMaterials.values()) material.emissiveIntensity = 0.4 + 0.45 * pulse;
    } else if (this.modelState === 'selected') {
      // Slow breathing, calmer than the bulldoze pulse.
      this.pulseTime += delta;
      const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * 3.5);
      for (const material of this.ghostMaterials.values()) material.emissiveIntensity = 0.15 + 0.25 * pulse;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.fill.geometry.dispose();
    this.fill.material.dispose();
    this.frame.geometry.dispose();
    this.frame.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
    for (const material of this.ghostMaterials.values()) material.dispose();
    this.ghostMaterials.clear();
    this.pool.clear();
  }

  private setTileSize(w: number, d: number): void {
    if (w === this.tileW && d === this.tileD) return;
    this.tileW = w;
    this.tileD = d;
    const hx = (w * CELL_SIZE) / 2;
    const hz = (d * CELL_SIZE) / 2;
    this.fill.scale.set(w * CELL_SIZE * 0.98, 1, d * CELL_SIZE * 0.98);
    const border = Math.min(0.09 * CELL_SIZE, hx * 0.5, hz * 0.5);
    writeRectRing(this.frame.geometry, hx - border, hz - border, hx, hz);
    writeRectRing(this.glow.geometry, hx, hz, hx + 0.12 * CELL_SIZE, hz + 0.12 * CELL_SIZE);
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
      group.rotation.y = part.yaw ?? ((part.quarterTurns ?? 0) * Math.PI) / 2;
      const size = part.scale ?? 1;
      const [sx, sy, sz] = styleScale(part.model);
      group.scale.set(size * sx, size * (part.scaleY ?? 1) * sy, size * sz);
      this.active.push(group);
    }
    if (state !== this.modelState || solid !== this.modelSolid) {
      this.modelState = state;
      this.modelSolid = solid;
      this.tint.set(GHOST_TINTS[state]);
      this.ghostUniforms.uGhostRimColor.value.copy(this.tint);
      this.ghostUniforms.uGhostRimStrength.value = solid && state === 'valid' ? 0.35 : RIM_STRENGTH[state];
      this.ghostUniforms.uGhostRecolor.value = state === 'invalid' || state === 'remove' ? RED_RECOLOR : state === 'selected' ? SELECTED_RECOLOR : 0;
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

  private ghostMaterial(source: THREE.Material): LitMaterial {
    let ghost = this.ghostMaterials.get(source);
    if (ghost) return ghost;
    const standard = source as LitMaterial;
    // Same lit family as the library; the rim patch's chunks and varyings exist in both.
    ghost = createLitMaterial({
      map: standard.map ?? null,
      color: standard.color ? standard.color.clone() : new THREE.Color('#ffffff'),
      vertexColors: standard.vertexColors ?? false,
      roughness: 0.8,
      metalness: 0,
      transparent: true,
      opacity: this.tuning.modelOpacity,
      depthWrite: false,
    }, this.library.materialMode);
    ghost.name = `ghost:${source.name}`;
    // Fresnel rim in the state colour; red and selected states pull the surface colour (atlas texel ×
    // vertex colour × material colour) to the tint. Shared uniforms: one extra program for all ghosts.
    const uniforms = this.ghostUniforms;
    ghost.onBeforeCompile = (shader) => {
      shader.uniforms.uGhostRimColor = uniforms.uGhostRimColor;
      shader.uniforms.uGhostRimStrength = uniforms.uGhostRimStrength;
      shader.uniforms.uGhostRecolor = uniforms.uGhostRecolor;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uGhostRimColor;\nuniform float uGhostRimStrength;\nuniform float uGhostRecolor;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uGhostRimColor, uGhostRecolor);')
        .replace(
          '#include <opaque_fragment>',
          'float ghostRim = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.0);\n' +
            'outgoingLight += uGhostRimColor * ghostRim * uGhostRimStrength;\n#include <opaque_fragment>',
        );
    };
    ghost.customProgramCacheKey = () => 'tiny-town-ghost-rim';
    // Foliage sways like the town's copy, so a remove ghost stays on its tree. Chains after the rim patch.
    if (source.userData.windSway) applyWindSway(ghost);
    this.baseColors.set(ghost, ghost.color.clone());
    this.ghostMaterials.set(source, ghost);
    if (this.modelState) this.applyTint(ghost, this.modelState);
    return ghost;
  }

  private applyTint(material: LitMaterial, state: GhostState): void {
    const base = this.baseColors.get(material);
    const calm = state === 'valid' || state === 'neutral';
    const solid = calm && this.modelSolid;
    // Red and selected states keep the base colour: the shader recolours the textured colour
    // (uGhostRecolor), so every model reads the same brick red / sky blue. Calm states only lean to the tint.
    if (base) material.color.copy(base).lerp(this.tint, solid || !calm ? 0 : state === 'valid' ? 0.15 : 0.2);
    material.emissive.copy(this.tint);
    material.emissiveIntensity = solid ? 0.06 : state === 'valid' ? 0.2 : calm ? 0.12 : state === 'selected' ? 0.3 : 0.5;
    material.opacity = solid
      ? 0.95
      : calm
      ? this.tuning.modelOpacity
      : state === 'remove'
      ? REMOVE_OPACITY
      : state === 'selected'
      ? SELECTED_OPACITY
      : 0.78;
    // Ground ghosts lie exactly on the tile they replace and on-object ghosts on their object: pull them
    // towards the camera in depth so they win on shared surfaces (no z-fighting), while the town's depth
    // still hides the ghost's own back and inner faces.
    const offset = this.modelSolid || onObject(state);
    material.polygonOffset = offset;
    material.polygonOffsetFactor = offset ? -1 : 0;
    material.polygonOffsetUnits = offset ? -4 : 0;
  }
}

/** A flat (y = 0) rectangular ring: 8 vertices (outer corners 0–3, inner 4–7), 8 triangles. */
function rectRingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
  const index: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    // Outer i, outer j, inner j / outer i, inner j, inner i (counter-clockwise seen from above).
    index.push(i, 4 + j, j, i, 4 + i, 4 + j);
  }
  geometry.setIndex(index);
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  return geometry;
}

/** Rewrite a rectRingGeometry for inner half-extents (ix, iz) and outer (ox, oz). */
function writeRectRing(geometry: THREE.BufferGeometry, ix: number, iz: number, ox: number, oz: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let i = 0; i < 4; i += 1) {
    position.setXYZ(i, corners[i * 2] * ox, 0, corners[i * 2 + 1] * oz);
    position.setXYZ(4 + i, corners[i * 2] * ix, 0, corners[i * 2 + 1] * iz);
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}
