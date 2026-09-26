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
import { SaveStore } from '../persistence/SaveStore';
import { CameraController } from '../interaction/CameraController';
import { GridPicker } from '../interaction/GridPicker';
import { ToolController } from '../interaction/ToolController';
import { ModelLibrary } from '../render/ModelLibrary';
import { TownRenderer } from '../render/TownRenderer';
import { TownEditor } from '../town/TownEditor';
import { TownState } from '../town/TownState';
import { buildAssetGallery, buildSampleTown, buildStressTown } from '../town/sampleTown';
import { UiRoot } from '../ui/UiRoot';
import { createSeededRandom } from '../utils/random';
import { Environment } from '../world/Environment';
import { MAX_DPR, PLOT_DEPTH, PLOT_WIDTH, type QualityTier } from './config';
import { createGameBus, type GamePhase } from './events';

/** Named states for __THREE_GAME_TEST_HOOKS__.setState (canvas inspector, visual tests, bots). */
export const TEST_STATES = ['title', 'empty-build', 'sample-town', 'active-play', 'asset-gallery', 'stress-town'] as const;
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
  private readonly audio: AudioManager;
  private readonly ui: UiRoot;
  private readonly debug: DebugTools;

  private phase: GamePhase = 'loading';
  private ready: Promise<void>;
  private frame = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;

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
    this.audio = new AudioManager(this.bus, fxRand, this.saves);
    this.ui = new UiRoot(uiHost, this.bus, () => this.saves.has());

    // Persistence: autosave 1 s after edits (never on 'load'); flush on page hide.
    this.saves.attachAutosave(this.bus, () => this.editor.serialize(this.cameraController.getPose()));
    window.addEventListener('pagehide', this.onPageHide);
    this.gridPreferred = this.saves.getSettings().grid;

    this.bus.on('intent:start', ({ mode }) => {
      void this.audio.unlock(); // must stay inside the click's call stack
      const save = mode === 'continue' ? this.saves.read() : null;
      if (save) this.editor.load(save);
      else this.editor.reset(); // 'new': cause 'reset' also clears the stored save
      this.setPhase('building');
      if (save?.camera) this.cameraController.setPose(save.camera);
    });
    this.bus.on('intent:new-town', () => this.editor.reset());
    this.bus.on('intent:open-menu', () => {
      if (this.phase === 'building') this.setPhase('menu');
    });
    this.bus.on('intent:close-menu', () => {
      if (this.phase === 'menu') this.setPhase('building');
    });
    this.bus.on('intent:reset-camera', () => this.cameraController.reset());
    this.bus.on('intent:toggle-grid', ({ visible }) => {
      this.gridPreferred = visible;
      this.saves.setSettings({ grid: visible });
      this.environment.setGridVisible(visible && this.phase === 'building');
    });
    this.bus.on('build:invalid', () => {
      this.invalidCount += 1;
    });

    if (!this.gridPreferred) this.bus.emit('intent:toggle-grid', { visible: false }); // sync the UI switch
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
      await this.library.loadAll((loaded, total, label) => this.bus.emit('load:progress', { loaded, total, label }));
      this.townRenderer.rebuildAll();
      this.environment.populate(this.library);
      this.bus.emit('town:stats', this.town.stats());
      this.setPhase('title');
    } catch (error) {
      console.error(error);
      this.bus.emit('load:error', { message: error instanceof Error ? error.message : String(error) });
      this.setPhase('error');
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
      this.environment.update(animDelta, animElapsed);
      this.fx.update(animDelta);
    }
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
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
    this.setPhase(name === 'title' ? 'title' : 'building');
    this.cameraController.setMode(name === 'title' ? 'title' : 'build');
    this.townRenderer.settle();
  }

  private installTestHooks(): void {
    // Consumed by scripts/inspect-threejs-canvas.mjs, tests/*.spec.ts and bot playtests.
    // Keep them REAL: no-op hooks make screenshot baselines flaky.
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seedValue = value;
        this.rng = createSeededRandom(value);
        this.fxRng = createSeededRandom(value ^ 0x9e3779b9);
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
          this.fx.stabilize();
          this.townRenderer.settle();
        }
        this.render();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => this.debug.setHidden(hidden),
      cellToClient: (x: number, z: number) => this.picker.cellToClient({ x, z }),
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
