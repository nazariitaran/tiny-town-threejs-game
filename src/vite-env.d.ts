/// <reference types="vite/client" />

/** package.json `version`, injected by `define` in vite.config.ts and vitest.config.ts. */
declare const __APP_VERSION__: string;

/** Published every frame by Game.publishDiagnostics(); read by tests and the canvas inspector. */
interface ThreeGameDiagnostics {
  frame: number;
  phase: import('./game/events').GamePhase;
  tool: import('./catalog/tools').ToolId | null;
  rotation: number;
  /** valid/reason mirror hover:changed; a just-placed cell reports valid. */
  hover: { x: number; z: number; valid: boolean; reason: string | null } | null;
  /** Move tool: the carried object and the rotation it would be put down with. */
  selection: { id: number; kind: import('./town/types').ObjectKind; rotation: number } | null;
  /** The active object tool's chosen model and its model count; null for one-model tools. */
  variant: { choice: number; count: number } | null;
  town: import('./town/types').TownStats;
  townName: string;
  /** Objects in TownState; render.objects is what TownRenderer draws. */
  objects: number;
  render: { objects: number; groundTiles: number; edges: number } & Record<string, number>;
  history: { canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number };
  /** Count of build:invalid events since boot. */
  invalidCount: number;
  camera: import('./interaction/CameraController').CameraPose;
  /** The graphics preset now applied. */
  quality: import('./game/graphics').GraphicsPreset;
  /**
   * preset: applied now; booted: what the page started with (fixes MSAA and the material family).
   * antialias / material: what the page really runs with (the context's attributes; the lit material
   * family in the scene, where 'mixed' is a bug).
   */
  graphics: {
    preset: import('./game/graphics').GraphicsPreset;
    booted: import('./game/graphics').GraphicsPreset;
    reloadRequired: boolean;
    antialias: boolean;
    material: 'standard' | 'lambert' | 'mixed' | 'none';
    maxDpr: number;
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
    music: { enabled: boolean; volume: number; playing: boolean; loaded: boolean; requested: boolean; ducked: boolean; time: number; loops: number; resumedFrom: number | null };
  };
  /** pending: a debounced autosave write is waiting. */
  save: { available: boolean; pending: boolean; lastError: string | null };
  fx: import('./fx/PlacementFx').FxDiagnostics;
  /** Ambient cars. */
  life: import('./life/LifeSystem').LifeDiagnostics;
  birds: import('./life/BirdSystem').BirdDiagnostics;
  /**
   * t: time of day shown (0..1); pinned: a test hook or test state holds it; night: 0 day .. 1 full night;
   * lightsOn: fraction of lit houses; lamps: lampposts NightLights tracks; drawCalls: main-pass calls it adds.
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
   * taken: photos requested while building; developing: one is being framed/encoded.
   * last: the latest photo's JPEG size in px and bytes, capture pixel ratio, capture + encode ms.
   */
  photo: {
    taken: number;
    developing: boolean;
    last: { width: number; height: number; bytes: number; pixelRatio: number; ms: number } | null;
  };
  /**
   * targetFps: the loop's cap this frame (0 = display rate); idle: no input, camera glide or tween for
   * FrameBudget.idleAfterS; shadowRenders: sun shadow-map redraws since boot (only when a caster changed).
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
  /** Acknowledges after setup/assets are ready; throws for unknown states (Game.TEST_STATES). */
  setState(name: string): { state: string } | Promise<{ state: string }>;
  /** Stops simulation/state transitions immediately; keeps rendering. */
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  /** Stabilize ambient/idle visuals without requiring an unpaused simulation tick. */
  setReducedMotion(enabled: boolean): void | Promise<void>;
  hideDebugUi(hidden: boolean): void | Promise<void>;
  /** CSS client coordinates of a grid cell centre, so bots can click real cells with real input. */
  cellToClient(x: number, z: number): { x: number; y: number };
  /** Moves the camera to a pose at once. */
  setCameraPose(pose: { targetX: number; targetZ: number; azimuth: number; polar: number; distance: number }): void;
  /**
   * Pin the time of day (0..1; 0.55 = afternoon, 0.82 = night) and apply it at once, even while
   * paused for a screenshot. null releases the pin (Auto/Day/Night resume). Test states pin too.
   */
  setTimeOfDay(t: number | null): void;
  /**
   * Launches a flock of birds now, any time of day: 'pigeon' | 'starling' | 'goose' | 'gull',
   * or a species picked by the flock stream. Returns the number of birds (0 when the sky is full).
   * Test states switch spontaneous flocks off until a reload, so this is how tests get birds.
   */
  spawnFlock(species?: string): number;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
