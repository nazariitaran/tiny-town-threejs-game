/**
 * Background music (WP-13): one looping track, STREAMED through an HTMLAudioElement →
 * MediaElementAudioSourceNode, so the 585 s file is never decoded into an AudioBuffer and is not
 * part of the initial download (the element gets its `src` only on the first `start()`, which
 * AudioManager calls from the Start/Continue gesture).
 *
 * Graph:  <audio> → source → fade (fade-in / on-off / loop fade) → bus (musicVolume × trim × duck) → master
 *
 * - Fade-in FADE_IN_S on start and on every loop wrap; a short fade-out just before the loop point.
 * - `setDucked(true)` lowers the bus by DUCK_DB (a menu is open).
 * - `setActive(false)` (music off, master mute, hidden page) fades out and pauses the element, so a
 *   muted or hidden game doesn't keep decoding; `setActive(true)` resumes where it left off.
 * - Resume across visits (WP-18): the first start reads the saved `{ track, time }` from the
 *   MusicPositionPort and seeks there on `loadedmetadata` (before any sound, so no audible jump), unless
 *   it is within RESUME_END_GUARD_S of the real duration. `savePosition()` (AudioManager calls it when
 *   the page is hidden or unloaded) and a periodic save every MUSIC_SAVE_INTERVAL_S of playback store it.
 */
import { assetUrl } from '../game/config';
import { canResumeAt, resumeTimeFor, shouldPeriodicSave, type MusicPosition } from './musicPosition';

export const MUSIC_URL = '/assets/music/foundation-of-gold.mp3';
/** Fade-in time on start/resume/loop wrap (s). */
export const MUSIC_FADE_IN_S = 2.5;
/** Fade-out before the loop point and when switching off (s). */
export const MUSIC_FADE_OUT_S = 0.6;
/** Menu duck, in dB. */
export const MUSIC_DUCK_DB = -3;
/**
 * Fixed trim under musicVolume. The master is −13 LUFS integrated (loud), SFX one-shots are ~−25 LUFS;
 * trim 0.25 (−12 dB) keeps music at the default musicVolume 0.5 roughly 14–16 dB under placement sounds.
 */
export const MUSIC_TRIM = 0.25;
/** Start the loop-point fade-out this many seconds before the end of the track. */
const LOOP_FADE_LEAD_S = 1.2;
/** Time constant for bus (volume/duck) changes (s). */
const BUS_RAMP_S = 0.12;

export interface MusicState {
  /** Player setting: music on. */
  enabled: boolean;
  /** Player setting 0..1. */
  volume: number;
  /** The element is playing (not paused) — false while off, muted, hidden or not started yet. */
  playing: boolean;
  /** Enough data is buffered to play (readyState ≥ HAVE_FUTURE_DATA was reached). */
  loaded: boolean;
  /** `src` was assigned, i.e. the stream was requested. */
  requested: boolean;
  ducked: boolean;
  /** Media time in s (tests assert it advances). */
  time: number;
  /** Number of times the loop wrapped. */
  loops: number;
  /** Media time this visit resumed from (WP-18), or null when it started from 0. */
  resumedFrom: number | null;
}

/** Where the music position is persisted (SaveStore matches it). Missing methods = no persistence. */
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
  /** Saved time to seek to once the metadata is known (read on the first start). */
  private resumeAt: number | null = null;
  private resumedFrom: number | null = null;
  /** Media time of the last save, for the periodic save. */
  private lastSavedTime = 0;

  constructor(
    private enabled: boolean,
    private volume: number,
    private readonly url = MUSIC_URL,
    private readonly positions: Partial<MusicPositionPort> = {},
  ) {}

  /** Build the graph under `destination`. Call once, after the AudioContext exists. */
  attach(ctx: AudioContext, destination: AudioNode): void {
    if (this.bus) return;
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.bus = ctx.createGain();
    this.bus.gain.value = this.busTarget();
    this.fade.connect(this.bus).connect(destination);
  }

  /** Whether the music should be sounding (enabled && not muted && visible). Call from a gesture the first time. */
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

  /**
   * Store the current position for the next visit. Skipped until the stream has played (a tab closed
   * while the resumed stream is still buffering must not overwrite a good position with 0) and while seeking.
   */
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
        this.rampFade(0, 0); // start silent, then fade in
        el.play().then(
          () => {
            if (this.enabled && this.active) this.rampFade(1, MUSIC_FADE_IN_S);
          },
          (error: unknown) => {
            // AbortError = a pause() (off/mute/hide) overtook this play(); not a failure.
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

  /** Linear ramp of the fade gain to `target` over `seconds` (0 = immediate). */
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

  /** Resume seek (WP-18). Runs before the first sample plays, so there is no audible jump. */
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
    if (this.warned) return; // one warning, never a throw; the game plays on silently
    this.warned = true;
    console.warn(`[audio] ${message}`, ...(error === undefined ? [] : [error]));
  }
}
