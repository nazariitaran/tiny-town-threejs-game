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
  // Move tool: four-way arrows.
  move: svg('<path d="M12 3v18"/><path d="M3 12h18"/><path d="m9 6 3-3 3 3"/><path d="m9 18 3 3 3-3"/><path d="m6 9-3 3 3 3"/><path d="m18 9 3 3-3 3"/>'),
  close: svg('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17.2v.1"/>'),
  grid: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.3 4v16"/><path d="M14.7 4v16"/><path d="M4 9.3h16"/><path d="M4 14.7h16"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.1"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  retry: svg('<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v5h5"/>'),
  // Town photo (WP-19): the top-bar camera and the preview's Download button.
  photo: svg('<path d="M3 9a2 2 0 0 1 2-2h2.2l1.6-2.5h6.4L16.8 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13.2" r="3.6"/>'),
  download: svg('<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20h14"/>'),
  // Town file (WP-21): the top-bar folder and the panel's "Open a town file…".
  folder: svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M3 10.5h18"/>'),
  upload: svg('<path d="M12 16V5"/><path d="m7 9.5 5-5 5 5"/><path d="M5 20h14"/>'),
  // Town name (WP-20): the menu's Rename town button and the name dialog's "Another name" die.
  pencil: svg('<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  dice: svg(
    '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.6" cy="8.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.35" fill="currentColor" stroke="none"/>',
  ),
  // Menu tabs (WP-25): the Graphics tab and its Quality row (a framed landscape), the Help tab's Controls (a keyboard).
  graphics: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="15.5" cy="9.5" r="1.8"/><path d="m3.5 17.5 5.5-5.5 4.5 4.5"/><path d="m12 15 2.5-2.5 6 6"/>'),
  keys: svg(
    '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M17.5 10h.01"/><path d="M8 14h8"/>',
  ),
  // Day/night modes (WP-16c): the top-bar time button and the menu's "Time of day" row.
  /** Auto: a sun whose core is a crescent moon (the cycle runs by itself). */
  timeAuto: svg(
    '<path d="M12 7.5a3.2 3.2 0 0 0 4.5 4.5A4.5 4.5 0 1 1 12 7.5z"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="m5.3 5.3 1.4 1.4"/><path d="m17.3 17.3 1.4 1.4"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="m5.3 18.7 1.4-1.4"/><path d="m17.3 6.7 1.4-1.4"/>',
  ),
  /** Day: the sun. */
  timeDay: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="m5.3 5.3 1.4 1.4"/><path d="m17.3 17.3 1.4 1.4"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="m5.3 18.7 1.4-1.4"/><path d="m17.3 6.7 1.4-1.4"/>',
  ),
  /** Night: a crescent moon. */
  timeNight: svg('<path d="M12.5 3.5a6.5 6.5 0 0 0 8 8 8.6 8.6 0 1 1-8-8z"/>'),
  // Category tabs (catalog/tools.ts TOOL_CATEGORIES)
  streets: svg('<path d="M8 3 5 21"/><path d="m16 3 3 18"/><path d="M12 4v2.5"/><path d="M12 10.5v3"/><path d="M12 17.5V20"/>'),
  homes: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  town: svg('<path d="M4.5 10v10h15V10"/><path d="M3 10 5 4.5h14l2 5.5z"/><path d="M10 20v-5h4v5"/>'),
  nature: svg('<path d="M12 21v-6"/><path d="M12 3c3.6 0 6 2.8 6 6.2 0 3.3-2.7 5.8-6 5.8s-6-2.5-6-5.8C6 5.8 8.4 3 12 3z"/>'),
  garden: svg('<path d="M5 21V7.5L6.5 5 8 7.5V21"/><path d="M10.5 21V7.5L12 5l1.5 2.5V21"/><path d="M16 21V7.5L17.5 5 19 7.5V21"/><path d="M3 11h18"/><path d="M3 16.5h18"/>'),
} as const;

