/**
 * Lit material family (WP-25 graphics presets). `GraphicsProfile.material` is fixed at boot:
 * 'standard' keeps three's MeshStandardMaterial everywhere; 'lambert' converts every lit
 * MeshStandardMaterial into an equivalent MeshLambertMaterial when it is created (ModelLibrary's
 * GLTF materials, TownRenderer's slabs, the terrain, cars, birds, the ghost).
 *
 * Why Lambert is nearly free visually: the Kenney models use flat atlas colours with roughness ≈ 1,
 * so the GGX specular term adds almost nothing. three r184 still lights Lambert with
 * `scene.environment` (diffuse irradiance from the PMREM, `WebGLPrograms` getParameters), so the
 * env lighting and its day/night intensity carry over; only the (tiny) env specular is lost.
 * Lambert keeps `emissive` / `emissiveMap` / `emissiveIntensity` (night glow masks) and the same
 * `begin_vertex` / `emissivemap_fragment` chunks the wind-sway, window-stagger and wing-flap
 * patches hook into, so patches are applied after conversion exactly as before.
 */
import * as THREE from 'three';
import type { GraphicsProfile } from '../game/graphics';

export type MaterialMode = GraphicsProfile['material'];

/** Either lit family: both have color, map, emissive, emissiveMap, emissiveIntensity. */
export type LitMaterial = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

/**
 * An equivalent MeshLambertMaterial for `source`. Base Material state (name, side, transparent,
 * opacity, alphaTest, vertexColors, depth / blending / polygon offset, toneMapped, userData, …)
 * is copied by Material.copy; the lit maps and colours are copied explicitly (MeshLambertMaterial.copy
 * would read Lambert-only fields such as `combine` / `specularMap` off the standard material).
 * Textures are shared, not cloned. onBeforeCompile patches are NOT carried over: convert first,
 * then patch.
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

/**
 * `material` in the requested family: under 'lambert' a lit MeshStandardMaterial (or Physical)
 * becomes a new MeshLambertMaterial and the source is disposed; everything else (Basic, Shader,
 * Depth, already-Lambert, or mode 'standard') is returned unchanged.
 */
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

/** What a material actually is ('standard' | 'lambert' | null for unlit ones), for diagnostics / tests. */
export function materialFamily(material: THREE.Material): MaterialMode | null {
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return 'standard';
  if ((material as THREE.MeshLambertMaterial).isMeshLambertMaterial) return 'lambert';
  return null;
}
