// Ícones de traço (24x24, currentColor). icon('clock') devolve o <svg> pronto; sempre decorativo (aria-hidden).
const P = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4M12 17.5v.01"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6A17 17 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4-.9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  home: '<path d="M4 11 12 4l8 7v9H4v-9Z"/><path d="M10 20v-6h4v6"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 7l12-3v3M16 13.5h.01"/>',
  market: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  sim: '<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8"/><path d="M4 4v4h4M12 8v4l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17v.01"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  wifiOff: '<path d="M3 3l18 18M5 12.5a10 10 0 0 1 3.2-2M2 9a15 15 0 0 1 4-2.5M9 16a5 5 0 0 1 6 0M12 20h.01M16 10.8a10 10 0 0 1 3 1.7M22 9a15 15 0 0 0-8-3.8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"/><path d="M7.5 8.5h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
};

export function icon(name, size = 20) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] ?? ''}</svg>`;
}
