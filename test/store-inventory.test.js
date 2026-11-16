// Inventario en el store: compras y ventas atómicas, protección de los movimientos vinculados, aislamiento por espacio y demostración.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { computeNotices } from '../src/domain/notices.js';
import { inventorySummary, replayProduct, salesAnalysis } from '../src/domain/inventory.js';
import { overallTotals } from '../src/domain/summaries.js';

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
const buyInput = (/** @type {string} */ productId, /** @type {Record<string, string>} */ over = {}) => ({
  kind: 'purchase', productId, quantityText: '10', unitText: '100', date: '2026-11-01', supplierId: '', categoryId: 'cat-exp-otros', note: '', ...over,
});
const saleInput = (/** @type {string} */ productId, /** @type {Record<string, string>} */ over = {}) => ({
  kind: 'sale', productId, quantityText: '4', unitText: '250', date: '2026-11-05', categoryId: 'cat-inc-ventas', note: '', ...over,
});
async function withProduct(kind = 'entrepreneur') {
  const { store, root } = await space(kind);
  const product = must(await store.saveProduct({ name: 'Camisa', priceText: '250', minStockText: '3' })).product;
  return { store, root, product };
}

test('inventoryEnabled: Emprendedor y Empresa sí; Personal y Freelancer solo si ya hay datos', async () => {
  for (const kind of /** @type {const} */ (['entrepreneur', 'company'])) {
    const { store } = await space(kind);
    assert.equal(store.inventoryEnabled(), true, kind);
  }
  for (const kind of /** @type {const} */ (['personal', 'freelancer'])) {
    const { store } = await space(kind);
    assert.equal(store.inventoryEnabled(), false, kind);
  }
});

test('una compra crea el gasto y el movimiento de stock juntos, y baja el Disponible', async () => {
  const { store, product } = await withProduct();
  const supplier = must(await store.saveSupplier({ name: 'Textiles' })).supplier;
  const before = overallTotals(store.getState().data, TODAY).availableCents;
  const r = must(await store.registerStock(buyInput(product.id, { supplierId: supplier.id, quantityText: '12', unitText: '1,500', note: 'Factura 7' })));
  assert.equal(r.movement.type, 'expense');
  assert.equal(r.movement.amountCents, 12 * 150000);
  assert.equal(r.movement.description, 'Compra: 12 × Camisa');
  assert.equal(r.entry.movementId, r.movement.id);
  assert.equal(r.entry.supplierId, supplier.id);
  assert.equal(r.entry.quantity, 12);
  const d = store.getState().data;
  assert.equal(d.movements.length, 1);
  assert.equal(d.stockEntries.length, 1);
  assert.equal(overallTotals(d, TODAY).availableCents, before - 12 * 150000);
  assert.equal(inventorySummary(d).totalValueCents, 12 * 150000);
});

test('una venta crea el ingreso, resta stock y sube el Disponible', async () => {
  const { store, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id)));
  const before = overallTotals(store.getState().data, TODAY).availableCents;
  const r = must(await store.registerStock(saleInput(product.id)));
  assert.equal(r.movement.type, 'income');
  assert.equal(r.movement.amountCents, 4 * 25000);
  assert.equal(r.entry.quantity, -4);
  const d = store.getState().data;
  assert.equal(overallTotals(d, TODAY).availableCents, before + 100000);
  assert.equal(replayProduct(d.stockEntries).stock, 6);
  const month = salesAnalysis(d, '2026-11-01', '2026-11-30');
  assert.deepEqual([month.revenueCents, month.costCents, month.profitCents], [100000, 40000, 60000]);
});

test('no se puede vender más de lo que hay y no se guarda nada a medias', async () => {
  const { store, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id, { quantityText: '3' })));
  const movementsBefore = store.getState().data.movements.length;
  const r = await store.registerStock(saleInput(product.id, { quantityText: '4' }));
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.quantity, /No alcanza el stock/);
  const d = store.getState().data;
  assert.equal(d.movements.length, movementsBefore, 'ni siquiera el ingreso se guardó');
  assert.equal(d.stockEntries.length, 1);
});

test('la compra y el stock se guardan en UNA sola operación (el almacén los recibe juntos)', async () => {
  const { store, root, product } = await withProduct();
  const ws = store.activeWorkspace();
  assert.ok(ws);
  const real = root.forWorkspace(/** @type {any} */ (ws).id);
  /** @type {any[]} */
  const calls = [];
  const spyRoot = { ...root, forWorkspace: () => ({ ...real, putMany: async (/** @type {any} */ changes) => { calls.push(changes); return real.putMany(changes); } }) };
  const spied = createStore(/** @type {any} */ (spyRoot), tickingClock());
  await spied.init();
  must(await spied.registerStock(buyInput(product.id)));
  must(await spied.registerStock(saleInput(product.id)));
  assert.equal(calls.length, 2);
  for (const c of calls) assert.ok(c.movements.length === 1 && c.stockEntries.length === 1, 'dinero y stock en la misma llamada');
});

test('si el guardado falla, no queda el gasto sin el stock ni al revés (en memoria y en lo guardado)', async () => {
  const { store, root, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id)));
  const ws = store.activeWorkspace();
  assert.ok(ws);
  const real = root.forWorkspace(/** @type {any} */ (ws).id);
  // Un almacén cuyo guardado siempre falla, usado solo para la próxima compra.
  const failingRoot = { ...root, forWorkspace: () => ({ ...real, putMany: async () => { throw new Error('disco lleno'); } }) };
  const store2 = createStore(/** @type {any} */ (failingRoot), tickingClock());
  await store2.init();
  const r = await store2.registerStock(buyInput(product.id, { quantityText: '5' }));
  assert.ok(!r.ok);
  assert.equal(store2.getState().data.stockEntries.length, 1);
  assert.equal(store2.getState().data.movements.length, 1);
  assert.equal((await real.load()).stockEntries.length, 1);
});

test('un movimiento que viene del inventario no se edita ni se borra desde Movimientos', async () => {
  const { store, product } = await withProduct();
  const { movement } = must(await store.registerStock(buyInput(product.id)));
  const edit = await store.saveMovement({ type: 'expense', amountText: '1', date: '2026-11-01', time: '09:00', description: 'x', classification: 'variable', categoryId: 'cat-exp-otros' }, movement.id);
  assert.ok(!edit.ok);
  if (!edit.ok) assert.match(edit.errors.form, /Inventario/);
  const del = await store.deleteMovement(movement.id);
  assert.ok(!del.ok);
  if (!del.ok) assert.match(del.errors.form, /Inventario/);
  assert.equal(store.getState().data.movements.length, 1);
});

test('borrar un movimiento de stock borra también su gasto o ingreso', async () => {
  const { store, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id)));
  const sale = must(await store.registerStock(saleInput(product.id)));
  const balanceWithSale = overallTotals(store.getState().data, TODAY).availableCents;
  must(await store.deleteStockEntry(sale.entry.id));
  const d = store.getState().data;
  assert.equal(d.stockEntries.length, 1);
  assert.equal(d.movements.length, 1);
  assert.equal(overallTotals(d, TODAY).availableCents, balanceWithSale - 100000, 'el ingreso se fue con la venta');
});

test('no se borra una compra cuya mercancía ya se vendió; el stock no queda en negativo', async () => {
  const { store, product } = await withProduct();
  const purchase = must(await store.registerStock(buyInput(product.id, { quantityText: '5' })));
  must(await store.registerStock(saleInput(product.id, { quantityText: '5' })));
  const r = await store.deleteStockEntry(purchase.entry.id);
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.form, /ya respalda otras salidas/);
  assert.equal(store.getState().data.stockEntries.length, 2);
  assert.equal(store.getState().data.movements.length, 2);
});

test('ajustes: suman con costo y restan como merma, sin mover dinero', async () => {
  const { store, product } = await withProduct();
  const plus = must(await store.registerStock({ kind: 'adjustment', productId: product.id, quantityText: '10', unitText: '80', date: '2026-11-01', note: 'Stock inicial' }));
  assert.equal(plus.movement, null);
  assert.equal(store.getState().data.movements.length, 0);
  const minus = must(await store.registerStock({ kind: 'adjustment', productId: product.id, quantityText: '-2', date: '2026-11-02', note: 'Roto' }));
  assert.equal(minus.entry.unitCents, 0);
  const d = store.getState().data;
  assert.equal(replayProduct(d.stockEntries).stock, 8);
  assert.equal(replayProduct(d.stockEntries).valueCents, 8 * 8000);
  must(await store.deleteStockEntry(minus.entry.id));
  assert.equal(store.getState().data.movements.length, 0);
});

test('productos y proveedores: no se borran si tienen movimientos, pero sí se archivan', async () => {
  const { store, product } = await withProduct();
  const supplier = must(await store.saveSupplier({ name: 'Textiles' })).supplier;
  const spare = must(await store.saveProduct({ name: 'Sin uso' })).product;
  const spareSupplier = must(await store.saveSupplier({ name: 'Sin compras' })).supplier;
  must(await store.registerStock(buyInput(product.id, { supplierId: supplier.id })));
  const noProduct = await store.deleteProduct(product.id);
  assert.ok(!noProduct.ok);
  if (!noProduct.ok) assert.match(noProduct.errors.form, /archivarlo/);
  const noSupplier = await store.deleteSupplier(supplier.id);
  assert.ok(!noSupplier.ok);
  if (!noSupplier.ok) assert.match(noSupplier.errors.form, /archivarlo/);
  must(await store.deleteProduct(spare.id));
  must(await store.deleteSupplier(spareSupplier.id));
  assert.deepEqual(store.getState().data.products.map((p) => p.name), ['Camisa']);
  // Archivar: ya no se ofrece para comprar o vender, pero se conserva y se reactiva.
  must(await store.setProductArchived(product.id, true));
  const blocked = await store.registerStock(buyInput(product.id));
  assert.ok(!blocked.ok);
  if (!blocked.ok) assert.match(blocked.errors.product, /archivado/);
  must(await store.setProductArchived(product.id, false));
  must(await store.registerStock(buyInput(product.id)));
  must(await store.setSupplierArchived(supplier.id, true));
  assert.equal(store.getState().data.suppliers[0].archived, true);
});

test('editar un producto conserva sus movimientos; el nombre no se repite', async () => {
  const { store, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id)));
  const edited = must(await store.saveProduct({ name: 'Camisa polo', priceText: '300' }, product.id));
  assert.equal(edited.product.name, 'Camisa polo');
  assert.equal(store.getState().data.stockEntries[0].productId, product.id);
  must(await store.saveProduct({ name: 'Otra' }));
  const dup = await store.saveProduct({ name: 'OTRA' });
  assert.ok(!dup.ok && dup.errors.name);
  const gone = await store.saveProduct({ name: 'X' }, 'no-existe');
  assert.ok(!gone.ok);
});

test('el inventario es de cada espacio: otro espacio no ve ni mezcla productos, proveedores ni stock', async () => {
  const { store, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id)));
  must(await store.createWorkspace({ kind: 'company', name: 'Otra empresa' }));
  const other = store.getState().data;
  assert.deepEqual([other.products.length, other.suppliers.length, other.stockEntries.length, other.movements.length], [0, 0, 0, 0]);
  // El mismo nombre de producto se puede usar en otro espacio.
  must(await store.saveProduct({ name: 'Camisa' }));
  const ws = store.getState().workspaces.find((w) => w.name === 'Mi tienda');
  assert.ok(ws);
  must(await store.switchWorkspace(/** @type {any} */ (ws).id));
  assert.equal(store.getState().data.stockEntries.length, 1);
});

test('lo guardado vuelve igual al abrir de nuevo la app', async () => {
  const { store, root, product } = await withProduct();
  const supplier = must(await store.saveSupplier({ name: 'Textiles', email: 'a@b.co' })).supplier;
  must(await store.registerStock(buyInput(product.id, { supplierId: supplier.id })));
  must(await store.registerStock(saleInput(product.id)));
  const reopened = createStore(root, tickingClock());
  await reopened.init();
  assert.deepEqual(reopened.getState().data, store.getState().data);
});

test('aviso de stock bajo en Inicio cuando una venta lo deja en el mínimo', async () => {
  const { store, product } = await withProduct(); // mínimo 3
  must(await store.registerStock(buyInput(product.id, { quantityText: '5' })));
  assert.ok(!computeNotices(store.getState().data, TODAY, { kind: 'entrepreneur' }).some((n) => n.id === 'inventory-low-stock'));
  must(await store.registerStock(saleInput(product.id, { quantityText: '2' })));
  const notice = computeNotices(store.getState().data, TODAY, { kind: 'entrepreneur' }).find((n) => n.id === 'inventory-low-stock');
  assert.ok(notice);
  assert.match(notice.text, /«Camisa»/);
});

// ---- Demostración ---------------------------------------------------------------------------------

test('demostración de un negocio: productos, proveedores y movimientos coherentes, todo DEMO', async () => {
  for (const kind of /** @type {const} */ (['entrepreneur', 'company'])) {
    const { store } = await space(kind);
    must(await store.loadDemoData());
    const d = store.getState().data;
    assert.equal(d.products.length, 5, kind); // 0.17.0: el quinto, «Caramelos sueltos», sin control de stock
    assert.equal(d.suppliers.length, 2);
    assert.ok(d.stockEntries.length > 10);
    assert.ok(d.products.every((p) => p.isDemo) && d.suppliers.every((s) => s.isDemo) && d.stockEntries.every((e) => e.isDemo));
    // Cada compra y venta tiene su gasto o ingreso DEMO con el mismo monto y fecha; el stock nunca es negativo ni hay fechas futuras.
    for (const e of d.stockEntries) {
      assert.ok(e.date <= TODAY);
      if (e.kind === 'adjustment') { assert.equal(e.movementId, undefined); continue; }
      const m = d.movements.find((x) => x.id === e.movementId);
      assert.ok(m && m.isDemo, `${kind}: falta el movimiento de ${e.kind}`);
      assert.equal(m.amountCents, Math.abs(e.quantity) * e.unitCents);
      assert.equal(m.date, e.date);
      assert.equal(m.type, e.kind === 'purchase' ? 'expense' : 'income');
    }
    for (const p of d.products) assert.equal(replayProduct(d.stockEntries.filter((e) => e.productId === p.id)).firstNegative, null, p.name);
    const summary = inventorySummary(d);
    assert.equal(summary.alerts.length, 3, 'camisas y gorras con stock bajo, cinturones agotados');
    assert.equal(summary.outCount, 1);
    const notices = computeNotices(d, TODAY, { kind });
    assert.ok(notices.some((n) => n.id === 'inventory-low-stock' && n.level === 'critical'));
  }
});

test('la demostración de inventario no aparece en Personal ni en Freelancer', async () => {
  for (const kind of /** @type {const} */ (['personal', 'freelancer'])) {
    const { store } = await space(kind);
    must(await store.loadDemoData());
    const d = store.getState().data;
    assert.deepEqual([d.products.length, d.suppliers.length, d.stockEntries.length], [0, 0, 0], kind);
  }
});

test('quitar la demostración borra productos, proveedores, stock y los movimientos de dinero que generaron', async () => {
  const { store } = await space('entrepreneur');
  must(await store.registerStock(buyInput(must(await store.saveProduct({ name: 'Real' })).product.id)));
  const real = JSON.stringify(store.getState().data);
  must(await store.loadDemoData());
  assert.ok(store.getState().data.stockEntries.length > 1);
  must(await store.removeDemoData());
  assert.equal(JSON.stringify(store.getState().data), real, 'queda exactamente lo real');
  assert.equal(store.hasDemoData(), false);
});

test('comprar o vender un producto de demostración también es de demostración y se va con él', async () => {
  const { store } = await space('company');
  must(await store.loadDemoData());
  const shirt = store.getState().data.products.find((p) => p.name === 'Camisa de algodón');
  assert.ok(shirt);
  const r = must(await store.registerStock(buyInput(shirt.id, { date: '2026-11-10', quantityText: '5' })));
  assert.equal(r.entry.isDemo, true);
  assert.equal(r.movement.isDemo, true);
  must(await store.removeDemoData());
  const d = store.getState().data;
  assert.deepEqual([d.products.length, d.suppliers.length, d.stockEntries.length], [0, 0, 0]);
  assert.ok(!d.movements.some((m) => m.isDemo));
});

test('un proveedor de demostración con una compra real pasa a ser del usuario', async () => {
  const { store } = await space('entrepreneur');
  must(await store.loadDemoData());
  const demoSupplier = store.getState().data.suppliers[0];
  const mine = must(await store.saveProduct({ name: 'Mío' })).product;
  must(await store.registerStock(buyInput(mine.id, { supplierId: demoSupplier.id })));
  must(await store.removeDemoData());
  const d = store.getState().data;
  assert.deepEqual(d.suppliers.map((s) => [s.name, s.isDemo]), [[demoSupplier.name, undefined]]);
  assert.equal(d.stockEntries.length, 1);
  assert.equal(d.stockEntries[0].supplierId, demoSupplier.id);
});

test('copia de seguridad: ida y vuelta con inventario, y la revisión previa cuenta los productos', async () => {
  const { store, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id)));
  must(await store.registerStock(saleInput(product.id)));
  const before = store.getState().data;
  const { json } = store.exportBackup();
  const inspected = store.inspectBackup(json);
  assert.ok(inspected.ok && inspected.kind === 'workspace');
  assert.equal(inspected.ok && inspected.counts.products, 1);

  // Se borra el inventario y se restaura la copia: todo vuelve igual, con su gasto e ingreso ligados.
  must(await store.deleteStockEntry(before.stockEntries[1].id));
  must(await store.deleteStockEntry(before.stockEntries[0].id));
  must(await store.deleteProduct(product.id));
  assert.equal(store.getState().data.products.length, 0);
  const restored = must(await store.importBackup(json));
  assert.equal(restored.counts.products, 1);
  const after = store.getState().data;
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.stockEntries, before.stockEntries);
  assert.deepEqual(after.movements, before.movements);
});

test('copia completa: la revisión previa y la restauración cuentan los productos de todos los espacios', async () => {
  const { store, product } = await withProduct();
  must(await store.registerStock(buyInput(product.id)));
  must(await store.createWorkspace({ kind: 'company', name: 'Otra' }));
  const other = must(await store.saveProduct({ name: 'Taza' })).product;
  must(await store.registerStock(buyInput(other.id)));
  const full = must(await store.exportFullBackup());
  const inspected = store.inspectBackup(full.json);
  assert.ok(inspected.ok && inspected.kind === 'full' && inspected.counts.products === 2);
  const restored = must(await store.importBackup(full.json));
  assert.equal(restored.counts.products, 2);
});
