// @ts-check
// =============================================================================
// MODELO DE REPORTE (común a CSV, Excel y PDF)
// -----------------------------------------------------------------------------
// Un reporte se describe UNA vez (títulos, tablas, montos) y tres escritores lo
// convierten a CSV, Excel o PDF. Así los tres formatos muestran los mismos
// números y no pueden contradecirse.
//
// Celdas:
//   "texto"             texto
//   { money: 123450 }   monto en centavos (RD$ 1,234.50)
//   { date: "AAAA-MM-DD" }
//   { int: 12 }         número entero
//   { pct: 22.8 }       porcentaje (22.8 %)
//   null                celda vacía
// =============================================================================

import { formatDate } from '../domain/dates.js';
import { formatMoney } from '../domain/money.js';

/** @typedef {string | { money: number } | { date: string } | { int: number } | { pct: number } | null} Cell */

/**
 * @typedef {Object} TableBlock
 * @property {'table'} type
 * @property {string[]} headers
 * @property {Cell[][]} rows
 * @property {Cell[]} [totals]   Fila de totales (se muestra en negrita).
 *
 * @typedef {{ type: 'heading', text: string }} HeadingBlock
 * @typedef {{ type: 'text', text: string }} TextBlock
 * @typedef {{ type: 'pairs', rows: [string, Cell][] }} PairsBlock
 * @typedef {TableBlock | HeadingBlock | TextBlock | PairsBlock} Block
 *
 * @typedef {Object} Sheet
 * @property {string} name
 * @property {Block[]} blocks
 *
 * @typedef {Object} Report
 * @property {string} title
 * @property {string} subtitle
 * @property {string[]} notes       Avisos que van al inicio (por ejemplo "Incluye datos de demostración").
 * @property {Sheet[]} sheets
 * @property {string} fileBase      Nombre del archivo sin extensión.
 * @property {string} csvSheet      Hoja cuya primera tabla se exporta como CSV (un CSV solo lleva una tabla).
 */

/** @param {number} cents @returns {Cell} */
export const money = (cents) => ({ money: cents });
/** @param {string} iso @returns {Cell} */
export const date = (iso) => ({ date: iso });
/** @param {number} n @returns {Cell} */
export const int = (n) => ({ int: n });
/** @param {number} value @returns {Cell} */
export const pct = (value) => ({ pct: value });

/**
 * Texto para pantalla y PDF.
 * @param {Cell} cell
 */
export function cellText(cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if ('money' in cell) return formatMoney(cell.money);
  if ('date' in cell) return formatDate(cell.date);
  if ('int' in cell) return String(cell.int);
  return `${(Math.round(cell.pct * 10) / 10).toString()} %`;
}

/** ¿Se alinea a la derecha? (números) @param {Cell} cell */
export function isNumericCell(cell) {
  return cell !== null && typeof cell === 'object' && ('money' in cell || 'int' in cell || 'pct' in cell);
}

/** Centavos como "1234.50" (sin símbolo ni separadores de miles; lo que Excel entiende en cualquier idioma). @param {number} cents */
export function centsToPlain(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Nombre de archivo seguro (sin tildes ni símbolos). @param {string} text */
export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'reporte';
}
