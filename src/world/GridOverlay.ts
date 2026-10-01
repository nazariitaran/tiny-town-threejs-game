/**
 * Shader grid over the plot: anti-aliased major lines every ROAD_BLOCK cells and fainter cell lines,
 * each thinning out when too dense on screen (no moiré), fading with camera distance. Polygon offset
 * and no depth write, so it never z-fights and models depth-test over it. At night the lines turn a
 * dim moonlit blue and take the scene fog, so they don't read as a harsh overlay on the dark ground.
 */
import * as THREE from 'three';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { ROAD_BLOCK } from '../town/grid';

/** Minor (single-cell) line strength relative to the major road-lattice lines. */
export const GRID_MINOR_STRENGTH = 0.45;

export const GRID_Y = 0.028;
export const GRID_MAX_OPACITY = 0.14;
/**
 * At night the lines are (1 + boost · night)× stronger, the only case above GRID_MAX_OPACITY,
 * and blend from white to `color` (display sRGB).
 */
export const GRID_NIGHT = { boost: 0.25, color: '#7896c4' };

const vertexShader = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec2 uHalf;
uniform float uCell;
uniform float uMajor;
uniform float uMinorStrength;
uniform vec2 uFade; // camera distance: full opacity until x, gone at y
varying vec3 vWorld;
#include <fog_pars_fragment>

float gridLine(vec2 p, float widthPx) {
  vec2 w = fwidth(p);
  vec2 g = abs(fract(p - 0.5) - 0.5) / max(w, vec2(1e-4));
  float l = min(g.x, g.y);
  return 1.0 - smoothstep(widthPx - 0.5, widthPx + 0.5, l);
}

void main() {
  vec2 p = vWorld.xz / uCell;
  vec2 q = p / uMajor;
  // Thin each line set out where its cells get tiny on screen (distant / grazing) to avoid moire.
  float minorFade = 1.0 - smoothstep(0.18, 0.45, max(fwidth(p.x), fwidth(p.y)));
  float majorFade = 1.0 - smoothstep(0.18, 0.45, max(fwidth(q.x), fwidth(q.y)));
  float minor = gridLine(p, 0.6) * uMinorStrength * minorFade;
  float major = gridLine(q, 0.6) * majorFade;
  // Border of the plot a touch stronger.
  vec2 edge = (uHalf - abs(vWorld.xz)) / max(fwidth(vWorld.xz), vec2(1e-4));
  float border = 1.0 - smoothstep(1.0, 2.2, min(edge.x, edge.y));
  float a = max(max(minor, major) * 0.8, border * majorFade);
  float dist = distance(cameraPosition, vWorld);
  a *= 1.0 - smoothstep(uFade.x, uFade.y, dist);
  a *= uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

export class GridOverlay {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** Day opacity (debug slider, clamped to GRID_MAX_OPACITY); the uniform adds the night boost. */
  private baseOpacity = GRID_MAX_OPACITY;
  private night = 0;
  private readonly dayColor = new THREE.Color(1, 1, 1);
  private readonly nightColor = new THREE.Color();

  constructor() {
    const w = PLOT_WIDTH * CELL_SIZE;
    const d = PLOT_DEPTH * CELL_SIZE;
    const geometry = new THREE.PlaneGeometry(w, d);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      name: 'grid-overlay',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: GRID_MAX_OPACITY },
        uHalf: { value: new THREE.Vector2(w / 2, d / 2) },
        uCell: { value: CELL_SIZE },
        uMajor: { value: ROAD_BLOCK },
        uMinorStrength: { value: GRID_MINOR_STRENGTH },
        uFade: { value: new THREE.Vector2(30, 75) },
      },
      vertexShader,
      fragmentShader,
      fog: true,
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
    return this.baseOpacity;
  }

  set opacity(value: number) {
    this.baseOpacity = Math.min(GRID_MAX_OPACITY, Math.max(0, value));
    this.updateOpacity();
  }

  /** 0 day .. 1 night; exactly the day look at 0. */
  setNight(night: number): void {
    this.night = Math.min(1, Math.max(0, night));
    this.nightColor.setStyle(GRID_NIGHT.color, THREE.SRGBColorSpace);
    this.mesh.material.uniforms.uColor.value.copy(this.dayColor).lerp(this.nightColor, this.night);
    this.updateOpacity();
  }

  private updateOpacity(): void {
    const boost = this.night > 0 ? 1 + GRID_NIGHT.boost * this.night : 1;
    this.mesh.material.uniforms.uOpacity.value = this.baseOpacity * boost;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
