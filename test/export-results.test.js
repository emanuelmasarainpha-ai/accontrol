// Reporte de resultados (Emprendedor / Empresa): coincide con las cuentas de la pantalla y sale en los tres formatos.
// Cifras calculadas a mano con el mismo escenario de test/business.test.js; hoy = 2026-11-15.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo } from '../src/domain/demo.js';
import { incomeStatement, periodBounds, periodComparison } from '../src/domain/business.js';
import { makeFile } from '../src/export/index.js';
import { resultsReport, withWorkspaceHeader } from '../src/export/reports.js';

const NOW = '2026-11-15T10:00:00.000Z';
const TODAY = '2026-11-15';
const now = new Date(Date.UTC(2026, 10, 15, 12));
const decoder = new TextDecoder();
let seq = 0;
const mv = (type, date, amountCents, over = {}) => ({
  id: `m${++seq}`, type, amountCents, date, time: '10:00', description: 'x', classification: 'variable',
  categoryId: type === 'income' ? 'cat-inc-ventas' : 'cat-exp-otros', createdAt: NOW, updatedAt: NOW, ...over,
});
const inc = (date, cents, over) => mv('income', date, cents, over);
const exp = (date, cents, over) => mv('expense', date, cents, over);
/** @returns {any} */
const dataOf = (movements, extra = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements, goals: [], contributions: [],
  debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], ...extra,
});

function scenario() {
  const debtExpense = exp('2026-10-12', 40000, { categoryId: 'cat-exp-deudas' });
  return dataOf([
    inc('2025-11-10', 100000), exp('2025-11-11', 60000),
    inc('2026-05-10', 200000), exp('2026-05-11', 150000),
    inc('2026-06-10', 300000), exp('2026-06-11', 200000),
    inc('2026-07-10', 400000), exp('2026-07-11', 250000),
    inc('2026-08-10', 500000), exp('2026-08-11', 300000),
    inc('2026-09-10', 600000), exp('2026-09-11', 350000),
    inc('2026-10-10', 700000), exp('2026-10-11', 360000), debtExpense,
    inc('2026-11-10', 100000), exp('2026-11-12', 50000),
    inc('2026-11-20', 99999900, { categoryId: 'cat-inc-otros' }), // futuro: no cuenta
  ], { debtPayments: [{ id: 'p1', debtId: 'd1', kind: 'regular', amountCents: 40000, date: '2026-10-12', time: '10:00', note: '', movementId: debtExpense.id, createdAt: NOW, updatedAt: NOW }] });
}

/** @param {import('../src/export/model.js').Report} r @param {string} name */
const sheet = (r, name) => /** @type {any} */ (r.sheets.find((s) => s.name === name));
const tableOf = (r, name, index = 0) => sheet(r, name).blocks.filter((b) => b.type === 'table')[index];
const pairs = (r) => Object.fromEntries(sheet(r, 'Resumen').blocks.find((b) => b.type === 'pairs').rows);

test('reporte de resultados de octubre: cifras del estado de resultados, con pagos de deudas aparte', () => {
  const r = resultsReport(scenario(), 'month', '2026-10', TODAY);
  assert.equal(r.title, 'Reporte de resultados');
  assert.match(r.subtitle, /Mensual: octubre 2026/);
  assert.equal(r.fileBase, 'accontrol-resultados-2026-10-2026-11-15');
  assert.equal(r.csvSheet, 'Comparación');
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.sheets.map((s) => s.name), ['Resumen', 'Comparación', 'Categorías', 'Últimos 6 meses', 'Proyección']);

  const p = pairs(r);
  assert.deepEqual(p['Ingresos'], { money: 700000 });
  assert.deepEqual(p['Gastos'], { money: 400000 });
  assert.deepEqual(p['Beneficio neto'], { money: 300000 });
  assert.deepEqual(p['De los gastos, pagos de deudas'], { money: 40000 });
  assert.deepEqual(p['Beneficio antes de pagos de deudas'], { money: 340000 });
  assert.ok(Math.abs(p['Margen (beneficio ÷ ingresos)'].pct - 42.857142857) < 1e-6);
  assert.deepEqual(p['Rentabilidad (beneficio ÷ gastos)'], { pct: 75 });
  // Acumulado de 2026 hasta hoy (el ingreso fechado el 20 no cuenta): (2+3+4+5+6+7+1) − (1.5+2+2.5+3+3.5+4+0.5) = 28 − 17 = 11 mil.
  assert.deepEqual(p['Beneficio acumulado de 2026'], { money: 1100000 });
  assert.deepEqual(p['Beneficio acumulado desde el primer registro'], { money: 1100000 + 40000 });
});

test('reporte de resultados: la comparación coincide con la del dominio y no inventa porcentajes sin base', () => {
  const data = scenario();
  const r = resultsReport(data, 'month', '2026-10', TODAY);
  const cmp = tableOf(r, 'Comparación');
  assert.deepEqual(cmp.headers, ['Cifra', 'octubre 2026', 'septiembre 2026', 'Cambio', 'Variación', 'octubre 2025', 'Cambio', 'Variación']);
  assert.equal(cmp.rows.length, 4);
  const [ingresos, gastos, beneficio, margen] = cmp.rows;
  // Septiembre: ingresó 6,000 y gastó 3,500 → +1,000 (+16.67 %), +500 (+14.29 %), beneficio 2,500 → +500 (+20 %).
  assert.deepEqual(ingresos.slice(0, 4), ['Ingresos', { money: 700000 }, { money: 600000 }, { money: 100000 }]);
  assert.ok(Math.abs(ingresos[4].pct - 16.6666667) < 1e-4);
  assert.deepEqual(gastos.slice(1, 4), [{ money: 400000 }, { money: 350000 }, { money: 50000 }]);
  assert.ok(Math.abs(gastos[4].pct - 14.2857143) < 1e-4);
  assert.deepEqual(beneficio.slice(1, 5), [{ money: 300000 }, { money: 250000 }, { money: 50000 }, { pct: 20 }]);
  // Octubre de 2025 no tuvo movimientos: no hay con qué comparar → "—", nunca un % inventado.
  assert.deepEqual(ingresos.slice(5), [{ money: 0 }, { money: 700000 }, '—']);
  // Margen: septiembre 41.67 % → octubre 42.86 %: +1.19 puntos.
  assert.match(String(margen[0]), /^Margen/);
  assert.equal(margen[3], '+1.2 pts');
  // Cada fila tiene tantas celdas como encabezados.
  for (const row of cmp.rows) assert.equal(row.length, cmp.headers.length);
  // Y es lo mismo que calcula el dominio (lo que ve la pantalla).
  const domain = periodComparison(data, 'month', '2026-10', TODAY);
  assert.equal(ingresos[3].money, domain.previous.income.diffCents);
  assert.equal(beneficio[2].money, domain.previous.statement.netCents);
});

test('reporte de resultados: las categorías suman el total del período', () => {
  const data = scenario();
  const r = resultsReport(data, 'month', '2026-10', TODAY);
  const incomes = tableOf(r, 'Categorías', 0);
  const expenses = tableOf(r, 'Categorías', 1);
  assert.deepEqual(incomes.rows, [['Ventas', { money: 700000 }, { pct: 100 }]]);
  assert.deepEqual(expenses.rows.map((row) => [row[1], row[2]]), [[{ money: 360000 }, { pct: 90 }], [{ money: 40000 }, { pct: 10 }]]);
  assert.deepEqual(incomes.totals, ['Total', { money: 700000 }, { pct: 100 }]);
  assert.equal(expenses.rows.reduce((sum, row) => sum + row[1].money, 0), expenses.totals[1].money);
  assert.equal(expenses.totals[1].money, incomeStatement(data, periodBounds('month', '2026-10'), TODAY).expenseCents);
});

test('reporte de resultados: últimos 6 meses y proyección', () => {
  const r = resultsReport(scenario(), 'month', '2026-10', TODAY);
  const series = tableOf(r, 'Últimos 6 meses');
  assert.equal(series.rows.length, 6);
  assert.deepEqual(series.rows.map((row) => row[0]), ['junio 2026', 'julio 2026', 'agosto 2026', 'septiembre 2026', 'octubre 2026', 'noviembre 2026']);
  assert.deepEqual(series.rows.at(-1).slice(1, 4), [{ money: 100000 }, { money: 50000 }, { money: 50000 }]);
  assert.equal(series.rows.at(-1)[5], 'En curso');
  assert.equal(series.rows[0][5], '');

  // Tendencia exacta de mayo–octubre: ingresos +1,000/mes y gastos +500/mes → noviembre 8,000 / 4,500 / 3,500, sin dispersión.
  const proj = tableOf(r, 'Proyección');
  assert.equal(proj.rows.length, 3);
  assert.deepEqual(proj.rows[0].slice(0, 6), ['noviembre 2026', { money: 800000 }, { money: 450000 }, { money: 350000 }, { money: 350000 }, { money: 350000 }]);
  assert.deepEqual(proj.rows[2].slice(1, 4), [{ money: 1000000 }, { money: 550000 }, { money: 450000 }]);
  assert.deepEqual(proj.totals.slice(1, 4), [{ money: 2700000 }, { money: 1500000 }, { money: 1200000 }]);
  const text = sheet(r, 'Proyección').blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
  assert.match(text, /estimación, no una promesa/);
});

test('reporte de resultados: trimestre y año; el año no se compara con "el mismo período del año anterior"', () => {
  const q = resultsReport(scenario(), 'quarter', '2026-08', TODAY);
  assert.equal(q.fileBase, 'accontrol-resultados-2026-T3-2026-11-15');
  assert.deepEqual(pairs(q)['Ingresos'], { money: 400000 + 500000 + 600000 });
  assert.equal(tableOf(q, 'Comparación').headers.length, 8);

  const y = resultsReport(scenario(), 'year', '2026-10', TODAY);
  assert.equal(y.fileBase, 'accontrol-resultados-2026-2026-11-15');
  assert.match(String(pairs(y)['Período']), /en curso/);
  const cmp = tableOf(y, 'Comparación');
  assert.deepEqual(cmp.headers, ['Cifra', '2026', '2025', 'Cambio', 'Variación']);
  for (const row of cmp.rows) assert.equal(row.length, 5);
});

test('reporte de resultados: sin pagos de deudas no aparece esa línea', () => {
  const r = resultsReport(scenario(), 'month', '2026-09', TODAY);
  const p = pairs(r);
  assert.equal(p['De los gastos, pagos de deudas'], undefined);
  assert.equal(p['Beneficio antes de pagos de deudas'], undefined);
});

test('reporte de resultados: sin historia suficiente explica por qué no proyecta y no inventa cifras', () => {
  const few = dataOf([inc('2026-09-10', 100000), exp('2026-09-11', 40000), inc('2026-10-10', 120000), exp('2026-10-11', 50000), inc('2026-11-05', 10000)]);
  const r = resultsReport(few, 'month', '2026-11', TODAY);
  const blocks = sheet(r, 'Proyección').blocks;
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /hacen falta 3 meses completos \(tienes 2\)/);

  const empty = resultsReport(dataOf([]), 'month', '2026-11', TODAY);
  assert.match(sheet(empty, 'Proyección').blocks[0].text, /no hay movimientos/);
  assert.deepEqual(empty.notes, []);
  assert.deepEqual(pairs(empty)['Ingresos'], { money: 0 });
  assert.equal(pairs(empty)['Margen (beneficio ÷ ingresos)'], '—');
  assert.ok(tableOf(empty, 'Categorías', 0).rows.length === 0);
});

test('reporte de resultados: con la demostración de negocio avisa que son datos inventados', () => {
  const data = dataOf(buildBusinessDemo(TODAY, NOW));
  const r = resultsReport(data, 'month', '2026-10', TODAY);
  assert.ok(r.notes.some((n) => /demostración/.test(n)));
  assert.ok(pairs(r)['Ingresos'].money > 0);
});

test('reporte de resultados: lleva el espacio en el subtítulo y se exporta en los tres formatos, siempre igual', () => {
  const r = withWorkspaceHeader(resultsReport(scenario(), 'month', '2026-10', TODAY), /** @type {any} */ ({ name: 'Mi negocio', kind: 'entrepreneur', organization: null }));
  assert.match(r.subtitle, /Espacio: Mi negocio/);
  const files = {};
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) {
    const f = makeFile(r, format, now);
    assert.ok(f.bytes.length > 100, format);
    assert.ok(f.filename.startsWith('accontrol-resultados-2026-10-2026-11-15.'), f.filename);
    assert.deepEqual(makeFile(r, format, now).bytes, f.bytes, `${format} es determinista`);
    files[format] = f;
  }
  // El CSV es la tabla de comparación, con los números en texto plano.
  const csv = decoder.decode(files.csv.bytes);
  assert.match(csv, /Cifra/);
  assert.match(csv, /septiembre 2026/);
  assert.match(csv, /7000\.00|7,000\.00/);
  assert.equal(decoder.decode(files.pdf.bytes.slice(0, 5)), '%PDF-');
});
