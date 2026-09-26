/**
 * WP-08 unit tests: particle pool, burst recipes (sizing, determinism, seeded rng only),
 * wind-sway shader patch, and PlacementFx wiring (bus → pools → ≤ 2 FX meshes, stabilize).
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOLS } from '../catalog/tools';
import { createGameBus } from '../game/events';
import { createSeededRandom } from '../utils/random';
import { classify, emitPlaced, emitRemoved, strokeCount, type FxPools } from './fxRecipes';
import { Curve, FLOOR_Y, ParticlePool, type ParticleSpec } from './particlePool';
import { PlacementFx } from './PlacementFx';
import { WIND_SWAY_CACHE_KEY, applyWindSway, patchShader, setWindStrength, updateWindSway, windStrength } from './windSway';

const baseSpec = (overrides: Partial<ParticleSpec> = {}): ParticleSpec => ({
  x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0, life: 1, delay: 0, size: 0.1, gravity: 0, drag: 0,
  spin: 0, flat: 1, curve: Curve.Puff, r: 1, g: 1, b: 1, ...overrides,
});

const pools = (): FxPools => ({ solid: new ParticlePool(512), glint: new ParticlePool(128) });
const total = (p: FxPools) => p.solid.count + p.glint.count;

afterEach(() => {
  vi.restoreAllMocks();
  setWindStrength(1);
  updateWindSway(0);
});

describe('ParticlePool', () => {
  it('spawns, ages and swap-removes dead particles', () => {
    const pool = new ParticlePool(4);
    pool.spawn(baseSpec({ life: 0.1, x: 1 }), 0.1);
    pool.spawn(baseSpec({ life: 1, x: 2 }), 0.2);
    expect(pool.count).toBe(2);
    for (let i = 0; i < 4; i += 1) pool.step(0.05);
    expect(pool.count).toBe(1);
    expect(pool.px[0]).toBe(2); // the survivor moved into slot 0
  });

  it('drops spawns beyond capacity instead of growing', () => {
    const pool = new ParticlePool(2);
    expect(pool.spawn(baseSpec(), 0)).toBe(true);
    expect(pool.spawn(baseSpec(), 0)).toBe(true);
    expect(pool.spawn(baseSpec(), 0)).toBe(false);
    expect(pool.count).toBe(2);
    expect(pool.dropped).toBe(1);
  });

  it('keeps delayed particles invisible and still until their start', () => {
    const pool = new ParticlePool(1);
    pool.spawn(baseSpec({ delay: 0.2, vx: 5 }), 0);
    pool.step(0.05);
    expect(pool.sizeAt(0)).toBe(0);
    expect(pool.px[0]).toBe(0);
    for (let i = 0; i < 5; i += 1) pool.step(0.05);
    expect(pool.sizeAt(0)).toBeGreaterThan(0);
    expect(pool.px[0]).toBeGreaterThan(0);
  });

  it('never sinks below the floor and clamps huge steps', () => {
    const pool = new ParticlePool(1);
    pool.spawn(baseSpec({ gravity: 50, life: 5, curve: Curve.Chip }), 0);
    pool.step(10); // clamped to MAX_STEP
    expect(pool.age[0]).toBeCloseTo(0.05, 5);
    for (let i = 0; i < 40; i += 1) pool.step(0.05);
    expect(pool.py[0]).toBeGreaterThanOrEqual(FLOOR_Y - 1e-6); // Float32 storage
  });

  it('delta 0 is a no-op (reduced motion)', () => {
    const pool = new ParticlePool(1);
    pool.spawn(baseSpec({ vx: 1 }), 0);
    pool.step(0.02);
    const x = pool.px[0];
    pool.step(0);
    expect(pool.px[0]).toBe(x);
  });

  it('size curves start small, peak, and end at 0', () => {
    for (const curve of [Curve.Puff, Curve.Chip, Curve.Glint]) {
      const pool = new ParticlePool(1);
      pool.spawn(baseSpec({ curve, life: 1, size: 1 }), 0.3);
      let peak = 0;
      for (let i = 0; i < 19; i += 1) {
        pool.step(0.05);
        peak = Math.max(peak, pool.sizeAt(0));
      }
      expect(peak).toBeGreaterThan(0.5);
      expect(pool.sizeAt(0)).toBeLessThan(0.35);
    }
  });
});

describe('fx recipes', () => {
  it('classifies every tool into an effect class', () => {
    const classes = Object.fromEntries(TOOLS.filter((t) => t.id !== 'bulldoze').map((t) => [t.id, classify(t.id)]));
    expect(classes).toMatchObject({
      road: 'road', pavement: 'path', walkway: 'path', grass: 'lawn', meadow: 'meadow',
      'tree-a': 'tree', 'tree-b': 'tree', 'tree-c': 'tree',
      'townhouse-a': 'building', 'townhouse-b': 'building', 'townhouse-c': 'building', garage: 'building',
      'bus-stop': 'small-building', 'fence-tall': 'fence', 'fence-small': 'fence', postbox: 'prop', lamppost: 'prop',
    });
  });

  it('sizes placement bursts by category: building > tree > path, and only buildings/props sparkle', () => {
    const counts: Record<string, { solid: number; glint: number; maxSize: number }> = {};
    for (const id of ['road', 'tree-a', 'townhouse-a', 'meadow', 'lamppost', 'fence-tall']) {
      const p = pools();
      emitPlaced(p, createSeededRandom(1), id, 0, 0, 0);
      let maxSize = 0;
      for (let i = 0; i < p.solid.count; i += 1) maxSize = Math.max(maxSize, p.solid.size[i]);
      counts[id] = { solid: p.solid.count, glint: p.glint.count, maxSize };
    }
    expect(counts['townhouse-a'].solid).toBeGreaterThan(counts['tree-a'].solid);
    expect(counts['tree-a'].solid).toBeGreaterThan(counts.road.solid);
    expect(counts['townhouse-a'].maxSize).toBeGreaterThan(counts.road.maxSize);
    expect(counts['townhouse-a'].glint).toBeGreaterThanOrEqual(8);
    expect(counts.road.glint).toBe(0);
    expect(counts['tree-a'].glint).toBe(0);
  });

  it('building sparkles wait for the pop-in', () => {
    const p = pools();
    emitPlaced(p, createSeededRandom(3), 'townhouse-b', 0, 0, 0);
    for (let i = 0; i < p.glint.count; i += 1) expect(p.glint.age[i]).toBeLessThanOrEqual(-0.15);
  });

  it('sizes removal by layer/kind: building poof > prop > path', () => {
    const count = (layer: 'ground' | 'object' | 'edge', kind: string) => {
      const p = pools();
      emitRemoved(p, createSeededRandom(2), layer, kind, 0, 0, 0);
      return total(p);
    };
    expect(count('object', 'townhouse-c')).toBeGreaterThan(count('object', 'postbox'));
    expect(count('object', 'postbox')).toBeGreaterThan(count('ground', 'road'));
    expect(count('edge', 'fence-small')).toBeGreaterThan(0);
    expect(count('ground', 'meadow')).toBeGreaterThan(0);
  });

  it('thins bursts inside a drag stroke', () => {
    expect(strokeCount(6, 0)).toBe(6);
    expect(strokeCount(6, 2)).toBeLessThan(6);
    expect(strokeCount(6, 20, 2)).toBe(2);
    const first = pools();
    const later = pools();
    emitPlaced(first, createSeededRandom(1), 'road', 0, 0, 0);
    emitPlaced(later, createSeededRandom(1), 'road', 0, 0, 12);
    expect(later.solid.count).toBeLessThan(first.solid.count);
  });

  it('a 30-tile road stroke fits the pool without drops', () => {
    const p: FxPools = { solid: new ParticlePool(384), glint: new ParticlePool(96) };
    const rng = createSeededRandom(9);
    for (let i = 0; i < 30; i += 1) {
      emitPlaced(p, rng, 'road', i, 0, i);
      p.solid.step(1 / 60);
      p.solid.step(1 / 60);
    }
    expect(p.solid.dropped).toBe(0);
  });

  it('is deterministic for a seed and never touches Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used in fx');
    });
    const run = () => {
      const p = pools();
      const rng = createSeededRandom(77);
      emitPlaced(p, rng, 'townhouse-a', 1, 2, 0);
      emitRemoved(p, rng, 'object', 'tree-b', -1, 0, 0);
      for (let i = 0; i < 10; i += 1) {
        p.solid.step(1 / 60);
        p.glint.step(1 / 60);
      }
      return [Array.from(p.solid.px.slice(0, p.solid.count)), Array.from(p.glint.py.slice(0, p.glint.count))];
    };
    expect(run()).toEqual(run());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('windSway', () => {
  const fakeShader = () => ({
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
  });

  it('injects an instancing-aware bend after begin_vertex', () => {
    const shader = fakeShader();
    patchShader(shader);
    expect(shader.vertexShader).toContain('uniform float uWindTime;');
    expect(shader.vertexShader).toContain('#ifdef USE_INSTANCING');
    expect(shader.vertexShader).toContain('modelMatrix * instanceMatrix');
    expect(shader.vertexShader.indexOf('#include <begin_vertex>')).toBeLessThan(shader.vertexShader.indexOf('swayBend'));
  });

  it('shares one uniform across every patched material', () => {
    const a = fakeShader();
    const b = fakeShader();
    patchShader(a);
    patchShader(b);
    updateWindSway(4.5);
    expect(a.uniforms.uWindTime).toBe(b.uniforms.uWindTime);
    expect(a.uniforms.uWindTime.value).toBe(4.5);
  });

  it('sets a program cache key, chains onBeforeCompile and is idempotent', () => {
    const material = new THREE.MeshStandardMaterial();
    const before = vi.fn();
    material.onBeforeCompile = before;
    applyWindSway(material);
    const hook = material.onBeforeCompile;
    applyWindSway(material);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey()).toContain(WIND_SWAY_CACHE_KEY);
    const shader = fakeShader();
    material.onBeforeCompile(shader as never, {} as never);
    expect(before).toHaveBeenCalledTimes(1);
    expect(shader.vertexShader).toContain('swayWorld');
  });

  it('leaves shaders without begin_vertex untouched', () => {
    const shader = { uniforms: {}, vertexShader: 'void main() {}' };
    patchShader(shader);
    expect(shader.vertexShader).toBe('void main() {}');
  });
});

describe('PlacementFx', () => {
  it('turns build events into ≤ 2 visible FX meshes and stabilizes to none', () => {
    const scene = new THREE.Scene();
    const bus = createGameBus();
    const fx = new PlacementFx(scene, bus, createSeededRandom(5));
    const meshes = () => scene.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh && c.visible);
    fx.update(1 / 60);
    expect(meshes()).toHaveLength(0);
    expect(fx.getDiagnostics().drawCalls).toBe(0);

    bus.emit('build:placed', { toolId: 'townhouse-a', layer: 'object', cell: { x: 3, z: 3 }, worldX: 0.5, worldZ: 0.5, strokeIndex: 0 });
    bus.emit('build:removed', { layer: 'object', kind: 'tree-a', cell: { x: 4, z: 3 }, worldX: 1.5, worldZ: 0.5, strokeIndex: 0 });
    fx.update(1 / 60);
    expect(fx.getDiagnostics().active).toBeGreaterThan(20);
    expect(fx.getDiagnostics().drawCalls).toBe(2);
    expect(meshes()).toHaveLength(2);
    for (const mesh of meshes()) expect((mesh as THREE.InstancedMesh).castShadow).toBe(false);

    // Particles expire on their own.
    for (let i = 0; i < 120; i += 1) fx.update(1 / 30);
    expect(fx.getDiagnostics().active).toBe(0);
    expect(meshes()).toHaveLength(0);

    // Reduced motion: stabilize clears, blocks spawns and rests the foliage until motion resumes.
    bus.emit('build:placed', { toolId: 'road', layer: 'ground', cell: { x: 3, z: 3 }, worldX: 0.5, worldZ: 0.5, strokeIndex: 0 });
    fx.stabilize();
    expect(fx.getDiagnostics().active).toBe(0);
    expect(windStrength()).toBe(0);
    fx.update(0);
    bus.emit('build:placed', { toolId: 'road', layer: 'ground', cell: { x: 3, z: 3 }, worldX: 0.5, worldZ: 0.5, strokeIndex: 0 });
    expect(fx.getDiagnostics().active).toBe(0);
    expect(fx.getDiagnostics().reducedMotion).toBe(true);
    fx.update(1 / 60);
    expect(fx.getDiagnostics().reducedMotion).toBe(false);
    expect(windStrength()).toBeGreaterThan(0);

    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
