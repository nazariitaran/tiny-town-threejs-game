import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings, PRESETS } from './bindings';
import { headAngles } from './faceAngles';
import { HeadInterpreter } from './headInterpreter';
import { DEFAULT_HEAD_POINTER, directTarget, HeadPointer, joystickSpeed, SOURCE_TUNING, unitOffset, type HeadRange } from './headPointer';
import type { FaceObservation } from './protocol';
import { RangeFit, type FitEvent } from './rangeFit';

const REACH = DEFAULT_HEAD_POINTER.reach;
const RANGE: HeadRange = { left: 0.02, right: 0.08, up: 0.03, down: 0.06 };

describe('fit mapping', () => {
  it('without a fit reproduces the fixed gains', () => {
    const unit = unitOffset(0.04, -0.02, 'nose', null, REACH, { x: 0, y: 0 });
    expect(directTarget(unit.x, REACH, 1)).toBeCloseTo(0.5 + 0.04 * SOURCE_TUNING.nose.gainX, 6);
    expect(directTarget(unit.y, REACH, 1)).toBeCloseTo(0.5 - 0.02 * SOURCE_TUNING.nose.gainY, 6);
  });

  it('maps each half-axis on its own: neutral is the centre, `reach` of each extreme is its edge', () => {
    const at = (dx: number, dy: number): { x: number; y: number } => {
      const unit = unitOffset(dx, dy, 'nose', RANGE, REACH, { x: 0, y: 0 });
      return { x: directTarget(unit.x, REACH, 1), y: directTarget(unit.y, REACH, 1) };
    };
    expect(at(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    // A small left range and a big right one: the same turn goes much further left.
    expect(at(-0.01, 0).x).toBeCloseTo(0.5 - 0.5 * (0.5 / REACH), 6);
    expect(at(0.01, 0).x).toBeCloseTo(0.5 + 0.5 * (0.125 / REACH), 6);
    // 90 % of each extreme is the edge; the full extreme is past it (clamped).
    expect(at(-0.02 * REACH, 0).x).toBeCloseTo(0, 6);
    expect(at(0.08 * REACH, 0).x).toBeCloseTo(1, 6);
    expect(at(0, -0.03 * REACH).y).toBeCloseTo(0, 6);
    expect(at(0, 0.06 * REACH).y).toBeCloseTo(1, 6);
    expect(at(0.08, 0.06)).toEqual({ x: 1, y: 1 });
    // Halfway to 90 % is a quarter of the screen from the centre.
    expect(at(0.04 * REACH, 0).x).toBeCloseTo(0.75, 6);
  });

  it('the sensitivity still multiplies', () => {
    const unit = unitOffset(0.02, 0, 'nose', RANGE, REACH, { x: 0, y: 0 });
    expect(directTarget(unit.x, REACH, 2) - 0.5).toBeCloseTo(2 * (directTarget(unit.x, REACH, 1) - 0.5), 6);
  });
});

describe('joystick', () => {
  const tuning = DEFAULT_HEAD_POINTER;

  it('has a dead zone, then a speed rising to `joystickSpeed` at reach', () => {
    expect(joystickSpeed(0, tuning, 1)).toBe(0);
    expect(joystickSpeed(0.14, tuning, 1)).toBe(0);
    expect(joystickSpeed(-0.15, tuning, 1)).toBeCloseTo(0, 9);
    const mid = joystickSpeed(0.5, tuning, 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(joystickSpeed(0.8, tuning, 1));
    expect(joystickSpeed(REACH, tuning, 1)).toBeCloseTo(tuning.joystickSpeed, 9);
    expect(joystickSpeed(1.5, tuning, 1)).toBeCloseTo(tuning.joystickSpeed, 9);
    expect(joystickSpeed(-1, tuning, 1)).toBeCloseTo(-tuning.joystickSpeed, 9);
    expect(joystickSpeed(0.5, tuning, 2)).toBeCloseTo(2 * mid, 9);
  });

  /** Feeds a constant offset from `start` for `seconds` (both ends included). */
  const drive = (hz: number, seconds: number, dx: number, pointer = new HeadPointer(), start = 0): HeadPointer => {
    pointer.style = 'joystick';
    pointer.fit = RANGE;
    const dt = 1 / hz;
    for (let t = start; t <= start + seconds + 1e-9; t += dt) pointer.update(dx, 0, t, 1);
    return pointer;
  };

  it('moves the same distance in the same time at 4 and 30 results a second', () => {
    // Half of the right extreme: well past the dead zone, short of full speed.
    const slow = drive(4, 0.5, 0.04).target.x;
    const fast = drive(30, 0.5, 0.04).target.x;
    const expected = 0.5 + joystickSpeed(0.5, DEFAULT_HEAD_POINTER, 1) * 0.5;
    expect(slow).toBeCloseTo(expected, 3);
    expect(fast).toBeCloseTo(expected, 3);
  });

  it('stays put back at neutral and at the edge', () => {
    const pointer = drive(30, 0.4, 0.06);
    const x = pointer.target.x;
    expect(x).toBeGreaterThan(0.6);
    drive(30, 1, 0, pointer, 0.5);
    const rest = pointer.target.x;
    expect(rest).toBeGreaterThanOrEqual(x);
    expect(rest).toBeLessThan(x + 0.05);
    drive(30, 1, 0, pointer, 1.6);
    expect(pointer.target.x).toBe(rest);
    drive(30, 3, 0.08, pointer, 2.7);
    expect(pointer.target.x).toBe(1);
  });

  it('a long gap integrates at most `maxStepS`', () => {
    const pointer = new HeadPointer();
    pointer.style = 'joystick';
    pointer.update(0.1, 0, 0, 1);
    pointer.update(0.1, 0, 10, 1);
    expect(pointer.target.x).toBeCloseTo(0.5 + tuning.joystickSpeed * tuning.maxStepS, 6);
  });

  it('a held pointer pins the joystick there', () => {
    const pointer = drive(30, 0.3, 0.06);
    pointer.update(0.06, 0, 0.4, 1, { x: 0.2, y: 0.3 });
    expect(pointer.target).toEqual({ x: 0.2, y: 0.3 });
  });
});

/** Feeds `seconds` of a constant signal at `hz`; returns the events and the time reached. */
function feed(fit: RangeFit, x: number | null, y: number | null, seconds: number, t: number, hz = 30): { t: number; events: FitEvent[] } {
  const events: FitEvent[] = [];
  const end = t + seconds - 1e-9;
  for (; t < end; t += 1 / hz) {
    const event = fit.feed(x, y, t);
    if (event) events.push(event);
  }
  return { t, events };
}

describe('RangeFit', () => {
  it('centre, then each extreme held 0.6 s, records an asymmetric range', () => {
    const fit = new RangeFit();
    fit.start('nose', 0);
    let r = feed(fit, 0.01, 0.02, 0.8, 0);
    expect(r.events).toEqual([{ kind: 'step', completed: 'centre' }]);
    expect(fit.neutral.x).toBeCloseTo(0.01, 6);
    expect(fit.step).toBe('left');
    r = feed(fit, -0.02, 0.02, 0.8, r.t); // 0.03 to the left
    expect(r.events[0]).toEqual({ kind: 'step', completed: 'left' });
    r = feed(fit, 0.09, 0.02, 0.8, r.t); // 0.08 to the right
    r = feed(fit, 0.01, -0.005, 0.8, r.t); // 0.025 up
    r = feed(fit, 0.01, 0.07, 0.8, r.t); // 0.05 down
    const done = r.events.find((e) => e.kind === 'done');
    expect(done).toBeDefined();
    if (done?.kind !== 'done') return;
    expect(done.range.left).toBeCloseTo(0.03, 6);
    expect(done.range.right).toBeCloseTo(0.08, 6);
    expect(done.range.up).toBeCloseTo(0.025, 6);
    expect(done.range.down).toBeCloseTo(0.05, 6);
    expect(done.neutral.x).toBeCloseTo(0.01, 9);
    expect(done.neutral.y).toBeCloseTo(0.02, 9);
    expect(fit.running).toBe(false);
  });

  it('a hold needs 0.6 s steady: wobbling restarts it, at 4 results a second too', () => {
    const fit = new RangeFit();
    fit.start('nose', 0);
    let r = feed(fit, 0, 0, 0.8, 0, 4);
    expect(fit.step).toBe('left');
    // Swinging between two far-apart points never holds.
    let t = r.t;
    for (let i = 0; i < 20; i += 1, t += 0.25) expect(fit.feed(i % 2 ? -0.03 : -0.06, 0, t)).toBeNull();
    expect(fit.step).toBe('left');
    // Small tremble within the tolerance holds.
    r = feed(fit, -0.05, 0.002, 0.3, t, 4);
    expect(fit.status).toBe('hold');
    r = feed(fit, -0.052, 0, 0.6, r.t, 4);
    expect(fit.step).toBe('right');
  });

  it('too small a movement never completes, and the step times out', () => {
    const fit = new RangeFit();
    fit.start('angle', 0);
    let r = feed(fit, 0, 0, 0.8, 0);
    r = feed(fit, -SOURCE_TUNING.angle.minMove * 0.8, 0, 5, r.t);
    expect(r.events).toEqual([]);
    expect(fit.step).toBe('left');
    expect(fit.status).toBe('further');
    // The wrong way doesn't count either.
    r = feed(fit, 0.3, 0, 2, r.t);
    expect(fit.status).toBe('move');
    r = feed(fit, 0, 0, fit.tuning.timeoutS, r.t, 4);
    expect(r.events).toEqual([{ kind: 'failed', step: 'left' }]);
    expect(fit.running).toBe(false);
  });

  it('a lost face breaks the hold; cancel stops; back redoes the last step', () => {
    const fit = new RangeFit();
    fit.start('nose', 0);
    let r = feed(fit, 0, 0, 0.4, 0);
    r = feed(fit, null, null, 0.1, r.t);
    expect(fit.status).toBe('lost');
    expect(fit.progress).toBe(0);
    r = feed(fit, 0, 0, 0.7, r.t);
    expect(fit.step).toBe('left');
    r = feed(fit, -0.04, 0, 0.8, r.t);
    expect(fit.step).toBe('right');
    fit.back(r.t);
    expect(fit.step).toBe('left');
    fit.cancel();
    expect(fit.running).toBe(false);
    expect(fit.feed(0, 0, r.t + 1)).toBeNull();
  });
});

/** A rotation matrix (column-major 4 × 4) for a face turned by `yaw` and tilted by `pitch`, as headAngles reads them. */
function poseMatrix(yaw: number, pitch: number, tz = -45): number[] {
  // R = Ry(−yaw) · Rx(pitch): the forward axis (third column) points to image-left (−x) for a turn to the
  // subject's right and down (−y) for a tilt down.
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  return [cy, 0, sy, 0, -sy * sp, cp, cy * sp, 0, -sy * cp, -sp, cy * cp, 0, 0, 3, tz, 1];
}

describe('headAngles', () => {
  it('reads yaw and pitch from the facial transformation matrix', () => {
    const identity = headAngles([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -45, 1]);
    expect(identity.yaw).toBeCloseTo(0, 9);
    expect(identity.pitch).toBeCloseTo(0, 9);
    for (const [yaw, pitch] of [[0.3, 0], [-0.2, 0.1], [0.1, -0.25]]) {
      const angles = headAngles(poseMatrix(yaw, pitch));
      expect(angles.yaw).toBeCloseTo(yaw, 6);
      expect(angles.pitch).toBeCloseTo(pitch, 6);
    }
  });

  it('matches the signs MediaPipe gave on the smoke portrait (perspective-warped)', () => {
    // Columns of real matrices: the image's right side nearer reads as a turn to the subject's right, the top nearer as a tilt down.
    const rightNear = [0.999, 0.03, -0.012, 0, -0.03, 1, -0.006, 0, 0.012, 0.006, 1, 0, -4.1, 4.5, -47.2, 1];
    const leftNear = [0.998, -0.016, -0.059, 0, 0.017, 0.999, 0.027, 0, 0.059, -0.028, 0.998, 0, 3.3, 4.6, -46.7, 1];
    expect(headAngles(rightNear).yaw).toBeGreaterThan(headAngles(leftNear).yaw);
    const topNear = [1, 0, -0.008, 0, 0, 1, 0.03, 0, 0.008, -0.03, 1, 0, -0.3, 1.8, -46.3, 1];
    const bottomNear = [1, 0.004, -0.016, 0, -0.005, 0.999, -0.05, 0, 0.015, 0.05, 0.999, 0, -0.4, 9.4, -50.7, 1];
    expect(headAngles(topNear).pitch).toBeGreaterThan(headAngles(bottomNear).pitch);
  });

  it('a degenerate matrix reads as facing the camera', () => {
    expect(headAngles(new Array(16).fill(0))).toEqual({ yaw: 0, pitch: 0 });
  });
});

describe('pointer settings', () => {
  it('old blobs without the pointer fields get the defaults', () => {
    const old = JSON.stringify({ bindings: {}, timing: { blinkMinS: 0.4 }, key: 'KeyJ', dwell: false, sensitivity: 1.2 });
    const parsed = parseSettings(old);
    expect(parsed.pointer).toEqual(defaultSettings().pointer);
    expect(parsed.sensitivity).toBe(1.2);
  });

  it('keeps valid choices and fits, drops malformed or implausible ones per source', () => {
    const parsed = parseSettings(
      JSON.stringify({ pointer: { source: 'angle', style: 'joystick', fits: { nose: { left: 0.02, right: 0.05, up: 0.03, down: 0.04 }, angle: { left: 0.2, right: 'far', up: 0.1, down: 0.1 } } } }),
    );
    expect(parsed.pointer.source).toBe('angle');
    expect(parsed.pointer.style).toBe('joystick');
    expect(parsed.pointer.fits.nose).toEqual({ left: 0.02, right: 0.05, up: 0.03, down: 0.04 });
    expect(parsed.pointer.fits.angle).toBeNull();
    const bad = parseSettings(JSON.stringify({ pointer: { source: 'ear', style: 7, fits: { nose: { left: -1, right: 0.05, up: 0.03, down: 0.04 }, angle: [] } } }));
    expect(bad.pointer).toEqual(defaultSettings().pointer);
    expect(parseSettings(JSON.stringify({ pointer: { fits: { nose: { left: 0.001, right: 0.05, up: 0.03, down: 0.04 } } } })).pointer.fits.nose).toBeNull();
    expect(parseSettings(JSON.stringify({ pointer: 'nose' })).pointer).toEqual(defaultSettings().pointer);
  });

  it('round-trips', () => {
    const settings = defaultSettings();
    settings.pointer = { source: 'angle', style: 'joystick', fits: { nose: null, angle: { left: 0.2, right: 0.3, up: 0.1, down: 0.15 } } };
    expect(parseSettings(JSON.stringify(settings)).pointer).toEqual(settings.pointer);
  });
});

const DT = 1 / 30;

function face({ turn = 0, yaw, pitch, shapes = {} }: { turn?: number; yaw?: number; pitch?: number; shapes?: Record<string, number> } = {}): FaceObservation {
  return {
    nose: { x: 0.5 - turn, y: 0.48, z: 0 },
    cheekRight: { x: 0.35, y: 0.5, z: 0 },
    cheekLeft: { x: 0.65, y: 0.5, z: 0 },
    forehead: { x: 0.5, y: 0.3, z: 0 },
    chin: { x: 0.5, y: 0.7, z: 0 },
    blendshapes: shapes,
    yaw,
    pitch,
  };
}

function run(head: HeadInterpreter, f: FaceObservation | null, seconds: number, t: number, dt = DT): number {
  const end = t + seconds - 1e-9;
  for (; t < end; t += dt) head.update(f, t);
  return t;
}

describe('HeadInterpreter pointer', () => {
  it('the angle source points with yaw and pitch, and ignores the nose', () => {
    const head = new HeadInterpreter();
    head.configurePointer('angle', 'direct', null);
    let t = run(head, face({ yaw: 0.05, pitch: 0 }), 1, 0);
    expect(head.frame.x).toBeCloseTo(0.5, 3);
    t = run(head, face({ yaw: 0.15, pitch: -0.05, turn: -0.05 }), 2, t);
    expect(head.frame.x).toBeCloseTo(0.5 + 0.1 * SOURCE_TUNING.angle.gainX, 2);
    expect(head.frame.y).toBeCloseTo(0.5 - 0.05 * SOURCE_TUNING.angle.gainY, 2);
    // A face without angles holds the pointer still.
    const x = head.frame.x;
    run(head, face({ turn: 0.05 }), 1, t);
    expect(head.frame.x).toBeCloseTo(x, 6);
    expect(head.hasSignal).toBe(false);
  });

  it('a fit maps the fitted extreme to past the edge; re-centre keeps the fit and takes a new neutral', () => {
    const head = new HeadInterpreter();
    // Nose offsets: turn 0.006 → 0.02 of the face width.
    head.configurePointer('nose', 'direct', { left: 0.02, right: 0.04, up: 0.03, down: 0.03 });
    let t = run(head, face(), 1, 0);
    t = run(head, face({ turn: 0.006 * REACH * 2 }), 2, t); // 90 % of the right extreme of 0.04
    expect(head.frame.x).toBeCloseTo(1, 2);
    t = run(head, face({ turn: -0.006 * REACH * 0.5 }), 2, t); // 45 % of the left extreme
    expect(head.frame.x).toBeCloseTo(0.25, 2);
    head.recalibrate();
    t = run(head, face({ turn: 0.006 }), 1, t);
    t = run(head, face({ turn: 0.006 }), 1, t);
    expect(head.frame.x).toBeCloseTo(0.5, 2);
    expect(head.mapper.fit).toEqual({ left: 0.02, right: 0.04, up: 0.03, down: 0.03 });
  });

  it('joystick: holding a turn moves the pointer on, back at neutral it stays, and a click is back-dated', () => {
    for (const hz of [4, 30]) {
      const head = new HeadInterpreter();
      head.configurePointer('nose', 'joystick', { left: 0.03, right: 0.03, up: 0.03, down: 0.03 });
      let t = run(head, face(), 1, 0, 1 / hz);
      t = run(head, face({ turn: 0.3 * 0.03 * 0.7 }), 0.5, t, 1 / hz); // 70 % of the extreme
      const moved = head.frame.x;
      expect(moved).toBeGreaterThan(0.6);
      expect(moved).toBeLessThan(1);
      t = run(head, face(), 1.5, t, 1 / hz);
      const rest = head.frame.x;
      expect(rest).toBeGreaterThanOrEqual(moved - 0.01);
      expect(rest).toBeLessThan(moved + 0.1);
      // An open mouth clicks where the pointer was, though the head jerks as it opens.
      head.configure({ ...PRESETS.classic, mouth: 'click' }, null);
      head.update(face({ shapes: { jawOpen: 0.6 } }), t);
      const tap = head.update(face({ turn: 0.02, shapes: { jawOpen: 0.6 } }), t + 1 / hz);
      expect(tap.tap).toBe(true);
      expect(tap.x).toBeCloseTo(rest, 2);
    }
  });

  it('a frozen pointer holds still while the signal and the unit offset still update', () => {
    const head = new HeadInterpreter();
    let t = run(head, face(), 1, 0);
    head.pointerFrozen = true;
    t = run(head, face({ turn: 0.03 }), 1, t);
    expect(head.frame.x).toBeCloseTo(0.5, 3);
    expect(head.mapper.unit.x).toBeGreaterThan(0.5);
    head.pointerFrozen = false;
    run(head, face({ turn: 0.03 }), 1, t);
    expect(head.frame.x).toBeGreaterThan(0.7);
  });

  it('switching source re-centres', () => {
    const head = new HeadInterpreter();
    const t = run(head, face(), 1, 0);
    head.configurePointer('angle', 'direct', null);
    head.update(face({ yaw: 0.2, pitch: 0 }), t);
    expect(head.frame.calibrating).toBe(true);
  });
});
