/**
 * Web Audio SFX and music: unlocks on the first user gesture, decodes every file in SFX_TABLE, and plays
 * with variant pools, pitch jitter, per-event cooldowns and ui/sfx groups under one master gain.
 * Music and the stadium crowd are attached in unlock(), so nothing is fetched before Start. The context is
 * suspended while the page is hidden.
 */
import { assetUrl } from '../game/config';
import type { GameBus } from '../game/events';
import type { SfxEvent } from './sfx';
import { SFX_TABLE } from './sfxTable';
import { CrowdLoop, type CrowdState } from './CrowdLoop';
import { MusicPlayer, type MusicPositionPort, type MusicState } from './MusicPlayer';
import type { ToolId } from '../catalog/tools';
import { toolDef } from '../catalog/tools';

type Group = 'ui' | 'sfx';

export interface AudioSettings {
  muted: boolean;
  volume: number;
  music: boolean;
  /** 0..1. */
  musicVolume: number;
}

/** SaveStore satisfies it structurally. */
export interface SettingsPort extends Partial<MusicPositionPort> {
  getSettings(): Partial<AudioSettings>;
  setSettings(patch: Partial<AudioSettings>): unknown;
}

/** Minimum gap between place/remove sounds, so drag-painting never machine-guns. */
export const BUILD_SOUND_GAP_MS = 60;
/** Playback-rate rise per consecutive placement in one stroke. */
export const STROKE_PITCH_STEP = 0.02;
/** Caps the stroke pitch rise so long strokes don't squeak. */
export const STROKE_PITCH_MAX = 0.4;
/** Pitch jitter multiplier for placements after the first in a stroke. */
const STROKE_JITTER_SCALE = 0.35;
const DEFAULT_SETTINGS: AudioSettings = { muted: false, volume: 0.8, music: true, musicVolume: 0.5 };
/** Master-gain ramp time constant (s), so mute/volume changes don't click. */
const GAIN_RAMP_S = 0.015;

/** Removal pitch by layer: objects sound heavier, ground tiles lighter. */
const REMOVE_RATE: Record<'ground' | 'object' | 'edge', number> = { ground: 1.06, object: 0.92, edge: 1 };

const memorySettings: SettingsPort = {
  getSettings: () => ({}),
  setSettings: () => undefined,
};

const clamp01 = (value: number, fallback: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback);

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly groups = new Map<Group, GainNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<SfxEvent, number>();
  private readonly unsubscribers: Array<() => void> = [];
  private muted: boolean;
  private volume: number;
  private starts = 0;
  private lastBuildSoundAt = -Infinity;
  private suspendedForHidden = false;
  private loading: Promise<void> | null = null;
  private readonly music: MusicPlayer;
  private readonly crowd = new CrowdLoop();

  constructor(
    private readonly bus: GameBus,
    private readonly rng: () => number,
    private readonly settings: SettingsPort = memorySettings,
  ) {
    const stored = { ...DEFAULT_SETTINGS, ...settings.getSettings() };
    this.muted = stored.muted;
    this.volume = stored.volume;
    this.music = new MusicPlayer(stored.music, clamp01(stored.musicVolume, DEFAULT_SETTINGS.musicVolume), undefined, settings);

    const on = bus.on.bind(bus);
    this.unsubscribers.push(
      on('ui:sfx', ({ event }) => this.play(event)),
      on('build:placed', ({ toolId, strokeIndex }) =>
        this.playBuild(
          this.placeEventFor(toolId),
          1 + Math.min(STROKE_PITCH_MAX, strokeIndex * STROKE_PITCH_STEP),
          // less jitter inside a stroke, so the pitch steps read as a rising run
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
      bus.on('intent:set-music', ({ enabled }) => this.setMusicEnabled(enabled)),
      bus.on('intent:set-music-volume', ({ volume }) => this.setMusicVolume(volume)),
      // The menu phase includes overlays opened from the menu.
      on('phase:changed', ({ phase }) => {
        this.music.setDucked(phase === 'menu');
        this.crowd.setDucked(phase === 'menu');
      }),
    );
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
    // Game builds the UI after the AudioManager; announce the stored settings once it's listening.
    queueMicrotask(() => {
      if (this.unsubscribers.length > 0) this.announce();
    });
  }

  /** Must be called from a user gesture handler. */
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
      this.music.attach(this.context, this.master);
      this.crowd.attach(this.context, this.master);
    }
    // Still inside the gesture, so play() is allowed.
    this.syncMusic();
    if (this.context.state !== 'running' && !document.hidden) {
      try {
        await this.context.resume();
      } catch (error) {
        console.warn('[audio] could not resume the AudioContext', error);
      }
    }
  }

  play(event: SfxEvent, rate = 1, jitterScale = 1): void {
    const ctx = this.context;
    const entry = SFX_TABLE[event];
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
    source.playbackRate.value = rate * (entry.playbackRate ?? 1) * jitter;
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
    this.syncMusic();
    this.settings.setSettings({ muted });
    this.announce();
  }

  setMusicEnabled(enabled: boolean): void {
    this.music.setEnabled(enabled);
    this.syncMusic();
    this.settings.setSettings({ music: enabled });
    this.announce();
  }

  setMusicVolume(volume: number): void {
    const next = clamp01(volume, this.music.state.volume);
    this.music.setVolume(next);
    this.settings.setSettings({ musicVolume: next });
    this.announce();
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : this.volume;
    this.applyVolume();
    this.settings.setSettings({ volume: this.volume });
    this.announce();
  }

  /** Per frame: how loud the stadium crowd is, 0..1 (match level × distance); 0 = silent. */
  setCrowdLevel(level: number): void {
    this.crowd.setLevel(level);
  }

  get state(): { muted: boolean; volume: number; unlocked: boolean; loaded: number; starts: number; music: MusicState; crowd: CrowdState } {
    return {
      muted: this.muted,
      volume: this.volume,
      unlocked: this.context?.state === 'running',
      loaded: this.buffers.size,
      starts: this.starts,
      music: this.music.state,
      crowd: this.crowd.state,
    };
  }

  /** Resolves once every file has been decoded or has failed. */
  whenLoaded(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
    this.music.dispose();
    this.crowd.dispose();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.groups.clear();
    this.buffers.clear();
  }

  private playBuild(event: SfxEvent, rate: number, jitterScale = 1): void {
    const now = performance.now();
    if (now - this.lastBuildSoundAt < BUILD_SOUND_GAP_MS) return;
    const before = this.starts;
    this.play(event, rate, jitterScale);
    if (this.starts !== before) this.lastBuildSoundAt = now;
  }

  private placeEventFor(toolId: ToolId): SfxEvent {
    return toolDef(toolId).sfx;
  }

  private announce(): void {
    this.bus.emit('audio:changed', { muted: this.muted, volume: this.volume });
    const { enabled, volume } = this.music.state;
    this.bus.emit('music:changed', { enabled, volume });
  }

  private syncMusic(): void {
    if (!this.context) return;
    this.music.setActive(!this.muted && !document.hidden);
    this.crowd.setActive(!this.muted && !document.hidden);
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
      this.music.savePosition();
      if (ctx.state === 'running') {
        this.suspendedForHidden = true;
        this.syncMusic();
        void ctx.suspend().catch(() => undefined);
      }
    } else if (this.suspendedForHidden) {
      this.suspendedForHidden = false;
      this.syncMusic();
      void ctx.resume().catch((error: unknown) => console.warn('[audio] could not resume after the page became visible', error));
    }
  };

  /** Backup for `visibilitychange` (bfcache, iOS). */
  private readonly onPageHide = (): void => this.music.savePosition();

  private async loadAll(): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;
    const files = new Set<string>();
    for (const entry of Object.values(SFX_TABLE)) for (const file of entry.files) files.add(file);
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
    // One warning for the whole batch; the game plays on without the missing sounds.
    if (failures.length > 0 && this.context === ctx) {
      console.warn(`[audio] ${failures.length} of ${files.size} sound files failed to load/decode: ${failures.join(', ')}`);
    }
  }
}
