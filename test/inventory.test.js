// Inventario: productos, proveedores, stock, costo promedio, ventas y la regla «el stock nunca queda negativo».
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import {
  MAX_QUANTITY, applyProductEdit, applySupplierEdit, buildProduct, buildStockEntry, buildStockMovement, buildSupplier,
  deletionProblem, inventoryEnabled, inventoryNotices, inventorySummary, productUsage, replayProduct, salesAnalysis,
  sortEntries, sortProducts, sortSuppliers, stockMovementDescription, stockPositions, supplierTotals, supplierUsage,
  validateProduct, validateStockEntry, validateSupplier,
} from '../src/domain/inventory.js';
import { LIMITS } from '../src/domain/types.js';

const NOW = '2026-07-20T12:00:00.000Z';
const TODAY = '2026-07-20';
const categories = defaultCategories();
const CAT_EXPENSE = 'cat-exp-otros';
const CAT_INCOME = 'cat-inc-ventas';

/** @param {string} id @param {Partial<import('../src/domain/types.js').Product>} [over] */
const product = (id, over = {}) => ({
  id, name: `Producto ${id}`, sku: '', unit: 'unidad', priceCents: 0, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over,
});
/** @param {string} id @param {Partial<import('../src/domain/types.js').Supplier>} [over] */
const supplier = (id, over = {}) => ({ id, name: `Proveedor ${id}`, contact: '', email: '', phone: '', notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over });
let seq = 0;
/** @param {'purchase' | 'sale' | 'adjustment'} kind @param {string} productId @param {number} quantity @param {number} unitCents @param {string} date @param {string} [time] @param {object} [over] */
const entry = (kind, productId, quantity, unitCents, date, time = '10:00', over = {}) => ({
  id: `e${++seq}`, productId, kind, quantity, unitCents, date, time, note: '', createdAt: `${date}T${time}:00.000Z`, updatedAt: NOW, ...over,
});
const buy = (/** @type {string} */ pid, /** @type {number} */ q, /** @type {number} */ unit, /** @type {string} */ date, /** @type {string} */ time) => entry('purchase', pid, q, unit, date, time);
const sell = (/** @type {string} */ pid, /** @type {number} */ q, /** @type {number} */ unit, /** @type {string} */ date, /** @type {string} */ time) => entry('sale', pid, -q, unit, date, time);

// ---- Productos ------------------------------------------------------------------------------------

test('producto: solo el nombre es obligatorio y todo lo demás tiene un valor por defecto', () => {
  const r = validateProduct({ name: '  Camisa   azul ' }, { products: [] });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { name: 'Camisa azul', sku: '', unit: 'unidad', priceCents: 0, minStock: 0, notes: '' });
  const bad = validateProduct({ name: '   ' }, { products: [] });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.match(bad.errors.name, /nombre/);
});

test('producto: lee precio y stock mínimo y rechaza lo que no es válido', () => {
  const ok = validateProduct({ name: 'A', priceText: '1,250.50', minStockText: '5', unit: 'caja', sku: 'A-1', notes: 'nota' }, { products: [] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { name: 'A', sku: 'A-1', unit: 'caja', priceCents: 125050, minStock: 5, notes: 'nota' });
  for (const [input, field] of [
    [{ name: 'A', priceText: 'abc' }, 'price'],
    [{ name: 'A', priceText: '999999999999' }, 'price'],
    [{ name: 'A', minStockText: '2.5' }, 'minStock'],
    [{ name: 'A', minStockText: '-1' }, 'minStock'],
    [{ name: 'A', minStockText: String(MAX_QUANTITY + 1) }, 'minStock'],
    [{ name: 'x'.repeat(LIMITS.productName + 1) }, 'name'],
    [{ name: 'A', sku: 'x'.repeat(LIMITS.productSku + 1) }, 'sku'],
    [{ name: 'A', unit: 'x'.repeat(LIMITS.productUnit + 1) }, 'unit'],
    [{ name: 'A', notes: 'x'.repeat(LIMITS.productNotes + 1) }, 'notes'],
  ]) {
    const r = validateProduct(/** @type {any} */ (input), { products: [] });
    assert.ok(!r.ok, JSON.stringify(input));
    if (!r.ok) assert.ok(r.errors[/** @type {string} */ (field)], `${JSON.stringify(input)} → ${Object.keys(r.errors)}`);
  }
});

test('producto: no se repite el nombre ni el código, pero uno puede conservar los suyos al editarse', () => {
  const products = [product('p1', { name: 'Camisa', sku: 'CAM-1' })];
  const dupName = validateProduct({ name: 'camisa' }, { products });
  assert.ok(!dupName.ok && dupName.errors.name);
  const dupSku = validateProduct({ name: 'Otra', sku: 'cam-1' }, { products });
  assert.ok(!dupSku.ok && dupSku.errors.sku);
  assert.ok(validateProduct({ name: 'Camisa', sku: 'CAM-1' }, { products, exceptId: 'p1' }).ok);
  assert.ok(validateProduct({ name: 'Otra', sku: '' }, { products }).ok, 'un código vacío no choca con nada');
  assert.ok(validateProduct({ name: 'Otra 2', sku: '' }, { products: [...products, product('p2', { sku: '' })] }).ok);
});

test('producto: construir y editar conserva id, creación, archivado y demostración', () => {
  const built = buildProduct({ name: 'A', sku: '', unit: 'unidad', priceCents: 100, minStock: 2, notes: '' }, { id: 'p1', nowISO: NOW });
  assert.deepEqual(built, { id: 'p1', name: 'A', sku: '', unit: 'unidad', priceCents: 100, minStock: 2, notes: '', archived: false, createdAt: NOW, updatedAt: NOW });
  const edited = applyProductEdit({ ...built, archived: true, isDemo: true }, { name: 'B', sku: 'X', unit: 'par', priceCents: 5, minStock: 0, notes: 'n' }, '2026-08-01T00:00:00.000Z');
  assert.equal(edited.id, 'p1');
  assert.equal(edited.createdAt, NOW);
  assert.equal(edited.archived, true);
  assert.equal(edited.isDemo, true);
  assert.equal(edited.name, 'B');
  assert.equal(edited.updatedAt, '2026-08-01T00:00:00.000Z');
});

test('productos y proveedores se ordenan sin importar tildes ni mayúsculas, con los archivados al final', () => {
  const list = [product('3', { name: 'zapato' }), product('1', { name: 'Árbol', archived: true }), product('2', { name: 'abrigo' }), product('4', { name: 'Ángel' })];
  assert.deepEqual(sortProducts(list).map((p) => p.name), ['abrigo', 'Ángel', 'zapato', 'Árbol']);
  const sup = [supplier('2', { name: 'Zeta' }), supplier('1', { name: 'alfa', archived: true }), supplier('3', { name: 'Beta' })];
  assert.deepEqual(sortSuppliers(sup).map((s) => s.name), ['Beta', 'Zeta', 'alfa']);
});

// ---- Proveedores ----------------------------------------------------------------------------------

test('proveedor: solo el nombre es obligatorio; el correo y el teléfono se validan', () => {
  const ok = validateSupplier({ name: ' Distribuidora  Sol ', email: ' ventas@sol.com ', phone: '809-555-0100', contact: 'Ana', notes: 'n' }, { suppliers: [] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { name: 'Distribuidora Sol', contact: 'Ana', email: 'ventas@sol.com', phone: '809-555-0100', notes: 'n' });
  for (const [input, field] of [
    [{ name: '' }, 'name'],
    [{ name: 'A', email: 'no-es-correo' }, 'email'],
    [{ name: 'A', phone: 'abc' }, 'phone'],
    [{ name: 'x'.repeat(LIMITS.supplierName + 1) }, 'name'],
    [{ name: 'A', contact: 'x'.repeat(LIMITS.supplierContact + 1) }, 'contact'],
    [{ name: 'A', notes: 'x'.repeat(LIMITS.supplierNotes + 1) }, 'notes'],
  ]) {
    const r = validateSupplier(/** @type {any} */ (input), { suppliers: [] });
    assert.ok(!r.ok, JSON.stringify(input));
    if (!r.ok) assert.ok(r.errors[/** @type {string} */ (field)]);
  }
  const suppliers = [supplier('s1', { name: 'Sol' })];
  const dup = validateSupplier({ name: 'SOL' }, { suppliers });
  assert.ok(!dup.ok && dup.errors.name);
  assert.ok(validateSupplier({ name: 'Sol' }, { suppliers, exceptId: 's1' }).ok);
  const built = buildSupplier({ name: 'A', contact: '', email: '', phone: '', notes: '' }, { id: 's9', nowISO: NOW });
  assert.equal(built.archived, false);
  assert.equal(applySupplierEdit({ ...built, archived: true, isDemo: true }, { name: 'B', contact: '', email: '', phone: '', notes: '' }, NOW).isDemo, true);
});

// ---- Stock y costo promedio -----------------------------------------------------------------------

test('stock y valor: cada venta resta al costo promedio del momento', () => {
  // 10 a 100 y 10 a 200: 20 unidades valen 3,000 (costo promedio 150).
  const rows = replayProduct([buy('p', 10, 100, '2026-07-01'), buy('p', 10, 200, '2026-07-02'), sell('p', 5, 999, '2026-07-03'), sell('p', 15, 999, '2026-07-04')]);
  assert.deepEqual(rows.rows.map((r) => [r.stockAfter, r.valueAfterCents, r.costCents]), [[10, 1000, 0], [20, 3000, 0], [15, 2250, 750], [0, 0, 2250]]);
  assert.equal(rows.stock, 0);
  assert.equal(rows.valueCents, 0);
  assert.equal(rows.firstNegative, null);
});

test('stock y valor: sin perder centavos al redondear (lo que sale + lo que queda = lo que se compró)', () => {
  // 1 a 100 y 2 a 101: 3 unidades valen 302; 302 ÷ 3 no es exacto.
  const replay = replayProduct([buy('p', 1, 100, '2026-07-01'), buy('p', 2, 101, '2026-07-02'), sell('p', 1, 500, '2026-07-03'), sell('p', 1, 500, '2026-07-04'), sell('p', 1, 500, '2026-07-05')]);
  assert.deepEqual(replay.rows.map((r) => r.costCents), [0, 0, 101, 101, 100]);
  assert.equal(replay.rows.reduce((sum, r) => sum + r.costCents, 0), 302, 'lo que salió suma exactamente lo que se compró');
  assert.equal(replay.valueCents, 0, 'al vaciarse el stock el valor queda en cero, no en un residuo');
});

test('stock y valor: números grandes no pierden precisión (cálculo con enteros grandes)', () => {
  // Valor de 5.9e10 centavos repartido en 1,000,000 unidades: vender 999,999 usa valor × cantidad ≈ 6e16 (más que 2^53).
  const replay = replayProduct([buy('p', 1_000_000, 59_999, '2026-07-01'), sell('p', 999_999, 1, '2026-07-02')]);
  const value = 1_000_000n * 59_999n;
  const cost = Number((value * 999_999n * 2n + 1_000_000n) / (1_000_000n * 2n));
  assert.equal(replay.rows[1].costCents, cost);
  assert.equal(replay.valueCents, Number(value) - cost);
  assert.equal(replay.stock, 1);
});

test('stock y valor: el orden es por fecha y hora, no por el orden en que se guardaron', () => {
  const sale = sell('p', 3, 10, '2026-07-05', '09:00');
  const purchase = buy('p', 5, 100, '2026-07-05', '08:00');
  assert.equal(replayProduct([sale, purchase]).firstNegative, null);
  assert.deepEqual(sortEntries([sale, purchase]).map((e) => e.kind), ['purchase', 'sale']);
  // La venta a las 07:00 va antes de la compra de las 08:00: no habría stock.
  const early = sell('p', 3, 10, '2026-07-05', '07:00');
  const problem = replayProduct([purchase, early]).firstNegative;
  assert.ok(problem);
  assert.equal(problem?.entry.id, early.id);
  assert.equal(problem?.available, 0);
});

test('ajustes: sumar entra con su costo, restar sale al costo promedio y cuenta como merma', () => {
  const entries = [
    entry('adjustment', 'p', 10, 50, '2026-07-01'), // stock inicial: 10 a 50
    entry('adjustment', 'p', -2, 0, '2026-07-02'), // merma: 2 × 50 = 100
    sell('p', 4, 80, '2026-07-03'),
  ];
  const replay = replayProduct(entries);
  assert.deepEqual(replay.rows.map((r) => [r.stockAfter, r.valueAfterCents, r.costCents]), [[10, 500, 0], [8, 400, 100], [4, 200, 200]]);
  const analysis = salesAnalysis({ products: [product('p')], stockEntries: entries }, '2026-07-01', '2026-07-31');
  assert.equal(analysis.shrinkCostCents, 100);
  assert.equal(analysis.shrinkUnits, 2);
  assert.equal(analysis.revenueCents, 320);
  assert.equal(analysis.costCents, 200);
  assert.equal(analysis.profitCents, 120);
});

test('posiciones: stock, valor, costo promedio y estado de cada producto', () => {
  const products = [product('a', { name: 'A', minStock: 5 }), product('b', { name: 'B' }), product('c', { name: 'C', minStock: 2 }), product('d', { name: 'D', minStock: 3, archived: true })];
  const stockEntries = [
    buy('a', 5, 100, '2026-07-01'), // 5 ≤ mínimo 5 → bajo
    buy('b', 4, 250, '2026-07-01'), // sin aviso → ok
    buy('c', 2, 10, '2026-07-01'), sell('c', 2, 20, '2026-07-02'), // agotado
    // d sin movimientos y archivado
  ];
  const pos = stockPositions({ products, stockEntries });
  assert.deepEqual(pos.map((p) => [p.product.id, p.stock, p.valueCents, p.avgCostCents, p.status]), [
    ['a', 5, 500, 100, 'low'], ['b', 4, 1000, 250, 'ok'], ['c', 0, 0, 0, 'out'], ['d', 0, 0, 0, 'out'],
  ]);
  const summary = inventorySummary({ products, stockEntries });
  assert.equal(summary.totalValueCents, 1500);
  assert.equal(summary.totalUnits, 9);
  assert.equal(summary.activeProducts, 3);
  assert.deepEqual(summary.alerts.map((a) => a.product.id), ['a', 'c'], 'los archivados no avisan; los sin mínimo tampoco');
  assert.equal(summary.outCount, 1, 'agotados activos (el archivado no cuenta)');
});

test('el valor del inventario incluye productos archivados que todavía tienen stock', () => {
  const summary = inventorySummary({ products: [product('a', { archived: true })], stockEntries: [buy('a', 3, 100, '2026-07-01')] });
  assert.equal(summary.totalValueCents, 300);
  assert.equal(summary.activeProducts, 0);
});

// ---- Registrar movimientos de stock (validación) --------------------------------------------------

const baseCtx = () => ({
  products: [product('p1', { name: 'Camisa' }), product('arch', { archived: true })],
  suppliers: [supplier('s1')],
  categories,
  entries: /** @type {any[]} */ ([]),
  today: TODAY,
  time: '12:00',
  nowISO: NOW,
});
const purchaseInput = (/** @type {object} */ over = {}) => ({ kind: 'purchase', productId: 'p1', quantityText: '10', unitText: '100', date: '2026-07-10', supplierId: 's1', categoryId: CAT_EXPENSE, note: '', ...over });
const saleInput = (/** @type {object} */ over = {}) => ({ kind: 'sale', productId: 'p1', quantityText: '3', unitText: '250', date: '2026-07-12', categoryId: CAT_INCOME, ...over });

test('compra válida: el total justo en el máximo se acepta', () => {
  assert.ok(validateStockEntry(purchaseInput({ quantityText: '1', unitText: '999999999.99' }), baseCtx()).ok);
});

test('compra válida: la cantidad queda positiva y se normaliza todo', () => {
  const r = validateStockEntry(purchaseInput({ unitText: '1,250.50', note: '  Factura   123 ' }), baseCtx());
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { kind: 'purchase', productId: 'p1', quantity: 10, unitCents: 125050, date: '2026-07-10', supplierId: 's1', categoryId: CAT_EXPENSE, departmentId: '', note: 'Factura 123' });
});

test('venta válida: la cantidad se guarda en negativo y necesita stock', () => {
  const ctx = { ...baseCtx(), entries: [buy('p1', 10, 100, '2026-07-10')] };
  const r = validateStockEntry(saleInput(), ctx);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.quantity, -3);
});

test('movimiento de stock: cada dato inválido se explica', () => {
  const ctx = { ...baseCtx(), entries: [buy('p1', 10, 100, '2026-07-10')] };
  /** @type {[object, string][]} */
  const cases = [
    [purchaseInput({ kind: 'otra' }), 'kind'],
    [purchaseInput({ productId: 'nope' }), 'product'],
    [purchaseInput({ productId: 'arch' }), 'product'],
    [purchaseInput({ quantityText: '' }), 'quantity'],
    [purchaseInput({ quantityText: '2.5' }), 'quantity'],
    [purchaseInput({ quantityText: '5.' }), 'quantity'],
    [purchaseInput({ quantityText: '2', unitText: '999999999.99' }), 'unit'], // el total pasa del máximo aunque cada parte quepa
    [purchaseInput({ quantityText: '0' }), 'quantity'],
    [purchaseInput({ quantityText: '-3' }), 'quantity'],
    [purchaseInput({ quantityText: '-1' }), 'quantity'],
    [saleInput({ quantityText: '-1' }), 'quantity'],
    [purchaseInput({ quantityText: String(MAX_QUANTITY + 1) }), 'quantity'],
    [purchaseInput({ unitText: '' }), 'unit'],
    [purchaseInput({ unitText: '0' }), 'unit'],
    [purchaseInput({ unitText: 'abc' }), 'unit'],
    [purchaseInput({ quantityText: '1000000', unitText: '99999999' }), 'unit'], // total demasiado grande
    [purchaseInput({ date: '2026-07-21' }), 'date'],
    [purchaseInput({ date: 'ayer' }), 'date'],
    [purchaseInput({ date: '1999-12-31' }), 'date'],
    [purchaseInput({ supplierId: 'nope' }), 'supplier'],
    [purchaseInput({ categoryId: '' }), 'category'],
    [purchaseInput({ categoryId: CAT_INCOME }), 'category'],
    [purchaseInput({ note: 'x'.repeat(LIMITS.stockNote + 1) }), 'note'],
    [saleInput({ supplierId: 's1' }), 'supplier'],
    [saleInput({ categoryId: CAT_EXPENSE }), 'category'],
    [saleInput({ unitText: '0' }), 'unit'],
    [{ kind: 'adjustment', productId: 'p1', quantityText: '2', unitText: '', date: '2026-07-12' }, 'unit'],
    [{ kind: 'adjustment', productId: 'p1', quantityText: '0', unitText: '5', date: '2026-07-12' }, 'quantity'],
    [{ kind: 'adjustment', productId: 'p1', quantityText: '-1', unitText: '', date: '2026-07-12', categoryId: CAT_EXPENSE }, 'category'],
  ];
  for (const [input, field] of cases) {
    const r = validateStockEntry(/** @type {any} */ (input), ctx);
    assert.ok(!r.ok, JSON.stringify(input));
    if (!r.ok) assert.ok(r.errors[field], `${JSON.stringify(input)} → ${Object.keys(r.errors)}`);
  }
});

test('el ajuste que resta no pide costo; el que suma sí (puede ser cero)', () => {
  const ctx = { ...baseCtx(), entries: [buy('p1', 10, 100, '2026-07-10')] };
  const minus = validateStockEntry({ kind: 'adjustment', productId: 'p1', quantityText: '-2', date: '2026-07-12', note: 'merma' }, ctx);
  assert.ok(minus.ok);
  if (minus.ok) assert.deepEqual([minus.value.quantity, minus.value.unitCents, minus.value.categoryId], [-2, 0, '']);
  const plus = validateStockEntry({ kind: 'adjustment', productId: 'p1', quantityText: '+4', unitText: '0', date: '2026-07-12' }, ctx);
  assert.ok(plus.ok);
  if (plus.ok) assert.deepEqual([plus.value.quantity, plus.value.unitCents], [4, 0]);
});

test('regla de oro: no se puede vender más de lo que hay', () => {
  const ctx = { ...baseCtx(), entries: [buy('p1', 5, 100, '2026-07-10')] };
  const r = validateStockEntry(saleInput({ quantityText: '6' }), ctx);
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.quantity, /No alcanza el stock de «Camisa».*solo hay 5 unidades/);
  assert.ok(validateStockEntry(saleInput({ quantityText: '5' }), ctx).ok, 'justo lo que hay sí se puede');
  const one = validateStockEntry(saleInput({ quantityText: '2' }), { ...baseCtx(), entries: [buy('p1', 1, 100, '2026-07-10')] });
  assert.ok(!one.ok);
  if (!one.ok) assert.match(one.errors.quantity, /solo hay 1 unidad\./);
  const adj = validateStockEntry({ kind: 'adjustment', productId: 'p1', quantityText: '-6', date: '2026-07-12' }, ctx);
  assert.ok(!adj.ok, 'una merma tampoco puede pasar de lo que hay');
});

test('regla de oro con fechas pasadas: una venta antes de la compra no se acepta', () => {
  const ctx = { ...baseCtx(), entries: [buy('p1', 5, 100, '2026-07-10')] };
  const r = validateStockEntry(saleInput({ date: '2026-07-09', quantityText: '1' }), ctx);
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.quantity, /solo hay 0 unidades/);
});

test('regla de oro: una salida con fecha pasada tampoco puede dejar sin stock a una venta posterior', () => {
  // 10 unidades el 1, vendidas las 10 el 5. Ahora alguien intenta vender 1 el día 3: la venta del día 5 ya no tendría stock.
  const ctx = { ...baseCtx(), entries: [buy('p1', 10, 100, '2026-07-01'), sell('p1', 10, 200, '2026-07-05')] };
  const r = validateStockEntry(saleInput({ date: '2026-07-03', quantityText: '1' }), ctx);
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.quantity, /quedaría en negativo el 5 jul 2026/);
  // Una compra con fecha pasada, en cambio, siempre se puede.
  assert.ok(validateStockEntry(purchaseInput({ date: '2026-07-02' }), ctx).ok);
});

test('regla de oro: el orden dentro del mismo día usa la hora que tendrá el movimiento', () => {
  // La compra se registró a las 15:00 del 10. Una venta del mismo día a las 09:00 iría antes: no hay stock; a las 16:00 sí.
  const ctx = { ...baseCtx(), entries: [buy('p1', 5, 100, '2026-07-10', '15:00')] };
  const before = validateStockEntry(saleInput({ date: '2026-07-10', quantityText: '1' }), { ...ctx, time: '09:00', nowISO: '2026-07-20T09:00:00.000Z' });
  assert.ok(!before.ok, 'a las 09:00 todavía no se había comprado');
  const after = validateStockEntry(saleInput({ date: '2026-07-10', quantityText: '1' }), { ...ctx, time: '16:00', nowISO: '2026-07-20T16:00:00.000Z' });
  assert.ok(after.ok);
});

test('borrar: no se borra una compra que ya respalda ventas, pero sí una venta', () => {
  const products = [product('p1', { name: 'Camisa' })];
  const purchase = buy('p1', 10, 100, '2026-07-01');
  const sale = sell('p1', 4, 200, '2026-07-02');
  const entries = [purchase, sale];
  const blocked = deletionProblem(entries, purchase.id, products);
  assert.ok(blocked);
  assert.match(blocked ?? '', /ya respalda otras salidas de «Camisa»/);
  assert.equal(deletionProblem(entries, sale.id, products), null);
  assert.equal(deletionProblem([purchase, buy('p1', 10, 100, '2026-07-01', '11:00'), sale], purchase.id, products), null, 'si queda stock de sobra, sí se puede');
  assert.equal(deletionProblem(entries, 'no-existe', products), null);
});

// ---- Construcción del movimiento de dinero y del de stock -----------------------------------------

test('compra: genera un gasto con el total, la descripción y la clasificación de su categoría', () => {
  const value = { kind: /** @type {const} */ ('purchase'), productId: 'p1', quantity: 12, unitCents: 1500, date: '2026-07-10', supplierId: 's1', categoryId: CAT_EXPENSE, note: '' };
  const cat = categories.find((c) => c.id === CAT_EXPENSE);
  assert.ok(cat);
  const m = buildStockMovement(value, product('p1', { name: 'Camisa' }), /** @type {any} */ (cat), { id: 'm1', time: '09:30', nowISO: NOW });
  assert.deepEqual(m, {
    id: 'm1', type: 'expense', amountCents: 18000, date: '2026-07-10', time: '09:30', description: 'Compra: 12 × Camisa', classification: 'variable', categoryId: CAT_EXPENSE, createdAt: NOW, updatedAt: NOW,
  });
});

test('venta: genera un ingreso; la marca de demostración se hereda', () => {
  const value = { kind: /** @type {const} */ ('sale'), productId: 'p1', quantity: -3, unitCents: 25000, date: '2026-07-12', supplierId: '', categoryId: CAT_INCOME, note: '' };
  const cat = categories.find((c) => c.id === CAT_INCOME);
  const m = buildStockMovement(value, product('p1', { name: 'Camisa' }), /** @type {any} */ (cat), { id: 'm2', time: '10:00', nowISO: NOW, isDemo: true });
  assert.equal(m.type, 'income');
  assert.equal(m.amountCents, 75000);
  assert.equal(m.description, 'Venta: 3 × Camisa');
  assert.equal(m.isDemo, true);
});

test('la clasificación de la categoría que no vale para el tipo se corrige a «variable»', () => {
  // Una categoría de gasto con clasificación válida para ingresos jamás debería existir, pero la función no se fía.
  const weird = { id: 'x', name: 'X', kind: /** @type {const} */ ('expense'), defaultClassification: /** @type {any} */ ('extraordinary'), builtIn: false };
  const m = buildStockMovement({ kind: 'purchase', productId: 'p', quantity: 1, unitCents: 10, date: TODAY, supplierId: '', categoryId: 'x', note: '' }, product('p'), weird, { id: 'm', time: '10:00', nowISO: NOW });
  assert.equal(m.classification, 'variable');
});

test('descripción del movimiento: nunca pasa del límite aunque el producto tenga nombre largo', () => {
  // Con los límites actuales (nombre de 60 y hasta 1,000,000 de unidades) siempre cabe; la función se protege igual si algún día cambian.
  const longest = stockMovementDescription('purchase', 1_000_000, 'N'.repeat(LIMITS.productName));
  assert.ok(longest.length <= LIMITS.description && !longest.endsWith('…'), String(longest.length));
  const text = stockMovementDescription('purchase', 1_000_000, 'N'.repeat(200));
  assert.equal(text.length, LIMITS.description);
  assert.ok(text.endsWith('…'));
  assert.equal(stockMovementDescription('sale', -3, 'Camisa'), 'Venta: 3 × Camisa');
});

test('movimiento de stock: se arma sin proveedor ni movimiento cuando no los hay, y la merma queda sin monto', () => {
  const plain = buildStockEntry({ kind: 'adjustment', productId: 'p', quantity: -2, unitCents: 999, date: TODAY, supplierId: '', categoryId: '', note: 'merma' }, { id: 'e1', time: '10:00', nowISO: NOW });
  assert.equal(plain.unitCents, 0, 'un ajuste que resta no guarda monto');
  assert.ok(!('supplierId' in plain) && !('movementId' in plain));
  const full = buildStockEntry({ kind: 'purchase', productId: 'p', quantity: 2, unitCents: 50, date: TODAY, supplierId: 's1', categoryId: CAT_EXPENSE, note: '' }, { id: 'e2', time: '10:00', nowISO: NOW, movementId: 'm1' });
  assert.equal(full.supplierId, 's1');
  assert.equal(full.movementId, 'm1');
});

// ---- Ventas, margen y proveedores -----------------------------------------------------------------

test('ventas y margen: ingresos, costo de lo vendido y ganancia por producto en el período', () => {
  const products = [product('a', { name: 'A' }), product('b', { name: 'B' }), product('c', { name: 'C' })];
  const stockEntries = [
    buy('a', 10, 100, '2026-06-20'), sell('a', 2, 300, '2026-06-25'), // fuera del período
    sell('a', 4, 250, '2026-07-05'), // ingreso 1,000, costo 400
    buy('b', 4, 500, '2026-07-01'), sell('b', 4, 600, '2026-07-10'), // ingreso 2,400, costo 2,000
    buy('c', 3, 10, '2026-07-01'), // sin ventas
  ];
  const r = salesAnalysis({ products, stockEntries }, '2026-07-01', '2026-07-31');
  assert.deepEqual(r.byProduct.map((p) => [p.product.id, p.units, p.revenueCents, p.costCents, p.profitCents]), [['b', 4, 2400, 2000, 400], ['a', 4, 1000, 400, 600]]);
  assert.equal(r.revenueCents, 3400);
  assert.equal(r.costCents, 2400);
  assert.equal(r.profitCents, 1000);
  assert.ok(Math.abs((r.marginPercent ?? 0) - (1000 / 3400) * 100) < 1e-9);
  assert.equal(r.units, 8);
  assert.equal(r.byProduct[0].marginPercent, (400 / 2400) * 100);
  // Los límites del período son inclusivos.
  assert.equal(salesAnalysis({ products, stockEntries }, '2026-07-05', '2026-07-05').revenueCents, 1000);
  assert.equal(salesAnalysis({ products, stockEntries }, '2026-08-01', '2026-08-31').marginPercent, null);
});

test('ventas: el costo de lo vendido usa el costo promedio de cuando se vendió, aunque el período empiece después', () => {
  // La compra cara llega después de la venta: la venta no la usa.
  const r = salesAnalysis(
    { products: [product('a')], stockEntries: [buy('a', 10, 100, '2026-07-01'), sell('a', 5, 300, '2026-07-02'), buy('a', 10, 500, '2026-07-03')] },
    '2026-07-02', '2026-07-02',
  );
  assert.equal(r.costCents, 500);
});

test('proveedores: cuántas compras y cuánto se les compró; solo cuentan las compras', () => {
  const suppliers = [supplier('s2', { name: 'Beta' }), supplier('s1', { name: 'Alfa' }), supplier('s3', { name: 'Gamma' })];
  const stockEntries = [
    entry('purchase', 'a', 10, 100, '2026-07-01', '10:00', { supplierId: 's1' }),
    entry('purchase', 'a', 5, 200, '2026-07-09', '10:00', { supplierId: 's1' }),
    entry('purchase', 'a', 1, 50, '2026-07-04', '10:00', { supplierId: 's2' }),
    entry('purchase', 'a', 3, 10, '2026-07-05'), // sin proveedor
  ];
  const t = supplierTotals({ suppliers, stockEntries });
  assert.deepEqual(t.map((x) => [x.supplier.name, x.purchases, x.totalCents, x.lastDate]), [['Alfa', 2, 2000, '2026-07-09'], ['Beta', 1, 50, '2026-07-04'], ['Gamma', 0, 0, '']]);
});

test('uso: producto y proveedor con movimientos no se deben borrar', () => {
  const stockEntries = [entry('purchase', 'a', 1, 1, TODAY, '10:00', { supplierId: 's1' }), entry('sale', 'a', -1, 1, TODAY)];
  assert.equal(productUsage({ stockEntries }, 'a').entries, 2);
  assert.equal(productUsage({ stockEntries }, 'z').entries, 0);
  assert.equal(supplierUsage({ stockEntries }, 's1').purchases, 1);
  assert.equal(supplierUsage({ stockEntries }, 's9').purchases, 0);
});

// ---- Avisos y activación --------------------------------------------------------------------------

test('aviso de stock bajo: sin productos en aviso no hay nada; con uno, nombra el producto', () => {
  assert.deepEqual(inventoryNotices({ products: [product('a', { minStock: 0 })], stockEntries: [] }), []);
  const one = inventoryNotices({ products: [product('a', { name: 'Camisa', minStock: 5 })], stockEntries: [buy('a', 4, 100, '2026-07-01')] });
  assert.equal(one.length, 1);
  assert.equal(one[0].id, 'inventory-low-stock');
  assert.equal(one[0].level, 'info');
  assert.match(one[0].text, /Stock bajo en un producto: «Camisa»\./);
});

test('aviso de stock bajo: con varios lista hasta tres y cuenta el resto; agotado = crítico', () => {
  const products = ['A', 'B', 'C', 'D', 'E'].map((n) => product(n.toLowerCase(), { name: n, minStock: 5 }));
  const stockEntries = products.map((p) => buy(p.id, 3, 100, '2026-07-01'));
  const [n] = inventoryNotices({ products, stockEntries });
  assert.match(n.text, /Stock bajo en 5 productos: «A», «B», «C» y 2 más\./);
  assert.equal(n.level, 'info');
  const [out] = inventoryNotices({ products: products.slice(0, 2), stockEntries: [] });
  assert.equal(out.level, 'critical');
  assert.match(out.text, /«A» y «B»\. Hay productos agotados\./);
});

test('el inventario se ofrece en Emprendedor y Empresa, y en los demás solo si ya hay datos', () => {
  const empty = { products: [], suppliers: [], stockEntries: [] };
  assert.equal(inventoryEnabled('entrepreneur', empty), true);
  assert.equal(inventoryEnabled('company', empty), true);
  assert.equal(inventoryEnabled('personal', empty), false);
  assert.equal(inventoryEnabled('freelancer', empty), false);
  assert.equal(inventoryEnabled(null, empty), false);
  assert.equal(inventoryEnabled('personal', { ...empty, products: [product('a')] }), true);
  assert.equal(inventoryEnabled('freelancer', { ...empty, suppliers: [supplier('s')] }), true);
});
