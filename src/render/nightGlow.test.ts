import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODELS, type ModelId } from '../catalog/models';
import { createGlbLoader } from '../testing/gltfNode';
import { measureCellCentroid } from './lampRegistry';
import {
  applyFloodlight,
  applyWindowStagger,
  DEFAULT_GLOW_TUNING,
  FLOOD_LAMPS,
  FLOODLIGHT_CACHE_KEY,
  floodLitLevel,
  patchFloodlightShader,
  ATLAS_COLUMNS,
  atlasCell,
  createGlowMask,
  GLOW_CELLS,
  glowIntensity,
  glowMaskData,
  GlowRegistry,
  lampLevel,
  MASK_GRID,
  patchWindowShader,
  WINDOW_GLOW_CACHE_KEY,
  type GlowMaskKind,
} from './nightGlow';

const texel = (data: Uint8Array, col: number, row: number, columns = ATLAS_COLUMNS) => Array.from(data.slice((row * columns + col) * 4, (row * columns + col) * 4 + 4));
const cells = (kind: GlowMaskKind) => GLOW_CELLS[kind].map((c) => `${c.col},${c.row}`);

describe('glow masks', () => {
  it('are 16 × 4 (atlas kinds), one RGBA texel per cell, black except the glow cells', () => {
    expect(Object.keys(MASK_GRID).sort()).toEqual(['floodlight', 'headlights', 'lamp', 'traffic', 'windows']);
    expect(Object.keys(GLOW_CELLS).sort()).toEqual(['floodlight', 'headlights', 'lamp', 'traffic', 'windows']);
    for (const kind of ['windows', 'lamp', 'traffic', 'floodlight', 'headlights'] as const) expect(MASK_GRID[kind]).toEqual({ columns: 16, rows: 4 });
    for (const kind of Object.keys(GLOW_CELLS) as GlowMaskKind[]) {
      const { columns, rows } = MASK_GRID[kind];
      const data = glowMaskData(kind);
      expect(data.length).toBe(columns * rows * 4);
      const lit = new Set(cells(kind));
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const [r, g, b, a] = texel(data, col, row, columns);
          expect(a).toBe(255);
          expect(r + g + b > 0, `${kind} (${col},${row})`).toBe(lit.has(`${col},${row}`));
        }
      }
    }
  });

  it('row 0 is the atlas TOP row (flipY = false, glTF UVs: v = 0 at the top)', () => {
    // The suburban glass samples v ≈ 0.35–0.46 (measured): the second row from the top.
    expect(atlasCell(0.7188, 0.4)).toEqual({ col: 11, row: 1 });
    expect(texel(glowMaskData('windows'), 11, 1).slice(0, 3)).toEqual([0xff, 0xc8, 0x73]);
    // The same column one row lower (what a bottom-up mask would light) stays dark.
    expect(texel(glowMaskData('windows'), 11, 2).slice(0, 3)).toEqual([0, 0, 0]);
    const mask = createGlowMask('windows');
    expect(mask.flipY).toBe(false);
    expect(mask.image.width).toBe(16);
    expect(mask.image.height).toBe(4);
    expect(mask.magFilter).toBe(THREE.NearestFilter);
    expect(mask.minFilter).toBe(THREE.NearestFilter);
    expect(mask.generateMipmaps).toBe(false);
    expect(mask.colorSpace).toBe(THREE.SRGBColorSpace);
    // DataTexture row 0 = the first bytes = v in [0, 0.25) = atlas top row.
    expect(Array.from((mask.image.data as Uint8Array).slice(0, 4))).toEqual([0, 0, 0, 255]);
    mask.dispose();
  });

  it('cell indices match the facts table (16-column terms)', () => {
    expect(cells('windows')).toEqual(['11,1']);
    expect(cells('lamp')).toEqual(['8,2']);
    expect(cells('traffic')).toEqual(['9,1', '11,3', '15,3']);
    // The stadium: its lamps and scoreboard digits only; the pitch, track and paint are lit, not painted.
    expect(cells('floodlight')).toEqual(['0,1', '5,1']);
    expect(GLOW_CELLS.floodlight[0].color).toBe(0xfff4d6);
    for (const [col, row] of [[14, 3], [15, 3], [10, 2], [9, 2]]) expect(texel(glowMaskData('floodlight'), col, row).slice(0, 3), `${col},${row}`).toEqual([0, 0, 0]);
    expect(cells('headlights')).toEqual(['3,3', '5,3']);
    expect(GLOW_CELLS.windows[0].color).toBe(0xffc873);
    expect(GLOW_CELLS.lamp[0].color).toBe(0xfff0c8);
    expect(GLOW_CELLS.headlights.map((c) => c.color)).toEqual([0xfff6d8, 0xff3a2a]);
    // Traffic lenses: own colours × 0.8 (red (231,96,71) → (185,77,57)).
    expect(texel(glowMaskData('traffic'), 9, 1).slice(0, 3)).toEqual([185, 77, 57]);
  });
});

describe('which catalog models glow (shops and the church stay dark at night; the stadium lights its floodlights)', () => {
  const glowing = () =>
    Object.fromEntries(
      (Object.entries(MODELS) as Array<[ModelId, (typeof MODELS)[ModelId]]>).flatMap(([id, spec]) => ('glow' in spec && spec.glow ? [[id, spec.glow]] : [])),
    );

  it('exactly the 12 suburban houses (windows), the lamppost (lamp), both traffic lights (traffic) and the stadium (floodlight)', () => {
    const houses = [
      'cottage', 'townhouse', 'townhouse-alt', 'bungalow', 'bungalow-l', 'family-home',
      'garage-house-c', 'garage-house-o', 'garage-house-s', 'garage-house-u', 'big-house-d', 'big-house-n',
    ];
    expect(glowing()).toEqual({
      ...Object.fromEntries(houses.map((id) => [id, 'windows'])),
      lamppost: 'lamp',
      'traffic-light': 'traffic',
      'traffic-light-hanging': 'traffic',
      stadium: 'floodlight',
    });
    for (const id of houses) expect(MODELS[id as ModelId].url, id).toMatch(/^\/assets\/models\/suburban\/building-type-/);
  });

  it('the supermarket, corner shop and church have no glow', () => {
    for (const id of ['supermarket', 'corner-shop', 'church'] as const) expect('glow' in MODELS[id] ? MODELS[id].glow : undefined, id).toBeUndefined();
  });
});

describe('glow masks against the real assets', () => {
  /** Each glow GLB's geometries, in native space. */
  const census = new Map<string, THREE.BufferGeometry[]>();

  beforeAll(async () => {
    const load = await createGlbLoader();
    const urls = new Set<string>();
    for (const spec of Object.values(MODELS)) if ('glow' in spec && spec.glow) urls.add(spec.url);
    for (const car of ['sedan', 'hatchback-sports', 'van', 'taxi']) urls.add(`/assets/models/cars/${car}.glb`);
    for (const url of urls) {
      const gltf = await load(url);
      gltf.scene.updateMatrixWorld(true);
      const geometries: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) geometries.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      });
      census.set(url, geometries);
    }
  }, 60_000);

  const centroid = (url: string, col: number, row: number) => {
    let best: ReturnType<typeof measureCellCentroid> = null;
    for (const g of census.get(url) ?? []) {
      const c = measureCellCentroid(g.getAttribute('position').array, g.getAttribute('uv').array, g.index ? g.index.array : null, col, row);
      if (c && (!best || c.triangles > best.triangles)) best = c;
    }
    return best;
  };

  it('every catalog glow model samples its kind’s cells', () => {
    for (const [id, spec] of Object.entries(MODELS) as Array<[ModelId, (typeof MODELS)[ModelId]]>) {
      const kind = 'glow' in spec ? spec.glow : undefined;
      if (!kind) continue;
      for (const cell of GLOW_CELLS[kind]) {
        // Traffic lights: every lens; windows/lamp: their single cell.
        expect(centroid(spec.url, cell.col, cell.row)?.triangles ?? 0, `${id} (${cell.col},${cell.row})`).toBeGreaterThan(0);
      }
    }
  });

  it('the lamp face is the measured head (native (0, 0.653, −0.155), facing down)', () => {
    const head = centroid(MODELS.lamppost.url, 8, 2)!;
    expect(head.triangles).toBe(4);
    expect(head.x).toBeCloseTo(0, 2);
    expect(head.y).toBeCloseTo(0.653, 2);
    expect(head.z).toBeCloseTo(-0.155, 2);
  });

  it('the stadium lights its lamps and scoreboard digits; its white and its yellow flags stay out of the mask', () => {
    // Two rows of proud lamp boxes on each of the four masts, five faces each.
    const lamps = centroid(MODELS.stadium.url, 0, 1)!;
    expect(lamps.triangles).toBe(80);
    expect(lamps.x).toBeCloseTo(0, 2);
    expect(lamps.z).toBeCloseTo(0, 1);
    expect(lamps.y).toBeGreaterThan(2.5);
    // The digits face the pitch from the +x end, above the rim.
    const digits = centroid(MODELS.stadium.url, 5, 1)!;
    expect(digits.triangles).toBeGreaterThan(0);
    expect(digits.x).toBeGreaterThan(3);
    expect(digits.y).toBeGreaterThan(1.42);
    // Plain white (8, 2: roof, corner seats, gate, flags; also the lamppost's lamp cell) and the flags'
    // yellow (4, 1) are on the model and outside the mask.
    for (const [col, row] of [[8, 2], [4, 1]]) {
      expect(centroid(MODELS.stadium.url, col, row)!.triangles, `${col},${row}`).toBeGreaterThan(0);
      expect(cells('floodlight')).not.toContain(`${col},${row}`);
    }
  });

  it('the stadium has a bank of lamps in each corner, above the bowl, for the four floodlight spots', () => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      let mast: ReturnType<typeof measureCellCentroid> = null;
      for (const g of census.get(MODELS.stadium.url) ?? []) {
        const inQuadrant = (x: number, _y: number, z: number) => x * sx > 0 && z * sz > 0;
        mast ??= measureCellCentroid(g.getAttribute('position').array, g.getAttribute('uv').array, g.index ? g.index.array : null, 0, 1, undefined, undefined, inQuadrant);
      }
      if (!mast) throw new Error(`no lamps in quadrant ${sx},${sz}`);
      expect(mast.triangles, `${sx},${sz}`).toBe(20);
      expect(Math.abs(mast.x), `${sx},${sz} x`).toBeGreaterThan(2.9);
      expect(Math.abs(mast.x)).toBeLessThan(3.3);
      expect(Math.abs(mast.z), `${sx},${sz} z`).toBeGreaterThan(2.1);
      expect(Math.abs(mast.z)).toBeLessThan(2.6);
      expect(mast.y).toBeGreaterThan(2.55);
    }
  });

  it('cars: headlights at native +z, tail lights at native −z (the car front is +Z)', () => {
    for (const car of ['sedan', 'hatchback-sports', 'van', 'taxi']) {
      const url = `/assets/models/cars/${car}.glb`;
      expect(centroid(url, 3, 3)!.z, `${car} headlights`).toBeGreaterThan(0.5);
      expect(centroid(url, 5, 3)!.z, `${car} tail lights`).toBeLessThan(-0.5);
    }
  });
});

describe('glow intensity', () => {
  it('is exactly 0 at night = 0 for every kind (baselines and icons unchanged)', () => {
    for (const kind of Object.keys(GLOW_CELLS) as GlowMaskKind[]) {
      expect(glowIntensity(kind, 0)).toBe(0);
      expect(glowIntensity(kind, -0.1)).toBe(0);
      expect(glowIntensity(kind, Number.NaN)).toBe(0);
      expect(glowIntensity(kind, 0, DEFAULT_GLOW_TUNING, 1)).toBe(0);
      expect(glowIntensity(kind, 1, DEFAULT_GLOW_TUNING, 1)).toBeGreaterThan(0);
    }
  });

  it('lamps switch on after night 0.3; windows, lenses and headlights scale with night', () => {
    expect(lampLevel(0.25)).toBe(0);
    expect(lampLevel(0.3)).toBe(0);
    expect(lampLevel(0.36)).toBeGreaterThan(0);
    expect(lampLevel(0.5)).toBe(1);

    expect(glowIntensity('windows', 0.5)).toBeCloseTo(glowIntensity('windows', 1) / 2, 6);
    expect(glowIntensity('traffic', 0.25)).toBeCloseTo(glowIntensity('traffic', 1) / 4, 6);
  });
});

describe('stadium floodlights', () => {
  it('lamps and scoreboard follow the match level, not the night alone; 0 by day whatever the match', () => {
    expect(glowIntensity('floodlight', 1)).toBe(0);
    expect(glowIntensity('floodlight', 1, DEFAULT_GLOW_TUNING, 0)).toBe(0);
    expect(glowIntensity('floodlight', 1, DEFAULT_GLOW_TUNING, 1)).toBe(DEFAULT_GLOW_TUNING.floodlight);
    expect(glowIntensity('floodlight', 0.5, DEFAULT_GLOW_TUNING, 0.5)).toBeCloseTo(DEFAULT_GLOW_TUNING.floodlight / 2, 6);
    expect(glowIntensity('floodlight', 0, DEFAULT_GLOW_TUNING, 1)).toBe(0);
    expect(glowIntensity('lamp', 1, DEFAULT_GLOW_TUNING, 0)).toBe(glowIntensity('lamp', 1, DEFAULT_GLOW_TUNING, 1));
  });

  it('the light on the stadium is 0 without a match or by day, and softer at dusk than at night', () => {
    expect(floodLitLevel(0, 1)).toBe(0);
    expect(floodLitLevel(1, 0)).toBe(0);
    expect(floodLitLevel(1, 1)).toBe(DEFAULT_GLOW_TUNING.floodLit);
    expect(floodLitLevel(1, 0.5)).toBeCloseTo(DEFAULT_GLOW_TUNING.floodLit * 0.7, 6);
    expect(floodLitLevel(0.5, 1)).toBeCloseTo(DEFAULT_GLOW_TUNING.floodLit / 2, 6);
  });

  it('the registry drives the lamps and the shared light uniform from the match level', () => {
    const glow = new GlowRegistry();
    const stadium = glow.createClone(new THREE.MeshStandardMaterial(), 'floodlight');
    const lamp = glow.createClone(new THREE.MeshStandardMaterial(), 'lamp');
    glow.update({ night: 1, lightsOn: 1, lightsOff: 0 });
    expect(stadium.emissiveIntensity).toBe(0);
    expect(glow.flood.uFloodLevel.value).toBe(0);
    expect(lamp.emissiveIntensity).toBeGreaterThan(0);
    glow.update({ night: 1, lightsOn: 1, lightsOff: 0 }, 1);
    expect(stadium.emissiveIntensity).toBe(DEFAULT_GLOW_TUNING.floodlight);
    expect(glow.flood.uFloodLevel.value).toBe(DEFAULT_GLOW_TUNING.floodLit);
    expect(glow.levels.match).toBe(1);
    glow.update({ night: 0, lightsOn: 0, lightsOff: 0 }, 1);
    expect(stadium.emissiveIntensity).toBe(0);
    expect(glow.flood.uFloodLevel.value).toBe(0);
    glow.dispose();
  });

  it('patches Standard and Lambert programs once, sharing ONE uniforms object', () => {
    const glow = new GlowRegistry();
    for (const [material, lib] of [
      [new THREE.MeshStandardMaterial(), THREE.ShaderLib.standard],
      [new THREE.MeshLambertMaterial(), THREE.ShaderLib.lambert],
    ] as const) {
      const clone = glow.createClone(material, 'floodlight');
      expect(clone.customProgramCacheKey()).toContain(FLOODLIGHT_CACHE_KEY);
      applyFloodlight(clone, glow.flood);
      expect(clone.customProgramCacheKey().split(FLOODLIGHT_CACHE_KEY).length).toBe(2);
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      clone.onBeforeCompile(shader as never, null as never);
      expect(shader.uniforms.uFloodLevel).toBe(glow.flood.uFloodLevel);
      expect(shader.uniforms.uFloodLamps).toBe(glow.flood.uFloodLamps);
      expect(shader.vertexShader).toContain('vFloodPosition = position;');
      expect(shader.fragmentShader).toContain('if (uFloodLevel > 0.0)');
      expect(shader.fragmentShader.split('uniform float uFloodLevel').length).toBe(2);
    }
    expect(glow.flood.uFloodLamps.value.length).toBe(FLOOD_LAMPS);
    // A shader without the hooks is left alone.
    const bare = { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
    patchFloodlightShader(bare, glow.flood);
    expect(bare.fragmentShader).toBe('void main() {}');
    glow.dispose();
  });
});

describe('GlowRegistry', () => {
  const sample = (night: number, lightsOn = night, lightsOff = 0) => ({ night, lightsOn, lightsOff });

  it('private clones carry the mask, white emissive and intensity 0, and follow update()', () => {
    const glow = new GlowRegistry();
    const source = new THREE.MeshStandardMaterial({ name: 'atlas' });
    const clone = glow.createClone(source, 'lamp');
    expect(clone).not.toBe(source);
    expect(source.emissiveMap).toBeNull();
    expect(clone.emissiveMap).toBe(glow.mask('lamp'));
    expect(clone.emissive.getHex()).toBe(0xffffff);
    expect(clone.emissiveIntensity).toBe(0);
    glow.update(sample(1));
    expect(clone.emissiveIntensity).toBe(glowIntensity('lamp', 1));
    expect(glow.levels).toEqual({ night: 1, lamps: 1, match: 0 });
    glow.update(sample(0));
    expect(clone.emissiveIntensity).toBe(0);
    glow.dispose();
  });

  it("a clone of a glow clone (TownRenderer's lamppost colour style) keeps the mask and can join", () => {
    const glow = new GlowRegistry();
    const base = glow.createClone(new THREE.MeshStandardMaterial(), 'lamp');
    const style = base.clone();
    style.map = null;
    style.color.set('#46505e');
    expect(style.emissiveMap).toBe(base.emissiveMap);
    glow.register(style);
    glow.register(style); // idempotent
    glow.register(new THREE.MeshStandardMaterial()); // not a glow material: ignored
    expect(glow.size).toBe(2);
    glow.update(sample(1));
    expect(style.emissiveIntensity).toBe(glowIntensity('lamp', 1));
    glow.unregister(style);
    glow.update(sample(0));
    expect(style.emissiveIntensity).toBe(glowIntensity('lamp', 1));
    expect(base.emissiveIntensity).toBe(0);
  });

  it('windows clones share ONE uniforms object and a stagger program key; the patch is idempotent', () => {
    const glow = new GlowRegistry();
    const a = glow.createClone(new THREE.MeshStandardMaterial(), 'windows');
    const b = glow.createClone(new THREE.MeshStandardMaterial(), 'windows');
    expect(a.customProgramCacheKey()).toContain(WINDOW_GLOW_CACHE_KEY);
    applyWindowStagger(a, glow.uniforms);
    expect(a.customProgramCacheKey().split(WINDOW_GLOW_CACHE_KEY).length).toBe(2);
    const shaderA = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    const shaderB = { ...shaderA, uniforms: {} as Record<string, { value: unknown }> };
    a.onBeforeCompile(shaderA as never, null as never);
    b.onBeforeCompile(shaderB as never, null as never);
    expect(shaderA.uniforms.uLightsOn).toBe(shaderB.uniforms.uLightsOn);
    expect(shaderA.uniforms.uLightsOn).toBe(glow.uniforms.uLightsOn);
    glow.update(sample(1, 0.6, 0.2));
    expect(glow.uniforms.uLightsOn.value).toBe(0.6);
    expect(glow.uniforms.uLightsOff.value).toBe(0.2);
    // Lamps and lenses are not staggered.
    expect(glow.createClone(new THREE.MeshStandardMaterial(), 'lamp').customProgramCacheKey()).not.toContain(WINDOW_GLOW_CACHE_KEY);
  });

  it('the patch seeds from the instance translation (or the model matrix) and gates the emissive', () => {
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    patchWindowShader(shader, { uLightsOn: { value: 0 }, uLightsOff: { value: 0 } });
    expect(shader.vertexShader).toMatch(/#ifdef USE_INSTANCING\s+vec2 glowOrigin = instanceMatrix\[3\]\.xz;\s+#else\s+vec2 glowOrigin = modelMatrix\[3\]\.xz;/);
    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= step(vGlowSeed, uLightsOn) * step(uLightsOff, 1.0 - vGlowSeed);');
    expect(shader.fragmentShader.indexOf('#include <emissivemap_fragment>')).toBeLessThan(shader.fragmentShader.indexOf('totalEmissiveRadiance *= step'));
    const plain = { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
    patchWindowShader(plain, { uLightsOn: { value: 0 }, uLightsOff: { value: 0 } });
    expect(plain.vertexShader).toBe('void main() {}');
  });
});
