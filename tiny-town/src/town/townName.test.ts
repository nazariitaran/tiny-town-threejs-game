import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../utils/random';
import {
  DEFAULT_TOWN_NAME,
  isValidTownName,
  parseTownNames,
  pickTownName,
  sanitizeTownName,
  TOWN_NAME_MAX_LENGTH,
  TOWN_NAMES_PATH,
  townNameLength,
  townNameSlug,
} from './townName';

describe('sanitizeTownName', () => {
  it('trims, collapses whitespace and removes control characters', () => {
    expect(sanitizeTownName('  Puddleton  ')).toBe('Puddleton');
    expect(sanitizeTownName('Little \t  Snorting')).toBe('Little Snorting');
    expect(sanitizeTownName('Muffin\nHeath\u0000')).toBe('Muffin Heath');
    expect(sanitizeTownName('Tea\u2028cup')).toBe('Tea cup');
  });

  it('cuts to 30 characters, counting code points (an emoji is one character)', () => {
    expect(TOWN_NAME_MAX_LENGTH).toBe(30);
    expect(sanitizeTownName('a'.repeat(40))).toBe('a'.repeat(30));
    const emoji = '🏡'.repeat(31);
    expect(townNameLength(sanitizeTownName(emoji))).toBe(30);
    // A cut never leaves a trailing space.
    expect(sanitizeTownName(`${'a'.repeat(29)} bcd`)).toBe('a'.repeat(29));
  });

  it('returns an empty string for blank input', () => {
    expect(sanitizeTownName('')).toBe('');
    expect(sanitizeTownName(' \n\t ')).toBe('');
  });

  it('keeps any other character as text', () => {
    expect(sanitizeTownName('<b>Town</b> & "Co"')).toBe('<b>Town</b> & "Co"');
    expect(sanitizeTownName('Zürich-über-Öl')).toBe('Zürich-über-Öl');
  });
});

describe('isValidTownName', () => {
  it('accepts sanitised non-empty names only', () => {
    expect(isValidTownName('Puddleton')).toBe(true);
    expect(isValidTownName('a'.repeat(30))).toBe(true);
    expect(isValidTownName('a'.repeat(31))).toBe(false);
    expect(isValidTownName(' Puddleton')).toBe(false);
    expect(isValidTownName('')).toBe(false);
    expect(isValidTownName(42)).toBe(false);
    expect(isValidTownName(null)).toBe(false);
  });
});

describe('parseTownNames', () => {
  it('keeps usable strings, sanitised and without duplicates', () => {
    expect(parseTownNames(['Puddleton', ' Puddleton ', '', 7, null, 'Bumble  ford'])).toEqual(['Puddleton', 'Bumble ford']);
  });

  it('gives an empty list for anything but an array', () => {
    expect(parseTownNames({ names: ['a'] })).toEqual([]);
    expect(parseTownNames('Puddleton')).toEqual([]);
    expect(parseTownNames(null)).toEqual([]);
  });

  it('the shipped list: 500 unique names, all valid as they are', () => {
    const raw: unknown = JSON.parse(readFileSync(`public/${TOWN_NAMES_PATH}`, 'utf8'));
    expect(Array.isArray(raw)).toBe(true);
    const list = raw as unknown[];
    expect(list.length).toBe(500);
    expect(list.every(isValidTownName)).toBe(true);
    expect(parseTownNames(list)).toEqual(list);
  });
});

describe('pickTownName', () => {
  const names = ['Puddleton', 'Bumbleford', 'Wobblegate'];

  it('is deterministic for a seed and covers the list', () => {
    const a = createSeededRandom(5);
    const b = createSeededRandom(5);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const name = pickTownName(names, a);
      expect(pickTownName(names, b)).toBe(name);
      seen.add(name);
    }
    expect([...seen].sort()).toEqual([...names].sort());
  });

  it('never repeats the name to avoid when there is another choice', () => {
    const rng = createSeededRandom(9);
    for (let i = 0; i < 50; i += 1) expect(pickTownName(names, rng, 'Bumbleford')).not.toBe('Bumbleford');
    expect(pickTownName(['Solo'], rng, 'Solo')).toBe('Solo');
  });

  it('stays in range for rng() at the edges', () => {
    expect(pickTownName(names, () => 0)).toBe('Puddleton');
    expect(pickTownName(names, () => 0.999999)).toBe('Wobblegate');
    expect(pickTownName(names, () => 1)).toBe('Wobblegate');
  });

  it('falls back to the default name when the list is empty', () => {
    expect(pickTownName([], () => 0.5)).toBe(DEFAULT_TOWN_NAME);
  });
});

describe('townNameSlug', () => {
  it('lower-case ASCII words joined by dashes', () => {
    expect(townNameSlug('Tiny Town')).toBe('tiny-town');
    expect(townNameSlug('Bobbington-on-Wobble')).toBe('bobbington-on-wobble');
    expect(townNameSlug("  Pixie's Puddle!! ")).toBe('pixie-s-puddle');
    expect(townNameSlug('Café Öl 42')).toBe('cafe-ol-42');
  });

  it('is empty when no letter or digit survives', () => {
    expect(townNameSlug('東京')).toBe('');
    expect(townNameSlug('🏡🏡')).toBe('');
  });

  it('is at most 30 characters and never ends with a dash', () => {
    const slug = townNameSlug('Abcdefghij Klmnopqrst Uvwxyzabcd');
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith('-')).toBe(false);
  });
});
