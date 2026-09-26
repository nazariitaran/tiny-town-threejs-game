/**
 * Builder camera: MapControls remapped so the LEFT button stays free for building.
 * See docs/design/02-interaction-and-ui.md §1 for the full gesture table.
 *
 * SCAFFOLD STUB — WP-05 (Interaction) owns this file. TODO(WP-05): WASD/arrow pan,
 * Q/E animated 45° orbit steps, reset pose tween, slow auto-orbit in 'title' mode,
 * tunables via debug.folder('Camera'). getPose/setPose already exist (used for saves).
 */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { DebugTools } from '../debug/DebugTools';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';

export interface CameraPose {
  targetX: number;
  targetZ: number;
  azimuth: number;
  polar: number;
  distance: number;
}

export const DEFAULT_POSE: CameraPose = {
  targetX: 0,
  targetZ: 0,
  azimuth: Math.PI / 4,
  polar: THREE.MathUtils.degToRad(52),
  distance: 30,
};

/**
 * Low 'hero' pose for the title screen: with FOV 35°, polar 78° puts the horizon (and sky/sun)
 * in the top of the frame. The build pose (polar 30–70°) is too steep to ever show the horizon.
 */
export const TITLE_POSE: CameraPose = {
  targetX: 0,
  targetZ: 2,
  azimuth: Math.PI / 4,
  polar: THREE.MathUtils.degToRad(78),
  distance: 34,
};

export type CameraMode = 'title' | 'build';

export class CameraController {
  readonly controls: MapControls;

  private mode: CameraMode = 'build';

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    _debug?: DebugTools,
  ) {
    this.controls = new MapControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(30);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(70);
    this.controls.minDistance = 6;
    this.controls.maxDistance = 60;
    this.controls.zoomToCursor = true;
    this.setToolActive(false);
    this.setPose(DEFAULT_POSE);
  }

  /** 'title': user input off, polar clamp lifted for TITLE_POSE. 'build': normal clamps + input. */
  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === 'build';
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(mode === 'title' ? 85 : 70);
    this.setPose(mode === 'title' ? TITLE_POSE : DEFAULT_POSE);
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  /** Back to the default build pose (F / Home, 'intent:reset-camera'). WP-05: tween it. */
  reset(): void {
    this.setPose(DEFAULT_POSE);
  }

  /** With a tool active, left mouse / one finger belong to the tool; the camera uses the other gestures. */
  setToolActive(active: boolean): void {
    this.controls.mouseButtons = {
      LEFT: active ? null : THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: active ? null : THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
  }

  setPose(pose: CameraPose): void {
    const target = new THREE.Vector3(pose.targetX, 0, pose.targetZ);
    const offset = new THREE.Vector3().setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth);
    this.camera.position.copy(target).add(offset);
    this.controls.target.copy(target);
    this.camera.lookAt(target);
    this.controls.update();
  }

  getPose(): CameraPose {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    return {
      targetX: this.controls.target.x,
      targetZ: this.controls.target.z,
      azimuth: spherical.theta,
      polar: spherical.phi,
      distance: spherical.radius,
    };
  }

  update(_delta: number): void {
    // Keep the orbit target over the plot (+2 cells margin).
    const limitX = (PLOT_WIDTH / 2 + 2) * CELL_SIZE;
    const limitZ = (PLOT_DEPTH / 2 + 2) * CELL_SIZE;
    const target = this.controls.target;
    const clampedX = THREE.MathUtils.clamp(target.x, -limitX, limitX);
    const clampedZ = THREE.MathUtils.clamp(target.z, -limitZ, limitZ);
    if (clampedX !== target.x || clampedZ !== target.z) {
      this.camera.position.x += clampedX - target.x;
      this.camera.position.z += clampedZ - target.z;
      target.set(clampedX, 0, clampedZ);
    }
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
