// @ts-check
// =============================================================================
// GUILLOCHÉ: la roseta de líneas finas de los billetes, trazada de verdad
// -----------------------------------------------------------------------------
// Firma del mundo «El billete dominicano». Cada anillo es una hipotrocoide (la curva de un espirógrafo): un
// círculo de radio r rueda por dentro de otro de radio R y un punto a distancia d del centro dibuja la curva.
// Con R y r enteros la curva se cierra sola después de r / mcd(R, r) vueltas. Es decorativa (aria-hidden) y toma
// el color del espacio por currentColor. Se calcula una sola vez (no cambia nunca).
// =============================================================================

import { html } from './html.js';

/** @param {number} a @param {number} b @returns {number} */
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/**
 * Puntos de una hipotrocoide cerrada, escalada y girada.
 * Con r divisor de R la curva cierra en una vuelta y es una «banda» ondulada de R / r ondas, como las de un billete.
 * @param {{ R: number, r: number, d: number, scale?: number, rotate?: number, steps?: number }} ring
 *   R y r enteros positivos, r < R; scale (0..1) achica la banda; rotate (grados) la desfasa.
 * @returns {Array<[number, number]>}
 */
export function hypotrochoid({ R, r, d, scale = 1, rotate = 0, steps = 240 }) {
  const turns = r / gcd(R, r);
  const total = Math.max(64, Math.round(steps * turns));
  const k = (R - r) / r;
  const cos = Math.cos((rotate * Math.PI) / 180);
  const sin = Math.sin((rotate * Math.PI) / 180);
  /** @type {Array<[number, number]>} */
  const points = [];
  for (let i = 0; i <= total; i += 1) {
    const t = (i / total) * 2 * Math.PI * turns;
    const x = ((R - r) * Math.cos(t) + d * Math.cos(k * t)) * scale;
    const y = ((R - r) * Math.sin(t) - d * Math.sin(k * t)) * scale;
    points.push([x * cos - y * sin, x * sin + y * cos]);
  }
  return points;
}

/**
 * Los puntos como camino SVG, con un decimal (suficiente a este tamaño y mucho más liviano).
 * @param {Array<[number, number]>} points
 */
export function toPath(points) {
  const f = (/** @type {number} */ n) => (Math.round(n * 10) / 10).toString();
  return `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

/**
 * Los anillos de la roseta: bandas onduladas concéntricas, como las de un billete. Dos familias que se entrecruzan
 * (15 ondas y 20 ondas), cada anillo un poco más chico y desfasado que el anterior. Todas cierran en una vuelta,
 * así el dibujo es liviano en un celular modesto.
 */
export const RINGS = [
  ...[1, 0.88, 0.76, 0.64, 0.52, 0.4].map((scale, i) => ({ R: 120, r: 8, d: 7, scale, rotate: i * 4 })),
  ...[0.94, 0.82, 0.7, 0.58, 0.46].map((scale, i) => ({ R: 120, r: 6, d: 9, scale, rotate: i * 3 + 2 })),
];

/** Medio lado del cuadro donde cabe la roseta (el anillo más ancho llega a (R - r + d) · escala). */
export const ROSETTE_EXTENT = Math.ceil(Math.max(...RINGS.map((g) => (g.R - g.r + g.d) * g.scale))) + 4;

/** @type {string[] | null} */
let cached = null;

/** Los caminos de todos los anillos (se calculan una sola vez). */
export function rosettePaths() {
  if (!cached) cached = RINGS.map((ring) => toPath(hypotrochoid(ring)));
  return cached;
}

/**
 * La roseta lista para la pantalla (decorativa).
 * @param {string} [className]
 */
export function guillocheRosette(className = 'rosette') {
  const e = ROSETTE_EXTENT;
  return html`<svg class="${className}" viewBox="${-e} ${-e} ${e * 2} ${e * 2}" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" stroke-width="0.55" stroke-linejoin="round">${rosettePaths().map((d) => html`<path d="${d}" />`)}</g>
  </svg>`;
}
