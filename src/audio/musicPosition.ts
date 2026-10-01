/** Pure rules for the saved music position; SaveStore persists it and MusicPlayer applies it. */

export interface MusicPosition {
  /** MusicPlayer's url; a different track starts from 0. */
  track: string;
  /** Media time in s. */
  time: number;
}

/** Seconds before the end (the track's fade-out) inside which playback restarts from 0. */
export const RESUME_END_GUARD_S = 5;
/** Seconds of media time between periodic saves. */
export const MUSIC_SAVE_INTERVAL_S = 15;

export function parseMusicPosition(raw: unknown): MusicPosition | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { track, time } = raw as Record<string, unknown>;
  if (typeof track !== 'string' || track === '') return null;
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) return null;
  return { track, time };
}

/** Null means start from 0. */
export function resumeTimeFor(saved: MusicPosition | null, track: string): number | null {
  if (!saved || saved.track !== track || saved.time <= 0) return null;
  return saved.time;
}

export function canResumeAt(time: number, duration: number): boolean {
  return Number.isFinite(duration) && time < duration - RESUME_END_GUARD_S;
}

/** True after MUSIC_SAVE_INTERVAL_S of media time, or after a loop wrap. */
export function shouldPeriodicSave(time: number, lastSaved: number): boolean {
  return Math.abs(time - lastSaved) >= MUSIC_SAVE_INTERVAL_S;
}
