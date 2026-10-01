import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, cellToWorld, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { DEFAULT_POSE, defaultPoseFor, TITLE_POSE, titlePoseFor, type CameraPose } from './CameraController';
import { CENTRE_ABOVE_DOCK_PX, dockTopPx, SAFE_INSETS } from './framing';

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
  const hx = (PLOT_WIDTH / 2) * CELL_SIZE;
  const hz = (PLOT_DEPTH / 2) * CELL_SIZE;
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
