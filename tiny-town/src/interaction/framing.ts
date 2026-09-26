/**
 * Aspect-aware camera framing (WP-05). Finds the closest pose (at a given azimuth) whose view
 * fits the whole plot inside the screen area left free by the HUD: below the top bar, above the
 * dock and inside the side gutters. Used for the build start / reset pose and the portrait title
 * pose. Runs only on mode changes and resets (a few thousand projections), never per frame.
 *
 * The HUD insets mirror WP-06's layout (desktop dock ≤ 150 px + gap; mobile dock ≈ bottom 30 %).
 * If the UI layout changes, retune SAFE_INSETS here.
 */
import * as THREE from 'three';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import type { CameraPose } from './CameraController';

export interface ScreenInsets {
  /** CSS px kept clear at the top (top bar). */
  top: number;
  /** CSS px kept clear at the bottom (dock), or a fraction of the height when ≤ 1. */
  bottom: number;
  /** CSS px kept clear on each side (negative lets the plot's side corners overflow). */
  side: number;
}

/** Build-view HUD insets per layout. Narrow = the mobile layout (≤ 760 px wide). */
export const SAFE_INSETS: Readonly<{ wide: ScreenInsets; narrow: ScreenInsets }> = {
  wide: { top: 76, bottom: 172, side: 24 },
  // Negative side inset: on phones the plot's far left/right corners may run off-screen, so the
  // cells stay big enough to tap. Those corners are only reachable by panning.
  narrow: { top: 88, bottom: 0.32, side: -36 },
};

const NARROW_MAX_WIDTH = 760;

export function insetsFor(width: number): ScreenInsets {
  return width <= NARROW_MAX_WIDTH ? SAFE_INSETS.narrow : SAFE_INSETS.wide;
}

interface FitOptions {
  fov: number;
  width: number;
  height: number;
  insets: ScreenInsets;
  /** Polar angles (radians) to try, in order of preference; the first that fits wins. */
  polars: readonly number[];
  minDistance: number;
  maxDistance: number;
  /** Also keep this height (world units) above the plot in view (houses on the back row). */
  headroom: number;
  /** When false, only the horizontal extent must fit and the target stays put (title shots). */
  fitVertical: boolean;
}

const scratchCamera = new THREE.PerspectiveCamera();
const scratchTarget = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchPoint = new THREE.Vector3();

/** Plot corners at ground level and at `headroom` height. */
function plotPoints(headroom: number): THREE.Vector3[] {
  const hx = (PLOT_WIDTH / 2) * CELL_SIZE;
  const hz = (PLOT_DEPTH / 2) * CELL_SIZE;
  const points: THREE.Vector3[] = [];
  for (const y of [0, headroom]) for (const x of [-hx, hx]) for (const z of [-hz, hz]) points.push(new THREE.Vector3(x, y, z));
  return points;
}

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function project(pose: CameraPose, options: FitOptions, points: readonly THREE.Vector3[], out: Extent): Extent {
  scratchCamera.fov = options.fov;
  scratchCamera.aspect = options.width / options.height;
  scratchCamera.near = 0.1;
  scratchCamera.far = 2000;
  scratchCamera.updateProjectionMatrix();
  scratchTarget.set(pose.targetX, 0, pose.targetZ);
  scratchOffset.setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth);
  scratchCamera.position.copy(scratchTarget).add(scratchOffset);
  scratchCamera.lookAt(scratchTarget);
  scratchCamera.updateMatrixWorld();
  out.minX = Infinity;
  out.maxX = -Infinity;
  out.minY = Infinity;
  out.maxY = -Infinity;
  for (const point of points) {
    scratchPoint.copy(point).project(scratchCamera);
    out.minX = Math.min(out.minX, scratchPoint.x);
    out.maxX = Math.max(out.maxX, scratchPoint.x);
    out.minY = Math.min(out.minY, scratchPoint.y);
    out.maxY = Math.max(out.maxY, scratchPoint.y);
  }
  return out;
}

/**
 * Closest pose (same azimuth as `base`) that frames the plot in the free screen area. The target
 * slides along the view's ground-forward direction so the plot is centred in that area.
 * Falls back to maxDistance when nothing fits (very narrow portrait screens).
 */
export function fitPlotPose(base: CameraPose, options: FitOptions): CameraPose {
  const { width, height, insets } = options;
  const bottomPx = insets.bottom <= 1 ? insets.bottom * height : insets.bottom;
  // Safe area in NDC (y up).
  const safeTop = 1 - (2 * insets.top) / height;
  const safeBottom = -1 + (2 * bottomPx) / height;
  const safeSide = 1 - (2 * insets.side) / width;
  const safeCentre = (safeTop + safeBottom) / 2;
  const points = plotPoints(options.headroom);
  const extent: Extent = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  // Ground-forward (away from the camera) at this azimuth.
  const forwardX = -Math.sin(base.azimuth);
  const forwardZ = -Math.cos(base.azimuth);

  const poseAt = (polar: number, distance: number, shift: number): CameraPose => ({
    targetX: base.targetX + forwardX * shift,
    targetZ: base.targetZ + forwardZ * shift,
    azimuth: base.azimuth,
    polar,
    distance,
  });

  /** Target shift that centres the plot vertically in the safe band (bisection; centre y falls as shift grows). */
  const centredShift = (polar: number, distance: number): number => {
    if (!options.fitVertical) return 0;
    let lo = -PLOT_DEPTH * CELL_SIZE;
    let hi = PLOT_DEPTH * CELL_SIZE;
    for (let i = 0; i < 32; i += 1) {
      const mid = (lo + hi) / 2;
      project(poseAt(polar, distance, mid), options, points, extent);
      if ((extent.minY + extent.maxY) / 2 > safeCentre) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const fits = (polar: number, distance: number): { ok: boolean; shift: number } => {
    const shift = centredShift(polar, distance);
    project(poseAt(polar, distance, shift), options, points, extent);
    const horizontal = extent.minX >= -safeSide && extent.maxX <= safeSide;
    const vertical = !options.fitVertical || (extent.maxY <= safeTop && extent.minY >= safeBottom);
    return { ok: horizontal && vertical, shift };
  };

  let best: CameraPose | null = null;
  for (const polar of options.polars) {
    if (!fits(polar, options.maxDistance).ok) continue;
    let lo = options.minDistance;
    let hi = options.maxDistance;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(polar, mid).ok) hi = mid;
      else lo = mid;
    }
    const pose = poseAt(polar, hi, fits(polar, hi).shift);
    if (!best || pose.distance < best.distance - 0.5) best = pose;
    // Prefer the first (designed) polar when it fits at a reasonable distance.
    if (polar === options.polars[0]) break;
  }
  if (best) return best;
  const polar = options.polars[options.polars.length - 1];
  return poseAt(polar, options.maxDistance, centredShift(polar, options.maxDistance));
}
