/**
 * Aspect-aware camera framing (WP-05). Readability first: the plot is fitted WIDTH-wise (its
 * left/right corners inside the side insets) and its centre is placed at a chosen screen height,
 * so the near corner may tuck under the dock and the far corner may reach the top bar, while the
 * plot centre always stays clear above the dock. Used for the build start / reset pose and the
 * portrait title pose. Runs only on mode changes and resets, never per frame.
 *
 * The HUD insets mirror WP-06's layout (desktop dock ≤ 150 px + gap; mobile dock ≈ bottom 32 %).
 * If the UI layout changes, retune SAFE_INSETS here.
 */
import * as THREE from 'three';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import type { CameraPose } from './CameraController';

export interface ScreenInsets {
  /** CSS px covered by the top bar. */
  top: number;
  /** CSS px covered by the dock, or a fraction of the height when ≤ 1. */
  bottom: number;
  /**
   * CSS px kept between the plot's side corners and the screen edge. Larger = the camera stays
   * further back; negative lets the side corners run off-screen (phones, so cells stay tappable).
   */
  side: number;
}

/** Build-view insets per layout. Narrow = the mobile layout (≤ 760 px wide). */
export const SAFE_INSETS: Readonly<{ wide: ScreenInsets; narrow: ScreenInsets }> = {
  // side 128: the plot spans ~80 % of a 1280 px screen, so a townhouse reads clearly.
  wide: { top: 76, bottom: 172, side: 128 },
  // side −260 (WP-12, was −150): on phones the plot is ~2.3× the screen width (its side corners are
  // off-screen, reachable by panning) so the 0.5-unit cells stay ≥ 9 px (≈ 10.6) at the default pose;
  // the centre stays well above the dock. Small props still want a pinch-zoom on touch.
  narrow: { top: 88, bottom: 0.32, side: -260 },
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
const HALF_X = (PLOT_WIDTH / 2) * CELL_SIZE;
const HALF_Z = (PLOT_DEPTH / 2) * CELL_SIZE;
const CORNERS: readonly THREE.Vector3[] = [
  new THREE.Vector3(-HALF_X, 0, -HALF_Z),
  new THREE.Vector3(HALF_X, 0, -HALF_Z),
  new THREE.Vector3(-HALF_X, 0, HALF_Z),
  new THREE.Vector3(HALF_X, 0, HALF_Z),
];
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
 * Closest pose (azimuth of `base`, polar `options.polar`) whose plot fits the screen width inside
 * `side`, with the plot centre at `centreY`. The target slides along the view's ground-forward
 * direction to place the centre. Falls back to maxDistance when nothing fits.
 */
export function fitPlotPose(base: CameraPose, options: FitOptions): CameraPose {
  const { width, height, fov } = options;
  const aspect = width / height;
  const centreY = options.centreY;
  const wantNdcY = centreY === undefined ? 0 : 1 - (2 * centreY) / height;
  const safeSide = 1 - (2 * options.side) / width;
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
    let lo = -PLOT_DEPTH * CELL_SIZE;
    let hi = PLOT_DEPTH * CELL_SIZE;
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
