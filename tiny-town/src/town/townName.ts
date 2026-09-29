/**
 * Town names (WP-20): the rules for a player's town name, the suggestion list and its random pick.
 * PURE (no three.js, no DOM) so it runs in Node tests. The list itself is owner-supplied data,
 * fetched at load from public/data/default_town_names.json (TOWN_NAMES_PATH), not bundled.
 */

/** Longest name, in characters (Unicode code points). The name field's maxlength matches it. */
export const TOWN_NAME_MAX_LENGTH = 30;

/** The name of a town that was never named: old saves, test states, and when the list can't load. */
export const DEFAULT_TOWN_NAME = 'Tiny Town';

/** The suggestion list, a JSON array of strings (public path, resolve it with assetUrl). */
export const TOWN_NAMES_PATH = 'data/default_town_names.json';

// C0/C1 control characters, plus the line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * A name as it is stored and shown: control characters removed, whitespace runs collapsed to one
 * space, trimmed, and cut to TOWN_NAME_MAX_LENGTH code points. May return '' (not a valid name).
 */
export function sanitizeTownName(raw: string): string {
  const clean = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  return chars.length > TOWN_NAME_MAX_LENGTH ? chars.slice(0, TOWN_NAME_MAX_LENGTH).join('').trimEnd() : clean;
}

/** Length in characters (code points), as the name field's counter shows it. */
export const townNameLength = (name: string): number => Array.from(name).length;

/** A stored name: a string that is already sanitised and not empty. */
export function isValidTownName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && sanitizeTownName(value) === value;
}

/** The suggestion list from untrusted JSON: every usable entry, sanitised, without duplicates. */
export function parseTownNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const names = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== 'string') continue;
    const name = sanitizeTownName(entry);
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * A random name from `names` (`rng` in [0, 1)), never `avoid` (the one already in the field) when
 * there is another choice. An empty list gives DEFAULT_TOWN_NAME.
 */
export function pickTownName(names: readonly string[], rng: () => number, avoid?: string): string {
  const pool = names.length > 1 && avoid !== undefined ? names.filter((name) => name !== avoid) : names;
  if (pool.length === 0) return DEFAULT_TOWN_NAME;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * The name as a file-name part: lower-case ASCII letters and digits joined by '-', accents dropped
 * ("Bobbington-on-Wobble" → "bobbington-on-wobble", "Café Ö" → "cafe-o"). '' when nothing is left.
 */
export function townNameSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TOWN_NAME_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * The stem every file named after the town shares (the photo, WP-19; the town file, WP-21):
 * `puddleton-2026-09-28-1432`, local time; `tiny-town-…` when the name has no usable letters.
 */
export function townFileStem(name: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const slug = townNameSlug(name) || townNameSlug(DEFAULT_TOWN_NAME);
  return `${slug}-${day}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
