import { describe, expect, it } from 'vitest';
import { DEFAULT_HAND_TUNING, HandInterpreter, imageToScreen, INDEX_MCP, INDEX_TIP, MIDDLE_MCP, pinchPoint, pinchRatio, THUMB_TIP, WRIST } from './handInterpreter';
import { DEFAULT_HEAD_TUNING, HeadInterpreter, noseOffset } from './headInterpreter';
import { OneEuroFilter } from './oneEuro';
import { PointerSmoother } from './pointerSmoother';
import type { FaceObservation, HandObservation, Point3 } from './protocol';
import { HoldTrigger, Latch, ThresholdSwitch } from './triggers';

const FPS = 30;
const DT = 1 / FPS;

/** A hand whose middle knuckle is at (cx, cy), `size` from wrist to knuckle, thumb and index tips `gap` hand-sizes apart. */
function hand(cx: number, cy: number, { size = 0.2, gap = 1, gesture = 'None', score = 0.9 } = {}): HandObservation {
  const landmarks: Point3[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  landmarks[WRIST] = { x: cx, y: cy + size, z: 0 };
  landmarks[MIDDLE_MCP] = { x: cx, y: cy, z: 0 };
  landmarks[INDEX_MCP] = { x: cx - 0.2 * size, y: cy, z: 0 };
  const tipY = cy - 0.4 * size;
  landmarks[THUMB_TIP] = { x: cx - 0.3 * size - (gap * size) / 2, y: tipY, z: 0 };
  landmarks[INDEX_TIP] = { x: cx - 0.3 * size + (gap * size) / 2, y: tipY, z: 0 };
  return { landmarks, handedness: 'Right', gesture, gestureScore: score };
}

/** Square frames, so x and y distances compare directly. */
const ASPECT = 1;

function run(interpreter: HandInterpreter, frames: Array<HandObservation[]>, start = 0): number {
  let t = start;
  for (const hands of frames) {
    interpreter.update(hands, ASPECT, t);
    t += DT;
  }
  return t;
}

const repeat = <T>(value: T, n: number): T[] => Array.from({ length: n }, () => value);

describe('OneEuroFilter', () => {
  it('passes the first sample and settles on a constant', () => {
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    expect(filter.filter(5, 0)).toBe(5);
    let value = 0;
    for (let i = 1; i <= 120; i += 1) value = filter.filter(10, i * DT);
    expect(value).toBeCloseTo(10, 3);
  });

  it('smooths jitter at rest and follows fast moves with less lag when beta is higher', () => {
    const still = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    let spread = 0;
    for (let i = 0; i < 60; i += 1) {
      const out = still.filter(i % 2 === 0 ? 0.01 : -0.01, i * DT);
      if (i > 30) spread = Math.max(spread, Math.abs(out));
    }
    expect(spread).toBeLessThan(0.005);

    const lag = (beta: number): number => {
      const filter = new OneEuroFilter({ minCutoff: 1, beta, dCutoff: 1 });
      let out = 0;
      for (let i = 0; i < 10; i += 1) out = filter.filter(i * 0.1, i * DT);
      return 0.9 - out;
    };
    expect(lag(10)).toBeLessThan(lag(0));
  });

  it('ignores a repeated timestamp', () => {
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    filter.filter(1, 0);
    expect(filter.filter(100, 0)).toBe(1);
  });
});

describe('PointerSmoother', () => {
  it('back-dates a press and holds there, then follows again', () => {
    const smoother = new PointerSmoother({ minCutoff: 1000, beta: 0, dCutoff: 1 }, { backdateS: 0.1, holdS: 0.15 });
    let t = 0;
    for (let i = 0; i < 10; i += 1, t += DT) smoother.update(0.5, 0.5, t);
    // The pinch drags the hand down over the last frames before the press.
    for (let i = 0; i < 3; i += 1, t += DT) smoother.update(0.5, 0.5 + 0.02 * (i + 1), t);
    const pressT = t - DT;
    const held = smoother.pressAt(pressT);
    expect(held.y).toBeCloseTo(0.5, 2);
    expect(smoother.update(0.5, 0.7, pressT + 0.05).y).toBeCloseTo(0.5, 2);
    expect(smoother.update(0.5, 0.7, pressT + 0.2).y).toBeCloseTo(0.7, 2);
  });
});

describe('triggers', () => {
  it('Latch waits onS to switch on and offS to switch off', () => {
    const latch = new Latch(0.1, 0.2);
    expect(latch.update(true, 0)).toBe(false);
    expect(latch.update(true, 0.05)).toBe(false);
    expect(latch.update(true, 0.1)).toBe(true);
    expect(latch.on).toBe(true);
    expect(latch.update(false, 0.2)).toBe(false);
    expect(latch.update(true, 0.25)).toBe(false); // a blip back resets the off timer
    expect(latch.update(false, 0.3)).toBe(false);
    expect(latch.update(false, 0.5)).toBe(true);
    expect(latch.on).toBe(false);
  });

  it('HoldTrigger fires once per hold and re-arms', () => {
    const hold = new HoldTrigger(0.3);
    const fires = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => hold.update(true, t));
    expect(fires.filter(Boolean)).toHaveLength(1);
    expect(hold.progress).toBe(1);
    hold.update(false, 0.6);
    expect(hold.progress).toBe(0);
    expect([0.7, 1.0].map((t) => hold.update(true, t))).toEqual([false, true]);
  });

  it('ThresholdSwitch needs onFrames past the on threshold and has hysteresis', () => {
    const pinch = new ThresholdSwitch(0.3, 0.45, 2);
    expect(pinch.update(0.2)).toBe(false);
    expect(pinch.update(0.2)).toBe(true);
    expect(pinch.update(0.4)).toBe(false); // between the thresholds: stays on
    expect(pinch.on).toBe(true);
    expect(pinch.update(0.5)).toBe(true);
    expect(pinch.on).toBe(false);
    expect(pinch.update(0.2, false)).toBe(false);
    expect(pinch.update(0.2)).toBe(false);

    const mouth = new ThresholdSwitch(0.4, 0.2, 1, true);
    expect(mouth.update(0.5)).toBe(true);
    expect(mouth.update(0.3)).toBe(false);
    expect(mouth.update(0.1)).toBe(true);
  });
});

describe('hand geometry', () => {
  it('pinch ratio is the tip gap over the hand size, whatever the distance from the camera', () => {
    expect(pinchRatio(hand(0.5, 0.5, { gap: 1 }).landmarks, ASPECT)).toBeCloseTo(1, 5);
    expect(pinchRatio(hand(0.5, 0.5, { gap: 0.1, size: 0.05 }).landmarks, ASPECT)).toBeCloseTo(0.1, 5);
    expect(pinchRatio(hand(0.5, 0.5, { gap: 0.1, size: 0.3 }).landmarks, ASPECT)).toBeCloseTo(0.1, 5);
  });

  it('the pinch point barely moves as the fingers close', () => {
    const open = pinchPoint(hand(0.5, 0.5, { gap: 1 }).landmarks);
    const closed = pinchPoint(hand(0.5, 0.5, { gap: 0.05 }).landmarks);
    expect(Math.hypot(open.x - closed.x, open.y - closed.y)).toBeLessThan(1e-9);
  });

  it('maps the mirrored middle of the frame to the whole screen', () => {
    const region = { left: 0.2, right: 0.8, top: 0.1, bottom: 0.7 };
    const centre = imageToScreen(0.5, 0.4, region);
    expect(centre.x).toBeCloseTo(0.5, 9);
    expect(centre.y).toBeCloseTo(0.5, 9);
    // Image-right is screen-left (a mirror).
    expect(imageToScreen(0.8, 0.1, region)).toEqual({ x: 0, y: 0 });
    expect(imageToScreen(0.2, 0.7, region)).toEqual({ x: 1, y: 1 });
    expect(imageToScreen(0, 1, region)).toEqual({ x: 1, y: 1 });
  });
});

describe('HandInterpreter', () => {
  it('follows the hand, mirrored, and loses it after lostS', () => {
    const interp = new HandInterpreter();
    let t = run(interp, repeat([hand(0.3, 0.42)], 30));
    const f = interp.frame;
    expect(f.present).toBe(true);
    expect(f.x).toBeGreaterThan(0.6); // a hand on image-left points at screen-right
    expect(f.pressed).toBe(false);
    t = run(interp, repeat([], 2), t);
    expect(f.present).toBe(true); // a dropped frame or two keeps it
    run(interp, repeat([], 10), t);
    expect(f.present).toBe(false);
  });

  it('a pinch presses after pinchFrames and releases past the open threshold', () => {
    const interp = new HandInterpreter();
    let t = run(interp, repeat([hand(0.5, 0.42)], 10));
    t = run(interp, [[hand(0.5, 0.42, { gap: 0.1 })]], t);
    expect(interp.frame.pressed).toBe(false);
    t = run(interp, [[hand(0.5, 0.42, { gap: 0.1 })]], t);
    expect(interp.frame.pressed).toBe(true);
    t = run(interp, [[hand(0.5, 0.42, { gap: 0.4 })]], t); // between the thresholds
    expect(interp.frame.pressed).toBe(true);
    run(interp, [[hand(0.5, 0.42, { gap: 0.6 })]], t);
    expect(interp.frame.pressed).toBe(false);
  });

  it('releases a held pinch when the hand is lost', () => {
    const interp = new HandInterpreter();
    const t = run(interp, repeat([hand(0.5, 0.42, { gap: 0.1 })], 5));
    expect(interp.frame.pressed).toBe(true);
    run(interp, repeat([], 10), t);
    expect(interp.frame.pressed).toBe(false);
  });

  it('a fist grabs instead of clicking and reports how far the hand moved', () => {
    const interp = new HandInterpreter();
    let t = run(interp, repeat([hand(0.5, 0.42, { gap: 0.1, gesture: 'Closed_Fist' })], 6));
    expect(interp.frame.pressed).toBe(false);
    expect(interp.frame.grab).toBe(true);
    t = run(interp, [[hand(0.45, 0.42, { gap: 0.1, gesture: 'Closed_Fist' })]], t);
    const span = DEFAULT_HAND_TUNING.region.right - DEFAULT_HAND_TUNING.region.left;
    expect(interp.frame.grabDx).toBeCloseTo(0.05 / span, 5); // moved image-left = screen-right
    expect(interp.frame.grabDy).toBeCloseTo(0, 5);
    run(interp, repeat([hand(0.45, 0.42)], 8), t);
    expect(interp.frame.grab).toBe(false);
  });

  it('two fists zoom by the change in their gap', () => {
    const interp = new HandInterpreter();
    const fists = (gap: number): HandObservation[] => [
      hand(0.5 - gap / 2, 0.42, { gesture: 'Closed_Fist' }),
      hand(0.5 + gap / 2, 0.42, { gesture: 'Closed_Fist' }),
    ];
    const t = run(interp, [fists(0.3)]);
    expect(interp.frame.zoom).toBe(1);
    run(interp, [fists(0.36)], t);
    expect(interp.frame.zoom).toBeCloseTo(1.2, 5);
    expect(interp.frame.grab).toBe(false);
  });

  it('✌ held rotates once, 👎 held cancels once', () => {
    const interp = new HandInterpreter();
    const commands: Array<string | null> = [];
    let t = 0;
    for (let i = 0; i < 30; i += 1, t += DT) commands.push(interp.update([hand(0.5, 0.42, { gesture: 'Victory' })], ASPECT, t).command);
    expect(commands.filter((c) => c === 'rotate')).toHaveLength(1);
    for (let i = 0; i < 30; i += 1, t += DT) commands.push(interp.update([hand(0.5, 0.42, { gesture: 'Thumb_Down' })], ASPECT, t).command);
    expect(commands.filter((c) => c === 'cancel')).toHaveLength(1);
    // A low score doesn't count.
    const quiet = new HandInterpreter();
    let fired = 0;
    for (let i = 0; i < 30; i += 1) if (quiet.update([hand(0.5, 0.42, { gesture: 'Victory', score: 0.3 })], ASPECT, i * DT).command) fired += 1;
    expect(fired).toBe(0);
  });

  it("'pinch' picking lets whichever hand pinches click", () => {
    const interp = new HandInterpreter({ ...DEFAULT_HAND_TUNING, pick: 'pinch' });
    run(interp, repeat([hand(0.3, 0.42), hand(0.7, 0.42, { gap: 0.1 })], 4));
    expect(interp.frame.pressed).toBe(true);
  });

  it('follows the same hand when a second one appears', () => {
    const interp = new HandInterpreter();
    const t = run(interp, repeat([hand(0.3, 0.42)], 20));
    const x = interp.frame.x;
    run(interp, repeat([hand(0.7, 0.42, { size: 0.3 }), hand(0.3, 0.42)], 10), t);
    expect(interp.frame.x).toBeCloseTo(x, 3);
  });
});

function face({ turn = 0, tilt = 0, shapes = {} as Record<string, number> } = {}): FaceObservation {
  // A 0.3-wide, 0.4-tall face centred at (0.5, 0.5); `turn` / `tilt` shift the nose inside it (image coords).
  return {
    nose: { x: 0.5 - turn, y: 0.48 + tilt, z: 0 },
    cheekRight: { x: 0.35, y: 0.5, z: 0 },
    cheekLeft: { x: 0.65, y: 0.5, z: 0 },
    forehead: { x: 0.5, y: 0.3, z: 0 },
    chin: { x: 0.5, y: 0.7, z: 0 },
    blendshapes: shapes,
  };
}

function runHead(interp: HeadInterpreter, faces: Array<FaceObservation | null>, start = 0, press: boolean | null = null): number {
  let t = start;
  for (const f of faces) {
    interp.update(f, t, press);
    t += DT;
  }
  return t;
}

describe('HeadInterpreter', () => {
  it('the nose offset is relative to the face, signed the way the head turns in a mirror', () => {
    expect(noseOffset(face()).x).toBeCloseTo(0, 6);
    expect(noseOffset(face({ turn: 0.03 })).x).toBeCloseTo(0.1, 6); // subject turns right: nose to image-left
    expect(noseOffset(face({ tilt: 0.04 })).y).toBeCloseTo(0.05, 6);
  });

  it('calibrates on the first pose, then points relative to it', () => {
    const interp = new HeadInterpreter();
    // The resting nose sits a little off-centre: that pose becomes the screen centre.
    let t = runHead(interp, repeat(face({ turn: 0.01, tilt: 0.01 }), 25));
    expect(interp.frame.calibrating).toBe(false);
    t = runHead(interp, repeat(face({ turn: 0.01, tilt: 0.01 }), 30), t);
    expect(interp.frame.x).toBeCloseTo(0.5, 3);
    expect(interp.frame.y).toBeCloseTo(0.5, 3);
    runHead(interp, repeat(face({ turn: 0.03, tilt: -0.01 }), 60), t);
    expect(interp.frame.x).toBeCloseTo(0.5 + (0.02 / 0.3) * DEFAULT_HEAD_TUNING.gainX, 2);
    expect(interp.frame.y).toBeLessThan(0.5); // tilting up points up
  });

  it('an open mouth presses and holds while open; a pinch can stand in for it', () => {
    const interp = new HeadInterpreter();
    let t = runHead(interp, repeat(face(), 25));
    t = runHead(interp, repeat(face({ shapes: { jawOpen: 0.6 } }), 2), t);
    expect(interp.frame.pressed).toBe(true);
    t = runHead(interp, [face({ shapes: { jawOpen: 0.3 } })], t);
    expect(interp.frame.pressed).toBe(true);
    t = runHead(interp, [face({ shapes: { jawOpen: 0.1 } })], t);
    expect(interp.frame.pressed).toBe(false);
    t = runHead(interp, [face({ shapes: { jawOpen: 0.9 } })], t, false);
    expect(interp.frame.pressed).toBe(false);
    runHead(interp, [face()], t, true);
    expect(interp.frame.pressed).toBe(true);
  });

  it('raised eyebrows cancel, a smile rotates, once per hold', () => {
    const interp = new HeadInterpreter();
    let t = runHead(interp, repeat(face(), 25));
    const commands: Array<string | null> = [];
    for (let i = 0; i < 30; i += 1, t += DT) commands.push(interp.update(face({ shapes: { browInnerUp: 0.8 } }), t).command);
    for (let i = 0; i < 30; i += 1, t += DT) commands.push(interp.update(face({ shapes: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8 } }), t).command);
    expect(commands.filter((c) => c === 'cancel')).toHaveLength(1);
    expect(commands.filter((c) => c === 'rotate')).toHaveLength(1);
  });

  it('recalibrate re-centres on the current pose', () => {
    const interp = new HeadInterpreter();
    let t = runHead(interp, repeat(face(), 40));
    t = runHead(interp, repeat(face({ turn: 0.03 }), 40), t);
    expect(interp.frame.x).toBeGreaterThan(0.8);
    interp.recalibrate();
    runHead(interp, repeat(face({ turn: 0.03 }), 60), t);
    expect(interp.frame.x).toBeCloseTo(0.5, 2);
  });
});
