/**
 * Web Audio SFX manager (WP-07): unlock on the first user gesture, decode every file in SFX_TABLE,
 * play with variant pools, pitch jitter, per-event cooldowns and ui/sfx groups under one master gain.
 *
 * - Mute/volume persist under SETTINGS_STORAGE_KEY (merged with the other settings keys, never clobbered).
 *   The stored values are announced with `audio:changed` right after construction so the UI shows them.
 * - The context is suspended while the page is hidden and resumed when it's visible again.
 * - Load/decode failures are reported once, as a single console.warn listing every failed file; never thrown.
 * - Drag strokes: at most one build sound per BUILD_SOUND_GAP_MS, and placements rise in pitch by
 *   STROKE_PITCH_STEP per consecutive placement (build:placed.strokeIndex; resets with each new stroke).
 *
 * LOCAL SHIMS (remove once the integrator lands the matching contract changes, see the WP-07 hand-off):
 *  - `place-prop-metal`: lamppost/postbox get a metal clink instead of the wooden fence knock. Until
 *    sfx.ts/tools.ts/sfxTable.ts know the event, its table entry and tool mapping live here.
 *  - undo/redo `playbackRate` (0.89 / 1.12) is in audio.json but not yet emitted by gen-sfx-table.mjs.
 *  - settings storage: until Game passes WP-02's SaveStore as the 3rd constructor argument, `localSettings`
 *    below reads/writes the same SETTINGS_STORAGE_KEY with the same merge semantics.
 */
import { SETTINGS_STORAGE_KEY, assetUrl } from '../game/config';
import type { GameBus } from '../game/events';
import type { SfxEvent } from './sfx';
import { SFX_TABLE, type SfxEntry } from './sfxTable';
import type { ToolId } from '../catalog/tools';
import { toolDef } from '../catalog/tools';

type Group = 'ui' | 'sfx';
/** SfxEvent plus the events this file shims until the contract catches up. */
type PlayableEvent = SfxEvent | 'place-prop-metal';

export interface AudioSettings {
  muted: boolean;
  volume: number;
}

/**
 * Where mute/volume are persisted. Structurally matches WP-02's SaveStore (`getSettings()` /
 * `setSettings(patch)`), so Game can pass its SaveStore instance straight in:
 * `new AudioManager(bus, fxRand, saves)`.
 */
export interface SettingsPort {
  getSettings(): Partial<AudioSettings>;
  setSettings(patch: Partial<AudioSettings>): unknown;
}

/** Minimum gap between two build (place/remove) sounds, so drag-painting never machine-guns. */
export const BUILD_SOUND_GAP_MS = 60;
/** Playback-rate rise per consecutive placement in one stroke (+2%). */
export const STROKE_PITCH_STEP = 0.02;
/** Cap on the stroke pitch rise (+40%, reached at the 20th placement) so long strokes don't squeak. */
export const STROKE_PITCH_MAX = 0.4;
/** Pitch jitter multiplier for placements after the first in a stroke. */
const STROKE_JITTER_SCALE = 0.35;
const DEFAULT_SETTINGS: AudioSettings = { muted: false, volume: 0.8 };
/** Master-gain ramp time constant (s): mute/volume changes fade instead of clicking. */
const GAIN_RAMP_S = 0.015;

// ---- LOCAL SHIM: contract additions requested in the WP-07 hand-off -------------------------------
const SHIM_TABLE: Partial<Record<PlayableEvent, SfxEntry>> = {
  'place-prop-metal': {
    files: ['/assets/audio/place-prop-metal-1.mp3', '/assets/audio/place-prop-metal-2.mp3'],
    group: 'sfx',
    volume: 0.7,
    pitchJitter: 0.06,
    cooldownMs: 50,
  },
};
const SHIM_TOOL_SFX: Partial<Record<ToolId, PlayableEvent>> = { lamppost: 'place-prop-metal', postbox: 'place-prop-metal' };
const SHIM_PLAYBACK_RATE: Partial<Record<PlayableEvent, number>> = { undo: 0.89, redo: 1.12 };
/** Removal pitch by layer: objects sound heavier, ground tiles lighter. */
const REMOVE_RATE: Record<'ground' | 'object' | 'edge', number> = { ground: 1.06, object: 0.92, edge: 1 };

function entryFor(event: PlayableEvent): SfxEntry | undefined {
  return (SFX_TABLE as Partial<Record<PlayableEvent, SfxEntry>>)[event] ?? SHIM_TABLE[event];
}

/** LOCAL SHIM for WP-02's SaveStore settings API: same key, merges with whatever else is stored there. */
export const localSettings: SettingsPort = {
  getSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return {};
      const { muted, volume } = parsed as Record<string, unknown>;
      const out: Partial<AudioSettings> = {};
      if (typeof muted === 'boolean') out.muted = muted;
      if (typeof volume === 'number' && Number.isFinite(volume)) out.volume = Math.min(1, Math.max(0, volume));
      return out;
    } catch {
      return {};
    }
  },
  setSettings(patch) {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      let current: Record<string, unknown> = {};
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') current = parsed as Record<string, unknown>;
      } catch {
        // corrupted settings: start over rather than throw
      }
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {
      // quota / privacy mode: settings just don't persist
    }
  },
};
// ----------------------------------------------------------------------------------------------------

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly groups = new Map<Group, GainNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<PlayableEvent, number>();
  private readonly unsubscribers: Array<() => void> = [];
  private muted: boolean;
  private volume: number;
  /** Buffer sources started since boot (diagnostics: audio.starts). */
  private starts = 0;
  private lastBuildSoundAt = -Infinity;
  /** True while we suspended the context because the page was hidden. */
  private suspendedForHidden = false;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly bus: GameBus,
    private readonly rng: () => number,
    private readonly settings: SettingsPort = localSettings,
  ) {
    const stored = { ...DEFAULT_SETTINGS, ...settings.getSettings() };
    this.muted = stored.muted;
    this.volume = stored.volume;

    const on = bus.on.bind(bus);
    this.unsubscribers.push(
      on('ui:sfx', ({ event }) => this.play(event)),
      on('build:placed', ({ toolId, strokeIndex }) =>
        this.playBuild(
          this.placeEventFor(toolId),
          1 + Math.min(STROKE_PITCH_MAX, strokeIndex * STROKE_PITCH_STEP),
          // less random jitter inside a stroke, so the +2% steps read as a rising run
          strokeIndex > 0 ? STROKE_JITTER_SCALE : 1,
        ),
      ),
      on('build:removed', ({ layer }) => this.playBuild('remove', REMOVE_RATE[layer])),
      on('build:invalid', () => this.play('invalid')),
      on('build:rotated', () => this.play('rotate')),
      on('intent:undo', () => this.play('undo')),
      on('intent:redo', () => this.play('redo')),
      on('intent:set-muted', ({ muted }) => this.setMuted(muted)),
      on('intent:set-volume', ({ volume }) => this.setVolume(volume)),
    );
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Game builds the UI after the AudioManager; announce the stored settings once it's listening.
    queueMicrotask(() => {
      if (this.unsubscribers.length > 0) this.announce();
    });
  }

  /** Must be called from a user gesture handler (the title screen's Start button). */
  async unlock(): Promise<void> {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      for (const group of ['ui', 'sfx'] as const) {
        const gain = this.context.createGain();
        gain.connect(this.master);
        this.groups.set(group, gain);
      }
      this.applyVolume(true);
      this.loading = this.loadAll();
    }
    if (this.context.state !== 'running' && !document.hidden) {
      try {
        await this.context.resume();
      } catch (error) {
        console.warn('[audio] could not resume the AudioContext', error);
      }
    }
  }

  play(event: PlayableEvent, rate = 1, jitterScale = 1): void {
    const ctx = this.context;
    const entry = entryFor(event);
    if (!ctx || ctx.state !== 'running' || !entry || this.muted) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(event) ?? -Infinity) < entry.cooldownMs) return;
    const file = entry.files[Math.floor(this.rng() * entry.files.length)];
    const buffer = this.buffers.get(file);
    if (!buffer) return;
    this.lastPlayed.set(event, now);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const jitter = 1 + (this.rng() * 2 - 1) * entry.pitchJitter * jitterScale;
    source.playbackRate.value = rate * (SHIM_PLAYBACK_RATE[event] ?? 1) * jitter;
    const gain = ctx.createGain();
    gain.gain.value = entry.volume;
    source.connect(gain).connect(this.groups.get(entry.group) ?? ctx.destination);
    source.onended = () => gain.disconnect();
    source.start();
    this.starts += 1;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
    this.settings.setSettings({ muted });
    this.announce();
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : this.volume;
    this.applyVolume();
    this.settings.setSettings({ volume: this.volume });
    this.announce();
  }

  get state(): { muted: boolean; volume: number; unlocked: boolean; loaded: number; starts: number } {
    return { muted: this.muted, volume: this.volume, unlocked: this.context?.state === 'running', loaded: this.buffers.size, starts: this.starts };
  }

  /** Resolves when every file has been fetched and decoded (or failed). For tests/tools. */
  whenLoaded(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.groups.clear();
    this.buffers.clear();
  }

  /** Place/remove sounds share one rate limiter so a fast drag gives at most one sound per gap. */
  private playBuild(event: PlayableEvent, rate: number, jitterScale = 1): void {
    const now = performance.now();
    if (now - this.lastBuildSoundAt < BUILD_SOUND_GAP_MS) return;
    const before = this.starts;
    this.play(event, rate, jitterScale);
    if (this.starts !== before) this.lastBuildSoundAt = now;
  }

  private placeEventFor(toolId: ToolId): PlayableEvent {
    // LOCAL SHIM: once tools.ts maps lamppost/postbox to 'place-prop-metal', toolDef(toolId).sfx alone is enough.
    return SHIM_TOOL_SFX[toolId] ?? toolDef(toolId).sfx;
  }

  private announce(): void {
    this.bus.emit('audio:changed', { muted: this.muted, volume: this.volume });
  }

  private applyVolume(immediate = false): void {
    const ctx = this.context;
    if (!this.master || !ctx) return;
    const target = this.muted ? 0 : this.volume;
    const param = this.master.gain;
    if (immediate) {
      param.value = target;
      return;
    }
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(target, ctx.currentTime, GAIN_RAMP_S);
  }

  private readonly onVisibilityChange = (): void => {
    const ctx = this.context;
    if (!ctx || ctx.state === 'closed') return;
    if (document.hidden) {
      if (ctx.state === 'running') {
        this.suspendedForHidden = true;
        void ctx.suspend().catch(() => undefined);
      }
    } else if (this.suspendedForHidden) {
      this.suspendedForHidden = false;
      void ctx.resume().catch((error: unknown) => console.warn('[audio] could not resume after the page became visible', error));
    }
  };

  private async loadAll(): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;
    const files = new Set<string>();
    for (const entry of [...Object.values(SFX_TABLE), ...Object.values(SHIM_TABLE)]) {
      if (entry) for (const file of entry.files) files.add(file);
    }
    const failures: string[] = [];
    await Promise.all(
      [...files].map(async (file) => {
        try {
          const response = await fetch(assetUrl(file));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.arrayBuffer();
          const buffer = await ctx.decodeAudioData(data);
          if (this.context === ctx) this.buffers.set(file, buffer);
        } catch (error) {
          failures.push(`${file} (${error instanceof Error ? error.message : String(error)})`);
        }
      }),
    );
    // One warning for the whole batch, never a throw: the game plays on without the missing sounds.
    if (failures.length > 0 && this.context === ctx) {
      console.warn(`[audio] ${failures.length} of ${files.size} sound files failed to load/decode: ${failures.join(', ')}`);
    }
  }
}
