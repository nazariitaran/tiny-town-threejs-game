import { describe, expect, it } from 'vitest';
import { MUSIC_POSITION_STORAGE_KEY, PLOT_DEPTH, PLOT_WIDTH, SAVE_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../game/config';
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

  it('an older (v1/v2/v3) save under the same key is rejected, so the game starts a fresh town', () => {
    const v1 = { version: 1, width: 24, depth: 24, ground: [['field', 576]], objects: [{ id: 1, kind: 'tree-a', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 }], edges: [], nextObjectId: 2 };
    const v2 = { ...v1, version: 2, width: PLOT_WIDTH, depth: PLOT_DEPTH, ground: [['field', PLOT_WIDTH * PLOT_DEPTH]] };
    // v3 isn't migrated either: building footprints changed in v4.
    const v3 = { ...v2, version: 3, objects: [{ id: 1, kind: 'cottage', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 }] };
    for (const [version, old] of [[1, v1], [2, v2], [3, v3]] as const) {
      const storage = new MemoryStorage();
      storage.data.set(SAVE_STORAGE_KEY, JSON.stringify(old));
      const { store } = setup(storage);
      expect(store.read()).toBeNull();
      expect(store.has()).toBe(false);
      expect(store.lastError).toBe(`No migration from save version ${version}`);
    }
  });

  it('a v4 save of the sample town written by an earlier session reads back unchanged and loads', () => {
    const source = setup();
    buildSampleTown(source.editor);
    const storage = new MemoryStorage();
    storage.data.set(SAVE_STORAGE_KEY, JSON.stringify(serializeTown(source.editor.state)));
    const { store, editor } = setup(storage);
    const save = store.read()!;
    expect([save.version, save.width, save.depth]).toEqual([4, PLOT_WIDTH, PLOT_DEPTH]);
    expect(save).toEqual(serializeTown(source.editor.state));
    editor.load(save);
    expect(editor.state.stats()).toEqual(source.editor.state.stats());
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
    // Attaching again replaces the first subscription.
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

  it('a rename schedules a write with the new name; reset and load names never do', () => {
    const { bus, store, editor, timers, storage } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    editor.reset('Puddleton');
    expect(store.pending).toBe(false);
    editor.rename('Bumbleford');
    expect(store.pending).toBe(true);
    timers.advance(AUTOSAVE_DEBOUNCE_MS);
    expect((storage as MemoryStorage).writes).toBe(1);
    expect(store.read()?.name).toBe('Bumbleford');
    editor.load(store.read()!);
    expect(store.pending).toBe(false);
  });

  it('autosaveEnabled=false ignores renames too', () => {
    const { bus, store, editor, timers, storage } = setup();
    store.attachAutosave(bus, () => editor.serialize());
    store.autosaveEnabled = false;
    editor.rename('Bumbleford');
    timers.advance(5000);
    expect((storage as MemoryStorage).writes).toBe(0);
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
    editor.apply({ type: 'place-object', kind: 'birch', cell: { x: 0, z: 23 }, rotation: 1 }, 'birch');
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
    expect(store.getSettings()).toEqual({ muted: false, volume: 0.8, grid: true, music: true, musicVolume: 0.5, timeMode: 'auto', graphics: 'medium' });
  });

  it('setSettings merges, clamps volume and persists under SETTINGS_STORAGE_KEY', () => {
    const { store, storage } = setup();
    expect(store.setSettings({ muted: true })).toEqual({ muted: true, volume: 0.8, grid: true, music: true, musicVolume: 0.5, timeMode: 'auto', graphics: 'medium' });
    expect(store.setSettings({ volume: 7 })).toEqual({ muted: true, volume: 1, grid: true, music: true, musicVolume: 0.5, timeMode: 'auto', graphics: 'medium' });
    expect(store.setSettings({ volume: -2, grid: false })).toEqual({ muted: true, volume: 0, grid: false, music: true, musicVolume: 0.5, timeMode: 'auto', graphics: 'medium' });
    expect(JSON.parse((storage as MemoryStorage).data.get(SETTINGS_STORAGE_KEY)!)).toEqual({ muted: true, volume: 0, grid: false, music: true, musicVolume: 0.5, timeMode: 'auto', graphics: 'medium' });
    expect(store.getSettings()).toEqual({ muted: true, volume: 0, grid: false, music: true, musicVolume: 0.5, timeMode: 'auto', graphics: 'medium' });
  });

  it('round-trips timeMode and falls back to auto for bad values', () => {
    const storage = new MemoryStorage();
    const { store } = setup(storage);
    expect(store.setSettings({ timeMode: 'night' }).timeMode).toBe('night');
    expect(store.getSettings().timeMode).toBe('night');
    expect(store.setSettings({ timeMode: 'dusk' as unknown as 'day' }).timeMode).toBe('night');
    storage.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ timeMode: 'noon', grid: false }));
    expect(store.getSettings()).toEqual({ ...DEFAULT_SETTINGS, grid: false, timeMode: 'auto', graphics: 'medium' });
  });

  it('round-trips the graphics preset and falls back to medium for bad values', () => {
    const storage = new MemoryStorage();
    const { store } = setup(storage);
    expect(store.getSettings().graphics).toBe('medium');
    expect(store.setSettings({ graphics: 'low' }).graphics).toBe('low');
    expect(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)!).graphics).toBe('low');
    expect(setup(storage).store.getSettings().graphics).toBe('low'); // a fresh store (next page load)
    expect(store.setSettings({ graphics: 'ultra' as unknown as 'high' }).graphics).toBe('low'); // invalid patch ignored
    expect(store.setSettings({ graphics: 'high', muted: true })).toEqual({ ...DEFAULT_SETTINGS, muted: true, graphics: 'high' });
    for (const bad of ['ultra', 'LOW', '', 2, null, true, { preset: 'low' }]) {
      storage.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ graphics: bad, grid: false }));
      expect(store.getSettings(), JSON.stringify(bad)).toEqual({ ...DEFAULT_SETTINGS, grid: false, graphics: 'medium' });
    }
    // Settings without a graphics field load as Medium and keep their other fields.
    storage.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ muted: true, volume: 0.3, grid: false, music: true, musicVolume: 0.5, timeMode: 'night' }));
    expect(store.getSettings()).toEqual({ muted: true, volume: 0.3, grid: false, music: true, musicVolume: 0.5, timeMode: 'night', graphics: 'medium' });
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

  it('music settings: persist, clamp, and old settings without them load with defaults', () => {
    const storage = new MemoryStorage();
    const { store } = setup(storage);
    storage.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ muted: true, volume: 0.3, grid: false }));
    expect(store.getSettings()).toEqual({ muted: true, volume: 0.3, grid: false, music: true, musicVolume: 0.5, timeMode: 'auto', graphics: 'medium' });
    expect(store.setSettings({ music: false, musicVolume: 3 })).toMatchObject({ music: false, musicVolume: 1, volume: 0.3 });
    expect(store.setSettings({ musicVolume: 0.25, music: 'no' as unknown as boolean })).toMatchObject({ music: false, musicVolume: 0.25 });
    storage.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ music: 1, musicVolume: 'x' }));
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('clearing the save keeps the settings', () => {
    const { store } = setup();
    store.setSettings({ muted: true });
    store.clear();
    expect(store.getSettings().muted).toBe(true);
  });
});

describe('SaveStore — music position', () => {
  const TRACK = '/assets/music/foundation-of-gold.mp3';

  it('round-trips under its own key and leaves the settings alone', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore({ storage });
    expect(store.getMusicPosition()).toBeNull();
    store.setMusicPosition({ track: TRACK, time: 212.5 });
    expect(JSON.parse(storage.data.get(MUSIC_POSITION_STORAGE_KEY)!)).toEqual({ track: TRACK, time: 212.5 });
    expect(storage.data.has(SETTINGS_STORAGE_KEY)).toBe(false);
    expect(new SaveStore({ storage }).getMusicPosition()).toEqual({ track: TRACK, time: 212.5 });
  });

  it('is kept when the town save is cleared', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore({ storage });
    store.setMusicPosition({ track: TRACK, time: 40 });
    store.clear();
    expect(store.getMusicPosition()).toEqual({ track: TRACK, time: 40 });
  });

  it('reads invalid JSON or an invalid record as null', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore({ storage });
    storage.data.set(MUSIC_POSITION_STORAGE_KEY, '{not json');
    expect(store.getMusicPosition()).toBeNull();
    storage.data.set(MUSIC_POSITION_STORAGE_KEY, JSON.stringify({ track: TRACK, time: -3 }));
    expect(store.getMusicPosition()).toBeNull();
  });

  it('ignores an invalid position on write', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore({ storage });
    store.setMusicPosition({ track: TRACK, time: Number.NaN });
    expect(storage.writes).toBe(0);
  });

  it('never throws with blocked, full or missing storage', () => {
    for (const storage of [new BlockedStorage(), new QuotaStorage(), null]) {
      const store = new SaveStore({ storage });
      expect(() => store.setMusicPosition({ track: TRACK, time: 10 })).not.toThrow();
      expect(store.getMusicPosition()).toBeNull();
    }
  });
});
