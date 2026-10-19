/** GestureRouter in Node, with just enough of a DOM: elements that can be hit, hovered and clicked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGestureFrame, type GestureCommand, type GestureFrame } from './protocol';

class FakeElement {
  readonly classes = new Set<string>();
  readonly classList = { add: (c: string) => this.classes.add(c), remove: (c: string) => this.classes.delete(c) };
  clicks = 0;
  disabled = false;
  constructor(
    readonly attributes: Record<string, string> = {},
    readonly clickable = true,
  ) {}
  closest(): FakeElement | null {
    return this.clickable ? this : null;
  }
  click(): void {
    this.clicks += 1;
  }
  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  get textContent(): string {
    return '';
  }
  focus(): void {}
}

const canvas = new FakeElement({}, false);
let hit: FakeElement = canvas;
const keys: string[] = [];

beforeEach(() => {
  hit = canvas;
  keys.length = 0;
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLInputElement', class extends FakeElement {});
  vi.stubGlobal('KeyboardEvent', class {
    constructor(
      readonly type: string,
      readonly init: { code: string },
    ) {}
  });
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 500, dispatchEvent: (event: { init: { code: string } }) => keys.push(event.init.code) });
  vi.stubGlobal('document', { elementFromPoint: () => hit });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function router(): Promise<{ router: import('./GestureRouter').GestureRouter; events: Array<[string, unknown]> }> {
  const { GestureRouter } = await import('./GestureRouter');
  const events: Array<[string, unknown]> = [];
  const bus = { emit: (type: string, payload: unknown) => events.push([type, payload]) };
  return { router: new GestureRouter(bus as never, canvas as never), events };
}

function frame(patch: Partial<GestureFrame> = {}): GestureFrame {
  return Object.assign(createGestureFrame(), { present: true, x: 0.5, y: 0.5 }, patch);
}

const phases = (events: Array<[string, unknown]>): string[] =>
  events.filter(([type]) => type === 'intent:virtual-pointer').map(([, payload]) => (payload as { phase: string }).phase).filter((p) => p !== 'move');

describe('GestureRouter', () => {
  it('sends every command where it belongs, and nothing else to the game', async () => {
    const { commandRoute } = await import('./GestureRouter');
    const all: GestureCommand[] = ['rotate', 'cancel', 'pause', 'recentre'];
    expect(all.map(commandRoute)).toEqual(['rotate', 'escape', 'none', 'none']);
    const { router: r, events } = await router();
    let t = 0;
    for (const command of all) r.apply(frame({ command }), (t += 0.03));
    expect(events.filter(([type]) => type === 'intent:rotate')).toHaveLength(1);
    expect(keys).toEqual(['Escape']);
  });

  it('a tap on the canvas is a press and release at the point; on a control, a click', async () => {
    const { router: r, events } = await router();
    r.apply(frame({ tap: true, x: 0.2, y: 0.4 }), 0);
    expect(phases(events)).toEqual(['down', 'up']);
    const down = events.find(([, p]) => (p as { phase?: string }).phase === 'down')![1] as { clientX: number; clientY: number };
    expect([down.clientX, down.clientY]).toEqual([200, 200]);
    const button = new FakeElement();
    hit = button;
    r.apply(frame({ tap: true }), 0.1);
    expect(button.clicks).toBe(1);
    expect(r.counts.taps).toBe(2);
  });

  it('a press held across frames stays down until released, and pausing releases it', async () => {
    const { router: r, events } = await router();
    let t = 0;
    for (let i = 0; i < 10; i += 1) r.apply(frame({ pressed: true }), (t += 0.03));
    expect(phases(events)).toEqual(['down']);
    r.apply(frame({ pressed: true, paused: true }), (t += 0.03));
    expect(phases(events)).toEqual(['down', 'up']);
    r.apply(frame({ tap: true, paused: true }), (t += 0.03));
    expect(phases(events)).toEqual(['down', 'up']);
  });

  it('a held press on a [data-repeat] control clicks at once, then repeats until release', async () => {
    const { router: r } = await router();
    const { REPEAT_DELAY_S, REPEAT_EVERY_S } = await import('./GestureRouter');
    const step = new FakeElement({ 'data-repeat': '' });
    hit = step;
    let t = 0;
    r.apply(frame({ pressed: true }), t);
    expect(step.clicks).toBe(1);
    const holdS = REPEAT_DELAY_S + 3 * REPEAT_EVERY_S + 0.01;
    for (; t < holdS; t += 0.01) r.apply(frame({ pressed: true }), t);
    expect(step.clicks).toBe(5);
    r.apply(frame({ pressed: false }), t);
    expect(step.clicks).toBe(5);

    const plain = new FakeElement();
    hit = plain;
    for (let i = 0; i < 50; i += 1) r.apply(frame({ pressed: true }), (t += 0.03));
    expect(plain.clicks).toBe(0);
    r.apply(frame({ pressed: false }), (t += 0.03));
    expect(plain.clicks).toBe(1);
  });

  it('dwell clicks a control once, but keeps stepping a [data-repeat] control', async () => {
    const { router: r } = await router();
    r.setDwell(1);
    const plain = new FakeElement();
    hit = plain;
    let t = 0;
    for (; t < 3.5; t += 0.05) r.apply(frame(), t);
    expect(plain.clicks).toBe(1);
    const step = new FakeElement({ 'data-repeat': '' });
    hit = step;
    // Elsewhere on the screen: the re-arm distance from the last dwell click.
    for (const end = t + 3.5; t < end; t += 0.05) r.apply(frame({ x: 0.7 }), t);
    expect(step.clicks).toBe(3);
    // No dwell while paused.
    const other = new FakeElement();
    hit = other;
    for (const end = t + 3; t < end; t += 0.05) r.apply(frame({ x: 0.2, paused: true }), t);
    expect(other.clicks).toBe(0);
  });
});
