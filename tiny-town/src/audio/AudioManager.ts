/**
 * Web Audio SFX manager: unlock on first user gesture, decode files from SFX_TABLE,
 * play with variant pools, pitch jitter, per-event cooldowns and ui/sfx groups.
 *
 * SCAFFOLD STUB — WP-07 (Audio) owns this file. Baseline plays sounds; TODO(WP-07):
 * persist mute/volume (SETTINGS_STORAGE_KEY), pause on page hidden, drag-paint
 * rate limiting, pitch rise for consecutive placements in one stroke, decode error surfacing.
 */
import { assetUrl } from '../game/config';
import type { GameBus } from '../game/events';
import type { SfxEvent } from './sfx';
import { SFX_TABLE } from './sfxTable';
import type { ToolId } from '../catalog/tools';
import { toolDef } from '../catalog/tools';

type Group = 'ui' | 'sfx';

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly groups = new Map<Group, GainNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<SfxEvent, number>();
  private readonly unsubscribers: Array<() => void> = [];
  private muted = false;
  /** Buffer sources started since boot (diagnostics: audio.starts). */
  private starts = 0;
  private volume = 0.8;

  constructor(
    private readonly bus: GameBus,
    private readonly rng: () => number,
  ) {
    const on = bus.on.bind(bus);
    this.unsubscribers.push(
      on('ui:sfx', ({ event }) => this.play(event)),
      on('build:placed', ({ toolId }) => this.play(this.placeEventFor(toolId))),
      on('build:removed', () => this.play('remove')),
      on('build:invalid', () => this.play('invalid')),
      on('build:rotated', () => this.play('rotate')),
      on('intent:undo', () => this.play('undo')),
      on('intent:redo', () => this.play('redo')),
      on('intent:set-muted', ({ muted }) => this.setMuted(muted)),
      on('intent:set-volume', ({ volume }) => this.setVolume(volume)),
    );
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
      this.applyVolume();
      void this.loadAll();
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  play(event: SfxEvent): void {
    const entry = SFX_TABLE[event];
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !entry) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(event) ?? -Infinity) < entry.cooldownMs) return;
    const file = entry.files[Math.floor(this.rng() * entry.files.length)];
    const buffer = this.buffers.get(file);
    if (!buffer) return;
    this.lastPlayed.set(event, now);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (this.rng() * 2 - 1) * entry.pitchJitter;
    const gain = ctx.createGain();
    gain.gain.value = entry.volume;
    source.connect(gain).connect(this.groups.get(entry.group) ?? ctx.destination);
    source.start();
    this.starts += 1;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
    this.bus.emit('audio:changed', { muted: this.muted, volume: this.volume });
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
    this.bus.emit('audio:changed', { muted: this.muted, volume: this.volume });
  }

  get state(): { muted: boolean; volume: number; unlocked: boolean; loaded: number; starts: number } {
    return { muted: this.muted, volume: this.volume, unlocked: this.context?.state === 'running', loaded: this.buffers.size, starts: this.starts };
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    void this.context?.close();
    this.context = null;
  }

  private placeEventFor(toolId: ToolId): SfxEvent {
    return toolDef(toolId).sfx;
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private async loadAll(): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;
    const files = new Set(Object.values(SFX_TABLE).flatMap((entry) => entry.files));
    await Promise.all(
      [...files].map(async (file) => {
        try {
          const data = await fetch(assetUrl(file)).then((r) => r.arrayBuffer());
          this.buffers.set(file, await ctx.decodeAudioData(data));
        } catch (error) {
          console.warn(`[audio] failed to load ${file}`, error);
        }
      }),
    );
  }
}
