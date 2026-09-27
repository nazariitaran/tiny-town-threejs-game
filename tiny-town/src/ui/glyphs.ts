/**
 * Inline SVG glyphs for UI chrome (WP-06). 24×24 grid, 2 px round strokes in `currentColor`,
 * so every glyph follows the button's text colour in hover/pressed/active/disabled states.
 * Item cards use Kenney preview PNGs instead (catalog `ToolDef.icon`).
 */
const svg = (body: string, extra = ''): string =>
  `<svg class="ui-glyph" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

export const GLYPHS = {
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  soundOn: svg('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  soundOff: svg('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/>'),
  menu: svg('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>'),
  bulldoze: svg(
    '<rect x="2.5" y="15" width="12" height="5" rx="2.5"/><path d="M4.5 15v-5h4.5l2 5"/><path d="m13 13 4-2"/><path d="M17 7.5 21 9v9l-4-1.5z" fill="currentColor"/>',
  ),
  close: svg('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17.2v.1"/>'),
  camera: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><circle cx="12" cy="12" r="2.5"/>'),
  grid: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.3 4v16"/><path d="M14.7 4v16"/><path d="M4 9.3h16"/><path d="M4 14.7h16"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.1"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  retry: svg('<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v5h5"/>'),
  // Category tabs
  paths: svg('<path d="M8 3 5 21"/><path d="m16 3 3 18"/><path d="M12 4v2.5"/><path d="M12 10.5v3"/><path d="M12 17.5V20"/>'),
  nature: svg('<path d="M12 21v-6"/><path d="M12 3c3.6 0 6 2.8 6 6.2 0 3.3-2.7 5.8-6 5.8s-6-2.5-6-5.8C6 5.8 8.4 3 12 3z"/>'),
  buildings: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  other: svg('<path d="M12 21V8"/><path d="M8.5 21h7"/><path d="M9 8h6l-1-4h-4z"/><path d="M12 8v0"/>'),
  // Brand mark
  homes: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
} as const;

export type GlyphId = keyof typeof GLYPHS;
