// Respaldo de las facturas internas (versión 7 del formato): ida y vuelta, copias antiguas y archivos manipulados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, createFullBackup, parseAnyBackup, parseBackup } from '../src/domain/backup.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo, buildInventoryDemo, buildInvoiceDemo } from '../src/domain/demo.js';
import { buildInvoice, buildInvoicePayment, buildPaymentMovement, stockEntriesFromLines } from '../src/domain/invoices.js';

const today = '2026-07-20';
const nowISO = '2026-07-20T12:00:00.000Z';

/**
 * Un negocio con inventario y tres facturas reales: la A vende 2 camisas del inventario y tiene un cobro parcial; la B es de texto
 * libre y está vencida; la C está anulada. Además, la demostración de facturas (con su propia numeración).
 */
function invoiceData() {
  const inv = buildInventoryDemo(today, nowISO);
  const demo = buildInvoiceDemo(today, nowISO);
  const shirt = inv.products[0];
  const mk = (/** @type {any} */ over, /** @type {any[]} */ lines) => buildInvoice({
    customerName: 'Hotel Sol', customerTaxId: '', customerContact: '', issueDate: '2026-07-18', dueDate: '2026-08-01', taxRateBp: 1800, notes: '', lines, ...over,
  }, { id: over.id, number: over.number, nowISO });
  const a = mk({ id: 'inv-a', number: 1 }, [{ description: 'Camisas', quantity: 2, unitCents: 120000, productId: shirt.id }, { description: 'Bordado', quantity: 1, unitCents: 50000 }]);
  const b = mk({ id: 'inv-b', number: 2, issueDate: '2026-06-01', dueDate: '2026-06-15', customerName: 'Colegio', customerContact: '809-555-0101' }, [{ description: 'Servicio', quantity: 3, unitCents: 10000 }]);
  const c = { ...mk({ id: 'inv-c', number: 3 }, [{ description: 'Cancelada', quantity: 1, unitCents: 5000, productId: shirt.id }]), voidedAt: '2026-07-19T10:00:00.000Z' };
  const entries = stockEntriesFromLines(a.lines, { invoiceId: a.id, ids: ['se-a0', 'se-a1'], issueDate: a.issueDate, time: '10:00', nowISO, label: 'Factura F-0001' });
  const category = /** @type {any} */ ({ id: 'cat-inc-ventas', defaultClassification: 'variable' });
  const value = { amountCents: 100000, date: '2026-07-19', categoryId: category.id, note: '' };
  const movement = buildPaymentMovement(value, a, category, { id: 'mv-pay-a', time: '09:00', nowISO });
  const payment = buildInvoicePayment(value, { id: 'pay-a', invoiceId: a.id, time: '09:00', nowISO, movementId: movement.id });
  return {
    categories: defaultCategories(),
    movements: [...buildBusinessDemo(today, nowISO), ...inv.movements, ...demo.movements, movement],
    goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [],
    products: inv.products, suppliers: inv.suppliers, stockEntries: [...inv.stockEntries, ...entries],
    invoices: [...demo.invoices, a, b, c], invoicePayments: [...demo.invoicePayments, payment], departments: [],
    settings: { displayName: 'Ana', openingBalanceCents: 0 },
  };
}
/** @param {(b: any) => void} change */
function corrupt(change) {
  const backup = JSON.parse(JSON.stringify(createBackup(invoiceData(), nowISO)));
  change(backup);
  return parseBackup(JSON.stringify(backup), { today });
}
const rejects = (/** @type {(b: any) => void} */ change, /** @type {RegExp} */ message) => {
  const r = corrupt(change);
  assert.ok(!r.ok, 'debía rechazarse');
  if (!r.ok) assert.match(r.error, message);
};
const accepts = (/** @type {(b: any) => void} */ change) => {
  const r = corrupt(change);
  assert.ok(r.ok, r.ok ? '' : r.error);
};
const inv = (/** @type {any} */ b, /** @type {string} */ id) => b.data.invoices.find((/** @type {any} */ i) => i.id === id);

test('el fixture es válido: la copia intacta se acepta', () => {
  accepts(() => {});
});

test('facturas, cobros y salidas de stock de facturas se exportan e importan tal cual', () => {
  const data = invoiceData();
  assert.equal(data.invoices.length, 8);
  assert.ok(data.stockEntries.some((e) => e.invoiceId));
  const r = parseBackup(JSON.stringify(createBackup(data, nowISO)), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) {
    assert.deepEqual(r.data.invoices, data.invoices);
    assert.deepEqual(r.data.invoicePayments, data.invoicePayments);
    assert.deepEqual(r.data, data);
  }
});

test('la copia completa también las conserva', () => {
  const data = invoiceData();
  const workspace = {
    id: 'w1', kind: /** @type {const} */ ('entrepreneur'), name: 'Mi tienda', currency: /** @type {const} */ ('DOP'), openingBalanceCents: 0, isDefault: true,
    createdAt: nowISO, updatedAt: nowISO,
  };
  const full = createFullBackup({ profile: { displayName: 'Ana', lastWorkspaceId: 'w1' }, workspaces: [{ workspace, data }] }, nowISO);
  const r = parseAnyBackup(JSON.stringify(full), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok && r.kind === 'full') {
    assert.deepEqual(r.workspaces[0].data.invoices, data.invoices);
    assert.deepEqual(r.workspaces[0].data.invoicePayments, data.invoicePayments);
  } else assert.fail('debía ser una copia completa');
});

test('un respaldo anterior (versión 6, sin facturas) se importa con las listas vacías', () => {
  const old = JSON.parse(JSON.stringify(createBackup({ ...invoiceData(), movements: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [] }, nowISO)));
  old.schemaVersion = 6;
  delete old.data.invoices; delete old.data.invoicePayments;
  const r = parseBackup(JSON.stringify(old), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual([r.data.invoices, r.data.invoicePayments], [[], []]);
});

test('un respaldo de una versión más nueva se rechaza', () => {
  assert.ok(!corrupt((b) => { b.schemaVersion = 9; }).ok);
});

test('las secciones de facturas deben ser listas', () => {
  for (const key of ['invoices', 'invoicePayments']) rejects((b) => { b.data[key] = 'no'; }, new RegExp(`«${key}»`));
});

test('rechaza facturas mal formadas', () => {
  rejects((b) => { inv(b, 'inv-a').number = 0; }, /Factura #\d+: número no válido/);
  rejects((b) => { inv(b, 'inv-a').number = 1.5; }, /número no válido/);
  rejects((b) => { inv(b, 'inv-b').number = 1; }, /el número 1 está repetido/);
  rejects((b) => { b.data.invoices[1].id = b.data.invoices[0].id; }, /id repetido|repetido/);
  rejects((b) => { inv(b, 'inv-a').customerName = ''; }, /cliente/);
  rejects((b) => { inv(b, 'inv-a').customerName = 'x'.repeat(81); }, /cliente/);
  rejects((b) => { inv(b, 'inv-a').customerContact = 'esto no es un contacto'; }, /contacto del cliente/);
  rejects((b) => { inv(b, 'inv-a').issueDate = '2026-07-21'; }, /fecha futura/);
  rejects((b) => { inv(b, 'inv-a').issueDate = '2026-02-30'; }, /fecha no válida/);
  rejects((b) => { inv(b, 'inv-a').issueDate = '1999-01-01'; }, /fecha no válida/);
  rejects((b) => { inv(b, 'inv-a').dueDate = '2026-07-17'; }, /vencimiento no válido/);
  rejects((b) => { inv(b, 'inv-a').dueDate = 'pronto'; }, /vencimiento no válido/);
  rejects((b) => { inv(b, 'inv-a').taxRateBp = 10001; }, /impuesto no válido/);
  rejects((b) => { inv(b, 'inv-a').taxRateBp = -1; }, /impuesto no válido/);
  rejects((b) => { inv(b, 'inv-a').taxRateBp = 18.5; }, /impuesto no válido/);
  rejects((b) => { inv(b, 'inv-a').notes = 'x'.repeat(301); }, /notas/);
  rejects((b) => { inv(b, 'inv-c').voidedAt = 'ayer'; }, /anulación/);
  rejects((b) => { inv(b, 'inv-a').lines = []; }, /líneas no son válidas/);
  rejects((b) => { inv(b, 'inv-a').lines = Array.from({ length: 31 }, () => ({ description: 'x', quantity: 1, unitCents: 1 })); }, /líneas no son válidas/);
  rejects((b) => { inv(b, 'inv-b').lines[0].quantity = 0; }, /línea 1: cantidad/);
  rejects((b) => { inv(b, 'inv-b').lines[0].quantity = 2.5; }, /línea 1: cantidad/);
  rejects((b) => { inv(b, 'inv-b').lines[0].unitCents = 0; }, /línea 1: precio/);
  rejects((b) => { inv(b, 'inv-b').lines[0].description = ''; }, /línea 1/);
  rejects((b) => { inv(b, 'inv-b').lines[0].unitCents = 99_999_999_999; inv(b, 'inv-b').lines[0].quantity = 2; }, /línea 1: el total es demasiado grande/);
  rejects((b) => { inv(b, 'inv-b').lines[0].unitCents = 99_999_999_999; inv(b, 'inv-b').lines[0].quantity = 1; inv(b, 'inv-b').taxRateBp = 1; }, /el total es demasiado grande/);
  rejects((b) => { inv(b, 'inv-b').lines[0].productId = 'no-existe'; }, /producto que no existe/);
});

test('el mismo número en la serie real y en la de demostración es válido', () => {
  const r = parseBackup(JSON.stringify(createBackup(invoiceData(), nowISO)), { today });
  assert.ok(r.ok);
  if (r.ok) {
    const numbers = (/** @type {boolean} */ demo) => r.data.invoices.filter((i) => (i.isDemo === true) === demo).map((i) => i.number).sort();
    assert.deepEqual(numbers(false), [1, 2, 3]);
    assert.deepEqual(numbers(true), [1, 2, 3, 4, 5]);
  }
});

test('rechaza cobros mal formados', () => {
  const pay = (/** @type {any} */ b) => b.data.invoicePayments.find((/** @type {any} */ p) => p.id === 'pay-a');
  rejects((b) => { pay(b).invoiceId = 'no-existe'; }, /Cobro de factura #\d+: pertenece a una factura que no existe/);
  rejects((b) => { pay(b).amountCents = 0; }, /Cobro de factura #\d+/);
  rejects((b) => { pay(b).amountCents = 1.5; }, /Cobro de factura #\d+/);
  rejects((b) => { pay(b).date = '2026-07-17'; b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a').date = '2026-07-17'; }, /anterior a la fecha de su factura/);
  rejects((b) => { pay(b).date = '2026-07-21'; }, /Cobro de factura #\d+/);
  rejects((b) => { pay(b).note = 'x'.repeat(121); }, /nota/);
  rejects((b) => { pay(b).movementId = 'no-existe'; }, /su ingreso vinculado no existe/);
  rejects((b) => { Object.assign(b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a'), { type: 'expense', categoryId: 'cat-exp-otros', classification: 'variable' }); }, /su ingreso vinculado no existe/);
  rejects((b) => { b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a').amountCents += 1; }, /no coincide con su ingreso vinculado/);
  rejects((b) => { b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a').date = '2026-07-18'; }, /no coincide con su ingreso vinculado/);
  rejects((b) => { b.data.invoicePayments.push({ ...pay(b), id: 'pay-dup' }); }, /comparte su ingreso vinculado/);
  rejects((b) => { pay(b).amountCents = 100000; b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a').amountCents = 100000; pay(b).invoiceId = 'inv-b'; pay(b).date = '2026-07-19'; b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a').date = '2026-07-19'; }, /superan su total/);
});

test('los cobros no pueden pasar del total de su factura, sumados', () => {
  // Factura B: 3 × 100 = 300 + 18 % = 354. Dos cobros de 200 pasan.
  rejects((b) => {
    const base = b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a');
    for (const n of [1, 2]) {
      b.data.movements.push({ ...base, id: `mv-b${n}`, amountCents: 20000, date: '2026-07-10' });
      b.data.invoicePayments.push({ id: `pay-b${n}`, invoiceId: 'inv-b', amountCents: 20000, date: '2026-07-10', time: '09:00', note: '', movementId: `mv-b${n}`, createdAt: nowISO, updatedAt: nowISO });
    }
  }, /Factura 2: sus cobros superan su total/);
  accepts((b) => {
    const base = b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a');
    b.data.movements.push({ ...base, id: 'mv-b1', amountCents: 35400, date: '2026-07-10' });
    b.data.invoicePayments.push({ id: 'pay-b1', invoiceId: 'inv-b', amountCents: 35400, date: '2026-07-10', time: '09:00', note: '', movementId: 'mv-b1', createdAt: nowISO, updatedAt: nowISO });
  });
});

test('una factura anulada no puede tener cobros', () => {
  rejects((b) => {
    const base = b.data.movements.find((/** @type {any} */ m) => m.id === 'mv-pay-a');
    b.data.movements.push({ ...base, id: 'mv-c', amountCents: 100, date: '2026-07-19' });
    b.data.invoicePayments.push({ id: 'pay-c', invoiceId: 'inv-c', amountCents: 100, date: '2026-07-19', time: '09:00', note: '', movementId: 'mv-c', createdAt: nowISO, updatedAt: nowISO });
  }, /su factura está anulada/);
});

test('las salidas de stock de una factura: deben ser ventas, de una factura vigente, sin dinero propio y con su fecha', () => {
  const entry = (/** @type {any} */ b) => b.data.stockEntries.find((/** @type {any} */ e) => e.id === 'se-a0');
  rejects((b) => { entry(b).invoiceId = 'no-existe'; }, /pertenece a una factura que no existe/);
  rejects((b) => { entry(b).invoiceId = 'inv-c'; }, /su factura está anulada/);
  rejects((b) => { entry(b).date = '2026-07-17'; }, /no coincide con la fecha de su factura/);
  rejects((b) => { entry(b).movementId = 'mv-pay-a'; }, /no lleva su propio movimiento/);
  rejects((b) => { entry(b).kind = 'purchase'; entry(b).quantity = 2; }, /solo una venta puede venir de una factura/);
  rejects((b) => { entry(b).kind = 'adjustment'; entry(b).unitCents = 0; }, /solo una venta puede venir de una factura/);
});

test('cada factura vigente debe haber sacado del inventario exactamente lo que dicen sus líneas', () => {
  const entry = (/** @type {any} */ b) => b.data.stockEntries.find((/** @type {any} */ e) => e.id === 'se-a0');
  rejects((b) => { b.data.stockEntries = b.data.stockEntries.filter((/** @type {any} */ e) => e.id !== 'se-a0'); }, /Factura 1: sus salidas de inventario no coinciden con sus líneas/);
  rejects((b) => { entry(b).quantity = -1; }, /Factura 1: sus salidas de inventario no coinciden/);
  rejects((b) => { entry(b).unitCents += 100; }, /Factura 1: sus salidas de inventario no coinciden/);
  rejects((b) => { b.data.stockEntries.push({ ...entry(b), id: 'se-extra' }); }, /Factura 1: sus salidas de inventario no coinciden/);
  rejects((b) => { inv(b, 'inv-b').lines[0].productId = b.data.products[0].id; }, /Factura 2: sus salidas de inventario no coinciden/);
  rejects((b) => { inv(b, 'inv-a').lines[0].productId = b.data.products[1].id; }, /Factura 1: sus salidas de inventario no coinciden/);
});

test('las salidas de las facturas también cuentan en la regla de oro: el stock nunca queda en negativo', () => {
  rejects((b) => {
    // Se pide una cantidad enorme de una vez: línea y salida coinciden, pero no había tantas unidades.
    inv(b, 'inv-a').lines[0].quantity = 500;
    b.data.stockEntries.find((/** @type {any} */ e) => e.id === 'se-a0').quantity = -500;
  }, /superan lo que había en stock/);
});
