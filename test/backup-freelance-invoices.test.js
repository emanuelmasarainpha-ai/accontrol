// 0.14.5 — La copia de seguridad conserva el cliente de la factura y el servicio de cada línea, y rechaza copias que rompan
// los vínculos o la regla de una sola fuente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { createBackup, parseBackup } from '../src/domain/backup.js';
import { receivables } from '../src/domain/freelance.js';

const fixedNow = new Date(2026, 10, 15, 15, 30);
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };

/** Datos reales hechos con la app: Ana, su Logo de 10,000, una factura del 50 % y un cobro parcial. */
async function freelancerData() {
  const store = createStore(createMemoryWorkspaceStore(), tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'freelancer', name: 'Mi trabajo' }));
  const ana = must(await store.saveClient({ firstName: 'Ana', lastName: '', company: '', email: '', phone: '', country: '', notes: '' })).client;
  const logo = must(await store.saveService({ clientId: ana.id, name: 'Logo', priceText: '10000', estimatedDaysText: '', status: 'in_progress', startDate: '' })).service;
  const { invoice } = must(await store.createInvoice({
    clientId: ana.id, customerName: 'Ana', issueDate: '2026-11-10', dueDate: '2026-11-25', taxText: '18', notes: '',
    lines: [{ description: 'Logo 50 %', productId: '', serviceId: logo.id, quantityText: '1', unitText: '5000' }, { description: 'Viático', productId: '', quantityText: '1', unitText: '300' }],
  }));
  must(await store.addInvoicePayment(invoice.id, { amountText: '2000', date: '2026-11-12', categoryId: 'cat-inc-ventas', note: '' }));
  return { data: store.getState().data, ana, logo, invoice };
}
const roundTrip = (/** @type {any} */ data) => parseBackup(JSON.stringify(createBackup(data, '2026-11-15T19:30:00.000Z')), { today: TODAY });

test('ida y vuelta: la factura conserva su cliente, cada línea su servicio, y lo por cobrar no cambia', async () => {
  const { data, ana, logo } = await freelancerData();
  const r = roundTrip(data);
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (!r.ok) return;
  const inv = r.data.invoices[0];
  assert.equal(inv.clientId, ana.id);
  assert.equal(inv.lines[0].serviceId, logo.id);
  assert.equal('serviceId' in inv.lines[1], false, 'la línea suelta sigue sin servicio');
  const pay = r.data.movements.find((m) => m.id === r.data.invoicePayments[0].movementId);
  assert.equal(pay?.clientId, ana.id, 'el ingreso del cobro sigue con su cliente');
  assert.deepEqual(receivables(r.data, TODAY), receivables(data, TODAY));
});

/** Copia hecha a mano con un cambio. */
async function tampered(/** @type {(b: any, ctx: any) => void} */ change) {
  const ctx = await freelancerData();
  const backup = JSON.parse(JSON.stringify(createBackup(ctx.data, '2026-11-15T19:30:00.000Z')));
  change(backup.data, ctx);
  return parseBackup(JSON.stringify(backup), { today: TODAY });
}

test('se rechaza: factura de un cliente que no está en la copia', async () => {
  const r = await tampered((d) => { d.invoices[0].clientId = 'cliente-fantasma'; });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /cliente que no existe/);
});

test('se rechaza: línea con un servicio que no existe, de otro cliente o junto con un producto', async () => {
  const ghost = await tampered((d) => { d.invoices[0].lines[0].serviceId = 'servicio-fantasma'; });
  assert.match(ghost.ok ? '' : ghost.error, /servicio que no existe/);
  const other = await tampered((d) => {
    d.clients.push({ ...d.clients[0], id: 'c-otro', firstName: 'Beto' });
    d.services.push({ ...d.services[0], id: 's-otro', clientId: 'c-otro' });
    d.invoices[0].lines[0].serviceId = 's-otro';
  });
  assert.match(other.ok ? '' : other.error, /no es del cliente de la factura/);
  const both = await tampered((d) => { d.invoices[0].lines[0].productId = 'p'; });
  assert.equal(both.ok, false);
});

test('se rechaza: facturas vigentes que suman más que el precio del servicio (regla de una sola fuente)', async () => {
  const r = await tampered((d) => { d.invoices[0].lines[0].unitCents = 1000001; });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /Servicio «Logo»: sus facturas vigentes suman más que su precio/);
  // Si esa factura está anulada, ya no cuenta como facturada (pero sus cobros la invalidarían: se quitan).
  const voided = await tampered((d) => {
    d.invoices[0].lines[0].unitCents = 1000001;
    d.invoices[0].voidedAt = '2026-11-14T10:00:00.000Z';
    const movementIds = new Set(d.invoicePayments.map((/** @type {any} */ p) => p.movementId));
    d.invoicePayments = [];
    d.movements = d.movements.filter((/** @type {any} */ m) => !movementIds.has(m.id));
  });
  assert.ok(voided.ok, voided.ok ? '' : voided.error);
});

test('una copia anterior (facturas sin cliente ni servicios) se sigue leyendo igual', async () => {
  const r = await tampered((d) => {
    delete d.invoices[0].clientId;
    for (const l of d.invoices[0].lines) delete l.serviceId;
  });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.equal(r.data.invoices[0].clientId, undefined);
});
