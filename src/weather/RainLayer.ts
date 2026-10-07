/**
 * Falling rain and its splashes: two instanced meshes, animated wholly in the vertex shader.
 *
 * Streaks live in a box centred on the view's ground target and sized by the camera's distance, so the
 * rain looks the same at every zoom. Their positions wrap on the box, anchored to the world, so panning
 * slides the view through the rain; zooming scales it. Splashes are rings on the ground under the same box.
 * Hidden, and no draw call, while it is dry.
 */
import * as THREE from 'three';
import { GROUND_Y } from '../game/config';

export interface RainTuning {
  /** Streaks at full strength; the preset's share of them is drawn. */
  maxStreaks: number;
  maxSplashes: number;
  /** Box width and height in camera distances. */
  boxWidth: number;
  boxHeight: number;
  /** Streak length and width, and fall speed per second, in camera distances. */
  length: number;
  width: number;
  speed: number;
  /** Sideways drift per unit of fall at wind 1. */
  slant: number;
  opacity: number;
  /** Splash radius in world units, and the least it may be, in camera distances. */
  splashSize: number;
  splashMinSize: number;
  splashOpacity: number;
}

export const RAIN_TUNING: RainTuning = {
  maxStreaks: 2600,
  maxSplashes: 900,
  boxWidth: 1.5,
  boxHeight: 0.62,
  length: 0.03,
  width: 0.0011,
  speed: 0.85,
  slant: 0.1,
  opacity: 0.55,
  splashSize: 0.07,
  splashMinSize: 0.0022,
  splashOpacity: 0.5,
};

/** World heading (xz) the rain leans towards: the foliage's wind heading. */
const WIND_X = 0.86;
const WIND_Z = 0.51;

export interface RainDiagnostics {
  streaks: number;
  splashes: number;
  drawCalls: number;
}

export class RainLayer {
  readonly tuning = RAIN_TUNING;
  /** Share of the streaks and splashes drawn (graphics preset). */
  density = 1;
  private readonly group = new THREE.Group();
  private readonly streaks: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly splashes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private time = 0;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCentre: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(1, 1, 1) },
    uFall: { value: new THREE.Vector3(0, -1, 0) },
    uLength: { value: 1 },
    uWidth: { value: 1 },
    uSpeed: { value: 1 },
    uColor: { value: new THREE.Color() },
    uOpacity: { value: 0 },
    uSplashSize: { value: 1 },
    uSplashOpacity: { value: 0 },
    uGround: { value: GROUND_Y + 0.006 },
  };

  constructor(scene: THREE.Scene, seed: () => number) {
    this.group.name = 'weather:rain';
    this.streaks = new THREE.Mesh(
      seededQuads(this.tuning.maxStreaks, seed, false),
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
      seededQuads(this.tuning.maxSplashes, seed, true),
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
    for (const mesh of [this.streaks, this.splashes]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
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
   * (the horizon colour), `target` the view's ground point, `distance` the camera's distance to it.
   */
  update(delta: number, rain: number, wind: number, light: Readonly<{ r: number; g: number; b: number }>, target: Readonly<THREE.Vector3>, distance: number): void {
    const shown = rain > 0.005;
    this.streaks.visible = shown;
    this.splashes.visible = shown;
    if (!shown) return;
    const t = this.tuning;
    const u = this.uniforms;
    this.time += delta;
    u.uTime.value = this.time;
    const d = Math.max(4, distance);
    u.uBox.value.set(d * t.boxWidth, d * t.boxHeight, d * t.boxWidth);
    u.uCentre.value.set(target.x, 0, target.z);
    const lean = t.slant * wind;
    u.uFall.value.set(WIND_X * lean, -1, WIND_Z * lean).normalize();
    // Heavier rain falls faster and draws longer.
    u.uLength.value = d * t.length * (0.7 + 0.6 * rain);
    u.uWidth.value = d * t.width;
    u.uSpeed.value = d * t.speed * (0.8 + 0.4 * rain);
    // A little brighter than the sky behind it, so the rain reads against grey cloud and dark ground alike.
    u.uColor.value.setRGB(0.25 + 0.75 * light.r, 0.27 + 0.75 * light.g, 0.3 + 0.75 * light.b, THREE.LinearSRGBColorSpace);
    u.uOpacity.value = t.opacity * (0.55 + 0.45 * rain);
    u.uSplashSize.value = Math.max(t.splashSize, d * t.splashMinSize);
    u.uSplashOpacity.value = t.splashOpacity * (0.5 + 0.5 * rain);
    this.streaks.geometry.instanceCount = Math.max(1, Math.round(t.maxStreaks * this.density * rain));
    this.splashes.geometry.instanceCount = Math.max(1, Math.round(t.maxSplashes * this.density * rain));
  }

  getDiagnostics(): RainDiagnostics {
    const shown = this.streaks.visible;
    return {
      streaks: shown ? this.streaks.geometry.instanceCount : 0,
      splashes: shown ? this.splashes.geometry.instanceCount : 0,
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

const STREAK_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform vec3 uFall;
uniform float uLength;
uniform float uWidth;
uniform float uSpeed;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = position.xy + vec2(0.5, 0.0);
  float speed = uSpeed * (0.8 + 0.4 * aSeed.w);
  // World-anchored wrap on a box that follows the view; in box units, so a zoom scales the rain instead of reshuffling it.
  vec3 n = fract(aSeed.xyz + (uFall * (uTime * speed) - uCentre) / uBox);
  vec3 p = (n - vec3(0.5, 0.0, 0.5)) * uBox + uCentre;
  vec3 tail = p - uFall * uLength * (0.6 + 0.8 * aSeed.w);
  vec4 a = viewMatrix * vec4(p, 1.0);
  vec4 b = viewMatrix * vec4(tail, 1.0);
  vec2 along = normalize(b.xy - a.xy + vec2(1e-5));
  vec4 mv = mix(a, b, position.y);
  mv.xy += vec2(-along.y, along.x) * position.x * uWidth;
  // Fade out towards the box's sides and top, so the wrap never pops.
  vec2 q = abs(n.xz * 2.0 - 1.0);
  vFade = (1.0 - smoothstep(0.75, 1.0, max(q.x, q.y))) * (1.0 - smoothstep(0.8, 1.0, n.y)) * (0.45 + 0.55 * aSeed.w);
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
uniform vec3 uBox;
uniform float uSplashSize;
uniform float uGround;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vLife;
varying float vFade;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vUv = position.xz;
  // Each splash lives 0.35-0.6 s, then lands somewhere else.
  float t = uTime / (0.35 + 0.25 * aSeed.w) + aSeed.z * 7.0;
  float cycle = floor(t);
  vLife = fract(t);
  vec2 cell = vec2(hash(aSeed.xy + cycle * 0.37), hash(aSeed.yx + cycle * 0.73 + 3.1));
  vec2 n = fract(cell - uCentre.xz / uBox.xz);
  vec2 xz = (n - 0.5) * uBox.xz + uCentre.xz;
  vec2 q = abs(n * 2.0 - 1.0);
  vFade = 1.0 - smoothstep(0.75, 1.0, max(q.x, q.y));
  float size = uSplashSize * (0.5 + 0.9 * vLife) * (0.7 + 0.6 * aSeed.w);
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
