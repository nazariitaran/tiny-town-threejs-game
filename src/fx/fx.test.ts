import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOLS } from '../catalog/tools';
import { createGameBus } from '../game/events';
import { createSeededRandom } from '../utils/random';
import { buildingBurstRadius, classify, emitPlaced, emitRemoved, footprintPoofRadius, strokeCount, type FxPools } from './fxRecipes';
import { Curve, FLOOR_Y, ParticlePool, type ParticleSpec } from './particlePool';
import { PlacementFx } from './PlacementFx';
import { WIND_SWAY_CACHE_KEY, applyWindSway, patchShader, setWindStrength, updateWindSway, windStrength } from './windSway';

const baseSpec = (overrides: Partial<ParticleSpec> = {}): ParticleSpec => ({
  x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0, life: 1, delay: 0, size: 0.1, gravity: 0, drag: 0,
  spin: 0, flat: 1, curve: Curve.Puff, r: 1, g: 1, b: 1, ...overrides,
});

const pools = (): FxPools => ({ dust: new ParticlePool(512), solid: new ParticlePool(512), glint: new ParticlePool(128) });
const total = (p: FxPools) => p.dust.count + p.solid.count + p.glint.count;

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

  it('dust puffs scale OUT over their life while their alpha fades to 0', () => {
    const pool = new ParticlePool(1);
    pool.spawn(baseSpec({ curve: Curve.Puff, life: 1, size: 1 }), 0.3);
    pool.step(0.05);
    const early = pool.sizeAt(0);
    let peakAlpha = 0;
    for (let i = 0; i < 18; i += 1) {
      pool.step(0.05);
      peakAlpha = Math.max(peakAlpha, pool.alphaAt(0));
    }
    expect(pool.sizeAt(0)).toBeGreaterThan(early);
    expect(peakAlpha).toBeGreaterThan(0.6);
    expect(pool.alphaAt(0)).toBeLessThan(0.02);
  });

  it('chips and sparkles are opaque while alive and shrink to 0', () => {
    for (const curve of [Curve.Chip, Curve.Glint]) {
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
    // Mode tools never place anything of their own (a Move drop reports the moved item's tool).
    const classes = Object.fromEntries(TOOLS.filter((t) => t.category !== 'mode').map((t) => [t.id, classify(t.id)]));
    expect(classes).toEqual({
      road: 'road', pavement: 'path', grass: 'lawn', meadow: 'meadow',
      // group road → road; street / garden → prop; home / amenity → building; tree / plant → tree.
      roundabout: 'road',
      parking: 'road',
      'zebra-crossing': 'road',
      'traffic-light': 'prop', lamppost: 'prop', postbox: 'prop', mailbox: 'prop', 'bus-stop': 'small-building',
      cottage: 'building', townhouse: 'building', bungalow: 'building', 'family-home': 'building',
      'garage-house': 'building', 'big-house': 'building',
      'corner-shop': 'building', 'donut-shop': 'building', supermarket: 'building', church: 'building', stadium: 'building', cinema: 'building', 'swimming-pool': 'building',
      'tiered-fountain': 'building',
      oak: 'tree', pine: 'tree', birch: 'tree', bush: 'tree', tulips: 'tree',
      hedge: 'fence', 'fence-low': 'fence', 'fence-tall': 'fence',
      planter: 'prop', bench: 'prop', 'long-bench': 'prop', 'garden-table': 'prop', swing: 'prop', slide: 'prop', barbecue: 'prop',
    });
  });

  it('classifies removed kinds the same way, and unknown ids as props', () => {
    expect(classify('roundabout')).toBe('road');
    expect(classify('hedge')).toBe('fence');
    // Kinds without a dock tool.
    expect(classify('walkway')).toBe('path');
    expect(classify('fountain')).toBe('building');
    expect(classify('toString')).toBe('prop');
    expect(classify('castle')).toBe('prop');
  });

  it('sizes placement bursts by category: building > tree > path, and only buildings/props sparkle', () => {
    const counts: Record<string, { dust: number; solid: number; glint: number; maxSize: number }> = {};
    for (const id of ['road', 'oak', 'cottage', 'meadow', 'lamppost', 'fence-tall']) {
      const p = pools();
      emitPlaced(p, createSeededRandom(1), id, 0, 0, 0);
      let maxSize = 0;
      for (let i = 0; i < p.dust.count; i += 1) maxSize = Math.max(maxSize, p.dust.size[i]);
      counts[id] = { dust: p.dust.count, solid: p.solid.count, glint: p.glint.count, maxSize };
    }
    expect(counts['cottage'].dust).toBeGreaterThan(counts['oak'].dust);
    expect(counts['cottage'].dust + counts['cottage'].solid).toBeGreaterThan(counts.road.dust + counts.road.solid);
    expect(counts['oak'].dust + counts['oak'].solid).toBeGreaterThan(counts.road.dust + counts.road.solid);
    expect(counts['cottage'].maxSize).toBeGreaterThan(counts.road.maxSize);
    expect(counts['cottage'].glint).toBeGreaterThanOrEqual(8);
    expect(counts.road.glint).toBe(0);
    expect(counts['oak'].glint).toBe(0);
  });

  it('building sparkles wait for the pop-in', () => {
    const p = pools();
    emitPlaced(p, createSeededRandom(3), 'townhouse', 0, 0, 0);
    for (let i = 0; i < p.glint.count; i += 1) expect(p.glint.age[i]).toBeLessThanOrEqual(-0.15);
  });

  it('sizes removal by layer/kind: building poof > prop > path', () => {
    const count = (layer: 'ground' | 'object' | 'edge', kind: string) => {
      const p = pools();
      emitRemoved(p, createSeededRandom(2), layer, kind, 0, 0, 0);
      return total(p);
    };
    expect(count('object', 'family-home')).toBeGreaterThan(count('object', 'postbox'));
    expect(count('object', 'postbox')).toBeGreaterThan(count('ground', 'road'));
    expect(count('edge', 'fence-low')).toBeGreaterThan(0);
    expect(count('ground', 'meadow')).toBeGreaterThan(0);
  });

  it('removal poof rings the footprint at ground level, starts late, and chips stay small', () => {
    const p = pools();
    emitRemoved(p, createSeededRandom(4), 'object', 'cottage', 2, 3, 0);
    expect(p.dust.count).toBeGreaterThan(0);
    for (let i = 0; i < p.dust.count; i += 1) {
      expect(Math.hypot(p.dust.px[i] - 2, p.dust.pz[i] - 3)).toBeGreaterThanOrEqual(0.4); // never over the house
      expect(p.dust.py[i]).toBeLessThanOrEqual(0.08);
      expect(p.dust.size[i]).toBeLessThanOrEqual(0.17);
      expect(p.dust.age[i]).toBeLessThan(0); // delayed: the shrink-out reads first
    }
    for (let i = 0; i < p.solid.count; i += 1) expect(p.solid.size[i]).toBeLessThanOrEqual(0.035);
    expect(p.solid.count).toBeLessThanOrEqual(5);
  });

  it('soft dust stays small at spawn (≤ 0.17 world units, no boulders) and chips ≤ 0.055', () => {
    for (const id of ['road', 'pavement', 'grass', 'meadow', 'oak', 'family-home', 'slide', 'bus-stop', 'fence-tall', 'lamppost']) {
      const p = pools();
      emitPlaced(p, createSeededRandom(8), id, 0, 0, 0);
      for (let i = 0; i < p.dust.count; i += 1) expect(p.dust.size[i]).toBeLessThanOrEqual(0.17);
      for (let i = 0; i < p.solid.count; i += 1) expect(p.solid.size[i]).toBeLessThanOrEqual(0.055);
    }
  });

  it('thins bursts inside a drag stroke', () => {
    expect(strokeCount(6, 0)).toBe(6);
    expect(strokeCount(6, 2)).toBeLessThan(6);
    expect(strokeCount(6, 20, 2)).toBe(2);
    const first = pools();
    const later = pools();
    emitPlaced(first, createSeededRandom(1), 'road', 0, 0, 0);
    emitPlaced(later, createSeededRandom(1), 'road', 0, 0, 12);
    expect(later.dust.count).toBeLessThan(first.dust.count);
  });

  it('a 30-tile road stroke fits the pool without drops', () => {
    const p: FxPools = { dust: new ParticlePool(320), solid: new ParticlePool(256), glint: new ParticlePool(96) };
    const rng = createSeededRandom(9);
    for (let i = 0; i < 30; i += 1) {
      emitPlaced(p, rng, 'road', i, 0, i);
      p.dust.step(1 / 60);
      p.dust.step(1 / 60);
    }
    expect(p.dust.dropped).toBe(0);
  });

  it('is deterministic for a seed and never touches Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used in fx');
    });
    const run = () => {
      const p = pools();
      const rng = createSeededRandom(77);
      emitPlaced(p, rng, 'cottage', 1, 2, 0);
      emitRemoved(p, rng, 'object', 'pine', -1, 0, 0);
      for (let i = 0; i < 10; i += 1) {
        p.dust.step(1 / 60);
        p.solid.step(1 / 60);
        p.glint.step(1 / 60);
      }
      return [Array.from(p.dust.px.slice(0, p.dust.count)), Array.from(p.solid.px.slice(0, p.solid.count)), Array.from(p.glint.py.slice(0, p.glint.count))];
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
    // Height along the model's own Y: a stretched tree bends by its real height.
    expect(shader.vertexShader).toContain('length(swayModel[1].xyz)');
    expect(shader.vertexShader).toContain('swayH -= 0.5 * max(swayH - 1.0, 0.0);');
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
  it('turns build events into ≤ 3 visible FX meshes and stabilizes to none', () => {
    const scene = new THREE.Scene();
    const bus = createGameBus();
    const fx = new PlacementFx(scene, bus, createSeededRandom(5));
    const meshes = () => scene.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh && c.visible);
    fx.update(1 / 60);
    expect(meshes()).toHaveLength(0);
    expect(fx.getDiagnostics().drawCalls).toBe(0);

    bus.emit('build:placed', { toolId: 'cottage', layer: 'object', cell: { x: 3, z: 3 }, worldX: 0.5, worldZ: 0.5, strokeIndex: 0 });
    bus.emit('build:removed', { layer: 'object', kind: 'oak', cell: { x: 4, z: 3 }, worldX: 1.5, worldZ: 0.5, strokeIndex: 0 });
    fx.update(1 / 60);
    expect(fx.getDiagnostics().active).toBeGreaterThan(20);
    expect(fx.getDiagnostics().drawCalls).toBe(3);
    expect(meshes()).toHaveLength(3);
    for (const mesh of meshes()) expect((mesh as THREE.InstancedMesh).castShadow).toBe(false);

    for (let i = 0; i < 120; i += 1) fx.update(1 / 30);
    expect(fx.getDiagnostics().active).toBe(0);
    expect(meshes()).toHaveLength(0);

    // stabilize clears, blocks spawns and rests the foliage until delta > 0.
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

describe('removal poof radius follows the footprint', () => {
  it('hugs a 4×4 house, a 2×1 swing and falls back to the minimum for unknown kinds', () => {
    expect(footprintPoofRadius('cottage', 0.3)).toBeCloseTo(0.95, 5);
    expect(footprintPoofRadius('townhouse', 0.3)).toBeCloseTo(0.95, 5);
    expect(footprintPoofRadius('swing', 0.3)).toBeCloseTo(0.45, 5);
    expect(footprintPoofRadius('postbox', 0.3)).toBe(0.3);
    expect(footprintPoofRadius('toString', 0.28)).toBe(0.28);
    // Placement burst: house-sized up to a 5-cell lot, then out towards the walls (the stadium is 14 cells long).
    for (const kind of ['cottage', 'church', 'big-house', 'supermarket', 'corner-shop']) expect(buildingBurstRadius(kind), kind).toBe(0.48);
    expect(buildingBurstRadius('stadium')).toBeCloseTo(2.7, 5);
  });
});
