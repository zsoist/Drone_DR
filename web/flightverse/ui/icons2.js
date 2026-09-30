// flightverse/ui/icons2.js — iconos SVG del HUD v2 (trazo 1.75, sin relleno, sin emojis).
const ic = (d, s = 20) => `<svg viewBox="0 0 20 20" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  back: ic('<path d="M12 4.5L6.5 10 12 15.5"/>'),
  pause: ic('<path d="M7 4.5v11M13 4.5v11"/>'),
  close: ic('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
  chev: ic('<path d="M7.5 4.5L13 10l-5.5 5.5"/>', 16),
};
