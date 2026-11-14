// 0.14.5 — Facturas en Freelancer, a través del store (como la app): cliente obligatorio, servicio del cliente, el cobro cuenta una
// sola vez, lo por cobrar de una sola fuente y las protecciones de clientes y servicios con facturas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { clientSummaries, receivables } from '../src/domain/freelance.js';
import { overallTotals } from '../src/domain/summaries.js';

const fixedNow = new Date(2026, 10, 15, 15, 30); // 15 nov 2026, 15:30
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const data = (/** @type {any} */ store) => store.getState().data;

/** Espacio Freelancer con Ana y su servicio «Logo» de RD$ 10,000 en proceso (y Beto, con otro servicio). */
async function freelancer() {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'freelancer', name: 'Mi trabajo' }));
  const ana = must(await store.saveClient({ firstName: 'Ana', lastName: 'Pérez', company: '', email: 'ana@correo.com', phone: '', country: '', notes: '' })).client;
  const beto = must(await store.saveClient({ firstName: 'Beto', lastName: '', company: '', email: '', phone: '', country: '', notes: '' })).client;
  const logo = must(await store.saveService({ clientId: ana.id, name: 'Logo', priceText: '10000', estimatedDaysText: '', status: 'in_progress', startDate: '' })).service;
  const web = must(await store.saveService({ clientId: beto.id, name: 'Web', priceText: '30000', estimatedDaysText: '', status: 'in_progress', startDate: '' })).service;
  return { root, store, ana, beto, logo, web };
}
/** @returns {any} */
const invIn = (/** @type {string} */ clientId, /** @type {any[]} */ lines, over = {}) => ({
  clientId, customerName: 'Ana Pérez', customerTaxId: '', customerContact: 'ana@correo.com', issueDate: '2026-11-10', dueDate: '2026-11-25', taxText: '18', notes: '', lines, ...over,
});
const lineIn = (/** @type {string} */ serviceId, unitText = '5000', over = {}) => ({ description: 'Logo (50 %)', productId: '', serviceId, quantityText: '1', unitText, ...over });

test('Freelancer: la factura pide un cliente de la lista', async () => {
  const { store } = await freelancer();
  const r = await store.createInvoice(invIn('', [lineIn('')]));
  assert.equal(r.ok, false);
  assert.equal(r.errors.clientId, 'Elige el cliente de tu lista.');
  assert.equal(data(store).invoices.length, 0, 'no se guarda nada');
});

test('Freelancer: factura del 50 % de un servicio y cobro: lo por cobrar y lo cobrado cuentan una sola vez', async () => {
  const { store, ana, logo } = await freelancer();
  const before = overallTotals(data(store), TODAY).availableCents;
  const { invoice } = must(await store.createInvoice(invIn(ana.id, [lineIn(logo.id)])));
  assert.equal(invoice.clientId, ana.id);
  assert.equal(invoice.lines[0].serviceId, logo.id);
  assert.equal(invoice.number, 1);
  assert.equal(overallTotals(data(store), TODAY).availableCents, before, 'emitir no mueve el dinero');

  let owed = receivables(data(store), TODAY);
  // Ana: 5,000 sin facturar + 5,900 de la factura; Beto: su Web de 30,000 sin facturar.
  assert.deepEqual([owed.servicesCents, owed.invoicesCents, owed.totalCents], [3500000, 590000, 4090000]);
  const anaOwed = clientSummaries(data(store), { range: 'all', today: TODAY }).find((x) => x.client.id === ana.id)?.owedCents;
  assert.equal(anaOwed, 1090000, 'Ana: 5,000 + 5,900 (no 15,900)');

  const { movement } = must(await store.addInvoicePayment(invoice.id, { amountText: '5900', date: '2026-11-12', categoryId: 'cat-inc-ventas', note: '' }));
  assert.equal(movement.clientId, ana.id);
  assert.equal(movement.serviceId, undefined);
  assert.equal(overallTotals(data(store), TODAY).availableCents, before + 590000, 'el cobro entra una vez al Disponible');
  owed = receivables(data(store), TODAY);
  assert.deepEqual([owed.invoicesCents, owed.totalCents], [0, 3500000]);
  const row = clientSummaries(data(store), { range: 'all', today: TODAY }).find((x) => x.client.id === ana.id);
  assert.equal(row?.incomeCents, 590000, 'cobrado de Ana: una sola vez');
  assert.equal(row?.owedCents, 500000);
});

test('Freelancer: no se puede facturar un servicio de otro cliente ni por encima de lo que le queda', async () => {
  const { store, ana, logo, web } = await freelancer();
  const other = await store.createInvoice(invIn(ana.id, [lineIn(web.id, '100')]));
  assert.match(other.errors?.['line0.service'] ?? '', /no es del cliente/);
  must(await store.createInvoice(invIn(ana.id, [lineIn(logo.id, '6000')])));
  const over = await store.createInvoice(invIn(ana.id, [lineIn(logo.id, '4000.01')]));
  assert.match(over.errors?.['line0.unit'] ?? '', /Pasa de lo que queda por facturar de «Logo» \(RD\$ 4,000\.00\)/);
  assert.equal(data(store).invoices.length, 1, 'la segunda no se guardó');
});

test('Freelancer: anular la factura devuelve lo facturado al servicio', async () => {
  const { store, ana, logo } = await freelancer();
  const { invoice } = must(await store.createInvoice(invIn(ana.id, [lineIn(logo.id, '10000')])));
  assert.equal(receivables(data(store), TODAY).servicesCents, 3000000, 'el Logo, facturado entero, no cuenta; queda la Web de Beto');
  must(await store.voidInvoice(invoice.id));
  const owed = receivables(data(store), TODAY);
  assert.deepEqual([owed.servicesCents, owed.invoicesCents], [4000000, 0]);
  must(await store.createInvoice(invIn(ana.id, [lineIn(logo.id, '10000')])));
});

test('protecciones: un cliente con facturas no se borra; un servicio facturado no se borra, no cambia de cliente ni baja su precio por debajo de lo facturado', async () => {
  const { store, ana, beto, logo } = await freelancer();
  const { invoice } = must(await store.createInvoice(invIn(ana.id, [lineIn(logo.id, '6000')])));
  assert.match((await store.deleteClient(ana.id)).errors?.form ?? '', /facturas/);
  assert.match((await store.deleteService(logo.id)).errors?.form ?? '', /está en una factura/);
  const base = { clientId: ana.id, name: 'Logo', estimatedDaysText: '', status: 'in_progress', startDate: '' };
  assert.match((await store.saveService({ ...base, priceText: '5999' }, logo.id)).errors?.price ?? '', /Ya facturaste RD\$ 6,000\.00/);
  must(await store.saveService({ ...base, priceText: '6000' }, logo.id));
  assert.match((await store.saveService({ ...base, clientId: beto.id, priceText: '10000' }, logo.id)).errors?.clientId ?? '', /está en una factura/);
  // Anulada: el precio puede bajar, pero el servicio sigue sin poder borrarse (la factura anulada lo nombra).
  must(await store.voidInvoice(invoice.id));
  must(await store.saveService({ ...base, priceText: '100' }, logo.id));
  assert.match((await store.deleteService(logo.id)).errors?.form ?? '', /está en una factura/);
});

test('Emprendedor no cambia: sin cliente de la lista, con nombre escrito a mano', async () => {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Tienda' }));
  const { invoice } = must(await store.createInvoice({ customerName: 'Hotel Sol', issueDate: '2026-11-10', dueDate: '', taxText: '', notes: '', lines: [{ description: 'Camisas', productId: '', quantityText: '2', unitText: '500' }] }));
  assert.equal(invoice.clientId, undefined);
});

test('un cliente cuya única relación es una factura (sin servicios, pagos ni gastos) tampoco se borra', async () => {
  const { store } = await freelancer();
  const cata = must(await store.saveClient({ firstName: 'Cata', lastName: '', company: '', email: '', phone: '', country: '', notes: '' })).client;
  must(await store.createInvoice(invIn(cata.id, [{ description: 'Asesoría', productId: '', quantityText: '1', unitText: '1500' }], { customerName: 'Cata' })));
  const r = await store.deleteClient(cata.id);
  assert.equal(r.ok, false);
  assert.match(r.errors?.form ?? '', /facturas/);
  assert.ok(data(store).clients.some((/** @type {any} */ c) => c.id === cata.id), 'sigue ahí');
});

test('demostración de Freelancer: 3 facturas DEMO ligadas a sus clientes, con los tres estados, sin facturar de más; y se quitan enteras', async () => {
  const { invoicePositions, billedByService, invoiceLabel } = await import('../src/domain/invoices.js');
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'freelancer', name: 'Mi trabajo' }));
  must(await store.loadDemoData());
  const d = data(store);
  assert.equal(d.invoices.length, 3);
  for (const inv of d.invoices) {
    assert.equal(inv.isDemo, true);
    assert.match(invoiceLabel(inv), /^DEMO-00\d$/);
    assert.ok(d.clients.some((/** @type {any} */ c) => c.id === inv.clientId && c.isDemo), 'ligada a un cliente de demostración');
  }
  const statuses = invoicePositions(d, TODAY).map((p) => p.status).sort();
  assert.deepEqual(statuses, ['open', 'overdue', 'paid']);
  // Regla de una sola fuente: ningún servicio facturado por encima de su precio.
  for (const [serviceId, cents] of billedByService(d.invoices)) {
    const svc = d.services.find((/** @type {any} */ s) => s.id === serviceId);
    assert.ok(svc && cents <= svc.priceCents, 'facturado ≤ precio');
  }
  // Cada cobro tiene su ingreso DEMO con el cliente de la factura.
  for (const p of d.invoicePayments) {
    const m = d.movements.find((/** @type {any} */ x) => x.id === p.movementId);
    const inv = d.invoices.find((/** @type {any} */ x) => x.id === p.invoiceId);
    assert.equal(m?.isDemo, true);
    assert.equal(m?.clientId, inv?.clientId);
  }
  must(await store.removeDemoData());
  const after = data(store);
  assert.deepEqual([after.invoices.length, after.invoicePayments.length, after.movements.filter((/** @type {any} */ m) => m.isDemo).length], [0, 0, 0]);
});
