import { afterEach, describe, expect, it, vi } from 'vitest';
import { CROWD_DUCK_DB, CROWD_LOOP_START_S, CROWD_PERIOD_S, CROWD_TRIM, crowdGain, CrowdLoop } from './CrowdLoop';

class FakeParam {
  value = 0;
  target = 0;
  ramps = 0;
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
    this.target = value;
  }
  setTargetAtTime(value: number): void {
    this.target = value;
    this.ramps += 1;
  }
}

class FakeSource {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started: [number, number] | null = null;
  stopped = false;
  connect(): void {}
  disconnect(): void {}
  start(when: number, offset: number): void {
    this.started = [when, offset];
  }
  stop(): void {
    this.stopped = true;
  }
}

function fakeContext() {
  const gain = new FakeParam();
  const sources: FakeSource[] = [];
  const ctx = {
    currentTime: 0,
    state: 'running',
    createGain: () => ({ gain, connect() {}, disconnect() {} }),
    createBufferSource: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    decodeAudioData: async () => ({ duration: 29 }),
  };
  return { ctx, gain, sources };
}

/** Lets the fetch → arrayBuffer → decode chain finish. */
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

afterEach(() => vi.unstubAllGlobals());

describe('crowd gain', () => {
  it('is the level × trim, ducked in the menu, clamped to 0..1', () => {
    expect(crowdGain(0, false)).toBe(0);
    expect(crowdGain(1, false)).toBe(CROWD_TRIM);
    expect(crowdGain(0.5, false)).toBe(CROWD_TRIM / 2);
    expect(crowdGain(3, false)).toBe(CROWD_TRIM);
    expect(crowdGain(-1, false)).toBe(0);
    expect(crowdGain(Number.NaN, false)).toBe(0);
    expect(crowdGain(1, true)).toBeCloseTo(CROWD_TRIM * 10 ** (CROWD_DUCK_DB / 20), 6);
  });
});

describe('CrowdLoop', () => {
  function attached() {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    const fake = fakeContext();
    const crowd = new CrowdLoop();
    crowd.attach(fake.ctx as never, {} as never);
    crowd.setActive(true);
    return { ...fake, crowd, fetched };
  }

  it('fetches nothing until the crowd should be heard, then loops inside the buffer', async () => {
    const { ctx, gain, sources, crowd, fetched } = attached();
    crowd.setLevel(0);
    expect(fetched).toEqual([]);
    expect(crowd.state).toMatchObject({ requested: false, loaded: false, playing: false, gain: 0 });
    crowd.setLevel(0.6);
    expect(fetched.length).toBe(1);
    expect(fetched[0]).toContain('assets/audio/stadium-crowd.mp3');
    expect(crowd.state).toMatchObject({ requested: true, playing: false, gain: 0, level: 0.6 });
    await settle();
    crowd.setLevel(0.6);
    crowd.setLevel(0.6);
    expect(fetched.length).toBe(1);
    expect(sources.length).toBe(1);
    expect(sources[0]).toMatchObject({ loop: true, loopStart: CROWD_LOOP_START_S, loopEnd: CROWD_LOOP_START_S + CROWD_PERIOD_S, started: [0, CROWD_LOOP_START_S] });
    expect(gain.target).toBeCloseTo(0.6 * CROWD_TRIM, 6);
    expect(crowd.state).toMatchObject({ playing: true, loaded: true, starts: 1 });
    // An unchanged level schedules nothing more.
    const ramps = gain.ramps;
    for (let i = 0; i < 50; i += 1) crowd.setLevel(0.6);
    crowd.setLevel(0.603);
    expect(gain.ramps).toBe(ramps);
    crowd.setLevel(0.9);
    expect(gain.ramps).toBe(ramps + 1);
    expect(ctx.currentTime).toBe(0);
  });

  it('fades to silence and then stops the source; the next match starts a new one without another fetch', async () => {
    const { ctx, gain, sources, crowd, fetched } = attached();
    crowd.setLevel(1);
    await settle();
    crowd.setLevel(1);
    ctx.currentTime = 10;
    crowd.setLevel(0);
    expect(gain.target).toBe(0);
    expect(sources[0].stopped).toBe(false);
    ctx.currentTime = 10.5;
    crowd.setLevel(0);
    expect(sources[0].stopped).toBe(false);
    ctx.currentTime = 11.1;
    crowd.setLevel(0);
    expect(sources[0].stopped).toBe(true);
    expect(crowd.state.playing).toBe(false);
    crowd.setLevel(0.5);
    expect(sources.length).toBe(2);
    expect(fetched.length).toBe(1);
    expect(gain.target).toBeCloseTo(0.5 * CROWD_TRIM, 6);
  });

  it('muted or hidden is silent whatever the level; the menu ducks it', async () => {
    const { gain, crowd } = attached();
    crowd.setLevel(1);
    await settle();
    crowd.setLevel(1);
    expect(gain.target).toBe(CROWD_TRIM);
    crowd.setDucked(true);
    expect(gain.target).toBeCloseTo(CROWD_TRIM * 10 ** (CROWD_DUCK_DB / 20), 6);
    crowd.setDucked(false);
    crowd.setActive(false);
    expect(gain.target).toBe(0);
    expect(crowd.state.gain).toBe(0);
    crowd.setLevel(1);
    expect(gain.target).toBe(0);
    crowd.setActive(true);
    expect(gain.target).toBe(CROWD_TRIM);
  });

  it('before unlock nothing happens; a decode that lands after dispose is dropped; a failed load warns once', async () => {
    const idle = new CrowdLoop();
    idle.setLevel(1);
    expect(idle.state).toMatchObject({ requested: false, playing: false, level: 1 });

    const { sources, crowd } = attached();
    crowd.setLevel(1);
    crowd.dispose();
    await settle();
    crowd.setLevel(1);
    expect(sources.length).toBe(0);
    expect(crowd.state.loaded).toBe(false);

    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeContext();
    const broken = new CrowdLoop();
    broken.attach(fake.ctx as never, {} as never);
    broken.setActive(true);
    broken.setLevel(1);
    await settle();
    for (let i = 0; i < 5; i += 1) broken.setLevel(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fake.sources.length).toBe(0);
    warn.mockRestore();
  });
});
