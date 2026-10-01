/// <reference types="vite/client" />
// CONTRACT FILE — owned by the integrator (WP-01). Diagnostics + test-hook shapes.

/** Published every frame by Game.publishDiagnostics(). Tests and the canvas inspector read it. */
interface ThreeGameDiagnostics {
  frame: number;
  phase: import('./game/events').GamePhase;
  tool: import('./catalog/tools').ToolId | null;
  rotation: number;
  /** Hovered cell; valid/reason mirror hover:changed (a just-placed cell reports valid). */
  hover: { x: number; z: number; valid: boolean; reason: string | null } | null;
  /** Move tool: the object being carried (its id, kind and the rotation it would be put down with), or null. */
  selection: { id: number; kind: import('./town/types').ObjectKind; rotation: number } | null;
  /**
   * Variant picker: the active object tool's chosen model (what its ghost shows and it builds) and
   * `count`, its models. null for tools with one model.
   */
  variant: { choice: number; count: number } | null;
  town: import('./town/types').TownStats;
  /** The town's name (WP-20): what the top bar and the photo card show. */
  townName: string;
  /** Objects in TownState. Compare with render.objects (what TownRenderer actually draws). */
  objects: number;
  render: { objects: number; groundTiles: number; edges: number } & Record<string, number>;
  history: { canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number };
  /** Count of build:invalid events since boot. */
  invalidCount: number;
  camera: import('./interaction/CameraController').CameraPose;
  /** The graphics preset now applied (WP-25; was the hidden touch-screen tier before). */
  quality: import('./game/graphics').GraphicsPreset;
  /**
   * Graphics preset (WP-25). preset = applied now; booted = what the page started with (fixes MSAA
   * and the material family); reloadRequired = needsReload(booted, preset). antialias / material are
   * what the page really runs with (the context's attributes; the lit material family in the scene,
   * 'mixed' would be a bug). The rest is what is applied now: DPR cap, sun shadow-map size, decor-ring
   * share and instances drawn, sky fbm octaves, frame caps, lamp halos at night.
   */
  graphics: {
    preset: import('./game/graphics').GraphicsPreset;
    booted: import('./game/graphics').GraphicsPreset;
    reloadRequired: boolean;
    antialias: boolean;
    material: 'standard' | 'lambert' | 'mixed' | 'none';
    maxDpr: number;
    /** Share of the screen's pixel density rendered before the cap (Low 0.75; see graphics.ts effectivePixelRatio). */
    renderScale: number;
    shadowMapSize: number;
    decorFraction: number;
    decorInstances: number;
    skyOctaves: number;
    activeFps: number;
    idleFps: number;
    lampHalos: boolean;
  };
  audio: {
    muted: boolean;
    volume: number;
    unlocked: boolean;
    loaded: number;
    starts: number;
    /** Background music (WP-13): streamed, starts after Start. */
    music: { enabled: boolean; volume: number; playing: boolean; loaded: boolean; requested: boolean; ducked: boolean; time: number; loops: number; resumedFrom: number | null };
  };
  /** Autosave state (SaveStore). pending = a debounced write is waiting. */
  save: { available: boolean; pending: boolean; lastError: string | null };
  /** Placement FX pool (WP-08): active particles, fx draw calls, spawn/drop counters, wind state. */
  fx: import('./fx/PlacementFx').FxDiagnostics;
  /** Ambient cars (WP-10). */
  life: import('./life/LifeSystem').LifeDiagnostics;
  /** Flocks over the town (WP-22): auto = spontaneous flocks on; positions of every bird in the air. */
  birds: import('./life/BirdSystem').BirdDiagnostics;
  /**
   * Day/night (WP-16). t = time of day shown (0..1), pinned = a test hook / test state holds it.
   * night 0 day .. 1 full night; lightsOn = fraction of lit houses; lamps = lampposts NightLights
   * tracks; drawCalls = main-pass calls NightLights adds (0 by day).
   */
  daytime: {
    mode: import('./world/dayCycle').TimeMode;
    t: number;
    phase: import('./world/dayCycle').DayPhase;
    pinned: boolean;
    night: number;
    lightsOn: number;
    lamps: number;
    drawCalls: number;
  };
  /**
   * Photo (WP-19). taken = photos requested while building; developing = one is being framed/encoded.
   * last = the latest framed photo: JPEG size in px and bytes, capture pixel ratio, capture + encode ms.
   */
  photo: {
    taken: number;
    developing: boolean;
    last: { width: number; height: number; bytes: number; pixelRatio: number; ms: number } | null;
  };
  /**
   * Frame budget (WP-24). targetFps = the loop's cap this frame (60 active, 30 idle; 0 = display
   * rate); idle = no input, camera glide or tween for FrameBudget.idleAfterS; shadowRenders =
   * sun shadow-map redraws since boot (the map is redrawn only when a caster changed).
   */
  perf: { targetFps: number; idle: boolean; shadowRenders: number };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void | Promise<void>;
  /** Acknowledge after setup/assets are ready; throw for unknown states. See Game.TEST_STATES. */
  setState(name: string): { state: string } | Promise<{ state: string }>;
  /** Stop simulation/state transitions immediately; keep rendering. Await optional synchronization. */
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  /** Stabilize ambient/idle visuals without requiring an unpaused simulation tick. */
  setReducedMotion(enabled: boolean): void | Promise<void>;
  /** Hide debug UI (lil-gui) before capturing. */
  hideDebugUi(hidden: boolean): void | Promise<void>;
  /**
   * CSS client coordinates of a grid cell centre, so bots can click real cells with real input.
   * Cells are the 64 × 64 half-unit grid (WP-12; 48 × 48 until the 64 × 64 plot); a road block is 2 × 2 cells, houses 4×4 / 3×4 / 5×4 (WP-17).
   */
  cellToClient(x: number, z: number): { x: number; y: number };
  /** Move the camera to a pose at once (screenshots of one spot, e.g. the asset gallery). */
  setCameraPose(pose: { targetX: number; targetZ: number; azimuth: number; polar: number; distance: number }): void;
  /**
   * Pin the time of day (0..1; 0.55 = afternoon, 0.82 = night) and apply it at once, even while
   * paused for a screenshot. null releases the pin (Auto/Day/Night resume). Test states pin too.
   */
  setTimeOfDay(t: number | null): void;
  /**
   * Launch a flock of birds now (WP-22), any time of day: 'pigeon' | 'starling' | 'goose' | 'gull',
   * or a species picked by the flock stream. Returns the number of birds (0 when the sky is full).
   * Test states switch spontaneous flocks off until a reload, so this is how tests get birds.
   */
  spawnFlock(species?: string): number;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
