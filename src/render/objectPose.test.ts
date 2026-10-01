import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OBJECT_KINDS, objectDef } from '../catalog/objects';
import { edgeOrigin, hasJitter, objectOrigin, objectPose, styleMatrix, styleScale } from './objectPose';

const ROTATIONS = [0, 1, 2, 3] as const;

describe('objectPose', () => {
  it('turns plain objects by their quarter turn at size 1, whatever the id', () => {
    for (const rotation of ROTATIONS) {
      expect(objectPose(objectDef('cottage'), rotation, 42)).toEqual({ yaw: (rotation * Math.PI) / 2, scale: 1, scaleY: 1 });
    }
  });

  it('gives trees and plants a stable hashed yaw, ±12 % size and their height', () => {
    const jittered = OBJECT_KINDS.filter((kind) => hasJitter(objectDef(kind)));
    expect(jittered.sort()).toEqual(['birch', 'bush', 'oak', 'pine', 'tulips']);
    for (let id = 1; id < 200; id += 1) {
      const pose = objectPose(objectDef('pine'), 0, id);
      expect(pose.yaw).toBeGreaterThanOrEqual(0);
      expect(pose.yaw).toBeLessThan(Math.PI * 2);
      expect(pose.scale).toBeGreaterThanOrEqual(0.88);
      expect(pose.scale).toBeLessThan(1.12);
      expect(pose.scaleY).toBe(2);
      // Rotation is ignored: the same id always grows the same tree.
      expect(objectPose(objectDef('pine'), 3, id)).toEqual(pose);
    }
  });

  it('poses a preview (no id yet) without jitter', () => {
    expect(objectPose(objectDef('pine'), 1, null)).toEqual({ yaw: Math.PI / 2, scale: 1, scaleY: 2 });
    expect(objectPose(objectDef('oak'), 0, null)).toEqual({ yaw: 0, scale: 1, scaleY: 1 });
  });
});

describe('object and edge matrices', () => {
  it('puts an object at its rotated footprint centre', () => {
    const def = objectDef('townhouse'); // 3 × 4
    const origin = objectOrigin({ id: 1, anchor: { x: 10, z: 12 }, rotation: 1 }, def, new THREE.Matrix4());
    const position = new THREE.Vector3().setFromMatrixPosition(origin);
    // Rotation 1 covers 4 × 3 cells: centre at cell 10 + 2, 12 + 1.5 on the 64 × 64 plot of 0.5 cells.
    expect(position.x).toBeCloseTo((12 - 32) * 0.5);
    expect(position.z).toBeCloseTo((13.5 - 32) * 0.5);
    expect(position.y).toBe(0);
  });

  it('turns edges across x a quarter turn', () => {
    const along = edgeOrigin({ x: 5, z: 6, side: 'n' }, new THREE.Matrix4());
    const across = edgeOrigin({ x: 5, z: 6, side: 'w' }, new THREE.Matrix4());
    expect(new THREE.Vector3(1, 0, 0).transformDirection(along).x).toBeCloseTo(1);
    expect(new THREE.Vector3(1, 0, 0).transformDirection(across).z).toBeCloseTo(-1);
  });

  it('reads MODEL_STYLES scales (the ones the old ghost missed) and defaults to none', () => {
    expect(styleScale('bush')).toEqual([1, 0.58, 1]);
    expect(styleScale('fence-tall')).toEqual([1, 1.8, 1]);
    expect(styleScale('fence-low')).toEqual([1, 1.4, 1]);
    expect(styleScale('lamppost')).toEqual([1.5, 1, 1.15]);
    expect(styleScale('hedge')).toEqual([1.12, 1, 1]);
    expect(styleScale('cottage')).toEqual([1, 1, 1]);
    expect(styleMatrix('cottage', new THREE.Matrix4()).equals(new THREE.Matrix4())).toBe(true);
  });
});
