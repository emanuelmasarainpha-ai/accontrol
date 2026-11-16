// La demostración de inventario: coherente (stock nunca negativo, vínculos con el dinero) y sin romper la historia del negocio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo, buildInventoryDemo } from '../src/domain/demo.js';
import { businessVerdict, monthlyResults } from '../src/domain/business.js';
import { inventorySummary, replayProduct } from '../src/domain/inventory.js';

const NOW = '2026-11-15T10:00:00.000Z';
// Fechas «incómodas»: día 1 y 2 (el mes en curso casi no tiene días), fin de mes, febrero, cambio de año.
const DAYS = ['2026-11-06', '2026-11-01', '2026-11-02', '2026-11-30', '2026-03-01', '2026-02-28', '2027-01-02', '2026-07-31'];

/** @param {string} today */
function demoData(today) {
  const inv = buildInventoryDemo(today, NOW);
  return {
    inv,
    data: /** @type {any} */ ({
      categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [],
      movements: [...buildBusinessDemo(today, NOW), ...inv.movements], products: inv.products, suppliers: inv.suppliers, stockEntries: inv.stockEntries,
    }),
  };
}

for (const today of DAYS) {
  test(`demostración de inventario (${today}): stock coherente y nunca negativo`, () => {
    const { inv, data } = demoData(today);
    assert.ok(inv.products.every((p) => p.isDemo) && inv.suppliers.every((s) => s.isDemo) && inv.stockEntries.every((e) => e.isDemo) && inv.movements.every((m) => m.isDemo));
    assert.ok(inv.stockEntries.every((e) => e.date <= today), 'sin fechas futuras');
    assert.ok(inv.movements.every((m) => m.date <= today), 'el dinero tampoco es futuro');
    for (const p of inv.products) assert.equal(replayProduct(data.stockEntries.filter((/** @type {any} */ e) => e.productId === p.id)).firstNegative, null, p.name);
    const summary = inventorySummary(data);
    const byName = Object.fromEntries(summary.positions.map((p) => [p.product.name, p]));
    assert.deepEqual(
      Object.fromEntries(Object.entries(byName).map(([name, p]) => [name, [p.stock, p.status]])),
      { 'Camisa de algodón': [7, 'low'], 'Pantalón de mezclilla': [11, 'ok'], Gorra: [6, 'low'], 'Cinturón de cuero': [0, 'out'], 'Caramelos sueltos': [0, 'untracked'] },
    );
    assert.equal(summary.alerts.length, 3, 'dos con stock bajo y uno agotado (los caramelos, sin control de stock, no avisan)');
    assert.equal(summary.outCount, 1, 'los caramelos no cuentan como agotados');
  });

  test(`demostración de inventario (${today}): cada compra y venta tiene su dinero y no hay dinero suelto`, () => {
    const { inv } = demoData(today);
    const ids = new Set(inv.movements.map((m) => m.id));
    const linked = inv.stockEntries.filter((e) => e.movementId);
    assert.equal(linked.length, inv.movements.length);
    assert.ok(linked.every((e) => e.movementId && ids.has(e.movementId)));
    for (const e of linked) {
      const m = /** @type {any} */ (inv.movements.find((x) => x.id === e.movementId));
      assert.equal(m.amountCents, Math.abs(e.quantity) * e.unitCents);
      assert.equal(m.type, e.kind === 'purchase' ? 'expense' : 'income');
      assert.equal(m.date, e.date);
    }
    assert.ok(inv.stockEntries.filter((e) => e.kind === 'adjustment').every((e) => !e.movementId), 'un ajuste no mueve dinero');
  });

  test(`demostración de inventario (${today}): sumada a la del negocio, no la vuelve una pérdida`, () => {
    const { data } = demoData(today);
    const verdict = businessVerdict(data, today);
    assert.equal(verdict.state, 'value', `${today}: ${JSON.stringify(verdict)}`);
    const lastThree = monthlyResults(data, today, 4).slice(0, 3); // los 3 meses completos antes del actual
    assert.ok(lastThree.every((m) => m.expenseCents < m.incomeCents), `${today}: ${JSON.stringify(lastThree)}`);
  });
}
