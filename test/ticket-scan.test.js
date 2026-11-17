// 0.17.2 — Ticket de venta y pistola lectora de códigos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { createScanReader, MAX_CODE_LENGTH } from '../src/domain/scan.js';
import { buildTicket, TICKET_FOOTER } from '../src/domain/ticket.js';

const fixedNow = new Date(2026, 10, 15, 15, 30);
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
async function shop() {
  const store = createStore(createMemoryWorkspaceStore(), tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Colmado La Esquina' }));
  const pan = must(await store.saveProduct({ name: 'Pan de agua', priceText: '10', trackStock: false })).product;
  const refresco = must(await store.saveProduct({ name: 'Refresco rojo', priceText: '50', trackStock: false })).product;
  return { store, pan, refresco };
}
const ticketOf = (/** @type {any} */ store, /** @type {any} */ invoice, organization = null) =>
  buildTicket(invoice, store.getState().data.invoicePayments, { workspaceName: store.activeWorkspace().name, organization, today: TODAY });

// ---- Ticket ---------------------------------------------------------------------------------------------------------

test('ticket de una venta en efectivo: negocio, número, líneas, ITBIS, total, pago con la devuelta y el pie', async () => {
  const { store, pan, refresco } = await shop();
  const r = must(await store.posSale({
    cart: [{ productId: pan.id, quantity: 3, unitCents: 1000 }, { productId: refresco.id, quantity: 1, unitCents: 5000 }],
    method: 'cash', receivedText: '200', taxText: '18', date: TODAY,
  }));
  const t = ticketOf(store, r.invoice, /** @type {any} */ ({ legalName: 'Colmado La Esquina SRL', taxId: '1-31-00000-1', phone: '809-555-0100', address: 'Santiago', activity: '', email: '' }));
  assert.equal(t.business, 'Colmado La Esquina SRL');
  assert.deepEqual(t.details, ['RNC 1-31-00000-1', 'Tel. 809-555-0100', 'Santiago']);
  assert.equal(t.title, 'Ticket de venta');
  assert.equal(t.number, 'F-0001');
  assert.match(t.when, /^15 nov 2026 · \d\d:\d\d$/);
  assert.equal(t.customer, 'Cliente de mostrador');
  assert.deepEqual(t.lines, [
    { quantity: 3, name: 'Pan de agua', unit: 'RD$ 10.00', total: 'RD$ 30.00' },
    { quantity: 1, name: 'Refresco rojo', unit: 'RD$ 50.00', total: 'RD$ 50.00' },
  ]);
  assert.deepEqual([t.subtotal, t.tax, t.total], ['RD$ 80.00', { label: 'ITBIS 18 %', amount: 'RD$ 14.40' }, 'RD$ 94.40']);
  assert.deepEqual(t.payments, [{ label: 'Efectivo · recibido RD$ 200.00 · devuelta RD$ 105.60', amount: 'RD$ 94.40' }]);
  assert.equal(t.pending, null);
  assert.equal(t.footer, TICKET_FOOTER);
  assert.match(t.footer, /No es un comprobante fiscal/);
});

test('ticket de un fiado: título de fiado, sin pagos y con lo pendiente; sin datos del negocio usa el nombre del espacio', async () => {
  const { store, pan } = await shop();
  const r = must(await store.posSale({ cart: [{ productId: pan.id, quantity: 2, unitCents: 1000 }], method: 'credit', customerName: 'Doña Rosa', date: TODAY }));
  const t = ticketOf(store, r.invoice);
  assert.deepEqual([t.business, t.details, t.title, t.customer, t.tax, t.payments, t.pending], ['Colmado La Esquina', [], 'Ticket de fiado', 'Doña Rosa', null, [], 'RD$ 20.00']);
  assert.equal(t.when, '15 nov 2026');
});

test('ticket de una factura anulada lo dice', async () => {
  const { store, pan } = await shop();
  const r = must(await store.posSale({ cart: [{ productId: pan.id, quantity: 1, unitCents: 1000 }], method: 'credit', customerName: 'Ana', date: TODAY }));
  must(await store.voidInvoice(r.invoice.id));
  const voided = store.getState().data.invoices[0];
  assert.equal(ticketOf(store, voided).isVoid, true);
  assert.equal(ticketOf(store, voided).pending, null);
});

// ---- Pistola lectora --------------------------------------------------------------------------------------------------

/** Teclea `text` y Enter, con `gap` milisegundos entre teclas. @param {ReturnType<typeof createScanReader>} reader */
function type(reader, text, gap, start = 1000) {
  let at = start;
  for (const ch of text) { reader.key(ch, at); at += gap; }
  return reader.key('Enter', at);
}

test('pistola: teclas rápidas + Enter = un código', () => {
  const reader = createScanReader();
  assert.equal(type(reader, '7460001234567', 5), '7460001234567');
  assert.equal(type(reader, 'CAM-001', 8, 5000), 'CAM-001', 'una segunda lectura seguida');
});

test('pistola: una persona tecleando despacio no cuenta como código', () => {
  const reader = createScanReader();
  assert.equal(type(reader, '123456', 180), null);
});

test('pistola: códigos muy cortos, un Enter suelto o una pausa larga antes del Enter no cuentan', () => {
  const reader = createScanReader();
  assert.equal(type(reader, '12', 5), null, 'muy corto');
  assert.equal(reader.key('Enter', 99999), null, 'Enter suelto');
  for (const [i, ch] of [...'4567'].entries()) reader.key(ch, 200000 + i * 5);
  assert.equal(reader.key('Enter', 200000 + 500), null, 'pausa larga antes del Enter');
});

test('pistola: si hubo una pausa, el código empieza de nuevo; Shift y otras teclas no se suman', () => {
  const reader = createScanReader();
  reader.key('x', 0); reader.key('y', 5);
  let at = 1000;
  for (const k of ['Shift', 'A', 'B', 'Shift', 'C']) { reader.key(k, at); at += 5; }
  assert.equal(reader.key('Enter', at), 'ABC');
});

test('pistola: no junta más de lo que cabe en un código, y reset borra lo leído', () => {
  const reader = createScanReader();
  assert.equal(type(reader, '9'.repeat(50), 2)?.length, MAX_CODE_LENGTH);
  for (const ch of 'abcd') reader.key(ch, 300000);
  reader.reset();
  assert.equal(reader.key('Enter', 300001), null);
});
