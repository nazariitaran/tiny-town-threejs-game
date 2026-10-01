/**
 * Composition root: creates every system, wires them through the event bus, and owns the
 * phase machine (loading → title → building ⇄ menu) and the per-frame update order.
 */
import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FrameBudget } from '../core/FrameBudget';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { DebugTools, type DebugTuning } from '../debug/DebugTools';
import { PlacementFx } from '../fx/PlacementFx';
import { BirdSystem, isBirdSpecies } from '../life/BirdSystem';
import { LifeSystem } from '../life/LifeSystem';
import { SaveStore } from '../persistence/SaveStore';
import { encodeTownFile, TOWN_FILE_MIME, townFileName } from '../persistence/townFile';
import { CameraController } from '../interaction/CameraController';
import { GridPicker } from '../interaction/GridPicker';
import { ToolController } from '../interaction/ToolController';
import { ModelLibrary } from '../render/ModelLibrary';
import { captureView } from '../photo/capture';
import { photoFileName } from '../photo/photoLayout';
import { NightLights } from '../render/NightLights';
import { ShadowScheduler } from '../render/ShadowScheduler';
import { TownRenderer } from '../render/TownRenderer';
import { TownEditor } from '../town/TownEditor';
import { TownState } from '../town/TownState';
import { buildAssetGallery, buildSampleTown, buildStressTown } from '../town/sampleTown';
import type { SavedTown } from '../town/types';
import { parseTownNames, pickTownName, TOWN_NAMES_PATH } from '../town/townName';
import { UiRoot } from '../ui/UiRoot';
import { createSeededRandom, entropySeed } from '../utils/random';
import { createDaySample, DayClock, sampleDay, T_AFTERNOON, T_NIGHT, TIME_MODES, type DayPhase, type TimeMode } from '../world/dayCycle';
import { Environment } from '../world/Environment';
import { assetUrl, PLOT_DEPTH, PLOT_WIDTH } from './config';
import { createGameBus, type GamePhase } from './events';
import { effectivePixelRatio, GRAPHICS_PROFILES, isGraphicsPreset, needsReload, type GraphicsPreset, type GraphicsProfile } from './graphics';
import { materialFamily } from '../render/materials';

/** Test-hook states; each pins the clock to afternoon except 'night-town' (sample town at T_NIGHT). */
export const TEST_STATES = ['title', 'empty-build', 'sample-town', 'active-play', 'asset-gallery', 'stress-town', 'night-town'] as const;
type TestState = (typeof TEST_STATES)[number];

/** Birds run on their own stream derived from the seed, never drawing from fxRng. */
const BIRD_SEED_SALT = 0xb12d5eed;

/** `?graphics=low|medium|high`: boot with this preset without saving it. */
const GRAPHICS_URL_PARAM = 'graphics';

function graphicsOverride(): GraphicsPreset | null {
  const value = new URLSearchParams(window.location.search).get(GRAPHICS_URL_PARAM);
  return isGraphicsPreset(value) ? value : null;
}

export class Game {
  readonly bus = createGameBus();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 900);
  private readonly frameBudget = new FrameBudget();
  /** The sun's shadow map is redrawn only when a caster changed (autoUpdate is off). */
  private readonly shadows = new ShadowScheduler();
  private shadowVersion = -1;
  /** Seconds since the previous rendered frame. */
  private frameDelta = 0;
  private readonly lastCameraPosition = new THREE.Vector3();
  private readonly lastCameraQuaternion = new THREE.Quaternion();
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
    () => this.frameBudget.targetFps,
  );
  private readonly saves = new SaveStore();
  /** Fixes MSAA and the material family until a reload; the live parts follow `graphics`. */
  private readonly bootGraphics: GraphicsPreset = graphicsOverride() ?? this.saves.getSettings().graphics;
  private graphics: GraphicsPreset = this.bootGraphics;
  private readonly tuning: DebugTuning = { exposure: 1.0, maxDpr: GRAPHICS_PROFILES[this.bootGraphics].maxDpr, renderScale: GRAPHICS_PROFILES[this.bootGraphics].renderScale, showStats: false };
  /** What the page really runs with: the context's MSAA and the lit material family in the scene. */
  private antialias = false;
  private materialInUse: 'standard' | 'lambert' | 'mixed' | 'none' = 'none';
  private perfDebug: ReturnType<DebugTools['folder']> = null;
  // All randomness goes through these so seed() keeps tests deterministic. Gameplay (variants) and
  // cosmetic (audio/fx jitter) streams are separate, so playing a sound never changes the next house variant.
  private seedValue = 1;
  private rng = createSeededRandom(this.seedValue);
  private fxRng = createSeededRandom(this.seedValue ^ 0x9e3779b9);
  /** Seeded afresh per page load, else every new player gets the same first name suggestion; seed() pins it. */
  private nameRng = createSeededRandom(entropySeed());
  private townNames: string[] = [];
  private gridPreferred = true;
  private invalidCount = 0;

  private readonly town = new TownState(PLOT_WIDTH, PLOT_DEPTH);
  private readonly editor: TownEditor;
  private readonly library = new ModelLibrary(GRAPHICS_PROFILES[this.bootGraphics].material);
  private readonly environment: Environment;
  private readonly cameraController: CameraController;
  private readonly picker: GridPicker;
  private readonly tools: ToolController;
  private readonly townRenderer: TownRenderer;
  private readonly fx: PlacementFx;
  private readonly life: LifeSystem;
  private readonly nightLights: NightLights;
  private readonly birds: BirdSystem;
  /** Spontaneous flocks stay off after a test state until a reload. */
  private birdsAuto = true;
  /** Day/night: the clock, the sample it writes every frame, the last announced mode/phase. */
  private readonly clock: DayClock;
  private readonly daySample = createDaySample();
  private announcedDay: { mode: TimeMode; phase: DayPhase } | null = null;
  private readonly audio: AudioManager;
  private readonly ui: UiRoot;
  private readonly debug: DebugTools;

  private phase: GamePhase = 'loading';
  private ready: Promise<void>;
  private frame = 0;
  private pausedForScreenshot = false;
  /** Diagnostics only; the framed blob travels on `photo:ready`. */
  private readonly photo: ThreeGameDiagnostics['photo'] = { taken: 0, developing: false, last: null };
  private reducedMotion = false;
  /** OS "reduce motion": the day cycle still runs, but mode switches snap instead of sweeping. */
  private readonly prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  constructor(private readonly canvas: HTMLCanvasElement, uiHost: HTMLElement) {
    const rand = () => this.rng();
    const fxRand = () => this.fxRng();
    const boot = GRAPHICS_PROFILES[this.bootGraphics];
    this.renderer = createRenderer(canvas, { antialias: boot.antialias });
    this.antialias = this.renderer.getContextAttributes()?.antialias === true;
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.debug = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr, this.tuning.renderScale);
    });

    this.editor = new TownEditor(this.town, this.bus, rand);
    this.environment = new Environment(this.scene, this.renderer, this.debug, boot.material);
    this.cameraController = new CameraController(this.camera, canvas, this.debug);
    this.picker = new GridPicker(this.camera, canvas);
    this.tools = new ToolController(canvas, this.picker, this.editor, this.cameraController, this.bus, this.scene, this.library, this.debug);
    this.townRenderer = new TownRenderer(this.scene, this.library, this.town, this.bus, this.debug);
    this.fx = new PlacementFx(this.scene, this.bus, fxRand);
    // Ambient cars use the cosmetic stream so they never shift gameplay variants.
    this.life = new LifeSystem(this.scene, this.town, this.bus, fxRand, this.debug, boot.material);
    this.nightLights = new NightLights(this.scene, this.library, this.town, this.bus, this.life, this.debug);
    this.birds = new BirdSystem(this.scene, this.town, this.seedValue ^ BIRD_SEED_SALT, this.debug, boot.material);
    this.installBirdDebug();
    this.clock = new DayClock(this.saves.getSettings().timeMode);
    this.installClockDebug();
    this.audio = new AudioManager(this.bus, fxRand, this.saves);
    this.ui = new UiRoot(uiHost, this.bus, () => this.saves.has(), (avoid) => pickTownName(this.townNames, this.nameRng, avoid));
    this.bus.on('intent:set-graphics', ({ preset }) => this.setGraphics(preset));
    this.bus.on('intent:reload-graphics', () => this.reloadForGraphics());

    // Autosave 1 s after edits (never on 'load'); flush on page hide.
    this.saves.attachAutosave(this.bus, () => this.editor.serialize(this.cameraController.getPose()));
    window.addEventListener('pagehide', this.onPageHide);
    this.gridPreferred = this.saves.getSettings().grid;

    this.bus.on('intent:start', ({ mode, name }) => {
      void this.audio.unlock(); // must stay inside the click's call stack
      const save = mode === 'continue' ? this.saves.read() : null;
      if (save) this.editor.load(save);
      else this.editor.reset(name); // 'new': cause 'reset' also clears the stored save
      this.setPhase('building');
      if (save?.camera) this.cameraController.setPose(save.camera);
      this.clock.startDay(); // Auto starts in the morning; the time of day is never saved
      this.applyDaylight();
    });
    this.bus.on('intent:set-time-mode', ({ mode }) => this.setTimeMode(mode));
    this.bus.on('intent:cycle-time-mode', () => {
      this.setTimeMode(TIME_MODES[(TIME_MODES.indexOf(this.clock.mode) + 1) % TIME_MODES.length]);
    });
    this.bus.on('intent:new-town', ({ name }) => this.editor.reset(name));
    this.bus.on('intent:rename-town', ({ name }) => this.editor.rename(name));
    this.bus.on('intent:export-town', () => this.exportTown());
    this.bus.on('intent:open-town', ({ save }) => this.openTown(save));
    this.bus.on('intent:open-menu', () => {
      if (this.phase === 'building') this.setPhase('menu');
    });
    this.bus.on('intent:close-menu', () => {
      if (this.phase === 'menu') this.setPhase('building');
    });
    this.bus.on('intent:reset-camera', () => this.cameraController.reset());
    this.bus.on('intent:take-photo', () => this.takePhoto());
    this.bus.on('intent:toggle-grid', ({ visible }) => {
      this.gridPreferred = visible;
      this.saves.setSettings({ grid: visible });
      this.environment.setGridVisible(visible && this.phase === 'building');
    });
    this.bus.on('build:invalid', () => {
      this.invalidCount += 1;
    });
    this.bus.on('town:changed', () => this.shadows.invalidate());
    this.frameBudget.attach(window);
    this.installPerfDebug();
    this.applyGraphics(GRAPHICS_PROFILES[this.graphics]);
    this.announceGraphics(); // the UI exists: sync its Graphics radios

    if (!this.gridPreferred) this.bus.emit('intent:toggle-grid', { visible: false }); // sync the UI switch
    this.announceDaytime(); // sync the UI time button with the stored mode
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr, this.tuning.renderScale);
    this.installTestHooks();
    this.installDiagnostics();
    this.ready = this.load();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.frameBudget.detach();
    window.removeEventListener('pagehide', this.onPageHide);
    this.saves.flush();
    this.saves.dispose();
    this.tools.dispose();
    this.cameraController.dispose();
    this.townRenderer.dispose();
    this.fx.dispose();
    this.nightLights.dispose();
    this.life.dispose();
    this.birds.dispose();
    this.audio.dispose();
    this.ui.dispose();
    this.environment.dispose();
    this.library.dispose();
    this.debug.dispose();
    this.bus.clear();
    this.renderer.dispose();
    delete window.__THREE_GAME_DIAGNOSTICS__;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private readonly onPageHide = (): void => {
    this.saves.flush();
  };

  private async load(): Promise<void> {
    try {
      await Promise.all([
        this.library.loadAll((loaded, total, label) => this.bus.emit('load:progress', { loaded, total, label })),
        this.life.load(),
        this.loadTownNames(),
      ]);
      this.townRenderer.rebuildAll();
      this.environment.populate(this.library);
      this.nightLights.populate();
      this.applyDaylight();
      this.measureMaterials();
      this.setPhase('title');
    } catch (error) {
      console.error(error);
      this.bus.emit('load:error', { message: error instanceof Error ? error.message : String(error) });
      this.setPhase('error');
    }
  }

  /** Never fails the load: without names the suggestion is "Tiny Town". */
  private async loadTownNames(): Promise<void> {
    try {
      const response = await fetch(assetUrl(TOWN_NAMES_PATH));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.townNames = parseTownNames(await response.json());
    } catch (error) {
      console.warn('[town-name] no name suggestions:', error);
    }
  }

  private setPhase(phase: GamePhase): void {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;
    this.tools.setEnabled(phase === 'building');
    this.environment.setGridVisible(this.gridPreferred && phase === 'building');
    // Menu is an overlay over the build view: keep the camera where it was.
    if (phase === 'title') this.cameraController.setMode('title');
    else if (phase === 'building' && previous !== 'menu') this.cameraController.setMode('build');
    this.bus.emit('phase:changed', { phase, previous });
  }

  /** Fixed update order: input/tools → camera → town visuals → world → fx. */
  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    this.frameDelta = delta;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr, this.tuning.renderScale);
    if (!this.pausedForScreenshot) {
      const animDelta = this.reducedMotion ? 0 : delta;
      const animElapsed = this.reducedMotion ? 0 : elapsed;
      this.tools.update(delta);
      this.cameraController.update(delta);
      this.townRenderer.update(animDelta);
      this.life.update(animDelta);
      // No spontaneous flocks under the OS "reduce motion" setting (a test hook's reduced motion stops the clock anyway).
      this.birds.setAuto(this.birdsAuto && this.prefersReducedMotion?.matches !== true);
      this.birds.update(animDelta);
      // The clock runs only while building (frozen on the title, in the menu, under reduced motion).
      if (this.phase === 'building') this.clock.advance(animDelta);
      this.applyDaylight();
      this.environment.update(animDelta, animElapsed);
      this.fx.update(animDelta);
    }
    this.trackActivity();
  }

  private render(): void {
    if (this.environment.shadowVersion !== this.shadowVersion) {
      this.shadowVersion = this.environment.shadowVersion;
      this.shadows.invalidate();
    }
    const moving = !this.pausedForScreenshot && !this.reducedMotion;
    // Paused for a screenshot: always a fresh map, so captures never show a throttled car shadow.
    if (this.pausedForScreenshot) this.shadows.invalidate();
    this.renderer.shadowMap.needsUpdate = this.shadows.step(this.frameDelta, {
      settling: this.townRenderer.isAnimating,
      cars: moving && this.life.castsShadows,
      birds: moving && this.birds.castsShadows,
    });
    this.renderer.render(this.scene, this.camera);
  }

  /** One-off render from a test hook: state may have jumped, so the shadow map is redrawn too. */
  private renderNow(): void {
    this.shadows.invalidate();
    this.frameDelta = 0;
    this.render();
  }

  /**
   * Input keeps the loop at the active rate (FrameBudget listens for it); so do a gliding camera and
   * town pop-in tweens. The title screen's slow auto-orbit doesn't count, so the title idles.
   */
  private trackActivity(): void {
    const camera = this.camera;
    const cameraMoved = !camera.position.equals(this.lastCameraPosition) || !camera.quaternion.equals(this.lastCameraQuaternion);
    if (cameraMoved) {
      this.lastCameraPosition.copy(camera.position);
      this.lastCameraQuaternion.copy(camera.quaternion);
    }
    if ((cameraMoved && this.phase !== 'title') || this.townRenderer.isAnimating || this.photo.developing) this.frameBudget.markActive();
  }

  /** Applies the live parts of a preset (MSAA and the material family stay as booted); overwrites the debug sliders. */
  applyGraphics(profile: Readonly<GraphicsProfile>): void {
    this.tuning.maxDpr = profile.maxDpr;
    this.tuning.renderScale = profile.renderScale;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr, this.tuning.renderScale);
    this.environment.applyGraphics(profile);
    this.frameBudget.tuning.activeFps = profile.activeFps;
    this.frameBudget.tuning.idleFps = profile.idleFps;
    this.nightLights.setLampHalos(profile.lampHalos);
    for (const controller of this.perfDebug?.parent?.controllersRecursive() ?? []) controller.updateDisplay();
  }

  private setGraphics(preset: GraphicsPreset): void {
    if (!isGraphicsPreset(preset)) return;
    this.graphics = preset;
    this.saves.setSettings({ graphics: preset });
    this.applyGraphics(GRAPHICS_PROFILES[preset]);
    this.announceGraphics();
  }

  private announceGraphics(): void {
    this.bus.emit('graphics:changed', { preset: this.graphics, reloadRequired: needsReload(this.bootGraphics, this.graphics) });
  }

  /** Reloads so MSAA and the material follow the saved preset; a `?graphics=` override would win again, so it is dropped. */
  private reloadForGraphics(): void {
    this.saves.flush();
    const url = new URL(window.location.href);
    if (url.searchParams.has(GRAPHICS_URL_PARAM)) {
      url.searchParams.delete(GRAPHICS_URL_PARAM);
      window.location.replace(url.href);
    } else {
      window.location.reload();
    }
  }

  /** The lit material family the scene draws with. Placement FX (`fx:*`) are Lambert on every preset, so they're excluded. */
  private measureMaterials(): void {
    const families = new Set<string>();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.name.startsWith('fx:')) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const family = materialFamily(material);
        if (family) families.add(family);
      }
    });
    this.materialInUse = families.size === 0 ? 'none' : families.size > 1 ? 'mixed' : ([...families][0] as 'standard' | 'lambert');
  }

  private installPerfDebug(): void {
    const folder = this.debug.folder('Performance');
    this.perfDebug = folder;
    if (!folder) return;
    const budget = this.frameBudget.tuning;
    folder.add(budget, 'activeFps', 0, 120, 5).name('active fps (0 = display)');
    folder.add(budget, 'idleFps', 0, 120, 5).name('idle fps (0 = display)');
    folder.add(budget, 'idleAfterS', 0.5, 30, 0.5).name('idle after (s)');
    folder.add(this.shadows.tuning, 'carHz', 1, 60, 1).name('car shadow Hz');
    folder.add(this.shadows.tuning, 'birdHz', 1, 60, 1).name('bird shadow Hz');
  }

  /**
   * Entering the menu phase (the UI shows the photo view) hides the ghost, hover frame and grid and
   * pauses the clock; one higher-resolution frame is captured synchronously, then framed and encoded
   * asynchronously. The framing code is lazy-loaded to keep the main chunk under the 900 kB warning limit.
   */
  private takePhoto(): void {
    if (this.phase !== 'building' || this.photo.developing) return;
    const started = performance.now();
    const phase = this.daySample.phase;
    this.photo.taken += 1;
    this.photo.developing = true;
    this.setPhase('menu');
    const fail = (error: unknown): void => {
      console.error(error);
      this.photo.developing = false;
      this.bus.emit('photo:error', { message: error instanceof Error ? error.message : String(error) });
    };
    let shot: ReturnType<typeof captureView>;
    try {
      this.renderer.shadowMap.needsUpdate = true; // the photo never shows a throttled shadow
      shot = captureView(this.renderer, this.scene, this.camera);
    } catch (error) {
      fail(error);
      return;
    }
    const date = new Date();
    const townName = this.editor.name;
    import('../photo/PhotoFrame')
      .then(({ framePhoto }) => framePhoto(shot.canvas, phase, date, townName))
      .then(({ blob, width, height }) => {
        this.photo.developing = false;
        this.photo.last = { width, height, bytes: blob.size, pixelRatio: shot.pixelRatio, ms: Math.round(performance.now() - started) };
        this.bus.emit('photo:ready', { blob, width, height, fileName: photoFileName(date, townName) });
      }, fail);
  }

  /** Serialises the live town synchronously, not the stored autosave (which trails by 1 s). */
  private exportTown(): void {
    if (this.phase !== 'building' && this.phase !== 'menu') return;
    const date = new Date();
    const text = encodeTownFile(this.editor.serialize(this.cameraController.getPose()), date);
    this.bus.emit('town-file:ready', { blob: new Blob([text], { type: TOWN_FILE_MIME }), fileName: townFileName(this.editor.name, date) });
  }

  /**
   * Not undoable. The save is written at once so a reload continues the opened town, and autosave
   * turns back on after a test state. From the title this acts as Start (audio unlocks, the morning
   * starts); from the menu the time of day carries on.
   */
  private openTown(save: SavedTown): void {
    const fromTitle = this.phase === 'title';
    if (!fromTitle && this.phase !== 'menu') return;
    if (fromTitle) void this.audio.unlock(); // must stay inside the click's call stack
    this.editor.load(save);
    this.saves.autosaveEnabled = true;
    this.saves.write(this.editor.serialize(save.camera));
    this.setPhase('building');
    if (save.camera) this.cameraController.setPose(save.camera);
    else this.cameraController.reset();
    if (fromTitle) this.clock.startDay();
    this.applyDaylight();
  }

  /** `?debug&day=N`: an N-second Auto day; lil-gui `Clock` folder. */
  private installClockDebug(): void {
    if (!this.debug.enabled) return;
    const day = Number(new URLSearchParams(window.location.search).get('day'));
    if (Number.isFinite(day) && day > 0) this.clock.dayLengthS = day;
    this.debug.folder('Clock')?.add(this.clock, 'dayLengthS', 10, 1200, 1).name('day length (s)');
  }

  /** `?debug&flock=N`: a flock every N seconds. */
  private installBirdDebug(): void {
    if (!this.debug.enabled) return;
    const every = Number(new URLSearchParams(window.location.search).get('flock'));
    if (!Number.isFinite(every) || every <= 0) return;
    this.birds.setIntervalOverride(every);
    this.birds.reset(this.seedValue ^ BIRD_SEED_SALT);
  }

  /** Persisted; the clock sweeps to the new mode (snaps under reduced motion). */
  private setTimeMode(mode: TimeMode): void {
    this.clock.setMode(mode, this.reducedMotion || this.prefersReducedMotion?.matches === true);
    this.saves.setSettings({ timeMode: mode });
    this.applyDaylight();
  }

  /**
   * Samples the clock and drives every day/night consumer. The title and loading screens show the
   * afternoon unless a test pinned the clock. Also called from test hooks, which must work while paused.
   */
  private applyDaylight(): void {
    const live = this.clock.isPinned || this.phase === 'building' || this.phase === 'menu';
    if (live) this.clock.sample(this.daySample);
    else sampleDay(T_AFTERNOON, this.daySample);
    this.environment.applyDaylight(this.daySample);
    this.nightLights.update(this.daySample);
    this.life.setNight(this.daySample.night);
    this.birds.setDaylight(this.daySample.night, this.daySample.phase);
    this.announceDaytime();
  }

  private announceDaytime(): void {
    const mode = this.clock.mode;
    const phase = this.daySample.phase;
    if (this.announcedDay?.mode === mode && this.announcedDay.phase === phase) return;
    this.announcedDay = { mode, phase };
    this.bus.emit('daytime:changed', { mode, phase });
  }

  private async applyTestState(name: TestState): Promise<void> {
    await this.ready;
    // Demo/test towns must never overwrite or clear the player's save (stays off until reload).
    this.saves.autosaveEnabled = false;
    // Reseed so a state is identical no matter what happened before it.
    this.rng = createSeededRandom(this.seedValue);
    this.fxRng = createSeededRandom(this.seedValue ^ 0x9e3779b9);
    this.editor.reset();
    if (this.tools.activeTool) this.tools.selectTool(null);
    if (name === 'sample-town' || name === 'active-play') buildSampleTown(this.editor);
    if (name === 'asset-gallery') buildAssetGallery(this.editor);
    if (name === 'stress-town') buildStressTown(this.editor);
    if (name === 'night-town') buildSampleTown(this.editor);
    this.setPhase(name === 'title' ? 'title' : 'building');
    this.cameraController.setMode(name === 'title' ? 'title' : 'build');
    // Pinned until setTimeOfDay(null) or a reload.
    this.clock.pin(name === 'night-town' ? T_NIGHT : T_AFTERNOON);
    this.applyDaylight();
    this.townRenderer.settle();
    this.life.settle();
    // No surprise flock in a test state (baselines, draw-call checks): spawnFlock() launches one.
    this.birdsAuto = false;
    this.birds.setAuto(false);
    this.birds.reset(this.seedValue ^ BIRD_SEED_SALT);
  }

  private installTestHooks(): void {
    // Keep them real: no-op hooks make screenshot baselines flaky.
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seedValue = value;
        this.rng = createSeededRandom(value);
        this.fxRng = createSeededRandom(value ^ 0x9e3779b9);
        this.nameRng = createSeededRandom(value ^ 0x51f15eed);
        this.birds.reset(value ^ BIRD_SEED_SALT);
      },
      setState: async (name: string) => {
        if (!(TEST_STATES as readonly string[]).includes(name)) throw new Error(`Unknown test state: ${name}`);
        await this.applyTestState(name as TestState);
        this.renderNow();
        this.measureMaterials();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        if (enabled) {
          this.clock.finishSweep();
          this.applyDaylight();
          this.fx.stabilize();
          this.townRenderer.settle();
          this.life.settle();
          this.birds.settle();
        }
        this.renderNow();
      },
      hideDebugUi: (hidden: boolean) => this.debug.setHidden(hidden),
      cellToClient: (x: number, z: number) => this.picker.cellToClient({ x, z }),
      setCameraPose: (pose) => {
        this.cameraController.setPose(pose);
        this.renderNow();
      },
      spawnFlock: (species?: string) => {
        if (species !== undefined && !isBirdSpecies(species)) throw new Error(`spawnFlock: unknown species: ${species}`);
        const birds = this.birds.spawnFlock(species);
        this.renderNow();
        return birds;
      },
      setTimeOfDay: (t: number | null) => {
        if (t !== null && !Number.isFinite(t)) throw new Error(`setTimeOfDay: not a number: ${t}`);
        this.clock.pin(t);
        this.applyDaylight();
        this.renderNow();
      },
    };
  }

  /** A getter: each read builds a fresh snapshot, so rendered frames never allocate for it. */
  private installDiagnostics(): void {
    Object.defineProperty(window, '__THREE_GAME_DIAGNOSTICS__', {
      configurable: true,
      enumerable: true,
      get: () => this.diagnostics(),
    });
  }

  private diagnostics(): ThreeGameDiagnostics {
    const info = this.renderer.info;
    return {
      frame: this.frame,
      phase: this.phase,
      tool: this.tools.activeTool,
      rotation: this.tools.activeRotation,
      hover: this.tools.hovered,
      selection: this.tools.selection,
      variant: this.tools.variant,
      town: this.town.stats(),
      townName: this.editor.name,
      objects: [...this.town.objects()].length,
      render: this.townRenderer.getDiagnostics(),
      history: {
        canUndo: this.editor.history.canUndo,
        canRedo: this.editor.history.canRedo,
        undoDepth: this.editor.history.undoDepth,
        redoDepth: this.editor.history.redoDepth,
      },
      invalidCount: this.invalidCount,
      camera: this.cameraController.getPose(),
      quality: this.graphics,
      graphics: {
        preset: this.graphics,
        booted: this.bootGraphics,
        reloadRequired: needsReload(this.bootGraphics, this.graphics),
        antialias: this.antialias,
        material: this.materialInUse,
        maxDpr: this.tuning.maxDpr,
        renderScale: this.tuning.renderScale,
        ...this.environment.graphicsState,
        activeFps: this.frameBudget.tuning.activeFps,
        idleFps: this.frameBudget.tuning.idleFps,
        lampHalos: this.nightLights.halosEnabled,
      },
      audio: this.audio.state,
      save: { available: this.saves.available, pending: this.saves.pending, lastError: this.saves.lastError },
      fx: this.fx.getDiagnostics(),
      life: this.life.getDiagnostics(),
      birds: this.birds.getDiagnostics(),
      daytime: {
        mode: this.clock.mode,
        t: this.daySample.t,
        phase: this.daySample.phase,
        pinned: this.clock.isPinned,
        night: this.daySample.night,
        lightsOn: this.daySample.lightsOn,
        ...this.nightLights.getDiagnostics(),
      },
      photo: { ...this.photo },
      perf: { targetFps: this.frameBudget.targetFps, idle: this.frameBudget.idle, shadowRenders: this.shadows.renders },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: effectivePixelRatio(window.devicePixelRatio, this.tuning),
      },
    };
  }
}
