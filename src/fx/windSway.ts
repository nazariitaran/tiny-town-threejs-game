/**
 * Wind sway for foliage materials. A patched material clone is shared by every instance of its model,
 * so per-instance variation comes from the instance's world position. PlacementFx drives the shared uniforms.
 *
 * The offset is computed in world space, so every tree leans the same way whatever its rotation, then
 * mapped back to object space with Mᵀ / s² (rotation × uniform scale). Shadows use three's depth
 * material and don't sway; the motion is a few cm, so the mismatch is invisible.
 */
import type * as THREE from 'three';

export const WIND_SWAY_CACHE_KEY = 'tiny-town:wind-sway:v1';

/** World-space wind heading (xz). */
const WIND_DIR_X = 0.86;
const WIND_DIR_Z = 0.51;
/** Bend at 1 world unit above the model base: linear and quadratic terms (world units). */
const BEND_LINEAR = 0.045;
const BEND_QUADRATIC = 0.035;

/** Shared by every patched program: one write per frame animates all foliage. */
const uniforms = {
  uWindTime: { value: 0 },
  uWindStrength: { value: 1 },
};

const VERTEX_PARS = /* glsl */ `uniform float uWindTime;
uniform float uWindStrength;
`;

const VERTEX_SWAY = /* glsl */ `#include <begin_vertex>
{
  mat4 swayModel = modelMatrix;
  #ifdef USE_INSTANCING
    swayModel = modelMatrix * instanceMatrix;
  #endif
  vec3 swayOrigin = swayModel[3].xyz;
  float swayScale = max(length(swayModel[0].xyz), 1e-4);
  // Height above the base in world units: a tree stretched taller (Y only) bends by its real height.
  float swayH = max(position.y, 0.0) * max(length(swayModel[1].xyz), 1e-4);
  // Past 1 unit (only towering trees get there) the bend grows at half rate: a taller tree sways
  // more, but not so much that it leans into the next cell. Natural trees (< 1 unit) are untouched.
  swayH -= 0.5 * max(swayH - 1.0, 0.0);
  float swayPhase = swayOrigin.x * 0.37 + swayOrigin.z * 0.23;
  float swayGust = sin(uWindTime * 0.9 + swayPhase) * 0.65 + sin(uWindTime * 0.41 + swayPhase * 0.5 + 1.3) * 0.35;
  float swayFlutter = sin(uWindTime * 3.3 + swayPhase * 2.1 + position.x * 5.0 + position.z * 3.0) * 0.22;
  float swayBend = uWindStrength * (swayH * ${BEND_LINEAR.toFixed(4)} + swayH * swayH * ${BEND_QUADRATIC.toFixed(4)});
  vec3 swayWorld = vec3(${WIND_DIR_X.toFixed(3)}, 0.0, ${WIND_DIR_Z.toFixed(3)}) * (swayGust + swayFlutter) * swayBend;
  transformed += (transpose(mat3(swayModel)) * swayWorld) / (swayScale * swayScale);
}
`;

interface ShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

/** Makes a private foliage material sway. Idempotent. */
export function applyWindSway(material: THREE.Material): void {
  if (material.userData.windSway) return;
  material.userData.windSway = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patchShader(shader);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${WIND_SWAY_CACHE_KEY}`;
  material.needsUpdate = true;
}

export function patchShader(shader: ShaderLike): void {
  if (!shader.vertexShader.includes('#include <begin_vertex>')) return;
  shader.uniforms.uWindTime = uniforms.uWindTime;
  shader.uniforms.uWindStrength = uniforms.uWindStrength;
  shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_SWAY);
}

/** `elapsed`: seconds of accumulated animation time. */
export function updateWindSway(elapsed: number): void {
  uniforms.uWindTime.value = elapsed;
}

let breeze = 1;
let gust = 1;

/** 0 = rest pose (reduced motion / screenshots), 1 = normal breeze. */
export function setWindStrength(strength: number): void {
  breeze = strength;
  uniforms.uWindStrength.value = breeze * gust;
}

/** Weather's multiplier on the breeze: 1 = calm. */
export function setWindGust(multiplier: number): void {
  gust = multiplier;
  uniforms.uWindStrength.value = breeze * gust;
}

export function windTime(): number {
  return uniforms.uWindTime.value;
}

export function windStrength(): number {
  return breeze;
}
