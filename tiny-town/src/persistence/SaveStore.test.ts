import { describe, expect, it } from 'vitest';
import { PLOT_DEPTH, PLOT_WIDTH, SAVE_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../game/config';
import { createGameBus } from '../game/events';
import { buildSampleTown } from '../town/sampleTown';
import { serializeTown } from '../town/serialize';
import { TownEditor } from '../town/TownEditor';
import { TownState } from '../town/TownState';
import { createSeededRandom } from '../utils/random';
import { AUTOSAVE_DEBOUNCE_MS, DEFAULT_SETTINGS, SaveStore, type StorageLike, type TimerApi } from './SaveStore';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

class QuotaStorage extends MemoryStorage {
  override setItem(): void {
    const error = new Error('The quota has been exceeded.');
    error.name = 'QuotaExceededError';
    throw error;
  }
}

class BlockedStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('SecurityError: access denied');
  }
  setItem(): void {
    throw new Error('SecurityError: access denied');
  }
  removeItem(): void {
    throw new Error('SecurityError: access denied');
  }
}

/** Manual clock: advance(ms) fires due timers in order. */
class FakeTimers implements TimerApi {
  private now = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  setTimeout(callback: () => void, ms: number): number {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = target;
  }
  get size(): number {
    return this.timers.size;
  }
}

function setup(storage: StorageLike | null = new MemoryStorage()) {
  const bus = createGameBus();
  const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), bus, createSeededRandom(1));
  const timers = new FakeTimers();
  const store = new SaveStore({ storage, timers, now: () => 1234 });
  const written: number[] = [];
  bus.on('save:written', ({ at }) => written.push(at));
  return { bus, editor, timers, store, written, storage };
}

const road = (x: number, z: number) => ({ type: 'paint-ground' as const, kind: 'road' as const, cell: { x, z } });

describe('SaveStore basic API', () => {
  it('has/read/write/clear round-trip a save under SAVE_STORAGE_KEY', () => {
    const { store, editor, storage } = setup();
    expect(store.available).toBe(true);
    expect(store.has()).toBe(false);
    expect(store.read()).toBeNull();

    buildSampleTown(editor);
    const save = editor.serialize({ targetX: 0, targetZ: 0, azimuth: 1, polar: 1, distance: 20 });
    expect(store.write(save)).toBe(true);
    expect((storage as MemoryStorage).data.has(SAVE_STORAGE_KEY)).toBe(true);
    expect(store.has()).toBe(true);
    expect(store.read()).toEqual(save);

    store.clear();
    expect(store.has()).toBe(false);
  });

  it('corrupted or foreign JSON in storage reads as "no save" without throwing', () => {
    for (const text of ['{broken', 'null', '{"hello":"world"}', '{"version":99}', '']) {
      const storage = new MemoryStorage();
      storage.data.set(SAVE_STORAGE_KEY, text);
      const { store } = setup(storage);
      expect(() => store.read()).not.toThrow();
      expect(store.read()).toBeNull();
      expect(store.has()).toBe(false);
      expect(store.lastError).not.toBeNull();
    }
  });

  it('quota errors on write return false and set lastError, never throw', () => {
    const { store, editor } = setup(new QuotaStorage());
    let result: boolean | undefined;
    expect(() => (result = store.write(editor.serialize()))).not.toThrow();
    expect(result).toBe(false);
    expect(store.lastError).toMatch(/QuotaExceededError/);
  });

  it('blocked storage (SecurityError on every call) never throws', () => {
    const { store, editor } = setup(new BlockedStorage());
    expect(() => {
      expect(store.has()).toBe(false);
      expect(store.read()).toBeNull();
      expect(store.write(editor.serialize())).toBe(false);
      store.clear();
      expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
      store.setSettings({ muted: true });
    }).not.toThrow();
  });

  it('with storage null everything is a harmless no-op', () => {
    const { store, editor } = setup(null);
    expect(store.available).toBe(false);
    expect(store.has()).toBe(false);
    expect(store.write(editor.serialize())).toBe(false);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(store.setSettings({ volume: 0.2 })).toEqual({ ...DEFAULT_SETTINGS, volume: 0.2 });
  });

  it('default construction does not throw in a non-browser environment', () => {
    expect(() => new SaveStore().has()).not.toThrow();
  });

  it('a save written for a different plot size is clamped on read', () => {
    const storage = new MemoryStorage();
    storage.data.set(SAVE_STORAGE_KEY, JSON.stringify(serializeTown(new TownState(40, 40))));
    const { store } = setup(storage);
    expect(store.read()).toMatchObject({ width: PLOT_WIDTH, depth: PLOT_DEPTH });
  });
});

describe('SaveStore autosave', () => {
  it(`writes once, ${AUTOSAVE_DEBOUNCE_MS} ms after the LAST town:changed (debounced)`, () => {
    const { bus, store, editor, timers, written, storage } = setup();
    // Attaching twice replaces the first subscription (the stray bus is never listened to again).
    const stray = createGameBus();
    store.attachAutosave(stray, () => editor.serialize());
    store.attachAutosave(bus, () => editor.serialize());
    stray.emit('town:changed', { changes: [], cause: 'edit' });
    expect(store.pending).toBe(false);

    editor.apply(road(1, 1), 'road');
    timers.advance(600);
    editor.apply(road(2, 1), 'road');
    timers.advance(600);
    expect((storage as MemoryStorage).writes).toBe(0);
    expect(store.pending).toBe(true);
    timers.advance(400);
    expect((storage as MemoryStorage).writes).toBe(1);
    expect(store.pending).toBe(false);
    expect(written).toEqual([1234]);
    expect(store.read()).toEqual(editor.serialize());
  });

  it('a whole drag stroke produces one write', () => {
    const { bus, store, editor, timers, storage } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    editor.beginStroke();
    for (let x = 0; x < 20; x += 1) editor.apply(road(x, 3), 'road');
    editor.endStroke();
    timers.advance(AUTOSAVE_DEBOUNCE_MS);
    expect((storage as MemoryStorage).writes).toBe(1);
  });

  it('undo and redo also autosave', () => {
    const { bus, store, editor, timers, storage } = setup();
    editor.apply(road(1, 1), 'road');
    store.attachAutosave(bus, () => editor.serialize());
    editor.undo();
    timers.advance(AUTOSAVE_DEBOUNCE_MS);
    expect(store.read()?.ground).toEqual([['field', PLOT_WIDTH * PLOT_DEPTH]]);
    editor.redo();
    timers.advance(AUTOSAVE_DEBOUNCE_MS);
    expect((storage as MemoryStorage).writes).toBe(2);
    expect(store.read()).toEqual(editor.serialize());
  });

  it("cause 'load' never schedules a write", () => {
    const { bus, store, editor, timers, storage } = setup();
    const source = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(2));
    buildSampleTown(source);
    store.attachAutosave(bus, () => editor.serialize());
    editor.load(source.serialize());
    expect(store.pending).toBe(false);
    timers.advance(5000);
    expect((storage as MemoryStorage).writes).toBe(0);
  });

  it("cause 'reset' (New town) cancels the pending write and clears the save", () => {
    const { bus, store, editor, timers, storage } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    editor.apply(road(1, 1), 'road');
    timers.advance(AUTOSAVE_DEBOUNCE_MS);
    expect(store.has()).toBe(true);
    editor.apply(road(2, 1), 'road');
    editor.reset();
    expect(store.pending).toBe(false);
    expect(store.has()).toBe(false);
    timers.advance(5000);
    expect((storage as MemoryStorage).writes).toBe(1);
  });

  it('autosaveEnabled=false ignores edits and resets (test states never touch the player save)', () => {
    const { bus, store, editor, timers, storage } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    editor.apply(road(1, 1), 'road');
    timers.advance(AUTOSAVE_DEBOUNCE_MS);
    const saved = store.read();
    editor.apply(road(2, 1), 'road'); // pending…
    store.autosaveEnabled = false;
    editor.reset();
    buildSampleTown(editor);
    timers.advance(5000);
    expect((storage as MemoryStorage).writes).toBe(1);
    expect(store.read()).toEqual(saved);
  });

  it('flush() writes a pending autosave immediately; nothing pending → false', () => {
    const { bus, store, editor, storage } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    expect(store.flush()).toBe(false);
    editor.apply(road(1, 1), 'road');
    expect(store.flush()).toBe(true);
    expect((storage as MemoryStorage).writes).toBe(1);
    expect(store.pending).toBe(false);
  });

  it('quota errors during autosave are absorbed', () => {
    const { bus, store, editor, timers, written } = setup(new QuotaStorage());
    store.attachAutosave(bus, () => editor.serialize());
    editor.apply(road(1, 1), 'road');
    expect(() => timers.advance(AUTOSAVE_DEBOUNCE_MS)).not.toThrow();
    expect(written).toEqual([]);
    expect(store.lastError).toMatch(/Quota/);
  });

  it('a throwing snapshot callback is absorbed', () => {
    const { bus, store, editor, timers } = setup();
    store.attachAutosave(bus, () => {
      throw new Error('camera not ready');
    });
    editor.apply(road(1, 1), 'road');
    expect(() => timers.advance(AUTOSAVE_DEBOUNCE_MS)).not.toThrow();
    expect(store.lastError).toMatch(/camera not ready/);
  });

  it('detachAutosave / dispose stop listening and cancel the pending write', () => {
    const { bus, store, editor, timers, storage } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    editor.apply(road(1, 1), 'road');
    store.dispose();
    timers.advance(5000);
    editor.apply(road(2, 1), 'road');
    timers.advance(5000);
    expect((storage as MemoryStorage).writes).toBe(0);
    expect(timers.size).toBe(0);
  });

  it('end to end: edit → autosave → fresh editor loads an identical town', () => {
    const { bus, store, editor, timers } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    buildSampleTown(editor);
    editor.apply({ type: 'place-object', kind: 'tree-c', cell: { x: 0, z: 23 }, rotation: 1 }, 'tree-c');
    timers.advance(AUTOSAVE_DEBOUNCE_MS);

    const other = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(77));
    const save = store.read();
    expect(save).not.toBeNull();
    other.load(save!);
    expect(other.serialize()).toEqual(editor.serialize());
  });
});

describe('SaveStore settings', () => {
  it('defaults when nothing is stored', () => {
    const { store } = setup();
    expect(store.getSettings()).toEqual({ muted: false, volume: 0.8, grid: true });
  });

  it('setSettings merges, clamps volume and persists under SETTINGS_STORAGE_KEY', () => {
    const { store, storage } = setup();
    expect(store.setSettings({ muted: true })).toEqual({ muted: true, volume: 0.8, grid: true });
    expect(store.setSettings({ volume: 7 })).toEqual({ muted: true, volume: 1, grid: true });
    expect(store.setSettings({ volume: -2, grid: false })).toEqual({ muted: true, volume: 0, grid: false });
    expect(JSON.parse((storage as MemoryStorage).data.get(SETTINGS_STORAGE_KEY)!)).toEqual({ muted: true, volume: 0, grid: false });
    expect(store.getSettings()).toEqual({ muted: true, volume: 0, grid: false });
  });

  it('ignores invalid patch fields', () => {
    const { store } = setup();
    expect(store.setSettings({ volume: Number.NaN, muted: 'yes' as unknown as boolean })).toEqual(DEFAULT_SETTINGS);
  });

  it('corrupted or partial settings fall back to defaults field by field', () => {
    const storage = new MemoryStorage();
    const { store } = setup(storage);
    storage.data.set(SETTINGS_STORAGE_KEY, '{nope');
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    storage.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ muted: true, volume: 'loud', grid: 0 }));
    expect(store.getSettings()).toEqual({ ...DEFAULT_SETTINGS, muted: true });
    storage.data.set(SETTINGS_STORAGE_KEY, '[1,2]');
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('clearing the save keeps the settings', () => {
    const { store } = setup();
    store.setSettings({ muted: true });
    store.clear();
    expect(store.getSettings().muted).toBe(true);
  });
});
