// 0.17.5 — Oferta por cantidad («2 por RD$15», como el pan del colmado).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { createBackup, parseBackup } from '../src/domain/backup.js';
import { packLabel, productPack, replayProduct, stockPositions, validateProduct } from '../src/domain/inventory.js';
import {
  addToCart, cartInvoiceLines, cartTotals, lineSavingsCents, lineSegments, lineTotalCents, MAX_CART_LINES, offerDescription, setCartPrice,
  setCartQuantity,
} from '../src/domain/pos.js';
import { LIMITS } from '../src/domain/types.js';

const TODAY = '2026-11-17';
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const data = (/** @type {any} */ store) => store.getState().data;
const at = (/** @type {any} */ store, /** @type {string} */ id) => /** @type {any} */ (stockPositions(data(store)).find((p) => p.product.id === id));
/** @param {number} quantity @param {number} unitCents @param {number} qty @param {number} priceCents */
const line = (quantity, unitCents, qty, priceCents) => ({ productId: 'p', quantity, unitCents, pack: { qty, priceCents } });

async function colmado() {
  let ticks = 0;
  const store = createStore(createMemoryWorkspaceStore(), () => new Date(new Date(2026, 10, 17, 9, 0).getTime() + (ticks += 1) * 1000));
  await store.init();
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Colmado' }));
  const pan = must(await store.saveProduct({ name: 'Pan', priceText: '8', packQtyText: '2', packPriceText: '15' })).product;
  must(await store.registerStock({ kind: 'purchase', productId: pan.id, quantityText: '50', unitText: '5', date: '2026-11-01', supplierId: '', categoryId: 'cat-exp-otros', note: '' }));
  return { store, pan };
}

// ---- El producto -------------------------------------------------------------------------------------------------------

test('producto: la oferta es opcional y se guarda en centavos', () => {
  const none = must(validateProduct({ name: 'Arroz', priceText: '40' }, { products: [] }));
  assert.deepEqual([none.value.packQty, none.value.packPriceCents], [0, 0]);
  const pan = must(validateProduct({ name: 'Pan', priceText: '8', packQtyText: ' 2 ', packPriceText: '15' }, { products: [] }));
  assert.deepEqual([pan.value.packQty, pan.value.packPriceCents], [2, 1500]);
  assert.deepEqual(productPack(pan.value), { qty: 2, priceCents: 1500 });
  assert.equal(productPack({ packQty: 0, packPriceCents: 0 }), null);
  assert.equal(productPack({}), null, 'un producto de antes no tiene oferta');
  assert.equal(packLabel({ qty: 2, priceCents: 1500 }), '2 por RD$ 15.00');
});

test('producto: la oferta se rechaza si está incompleta, no tiene sentido o no sale más barata', () => {
  for (const [input, field, text] of [
    [{ packQtyText: '2' }, 'packPrice', /cuánto cuestan juntas/],
    [{ packPriceText: '15' }, 'packQty', /cuántas unidades/],
    [{ packQtyText: '1', packPriceText: '7' }, 'packQty', /de 2 a 999/],
    [{ packQtyText: '1000', packPriceText: '7' }, 'packQty', /de 2 a 999/],
    [{ packQtyText: '2.5', packPriceText: '7' }, 'packQty', /de 2 a 999/],
    [{ packQtyText: '2', packPriceText: '0' }, 'packPrice', /mayor que cero/],
    [{ packQtyText: '2', packPriceText: 'abc' }, 'packPrice', /./],
    [{ packQtyText: '2', packPriceText: '16' }, 'packPrice', /más barata que 2 unidades sueltas \(RD\$ 16\.00\)/],
    [{ packQtyText: '3', packPriceText: '0.02' }, 'packPrice', /demasiado bajo/],
  ]) {
    const r = validateProduct(/** @type {any} */ ({ name: 'Pan', priceText: '8', ...input }), { products: [] });
    assert.ok(!r.ok, JSON.stringify(input));
    if (!r.ok) assert.match(r.errors[/** @type {string} */ (field)] ?? '', /** @type {RegExp} */ (text), JSON.stringify(input));
  }
  const noUnit = validateProduct({ name: 'Pan', packQtyText: '2', packPriceText: '15' }, { products: [] });
  assert.ok(!noUnit.ok);
  if (!noUnit.ok) assert.match(noUnit.errors.price, /precio de una unidad/);
});

// ---- El cálculo ----------------------------------------------------------------------------------------------------------

test('2 por RD$15 con el pan a RD$8: 6 panes = RD$45 y 7 = RD$53 (el que sobra va suelto)', () => {
  assert.equal(lineTotalCents(line(1, 800, 2, 1500)), 800, 'uno solo no llega a la oferta');
  assert.equal(lineTotalCents(line(2, 800, 2, 1500)), 1500);
  assert.equal(lineTotalCents(line(6, 800, 2, 1500)), 4500);
  assert.equal(lineTotalCents(line(7, 800, 2, 1500)), 5300);
  assert.deepEqual(lineSegments(line(7, 800, 2, 1500)), [
    { quantity: 6, unitCents: 750, offer: true },
    { quantity: 1, unitCents: 800, offer: false },
  ]);
  assert.equal(lineSavingsCents(line(7, 800, 2, 1500)), 300);
  assert.equal(lineSavingsCents(line(1, 800, 2, 1500)), 0);
});

test('3 por RD$25 (no se divide exacto): dos tramos de centavos enteros que suman justo la oferta', () => {
  assert.deepEqual(lineSegments(line(3, 1000, 3, 2500)), [
    { quantity: 2, unitCents: 833, offer: true },
    { quantity: 1, unitCents: 834, offer: true },
  ]);
  assert.equal(lineTotalCents(line(7, 1000, 3, 2500)), 6000, '2 ofertas (RD$50) + 1 suelto (RD$10)');
  // Todas las cantidades de 1 a 200, con varias ofertas: siempre packs × oferta + sueltos × precio, sin un centavo de más ni de menos.
  for (const [unit, qty, price] of [[1000, 3, 2500], [800, 2, 1500], [700, 6, 3999], [1, 2, 2], [100, 7, 601]]) {
    for (let q = 1; q <= 200; q += 1) {
      const l = line(q, unit, qty, price);
      const segs = lineSegments(l);
      assert.equal(segs.reduce((s, x) => s + x.quantity, 0), q, 'no se pierde ni se inventa ninguna unidad');
      assert.ok(segs.every((x) => Number.isSafeInteger(x.unitCents) && x.unitCents > 0), 'centavos enteros y positivos');
      assert.equal(lineTotalCents(l), Math.floor(q / qty) * price + (q % qty) * unit, `q=${q} ${qty} por ${price}`);
      assert.ok(segs.length <= 3);
    }
  }
});

test('sin oferta, la línea es la de siempre', () => {
  assert.deepEqual(lineSegments({ productId: 'p', quantity: 4, unitCents: 500 }), [{ quantity: 4, unitCents: 500, offer: false }]);
  assert.deepEqual(lineSegments({ productId: 'p', quantity: 4, unitCents: 500, pack: null }), [{ quantity: 4, unitCents: 500, offer: false }]);
  assert.equal(lineTotalCents({ productId: 'p', quantity: 4, unitCents: 500 }), 2000);
});

test('totales del carrito: con la oferta, el ahorro y el impuesto sobre lo que de verdad se cobra', () => {
  const t = cartTotals([line(7, 800, 2, 1500), { productId: 'r', quantity: 1, unitCents: 5000 }], 1800);
  assert.deepEqual(t, { subtotalCents: 10300, taxCents: 1854, totalCents: 12154, units: 8, savingsCents: 300 });
});

// ---- En la caja ----------------------------------------------------------------------------------------------------------

test('caja: al tocar el producto la línea trae su oferta; con un precio puesto a mano, la oferta ya no se aplica', async () => {
  const { store, pan } = await colmado();
  /** @type {any[]} */
  let cart = [];
  for (let i = 0; i < 7; i += 1) cart = must(addToCart(cart, at(store, pan.id))).cart;
  assert.deepEqual(cart, [{ productId: pan.id, quantity: 7, unitCents: 800, pack: { qty: 2, priceCents: 1500 } }]);
  assert.equal(cartTotals(cart, 0).totalCents, 5300);
  const manual = must(setCartPrice(cart, pan.id, '7')).cart;
  assert.equal(manual[0].pack, null);
  assert.equal(cartTotals(manual, 0).totalCents, 4900);
});

test('caja: cobrar 7 panes a «2 por RD$15»: factura de RD$53, salen 7 del stock y entra RD$53', async () => {
  const { store, pan } = await colmado();
  const cart = [{ productId: pan.id, quantity: 7, unitCents: 800, pack: { qty: 2, priceCents: 1500 } }];
  const r = must(await store.posSale({ cart, method: 'cash', receivedText: '100', taxText: '', date: TODAY }));
  assert.deepEqual([r.totalCents, r.changeCents], [5300, 4700]);
  assert.deepEqual(r.invoice.lines.map((/** @type {any} */ l) => [l.description, l.quantity, l.unitCents]), [
    ['Pan (oferta 2 por RD$ 15.00)', 6, 750],
    ['Pan', 1, 800],
  ]);
  assert.equal(replayProduct(data(store).stockEntries.filter((/** @type {any} */ e) => e.productId === pan.id)).stock, 43, '50 − 7');
  assert.equal(r.payment.amountCents, 5300);
});

test('caja: cada producto con oferta puede ocupar hasta 3 líneas de la factura, y no se pasa de 30', async () => {
  const { store } = await colmado();
  const products = [];
  for (let i = 0; i < 11; i += 1) {
    products.push(must(await store.saveProduct({ name: `Dulce ${i}`, priceText: '10', packQtyText: '3', packPriceText: '25', trackStock: false })).product);
  }
  /** @type {any[]} */
  let cart = [];
  for (const p of products.slice(0, 10)) for (let k = 0; k < 4; k += 1) cart = must(addToCart(cart, at(store, p.id))).cart; // 4 = 2 tramos de oferta + 1 suelto
  assert.equal(cartInvoiceLines(cart), MAX_CART_LINES);
  const more = addToCart(cart, at(store, products[10].id));
  assert.equal(more.ok, false);
  if (!more.ok) assert.match(more.error, /máximo de 30 líneas/);
  // Bajar a 3 (sin suelto) deja sitio para otro producto.
  cart = must(setCartQuantity(cart, products[0].id, 3, at(store, products[0].id))).cart;
  assert.equal(cartInvoiceLines(cart), MAX_CART_LINES - 1);
  must(addToCart(cart, at(store, products[10].id)));
});

test('la descripción de la oferta no pasa del máximo de una línea de factura', () => {
  assert.equal(offerDescription('Pan', { qty: 2, priceCents: 1500 }), 'Pan (oferta 2 por RD$ 15.00)');
  const long = offerDescription('x'.repeat(LIMITS.productName), { qty: 999, priceCents: 99999999999 });
  assert.ok(long.length <= LIMITS.invoiceLine, String(long.length));
  assert.match(long, /…\s\(oferta 999 por RD\$ 999,999,999\.99\)$/);
});

// ---- Copias y base de datos ----------------------------------------------------------------------------------------------

test('copia de seguridad: la oferta va y vuelve; una oferta rota se rechaza', async () => {
  const { store, pan } = await colmado();
  const text = JSON.stringify(createBackup(data(store), '2026-11-17T20:00:00.000Z'));
  const r = parseBackup(text, { today: TODAY });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual(productPack(/** @type {any} */ (r.data.products.find((p) => p.id === pan.id))), { qty: 2, priceCents: 1500 });
  for (const broken of [{ packQty: 2 }, { packQty: 1, packPriceCents: 500 }, { packQty: 3, packPriceCents: 2 }, { packQty: 0, packPriceCents: 500 }]) {
    const b = JSON.parse(text);
    const p = b.data.products.find((/** @type {any} */ x) => x.id === pan.id);
    delete p.packQty; delete p.packPriceCents;
    Object.assign(p, broken);
    const bad = parseBackup(JSON.stringify(b), { today: TODAY });
    assert.equal(bad.ok, false, JSON.stringify(broken));
  }
});

test('migración: dos columnas con 0 = sin oferta, que van juntas', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261120000100_product_pack.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /add column pack_qty integer not null default 0\s+check \(pack_qty = 0 or pack_qty between 2 and 999\)/);
  assert.match(sql, /add column pack_price_cents bigint not null default 0/);
  assert.match(sql, /products_pack_together/);
  assert.doesNotMatch(sql.toLowerCase(), /\b(drop|delete|update|truncate)\b/, 'no borra ni cambia datos');
});
