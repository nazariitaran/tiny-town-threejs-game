/**
 * Loads every GLB in MODELS once and exposes normalised templates: scaled to world units, front
 * facing +z, footprint-centred at the origin with the base on y = 0.
 *  - Materials are shared by (atlas image + parameters), and each model is merged into one geometry
 *    per material, so part matrices are identity.
 *  - `sway` models get private wind-sway clones; `glow` models share one glow clone per
 *    (source material, glow kind), so houses with windows still share pools and draw calls.
 *  - Under 'lambert' every shared GLTF material is converted before any clone or patch.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODELS, type GlowKind, type ModelId } from '../catalog/models';
import { assetUrl } from '../game/config';
import { applyWindSway } from '../fx/windSway';
import { litMaterial, type MaterialMode } from './materials';
import { GlowRegistry } from './nightGlow';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Transform of this part inside the normalised model space (identity after merging). */
  matrix: THREE.Matrix4;
}

export interface ModelTemplate {
  id: ModelId;
  parts: ModelPart[];
  /** Bounds in normalised model space. */
  bounds: THREE.Box3;
  /** Triangles drawn per instance of this model. */
  triangles: number;
}

/** Anisotropy requested for colour atlases (three clamps it to the GPU maximum). */
const ANISOTROPY = 8;

export class ModelLibrary {
  private readonly templates = new Map<ModelId, ModelTemplate>();
  private readonly loader = new GLTFLoader();
  /** Shared materials keyed by texture source + parameters. */
  private readonly materials = new Map<string, THREE.Material>();
  /** Textures kept alive by shared materials (deduplicated by source image URL). */
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly swayMaterials = new Set<THREE.Material>();
  /** Private night-glow clones keyed by `${source material uuid}|${kind}`. */
  private readonly glowMaterials = new Map<string, THREE.Material>();
  /** Night glow masks, intensity and the window stagger uniforms. */
  readonly glow = new GlowRegistry();

  /** Fixed at boot; TownRenderer and GhostPreview follow it. */
  constructor(readonly materialMode: MaterialMode = 'standard') {}

  async loadAll(onProgress?: (loaded: number, total: number, label: string) => void): Promise<void> {
    const ids = Object.keys(MODELS) as ModelId[];
    let loaded = 0;
    const results = await Promise.all(
      ids.map(async (id) => {
        const url = assetUrl(MODELS[id].url);
        const gltf = await this.loader.loadAsync(url);
        loaded += 1;
        onProgress?.(loaded, ids.length, id);
        return { id, gltf, url };
      }),
    );
    // Normalise in catalog order (not network order) so the shared-material choice is deterministic.
    for (const { id, gltf, url } of results) this.templates.set(id, this.normalise(id, gltf, url));
  }

  has(id: ModelId): boolean {
    return this.templates.has(id);
  }

  get(id: ModelId): ModelTemplate {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Model not loaded: ${id}`);
    return template;
  }

  /** Distinct materials in use (shared + sway clones + glow clones), for diagnostics. */
  get materialCount(): number {
    return this.materials.size + this.swayMaterials.size + this.glowMaterials.size;
  }

  get textureCount(): number {
    return this.textures.size;
  }

  /** A plain (non-instanced) Object3D of the model; shares GPU resources. */
  createObject(id: ModelId): THREE.Group {
    const group = new THREE.Group();
    group.name = `model:${id}`;
    for (const part of this.get(id).parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(part.matrix);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  dispose(): void {
    for (const template of this.templates.values()) for (const part of template.parts) part.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const material of this.swayMaterials) material.dispose();
    for (const material of this.glowMaterials.values()) material.dispose();
    this.glow.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.templates.clear();
    this.materials.clear();
    this.swayMaterials.clear();
    this.glowMaterials.clear();
    this.textures.clear();
  }

  private normalise(id: ModelId, gltf: GLTF, fileUrl: string): ModelTemplate {
    const spec = MODELS[id];
    const scene = gltf.scene;
    // Scale and quarter-turn so the front faces +z, then put the base on y = 0 and the footprint
    // centre at the origin (plus the catalog offset).
    const root = new THREE.Group();
    root.add(scene);
    scene.scale.setScalar(spec.scale);
    scene.rotation.y = (spec.rotationOffset * Math.PI) / 2;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const centre = bounds.getCenter(new THREE.Vector3());
    const [ox, oy, oz] = spec.offset ?? [0, 0, 0];
    scene.position.set(-centre.x + ox, -bounds.min.y + oy, -centre.z + oz);
    root.updateMatrixWorld(true);

    // Bake every mesh into model space, grouped by its shared material.
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const sourceGeometries = new Set<THREE.BufferGeometry>();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.length > 1) console.warn(`[models] ${id}: multi-material mesh, using first material`);
      const material = this.shareMaterial(materials[0], gltf, fileUrl);
      sourceGeometries.add(mesh.geometry);
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const list = byMaterial.get(material) ?? [];
      list.push(geometry);
      byMaterial.set(material, list);
    });
    for (const geometry of sourceGeometries) geometry.dispose();

    const parts: ModelPart[] = [];
    let triangles = 0;
    for (const [shared, geometries] of byMaterial) {
      let material = shared;
      if (spec.sway) {
        // Foliage gets a private clone so the wind-sway shader patch never leaks onto shared materials.
        material = shared.clone();
        material.name = `${shared.name}:sway:${id}`;
        applyWindSway(material);
        this.swayMaterials.add(material);
      }
      if (spec.glow) material = this.glowMaterial(material, spec.glow);
      const geometry = mergeParts(id, geometries);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
      parts.push({ geometry, material, matrix: new THREE.Matrix4() });
    }
    return { id, parts, bounds, triangles: Math.round(triangles) };
  }

  /** The private glow clone of `source` for `kind` (one per pair, shared by every model using it). */
  private glowMaterial(source: THREE.Material, kind: GlowKind): THREE.Material {
    const key = `${source.uuid}|${kind}`;
    let material = this.glowMaterials.get(key);
    if (!material) {
      material = this.glow.createClone(source, kind);
      this.glowMaterials.set(key, material);
    }
    return material;
  }

  /** Map a GLTF material onto a shared one (same atlas image + same parameters ⇒ same material). */
  private shareMaterial(material: THREE.Material, gltf: GLTF, fileUrl: string): THREE.Material {
    const standard = material as THREE.MeshStandardMaterial;
    const imageKey = standard.map ? this.imageKey(standard.map, gltf, fileUrl) : 'none';
    const key = [
      material.type,
      imageKey,
      standard.color?.getHexString() ?? '',
      standard.emissive?.getHexString() ?? '',
      standard.metalness ?? '',
      standard.roughness ?? '',
      material.transparent,
      material.opacity,
      material.side,
      material.vertexColors,
      material.alphaTest,
    ].join('|');
    const existing = this.materials.get(key);
    if (existing) return existing;
    if (standard.map) {
      const shared = this.textures.get(imageKey);
      if (shared) {
        standard.map = shared;
      } else {
        standard.map.colorSpace = THREE.SRGBColorSpace;
        standard.map.anisotropy = ANISOTROPY;
        standard.map.needsUpdate = true;
        this.textures.set(imageKey, standard.map);
      }
    }
    const shared = litMaterial(material, this.materialMode);
    this.materials.set(key, shared);
    return shared;
  }

  /** The texture's source image identity: resolved URL for external images, file-scoped for embedded ones. */
  private imageKey(texture: THREE.Texture, gltf: GLTF, fileUrl: string): string {
    const mapping = gltf.parser.associations.get(texture) as { textures?: number } | undefined;
    const json = gltf.parser.json as { textures?: Array<{ source?: number }>; images?: Array<{ uri?: string }> };
    if (mapping?.textures !== undefined) {
      const source = json.textures?.[mapping.textures]?.source;
      if (source !== undefined) {
        const uri = json.images?.[source]?.uri;
        if (uri && !uri.startsWith('data:')) return new URL(uri, new URL(fileUrl, window.location.href)).href;
        return `${fileUrl}#image${source}`;
      }
    }
    return `${fileUrl}#texture:${texture.uuid}`;
  }
}

/** Merge same-material geometries of one model into one (attributes reduced to the common set). */
function mergeParts(id: ModelId, geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 1) return geometries[0];
  const common = Object.keys(geometries[0].attributes).filter((name) => geometries.every((g) => g.getAttribute(name)));
  const allIndexed = geometries.every((g) => g.index);
  const prepared = geometries.map((g) => {
    const source = allIndexed || !g.index ? g : g.toNonIndexed();
    for (const name of Object.keys(source.attributes)) if (!common.includes(name)) source.deleteAttribute(name);
    source.morphAttributes = {};
    return source;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) {
    console.warn(`[models] ${id}: could not merge meshes, keeping the first only`);
    return prepared[0];
  }
  for (const g of new Set([...geometries, ...prepared])) g.dispose();
  return merged;
}
