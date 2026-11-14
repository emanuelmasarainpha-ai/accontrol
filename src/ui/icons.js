// @ts-check
// =============================================================================
// ÍCONOS (dibujados a mano, líneas simples de 24x24)
// =============================================================================

import { raw } from './html.js';

/** @type {Record<string, string>} */
const PATHS = {
  home: '<path d="M4 11.2 12 4l8 7.2"/><path d="M6 10v9.2c0 .4.4.8.8.8H10v-5.5h4V20h3.2c.4 0 .8-.4.8-.8V10"/>',
  swap: '<path d="M7 4v14"/><path d="m3.8 15 3.2 3.2L10.2 15"/><path d="M17 20V6"/><path d="m13.8 9 3.2-3.2L20.2 9"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  chart: '<path d="M5 20v-8"/><path d="M12 20V5"/><path d="M19 20v-5"/>',
  spark: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.3l-1.9-5.5-5.6-1.9L10.1 9z"/><path d="M18.5 3.5v3M17 5h3"/>',
  sliders: '<path d="M4 8h9"/><path d="M17 8h3"/><circle cx="15" cy="8" r="2"/><path d="M4 16h3"/><path d="M11 16h9"/><circle cx="9" cy="16" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4.2"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 16V5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M5 19.5h14"/>',
  trash: '<path d="M5 7h14"/><path d="M9.5 7V5h5v2"/><path d="M7 7l.8 12h8.4L17 7"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  arrowUp: '<path d="M12 19V6"/><path d="m6.5 11.5 5.5-5.5 5.5 5.5"/>',
  arrowDown: '<path d="M12 5v13"/><path d="m6.5 12.5 5.5 5.5 5.5-5.5"/>',
  card: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17"/><path d="M7 15h3"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16"/><path d="M8.5 3.5v4M15.5 3.5v4"/>',
  back: '<path d="M19 12H6"/><path d="m11 6.5-5.5 5.5 5.5 5.5"/>',
  bank: '<path d="M4 9.5 12 4l8 5.5"/><path d="M6 9.5V17M10 9.5V17M14 9.5V17M18 9.5V17"/><path d="M4 20h16"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5"/><path d="M3.5 12.5h17"/>',
  store: '<path d="M4 9.5 5.5 4.5h13L20 9.5"/><path d="M4 9.5c0 1.4 1.1 2.5 2.5 2.5S9 10.9 9 9.5c0 1.4 1.1 2.5 2.5 2.5h1c1.4 0 2.5-1.1 2.5-2.5 0 1.4 1.1 2.5 2.5 2.5S20 10.9 20 9.5"/><path d="M5.5 12v7.5h13V12"/><path d="M10 19.5v-4h4v4"/>',
  building: '<rect x="5" y="3.5" width="9" height="16" rx="1.5"/><path d="M14 9.5h3.5a1.5 1.5 0 0 1 1.5 1.5v8.5"/><path d="M8 7.5h3M8 11h3M8 14.5h3"/><path d="M4 19.5h16"/>',
  chevronsUpDown: '<path d="m8 9.5 4-4 4 4"/><path d="m8 14.5 4 4 4-4"/>',
  box: '<path d="M12 3.5 20 7.8v8.4L12 20.5 4 16.2V7.8z"/><path d="m4 7.8 8 4.4 8-4.4"/><path d="M12 12.2v8.3"/>',
  receipt: '<path d="M6 3.5h12v17l-2.4-1.6L13.2 20.5 12 19.6l-1.2.9-2.4-1.6L6 20.5z"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/>',
  calculator: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8h7"/><path d="M8.5 12.5h1M12 12.5h1M15 12.5h1M8.5 16h1M12 16h1M15 16h1"/>',
};

/**
 * @param {keyof typeof PATHS | string} name
 * @param {number} [size]
 */
export function icon(name, size = 20) {
  const body = PATHS[name];
  if (!body) throw new Error(`Ícono desconocido: ${name}`);
  return raw(
    `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`,
  );
}
