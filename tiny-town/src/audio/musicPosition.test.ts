import { describe, expect, it } from 'vitest';
import { MUSIC_SAVE_INTERVAL_S, RESUME_END_GUARD_S, canResumeAt, parseMusicPosition, resumeTimeFor, shouldPeriodicSave } from './musicPosition';

const TRACK = '/assets/music/foundation-of-gold.mp3';

describe('parseMusicPosition', () => {
  it('accepts a valid record and drops extra fields', () => {
    expect(parseMusicPosition({ track: TRACK, time: 123.4, extra: 1 })).toEqual({ track: TRACK, time: 123.4 });
    expect(parseMusicPosition({ track: TRACK, time: 0 })).toEqual({ track: TRACK, time: 0 });
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['a string', 'x'],
    ['an array', [TRACK, 1]],
    ['no track', { time: 10 }],
    ['an empty track', { track: '', time: 10 }],
    ['a numeric track', { track: 7, time: 10 }],
    ['no time', { track: TRACK }],
    ['a string time', { track: TRACK, time: '10' }],
    ['NaN', { track: TRACK, time: Number.NaN }],
    ['Infinity', { track: TRACK, time: Number.POSITIVE_INFINITY }],
    ['a negative time', { track: TRACK, time: -1 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseMusicPosition(raw)).toBeNull();
  });
});

describe('resumeTimeFor', () => {
  it('resumes the same track from its saved time', () => {
    expect(resumeTimeFor({ track: TRACK, time: 300 }, TRACK)).toBe(300);
  });

  it('starts from 0 with nothing saved, another track, or time 0', () => {
    expect(resumeTimeFor(null, TRACK)).toBeNull();
    expect(resumeTimeFor({ track: '/assets/music/other.mp3', time: 300 }, TRACK)).toBeNull();
    expect(resumeTimeFor({ track: TRACK, time: 0 }, TRACK)).toBeNull();
  });
});

describe('canResumeAt', () => {
  const duration = 585.05;

  it('resumes anywhere before the end guard', () => {
    expect(canResumeAt(0.5, duration)).toBe(true);
    expect(canResumeAt(duration - RESUME_END_GUARD_S - 0.01, duration)).toBe(true);
  });

  it('starts from 0 inside the end guard, past the end, or with an unknown duration', () => {
    expect(canResumeAt(duration - RESUME_END_GUARD_S, duration)).toBe(false);
    expect(canResumeAt(duration - 1, duration)).toBe(false);
    expect(canResumeAt(duration + 10, duration)).toBe(false);
    expect(canResumeAt(10, Number.NaN)).toBe(false);
    expect(canResumeAt(10, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('shouldPeriodicSave', () => {
  it('saves once per interval of media time', () => {
    expect(shouldPeriodicSave(MUSIC_SAVE_INTERVAL_S - 0.1, 0)).toBe(false);
    expect(shouldPeriodicSave(MUSIC_SAVE_INTERVAL_S, 0)).toBe(true);
    expect(shouldPeriodicSave(300 + MUSIC_SAVE_INTERVAL_S, 300)).toBe(true);
  });

  it('saves right after a loop wrap', () => {
    expect(shouldPeriodicSave(0.3, 580)).toBe(true);
  });
});
