/**
 * The stadium crowd: one looping buffer whose gain the game sets every frame (match level × distance).
 *
 * Graph:  buffer source (loop) → gain → master
 *
 * The file is fetched and decoded the first time the crowd should be heard, never before Start. The
 * source runs only while the crowd is audible, so a silent town mixes nothing.
 */
import { assetUrl } from '../game/config';

export const CROWD_URL = '/assets/audio/stadium-crowd.mp3';
/** The file repeats after CROWD_PERIOD_S from here on (scripts/build-crowd.py), clear of the MP3's padding. */
export const CROWD_LOOP_START_S = 0.1;
export const CROWD_PERIOD_S = 28.5;
/** The file is at −23 LUFS; −6 dB puts the crowd at the stadium under placement sounds and just over the music. */
export const CROWD_TRIM = 0.5;
/** Applied while a menu is open, in dB (the music's duck). */
export const CROWD_DUCK_DB = -3;
/** setTargetAtTime time constant for gain changes (s). */
const RAMP_S = 0.15;
/** A gain change smaller than this is not worth a new ramp. */
const GAIN_STEP = 0.01;
/** The source stops this long after the gain was set to 0 (the ramp has died away). */
const STOP_AFTER_S = 1;

export interface CrowdState {
  /** 0..1 asked for by the game: match level × distance, before trim, duck and master. */
  level: number;
  /** The gain node's target. */
  gain: number;
  requested: boolean;
  loaded: boolean;
  playing: boolean;
  ducked: boolean;
  /** Loop sources started since boot. */
  starts: number;
}

/** 0..1 gain of the crowd for a `level` (match level × distance gain). */
export function crowdGain(level: number, ducked: boolean): number {
  const clamped = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  return clamped * CROWD_TRIM * (ducked ? 10 ** (CROWD_DUCK_DB / 20) : 1);
}

export class CrowdLoop {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private requested = false;
  private level = 0;
  private active = false;
  private ducked = false;
  /** The gain last handed to the node. */
  private applied = 0;
  private silentSince = 0;
  private starts = 0;
  private warned = false;

  constructor(private readonly url = CROWD_URL) {}

  attach(ctx: AudioContext, destination: AudioNode): void {
    if (this.gain) return;
    this.context = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(destination);
  }

  /** Active means not muted and visible. */
  setActive(active: boolean): void {
    this.active = active;
    this.apply();
  }

  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.apply();
  }

  /** Per frame: 0..1, match level × distance gain (0 = silent). No allocations while it is unchanged. */
  setLevel(level: number): void {
    this.level = level > 0 ? Math.min(1, level) : 0;
    this.apply();
  }

  get state(): CrowdState {
    return {
      level: this.level,
      gain: this.applied,
      requested: this.requested,
      loaded: this.buffer !== null,
      playing: this.source !== null,
      ducked: this.ducked,
      starts: this.starts,
    };
  }

  dispose(): void {
    this.stop();
    this.gain?.disconnect();
    this.gain = null;
    this.context = null;
    this.buffer = null;
  }

  private apply(): void {
    const ctx = this.context;
    const node = this.gain;
    if (!ctx || !node) return;
    const target = this.active ? crowdGain(this.level, this.ducked) : 0;
    if (target > 0) {
      if (!this.requested) void this.load(ctx);
      if (this.buffer && !this.source && ctx.state === 'running') this.start(ctx, node);
    }
    const audible = this.source !== null;
    const next = audible ? target : 0;
    if (next !== this.applied && (next === 0 || this.applied === 0 || Math.abs(next - this.applied) >= GAIN_STEP)) {
      node.gain.cancelScheduledValues(ctx.currentTime);
      node.gain.setTargetAtTime(next, ctx.currentTime, RAMP_S);
      this.applied = next;
      if (next === 0) this.silentSince = ctx.currentTime;
    }
    if (audible && this.applied === 0 && ctx.currentTime - this.silentSince >= STOP_AFTER_S) this.stop();
  }

  private start(ctx: AudioContext, node: GainNode): void {
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = CROWD_LOOP_START_S;
    source.loopEnd = CROWD_LOOP_START_S + CROWD_PERIOD_S;
    source.connect(node);
    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setValueAtTime(0, ctx.currentTime);
    this.applied = 0;
    source.start(0, CROWD_LOOP_START_S);
    this.source = source;
    this.starts += 1;
  }

  private stop(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    try {
      source.stop();
    } catch {
      // never started
    }
    source.disconnect();
  }

  private async load(ctx: AudioContext): Promise<void> {
    this.requested = true;
    try {
      const response = await fetch(assetUrl(this.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      if (this.context === ctx) this.buffer = buffer;
    } catch (error) {
      if (this.warned || this.context !== ctx) return;
      this.warned = true; // warn once; the game plays on without the crowd
      console.warn(`[audio] the stadium crowd failed to load (${this.url})`, error);
    }
  }
}
