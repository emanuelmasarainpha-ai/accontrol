// El "cerebro" en espacios de negocio: cuándo se muestra Resultados, las categorías sugeridas y los avisos de negocio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { BUSINESS_CATEGORY_SUGGESTIONS } from '../src/domain/business.js';
import { computeNotices } from '../src/domain/notices.js';

const fixedNow = new Date(2026, 10, 15, 15, 30); // 15 nov 2026
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {'personal' | 'freelancer' | 'entrepreneur' | 'company'} kind */
async function space(kind, name = 'Mi negocio') {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind, name })).ok);
  return { root, store };
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const movement = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'expense', amountText: '100', date: '2026-10-05', time: '09:00', description: 'Gasto', classification: 'variable', categoryId: 'cat-exp-otros', ...over,
});

test('resultsEnabled: solo en Emprendedor y Empresa, y cambia al cambiar de espacio', async () => {
  const { store } = await space('entrepreneur', 'Tienda');
  assert.equal(store.resultsEnabled(), true);
  must(await store.createWorkspace({ kind: 'personal', name: 'Yo' }));
  assert.equal(store.resultsEnabled(), false);
  must(await store.createWorkspace({ kind: 'freelancer', name: 'Diseño' }));
  assert.equal(store.resultsEnabled(), false);
  must(await store.createWorkspace({ kind: 'company', name: 'ABC' }));
  assert.equal(store.resultsEnabled(), true);
});

test('categorías sugeridas: se añaden al espacio de negocio, quedan guardadas y no se repiten', async () => {
  const { store, root } = await space('entrepreneur');
  const before = store.getState().data.categories.length;
  const first = must(await store.addBusinessCategories());
  assert.equal(first.added, BUSINESS_CATEGORY_SUGGESTIONS.length);
  const cats = store.getState().data.categories;
  assert.equal(cats.length, before + BUSINESS_CATEGORY_SUGGESTIONS.length);
  const added = cats.filter((c) => !c.builtIn);
  assert.equal(added.length, BUSINESS_CATEGORY_SUGGESTIONS.length);
  assert.ok(added.every((c) => c.builtIn === false && typeof c.id === 'string' && c.id.length > 10));
  assert.equal(added.find((c) => c.name === 'Servicios prestados')?.kind, 'income');
  assert.equal(added.find((c) => c.name === 'Nómina y colaboradores')?.defaultClassification, 'fixed');
  // segunda vez: nada nuevo
  assert.equal(must(await store.addBusinessCategories()).added, 0);
  assert.equal(store.getState().data.categories.length, before + BUSINESS_CATEGORY_SUGGESTIONS.length);
  // otra pestaña las ve
  const tab2 = createStore(root, () => fixedNow);
  await tab2.init();
  assert.equal(tab2.getState().data.categories.filter((c) => !c.builtIn).length, BUSINESS_CATEGORY_SUGGESTIONS.length);
});

test('categorías sugeridas: son propias del espacio (no aparecen en los demás) y se pueden renombrar y borrar', async () => {
  const { store } = await space('entrepreneur', 'Tienda');
  must(await store.addBusinessCategories());
  const target = store.getState().data.categories.find((c) => c.name === 'Marketing y publicidad');
  assert.ok(target);
  must(await store.saveCategory({ name: 'Publicidad', kind: 'expense', defaultClassification: 'variable' }, target.id));
  must(await store.deleteCategory(target.id));
  assert.ok(!store.getState().data.categories.some((c) => c.id === target.id));
  // en un espacio nuevo no hay ninguna de las añadidas
  must(await store.createWorkspace({ kind: 'personal', name: 'Yo' }));
  assert.equal(store.getState().data.categories.filter((c) => !c.builtIn).length, 0);
  assert.equal((await store.addBusinessCategories()).ok, false);
});

test('categorías sugeridas: respeta las que el usuario ya tiene con ese nombre', async () => {
  const { store } = await space('company', 'ABC');
  must(await store.saveCategory({ name: 'marketing y publicidad', kind: 'expense', defaultClassification: 'variable' }));
  const result = must(await store.addBusinessCategories());
  assert.equal(result.added, BUSINESS_CATEGORY_SUGGESTIONS.length - 1);
  assert.equal(store.getState().data.categories.filter((c) => c.name.toLowerCase() === 'marketing y publicidad').length, 1);
});

test('categorías sugeridas: no se ofrecen en Personal ni Freelancer', async () => {
  for (const kind of /** @type {const} */ (['personal', 'freelancer'])) {
    const { store } = await space(kind, 'X');
    const r = await store.addBusinessCategories();
    assert.equal(r.ok, false);
    assert.equal(store.getState().data.categories.filter((c) => !c.builtIn).length, 0);
  }
});

test('avisos de negocio: solo en Emprendedor y Empresa', async () => {
  const { store } = await space('entrepreneur', 'Tienda');
  // dos meses completos seguidos con pérdida: septiembre y octubre
  for (const m of [
    { type: 'income', amountText: '50', date: '2026-09-02', categoryId: 'cat-inc-ventas' },
    { type: 'expense', amountText: '90', date: '2026-09-03' },
    { type: 'income', amountText: '20', date: '2026-10-02', categoryId: 'cat-inc-ventas' },
    { type: 'expense', amountText: '70', date: '2026-10-03' },
  ]) must(await store.saveMovement(movement(m)));
  const data = store.getState().data;
  assert.ok(computeNotices(data, TODAY, { kind: 'entrepreneur' }).some((n) => n.id === 'business-loss-streak'));
  assert.ok(computeNotices(data, TODAY, { kind: 'company' }).some((n) => n.id === 'business-loss-streak'));
  assert.ok(!computeNotices(data, TODAY, { kind: 'personal' }).some((n) => n.id.startsWith('business-')));
  assert.ok(!computeNotices(data, TODAY, { kind: 'freelancer' }).some((n) => n.id.startsWith('business-')));
  assert.ok(!computeNotices(data, TODAY).some((n) => n.id.startsWith('business-')));
});

test('el espacio de negocio y el personal no se mezclan: Resultados solo ve el suyo', async () => {
  const { store } = await space('entrepreneur', 'Tienda');
  must(await store.saveMovement(movement({ type: 'income', amountText: '500', date: '2026-11-02', categoryId: 'cat-inc-ventas' })));
  const bizId = store.getState().activeWorkspaceId;
  must(await store.createWorkspace({ kind: 'personal', name: 'Yo' }));
  assert.equal(store.getState().data.movements.length, 0);
  must(await store.saveMovement(movement({ type: 'expense', amountText: '40', date: '2026-11-03' })));
  must(await store.switchWorkspace(/** @type {string} */ (bizId)));
  assert.equal(store.getState().data.movements.length, 1);
  assert.equal(store.getState().data.movements[0].type, 'income');
});

test('demostración: en un espacio de negocio es un negocio inventado y se borra sin dejar nada', async () => {
  const { store } = await space('entrepreneur', 'Tienda');
  const real = must(await store.saveMovement(movement({ type: 'income', amountText: '123', date: '2026-11-02', categoryId: 'cat-inc-ventas', description: 'Venta real' })));
  must(await store.loadDemoData());
  const { data } = store.getState();
  assert.ok(data.movements.some((m) => m.isDemo && m.description.includes('Ventas de la semana')));
  assert.ok(!data.movements.some((m) => m.description.includes('Salario')), 'no es la demostración personal');
  assert.equal(data.goals.length + data.debts.length + data.assets.length, 0);
  assert.ok(data.movements.every((m) => m.date <= TODAY));
  must(await store.removeDemoData());
  const after = store.getState().data;
  assert.deepEqual(after.movements.map((m) => m.id), [real.movement.id]);
});

test('demostración: en un espacio Personal sigue siendo la personal', async () => {
  const { store } = await space('personal', 'Yo');
  must(await store.loadDemoData());
  const { data } = store.getState();
  assert.ok(data.movements.some((m) => m.description.includes('Salario')));
  assert.ok(data.goals.length > 0);
});
