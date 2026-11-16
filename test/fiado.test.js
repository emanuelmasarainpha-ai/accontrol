// 0.16.3 — Quién me debe (fiado): reglas del dominio y operaciones del store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import {
  allocatePayment, creditInvoiceInput, customerKey, customerLedger, customerLedgers, fiadoEnabled, fiadoSummary, foldName, searchLedgers,
  statementMessage, STATEMENT_EVENTS, validateCustomerPayment,
} from '../src/domain/fiado.js';
import { invoicePosition, invoiceReceivables } from '../src/domain/invoices.js';
import { overallTotals } from '../src/domain/summaries.js';
import { replayProduct } from '../src/domain/inventory.js';

const fixedNow = new Date(2026, 10, 15, 15, 30); // 15 nov 2026, 15:30
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {'personal' | 'freelancer' | 'entrepreneur' | 'company'} kind */
async function space(kind = 'entrepreneur') {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind, name: 'Colmado' })).ok);
  return { root, store };
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const credit = (/** @type {Record<string, string>} */ over = {}) => ({ customerName: 'Doña Rosa', description: 'Pan y leche', amountText: '150', date: '2026-11-01', ...over });
const abono = (/** @type {Record<string, string>} */ over = {}) => ({ amountText: '100', date: TODAY, categoryId: 'cat-inc-ventas', note: '', ...over });
const data = (/** @type {any} */ store) => store.getState().data;

// ---- Quién es quién ---------------------------------------------------------------------------------------------

test('el mismo cliente aunque se escriba con o sin tildes, mayúsculas o espacios de más', () => {
  assert.equal(foldName('  José   PÉREZ '), 'jose perez');
  const a = customerKey({ customerName: 'José Pérez' });
  assert.equal(customerKey({ customerName: 'jose  perez' }), a);
  assert.notEqual(customerKey({ customerName: 'José Peralta' }), a);
  assert.equal(customerKey({ customerName: 'José Pérez', clientId: 'c1' }), 'c:c1', 'con ficha de cliente, manda la ficha');
});

test('Fiado se ofrece en Emprendedor y Empresa, no en Freelancer ni en Personal', () => {
  const empty = { invoices: [] };
  assert.equal(fiadoEnabled('entrepreneur', empty), true);
  assert.equal(fiadoEnabled('company', empty), true);
  assert.equal(fiadoEnabled('freelancer', empty), false);
  assert.equal(fiadoEnabled('personal', empty), false);
});

test('fiar crea una factura de una línea, sin impuesto ni producto, con la nota «Fiado»', () => {
  const input = creditInvoiceInput(credit({ description: '  ' }));
  assert.equal(input.notes, 'Fiado');
  assert.equal(input.taxText, '');
  assert.equal(input.lines.length, 1);
  assert.deepEqual({ ...input.lines[0] }, { description: 'Fiado', quantityText: '1', unitText: '150', productId: '', serviceId: '' });
});

// ---- Reparto de un abono ----------------------------------------------------------------------------------------

/** @param {string} id @param {string} issueDate @param {number} number @param {number} balanceCents */
const pos = (id, issueDate, number, balanceCents) => /** @type {any} */ ({ invoice: { id, issueDate, number }, balanceCents });

test('un abono paga primero la deuda más vieja', () => {
  const open = [pos('a', '2026-11-01', 1, 10000), pos('b', '2026-11-05', 2, 5000), pos('c', '2026-11-09', 3, 3000)];
  assert.deepEqual(allocatePayment(open, 12000, TODAY), [{ invoiceId: 'a', amountCents: 10000 }, { invoiceId: 'b', amountCents: 2000 }]);
  assert.deepEqual(allocatePayment(open, 18000, TODAY).map((x) => x.amountCents), [10000, 5000, 3000], 'todo justo');
  assert.deepEqual(allocatePayment(open, 1, TODAY), [{ invoiceId: 'a', amountCents: 1 }]);
});

test('un abono no toca facturas posteriores a su fecha', () => {
  const open = [pos('a', '2026-11-01', 1, 1000), pos('b', '2026-11-10', 2, 5000)];
  assert.deepEqual(allocatePayment(open, 3000, '2026-11-05'), [{ invoiceId: 'a', amountCents: 1000 }]);
});

// ---- Store: fiar y abonar ---------------------------------------------------------------------------------------

test('fiar: la deuda aparece en «Fiado» y en «Facturas», y no cambia el dinero disponible hasta que pague', async () => {
  const { store } = await space();
  const before = overallTotals(data(store), TODAY);
  must(await store.createCredit(credit()));
  must(await store.createCredit(credit({ customerName: 'doña  ROSA', description: 'Arroz', amountText: '250', date: '2026-11-03' })));
  must(await store.createCredit(credit({ customerName: 'Pedro', amountText: '80' })));
  assert.deepEqual(overallTotals(data(store), TODAY), before, 'fiar no es cobrar');
  const ledgers = customerLedgers(data(store), TODAY);
  assert.deepEqual(ledgers.map((l) => [l.name, l.balanceCents, l.positions.length]), [['Doña Rosa', 40000, 2], ['Pedro', 8000, 1]]);
  // «Facturas → Quién te debe» cuenta lo mismo y con la misma clave.
  const r = invoiceReceivables(data(store), TODAY);
  assert.deepEqual(r.customers.map((c) => [c.key, c.balanceCents]), ledgers.map((l) => [l.key, l.balanceCents]));
  assert.equal(data(store).invoices[0].notes, 'Fiado');
});

test('fiar: errores claros con los nombres del formulario', async () => {
  const { store } = await space();
  const r = await store.createCredit(credit({ customerName: ' ', amountText: '', date: '2099-01-01' }));
  assert.equal(r.ok, false);
  assert.match(r.errors.customerName, /nombre del cliente/);
  assert.match(r.errors.amount, /cuánto se llevó fiado/);
  assert.match(r.errors.date, /no puede ser futura/);
  const zero = await store.createCredit(credit({ amountText: '0' }));
  assert.match(zero.errors.amount, /Lo fiado debe ser mayor que cero/);
  assert.equal(data(store).invoices.length, 0);
});

test('abonar: reparte desde lo más viejo, crea un cobro con su ingreso por factura y sube el disponible una sola vez', async () => {
  const { store, root } = await space();
  must(await store.createCredit(credit({ amountText: '100', date: '2026-11-01' })));
  must(await store.createCredit(credit({ amountText: '300', date: '2026-11-05' })));
  const key = customerLedgers(data(store), TODAY)[0].key;
  const before = overallTotals(data(store), TODAY);
  const r = must(await store.addCustomerPayment(key, abono({ amountText: '250', note: 'Efectivo' })));
  assert.equal(r.amountCents, 25000);
  assert.deepEqual(r.payments.map((/** @type {any} */ p) => p.amountCents), [10000, 15000]);
  assert.equal(r.movements.length, 2);
  assert.ok(r.payments.every((/** @type {any} */ p, /** @type {number} */ i) => p.movementId === r.movements[i].id && p.note === 'Efectivo'));
  const after = overallTotals(data(store), TODAY);
  assert.equal(after.incomeCents - before.incomeCents, 25000, 'el disponible sube lo abonado, ni más ni menos');
  const ledger = customerLedger(data(store), key, TODAY);
  assert.equal(ledger?.balanceCents, 15000);
  assert.equal(ledger?.open.length, 1);
  assert.equal(ledger?.lastPaymentDate, TODAY);
  // Lo guardado de verdad.
  assert.equal(root.rawRecords('invoicePayments').length, 2);
  assert.equal(root.rawRecords('movements').length, 2);
  // Cada factura queda cobrada según su parte.
  const [first, second] = ledger?.positions ?? [];
  assert.equal(first.status, 'paid');
  assert.equal(second.paidCents, 15000);
});

test('abonar: no se puede pagar más de lo que debe, ni en el futuro, ni antes de la deuda más vieja', async () => {
  const { store } = await space();
  must(await store.createCredit(credit({ amountText: '100', date: '2026-11-05' })));
  const key = customerLedgers(data(store), TODAY)[0].key;
  const tooMuch = await store.addCustomerPayment(key, abono({ amountText: '100.01' }));
  assert.match(tooMuch.errors.amount, /debe RD\$ 100\.00: el abono no puede pasar de ahí/);
  assert.match((await store.addCustomerPayment(key, abono({ date: '2026-11-16' }))).errors.date, /no puede ser futura/);
  assert.match((await store.addCustomerPayment(key, abono({ date: '2026-11-04' }))).errors.date, /no puede ser anterior/);
  assert.match((await store.addCustomerPayment(key, abono({ amountText: '-5' }))).errors.amount, /mayor que cero|válid|negativ/i);
  assert.match((await store.addCustomerPayment(key, abono({ categoryId: 'cat-exp-otros' }))).errors.category, /no es de ingresos/);
  assert.equal((await store.addCustomerPayment('n:nadie', abono())).errors.form, 'Ese cliente ya no tiene fiados.');
  assert.equal(data(store).invoicePayments.length, 0);
});

test('abonar: con fecha intermedia solo cuenta lo que ya se debía en esa fecha', async () => {
  const { store } = await space();
  must(await store.createCredit(credit({ amountText: '100', date: '2026-11-01' })));
  must(await store.createCredit(credit({ amountText: '500', date: '2026-11-10' })));
  const key = customerLedgers(data(store), TODAY)[0].key;
  const r = await store.addCustomerPayment(key, abono({ amountText: '200', date: '2026-11-05' }));
  assert.match(r.errors.amount, /Hasta el .*debía RD\$ 100\.00/);
  must(await store.addCustomerPayment(key, abono({ amountText: '100', date: '2026-11-05' })));
});

test('abonar: si falla el guardado, no queda ningún cobro ni ingreso a medias', async () => {
  const { store, root } = await space();
  must(await store.createCredit(credit({ amountText: '100', date: '2026-11-01' })));
  must(await store.createCredit(credit({ amountText: '100', date: '2026-11-02' })));
  const key = customerLedgers(data(store), TODAY)[0].key;
  root.failNextWrite();
  const r = await store.addCustomerPayment(key, abono({ amountText: '150' }));
  assert.equal(r.ok, false);
  assert.equal(root.rawRecords('invoicePayments').length, 0);
  assert.equal(root.rawRecords('movements').length, 0);
  assert.equal(data(store).invoicePayments.length, 0);
});

test('una factura con productos a ese cliente también es fiado, y su abono no toca el inventario', async () => {
  const { store } = await space();
  const product = must(await store.saveProduct({ name: 'Arroz', priceText: '50' })).product;
  must(await store.registerStock({ kind: 'purchase', productId: product.id, quantityText: '10', unitText: '30', date: '2026-11-01', supplierId: '', categoryId: 'cat-exp-otros', note: '' }));
  must(await store.createInvoice({ customerName: 'Doña Rosa', customerTaxId: '', customerContact: '', issueDate: '2026-11-02', dueDate: '', taxText: '', notes: '', lines: [{ description: 'Arroz', productId: product.id, quantityText: '2', unitText: '50' }] }));
  must(await store.createCredit(credit({ amountText: '20', date: '2026-11-03' })));
  const ledger = customerLedgers(data(store), TODAY)[0];
  assert.equal(ledger.positions.length, 2);
  assert.equal(ledger.balanceCents, 12000);
  must(await store.addCustomerPayment(ledger.key, abono({ amountText: '120' })));
  assert.equal(replayProduct(data(store).stockEntries).stock, 8, 'el inventario solo bajó al vender');
  assert.equal(customerLedger(data(store), ledger.key, TODAY)?.balanceCents, 0);
});

test('una factura anulada no cuenta como fiado', async () => {
  const { store } = await space();
  const inv = must(await store.createCredit(credit({ amountText: '100' }))).invoice;
  must(await store.voidInvoice(inv.id));
  assert.deepEqual(customerLedgers(data(store), TODAY), []);
});

// ---- Estado de cuenta, resumen y búsqueda ------------------------------------------------------------------------

test('estado de cuenta: fiados y abonos en orden con el saldo después de cada uno', async () => {
  const { store } = await space();
  must(await store.createCredit(credit({ amountText: '100', date: '2026-11-01', description: 'Pan' })));
  must(await store.createCredit(credit({ amountText: '50', date: '2026-11-03', description: 'Leche' })));
  const key = customerLedgers(data(store), TODAY)[0].key;
  must(await store.addCustomerPayment(key, abono({ amountText: '120', date: '2026-11-04' })));
  const ledger = /** @type {any} */ (customerLedger(data(store), key, TODAY));
  assert.deepEqual(ledger.events.map((/** @type {any} */ e) => [e.kind, e.date, e.amountCents, e.balanceAfterCents]), [
    ['credit', '2026-11-01', 10000, 10000],
    ['credit', '2026-11-03', 5000, 15000],
    ['payment', '2026-11-04', 10000, 5000],
    ['payment', '2026-11-04', 2000, 3000],
  ]);
  const text = statementMessage(ledger, { senderName: 'Colmado La Esquina', today: TODAY });
  assert.match(text, /^Hola, Doña Rosa\.\nEste es tu estado de cuenta con Colmado La Esquina al 15 nov 2026:/);
  assert.match(text, /• 1 nov 2026: Pan \(F-0001\) — RD\$ 100\.00/);
  assert.match(text, /• 4 nov 2026: abono — −RD\$ 100\.00/);
  assert.match(text, /Saldo pendiente: RD\$ 30\.00\./);
  assert.match(text, /Colmado La Esquina$/);
  assert.doesNotMatch(text, /undefined|NaN/);
});

test('estado de cuenta: al día lo dice, y con muchos movimientos solo lleva los últimos', async () => {
  const { store } = await space();
  for (let d = 1; d <= 12; d += 1) must(await store.createCredit(credit({ amountText: '10', date: `2026-11-${String(d).padStart(2, '0')}` })));
  const key = customerLedgers(data(store), TODAY)[0].key;
  const many = /** @type {any} */ (customerLedger(data(store), key, TODAY));
  const text = statementMessage(many, { today: TODAY });
  assert.equal(text.split('\n').filter((l) => l.startsWith('•')).length, STATEMENT_EVENTS);
  assert.match(text, /los últimos 10 movimientos/);
  must(await store.addCustomerPayment(key, abono({ amountText: '120' })));
  assert.match(statementMessage(/** @type {any} */ (customerLedger(data(store), key, TODAY)), { today: TODAY }), /Estás al día: no debes nada/);
});

test('resumen: total que te deben, cuántos clientes deben y lo abonado este mes', async () => {
  const { store } = await space();
  must(await store.createCredit(credit({ amountText: '100', date: '2026-10-20' })));
  must(await store.createCredit(credit({ customerName: 'Pedro', amountText: '40' })));
  must(await store.createCredit(credit({ customerName: 'Ana', amountText: '30' })));
  const ana = customerLedgers(data(store), TODAY).find((l) => l.name === 'Ana');
  must(await store.addCustomerPayment(/** @type {any} */ (ana).key, abono({ amountText: '30' })));
  const rosa = customerLedgers(data(store), TODAY).find((l) => l.name === 'Doña Rosa');
  must(await store.addCustomerPayment(/** @type {any} */ (rosa).key, abono({ amountText: '10', date: '2026-10-25' })));
  const s = fiadoSummary(customerLedgers(data(store), TODAY), '2026-11');
  assert.deepEqual(s, { totalCents: 13000, customers: 2, overdueCents: 0, collectedThisMonthCents: 3000 });
});

test('buscar clientes por nombre o contacto, sin tildes', async () => {
  const { store } = await space();
  must(await store.createCredit(credit({ customerName: 'José Pérez', customerContact: '809-555-1234' })));
  must(await store.createCredit(credit({ customerName: 'Ana' })));
  const all = customerLedgers(data(store), TODAY);
  assert.deepEqual(searchLedgers(all, 'jose').map((l) => l.name), ['José Pérez']);
  assert.deepEqual(searchLedgers(all, '555').map((l) => l.name), ['José Pérez']);
  assert.equal(searchLedgers(all, '  ').length, 2);
});

test('validar un abono sin cliente o de alguien que no debe', () => {
  assert.equal(validateCustomerPayment(abono(), { ledger: null, categories: [], today: TODAY }).ok, false);
  const paid = /** @type {any} */ ({ name: 'Ana', balanceCents: 0, open: [], oldestOpenDate: '' });
  const r = validateCustomerPayment(abono(), { ledger: paid, categories: [{ id: 'cat-inc-ventas', kind: 'income' }], today: TODAY });
  assert.equal(r.ok, false);
  assert.equal(/** @type {any} */ (r).errors.form, 'Ana no debe nada.');
});

test('los abonos a una factura de demostración también son de demostración', async () => {
  const { store } = await space();
  must(await store.loadDemoData());
  const demo = customerLedgers(data(store), TODAY).find((l) => l.isDemo && l.balanceCents > 0);
  assert.ok(demo, 'la demostración trae clientes que deben');
  const r = must(await store.addCustomerPayment(demo.key, abono({ amountText: '1', date: TODAY })));
  assert.ok(r.payments.every((/** @type {any} */ p) => p.isDemo === true) && r.movements.every((/** @type {any} */ m) => m.isDemo === true));
  // invoicePosition sigue cuadrando con el abono.
  const inv = data(store).invoices.find((/** @type {any} */ i) => i.id === r.payments[0].invoiceId);
  assert.ok(invoicePosition(inv, data(store).invoicePayments, TODAY).paidCents >= 100);
});

test('estado de cuenta: el mismo día va primero el fiado y luego el abono (el saldo nunca queda negativo)', async () => {
  const { store } = await space();
  must(await store.createCredit(credit({ amountText: '100', date: TODAY })));
  const key = customerLedgers(data(store), TODAY)[0].key;
  must(await store.addCustomerPayment(key, abono({ amountText: '100', date: TODAY })));
  const ledger = /** @type {any} */ (customerLedger(data(store), key, TODAY));
  assert.deepEqual(ledger.events.map((/** @type {any} */ e) => [e.kind, e.balanceAfterCents]), [['credit', 10000], ['payment', 0]]);
  assert.ok(ledger.events.every((/** @type {any} */ e) => e.balanceAfterCents >= 0));
});
