/**
 * Music resume (WP-18): pure rules for the saved music position. No DOM, no storage; SaveStore
 * persists the record under MUSIC_POSITION_STORAGE_KEY and MusicPlayer applies it.
 *
 * - The record is `{ track, time }`: the track URL (a different or replaced track starts from 0)
 *   and the media time in s.
 * - The end guard is checked against the element's real `duration` when the metadata is known,
 *   so no track length is hard-coded here.
 */

export interface MusicPosition {
  /** Track id (MusicPlayer's url). */
  track: string;
  /** Media time in s, ≥ 0. */
  time: number;
}

/** Don't resume this close to the end (the track's built-in fade-out); start from 0 instead. */
export const RESUME_END_GUARD_S = 5;
/** While playing, save the position at most once per this much media time (s). */
export const MUSIC_SAVE_INTERVAL_S = 15;

/** A valid MusicPosition from untrusted JSON-parsed data, else null. */
export function parseMusicPosition(raw: unknown): MusicPosition | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { track, time } = raw as Record<string, unknown>;
  if (typeof track !== 'string' || track === '') return null;
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) return null;
  return { track, time };
}

/** The time to resume `track` from, or null to start from 0 (nothing saved, or another track). */
export function resumeTimeFor(saved: MusicPosition | null, track: string): number | null {
  if (!saved || saved.track !== track || saved.time <= 0) return null;
  return saved.time;
}

/** Whether `time` is far enough from the end of a track of `duration` s to seek to. */
export function canResumeAt(time: number, duration: number): boolean {
  return Number.isFinite(duration) && time < duration - RESUME_END_GUARD_S;
}

/** Periodic save while playing: after MUSIC_SAVE_INTERVAL_S of media time, or after a loop wrap. */
export function shouldPeriodicSave(time: number, lastSaved: number): boolean {
  return Math.abs(time - lastSaved) >= MUSIC_SAVE_INTERVAL_S;
}
