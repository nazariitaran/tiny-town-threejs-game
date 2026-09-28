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
 *
 * WP-16a (day/night): applyDaylight(sample) drives the key light (sun by day, moon at night), the
 * hemisphere fill, fog, env intensity, sky and grid from dayCycle.ts. The afternoon sample (t 0.55)
 * is exactly the constants below, which stay exported for IconStudio.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { DebugTools } from '../debug/DebugTools';
import type { QualityTier } from '../game/config';
import type { ModelLibrary } from '../render/ModelLibrary';
import { DAY_KEYFRAMES, DAY_TUNING, type DayKeyframe, type DaySample } from './dayCycle';
import { DecorRing } from './DecorRing';
import { GRID_NIGHT, GridOverlay } from './GridOverlay';
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

/** Day/night tunables owned by Environment (debug `Daylight` folder). */
const DAYLIGHT_TUNING = {
  /** Re-aim the key light and refit its shadow frustum only after it has moved this far (degrees). */
  shadowRefitDeg: 0.2,
  /**
   * Fog pulled in at night (blended by `night`; the day values are LIGHTING's). The navy horizon
   * colour then washes over the plot a little, which is what turns green grass into "blue hour".
   */
  nightFogNear: 13, // 10 / 170 on the 24-unit plot; scaled with the camera distance (64 × 64 plot)
  nightFogFar: 225,
};

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

  // Day/night state (WP-16a): the last applied time and the tier-dependent inputs.
  private appliedT = Number.NaN;
  private daylightDirty = false;
  private hemiBase = LIGHTING.hemiIntensity;
  private envLevel = LIGHTING.envIntensity;
  private night = 0;
  /** Direction the key light and its shadow frustum are currently fitted to. */
  private readonly fittedDir = SUN_DIRECTION.clone();
  private readonly keyDir = new THREE.Vector3();
  // fitSunShadow scratch (no allocations when the key light moves).
  private readonly fitView = new THREE.OrthographicCamera();
  private readonly fitToLight = new THREE.Matrix4();
  private readonly fitBox = new THREE.Box3();
  private readonly fitPoint = new THREE.Vector3();

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
    } else {
      this.scene.environment = null;
    }
    this.applyTierLighting();
    this.decor.setQuality(tier);
  }

  setGridVisible(visible: boolean): void {
    this.grid.setVisible(visible);
  }

  /**
   * Day/night (WP-16): key light, hemisphere, fog, sky, env intensity and grid strength for one
   * moment of the day. Game calls it every frame (and at once from test hooks while paused).
   * Cheap when nothing changed: skipped while `t` is unchanged; no allocations.
   */
  applyDaylight(s: Readonly<DaySample>): void {
    if (s.t === this.appliedT && !this.daylightDirty) return;
    this.appliedT = s.t;
    this.daylightDirty = false;

    // Lights and fog are colour-managed: DaySample colours are display-space sRGB, like '#rrggbb'.
    this.sun.color.setRGB(s.keyColor.r, s.keyColor.g, s.keyColor.b, THREE.SRGBColorSpace);
    this.sun.intensity = s.keyIntensity;
    this.hemi.color.setRGB(s.hemiSky.r, s.hemiSky.g, s.hemiSky.b, THREE.SRGBColorSpace);
    this.hemi.groundColor.setRGB(s.hemiGround.r, s.hemiGround.g, s.hemiGround.b, THREE.SRGBColorSpace);
    this.fog.color.setRGB(s.skyHorizon.r, s.skyHorizon.g, s.skyHorizon.b, THREE.SRGBColorSpace);
    const n = s.night;
    this.fog.near = n > 0 ? LIGHTING.fogNear + (DAYLIGHT_TUNING.nightFogNear - LIGHTING.fogNear) * n : LIGHTING.fogNear;
    this.fog.far = n > 0 ? LIGHTING.fogFar + (DAYLIGHT_TUNING.nightFogFar - LIGHTING.fogFar) * n : LIGHTING.fogFar;
    this.hemiBase = s.hemiIntensity;
    this.envLevel = s.envIntensity;
    this.night = s.night;
    this.applyTierLighting();

    this.sky.applyDaylight(s);
    this.grid.setNight(s.night);

    // Re-aim + refit the shadow only when the key light has really moved (sun drift, sun ↔ moon swap).
    this.keyDir.set(s.keyDir.x, s.keyDir.y, s.keyDir.z);
    if (this.keyDir.dot(this.fittedDir) < Math.cos(THREE.MathUtils.degToRad(DAYLIGHT_TUNING.shadowRefitDeg))) {
      this.fittedDir.copy(this.keyDir);
      this.fitSunShadow();
    }
  }

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

  /** Hemisphere (+ the low-tier boost, halved at night) and env intensity for the current tier. */
  private applyTierLighting(): void {
    const boost = this.tier === 'low' ? LIGHTING.hemiLowTierBoost * (1 - 0.5 * this.night) : 0;
    this.hemi.intensity = this.hemiBase + boost;
    if (this.scene.environment) this.scene.environmentIntensity = this.envLevel;
  }

  /**
   * Aim the key light along `fittedDir` (SUN_DIRECTION until the first day/night change) and fit
   * its orthographic shadow camera tightly around the plot. Reuses scratch objects.
   */
  private fitSunShadow(): void {
    this.sun.target.position.set(0, 0, 0);
    this.sun.position.copy(this.fittedDir).multiplyScalar(SHADOW_DISTANCE);

    // Same orientation the renderer will give the shadow camera (lookAt target, up = +y). Must be a
    // camera: Object3D.lookAt points +z at the target, cameras point -z.
    const view = this.fitView;
    view.position.copy(this.sun.position);
    view.lookAt(this.sun.target.position);
    view.updateMatrixWorld(true);
    const toLight = this.fitToLight.copy(view.matrixWorld).invert();

    const hx = PLOT_HALF_X + KERB_WIDTH + 0.3;
    const hz = PLOT_HALF_Z + KERB_WIDTH + 0.3;
    const box = this.fitBox.makeEmpty();
    const p = this.fitPoint;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? hx : -hx, i & 4 ? PLOT_CONTENT_HEIGHT : SLAB_BOTTOM_Y, i & 2 ? hz : -hz);
      box.expandByPoint(p.applyMatrix4(toLight));
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
    folder.add(this.scene, 'environmentIntensity', 0, 1.5, 0.01).name('env map');
    folder.add(this.fog, 'near', 0, 200, 1).name('fog near');
    folder.add(this.fog, 'far', 50, 900, 1).name('fog far');
    folder.add(this.sun.shadow, 'normalBias', 0, 0.1, 0.001);
    folder.add(this.sun.shadow, 'bias', -0.005, 0.005, 0.0001);
    folder.add(this.sky, 'cloudCover', 0.2, 0.9, 0.01).name('cloud cover');
    folder.add(this.grid, 'opacity', 0, 0.2, 0.005).name('grid opacity');
    this.installDaylightDebug(debug);
  }

  /** lil-gui `Daylight`: the keyframes (except the pinned afternoon) and the non-keyframed tunables. */
  private installDaylightDebug(debug?: DebugTools): void {
    const folder = debug?.folder('Daylight');
    if (!folder) return;
    const dirty = () => {
      this.daylightDirty = true;
    };
    folder.add(GRID_NIGHT, 'boost', 0, 2, 0.05).name('grid night boost').onChange(dirty);
    folder.addColor(GRID_NIGHT, 'color').name('grid night colour').onChange(dirty);
    folder.add(DAY_TUNING, 'minKeyElevationDeg', 0, 40, 1).name('min key elevation°').onChange(dirty);
    folder.add(DAYLIGHT_TUNING, 'shadowRefitDeg', 0, 2, 0.05).name('shadow refit°');
    folder.add(DAYLIGHT_TUNING, 'nightFogNear', 0, 120, 1).name('night fog near').onChange(dirty);
    folder.add(DAYLIGHT_TUNING, 'nightFogFar', 40, 500, 1).name('night fog far').onChange(dirty);
    for (const frame of DAY_KEYFRAMES) {
      if (frame.name === 'afternoon') continue; // must stay the v0.2 look (baselines, IconStudio)
      this.addKeyframeDebug(folder.addFolder(`${frame.name} (${frame.t})`), frame, dirty);
    }
    folder.close();
  }

  private addKeyframeDebug(folder: NonNullable<ReturnType<DebugTools['folder']>>, f: DayKeyframe, dirty: () => void): void {
    folder.addColor(f, 'keyColor').name('key').onChange(dirty);
    folder.add(f, 'keyIntensity', 0, 4, 0.01).name('key ×').onChange(dirty);
    folder.addColor(f, 'hemiSky').name('hemi sky').onChange(dirty);
    folder.addColor(f, 'hemiGround').name('hemi ground').onChange(dirty);
    folder.add(f, 'hemiIntensity', 0, 3, 0.01).name('hemi ×').onChange(dirty);
    folder.addColor(f, 'skyTop').name('sky top').onChange(dirty);
    folder.addColor(f, 'skyHorizon').name('horizon / fog').onChange(dirty);
    folder.addColor(f, 'skyGlow').name('glow').onChange(dirty);
    folder.add(f, 'envIntensity', 0, 1, 0.01).name('env').onChange(dirty);
    folder.add(f, 'cloudShade', 0, 1, 0.01).name('cloud shade').onChange(dirty);
    folder.add(f, 'stars', 0, 1, 0.01).name('stars').onChange(dirty);
    folder.close();
  }
}
