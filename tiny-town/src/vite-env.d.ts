/// <reference types="vite/client" />
// CONTRACT FILE — owned by the integrator (WP-01). Diagnostics + test-hook shapes.

/** Published every frame by Game.publishDiagnostics(). Tests and the canvas inspector read it. */
interface ThreeGameDiagnostics {
  frame: number;
  phase: import('./game/events').GamePhase;
  tool: import('./catalog/tools').ToolId | null;
  rotation: number;
  hover: { x: number; z: number } | null;
  town: import('./town/types').TownStats;
  /** Objects in TownState. Compare with render.objects (what TownRenderer actually draws). */
  objects: number;
  render: { objects: number; groundTiles: number; edges: number } & Record<string, number>;
  history: { canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number };
  /** Count of build:invalid events since boot. */
  invalidCount: number;
  camera: import('./interaction/CameraController').CameraPose;
  quality: import('./game/config').QualityTier;
  audio: { muted: boolean; volume: number; unlocked: boolean; loaded: number; starts: number };
  /** Autosave state (SaveStore). pending = a debounced write is waiting. */
  save: { available: boolean; pending: boolean; lastError: string | null };
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
  /** CSS client coordinates of a grid cell centre, so bots can click real cells with real input. */
  cellToClient(x: number, z: number): { x: number; y: number };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
