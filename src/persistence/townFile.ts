/**
 * Town files (WP-21): a town downloaded to the player's drive and opened again later, on any
 * machine. PURE (no DOM, no three.js); tested in townFile.test.ts. UiRoot reads the file and decodes
 * it here (so the confirm can name the town); Game encodes the live town for a download.
 *
 * The file is JSON: { app: 'tiny-town', kind: 'town', format: 1, exportedAt, town: SavedTown }.
 * `town` is exactly what the autosave stores (the town, its name, the camera pose), so decoding goes
 * through the same parseSave: never trusted, migrated, clamped to the plot. A bare save (the JSON
 * the game keeps in localStorage) opens too.
 */
import { parseSave, type ParseOptions } from '../town/serialize';
import { townFileStem } from '../town/townName';
import type { SavedTown } from '../town/types';

export const TOWN_FILE_APP = 'tiny-town';
export const TOWN_FILE_KIND = 'town';
/** The wrapper's own version (the town inside carries the save version). */
export const TOWN_FILE_FORMAT = 1;
/** A full 64 × 64 town is tens of KB; anything this big is not a town file. */
export const TOWN_FILE_MAX_BYTES = 2_000_000;
export const TOWN_FILE_EXTENSION = '.tinytown.json';
export const TOWN_FILE_MIME = 'application/json';

export interface TownFile {
  app: typeof TOWN_FILE_APP;
  kind: typeof TOWN_FILE_KIND;
  format: number;
  /** When the town was downloaded (ISO 8601). */
  exportedAt: string;
  town: SavedTown;
}

export interface DecodedTownFile {
  town: SavedTown;
  /** When the file was downloaded, if it says (a bare save doesn't). */
  exportedAt: Date | null;
}

/** Player-facing messages (the panel shows them as they are). */
export const TOWN_FILE_ERRORS = {
  notTown: "That file isn't a Tiny Town town.",
  newer: 'This town was saved by a newer version of Tiny Town.',
  older: "This town is from an older version of Tiny Town that can't be opened any more.",
  tooBig: 'That file is too big to be a Tiny Town town.',
} as const;

export function encodeTownFile(town: SavedTown, exportedAt: Date): string {
  const file: TownFile = { app: TOWN_FILE_APP, kind: TOWN_FILE_KIND, format: TOWN_FILE_FORMAT, exportedAt: exportedAt.toISOString(), town };
  return JSON.stringify(file);
}

/** `puddleton-2026-09-29-1432.tinytown.json`, local time (the same stem as the town photo). */
export function townFileName(townName: string, date: Date): string {
  return `${townFileStem(townName, date)}${TOWN_FILE_EXTENSION}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read a town file (or a bare save). Never throws; an Error carries a player-facing message. */
export function decodeTownFile(text: string, options: ParseOptions = {}): DecodedTownFile | Error {
  if (text.length > TOWN_FILE_MAX_BYTES) return new Error(TOWN_FILE_ERRORS.tooBig);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return new Error(TOWN_FILE_ERRORS.notTown);
  }
  if (!isRecord(data)) return new Error(TOWN_FILE_ERRORS.notTown);
  let raw: unknown = data;
  let exportedAt: Date | null = null;
  if ('app' in data || 'town' in data) {
    if (data.app !== TOWN_FILE_APP || data.kind !== TOWN_FILE_KIND || !isRecord(data.town)) return new Error(TOWN_FILE_ERRORS.notTown);
    if (typeof data.format === 'number' && data.format > TOWN_FILE_FORMAT) return new Error(TOWN_FILE_ERRORS.newer);
    raw = data.town;
    const when = typeof data.exportedAt === 'string' ? new Date(data.exportedAt) : null;
    exportedAt = when && Number.isFinite(when.getTime()) ? when : null;
  } else if (!('version' in data) || !('ground' in data)) {
    return new Error(TOWN_FILE_ERRORS.notTown);
  }
  const town = parseSave(raw, options);
  if (town instanceof Error) {
    if (/newer than supported/.test(town.message)) return new Error(TOWN_FILE_ERRORS.newer);
    if (/No migration|Migration from/.test(town.message)) return new Error(TOWN_FILE_ERRORS.older);
    return new Error(TOWN_FILE_ERRORS.notTown);
  }
  return { town, exportedAt };
}
