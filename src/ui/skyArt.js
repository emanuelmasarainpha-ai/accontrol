// @ts-check
// =============================================================================
// EL CIELO DEL SALUDO DE INICIO (0.20.8, paso 2 de «una app más creativa», pedido de la persona)
// -----------------------------------------------------------------------------
// Junto a «Buenos días / Buenas tardes / Buenas noches» va un dibujo del cielo de esa hora, con partes que se
// mueven solas sin parar:
//   · mañana: el sol que asoma detrás de las colinas (los rayos giran) y un pajarito que vuela;
//   · tarde:  el sol en lo alto (los rayos giran) y una nube que pasa;
//   · noche:  la luna que flota, estrellas que titilan y una nube.
// La hora de cada uno es la misma del saludo (domain/dates.js → dayPhase). Decorativo (aria-hidden).
// Quieto con «reducir movimiento» o «Imágenes en movimiento» apagado. Solo transform y opacity.
// =============================================================================

import { html, raw } from './html.js';

/** @typedef {import('../domain/dates.js').DayPhase} DayPhase */

/** Los rayos del sol: 8 rayitas alrededor de (cx, cy). @param {number} cx @param {number} cy @param {number} r1 @param {number} r2 */
function rays(cx, cy, r1, r2) {
  const lines = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (/** @type {number} */ r) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
    return `M${p(r1)}L${p(r2)}`;
  }).join('');
  // El círculo invisible hace que el centro de giro sea el del sol.
  return `<g class="sk-spin"><circle cx="${cx}" cy="${cy}" r="${r2}" fill="none"/><path class="sk-ray" d="${lines}"/></g>`;
}

/** Nube. @param {number} x @param {number} y @param {number} s escala */
const cloud = (x, y, s) => `<path class="sk-cloud" transform="translate(${x} ${y}) scale(${s})" d="M6 20a8 8 0 0 1 2-15.7A11 11 0 0 1 29 5a8 8 0 0 1 3 15z"/>`;

/** Estrella de cuatro puntas. @param {number} x @param {number} y @param {number} s @param {number} step */
const star = (x, y, s, step) => `<g class="sk-blink sk-d${step}"><path class="sk-star" d="M${x} ${y - s}l${s * 0.3} ${s * 0.7} ${s * 0.7} ${s * 0.3}-${s * 0.7} ${s * 0.3}L${x} ${y + s}l-${s * 0.3}-${s * 0.7}-${s * 0.7}-${s * 0.3} ${s * 0.7}-${s * 0.3}z"/></g>`;

/** Los tres cielos (viewBox 120 × 90). @type {Readonly<Record<DayPhase, string>>} */
export const SKIES = Object.freeze({
  morning: `${rays(60, 56, 26, 34)}<circle class="sk-sun" cx="60" cy="56" r="20"/>
    <path class="sk-hill sk-hill--back" d="M0 70c18-12 38-14 58-6s44 6 62-4v30H0z"/><path class="sk-hill" d="M0 76c22-8 44-8 64-2s38 4 56-2v18H0z"/>
    <g class="sk-fly"><path class="sk-bird" d="M88 24c3-3 6-3 8 0 2-3 5-3 8 0"/></g>`,
  afternoon: `${rays(76, 34, 22, 30)}<circle class="sk-sun" cx="76" cy="34" r="17"/>
    <g class="sk-drift">${cloud(20, 46, 1.35)}</g><g class="sk-drift sk-drift--slow">${cloud(78, 62, 0.8)}</g>`,
  night: `${star(22, 22, 5, 1)}${star(100, 16, 4, 2)}${star(98, 62, 4.5, 3)}${star(36, 70, 3.5, 2)}
    <g class="sk-bob"><path class="sk-moon" d="M66 14a28 28 0 1 0 26 38 22 22 0 1 1-26-38z"/><circle class="sk-crater" cx="52" cy="46" r="3.5"/><circle class="sk-crater" cx="62" cy="60" r="2.5"/></g>
    <g class="sk-drift">${cloud(4, 52, 1)}</g>`,
});

/** El dibujo del cielo de esa hora del día. @param {DayPhase} phase */
export function skyArt(phase) {
  return html`<span class="sky sky--${phase}" data-sky="${phase}" aria-hidden="true"><svg viewBox="0 0 120 90" focusable="false">${raw(SKIES[phase])}</svg></span>`;
}
