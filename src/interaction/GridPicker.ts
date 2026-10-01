/** Pointer → grid cell / nearest edge, by intersecting the y = 0 plane. */
import * as THREE from 'three';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH, cellToWorld, worldToCell, worldToNearestEdge } from '../game/config';
import type { Cell, Edge } from '../town/types';
import type { GridPoint } from './strokeMath';

export interface PickResult {
  cell: Cell;
  edge: Edge;
  world: THREE.Vector3;
  /** Continuous grid coordinates (cell x spans [x, x + 1)); see strokeMath.ts. */
  grid: GridPoint;
}

export class GridPicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly lastCameraMatrix = new THREE.Matrix4();
  private readonly lastProjection = new THREE.Matrix4();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  /** Pick from client (CSS pixel) coordinates. Returns null if the ray misses the ground. */
  pick(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.camera.updateMatrixWorld();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    return {
      cell: worldToCell(this.hit.x, this.hit.z),
      edge: worldToNearestEdge(this.hit.x, this.hit.z),
      world: this.hit.clone(),
      grid: { x: this.hit.x / CELL_SIZE + PLOT_WIDTH / 2, z: this.hit.z / CELL_SIZE + PLOT_DEPTH / 2 },
    };
  }

  /**
   * True once per camera move (view or projection change) since the last call, so the hover can be
   * re-picked under a still pointer without raycasting every idle frame.
   */
  consumeCameraChange(): boolean {
    this.camera.updateMatrixWorld();
    const moved =
      !this.lastCameraMatrix.equals(this.camera.matrixWorld) || !this.lastProjection.equals(this.camera.projectionMatrix);
    if (moved) {
      this.lastCameraMatrix.copy(this.camera.matrixWorld);
      this.lastProjection.copy(this.camera.projectionMatrix);
    }
    return moved;
  }

  /** Inverse, for tests/bots: CSS client coordinates of a cell centre. */
  cellToClient(cell: Cell): { x: number; y: number } {
    const world = cellToWorld(cell);
    this.camera.updateMatrixWorld();
    const projected = new THREE.Vector3(world.x, 0, world.z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }
}
