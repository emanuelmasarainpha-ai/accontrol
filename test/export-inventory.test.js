// Reporte de inventario: dice lo mismo que la pantalla, no inventa cifras y sale igual en CSV, Excel y PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo, buildInventoryDemo } from '../src/domain/demo.js';
import { inventorySummary, salesAnalysis } from '../src/domain/inventory.js';
import { makeFile } from '../src/export/index.js';
import { inventoryReport, withWorkspaceHeader } from '../src/export/reports.js';

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

const product = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ over = {}) => ({
  id, name, sku: '', unit: 'unidad', priceCents: 0, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over,
});
let seq = 0;
const entry = (/** @type {string} */ productId, /** @type {'purchase'|'sale'|'adjustment'} */ kind, /** @type {number} */ quantity, /** @type {number} */ unitPesos, /** @type {string} */ date, /** @type {any} */ over = {}) => ({
  id: `e${++seq}`, productId, kind, quantity, unitCents: unitPesos * 100, date, time: '10:00', note: '', createdAt: NOW, updatedAt: NOW, ...over,
});

// Camisa: compra 10 a 200, venta 4 a 500 (costo 800), merma de 1 (costo 200 de las 6 restantes). Stock 5, valor 1,000.
const small = () => dataOf({
  products: [product('p1', 'Camisa', { sku: 'CAM-1', priceCents: 50000, minStock: 5 }), product('p2', 'Gorra')],
  suppliers: [{ id: 's1', name: 'Sol', contact: 'Marta', email: 'v@sol.do', phone: '+1 809 555 0100', notes: '', archived: false, createdAt: NOW, updatedAt: NOW }],
  stockEntries: [
    entry('p1', 'purchase', 10, 200, '2026-11-02', { supplierId: 's1', note: 'F-1' }),
    entry('p1', 'sale', -4, 500, '2026-11-05'),
    entry('p1', 'adjustment', -1, 0, '2026-11-06', { note: 'Rota' }),
  ],
});

test('reporte de inventario: hojas, cifras y textos iguales a los de la pantalla', () => {
  const data = small();
  const r = inventoryReport(data, TODAY);
  assert.equal(r.title, 'Reporte de inventario');
  assert.equal(r.fileBase, 'accontrol-inventario-2026-11-15');
  assert.equal(r.csvSheet, 'Productos');
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.sheets.map((s) => s.name), ['Resumen', 'Productos', 'Movimientos de stock', 'Ventas y ganancia', 'Proveedores']);

  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.deepEqual(pairs['Valor del inventario (costo promedio)'], { money: 100_000 });
  assert.deepEqual(pairs['Unidades en stock (de todos los productos)'], { int: 5 });
  assert.deepEqual(pairs['Productos activos'], { int: 2 });
  assert.deepEqual(pairs['Productos con stock bajo o agotados'], { int: 1 }, 'Camisa (5 ≤ aviso 5); Gorra no pidió aviso');
  assert.deepEqual(pairs['Ventas de noviembre 2026'], { money: 200_000 });
  assert.deepEqual(pairs['Costo de lo vendido en noviembre 2026'], { money: 80_000 });
  assert.deepEqual(pairs['Ganancia bruta de noviembre 2026'], { money: 120_000 });
  assert.deepEqual(pairs['Margen de noviembre 2026'], { pct: 60 });
  assert.deepEqual(pairs['Mermas del mes (costo de las unidades perdidas por ajustes)'], { money: 20_000 });
});

test('reporte de inventario: un renglón por producto, con su situación', () => {
  const r = inventoryReport(small(), TODAY);
  const table = sheet(r, 'Productos').blocks[0];
  assert.deepEqual(table.headers, ['Producto', 'Código', 'Unidad', 'Situación', 'Stock', 'Costo promedio', 'Valor en stock', 'Precio de venta', 'Aviso en', 'Marca']);
  assert.deepEqual(table.rows, [
    ['Camisa', 'CAM-1', 'unidad', 'Stock bajo', { int: 5 }, { money: 20_000 }, { money: 100_000 }, { money: 50_000 }, { int: 5 }, ''],
    ['Gorra', '', 'unidad', 'Sin movimientos', { int: 0 }, { money: 0 }, { money: 0 }, null, null, ''],
  ]);
  assert.deepEqual(table.totals, ['Total', '', '', '', null, null, { money: 100_000 }, null, null, '']);
});

test('reporte de inventario: todos los movimientos de stock en orden, con lo que costó lo que salió', () => {
  const r = inventoryReport(small(), TODAY);
  const table = sheet(r, 'Movimientos de stock').blocks[0];
  assert.deepEqual(table.rows, [
    [{ date: '2026-11-02' }, '10:00', 'Camisa', 'Compra', { int: 10 }, { money: 20_000 }, { money: 200_000 }, null, 'Sol', 'F-1', ''],
    [{ date: '2026-11-05' }, '10:00', 'Camisa', 'Venta', { int: -4 }, { money: 50_000 }, { money: 200_000 }, { money: 80_000 }, '', '', ''],
    [{ date: '2026-11-06' }, '10:00', 'Camisa', 'Ajuste', { int: -1 }, null, null, { money: 20_000 }, '', 'Rota', ''],
  ]);
});

test('reporte de inventario: ventas y ganancia del mes y del año, y compras por proveedor', () => {
  const r = inventoryReport(small(), TODAY);
  const blocks = sheet(r, 'Ventas y ganancia').blocks;
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'table', 'heading', 'table']);
  assert.equal(blocks[0].text, 'Ventas de noviembre 2026');
  for (const i of [1, 3]) {
    assert.deepEqual(blocks[i].rows, [['Camisa', { int: 4 }, { money: 200_000 }, { money: 80_000 }, { money: 120_000 }, { pct: 60 }, '']]);
    assert.deepEqual(blocks[i].totals, ['Total', { int: 4 }, { money: 200_000 }, { money: 80_000 }, { money: 120_000 }, { pct: 60 }, '']);
  }
  const suppliers = sheet(r, 'Proveedores').blocks[0];
  assert.deepEqual(suppliers.rows, [['Sol', 'Marta', 'v@sol.do', '+1 809 555 0100', 'Activo', { int: 1 }, { money: 200_000 }, { date: '2026-11-02' }, '']]);
});

test('reporte de inventario: una venta de otro mes cuenta en el año pero no en el mes', () => {
  const data = small();
  data.stockEntries.push(entry('p1', 'sale', -2, 500, '2026-09-10'), entry('p1', 'purchase', 2, 200, '2026-09-01'));
  const r = inventoryReport(data, TODAY);
  const blocks = sheet(r, 'Ventas y ganancia').blocks;
  assert.deepEqual(blocks[1].totals?.[2], { money: 200_000 }, 'mes: solo la venta de noviembre');
  assert.deepEqual(blocks[3].totals?.[2], { money: 300_000 }, 'año: noviembre y septiembre');
});

test('reporte de inventario: un producto archivado se marca y su valor sigue contando', () => {
  const data = small();
  data.products[0].archived = true;
  const r = inventoryReport(data, TODAY);
  const table = sheet(r, 'Productos').blocks[0];
  // Los archivados van al final de la lista, como en la pantalla.
  assert.deepEqual(table.rows.map((row) => [row[0], row[3]]), [['Gorra', 'Sin movimientos'], ['Camisa', 'Archivado']]);
  assert.deepEqual(table.totals?.[6], { money: 100_000 });
  assert.deepEqual(Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows)['Productos activos'], { int: 1 });
});

test('reporte de inventario con la demostración: avisa que es inventada y marca cada fila DEMO', () => {
  const inv = buildInventoryDemo(TODAY, NOW);
  const data = dataOf({ movements: [...buildBusinessDemo(TODAY, NOW), ...inv.movements], products: inv.products, suppliers: inv.suppliers, stockEntries: inv.stockEntries });
  const r = inventoryReport(data, TODAY);
  assert.ok(r.notes.some((n) => /demostración/.test(n)));
  assert.ok(sheet(r, 'Productos').blocks[0].rows.every((row) => row[9] === 'DEMO'));
  assert.ok(sheet(r, 'Movimientos de stock').blocks[0].rows.every((row) => row[10] === 'DEMO'));
  assert.ok(sheet(r, 'Proveedores').blocks[0].rows.every((row) => row[8] === 'DEMO'));
  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.deepEqual(pairs['Valor del inventario (costo promedio)'], { money: inventorySummary(data).totalValueCents });
  const month = salesAnalysis(data, `${TODAY.slice(0, 7)}-01`, TODAY);
  assert.deepEqual(pairs['Ventas de noviembre 2026'], { money: month.revenueCents });
});

test('reporte de inventario vacío: no inventa cifras ni falla', () => {
  const r = inventoryReport(dataOf(), TODAY);
  const pairs = Object.fromEntries(sheet(r, 'Resumen').blocks[0].rows);
  assert.deepEqual(pairs['Valor del inventario (costo promedio)'], { money: 0 });
  assert.equal(pairs['Margen de noviembre 2026'], 'Sin ventas');
  assert.deepEqual(sheet(r, 'Productos').blocks[0].rows, []);
  assert.deepEqual(sheet(r, 'Movimientos de stock').blocks[0].rows, []);
  assert.deepEqual(sheet(r, 'Ventas y ganancia').blocks[1].totals?.[5], null);
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) assert.ok(makeFile(r, format, now).bytes.length > 50, format);
});

test('reporte de inventario: se exporta en los tres formatos, siempre igual', () => {
  const r = withWorkspaceHeader(inventoryReport(small(), TODAY), /** @type {any} */ ({ name: 'Mi tienda', kind: 'entrepreneur', organization: null }));
  assert.match(r.subtitle, /Espacio: Mi tienda/);
  /** @type {Record<string, any>} */
  const files = {};
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) {
    const f = makeFile(r, format, now);
    assert.ok(f.bytes.length > 100, format);
    assert.ok(f.filename.startsWith('accontrol-inventario-2026-11-15.'), f.filename);
    assert.deepEqual(makeFile(r, format, now).bytes, f.bytes, `${format} es determinista`);
    files[format] = f;
  }
  const csv = decoder.decode(files.csv.bytes);
  assert.match(csv, /Valor en stock/);
  assert.match(csv, /Camisa/);
  assert.match(csv, /CAM-1/);
  assert.doesNotMatch(csv, /Rota/, 'el CSV lleva solo la tabla de productos');
  assert.equal(decoder.decode(files.pdf.bytes.slice(0, 5)), '%PDF-');
  const xlsx = decoder.decode(files.xlsx.bytes);
  for (const name of ['Resumen', 'Productos', 'Movimientos de stock', 'Ventas y ganancia', 'Proveedores']) assert.ok(xlsx.includes(name), name);
});
