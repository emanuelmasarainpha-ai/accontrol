// Reportes de facturas internas: dicen lo mismo que la pantalla, no inventan cifras y salen iguales en CSV, Excel y PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { buildInvoiceDemo } from '../src/domain/demo.js';
import { NOT_FISCAL_NOTE, invoiceReceivables } from '../src/domain/invoices.js';
import { makeFile } from '../src/export/index.js';
import { invoiceReport, invoicesReport, withWorkspaceHeader } from '../src/export/reports.js';

const NOW = '2026-11-15T10:00:00.000Z';
const TODAY = '2026-11-15';
const now = new Date(Date.UTC(2026, 10, 15, 12));
const decoder = new TextDecoder();

/** @returns {any} */
const dataOf = (over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements: [], goals: [], contributions: [],
  debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], ...over,
});
const sheet = (/** @type {any} */ r, /** @type {string} */ name) => r.sheets.find((s) => s.name === name);
const invoice = (/** @type {string} */ id, /** @type {number} */ number, /** @type {any} */ over = {}) => ({
  id, number, customerName: 'Cliente', customerTaxId: '', customerContact: '', issueDate: '2026-11-10', dueDate: '', lines: [{ description: 'Servicio', quantity: 1, unitCents: 100_000 }],
  taxRateBp: 0, notes: '', createdAt: NOW, updatedAt: NOW, ...over,
});
const payment = (/** @type {string} */ id, /** @type {string} */ invoiceId, /** @type {number} */ amountCents, /** @type {string} */ date, /** @type {any} */ over = {}) => ({
  id, invoiceId, amountCents, date, time: '10:00', note: '', movementId: `m-${id}`, createdAt: NOW, updatedAt: NOW, ...over,
});

// A (Hotel Sol): 2×100 + 1×50 = 250,00 + 18 % (45,00) = 295,00; cobró 100,00; venció el 15-oct → 31 días de atraso → saldo 195,00.
// B (Colegio): 1.000,00 sin impuesto, sin vencimiento, sin cobros → por vencer.  C: anulada (no suma).
const small = () => dataOf({
  invoices: [
    invoice('i1', 1, {
      customerName: 'Hotel Sol', customerTaxId: '101-12345-6', customerContact: 'compras@hotelsol.do', issueDate: '2026-10-01', dueDate: '2026-10-15', taxRateBp: 1800, notes: 'Pago por transferencia',
      lines: [{ description: 'Camisa azul', quantity: 2, unitCents: 10_000, productId: 'p1' }, { description: 'Envío', quantity: 1, unitCents: 5_000 }],
    }),
    invoice('i2', 2, { customerName: 'Colegio', lines: [{ description: 'Uniformes', quantity: 1, unitCents: 100_000 }] }),
    invoice('i3', 3, { customerName: 'Hotel Sol', voidedAt: '2026-11-12T10:00:00.000Z' }),
  ],
  invoicePayments: [payment('c1', 'i1', 10_000, '2026-10-10', { note: 'Adelanto' })],
  products: [{ id: 'p1', name: 'Camisa', sku: '', unit: 'unidad', priceCents: 0, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW }],
});

test('reporte de facturas: hojas, cifras y textos iguales a los de la pantalla', () => {
  const data = small();
  const r = invoicesReport(data, TODAY);
  assert.equal(r.title, 'Reporte de facturas');
  assert.equal(r.fileBase, 'accontrol-facturas-2026-11-15');
  assert.equal(r.csvSheet, 'Facturas');
  assert.deepEqual(r.notes, [NOT_FISCAL_NOTE]);
  assert.deepEqual(r.sheets.map((s) => s.name), ['Resumen', 'Facturas', 'Líneas', 'Cobros', 'Por cliente']);

  const recv = invoiceReceivables(data, TODAY);
  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.deepEqual(pairs['Por cobrar (facturas con saldo)'], { money: recv.totalCents });
  assert.deepEqual(pairs['Por cobrar (facturas con saldo)'], { money: 19_500 + 100_000 });
  assert.deepEqual(pairs['Facturas con saldo'], { int: 2 });
  assert.deepEqual(pairs['Vencido'], { money: 19_500 });
  assert.deepEqual(pairs['Facturas vencidas'], { int: 1 });
  assert.deepEqual(pairs['Días de atraso de la más atrasada'], { int: 31 });
  assert.deepEqual(pairs['Facturado en noviembre 2026'], { money: 100_000 }, 'solo B (A es de octubre; C está anulada)');
  assert.deepEqual(pairs['Cobrado en noviembre 2026'], { money: 0 });
  assert.deepEqual(pairs['Facturado en 2026'], { money: 29_500 + 100_000 });
  assert.deepEqual(pairs['Cobrado en 2026'], { money: 10_000 });

  const aging = sheet(r, 'Resumen').blocks[2];
  assert.deepEqual(aging.rows.map((/** @type {any[]} */ x) => x[1]), [{ money: 100_000 }, { money: 0 }, { money: 19_500 }, { money: 0 }]);
  assert.deepEqual(aging.totals, ['Total', { money: 119_500 }], 'los tramos suman lo por cobrar');
  assert.match(JSON.stringify(sheet(r, 'Resumen').blocks), /documentos internos de control, no comprobantes fiscales/);
});

test('reporte de facturas: una fila por factura (con anuladas), totales sin las anuladas', () => {
  const r = invoicesReport(small(), TODAY);
  const t = sheet(r, 'Facturas').blocks[0];
  assert.deepEqual(t.headers, ['Número', 'Fecha', 'Cliente', 'RNC o cédula', 'Vence', 'Estado', 'Días de atraso', 'Subtotal', 'Impuesto', 'Total', 'Cobrado', 'Por cobrar', 'Marca']);
  assert.equal(t.rows.length, 3);
  const byNumber = Object.fromEntries(t.rows.map((/** @type {any[]} */ row) => [row[0], row]));
  const a = byNumber['F-0001'];
  assert.deepEqual([a[2], a[3], a[5], a[6]], ['Hotel Sol', '101-12345-6', 'Vencida', { int: 31 }]);
  assert.deepEqual(a.slice(7, 12), [{ money: 25_000 }, { money: 4_500 }, { money: 29_500 }, { money: 10_000 }, { money: 19_500 }]);
  const b = byNumber['F-0002'];
  assert.deepEqual([b[4], b[5], b[6], b[11]], ['Sin vencimiento', 'Emitida', null, { money: 100_000 }]);
  const c = byNumber['F-0003'];
  assert.equal(c[5], 'Anulada');
  assert.deepEqual(c[11], { money: 0 }, 'una anulada no debe nada');
  assert.deepEqual(t.totals, ['Total (sin anuladas)', null, '', '', null, '', null, { money: 125_000 }, { money: 4_500 }, { money: 129_500 }, { money: 10_000 }, { money: 119_500 }, '']);
});

test('reporte de facturas: líneas, cobros y deuda por cliente', () => {
  const r = invoicesReport(small(), TODAY);
  const lines = sheet(r, 'Líneas').blocks[0].rows;
  assert.equal(lines.length, 4, 'dos de A, una de B y una de C');
  assert.deepEqual(lines.map((/** @type {any[]} */ x) => x[0]), ['F-0003', 'F-0002', 'F-0001', 'F-0001'], 'la más reciente primero, y las líneas en su orden');
  assert.deepEqual(lines[2], ['F-0001', 'Hotel Sol', 'Camisa azul', 'Camisa', { int: 2 }, { money: 10_000 }, { money: 20_000 }, '', '']);
  assert.deepEqual(lines[3].slice(2, 4), ['Envío', ''], 'una línea sin producto no inventa uno');
  assert.equal(lines[0][7], 'Anulada');
  const pays = sheet(r, 'Cobros').blocks[0];
  assert.deepEqual(pays.rows, [[{ date: '2026-10-10' }, '10:00', 'F-0001', 'Hotel Sol', { money: 10_000 }, 'Adelanto', '']]);
  const owing = sheet(r, 'Por cliente').blocks[0];
  assert.deepEqual(owing.rows, [
    ['Colegio', { int: 1 }, { money: 100_000 }, { money: 0 }, { int: 0 }],
    ['Hotel Sol', { int: 1 }, { money: 19_500 }, { money: 19_500 }, { int: 31 }],
  ]);
});

test('reporte de facturas: cada fila tiene tantas celdas como encabezados', () => {
  for (const data of [small(), dataOf(), dataOf({ invoices: buildInvoiceDemo(TODAY, NOW).invoices, invoicePayments: buildInvoiceDemo(TODAY, NOW).invoicePayments })]) {
    const r = invoicesReport(data, TODAY);
    for (const s of r.sheets) {
      for (const b of s.blocks) {
        if (b.type !== 'table') continue;
        for (const row of b.rows) assert.equal(row.length, b.headers.length, `${s.name}: ${JSON.stringify(row)}`);
        if (b.totals) assert.equal(b.totals.length, b.headers.length, `${s.name}: totales`);
      }
    }
  }
});

test('reporte de facturas: sin facturas no inventa nada y exporta', () => {
  const r = invoicesReport(dataOf(), TODAY);
  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.deepEqual(pairs['Por cobrar (facturas con saldo)'], { money: 0 });
  assert.deepEqual(sheet(r, 'Facturas').blocks[0].rows, []);
  assert.deepEqual(sheet(r, 'Cobros').blocks[0].rows, []);
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) assert.ok(makeFile(r, format, now).bytes.length > 50, format);
});

test('reporte de facturas: con datos de demostración lo avisa y marca cada fila', () => {
  const demo = buildInvoiceDemo(TODAY, NOW);
  const r = invoicesReport(dataOf({ invoices: demo.invoices, invoicePayments: demo.invoicePayments }), TODAY);
  assert.equal(r.notes.length, 2);
  assert.match(r.notes[1], /demostración/);
  const rows = sheet(r, 'Facturas').blocks[0].rows;
  assert.ok(rows.length > 0 && rows.every((/** @type {any[]} */ row) => row.at(-1) === 'DEMO'));
});

test('reporte de facturas: se exporta en los tres formatos, siempre igual', () => {
  const r = withWorkspaceHeader(invoicesReport(small(), TODAY), /** @type {any} */ ({ name: 'Mi tienda', kind: 'entrepreneur', organization: null }));
  assert.match(r.subtitle, /Espacio: Mi tienda/);
  /** @type {Record<string, any>} */
  const files = {};
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) {
    const f = makeFile(r, format, now);
    assert.ok(f.bytes.length > 100, format);
    assert.ok(f.filename.startsWith('accontrol-facturas-2026-11-15.'), f.filename);
    assert.deepEqual(makeFile(r, format, now).bytes, f.bytes, `${format} es determinista`);
    files[format] = f;
  }
  const csv = decoder.decode(files.csv.bytes);
  assert.match(csv, /F-0001/);
  assert.match(csv, /Hotel Sol/);
  assert.match(csv, /Anulada/);
  assert.doesNotMatch(csv, /Adelanto/, 'el CSV lleva solo la tabla de facturas');
  assert.equal(decoder.decode(files.pdf.bytes.slice(0, 5)), '%PDF-');
  const xlsx = decoder.decode(files.xlsx.bytes);
  for (const name of ['Resumen', 'Facturas', 'Líneas', 'Cobros', 'Por cliente']) assert.ok(xlsx.includes(name), name);
});

test('PDF de una factura: datos, líneas, totales y cobros, con la leyenda de documento interno', () => {
  const data = small();
  const r = invoiceReport(data, data.invoices[0], TODAY);
  assert.equal(r.title, 'Factura F-0001');
  assert.equal(r.fileBase, 'accontrol-factura-f-0001');
  assert.equal(r.csvSheet, 'Factura');
  assert.deepEqual(r.notes, [NOT_FISCAL_NOTE]);
  assert.match(r.subtitle, /situación al 2026-11-15/);
  const blocks = sheet(r, 'Factura').blocks;
  const details = Object.fromEntries(blocks[0].rows);
  assert.deepEqual([details['Estado'], details['Cliente'], details['RNC o cédula'], details['Contacto']], ['Vencida', 'Hotel Sol', '101-12345-6', 'compras@hotelsol.do']);
  assert.deepEqual([details['Fecha'], details['Vencimiento']], [{ date: '2026-10-01' }, { date: '2026-10-15' }]);
  assert.deepEqual(blocks[1], { type: 'text', text: 'Notas: Pago por transferencia' });
  const lines = blocks[2];
  assert.deepEqual(lines.headers, ['Descripción', 'Cantidad', 'Precio por unidad', 'Total']);
  assert.deepEqual(lines.rows, [['Camisa azul', { int: 2 }, { money: 10_000 }, { money: 20_000 }], ['Envío', { int: 1 }, { money: 5_000 }, { money: 5_000 }]]);
  const totals = Object.fromEntries(blocks[3].rows);
  assert.deepEqual([totals['Subtotal'], totals['Impuesto (18 %)'], totals['Total'], totals['Cobrado'], totals['Por cobrar'], totals['Días de atraso']],
    [{ money: 25_000 }, { money: 4_500 }, { money: 29_500 }, { money: 10_000 }, { money: 19_500 }, { int: 31 }]);
  const pays = blocks[5];
  assert.deepEqual(pays.rows, [[{ date: '2026-10-10' }, { money: 10_000 }, 'Adelanto']]);
  assert.deepEqual(pays.totals, ['Total cobrado', { money: 10_000 }, '']);
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) assert.ok(makeFile(r, format, now).bytes.length > 100, format);
});

test('PDF de una factura: sin cobros no trae la tabla de cobros; anulada y demo lo avisan', () => {
  const data = small();
  const open = invoiceReport(data, data.invoices[1], TODAY);
  assert.equal(sheet(open, 'Factura').blocks.length, 3, 'datos, líneas y totales');
  assert.equal(Object.fromEntries(sheet(open, 'Factura').blocks[0].rows)['Vencimiento'], 'Sin vencimiento');
  assert.equal(Object.fromEntries(sheet(open, 'Factura').blocks[2].rows)['Impuesto (0 %)'] !== undefined, true);

  const voided = invoiceReport(data, data.invoices[2], TODAY);
  assert.ok(voided.notes.includes('Esta factura está ANULADA.'));
  assert.equal(Object.fromEntries(sheet(voided, 'Factura').blocks[1].rows)['Por cobrar (factura anulada)']?.money ?? 0, 0);

  const demo = buildInvoiceDemo(TODAY, NOW);
  const demoReport = invoiceReport(dataOf({ invoices: demo.invoices, invoicePayments: demo.invoicePayments }), demo.invoices[0], TODAY);
  assert.match(demoReport.title, /DEMO-\d{3}/);
  assert.match(demoReport.notes.join(' '), /demostración/);
  assert.match(demoReport.fileBase, /^accontrol-factura-demo-\d{3}$/);
});

test('PDF de una factura: los textos largos se acortan para que no se salgan de la fila', () => {
  const long = invoice('i9', 9, { customerName: 'N'.repeat(80), customerContact: `${'x'.repeat(60)}@${'y'.repeat(40)}.do`, customerTaxId: '1'.repeat(30) });
  const r = invoiceReport(dataOf({ invoices: [long] }), long, TODAY);
  const details = Object.fromEntries(sheet(r, 'Factura').blocks[0].rows);
  for (const key of ['Cliente', 'RNC o cédula', 'Contacto']) assert.ok(String(details[key]).length <= 70, key);
  assert.ok(String(details['Cliente']).endsWith('…'));
  assert.ok(String(details['RNC o cédula']).length === 30 && !String(details['RNC o cédula']).endsWith('…'), 'lo corto no se toca');
});

test('reporte de facturas: los cobros salen del más reciente al más antiguo (fecha y luego hora)', () => {
  const data = small();
  data.invoicePayments.push(payment('c2', 'i1', 1_000, '2026-11-01', { time: '09:00', note: 'Mañana' }), payment('c3', 'i1', 2_000, '2026-11-01', { time: '15:00', note: 'Tarde' }));
  const rows = sheet(invoicesReport(data, TODAY), 'Cobros').blocks[0].rows;
  assert.deepEqual(rows.map((/** @type {any[]} */ x) => x[5]), ['Tarde', 'Mañana', 'Adelanto']);
  const single = invoiceReport(data, data.invoices[0], TODAY);
  assert.deepEqual(sheet(single, 'Factura').blocks[5].rows.map((/** @type {any[]} */ x) => x[2]), ['Adelanto', 'Mañana', 'Tarde'], 'en la factura, del más antiguo al más reciente (como en su ficha)');
});
