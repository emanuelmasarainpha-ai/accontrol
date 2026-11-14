// Facturas internas (dominio): numeración, totales, estados, cuentas por cobrar, validación, cobros y anulación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import {
  buildInvoice, buildInvoicePayment, buildPaymentMovement, customerSuggestions, formatTaxPercent, invoiceActivity, invoiceLabel, invoiceNotices,
  invoicePosition, invoiceReceivables, invoiceTotals, invoicesEnabled, lastCustomerDetails, nextInvoiceNumber, parseTaxPercent,
  paymentDescription, stockEntriesFromLines, validateInvoice, validateInvoiceEdit, validateInvoicePayment, voidProblem,
} from '../src/domain/invoices.js';

const NOW = '2026-11-15T10:00:00.000Z';
const TODAY = '2026-11-15';

/** @returns {any} */
const invoice = (over = {}) => ({
  id: 'i1', number: 1, customerName: 'Hotel Sol', customerTaxId: '', customerContact: '', issueDate: '2026-10-01', dueDate: '2026-10-31',
  lines: [{ description: 'Camisas', quantity: 10, unitCents: 50000 }], taxRateBp: 1800, notes: '', createdAt: NOW, updatedAt: NOW, ...over,
});
/** @returns {any} */
const payment = (invoiceId, amountPesos, date = '2026-10-10', id = `p-${invoiceId}-${date}-${amountPesos}`) => ({
  id, invoiceId, amountCents: amountPesos * 100, date, time: '10:00', note: '', movementId: `m-${id}`, createdAt: NOW, updatedAt: NOW,
});
const product = (/** @type {string} */ id, /** @type {any} */ over = {}) => ({
  id, name: id, sku: '', unit: 'unidad', priceCents: 0, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over,
});
let seq = 0;
const stock = (/** @type {string} */ productId, /** @type {number} */ quantity, /** @type {string} */ date, /** @type {any} */ over = {}) => ({
  id: `e${++seq}`, productId, kind: quantity > 0 ? 'purchase' : 'sale', quantity, unitCents: 10000, date, time: '09:00', note: '', createdAt: NOW, updatedAt: NOW, ...over,
});

// ---- Numeración -------------------------------------------------------------------------------------------------

test('el número se muestra como F-0001 y las facturas de demostración llevan su propia serie DEMO-001', () => {
  assert.equal(invoiceLabel({ number: 1 }), 'F-0001');
  assert.equal(invoiceLabel({ number: 128 }), 'F-0128');
  assert.equal(invoiceLabel({ number: 12345 }), 'F-12345');
  assert.equal(invoiceLabel({ number: 3, isDemo: true }), 'DEMO-003');
});

test('el consecutivo sigue al mayor de su serie; la demostración no ensucia la numeración real', () => {
  assert.equal(nextInvoiceNumber([]), 1);
  assert.equal(nextInvoiceNumber([{ number: 1 }, { number: 2 }]), 3);
  assert.equal(nextInvoiceNumber([{ number: 5 }, { number: 2 }]), 6, 'el mayor, no la cantidad');
  const mixed = [{ number: 1 }, { number: 2 }, { number: 1, isDemo: true }, { number: 9, isDemo: true }];
  assert.equal(nextInvoiceNumber(mixed), 3, 'real: ignora las de demostración');
  assert.equal(nextInvoiceNumber(mixed, true), 10, 'demostración: solo cuenta las suyas');
  assert.equal(nextInvoiceNumber([{ number: 4, isDemo: true }]), 1);
});

// ---- Totales --------------------------------------------------------------------------------------------------

test('totales: subtotal de las líneas, impuesto redondeado al centavo y total', () => {
  assert.deepEqual(invoiceTotals(invoice()), { subtotalCents: 500000, taxCents: 90000, totalCents: 590000 });
  assert.deepEqual(invoiceTotals(invoice({ taxRateBp: 0 })), { subtotalCents: 500000, taxCents: 0, totalCents: 500000 });
  const two = invoice({ lines: [{ description: 'a', quantity: 3, unitCents: 33333 }, { description: 'b', quantity: 1, unitCents: 1 }], taxRateBp: 1800 });
  // 99,999 + 1 = 100,000 centavos; 18 % = 18,000 exactos
  assert.deepEqual(invoiceTotals(two), { subtotalCents: 100000, taxCents: 18000, totalCents: 118000 });
});

test('el impuesto se redondea al centavo más cercano (mitades hacia arriba)', () => {
  assert.equal(invoiceTotals(invoice({ lines: [{ description: 'x', quantity: 1, unitCents: 99999 }], taxRateBp: 1800 })).taxCents, 18000, '17,999.82 → 18,000');
  assert.equal(invoiceTotals(invoice({ lines: [{ description: 'x', quantity: 1, unitCents: 1050 }], taxRateBp: 500 })).taxCents, 53, '52.5 → 53');
  assert.equal(invoiceTotals(invoice({ lines: [{ description: 'x', quantity: 1, unitCents: 1030 }], taxRateBp: 500 })).taxCents, 52, '51.5 → 52 (mitad hacia arriba)');
  assert.equal(invoiceTotals(invoice({ lines: [{ description: 'x', quantity: 1, unitCents: 1020 }], taxRateBp: 500 })).taxCents, 51, '51.0 exacto');
  assert.equal(invoiceTotals(invoice({ lines: [{ description: 'x', quantity: 1, unitCents: 250000 }], taxRateBp: 725 })).taxCents, 18125);
});

test('totales grandes no pierden precisión (sin desbordar)', () => {
  const big = invoice({ lines: [{ description: 'x', quantity: 1, unitCents: 99_999_999_999 }], taxRateBp: 10000 });
  assert.deepEqual(invoiceTotals(big), { subtotalCents: 99_999_999_999, taxCents: 99_999_999_999, totalCents: 199_999_999_998 });
});

test('porcentaje de impuesto: se lee sin decimales de coma flotante y se muestra limpio', () => {
  assert.equal(parseTaxPercent('18'), 1800);
  assert.equal(parseTaxPercent('18.5'), 1850);
  assert.equal(parseTaxPercent('18,5'), 1850);
  assert.equal(parseTaxPercent('7.25'), 725);
  assert.equal(parseTaxPercent('0'), 0);
  assert.equal(parseTaxPercent('100'), 10000);
  assert.equal(parseTaxPercent(' 5 '), 500);
  for (const bad of ['100.01', '101', '-1', '18%', 'abc', '1.234', '', '1000', '.5']) assert.equal(parseTaxPercent(bad), null, bad);
  assert.equal(formatTaxPercent(1800), '18');
  assert.equal(formatTaxPercent(1850), '18.5');
  assert.equal(formatTaxPercent(725), '7.25');
  assert.equal(formatTaxPercent(0), '0');
  assert.equal(formatTaxPercent(10000), '100');
  assert.equal(formatTaxPercent(1000), '10');
  assert.equal(formatTaxPercent(50), '0.5');
  for (const bp of [0, 1, 50, 725, 1000, 1800, 1850, 9999, 10000]) assert.equal(parseTaxPercent(formatTaxPercent(bp)), bp, String(bp));
});

// ---- Estado -----------------------------------------------------------------------------------------------------

test('estado: emitida, cobro parcial, vencida, cobrada y anulada', () => {
  const inv = invoice(); // total 5,900; vence 2026-10-31
  const at = (/** @type {any} */ i, /** @type {any[]} */ pays, /** @type {string} */ today) => invoicePosition(i, pays, today);
  assert.equal(at(inv, [], '2026-10-20').status, 'open');
  assert.equal(at(inv, [], '2026-10-31').status, 'open', 'el día del vencimiento todavía no está vencida');
  assert.equal(at(inv, [], '2026-11-01').status, 'overdue');
  assert.equal(at(inv, [payment('i1', 1000)], '2026-10-20').status, 'partial');
  assert.equal(at(inv, [payment('i1', 1000)], '2026-11-15').status, 'overdue', 'con cobro parcial pero vencida: vencida');
  assert.equal(at(inv, [payment('i1', 5900)], '2026-11-15').status, 'paid');
  assert.equal(at(inv, [payment('i1', 5900)], '2026-11-15').balanceCents, 0);
  assert.equal(at(invoice({ voidedAt: NOW }), [], '2026-11-15').status, 'void');
  assert.equal(at(invoice({ dueDate: '' }), [], '2030-01-01').status, 'open', 'sin vencimiento nunca vence');
});

test('posición: lo cobrado, lo que falta y los días de atraso', () => {
  const p = invoicePosition(invoice(), [payment('i1', 1000, '2026-10-05'), payment('i1', 500, '2026-10-02'), payment('otra', 9999)], '2026-11-15');
  assert.equal(p.totalCents, 590000);
  assert.equal(p.paidCents, 150000);
  assert.equal(p.balanceCents, 440000);
  assert.equal(p.daysOverdue, 15);
  assert.deepEqual(p.payments.map((x) => x.date), ['2026-10-02', '2026-10-05'], 'solo sus cobros, del más antiguo al más reciente');
  assert.equal(invoicePosition(invoice({ voidedAt: NOW }), [], TODAY).balanceCents, 0, 'una anulada no se cobra');
  assert.equal(invoicePosition(invoice(), [], '2026-10-10').daysOverdue, 0);
});

// ---- Cuentas por cobrar -------------------------------------------------------------------------------------------

test('cuentas por cobrar: total, vencido, tramos de atraso y quién debe más', () => {
  const data = {
    invoices: [
      invoice({ id: 'a', number: 1, customerName: 'Hotel Sol', issueDate: '2026-09-01', dueDate: '2026-09-16', lines: [{ description: 'x', quantity: 1, unitCents: 100000 }], taxRateBp: 0 }), // 60 días vencida
      invoice({ id: 'b', number: 2, customerName: 'hotel sol', issueDate: '2026-10-20', dueDate: '2026-11-05', lines: [{ description: 'x', quantity: 1, unitCents: 200000 }], taxRateBp: 0 }), // 10 días
      invoice({ id: 'c', number: 3, customerName: 'Colegio', issueDate: '2026-11-10', dueDate: '2026-12-10', lines: [{ description: 'x', quantity: 1, unitCents: 300000 }], taxRateBp: 0 }), // al día
      invoice({ id: 'd', number: 4, customerName: 'Gym', issueDate: '2026-08-01', dueDate: '2026-08-10', lines: [{ description: 'x', quantity: 1, unitCents: 50000 }], taxRateBp: 0 }), // 97 días
      invoice({ id: 'e', number: 5, customerName: 'Ferretería', issueDate: '2026-11-01', dueDate: '', lines: [{ description: 'x', quantity: 1, unitCents: 70000 }], taxRateBp: 0 }), // sin vencimiento
      invoice({ id: 'f', number: 6, customerName: 'Pagada', issueDate: '2026-10-01', dueDate: '2026-10-05', lines: [{ description: 'x', quantity: 1, unitCents: 10000 }], taxRateBp: 0 }),
      invoice({ id: 'g', number: 7, customerName: 'Anulada', issueDate: '2026-10-01', dueDate: '2026-10-05', voidedAt: NOW, lines: [{ description: 'x', quantity: 1, unitCents: 99999 }], taxRateBp: 0 }),
      invoice({ id: 'h', number: 8, customerName: 'Parcial', issueDate: '2026-10-20', dueDate: '2026-11-14', lines: [{ description: 'x', quantity: 1, unitCents: 100000 }], taxRateBp: 0 }), // 1 día
    ],
    invoicePayments: [payment('f', 100), payment('h', 400)],
  };
  const r = invoiceReceivables(data, TODAY);
  // días de atraso: a = 60, b = 10, d = 97, h = 1
  assert.equal(r.totalCents, 100000 + 200000 + 300000 + 50000 + 70000 + 60000);
  assert.equal(r.openCount, 6);
  assert.equal(r.overdueCount, 4);
  assert.equal(r.overdueCents, 100000 + 200000 + 50000 + 60000);
  assert.equal(r.oldestDaysOverdue, 97);
  assert.deepEqual(r.aging, { current: 300000 + 70000, d1to30: 200000 + 60000, d31to60: 100000, d61plus: 50000 });
  assert.equal(r.aging.current + r.aging.d1to30 + r.aging.d31to60 + r.aging.d61plus, r.totalCents, 'los tramos suman el total');
  assert.deepEqual(r.customers.map((c) => [c.customerName, c.balanceCents, c.overdueCents, c.invoices]), [
    ['Colegio', 300000, 0, 1],
    ['hotel sol', 300000, 300000, 2],
    ['Ferretería', 70000, 0, 1],
    ['Parcial', 60000, 60000, 1],
    ['Gym', 50000, 50000, 1],
  ], 'agrupa sin importar mayúsculas (se muestra como lo escribieron en la factura más reciente) y ordena por lo que deben (empate: alfabético)');
});

test('cuentas por cobrar vacías o todo cobrado: ceros, sin inventar nada', () => {
  const r = invoiceReceivables({ invoices: [], invoicePayments: [] }, TODAY);
  assert.deepEqual([r.totalCents, r.openCount, r.overdueCents, r.overdueCount, r.oldestDaysOverdue, r.customers.length], [0, 0, 0, 0, 0, 0]);
  const paid = invoiceReceivables({ invoices: [invoice({ taxRateBp: 0 })], invoicePayments: [payment('i1', 5000)] }, TODAY);
  assert.equal(paid.totalCents, 0);
});

test('actividad: lo facturado (sin anuladas) y lo cobrado en un rango', () => {
  const data = {
    invoices: [
      invoice({ id: 'a', issueDate: '2026-11-02', taxRateBp: 0, lines: [{ description: 'x', quantity: 1, unitCents: 100000 }] }),
      invoice({ id: 'b', number: 2, issueDate: '2026-11-10', taxRateBp: 1800, lines: [{ description: 'x', quantity: 1, unitCents: 100000 }] }),
      invoice({ id: 'c', number: 3, issueDate: '2026-10-30', taxRateBp: 0, lines: [{ description: 'x', quantity: 1, unitCents: 999 }] }),
      invoice({ id: 'd', number: 4, issueDate: '2026-11-03', voidedAt: NOW, taxRateBp: 0, lines: [{ description: 'x', quantity: 1, unitCents: 7777 }] }),
    ],
    invoicePayments: [payment('a', 400, '2026-11-05'), payment('b', 200, '2026-12-01'), payment('c', 5, '2026-11-20')],
  };
  const a = invoiceActivity(data, '2026-11-01', '2026-11-30');
  assert.deepEqual(a, { billedCount: 2, billedCents: 100000 + 118000, collectedCents: 40000 + 500 });
  assert.deepEqual(invoiceActivity(data, '2026-11-02', '2026-11-02'), { billedCount: 1, billedCents: 100000, collectedCents: 0 }, 'extremos incluidos');
  assert.deepEqual(invoiceActivity({ invoices: [], invoicePayments: [] }, '2026-11-01', '2026-11-30'), { billedCount: 0, billedCents: 0, collectedCents: 0 });
});

test('sugerencias de clientes: sin repetir, lo más reciente primero, y sus últimos datos', () => {
  const list = [
    invoice({ id: 'a', number: 1, customerName: 'Hotel Sol', customerTaxId: '1', customerContact: 'a@a.com', issueDate: '2026-08-01' }),
    invoice({ id: 'b', number: 2, customerName: 'Colegio', issueDate: '2026-09-01' }),
    invoice({ id: 'c', number: 3, customerName: 'hotel sol', customerTaxId: '2', customerContact: '809-555-0100', issueDate: '2026-10-01' }),
  ];
  assert.deepEqual(customerSuggestions(list), ['hotel sol', 'Colegio']);
  assert.deepEqual(lastCustomerDetails(list, 'HOTEL SOL'), { customerTaxId: '2', customerContact: '809-555-0100' });
  assert.equal(lastCustomerDetails(list, 'Nadie'), null);
  assert.deepEqual(customerSuggestions([]), []);
});

test('invoicesEnabled: Freelancer (0.14.5), Emprendedor y Empresa siempre; Personal, solo si ya hay facturas', () => {
  assert.equal(invoicesEnabled('entrepreneur', { invoices: [] }), true);
  assert.equal(invoicesEnabled('company', { invoices: [] }), true);
  assert.equal(invoicesEnabled('personal', { invoices: [] }), false);
  assert.equal(invoicesEnabled('freelancer', { invoices: [] }), true);
  assert.equal(invoicesEnabled('personal', { invoices: [invoice()] }), true);
  assert.equal(invoicesEnabled(null, { invoices: [] }), false);
});

// ---- Emitir -----------------------------------------------------------------------------------------------------

/** @returns {any} */
const lineIn = (over = {}) => ({ description: 'Camisas', productId: '', quantityText: '2', unitText: '500', ...over });
/** @returns {any} */
const input = (over = {}) => ({
  customerName: 'Hotel Sol', customerTaxId: '', customerContact: '', issueDate: '2026-11-10', dueDate: '2026-11-25', taxText: '18', notes: '', lines: [lineIn()], ...over,
});
const ctx = (over = {}) => ({ products: [], entries: [], today: TODAY, time: '10:30', nowISO: NOW, ...over });

test('una factura válida: se limpian los textos y se calcula todo', () => {
  const r = validateInvoice(input({ customerName: '  Hotel   Sol ', customerTaxId: ' 101-00000-0 ', customerContact: 'compras@hotel.test', notes: ' pago a 15 días ', lines: [lineIn({ description: ' Camisas  azules ', quantityText: '3', unitText: '1,250.50' })] }), ctx());
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value, {
    customerName: 'Hotel Sol', customerTaxId: '101-00000-0', customerContact: 'compras@hotel.test', issueDate: '2026-11-10', dueDate: '2026-11-25', taxRateBp: 1800,
    notes: 'pago a 15 días', lines: [{ description: 'Camisas azules', quantity: 3, unitCents: 125050 }],
  });
});

test('el impuesto, el vencimiento, el RNC, el contacto y las notas son opcionales', () => {
  const r = validateInvoice(input({ taxText: '', dueDate: '', customerTaxId: undefined, customerContact: undefined, notes: undefined }), ctx());
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.taxRateBp, 0);
  assert.equal(r.value.dueDate, '');
  assert.equal(r.value.customerContact, '');
});

test('errores de la cabecera de la factura', () => {
  const bad = (/** @type {any} */ over, /** @type {string} */ field, /** @type {RegExp} */ pattern, /** @type {any} */ extra = {}) => {
    const r = validateInvoice(input(over), ctx(extra));
    assert.ok(!r.ok, JSON.stringify(over));
    assert.match(r.errors[field] ?? '(sin error)', pattern, JSON.stringify(over));
  };
  bad({ customerName: '  ' }, 'customerName', /nombre del cliente/);
  bad({ customerName: 'x'.repeat(81) }, 'customerName', /Máximo 80/);
  bad({ customerTaxId: 'x'.repeat(21) }, 'customerTaxId', /Máximo 20/);
  bad({ customerContact: 'no es nada' }, 'customerContact', /correo o un teléfono/);
  bad({ customerContact: 'x'.repeat(121) }, 'customerContact', /Máximo 120/);
  bad({ notes: 'x'.repeat(301) }, 'notes', /Máximo 300/);
  bad({ issueDate: '' }, 'issueDate', /fecha válida/);
  bad({ issueDate: '2026-02-30' }, 'issueDate', /fecha válida/);
  bad({ issueDate: '2026-11-16' }, 'issueDate', /futura/);
  bad({ issueDate: '1999-12-31' }, 'issueDate', /fuera de rango/);
  bad({ dueDate: '2026-11-09' }, 'dueDate', /anterior/);
  bad({ dueDate: 'mañana' }, 'dueDate', /válida/);
  bad({ dueDate: '2040-01-01' }, 'dueDate', /lejos/);
  bad({ taxText: '101' }, 'tax', /0 a 100/);
  bad({ taxText: 'abc' }, 'tax', /0 a 100/);
  bad({ taxText: '-5' }, 'tax', /0 a 100/);
});

test('el vencimiento puede ser el mismo día de la factura y tiene un máximo de 10 años', () => {
  assert.ok(validateInvoice(input({ dueDate: '2026-11-10' }), ctx()).ok);
  assert.ok(validateInvoice(input({ dueDate: '2036-11-07' }), ctx()).ok, '3,650 días después del 2026-11-10');
  assert.ok(!validateInvoice(input({ dueDate: '2036-11-08' }), ctx()).ok);
  assert.ok(validateInvoice(input({ issueDate: TODAY }), ctx()).ok, 'hoy es válido');
});

test('errores de las líneas: cada una dice cuál campo está mal', () => {
  const r = validateInvoice(input({
    lines: [
      lineIn(),
      lineIn({ description: '', quantityText: '0', unitText: '' }),
      lineIn({ quantityText: '1.5', unitText: 'abc' }),
      lineIn({ quantityText: '-2', unitText: '0' }),
      lineIn({ description: 'x'.repeat(81), quantityText: '1000001', unitText: '10' }),
    ],
  }), ctx());
  assert.ok(!r.ok);
  assert.equal(r.errors.line0, undefined);
  assert.match(r.errors['line1.description'], /Describe/);
  assert.match(r.errors['line1.quantity'], /al menos 1/);
  assert.match(r.errors['line1.unit'], /precio/);
  assert.match(r.errors['line2.quantity'], /número entero/);
  assert.match(r.errors['line2.unit'], /solo números/i);
  assert.match(r.errors['line3.quantity'], /número entero/);
  assert.match(r.errors['line3.unit'], /mayor que cero/);
  assert.match(r.errors['line4.description'], /Máximo 80/);
  assert.match(r.errors['line4.quantity'], /Máximo 1,000,000/);
});

test('una factura sin líneas o con demasiadas no se puede emitir', () => {
  const none = validateInvoice(input({ lines: [] }), ctx());
  assert.ok(!none.ok);
  assert.match(none.errors.lines, /al menos una línea/);
  const many = validateInvoice(input({ lines: Array.from({ length: 31 }, () => lineIn()) }), ctx());
  assert.ok(!many.ok);
  assert.match(many.errors.lines, /hasta 30 líneas/);
  assert.ok(validateInvoice(input({ lines: Array.from({ length: 30 }, () => lineIn()) }), ctx()).ok, '30 líneas sí');
});

test('los montos enormes se rechazan: por línea y por el total con impuesto', () => {
  const line = validateInvoice(input({ lines: [lineIn({ quantityText: '2', unitText: '999,999,999.99' })] }), ctx());
  assert.ok(!line.ok);
  assert.match(line.errors['line0.unit'], /demasiado grande/);
  const total = validateInvoice(input({ taxText: '100', lines: [lineIn({ quantityText: '1', unitText: '999,999,999.99' })] }), ctx());
  assert.ok(!total.ok);
  assert.match(total.errors.lines, /demasiado grande/);
  assert.ok(validateInvoice(input({ taxText: '0', lines: [lineIn({ quantityText: '1', unitText: '999,999,999.99' })] }), ctx()).ok, 'justo en el límite sin impuesto');
});

test('una línea con producto: debe existir y no estar archivado', () => {
  const missing = validateInvoice(input({ lines: [lineIn({ productId: 'nada' })] }), ctx());
  assert.ok(!missing.ok);
  assert.match(missing.errors['line0.product'], /ya no existe/);
  const archived = validateInvoice(input({ lines: [lineIn({ productId: 'p1' })] }), ctx({ products: [product('p1', { archived: true })], entries: [stock('p1', 50, '2026-11-01')] }));
  assert.ok(!archived.ok);
  assert.match(archived.errors['line0.product'], /archivado/);
});

test('regla de oro: la factura no puede sacar más unidades de las que hay', () => {
  const p = [product('p1', { name: 'Camisa' })];
  const ok = validateInvoice(input({ lines: [lineIn({ productId: 'p1', quantityText: '5' })] }), ctx({ products: p, entries: [stock('p1', 5, '2026-11-01')] }));
  assert.ok(ok.ok, JSON.stringify(ok));
  const over = validateInvoice(input({ lines: [lineIn({ productId: 'p1', quantityText: '6' })] }), ctx({ products: p, entries: [stock('p1', 5, '2026-11-01')] }));
  assert.ok(!over.ok);
  assert.match(over.errors['line0.quantity'], /No alcanza el stock de «Camisa»: el 10 nov 2026 solo hay 5 unidades/);
});

test('dos líneas del mismo producto suman: juntas no pueden pasar del stock', () => {
  const p = [product('p1', { name: 'Camisa' })];
  const r = validateInvoice(input({ lines: [lineIn({ productId: 'p1', quantityText: '3' }), lineIn({ productId: 'p1', quantityText: '3' })] }), ctx({ products: p, entries: [stock('p1', 5, '2026-11-01')] }));
  assert.ok(!r.ok);
  assert.ok(r.errors['line0.quantity'] || r.errors['line1.quantity'], 'marca alguna de las dos líneas');
  assert.ok(validateInvoice(input({ lines: [lineIn({ productId: 'p1', quantityText: '2' }), lineIn({ productId: 'p1', quantityText: '3' })] }), ctx({ products: p, entries: [stock('p1', 5, '2026-11-01')] })).ok, '2 + 3 = 5 sí alcanza');
});

test('una línea sin producto no toca el inventario aunque haya productos', () => {
  const p = [product('p1', { name: 'Camisa' })];
  assert.ok(validateInvoice(input({ lines: [lineIn({ productId: '', quantityText: '999' })] }), ctx({ products: p, entries: [] })).ok);
});

test('la fecha de la factura cuenta para el stock: una factura con fecha pasada no puede dejar un negativo después', () => {
  const p = [product('p1', { name: 'Camisa' })];
  // Compra de 5 el 1 nov; ya se vendieron 4 el 8 nov. Una factura del 5 nov de 3 dejaría el 8 nov en -2.
  const entries = [stock('p1', 5, '2026-11-01'), stock('p1', -4, '2026-11-08')];
  const r = validateInvoice(input({ issueDate: '2026-11-05', lines: [lineIn({ productId: 'p1', quantityText: '3' })] }), ctx({ products: p, entries }));
  assert.ok(!r.ok);
  assert.match(r.errors.issueDate, /Con esa fecha, el stock de «Camisa» quedaría en negativo el 8 nov 2026/);
  assert.ok(validateInvoice(input({ issueDate: '2026-11-05', lines: [lineIn({ productId: 'p1', quantityText: '1' })] }), ctx({ products: p, entries })).ok, '1 sí alcanza');
});

test('las salidas de stock de una factura: una por línea con producto, con su fecha, precio y sin dinero', () => {
  const lines = [
    { description: 'Camisas', quantity: 2, unitCents: 50000, productId: 'p1' },
    { description: 'Servicio', quantity: 1, unitCents: 10000 },
    { description: 'Gorras', quantity: 4, unitCents: 30000, productId: 'p2' },
  ];
  const entries = stockEntriesFromLines(lines, { invoiceId: 'inv9', ids: ['x0', 'x1', 'x2'], issueDate: '2026-11-10', time: '10:30', nowISO: NOW, label: 'Factura F-0009' });
  assert.deepEqual(entries, [
    { id: 'x0', productId: 'p1', kind: 'sale', quantity: -2, unitCents: 50000, date: '2026-11-10', time: '10:30', invoiceId: 'inv9', note: 'Factura F-0009', createdAt: NOW, updatedAt: NOW },
    { id: 'x2', productId: 'p2', kind: 'sale', quantity: -4, unitCents: 30000, date: '2026-11-10', time: '10:30', invoiceId: 'inv9', note: 'Factura F-0009', createdAt: NOW, updatedAt: NOW },
  ]);
  assert.ok(entries.every((e) => e.movementId === undefined), 'no llevan dinero: entra al cobrar');
  assert.ok(stockEntriesFromLines(lines, { invoiceId: 'i', ids: ['a', 'b', 'c'], issueDate: '2026-11-10', time: '10:30', nowISO: NOW, label: '', isDemo: true }).every((e) => e.isDemo === true));
});

test('buildInvoice conserva todo y marca la demostración', () => {
  const v = /** @type {any} */ (validateInvoice(input(), ctx())).value;
  const made = buildInvoice(v, { id: 'z', number: 7, nowISO: NOW });
  assert.equal(made.id, 'z');
  assert.equal(made.number, 7);
  assert.equal(made.isDemo, undefined);
  assert.equal(made.voidedAt, undefined);
  assert.equal(buildInvoice(v, { id: 'z', number: 1, nowISO: NOW, isDemo: true }).isDemo, true);
});

// ---- Editar y anular --------------------------------------------------------------------------------------------

test('editar: cliente, vencimiento y notas; no se toca el dinero ni se edita una anulada', () => {
  const ok = validateInvoiceEdit({ customerName: ' Nuevo  Cliente ', customerTaxId: '1', customerContact: '809-555-0101', dueDate: '2026-12-01', notes: 'ok' }, invoice());
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.deepEqual(ok.value, { customerName: 'Nuevo Cliente', customerTaxId: '1', customerContact: '809-555-0101', dueDate: '2026-12-01', notes: 'ok' });
  const cleared = validateInvoiceEdit({ customerName: 'X', dueDate: '' }, invoice());
  assert.ok(cleared.ok);
  assert.equal(cleared.value.dueDate, '');
  const early = validateInvoiceEdit({ customerName: 'X', dueDate: '2026-09-30' }, invoice());
  assert.ok(!early.ok);
  assert.match(early.errors.dueDate, /anterior/);
  const noName = validateInvoiceEdit({ customerName: ' ' }, invoice());
  assert.ok(!noName.ok);
  assert.match(noName.errors.customerName, /nombre/);
  const voided = validateInvoiceEdit({ customerName: 'X' }, invoice({ voidedAt: NOW }));
  assert.ok(!voided.ok);
  assert.match(voided.errors.form, /anulada/);
});

test('anular: no si ya está anulada ni si tiene cobros', () => {
  assert.equal(voidProblem(invoice(), []), null);
  assert.equal(voidProblem(invoice(), [payment('otra', 5)]), null, 'los cobros de otras facturas no cuentan');
  assert.match(String(voidProblem(invoice({ voidedAt: NOW }), [])), /ya está anulada/);
  assert.match(String(voidProblem(invoice(), [payment('i1', 5)])), /un cobro registrado/);
  assert.match(String(voidProblem(invoice(), [payment('i1', 5), payment('i1', 6, '2026-10-11')])), /2 cobros registrados/);
});

// ---- Cobros -------------------------------------------------------------------------------------------------------

const cats = defaultCategories();
const payCtx = (/** @type {any} */ over = {}) => ({ invoice: invoice(), payments: [], categories: cats, today: TODAY, ...over });
const payIn = (/** @type {any} */ over = {}) => ({ amountText: '1000', date: '2026-10-10', categoryId: 'cat-inc-ventas', note: '', ...over });

test('un cobro válido, hasta lo que falta', () => {
  const r = validateInvoicePayment(payIn(), payCtx());
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value, { amountCents: 100000, date: '2026-10-10', categoryId: 'cat-inc-ventas', note: '' });
  assert.ok(validateInvoicePayment(payIn({ amountText: '5,900' }), payCtx()).ok, 'el total justo');
  assert.ok(validateInvoicePayment(payIn({ amountText: '5,899.99' }), payCtx()).ok);
  const over = validateInvoicePayment(payIn({ amountText: '5,900.01' }), payCtx());
  assert.ok(!over.ok);
  assert.match(over.errors.amount, /Solo faltan RD\$ 5,900\.00 por cobrar/);
});

test('los cobros anteriores restan de lo que falta', () => {
  const r = validateInvoicePayment(payIn({ amountText: '1000.01' }), payCtx({ payments: [payment('i1', 4900)] }));
  assert.ok(!r.ok);
  assert.match(r.errors.amount, /Solo faltan RD\$ 1,000\.00/);
  assert.ok(validateInvoicePayment(payIn({ amountText: '1000' }), payCtx({ payments: [payment('i1', 4900)] })).ok);
  assert.ok(validateInvoicePayment(payIn({ amountText: '5900' }), payCtx({ payments: [payment('otra', 4900)] })).ok, 'cobros de otra factura no cuentan');
});

test('errores de un cobro', () => {
  const bad = (/** @type {any} */ over, /** @type {string} */ field, /** @type {RegExp} */ pattern, /** @type {any} */ extra = {}) => {
    const r = validateInvoicePayment(payIn(over), payCtx(extra));
    assert.ok(!r.ok, JSON.stringify(over));
    assert.match(r.errors[field] ?? '(sin error)', pattern, JSON.stringify(over));
  };
  bad({ amountText: '' }, 'amount', /cuánto/);
  bad({ amountText: 'abc' }, 'amount', /solo números/i);
  bad({ amountText: '0' }, 'amount', /mayor que cero/);
  bad({ amountText: '-5' }, 'amount', /signo negativo/);
  bad({ date: '' }, 'date', /fecha válida/);
  bad({ date: '2026-11-16' }, 'date', /futura/);
  bad({ date: '2026-09-30' }, 'date', /anterior a la fecha de la factura/);
  bad({ categoryId: '' }, 'category', /Elige/);
  bad({ categoryId: 'cat-exp-otros' }, 'category', /ingresos/);
  bad({ note: 'x'.repeat(121) }, 'note', /Máximo 120/);
  bad({}, 'form', /anulada/, { invoice: invoice({ voidedAt: NOW }) });
  bad({}, 'form', /cobrada por completo/, { payments: [payment('i1', 5900)] });
});

test('el cobro puede ser el mismo día de la factura y el de hoy', () => {
  assert.ok(validateInvoicePayment(payIn({ date: '2026-10-01' }), payCtx()).ok);
  assert.ok(validateInvoicePayment(payIn({ date: TODAY }), payCtx()).ok);
});

test('el ingreso de un cobro: descripción, categoría y clasificación', () => {
  const inv = invoice({ number: 12 });
  const category = cats.find((c) => c.id === 'cat-inc-ventas');
  assert.ok(category);
  const value = { amountCents: 100000, date: '2026-10-10', categoryId: category.id, note: '' };
  const m = buildPaymentMovement(value, inv, category, { id: 'm1', time: '11:00', nowISO: NOW });
  assert.deepEqual(m, {
    id: 'm1', type: 'income', amountCents: 100000, date: '2026-10-10', time: '11:00', description: 'Cobro F-0012: Hotel Sol',
    classification: category.defaultClassification, categoryId: category.id, createdAt: NOW, updatedAt: NOW,
  });
  assert.equal(buildPaymentMovement(value, { ...inv, isDemo: true }, category, { id: 'm2', time: '11:00', nowISO: NOW, isDemo: true }).isDemo, true);
  assert.equal(paymentDescription({ ...inv, customerName: 'x'.repeat(80) }).length, 80, 'cabe en el límite de la descripción');
  assert.match(paymentDescription({ ...inv, customerName: 'x'.repeat(80) }), /…$/);
  assert.equal(paymentDescription({ ...inv, isDemo: true, number: 2 }), 'Cobro DEMO-002: Hotel Sol');
  const p = buildInvoicePayment(value, { id: 'p1', invoiceId: 'i1', time: '11:00', nowISO: NOW, movementId: 'm1' });
  assert.deepEqual(p, { id: 'p1', invoiceId: 'i1', amountCents: 100000, date: '2026-10-10', time: '11:00', note: '', movementId: 'm1', createdAt: NOW, updatedAt: NOW });
});

test('la clasificación del ingreso sale de la categoría si es válida para ingresos', () => {
  const odd = /** @type {any} */ ({ id: 'c', name: 'x', kind: 'income', defaultClassification: 'discretionary', builtIn: false });
  const m = buildPaymentMovement({ amountCents: 1, date: '2026-10-10', categoryId: 'c', note: '' }, invoice(), odd, { id: 'm', time: '10:00', nowISO: NOW });
  assert.equal(m.classification, 'variable', 'discrecional no existe en ingresos');
  const fixed = /** @type {any} */ ({ id: 'c', name: 'x', kind: 'income', defaultClassification: 'fixed', builtIn: false });
  assert.equal(buildPaymentMovement({ amountCents: 1, date: '2026-10-10', categoryId: 'c', note: '' }, invoice(), fixed, { id: 'm', time: '10:00', nowISO: NOW }).classification, 'fixed');
});

// ---- Avisos ---------------------------------------------------------------------------------------------------------

test('aviso de facturas vencidas: sin vencidas no hay aviso; rojo solo si pasan de 30 días', () => {
  const mk = (/** @type {string} */ due, /** @type {any} */ over = {}) => ({
    invoices: [invoice({ dueDate: due, taxRateBp: 0, lines: [{ description: 'x', quantity: 1, unitCents: 250000 }], ...over })],
    invoicePayments: [], departments: [],
  });
  assert.deepEqual(invoiceNotices(mk('2026-11-30'), TODAY), []);
  assert.deepEqual(invoiceNotices(mk(''), TODAY), []);
  assert.deepEqual(invoiceNotices({ invoices: [], invoicePayments: [] }, TODAY), []);
  const soft = invoiceNotices(mk('2026-11-05'), TODAY);
  assert.equal(soft.length, 1);
  assert.equal(soft[0].level, 'info');
  assert.equal(soft[0].id, 'invoices-overdue');
  assert.match(soft[0].text, /Tienes una factura vencida por RD\$ 2,500\.00 \(la más atrasada, 10 días\)\. Mira «Facturas»\./);
  assert.equal(invoiceNotices(mk('2026-10-16'), TODAY)[0].level, 'info', '30 días justos todavía no es rojo');
  assert.equal(invoiceNotices(mk('2026-10-15'), TODAY)[0].level, 'critical', '31 días: rojo');
  const two = { invoices: [...mk('2026-11-05').invoices, invoice({ id: 'i2', number: 2, dueDate: '2026-11-14', taxRateBp: 0, lines: [{ description: 'x', quantity: 1, unitCents: 100000 }] })], invoicePayments: [] };
  assert.match(invoiceNotices(two, TODAY)[0].text, /Tienes 2 facturas vencidas por RD\$ 3,500\.00 \(la más atrasada, 10 días\)/);
  assert.match(invoiceNotices(mk('2026-11-14'), TODAY)[0].text, /1 día\)/, 'singular');
});
