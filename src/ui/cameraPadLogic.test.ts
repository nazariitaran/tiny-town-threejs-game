import { describe, expect, it } from 'vitest';
import { cameraPadVisible, HOLD_DELAY_MS, HOLD_INTERVAL_MS, HoldRepeat, type RepeatTimers } from './cameraPadLogic';

/** Manual clock: advance(ms) runs every timer due by then, in order. */
class FakeTimers implements RepeatTimers {
  now = 0;
  private next = 1;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  get count(): number {
    return this.pending.size;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let due: [number, { at: number; callback: () => void }] | null = null;
      for (const entry of this.pending) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = end;
  }
}

describe('cameraPadVisible', () => {
  it('shows in the building phase when the setting is on', () => {
    expect(cameraPadVisible('building', true, null)).toBe(true);
    expect(cameraPadVisible('building', false, null)).toBe(false);
  });

  it('head and palm tracking show it with the setting off; hand tracking does not', () => {
    expect(cameraPadVisible('building', false, 'head')).toBe(true);
    expect(cameraPadVisible('building', false, 'head-hand')).toBe(true);
    expect(cameraPadVisible('building', false, 'palms')).toBe(true);
    expect(cameraPadVisible('building', false, 'hand')).toBe(false);
  });

  it('never shows outside the building phase', () => {
    for (const phase of ['loading', 'title', 'menu', 'error'] as const) {
      expect(cameraPadVisible(phase, true, 'head'), phase).toBe(false);
    }
  });
});

describe('HoldRepeat', () => {
  it('steps at once, after the delay, then every interval until stopped', () => {
    const timers = new FakeTimers();
    const repeat = new HoldRepeat(timers);
    let steps = 0;
    repeat.start(() => (steps += 1));
    expect(steps).toBe(1);
    timers.advance(HOLD_DELAY_MS - 1);
    expect(steps).toBe(1);
    timers.advance(1);
    expect(steps).toBe(2);
    timers.advance(HOLD_INTERVAL_MS * 3);
    expect(steps).toBe(5);
    repeat.stop();
    expect(repeat.active).toBe(false);
    timers.advance(5000);
    expect(steps).toBe(5);
    expect(timers.count).toBe(0);
  });

  it('a quick press is one step', () => {
    const timers = new FakeTimers();
    const repeat = new HoldRepeat(timers);
    let steps = 0;
    repeat.start(() => (steps += 1));
    timers.advance(100);
    repeat.stop();
    timers.advance(2000);
    expect(steps).toBe(1);
  });

  it('starting again replaces the running repeat', () => {
    const timers = new FakeTimers();
    const repeat = new HoldRepeat(timers);
    const fired: string[] = [];
    repeat.start(() => fired.push('a'));
    timers.advance(HOLD_DELAY_MS);
    repeat.start(() => fired.push('b'));
    timers.advance(HOLD_DELAY_MS);
    expect(fired).toEqual(['a', 'a', 'b', 'b']);
    expect(timers.count).toBe(1);
  });

  it('a step that stops the repeat is not rescheduled', () => {
    const timers = new FakeTimers();
    const repeat = new HoldRepeat(timers);
    let steps = 0;
    repeat.start(() => {
      steps += 1;
      if (steps === 2) repeat.stop();
    });
    timers.advance(5000);
    expect(steps).toBe(2);
    expect(timers.count).toBe(0);
  });
});
