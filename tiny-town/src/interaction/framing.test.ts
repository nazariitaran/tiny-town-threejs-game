import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { DEFAULT_POSE, defaultPoseFor, TITLE_POSE, type CameraPose } from './CameraController';
import { SAFE_INSETS } from './framing';

/** Screen-space (CSS px) bounds of the plot corners at a pose. */
function plotRect(pose: CameraPose, width: number, height: number) {
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 2000);
  camera.position.setFromSphericalCoords(pose.distance, pose.polar, pose.azimuth).add(new THREE.Vector3(pose.targetX, 0, pose.targetZ));
  camera.lookAt(pose.targetX, 0, pose.targetZ);
  camera.updateMatrixWorld();
  const hx = (PLOT_WIDTH / 2) * CELL_SIZE;
  const hz = (PLOT_DEPTH / 2) * CELL_SIZE;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [-hx, hx]) {
    for (const z of [-hz, hz]) {
      const p = new THREE.Vector3(x, 0, z).project(camera);
      xs.push(((p.x + 1) / 2) * width);
      ys.push(((1 - p.y) / 2) * height);
    }
  }
  const centre = new THREE.Vector3(0, 0, 0).project(camera);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), centreY: ((1 - centre.y) / 2) * height };
}

describe('build camera framing', () => {
  it('desktop 1280×720: the whole plot sits between the top bar and the dock', () => {
    const pose = defaultPoseFor(1280, 720);
    const rect = plotRect(pose, 1280, 720);
    console.log('defaultPoseFor(1280,720)', JSON.stringify(pose), JSON.stringify(rect));
    expect(rect.top).toBeGreaterThanOrEqual(SAFE_INSETS.wide.top - 1);
    expect(rect.bottom).toBeLessThanOrEqual(720 - (SAFE_INSETS.wide.bottom as number) + 1);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(1280);
  });

  it('DEFAULT_POSE is the desktop fit', () => {
    const pose = defaultPoseFor(1280, 720);
    expect(DEFAULT_POSE.distance).toBeCloseTo(pose.distance, 1);
    expect(DEFAULT_POSE.targetX).toBeCloseTo(pose.targetX, 1);
    expect(DEFAULT_POSE.targetZ).toBeCloseTo(pose.targetZ, 1);
    expect(DEFAULT_POSE.polar).toBeCloseTo(pose.polar, 5);
    expect(DEFAULT_POSE.azimuth).toBeCloseTo(pose.azimuth, 5);
  });

  it('phone 390×844: the plot centre sits clearly above the dock and the plot top below the top bar', () => {
    const pose = defaultPoseFor(390, 844);
    const rect = plotRect(pose, 390, 844);
    console.log('defaultPoseFor(390,844)', JSON.stringify(pose), JSON.stringify(rect));
    const dockTop = 844 * (1 - 0.32);
    expect(rect.centreY).toBeLessThan(dockTop - 120);
    expect(rect.bottom).toBeLessThanOrEqual(dockTop + 1);
    expect(rect.top).toBeGreaterThanOrEqual(SAFE_INSETS.narrow.top - 1);
  });

  it('TITLE_POSE keeps its landscape values', () => {
    expect(TITLE_POSE.polar).toBeCloseTo((78 * Math.PI) / 180);
  });
});
