// @ts-check
// =============================================================================
// CSV
// -----------------------------------------------------------------------------
// Texto separado por comas. Se escribe con BOM UTF-8 (para que Excel muestre bien
// las tildes) y saltos de línea CRLF. Los montos van como números simples
// ("1234.50") para que Excel y Google Sheets puedan sumarlos.
//
// Seguridad: si un texto empieza con = + - @ (o tabulador), Excel podría
// interpretarlo como una fórmula. Se le antepone ' para que se lea como texto.
// Además, TODO texto va entre comillas: en los Excel cuyo separador de listas es
// «;» (España, Colombia, Argentina…), un texto como «Pago;=FÓRMULA» sin comillas
// se partiría en dos celdas y la segunda se ejecutaría (auditoría, 2026-11-14).
// =============================================================================

import { centsToPlain } from './model.js';

/** @typedef {import('./model.js').Cell} Cell */
/** @typedef {import('./model.js').Report} Report */

/** @param {string} text */
export function neutralizeFormula(text) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Texto entre comillas (las comillas internas se duplican). @param {string} text */
function quote(text) {
  return `"${text.replace(/"/g, '""')}"`;
}

/** @param {Cell} cell */
export function csvCell(cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return quote(neutralizeFormula(cell));
  if ('money' in cell) return centsToPlain(cell.money);
  if ('date' in cell) return cell.date;
  if ('int' in cell) return String(cell.int);
  return String(Math.round(cell.pct * 10) / 10);
}

/**
 * @param {string[]} headers @param {Cell[][]} rows
 * @returns {string}
 */
export function toCsv(headers, rows) {
  const lines = [headers.map((h) => quote(neutralizeFormula(h))).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * CSV de la primera tabla de la hoja `report.csvSheet` (un CSV solo puede llevar una tabla).
 * @param {Report} report
 */
export function reportToCsv(report) {
  const sheet = report.sheets.find((s) => s.name === report.csvSheet) ?? report.sheets[0];
  const block = sheet?.blocks.find((b) => b.type === 'table');
  if (!block || block.type !== 'table') return toCsv([], []);
  return toCsv(block.headers, block.totals ? [...block.rows, block.totals] : block.rows);
}
