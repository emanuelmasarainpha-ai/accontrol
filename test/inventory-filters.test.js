// @ts-check
// 0.16.2 — Filtros de la lista de productos: stock bajo, agotados, con stock, archivados y búsqueda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStockPositions, isProductFilter, matchesProductFilter, productFilterCounts, stockPositions } from '../src/domain/inventory.js';

const NOW = '2026-07-20T12:00:00.000Z';
/** @param {string} id @param {Partial<import('../src/domain/types.js').Product>} [over] */
const product = (id, over = {}) => ({
  id, name: `Producto ${id}`, sku: '', unit: 'unidad', priceCents: 0, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over,
});
let seq = 0;
/** @param {string} productId @param {number} quantity @returns {import('../src/domain/types.js').StockEntry} */
const entry = (productId, quantity) => ({
  id: `e${++seq}`, productId, kind: quantity > 0 ? 'purchase' : 'sale', quantity, unitCents: 100, date: '2026-07-01', time: '10:00', note: '', createdAt: NOW, updatedAt: NOW,
});

// Un colmado de prueba:
//  - Café: 3 unidades con aviso en 5  → stock bajo
//  - Arroz: 50 unidades con aviso en 5 → bien
//  - Azúcar: compró 10 y vendió 10 con aviso en 2 → agotado (y también stock bajo, porque pidió aviso)
//  - Vela: nunca se compró y no tiene aviso → agotado, pero no «stock bajo»
//  - Jabón: archivado con 4 unidades y aviso en 10 → solo en «Archivados»
const data = {
  products: [
    product('cafe', { name: 'Café Santo Domingo', sku: 'CAF-01', minStock: 5 }),
    product('arroz', { name: 'Arroz selecto', sku: '7461234567890', minStock: 5 }),
    product('azucar', { name: 'Azúcar crema', minStock: 2, notes: 'Saco de 5 libras' }),
    product('vela', { name: 'Vela' }),
    product('jabon', { name: 'Jabón de cuaba', minStock: 10, archived: true }),
  ],
  stockEntries: [entry('cafe', 3), entry('arroz', 50), entry('azucar', 10), entry('azucar', -10), entry('jabon', 4)],
};
const positions = stockPositions(data);
/** @param {import('../src/domain/inventory.js').ProductFilter} filter @param {string} [query] */
const ids = (filter, query = '') => filterStockPositions(positions, { filter, query }).map((p) => p.product.id).sort();

test('«Todos» muestra los activos y deja fuera los archivados', () => {
  assert.deepEqual(ids('active'), ['arroz', 'azucar', 'cafe', 'vela']);
});

test('«Stock bajo» muestra los que pidieron aviso y están en él o por debajo, incluidos los agotados con aviso', () => {
  assert.deepEqual(ids('low'), ['azucar', 'cafe']);
});

test('«Stock bajo» incluye el producto que está justo en el aviso', () => {
  const justo = stockPositions({ products: [product('x', { minStock: 3 })], stockEntries: [entry('x', 3)] });
  assert.equal(matchesProductFilter(justo[0], 'low'), true);
  const encima = stockPositions({ products: [product('x', { minStock: 3 })], stockEntries: [entry('x', 4)] });
  assert.equal(matchesProductFilter(encima[0], 'low'), false);
});

test('«Agotados» muestra los que no tienen unidades, con aviso o sin él', () => {
  assert.deepEqual(ids('out'), ['azucar', 'vela']);
});

test('«Con stock» muestra los que tienen al menos una unidad', () => {
  assert.deepEqual(ids('in_stock'), ['arroz', 'cafe']);
});

test('«Archivados» muestra solo los archivados, aunque tengan stock bajo', () => {
  assert.deepEqual(ids('archived'), ['jabon']);
  assert.equal(ids('low').includes('jabon'), false);
  assert.equal(ids('in_stock').includes('jabon'), false);
});

test('la búsqueda mira el nombre, el código y las notas, sin tildes ni mayúsculas', () => {
  assert.deepEqual(ids('active', 'cafe'), ['cafe']);
  assert.deepEqual(ids('active', 'AZUCAR'), ['azucar']);
  assert.deepEqual(ids('active', '7461234567890'), ['arroz'], 'código de barras completo');
  assert.deepEqual(ids('active', 'caf-01'), ['cafe']);
  assert.deepEqual(ids('active', 'libras'), ['azucar'], 'notas');
  assert.deepEqual(ids('active', '  arroz  '), ['arroz'], 'espacios alrededor');
  assert.deepEqual(ids('active', 'pan'), []);
});

test('la búsqueda se combina con el filtro', () => {
  assert.deepEqual(ids('low', 'arroz'), [], 'el arroz está bien de stock');
  assert.deepEqual(ids('archived', 'jabon'), ['jabon']);
  assert.deepEqual(ids('active', 'jabon'), [], 'un archivado no sale en «Todos» aunque se busque');
});

test('el filtro conserva el orden de la lista', () => {
  const all = filterStockPositions(positions, { filter: 'active', query: '' }).map((p) => p.product.id);
  assert.deepEqual(all, positions.filter((p) => !p.product.archived).map((p) => p.product.id));
});

test('los contadores de los botones cuadran con lo que muestra cada filtro', () => {
  const counts = productFilterCounts(positions);
  assert.deepEqual(counts, { active: 4, low: 2, out: 2, in_stock: 2, archived: 1 });
  for (const [f, n] of Object.entries(counts)) {
    assert.ok(isProductFilter(f));
    assert.equal(ids(/** @type {any} */ (f)).length, n, f);
  }
});

test('solo se aceptan filtros conocidos', () => {
  assert.equal(isProductFilter('low'), true);
  assert.equal(isProductFilter('LOW'), false);
  assert.equal(isProductFilter(undefined), false);
  assert.equal(isProductFilter('<script>'), false);
});
