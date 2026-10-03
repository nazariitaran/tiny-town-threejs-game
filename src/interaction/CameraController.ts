/**
 * Builder camera: MapControls remapped so the left button / one finger stay free for building.
 *
 *  Pan    right-drag · WASD / arrows · left-drag with no tool · two-finger drag
 *  Orbit  middle-drag · Alt+left-drag (also tilts) · Q / E 45° steps · two-finger twist
 *  Zoom   wheel (zoom-to-cursor) · + / − · pinch
 */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { DebugTools } from '../debug/DebugTools';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { isEditableTarget } from './keyboard';
import { CENTRE_ABOVE_DOCK_PX, dockTopPx, fitPlotPose, insetsFor } from './framing';
import { easeInOutCubic, easeOutCubic, shortestAngle } from './strokeMath';

const DEG = Math.PI / 180;
/** defaultPoseFor(1280, 720), rounded. */
const DESKTOP_TARGET = 1.829;
const DESKTOP_DISTANCE = 35.843;

export interface CameraPose {
  targetX: number;
  targetZ: number;
  azimuth: number;
  polar: number;
  distance: number;
}

const BUILD_ANGLE: CameraPose = {
  targetX: 0,
  targetZ: 0,
  azimuth: Math.PI / 4,
  polar: THREE.MathUtils.degToRad(52),
  distance: 30,
};

/** Build start pose on the reference desktop viewport (1280×720, FOV 35); equals defaultPoseFor(1280, 720). */
export const DEFAULT_POSE: CameraPose = {
  targetX: DESKTOP_TARGET,
  targetZ: DESKTOP_TARGET,
  azimuth: Math.PI / 4,
  polar: THREE.MathUtils.degToRad(52),
  distance: DESKTOP_DISTANCE,
};

/**
 * Build start pose fitted to a viewport (CSS px): the plot fills the width and its centre sits
 * midway between the top bar and the dock, at least CENTRE_ABOVE_DOCK_PX above the dock.
 */
export function defaultPoseFor(width: number, height: number, fov = 35): CameraPose {
  if (width <= 0 || height <= 0) return { ...DEFAULT_POSE };
  const portrait = height > width;
  const insets = insetsFor(width);
  const dockTop = dockTopPx(insets, height);
  const centreY = Math.min((insets.top + dockTop) / 2, dockTop - CENTRE_ABOVE_DOCK_PX);
  return fitPlotPose(BUILD_ANGLE, {
    fov,
    width,
    height,
    side: insets.side,
    centreY,
    polar: portrait ? 58 * DEG : BUILD_ANGLE.polar,
    minDistance: 6,
    maxDistance: portrait ? 80 : 60,
  });
}

/**
 * Low 'hero' pose for the title screen: with FOV 35°, polar 78° puts the horizon (and sky/sun)
 * in the top of the frame. The build pose (polar 30–70°) is too steep to ever show the horizon.
 */
export const TITLE_POSE: CameraPose = {
  targetX: 0,
  targetZ: 2,
  azimuth: Math.PI / 4,
  polar: THREE.MathUtils.degToRad(78),
  distance: 44,
};

export type CameraMode = 'title' | 'build';

/**
 * Title pose for a viewport. Landscape: TITLE_POSE. Portrait: same angle and orbit centre, pulled in
 * so the diorama fills the width (its side corners run off-screen) instead of sitting small
 * above a big empty foreground.
 */
export function titlePoseFor(width: number, height: number, fov = 35): CameraPose {
  if (width <= 0 || height <= 0 || width >= height) return { ...TITLE_POSE };
  return fitPlotPose(TITLE_POSE, {
    fov,
    width,
    height,
    side: -0.3 * width,
    polar: TITLE_POSE.polar,
    minDistance: 20,
    maxDistance: 150,
  });
}

interface ScalarTween {
  from: number;
  to: number;
  elapsed: number;
  duration: number;
}

interface PoseTween {
  from: CameraPose;
  to: CameraPose;
  elapsed: number;
  duration: number;
}

/** [screen-right, screen-forward] per held key. */
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class CameraController {
  readonly controls: MapControls;

  readonly tuning = {
    /** Keyboard pan speed in camera-distances per second. */
    panSpeed: 0.75,
    /** How quickly keyboard pan reaches full speed / stops (1/s). */
    panResponse: 12,
    orbitStepDegrees: 45,
    orbitDuration: 0.28,
    zoomStep: 1.25,
    zoomDuration: 0.2,
    resetDuration: 0.55,
    /** Title-screen auto-orbit, radians per second. */
    titleOrbitSpeed: 0.06,
    /** Two-finger twist needed before rotation starts (degrees), so pans don't wobble. */
    twistDeadzoneDegrees: 8,
    damping: 0.12,
    minPolarDegrees: 30,
    maxPolarDegrees: 70,
    minDistance: 6,
    maxDistance: 60,
  };

  private mode: CameraMode = 'build';
  private homeDistance = DEFAULT_POSE.distance;
  private inputEnabled = true;
  private toolActive = false;
  private readonly heldKeys = new Set<string>();
  private readonly panVelocity = new THREE.Vector2(); // (right, forward) in world units / s
  private orbitTween: ScalarTween | null = null;
  private zoomTween: ScalarTween | null = null;
  private poseTween: PoseTween | null = null;

  private readonly touchPoints = new Map<number, { x: number; y: number }>();
  private twistAngle: number | null = null;
  private twistAccum = 0;
  private twisting = false;

  // Scratch objects: no per-frame allocations.
  private readonly offset = new THREE.Vector3();
  private readonly spherical = new THREE.Spherical();
  private readonly scratchPose: CameraPose = { ...DEFAULT_POSE };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    debug?: DebugTools,
  ) {
    this.controls = new MapControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.applyClamps();
    this.setToolActive(false);
    this.setPose(DEFAULT_POSE);

    // Capture phase: runs before MapControls' own pointerdown, so Alt+left can become orbit.
    domElement.addEventListener('pointerdown', this.onPointerDownCapture, { capture: true });
    domElement.addEventListener('pointermove', this.onTouchMove);
    domElement.addEventListener('pointerup', this.onTouchEnd);
    domElement.addEventListener('pointercancel', this.onTouchEnd);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Any direct manipulation cancels scripted moves so the player is never fought.
    this.controls.addEventListener('start', this.cancelScriptedMoves);
    this.installDebug(debug);
  }

  /** 'title': user input off, polar clamp lifted for TITLE_POSE, slow auto-orbit. 'build': normal clamps + input. */
  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.cancelScriptedMoves();
    this.clearHeldInput();
    this.syncEnabled();
    const pose = mode === 'title' ? this.titlePose() : this.buildPose();
    this.applyClamps(pose.distance);
    this.setPose(pose);
  }

  /** The build start / reset pose for the current screen. */
  buildPose(): CameraPose {
    const { width, height } = this.viewportSize();
    return defaultPoseFor(width, height, this.camera.fov);
  }

  titlePose(): CameraPose {
    const { width, height } = this.viewportSize();
    return titlePoseFor(width, height, this.camera.fov);
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  /** Input gate from ToolController; title mode stays input-free regardless. */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.clearHeldInput();
    this.syncEnabled();
  }

  /** Back to the build pose (F / Home) as a short eased tween. */
  reset(): void {
    if (this.mode === 'title') {
      this.setPose(this.titlePose());
      return;
    }
    this.cancelScriptedMoves();
    const from = this.getPose();
    const home = this.buildPose();
    this.applyClamps(home.distance);
    const to: CameraPose = { ...home, azimuth: from.azimuth + shortestAngle(from.azimuth, home.azimuth) };
    this.poseTween = { from, to, elapsed: 0, duration: this.tuning.resetDuration };
  }

  /** Q / E: animated orbit step. direction 1 = world turns clockwise seen from above. */
  orbitStep(direction: 1 | -1): void {
    if (this.mode !== 'build') return;
    this.poseTween = null;
    const current = this.readSpherical().theta;
    const base = this.orbitTween ? this.orbitTween.to : current;
    const to = base + direction * THREE.MathUtils.degToRad(this.tuning.orbitStepDegrees);
    this.orbitTween = { from: current, to, elapsed: 0, duration: this.tuning.orbitDuration };
  }

  /** + / −: animated dolly. direction 1 = zoom in. */
  zoomStep(direction: 1 | -1): void {
    if (this.mode !== 'build') return;
    this.poseTween = null;
    const current = this.readSpherical().radius;
    const base = this.zoomTween ? this.zoomTween.to : current;
    const factor = direction === 1 ? 1 / this.tuning.zoomStep : this.tuning.zoomStep;
    const to = THREE.MathUtils.clamp(base * factor, this.controls.minDistance, this.controls.maxDistance);
    this.zoomTween = { from: current, to, elapsed: 0, duration: this.tuning.zoomDuration };
  }

  /** With a tool active, left mouse / one finger belong to the tool; the camera uses the other gestures. */
  setToolActive(active: boolean): void {
    this.toolActive = active;
    this.controls.mouseButtons = {
      LEFT: active ? null : THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: active ? null : THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
  }

  setPose(pose: CameraPose): void {
    this.controls.target.set(pose.targetX, 0, pose.targetZ);
    this.offset.setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth);
    this.camera.position.copy(this.controls.target).add(this.offset);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /** The point on the ground the camera looks at (live; don't keep or change it). */
  get target(): Readonly<THREE.Vector3> {
    return this.controls.target;
  }

  getPose(): CameraPose {
    const spherical = this.readSpherical();
    return {
      targetX: this.controls.target.x,
      targetZ: this.controls.target.z,
      azimuth: spherical.theta,
      polar: spherical.phi,
      distance: spherical.radius,
    };
  }

  update(delta: number): void {
    if (this.mode === 'title') {
      this.setAzimuth(this.readSpherical().theta + delta * this.tuning.titleOrbitSpeed);
    } else {
      this.updateKeyboardPan(delta);
      this.updateTweens(delta);
    }
    this.clampTarget();
    this.controls.update(delta);
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDownCapture, { capture: true });
    this.domElement.removeEventListener('pointermove', this.onTouchMove);
    this.domElement.removeEventListener('pointerup', this.onTouchEnd);
    this.domElement.removeEventListener('pointercancel', this.onTouchEnd);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.controls.removeEventListener('start', this.cancelScriptedMoves);
    this.controls.dispose();
  }

  private get acceptsInput(): boolean {
    return this.mode === 'build' && this.inputEnabled;
  }

  private syncEnabled(): void {
    this.controls.enabled = this.acceptsInput;
  }

  /** `homeDistance`: the fitted start pose may sit beyond maxDistance on portrait screens; keep it reachable. */
  private applyClamps(homeDistance = this.homeDistance): void {
    const t = this.tuning;
    this.homeDistance = homeDistance;
    this.controls.dampingFactor = t.damping;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(this.mode === 'title' ? 0 : t.minPolarDegrees);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(this.mode === 'title' ? 85 : t.maxPolarDegrees);
    this.controls.minDistance = t.minDistance;
    this.controls.maxDistance = this.mode === 'title' ? 200 : Math.max(t.maxDistance, homeDistance * 1.2);
  }

  private viewportSize(): { width: number; height: number } {
    const element = this.domElement;
    return { width: element.clientWidth || window.innerWidth || 0, height: element.clientHeight || window.innerHeight || 0 };
  }

  private readSpherical(): THREE.Spherical {
    this.offset.subVectors(this.camera.position, this.controls.target);
    return this.spherical.setFromVector3(this.offset);
  }

  private writeSpherical(): void {
    this.offset.setFromSpherical(this.spherical);
    this.camera.position.copy(this.controls.target).add(this.offset);
    this.camera.lookAt(this.controls.target);
  }

  private setAzimuth(theta: number): void {
    this.readSpherical().theta = theta;
    this.writeSpherical();
  }

  private setDistance(radius: number): void {
    this.readSpherical().radius = radius;
    this.writeSpherical();
  }

  private updateKeyboardPan(delta: number): void {
    let right = 0;
    let forward = 0;
    if (this.acceptsInput) {
      for (const code of this.heldKeys) {
        const dir = PAN_KEYS[code];
        if (dir) {
          right += dir[0];
          forward += dir[1];
        }
      }
    }
    const length = Math.hypot(right, forward);
    if (length === 0 && this.panVelocity.x === 0 && this.panVelocity.y === 0) return;
    const spherical = this.readSpherical();
    const speed = this.tuning.panSpeed * spherical.radius;
    const desiredRight = length > 0 ? (right / length) * speed : 0;
    const desiredForward = length > 0 ? (forward / length) * speed : 0;
    const blend = 1 - Math.exp(-this.tuning.panResponse * delta);
    this.panVelocity.x += (desiredRight - this.panVelocity.x) * blend;
    this.panVelocity.y += (desiredForward - this.panVelocity.y) * blend;
    if (length === 0 && this.panVelocity.lengthSq() < 1e-4) {
      this.panVelocity.set(0, 0);
      return;
    }
    if (length > 0) this.poseTween = null;
    const theta = spherical.theta;
    // The camera looks along (−sinθ, −cosθ) on the ground; screen-right is (cosθ, −sinθ).
    const dx = (Math.cos(theta) * this.panVelocity.x - Math.sin(theta) * this.panVelocity.y) * delta;
    const dz = (-Math.sin(theta) * this.panVelocity.x - Math.cos(theta) * this.panVelocity.y) * delta;
    this.controls.target.x += dx;
    this.controls.target.z += dz;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }

  private updateTweens(delta: number): void {
    const poseTween = this.poseTween;
    if (poseTween) {
      poseTween.elapsed = Math.min(poseTween.duration, poseTween.elapsed + delta);
      const k = easeInOutCubic(poseTween.duration > 0 ? poseTween.elapsed / poseTween.duration : 1);
      const { from, to } = poseTween;
      const pose = this.scratchPose;
      pose.targetX = THREE.MathUtils.lerp(from.targetX, to.targetX, k);
      pose.targetZ = THREE.MathUtils.lerp(from.targetZ, to.targetZ, k);
      pose.azimuth = THREE.MathUtils.lerp(from.azimuth, to.azimuth, k);
      pose.polar = THREE.MathUtils.lerp(from.polar, to.polar, k);
      pose.distance = THREE.MathUtils.lerp(from.distance, to.distance, k);
      this.controls.target.set(pose.targetX, 0, pose.targetZ);
      this.offset.setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth);
      this.camera.position.copy(this.controls.target).add(this.offset);
      this.camera.lookAt(this.controls.target);
      if (poseTween.elapsed >= poseTween.duration) this.poseTween = null;
    }
    const orbitTween = this.orbitTween;
    if (orbitTween) {
      this.setAzimuth(this.stepScalar(orbitTween, delta));
      if (orbitTween.elapsed >= orbitTween.duration) this.orbitTween = null;
    }
    const zoomTween = this.zoomTween;
    if (zoomTween) {
      this.setDistance(this.stepScalar(zoomTween, delta));
      if (zoomTween.elapsed >= zoomTween.duration) this.zoomTween = null;
    }
  }

  private stepScalar(tween: ScalarTween, delta: number): number {
    tween.elapsed = Math.min(tween.duration, tween.elapsed + delta);
    const k = easeOutCubic(tween.duration > 0 ? tween.elapsed / tween.duration : 1);
    return THREE.MathUtils.lerp(tween.from, tween.to, k);
  }

  private clampTarget(): void {
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
  }

  private readonly cancelScriptedMoves = (): void => {
    this.poseTween = null;
    this.orbitTween = null;
    this.zoomTween = null;
  };

  private clearHeldInput(): void {
    this.heldKeys.clear();
    this.panVelocity.set(0, 0);
    this.touchPoints.clear();
    this.twistAngle = null;
    this.twisting = false;
    this.twistAccum = 0;
  }

  private readonly onPointerDownCapture = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.resetTwist();
      return;
    }
    if (event.button === 0) {
      // Alt/Option + left-drag orbits and tilts, even with a tool active (ToolController ignores Alt clicks).
      this.controls.mouseButtons.LEFT = event.altKey ? THREE.MOUSE.ROTATE : this.toolActive ? null : THREE.MOUSE.PAN;
    }
  };

  private readonly onTouchMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    const point = this.touchPoints.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (this.touchPoints.size !== 2 || !this.acceptsInput) return;
    const angle = this.currentTwistAngle();
    if (this.twistAngle === null) {
      this.twistAngle = angle;
      return;
    }
    const step = shortestAngle(this.twistAngle, angle);
    this.twistAngle = angle;
    this.twistAccum += step;
    if (!this.twisting && Math.abs(this.twistAccum) >= THREE.MathUtils.degToRad(this.tuning.twistDeadzoneDegrees)) {
      this.twisting = true;
    }
    if (this.twisting) {
      this.cancelScriptedMoves();
      // Screen angles grow clockwise (y down); turning the world clockwise = increasing theta.
      this.setAzimuth(this.readSpherical().theta + step);
    }
  };

  private readonly onTouchEnd = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.touchPoints.delete(event.pointerId);
    this.resetTwist();
  };

  private resetTwist(): void {
    this.twistAngle = this.touchPoints.size === 2 ? this.currentTwistAngle() : null;
    this.twistAccum = 0;
    this.twisting = false;
  }

  private currentTwistAngle(): number {
    let first: { x: number; y: number } | null = null;
    for (const point of this.touchPoints.values()) {
      if (!first) first = point;
      else return Math.atan2(point.y - first.y, point.x - first.x);
    }
    return 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.acceptsInput || isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const code = event.code;
    if (code in PAN_KEYS) {
      this.heldKeys.add(code);
      if (code.startsWith('Arrow')) event.preventDefault();
      return;
    }
    if (event.repeat) return;
    if (code === 'KeyQ') this.orbitStep(-1);
    else if (code === 'KeyE') this.orbitStep(1);
    else if (code === 'Equal' || code === 'NumpadAdd') this.zoomStep(1);
    else if (code === 'Minus' || code === 'NumpadSubtract') this.zoomStep(-1);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.clearHeldInput();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.clearHeldInput();
  };

  private installDebug(debug?: DebugTools): void {
    const folder = debug?.folder('Camera');
    if (!folder) return;
    const t = this.tuning;
    const clamps = () => this.applyClamps();
    folder.add(t, 'panSpeed', 0.1, 2, 0.05);
    folder.add(t, 'panResponse', 2, 30, 1);
    folder.add(t, 'orbitStepDegrees', 15, 90, 15);
    folder.add(t, 'orbitDuration', 0.05, 1, 0.01);
    folder.add(t, 'zoomStep', 1.05, 2, 0.05);
    folder.add(t, 'zoomDuration', 0.05, 1, 0.01);
    folder.add(t, 'resetDuration', 0.1, 1.5, 0.05);
    folder.add(t, 'titleOrbitSpeed', 0, 0.5, 0.01);
    folder.add(t, 'twistDeadzoneDegrees', 0, 30, 1);
    folder.add(t, 'damping', 0.02, 0.5, 0.01).onChange(clamps);
    folder.add(t, 'minPolarDegrees', 5, 60, 1).onChange(clamps);
    folder.add(t, 'maxPolarDegrees', 40, 85, 1).onChange(clamps);
    folder.add(t, 'minDistance', 2, 20, 0.5).onChange(clamps);
    folder.add(t, 'maxDistance', 20, 120, 1).onChange(clamps);
    folder.close();
  }
}
