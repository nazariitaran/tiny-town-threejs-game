/**
 * Pointer → grid cell / nearest edge, by intersecting the y = 0 plane.
 * Implemented in the scaffold; WP-05 owns it from here.
 */
import * as THREE from 'three';
import { cellToWorld, worldToCell, worldToNearestEdge } from '../game/config';
import type { Cell, Edge } from '../town/types';

export interface PickResult {
  cell: Cell;
  edge: Edge;
  world: THREE.Vector3;
}

export class GridPicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  /** Pick from client (CSS pixel) coordinates. Returns null if the ray misses the ground. */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    return {
      cell: worldToCell(this.hit.x, this.hit.z),
      edge: worldToNearestEdge(this.hit.x, this.hit.z),
      world: this.hit.clone(),
    };
  }

  /** Inverse, for tests/bots: CSS client coordinates of a cell centre. */
  cellToClient(cell: Cell): { x: number; y: number } {
    const world = cellToWorld(cell);
    const projected = new THREE.Vector3(world.x, 0, world.z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }
}
