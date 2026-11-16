// 0.17.1 — Caja (punto de venta): carrito, cobro, devuelta y la venta guardada de una sola vez.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { customerLedgers } from '../src/domain/fiado.js';
import { replayProduct, stockPositions } from '../src/domain/inventory.js';
import { invoicePosition } from '../src/domain/invoices.js';
import {
  addToCart, cartTotals, cashChange, posGroups, posProducts, prepareSale, productForCode, quickCashOptions, reconcileCart, setCartPrice, setCartQuantity,
  WALK_IN_CUSTOMER,
} from '../src/domain/pos.js';
import { overallTotals } from '../src/domain/summaries.js';

const fixedNow = new Date(2026, 10, 15, 15, 30);
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const data = (/** @type {any} */ store) => store.getState().data;
async function shop() {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Colmado' }));
  const refresco = must(await store.saveProduct({ name: 'Refresco', sku: '7460001', priceText: '50', groupText: 'Bebidas' })).product;
  const pan = must(await store.saveProduct({ name: 'Pan de agua', priceText: '10', groupText: 'Panadería' })).product;
  const gomitas = must(await store.saveProduct({ name: 'Gomitas', priceText: '5', groupText: 'Dulces', trackStock: false })).product;
  const libre = must(await store.saveProduct({ name: 'Encargo', priceText: '' })).product; // sin precio ni grupo
  for (const [p, q] of [[refresco, '3'], [pan, '20'], [libre, '5']]) {
    must(await store.registerStock({ kind: 'purchase', productId: p.id, quantityText: q, unitText: '4', date: '2026-11-01', supplierId: '', categoryId: 'cat-exp-otros', note: '' }));
  }
  return { root, store, refresco, pan, gomitas, libre };
}
const pos = (/** @type {any} */ store) => stockPositions(data(store));
const at = (/** @type {any} */ store, /** @type {string} */ id) => /** @type {any} */ (pos(store).find((p) => p.product.id === id));

// ---- Productos que se ofrecen ----------------------------------------------------------------------------------------

test('grupos de la caja: en orden, sin repetir y con «Sin grupo» al final si hace falta', async () => {
  const { store } = await shop();
  assert.deepEqual(posGroups(data(store).products), ['Bebidas', 'Dulces', 'Panadería', '']);
});

test('filtrar por grupo y buscar (nombre, código o grupo, sin tildes)', async () => {
  const { store } = await shop();
  const names = (/** @type {any} */ f) => posProducts(pos(store), f).map((p) => p.product.name);
  assert.deepEqual(names({ group: 'bebidas', query: '' }), ['Refresco']);
  assert.deepEqual(names({ group: '', query: '' }), ['Encargo'], '«Sin grupo»');
  assert.deepEqual(names({ group: null, query: 'panaderia' }), ['Pan de agua']);
  assert.deepEqual(names({ group: null, query: '7460001' }), ['Refresco']);
  assert.equal(names({ group: null, query: '' }).length, 4);
});

test('lo que manda la pistola lectora: el código exacto, o la única coincidencia', async () => {
  const { store } = await shop();
  assert.equal(productForCode(pos(store), ' 7460001 ')?.product.name, 'Refresco');
  assert.equal(productForCode(pos(store), 'gomit')?.product.name, 'Gomitas');
  assert.equal(productForCode(pos(store), 'e'), null, 'varias coincidencias: no adivina');
  assert.equal(productForCode(pos(store), ''), null);
});

// ---- Carrito -----------------------------------------------------------------------------------------------------------

test('carrito: tocar suma una unidad; no pasa del stock; lo que no se cuenta no tiene tope', async () => {
  const { store, refresco, gomitas } = await shop();
  /** @type {any[]} */
  let cart = [];
  for (let i = 0; i < 3; i += 1) cart = must(addToCart(cart, at(store, refresco.id))).cart;
  assert.deepEqual(cart, [{ productId: refresco.id, quantity: 3, unitCents: 5000 }]);
  const fourth = addToCart(cart, at(store, refresco.id));
  assert.equal(fourth.ok, false);
  if (!fourth.ok) assert.match(fourth.error, /Solo quedan 3 de «Refresco»/);
  for (let i = 0; i < 500; i += 1) cart = must(addToCart(cart, at(store, gomitas.id))).cart;
  assert.equal(cart[1].quantity, 500);
});

test('carrito: un producto agotado no entra', async () => {
  const { store } = await shop();
  const agotado = must(await store.saveProduct({ name: 'Leche', priceText: '60' })).product;
  const r = addToCart([], at(store, agotado.id));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /está agotado/);
});

test('carrito: cambiar la cantidad (0 la quita) y el precio', async () => {
  const { store, pan, refresco } = await shop();
  let cart = must(addToCart([], at(store, pan.id))).cart;
  cart = must(addToCart(cart, at(store, refresco.id))).cart;
  cart = must(setCartQuantity(cart, pan.id, 12, at(store, pan.id))).cart;
  assert.equal(cart[0].quantity, 12);
  assert.equal(setCartQuantity(cart, pan.id, 21, at(store, pan.id)).ok, false, 'hay 20');
  assert.equal(setCartQuantity(cart, pan.id, 1.5, at(store, pan.id)).ok, false);
  cart = must(setCartPrice(cart, refresco.id, '45')).cart;
  assert.equal(cart[1].unitCents, 4500);
  assert.equal(setCartPrice(cart, refresco.id, '0').ok, false);
  assert.deepEqual(must(setCartQuantity(cart, pan.id, 0, at(store, pan.id))).cart.map((l) => l.productId), [refresco.id]);
});

test('carrito: si otra persona vendió mientras tanto, baja a lo que queda y quita lo agotado o archivado', async () => {
  const { store, pan, refresco } = await shop();
  const cart = [{ productId: pan.id, quantity: 25, unitCents: 1000 }, { productId: refresco.id, quantity: 1, unitCents: 5000 }, { productId: 'borrado', quantity: 1, unitCents: 1 }];
  const r = reconcileCart(cart, pos(store));
  assert.equal(r.changed, true);
  assert.deepEqual(r.cart.map((l) => [l.productId, l.quantity]), [[pan.id, 20], [refresco.id, 1]]);
  assert.equal(reconcileCart(r.cart, pos(store)).changed, false);
});

test('totales del carrito con impuesto (redondeado al centavo, como una factura)', () => {
  const cart = [{ productId: 'a', quantity: 3, unitCents: 3333 }, { productId: 'b', quantity: 1, unitCents: 1 }];
  assert.deepEqual(cartTotals(cart, 1800), { subtotalCents: 10000, taxCents: 1800, totalCents: 11800, units: 4 });
  assert.equal(cartTotals([], 0).totalCents, 0);
});

// ---- Efectivo ----------------------------------------------------------------------------------------------------------

test('efectivo: la devuelta; si no se escribe nada, pagó exacto; si no alcanza, lo dice', () => {
  assert.deepEqual(cashChange(12050, '200'), { ok: true, receivedCents: 20000, changeCents: 7950 });
  assert.deepEqual(cashChange(12050, ''), { ok: true, receivedCents: 12050, changeCents: 0 });
  const short = cashChange(12050, '100');
  assert.equal(short.ok, false);
  if (!short.ok) assert.match(short.error, /Faltan RD\$ 20\.50/);
  assert.equal(cashChange(100, 'abc').ok, false);
});

test('billetes rápidos: los que cubren el total, sin repetir el exacto', () => {
  assert.deepEqual(quickCashOptions(12050), [20000, 50000, 100000]);
  assert.deepEqual(quickCashOptions(50000), [100000, 200000]);
  assert.deepEqual(quickCashOptions(500000), []);
});

// ---- Preparar la venta -----------------------------------------------------------------------------------------------

test('preparar la venta: carrito vacío, sin método o fiado sin nombre se explican', async () => {
  const { store, pan } = await shop();
  const products = data(store).products;
  const empty = prepareSale({ cart: [], method: 'cash', date: TODAY }, { products });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.errors.form, /carrito está vacío/);
  const cart = [{ productId: pan.id, quantity: 1, unitCents: 1000 }];
  const noMethod = prepareSale({ cart, method: /** @type {any} */ ('cheque'), date: TODAY }, { products });
  assert.equal(noMethod.ok, false);
  if (!noMethod.ok) assert.ok(noMethod.errors.method);
  for (const name of ['', '  ', 'cliente de mostrador']) {
    const r = prepareSale({ cart, method: 'credit', customerName: name, date: TODAY }, { products });
    assert.equal(r.ok, false, name);
    if (!r.ok) assert.match(r.errors.customerName, /escribe el nombre/);
  }
  const noPrice = prepareSale({ cart: [{ productId: pan.id, quantity: 1, unitCents: 0 }], method: 'card', date: TODAY }, { products });
  assert.equal(noPrice.ok, false);
  if (!noPrice.ok) assert.match(noPrice.errors.form, /no tiene precio/);
});

test('preparar la venta: cliente de mostrador, nota con el método y la devuelta', async () => {
  const { store, pan } = await shop();
  const r = prepareSale({ cart: [{ productId: pan.id, quantity: 3, unitCents: 1000 }], method: 'cash', receivedText: '100', date: TODAY }, { products: data(store).products });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.invoiceInput.customerName, WALK_IN_CUSTOMER);
    assert.equal(r.invoiceInput.notes, 'Venta en caja · Efectivo');
    assert.equal(r.note, 'Efectivo · recibido RD$ 100.00 · devuelta RD$ 70.00');
    assert.deepEqual(r.invoiceInput.lines.map((l) => [l.description, l.quantityText, l.unitText]), [['Pan de agua', '3', '10.00']]);
  }
});

// ---- Store: la venta ---------------------------------------------------------------------------------------------------

test('venta en efectivo: factura, salida de inventario, cobro e ingreso, todo de una vez', async () => {
  const { store, root, pan, refresco, gomitas } = await shop();
  const before = overallTotals(data(store), TODAY);
  const cart = [{ productId: pan.id, quantity: 5, unitCents: 1000 }, { productId: refresco.id, quantity: 2, unitCents: 5000 }, { productId: gomitas.id, quantity: 10, unitCents: 500 }];
  const r = must(await store.posSale({ cart, method: 'cash', receivedText: '200', taxText: '', date: TODAY }));
  assert.deepEqual([r.totalCents, r.receivedCents, r.changeCents], [20000, 20000, 0]);
  assert.equal(r.entries.length, 2, 'las gomitas no sacan unidades');
  assert.equal(replayProduct(data(store).stockEntries.filter((/** @type {any} */ e) => e.productId === pan.id)).stock, 15);
  assert.equal(replayProduct(data(store).stockEntries.filter((/** @type {any} */ e) => e.productId === refresco.id)).stock, 1);
  assert.equal(invoicePosition(r.invoice, data(store).invoicePayments, TODAY).status, 'paid');
  assert.equal(r.payment.note, 'Efectivo');
  assert.equal(overallTotals(data(store), TODAY).incomeCents - before.incomeCents, 20000, 'el ingreso es el total, una sola vez');
  for (const t of ['invoices', 'invoicePayments']) assert.equal(root.rawRecords(t).length, 1, t);
  assert.equal(root.rawRecords('stockEntries').filter((/** @type {any} */ e) => e.invoiceId === r.invoice.id).length, 2, 'las salidas de inventario se guardaron de verdad');
});

test('venta con tarjeta e impuesto: el cobro es el total con impuesto', async () => {
  const { store, pan } = await shop();
  const r = must(await store.posSale({ cart: [{ productId: pan.id, quantity: 10, unitCents: 1000 }], method: 'card', taxText: '18', date: TODAY }));
  assert.equal(r.totalCents, 11800);
  assert.equal(r.payment.amountCents, 11800);
  assert.equal(r.payment.note, 'Tarjeta');
  assert.equal(r.invoice.taxRateBp, 1800);
});

test('venta fiada: queda la factura pendiente (sin ingreso) y aparece en «Fiado» con el nombre que ya tenía', async () => {
  const { store, pan } = await shop();
  must(await store.createCredit({ customerName: 'Doña Rosa', amountText: '100', date: '2026-11-10' }));
  const before = overallTotals(data(store), TODAY);
  const r = must(await store.posSale({ cart: [{ productId: pan.id, quantity: 2, unitCents: 1000 }], method: 'credit', customerName: 'dona rosa', date: TODAY }));
  assert.equal(r.payment, null);
  assert.equal(r.invoice.customerName, 'Doña Rosa');
  assert.equal(r.invoice.notes, 'Fiado');
  assert.deepEqual(overallTotals(data(store), TODAY), before, 'fiar no es cobrar');
  assert.equal(replayProduct(data(store).stockEntries.filter((/** @type {any} */ e) => e.productId === pan.id)).stock, 18, 'pero sí sale del inventario');
  assert.deepEqual(customerLedgers(data(store), TODAY).map((l) => [l.name, l.balanceCents]), [['Doña Rosa', 12000]]);
});

test('venta: si el stock ya no alcanza (otra persona vendió), no se guarda nada y se explica', async () => {
  const { store, root, refresco } = await shop();
  const r = await store.posSale({ cart: [{ productId: refresco.id, quantity: 4, unitCents: 5000 }], method: 'cash', date: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.errors.form, /Refresco/);
  assert.equal(root.rawRecords('invoices').length, 0);
});

test('venta: efectivo que no alcanza, o un fallo al guardar, no deja nada a medias', async () => {
  const { store, root, pan } = await shop();
  const short = await store.posSale({ cart: [{ productId: pan.id, quantity: 5, unitCents: 1000 }], method: 'cash', receivedText: '20', date: TODAY });
  assert.match(short.errors.received, /Faltan RD\$ 30\.00/);
  root.failNextWrite();
  const failed = await store.posSale({ cart: [{ productId: pan.id, quantity: 5, unitCents: 1000 }], method: 'cash', date: TODAY });
  assert.equal(failed.ok, false);
  for (const t of ['invoices', 'invoicePayments', 'movements']) assert.equal(root.rawRecords(t).filter((/** @type {any} */ x) => t !== 'movements' || /Cobro/.test(x.description)).length, 0, t);
  assert.equal(data(store).invoices.length, 0);
});

test('venta: las ventas siguen la numeración de las facturas', async () => {
  const { store, pan } = await shop();
  const a = must(await store.posSale({ cart: [{ productId: pan.id, quantity: 1, unitCents: 1000 }], method: 'cash', date: TODAY }));
  const b = must(await store.posSale({ cart: [{ productId: pan.id, quantity: 1, unitCents: 1000 }], method: 'transfer', date: TODAY }));
  assert.deepEqual([a.invoice.number, b.invoice.number], [1, 2]);
  assert.equal(b.payment.note, 'Transferencia');
});

test('montos rápidos para totales grandes: redondeados a 100, 500 y 1,000 pesos', () => {
  assert.deepEqual(quickCashOptions(428340), [430000, 450000, 500000]);
  assert.deepEqual(quickCashOptions(9900), [10000, 20000, 50000]);
});

test('pistola lectora: el código exacto gana aunque haya otros que lo contienen', async () => {
  const { store } = await shop();
  must(await store.saveProduct({ name: 'Galleta A', sku: '123', priceText: '5', trackStock: false }));
  must(await store.saveProduct({ name: 'Galleta B', sku: '1234', priceText: '5', trackStock: false }));
  assert.equal(productForCode(pos(store), '123')?.product.name, 'Galleta A');
  assert.equal(productForCode(pos(store), '1234')?.product.name, 'Galleta B');
});
