/**
 * Shader grid over the plot: anti-aliased cell lines (fwidth), a slightly stronger plot border,
 * fading with camera distance and at grazing angles. One transparent quad, one draw call.
 * Sits just above the ground tiles (y = 0.02) with polygon offset, depthWrite off, so it never
 * z-fights and never hides models (they depth-test over it).
 *
 * WP-04 (World & look).
 */
import * as THREE from 'three';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';

export const GRID_Y = 0.028;
/** Peak line opacity (design cap: ≤ 20%). */
export const GRID_MAX_OPACITY = 0.14;

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec2 uHalf;
uniform float uCell;
uniform vec2 uFade; // camera distance: full opacity until x, gone at y
varying vec3 vWorld;

float gridLine(vec2 p, float widthPx) {
  vec2 w = fwidth(p);
  vec2 g = abs(fract(p - 0.5) - 0.5) / max(w, vec2(1e-4));
  float l = min(g.x, g.y);
  return 1.0 - smoothstep(widthPx - 0.5, widthPx + 0.5, l);
}

void main() {
  vec2 p = vWorld.xz / uCell;
  float lines = gridLine(p, 0.6);
  // Border of the plot a touch stronger.
  vec2 edge = (uHalf - abs(vWorld.xz)) / max(fwidth(vWorld.xz), vec2(1e-4));
  float border = 1.0 - smoothstep(1.0, 2.2, min(edge.x, edge.y));
  float a = max(lines * 0.8, border);
  // Thin out where cells get tiny on screen (distant / grazing) to avoid moire.
  float density = max(fwidth(p.x), fwidth(p.y));
  a *= 1.0 - smoothstep(0.18, 0.45, density);
  float dist = distance(cameraPosition, vWorld);
  a *= 1.0 - smoothstep(uFade.x, uFade.y, dist);
  a *= uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export class GridOverlay {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  constructor() {
    const w = PLOT_WIDTH * CELL_SIZE;
    const d = PLOT_DEPTH * CELL_SIZE;
    const geometry = new THREE.PlaneGeometry(w, d);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      name: 'grid-overlay',
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: GRID_MAX_OPACITY },
        uHalf: { value: new THREE.Vector2(w / 2, d / 2) },
        uCell: { value: CELL_SIZE },
        uFade: { value: new THREE.Vector2(22, 56) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = GRID_Y;
    this.mesh.name = 'grid-overlay';
    this.mesh.renderOrder = 1;
  }

  get opacity(): number {
    return this.mesh.material.uniforms.uOpacity.value as number;
  }

  set opacity(value: number) {
    this.mesh.material.uniforms.uOpacity.value = Math.min(GRID_MAX_OPACITY, Math.max(0, value));
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
