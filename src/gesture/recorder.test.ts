import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from './bindings';
import { HeadInterpreter } from './headInterpreter';
import { MAX_RECORD_FRAMES, MAX_RECORD_SECONDS, parseTrack, TrackRecorder, trackFileName, type RecordedFrame } from './recorder';
import { replayHead } from './replay';
import type { FaceObservation, HandObservation, TrackFrame } from './protocol';

const DT = 1 / 30;

function face(shut: number): FaceObservation {
  const point = (x: number, y: number) => ({ x, y, z: 0 });
  return {
    nose: point(0.5, 0.48),
    cheekRight: point(0.35, 0.5),
    cheekLeft: point(0.65, 0.5),
    forehead: point(0.5, 0.3),
    chin: point(0.5, 0.7),
    blendshapes: { eyeBlinkLeft: shut, eyeBlinkRight: shut, mouthSmileLeft: 0.25 },
  };
}

function hand(i: number): HandObservation {
  return {
    landmarks: Array.from({ length: 21 }, (_, k) => ({ x: 0.4 + k * 0.01, y: 0.5 - i * 0.001, z: k * 0.001 })),
    handedness: 'Left',
    gesture: i % 2 === 0 ? 'Open_Palm' : 'None',
    gestureScore: 0.875,
  };
}

/** A synthetic result `i` at 30 results a second, starting at page time `start`. */
function trackFrame(i: number, start = 100): TrackFrame {
  return { t: start + i * DT, hands: i % 3 === 0 ? [] : [hand(i)], face: i % 5 === 0 ? null : face(i % 2 ? 0.9 : 0), inferMs: 12 };
}

/** The recorder's stored form of `trackFrame(i)`: time from the first frame, no worker timing. */
function expected(i: number): RecordedFrame {
  const { t, hands, face: observed } = trackFrame(i);
  return { t: t - 100, hands, face: observed };
}

describe('TrackRecorder', () => {
  it('round-trips through JSON to equal frames', () => {
    const recorder = new TrackRecorder('head-hand');
    recorder.start(new Date('2026-10-19T10:30:00Z'));
    const count = 45;
    for (let i = 0; i < count; i += 1) recorder.push(trackFrame(i));
    recorder.stop();

    const text = JSON.stringify(recorder);
    const file = JSON.parse(text) as unknown;
    expect(file).toMatchObject({ format: 'tiny-town-track', version: 1, startedAt: '2026-10-19T10:30:00.000Z', mode: 'head-hand' });

    const frames = parseTrack(file);
    const wanted = Array.from({ length: count }, (_, i) => expected(i));
    expect(frames).toEqual(wanted);
    expect(frames[0].t).toBe(0);
    expect(frames[0]).not.toHaveProperty('inferMs');
  });

  it('keeps copies, not the worker frames', () => {
    const recorder = new TrackRecorder('head');
    recorder.start();
    const live = trackFrame(1);
    recorder.push(live);
    if (live.face) live.face.nose.x = 0.99;
    expect(recorder.toJSON().frames[0].face?.nose.x).toBe(0.5);
  });

  it('stops at the time cap and keeps nothing past it', () => {
    const recorder = new TrackRecorder('hand');
    recorder.start();
    let pushed = 0;
    for (let i = 0; recorder.recording && i < 10_000; i += 1) {
      recorder.push(trackFrame(i));
      pushed += 1;
    }
    expect(recorder.recording).toBe(false);
    const frames = recorder.toJSON().frames;
    expect(frames[frames.length - 1].t).toBeLessThanOrEqual(MAX_RECORD_SECONDS);
    expect(frames[frames.length - 1].t).toBeGreaterThanOrEqual(MAX_RECORD_SECONDS - 1);
    // A later push after the cap changes nothing.
    recorder.push(trackFrame(pushed + 1));
    expect(recorder.toJSON().frames.length).toBe(frames.length);
  });

  it('stops at the frame cap when the results come faster than the time cap allows', () => {
    const recorder = new TrackRecorder('hand');
    recorder.start();
    for (let i = 0; i < MAX_RECORD_FRAMES + 500; i += 1) {
      recorder.push({ ...trackFrame(0), t: 100 + i / 60 });
      if (!recorder.recording) break;
    }
    expect(recorder.recording).toBe(false);
    expect(recorder.toJSON().frames.length).toBe(MAX_RECORD_FRAMES);
    expect(parseTrack(JSON.parse(JSON.stringify(recorder)))).toHaveLength(MAX_RECORD_FRAMES);
  });

  it('ignores frames before start and after stop', () => {
    const recorder = new TrackRecorder('hand');
    recorder.push(trackFrame(0));
    recorder.start();
    recorder.push(trackFrame(1));
    recorder.stop();
    recorder.push(trackFrame(2));
    expect(recorder.toJSON().frames).toHaveLength(1);
  });

  it('names the file by mode and local start time', () => {
    expect(trackFileName('head-hand', new Date(2026, 9, 5, 7, 4))).toBe('tiny-town-track-head-hand-20261005-0704.json');
  });
});

describe('parseTrack', () => {
  /** A file with one frame that has a hand and a face. */
  const good = (): Record<string, unknown> => {
    const recorder = new TrackRecorder('hand');
    recorder.start();
    recorder.push(trackFrame(1));
    return JSON.parse(JSON.stringify(recorder)) as Record<string, unknown>;
  };

  it('accepts a good file', () => {
    expect(parseTrack(good())).toHaveLength(1);
  });

  it('rejects anything that is not a track', () => {
    const rejects = (value: unknown, message: RegExp | string = /Not a Tiny Town track|Unsupported track version/) => expect(() => parseTrack(value)).toThrow(message);
    rejects(null);
    rejects('{"format":"tiny-town-track"}');
    rejects([]);
    rejects({ ...good(), format: 'something-else' });
    rejects({ ...good(), version: 2 }, /Unsupported track version 2/);
    rejects({ ...good(), startedAt: 12 });
    rejects({ ...good(), mode: 'keyboard' });
    rejects({ ...good(), frames: 'many' });
    rejects({ ...good(), frames: Array.from({ length: MAX_RECORD_FRAMES + 1 }, () => ({ t: 0, hands: [], face: null })) }, /limit/);
  });

  it('rejects malformed frames with the path to the bad value', () => {
    const file = good();
    const frames = file.frames as Array<Record<string, unknown>>;
    frames[0].t = Number.NaN;
    expect(() => parseTrack(file)).toThrow(/frames\[0\]\.t/);

    const short = good();
    ((short.frames as Array<Record<string, unknown>>)[0].hands as Array<Record<string, unknown>>)[0].landmarks = [{ x: 0, y: 0, z: 0 }];
    expect(() => parseTrack(short)).toThrow(/frames\[0\]\.hands\[0\]\.landmarks/);

    const shapes = good();
    (((shapes.frames as Array<Record<string, unknown>>)[0].face as Record<string, unknown>).blendshapes as Record<string, unknown>).eyeBlinkLeft = 'shut';
    expect(() => parseTrack(shapes)).toThrow(/blendshapes\.eyeBlinkLeft/);

    const backwards = good();
    const two = [{ t: 0.5, hands: [], face: null }, { t: 0.2, hands: [], face: null }];
    backwards.frames = two;
    expect(() => parseTrack(backwards)).toThrow(/frames\[1\]\.t/);
  });
});

describe('replayHead with the recorded slow blink', () => {
  it('one slow blink taps once, and the fixture parses', () => {
    const json = JSON.parse(readFileSync(new URL('./fixtures/slow-blink.track.json', import.meta.url), 'utf8')) as unknown;
    const frames = parseTrack(json);
    const interpreter = new HeadInterpreter();
    interpreter.configure(defaultSettings().bindings, null);
    const results = replayHead(frames, interpreter);
    expect(results).toHaveLength(frames.length);
    const taps = results.flatMap((frame, i) => (frame.tap ? [frames[i].t] : []));
    expect(taps).toHaveLength(1);
    // The eyes close at frame 22 and open again at frame 40: the click lands on re-opening (times are rounded in the file).
    expect(Math.abs(taps[0] - 40 * DT)).toBeLessThan(DT);
  });
});
