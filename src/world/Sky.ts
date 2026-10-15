/**
 * Camera-centred sky dome: gradient, horizon glow, sun and moon discs with halos, fbm clouds and stars
 * in one shader. Colours are authored in display space and the shader skips tone mapping, so the
 * horizon matches the scene fog exactly (three applies fog after tone mapping, in output colour space).
 */
import * as THREE from 'three';
import type { DaySample, Rgb } from './dayCycle';

/** Cloud fbm octaves on Medium and High. */
export const SKY_FULL_OCTAVES = 5;

/** A THREE.Color holding raw display-space (sRGB) components, for shaders that skip colour management. */
export function displayColor(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
}

/** Raw display components into a shader colour (the same numbers displayColor() gives for '#rrggbb'). */
function setDisplay(target: THREE.Color, c: Readonly<Rgb>): void {
  target.setRGB(c.r, c.g, c.b, THREE.LinearSRGBColorSpace);
}

export interface SkyPalette {
  top: string;
  horizon: string;
  sunGlow: string;
  sun: string;
}

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation-only view transform: the dome is always centred on the camera and drawn at the far plane.
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunGlow;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCloudCover;
uniform float uCloudShade;
uniform float uStars;
uniform float uSunVisible;
uniform vec3 uMoonDir;
uniform float uMoonVisible;
uniform float uFlash;
uniform vec2 uFlashDir;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// SKY_OCTAVES: 5 = the full look; the Low preset uses 3. Fewer octaves add
// the dropped octaves' mean (a - 0.5^6 after the loop), so the cloud cover stays about the same.
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < SKY_OCTAVES; i++) {
    s += noise(p) * a;
    p = p * 2.02 + vec2(17.1, 9.3);
    a *= 0.5;
  }
#if SKY_OCTAVES < 5
  s += a - 0.015625;
#endif
  return s;
}
float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Sparse point stars: one candidate per 3D cell of the scaled direction p, only a few cells lit.
// px = one pixel in p units (fwidth, taken by the caller in uniform control flow).
const float STAR_SCALE = 150.0;
float starField(vec3 p, float px) {
  vec3 cell = floor(p);
  float h = hash3(cell);
  if (h < 0.93) return 0.0;
  vec3 centre = cell + 0.5 + (vec3(hash3(cell + 7.1), hash3(cell + 13.7), hash3(cell + 29.3)) - 0.5) * 0.5;
  centre = normalize(centre) * STAR_SCALE; // onto the sphere: every candidate is a round point
  float r = length(p - centre) / px;
  float bright = (h - 0.93) / 0.07;
  float twinkle = 0.75 + 0.25 * sin(uTime * (1.3 + 2.0 * h) + h * 91.0);
  return (1.0 - smoothstep(0.5, 1.6, r)) * (0.35 + 0.65 * bright * bright) * twinkle;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);

  // Base gradient: pale horizon to saturated zenith.
  vec3 col = mix(uHorizon, uTop, pow(up, 0.42));

  // Warm glow hugging the horizon on the sun side (golden afternoon).
  vec2 sunH = normalize(uSunDir.xz);
  vec2 dirH = normalize(d.xz + vec2(1e-5));
  float sunSide = max(dot(dirH, sunH), 0.0);
  float band = exp(-up * 4.5);
  col = mix(col, uSunGlow, band * (0.1 + 0.85 * pow(sunSide, 1.3)));

  // Sun: crisp disc, tight corona, broad halo.
  float sd = max(dot(d, uSunDir), 0.0);
  float disc = smoothstep(0.99935, 0.99965, sd);
  float halo = pow(sd, 48.0) * 0.45 + pow(sd, 6.0) * 0.22 + pow(sd, 2.0) * 0.08;
  // Sun-side bloom: a soft warm lift that reaches down into the low sky visible from the title
  // pose (the disc itself sits above/left of that frame).
  float bloom = pow(sunSide, 3.0) * (1.0 - smoothstep(0.0, 0.55, up)) * smoothstep(-0.01, 0.03, y);
  col += uSunColor * (halo + bloom * 0.16) * uSunVisible;

  // Night sky: stars (hidden behind the clouds below) and a soft moon halo.
  vec3 sp = d * STAR_SCALE;
  float spx = max(length(fwidth(sp)), 1e-4);
  if (uStars > 0.0) col += vec3(0.92, 0.95, 1.0) * starField(sp, spx) * uStars * smoothstep(0.02, 0.2, y);
  float md = max(dot(d, uMoonDir), 0.0);
  float moonHalo = pow(md, 90.0) * 0.18 + pow(md, 10.0) * 0.05;
  col += vec3(0.62, 0.7, 0.9) * moonHalo * uMoonVisible;

  // Clouds: fbm on a curved sky plane, fading out at the horizon (haze) and the zenith.
  vec2 uv = d.xz / (up + 0.22) * 1.35 + vec2(uTime * 0.006, uTime * 0.0025);
  float n = fbm(uv);
  float cover = smoothstep(uCloudCover, uCloudCover + 0.2, n);
  float lit = clamp((n - fbm(uv + sunH * 0.12)) * 5.0 + 0.6, 0.0, 1.0);
  vec3 cloudCol = mix(vec3(0.80, 0.85, 0.93), vec3(1.0, 0.985, 0.95), lit);
  // Dimmer clouds take on the horizon colour (peach at dusk, navy at night), moonlit on one side.
  // Written as a sum so uCloudShade = 1 leaves cloudCol bit-identical.
  cloudCol = cloudCol * uCloudShade + (uHorizon * 1.2 + vec3(0.03, 0.035, 0.05) * lit) * (1.0 - uCloudShade);
  cloudCol += uSunColor * halo * 0.6 * uSunVisible;
  cloudCol += vec3(0.5, 0.56, 0.7) * moonHalo * uMoonVisible;
  float cloudMask = cover * smoothstep(0.015, 0.14, y) * (1.0 - smoothstep(0.75, 0.98, y));
  col = mix(col, cloudCol, cloudMask * 0.92);
  // Lightning: the sky lights up from the strike's side, the clouds most. A sum, so uFlash = 0 changes nothing.
  float flashSide = 0.35 + 0.65 * pow(max(dot(dirH, uFlashDir), 0.0), 2.0);
  col += vec3(0.78, 0.84, 1.0) * uFlash * flashSide * (0.3 + 0.5 * cloudMask) * smoothstep(-0.02, 0.1, y);

  // Sun disc sits in front of thin cloud edges only.
  col = mix(col, uSunColor * 1.15, disc * (1.0 - cover * 0.8) * uSunVisible);
  // Moon disc, a little smaller than the sun's, also in front of thin cloud edges only.
  float moonDisc = smoothstep(0.99955, 0.99975, md);
  col = mix(col, vec3(0.93, 0.95, 1.0), moonDisc * (1.0 - cover * 0.8) * uMoonVisible);

  // Below the horizon: exactly the fog colour, so distant terrain melts into the sky.
  col = mix(uHorizon, col, smoothstep(-0.03, 0.004, y));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly uniforms: {
    uTop: THREE.IUniform<THREE.Color>;
    uHorizon: THREE.IUniform<THREE.Color>;
    uSunGlow: THREE.IUniform<THREE.Color>;
    uSunColor: THREE.IUniform<THREE.Color>;
    uSunDir: THREE.IUniform<THREE.Vector3>;
    uTime: THREE.IUniform<number>;
    uCloudCover: THREE.IUniform<number>;
    uCloudShade: THREE.IUniform<number>;
    uStars: THREE.IUniform<number>;
    uSunVisible: THREE.IUniform<number>;
    uMoonDir: THREE.IUniform<THREE.Vector3>;
    uMoonVisible: THREE.IUniform<number>;
    uFlash: THREE.IUniform<number>;
    uFlashDir: THREE.IUniform<THREE.Vector2>;
  };

  constructor(palette: SkyPalette, sunDir: THREE.Vector3) {
    this.uniforms = {
      uTop: { value: displayColor(palette.top) },
      uHorizon: { value: displayColor(palette.horizon) },
      uSunGlow: { value: displayColor(palette.sunGlow) },
      uSunColor: { value: displayColor(palette.sun) },
      uSunDir: { value: sunDir.clone().normalize() },
      uTime: { value: 0 },
      uCloudCover: { value: 0.5 },
      uCloudShade: { value: 1 },
      uStars: { value: 0 },
      uSunVisible: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonVisible: { value: 0 },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector2(1, 0) },
    };
    const material = new THREE.ShaderMaterial({
      name: 'sky-dome',
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      defines: { SKY_OCTAVES: SKY_FULL_OCTAVES },
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  get cloudCover(): number {
    return this.uniforms.uCloudCover.value;
  }

  set cloudCover(value: number) {
    this.uniforms.uCloudCover.value = value;
  }

  /** fbm octaves in the clouds (1..5). A change recompiles the sky once (three caches both programs). */
  get octaves(): number {
    return this.mesh.material.defines.SKY_OCTAVES as number;
  }

  set octaves(value: number) {
    const octaves = Math.min(SKY_FULL_OCTAVES, Math.max(1, Math.round(value)));
    const material = this.mesh.material;
    if (material.defines.SKY_OCTAVES === octaves) return;
    material.defines.SKY_OCTAVES = octaves;
    material.needsUpdate = true;
  }

  /** Lightning brightness 0..1 and the unit heading (xz) it comes from. */
  setFlash(level: number, x: number, z: number): void {
    this.uniforms.uFlash.value = level;
    this.uniforms.uFlashDir.value.set(x, z);
  }

  setTime(seconds: number): void {
    this.uniforms.uTime.value = seconds;
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.uniforms.uSunDir.value.copy(dir).normalize();
  }

  applyDaylight(s: Readonly<DaySample>): void {
    const u = this.uniforms;
    setDisplay(u.uTop.value, s.skyTop);
    setDisplay(u.uHorizon.value, s.skyHorizon);
    setDisplay(u.uSunGlow.value, s.skyGlow);
    setDisplay(u.uSunColor.value, s.skyDisc);
    u.uSunDir.value.set(s.sunDir.x, s.sunDir.y, s.sunDir.z).normalize();
    u.uMoonDir.value.set(s.moonDir.x, s.moonDir.y, s.moonDir.z).normalize();
    u.uSunVisible.value = s.sunVisible;
    u.uMoonVisible.value = s.moonVisible;
    u.uCloudShade.value = s.cloudShade;
    u.uStars.value = s.stars;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
