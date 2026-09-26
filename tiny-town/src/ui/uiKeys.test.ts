import { describe, expect, it } from 'vitest';
import { digitAction, digitOf } from './uiKeys';

const key = (code: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  code,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('digit shortcuts', () => {
  it('parses top-row and numpad digits 1–9 only', () => {
    expect(digitOf('Digit1')).toBe(1);
    expect(digitOf('Numpad9')).toBe(9);
    expect(digitOf('Digit0')).toBeNull();
    expect(digitOf('KeyR')).toBeNull();
  });

  it('selects the Nth tool of the active category', () => {
    expect(digitAction(key('Digit1'), 'paths', null)).toEqual({ type: 'tool', toolId: 'road' });
    expect(digitAction(key('Digit3'), 'buildings', null)).toEqual({ type: 'tool', toolId: 'townhouse-c' });
    expect(digitAction(key('Digit7'), 'buildings', null)).toEqual({ type: 'tool', toolId: 'fence-small' });
  });

  it('deselects when the active tool digit is pressed again', () => {
    expect(digitAction(key('Digit2'), 'nature', 'meadow')).toEqual({ type: 'tool', toolId: null });
  });

  it('ignores digits beyond the category size', () => {
    expect(digitAction(key('Digit4'), 'paths', null)).toBeNull();
    expect(digitAction(key('Digit9'), 'other', null)).toBeNull();
  });

  it('Shift+1–4 switches category', () => {
    expect(digitAction(key('Digit1', { shiftKey: true }), 'other', null)).toEqual({ type: 'category', category: 'paths' });
    expect(digitAction(key('Digit4', { shiftKey: true }), 'paths', null)).toEqual({ type: 'category', category: 'other' });
    expect(digitAction(key('Digit5', { shiftKey: true }), 'paths', null)).toBeNull();
  });

  it('leaves modified digits to the browser', () => {
    expect(digitAction(key('Digit1', { ctrlKey: true }), 'paths', null)).toBeNull();
    expect(digitAction(key('Digit1', { metaKey: true }), 'paths', null)).toBeNull();
    expect(digitAction(key('Digit1', { altKey: true }), 'paths', null)).toBeNull();
  });
});
