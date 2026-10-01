/**
 * localStorage persistence: the town save with a debounced autosave, the player settings and the music position.
 *
 * Never throws: a missing or blocked localStorage (private mode, sandboxed iframe), quota errors and
 * corrupted JSON are absorbed and reported via return values and `lastError`.
 *
 * Autosave writes `debounceMs` after the last 'town:changed' or rename. Cause 'load' never schedules a
 * write; 'reset' cancels any pending write and clears the save, so an empty plot is never offered as "Continue".
 */
import { parseMusicPosition, type MusicPosition } from '../audio/musicPosition';
import { MUSIC_POSITION_STORAGE_KEY, SAVE_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../game/config';
import { DEFAULT_GRAPHICS, isGraphicsPreset, type GraphicsPreset } from '../game/graphics';
import type { GameBus } from '../game/events';
import { parseSave, type ParseOptions } from '../town/serialize';
import type { SavedTown } from '../town/types';
import { TIME_MODES, type TimeMode } from '../world/dayCycle';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GameSettings {
  muted: boolean;
  /** Master, 0..1. */
  volume: number;
  grid: boolean;
  music: boolean;
  /** 0..1, under the master volume. */
  musicVolume: number;
  /** The time of day itself is never saved. */
  timeMode: TimeMode;
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
  /** Omit for window.localStorage (if usable); null disables persistence. */
  storage?: StorageLike | null;
  saveKey?: string;
  settingsKey?: string;
  musicPositionKey?: string;
  /** Plot the save is clamped to on read. */
  plot?: ParseOptions;
  timers?: TimerApi;
  /** Clock for 'save:written'. */
  now?: () => number;
}

/** window.localStorage if it exists and accepts a write, else null. */
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
  /** False ignores town changes entirely (no writes; a reset doesn't clear the save), e.g. while a test state is shown. */
  autosaveEnabled = true;
  /** Cleared by the next successful write. */
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

  get available(): boolean {
    return this.storage !== null;
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  has(): boolean {
    return this.read() !== null;
  }

  /** Null if absent or unusable. */
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

  /** Returns false and sets lastError on quota or serialization errors. */
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

  /** Keeps the settings; cancels any pending autosave. */
  clear(): void {
    this.cancelPending();
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.saveKey);
    } catch (error) {
      this.lastError = errorText(error);
    }
  }

  /** Calling again replaces the previous subscription. */
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

  detachAutosave(): void {
    this.cancelPending();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.snapshot = null;
    this.bus = null;
  }

  /** Writes a pending autosave now (e.g. on 'pagehide'); returns whether a write happened. */
  flush(): boolean {
    if (this.timer === null) return false;
    this.cancelPending();
    return this.writeSnapshot();
  }

  cancelPending(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Invalid fields fall back to DEFAULT_SETTINGS. */
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

  getMusicPosition(): MusicPosition | null {
    const text = this.getItem(this.musicPositionKey);
    if (text === null) return null;
    try {
      return parseMusicPosition(JSON.parse(text));
    } catch {
      return null;
    }
  }

  /** An invalid position is ignored. */
  setMusicPosition(position: MusicPosition): void {
    const valid = parseMusicPosition(position);
    if (valid) this.setItem(this.musicPositionKey, JSON.stringify(valid));
  }

  dispose(): void {
    this.detachAutosave();
  }

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
