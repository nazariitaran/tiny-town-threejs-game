/**
 * Sky, lighting, surrounding terrain, fog and the plot's grid overlay.
 *
 * WP-04 (World & look). Public API (constructor, populate, setQuality, setGridVisible, update,
 * dispose, sun) is the contract Game.ts relies on.
 *
 * Look: a single "golden afternoon". Warm key sun (shadow frustum fitted to the plot), cool
 * hemisphere fill, a low-intensity RoomEnvironment PMREM for gentle speculars (high tier only).
 * The plot is a raised diorama slab; the meadow undulates beyond it and rolls into hazy hills.
 * Fog colour == sky horizon colour, so distant ground melts into the horizon with no seam.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { DebugTools } from '../debug/DebugTools';
import type { QualityTier } from '../game/config';
import type { ModelLibrary } from '../render/ModelLibrary';
import type { DaySample } from './dayCycle';
import { DecorRing } from './DecorRing';
import { GridOverlay } from './GridOverlay';
import { Sky, type SkyPalette } from './Sky';
import { createOuterTerrain, createPlotBase } from './Terrain';
import { KERB_WIDTH, PLOT_HALF_X, PLOT_HALF_Z, SLAB_BOTTOM_Y } from './terrainShape';

export const SKY_PALETTE: SkyPalette = {
  top: '#4f9fe3',
  horizon: '#d4ebf6',
  sunGlow: '#ffd49a',
  sun: '#fff1d2',
};

/** Direction TOWARDS the sun: afternoon, ~42° up, from the build camera's left. */
export const SUN_DIRECTION = new THREE.Vector3(-0.66, 0.74, 0.42).normalize();

export const LIGHTING = {
  sunColor: '#ffe6c4',
  sunIntensity: 3.0,
  hemiSky: '#cfe6ff',
  hemiGround: '#7d9a5c',
  hemiIntensity: 0.8,
  /** Extra hemisphere fill on the low tier, standing in for the env map's diffuse light. */
  hemiLowTierBoost: 0.35,
  envIntensity: 0.18,
  fogNear: 55,
  fogFar: 420,
};

const SHADOW_DISTANCE = 60;
/** Tallest thing the plot can hold (with margin) — the shadow frustum must enclose it. */
const PLOT_CONTENT_HEIGHT = 4;

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly root = new THREE.Group();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: Sky;
  private readonly plotBase: THREE.Mesh;
  private readonly terrain: THREE.Mesh;
  private readonly grid: GridOverlay;
  private readonly decor = new DecorRing();
  private readonly fog: THREE.Fog;
  private envMap: THREE.Texture | null = null;
  private tier: QualityTier = 'high';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    debug?: DebugTools,
  ) {
    this.root.name = 'environment';
    scene.add(this.root);

    // --- Sky + fog (fog colour is the sky's horizon colour: seamless horizon).
    this.sky = new Sky(SKY_PALETTE, SUN_DIRECTION);
    this.root.add(this.sky.mesh);
    this.fog = new THREE.Fog(SKY_PALETTE.horizon, LIGHTING.fogNear, LIGHTING.fogFar);
    scene.fog = this.fog;
    scene.background = null;

    // --- Lights.
    this.hemi = new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity);
    this.root.add(this.hemi);
    this.sun = new THREE.DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.022;
    this.sun.shadow.radius = 2.5;
    this.root.add(this.sun, this.sun.target);
    this.fitSunShadow();

    // --- Ground.
    this.terrain = createOuterTerrain();
    this.plotBase = createPlotBase();
    this.root.add(this.terrain, this.plotBase);

    this.grid = new GridOverlay();
    this.root.add(this.grid.mesh);
    this.root.add(this.decor.group);

    this.installDebug(debug);
  }

  /** Called once after models load: instanced distant tree/bush/rock ring (≤ 4 draw calls). */
  populate(library: ModelLibrary): void {
    this.decor.populate(library);
    this.decor.setQuality(this.tier);
  }

  /** 'low': 1024 shadow map, no env map, thinner decor ring. Game applies the DPR cap (MAX_DPR[tier]). */
  setQuality(tier: QualityTier): void {
    this.tier = tier;
    const size = tier === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      // Force the renderer to reallocate the shadow render target at the new size.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (tier === 'high') {
      this.envMap ??= this.createEnvMap();
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = LIGHTING.envIntensity;
    } else {
      this.scene.environment = null;
    }
    this.hemi.intensity = LIGHTING.hemiIntensity + (tier === 'low' ? LIGHTING.hemiLowTierBoost : 0);
    this.decor.setQuality(tier);
  }

  setGridVisible(visible: boolean): void {
    this.grid.setVisible(visible);
  }

  /**
   * Day/night (WP-16): key light, hemisphere, fog, sky, env intensity and grid strength for one
   * moment of the day. Game calls it every frame (and at once from test hooks while paused).
   * STUB (contract commit): the afternoon look is already set up; WP-16a implements this.
   */
  applyDaylight(_sample: Readonly<DaySample>): void {}

  /** Ambient animation (clouds drift). `elapsed` is frozen under reduced motion. */
  update(_delta: number, elapsed: number): void {
    this.sky.setTime(elapsed);
  }

  dispose(): void {
    this.decor.dispose(); // shares GPU resources with ModelLibrary: never dispose those here
    this.sky.dispose();
    this.grid.dispose();
    for (const mesh of [this.terrain, this.plotBase]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    if (this.scene.environment === this.envMap) this.scene.environment = null;
    this.envMap?.dispose();
    this.envMap = null;
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.scene.remove(this.root);
  }

  /** Aim the sun along SUN_DIRECTION and fit its orthographic shadow camera tightly around the plot. */
  private fitSunShadow(): void {
    this.sun.target.position.set(0, 0, 0);
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(SHADOW_DISTANCE);
    this.sky.setSunDirection(SUN_DIRECTION);

    // Same orientation the renderer will give the shadow camera (lookAt target, up = +y). Must be a
    // camera: Object3D.lookAt points +z at the target, cameras point -z.
    const view = new THREE.OrthographicCamera();
    view.position.copy(this.sun.position);
    view.lookAt(this.sun.target.position);
    view.updateMatrixWorld(true);
    const toLight = view.matrixWorld.clone().invert();

    const hx = PLOT_HALF_X + KERB_WIDTH + 0.3;
    const hz = PLOT_HALF_Z + KERB_WIDTH + 0.3;
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const x of [-hx, hx]) {
      for (const z of [-hz, hz]) {
        for (const y of [SLAB_BOTTOM_Y, PLOT_CONTENT_HEIGHT]) box.expandByPoint(p.set(x, y, z).applyMatrix4(toLight));
      }
    }
    const cam = this.sun.shadow.camera;
    cam.left = box.min.x;
    cam.right = box.max.x;
    cam.bottom = box.min.y;
    cam.top = box.max.y;
    // Camera looks down -z in its own space.
    cam.near = Math.max(0.5, -box.max.z - 1);
    cam.far = -box.min.z + 1;
    cam.updateProjectionMatrix();
  }

  private createEnvMap(): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return texture;
  }

  private installDebug(debug?: DebugTools): void {
    const folder = debug?.folder('World');
    if (!folder) return;
    folder.add(this.sun, 'intensity', 0, 6, 0.05).name('sun');
    folder.add(this.hemi, 'intensity', 0, 3, 0.05).name('hemi fill');
    folder.add(LIGHTING, 'envIntensity', 0, 1.5, 0.01).name('env map').onChange((v: number) => {
      if (this.scene.environment) this.scene.environmentIntensity = v;
    });
    folder.add(this.fog, 'near', 0, 200, 1).name('fog near');
    folder.add(this.fog, 'far', 50, 900, 1).name('fog far');
    folder.add(this.sun.shadow, 'normalBias', 0, 0.1, 0.001);
    folder.add(this.sun.shadow, 'bias', -0.005, 0.005, 0.0001);
    folder.add(this.sky, 'cloudCover', 0.2, 0.9, 0.01).name('cloud cover');
    folder.add(this.grid, 'opacity', 0, 0.2, 0.005).name('grid opacity');
  }
}
