import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../utils/random';
import { defaultSettings, type PalmSettings, type TriggerAction } from './bindings';
import { INDEX_MCP, MIDDLE_MCP, WRIST } from './handInterpreter';
import { SOURCE_TUNING } from './headPointer';
import { DEFAULT_PALM_TUNING, PALM_POINTS, PalmInterpreter, palmCentre, palmSize, PINKY_MCP, RING_MCP } from './palmInterpreter';
import type { GestureFrame, HandObservation, Point3 } from './protocol';
import { replayPalms } from './replay';

const ASPECT = 1;
const SIZE = 0.15;
/** The player's right hand, seen on image-left, and their left hand on image-right. */
const RIGHT = { x: 0.3, y: 0.5 };
const LEFT = { x: 0.7, y: 0.6 };

/** Palm landmarks relative to the wrist-to-middle-knuckle line, in palm lengths: wrist below, knuckles across. */
const PALM_LAYOUT: Record<number, [number, number]> = {
  [WRIST]: [0, 1],
  [INDEX_MCP]: [-0.3, 0],
  [MIDDLE_MCP]: [0, 0],
  [RING_MCP]: [0.2, 0],
  [PINKY_MCP]: [0.4, 0],
};
const LAYOUT_MEAN = { x: 0.06, y: 0.2 };

type Fingers = (i: number) => Point3;

/** A hand whose palm centre is at (cx, cy) in image coords and whose palm is `size` frame heights long. */
function palm(cx: number, cy: number, { size = SIZE, aspect = ASPECT, fingers }: { size?: number; aspect?: number; fingers?: Fingers } = {}): HandObservation {
  const landmarks: Point3[] = [];
  for (let i = 0; i < 21; i += 1) {
    const at = PALM_LAYOUT[i];
    if (at) landmarks.push({ x: cx + ((at[0] - LAYOUT_MEAN.x) * size) / aspect, y: cy + (at[1] - LAYOUT_MEAN.y) * size, z: 0 });
    else landmarks.push(fingers ? fingers(i) : { x: cx, y: cy - 1.5 * size, z: 0 });
  }
  return { landmarks, handedness: 'Left', gesture: 'Open_Palm', gestureScore: 0.9 };
}

/** The player's left hand moved by (dx, dy) palm sizes the way the player sees it (x > 0 their right, y > 0 down). */
function clickAt(dx: number, dy: number, size = SIZE): HandObservation {
  return palm(LEFT.x - dx * size, LEFT.y + dy * size, { size });
}

function pointAt(dx: number, dy: number, size = SIZE): HandObservation {
  return palm(RIGHT.x - dx * size, RIGHT.y + dy * size, { size });
}

type Hands = HandObservation[] | ((t: number) => HandObservation[]);

/** Feeds `seconds` of hands at `hz`; returns the time reached. */
function run(interp: PalmInterpreter, hands: Hands, seconds: number, t: number, hz = 30, out?: GestureFrame[]): number {
  const end = t + seconds - 1e-9;
  for (; t < end; t += 1 / hz) {
    const f = interp.update(typeof hands === 'function' ? hands(t) : hands, ASPECT, t);
    out?.push({ ...f });
  }
  return t;
}

function interpreter(palmSettings: Partial<PalmSettings> = {}, key: TriggerAction = 'hold', tuning = DEFAULT_PALM_TUNING): PalmInterpreter {
  const interp = new PalmInterpreter({ ...tuning });
  interp.configure({ ...defaultSettings().palm, ...palmSettings }, key);
  return interp;
}

/** Both hands at rest through calibration and a moment after. */
function calibrated(palmSettings: Partial<PalmSettings> = {}, key: TriggerAction = 'hold', hz = 30): { interp: PalmInterpreter; t: number } {
  const interp = interpreter(palmSettings, key);
  const t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 1, 0, hz);
  return { interp, t };
}

const GAIN_X = SOURCE_TUNING.palm.gainX;
const GAIN_Y = SOURCE_TUNING.palm.gainY;

describe('palm geometry', () => {
  it('the centre is the mean of the wrist and the knuckles; the size is the palm length', () => {
    const hand = palm(0.4, 0.55).landmarks;
    const centre = palmCentre(hand);
    expect(centre.x).toBeCloseTo(0.4, 9);
    expect(centre.y).toBeCloseTo(0.55, 9);
    expect(palmSize(hand, ASPECT)).toBeCloseTo(SIZE, 9);
    expect(PALM_POINTS).toEqual([0, 5, 9, 13, 17]);
  });

  it('a hand tipped forward still measures by its knuckle width', () => {
    const hand = palm(0.4, 0.55).landmarks;
    // Foreshortened: the wrist seen almost under the knuckles.
    hand[WRIST] = { x: hand[MIDDLE_MCP].x, y: hand[MIDDLE_MCP].y + 0.2 * SIZE, z: 0 };
    expect(palmSize(hand, ASPECT)).toBeCloseTo(1.3 * 0.7 * SIZE, 9);
  });

  it('corrects for the frame aspect', () => {
    const wide = palm(0.4, 0.55, { aspect: 16 / 9 }).landmarks;
    expect(palmSize(wide, 16 / 9)).toBeCloseTo(SIZE, 9);
  });
});

describe('PalmInterpreter pointer', () => {
  it('calibrates on the first 0.6 s, then points in palm sizes, mirrored', () => {
    const interp = interpreter();
    run(interp, [pointAt(0, 0), clickAt(0, 0)], 0.3, 0);
    expect(interp.frame.calibrating).toBe(true);
    expect(interp.frame.label).toBe('Hold still: centring');
    let t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 0.7, 0.3);
    expect(interp.frame.calibrating).toBe(false);
    expect(interp.frame.x).toBeCloseTo(0.5, 3);
    expect(interp.neutralPose).toEqual({ x: 0, y: 0 });
    // Half a palm to the player's right and half a palm up.
    t = run(interp, [pointAt(0.5, -0.5), clickAt(0, 0)], 1.5, t);
    expect(interp.signal.x).toBeCloseTo(0.5, 6);
    expect(interp.signal.y).toBeCloseTo(-0.5, 6);
    expect(interp.frame.x).toBeCloseTo(0.5 + 0.5 * GAIN_X, 3);
    expect(interp.frame.y).toBeCloseTo(0.5 - 0.5 * GAIN_Y, 3);
    expect(interp.frame.grab).toBe(false);
    expect(interp.frame.zoom).toBe(1);
  });

  it('the same move in palm sizes points the same near the camera and far from it', () => {
    const at = (size: number): { x: number; y: number } => {
      const interp = interpreter();
      const t = run(interp, [pointAt(0, 0, size), clickAt(0, 0, size)], 1, 0);
      run(interp, [pointAt(0.8, 0.3, size), clickAt(0, 0, size)], 1.5, t);
      return { x: interp.frame.x, y: interp.frame.y };
    };
    const far = at(0.08);
    const near = at(0.25);
    expect(far.x).toBeGreaterThan(0.7);
    expect(far.y).toBeGreaterThan(0.6);
    expect(near.x).toBeCloseTo(far.x, 4);
    expect(near.y).toBeCloseTo(far.y, 4);
  });

  it('re-centres on the current place', () => {
    const { interp, t: t0 } = calibrated();
    let t = run(interp, [pointAt(1, 0), clickAt(0, 0)], 1, t0);
    expect(interp.frame.x).toBeGreaterThan(0.75);
    interp.recalibrate();
    t = run(interp, [pointAt(1, 0), clickAt(0, 0)], 0.3, t);
    expect(interp.frame.calibrating).toBe(true);
    run(interp, [pointAt(1, 0), clickAt(0, 0)], 1, t);
    expect(interp.frame.x).toBeCloseTo(0.5, 3);
  });

  it('a frozen pointer holds still while the signal updates; a fitted centre shifts it', () => {
    const { interp, t: t0 } = calibrated();
    interp.pointerFrozen = true;
    let t = run(interp, [pointAt(1, 0), clickAt(0, 0)], 1, t0);
    expect(interp.frame.x).toBeCloseTo(0.5, 3);
    expect(interp.signal.x).toBeCloseTo(1, 6);
    expect(interp.mapper.unit.x).toBeGreaterThan(0.5);
    interp.pointerFrozen = false;
    interp.setNeutral(1, 0);
    run(interp, [pointAt(1, 0), clickAt(0, 0)], 1, t);
    expect(interp.frame.x).toBeCloseTo(0.5, 3);
    expect(interp.neutralPose).toEqual({ x: 1, y: 0 });
  });

  it('joystick: an offset held moves the pointer on, and it stays when the palm comes back', () => {
    const { interp, t: t0 } = calibrated();
    interp.configurePointer('joystick', null);
    let t = run(interp, [pointAt(1, 0), clickAt(0, 0)], 0.5, t0);
    const moved = interp.frame.x;
    expect(moved).toBeGreaterThan(0.6);
    t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 1, t);
    expect(interp.frame.x).toBeGreaterThanOrEqual(moved - 0.01);
  });
});

describe('PalmInterpreter fingers', () => {
  it('fingers never matter: any finger landmarks give the same output', () => {
    const rng = createSeededRandom(7);
    const random: Fingers = () => ({ x: rng(), y: rng(), z: rng() - 0.5 });
    const script = (fingers?: Fingers) => (t: number): HandObservation[] => {
      const lift = t > 2 && t < 2.6 ? 1 : 0;
      const move = Math.min(1, Math.max(0, t - 1));
      const hand = (h: HandObservation): HandObservation => (fingers ? { ...h, gesture: rng() < 0.5 ? 'Closed_Fist' : 'Victory' } : h);
      return [
        hand(palm(RIGHT.x - move * SIZE, RIGHT.y, { fingers })),
        hand(palm(LEFT.x, LEFT.y - lift * SIZE, { fingers })),
      ];
    };
    const plain: GestureFrame[] = [];
    const scrambled: GestureFrame[] = [];
    run(interpreter(), script(), 3.5, 0, 30, plain);
    run(interpreter(), script(random), 3.5, 0, 30, scrambled);
    expect(plain.some((f) => f.pressed)).toBe(true);
    expect(scrambled).toEqual(plain);
  });
});

describe('PalmInterpreter hands', () => {
  it("the player's right hand points by default, the left with 'left'", () => {
    const right = interpreter();
    run(right, [clickAt(0, 0), pointAt(0, 0)], 1, 0);
    expect(right.pointerHand.index).toBe(1);
    expect(right.clickHand.index).toBe(0);
    const left = interpreter({ pointing: 'left' });
    run(left, [clickAt(0, 0), pointAt(0, 0)], 1, 0);
    expect(left.pointerHand.index).toBe(0);
    expect(left.clickHand.index).toBe(1);
  });

  it("'one' points with any hand and has no click hand", () => {
    const interp = interpreter({ pointing: 'one' });
    // A lone hand on the "click" side still points.
    let t = run(interp, [clickAt(0, 0)], 1, 0);
    expect(interp.pointerHand.index).toBe(0);
    t = run(interp, [clickAt(1, 0)], 1, t);
    expect(interp.frame.x).toBeGreaterThan(0.75);
    // A second hand lifted never clicks.
    run(interp, [clickAt(1, 0), pointAt(0, -1.5)], 1, t);
    expect(interp.clickHand.present).toBe(false);
    expect(interp.frame.pressed).toBe(false);
    expect(interp.pointerHand.index).toBe(0);
  });

  it("a lone hand that isn't clearly the pointing one is the click hand and doesn't move the cursor", () => {
    for (const x of [LEFT.x, 0.52]) {
      const interp = interpreter();
      run(interp, [palm(x, 0.5)], 1, 0);
      expect(interp.clickHand.index).toBe(0);
      expect(interp.pointerHand.present).toBe(false);
      expect(interp.frame.label).toBe('Show your pointing hand');
      run(interp, [palm(x - 0.1, 0.4)], 1, 1);
      expect(interp.frame.x).toBe(0.5);
    }
    // Clearly on the pointing side, a lone hand points.
    const interp = interpreter();
    run(interp, [palm(RIGHT.x, 0.5)], 1, 0);
    expect(interp.pointerHand.index).toBe(0);
  });

  it('a dropped frame of the pointing hand does not make the click hand point', () => {
    const { interp, t: t0 } = calibrated();
    let t = run(interp, [pointAt(0.5, 0), clickAt(0, 0)], 1, t0);
    const x = interp.frame.x;
    t = run(interp, [clickAt(0.3, 0)], 1 / 30, t);
    expect(interp.clickHand.index).toBe(0);
    expect(interp.pointerHand.present).toBe(true);
    expect(interp.frame.x).toBeCloseTo(x, 6);
    // Gone for longer: the click hand stays the click hand and the cursor stays.
    t = run(interp, [clickAt(0.6, 0.2)], 1, t);
    expect(interp.pointerHand.present).toBe(false);
    expect(interp.clickHand.index).toBe(0);
    expect(interp.frame.x).toBeCloseTo(x, 6);
    run(interp, [clickAt(0, 0), pointAt(0.5, 0)], 0.5, t);
    expect(interp.pointerHand.index).toBe(1);
  });

  it('young roles follow the side; once followed a second they stick', () => {
    // The left hand alone at the middle is taken as the click hand, then slides clearly to the pointing side.
    const young = interpreter();
    let t = run(young, [palm(0.5, 0.5)], 0.3, 0);
    expect(young.clickHand.index).toBe(0);
    run(young, [palm(0.3, 0.5)], 0.3, t);
    expect(young.pointerHand.index).toBe(0);

    const old = interpreter();
    t = run(old, [palm(0.5, 0.5)], 1.2, 0);
    run(old, [palm(0.3, 0.5)], 0.3, t);
    expect(old.clickHand.index).toBe(0);
  });

  it('no hand changes role during a press', () => {
    const interp = interpreter({}, 'hold', { ...DEFAULT_PALM_TUNING, roleHoldS: 10 });
    let t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 1, 0);
    t = run(interp, [pointAt(0, -1.3), clickAt(0, -1)], 0.5, t);
    expect(interp.frame.pressed).toBe(true);
    // The pointing hand moves above and past the click hand: still the pointing hand while pressed.
    const across = (t0: number) => (time: number): HandObservation[] => [palm(RIGHT.x + Math.min(1, (time - t0) / 0.5) * 0.55, RIGHT.y - 1.3 * SIZE), clickAt(0, -1)];
    t = run(interp, across(t), 0.6, t);
    expect(interp.frame.pressed).toBe(true);
    expect(interp.pointerHand.index).toBe(0);
    expect(interp.pointerHand.x).toBeGreaterThan(LEFT.x);
    // Released, the young roles follow the side again.
    run(interp, [palm(0.85, RIGHT.y - 1.3 * SIZE), clickAt(0, 0)], 0.5, t);
    expect(interp.frame.pressed).toBe(false);
    expect(interp.pointerHand.index).toBe(1);
  });

  it('is lost after lostS, and at 4 results a second a dropped result keeps it', () => {
    const { interp, t: t0 } = calibrated();
    let t = run(interp, [], 0.2, t0);
    expect(interp.frame.present).toBe(true);
    t = run(interp, [], 0.5, t);
    expect(interp.frame.present).toBe(false);
    const slow = calibrated({}, 'hold', 4);
    t = run(slow.interp, [], 0.5, slow.t, 4);
    expect(slow.interp.frame.present).toBe(true);
  });
});

describe('PalmInterpreter click move', () => {
  it('presses after 0.15 s past the threshold and releases below the lower one', () => {
    const { interp, t: t0 } = calibrated();
    expect(interp.restState).toBe('ready');
    // A flick past the threshold for under 0.15 s doesn't press.
    let t = run(interp, [pointAt(0, 0), clickAt(0, -0.8)], 0.1, t0);
    expect(interp.frame.pressed).toBe(false);
    t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 0.3, t);
    t = run(interp, [pointAt(0, 0), clickAt(0, -0.8)], 0.12, t);
    expect(interp.frame.pressed).toBe(false);
    expect(interp.frame.pressure).toBe(1);
    t = run(interp, [pointAt(0, 0), clickAt(0, -0.8)], 0.08, t);
    expect(interp.frame.pressed).toBe(true);
    expect(interp.frame.label).toBe('Other hand: click');
    t = run(interp, [pointAt(0, 0), clickAt(0, -0.6)], 0.3, t); // between the thresholds
    expect(interp.frame.pressed).toBe(true);
    run(interp, [pointAt(0, 0), clickAt(0, -0.4)], 1 / 30, t);
    expect(interp.frame.pressed).toBe(false);
    expect(interp.liftLevel).toBeCloseTo(0.4 / 0.75, 2);
  });

  it('moving the click hand any other way does nothing', () => {
    const { interp, t: t0 } = calibrated();
    const frames: GestureFrame[] = [];
    run(interp, [pointAt(0, 0), clickAt(1.5, 1)], 1, t0, 30, frames);
    expect(frames.some((f) => f.pressed || f.tap)).toBe(false);
    expect(interp.frame.x).toBeCloseTo(0.5, 3);
  });

  it('a click hand not seen at calibration, or back after a second away, holds still to rest first', () => {
    const interp = interpreter();
    let t = run(interp, [pointAt(0, 0)], 1, 0);
    // Arrives lifted: no press however long it stays, until it has held still for 0.5 s there.
    t = run(interp, [pointAt(0, 0), clickAt(0, -1)], 0.3, t);
    expect(interp.restState).toBe('settling');
    expect(interp.frame.label).toBe('Other hand: hold still');
    expect(interp.frame.pressed).toBe(false);
    t = run(interp, [pointAt(0, 0), clickAt(0, -1)], 0.5, t);
    expect(interp.restState).toBe('ready');
    expect(interp.frame.pressed).toBe(false);
    t = run(interp, [pointAt(0, 0), clickAt(0, -2)], 0.3, t);
    expect(interp.frame.pressed).toBe(true);

    // Away briefly: the rest stays, and coming back lifted presses.
    t = run(interp, [pointAt(0, 0), clickAt(0, -1)], 0.5, t);
    t = run(interp, [pointAt(0, 0)], 0.6, t);
    t = run(interp, [pointAt(0, 0), clickAt(0, -2)], 0.3, t);
    expect(interp.frame.pressed).toBe(true);

    // Away for over a second: it must rest again.
    t = run(interp, [pointAt(0, 0), clickAt(0, -1)], 0.5, t);
    t = run(interp, [pointAt(0, 0)], 1.2, t);
    t = run(interp, [pointAt(0, 0), clickAt(0, -2)], 0.3, t);
    expect(interp.frame.pressed).toBe(false);
    expect(interp.restState).toBe('settling');
  });

  it('the rest follows slow drift, and a very slow lift still presses', () => {
    const { interp, t: t0 } = calibrated();
    const restY = interp.clickRest.y;
    // The resting hand sags a fifth of a palm and stays there.
    let t = run(interp, [pointAt(0, 0), clickAt(0, 0.2)], 30, t0);
    expect(interp.clickRest.y - restY).toBeGreaterThan(0.9 * 0.2 * SIZE);
    // A lift at a twentieth of a palm a second: a rest that kept following would never let it cross.
    const frames: GestureFrame[] = [];
    const t1 = t;
    t = run(interp, (time) => [pointAt(0, 0), clickAt(0, 0.2 - 0.05 * (time - t1))], 20, t, 30, frames);
    expect(frames.some((f) => f.pressed)).toBe(true);
    expect(frames.some((f) => f.tap)).toBe(false);
  });

  it('a fitted sideways move clicks; lifting no longer does', () => {
    const { interp, t: t0 } = calibrated({ click: { x: -1.2, y: 0 } });
    // The threshold is half the fitted move, towards the player's left (image right).
    expect(interp.clickThreshold.x).toBeCloseTo(interp.clickRest.x + 0.6 * SIZE, 3);
    expect(interp.clickThreshold.y).toBeCloseTo(interp.clickRest.y, 6);
    let t = run(interp, [pointAt(0, 0), clickAt(0, -1.5)], 0.5, t0);
    expect(interp.frame.pressed).toBe(false);
    t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 0.5, t);
    t = run(interp, [pointAt(0, 0), clickAt(-0.7, 0)], 0.3, t);
    expect(interp.frame.pressed).toBe(true);
    t = run(interp, [pointAt(0, 0), clickAt(-0.4, 0)], 0.1, t); // above 30 % of 1.2
    expect(interp.frame.pressed).toBe(true);
    run(interp, [pointAt(0, 0), clickAt(-0.3, 0)], 0.1, t);
    expect(interp.frame.pressed).toBe(false);
  });

  it('a press lands where the pointer was just before the move crossed the threshold', () => {
    const { interp, t: t0 } = calibrated();
    const frames: GestureFrame[] = [];
    const times: number[] = [];
    // The pointer sweeps right; the click hand jumps up at `cross`.
    const cross = t0 + 1;
    const end = t0 + 1.5;
    let pressedAt = -1;
    for (let t = t0; t < end; t += 1 / 30) {
      const f = interp.update([pointAt((t - t0) * 0.8, 0), clickAt(0, t >= cross - 1e-9 ? -1 : 0)], ASPECT, t);
      frames.push({ ...f });
      times.push(t);
      if (f.pressed && pressedAt < 0) pressedAt = frames.length - 1;
    }
    expect(pressedAt).toBeGreaterThan(0);
    expect(times[pressedAt] - cross).toBeGreaterThanOrEqual(DEFAULT_PALM_TUNING.pressHoldS - 1e-9);
    let before = 0;
    for (let i = 0; i < times.length; i += 1) if (times[i] <= cross - DEFAULT_PALM_TUNING.backdateS + 1e-9) before = i;
    expect(frames[pressedAt].x).toBeCloseTo(frames[before].x, 6);
    expect(frames[pressedAt].x).toBeLessThan(frames[pressedAt - 1].x);
  });

  it('works the same at 4 and 30 results a second', () => {
    const outcome = (hz: number): { x: number; presses: number; pressDelay: number } => {
      const { interp, t: t0 } = calibrated({}, 'hold', hz);
      let t = run(interp, [pointAt(0.6, 0.4), clickAt(0, 0)], 1.5, t0, hz);
      const x = interp.frame.x;
      const frames: GestureFrame[] = [];
      t = run(interp, [pointAt(0.6, 0.4), clickAt(0, -1)], 0.6, t, hz, frames);
      run(interp, [pointAt(0.6, 0.4), clickAt(0, 0)], 0.6, t, hz, frames);
      let presses = 0;
      let pressDelay = -1;
      frames.forEach((f, i) => {
        if (f.pressed && (i === 0 || !frames[i - 1].pressed)) {
          presses += 1;
          if (pressDelay < 0) pressDelay = i / hz;
        }
      });
      return { x, presses, pressDelay };
    };
    const slow = outcome(4);
    const fast = outcome(30);
    expect(slow.x).toBeCloseTo(fast.x, 2);
    expect(slow.presses).toBe(1);
    expect(fast.presses).toBe(1);
    expect(fast.pressDelay).toBeGreaterThanOrEqual(0.15 - 1e-9);
    expect(slow.pressDelay).toBeGreaterThanOrEqual(0.15 - 1e-9);
    expect(slow.pressDelay).toBeLessThanOrEqual(0.15 + 0.25 + 1e-9);
  });
});

describe('PalmInterpreter bindings', () => {
  /** Lifts the click hand for `up` seconds, then rests it; returns the frames. */
  const lift = (interp: PalmInterpreter, t: number, up = 0.4): { t: number; frames: GestureFrame[] } => {
    const frames: GestureFrame[] = [];
    t = run(interp, [pointAt(0, 0), clickAt(0, -1)], up, t, 30, frames);
    t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 0.4, t, 30, frames);
    return { t, frames };
  };
  const count = (frames: GestureFrame[], test: (f: GestureFrame) => boolean): number => frames.filter(test).length;

  it('hold: pressed while the hand is up', () => {
    const { interp, t } = calibrated();
    const { frames } = lift(interp, t);
    expect(count(frames, (f) => f.pressed)).toBeGreaterThan(5);
    expect(frames[frames.length - 1].pressed).toBe(false);
    expect(count(frames, (f) => f.tap)).toBe(0);
  });

  it('click: one tap per move, never a held press', () => {
    const { interp, t } = calibrated({ lift: 'click' });
    const { frames } = lift(interp, t, 1);
    expect(count(frames, (f) => f.tap)).toBe(1);
    expect(count(frames, (f) => f.pressed)).toBe(0);
  });

  it('drag-toggle: the first move presses until the second', () => {
    const { interp, t: t0 } = calibrated({ lift: 'drag-toggle' });
    let r = lift(interp, t0);
    expect(r.frames[r.frames.length - 1].pressed).toBe(true);
    expect(interp.frame.label).toBe('Dragging');
    r = lift(interp, r.t);
    expect(r.frames[r.frames.length - 1].pressed).toBe(false);
  });

  it('cancel and rotate send their command once per move', () => {
    for (const action of ['cancel', 'rotate'] as const) {
      const { interp, t } = calibrated({ lift: action });
      const { frames } = lift(interp, t, 1);
      expect(count(frames, (f) => f.command === action)).toBe(1);
      expect(count(frames, (f) => f.pressed || f.tap)).toBe(0);
    }
  });

  it('pause: the move pauses (the key does nothing then) and the next move resumes', () => {
    const { interp, t: t0 } = calibrated({ lift: 'pause' });
    const r = lift(interp, t0);
    expect(count(r.frames, (f) => f.command === 'pause')).toBe(1);
    expect(interp.frame.paused).toBe(true);
    expect(interp.frame.label).toBe('Paused');
    interp.keyInput(true);
    const t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 0.2, r.t);
    expect(interp.frame.pressed).toBe(false);
    interp.keyInput(false);
    lift(interp, t);
    expect(interp.frame.paused).toBe(false);
    // With nothing bound to pause any more, a pause ends.
    const paused = calibrated({ lift: 'pause' });
    lift(paused.interp, paused.t);
    paused.interp.configure({ ...defaultSettings().palm, lift: 'hold' }, 'hold');
    expect(paused.interp.isPaused).toBe(false);
  });

  it('recentre: the move re-centres the pointer', () => {
    const { interp, t: t0 } = calibrated({ lift: 'recentre' });
    let t = run(interp, [pointAt(1, 0), clickAt(0, 0)], 1, t0);
    expect(interp.frame.x).toBeGreaterThan(0.75);
    const frames: GestureFrame[] = [];
    t = run(interp, [pointAt(1, 0), clickAt(0, -1)], 1.2, t, 30, frames);
    expect(count(frames, (f) => f.command === 'recentre')).toBe(1);
    t = run(interp, [pointAt(1, 0), clickAt(0, 0)], 1.5, t);
    expect(interp.frame.x).toBeCloseTo(0.5, 3);
    // The hand stayed up through the re-centre, so its rest wasn't taken there: the same move re-centres again.
    run(interp, [pointAt(1, 0), clickAt(0, -1)], 0.3, t, 30, frames);
    expect(count(frames, (f) => f.command === 'recentre')).toBe(2);
  });

  it('the switch key holds a press; a press and release between frames taps; bound to click it taps', () => {
    const { interp, t: t0 } = calibrated();
    interp.keyInput(true);
    let t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 0.3, t0);
    expect(interp.frame.pressed).toBe(true);
    expect(interp.frame.label).toBe('Key held: click');
    interp.keyInput(false);
    t = run(interp, [pointAt(0, 0), clickAt(0, 0)], 1 / 30, t);
    expect(interp.frame.pressed).toBe(false);
    interp.keyInput(true);
    interp.keyInput(false);
    expect(interp.update([pointAt(0, 0), clickAt(0, 0)], ASPECT, t).tap).toBe(true);

    const clicker = calibrated({}, 'click');
    clicker.interp.keyInput(true);
    const frames: GestureFrame[] = [];
    run(clicker.interp, [pointAt(0, 0), clickAt(0, 0)], 0.3, clicker.t, 30, frames);
    expect(count(frames, (f) => f.tap)).toBe(1);
    expect(count(frames, (f) => f.pressed)).toBe(0);
  });

  it('the click fit suspends the click move', () => {
    const { interp, t } = calibrated();
    interp.clickSuspended = true;
    const { frames } = lift(interp, t);
    expect(count(frames, (f) => f.pressed || f.tap)).toBe(0);
  });
});

describe('replayPalms', () => {
  it('runs recorded frames from a fresh start', () => {
    const interp = interpreter();
    run(interp, [pointAt(1, 0), clickAt(0, 0)], 2, 0);
    const frames = Array.from({ length: 45 }, (_, i) => ({ t: i / 30, hands: [pointAt(0, 0), clickAt(0, i >= 30 ? -1 : 0)], face: null }));
    const out = replayPalms(frames, interp, ASPECT);
    expect(out).toHaveLength(45);
    expect(out[10].calibrating).toBe(true);
    expect(out[29].x).toBeCloseTo(0.5, 3);
    expect(out[44].pressed).toBe(true);
  });
});
