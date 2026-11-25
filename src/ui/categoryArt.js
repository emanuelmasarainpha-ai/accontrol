// @ts-check
// =============================================================================
// DIBUJOS DE LAS CATEGORÍAS (0.20.6)
// -----------------------------------------------------------------------------
// Cada categoría tiene su dibujo (SVG hecho a mano, liviano, sin internet) sobre un cuadrito de su color.
// Una parte de cada dibujo se mueve sola, suave y sin parar: la moneda que flota, el vapor que sube, el rayo que
// parpadea… (clases ca-bob, ca-rise, ca-blink… en components.css). Se detiene con «reducir movimiento» o con
// Ajustes → General → «Imágenes en movimiento».
// Colores con clases (k = color de la categoría, d = oscuro, s = claro, w = blanco, y = dorado), no con estilos en línea:
// la política de seguridad de la app no deja estilos escritos dentro del HTML.
// Decorativo: lleva aria-hidden; el nombre de la categoría siempre está escrito al lado.
// =============================================================================

import { categoryArtKey } from '../domain/categoryArt.js';
import { html, raw } from './html.js';

/** @typedef {import('../domain/categoryArt.js').ArtKey} ArtKey */

/** Moneda dorada (se reutiliza). @param {number} cx @param {number} cy @param {number} r */
const coin = (cx, cy, r) => `<circle class="y" cx="${cx}" cy="${cy}" r="${r}"/><circle class="yl" cx="${cx}" cy="${cy}" r="${(r * 0.62).toFixed(1)}"/>`;

/** El dibujo de cada clave (dentro de un viewBox de 48 × 48). @type {Readonly<Record<ArtKey, string>>} */
export const ART = Object.freeze({
  salary: `<rect class="k" x="6" y="14" width="30" height="20" rx="3.5"/><rect class="s" x="9.5" y="17.5" width="23" height="13" rx="2"/><circle class="k" cx="21" cy="24" r="4"/>
    <g class="ca-bob">${coin(36, 31, 7)}</g>`,
  pension: `<circle class="k" cx="21" cy="24" r="13"/><circle class="w" cx="21" cy="24" r="10"/>
    <g class="ca-spin"><circle cx="21" cy="24" r="10" fill="none"/><path class="ln" d="M21 24V16.5"/></g><path class="ln" d="M21 24h5"/><circle class="d" cx="21" cy="24" r="1.6"/>
    <g class="ca-bob">${coin(36, 34, 6)}</g>`,
  rentIn: `<path class="k" d="M8 23 22 11l14 12v15H8z"/><rect class="w" x="18" y="27" width="8" height="11" rx="1.5"/><path class="d" d="M6 24 22 10l16 14-2.2 2.4L22 14.6 8.2 26.4z"/>
    <g class="ca-swing"><circle class="yl" cx="37" cy="29" r="3.6"/><path class="yl" d="M37 32.6v7.4M37 37h2.6"/></g>`,
  commission: `<circle class="k" cx="24" cy="24" r="15"/><g class="ca-spin"><circle cx="24" cy="24" r="15" fill="none"/><path class="lw" d="M16.5 31.5 31.5 16.5"/><circle class="w" cx="17.8" cy="17.8" r="3.2"/><circle class="w" cx="30.2" cy="30.2" r="3.2"/></g>`,
  sales: `<g class="ca-swing"><path class="k" d="M24 8h12a3 3 0 0 1 3 3v12L23 39a3 3 0 0 1-4.2 0L9 29.2a3 3 0 0 1 0-4.2z"/><circle class="w" cx="32" cy="15" r="3"/><path class="lw" d="M18 27.5l6-6M21 31l6-6"/></g>`,
  tips: `<path class="s" d="M13 17h22v17a5 5 0 0 1-5 5H18a5 5 0 0 1-5-5z"/><rect class="k" x="11" y="13" width="26" height="5" rx="2.5"/>${coin(20, 31, 4.2)}${coin(28, 33, 4.2)}
    <g class="ca-drop">${coin(24, 7, 4.2)}</g>`,
  bonus: `<g class="ca-pulse"><path class="k" d="m24 7 4.9 10 11 1.6-8 7.8 1.9 11L24 32.2l-9.8 5.2 1.9-11-8-7.8 11-1.6z"/><path class="s" d="m24 13 2.9 6 6.6 1-4.8 4.6 1.1 6.5L24 28l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1z"/></g>
    <g class="ca-blink"><path class="y" d="M38 7l1.2 3 3 1.2-3 1.2L38 15.4l-1.2-3-3-1.2 3-1.2z"/></g>`,
  gift: `<rect class="k" x="9" y="21" width="30" height="18" rx="2.5"/><rect class="d" x="7" y="16" width="34" height="7" rx="2"/><rect class="y" x="21.5" y="16" width="5" height="23"/>
    <g class="ca-bob"><path class="y" d="M24 16c-3-6-10-7-10-2.5S20 16 24 16zm0 0c3-6 10-7 10-2.5S28 16 24 16z"/></g>`,
  incomeOther: `${coin(22, 27, 12)}<g class="ca-bob"><path class="k" d="M36 8l6 7h-4v8h-4v-8h-4z"/></g>`,
  rent: `<path class="k" d="M9 23 24 10l15 13v16H9z"/><path class="d" d="M7 24 24 9l17 15-2.3 2.5L24 13.7 9.3 26.5z"/><rect class="w" x="20" y="28" width="8" height="11" rx="1.5"/>
    <g class="ca-blink"><rect class="y" x="13" y="26" width="5" height="5" rx="1"/><rect class="y" x="30" y="26" width="5" height="5" rx="1"/></g>`,
  electricity: `<circle class="s" cx="24" cy="24" r="15"/><g class="ca-blink"><path class="y" d="M26.5 7 13 27h9l-2.5 14L35 20h-9z"/><path class="yl" d="M26.5 7 13 27h9l-2.5 14L35 20h-9z"/></g>`,
  water: `<g class="ca-bob"><path class="k" d="M24 7c6 8 12 14.5 12 21a12 12 0 0 1-24 0c0-6.5 6-13 12-21z"/><path class="lw" d="M18.5 29a6 6 0 0 0 5 5.5"/></g>
    <g class="ca-drop"><path class="s" d="M38 8c1.8 2.4 3.4 4.3 3.4 6.1a3.4 3.4 0 0 1-6.8 0c0-1.8 1.6-3.7 3.4-6.1z"/></g>`,
  internet: `<circle class="k" cx="24" cy="35" r="3.2"/><g class="ca-blink ca-d1"><path class="ln ln--k" d="M17 28.5a10 10 0 0 1 14 0"/></g><g class="ca-blink ca-d2"><path class="ln ln--k" d="M12 23.5a17 17 0 0 1 24 0"/></g><g class="ca-blink ca-d3"><path class="ln ln--k" d="M7 18.5a24 24 0 0 1 34 0"/></g>`,
  transport: `<g class="ca-bob"><rect class="k" x="9" y="10" width="30" height="25" rx="5"/><rect class="w" x="12.5" y="14" width="23" height="10" rx="2"/><circle class="y" cx="15" cy="29.5" r="2"/><circle class="y" cx="33" cy="29.5" r="2"/></g>
    <rect class="d" x="12" y="34" width="5" height="5" rx="1.5"/><rect class="d" x="31" y="34" width="5" height="5" rx="1.5"/>`,
  food: `<g class="ca-bob"><circle class="r" cx="19" cy="15" r="6"/><path class="g" d="M19 9c0-3 2-4.5 4-4.5-.2 2.6-1.6 4-4 4.5z"/><rect class="y" x="25" y="8" width="7" height="13" rx="3.5"/></g>
    <path class="k" d="M7 20h34l-3.5 17.5A3 3 0 0 1 34.6 40H13.4a3 3 0 0 1-2.9-2.5z"/><path class="lw" d="M16 26v8M24 26v8M32 26v8"/>`,
  fuel: `<rect class="k" x="9" y="9" width="20" height="31" rx="3"/><rect class="w" x="12.5" y="13" width="13" height="9" rx="1.5"/><path class="ln ln--k" d="M29 17h4a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0 5 0V15l-4-4"/>
    <g class="ca-drop"><path class="y" d="M19 27c2 2.8 3.6 4.6 3.6 6.4a3.6 3.6 0 0 1-7.2 0c0-1.8 1.6-3.6 3.6-6.4z"/></g>`,
  health: `<g class="ca-pulse"><path class="k" d="M24 40S8 30.5 8 19.5A8.5 8.5 0 0 1 24 15a8.5 8.5 0 0 1 16 4.5C40 30.5 24 40 24 40z"/><path class="w" d="M21.5 18h5v5h5v5h-5v5h-5v-5h-5v-5h5z"/></g>`,
  clothes: `<g class="ca-swing"><path class="k" d="M17 8h14l9 6-4 7-4-2.5V40H16V18.5L12 21l-4-7z"/><path class="s" d="M19.5 8a4.5 4.5 0 0 0 9 0z"/><path class="lw" d="M24 22v14"/></g>`,
  restaurant: `<ellipse class="s" cx="24" cy="33" rx="16" ry="5"/><path class="k" d="M10 31a14 14 0 0 1 28 0z"/><rect class="d" x="22.5" y="15" width="3" height="3" rx="1.5"/>
    <g class="ca-rise"><path class="ln ln--s" d="M18 13c-2-2 2-3.5 0-6"/><path class="ln ln--s" d="M30 13c-2-2 2-3.5 0-6"/></g>`,
  entertainment: `<path class="k" d="M12 19h24l-3 21H15z"/><path class="w" d="M17 19h3.5l1 21H19zM27.5 19H31l-2 21h-2.5z"/>
    <g class="ca-rise"><circle class="y" cx="17" cy="15" r="3.6"/><circle class="y" cx="24" cy="12" r="4"/><circle class="y" cx="31" cy="15" r="3.6"/></g>`,
  debt: `<rect class="k" x="6" y="12" width="36" height="24" rx="4"/><rect class="d" x="6" y="17" width="36" height="5"/><rect class="y" x="11" y="26" width="8" height="5" rx="1.2"/><path class="lw" d="M24 29h12"/>
    <g class="ca-shine"><path class="w w--glint" d="M30 12h5l-9 24h-5z"/></g>`,
  expenseOther: `<g class="ca-swing"><path class="k" d="M10 17h28l-2 21a3 3 0 0 1-3 2.7H15A3 3 0 0 1 12 38z"/><path class="ln ln--d" d="M18 20v-5a6 6 0 0 1 12 0v5"/><circle class="w" cx="18" cy="21" r="1.7"/><circle class="w" cx="30" cy="21" r="1.7"/></g>`,
  services: `<rect class="k" x="7" y="15" width="34" height="23" rx="4"/><path class="ln ln--d" d="M18 15v-3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/><rect class="d" x="7" y="23" width="34" height="3"/>
    <g class="ca-blink"><rect class="y" x="21" y="21.5" width="6" height="6" rx="1.5"/></g>`,
  merchandise: `<g class="ca-bob"><path class="k" d="M8 16 24 9l16 7v17l-16 7-16-7z"/><path class="d" d="M24 23v17l16-7V16z"/><path class="s" d="M8 16l16 7 16-7-16-7z"/><path class="y" d="m14 13.4 16 7v5l3-1.3v-5.1l-16-7z"/></g>`,
  marketing: `<path class="k" d="M8 20h7l14-8v24l-14-8H8a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"/><path class="d" d="M12 28h5l2 9h-5z"/>
    <g class="ca-blink ca-d1"><path class="ln ln--k" d="M34 19a7 7 0 0 1 0 10"/></g><g class="ca-blink ca-d2"><path class="ln ln--k" d="M38 15a13 13 0 0 1 0 18"/></g>`,
  payroll: `<circle class="s" cx="31" cy="16" r="5.5"/><path class="s" d="M21 38a10 10 0 0 1 20 0z"/>
    <g class="ca-bob"><circle class="k" cx="19" cy="17" r="6.5"/><path class="k" d="M7 40a12 12 0 0 1 24 0z"/></g>`,
  taxes: `<path class="k" d="M12 6h17l9 9v25a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path class="s" d="M29 6v9h9z"/><path class="lw" d="M16 34 30 20"/><circle class="w" cx="17.5" cy="22" r="2.8"/><circle class="w" cx="28.5" cy="32" r="2.8"/>
    <g class="ca-pulse">${coin(38, 36, 5.5)}</g>`,
  software: `<rect class="k" x="9" y="10" width="30" height="21" rx="3"/><rect class="d" x="12" y="13" width="24" height="15" rx="1.5"/><path class="k" d="M5 33h38l-2.5 5H7.5z"/>
    <path class="ln ln--s" d="m18 18-3.5 2.5L18 23M30 18l3.5 2.5L30 23"/><g class="ca-blink"><path class="ln ln--y" d="M25.5 17.5 22.5 23.5"/></g>`,
  professional: `<rect class="k" x="10" y="9" width="28" height="31" rx="3"/><rect class="d" x="18" y="6" width="12" height="6" rx="2"/><path class="lw" d="M16 20h16M16 26h10"/>
    <g class="ca-pulse"><circle class="g" cx="32" cy="33" r="6"/><path class="lw" d="m29.2 33 2 2 3.8-4"/></g>`,
  bank: `<path class="k" d="M6 18 24 8l18 10z"/><rect class="d" x="7" y="35" width="34" height="5" rx="1"/><path class="k" d="M11 20h4v14h-4zM19 20h4v14h-4zM27 20h4v14h-4zM35 20h4v14h-4z"/>
    <g class="ca-blink">${coin(24, 14.5, 2.6)}</g>`,
  equipment: `<g class="ca-wiggle"><path class="k" d="M30.5 7.5a9 9 0 0 0-11 11.4L8.6 29.8a3.6 3.6 0 0 0 5.1 5.1l10.9-10.9a9 9 0 0 0 11.4-11l-5.3 5.2-4.6-.5-.5-4.6z"/></g><circle class="y" cx="11.2" cy="32.3" r="1.6"/>`,
  education: `<path class="k" d="M4 19 24 10l20 9-20 9z"/><path class="d" d="M13 23.5V32c0 3 5 5.5 11 5.5S35 35 35 32v-8.5L24 28.4z"/>
    <g class="ca-swing"><path class="ln ln--y" d="M40 20.5v10"/><circle class="y" cx="40" cy="32" r="2.4"/></g>`,
  phone: `<rect class="k" x="14" y="6" width="20" height="36" rx="4"/><rect class="w" x="16.8" y="10.5" width="14.4" height="24" rx="1.5"/><circle class="s" cx="24" cy="38" r="1.6"/>
    <g class="ca-pulse"><rect class="y" x="19.5" y="18" width="9" height="7" rx="2.5"/><path class="y" d="m21.5 25-2 3 4.5-3z"/></g>`,
  pets: `<g class="ca-bob"><ellipse class="k" cx="24" cy="31" rx="9" ry="7.5"/><ellipse class="k" cx="13" cy="21" rx="3.6" ry="4.6"/><ellipse class="k" cx="35" cy="21" rx="3.6" ry="4.6"/><ellipse class="k" cx="19" cy="13" rx="3.6" ry="4.6"/><ellipse class="k" cx="29" cy="13" rx="3.6" ry="4.6"/></g>`,
  gym: `<g class="ca-wiggle"><rect class="d" x="13" y="22" width="22" height="4" rx="2"/><rect class="k" x="6" y="14" width="6" height="20" rx="2.5"/><rect class="k" x="36" y="14" width="6" height="20" rx="2.5"/><rect class="s" x="2.5" y="18" width="4" height="12" rx="2"/><rect class="s" x="41.5" y="18" width="4" height="12" rx="2"/></g>`,
  travel: `<g class="ca-fly"><path class="k" d="M42 9c-1.5-1.5-4-1-5.6.6L30 16 12 11l-3 3 14.5 8.5L17 29l-5-1-2.5 2.5 6.5 3.5 3.5 6.5L22 38l-1-5 6.5-6.5L36 41l3-3-5-18 6.4-6.4C42 12 42.5 10.5 42 9z"/></g>`,
  savings: `<path class="k" d="M10 25c0-7 6.5-12 14.5-12 6 0 10.5 2.7 12.5 6.5H40v8h-3.2a12 12 0 0 1-3.8 5V38h-5v-3.5h-7V38h-5v-5.8A11 11 0 0 1 10 25z"/><circle class="d" cx="32" cy="21.5" r="1.6"/><path class="lw" d="M20 18h7"/>
    <g class="ca-drop">${coin(23.5, 7, 4)}</g>`,
  coffee: `<path class="k" d="M10 19h22v11a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z"/><path class="ln ln--k" d="M32 22h2.5a4.5 4.5 0 0 1 0 9H31"/><rect class="d" x="7" y="40" width="28" height="3" rx="1.5"/>
    <g class="ca-rise"><path class="ln ln--s" d="M16 15c-2-2 2-3.5 0-6"/><path class="ln ln--s" d="M22 15c-2-2 2-3.5 0-6"/><path class="ln ln--s" d="M28 15c-2-2 2-3.5 0-6"/></g>`,
});

/** Nombre corto de cada dibujo (para pruebas y para la galería de muestra). @type {Readonly<Record<ArtKey, string>>} */
export const ART_LABELS = Object.freeze({
  salary: 'Salario', pension: 'Pensión', rentIn: 'Alquiler recibido', commission: 'Comisiones', sales: 'Ventas', tips: 'Propinas',
  bonus: 'Bonificaciones', gift: 'Regalos', incomeOther: 'Otros ingresos', rent: 'Alquiler', electricity: 'Electricidad', water: 'Agua',
  internet: 'Internet', transport: 'Transporte', food: 'Alimentación', fuel: 'Combustible', health: 'Salud', clothes: 'Ropa',
  restaurant: 'Restaurantes', entertainment: 'Entretenimiento', debt: 'Deudas', expenseOther: 'Otros gastos', services: 'Servicios',
  merchandise: 'Mercancía', marketing: 'Marketing', payroll: 'Nómina', taxes: 'Impuestos', software: 'Software',
  professional: 'Servicios profesionales', bank: 'Banco', equipment: 'Equipos', education: 'Educación', phone: 'Teléfono',
  pets: 'Mascotas', gym: 'Gimnasio', travel: 'Viajes', savings: 'Ahorro', coffee: 'Café',
});

/**
 * El cuadrito con el dibujo de una clave.
 * @param {ArtKey} key @param {{ size?: 'sm' | 'md' | 'lg' }} [options]
 */
export function artTile(key, { size = 'md' } = {}) {
  return html`<span class="ca ca--${key} ca--${size}" data-art="${key}" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false">${raw(ART[key])}</svg></span>`;
}

/**
 * El cuadrito con el dibujo de una categoría (o del tipo de movimiento, si no tiene).
 * @param {{ id?: string, name?: string, kind?: string } | null | undefined} category
 * @param {string} [fallbackKind] @param {{ size?: 'sm' | 'md' | 'lg' }} [options]
 */
export function categoryArt(category, fallbackKind = 'expense', options = {}) {
  return artTile(categoryArtKey(category, fallbackKind), options);
}
