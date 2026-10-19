import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { CELL_SIZE, cellToWorld, plot, PLOT_DEPTH, PLOT_WIDTH, setPlotSize } from '../game/config';
import { DEFAULT_POSE, defaultPoseFor, TITLE_POSE, titlePoseFor, type CameraPose } from './CameraController';
import { CENTRE_ABOVE_DOCK_PX, dockTopPx, panStepDelta, SAFE_INSETS } from './framing';

/** Screen-space (CSS px) bounds of the plot corners and its centre at a pose. */
function plotRect(pose: CameraPose, width: number, height: number) {
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 2000);
  camera.position.setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth).add(new THREE.Vector3(pose.targetX, 0, pose.targetZ));
  camera.lookAt(pose.targetX, 0, pose.targetZ);
  camera.updateMatrixWorld();
  const toScreen = (x: number, z: number) => {
    const p = new THREE.Vector3(x, 0, z).project(camera);
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
  };
  const hx = (plot.width / 2) * CELL_SIZE;
  const hz = (plot.depth / 2) * CELL_SIZE;
  const corners = [toScreen(-hx, -hz), toScreen(hx, -hz), toScreen(-hx, hz), toScreen(hx, hz)];
  const round = (v: number) => Math.round(v);
  return {
    left: round(Math.min(...corners.map((c) => c.x))),
    right: round(Math.max(...corners.map((c) => c.x))),
    top: round(Math.min(...corners.map((c) => c.y))),
    bottom: round(Math.max(...corners.map((c) => c.y))),
    centreY: round(toScreen(0, 0).y),
  };
}

describe('build camera framing (readability first)', () => {
  it('desktop 1280×720: plot fills the width inside the side insets, centre well above the dock', () => {
    const pose = defaultPoseFor(1280, 720);
    const rect = plotRect(pose, 1280, 720);
    console.log('defaultPoseFor(1280,720)', JSON.stringify(pose), JSON.stringify(rect));
    const dockTop = dockTopPx(SAFE_INSETS.wide, 720);
    expect(rect.left).toBeGreaterThanOrEqual(SAFE_INSETS.wide.side - 1);
    expect(rect.right).toBeLessThanOrEqual(1280 - SAFE_INSETS.wide.side + 1);
    // The side corners sit just off-screen.
    expect(rect.right - rect.left).toBeGreaterThan(1280);
    expect(rect.centreY).toBeLessThanOrEqual(dockTop - CENTRE_ABOVE_DOCK_PX);
    expect(rect.centreY).toBeGreaterThan(SAFE_INSETS.wide.top);
    // Close enough that buildings read.
    expect(pose.distance).toBeGreaterThan(32);
    expect(pose.distance).toBeLessThan(40);
  });

  it('DEFAULT_POSE is the desktop fit', () => {
    const pose = defaultPoseFor(1280, 720);
    expect(DEFAULT_POSE.distance).toBeCloseTo(pose.distance, 1);
    expect(DEFAULT_POSE.targetX).toBeCloseTo(pose.targetX, 1);
    expect(DEFAULT_POSE.targetZ).toBeCloseTo(pose.targetZ, 1);
    expect(DEFAULT_POSE.polar).toBeCloseTo(pose.polar, 5);
    expect(DEFAULT_POSE.azimuth).toBeCloseTo(pose.azimuth, 5);
  });

  it('phone 390×844: plot centre clearly above the dock, plot ~1.8× the screen width so cells stay tappable', () => {
    const pose = defaultPoseFor(390, 844);
    const rect = plotRect(pose, 390, 844);
    console.log('defaultPoseFor(390,844)', JSON.stringify(pose), JSON.stringify(rect));
    const dockTop = dockTopPx(SAFE_INSETS.narrow, 844);
    expect(rect.centreY).toBeLessThanOrEqual(dockTop - CENTRE_ABOVE_DOCK_PX);
    expect(rect.centreY).toBeGreaterThan(SAFE_INSETS.narrow.top);
    expect(rect.right - rect.left).toBeGreaterThanOrEqual(1.6 * 390);
    expect(pose.distance).toBeLessThan(62);
  });

  it('title: landscape keeps TITLE_POSE; portrait fills the width around the same orbit centre', () => {
    expect(titlePoseFor(1280, 720)).toEqual(TITLE_POSE);
    const pose = titlePoseFor(390, 844);
    const rect = plotRect(pose, 390, 844);
    console.log('titlePoseFor(390,844)', JSON.stringify(pose), JSON.stringify(rect));
    expect(rect.right - rect.left).toBeGreaterThan(0.9 * 390);
    expect(rect.right - rect.left).toBeLessThan(1.8 * 390);
    expect(pose.targetX).toBe(TITLE_POSE.targetX);
    expect(pose.targetZ).toBe(TITLE_POSE.targetZ);
  });

  it('cell pitch at the default pose: ≥ 12 px desktop, ≥ 9 px phone (two cells at the plot centre)', () => {
    const pitch = (width: number, height: number) => {
      const pose = defaultPoseFor(width, height);
      const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 2000);
      camera.position.setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth).add(new THREE.Vector3(pose.targetX, 0, pose.targetZ));
      camera.lookAt(pose.targetX, 0, pose.targetZ);
      camera.updateMatrixWorld();
      const toScreen = (x: number, z: number) => {
        const w = cellToWorld({ x, z });
        const p = new THREE.Vector3(w.x, 0, w.z).project(camera);
        return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
      };
      const c = PLOT_WIDTH / 2;
      const a = toScreen(c, c);
      const b = toScreen(c + 1, c);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    const desktop = pitch(1280, 720);
    const phone = pitch(390, 844);
    console.log(`cell pitch (px): desktop ${desktop.toFixed(1)}, phone ${phone.toFixed(1)}`);
    expect(desktop).toBeGreaterThanOrEqual(12);
    expect(phone).toBeGreaterThanOrEqual(9);
  });
});

describe('build camera framing on the large plot', () => {
  afterEach(() => setPlotSize(PLOT_WIDTH, PLOT_DEPTH));

  it('desktop 1280×720: the whole large plot is framed like the small one, from further out', () => {
    const small = defaultPoseFor(1280, 720);
    setPlotSize(84, 84);
    const pose = defaultPoseFor(1280, 720);
    const rect = plotRect(pose, 1280, 720);
    expect(pose.distance).toBeGreaterThan(small.distance * 1.1);
    expect(rect.left).toBeGreaterThanOrEqual(SAFE_INSETS.wide.side - 1);
    expect(rect.right).toBeLessThanOrEqual(1280 - SAFE_INSETS.wide.side + 1);
    expect(rect.centreY).toBeLessThanOrEqual(dockTopPx(SAFE_INSETS.wide, 720) - CENTRE_ABOVE_DOCK_PX);
  });

  it('a near-square 960×760 window still fits the whole large plot', () => {
    setPlotSize(84, 84);
    const rect = plotRect(defaultPoseFor(960, 760), 960, 760);
    expect(rect.left).toBeGreaterThanOrEqual(SAFE_INSETS.wide.side - 1);
    expect(rect.right).toBeLessThanOrEqual(960 - SAFE_INSETS.wide.side + 1);
  });
});

describe('panStepDelta (on-screen camera pan steps)', () => {
  const fov = THREE.MathUtils.degToRad(35);
  const polar = THREE.MathUtils.degToRad(52);
  const aspect = 16 / 9;

  /** NDC of the old target after the camera and target move by one step. */
  function oldTargetAfter(azimuth: number, right: number, forward: number): THREE.Vector3 {
    const delta = panStepDelta(azimuth, polar, 30, fov, right, forward, 0.25, { x: 0, z: 0 });
    const camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 2000);
    const target = new THREE.Vector3(delta.x, 0, delta.z);
    camera.position.setFromSphericalCoords(30, polar, azimuth).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return new THREE.Vector3(0, 0, 0).project(camera);
  }

  it('moves the view a quarter of the screen height in the screen direction asked, at any azimuth', () => {
    for (const azimuth of [0, Math.PI / 4, 2]) {
      // Up (W): the old centre drops to about a quarter height below the middle (NDC −0.5; the tilt stretches the near half).
      const up = oldTargetAfter(azimuth, 0, 1);
      expect(up.x).toBeCloseTo(0, 5);
      expect(up.y).toBeGreaterThan(-0.7);
      expect(up.y).toBeLessThan(-0.4);
      // Right (D): the same distance on screen, sideways.
      const right = oldTargetAfter(azimuth, 1, 0);
      expect(right.y).toBeCloseTo(0, 5);
      expect(right.x * aspect).toBeCloseTo(-0.5, 1);
    }
  });

  it('is zero for no direction and opposite for opposite directions', () => {
    const out = { x: 0, z: 0 };
    expect(Math.hypot(panStepDelta(1, polar, 30, fov, 0, 0, 0.25, out).x, out.z)).toBe(0);
    const a = { ...panStepDelta(1, polar, 30, fov, 1, -1, 0.25, out) };
    const b = panStepDelta(1, polar, 30, fov, -1, 1, 0.25, out);
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.z).toBeCloseTo(-a.z, 9);
  });
});
