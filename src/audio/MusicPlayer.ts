/**
 * Background music: one looping track streamed through an <audio> element, so the long file is never
 * decoded into an AudioBuffer and isn't requested before the music first plays.
 *
 * Graph:  <audio> → source → fade → bus (musicVolume × trim × duck) → master
 *
 * Going inactive fades out and pauses the element, so a muted or hidden game doesn't keep decoding.
 */
import { assetUrl } from '../game/config';
import { canResumeAt, resumeTimeFor, shouldPeriodicSave, type MusicPosition } from './musicPosition';

export const MUSIC_URL = '/assets/music/foundation-of-gold.mp3';
/** Seconds; on start, resume and loop wrap. */
export const MUSIC_FADE_IN_S = 2.5;
/** Seconds; before the loop point and when switching off. */
export const MUSIC_FADE_OUT_S = 0.6;
/** Applied while a menu is open, in dB. */
export const MUSIC_DUCK_DB = -3;
/** The track is mastered at −13 LUFS, SFX at ~−25; −12 dB keeps default-volume music ~15 dB under placement sounds. */
export const MUSIC_TRIM = 0.25;
/** Seconds before the track's end at which the loop fade-out starts. */
const LOOP_FADE_LEAD_S = 1.2;
/** setTargetAtTime time constant for volume/duck changes (s). */
const BUS_RAMP_S = 0.12;

export interface MusicState {
  enabled: boolean;
  /** 0..1. */
  volume: number;
  playing: boolean;
  /** canplay has fired. */
  loaded: boolean;
  requested: boolean;
  ducked: boolean;
  /** Media time in s. */
  time: number;
  loops: number;
  /** Null when playback started from 0. */
  resumedFrom: number | null;
}

/** SaveStore implements it; a missing method means no persistence. */
export interface MusicPositionPort {
  getMusicPosition(): MusicPosition | null;
  setMusicPosition(position: MusicPosition): unknown;
}

export class MusicPlayer {
  private element: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private fade: GainNode | null = null;
  private bus: GainNode | null = null;
  private loaded = false;
  private active = false;
  private ducked = false;
  private loops = 0;
  private lastTime = 0;
  private loopFading = false;
  private pauseTimer = 0;
  private warned = false;
  /** Seek target applied on loadedmetadata. */
  private resumeAt: number | null = null;
  private resumedFrom: number | null = null;
  private lastSavedTime = 0;

  constructor(
    private enabled: boolean,
    private volume: number,
    private readonly url = MUSIC_URL,
    private readonly positions: Partial<MusicPositionPort> = {},
  ) {}

  attach(ctx: AudioContext, destination: AudioNode): void {
    if (this.bus) return;
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.bus = ctx.createGain();
    this.bus.gain.value = this.busTarget();
    this.fade.connect(this.bus).connect(destination);
  }

  /** Active means not muted and visible. Call from a user gesture the first time. */
  setActive(active: boolean): void {
    this.active = active;
    this.update();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.update();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.rampBus();
  }

  setDucked(ducked: boolean): void {
    if (ducked === this.ducked) return;
    this.ducked = ducked;
    this.rampBus();
  }

  get state(): MusicState {
    const el = this.element;
    return {
      enabled: this.enabled,
      volume: this.volume,
      playing: !!el && !el.paused,
      loaded: this.loaded,
      requested: !!el,
      ducked: this.ducked,
      time: el ? el.currentTime : 0,
      loops: this.loops,
      resumedFrom: this.resumedFrom,
    };
  }

  /** Skipped while seeking and until the stream has loaded, so a tab closed mid-buffering can't overwrite a good position with 0. */
  savePosition(): void {
    const el = this.element;
    if (!el || !this.loaded || el.seeking || !this.positions.setMusicPosition) return;
    this.lastSavedTime = el.currentTime;
    this.positions.setMusicPosition({ track: this.url, time: el.currentTime });
  }

  dispose(): void {
    window.clearTimeout(this.pauseTimer);
    const el = this.element;
    if (el) {
      el.pause();
      el.removeEventListener('timeupdate', this.onTimeUpdate);
      el.removeEventListener('loadedmetadata', this.onLoadedMetadata);
      el.removeEventListener('canplay', this.onCanPlay);
      el.removeEventListener('error', this.onError);
      el.removeAttribute('src');
      el.load(); // abort the stream
    }
    this.source?.disconnect();
    this.fade?.disconnect();
    this.bus?.disconnect();
    this.element = null;
    this.source = null;
    this.fade = null;
    this.bus = null;
  }

  private get context(): BaseAudioContext | null {
    return this.bus?.context ?? null;
  }

  private busTarget(): number {
    return this.volume * MUSIC_TRIM * (this.ducked ? 10 ** (MUSIC_DUCK_DB / 20) : 1);
  }

  private rampBus(): void {
    const ctx = this.context;
    if (!ctx || !this.bus) return;
    const param = this.bus.gain;
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(this.busTarget(), ctx.currentTime, BUS_RAMP_S);
  }

  private update(): void {
    const ctx = this.context;
    if (!ctx || !this.fade) return;
    const shouldPlay = this.enabled && this.active;
    window.clearTimeout(this.pauseTimer);
    if (shouldPlay) {
      const el = this.ensureElement(ctx as AudioContext);
      if (el.paused) {
        this.rampFade(0, 0);
        el.play().then(
          () => {
            if (this.enabled && this.active) this.rampFade(1, MUSIC_FADE_IN_S);
          },
          (error: unknown) => {
            // AbortError: a pause() overtook this play().
            if (!(error instanceof DOMException && error.name === 'AbortError')) this.warn('could not start music', error);
          },
        );
      } else {
        this.rampFade(1, MUSIC_FADE_IN_S);
      }
    } else if (this.element && !this.element.paused) {
      this.rampFade(0, MUSIC_FADE_OUT_S);
      const el = this.element;
      this.pauseTimer = window.setTimeout(() => el.pause(), MUSIC_FADE_OUT_S * 1000 + 50);
    }
  }

  private rampFade(target: number, seconds: number): void {
    const ctx = this.context;
    if (!ctx || !this.fade) return;
    const param = this.fade.gain;
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    if (seconds <= 0) {
      param.setValueAtTime(target, now);
      return;
    }
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + seconds);
  }

  private ensureElement(ctx: AudioContext): HTMLAudioElement {
    if (this.element) return this.element;
    const el = new Audio();
    el.preload = 'auto';
    el.loop = true;
    this.resumeAt = resumeTimeFor(this.positions.getMusicPosition?.() ?? null, this.url);
    if (this.resumeAt !== null) el.addEventListener('loadedmetadata', this.onLoadedMetadata, { once: true });
    el.addEventListener('timeupdate', this.onTimeUpdate);
    el.addEventListener('canplay', this.onCanPlay);
    el.addEventListener('error', this.onError);
    el.src = assetUrl(this.url);
    this.element = el;
    this.source = ctx.createMediaElementSource(el);
    this.source.connect(this.fade!);
    return el;
  }

  /** Runs before the first sample plays, so the resume seek is inaudible. */
  private readonly onLoadedMetadata = (): void => {
    const el = this.element;
    const at = this.resumeAt;
    this.resumeAt = null;
    if (!el || at === null || !canResumeAt(at, el.duration)) return;
    el.currentTime = at;
    this.resumedFrom = at;
    this.lastTime = at;
    this.lastSavedTime = at;
  };

  private readonly onCanPlay = (): void => {
    this.loaded = true;
  };

  private readonly onError = (): void => {
    const code = this.element?.error?.code;
    this.warn(`music stream failed (${this.url}, MediaError ${code ?? '?'})`);
  };

  /** ~4 Hz: fade out just before the loop point, fade back in after the wrap. */
  private readonly onTimeUpdate = (): void => {
    const el = this.element;
    if (!el) return;
    const t = el.currentTime;
    const duration = el.duration;
    if (t + 0.5 < this.lastTime) {
      this.loops += 1;
      this.loopFading = false;
      if (this.enabled && this.active) this.rampFade(1, MUSIC_FADE_IN_S);
    } else if (!this.loopFading && Number.isFinite(duration) && duration - t < LOOP_FADE_LEAD_S) {
      this.loopFading = true;
      this.rampFade(0, Math.max(0.1, duration - t - 0.1));
    }
    this.lastTime = t;
    if (!el.paused && shouldPeriodicSave(t, this.lastSavedTime)) this.savePosition();
  };

  private warn(message: string, error?: unknown): void {
    if (this.warned) return; // warn once; the game plays on silently
    this.warned = true;
    console.warn(`[audio] ${message}`, ...(error === undefined ? [] : [error]));
  }
}
