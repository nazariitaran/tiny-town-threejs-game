/**
 * Aspect-aware camera framing: the plot is fitted width-wise (side corners inside the side insets)
 * and its centre is placed at a chosen screen height, so the near corner may tuck under the dock
 * while the centre stays clear above it. Runs on mode changes and resets only.
 *
 * SAFE_INSETS mirror the HUD layout (desktop dock ≤ 150 px + gap; mobile dock ≈ bottom 32 %).
 */
import * as THREE from 'three';
import { CELL_SIZE, plot } from '../game/config';
import type { CameraPose } from './CameraController';

export interface ScreenInsets {
  /** CSS px covered by the top bar. */
  top: number;
  /** CSS px covered by the dock, or a fraction of the height when ≤ 1. */
  bottom: number;
  /**
   * CSS px kept between the plot's side corners and the screen edge. Negative lets the corners run
   * off-screen (phones, so cells stay tappable).
   */
  side: number;
}

/** Build-view insets per layout; narrow is the mobile layout. */
export const SAFE_INSETS: Readonly<{ wide: ScreenInsets; narrow: ScreenInsets }> = {
  // The plot spans ~1.07× a 1280 px screen, side corners just off-screen, so a townhouse reads clearly.
  wide: { top: 76, bottom: 172, side: -42 },
  // On phones the plot is ~3.1× the screen width (corners reachable by panning) so the 0.5-unit cells
  // stay ≥ 9 px at the default pose.
  narrow: { top: 76, bottom: 0.32, side: -412 },
};

/** The plot centre must stay at least this far (CSS px) above the dock top. */
export const CENTRE_ABOVE_DOCK_PX = 60;

const NARROW_MAX_WIDTH = 760;

export function insetsFor(width: number): ScreenInsets {
  return width <= NARROW_MAX_WIDTH ? SAFE_INSETS.narrow : SAFE_INSETS.wide;
}

/** Dock top in CSS px from the top of the screen. */
export function dockTopPx(insets: ScreenInsets, height: number): number {
  return height - (insets.bottom <= 1 ? insets.bottom * height : insets.bottom);
}

export interface FitOptions {
  fov: number;
  width: number;
  height: number;
  /** Side corners stay inside this many CSS px from each screen edge. */
  side: number;
  /**
   * Where the plot centre should appear, in CSS px from the top of the screen. Omit to keep the
   * target where `base` has it (title: the auto-orbit must keep circling the plot).
   */
  centreY?: number;
  polar: number;
  minDistance: number;
  maxDistance: number;
}

const scratchCamera = new THREE.PerspectiveCamera();
const scratchTarget = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchPoint = new THREE.Vector3();
const CORNERS: readonly THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const ORIGIN = new THREE.Vector3();

function place(pose: CameraPose, fov: number, aspect: number): THREE.PerspectiveCamera {
  scratchCamera.fov = fov;
  scratchCamera.aspect = aspect;
  scratchCamera.near = 0.1;
  scratchCamera.far = 2000;
  scratchCamera.updateProjectionMatrix();
  scratchTarget.set(pose.targetX, 0, pose.targetZ);
  scratchOffset.setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth);
  scratchCamera.position.copy(scratchTarget).add(scratchOffset);
  scratchCamera.lookAt(scratchTarget);
  scratchCamera.updateMatrixWorld();
  return scratchCamera;
}

/**
 * Closest pose (azimuth of `base`, polar `options.polar`) whose live plot fits the screen width inside
 * `side`, with the plot centre at `centreY`. The target slides along the view's ground-forward
 * direction to place the centre. Falls back to maxDistance when nothing fits.
 */
export function fitPlotPose(base: CameraPose, options: FitOptions): CameraPose {
  const { width, height, fov } = options;
  const aspect = width / height;
  const centreY = options.centreY;
  const wantNdcY = centreY === undefined ? 0 : 1 - (2 * centreY) / height;
  const safeSide = 1 - (2 * options.side) / width;
  const halfX = (plot.width / 2) * CELL_SIZE;
  const halfZ = (plot.depth / 2) * CELL_SIZE;
  CORNERS.forEach((corner, i) => corner.set(i & 1 ? halfX : -halfX, 0, i & 2 ? halfZ : -halfZ));
  const forwardX = -Math.sin(base.azimuth);
  const forwardZ = -Math.cos(base.azimuth);
  const poseAt = (distance: number, shift: number): CameraPose => ({
    targetX: base.targetX + forwardX * shift,
    targetZ: base.targetZ + forwardZ * shift,
    azimuth: base.azimuth,
    polar: options.polar,
    distance,
  });

  /** Target shift putting the plot centre at centreY (bisection: the centre rises on screen as the target comes nearer). */
  const shiftFor = (distance: number): number => {
    if (centreY === undefined) return 0;
    let lo = -plot.depth * CELL_SIZE;
    let hi = plot.depth * CELL_SIZE;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      scratchPoint.copy(ORIGIN).project(place(poseAt(distance, mid), fov, aspect));
      if (scratchPoint.y > wantNdcY) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const fits = (distance: number): boolean => {
    const camera = place(poseAt(distance, shiftFor(distance)), fov, aspect);
    for (const corner of CORNERS) {
      scratchPoint.copy(corner).project(camera);
      if (scratchPoint.z > 1 || Math.abs(scratchPoint.x) > safeSide) return false;
    }
    return true;
  };

  let distance = options.maxDistance;
  if (fits(options.maxDistance)) {
    let lo = options.minDistance;
    let hi = options.maxDistance;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    distance = hi;
  }
  return poseAt(distance, shiftFor(distance));
}

/**
 * Ground move (world units, written to `out`) for a camera pan step: `right` / `forward` are in
 * screen directions (−1..1, forward = up the screen, like W), each worth `fraction` of the visible
 * height at the target. A forward step covers more ground than a sideways one (the view is tilted).
 */
export function panStepDelta(
  azimuth: number,
  polar: number,
  distance: number,
  fovRadians: number,
  right: number,
  forward: number,
  fraction: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const step = fraction * 2 * distance * Math.tan(fovRadians / 2);
  const r = right * step;
  const f = (forward * step) / Math.max(0.2, Math.cos(polar));
  // Screen-right on the ground is (cosθ, −sinθ); the view looks along (−sinθ, −cosθ).
  out.x = Math.cos(azimuth) * r - Math.sin(azimuth) * f;
  out.z = -Math.sin(azimuth) * r - Math.cos(azimuth) * f;
  return out;
}
