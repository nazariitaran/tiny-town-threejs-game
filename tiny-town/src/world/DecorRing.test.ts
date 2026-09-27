import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE } from '../interaction/CameraController';
import { DECOR_CLEAR_MARGIN, TEMPLATE_RESCALE, TOP_BAR_BAND_PX, cameraForPose, planDecor } from './DecorRing';
import { MODELS } from '../catalog/models';
import { distanceToPlot } from './terrainShape';
import * as THREE from 'three';

describe('planDecor', () => {
  const plan = planDecor();

  it('is deterministic', () => {
    expect(planDecor()).toEqual(plan);
  });

  it('never places decor on or right next to the plot', () => {
    for (const item of plan) expect(distanceToPlot(item.x, item.z)).toBeGreaterThanOrEqual(DECOR_CLEAR_MARGIN);
  });

  it('frames the plot with hedgerow runs on every side', () => {
    const hedges = plan.filter((p) => p.layer === 'hedge');
    expect(hedges.length).toBeGreaterThan(40);
    const sides = new Set(hedges.map((h) => (Math.abs(h.x) > Math.abs(h.z) ? (h.x > 0 ? 'e' : 'w') : h.z > 0 ? 's' : 'n')));
    expect(sides.size).toBe(4);
  });

  it('keeps the top-bar band clear at the default build pose (desktop)', () => {
    const cam = cameraForPose(DEFAULT_POSE, 1280 / 720);
    const limit = 1 - (2 * TOP_BAR_BAND_PX) / 720;
    const p = new THREE.Vector3();
    for (const item of plan) {
      p.set(item.x, item.y, item.z).project(cam);
      const inBand = p.z < 1 && Math.abs(p.x) <= 1 && p.y >= limit && p.y <= 1;
      expect(inBand).toBe(false);
    }
  });

  it('uses at most three decor models (≤ 4 draw calls)', () => {
    expect(new Set(plan.map((p) => p.model)).size).toBeLessThanOrEqual(3);
  });

  it('renders the ring at its v0.1 size although the plot trees grew (WP-12)', () => {
    expect(MODELS['tree-a'].scale * TEMPLATE_RESCALE['tree-a']).toBeCloseTo(0.36, 6);
    expect(MODELS['tree-b'].scale * TEMPLATE_RESCALE['tree-b']).toBeCloseTo(0.36, 6);
    expect(TEMPLATE_RESCALE['decor-rocks']).toBe(1);
  });
});
