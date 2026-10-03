/**
 * Night glow masks. Each Kenney atlas is 16 × 4 cells and each glass / lamp / lens face samples one
 * cell, so a mask is a 16 × 4 DataTexture with one texel per atlas cell (RGB = glow colour, black =
 * none). It becomes the material's `emissiveMap` with `emissive = #ffffff`; only `emissiveIntensity`
 * changes with the time of day, and it is exactly 0 at `night = 0`, so daytime pixels, baselines and
 * tool icons are untouched.
 * `windows` materials also get a house-by-house stagger patch seeded by the instance translation,
 * so it survives reloads.
 */
import * as THREE from 'three';
import type { GlowKind } from '../catalog/models';
import type { DaySample } from '../world/dayCycle';
import type { LitMaterial } from './materials';

/** Kenney atlas grid. */
export const ATLAS_COLUMNS = 16;
export const ATLAS_ROWS = 4;

/** The catalog kinds plus the car material's own mask (LifeSystem). */
export type GlowMaskKind = GlowKind | 'headlights';

export const MASK_GRID: Readonly<Record<GlowMaskKind, { columns: number; rows: number }>> = {
  windows: { columns: ATLAS_COLUMNS, rows: ATLAS_ROWS },
  lamp: { columns: ATLAS_COLUMNS, rows: ATLAS_ROWS },
  traffic: { columns: ATLAS_COLUMNS, rows: ATLAS_ROWS },
  floodlight: { columns: ATLAS_COLUMNS, rows: ATLAS_ROWS },
  headlights: { columns: ATLAS_COLUMNS, rows: ATLAS_ROWS },
};

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

/** Atlas cells measured by a UV-triangle census. */
export const GLOW_CELLS: Readonly<Record<GlowMaskKind, readonly GlowCell[]>> = {
  // Suburban window glass (119,161,223)–(157,192,237): warm lamplight.
  windows: [{ col: 11, row: 1, color: 0xffc873 }],
  // Roads atlas lamp face (white), under the lamppost's head.
  lamp: [{ col: 8, row: 2, color: 0xfff0c8 }],
  // Roads atlas lenses: red, amber, green (own colours × 0.8). Housing (13, 3) stays dark.
  traffic: [
    { col: 9, row: 1, color: scaled(0xe76047, 0.8) },
    { col: 11, row: 3, color: scaled(0xffb349, 0.8) },
    { col: 15, row: 3, color: scaled(0x3da679, 0.8) },
  ],
  // The stadium (roads atlas): its lamps and scoreboard digits, which nothing else on the model samples.
  // What the lamps light is computed in the shader (applyFloodlight), not painted here.
  floodlight: [
    { col: 0, row: 1, color: 0xfff4d6 },
    { col: 5, row: 1, color: scaled(0xffc356, 0.8) },
  ],
  // Car Kit atlas: headlights (3, 3) at native +z, tail lights (5, 3) at native −z.
  headlights: [
    { col: 3, row: 3, color: 0xfff6d8 },
    { col: 5, row: 3, color: 0xff3a2a },
  ],
};

/** RGBA bytes of a kind's mask (16 × 4 for the atlases); texel (col, row) at (row · columns + col) · 4. */
export function glowMaskData(kind: GlowMaskKind): Uint8Array {
  const { columns, rows } = MASK_GRID[kind];
  const data = new Uint8Array(columns * rows * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const { col, row, color } of GLOW_CELLS[kind]) {
    const i = (row * columns + col) * 4;
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
  const { columns, rows } = MASK_GRID[kind];
  const texture = new THREE.DataTexture(glowMaskData(kind), columns, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `glow-mask:${kind}`;
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Every curve is exactly 0 at night = 0. */
export interface GlowTuning {
  windows: number;
  lamp: number;
  traffic: number;
  floodlight: number;
  headlights: number;
  /** How brightly the floodlights light the stadium (× its own colours) at full match level. */
  floodLit: number;
  /** Lamps switch on across this `night` range. */
  lampOnFrom: number;
  lampOnTo: number;
}

export const DEFAULT_GLOW_TUNING: Readonly<GlowTuning> = {
  windows: 1.9,
  lamp: 2.4,
  traffic: 2.6,
  floodlight: 2.6,
  headlights: 2.8,
  floodLit: 2.1,
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

/** How strongly the floodlights light the stadium: less at dusk, while the sky still lights it too. 0 without a match. */
export function floodLitLevel(match: number, night: number, tuning: Readonly<GlowTuning> = DEFAULT_GLOW_TUNING): number {
  if (!(match > 0) || !(night > 0)) return 0;
  return tuning.floodLit * Math.min(1, match) * (0.4 + 0.6 * Math.min(1, night));
}

/**
 * emissiveIntensity of a glow kind at `night` (0 at night = 0, exactly). `match` is the stadium's
 * match level (0..1): its floodlights are off on every other night.
 */
export function glowIntensity(kind: GlowMaskKind, night: number, tuning: Readonly<GlowTuning> = DEFAULT_GLOW_TUNING, match = 0): number {
  if (!(night > 0)) return 0;
  const n = Math.min(1, night);
  switch (kind) {
    case 'windows':
      return tuning.windows * n;
    case 'lamp':
      return tuning.lamp * lampLevel(n, tuning);
    case 'traffic':
      return tuning.traffic * n;
    case 'floodlight':
      return match > 0 ? tuning.floodlight * Math.min(1, match) : 0;
    case 'headlights':
      return tuning.headlights * n;
  }
}

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

/** Shaders without the hooks are left alone. */
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

export const FLOODLIGHT_CACHE_KEY = 'tiny-town:floodlight:v1';
/** Masts per stadium. */
export const FLOOD_LAMPS = 4;

/**
 * The stadium's floodlights as light: four spots at the mast heads (model space), aimed at `uFloodAim`,
 * lighting the model's own surfaces by their colour and normal. `uFloodLevel` 0 adds exactly nothing.
 */
export interface FloodlightUniforms {
  uFloodLevel: { value: number };
  uFloodLamps: { value: THREE.Vector3[] };
  uFloodAim: { value: THREE.Vector3 };
  uFloodColor: { value: THREE.Color };
  /** x: 1 / (falloff distance)², y / z: cosines of the cone's outer / inner half-angle. */
  uFloodShape: { value: THREE.Vector3 };
}

const FLOOD_VERTEX_PARS = /* glsl */ `varying vec3 vFloodPosition;
varying vec3 vFloodNormal;
`;

// Model space: the instance transform only moves, turns and (while popping in) scales the whole stadium.
const FLOOD_VERTEX = /* glsl */ `#include <begin_vertex>
vFloodPosition = position;
vFloodNormal = normal;
`;

const FLOOD_FRAGMENT_PARS = /* glsl */ `varying vec3 vFloodPosition;
varying vec3 vFloodNormal;
uniform float uFloodLevel;
uniform vec3 uFloodLamps[${FLOOD_LAMPS}];
uniform vec3 uFloodAim;
uniform vec3 uFloodColor;
uniform vec3 uFloodShape;
`;

const FLOOD_FRAGMENT = /* glsl */ `#include <emissivemap_fragment>
if (uFloodLevel > 0.0) {
  vec3 floodNormal = normalize(vFloodNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float flood = 0.0;
  for (int i = 0; i < ${FLOOD_LAMPS}; i++) {
    vec3 toLamp = uFloodLamps[i] - vFloodPosition;
    float d2 = max(dot(toLamp, toLamp), 1e-4);
    vec3 l = toLamp * inversesqrt(d2);
    float cone = smoothstep(uFloodShape.y, uFloodShape.z, dot(-l, normalize(uFloodAim - uFloodLamps[i])));
    float facing = clamp((dot(floodNormal, l) + 0.15) / 1.15, 0.0, 1.0);
    flood += cone * facing / (1.0 + d2 * uFloodShape.x);
  }
  totalEmissiveRadiance += diffuseColor.rgb * uFloodColor * (flood * uFloodLevel);
}
`;

/** Shaders without the hooks are left alone. */
export function patchFloodlightShader(shader: ShaderLike, uniforms: FloodlightUniforms): void {
  if (!shader.vertexShader.includes('#include <begin_vertex>') || !shader.fragmentShader.includes('#include <emissivemap_fragment>')) return;
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = FLOOD_VERTEX_PARS + shader.vertexShader.replace('#include <begin_vertex>', FLOOD_VERTEX);
  shader.fragmentShader = FLOOD_FRAGMENT_PARS + shader.fragmentShader.replace('#include <emissivemap_fragment>', FLOOD_FRAGMENT);
}

const floodlit = new WeakSet<THREE.Material>();

/** Patch a (private) floodlight material so the masts light the stadium. Idempotent; a clone needs its own call. */
export function applyFloodlight(material: THREE.Material, uniforms: FloodlightUniforms): void {
  if (floodlit.has(material)) return;
  floodlit.add(material);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patchFloodlightShader(shader, uniforms);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${FLOODLIGHT_CACHE_KEY}`;
  material.needsUpdate = true;
}

type GlowMaterial = LitMaterial;

/** Levels of the light sources this frame (0..1), read by NightLights for pools / halos / beams. */
export interface GlowLevels {
  night: number;
  lamps: number;
  /** The stadium's match level: floodlights and scoreboard. */
  match: number;
}

export class GlowRegistry {
  /** ONE object shared by every window-patched program: a frame update is two number writes. */
  readonly uniforms: WindowGlowUniforms = { uLightsOn: { value: 0 }, uLightsOff: { value: 0 } };
  readonly tuning: GlowTuning = { ...DEFAULT_GLOW_TUNING };
  readonly levels: GlowLevels = { night: 0, lamps: 0, match: 0 };
  /** ONE object shared by every floodlight-patched program. Lamp positions: NightLights measures them from the model. */
  readonly flood: FloodlightUniforms = {
    uFloodLevel: { value: 0 },
    uFloodLamps: { value: Array.from({ length: FLOOD_LAMPS }, () => new THREE.Vector3(0, 2.7, 0)) },
    uFloodAim: { value: new THREE.Vector3(0, 0, 0) },
    uFloodColor: { value: new THREE.Color(0xfff4d6) },
    uFloodShape: { value: new THREE.Vector3(1 / (4.5 * 4.5), 0.55, 0.9) },
  };
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
    if (kind === 'floodlight') applyFloodlight(material, this.flood);
    material.needsUpdate = true;
    this.register(material);
  }

  /** Add a clone of a glow material (clone() keeps emissiveMap and userData.glowKind). No-op otherwise. */
  register(material: THREE.Material): void {
    const kind = material.userData.glowKind as GlowMaskKind | undefined;
    if (!kind || this.entries.some((e) => e.material === material)) return;
    const glow = material as GlowMaterial;
    glow.emissiveIntensity = glowIntensity(kind, this.lastNight, this.tuning, this.levels.match);
    this.entries.push({ material: glow, kind });
  }

  unregister(material: THREE.Material): void {
    const i = this.entries.findIndex((e) => e.material === material);
    if (i >= 0) this.entries.splice(i, 1);
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Per frame: intensities from `night`, window stagger from lightsOn / lightsOff, the stadium's
   * floodlights from `match` (0..1, the match level). No allocations.
   */
  update(sample: Readonly<Pick<DaySample, 'night' | 'lightsOn' | 'lightsOff'>>, match = 0): void {
    const night = sample.night > 0 ? Math.min(1, sample.night) : 0;
    this.lastNight = night;
    this.levels.night = night;
    this.levels.lamps = lampLevel(night, this.tuning);
    this.levels.match = night > 0 && match > 0 ? Math.min(1, match) : 0;
    this.flood.uFloodLevel.value = floodLitLevel(this.levels.match, this.lastNight, this.tuning);
    this.uniforms.uLightsOn.value = sample.lightsOn;
    this.uniforms.uLightsOff.value = sample.lightsOff;
    for (let i = 0; i < this.entries.length; i += 1) {
      const entry = this.entries[i];
      entry.material.emissiveIntensity = glowIntensity(entry.kind, night, this.tuning, this.levels.match);
    }
  }

  /** Re-apply the last update (after a tuning change). */
  refresh(): void {
    for (const entry of this.entries) entry.material.emissiveIntensity = glowIntensity(entry.kind, this.lastNight, this.tuning, this.levels.match);
    this.levels.lamps = lampLevel(this.lastNight, this.tuning);
    this.flood.uFloodLevel.value = floodLitLevel(this.levels.match, this.lastNight, this.tuning);
  }

  /** Frees the masks; materials belong to whoever created them. */
  dispose(): void {
    for (const mask of this.masks.values()) mask.dispose();
    this.masks.clear();
    this.entries.length = 0;
  }
}
