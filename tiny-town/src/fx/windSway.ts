/**
 * Wind sway for foliage materials (trees, bushes, meadow flowers, grass tufts).
 *
 * ModelLibrary (WP-03) calls applyWindSway() on the private material clone of every model with
 * `sway: true`; those clones are shared by every instance of that model (town InstancePools and
 * WP-04's DecorRing), so all per-instance variation comes from the instance's world position.
 * PlacementFx.update() drives the shared uniforms through updateWindSway()/setWindStrength(), so
 * the sway follows the game's animation delta: frozen under reduced motion, rest pose after
 * PlacementFx.stabilize().
 *
 * Shader (shader-cookbook "(c) Wind sway", instancing-aware):
 *  - The offset is computed in WORLD space so every tree leans the same way whatever its rotation,
 *    then mapped back to object space with the inverse of (model × instance) (rotation × uniform
 *    scale ⇒ inverse = Mᵀ / s²). Works for InstancedMesh and for plain meshes (createObject).
 *  - Per-instance phase = world translation of the instance, so neighbours ripple, not march.
 *  - Bend grows with height (linear + quadratic): the base stays planted, crowns move most.
 *  - All materials share ONE uniform object, so a frame update is two float writes.
 *  - Shadows use three's internal depth material and do not sway; the motion is a few cm on a
 *    0.7-unit tree, so the mismatch is invisible.
 *
 * WP-08 (Feel & VFX).
 */
import type * as THREE from 'three';

/** Program cache key for every sway-patched material (onBeforeCompile rule, shader-cookbook). */
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
  float swayH = max(position.y, 0.0) * swayScale;
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

/**
 * Patch a (private) foliage material so its vertices sway. Idempotent. Materials whose vertex
 * stage has no `#include <begin_vertex>` are left untouched when compiled.
 */
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

/** Inject the sway chunk into a shader's vertex stage (exported for unit tests). */
export function patchShader(shader: ShaderLike): void {
  if (!shader.vertexShader.includes('#include <begin_vertex>')) return;
  shader.uniforms.uWindTime = uniforms.uWindTime;
  shader.uniforms.uWindStrength = uniforms.uWindStrength;
  shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_SWAY);
}

/** Set the shared wind clock (seconds of accumulated animation time). */
export function updateWindSway(elapsed: number): void {
  uniforms.uWindTime.value = elapsed;
}

/** 0 = rest pose (reduced motion / screenshots), 1 = normal breeze. */
export function setWindStrength(strength: number): void {
  uniforms.uWindStrength.value = strength;
}

/** Current uniform values (diagnostics and tests). Returns a live read, no allocation. */
export function windTime(): number {
  return uniforms.uWindTime.value;
}

export function windStrength(): number {
  return uniforms.uWindStrength.value;
}
