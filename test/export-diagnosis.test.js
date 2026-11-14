// Reporte de diagnóstico: dice lo mismo que la pantalla y sale en los tres formatos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { buildDemoData } from '../src/domain/demo.js';
import { personalDiagnosis } from '../src/domain/diagnosis.js';
import { diagnosisCards, diagnosisPriorities, diagnosisSummaryText, feasibilityText } from '../src/domain/diagnosisCards.js';
import { makeFile } from '../src/export/index.js';
import { diagnosisReport, withWorkspaceHeader } from '../src/export/reports.js';

const NOW = '2026-07-20T12:00:00.000Z';
const TODAY = '2026-07-20';
const now = new Date(Date.UTC(2026, 6, 20, 12));
const decoder = new TextDecoder();
let seq = 0;
const mv = (/** @type {'income'|'expense'} */ type, /** @type {string} */ date, /** @type {number} */ pesos) => ({
  id: `m${++seq}`, type, amountCents: pesos * 100, date, time: '10:00', description: 'x', classification: /** @type {const} */ ('variable'),
  categoryId: type === 'income' ? 'cat-inc-salario' : 'cat-exp-otros', createdAt: NOW, updatedAt: NOW,
});
/** @returns {any} */
const dataOf = (over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements: [], goals: [], contributions: [],
  debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], ...over,
});
const goal = (/** @type {string} */ id, /** @type {number} */ pesos, /** @type {string} */ targetDate) => ({
  id, name: `Meta ${id}`, description: '', targetCents: pesos * 100, targetDate, createdAt: NOW, updatedAt: NOW,
});
const sheet = (/** @type {any} */ r, /** @type {string} */ name) => r.sheets.find((s) => s.name === name);

const base = () => dataOf({
  movements: [mv('income', '2026-06-05', 50_000), mv('expense', '2026-06-10', 20_000)],
  goals: [goal('a', 20_000, '2026-08-10'), goal('b', 20_000, '2026-08-15')],
});

test('reporte de diagnóstico: hojas, cifras y textos iguales a los de la pantalla', () => {
  const data = base();
  const r = diagnosisReport(data, TODAY);
  assert.equal(r.title, 'Reporte de diagnóstico financiero');
  assert.equal(r.fileBase, 'accontrol-diagnostico-2026-07-20');
  assert.equal(r.csvSheet, 'Indicadores');
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.sheets.map((s) => s.name), ['Resumen', 'Indicadores', 'Detalle', 'Metas', 'Cómo se calcula']);

  const d = personalDiagnosis(data, TODAY);
  const cards = diagnosisCards(d);
  const table = sheet(r, 'Indicadores').blocks[0];
  assert.deepEqual(table.headers, ['Indicador', 'Nivel', 'Cifra', 'Qué significa', 'Qué falta para «Bien»', 'Regla del nivel']);
  assert.deepEqual(table.rows.map((row) => row[0]), cards.map((c) => c.title));
  assert.deepEqual(table.rows.map((row) => row[1]), cards.map((c) => c.levelLabel));
  assert.deepEqual(table.rows.map((row) => row[3]), cards.map((c) => c.text));
  assert.deepEqual(table.rows.map((row) => row[4]), cards.map((c) => c.hint || '—'), 'sin sugerencia sale «—», nunca vacío');
  assert.deepEqual(table.rows.map((row) => row[5]), cards.map((c) => c.rule));

  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.equal(pairs['Resumen'], diagnosisSummaryText(d));
  assert.deepEqual(pairs['Ingreso de un mes típico'], { money: 5_000_000 });
  assert.deepEqual(pairs['Gastos de un mes típico (sin pagos de deudas)'], { money: 2_000_000 });
  assert.deepEqual(pairs['Cuotas de deudas al mes'], { money: 0 });
  assert.deepEqual(pairs['Capacidad de ahorro al mes'], { money: 3_000_000 });
  assert.deepEqual(pairs['Dinero disponible (sin lo apartado en metas)'], { money: 3_000_000 });
  assert.equal(pairs['Qué mirar primero'], diagnosisPriorities(d).map((p) => `${p.title} (${p.levelLabel})`).join(', '));
  const text = sheet(r, 'Resumen').blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
  assert.match(text, /no es inteligencia artificial/);

  const detail = sheet(r, 'Detalle').blocks;
  assert.equal(detail.filter((b) => b.type === 'heading').length, cards.length);
  assert.equal(detail.filter((b) => b.type === 'table').length, cards.length);
  assert.ok(detail.some((b) => b.type === 'heading' && b.text === 'Tasa de ahorro · Bien'));
  const savingsTable = detail[detail.findIndex((b) => b.type === 'heading' && b.text === 'Tasa de ahorro · Bien') + 1];
  assert.deepEqual(savingsTable.rows, cards[0].details.map((row) => [row.label, row.value]));
  assert.ok(savingsTable.rows.length >= 3);
});

test('reporte de diagnóstico: una fila por meta pendiente con su viabilidad y totales', () => {
  const data = base();
  const r = diagnosisReport(data, TODAY);
  const t = sheet(r, 'Metas').blocks[0];
  assert.equal(t.type, 'table');
  assert.deepEqual(t.headers, ['Meta', 'Fecha objetivo', 'Falta', 'Aporte mensual necesario', 'Le toca de tu capacidad', 'Viabilidad', 'Qué significa']);
  const d = personalDiagnosis(data, TODAY);
  assert.deepEqual(t.rows.map((row) => row[0]), ['Meta a', 'Meta b']);
  assert.deepEqual(t.rows.map((row) => row[5]), ['Viable', 'Ajustada']);
  assert.deepEqual(t.rows.map((row) => row[6]), d.feasibility.goals.map((g) => feasibilityText(g, d.capacityCents).text));
  assert.deepEqual(t.rows[0].slice(1, 5), [{ date: '2026-08-10' }, { money: 2_000_000 }, { money: 2_000_000 }, { money: 2_000_000 }]);
  assert.deepEqual(t.rows[1].slice(2, 5), [{ money: 2_000_000 }, { money: 2_000_000 }, { money: 1_000_000 }]);
  assert.deepEqual(t.totals, ['Total', null, { money: 4_000_000 }, { money: 4_000_000 }, { money: 3_000_000 }, null, null]);
});

test('reporte de diagnóstico sin metas: lo dice en vez de una tabla vacía', () => {
  const r = diagnosisReport(dataOf({ movements: [mv('income', '2026-06-05', 50_000), mv('expense', '2026-06-10', 20_000)] }), TODAY);
  const blocks = sheet(r, 'Metas').blocks;
  assert.deepEqual(blocks, [{ type: 'text', text: 'No hay metas pendientes que evaluar.' }]);
});

test('reporte de diagnóstico vacío: no inventa cifras', () => {
  const r = diagnosisReport(dataOf(), TODAY);
  const rows = sheet(r, 'Indicadores').blocks[0].rows;
  assert.ok(rows.every((row) => row[1] === 'Sin datos' && row[2] === '—'));
  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.equal(pairs['Resumen'], 'Todavía no hay datos para hacer el diagnóstico.');
  assert.equal(pairs['Capacidad de ahorro al mes'], 'Sin datos');
  assert.equal(pairs['Qué mirar primero'], 'Nada en riesgo ni en atención con estas reglas.');
  const detail = sheet(r, 'Detalle').blocks.filter((blk) => blk.type === 'table');
  assert.ok(detail.length > 0 && detail.every((blk) => blk.rows.length === 1 && blk.rows[0][0] === 'Sin detalle todavía'), 'sin datos no hay detalle, y la tabla no queda vacía');
});

test('reporte de diagnóstico: con la demostración avisa que son datos inventados', () => {
  const demo = buildDemoData(TODAY, NOW);
  const data = dataOf({ ...demo, clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [] });
  const r = diagnosisReport(data, TODAY);
  assert.ok(r.notes.some((n) => /demostración/.test(n)));
  for (const row of sheet(r, 'Indicadores').blocks[0].rows) for (const cell of row) assert.doesNotMatch(String(cell), /undefined|NaN|null/);
});

test('reporte de diagnóstico: «Cómo se calcula» trae los cortes vigentes', () => {
  const text = sheet(diagnosisReport(base(), TODAY), 'Cómo se calcula').blocks.map((b) => b.text).join('\n');
  assert.match(text, /20% o más = Bien; 10% o más = Atención/);
  assert.match(text, /6 meses o más = Bien; 3 o más = Atención/);
  assert.match(text, /20% o menos = Bien; hasta 35% = Atención/);
  assert.match(text, /promedio de los últimos 3 meses completos/);
});

test('reporte de diagnóstico: se exporta en los tres formatos, siempre igual', () => {
  const r = withWorkspaceHeader(diagnosisReport(base(), TODAY), /** @type {any} */ ({ name: 'Mi espacio personal', kind: 'personal', organization: null }));
  assert.match(r.subtitle, /Espacio: Mi espacio personal/);
  /** @type {Record<string, any>} */
  const files = {};
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) {
    const f = makeFile(r, format, now);
    assert.ok(f.bytes.length > 100, format);
    assert.ok(f.filename.startsWith('accontrol-diagnostico-2026-07-20.'), f.filename);
    assert.deepEqual(makeFile(r, format, now).bytes, f.bytes, `${format} es determinista`);
    files[format] = f;
  }
  const csv = decoder.decode(files.csv.bytes);
  assert.match(csv, /Tasa de ahorro/);
  assert.match(csv, /Colchón de emergencia/);
  assert.match(csv, /Qué falta para «Bien»/);
  assert.equal(decoder.decode(files.pdf.bytes.slice(0, 5)), '%PDF-');
  const xlsx = decoder.decode(files.xlsx.bytes);
  for (const name of ['Resumen', 'Indicadores', 'Detalle', 'Metas', 'Cómo se calcula']) assert.ok(xlsx.includes(name), name);
});
