import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE } from '../interaction/CameraController';
import { DECOR_CLEAR_MARGIN, TEMPLATE_RESCALE, TOP_BAR_BAND_PX, cameraForPose, evenDecorSubset, planDecor } from './DecorRing';
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

  it('ring trees keep a 0.36 scale whatever the catalog scale of the plot trees', () => {
    expect(MODELS['oak'].scale * TEMPLATE_RESCALE['oak']).toBeCloseTo(0.36, 6);
    expect(MODELS['pine'].scale * TEMPLATE_RESCALE['pine']).toBeCloseTo(0.36, 6);
    expect(TEMPLATE_RESCALE['decor-rocks']).toBe(1);
  });
});

describe('evenDecorSubset (Low: 60% of the ring, spread evenly)', () => {
  const plan = planDecor();
  const SECTORS = 16;
  const sectorOf = (x: number, z: number) => Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;

  it('keeps everything at 1 and nothing at 0, deterministically', () => {
    const angles = plan.map((p) => Math.atan2(p.z, p.x));
    expect(evenDecorSubset(angles, 1)).toEqual(angles.map((_, i) => i));
    expect(evenDecorSubset(angles, 0)).toEqual([]);
    expect(evenDecorSubset(angles, 0.6)).toEqual(evenDecorSubset(angles, 0.6));
  });

  for (const model of ['oak', 'pine', 'decor-rocks'] as const) {
    it(`${model}: every sector of the ring keeps ≈ 60% of its instances`, () => {
      const items = plan.filter((p) => p.model === model);
      const kept = evenDecorSubset(items.map((p) => Math.atan2(p.z, p.x)), 0.6);
      expect(kept.length).toBe(Math.floor(items.length * 0.6));
      expect(new Set(kept).size).toBe(kept.length);
      const total = new Array<number>(SECTORS).fill(0);
      const left = new Array<number>(SECTORS).fill(0);
      for (const item of items) total[sectorOf(item.x, item.z)] += 1;
      for (const index of kept) left[sectorOf(items[index].x, items[index].z)] += 1;
      for (let s = 0; s < SECTORS; s += 1) {
        if (total[s] === 0) continue;
        // Stride over the angle order: a sector keeps its share, give or take one instance.
        expect(Math.abs(left[s] - total[s] * 0.6), `sector ${s}: ${left[s]} of ${total[s]}`).toBeLessThanOrEqual(1);
        if (total[s] >= 2) expect(left[s], `sector ${s} keeps trees`).toBeGreaterThan(0);
      }
    });
  }

  it('keeps far belt trees too (nearest-first dropped the ones the title camera looks at)', () => {
    const oaks = plan.filter((p) => p.model === 'oak');
    const kept = evenDecorSubset(oaks.map((p) => Math.atan2(p.z, p.x)), 0.6).map((i) => oaks[i]);
    const belt = oaks.filter((p) => p.layer === 'belt').length;
    const keptBelt = kept.filter((p) => p.layer === 'belt').length;
    expect(keptBelt / belt).toBeGreaterThan(0.45);
    expect(keptBelt / belt).toBeLessThan(0.75);
  });
});
