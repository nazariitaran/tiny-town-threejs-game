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
    expect(digitAction(key('Digit1'), 'streets', null)).toEqual({ type: 'tool', toolId: 'road' });
    expect(digitAction(key('Digit3'), 'homes', null)).toEqual({ type: 'tool', toolId: 'bungalow' });
    expect(digitAction(key('Digit7'), 'homes', null)).toEqual({ type: 'tool', toolId: 'garage' });
    expect(digitAction(key('Digit8'), 'garden', null)).toEqual({ type: 'tool', toolId: 'swing' });
  });

  it('deselects when the active tool digit is pressed again', () => {
    expect(digitAction(key('Digit2'), 'nature', 'meadow')).toEqual({ type: 'tool', toolId: null });
  });

  it('ignores digits beyond the category size', () => {
    expect(digitAction(key('Digit8'), 'streets', null)).toBeNull();
    expect(digitAction(key('Digit6'), 'town', null)).toBeNull();
    expect(digitAction(key('Digit9'), 'garden', null)).toBeNull();
  });

  it('Shift+1–5 switches category', () => {
    expect(digitAction(key('Digit1', { shiftKey: true }), 'garden', null)).toEqual({ type: 'category', category: 'streets' });
    expect(digitAction(key('Digit3', { shiftKey: true }), 'streets', null)).toEqual({ type: 'category', category: 'town' });
    expect(digitAction(key('Digit5', { shiftKey: true }), 'streets', null)).toEqual({ type: 'category', category: 'garden' });
    expect(digitAction(key('Digit6', { shiftKey: true }), 'streets', null)).toBeNull();
  });

  it('leaves modified digits to the browser', () => {
    expect(digitAction(key('Digit1', { ctrlKey: true }), 'streets', null)).toBeNull();
    expect(digitAction(key('Digit1', { metaKey: true }), 'streets', null)).toBeNull();
    expect(digitAction(key('Digit1', { altKey: true }), 'streets', null)).toBeNull();
  });
});
