/**
 * Soft dust billboards: unit quads expanded in view space by the vertex shader, radial falloff,
 * per-instance alpha from `aAlpha`. Procedural, so it works in Node unit tests.
 */
import * as THREE from 'three';

export const DUST_ALPHA_ATTRIBUTE = 'aAlpha';

const VERTEX = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying vec3 vDustColor;
varying float vAlpha;
void main() {
  vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz);
  centre.xy += position.xy * size;
  gl_Position = projectionMatrix * centre;
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
    vDustColor = instanceColor;
  #else
    vDustColor = vec3(1.0);
  #endif
  vAlpha = aAlpha;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vDustColor;
varying float vAlpha;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = dot(p, p);
  if (d >= 1.0) discard;
  // Soft core, feathered rim (no hard edge, no facets).
  float falloff = 1.0 - smoothstep(0.15, 1.0, d);
  // Faint top-light: a touch brighter on top, a touch warmer/darker underneath.
  vec3 colour = vDustColor * mix(0.9, 1.04, vUv.y);
  gl_FragColor = vec4(colour, falloff * vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createDustMaterial(opacity = 0.9): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'fx:dust',
    uniforms: { uOpacity: { value: opacity } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

/** A unit quad (−1..1) with the per-instance alpha attribute for `capacity` instances. */
export function createDustGeometry(capacity: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(DUST_ALPHA_ATTRIBUTE, alpha);
  return geometry;
}
