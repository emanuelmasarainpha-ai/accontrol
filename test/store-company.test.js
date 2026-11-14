// Empresa en el store: cuándo existe «Salud financiera», los avisos solo de Empresa y la demostración con deuda y activo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { companyHealth } from '../src/domain/company.js';
import { computeNotices } from '../src/domain/notices.js';

const fixedNow = new Date(2026, 10, 15, 15, 30); // 15 nov 2026
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {'personal' | 'freelancer' | 'entrepreneur' | 'company'} kind */
async function space(kind, name = 'Mi empresa') {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind, name })).ok);
  return { root, store };
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const movement = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'expense', amountText: '100', date: '2026-10-05', time: '09:00', description: 'Gasto', classification: 'fixed', categoryId: 'cat-exp-otros', ...over,
});

test('healthEnabled: solo en Empresa, y cambia al cambiar de espacio', async () => {
  const { store } = await space('company', 'ABC');
  assert.equal(store.healthEnabled(), true);
  for (const kind of /** @type {const} */ (['entrepreneur', 'freelancer', 'personal'])) {
    must(await store.createWorkspace({ kind, name: `Otro ${kind}` }));
    assert.equal(store.healthEnabled(), false, kind);
  }
});

test('diagnosisEnabled: en todos los espacios menos Empresa, y cambia al cambiar de espacio', async () => {
  const { store } = await space('company', 'ABC');
  assert.equal(store.diagnosisEnabled(), false);
  for (const kind of /** @type {const} */ (['entrepreneur', 'freelancer', 'personal'])) {
    must(await store.createWorkspace({ kind, name: `Otro ${kind}` }));
    assert.equal(store.diagnosisEnabled(), true, kind);
  }
});

test('avisos de salud: solo en Empresa, nunca en Emprendedor ni Personal', async () => {
  // Septiembre y octubre: ingresa 2,000, gasta 3,000 fijos; saldo inicial 0 → Disponible negativo y sin efectivo.
  for (const kind of /** @type {const} */ (['company', 'entrepreneur', 'personal'])) {
    const { store } = await space(kind);
    for (const month of ['09', '10']) {
      must(await store.saveMovement({ ...movement({ type: 'income', amountText: '2,000', date: `2026-${month}-05`, classification: 'fixed', categoryId: 'cat-inc-salario' }) }));
      must(await store.saveMovement(movement({ amountText: '3,000', date: `2026-${month}-06` })));
    }
    const ids = computeNotices(store.getState().data, TODAY, { kind }).map((n) => n.id);
    assert.equal(ids.includes('company-runway-low'), kind === 'company', `${kind}: ${ids.join(',')}`);
    assert.equal(ids.includes('company-below-breakeven'), kind === 'company', kind);
  }
});

test('demostración en un espacio Empresa: negocio inventado con una deuda y un activo, todo marcado DEMO', async () => {
  const { store } = await space('company', 'ABC');
  must(await store.loadDemoData());
  const d = store.getState().data;
  assert.equal(d.debts.length, 1);
  assert.equal(d.debtPayments.length, 3);
  assert.equal(d.assets.length, 1);
  assert.ok(d.debts[0].isDemo && d.assets[0].isDemo && d.debtPayments.every((p) => p.isDemo));
  // Cada pago tiene su gasto vinculado (también DEMO) y la clasificación de «Salud» no lo cuenta como costo.
  const linked = d.debtPayments.map((p) => d.movements.find((m) => m.id === p.movementId));
  assert.ok(linked.every((m) => m && m.isDemo && m.type === 'expense'));
  const health = companyHealth(d, TODAY);
  assert.equal(health.hasData, true);
  assert.equal(health.partial, false);
  assert.ok(health.baseline.debtServiceCents > 0, 'hay cuota de deuda');
  assert.ok(health.leverage.assetsCents > 0 && health.leverage.liabilitiesCents > 0);
  assert.equal(health.levels.breakEven === 'unknown', false);
  assert.equal(health.counts.unknown, 0);
});

test('demostración en Emprendedor: sin deudas ni activos (solo el negocio)', async () => {
  const { store } = await space('entrepreneur', 'Tienda');
  must(await store.loadDemoData());
  const d = store.getState().data;
  assert.deepEqual([d.debts.length, d.debtPayments.length, d.assets.length], [0, 0, 0]);
});

test('borrar la demostración de una empresa quita deuda, pagos y activo, y conserva lo real', async () => {
  const { store } = await space('company', 'ABC');
  must(await store.saveMovement(movement({ amountText: '777', description: 'Gasto real' })));
  must(await store.loadDemoData());
  must(await store.removeDemoData());
  const d = store.getState().data;
  assert.deepEqual([d.debts.length, d.debtPayments.length, d.assets.length], [0, 0, 0]);
  assert.deepEqual(d.movements.map((m) => m.description), ['Gasto real']);
});

test('la demostración de Empresa no aparece en otro espacio', async () => {
  const { store } = await space('company', 'ABC');
  must(await store.loadDemoData());
  must(await store.createWorkspace({ kind: 'company', name: 'Otra' }));
  const d = store.getState().data;
  assert.deepEqual([d.movements.length, d.debts.length, d.assets.length], [0, 0, 0]);
});
