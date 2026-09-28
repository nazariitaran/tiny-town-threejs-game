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
  town: import('./town/types').TownStats;
  /** Objects in TownState. Compare with render.objects (what TownRenderer actually draws). */
  objects: number;
  render: { objects: number; groundTiles: number; edges: number } & Record<string, number>;
  history: { canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number };
  /** Count of build:invalid events since boot. */
  invalidCount: number;
  camera: import('./interaction/CameraController').CameraPose;
  quality: import('./game/config').QualityTier;
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
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
