/** Inline SVG glyphs: 24×24 grid, 2 px round strokes in `currentColor`, so they follow the button's text colour. */
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
  move: svg('<path d="M12 3v18"/><path d="M3 12h18"/><path d="m9 6 3-3 3 3"/><path d="m9 18 3 3 3-3"/><path d="m6 9-3 3 3 3"/><path d="m18 9 3 3-3 3"/>'),
  chevronLeft: svg('<path d="m14.5 6-6 6 6 6"/>'),
  chevronRight: svg('<path d="m9.5 6 6 6-6 6"/>'),
  close: svg('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17.2v.1"/>'),
  grid: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.3 4v16"/><path d="M14.7 4v16"/><path d="M4 9.3h16"/><path d="M4 14.7h16"/>'),
  fps: svg('<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 3.5-5"/><path d="M4 17h16"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.1"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  retry: svg('<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v5h5"/>'),
  photo: svg('<path d="M3 9a2 2 0 0 1 2-2h2.2l1.6-2.5h6.4L16.8 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13.2" r="3.6"/>'),
  download: svg('<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20h14"/>'),
  folder: svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M3 10.5h18"/>'),
  upload: svg('<path d="M12 16V5"/><path d="m7 9.5 5-5 5 5"/><path d="M5 20h14"/>'),
  pencil: svg('<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  dice: svg(
    '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.6" cy="8.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.35" fill="currentColor" stroke="none"/>',
  ),
  graphics: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="15.5" cy="9.5" r="1.8"/><path d="m3.5 17.5 5.5-5.5 4.5 4.5"/><path d="m12 15 2.5-2.5 6 6"/>'),
  keys: svg(
    '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M17.5 10h.01"/><path d="M8 14h8"/>',
  ),
  timeAuto: svg(
    '<path d="M12 7.5a3.2 3.2 0 0 0 4.5 4.5A4.5 4.5 0 1 1 12 7.5z"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="m5.3 5.3 1.4 1.4"/><path d="m17.3 17.3 1.4 1.4"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="m5.3 18.7 1.4-1.4"/><path d="m17.3 6.7 1.4-1.4"/>',
  ),
  timeDay: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="m5.3 5.3 1.4 1.4"/><path d="m17.3 17.3 1.4 1.4"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="m5.3 18.7 1.4-1.4"/><path d="m17.3 6.7 1.4-1.4"/>',
  ),
  rainAuto: svg('<path d="M7 13a3.8 3.8 0 0 1 .4-7.6 5.3 5.3 0 0 1 10.2 1.3 3.2 3.2 0 0 1-.1 6.3z"/><path d="M12 16.5v1.5"/><path d="M12 20.5v.5"/>'),
  rainOn: svg('<path d="M7 13a3.8 3.8 0 0 1 .4-7.6 5.3 5.3 0 0 1 10.2 1.3 3.2 3.2 0 0 1-.1 6.3z"/><path d="m8.5 16.5-1 3.5"/><path d="m12.5 16.5-1 3.5"/><path d="m16.5 16.5-1 3.5"/>'),
  rainOff: svg('<path d="M7 15.5a3.8 3.8 0 0 1 .4-7.6 5.3 5.3 0 0 1 10.2 1.3 3.2 3.2 0 0 1-.1 6.3z"/><path d="m4 20 16-16"/>'),
  timeNight: svg('<path d="M12.5 3.5a6.5 6.5 0 0 0 8 8 8.6 8.6 0 1 1-8-8z"/>'),
  // Keyed by ToolCategory id.
  streets: svg('<path d="M8 3 5 21"/><path d="m16 3 3 18"/><path d="M12 4v2.5"/><path d="M12 10.5v3"/><path d="M12 17.5V20"/>'),
  homes: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  town: svg('<path d="M4.5 10v10h15V10"/><path d="M3 10 5 4.5h14l2 5.5z"/><path d="M10 20v-5h4v5"/>'),
  nature: svg('<path d="M12 21v-6"/><path d="M12 3c3.6 0 6 2.8 6 6.2 0 3.3-2.7 5.8-6 5.8s-6-2.5-6-5.8C6 5.8 8.4 3 12 3z"/>'),
  garden: svg('<path d="M5 21V7.5L6.5 5 8 7.5V21"/><path d="M10.5 21V7.5L12 5l1.5 2.5V21"/><path d="M16 21V7.5L17.5 5 19 7.5V21"/><path d="M3 11h18"/><path d="M3 16.5h18"/>'),
  // GitHub and X are Simple Icons paths (CC0).
  github: svg(
    '<path fill="currentColor" stroke="none" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',
  ),
  linkedin: svg(
    '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M4.5 1.5h15a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3h-15a3 3 0 0 1-3-3v-15a3 3 0 0 1 3-3ZM5.6 9.2v9.3h3V9.2Zm1.5-4.7a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm3.7 4.7v9.3h3v-5c0-1.3.7-2.1 1.8-2.1s1.6.8 1.6 2.1v5h3v-5.6c0-2.7-1.5-3.9-3.5-3.9-1.3 0-2.3.6-2.9 1.4V9.2Z"/>',
  ),
  x: svg('<path fill="currentColor" stroke="none" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>'),
} as const;

