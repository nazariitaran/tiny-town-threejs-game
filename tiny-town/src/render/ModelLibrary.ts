/**
 * Loads every GLB in MODELS once and exposes normalised templates:
 * scaled to world units, rotated so the model's front faces +z, footprint-centred
 * at the origin with its base on y = 0. Consumers never touch raw GLTF scenes.
 *
 * SCAFFOLD BASELINE — WP-03 (Rendering) owns this file. TODO(WP-03): share one
 * material per texture atlas across all models, texture filtering/anisotropy,
 * merge each model's meshes per material for instancing, diagnostics (tris per model).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODELS, type ModelId } from '../catalog/models';
import { assetUrl } from '../game/config';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Transform of this part inside the normalised model space. */
  matrix: THREE.Matrix4;
}

export interface ModelTemplate {
  id: ModelId;
  parts: ModelPart[];
  /** Bounds in normalised model space. */
  bounds: THREE.Box3;
}

export class ModelLibrary {
  private readonly templates = new Map<ModelId, ModelTemplate>();
  private readonly loader = new GLTFLoader();

  async loadAll(onProgress?: (loaded: number, total: number, label: string) => void): Promise<void> {
    const ids = Object.keys(MODELS) as ModelId[];
    let loaded = 0;
    await Promise.all(
      ids.map(async (id) => {
        const spec = MODELS[id];
        const gltf = await this.loader.loadAsync(assetUrl(spec.url));
        this.templates.set(id, this.normalise(id, gltf.scene));
        loaded += 1;
        onProgress?.(loaded, ids.length, id);
      }),
    );
  }

  has(id: ModelId): boolean {
    return this.templates.has(id);
  }

  get(id: ModelId): ModelTemplate {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Model not loaded: ${id}`);
    return template;
  }

  /** A plain (non-instanced) Object3D of the model — for ghosts, title scene, debugging. Shares GPU resources. */
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
    for (const template of this.templates.values()) {
      for (const part of template.parts) {
        part.geometry.dispose();
        part.material.dispose();
      }
    }
    this.templates.clear();
  }

  private normalise(id: ModelId, scene: THREE.Object3D): ModelTemplate {
    const spec = MODELS[id];
    // root: scale + quarter-turn so "front" faces +z, then translate so base sits at y=0 and the
    // footprint centre is at the origin (plus any authored offset from the catalog).
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

    const parts: ModelPart[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.length > 1) console.warn(`[models] ${id}: multi-material mesh, using first material`);
      parts.push({ geometry: mesh.geometry, material: materials[0], matrix: mesh.matrixWorld.clone() });
    });
    return { id, parts, bounds: new THREE.Box3().setFromObject(root) };
  }
}
