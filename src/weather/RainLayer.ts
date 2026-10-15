/**
 * Falling rain and its splashes: two instanced meshes, animated wholly in the vertex shader.
 *
 * The rain is drawn at two fixed world scales (octaves, see `rainField.ts`), interleaved in one draw call
 * per mesh: even instances draw the even octave, odd ones the odd. Within an octave the box, the drop size
 * and the fall speed are fixed and the wrap is anchored to the world, so panning and zooming move the camera
 * through the rain; as the zoom crosses octaves, one thins out while the other fills in.
 * Camera-dependent uniforms are set just before the meshes draw, so every render (test hooks, photos,
 * paused frames) sees rain fitted to its own camera. Hidden, and no draw call, while it is dry.
 */
import * as THREE from 'three';
import { GROUND_Y } from '../game/config';
import {
  advanceFall,
  fallDirection,
  octaveSlots,
  RAIN_TUNING,
  rainCuts,
  rainOctave,
  SPLASH_CLOCK_WRAP,
  type OctaveSlots,
  type RainCuts,
  type RainOctave,
} from './rainField';

export interface RainDiagnostics {
  /** Drops drawn (both octaves, by their cuts). */
  streaks: number;
  splashes: number;
  /** Instances submitted to the GPU, streaks and splashes together. */
  instances: number;
  /** Lower octave index and the upper one's weight, as of the last render. */
  octave: number;
  octaveMix: number;
  drawCalls: number;
}

export class RainLayer {
  readonly tuning = RAIN_TUNING;
  /** Share of the streaks and splashes drawn (graphics preset). */
  density = 1;
  private readonly group = new THREE.Group();
  private readonly streaks: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly splashes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private rain = 0;
  private splashClock = 0;
  private preparedFrame = -1;
  private readonly octave: RainOctave = { k: 0, mix: 0 };
  private readonly slots: OctaveSlots = { evenScale: 1, oddScale: 2, evenWeight: 1 };
  private readonly streakCuts: RainCuts = { even: 0, odd: 0, band: 1, instances: 0 };
  private readonly splashCuts: RainCuts = { even: 0, odd: 0, band: 1, instances: 0 };
  private readonly phase = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly uniforms = {
    uTime: { value: 0 },
    uCentre: { value: new THREE.Vector3() },
    uScale: { value: new THREE.Vector2(1, 2) },
    uBoxShape: { value: new THREE.Vector3(1, 1, 1) },
    uPhase: { value: new THREE.Vector3() },
    uFall: { value: new THREE.Vector3(0, -1, 0) },
    uCut: { value: new THREE.Vector3() },
    uSplashCut: { value: new THREE.Vector3() },
    uLength: { value: 1 },
    uWidth: { value: 1 },
    uPx: { value: 0.001 },
    uNear: { value: new THREE.Vector2() },
    uFog: { value: new THREE.Vector3(1, 2, 0) },
    uColor: { value: new THREE.Color() },
    uOpacity: { value: 0 },
    uSplashSize: { value: new THREE.Vector2(1, 0) },
    uSplashFar: { value: new THREE.Vector2(1, 2) },
    uSplashOpacity: { value: 0 },
    uGround: { value: GROUND_Y + 0.006 },
  };

  constructor(scene: THREE.Scene, seed: () => number) {
    this.group.name = 'weather:rain';
    this.streaks = new THREE.Mesh(
      seededQuads(2 * this.tuning.maxStreaks, seed, false),
      new THREE.ShaderMaterial({
        name: 'weather:streaks',
        uniforms: this.uniforms,
        vertexShader: STREAK_VERTEX,
        fragmentShader: STREAK_FRAGMENT,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    );
    this.splashes = new THREE.Mesh(
      seededQuads(2 * this.tuning.maxSplashes, seed, true),
      new THREE.ShaderMaterial({
        name: 'weather:splashes',
        uniforms: this.uniforms,
        vertexShader: SPLASH_VERTEX,
        fragmentShader: SPLASH_FRAGMENT,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    );
    // Whichever draws first fits the shared uniforms to the camera; the other finds them done.
    const prepare = (renderer: THREE.WebGLRenderer, renderScene: THREE.Scene, camera: THREE.Camera) => this.prepare(renderer, renderScene, camera);
    for (const mesh of [this.streaks, this.splashes]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.onBeforeRender = prepare;
      this.group.add(mesh);
    }
    this.streaks.name = 'weather:streaks';
    this.splashes.name = 'weather:splashes';
    this.streaks.renderOrder = 6;
    this.splashes.renderOrder = 5;
    scene.add(this.group);
  }

  /**
   * Per frame. `rain` 0..1, `wind` the breeze multiplier, `light` the display-space colour the rain takes
   * (the horizon colour). A `delta` of 0 holds the rain still.
   */
  update(delta: number, rain: number, wind: number, light: Readonly<{ r: number; g: number; b: number }>): void {
    const shown = rain > 0.005;
    this.streaks.visible = shown;
    this.splashes.visible = shown;
    this.rain = shown ? rain : 0;
    if (!shown) return;
    const t = this.tuning;
    const u = this.uniforms;
    fallDirection(wind, t, u.uFall.value);
    advanceFall(this.phase, delta, rain, u.uFall.value, t);
    u.uPhase.value.copy(this.phase);
    this.splashClock = (this.splashClock + delta) % SPLASH_CLOCK_WRAP;
    u.uTime.value = this.splashClock;
    u.uBoxShape.value.set(t.boxWidth, t.boxHeight, t.boxWidth);
    // Heavier rain draws longer streaks.
    u.uLength.value = t.length * (0.7 + 0.6 * rain);
    u.uWidth.value = t.width;
    u.uNear.value.set(t.nearFrom, t.nearTo);
    // A little brighter than the sky behind it, so the rain reads against grey cloud and dark ground alike.
    u.uColor.value.setRGB(0.25 + 0.75 * light.r, 0.27 + 0.75 * light.g, 0.3 + 0.75 * light.b, THREE.LinearSRGBColorSpace);
    u.uOpacity.value = t.opacity * (0.55 + 0.45 * rain);
    u.uSplashSize.value.set(t.splashSize, t.splashMinSize);
    u.uSplashFar.value.set(t.splashFarFrom, t.splashFarTo);
    u.uSplashOpacity.value = t.splashOpacity * (0.5 + 0.5 * rain);
  }

  /** Fits the rain to the camera about to render; once per render call. */
  private prepare(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const frame = renderer.info.render.frame;
    if (frame === this.preparedFrame) return;
    this.preparedFrame = frame;
    const t = this.tuning;
    const u = this.uniforms;
    // The camera distance to where its look ray meets y = 0, the orbit target's plane: the controller's distance.
    const look = camera.getWorldDirection(this.look);
    const origin = camera.position;
    const down = Math.min(look.y, -0.05);
    const distance = Math.max(1, origin.y / -down);
    // Past the ground point along the view's heading, the more so the flatter the view: the frame's far side reaches further.
    const reach = distance * (1 + t.ahead);
    u.uCentre.value.set(origin.x + look.x * reach, 0, origin.z + look.z * reach);
    rainOctave(distance, this.octave);
    const slots = octaveSlots(this.octave, this.slots);
    u.uScale.value.set(slots.evenScale, slots.oddScale);
    // View-space size of one pixel at depth 1: the floor for a streak's width.
    const height = renderer.getContext().drawingBufferHeight;
    u.uPx.value = 2 / (camera.projectionMatrix.elements[5] * Math.max(1, height));
    const fog = scene.fog;
    if (fog instanceof THREE.Fog) u.uFog.value.set(fog.near, Math.max(fog.near + 1, fog.far), t.fogFade);
    else u.uFog.value.set(1, 2, 0);
    const strength = this.rain * this.density;
    rainCuts(t.maxStreaks, strength, slots.evenWeight, this.streakCuts);
    rainCuts(t.maxSplashes, strength, slots.evenWeight, this.splashCuts);
    u.uCut.value.set(this.streakCuts.even, this.streakCuts.odd, this.streakCuts.band);
    u.uSplashCut.value.set(this.splashCuts.even, this.splashCuts.odd, this.splashCuts.band);
    this.streaks.geometry.instanceCount = this.streakCuts.instances;
    this.splashes.geometry.instanceCount = this.splashCuts.instances;
  }

  getDiagnostics(): RainDiagnostics {
    const shown = this.streaks.visible;
    const drops = (cuts: RainCuts) => (shown ? Math.round(cuts.even + cuts.odd) : 0);
    return {
      streaks: drops(this.streakCuts),
      splashes: drops(this.splashCuts),
      instances: shown ? this.streaks.geometry.instanceCount + this.splashes.geometry.instanceCount : 0,
      octave: this.octave.k,
      octaveMix: this.octave.mix,
      drawCalls: shown ? 2 : 0,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of [this.streaks, this.splashes]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}

/** A unit quad per instance with a random `aSeed` in [0, 1)⁴; `flat` lays it on the ground. */
function seededQuads(count: number, seed: () => number, flat: boolean): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const corners = flat ? [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1] : [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
  geometry.setIndex(flat ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i += 1) seeds[i] = seed();
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = 0;
  return geometry;
}

/** Instance → its half (even or odd), that half's scale S, and the drop's thinning under the half's cut. */
const OCTAVE_GLSL = /* glsl */ `
float octaveScale(vec2 scales) {
  return (gl_InstanceID & 1) == 0 ? scales.x : scales.y;
}
float thinning(vec3 cut) {
  float rank = float(gl_InstanceID >> 1);
  float shown = (gl_InstanceID & 1) == 0 ? cut.x : cut.y;
  return clamp((shown - rank) / cut.z + 0.5, 0.0, 1.0);
}
`;

/** Outside clip space: nothing is rasterised and the rest of the shader is skipped. */
const COLLAPSE = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;';

const STREAK_VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform vec2 uScale;
uniform vec3 uBoxShape;
uniform vec3 uPhase;
uniform vec3 uFall;
uniform vec3 uCut;
uniform float uLength;
uniform float uWidth;
uniform float uPx;
uniform vec2 uNear;
uniform vec3 uFog;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vFade;
${OCTAVE_GLSL}
void main() {
  vUv = position.xy + vec2(0.5, 0.0);
  float thin = thinning(uCut);
  if (thin <= 0.0) { ${COLLAPSE} }
  float S = octaveScale(uScale);
  vec3 box = uBoxShape * S;
  // Speeds are j/8 (j = 6..10), so the phase's wrap at 8 boxes moves every drop a whole number of boxes.
  float speed = (6.0 + min(4.0, floor(aSeed.w * 5.0))) / 8.0;
  // World-anchored wrap on a fixed box that follows the view.
  vec3 n = fract(aSeed.xyz + uPhase * speed - uCentre / box);
  vec3 p = (n - vec3(0.5, 0.0, 0.5)) * box + uCentre;
  vec3 tail = p - uFall * (uLength * S * (0.6 + 0.8 * aSeed.w));
  vec4 a = viewMatrix * vec4(p, 1.0);
  vec4 b = viewMatrix * vec4(tail, 1.0);
  float depth = -a.z;
  // Fade out towards the box's sides and top (so the wrap never pops), near the lens, and into the fog.
  vec2 q = abs(n.xz * 2.0 - 1.0);
  float fade = thin * (1.0 - smoothstep(0.75, 1.0, max(q.x, q.y))) * (1.0 - smoothstep(0.8, 1.0, n.y)) * (0.45 + 0.55 * aSeed.w);
  fade *= smoothstep(uNear.x * S, uNear.y * S, depth) * (1.0 - uFog.z * smoothstep(uFog.x, uFog.y, depth));
  if (fade < 0.004) { ${COLLAPSE} }
  // At least ~1 px wide, fainter instead of thinner, so far streaks don't shimmer.
  float width = uWidth * S;
  float least = 0.9 * uPx * depth;
  if (width < least) {
    fade *= width / least;
    width = least;
  }
  vec2 along = normalize(b.xy - a.xy + vec2(1e-5));
  vec4 mv = mix(a, b, position.y);
  mv.xy += vec2(-along.y, along.x) * position.x * width;
  vFade = fade;
  gl_Position = projectionMatrix * mv;
}`;

const STREAK_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  // Bright head (vUv.y = 0, the lower end), fading up the tail.
  float alongFade = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
  gl_FragColor = vec4(uColor, across * alongFade * vFade * uOpacity);
}`;

const SPLASH_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uCentre;
uniform vec2 uScale;
uniform vec3 uBoxShape;
uniform vec3 uSplashCut;
uniform vec2 uSplashSize;
uniform vec2 uSplashFar;
uniform vec3 uFog;
uniform float uGround;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vLife;
varying float vFade;
${OCTAVE_GLSL}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vUv = position.xz;
  float thin = thinning(uSplashCut);
  if (thin <= 0.0) { ${COLLAPSE} }
  float S = octaveScale(uScale);
  vec2 box = uBoxShape.xz * S;
  // Each splash lives 0.35-0.6 s, then lands somewhere else; the cycle wraps so the hash keeps its precision.
  float t = uTime / (0.35 + 0.25 * aSeed.w) + aSeed.z * 7.0;
  float cycle = mod(floor(t), 251.0);
  vLife = fract(t);
  vec2 cell = vec2(hash(aSeed.xy + cycle * 0.37), hash(aSeed.yx + cycle * 0.73 + 3.1));
  vec2 n = fract(cell - uCentre.xz / box);
  vec2 xz = (n - 0.5) * box + uCentre.xz;
  vec2 q = abs(n * 2.0 - 1.0);
  vec4 centre = viewMatrix * vec4(xz.x, uGround, xz.y, 1.0);
  float depth = -centre.z;
  vFade = thin * (1.0 - smoothstep(0.75, 1.0, max(q.x, q.y)));
  vFade *= (1.0 - smoothstep(uSplashFar.x, uSplashFar.y, depth)) * (1.0 - uFog.z * smoothstep(uFog.x, uFog.y, depth));
  if (vFade < 0.004 || depth <= 0.0) { ${COLLAPSE} }
  float size = max(uSplashSize.x, S * uSplashSize.y) * (0.5 + 0.9 * vLife) * (0.7 + 0.6 * aSeed.w);
  vec3 p = vec3(xz.x + position.x * size, uGround, xz.y + position.z * size);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SPLASH_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uSplashOpacity;
varying vec2 vUv;
varying float vLife;
varying float vFade;
void main() {
  float r = length(vUv);
  float ring = smoothstep(0.55, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r));
  float dot0 = (1.0 - smoothstep(0.0, 0.35, r)) * (1.0 - smoothstep(0.0, 0.3, vLife));
  float a = (ring * (1.0 - vLife) + dot0) * vFade * uSplashOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;
