/**
 * CONTRACT FILE — sound-effect event ids. Files live in public/assets/audio/ and are
 * described (variants, volume, jitter, cooldown) in docs/assets/audio.json, which
 * the AudioManager (WP-07) turns into its runtime table.
 */
export type SfxEvent =
  | 'ui-hover'
  | 'ui-click'
  | 'ui-open'
  | 'ui-close'
  | 'place-path'
  | 'place-nature'
  | 'place-building'
  | 'place-prop'
  | 'place-prop-metal'
  | 'rotate'
  | 'remove'
  | 'invalid'
  | 'undo'
  | 'redo';

export const SFX_EVENTS: readonly SfxEvent[] = [
  'ui-hover',
  'ui-click',
  'ui-open',
  'ui-close',
  'place-path',
  'place-nature',
  'place-building',
  'place-prop',
  'place-prop-metal',
  'rotate',
  'remove',
  'invalid',
  'undo',
  'redo',
];
