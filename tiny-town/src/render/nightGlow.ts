/**
 * Night glow masks (WP-16b, docs/plans/wp-16-day-night.md §3).
 *
 * Every Kenney atlas here is 512 × 512 in 16 × 4 cells (32 × 128 px), and each glass / lamp / lens
 * face samples one cell. A glow mask is therefore a 16 × 4 DataTexture, ONE texel per atlas cell
 * (NearestFilter, flipY = false like glTF, sRGB): its RGB is the glow colour of that cell, black = no
 * glow. It becomes the material's standard `emissiveMap` with `emissive = #ffffff`, and only
 * `emissiveIntensity` changes with the time of day. Intensity is EXACTLY 0 when `night = 0`, so
 * daytime pixels, baselines and tool icons are untouched (0 × anything = 0 in the shader).
 *
 * GlowRegistry (one per ModelLibrary):
 *  - `createClone(source, kind)`: a private material clone with the kind's mask (ModelLibrary makes
 *    one per (source material, kind), so draw calls don't change: pools are already per model).
 *  - `register(material)`: any further clone of a glow material (clone() keeps emissiveMap and
 *    userData.glowKind), e.g. TownRenderer's lamppost colour clone, joins the intensity updates.
 *  - `update(sample)`: a handful of number writes per frame, no allocations.
 *  - `windows` clones get the house-by-house stagger patch (chained onBeforeCompile,
 *    customProgramCacheKey, idempotent; the fx/windSway.ts pattern). The per-house seed hashes the
 *    instance translation (instanceMatrix under USE_INSTANCING, modelMatrix for plain meshes), so it
 *    survives reloads. `uLightsOn` / `uLightsOff` are ONE shared object for every patched material.
 *
 * Pure parts (cells, mask data, intensity curves) are exported for unit tests.
 */
import * as THREE from 'three';
import type { GlowKind } from '../catalog/models';
import type { DaySample } from '../world/dayCycle';

/** Kenney atlas grid (docs/plans/wp-16-day-night.md, facts table). */
export const ATLAS_COLUMNS = 16;
export const ATLAS_ROWS = 4;

/** The catalog kinds plus the car material's own mask (LifeSystem). */
export type GlowMaskKind = GlowKind | 'headlights';

export interface GlowCell {
  /** 0–15, left to right. */
  col: number;
  /** 0–3, row 0 = the atlas's TOP row (glTF / flipY = false convention). */
  row: number;
  /** Glow colour, display-space '#rrggbb' as a number. */
  color: number;
}

/** Scale a colour's channels (the traffic lenses glow at their own colours × 0.8). */
const scaled = (hex: number, k: number): number =>
  (Math.round(((hex >> 16) & 0xff) * k) << 16) | (Math.round(((hex >> 8) & 0xff) * k) << 8) | Math.round((hex & 0xff) * k);

/** Measured cells (UV-triangle census on ea54bb5, re-checked for WP-16b). */
export const GLOW_CELLS: Readonly<Record<GlowMaskKind, readonly GlowCell[]>> = {
  // Suburban + commercial window glass (119,161,223)–(157,192,237): warm lamplight.
  windows: [{ col: 11, row: 1, color: 0xffc873 }],
  // Roads atlas lamp face (white), under the lamppost's head.
  lamp: [{ col: 8, row: 2, color: 0xfff0c8 }],
  // Roads atlas lenses: red, amber, green (own colours × 0.8). Housing (13, 3) stays dark.
  traffic: [
    { col: 9, row: 1, color: scaled(0xe76047, 0.8) },
    { col: 11, row: 3, color: scaled(0xffb349, 0.8) },
    { col: 15, row: 3, color: scaled(0x3da679, 0.8) },
  ],
  // Car Kit atlas: headlights (3, 3) at native +z, tail lights (5, 3) at native −z.
  headlights: [
    { col: 3, row: 3, color: 0xfff6d8 },
    { col: 5, row: 3, color: 0xff3a2a },
  ],
};

/** RGBA bytes of a kind's 16 × 4 mask; texel (col, row) at index (row · 16 + col) · 4. */
export function glowMaskData(kind: GlowMaskKind): Uint8Array {
  const data = new Uint8Array(ATLAS_COLUMNS * ATLAS_ROWS * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const { col, row, color } of GLOW_CELLS[kind]) {
    const i = (row * ATLAS_COLUMNS + col) * 4;
    data[i] = (color >> 16) & 0xff;
    data[i + 1] = (color >> 8) & 0xff;
    data[i + 2] = color & 0xff;
  }
  return data;
}

/** The atlas cell a UV falls in (glTF UVs: v = 0 at the top), or null outside [0, 1). */
export function atlasCell(u: number, v: number): { col: number; row: number } | null {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return { col: Math.floor(u * ATLAS_COLUMNS), row: Math.floor(v * ATLAS_ROWS) };
}

/** A GPU mask for `kind` (caller owns / disposes it). */
export function createGlowMask(kind: GlowMaskKind): THREE.DataTexture {
  const texture = new THREE.DataTexture(glowMaskData(kind), ATLAS_COLUMNS, ATLAS_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `glow-mask:${kind}`;
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// ---- Intensity curves (pure) -------------------------------------------------------------------

/** Tunables (lil-gui `Night lights`). Every curve is exactly 0 at night = 0. */
export interface GlowTuning {
  windows: number;
  lamp: number;
  traffic: number;
  headlights: number;
  /** Lamps switch on across this `night` range (the plan's "on when night > 0.3"). */
  lampOnFrom: number;
  lampOnTo: number;
}

export const DEFAULT_GLOW_TUNING: Readonly<GlowTuning> = {
  windows: 1.6,
  lamp: 2.4,
  traffic: 1.6,
  headlights: 2.2,
  lampOnFrom: 0.3,
  lampOnTo: 0.42,
};

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 0..1: how far the street lamps are switched on. */
export function lampLevel(night: number, tuning: Readonly<GlowTuning> = DEFAULT_GLOW_TUNING): number {
  return night <= 0 ? 0 : smoothstep(tuning.lampOnFrom, tuning.lampOnTo, night);
}

/** emissiveIntensity of a glow kind at `night` (0 at night = 0, exactly). */
export function glowIntensity(kind: GlowMaskKind, night: number, tuning: Readonly<GlowTuning> = DEFAULT_GLOW_TUNING): number {
  if (!(night > 0)) return 0;
  const n = Math.min(1, night);
  switch (kind) {
    case 'windows':
      return tuning.windows * n;
    case 'lamp':
      return tuning.lamp * lampLevel(n, tuning);
    case 'traffic':
      return tuning.traffic * n;
    case 'headlights':
      return tuning.headlights * n;
  }
}

// ---- Windows stagger shader patch ----------------------------------------------------------------

/** Program cache key for every window-patched material. */
export const WINDOW_GLOW_CACHE_KEY = 'tiny-town:window-glow:v1';

export interface WindowGlowUniforms {
  uLightsOn: { value: number };
  uLightsOff: { value: number };
}

interface ShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

const VERTEX_PARS = /* glsl */ `varying float vGlowSeed;
float glowHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// The seed is taken from the house's translation (quantised to 1/4 world unit so float noise can't
// flip it). Pools draw with an identity model matrix, so instanceMatrix[3] is the world position.
const VERTEX_SEED = /* glsl */ `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec2 glowOrigin = instanceMatrix[3].xz;
  #else
    vec2 glowOrigin = modelMatrix[3].xz;
  #endif
  vGlowSeed = glowHash12(floor(glowOrigin * 4.0 + 0.5) + vec2(113.0, 71.0));
}
`;

const FRAGMENT_PARS = /* glsl */ `varying float vGlowSeed;
uniform float uLightsOn;
uniform float uLightsOff;
`;

const FRAGMENT_STAGGER = /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance *= step(vGlowSeed, uLightsOn) * step(uLightsOff, 1.0 - vGlowSeed);
`;

/** Inject the stagger chunks (exported for unit tests). Shaders without the hooks are left alone. */
export function patchWindowShader(shader: ShaderLike, uniforms: WindowGlowUniforms): void {
  if (!shader.vertexShader.includes('#include <begin_vertex>') || !shader.fragmentShader.includes('#include <emissivemap_fragment>')) return;
  shader.uniforms.uLightsOn = uniforms.uLightsOn;
  shader.uniforms.uLightsOff = uniforms.uLightsOff;
  shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_SEED);
  shader.fragmentShader = FRAGMENT_PARS + shader.fragmentShader.replace('#include <emissivemap_fragment>', FRAGMENT_STAGGER);
}

/** Patch a (private) windows material so houses light up one by one. Idempotent. */
export function applyWindowStagger(material: THREE.Material, uniforms: WindowGlowUniforms): void {
  if (material.userData.windowGlow) return;
  material.userData.windowGlow = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patchWindowShader(shader, uniforms);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${WINDOW_GLOW_CACHE_KEY}`;
  material.needsUpdate = true;
}

// ---- Registry -------------------------------------------------------------------------------------

type GlowMaterial = THREE.MeshStandardMaterial;

/** Levels of the light sources this frame (0..1), read by NightLights for pools / halos / beams. */
export interface GlowLevels {
  night: number;
  lamps: number;
}

export class GlowRegistry {
  /** ONE object shared by every window-patched program: a frame update is two number writes. */
  readonly uniforms: WindowGlowUniforms = { uLightsOn: { value: 0 }, uLightsOff: { value: 0 } };
  readonly tuning: GlowTuning = { ...DEFAULT_GLOW_TUNING };
  readonly levels: GlowLevels = { night: 0, lamps: 0 };
  private readonly masks = new Map<GlowMaskKind, THREE.DataTexture>();
  private readonly entries: Array<{ material: GlowMaterial; kind: GlowMaskKind }> = [];
  private lastNight = 0;

  /** The shared mask texture of a kind (created on first use, owned by the registry). */
  mask(kind: GlowMaskKind): THREE.DataTexture {
    let mask = this.masks.get(kind);
    if (!mask) {
      mask = createGlowMask(kind);
      this.masks.set(kind, mask);
    }
    return mask;
  }

  /** A private clone of `source` that glows as `kind` (registered; the caller owns / disposes it). */
  createClone(source: THREE.Material, kind: GlowMaskKind): GlowMaterial {
    const material = source.clone() as GlowMaterial;
    material.name = `${source.name}:glow:${kind}`;
    this.makeGlow(material, kind);
    return material;
  }

  /** Turn `material` itself into a glow material of `kind` (LifeSystem's car material). */
  makeGlow(material: GlowMaterial, kind: GlowMaskKind): void {
    material.emissiveMap = this.mask(kind);
    material.emissive.setRGB(1, 1, 1);
    material.emissiveIntensity = 0;
    material.userData.glowKind = kind;
    if (kind === 'windows') applyWindowStagger(material, this.uniforms);
    material.needsUpdate = true;
    this.register(material);
  }

  /** Add a clone of a glow material (clone() keeps emissiveMap and userData.glowKind). No-op otherwise. */
  register(material: THREE.Material): void {
    const kind = material.userData.glowKind as GlowMaskKind | undefined;
    if (!kind || this.entries.some((e) => e.material === material)) return;
    const glow = material as GlowMaterial;
    glow.emissiveIntensity = glowIntensity(kind, this.lastNight, this.tuning);
    this.entries.push({ material: glow, kind });
  }

  unregister(material: THREE.Material): void {
    const i = this.entries.findIndex((e) => e.material === material);
    if (i >= 0) this.entries.splice(i, 1);
  }

  /** Registered materials (diagnostics / tests). */
  get size(): number {
    return this.entries.length;
  }

  /** Per frame: intensities from `night`, window stagger from lightsOn / lightsOff. No allocations. */
  update(sample: Readonly<Pick<DaySample, 'night' | 'lightsOn' | 'lightsOff'>>): void {
    const night = sample.night > 0 ? Math.min(1, sample.night) : 0;
    this.lastNight = night;
    this.levels.night = night;
    this.levels.lamps = lampLevel(night, this.tuning);
    this.uniforms.uLightsOn.value = sample.lightsOn;
    this.uniforms.uLightsOff.value = sample.lightsOff;
    for (let i = 0; i < this.entries.length; i += 1) {
      const entry = this.entries[i];
      entry.material.emissiveIntensity = glowIntensity(entry.kind, night, this.tuning);
    }
  }

  /** Re-apply the last update (after a tuning change). */
  refresh(): void {
    for (const entry of this.entries) entry.material.emissiveIntensity = glowIntensity(entry.kind, this.lastNight, this.tuning);
    this.levels.lamps = lampLevel(this.lastNight, this.tuning);
  }

  /** Frees the masks; materials belong to whoever created them. */
  dispose(): void {
    for (const mask of this.masks.values()) mask.dispose();
    this.masks.clear();
    this.entries.length = 0;
  }
}
