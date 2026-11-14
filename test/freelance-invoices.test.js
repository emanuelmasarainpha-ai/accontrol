// 0.14.5 — Facturas internas en Freelancer: la regla de UNA SOLA FUENTE para lo «por cobrar».
//   · lo facturado de un servicio lo cuenta SOLO su factura (saldo = total − cobros, con impuesto);
//   · lo que el servicio aún no ha facturado lo cuenta SOLO el servicio (precio − cobrado directo − facturado);
//   · un servicio nunca se factura por encima de lo que le queda;
//   · el ingreso de un cobro lleva el cliente (cuenta UNA vez en su «cobrado») y no lleva servicio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSummaries, receivables, summarizeService, paidByService } from '../src/domain/freelance.js';
import {
  billedByService, buildPaymentMovement, directPaidByService, invoicePosition, overdueInvoices, reminderMessage, serviceBillingRoom, validateInvoice,
} from '../src/domain/invoices.js';

const NOW = '2026-11-03T10:00:00.000Z';
const TODAY = '2026-11-03';
const client = (id, firstName, over = {}) => ({ id, firstName, lastName: '', company: '', email: '', phone: '', country: '', notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over });
const service = (id, clientId, name, priceCents, status = 'in_progress') => ({ id, clientId, name, priceCents, estimatedDays: null, status, startDate: '', createdAt: NOW, updatedAt: NOW });
let seq = 0;
const income = (date, amountCents, link = {}) => ({ id: `m${++seq}`, type: 'income', amountCents, date, time: '10:00', description: 'Pago', classification: 'variable', categoryId: 'cat-inc-ventas', createdAt: NOW, updatedAt: NOW, ...link });
/** @returns {any} */
const invoice = (id, number, lines, over = {}) => ({
  id, number, clientId: 'c1', customerName: 'Ana', customerTaxId: '', customerContact: '', issueDate: '2026-10-01', dueDate: '2026-10-31',
  lines, taxRateBp: 1800, notes: '', createdAt: NOW, updatedAt: NOW, ...over,
});
/** @returns {any} */
const payment = (invoiceId, amountCents, movementId, date = '2026-10-20') => ({ id: `p-${movementId}`, invoiceId, amountCents, date, time: '10:00', note: '', movementId, createdAt: NOW, updatedAt: NOW });
const line = (description, unitCents, serviceId, quantity = 1) => ({ description, quantity, unitCents, ...(serviceId ? { serviceId } : {}) });
/** @returns {any} */
const data = (over = {}) => ({ clients: [client('c1', 'Ana'), client('c2', 'Beto')], services: [], movements: [], invoices: [], invoicePayments: [], ...over });

const CTX = { products: [], entries: [], today: TODAY, time: '10:00', nowISO: NOW };
const input = (over = {}) => ({ clientId: 'c1', customerName: 'Ana', issueDate: '2026-11-01', dueDate: '', taxText: '18', lines: [{ description: 'Logo', quantityText: '1', unitText: '5000', serviceId: 's1' }], ...over });

// ---- Lo facturado y lo que queda por facturar -------------------------------------------------------------------

test('facturado por servicio: suma las líneas (sin impuesto) de facturas vigentes; las anuladas no cuentan', () => {
  const invoices = [
    invoice('i1', 1, [line('Logo 50%', 500000, 's1'), line('Viático', 20000)]),
    invoice('i2', 2, [line('Logo resto', 200000, 's1'), line('Web', 300000, 's2')]),
    invoice('i3', 3, [line('Logo', 900000, 's1')], { voidedAt: NOW }),
  ];
  assert.deepEqual([...billedByService(invoices).entries()].sort(), [['s1', 700000], ['s2', 300000]]);
  assert.equal(billedByService(invoices, 'i2').get('s1'), 500000, 'sin contar la que se excluye');
});

test('cobrado directo por servicio: solo ingresos vinculados al servicio y no futuros (los cobros de facturas no llevan servicio)', () => {
  const movements = [income('2026-10-01', 1000, { serviceId: 's1' }), income('2026-12-01', 9999, { serviceId: 's1' }), income('2026-10-02', 5000, { clientId: 'c1' })];
  assert.deepEqual([...directPaidByService(movements, TODAY)], [['s1', 1000]]);
  assert.equal(paidByService, directPaidByService, 'una sola definición');
});

test('lo que queda por facturar: precio − cobrado directo − facturado, nunca menos de cero', () => {
  const s1 = service('s1', 'c1', 'Logo', 1000000);
  const movements = [income('2026-10-01', 200000, { clientId: 'c1', serviceId: 's1' })];
  const invoices = [invoice('i1', 1, [line('Logo', 300000, 's1')])];
  assert.equal(serviceBillingRoom(s1, { movements, invoices, today: TODAY }), 500000);
  assert.equal(serviceBillingRoom(s1, { movements, invoices: [invoice('i1', 1, [line('Logo', 900000, 's1')])], today: TODAY }), 0);
});

// ---- Validar una factura de Freelancer ---------------------------------------------------------------------------

test('Freelancer: la factura debe llevar un cliente de la lista, que exista y no esté archivado', () => {
  const services = [service('s1', 'c1', 'Logo', 1000000)];
  const ctx = { ...CTX, clients: data().clients, services, requireClient: true };
  assert.equal(validateInvoice(input({ clientId: '' }), ctx).errors?.clientId, 'Elige el cliente de tu lista.');
  assert.match(validateInvoice(input({ clientId: 'nadie' }), ctx).errors?.clientId ?? '', /ya no existe/);
  const archived = { ...ctx, clients: [client('c1', 'Ana', { archived: true })] };
  assert.match(validateInvoice(input(), archived).errors?.clientId ?? '', /archivado/);
  const ok = validateInvoice(input(), ctx);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.clientId, 'c1');
  assert.equal(ok.value.lines[0].serviceId, 's1');
});

test('Freelancer: la línea solo puede facturar un servicio de ESE cliente, no cancelado, y no junto con un producto', () => {
  const services = [service('s1', 'c1', 'Logo', 1000000), service('s9', 'c2', 'Web de Beto', 1000000), service('sx', 'c1', 'Viejo', 1000000, 'cancelled')];
  const ctx = { ...CTX, clients: data().clients, services };
  const err = (serviceId, extra = {}) => validateInvoice(input({ lines: [{ description: 'X', quantityText: '1', unitText: '100', serviceId, ...extra }] }), ctx).errors?.['line0.service'];
  assert.match(err('s9') ?? '', /no es del cliente/);
  assert.match(err('sx') ?? '', /cancelado/);
  assert.match(err('nada') ?? '', /ya no existe/);
  assert.match(err('s1', { productId: 'p1' }) ?? '', /producto o un servicio/);
  // Sin cliente en la factura, una línea no puede llevar servicio.
  const noClient = validateInvoice(input({ clientId: '', lines: [{ description: 'X', quantityText: '1', unitText: '100', serviceId: 's1' }] }), ctx);
  assert.match(noClient.errors?.['line0.service'] ?? '', /no es del cliente/);
});

test('Freelancer: un servicio no se factura por encima de lo que le queda (justo lo que queda, sí)', () => {
  const services = [service('s1', 'c1', 'Logo', 1000000)];
  const movements = [income('2026-10-01', 200000, { clientId: 'c1', serviceId: 's1' })];
  const invoices = [invoice('i1', 1, [line('Anticipo', 300000, 's1')])];
  const ctx = { ...CTX, clients: data().clients, services, movements, invoices };
  const at = (unitText) => validateInvoice(input({ lines: [{ description: 'Logo', quantityText: '1', unitText, serviceId: 's1' }] }), ctx);
  assert.equal(at('5000').ok, true, 'quedan 5,000: justo eso se puede');
  assert.match(at('5000.01').errors?.['line0.unit'] ?? '', /Pasa de lo que queda por facturar de «Logo» \(RD\$ 5,000\.00\)/);
  // Dos líneas del mismo servicio suman: juntas no pueden pasar.
  const two = validateInvoice(input({ lines: [{ description: 'A', quantityText: '1', unitText: '3000', serviceId: 's1' }, { description: 'B', quantityText: '1', unitText: '2500', serviceId: 's1' }] }), ctx);
  assert.match(two.errors?.['line0.unit'] ?? '', /Pasa de lo que queda/);
  // Si ya está todo facturado o cobrado, lo dice así.
  const full = validateInvoice(input(), { ...ctx, invoices: [invoice('i1', 1, [line('Todo', 800000, 's1')])] });
  assert.match(full.errors?.['line0.unit'] ?? '', /ya está facturado o cobrado por completo/);
});

test('Freelancer: al anular una factura, lo de su servicio vuelve a poder facturarse', () => {
  const services = [service('s1', 'c1', 'Logo', 1000000)];
  const ctx = { ...CTX, clients: data().clients, services, invoices: [invoice('i1', 1, [line('Logo', 1000000, 's1')], { voidedAt: NOW })] };
  assert.equal(validateInvoice(input({ lines: [{ description: 'Logo', quantityText: '1', unitText: '10000', serviceId: 's1' }] }), ctx).ok, true);
});

test('Emprendedor sigue igual: sin requireClient, una factura con cliente escrito a mano es válida y no lleva clientId', () => {
  const r = validateInvoice({ customerName: 'Hotel Sol', issueDate: '2026-11-01', lines: [{ description: 'Camisas', quantityText: '2', unitText: '500' }] }, CTX);
  assert.equal(r.ok, true);
  assert.equal('clientId' in r.value, false);
});

// ---- La regla de una sola fuente ------------------------------------------------------------------------------

/** Servicio de RD$ 10,000 en proceso; factura del 50 % (5,000 + 18 % = 5,900). */
function halfBilled() {
  return data({
    services: [service('s1', 'c1', 'Logo', 1000000)],
    invoices: [invoice('i1', 1, [line('Logo 50%', 500000, 's1')], { issueDate: '2026-10-01', dueDate: '2026-12-01' })],
  });
}

test('UNA SOLA FUENTE: servicio de 10,000 facturado al 50 %: 5,000 sin facturar + 5,900 de la factura = 10,900 (no 15,900)', () => {
  const d = halfBilled();
  const r = receivables(d, TODAY);
  assert.equal(r.servicesCents, 500000, 'el servicio solo cuenta lo que no se ha facturado');
  assert.equal(r.invoicesCents, 590000, 'la factura cuenta lo facturado, con impuesto');
  assert.equal(r.totalCents, 1090000);
  const ana = clientSummaries(d, { range: 'all', today: TODAY }).find((x) => x.client.id === 'c1');
  assert.equal(ana?.owedCents, 1090000, 'lo mismo por cliente');
  assert.equal(ana?.invoiceOwedCents, 590000);
  const sum = summarizeService(d.services[0], paidByService(d.movements, TODAY), billedByService(d.invoices));
  assert.deepEqual([sum.billedCents, sum.owedCents], [500000, 500000]);
});

test('UNA SOLA FUENTE: al cobrar la factura, el ingreso cuenta UNA vez en lo cobrado del cliente y baja lo por cobrar', () => {
  const d = halfBilled();
  const inv = d.invoices[0];
  const movement = buildPaymentMovement({ amountCents: 590000, date: '2026-10-20', categoryId: 'cat-inc-ventas', note: '' }, inv, { id: 'cat-inc-ventas', kind: 'income', defaultClassification: 'variable' }, { id: 'mov-cobro', time: '10:00', nowISO: NOW });
  assert.equal(movement.clientId, 'c1', 'el ingreso del cobro lleva el cliente');
  assert.equal('serviceId' in movement, false, 'y no el servicio (lo facturado ya lo cuenta la factura)');
  d.movements.push(movement);
  d.invoicePayments.push(payment('i1', 590000, 'mov-cobro'));
  const r = receivables(d, TODAY);
  assert.equal(r.invoicesCents, 0);
  assert.equal(r.totalCents, 500000, 'queda solo lo no facturado del servicio');
  const ana = clientSummaries(d, { range: 'all', today: TODAY }).find((x) => x.client.id === 'c1');
  assert.equal(ana?.incomeCents, 590000, 'cobrado una sola vez');
  assert.equal(ana?.payments, 1);
  const sum = summarizeService(d.services[0], paidByService(d.movements, TODAY), billedByService(d.invoices));
  assert.equal(sum.paidCents, 0, 'el cobro de la factura no se suma otra vez al servicio');
  assert.equal(sum.owedCents, 500000);
});

test('UNA SOLA FUENTE: un cobro parcial deja en la factura solo lo que falta', () => {
  const d = halfBilled();
  d.invoicePayments.push(payment('i1', 200000, 'mov-p'));
  d.movements.push(income('2026-10-20', 200000, { clientId: 'c1' }));
  assert.equal(receivables(d, TODAY).invoicesCents, 390000);
  assert.equal(receivables(d, TODAY).totalCents, 890000);
});

test('UNA SOLA FUENTE: al anular la factura, todo vuelve a contarse en el servicio (10,000)', () => {
  const d = halfBilled();
  d.invoices[0].voidedAt = NOW;
  const r = receivables(d, TODAY);
  assert.deepEqual([r.servicesCents, r.invoicesCents, r.totalCents], [1000000, 0, 1000000]);
});

test('UNA SOLA FUENTE: un servicio pendiente (sin empezar) no cuenta, pero su factura ya emitida sí', () => {
  const d = halfBilled();
  d.services[0].status = 'pending';
  const r = receivables(d, TODAY);
  assert.deepEqual([r.servicesCents, r.invoicesCents], [0, 590000]);
});

test('UNA SOLA FUENTE: lo cobrado directo + lo facturado nunca pasa del precio (el servicio queda en cero, no negativo)', () => {
  const d = halfBilled();
  d.movements.push(income('2026-10-05', 700000, { clientId: 'c1', serviceId: 's1' })); // cobró 7,000 directo además de facturar 5,000
  const sum = summarizeService(d.services[0], paidByService(d.movements, TODAY), billedByService(d.invoices));
  assert.equal(sum.owedCents, 0);
});

test('una factura sin cliente (restaurada de otra versión) cuenta en el total pero no en ningún cliente', () => {
  const d = data({ invoices: [invoice('i1', 1, [line('Algo', 100000)], { clientId: undefined })] });
  assert.equal(receivables(d, TODAY).invoicesCents, 118000);
  assert.ok(clientSummaries(d, { range: 'all', today: TODAY }).every((x) => x.owedCents === 0));
});

// ---- Recordatorios de cobro --------------------------------------------------------------------------------------

test('vencidas: solo las vencidas con saldo, de la más atrasada a la menos', () => {
  const d = data({
    invoices: [
      invoice('a', 1, [line('A', 100000)], { dueDate: '2026-10-20' }),
      invoice('b', 2, [line('B', 100000)], { dueDate: '2026-09-01' }),
      invoice('c', 3, [line('C', 100000)], { dueDate: '2026-12-01' }), // por vencer
      invoice('d', 4, [line('D', 100000)], { dueDate: '2026-09-01', voidedAt: NOW }), // anulada
    ],
  });
  assert.deepEqual(overdueInvoices(d, TODAY).map((p) => p.invoice.id), ['b', 'a']);
});

test('mensaje de recordatorio: número, fecha, vencimiento, saldo y lo recibido; cortés; no dice que la app lo envía', () => {
  const inv = invoice('i1', 7, [line('Logo', 500000)], { issueDate: '2026-09-15', dueDate: '2026-10-15' });
  const position = invoicePosition(inv, [payment('i1', 100000, 'm-x')], TODAY);
  const text = reminderMessage(position, { senderName: 'María Pérez' });
  assert.match(text, /^Hola, Ana\./);
  assert.match(text, /factura F-0007 del 15 sep 2026, que venció el 15 oct 2026/);
  assert.match(text, /saldo pendiente es de RD\$ 4,900\.00/);
  assert.match(text, /Ya recibí RD\$ 1,000\.00 de RD\$ 5,900\.00/);
  assert.match(text, /María Pérez$/);
  assert.doesNotMatch(text, /\bIA\b|autom[aá]tic|enviad[oa] por ACCONTROL/i);
  // Por vencer: «vence», no «venció»; sin cobros: no menciona lo recibido; sin firma: termina en el agradecimiento.
  const open = reminderMessage(invoicePosition({ ...inv, dueDate: '2026-12-01' }, [], TODAY));
  assert.match(open, /que vence el 1 dic 2026/);
  assert.doesNotMatch(open, /Ya recibí/);
  assert.match(open, /¡Gracias!$/);
});
