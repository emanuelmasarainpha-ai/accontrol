// 0.17.0 — Productos para la caja: grupo, foto y «sin control de stock» (dominio, store, copia de seguridad y nube).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { createBackup, parseBackup } from '../src/domain/backup.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo, buildInventoryDemo } from '../src/domain/demo.js';
import {
  filterStockPositions, inventorySummary, isValidProductImage, productFilterCounts, productGroups, stockPositions, tracksStock, validateProduct,
} from '../src/domain/inventory.js';
import { fromRow, toRow } from '../src/data/cloudRows.js';
import { LIMITS } from '../src/domain/types.js';

const fixedNow = new Date(2026, 10, 15, 15, 30);
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
async function space() {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind: 'entrepreneur', name: 'Colmado' })).ok);
  return { root, store };
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const data = (/** @type {any} */ store) => store.getState().data;
// Una foto mínima válida (un PNG de 1×1 px).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const buy = (/** @type {string} */ productId) => ({ kind: 'purchase', productId, quantityText: '10', unitText: '5', date: '2026-11-01', supplierId: '', categoryId: 'cat-exp-otros', note: '' });

// ---- Foto ----------------------------------------------------------------------------------------------------------

test('foto: solo JPG, PNG o WEBP en base64; nunca SVG, enlaces ni código', () => {
  assert.equal(isValidProductImage(''), true, 'sin foto');
  assert.equal(isValidProductImage(PNG), true);
  assert.equal(isValidProductImage('data:image/webp;base64,UklGRhIAAABXRUJQ'), true);
  assert.equal(isValidProductImage('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  for (const bad of [
    'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'https://ejemplo.com/foto.png',
    'javascript:alert(1)',
    'data:text/html;base64,PGgxPmhvbGE8L2gxPg==',
    'data:image/png;base64,abc"><script>alert(1)</script>',
    'data:image/png;base64,abc def',
    `data:image/png;base64,${'A'.repeat(LIMITS.productImage)}`,
    null, 42, {},
  ]) assert.equal(isValidProductImage(bad), false, String(bad).slice(0, 40));
});

// ---- Validar el producto -------------------------------------------------------------------------------------------

test('grupo: se limpia, es opcional y tiene un máximo', () => {
  const ok = validateProduct({ name: 'Refresco', groupText: '  Bebidas   frías ' }, { products: [] });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.groupName, 'Bebidas frías');
  const long = validateProduct({ name: 'Refresco', groupText: 'x'.repeat(LIMITS.productGroup + 1) }, { products: [] });
  assert.equal(long.ok, false);
  if (!long.ok) assert.match(long.errors.group, /Máximo 30/);
});

test('sin control de stock: no lleva aviso de stock bajo', () => {
  const r = validateProduct({ name: 'Gomitas', trackStock: false, minStockText: '5' }, { products: [] });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.value.trackStock, r.value.minStock], [false, 0]);
  const normal = validateProduct({ name: 'Arroz', minStockText: '5' }, { products: [] });
  if (normal.ok) assert.deepEqual([normal.value.trackStock, normal.value.minStock], [true, 5], 'por defecto sí controla');
});

test('un producto con movimientos de stock no puede pasar a «sin control de stock»', () => {
  const r = validateProduct({ name: 'Arroz', trackStock: false }, { products: [], stockEntries: 3 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors.trackStock, /ya tiene compras, ventas o ajustes/);
  assert.ok(validateProduct({ name: 'Arroz', trackStock: true }, { products: [], stockEntries: 3 }).ok, 'seguir controlando sí');
});

test('una foto no válida se rechaza con un mensaje claro', () => {
  const r = validateProduct({ name: 'Arroz', imageData: 'data:image/svg+xml;base64,PHN2Zz4=' }, { products: [] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors.image, /JPG, PNG o WEBP/);
  const ok = validateProduct({ name: 'Arroz', imageData: PNG }, { products: [] });
  if (ok.ok) assert.equal(ok.value.imageData, PNG);
});

test('grupos sugeridos: sin repetir (sin mirar mayúsculas) y en orden alfabético', () => {
  /** @param {string} id @param {string} [groupName] */
  const p = (id, groupName) => /** @type {any} */ ({ id, name: id, archived: false, ...(groupName !== undefined ? { groupName } : {}) });
  assert.deepEqual(productGroups([p('a', 'Dulces'), p('b', 'bebidas'), p('c', 'DULCES'), p('d', ''), p('e')]), ['bebidas', 'Dulces']);
});

// ---- Stock, filtros y avisos ---------------------------------------------------------------------------------------

test('los productos de antes (sin los campos nuevos) siguen igual: controlan su stock', () => {
  assert.equal(tracksStock({}), true);
  assert.equal(tracksStock({ trackStock: true }), true);
  assert.equal(tracksStock({ trackStock: false }), false);
});

test('sin control de stock: estado propio, filtro «Sin conteo», no avisa ni cuenta como agotado', () => {
  const NOW = '2026-11-01T12:00:00.000Z';
  /** @param {string} id @param {object} over */
  const prod = (id, over) => ({ id, name: id, sku: '', unit: 'unidad', priceCents: 100, minStock: 5, notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over });
  const d = { products: [prod('gomitas', { trackStock: false, minStock: 0 }), prod('arroz', {})], stockEntries: [] };
  const positions = stockPositions(d);
  assert.deepEqual(positions.map((p) => [p.product.id, p.status]), [['arroz', 'out'], ['gomitas', 'untracked']]);
  const ids = (/** @type {any} */ filter) => filterStockPositions(positions, { filter, query: '' }).map((p) => p.product.id);
  assert.deepEqual(ids('untracked'), ['gomitas']);
  assert.deepEqual(ids('active'), ['arroz', 'gomitas']);
  assert.deepEqual([ids('low'), ids('out'), ids('in_stock')], [['arroz'], ['arroz'], []]);
  assert.equal(productFilterCounts(positions).untracked, 1);
  const summary = inventorySummary(d);
  assert.deepEqual(summary.alerts.map((a) => a.product.id), ['arroz']);
  assert.equal(summary.outCount, 1);
});

// ---- Store: compras, ventas y facturas -----------------------------------------------------------------------------

test('a un producto sin control de stock no se le registran compras, ventas ni ajustes', async () => {
  const { store } = await space();
  const gomitas = must(await store.saveProduct({ name: 'Gomitas', priceText: '5', trackStock: false })).product;
  assert.equal(gomitas.trackStock, false);
  const r = await store.registerStock(buy(gomitas.id));
  assert.equal(r.ok, false);
  assert.match(r.errors.product, /no lleva control de stock/);
  assert.equal(data(store).stockEntries.length, 0);
});

test('una factura con un producto sin control de stock no saca unidades ni pide que haya stock', async () => {
  const { store } = await space();
  const gomitas = must(await store.saveProduct({ name: 'Gomitas', priceText: '5', trackStock: false })).product;
  const arroz = must(await store.saveProduct({ name: 'Arroz', priceText: '50' })).product;
  must(await store.registerStock(buy(arroz.id)));
  const before = data(store).stockEntries.length;
  const r = must(await store.createInvoice({
    customerName: 'Mostrador', issueDate: TODAY, dueDate: '', taxText: '', notes: '',
    lines: [
      { description: 'Gomitas', productId: gomitas.id, quantityText: '500', unitText: '5' },
      { description: 'Arroz', productId: arroz.id, quantityText: '2', unitText: '50' },
    ],
  }));
  assert.equal(r.entries.length, 1, 'solo el arroz sale del inventario');
  assert.equal(r.entries[0].productId, arroz.id);
  assert.equal(data(store).stockEntries.length, before + 1);
  // El arroz sí sigue pidiendo stock.
  const tooMuch = await store.createInvoice({ customerName: 'Mostrador', issueDate: TODAY, lines: [{ description: 'Arroz', productId: arroz.id, quantityText: '50', unitText: '50' }] });
  assert.equal(tooMuch.ok, false);
  // Anularla devuelve solo lo que salió.
  must(await store.voidInvoice(r.invoice.id));
  assert.equal(data(store).stockEntries.length, before);
});

test('pasar a «sin control» un producto que ya tiene compras: el store lo impide', async () => {
  const { store } = await space();
  const arroz = must(await store.saveProduct({ name: 'Arroz', priceText: '50' })).product;
  must(await store.registerStock(buy(arroz.id)));
  const r = await store.saveProduct({ name: 'Arroz', priceText: '50', trackStock: false }, arroz.id);
  assert.equal(r.ok, false);
  assert.equal(data(store).products[0].trackStock, true);
  // Y al revés (empezar a controlar uno que no controlaba) sí se puede.
  const gomitas = must(await store.saveProduct({ name: 'Gomitas', trackStock: false })).product;
  assert.equal(must(await store.saveProduct({ name: 'Gomitas', trackStock: true }, gomitas.id)).product.trackStock, true);
});

test('el grupo y la foto se guardan y se cambian', async () => {
  const { store, root } = await space();
  const p = must(await store.saveProduct({ name: 'Refresco', groupText: 'Bebidas', imageData: PNG })).product;
  assert.deepEqual([p.groupName, p.imageData], ['Bebidas', PNG]);
  assert.equal(root.rawRecords('products')[0].imageData, PNG, 'guardado de verdad');
  const sinFoto = must(await store.saveProduct({ name: 'Refresco', groupText: '', imageData: '' }, p.id)).product;
  assert.deepEqual([sinFoto.groupName, sinFoto.imageData], ['', '']);
});

// ---- Copia de seguridad --------------------------------------------------------------------------------------------

function backupData() {
  const inv = buildInventoryDemo('2026-07-20', '2026-07-20T12:00:00.000Z');
  return {
    categories: defaultCategories(), movements: [...buildBusinessDemo('2026-07-20', '2026-07-20T12:00:00.000Z'), ...inv.movements],
    goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [],
    products: inv.products, suppliers: inv.suppliers, stockEntries: inv.stockEntries, invoices: [], invoicePayments: [], departments: [],
    settings: { displayName: 'Ana', openingBalanceCents: 0 },
  };
}
/** @param {(b: any) => void} change */
const restored = (change) => {
  const b = JSON.parse(JSON.stringify(createBackup(backupData(), '2026-07-20T12:00:00.000Z')));
  change(b);
  return parseBackup(JSON.stringify(b), { today: '2026-07-20' });
};

test('copia de seguridad: grupo, foto y «sin control» vuelven tal cual', () => {
  const r = restored((b) => { b.data.products[0].imageData = PNG; });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) {
    assert.equal(r.data.products[0].imageData, PNG);
    assert.equal(r.data.products.find((p) => p.name === 'Caramelos sueltos')?.trackStock, false);
    assert.equal(r.data.products[0].groupName, 'Ropa');
  }
});

test('copia de seguridad: rechaza una foto peligrosa, un grupo largo o un «sin control» con movimientos de stock', () => {
  for (const [change, message] of /** @type {[(b: any) => void, RegExp][]} */ ([
    [(b) => { b.data.products[0].imageData = 'data:image/svg+xml;base64,PHN2Zz4='; }, /foto no es una imagen/],
    [(b) => { b.data.products[0].groupName = 'x'.repeat(31); }, /grupo/],
    [(b) => { b.data.products[0].trackStock = 'no'; }, /control de stock no válida/],
    [(b) => { b.data.products[0].trackStock = false; }, /no lleva control de stock, pero tiene movimientos/],
  ])) {
    const r = restored(change);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, message);
  }
});

// ---- Nube ----------------------------------------------------------------------------------------------------------

test('nube: un producto de antes viaja con «sin grupo, con control, sin foto»; uno nuevo, con sus valores', () => {
  const NOW = '2026-11-01T12:00:00.000Z';
  const old = { id: 'p1', name: 'Arroz', sku: '', unit: 'unidad', priceCents: 5000, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW };
  const row = toRow('products', old, 'w1');
  assert.deepEqual([row.group_name, row.track_stock, row.image_data], ['', true, '']);
  const pos = toRow('products', { ...old, groupName: 'Dulces', trackStock: false, imageData: PNG }, 'w1');
  assert.deepEqual([pos.group_name, pos.track_stock, pos.image_data], ['Dulces', false, PNG]);
  const back = fromRow('products', { ...pos, created_at: NOW, updated_at: NOW }).record;
  assert.deepEqual([back.groupName, back.trackStock, back.imageData], ['Dulces', false, PNG]);
  // Una fila sin las columnas nuevas (una base sin la migración) se lee con los valores de siempre.
  const { group_name: _g, track_stock: _t, image_data: _i, ...bare } = row;
  const legacy = fromRow('products', { ...bare, created_at: NOW, updated_at: NOW }).record;
  assert.deepEqual([legacy.groupName, legacy.trackStock, legacy.imageData], ['', true, '']);
});

test('un producto sin conteo que trae un aviso de stock mínimo (de una copia o de otro dispositivo) no avisa', () => {
  const NOW = '2026-11-01T12:00:00.000Z';
  const d = { products: [{ id: 'g', name: 'Gomitas', sku: '', unit: 'unidad', priceCents: 100, minStock: 5, notes: '', archived: false, trackStock: false, createdAt: NOW, updatedAt: NOW }], stockEntries: [] };
  const s = inventorySummary(d);
  assert.deepEqual([s.alerts.length, s.outCount], [0, 0]);
});

test('copia de seguridad: una factura de un producto sin conteo (sin salida de stock) se restaura', async () => {
  const { store } = await space();
  const gomitas = must(await store.saveProduct({ name: 'Gomitas', priceText: '5', trackStock: false })).product;
  must(await store.createInvoice({ customerName: 'Mostrador', issueDate: TODAY, lines: [{ description: 'Gomitas', productId: gomitas.id, quantityText: '40', unitText: '5' }] }));
  const r = parseBackup(JSON.stringify(createBackup(data(store), '2026-11-15T20:00:00.000Z')), { today: TODAY });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual([r.data.invoices.length, r.data.stockEntries.length], [1, 0]);
});

test('nube simulada (columnas leídas de la migración): un producto con foto, grupo y sin conteo sube y baja igual', async () => {
  const { createMockAuthServer } = await import('../tools/mock-auth-server.mjs');
  const { createCloudStore } = await import('../src/data/cloudStore.js');
  const { randomUUID } = await import('node:crypto');
  const URL_ = 'https://proyecto.supabase.co';
  const NOW = '2026-11-13T12:00:00.000Z';
  const mock = createMockAuthServer();
  const r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email: 'caja@correo.com', password: 'Vela9Lima!' }) });
  const token = r.body.access_token;
  const userId = r.body.user.id;
  const cloud = createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: mock.fetch });
  const ws = { id: randomUUID(), kind: 'entrepreneur', name: 'Colmado', currency: 'DOP', openingBalanceCents: 0, isDefault: false, createdAt: NOW, updatedAt: NOW };
  assert.deepEqual(await cloud.saveWorkspaces([ws]), { ok: true });
  const base = { sku: '', unit: 'unidad', priceCents: 500, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW };
  const gomitas = { id: randomUUID(), name: 'Gomitas', ...base, groupName: 'Dulces', trackStock: false, imageData: PNG, packQty: 3, packPriceCents: 1200 };
  const viejo = { id: randomUUID(), name: 'Arroz', ...base }; // guardado antes de la 0.17.0: sin los campos nuevos
  const empty = Object.fromEntries((await import('../src/data/cloudRows.js')).CLOUD_KINDS.map((k) => [k.key, []]));
  const pushed = await cloud.push(ws.id, { ...empty, products: [gomitas, viejo] });
  assert.equal(pushed.ok, true, JSON.stringify(pushed));
  const row = mock.data.live('products', ws.id).find((/** @type {any} */ x) => x.id === gomitas.id);
  assert.deepEqual([row.group_name, row.track_stock, row.image_data, row.pack_qty, row.pack_price_cents], ['Dulces', false, PNG, 3, 1200]);
  const pulled = await cloud.pull(ws.id);
  const got = new Map(pulled.changes.products.map((/** @type {any} */ c) => [c.record.id, c.record]));
  assert.deepEqual(got.get(gomitas.id), { ...gomitas, createdBy: userId });
  assert.deepEqual(got.get(viejo.id), { ...viejo, groupName: '', trackStock: true, imageData: '', packQty: 0, packPriceCents: 0, createdBy: userId }, 'el de antes baja con los valores de siempre');
});
