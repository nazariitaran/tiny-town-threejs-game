/**
 * Composition root. Creates every system, wires them through the event bus, owns the
 * phase machine (loading → title → building ⇄ menu) and the per-frame update order.
 *
 * OWNERSHIP: integrator only. Workstreams change their own modules behind the APIs used
 * here; if an API must change, say so in the hand-off and the integrator updates this file.
 */
import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { DebugTools, type DebugTuning } from '../debug/DebugTools';
import { PlacementFx } from '../fx/PlacementFx';
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
import { assetUrl, MAX_DPR, PLOT_DEPTH, PLOT_WIDTH, type QualityTier } from './config';
import { createGameBus, type GamePhase } from './events';

/** Named states for __THREE_GAME_TEST_HOOKS__.setState (canvas inspector, visual tests, bots). */
// Every state pins the clock to afternoon (the v0.2 look) except 'night-town' (sample town at T_NIGHT).
export const TEST_STATES = ['title', 'empty-build', 'sample-town', 'active-play', 'asset-gallery', 'stress-town', 'night-town'] as const;
type TestState = (typeof TEST_STATES)[number];

export class Game {
  readonly bus = createGameBus();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 900);
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );
  private readonly quality: QualityTier = window.matchMedia('(pointer: coarse)').matches ? 'low' : 'high';
  private readonly tuning: DebugTuning = { exposure: 1.0, maxDpr: MAX_DPR[this.quality], showStats: false };
  // Route ALL randomness through these (never Math.random) so seed() keeps tests deterministic.
  // Gameplay (variants) and cosmetic (audio/fx jitter) streams are separate, so playing a sound
  // never changes which house variant the next placement gets.
  private seedValue = 1;
  private rng = createSeededRandom(this.seedValue);
  private fxRng = createSeededRandom(this.seedValue ^ 0x9e3779b9);
  /**
   * Town-name suggestions (WP-20): a third stream, seeded afresh on every page load (a fixed seed
   * would give every new player the same first name); seed() pins it for tests.
   */
  private nameRng = createSeededRandom(entropySeed());
  /** The owner's suggestion list (public/data/default_town_names.json), loaded with the models. */
  private townNames: string[] = [];
  private gridPreferred = true;
  private invalidCount = 0;

  private readonly town = new TownState(PLOT_WIDTH, PLOT_DEPTH);
  private readonly editor: TownEditor;
  private readonly library = new ModelLibrary();
  private readonly saves = new SaveStore();
  private readonly environment: Environment;
  private readonly cameraController: CameraController;
  private readonly picker: GridPicker;
  private readonly tools: ToolController;
  private readonly townRenderer: TownRenderer;
  private readonly fx: PlacementFx;
  private readonly life: LifeSystem;
  private readonly nightLights: NightLights;
  /** Day/night (WP-16): the clock, the sample it writes every frame, the last announced mode/phase. */
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
  /** Photos (WP-19): diagnostics only; the framed blob travels on `photo:ready`. */
  private readonly photo: ThreeGameDiagnostics['photo'] = { taken: 0, developing: false, last: null };
  private reducedMotion = false;
  /** OS "reduce motion": the day cycle still runs, but mode switches snap instead of sweeping. */
  private readonly prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  constructor(private readonly canvas: HTMLCanvasElement, uiHost: HTMLElement) {
    const rand = () => this.rng();
    const fxRand = () => this.fxRng();
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    // Workstreams add their own tunables with debug.folder('<Name>') (only when ?debug is set).
    this.debug = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.editor = new TownEditor(this.town, this.bus, rand);
    this.environment = new Environment(this.scene, this.renderer, this.debug);
    this.environment.setQuality(this.quality);
    this.cameraController = new CameraController(this.camera, canvas, this.debug);
    this.picker = new GridPicker(this.camera, canvas);
    this.tools = new ToolController(canvas, this.picker, this.editor, this.cameraController, this.bus, this.scene, this.library, this.debug);
    this.townRenderer = new TownRenderer(this.scene, this.library, this.town, this.bus, this.debug);
    this.fx = new PlacementFx(this.scene, this.bus, fxRand);
    // Ambient cars use the cosmetic stream so they never shift gameplay variants.
    this.life = new LifeSystem(this.scene, this.town, this.bus, fxRand, this.debug);
    this.nightLights = new NightLights(this.scene, this.library, this.town, this.bus, this.life, this.quality, this.debug);
    this.clock = new DayClock(this.saves.getSettings().timeMode);
    this.installClockDebug();
    this.audio = new AudioManager(this.bus, fxRand, this.saves);
    this.ui = new UiRoot(uiHost, this.bus, () => this.saves.has(), (avoid) => pickTownName(this.townNames, this.nameRng, avoid));

    // Persistence: autosave 1 s after edits (never on 'load'); flush on page hide.
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

    if (!this.gridPreferred) this.bus.emit('intent:toggle-grid', { visible: false }); // sync the UI switch
    this.announceDaytime(); // sync the UI time button with the stored mode
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.installTestHooks();
    this.ready = this.load();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('pagehide', this.onPageHide);
    this.saves.flush();
    this.saves.dispose();
    this.tools.dispose();
    this.cameraController.dispose();
    this.townRenderer.dispose();
    this.fx.dispose();
    this.nightLights.dispose();
    this.life.dispose();
    this.audio.dispose();
    this.ui.dispose();
    this.environment.dispose();
    this.library.dispose();
    this.debug.dispose();
    this.bus.clear();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
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
      this.bus.emit('town:stats', this.town.stats());
      this.setPhase('title');
    } catch (error) {
      console.error(error);
      this.bus.emit('load:error', { message: error instanceof Error ? error.message : String(error) });
      this.setPhase('error');
    }
  }

  /** The name suggestions (WP-20). Never fails the load: without them the suggestion is "Tiny Town". */
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
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    if (!this.pausedForScreenshot) {
      const animDelta = this.reducedMotion ? 0 : delta;
      const animElapsed = this.reducedMotion ? 0 : elapsed;
      this.tools.update(delta);
      this.cameraController.update(delta);
      this.townRenderer.update(animDelta);
      this.life.update(animDelta);
      // The clock runs only while building (frozen on the title, in the menu, under reduced motion).
      if (this.phase === 'building') this.clock.advance(animDelta);
      this.applyDaylight();
      this.environment.update(animDelta, animElapsed);
      this.fx.update(animDelta);
    }
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Town photo (WP-19). Entering the menu phase (the UI shows the photo view, not the menu) hides
   * the ghost, the hover frame and the grid and pauses the clock; then one higher-resolution frame
   * is captured in this same task. Framing and JPEG encoding finish asynchronously; the framing
   * code is loaded on the first photo (it keeps the main chunk under the 900 kB warning limit).
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

  /** Town file (WP-21): the live town (not the stored autosave, which trails by 1 s), in the same task. */
  private exportTown(): void {
    if (this.phase !== 'building' && this.phase !== 'menu') return;
    const date = new Date();
    const text = encodeTownFile(this.editor.serialize(this.cameraController.getPose()), date);
    this.bus.emit('town-file:ready', { blob: new Blob([text], { type: TOWN_FILE_MIME }), fileName: townFileName(this.editor.name, date) });
  }

  /**
   * Town file (WP-21): replace the town with an opened (validated) file. Not undoable, like Continue.
   * The save is written at once, so a reload continues the opened town; opening a file is the
   * player's own act, so it also turns autosave back on after a test state. From the title this is
   * the Start click (audio unlocks, the morning starts); from the menu the time of day carries on.
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

  /** `?debug&day=N`: an N-second Auto day (evidence captures); lil-gui `Clock` folder. Debug only. */
  private installClockDebug(): void {
    if (!this.debug.enabled) return;
    const day = Number(new URLSearchParams(window.location.search).get('day'));
    if (Number.isFinite(day) && day > 0) this.clock.dayLengthS = day;
    this.debug.folder('Clock')?.add(this.clock, 'dayLengthS', 10, 1200, 1).name('day length (s)');
  }

  /** Change the day/night mode: persisted; the clock sweeps to it (snaps under reduced motion). */
  private setTimeMode(mode: TimeMode): void {
    this.clock.setMode(mode, this.reducedMotion || this.prefersReducedMotion?.matches === true);
    this.saves.setSettings({ timeMode: mode });
    this.applyDaylight();
  }

  /**
   * Sample the clock and drive every day/night consumer. The title screen (and loading) always
   * shows the afternoon unless a test pinned the clock; the chosen mode takes effect on Start.
   * Called every frame and at once from test hooks (they must work while paused for screenshots).
   */
  private applyDaylight(): void {
    const live = this.clock.isPinned || this.phase === 'building' || this.phase === 'menu';
    if (live) this.clock.sample(this.daySample);
    else sampleDay(T_AFTERNOON, this.daySample);
    this.environment.applyDaylight(this.daySample);
    this.nightLights.update(this.daySample);
    this.life.setNight(this.daySample.night);
    this.announceDaytime();
  }

  /** daytime:changed when the mode or the phase changes (never per frame). */
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
    // Pinned until setTimeOfDay(null) or a reload: existing states keep today's afternoon look.
    this.clock.pin(name === 'night-town' ? T_NIGHT : T_AFTERNOON);
    this.applyDaylight();
    this.townRenderer.settle();
    this.life.settle();
  }

  private installTestHooks(): void {
    // Consumed by scripts/inspect-threejs-canvas.mjs, tests/*.spec.ts and bot playtests.
    // Keep them REAL: no-op hooks make screenshot baselines flaky.
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seedValue = value;
        this.rng = createSeededRandom(value);
        this.fxRng = createSeededRandom(value ^ 0x9e3779b9);
        this.nameRng = createSeededRandom(value ^ 0x51f15eed);
      },
      setState: async (name: string) => {
        if (!(TEST_STATES as readonly string[]).includes(name)) throw new Error(`Unknown test state: ${name}`);
        await this.applyTestState(name as TestState);
        this.render();
        this.publishDiagnostics();
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
        }
        this.render();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => this.debug.setHidden(hidden),
      cellToClient: (x: number, z: number) => this.picker.cellToClient({ x, z }),
      setCameraPose: (pose) => {
        this.cameraController.setPose(pose);
        this.render();
        this.publishDiagnostics();
      },
      setTimeOfDay: (t: number | null) => {
        if (t !== null && !Number.isFinite(t)) throw new Error(`setTimeOfDay: not a number: ${t}`);
        this.clock.pin(t);
        this.applyDaylight();
        this.render();
        this.publishDiagnostics();
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      phase: this.phase,
      tool: this.tools.activeTool,
      rotation: this.tools.activeRotation,
      hover: this.tools.hovered,
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
      quality: this.quality,
      audio: this.audio.state,
      save: { available: this.saves.available, pending: this.saves.pending, lastError: this.saves.lastError },
      fx: this.fx.getDiagnostics(),
      life: this.life.getDiagnostics(),
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
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }
}
