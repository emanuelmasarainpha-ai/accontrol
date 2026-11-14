// Respaldo del inventario (versión 6 del formato, vigente en la 7): ida y vuelta, copias antiguas y archivos manipulados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, createFullBackup, parseAnyBackup, parseBackup } from '../src/domain/backup.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo, buildInventoryDemo } from '../src/domain/demo.js';

const today = '2026-07-20';
const nowISO = '2026-07-20T12:00:00.000Z';

function inventoryData() {
  const inv = buildInventoryDemo(today, nowISO);
  return {
    categories: defaultCategories(),
    movements: [...buildBusinessDemo(today, nowISO), ...inv.movements],
    goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [],
    products: inv.products, suppliers: inv.suppliers, stockEntries: inv.stockEntries, invoices: [], invoicePayments: [], departments: [],
    settings: { displayName: 'Ana', openingBalanceCents: 0 },
  };
}
/** @param {(b: any) => void} change */
function corrupt(change) {
  const backup = JSON.parse(JSON.stringify(createBackup(inventoryData(), nowISO)));
  change(backup);
  return parseBackup(JSON.stringify(backup), { today });
}
const rejects = (/** @type {(b: any) => void} */ change, /** @type {RegExp} */ message) => {
  const r = corrupt(change);
  assert.ok(!r.ok, 'debía rechazarse');
  if (!r.ok) assert.match(r.error, message);
};
const entryOf = (/** @type {any} */ b, /** @type {string} */ kind) => b.data.stockEntries.find((/** @type {any} */ e) => e.kind === kind && e.movementId);

test('productos, proveedores y movimientos de stock se exportan e importan tal cual', () => {
  const data = inventoryData();
  assert.ok(data.products.length > 0 && data.suppliers.length > 0 && data.stockEntries.length > 0);
  const r = parseBackup(JSON.stringify(createBackup(data, nowISO)), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual(r.data, data);
});

test('la copia completa también los conserva', () => {
  const data = inventoryData();
  const workspace = {
    id: 'w1', kind: /** @type {const} */ ('entrepreneur'), name: 'Mi tienda', currency: /** @type {const} */ ('DOP'), openingBalanceCents: 0, isDefault: true,
    createdAt: nowISO, updatedAt: nowISO,
  };
  const full = createFullBackup({ profile: { displayName: 'Ana', lastWorkspaceId: 'w1' }, workspaces: [{ workspace, data }] }, nowISO);
  const r = parseAnyBackup(JSON.stringify(full), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok && r.kind === 'full') {
    assert.deepEqual(r.workspaces[0].data.products, data.products);
    assert.deepEqual(r.workspaces[0].data.stockEntries, data.stockEntries);
  } else assert.fail('debía ser una copia completa');
});

test('un respaldo anterior, sin inventario, se importa con las listas vacías', () => {
  const old = JSON.parse(JSON.stringify(createBackup({ ...inventoryData(), movements: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [] }, nowISO)));
  old.schemaVersion = 5;
  delete old.data.products; delete old.data.suppliers; delete old.data.stockEntries;
  const r = parseBackup(JSON.stringify(old), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual([r.data.products, r.data.suppliers, r.data.stockEntries], [[], [], []]);
});

test('un respaldo de una versión más nueva se rechaza con un mensaje claro', () => {
  const r = corrupt((b) => { b.schemaVersion = 9; });
  assert.ok(!r.ok);
});

test('las secciones de inventario deben ser listas', () => {
  for (const key of ['products', 'suppliers', 'stockEntries']) rejects((b) => { b.data[key] = 'no'; }, new RegExp(`«${key}»`));
});

test('rechaza productos mal formados', () => {
  rejects((b) => { b.data.products[0].name = ''; }, /Producto #1: nombre/);
  rejects((b) => { b.data.products[0].priceCents = -1; }, /precio/);
  rejects((b) => { b.data.products[0].priceCents = 1.5; }, /precio/);
  rejects((b) => { b.data.products[0].minStock = 2_000_000; }, /stock mínimo/);
  rejects((b) => { b.data.products[0].archived = 'sí'; }, /archivado/);
  rejects((b) => { b.data.products[0].unit = ''; }, /unidad/);
  rejects((b) => { b.data.products[1].id = b.data.products[0].id; }, /repetido/);
  rejects((b) => { b.data.products[0].createdAt = 'ayer'; }, /fecha de registro/);
});

test('rechaza proveedores mal formados', () => {
  rejects((b) => { b.data.suppliers[0].name = ''; }, /Proveedor #1: nombre/);
  rejects((b) => { b.data.suppliers[0].email = 'no-es-correo'; }, /correo/);
  rejects((b) => { b.data.suppliers[0].phone = 'abc'; }, /teléfono/);
  rejects((b) => { b.data.suppliers[0].archived = 1; }, /archivado/);
});

test('rechaza movimientos de stock imposibles', () => {
  rejects((b) => { b.data.stockEntries[0].productId = 'no-existe'; }, /producto que no existe/);
  rejects((b) => { b.data.stockEntries[0].kind = 'regalo'; }, /tipo no válido/);
  rejects((b) => { b.data.stockEntries[0].quantity = 0; }, /cantidad/);
  rejects((b) => { b.data.stockEntries[0].quantity = 1.5; }, /cantidad/);
  rejects((b) => { b.data.stockEntries[0].quantity = 2_000_000; }, /cantidad/);
  rejects((b) => { const e = entryOf(b, 'purchase'); e.quantity = -e.quantity; }, /compra no puede restar/);
  rejects((b) => { const e = entryOf(b, 'sale'); e.quantity = -e.quantity; }, /venta no puede sumar/);
  rejects((b) => { entryOf(b, 'purchase').unitCents = 0; }, /mayor que cero/);
  rejects((b) => { entryOf(b, 'purchase').unitCents = -5; }, /monto por unidad/);
  rejects((b) => { const e = b.data.stockEntries.find((/** @type {any} */ x) => x.kind === 'adjustment'); e.unitCents = 50; }, /ajuste que resta no lleva monto/);
  rejects((b) => { const e = b.data.stockEntries.find((/** @type {any} */ x) => x.kind === 'adjustment' && x.quantity > 0) ?? b.data.stockEntries[0]; e.kind = 'adjustment'; delete e.movementId; delete e.supplierId; e.quantity = 1_000_000; e.unitCents = 99_999_999_999; }, /total es demasiado grande/);
  rejects((b) => { entryOf(b, 'sale').date = '2099-01-01'; }, /fecha futura/);
  rejects((b) => { entryOf(b, 'sale').time = '25:99'; }, /hora/);
  rejects((b) => { entryOf(b, 'sale').note = 'x'.repeat(500); }, /nota/);
  rejects((b) => { entryOf(b, 'sale').id = entryOf(b, 'purchase').id; }, /repetido/);
});

test('rechaza vínculos rotos entre el stock, los proveedores y el dinero', () => {
  rejects((b) => { entryOf(b, 'purchase').supplierId = 'no-existe'; }, /proveedor que no existe/);
  rejects((b) => { entryOf(b, 'sale').supplierId = b.data.suppliers[0].id; }, /solo una compra puede tener proveedor/);
  rejects((b) => { entryOf(b, 'purchase').movementId = 'no-existe'; }, /movimiento de dinero no existe/);
  rejects((b) => { delete entryOf(b, 'sale').movementId; }, /movimiento de dinero no existe/);
  rejects((b) => { const e = b.data.stockEntries.find((/** @type {any} */ x) => x.kind === 'adjustment'); e.movementId = entryOf(b, 'sale').movementId; }, /ajuste no mueve dinero/);
  // Una venta ligada al gasto de una compra (tipo equivocado).
  rejects((b) => { entryOf(b, 'sale').movementId = entryOf(b, 'purchase').movementId; }, /movimiento de dinero no existe|comparte su movimiento/);
  // Dos movimientos de stock con el mismo gasto.
  rejects((b) => {
    const purchases = b.data.stockEntries.filter((/** @type {any} */ x) => x.kind === 'purchase');
    purchases[1].movementId = purchases[0].movementId;
  }, /comparte su movimiento de dinero/);
  // El monto o la fecha del dinero no coinciden con los del stock.
  rejects((b) => { const m = b.data.movements.find((/** @type {any} */ x) => x.id === entryOf(b, 'sale').movementId); m.amountCents += 1; }, /no coincide con su movimiento de dinero/);
  rejects((b) => { const m = b.data.movements.find((/** @type {any} */ x) => x.id === entryOf(b, 'purchase').movementId); m.date = '2026-01-01'; }, /no coincide con su movimiento de dinero/);
});

test('rechaza un respaldo cuyo stock habría sido negativo (mercancía que nunca existió)', () => {
  rejects((b) => {
    // Se mueve la compra más antigua de las camisas a una fecha posterior a todas sus ventas: las ventas quedarían sin stock.
    const purchase = b.data.stockEntries.find((/** @type {any} */ e) => e.kind === 'purchase' && e.productId === b.data.products[0].id);
    const m = b.data.movements.find((/** @type {any} */ x) => x.id === purchase.movementId);
    purchase.date = today; m.date = today; purchase.time = '23:59'; m.time = '23:59';
    // La otra compra de camisas (más reciente) también se mueve, para que no haya stock antes de las ventas.
    for (const e of b.data.stockEntries.filter((/** @type {any} */ x) => x.kind === 'purchase' && x.productId === purchase.productId)) {
      const mv = b.data.movements.find((/** @type {any} */ x) => x.id === e.movementId);
      e.date = today; e.time = '23:59'; mv.date = today; mv.time = '23:59';
    }
  }, /sus salidas superan lo que había en stock/);
});

test('el archivo se rechaza completo: nada del inventario se importa a medias', () => {
  const r = corrupt((b) => { b.data.stockEntries[3].quantity = 0; });
  assert.ok(!r.ok);
});
