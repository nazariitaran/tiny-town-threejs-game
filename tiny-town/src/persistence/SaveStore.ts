/**
 * localStorage persistence: the town save (SAVE_STORAGE_KEY) with a debounced autosave, and the
 * player settings (SETTINGS_STORAGE_KEY), and the music position (MUSIC_POSITION_STORAGE_KEY, WP-18).
 * WP-02 owns this file; tested in SaveStore.test.ts.
 *
 * Never throws: a missing/blocked localStorage (private mode, sandboxed iframe), quota errors
 * and corrupted JSON are absorbed; failures are reported via return values and `lastError`.
 * Everything read back goes through parseSave (validated, clamped, migrated).
 *
 * Wiring in Game.ts (the whole documented API):
 *
 *   const saves = new SaveStore();                         // uses window.localStorage when usable
 *   new UiRoot(host, bus, () => saves.has());              // "Continue" only if a valid save exists
 *   saves.attachAutosave(bus, () => editor.serialize(cameraPose()));
 *   bus.on('intent:start', ({ mode }) => {
 *     const save = mode === 'continue' ? saves.read() : null;
 *     if (save) editor.load(save); else editor.reset(name); // load() never autosaves (cause 'load')
 *   });
 *   addEventListener('pagehide', () => saves.flush());     // don't lose the last second
 *   saves.getSettings() / saves.setSettings({ muted, volume, grid, music, musicVolume, timeMode, graphics })
 *   saves.getMusicPosition() / saves.setMusicPosition({ track, time })   // MUSIC_POSITION_STORAGE_KEY (WP-18)
 *   // Test states (setState): saves.autosaveEnabled = false, so demo towns never overwrite a player's save.
 *
 * Autosave: 1 s (debounceMs) after the LAST 'town:changed' whose cause is 'edit' | 'undo' | 'redo',
 * the snapshot callback is serialized and written, then 'save:written' is emitted.
 * cause 'load' never schedules a write. cause 'reset' (New town) cancels any pending write and
 * clears the stored save, so an empty plot is never offered as "Continue".
 * A rename ('town:named' with cause 'rename', WP-20) schedules a write like an edit; the name of a
 * new town is written with its first edit.
 */
import { parseMusicPosition, type MusicPosition } from '../audio/musicPosition';
import { MUSIC_POSITION_STORAGE_KEY, SAVE_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../game/config';
import { DEFAULT_GRAPHICS, isGraphicsPreset, type GraphicsPreset } from '../game/graphics';
import type { GameBus } from '../game/events';
import { parseSave, type ParseOptions } from '../town/serialize';
import type { SavedTown } from '../town/types';
import { TIME_MODES, type TimeMode } from '../world/dayCycle';

/** The subset of the Web Storage API SaveStore needs (window.localStorage satisfies it). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GameSettings {
  muted: boolean;
  /** Master volume 0..1. */
  volume: number;
  /** Grid overlay visible. */
  grid: boolean;
  /** Background music on (WP-13). */
  music: boolean;
  /** Music volume 0..1, applied under the master volume (WP-13). */
  musicVolume: number;
  /** Day/night mode (WP-16). The time of day itself is never saved. */
  timeMode: TimeMode;
  /** Graphics preset (WP-25): Low / Medium / High, Medium on every device until the player picks. */
  graphics: GraphicsPreset;
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = {
  muted: false,
  volume: 0.8,
  grid: true,
  music: true,
  musicVolume: 0.5,
  timeMode: 'auto',
  graphics: DEFAULT_GRAPHICS,
};

const isTimeMode = (value: unknown): value is TimeMode => (TIME_MODES as readonly unknown[]).includes(value);

export const AUTOSAVE_DEBOUNCE_MS = 1000;

type TimerHandle = unknown;

export interface TimerApi {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface SaveStoreOptions {
  /** Storage backend. Omit for window.localStorage (if usable); null disables persistence. */
  storage?: StorageLike | null;
  saveKey?: string;
  settingsKey?: string;
  musicPositionKey?: string;
  /** Plot the save is clamped to on read (default: game/config plot size). */
  plot?: ParseOptions;
  /** Timer functions (tests inject fakes). Default: globalThis.setTimeout/clearTimeout. */
  timers?: TimerApi;
  /** Clock for 'save:written'. Default Date.now. */
  now?: () => number;
}

/** window.localStorage if it exists and accepts a write, else null. Never throws. */
function detectLocalStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!storage || typeof storage.setItem !== 'function') return null;
    const probe = 'tiny-town:probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

export class SaveStore {
  /**
   * Set false to ignore 'town:changed' entirely (no writes, and a reset doesn't clear the save),
   * e.g. while a test state/demo town is shown. A write already pending when the debounce fires
   * is skipped while disabled.
   */
  autosaveEnabled = true;
  /** Last storage/parse failure, for diagnostics. Cleared by the next successful write. */
  lastError: string | null = null;

  private readonly storage: StorageLike | null;
  private readonly saveKey: string;
  private readonly settingsKey: string;
  private readonly musicPositionKey: string;
  private readonly plot: ParseOptions;
  private readonly timers: TimerApi;
  private readonly now: () => number;

  private bus: GameBus | null = null;
  private snapshot: (() => SavedTown) | null = null;
  private debounceMs = AUTOSAVE_DEBOUNCE_MS;
  private timer: TimerHandle | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: SaveStoreOptions = {}) {
    this.storage = options.storage === undefined ? detectLocalStorage() : options.storage;
    this.saveKey = options.saveKey ?? SAVE_STORAGE_KEY;
    this.settingsKey = options.settingsKey ?? SETTINGS_STORAGE_KEY;
    this.musicPositionKey = options.musicPositionKey ?? MUSIC_POSITION_STORAGE_KEY;
    this.plot = options.plot ?? {};
    this.timers = options.timers ?? {
      setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    };
    this.now = options.now ?? (() => Date.now());
  }

  /** Can anything be persisted at all? */
  get available(): boolean {
    return this.storage !== null;
  }

  /** Is an autosave waiting for its debounce to elapse? */
  get pending(): boolean {
    return this.timer !== null;
  }

  // ---- town save ------------------------------------------------------------------------------

  /** Does a valid (parseable) save exist? */
  has(): boolean {
    return this.read() !== null;
  }

  /** The stored save, validated/migrated/clamped by parseSave, or null if absent or unusable. */
  read(): SavedTown | null {
    const text = this.getItem(this.saveKey);
    if (text === null) return null;
    const parsed = parseSave(text, this.plot);
    if (parsed instanceof Error) {
      this.lastError = parsed.message;
      return null;
    }
    return parsed;
  }

  /** Write a save now. Returns false (and sets lastError) on quota/serialization errors. */
  write(save: SavedTown): boolean {
    if (!this.storage) return false;
    let text: string;
    try {
      text = JSON.stringify(save);
    } catch (error) {
      this.lastError = errorText(error);
      return false;
    }
    if (!this.setItem(this.saveKey, text)) return false;
    this.lastError = null;
    this.bus?.emit('save:written', { at: this.now() });
    return true;
  }

  /** Delete the stored save (settings are kept) and cancel any pending autosave. */
  clear(): void {
    this.cancelPending();
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.saveKey);
    } catch (error) {
      this.lastError = errorText(error);
    }
  }

  // ---- autosave -------------------------------------------------------------------------------

  /**
   * Start autosaving: debounced `debounceMs` after 'town:changed' (cause ≠ 'load') or a rename,
   * writes `snapshot()`. Calling again re-attaches (previous subscription removed).
   */
  attachAutosave(bus: GameBus, snapshot: () => SavedTown, debounceMs = AUTOSAVE_DEBOUNCE_MS): void {
    this.detachAutosave();
    this.bus = bus;
    this.snapshot = snapshot;
    this.debounceMs = debounceMs;
    const offChanged = bus.on('town:changed', ({ cause }) => {
      if (cause === 'load') return;
      if (!this.autosaveEnabled) return;
      if (cause === 'reset') this.clear();
      else this.schedule();
    });
    const offNamed = bus.on('town:named', ({ cause }) => {
      if (cause === 'rename' && this.autosaveEnabled) this.schedule();
    });
    this.unsubscribe = () => {
      offChanged();
      offNamed();
    };
  }

  /** Stop listening and cancel any pending write. */
  detachAutosave(): void {
    this.cancelPending();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.snapshot = null;
    this.bus = null;
  }

  /** Write a pending autosave immediately (e.g. on 'pagehide'). Returns whether a write happened. */
  flush(): boolean {
    if (this.timer === null) return false;
    this.cancelPending();
    return this.writeSnapshot();
  }

  /** Drop a pending autosave without writing. */
  cancelPending(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- settings -------------------------------------------------------------------------------

  /** Stored settings merged over DEFAULT_SETTINGS; invalid fields fall back to defaults. */
  getSettings(): GameSettings {
    const settings: GameSettings = { ...DEFAULT_SETTINGS };
    const text = this.getItem(this.settingsKey);
    if (text === null) return settings;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.lastError = 'Settings are not valid JSON';
      return settings;
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return settings;
    const r = raw as Record<string, unknown>;
    if (typeof r.muted === 'boolean') settings.muted = r.muted;
    if (typeof r.volume === 'number' && Number.isFinite(r.volume)) settings.volume = Math.min(1, Math.max(0, r.volume));
    if (typeof r.grid === 'boolean') settings.grid = r.grid;
    if (typeof r.music === 'boolean') settings.music = r.music;
    if (typeof r.musicVolume === 'number' && Number.isFinite(r.musicVolume)) settings.musicVolume = Math.min(1, Math.max(0, r.musicVolume));
    if (isTimeMode(r.timeMode)) settings.timeMode = r.timeMode;
    if (isGraphicsPreset(r.graphics)) settings.graphics = r.graphics;
    return settings;
  }

  /** Merge `patch` into the stored settings and persist them. Returns the resulting settings. */
  setSettings(patch: Partial<GameSettings>): GameSettings {
    const next = { ...this.getSettings() };
    if (typeof patch.muted === 'boolean') next.muted = patch.muted;
    if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) next.volume = Math.min(1, Math.max(0, patch.volume));
    if (typeof patch.grid === 'boolean') next.grid = patch.grid;
    if (typeof patch.music === 'boolean') next.music = patch.music;
    if (typeof patch.musicVolume === 'number' && Number.isFinite(patch.musicVolume)) next.musicVolume = Math.min(1, Math.max(0, patch.musicVolume));
    if (isTimeMode(patch.timeMode)) next.timeMode = patch.timeMode;
    if (isGraphicsPreset(patch.graphics)) next.graphics = patch.graphics;
    this.setItem(this.settingsKey, JSON.stringify(next));
    return next;
  }

  // ---- music position (WP-18) -----------------------------------------------------------------

  /** Where the music stopped last visit, or null (nothing stored, invalid JSON or an invalid record). */
  getMusicPosition(): MusicPosition | null {
    const text = this.getItem(this.musicPositionKey);
    if (text === null) return null;
    try {
      return parseMusicPosition(JSON.parse(text));
    } catch {
      return null;
    }
  }

  /** Store the music position; an invalid one is ignored. Never throws. */
  setMusicPosition(position: MusicPosition): void {
    const valid = parseMusicPosition(position);
    if (valid) this.setItem(this.musicPositionKey, JSON.stringify(valid));
  }

  dispose(): void {
    this.detachAutosave();
  }

  // ---- internals ------------------------------------------------------------------------------

  private schedule(): void {
    this.cancelPending();
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (this.autosaveEnabled) this.writeSnapshot();
    }, this.debounceMs);
  }

  private writeSnapshot(): boolean {
    if (!this.snapshot) return false;
    let save: SavedTown;
    try {
      save = this.snapshot();
    } catch (error) {
      this.lastError = errorText(error);
      return false;
    }
    return this.write(save);
  }

  private getItem(key: string): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(key);
    } catch (error) {
      this.lastError = errorText(error);
      return null;
    }
  }

  private setItem(key: string, value: string): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch (error) {
      // QuotaExceededError, SecurityError, …
      this.lastError = errorText(error);
      return false;
    }
  }
}
