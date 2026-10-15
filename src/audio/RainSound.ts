/**
 * Rain and thunder, synthesised: no files.
 *
 * Graph:  noise (loop) → highpass → lowpass → hiss gain ─┐
 *         noise (loop) → bandpass ──────────→ body gain ─┼→ gain → master
 *         thunder (one shot) → lowpass → envelope ───────┘
 *
 * The hiss carries light rain; the body (a low roar) comes in as the rain gets heavy. The sources run
 * only while rain is audible.
 */
import { createSeededRandom } from '../utils/random';

/** Rain at full strength, against the master. */
export const RAIN_TRIM = 0.2;
export const THUNDER_TRIM = 0.9;
/** Applied while a menu is open, in dB (the music's duck). */
const DUCK_DB = -3;
const RAMP_S = 0.4;
const GAIN_STEP = 0.01;
const STOP_AFTER_S = 2;
const NOISE_S = 3;
const NOISE_SEED = 0x7a1d;

export interface RainSoundState {
  level: number;
  gain: number;
  playing: boolean;
  /** Thunderclaps started since boot. */
  thunders: number;
}

export class RainSound {
  private context: AudioContext | null = null;
  private out: GainNode | null = null;
  private master: AudioNode | null = null;
  private hiss: GainNode | null = null;
  private body: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private level = 0;
  private active = false;
  private ducked = false;
  private applied = 0;
  private silentSince = 0;
  private thunders = 0;

  attach(ctx: AudioContext, destination: AudioNode): void {
    if (this.out) return;
    this.context = ctx;
    this.master = destination;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    const random = createSeededRandom(NOISE_SEED);
    const length = Math.floor(ctx.sampleRate * NOISE_S);
    this.white = ctx.createBuffer(1, length, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, length, ctx.sampleRate);
    const white = this.white.getChannelData(0);
    const brown = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const sample = random() * 2 - 1;
      white[i] = sample;
      last = (last + 0.02 * sample) / 1.02;
      brown[i] = last * 3.5;
    }
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

  /** Per frame: 0..1 rain strength (0 = silent). */
  setLevel(level: number): void {
    this.level = level > 0 ? Math.min(1, level) : 0;
    this.apply();
  }

  /** A thunderclap `delay` seconds from now, `strength` 0..1 (1 = overhead: a crack, then the roll). */
  thunder(delay: number, strength: number): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.brown || !this.active || ctx.state !== 'running') return;
    const at = ctx.currentTime + Math.max(0, delay);
    const long = 3.5 + 2.5 * (1 - strength);
    const peak = THUNDER_TRIM * (0.35 + 0.65 * strength);
    const roll = ctx.createBufferSource();
    roll.buffer = this.brown;
    roll.loop = true;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    // A near strike is brighter; every clap dulls as it rolls away.
    tone.frequency.setValueAtTime(220 + 900 * strength, at);
    tone.frequency.exponentialRampToValueAtTime(70, at + long);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(peak, at + 0.04 + 0.25 * (1 - strength));
    envelope.gain.exponentialRampToValueAtTime(peak * 0.35, at + 0.9);
    envelope.gain.linearRampToValueAtTime(peak * 0.5, at + 1.5);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + long);
    // Past the rain's own gain, so a clap is as loud in light rain as in heavy.
    roll.connect(tone).connect(envelope).connect(this.master);
    roll.onended = () => envelope.disconnect();
    roll.start(at, (this.thunders * 0.37) % NOISE_S);
    roll.stop(at + long + 0.1);
    this.thunders += 1;
  }

  get state(): RainSoundState {
    return { level: this.level, gain: this.applied, playing: this.sources.length > 0, thunders: this.thunders };
  }

  dispose(): void {
    this.stop();
    this.out?.disconnect();
    this.out = null;
    this.master = null;
    this.context = null;
    this.white = null;
    this.brown = null;
  }

  private apply(): void {
    const ctx = this.context;
    const node = this.out;
    if (!ctx || !node) return;
    const target = this.active ? this.level * RAIN_TRIM * (this.ducked ? 10 ** (DUCK_DB / 20) : 1) : 0;
    if (target > 0 && this.sources.length === 0 && ctx.state === 'running') this.start(ctx, node);
    const audible = this.sources.length > 0;
    const next = audible ? target : 0;
    if (next !== this.applied && (next === 0 || this.applied === 0 || Math.abs(next - this.applied) >= GAIN_STEP)) {
      node.gain.cancelScheduledValues(ctx.currentTime);
      node.gain.setTargetAtTime(next, ctx.currentTime, RAMP_S);
      // Heavier rain is brighter and has more body.
      this.lowpass?.frequency.setTargetAtTime(2600 + 5200 * this.level, ctx.currentTime, RAMP_S);
      this.body?.gain.setTargetAtTime(0.25 + 1.6 * this.level * this.level, ctx.currentTime, RAMP_S);
      this.applied = next;
      if (next === 0) this.silentSince = ctx.currentTime;
    }
    if (audible && this.applied === 0 && ctx.currentTime - this.silentSince >= STOP_AFTER_S) this.stop();
  }

  private start(ctx: AudioContext, node: GainNode): void {
    const hissSource = ctx.createBufferSource();
    hissSource.buffer = this.white;
    hissSource.loop = true;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 900;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 4000;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0.5;
    hissSource.connect(highpass).connect(this.lowpass).connect(this.hiss).connect(node);

    const bodySource = ctx.createBufferSource();
    bodySource.buffer = this.white;
    bodySource.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.6;
    this.body = ctx.createGain();
    this.body.gain.value = 0.25;
    bodySource.connect(band).connect(this.body).connect(node);

    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setValueAtTime(0, ctx.currentTime);
    this.applied = 0;
    hissSource.start();
    // Off the hiss's phase, so the two layers never line up.
    bodySource.start(0, NOISE_S / 2);
    this.sources = [hissSource, bodySource];
  }

  private stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // never started
      }
      source.disconnect();
    }
    this.sources = [];
    this.hiss?.disconnect();
    this.body?.disconnect();
    this.hiss = null;
    this.body = null;
    this.lowpass = null;
  }
}
