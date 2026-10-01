/**
 * Lit material family, fixed at boot by `GraphicsProfile.material`: 'lambert' converts every lit
 * MeshStandardMaterial into an equivalent MeshLambertMaterial when it is created.
 * The models are flat atlas colours with roughness ≈ 1, so losing GGX specular costs little, and
 * three still lights Lambert with `scene.environment`. Lambert keeps the emissive fields and the
 * `begin_vertex` / `emissivemap_fragment` chunks the shader patches hook into.
 */
import * as THREE from 'three';
import type { GraphicsProfile } from '../game/graphics';

export type MaterialMode = GraphicsProfile['material'];

/** Either lit family: both have color, map, emissive, emissiveMap, emissiveIntensity. */
export type LitMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

/**
 * An equivalent MeshLambertMaterial sharing `source`'s textures. Lit fields are copied explicitly:
 * MeshLambertMaterial.copy would read Lambert-only fields off the standard material.
 * onBeforeCompile patches are not carried over: convert first, then patch.
 */
export function toLambert(source: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
  const out = new THREE.MeshLambertMaterial();
  THREE.Material.prototype.copy.call(out, source);
  out.color.copy(source.color);
  out.map = source.map;
  out.lightMap = source.lightMap;
  out.lightMapIntensity = source.lightMapIntensity;
  out.aoMap = source.aoMap;
  out.aoMapIntensity = source.aoMapIntensity;
  out.emissive.copy(source.emissive);
  out.emissiveIntensity = source.emissiveIntensity;
  out.emissiveMap = source.emissiveMap;
  out.bumpMap = source.bumpMap;
  out.bumpScale = source.bumpScale;
  out.normalMap = source.normalMap;
  out.normalMapType = source.normalMapType;
  out.normalScale.copy(source.normalScale);
  out.displacementMap = source.displacementMap;
  out.displacementScale = source.displacementScale;
  out.displacementBias = source.displacementBias;
  out.alphaMap = source.alphaMap;
  out.envMap = source.envMap;
  out.envMapRotation.copy(source.envMapRotation);
  out.envMapIntensity = source.envMapIntensity;
  out.wireframe = source.wireframe;
  out.wireframeLinewidth = source.wireframeLinewidth;
  out.flatShading = source.flatShading;
  out.fog = source.fog;
  return out;
}

/** `material` in the requested family: under 'lambert' a MeshStandardMaterial becomes a new Lambert and the source is disposed. */
export function litMaterial<T extends THREE.Material>(material: T, mode: MaterialMode): T | THREE.MeshLambertMaterial {
  if (mode !== 'lambert') return material;
  const standard = material as unknown as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial) return material;
  const lambert = toLambert(standard);
  material.dispose();
  return lambert;
}

/** A new lit material from MeshStandardMaterial parameters, in the requested family. */
export function createLitMaterial(params: THREE.MeshStandardMaterialParameters, mode: MaterialMode): LitMaterial {
  const standard = new THREE.MeshStandardMaterial(params);
  return mode === 'lambert' ? (litMaterial(standard, mode) as THREE.MeshLambertMaterial) : standard;
}

/** null for unlit materials. */
export function materialFamily(material: THREE.Material): MaterialMode | null {
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return 'standard';
  if ((material as THREE.MeshLambertMaterial).isMeshLambertMaterial) return 'lambert';
  return null;
}
