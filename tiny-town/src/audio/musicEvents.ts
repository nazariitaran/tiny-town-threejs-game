/**
 * WP-13 SHIM — music events that are not in the contract file (src/game/events.ts) yet.
 * Requested in the WP-13 hand-off: add these three entries to `GameEvents`, then delete this file
 * and replace `musicBus(bus)` with `bus` at its call sites (AudioManager, UiRoot).
 *
 * The events travel on the SAME EventBus instance (it is keyed by string at runtime); this only
 * widens the type.
 */
import type { EventBus, GameBus, GameEvents } from '../game/events';

export type MusicEvents = {
  /** UI → audio: switch background music on/off (persisted). */
  'intent:set-music': { enabled: boolean };
  /** UI → audio: music volume 0..1 (persisted). */
  'intent:set-music-volume': { volume: number };
  /** audio → UI: current music settings. */
  'music:changed': { enabled: boolean; volume: number };
};

export type MusicBus = EventBus<GameEvents & MusicEvents>;

export const musicBus = (bus: GameBus): MusicBus => bus as unknown as MusicBus;
