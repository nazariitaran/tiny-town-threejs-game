/**
 * One InstancedMesh for one (model, part): add/remove instances in O(1) with swap-remove,
 * capacity doubling, and a single upload per frame (flush).
 */
import * as THREE from 'three';

/** A live instance inside a pool. `index` changes when another instance is swap-removed. */
export interface PoolSlot {
  pool: InstancePool;
  index: number;
}

const INITIAL_CAPACITY = 16;
const WHITE = new THREE.Color(1, 1, 1);

export class InstancePool {
  mesh: THREE.InstancedMesh;
  private owners: PoolSlot[] = [];
  private dirty = false;

  constructor(
    readonly key: string,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly parent: THREE.Object3D,
    readonly castShadow: boolean,
    readonly trianglesPerInstance: number,
    /** Instances carry a colour that multiplies the material's (white unless `add` is given one). */
    private readonly tinted = false,
  ) {
    this.mesh = this.createMesh(INITIAL_CAPACITY);
    parent.add(this.mesh);
  }

  get count(): number {
    return this.owners.length;
  }

  add(matrix: THREE.Matrix4, tint: THREE.Color = WHITE): PoolSlot {
    if (this.owners.length >= this.mesh.instanceMatrix.count) this.grow();
    const slot: PoolSlot = { pool: this, index: this.owners.length };
    this.owners.push(slot);
    this.mesh.setMatrixAt(slot.index, matrix);
    if (this.tinted) this.mesh.setColorAt(slot.index, tint);
    this.markDirty();
    return slot;
  }

  set(slot: PoolSlot, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(slot.index, matrix);
    this.dirty = true;
  }

  remove(slot: PoolSlot): void {
    const last = this.owners.length - 1;
    if (slot.index < 0 || this.owners[slot.index] !== slot) return;
    if (slot.index !== last) {
      const moved = this.owners[last];
      const array = this.mesh.instanceMatrix.array as Float32Array;
      array.copyWithin(slot.index * 16, last * 16, last * 16 + 16);
      (this.mesh.instanceColor?.array as Float32Array | undefined)?.copyWithin(slot.index * 3, last * 3, last * 3 + 3);
      moved.index = slot.index;
      this.owners[slot.index] = moved;
    }
    this.owners.pop();
    slot.index = -1;
    this.markDirty();
  }

  /** Upload changed matrices (once per frame / per change batch). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.count = this.owners.length;
    this.mesh.visible = this.owners.length > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.owners = [];
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private grow(): void {
    const old = this.mesh;
    const next = this.createMesh(old.instanceMatrix.count * 2);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    if (old.instanceColor && next.instanceColor) (next.instanceColor.array as Float32Array).set(old.instanceColor.array as Float32Array);
    this.parent.add(next);
    old.removeFromParent();
    old.dispose();
    this.mesh = next;
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = `pool:${this.key}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.tinted) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.count = this.owners.length;
    mesh.visible = this.owners.length > 0;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    // The plot is small and almost always fully in view; per-pool bounds would go stale while
    // instances animate, so skip culling instead of recomputing bounds every change.
    mesh.frustumCulled = false;
    return mesh;
  }
}
