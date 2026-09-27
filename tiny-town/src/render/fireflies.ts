/**
 * Fireflies over meadows at night (WP-16b stretch, docs/plans/wp-16-day-night.md §5).
 *
 *  - Up to MAX_FIREFLIES soft additive points, ONE InstancedMesh of camera-facing sprites (+1 draw
 *    call at night, only when the town has an uncovered meadow cell).
 *  - Spots: every free meadow cell ranked by a stable hash of its coordinates (never Math.random, no
 *    RNG stream consumed, survives reloads), the first MAX_FIREFLIES win; jittered inside the cell.
 *  - Motion runs in the vertex shader on the wind clock (fx/windSway.ts windTime / windStrength),
 *    so it freezes under reduced motion and while paused, and rests (no drift, steady glow) after
 *    PlacementFx.stabilize(): screenshots stay deterministic.
 */
import * as THREE from 'three';
import { cellToWorld } from '../game/config';
import type { TownStateReader } from '../town/types';
import { hash01 } from './tween';

export const MAX_FIREFLIES = 24;
/** Only a fully dark town gets fireflies. */
export const FIREFLIES_FROM = 0.6;

export interface FireflySpot {
  x: number;
  y: number;
  z: number;
}

/** Deterministic spots over uncovered meadow cells (row-major scan, hash-ranked). Allocates: call on change only. */
export function pickFireflySpots(town: TownStateReader, max = MAX_FIREFLIES): FireflySpot[] {
  const cells: Array<{ x: number; z: number; rank: number }> = [];
  const cell = { x: 0, z: 0 };
  for (let z = 0; z < town.depth; z += 1) {
    for (let x = 0; x < town.width; x += 1) {
      cell.x = x;
      cell.z = z;
      if (town.getGround(cell) !== 'meadow' || town.getObjectAt(cell)) continue;
      cells.push({ x, z, rank: hash01(x, z, 0xf1) });
    }
  }
  cells.sort((a, b) => a.rank - b.rank);
  const spots: FireflySpot[] = [];
  const world = { x: 0, z: 0 };
  for (const c of cells.slice(0, max)) {
    cellToWorld(c, world);
    spots.push({
      x: world.x + (hash01(c.x, c.z, 0xf2) - 0.5) * 0.3,
      y: 0.14 + hash01(c.x, c.z, 0xf3) * 0.16,
      z: world.z + (hash01(c.x, c.z, 0xf4) - 0.5) * 0.3,
    });
  }
  return spots;
}

export class Fireflies {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly matrix = new THREE.Matrix4();
  private dirty = true;
  size = 0.11;

  constructor(color = '#d9ff85', strength = 1.15) {
    this.material = new THREE.ShaderMaterial({
      name: 'night:fireflies',
      uniforms: {
        uColor: { value: new THREE.Color(color).multiplyScalar(strength) },
        uLevel: { value: 0 },
        uTime: { value: 0 },
        uAmp: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_FIREFLIES);
    this.mesh.name = 'night:fireflies';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** The town changed: re-pick the spots before the next night render. */
  invalidate(): void {
    this.dirty = true;
  }

  get count(): number {
    return this.mesh.count;
  }

  /** Re-pick spots if needed (allocates only then). Returns the firefly count. */
  refresh(town: TownStateReader): number {
    if (!this.dirty) return this.mesh.count;
    this.dirty = false;
    const spots = pickFireflySpots(town);
    spots.forEach((spot, i) => {
      this.matrix.makeScale(this.size, this.size, this.size).setPosition(spot.x, spot.y, spot.z);
      this.mesh.setMatrixAt(i, this.matrix);
    });
    this.mesh.count = spots.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    return spots.length;
  }

  /** Per frame: brightness 0..1, wind clock seconds, drift amplitude 0..1 (0 = rest pose). */
  setState(level: number, time: number, amplitude: number): void {
    this.material.uniforms.uLevel.value = level;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAmp.value = amplitude;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmp;
varying vec2 vUv;
varying float vBlink;
void main() {
  vUv = uv;
  vec3 base = instanceMatrix[3].xyz;
  float s = length(instanceMatrix[0].xyz);
  float ph = fract(sin(dot(floor(base.xz * 16.0), vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  vec3 drift = vec3(
    sin(uTime * 0.43 + ph) * 0.16 + sin(uTime * 1.1 + ph * 3.0) * 0.04,
    sin(uTime * 0.9 + ph * 2.0) * 0.05,
    cos(uTime * 0.37 + ph * 1.7) * 0.16 + cos(uTime * 1.3 + ph * 2.3) * 0.04
  ) * uAmp;
  float blink = 0.5 + 0.5 * sin(uTime * 1.7 + ph * 4.0);
  vBlink = mix(0.8, blink * blink, uAmp);
  vec4 mv = modelViewMatrix * vec4(base + drift, 1.0);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying vec2 vUv;
varying float vBlink;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = (a * a * a + 0.8 * pow(max(1.0 - d * 3.0, 0.0), 2.0)) * uLevel * vBlink;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;
