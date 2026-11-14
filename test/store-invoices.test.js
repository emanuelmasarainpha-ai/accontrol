// Facturas internas en el store: emitir con stock atómico, cobros con su ingreso, anular, protecciones, aislamiento y demostración.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { inventorySummary, replayProduct, salesAnalysis } from '../src/domain/inventory.js';
import { invoicePosition, invoiceReceivables } from '../src/domain/invoices.js';
import { overallTotals } from '../src/domain/summaries.js';
import { computeNotices } from '../src/domain/notices.js';

const fixedNow = new Date(2026, 10, 15, 15, 30); // 15 nov 2026, 15:30
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {'personal' | 'freelancer' | 'entrepreneur' | 'company'} kind */
async function space(kind = 'entrepreneur', name = 'Mi tienda') {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind, name })).ok);
  return { root, store };
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
/** @returns {any} */
const lineIn = (over = {}) => ({ description: 'Servicio', productId: '', quantityText: '1', unitText: '1,000', ...over });
/** @returns {any} */
const invIn = (over = {}) => ({
  customerName: 'Hotel Sol', customerTaxId: '', customerContact: '', issueDate: '2026-11-10', dueDate: '2026-11-25', taxText: '18', notes: '', lines: [lineIn()], ...over,
});
const payIn = (/** @type {Record<string, string>} */ over = {}) => ({ amountText: '500', date: '2026-11-12', categoryId: 'cat-inc-ventas', note: '', ...over });
const buyInput = (/** @type {string} */ productId, /** @type {Record<string, string>} */ over = {}) => ({
  kind: 'purchase', productId, quantityText: '10', unitText: '100', date: '2026-11-01', supplierId: '', categoryId: 'cat-exp-otros', note: '', ...over,
});
/** Un espacio con un producto y 10 unidades compradas a RD$ 100. */
async function withStock(kind = 'entrepreneur') {
  const { store, root } = await space(kind);
  const product = must(await store.saveProduct({ name: 'Camisa', priceText: '250' })).product;
  must(await store.registerStock(buyInput(product.id)));
  return { store, root, product };
}
const data = (/** @type {any} */ store) => store.getState().data;
/** Lo que hay guardado de verdad (no solo lo que muestra el store). */
const stored = (/** @type {any} */ root, /** @type {string} */ table) => root.rawRecords(table);

test('invoicesEnabled: Freelancer (0.14.5), Emprendedor y Empresa sí; Personal, no', async () => {
  for (const kind of /** @type {const} */ (['freelancer', 'entrepreneur', 'company'])) assert.equal((await space(kind)).store.invoicesEnabled(), true, kind);
  assert.equal((await space('personal')).store.invoicesEnabled(), false, 'personal');
});

// ---- Emitir -----------------------------------------------------------------------------------------------------

test('emitir una factura: número 1, 2, 3…; no mueve el dinero (el dinero entra al cobrar)', async () => {
  const { store } = await space();
  const before = overallTotals(data(store), TODAY);
  const a = must(await store.createInvoice(invIn()));
  const b = must(await store.createInvoice(invIn({ customerName: 'Colegio' })));
  assert.deepEqual([a.invoice.number, b.invoice.number], [1, 2]);
  assert.equal(data(store).invoices.length, 2);
  assert.equal(data(store).movements.length, 0, 'ningún ingreso todavía');
  assert.deepEqual(overallTotals(data(store), TODAY), before);
  const p = invoicePosition(a.invoice, [], TODAY);
  assert.equal(p.totalCents, 118000);
  assert.equal(p.balanceCents, 118000);
  assert.equal(p.status, 'open');
});

test('una factura con un producto saca el stock sin crear dinero, y aparece en las ventas de Inventario', async () => {
  const { store, product } = await withStock();
  const moneyBefore = overallTotals(data(store), TODAY).availableCents;
  const r = must(await store.createInvoice(invIn({ taxText: '', lines: [lineIn({ description: 'Camisas', productId: product.id, quantityText: '4', unitText: '250' })] })));
  assert.equal(r.entries.length, 1);
  const e = r.entries[0];
  assert.deepEqual([e.kind, e.quantity, e.unitCents, e.date, e.invoiceId, e.movementId, e.note], ['sale', -4, 25000, '2026-11-10', r.invoice.id, undefined, 'Factura F-0001']);
  assert.equal(replayProduct(data(store).stockEntries).stock, 6);
  assert.equal(overallTotals(data(store), TODAY).availableCents, moneyBefore, 'el dinero no se mueve al facturar');
  const month = salesAnalysis(data(store), '2026-11-01', '2026-11-30');
  assert.deepEqual([month.revenueCents, month.costCents, month.profitCents], [100000, 40000, 60000], 'la venta y su costo ya cuentan en Inventario');
  assert.equal(inventorySummary(data(store)).totalValueCents, 6 * 10000);
});

test('no se puede facturar más de lo que hay: no se guarda nada', async () => {
  const { store, product } = await withStock();
  const snapshot = JSON.stringify(data(store));
  const r = await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '11' })] }));
  assert.ok(!r.ok);
  assert.match(r.errors['line0.quantity'], /No alcanza el stock de «Camisa»/);
  assert.equal(JSON.stringify(data(store)), snapshot);
});

test('si falla el guardado, no queda la factura ni su salida de stock (todo o nada)', async () => {
  const { store, root, product } = await withStock();
  root.failNextWrite();
  const r = await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '2' })] }));
  assert.ok(!r.ok);
  assert.deepEqual([data(store).invoices.length, data(store).stockEntries.length], [0, 1]);
  assert.deepEqual([stored(root, 'invoices').length, stored(root, 'stockEntries').length], [0, 1]);
  // Y la siguiente sí funciona y toma el número 1 (no se gastó ninguno).
  assert.equal(must(await store.createInvoice(invIn())).invoice.number, 1);
});

test('los errores de validación llegan con el campo exacto', async () => {
  const { store } = await space();
  const r = await store.createInvoice(invIn({ customerName: '', lines: [lineIn({ unitText: '' })] }));
  assert.ok(!r.ok);
  assert.ok(r.errors.customerName && r.errors['line0.unit']);
  assert.equal(data(store).invoices.length, 0);
});

test('mezclar productos de demostración con productos propios en una factura no se permite', async () => {
  const { store } = await space();
  must(await store.loadDemoData());
  const demoShirt = data(store).products.find((p) => p.name === 'Camisa de algodón');
  const mine = must(await store.saveProduct({ name: 'Mío' })).product;
  must(await store.registerStock(buyInput(mine.id)));
  const r = await store.createInvoice(invIn({ lines: [lineIn({ productId: demoShirt?.id ?? '', quantityText: '1' }), lineIn({ productId: mine.id, quantityText: '1' })] }));
  assert.ok(!r.ok);
  assert.match(r.errors.lines, /No mezcles productos de demostración/);
});

test('una factura de un producto de demostración también es de demostración y lleva su propia serie', async () => {
  const { store } = await space();
  must(await store.loadDemoData());
  const demoNumbers = data(store).invoices.map((i) => i.number);
  const shirt = data(store).products.find((p) => p.name === 'Camisa de algodón');
  assert.ok(shirt);
  const demo = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: shirt.id, quantityText: '1' })] })));
  assert.equal(demo.invoice.isDemo, true);
  assert.equal(demo.invoice.number, Math.max(...demoNumbers) + 1);
  assert.ok(demo.entries.every((e) => e.isDemo === true));
  const real = must(await store.createInvoice(invIn()));
  assert.equal(real.invoice.isDemo, undefined);
  assert.equal(real.invoice.number, 1, 'la serie real arranca en 1 aunque haya demostración');
});

// ---- Cobros ---------------------------------------------------------------------------------------------------------

test('un cobro crea su ingreso y sube el Disponible; la factura pasa a cobro parcial y luego a cobrada', async () => {
  const { store } = await space();
  const inv = must(await store.createInvoice(invIn({ dueDate: '2026-11-30' }))).invoice; // 1,000 + 18 % = 1,180
  const before = overallTotals(data(store), TODAY).availableCents;
  const r = must(await store.addInvoicePayment(inv.id, payIn({ amountText: '500', note: 'Transferencia' })));
  assert.deepEqual([r.movement.type, r.movement.amountCents, r.movement.description, r.movement.date], ['income', 50000, 'Cobro F-0001: Hotel Sol', '2026-11-12']);
  assert.equal(r.payment.movementId, r.movement.id);
  assert.equal(overallTotals(data(store), TODAY).availableCents, before + 50000);
  assert.equal(invoicePosition(inv, data(store).invoicePayments, TODAY).status, 'partial');
  assert.equal(invoicePosition(inv, data(store).invoicePayments, TODAY).balanceCents, 68000);
  must(await store.addInvoicePayment(inv.id, payIn({ amountText: '680' })));
  const done = invoicePosition(inv, data(store).invoicePayments, TODAY);
  assert.deepEqual([done.status, done.balanceCents, done.paidCents], ['paid', 0, 118000]);
  assert.equal(overallTotals(data(store), TODAY).availableCents, before + 118000);
  assert.equal(data(store).movements.length, 2);
});

test('no se puede cobrar más de lo que falta ni una factura anulada ni una ya cobrada', async () => {
  const { store } = await space();
  const inv = must(await store.createInvoice(invIn({ taxText: '' }))).invoice; // 1,000
  const over = await store.addInvoicePayment(inv.id, payIn({ amountText: '1000.01' }));
  assert.ok(!over.ok);
  assert.match(over.errors.amount, /Solo faltan RD\$ 1,000\.00/);
  must(await store.addInvoicePayment(inv.id, payIn({ amountText: '1000' })));
  const again = await store.addInvoicePayment(inv.id, payIn({ amountText: '1' }));
  assert.ok(!again.ok);
  assert.match(again.errors.form, /cobrada por completo/);
  const other = must(await store.createInvoice(invIn({ taxText: '' }))).invoice;
  must(await store.voidInvoice(other.id));
  const voided = await store.addInvoicePayment(other.id, payIn());
  assert.ok(!voided.ok);
  assert.match(voided.errors.form, /anulada/);
  assert.equal((await store.addInvoicePayment('no-existe', payIn())).ok, false);
});

test('si falla el guardado de un cobro, no queda ni el cobro ni el ingreso', async () => {
  const { store, root } = await space();
  const inv = must(await store.createInvoice(invIn())).invoice;
  root.failNextWrite();
  assert.ok(!(await store.addInvoicePayment(inv.id, payIn())).ok);
  assert.deepEqual([data(store).movements.length, data(store).invoicePayments.length], [0, 0]);
  assert.deepEqual([stored(root, 'movements').length, stored(root, 'invoicePayments').length], [0, 0]);
});

test('borrar un cobro quita también su ingreso y la factura vuelve a deber ese monto', async () => {
  const { store, root } = await space();
  const inv = must(await store.createInvoice(invIn({ taxText: '' }))).invoice;
  const first = must(await store.addInvoicePayment(inv.id, payIn({ amountText: '300' })));
  must(await store.addInvoicePayment(inv.id, payIn({ amountText: '200' })));
  const before = overallTotals(data(store), TODAY).availableCents;
  must(await store.deleteInvoicePayment(first.payment.id));
  assert.equal(overallTotals(data(store), TODAY).availableCents, before - 30000);
  assert.equal(invoicePosition(inv, data(store).invoicePayments, TODAY).balanceCents, 80000);
  assert.deepEqual([data(store).movements.length, data(store).invoicePayments.length], [1, 1]);
  assert.deepEqual([stored(root, 'movements').length, stored(root, 'invoicePayments').length], [1, 1]);
  assert.ok(!(await store.deleteInvoicePayment(first.payment.id)).ok, 'ya no existe');
});

test('el ingreso de un cobro no se edita ni se borra desde Movimientos', async () => {
  const { store } = await space();
  const inv = must(await store.createInvoice(invIn())).invoice;
  const r = must(await store.addInvoicePayment(inv.id, payIn()));
  const edit = await store.saveMovement({ type: 'income', amountText: '1', date: '2026-11-12', description: 'x', categoryId: 'cat-inc-ventas', classification: 'variable' }, r.movement.id);
  assert.ok(!edit.ok);
  assert.match(edit.errors.form, /cobro de una factura/);
  const del = await store.deleteMovement(r.movement.id);
  assert.ok(!del.ok);
  assert.match(del.errors.form, /cobro de una factura/);
  assert.equal(data(store).movements.length, 1);
});

// ---- Anular ---------------------------------------------------------------------------------------------------------

test('anular devuelve el stock, deja la factura en la lista y no reutiliza su número', async () => {
  const { store, product } = await withStock();
  const a = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '4', unitText: '250' })] }))).invoice;
  assert.equal(replayProduct(data(store).stockEntries).stock, 6);
  const v = must(await store.voidInvoice(a.id));
  assert.ok(v.invoice.voidedAt);
  assert.equal(replayProduct(data(store).stockEntries).stock, 10, 'las 4 unidades volvieron');
  assert.equal(data(store).stockEntries.length, 1, 'solo queda la compra');
  assert.equal(data(store).invoices.length, 1, 'la factura sigue en la lista, anulada');
  assert.equal(invoicePosition(data(store).invoices[0], [], TODAY).status, 'void');
  assert.equal(must(await store.createInvoice(invIn())).invoice.number, 2, 'el 1 no se reutiliza');
  assert.equal(invoiceReceivables(data(store), TODAY).totalCents, 118000, 'la anulada no se debe');
});

test('anular es todo o nada: si falla, la factura sigue vigente y su stock fuera', async () => {
  const { store, root, product } = await withStock();
  const a = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '4' })] }))).invoice;
  root.failNextWrite();
  assert.ok(!(await store.voidInvoice(a.id)).ok);
  assert.equal(data(store).invoices[0].voidedAt, undefined);
  assert.equal(replayProduct(data(store).stockEntries).stock, 6);
  assert.equal(stored(root, 'invoices')[0].voidedAt, undefined);
  assert.equal(stored(root, 'stockEntries').length, 2);
  must(await store.voidInvoice(a.id));
  assert.equal(stored(root, 'stockEntries').length, 1);
});

test('anular se guarda en UNA sola operación del almacén (la factura y la devolución del stock juntas)', async () => {
  const root = createMemoryWorkspaceStore();
  /** @type {{ method: string, changes: any, deletions: any }[]} */
  const calls = [];
  const forWorkspace = root.forWorkspace.bind(root);
  root.forWorkspace = (/** @type {string} */ id) => {
    const ds = forWorkspace(id);
    return {
      ...ds,
      putMany: (/** @type {any} */ changes, /** @type {any} */ deletions) => { calls.push({ method: 'putMany', changes, deletions }); return ds.putMany(changes, deletions); },
      deleteMany: (/** @type {any} */ deletions) => { calls.push({ method: 'deleteMany', changes: null, deletions }); return ds.deleteMany(deletions); },
    };
  };
  const store = createStore(root, tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi tienda' }));
  const product = must(await store.saveProduct({ name: 'Camisa', priceText: '250' })).product;
  must(await store.registerStock(buyInput(product.id)));
  const a = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '4' })] }))).invoice;
  assert.equal(calls.at(-1)?.method, 'putMany', 'emitir: una sola operación con la factura y su salida');
  assert.deepEqual([calls.at(-1)?.changes.invoices.length, calls.at(-1)?.changes.stockEntries.length], [1, 1]);

  calls.length = 0;
  must(await store.voidInvoice(a.id));
  assert.equal(calls.length, 1, 'anular: UNA sola operación, no dos');
  assert.equal(calls[0].method, 'putMany');
  assert.equal(calls[0].changes.invoices[0].id, a.id);
  assert.equal(calls[0].deletions.stockEntryIds.length, 1);
});

test('no se anula una factura con cobros: primero se borran los cobros', async () => {
  const { store } = await space();
  const a = must(await store.createInvoice(invIn())).invoice;
  const pay = must(await store.addInvoicePayment(a.id, payIn()));
  const r = await store.voidInvoice(a.id);
  assert.ok(!r.ok);
  assert.match(r.errors.form, /Borra primero ese cobro/);
  must(await store.deleteInvoicePayment(pay.payment.id));
  must(await store.voidInvoice(a.id));
  assert.ok(!(await store.voidInvoice(a.id)).ok, 'ya anulada');
  assert.ok(!(await store.voidInvoice('no-existe')).ok);
});

test('una salida de stock de una factura no se borra desde Inventario: se anula la factura', async () => {
  const { store, product } = await withStock();
  const r = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '2' })] })));
  const del = await store.deleteStockEntry(r.entries[0].id);
  assert.ok(!del.ok);
  assert.match(del.errors.form, /anula la factura/);
  assert.equal(data(store).stockEntries.length, 2);
});

// ---- Editar ---------------------------------------------------------------------------------------------------------

test('editar una factura cambia cliente, vencimiento y notas; el dinero y el número no', async () => {
  const { store, root } = await space();
  const a = must(await store.createInvoice(invIn())).invoice;
  const r = must(await store.saveInvoiceEdit(a.id, { customerName: 'Hotel Luna', customerTaxId: '123', customerContact: 'a@b.co', dueDate: '2026-12-31', notes: 'Nota' }));
  assert.deepEqual([r.invoice.customerName, r.invoice.customerTaxId, r.invoice.dueDate, r.invoice.notes], ['Hotel Luna', '123', '2026-12-31', 'Nota']);
  assert.deepEqual([r.invoice.number, r.invoice.lines, r.invoice.taxRateBp, r.invoice.issueDate], [a.number, a.lines, a.taxRateBp, a.issueDate]);
  assert.equal(stored(root, 'invoices')[0].customerName, 'Hotel Luna');
  const bad = await store.saveInvoiceEdit(a.id, { customerName: '' });
  assert.ok(!bad.ok);
  must(await store.voidInvoice(a.id));
  const voided = await store.saveInvoiceEdit(a.id, { customerName: 'X' });
  assert.ok(!voided.ok);
  assert.match(voided.errors.form, /anulada/);
  assert.ok(!(await store.saveInvoiceEdit('no-existe', { customerName: 'X' })).ok);
});

// ---- Productos ligados ------------------------------------------------------------------------------------------

test('un producto que aparece en una factura (aunque esté anulada) no se borra, pero sí se archiva', async () => {
  const { store, product } = await withStock();
  const a = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id })] }))).invoice;
  must(await store.voidInvoice(a.id));
  const own = data(store).stockEntries.filter((e) => e.productId === product.id).length;
  assert.equal(own, 1);
  const attempt = await store.deleteProduct(product.id);
  assert.ok(!attempt.ok);
  must(await store.setProductArchived(product.id, true));
});

test('un producto sin movimientos pero en una factura anulada tampoco se borra', async () => {
  const { store } = await space();
  const p = must(await store.saveProduct({ name: 'Sin stock' })).product;
  // Sin stock no se puede facturar: se compra, se factura, se anula y se borra la compra.
  const buy = must(await store.registerStock(buyInput(p.id, { quantityText: '2' })));
  const a = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: p.id, quantityText: '1' })] }))).invoice;
  must(await store.voidInvoice(a.id));
  must(await store.deleteStockEntry(buy.entry.id));
  const r = await store.deleteProduct(p.id);
  assert.ok(!r.ok);
  assert.match(r.errors.form, /aparece en facturas/);
  assert.equal(data(store).products.length, 1);
});

// ---- Aislamiento, persistencia y avisos ----------------------------------------------------------------------------

test('las facturas son de cada espacio: numeración y cobros independientes', async () => {
  const { store } = await space('entrepreneur', 'Tienda A');
  const a = must(await store.createInvoice(invIn())).invoice;
  must(await store.addInvoicePayment(a.id, payIn()));
  must(await store.createWorkspace({ kind: 'company', name: 'Empresa B' }));
  assert.deepEqual([data(store).invoices.length, data(store).invoicePayments.length, data(store).movements.length], [0, 0, 0]);
  assert.equal(must(await store.createInvoice(invIn())).invoice.number, 1, 'cada espacio cuenta desde 1');
  const wsA = store.getState().workspaces.find((w) => w.name === 'Tienda A');
  must(await store.switchWorkspace(/** @type {any} */ (wsA).id));
  assert.deepEqual([data(store).invoices.length, data(store).invoicePayments.length], [1, 1]);
  assert.equal(data(store).invoices[0].customerName, 'Hotel Sol');
});

test('lo guardado vuelve igual al abrir de nuevo la app', async () => {
  const { store, root, product } = await withStock();
  const a = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '3' })] }))).invoice;
  must(await store.addInvoicePayment(a.id, payIn()));
  const b = must(await store.createInvoice(invIn({ customerName: 'Anulada' }))).invoice;
  must(await store.voidInvoice(b.id));
  const reopened = createStore(root, tickingClock());
  await reopened.init();
  assert.deepEqual(reopened.getState().data, store.getState().data);
});

test('aviso de facturas vencidas en Inicio (solo en negocios)', async () => {
  const { store } = await space();
  must(await store.createInvoice(invIn({ issueDate: '2026-10-01', dueDate: '2026-10-10' })));
  const notices = computeNotices(data(store), TODAY, { kind: 'entrepreneur' });
  const n = notices.find((x) => x.id === 'invoices-overdue');
  assert.ok(n);
  assert.equal(n.level, 'critical', '36 días de atraso');
  assert.match(n.text, /Tienes una factura vencida por RD\$ 1,180\.00/);
  // Si un espacio que no es de negocio tiene facturas (p. ej. por una copia restaurada), el aviso aparece: no se esconden datos.
  assert.ok(computeNotices(data(store), TODAY, { kind: 'personal' }).some((x) => x.id === 'invoices-overdue'));
  assert.ok(!computeNotices({ ...data(store), invoices: [], invoicePayments: [] }, TODAY, { kind: 'personal' }).some((x) => x.id === 'invoices-overdue'));
});

// ---- Demostración y respaldo ------------------------------------------------------------------------------------------

test('demostración de un negocio: cinco facturas con todos los estados, cada cobro con su ingreso DEMO', async () => {
  for (const kind of /** @type {const} */ (['entrepreneur', 'company'])) {
    const { store } = await space(kind);
    must(await store.loadDemoData());
    const d = data(store);
    assert.equal(d.invoices.length, 5, kind);
    assert.ok(d.invoices.every((i) => i.isDemo) && d.invoicePayments.every((p) => p.isDemo));
    assert.deepEqual(d.invoices.map((i) => i.number).sort(), [1, 2, 3, 4, 5]);
    const states = new Set(d.invoices.map((i) => invoicePosition(i, d.invoicePayments, TODAY).status));
    assert.deepEqual([...states].sort(), ['open', 'overdue', 'paid', 'void'], `${kind}: cobrada, vencida (con cobro parcial), vigente y anulada`);
    for (const p of d.invoicePayments) {
      const m = d.movements.find((x) => x.id === p.movementId);
      assert.ok(m && m.isDemo && m.type === 'income', 'cada cobro tiene su ingreso DEMO');
      assert.equal(m.amountCents, p.amountCents);
      assert.equal(m.date, p.date);
      assert.ok(p.date <= TODAY);
    }
    assert.ok(d.invoices.every((i) => i.issueDate <= TODAY));
    assert.equal(d.stockEntries.filter((e) => e.invoiceId).length, 0, 'la demostración de facturas no mueve el inventario de demostración');
    assert.ok(store.hasDemoData());
  }
});

test('la demostración de facturas no aparece en Personal; en Freelancer (0.14.5) trae las suyas', async () => {
  const personal = (await space('personal')).store;
  must(await personal.loadDemoData());
  assert.deepEqual([data(personal).invoices.length, data(personal).invoicePayments.length], [0, 0], 'personal');
  const freelancer = (await space('freelancer')).store;
  must(await freelancer.loadDemoData());
  assert.deepEqual([data(freelancer).invoices.length, data(freelancer).invoicePayments.length], [3, 2], 'freelancer');
});

test('quitar la demostración borra facturas, cobros e ingresos DEMO y deja intacto lo real', async () => {
  const { store, root, product } = await withStock();
  const real = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '2' })] }))).invoice;
  must(await store.addInvoicePayment(real.id, payIn({ amountText: '300' })));
  const snapshot = JSON.stringify(data(store));
  must(await store.loadDemoData());
  assert.equal(data(store).invoices.length, 6);
  must(await store.removeDemoData());
  assert.equal(JSON.stringify(data(store)), snapshot, 'queda exactamente lo real');
  assert.deepEqual([stored(root, 'invoices').length, stored(root, 'invoicePayments').length], [1, 1]);
  assert.equal(must(await store.createInvoice(invIn())).invoice.number, 2, 'la numeración real no tiene huecos');
  assert.equal(store.hasDemoData(), false);
});

test('quitar la demostración también quita una factura y un cobro que el usuario hizo sobre la demostración', async () => {
  const { store } = await space();
  must(await store.loadDemoData());
  const demoInvoice = data(store).invoices.find((i) => invoicePosition(i, data(store).invoicePayments, TODAY).status === 'open');
  assert.ok(demoInvoice);
  const r = must(await store.addInvoicePayment(demoInvoice.id, payIn({ date: '2026-11-14', amountText: '10' })));
  assert.equal(r.payment.isDemo, true);
  assert.equal(r.movement.isDemo, true);
  must(await store.removeDemoData());
  const d = data(store);
  assert.deepEqual([d.invoices.length, d.invoicePayments.length, d.movements.length], [0, 0, 0]);
});

test('copia de seguridad: ida y vuelta con facturas, cobros y salidas de stock, y la revisión previa las cuenta', async () => {
  const { store, product } = await withStock();
  const a = must(await store.createInvoice(invIn({ lines: [lineIn({ productId: product.id, quantityText: '3' })] }))).invoice;
  must(await store.addInvoicePayment(a.id, payIn()));
  const b = must(await store.createInvoice(invIn({ customerName: 'Anulada', lines: [lineIn({ productId: product.id, quantityText: '1' })] }))).invoice;
  must(await store.voidInvoice(b.id));
  const before = data(store);
  const { json } = store.exportBackup();
  const inspected = store.inspectBackup(json);
  assert.ok(inspected.ok && inspected.kind === 'workspace');
  assert.equal(inspected.ok && inspected.counts.invoices, 2);

  must(await store.clearAllData());
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Nueva' }));
  assert.equal(data(store).invoices.length, 0);
  const restored = must(await store.importBackup(json));
  assert.equal(restored.counts.invoices, 2);
  const after = data(store);
  assert.deepEqual(after.invoices, before.invoices);
  assert.deepEqual(after.invoicePayments, before.invoicePayments);
  assert.deepEqual(after.stockEntries, before.stockEntries);
  assert.deepEqual(after.movements, before.movements);
});
