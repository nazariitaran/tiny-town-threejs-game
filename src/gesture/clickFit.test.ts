import { describe, expect, it } from 'vitest';
import { CLICK_LENGTH, defaultSettings } from './bindings';
import { ClickFit, type ClickFitEvent, type ClickFitHand } from './clickFit';
import { PalmInterpreter } from './palmInterpreter';
import type { HandObservation, Point3 } from './protocol';

const SIZE = 0.15;
const REST = { x: 0.7, y: 0.6 };

/** The click hand moved by (dx, dy) palm sizes as the player sees it (x > 0 their right, y > 0 down). */
function at(dx: number, dy: number, size = SIZE, aspect = 1): ClickFitHand {
  return { x: REST.x - (dx * size) / aspect, y: REST.y + dy * size, size };
}

/** Feeds `seconds` of one hand at `hz`; returns the events and the time reached. */
function feed(fit: ClickFit, hand: ClickFitHand | null, seconds: number, t: number, hz = 30, aspect = 1): { t: number; events: ClickFitEvent[] } {
  const events: ClickFitEvent[] = [];
  const end = t + seconds - 1e-9;
  for (; t < end; t += 1 / hz) {
    const event = fit.feed(hand, aspect, t);
    if (event) events.push(event);
  }
  return { t, events };
}

describe('ClickFit', () => {
  it('rest, then a sideways move held 0.6 s, gives that move in palm sizes', () => {
    const fit = new ClickFit();
    fit.start(0);
    let r = feed(fit, at(0, 0), 0.8, 0);
    expect(r.events).toEqual([{ kind: 'step', completed: 'rest' }]);
    expect(fit.rest.x).toBeCloseTo(REST.x, 9);
    expect(fit.step).toBe('move');
    // Slid towards the player's left: image right.
    r = feed(fit, at(-1.2, 0.1), 0.8, r.t);
    const done = r.events.find((e) => e.kind === 'done');
    expect(done?.kind === 'done' && done.click.x).toBeCloseTo(-1.2, 6);
    expect(done?.kind === 'done' && done.click.y).toBeCloseTo(0.1, 6);
    expect(fit.running).toBe(false);
  });

  it('is in palm sizes whatever the distance from the camera and the frame aspect', () => {
    for (const [size, aspect] of [[0.08, 1], [0.25, 16 / 9]]) {
      const fit = new ClickFit();
      fit.start(0);
      const r = feed(fit, at(0, 0, size, aspect), 0.8, 0, 30, aspect);
      const done = feed(fit, at(0, -1, size, aspect), 0.8, r.t, 30, aspect).events.find((e) => e.kind === 'done');
      expect(done?.kind === 'done' && done.click.y).toBeCloseTo(-1, 6);
      expect(done?.kind === 'done' && done.click.x).toBeCloseTo(0, 6);
    }
  });

  it('a hold needs 0.6 s steady: swinging restarts it, at 4 results a second too', () => {
    const fit = new ClickFit();
    fit.start(0);
    let r = feed(fit, at(0, 0), 0.8, 0, 4);
    expect(fit.step).toBe('move');
    let t = r.t;
    for (let i = 0; i < 20; i += 1, t += 0.25) expect(fit.feed(i % 2 ? at(0, -0.8) : at(0, -1.6), 1, t)).toBeNull();
    expect(fit.step).toBe('move');
    // A tremble within the tolerance holds.
    r = feed(fit, at(0.05, -1), 0.3, t, 4);
    expect(fit.status).toBe('hold');
    r = feed(fit, at(-0.05, -1.05), 0.6, r.t, 4);
    expect(r.events.map((e) => e.kind)).toEqual(['done']);
  });

  it('too small a move never completes, and the step times out', () => {
    const fit = new ClickFit();
    fit.start(0);
    let r = feed(fit, at(0, 0), 0.8, 0);
    r = feed(fit, at(0, -CLICK_LENGTH.min * 0.8), 5, r.t);
    expect(r.events).toEqual([]);
    expect(fit.status).toBe('further');
    r = feed(fit, at(0, 0), fit.tuning.timeoutS, r.t, 4);
    expect(fit.status).toBe('move');
    expect(r.events).toEqual([{ kind: 'failed', step: 'move' }]);
    expect(fit.running).toBe(false);
  });

  it('a lost hand breaks the hold; back redoes the rest; cancel stops', () => {
    const fit = new ClickFit();
    fit.start(0);
    let r = feed(fit, at(0, 0), 0.4, 0);
    r = feed(fit, null, 0.1, r.t);
    expect(fit.status).toBe('lost');
    expect(fit.progress).toBe(0);
    r = feed(fit, at(0, 0), 0.7, r.t);
    expect(fit.step).toBe('move');
    fit.back(r.t);
    expect(fit.step).toBe('rest');
    fit.cancel();
    expect(fit.running).toBe(false);
    expect(fit.feed(at(0, 0), 1, r.t + 1)).toBeNull();
  });

  it('a move longer than the longest click is cut to it', () => {
    const fit = new ClickFit();
    fit.start(0);
    const r = feed(fit, at(0, 0), 0.8, 0);
    const done = feed(fit, at(0, -10), 0.8, r.t).events.find((e) => e.kind === 'done');
    expect(done?.kind === 'done' && Math.hypot(done.click.x, done.click.y)).toBeCloseTo(CLICK_LENGTH.max, 6);
  });

  it("drives the palm interpreter's click hand: the fitted move clicks at half its length", () => {
    const palm = (cx: number, cy: number): HandObservation => {
      const landmarks: Point3[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy - SIZE, z: 0 }));
      landmarks[0] = { x: cx, y: cy + 0.8 * SIZE, z: 0 };
      landmarks[5] = { x: cx - 0.3 * SIZE, y: cy - 0.2 * SIZE, z: 0 };
      landmarks[9] = { x: cx, y: cy - 0.2 * SIZE, z: 0 };
      landmarks[13] = { x: cx + 0.2 * SIZE, y: cy - 0.2 * SIZE, z: 0 };
      landmarks[17] = { x: cx + 0.4 * SIZE, y: cy - 0.2 * SIZE, z: 0 };
      return { landmarks, handedness: 'Left', gesture: 'None', gestureScore: 0 };
    };
    const pointing = palm(0.3, 0.5);
    const click = (dx: number): HandObservation => palm(0.7 - dx * SIZE, 0.6);
    const interp = new PalmInterpreter();
    let t = 0;
    const step = (hands: HandObservation[], seconds: number): void => {
      for (const end = t + seconds - 1e-9; t < end; t += 1 / 30) interp.update(hands, 1, t);
    };
    step([pointing, click(0)], 1);
    interp.clickSuspended = true;
    const fit = new ClickFit();
    fit.start(t);
    let result: ClickFitEvent | null = null;
    const fitStep = (hands: HandObservation[], seconds: number): void => {
      for (const end = t + seconds - 1e-9; t < end; t += 1 / 30) {
        interp.update(hands, 1, t);
        result = fit.feed(interp.clickHand.index >= 0 ? interp.clickHand : null, 1, t) ?? result;
      }
    };
    fitStep([pointing, click(0)], 0.8);
    fitStep([pointing, click(-1)], 0.8);
    expect(interp.frame.pressed).toBe(false);
    const done = result as ClickFitEvent | null;
    expect(done?.kind).toBe('done');
    if (done?.kind !== 'done') return;
    expect(done.click.x).toBeCloseTo(-1, 2);
    interp.clickSuspended = false;
    interp.configure({ ...defaultSettings().palm, click: done.click }, 'hold');
    step([pointing, click(0)], 1);
    step([pointing, click(-0.4)], 0.5);
    expect(interp.frame.pressed).toBe(false);
    step([pointing, click(-0.6)], 0.5);
    expect(interp.frame.pressed).toBe(true);
  });
});
