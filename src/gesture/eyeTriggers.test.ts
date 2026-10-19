import { describe, expect, it } from 'vitest';
import { defaultSettings, effectiveBindings, nextAction, parseSettings, PRESETS, presetOf, ALLOWED_ACTIONS, FACE_TRIGGERS } from './bindings';
import { DEFAULT_EYE_TIMING, EyeTest, EyeTriggers, eyeThreshold, type EyeCalibration, type EyeEvent } from './eyeTriggers';
import { HeadInterpreter } from './headInterpreter';
import type { FaceObservation } from './protocol';

const DT = 1 / 30;
const OPEN = 0.05;
const SHUT = 0.85;

/** Feeds `seconds` of (left, right) eyeBlink levels at 30 results a second; returns the events and the next time. */
function hold(eyes: EyeTriggers, left: number, right: number, seconds: number, t: number, allowed = true): { events: Array<{ event: EyeEvent; t: number; from: number }>; t: number } {
  const events: Array<{ event: EyeEvent; t: number; from: number }> = [];
  const end = t + seconds - 1e-9;
  for (; t < end; t += DT) {
    const event = eyes.update(left, right, t, allowed);
    if (event) events.push({ event, t, from: eyes.from });
  }
  return { events, t };
}

function sequence(eyes: EyeTriggers, steps: Array<[number, number, number]>, allowed = true): Array<{ event: EyeEvent; t: number; from: number }> {
  let t = 0;
  const events: Array<{ event: EyeEvent; t: number; from: number }> = [];
  for (const [left, right, seconds] of steps) {
    const result = hold(eyes, left, right, seconds, t, allowed);
    events.push(...result.events);
    t = result.t;
  }
  return events;
}

describe('EyeTriggers', () => {
  it('ignores an ordinary blink', () => {
    const events = sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [SHUT, SHUT, 0.15], [OPEN, OPEN, 1]]);
    expect(events).toEqual([]);
  });

  it('a slow blink clicks once, on re-opening, from when the eyes began to close', () => {
    const events = sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [SHUT, SHUT, 0.6], [OPEN, OPEN, 1]]);
    expect(events.map((e) => e.event)).toEqual(['blink']);
    expect(events[0].t).toBeGreaterThanOrEqual(1.6 - DT);
    // The last frame with the eyes open, just before 1 s.
    expect(events[0].from).toBeGreaterThan(1 - 2 * DT);
    expect(events[0].from).toBeLessThan(1);
  });

  it('a long blink fires while still shut, once, and nothing on re-opening', () => {
    const eyes = new EyeTriggers();
    const events = sequence(eyes, [[OPEN, OPEN, 1], [SHUT, SHUT, 2.5], [OPEN, OPEN, 1]]);
    expect(events.map((e) => e.event)).toEqual(['long-blink']);
    expect(events[0].t).toBeCloseTo(1 + DEFAULT_EYE_TIMING.pauseS, 1);
  });

  it('the slow-blink length is adjustable', () => {
    const eyes = new EyeTriggers({ ...DEFAULT_EYE_TIMING, blinkMinS: 0.8 });
    expect(sequence(eyes, [[OPEN, OPEN, 1], [SHUT, SHUT, 0.6], [OPEN, OPEN, 1]])).toEqual([]);
  });

  it('detects a left and a right wink', () => {
    expect(sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [SHUT, OPEN, 0.4], [OPEN, OPEN, 1]]).map((e) => e.event)).toEqual(['wink-left']);
    expect(sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [OPEN, SHUT, 0.4], [OPEN, OPEN, 1]]).map((e) => e.event)).toEqual(['wink-right']);
  });

  it('a short wink, or one where the other eye half closes, is not a wink', () => {
    expect(sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [SHUT, OPEN, 0.1], [OPEN, OPEN, 1]])).toEqual([]);
    expect(sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [SHUT, 0.4, 0.5], [OPEN, OPEN, 1]])).toEqual([]);
  });

  it('a blink with the eyes closing one after the other is a blink, not a wink', () => {
    const events = sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [SHUT, OPEN, 0.07], [SHUT, SHUT, 0.5], [OPEN, SHUT, 0.07], [OPEN, OPEN, 1]]);
    expect(events.map((e) => e.event)).toEqual(['blink']);
  });

  it('nothing fires while not allowed (a smile, too slow, the eye test)', () => {
    expect(sequence(new EyeTriggers(), [[OPEN, OPEN, 1], [SHUT, OPEN, 0.5], [SHUT, SHUT, 2], [OPEN, OPEN, 1]], false)).toEqual([]);
  });

  it('thresholds follow a calibration and fall back to the defaults without one', () => {
    const cal: EyeCalibration = { open: { left: 0.2, right: 0.1 }, closed: { left: 0.7, right: 0.9 }, smile: 0, winkLeft: true, winkRight: false };
    const left = eyeThreshold(cal, 'left');
    expect(left.on).toBeCloseTo(0.5, 6);
    expect(left.off).toBeCloseTo(0.4, 6);
    expect(eyeThreshold(cal, 'right').on).toBeCloseTo(0.58, 6);
    expect(eyeThreshold(null, 'left').on).toBe(0.5);
    // A test that saw no difference between open and shut: defaults.
    expect(eyeThreshold({ ...cal, closed: { left: 0.25, right: 0.9 } }, 'left').on).toBe(0.5);
  });
});

describe('EyeTest', () => {
  function feed(test: EyeTest, left: number, right: number, seconds: number, t: number): { t: number; outcome: ReturnType<EyeTest['feed']> } {
    for (const end = t + seconds; t < end; t += DT) {
      const outcome = test.feed(left, right, 0.1, t);
      if (outcome) return { t, outcome };
    }
    return { t, outcome: null };
  }

  it('measures open and shut levels, then passes a left wink and refuses a bilateral one', () => {
    const test = new EyeTest();
    test.start('open', 0);
    let r = feed(test, 0.1, 0.12, 3, 0);
    expect(r.outcome?.ok).toBe(true);
    test.start('closed', r.t);
    r = feed(test, 0.1, 0.12, 1, r.t); // still open: waiting
    expect(r.outcome).toBeNull();
    expect(test.waiting).toBe(true);
    r = feed(test, 0.8, 0.85, 3, r.t);
    expect(r.outcome).toMatchObject({ ok: true, calibration: { winkLeft: false } });
    const cal = test.result!;
    expect(cal.open.left).toBeCloseTo(0.1, 6);
    expect(cal.closed.right).toBeCloseTo(0.85, 6);

    const wink = new EyeTest(cal);
    wink.start('wink-left', 0);
    r = feed(wink, 0.75, 0.15, 3, 0);
    expect(r.outcome).toMatchObject({ ok: true, calibration: { winkLeft: true, winkRight: false } });

    const both = new EyeTest(cal);
    both.start('wink-right', 0);
    r = feed(both, 0.7, 0.75, 3, 0);
    expect(r.outcome?.ok).toBe(false);

    const wrong = new EyeTest(cal);
    wrong.start('wink-right', 0);
    r = feed(wrong, 0.75, 0.12, 3, 0);
    expect(r.outcome).toMatchObject({ ok: false });
    expect(r.outcome && !r.outcome.ok && r.outcome.reason).toMatch(/left eye/);
  });

  it('gives up kindly when the eyes never close', () => {
    const test = new EyeTest({ open: { left: 0.1, right: 0.1 }, closed: { left: 0, right: 0 }, smile: 0, winkLeft: false, winkRight: false });
    test.start('closed', 0);
    const r = feed(test, 0.1, 0.1, 10, 0);
    expect(r.outcome).toMatchObject({ ok: false });
  });
});

describe('bindings', () => {
  it('presets are recognised, and only allowed actions cycle', () => {
    expect(presetOf(PRESETS['low-effort'])).toBe('low-effort');
    expect(presetOf(PRESETS.classic)).toBe('classic');
    expect(presetOf({ ...PRESETS.classic, smile: 'off' })).toBeNull();
    for (const trigger of FACE_TRIGGERS) {
      let action = ALLOWED_ACTIONS[trigger][0];
      const seen = new Set<string>();
      for (let i = 0; i < 10; i += 1) {
        seen.add(action);
        action = nextAction(trigger, action);
      }
      expect([...seen].sort()).toEqual([...ALLOWED_ACTIONS[trigger]].sort());
    }
    expect(ALLOWED_ACTIONS.blink).not.toContain('hold');
    expect(ALLOWED_ACTIONS['wink-left']).not.toContain('hold');
    expect(ALLOWED_ACTIONS.mouth).toContain('hold');
    expect(ALLOWED_ACTIONS.key).toContain('hold');
  });

  it('a wink stays off until the eye test has seen it', () => {
    const bindings = PRESETS['low-effort'];
    const off = effectiveBindings(bindings, null);
    expect(off['wink-left']).toBe('off');
    expect(off.blink).toBe('click');
    const cal: EyeCalibration = { open: { left: 0.1, right: 0.1 }, closed: { left: 0.8, right: 0.8 }, smile: 0, winkLeft: true, winkRight: false };
    const on = effectiveBindings(bindings, cal);
    expect(on['wink-left']).toBe('drag-toggle');
    expect(on['wink-right']).toBe('off');
  });

  it('parsing stored settings tolerates garbage, old data and out-of-range values', () => {
    const defaults = defaultSettings();
    for (const raw of [null, '', 'not json', '42', '[]', '{"bindings": 3}', '{"bindings": {"blink": "explode", "mouth": "hold"}}']) {
      const parsed = parseSettings(raw);
      expect(parsed.bindings.blink).toBe(defaults.bindings.blink);
    }
    expect(parseSettings('{"bindings": {"mouth": "hold", "blink": "hold"}}').bindings).toMatchObject({ mouth: 'hold', blink: 'click' });
    const timing = parseSettings('{"timing": {"blinkMinS": 9, "pauseS": -1, "dwellS": "slow"}}').timing;
    expect(timing.blinkMinS).toBe(1);
    expect(timing.pauseS).toBeGreaterThanOrEqual(1.5);
    expect(timing.dwellS).toBe(defaults.timing.dwellS);
    expect(parseSettings('{"calibration": {"open": {"left": 0.1}}}').calibration).toBeNull();
    expect(parseSettings('{"calibration": {"open": {"left": 0.1, "right": 0.1}, "closed": {"left": 0.15, "right": 0.9}}}').calibration).toBeNull();
    const cal = parseSettings('{"calibration": {"open": {"left": 0.1, "right": 0.1}, "closed": {"left": 0.8, "right": 0.9}, "winkLeft": true}}').calibration;
    expect(cal).toMatchObject({ winkLeft: true, winkRight: false, smile: 0 });
    expect(parseSettings('{"key": "Space; drop table"}').key).toBe('Enter');
    expect(parseSettings('{"key": "KeyJ", "sensitivity": 7, "dwell": false}')).toMatchObject({ key: 'KeyJ', sensitivity: 2, dwell: false });
    const round = parseSettings(JSON.stringify({ ...defaults, bindings: PRESETS.classic }));
    expect(round.bindings).toEqual(PRESETS.classic);
  });
});

function face(shapes: Record<string, number> = {}, turn = 0): FaceObservation {
  return {
    nose: { x: 0.5 - turn, y: 0.48, z: 0 },
    cheekRight: { x: 0.35, y: 0.5, z: 0 },
    cheekLeft: { x: 0.65, y: 0.5, z: 0 },
    forehead: { x: 0.5, y: 0.3, z: 0 },
    chin: { x: 0.5, y: 0.7, z: 0 },
    blendshapes: shapes,
  };
}

const eyes = (left: number, right: number, extra: Record<string, number> = {}): Record<string, number> => ({ eyeBlinkLeft: left, eyeBlinkRight: right, ...extra });

/** Runs a head interpreter with Low effort bindings (winks allowed) and collects what each frame asked for. */
function lowEffort(): HeadInterpreter {
  const head = new HeadInterpreter();
  const cal: EyeCalibration = { open: { left: OPEN, right: OPEN }, closed: { left: SHUT, right: SHUT }, smile: 0, winkLeft: true, winkRight: true };
  head.configure(effectiveBindings(PRESETS['low-effort'], cal), cal);
  return head;
}

interface Step {
  shapes: Record<string, number>;
  seconds: number;
  turn?: number;
}

function play(head: HeadInterpreter, steps: Step[], start = 0, dt = DT): { t: number; taps: Array<{ t: number; x: number }>; commands: string[]; pressed: boolean[] } {
  let t = start;
  const taps: Array<{ t: number; x: number }> = [];
  const commands: string[] = [];
  const pressed: boolean[] = [];
  for (const step of steps) {
    for (const end = t + step.seconds - 1e-9; t < end; t += dt) {
      const f = head.update(face(step.shapes, step.turn ?? 0), t);
      if (f.tap) taps.push({ t, x: f.x });
      if (f.command) commands.push(f.command);
      pressed.push(f.pressed);
    }
  }
  return { t, taps, commands, pressed };
}

describe('HeadInterpreter with face triggers', () => {
  it('a slow blink taps once where the pointer was when the eyes began to close', () => {
    const head = lowEffort();
    let r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 1.5 }]);
    r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 1 }], r.t);
    expect(r.taps).toEqual([]);
    const before = head.frame.x;
    // The head drifts (turns) while the eyes are shut.
    r = play(head, [{ shapes: eyes(SHUT, SHUT), seconds: 0.6, turn: 0.03 }, { shapes: eyes(OPEN, OPEN), seconds: 0.1, turn: 0.03 }], r.t);
    expect(r.taps).toHaveLength(1);
    expect(r.taps[0].x).toBeCloseTo(before, 2);
    expect(r.pressed.every((p) => !p)).toBe(true);
  });

  it('a long blink pauses, and another resumes; nothing else acts while paused', () => {
    const head = lowEffort();
    let r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 2 }, { shapes: eyes(SHUT, SHUT), seconds: 2 }, { shapes: eyes(OPEN, OPEN), seconds: 0.5 }]);
    expect(r.commands).toEqual(['pause']);
    expect(head.frame.paused).toBe(true);
    r = play(head, [{ shapes: eyes(SHUT, SHUT), seconds: 0.6 }, { shapes: eyes(OPEN, OPEN), seconds: 0.5 }, { shapes: eyes(OPEN, OPEN, { browInnerUp: 0.9 }), seconds: 1 }], r.t);
    expect(r.taps).toEqual([]);
    expect(r.commands).toEqual([]);
    r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 0.5 }, { shapes: eyes(SHUT, SHUT), seconds: 2 }, { shapes: eyes(OPEN, OPEN), seconds: 0.5 }], r.t);
    expect(r.commands).toEqual(['pause']);
    expect(head.frame.paused).toBe(false);
  });

  it('wink left toggles a drag on and off; wink right is Esc and also ends a drag', () => {
    const head = lowEffort();
    let r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 1.5 }, { shapes: eyes(SHUT, OPEN), seconds: 0.4 }, { shapes: eyes(OPEN, OPEN), seconds: 1, turn: 0.03 }]);
    expect(r.pressed.at(-1)).toBe(true);
    expect(r.taps).toEqual([]);
    r = play(head, [{ shapes: eyes(SHUT, OPEN), seconds: 0.4, turn: 0.03 }, { shapes: eyes(OPEN, OPEN), seconds: 0.3 }], r.t);
    expect(r.pressed.at(-1)).toBe(false);
    r = play(head, [{ shapes: eyes(SHUT, OPEN), seconds: 0.4 }, { shapes: eyes(OPEN, OPEN), seconds: 0.3 }], r.t);
    expect(head.frame.pressed).toBe(true);
    r = play(head, [{ shapes: eyes(OPEN, SHUT), seconds: 0.4 }, { shapes: eyes(OPEN, OPEN), seconds: 0.3 }], r.t);
    expect(r.commands).toEqual(['cancel']);
    expect(head.frame.pressed).toBe(false);
  });

  it('a strong smile blocks blinks and winks', () => {
    const head = lowEffort();
    const r = play(head, [
      { shapes: eyes(OPEN, OPEN), seconds: 1.5 },
      { shapes: eyes(SHUT, SHUT, { mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }), seconds: 0.6 },
      { shapes: eyes(OPEN, OPEN), seconds: 0.3 },
      { shapes: eyes(SHUT, OPEN, { mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }), seconds: 0.4 },
      { shapes: eyes(OPEN, OPEN), seconds: 0.3 },
    ]);
    expect(r.taps).toEqual([]);
    expect(r.pressed.every((p) => !p)).toBe(true);
  });

  it('eye triggers stay off at 4 results a second, and a missed detection there does not lose the face', () => {
    const head = lowEffort();
    let t = 0;
    for (; t < 2; t += 0.25) head.update(face(eyes(OPEN, OPEN, { jawOpen: 0 })), t);
    expect(head.eyesLive).toBe(false);
    for (; t < 3; t += 0.25) head.update(face(eyes(SHUT, SHUT)), t);
    head.update(face(eyes(OPEN, OPEN)), t);
    expect(head.frame.tap).toBe(false);
    expect(head.frame.paused).toBe(false);
    // Classic: the mouth holds a press; one missed detection (two intervals) keeps it.
    head.configure(PRESETS.classic, null);
    t += 0.25;
    for (let i = 0; i < 3; i += 1, t += 0.25) head.update(face({ jawOpen: 0.7 }), t);
    expect(head.frame.pressed).toBe(true);
    head.update(null, t);
    t += 0.25;
    head.update(null, t);
    expect(head.frame.present).toBe(true);
    expect(head.frame.pressed).toBe(true);
    t += 0.25;
    head.update(face({ jawOpen: 0.7 }), t);
    expect(head.frame.pressed).toBe(true);
    for (let i = 0; i < 4; i += 1) head.update(null, (t += 0.25));
    expect(head.frame.present).toBe(false);
    expect(head.frame.pressed).toBe(false);
  });

  it('the key holds a press; a press and release between two frames is a tap', () => {
    const head = lowEffort();
    let r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 1 }]);
    head.keyInput(true);
    r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 0.3 }], r.t);
    expect(r.pressed.every(Boolean)).toBe(true);
    head.keyInput(false);
    r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: 0.1 }], r.t);
    expect(head.frame.pressed).toBe(false);
    head.keyInput(true);
    head.keyInput(false);
    r = play(head, [{ shapes: eyes(OPEN, OPEN), seconds: DT }], r.t);
    expect(r.taps).toHaveLength(1);
  });

  it('every action a trigger can be bound to is handled', () => {
    for (const action of ALLOWED_ACTIONS.key) {
      const head = new HeadInterpreter();
      head.configure({ ...PRESETS.classic, key: action }, null);
      let r = play(head, [{ shapes: {}, seconds: 1 }]);
      head.keyInput(true);
      const down = play(head, [{ shapes: {}, seconds: 0.2 }], r.t);
      head.keyInput(false);
      r = play(head, [{ shapes: {}, seconds: 0.2 }], down.t);
      const did = [down, r].some((x) => x.taps.length > 0 || x.commands.length > 0 || x.pressed.some(Boolean));
      expect(did, action).toBe(action !== 'off');
    }
  });
});
