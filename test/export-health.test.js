// Reporte de salud financiera: dice lo mismo que la pantalla y sale en los tres formatos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo, buildCompanyDemo } from '../src/domain/demo.js';
import { companyHealth } from '../src/domain/company.js';
import { healthCards } from '../src/domain/companyCards.js';
import { makeFile } from '../src/export/index.js';
import { healthReport, withWorkspaceHeader } from '../src/export/reports.js';

const NOW = '2026-11-15T10:00:00.000Z';
const TODAY = '2026-11-15';
const now = new Date(Date.UTC(2026, 10, 15, 12));
const decoder = new TextDecoder();
let seq = 0;
const mv = (/** @type {'income'|'expense'} */ type, /** @type {string} */ date, /** @type {number} */ pesos, /** @type {any} */ classification = 'variable') => ({
  id: `m${++seq}`, type, amountCents: pesos * 100, date, time: '10:00', description: 'x', classification,
  categoryId: type === 'income' ? 'cat-inc-ventas' : 'cat-exp-otros', createdAt: NOW, updatedAt: NOW,
});
/** @returns {any} */
const dataOf = (movements = [], over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements, goals: [], contributions: [],
  debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], ...over,
});
const sheet = (/** @type {any} */ r, /** @type {string} */ name) => r.sheets.find((s) => s.name === name);

const base = () => dataOf([
  mv('income', '2026-09-05', 100000), mv('expense', '2026-09-06', 30000, 'fixed'), mv('expense', '2026-09-07', 30000),
  mv('income', '2026-10-05', 100000), mv('expense', '2026-10-06', 30000, 'fixed'), mv('expense', '2026-10-07', 30000),
]);

test('reporte de salud: hojas, cifras y textos iguales a los de la pantalla', () => {
  const data = base();
  const r = healthReport(data, TODAY);
  assert.equal(r.title, 'Reporte de salud financiera');
  assert.equal(r.fileBase, 'accontrol-salud-financiera-2026-11-15');
  assert.equal(r.csvSheet, 'Indicadores');
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.sheets.map((s) => s.name), ['Resumen', 'Indicadores', 'Detalle', 'Cómo se calcula']);

  const cards = healthCards(companyHealth(data, TODAY));
  const table = sheet(r, 'Indicadores').blocks[0];
  assert.deepEqual(table.headers, ['Indicador', 'Nivel', 'Cifra', 'Qué significa', 'Regla del nivel']);
  assert.equal(table.rows.length, 5);
  assert.deepEqual(table.rows.map((row) => row[0]), cards.map((c) => c.title));
  assert.deepEqual(table.rows.map((row) => row[1]), cards.map((c) => c.levelLabel));
  assert.deepEqual(table.rows.map((row) => row[3]), cards.map((c) => c.text));

  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.deepEqual(pairs['Ingreso de un mes típico'], { money: 10_000_000 });
  assert.deepEqual(pairs['Costos fijos de un mes típico'], { money: 3_000_000 });
  assert.deepEqual(pairs['Costos variables de un mes típico'], { money: 3_000_000 });
  assert.deepEqual(pairs['Dinero disponible'], { money: 8_000_000 });
  assert.match(String(pairs['Resumen']), /bien/);

  const detail = sheet(r, 'Detalle').blocks;
  assert.equal(detail.filter((b) => b.type === 'heading').length, 5);
  assert.equal(detail.filter((b) => b.type === 'table').length, 5);
});

test('reporte de salud: con la demostración avisa que son datos inventados', () => {
  const company = buildCompanyDemo(TODAY, NOW);
  const data = dataOf([...buildBusinessDemo(TODAY, NOW), ...company.movements], { debts: company.debts, debtPayments: company.debtPayments, assets: company.assets });
  const r = healthReport(data, TODAY);
  assert.ok(r.notes.some((n) => /demostración/.test(n)));
  const rows = sheet(r, 'Indicadores').blocks[0].rows;
  assert.ok(rows.every((row) => row[1] !== 'Sin datos'));
});

test('reporte de salud vacío: no inventa cifras', () => {
  const r = healthReport(dataOf(), TODAY);
  const rows = sheet(r, 'Indicadores').blocks[0].rows;
  assert.ok(rows.every((row) => row[1] === 'Sin datos' && row[2] !== '' ));
  assert.match(String(Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows)['Resumen']), /Todavía no hay datos/);
});

test('reporte de salud: se exporta en los tres formatos, siempre igual', () => {
  const r = withWorkspaceHeader(healthReport(base(), TODAY), /** @type {any} */ ({ name: 'ABC S.R.L.', kind: 'company', organization: null }));
  assert.match(r.subtitle, /Espacio: ABC S\.R\.L\./);
  /** @type {Record<string, any>} */
  const files = {};
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) {
    const f = makeFile(r, format, now);
    assert.ok(f.bytes.length > 100, format);
    assert.ok(f.filename.startsWith('accontrol-salud-financiera-2026-11-15.'), f.filename);
    assert.deepEqual(makeFile(r, format, now).bytes, f.bytes, `${format} es determinista`);
    files[format] = f;
  }
  const csv = decoder.decode(files.csv.bytes);
  assert.match(csv, /Punto de equilibrio/);
  assert.match(csv, /Meses de efectivo/);
  assert.match(csv, /Regla del nivel/);
  assert.equal(decoder.decode(files.pdf.bytes.slice(0, 5)), '%PDF-');
  // Hojas de Excel con sus nombres (el zip va sin comprimir).
  const xlsx = decoder.decode(files.xlsx.bytes);
  for (const name of ['Resumen', 'Indicadores', 'Detalle', 'Cómo se calcula']) assert.ok(xlsx.includes(name), name);
});
