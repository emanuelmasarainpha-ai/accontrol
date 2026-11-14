// Pruebas del "cerebro" de la app: acciones, guardado y reglas de integridad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/data/memoryStore.js';
import { createStore } from '../src/app/store.js';
import { overallTotals } from '../src/domain/summaries.js';
import { goalSavedCents } from '../src/domain/goals.js';

const fixedNow = new Date(2026, 6, 20, 15, 30); // 20 jul 2026, 15:30 hora local
const TODAY = '2026-07-20';

async function setup() {
  const dataStore = createMemoryStore();
  const store = createStore(dataStore, () => fixedNow);
  await store.init();
  return { store, dataStore };
}

const expense = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'expense', amountText: '800', date: TODAY, time: '14:30',
  description: 'Protector solar', classification: 'variable', categoryId: 'cat-exp-salud', ...over,
});
const income = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'income', amountText: '5000', date: TODAY, time: '09:00',
  description: 'Entrenamiento personal', classification: 'variable', categoryId: 'cat-inc-ventas', ...over,
});
const goalInput = (/** @type {Record<string,string>} */ over = {}) => ({
  name: 'Laptop', description: '', targetText: '60000', targetDate: '2026-12-20', ...over,
});
const deposit = (/** @type {string} */ amountText, /** @type {string} */ kind = 'deposit') => ({
  kind, amountText, date: TODAY, time: '10:00', note: '',
});

test('arranque: carga categorías de fábrica y queda listo', async () => {
  const { store } = await setup();
  const s = store.getState();
  assert.equal(s.status, 'ready');
  assert.ok(s.data.categories.length > 15);
  assert.equal(s.data.movements.length, 0);
});

test('si el almacenamiento falla al cargar, la app muestra un error (no una pantalla vacía)', async () => {
  const broken = createMemoryStore();
  broken.load = async () => { throw new Error('IndexedDB no disponible'); };
  const store = createStore(broken, () => fixedNow);
  await store.init();
  assert.equal(store.getState().status, 'error');
  assert.match(store.getState().error, /IndexedDB/);
});

test('crear, editar y borrar un movimiento (persiste en el almacén)', async () => {
  const { store, dataStore } = await setup();
  const created = await store.saveMovement(expense());
  assert.ok(created.ok);
  if (!created.ok) return;
  assert.equal(store.getState().data.movements.length, 1);
  assert.equal((await dataStore.load()).movements.length, 1, 'debe estar guardado de verdad');

  const edited = await store.saveMovement(expense({ amountText: '950.50', description: 'Protector solar FPS 50' }), created.movement.id);
  assert.ok(edited.ok);
  const [m] = store.getState().data.movements;
  assert.equal(m.id, created.movement.id);
  assert.equal(m.amountCents, 95050);
  assert.equal(m.description, 'Protector solar FPS 50');
  assert.equal((await dataStore.load()).movements[0].amountCents, 95050);

  assert.ok((await store.deleteMovement(m.id)).ok);
  assert.equal(store.getState().data.movements.length, 0);
  assert.equal((await dataStore.load()).movements.length, 0);
  assert.ok(!(await store.deleteMovement(m.id)).ok, 'borrar dos veces falla con mensaje claro');
});

test('al editar, el tipo no puede cambiarse', async () => {
  const { store } = await setup();
  const created = await store.saveMovement(expense());
  assert.ok(created.ok);
  if (!created.ok) return;
  // Se intenta convertir en ingreso con una categoría de ingreso: se ignora el tipo nuevo y falla la categoría.
  const r = await store.saveMovement(income(), created.movement.id);
  assert.ok(!r.ok);
  assert.equal(store.getState().data.movements[0].type, 'expense');
});

test('validación: los errores no guardan nada', async () => {
  const { store, dataStore } = await setup();
  const r = await store.saveMovement(expense({ amountText: '0', date: '2026-07-21', description: '' }));
  assert.ok(!r.ok);
  if (!r.ok) for (const f of ['amount', 'date', 'description']) assert.ok(r.errors[f]);
  assert.equal(store.getState().data.movements.length, 0);
  assert.equal((await dataStore.load()).movements.length, 0);
});

test('si el guardado falla, la pantalla NO muestra el cambio', async () => {
  const { store, dataStore } = await setup();
  dataStore.failNextWrite();
  const r = await store.saveMovement(expense());
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.form, /No se pudo guardar/);
  assert.equal(store.getState().data.movements.length, 0, 'no debe aparecer como guardado');
  // Y la siguiente operación funciona con normalidad.
  assert.ok((await store.saveMovement(expense())).ok);
  assert.equal(store.getState().data.movements.length, 1);
});

test('categoría nueva creada desde el formulario de movimiento', async () => {
  const { store } = await setup();
  const r = await store.saveMovement(expense({ categoryId: '', newCategoryName: 'Mascotas' }));
  assert.ok(r.ok);
  const { categories, movements } = store.getState().data;
  const cat = categories.find((c) => c.name === 'Mascotas');
  assert.ok(cat && cat.kind === 'expense' && !cat.builtIn);
  assert.equal(movements[0].categoryId, cat.id);
});

test('categorías propias: renombrar y borrar solo si no se usan; las de fábrica son fijas', async () => {
  const { store } = await setup();
  const created = await store.saveCategory({ name: 'Mascotas', kind: 'expense', defaultClassification: 'variable' });
  assert.ok(created.ok);
  if (!created.ok) return;
  assert.ok(!(await store.saveCategory({ name: 'mascotas', kind: 'expense', defaultClassification: 'variable' })).ok, 'duplicado');
  assert.ok((await store.saveCategory({ name: 'Animales', kind: 'expense', defaultClassification: 'variable' }, created.category.id)).ok);
  assert.ok(!(await store.saveCategory({ name: 'Otro', kind: 'expense', defaultClassification: 'fixed' }, 'cat-exp-ropa')).ok);

  await store.saveMovement(expense({ categoryId: created.category.id }));
  const blocked = await store.deleteCategory(created.category.id);
  assert.ok(!blocked.ok && /1 movimiento/.test(blocked.errors.form));
  assert.ok(!(await store.deleteCategory('cat-exp-ropa')).ok);

  const [m] = store.getState().data.movements;
  await store.deleteMovement(m.id);
  assert.ok((await store.deleteCategory(created.category.id)).ok);
});

test('metas: aportes, retiros y el dinero disponible', async () => {
  const { store } = await setup();
  await store.saveSettings({ displayName: 'Ana', openingText: '1000' });
  await store.saveMovement(income({ amountText: '5000' }));
  await store.saveMovement(expense({ amountText: '800' }));
  const g = await store.saveGoal(goalInput());
  assert.ok(g.ok);
  if (!g.ok) return;

  assert.ok((await store.saveContribution(g.goal.id, deposit('1500'))).ok);
  assert.ok(!(await store.saveContribution(g.goal.id, deposit('2000', 'withdrawal'))).ok, 'no se puede retirar más de lo ahorrado');
  assert.ok((await store.saveContribution(g.goal.id, deposit('500', 'withdrawal'))).ok);

  const data = store.getState().data;
  assert.equal(goalSavedCents(g.goal.id, data.contributions), 100_000);
  // 1,000 inicial + 5,000 - 800 - 1,000 apartados = 4,200
  assert.equal(overallTotals(data, TODAY).availableCents, 420_000);
});

test('no se puede borrar un aporte si hay retiros que dependen de él', async () => {
  const { store } = await setup();
  await store.saveMovement(income({ amountText: '5000' }));
  const g = await store.saveGoal(goalInput());
  assert.ok(g.ok);
  if (!g.ok) return;
  const a = await store.saveContribution(g.goal.id, deposit('1000'));
  await store.saveContribution(g.goal.id, deposit('600', 'withdrawal'));
  assert.ok(a.ok);
  if (!a.ok) return;
  const r = await store.deleteContribution(a.contribution.id);
  assert.ok(!r.ok && /retiros posteriores/.test(r.errors.form));
  assert.equal(store.getState().data.contributions.length, 2);
});

test('borrar una meta borra sus aportes y devuelve el dinero a disponible', async () => {
  const { store, dataStore } = await setup();
  await store.saveMovement(income({ amountText: '5000' }));
  const g = await store.saveGoal(goalInput());
  assert.ok(g.ok);
  if (!g.ok) return;
  await store.saveContribution(g.goal.id, deposit('2000'));
  assert.equal(overallTotals(store.getState().data, TODAY).availableCents, 300_000);

  const r = await store.deleteGoal(g.goal.id);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.removedContributions, 1);
  assert.equal(overallTotals(store.getState().data, TODAY).availableCents, 500_000);
  assert.equal((await dataStore.load()).contributions.length, 0, 'no deben quedar aportes huérfanos');
});

test('demostración: se carga etiquetada y se borra sin tocar datos reales', async () => {
  const { store } = await setup();
  assert.equal(store.hasDemoData(), false);
  await store.saveMovement(income({ description: 'Mi ingreso real' }));
  const realGoal = await store.saveGoal(goalInput({ name: 'Mi meta real' }));
  assert.ok(realGoal.ok);

  assert.ok((await store.loadDemoData()).ok);
  assert.equal(store.hasDemoData(), true);
  assert.ok(!(await store.loadDemoData()).ok, 'no se cargan dos veces');
  const demoGoal = store.getState().data.goals.find((g) => g.isDemo);
  assert.ok(demoGoal);
  // Un aporte nuevo a una meta de demostración también queda marcado como demostración.
  const extra = await store.saveContribution(demoGoal.id, deposit('100'));
  assert.ok(extra.ok && extra.contribution.isDemo === true);

  assert.ok((await store.removeDemoData()).ok);
  const d = store.getState().data;
  assert.equal(store.hasDemoData(), false);
  assert.equal(d.movements.length, 1);
  assert.equal(d.movements[0].description, 'Mi ingreso real');
  assert.deepEqual(d.goals.map((g) => g.name), ['Mi meta real']);
  assert.equal(d.contributions.length, 0, 'no quedan aportes huérfanos');
});

test('respaldo: exportar, borrar todo y restaurar deja los mismos datos', async () => {
  const { store } = await setup();
  await store.saveSettings({ displayName: 'Ana', openingText: '250.50' });
  await store.saveMovement(income());
  await store.saveMovement(expense());
  const g = await store.saveGoal(goalInput());
  assert.ok(g.ok);
  if (!g.ok) return;
  await store.saveContribution(g.goal.id, deposit('700'));
  const before = structuredClone(store.getState().data);

  const { fileName, json } = store.exportBackup();
  assert.equal(fileName, 'accontrol-respaldo-2026-07-20.json');

  assert.ok((await store.clearAllData()).ok);
  const empty = store.getState().data;
  assert.equal(empty.movements.length + empty.goals.length + empty.contributions.length, 0);
  assert.equal(empty.settings.displayName, '');
  assert.ok(empty.categories.length > 15, 'las categorías de fábrica vuelven');

  assert.ok((await store.importBackup(json)).ok);
  assert.deepEqual(store.getState().data, before);
});

test('importar un archivo dañado no cambia nada', async () => {
  const { store, dataStore } = await setup();
  await store.saveMovement(income());
  const r = await store.importBackup('{"app":"accontrol","schemaVersion":1,"data":{}}');
  assert.ok(!r.ok);
  assert.equal(store.getState().data.movements.length, 1);
  assert.equal((await dataStore.load()).movements.length, 1);
});

test('las acciones simultáneas se ejecutan en orden y no se pisan', async () => {
  const { store } = await setup();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => store.saveMovement(expense({ amountText: String(i + 1), description: `Gasto ${i + 1}` }))),
  );
  assert.ok(results.every((r) => r.ok));
  assert.equal(store.getState().data.movements.length, 10);
});

test('los suscriptores reciben aviso en cada cambio', async () => {
  const { store } = await setup();
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  await store.saveMovement(expense());
  assert.equal(calls, 1);
  stop();
  await store.saveMovement(expense());
  assert.equal(calls, 1);
});

test('ajustes: saldo inicial y nombre se validan', async () => {
  const { store } = await setup();
  assert.ok(!(await store.saveSettings({ displayName: 'x'.repeat(41), openingText: '' })).ok);
  assert.ok(!(await store.saveSettings({ displayName: 'Ana', openingText: '1.500' })).ok);
  assert.ok((await store.saveSettings({ displayName: ' Ana  María ', openingText: '' })).ok);
  assert.equal(store.getState().data.settings.displayName, 'Ana María');
  assert.equal(store.getState().data.settings.openingBalanceCents, 0);
});

// ---------------------------------------------------------------------------
// Revisión independiente: dos pestañas/ventanas sobre los MISMOS datos guardados
// ---------------------------------------------------------------------------

async function twoTabs() {
  const dataStore = createMemoryStore();
  const a = createStore(dataStore, () => fixedNow);
  const b = createStore(dataStore, () => fixedNow);
  await a.init();
  await b.init();
  return { a, b, dataStore };
}

test('pestaña con datos viejos: aportar a una meta borrada en otra pestaña se rechaza (sin aporte huérfano)', async () => {
  const { a, b, dataStore } = await twoTabs();
  const g = await a.saveGoal(goalInput());
  assert.ok(g.ok);
  if (!g.ok) return;
  await b.refresh(); // B ve la meta
  assert.ok((await a.deleteGoal(g.goal.id)).ok); // A la borra; B todavía la "ve"
  const result = await b.saveContribution(g.goal.id, deposit('100'));
  assert.equal(result.ok, false);
  const saved = await dataStore.load();
  assert.equal(saved.contributions.length, 0, 'no debe quedar un aporte huérfano guardado');
});

test('pestaña con datos viejos: no se puede borrar un aporte del que depende un retiro hecho en otra pestaña', async () => {
  const { a, b, dataStore } = await twoTabs();
  await a.saveMovement(income({ amountText: '5000' }));
  const g = await a.saveGoal(goalInput());
  if (!g.ok) return assert.fail('meta');
  const dep = await a.saveContribution(g.goal.id, deposit('1000'));
  assert.ok(dep.ok);
  await b.refresh();
  assert.ok((await a.saveContribution(g.goal.id, deposit('500', 'withdrawal'))).ok); // A retira 500; B no lo sabe
  if (!dep.ok) return;
  const result = await b.deleteContribution(dep.contribution.id);
  assert.equal(result.ok, false);
  const saved = await dataStore.load();
  assert.equal(goalSavedCents(g.goal.id, saved.contributions), 50_000);
});

test('refresh() trae a esta pestaña lo guardado por otra', async () => {
  const { a, b } = await twoTabs();
  assert.ok((await a.saveMovement(expense())).ok);
  assert.equal(b.getState().data.movements.length, 0);
  await b.refresh();
  assert.equal(b.getState().data.movements.length, 1);
});

test('refresh() sigue trayendo datos cuando la tarea anterior de la fila terminó con null (0.15.0, paso 6)', async () => {
  // Error real hallado en el navegador: la fila le pasaba a refresh el resultado anterior (null) como opciones y la
  // relectura fallaba en silencio; lo bajado de la nube no aparecía en pantalla hasta recargar.
  const { a, b } = await twoTabs();
  assert.equal(await b.refresh(), null); // la primera relectura termina con null
  assert.ok((await a.saveMovement(expense())).ok);
  assert.equal(await b.refresh(), null, 'la segunda relectura seguida no debe fallar');
  assert.equal(b.getState().data.movements.length, 1);
  assert.ok((await a.saveMovement(expense({ amountText: '75' }))).ok);
  await b.refresh();
  assert.equal(b.getState().data.movements.length, 2);
});

test('onWrite avisa solo cuando algo se guardó de verdad', async () => {
  const { store, dataStore } = await setup();
  let calls = 0;
  store.onWrite(() => { calls += 1; });
  assert.ok((await store.saveMovement(expense())).ok);
  assert.equal(calls, 1);
  assert.equal((await store.saveMovement(expense({ amountText: 'abc' }))).ok, false); // validación falla: no se escribe
  assert.equal(calls, 1);
  dataStore.failNextWrite();
  assert.equal((await store.saveMovement(expense())).ok, false); // el almacén falla: tampoco se avisa
  assert.equal(calls, 1);
});

test('un aporte no se puede mover a otra meta al editarlo', async () => {
  const { store } = await setup();
  await store.saveMovement(income({ amountText: '5000' }));
  const g1 = await store.saveGoal(goalInput({ name: 'A' }));
  const g2 = await store.saveGoal(goalInput({ name: 'B' }));
  if (!g1.ok || !g2.ok) return assert.fail('metas');
  const dep = await store.saveContribution(g1.goal.id, deposit('1000'));
  const wd = await store.saveContribution(g1.goal.id, deposit('900', 'withdrawal'));
  assert.ok(dep.ok && wd.ok);
  if (!dep.ok) return;
  // Intento de mudar el aporte a la meta B para "liberar" la meta A en negativo.
  const moved = await store.saveContribution(g2.goal.id, deposit('1000'), dep.contribution.id);
  assert.equal(moved.ok, false);
  assert.equal(goalSavedCents(g1.goal.id, store.getState().data.contributions), 10_000);
});

// ---------------------------------------------------------------------------
// Aportes que superan el dinero disponible: la app pregunta de dónde sale la diferencia
// ---------------------------------------------------------------------------

test('aporte mayor al disponible: se rechaza con needsFunds y no guarda nada', async () => {
  const { store, dataStore } = await setup();
  await store.saveSettings({ displayName: 'Ana', openingText: '1000' });
  await store.saveMovement(income({ amountText: '6000' })); // disponible: 7,000
  const g = await store.saveGoal(goalInput());
  if (!g.ok) return assert.fail('meta');

  const r = await store.saveContribution(g.goal.id, deposit('10000'));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.needsFunds, { availableCents: 700_000, shortfallCents: 300_000 });
  assert.match(r.errors.amount, /supera tu dinero disponible/);
  assert.equal((await dataStore.load()).contributions.length, 0, 'nada guardado');
  assert.equal(overallTotals(store.getState().data, TODAY).availableCents, 700_000);
});

test('aporte exacto al disponible: se permite sin preguntar', async () => {
  const { store } = await setup();
  await store.saveMovement(income({ amountText: '7000' }));
  const g = await store.saveGoal(goalInput());
  if (!g.ok) return assert.fail('meta');
  const r = await store.saveContribution(g.goal.id, deposit('7000'));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.coveredCents, 0);
  assert.equal(overallTotals(store.getState().data, TODAY).availableCents, 0);
});

test('aporte con dinero sin registrar: el usuario confirma y la diferencia queda como ingreso', async () => {
  const { store, dataStore } = await setup();
  await store.saveMovement(income({ amountText: '7000' }));
  const g = await store.saveGoal(goalInput({ name: 'Laptop' }));
  if (!g.ok) return assert.fail('meta');

  const r = await store.saveContribution(g.goal.id, deposit('10000'), null, { coverShortfall: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.coveredCents, 300_000);

  const d = store.getState().data;
  const extra = d.movements.find((m) => m.description.includes('Laptop'));
  assert.ok(extra, 'se registra el ingreso');
  assert.equal(extra.type, 'income');
  assert.equal(extra.amountCents, 300_000);
  assert.equal(extra.classification, 'extraordinary');
  assert.equal(extra.categoryId, 'cat-inc-otros');
  assert.equal(goalSavedCents(g.goal.id, d.contributions), 1_000_000);
  assert.equal(overallTotals(d, TODAY).availableCents, 0, 'queda en cero, nunca en negativo');

  const saved = await dataStore.load();
  assert.equal(saved.movements.length, 2);
  assert.equal(saved.contributions.length, 1);
});

test('aporte con cobertura: si falla el guardado no queda ni el ingreso ni el aporte', async () => {
  const { store, dataStore } = await setup();
  await store.saveMovement(income({ amountText: '1000' }));
  const g = await store.saveGoal(goalInput());
  if (!g.ok) return assert.fail('meta');
  dataStore.failNextWrite();
  const r = await store.saveContribution(g.goal.id, deposit('3000'), null, { coverShortfall: true });
  assert.equal(r.ok, false);
  assert.equal(store.getState().data.movements.length, 1);
  assert.equal(store.getState().data.contributions.length, 0);
  assert.equal((await dataStore.load()).movements.length, 1);
});

test('editar un aporte a una cantidad menor nunca pide fondos aunque el disponible ya sea negativo', async () => {
  const { store } = await setup();
  await store.saveMovement(income({ amountText: '5000' }));
  const g = await store.saveGoal(goalInput());
  if (!g.ok) return assert.fail('meta');
  const a = await store.saveContribution(g.goal.id, deposit('4000'));
  assert.ok(a.ok);
  if (!a.ok) return;
  // Un gasto grande deja el disponible en negativo (los gastos sí se permiten, con aviso en pantalla).
  assert.ok((await store.saveMovement(expense({ amountText: '3000' }))).ok);
  assert.ok(overallTotals(store.getState().data, TODAY).availableCents < 0);
  const lower = await store.saveContribution(g.goal.id, deposit('3500'), a.contribution.id);
  assert.ok(lower.ok, 'reducir el aporte mejora el disponible');
  const higher = await store.saveContribution(g.goal.id, deposit('4500'), a.contribution.id);
  assert.equal(higher.ok, false, 'aumentarlo empeoraría un disponible ya negativo');
});

test('los retiros de meta nunca piden fondos (devuelven dinero al disponible)', async () => {
  const { store } = await setup();
  await store.saveMovement(income({ amountText: '2000' }));
  const g = await store.saveGoal(goalInput());
  if (!g.ok) return assert.fail('meta');
  assert.ok((await store.saveContribution(g.goal.id, deposit('2000'))).ok);
  assert.ok((await store.saveContribution(g.goal.id, deposit('800', 'withdrawal'))).ok);
  assert.equal(overallTotals(store.getState().data, TODAY).availableCents, 80_000);
});

test('crear categoría valida tipo y clasificación', async () => {
  const { store } = await setup();
  const bad1 = await store.saveCategory({ name: 'Rara', kind: /** @type {any} */ ('foo'), defaultClassification: 'bar' });
  assert.equal(bad1.ok, false);
  const bad2 = await store.saveCategory({ name: 'Rara', kind: 'income', defaultClassification: 'discretionary' });
  assert.equal(bad2.ok, false, 'discrecional no existe para ingresos');
  const ok = await store.saveCategory({ name: 'Rara', kind: 'income', defaultClassification: 'variable' });
  assert.ok(ok.ok);
});

test('datos de demostración: si faltan categorías de fábrica se añaden (nada queda sin categoría)', async () => {
  const dataStore = createMemoryStore({ categories: [] });
  const store = createStore(dataStore, () => fixedNow);
  await store.init();
  assert.equal(store.getState().data.categories.length, 0);
  assert.ok((await store.loadDemoData()).ok);
  const { categories, movements } = store.getState().data;
  for (const m of movements) assert.ok(categories.some((c) => c.id === m.categoryId), `falta la categoría de ${m.description}`);
  assert.deepEqual((await dataStore.load()).categories.length, categories.length, 'también se guardaron');
});

test('importar un respaldo sin categorías de fábrica las repone', async () => {
  const { store } = await setup();
  const json = store.exportBackup().json;
  const stripped = JSON.parse(json);
  stripped.data.categories = [];
  const result = await store.importBackup(JSON.stringify(stripped));
  assert.ok(result.ok);
  assert.ok(store.getState().data.categories.length > 15);
});

// ---------------------------------------------------------------------------
// Deudas (Etapa 3): cada pago crea su gasto vinculado en la misma operación
// ---------------------------------------------------------------------------

const debtInput = (/** @type {Record<string,string>} */ over = {}) => ({
  name: 'Préstamo del banco', note: '', totalText: '100000', rateText: '12', rateBasis: 'annual', frequency: 'monthly',
  collateralKind: 'personal', collateralType: 'prestamo-personal',
  firstDueDate: '2026-07-01', firstDueTime: '09:00', finalDueDate: '2027-06-01', finalDueTime: '09:00', ...over,
});
const payInput = (/** @type {Record<string,string>} */ over = {}) => ({
  kind: 'regular', amountText: '8884.88', date: TODAY, time: '11:00', note: '', ...over,
});

test('deudas: crear valida los datos y no guarda nada si hay errores', async () => {
  const { store, dataStore } = await setup();
  const bad = await store.saveDebt(debtInput({ name: '', totalText: 'abc' }));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.name && bad.errors.total);
  assert.equal((await dataStore.load()).debts.length, 0);

  const ok = await store.saveDebt(debtInput());
  assert.ok(ok.ok);
  assert.equal(store.getState().data.debts.length, 1);
  assert.equal((await dataStore.load()).debts.length, 1);
});

test('deudas: un pago crea su gasto vinculado y la categoría "Pago de deudas" (también en datos antiguos sin ella)', async () => {
  const dataStore = createMemoryStore();
  const store = createStore(dataStore, () => fixedNow);
  await store.init();
  // Datos "de la versión 1": sin la categoría de deudas.
  const withoutCat = store.getState().data.categories.filter((c) => c.id !== 'cat-exp-deudas');
  const old = createMemoryStore({ categories: withoutCat });
  const s = createStore(old, () => fixedNow);
  await s.init();
  assert.ok(!s.getState().data.categories.some((c) => c.id === 'cat-exp-deudas'));

  await s.saveMovement(income({ amountText: '50000' }));
  const d = await s.saveDebt(debtInput());
  if (!d.ok) return assert.fail('deuda');
  const p = await s.saveDebtPayment(d.debt.id, payInput());
  assert.ok(p.ok);
  if (!p.ok) return;

  assert.equal(p.movement.type, 'expense');
  assert.equal(p.movement.amountCents, 888_488);
  assert.equal(p.movement.categoryId, 'cat-exp-deudas');
  assert.match(p.movement.description, /^Cuota: Préstamo del banco/);
  assert.equal(p.payment.movementId, p.movement.id);
  assert.ok(s.getState().data.categories.some((c) => c.id === 'cat-exp-deudas'), 'categoría creada');

  const saved = await old.load();
  assert.equal(saved.debtPayments.length, 1);
  assert.ok(saved.movements.some((m) => m.id === p.movement.id));
  assert.ok(saved.categories.some((c) => c.id === 'cat-exp-deudas'));
  // 50,000 - 8,884.88
  assert.equal(overallTotals(s.getState().data, TODAY).availableCents, 4_111_512);
});

test('deudas: el gasto vinculado a un pago no se puede editar ni borrar por separado', async () => {
  const { store } = await setup();
  const d = await store.saveDebt(debtInput());
  if (!d.ok) return assert.fail('deuda');
  const p = await store.saveDebtPayment(d.debt.id, payInput());
  if (!p.ok) return assert.fail('pago');

  const edit = await store.saveMovement(expense({ amountText: '1' }), p.movement.id);
  assert.equal(edit.ok, false);
  if (!edit.ok) assert.match(edit.errors.form, /pago de una deuda/i);
  const del = await store.deleteMovement(p.movement.id);
  assert.equal(del.ok, false);
  assert.equal(store.getState().data.movements.length, 1, 'el gasto sigue ahí');
});

test('deudas: editar un pago actualiza su gasto; borrarlo devuelve el dinero', async () => {
  const { store, dataStore } = await setup();
  await store.saveMovement(income({ amountText: '50000' }));
  const d = await store.saveDebt(debtInput());
  if (!d.ok) return assert.fail('deuda');
  const p = await store.saveDebtPayment(d.debt.id, payInput({ amountText: '8884.88' }));
  if (!p.ok) return assert.fail('pago');

  const edited = await store.saveDebtPayment(d.debt.id, payInput({ amountText: '9000' }), p.payment.id);
  assert.ok(edited.ok);
  const data = store.getState().data;
  assert.equal(data.debtPayments.length, 1);
  assert.equal(data.movements.filter((m) => m.categoryId === 'cat-exp-deudas').length, 1, 'sin gastos duplicados');
  assert.equal(data.movements.find((m) => m.id === p.movement.id)?.amountCents, 900_000);

  assert.ok((await store.deleteDebtPayment(p.payment.id)).ok);
  const after = store.getState().data;
  assert.equal(after.debtPayments.length, 0);
  assert.equal(after.movements.some((m) => m.id === p.movement.id), false);
  assert.equal(overallTotals(after, TODAY).availableCents, 5_000_000);
  const saved = await dataStore.load();
  assert.equal(saved.debtPayments.length, 0);
  assert.equal(saved.movements.length, 1, 'solo queda el ingreso');
});

test('deudas: un pago que supera lo adeudado se rechaza y no deja nada guardado', async () => {
  const { store, dataStore } = await setup();
  const d = await store.saveDebt(debtInput({ totalText: '1000', rateText: '0', finalDueDate: '2026-08-01' }));
  if (!d.ok) return assert.fail('deuda');
  const r = await store.saveDebtPayment(d.debt.id, payInput({ amountText: '1500' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors.amount, /supera/);
  const saved = await dataStore.load();
  assert.equal(saved.debtPayments.length, 0);
  assert.equal(saved.movements.length, 0);
});

test('deudas: no se puede reducir la deuda por debajo de lo que ya pagaste (y borrar un pago anterior sí se puede)', async () => {
  const { store } = await setup();
  const d = await store.saveDebt(debtInput({ totalText: '1000', rateText: '0', finalDueDate: '2026-08-01' }));
  if (!d.ok) return assert.fail('deuda');
  const first = await store.saveDebtPayment(d.debt.id, payInput({ amountText: '400', date: '2026-07-10' }));
  assert.ok((await store.saveDebtPayment(d.debt.id, payInput({ amountText: '600', date: '2026-07-15', kind: 'extra' }))).ok);
  if (!first.ok) return assert.fail('pago');

  // Con 1,000 pagados, bajar la deuda a 500 dejaría pagos que no caben.
  const shrink = await store.saveDebt(debtInput({ totalText: '500', rateText: '0', finalDueDate: '2026-08-01' }), d.debt.id);
  assert.equal(shrink.ok, false);
  if (!shrink.ok) assert.match(shrink.errors.form, /pagos que ya registraste/);
  assert.equal(store.getState().data.debts[0].totalCents, 100_000, 'la deuda no cambió');

  // Borrar un pago anterior solo aumenta el saldo pendiente, así que es seguro.
  assert.ok((await store.deleteDebtPayment(first.payment.id)).ok);
  assert.equal(store.getState().data.debtPayments.length, 1);
});

test('deudas: renombrar una deuda renombra los gastos de sus pagos', async () => {
  const { store } = await setup();
  const d = await store.saveDebt(debtInput());
  if (!d.ok) return assert.fail('deuda');
  const p = await store.saveDebtPayment(d.debt.id, payInput());
  if (!p.ok) return assert.fail('pago');
  assert.ok((await store.saveDebt(debtInput({ name: 'Mi préstamo' }), d.debt.id)).ok);
  const m = store.getState().data.movements.find((x) => x.id === p.movement.id);
  assert.match(m?.description ?? '', /^Cuota: Mi préstamo/);
});

test('deudas: borrar una deuda borra sus pagos y gastos vinculados y devuelve el dinero', async () => {
  const { store, dataStore } = await setup();
  await store.saveMovement(income({ amountText: '50000' }));
  const d = await store.saveDebt(debtInput());
  if (!d.ok) return assert.fail('deuda');
  assert.ok((await store.saveDebtPayment(d.debt.id, payInput())).ok);
  assert.ok((await store.saveDebtPayment(d.debt.id, payInput({ amountText: '1000', kind: 'extra', time: '12:00' }))).ok);

  const r = await store.deleteDebt(d.debt.id);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.removedPayments, 2);
    assert.equal(r.removedCents, 888_488 + 100_000);
  }
  const data = store.getState().data;
  assert.equal(data.debts.length, 0);
  assert.equal(data.debtPayments.length, 0);
  assert.equal(data.movements.length, 1, 'solo queda el ingreso');
  assert.equal(overallTotals(data, TODAY).availableCents, 5_000_000);
  const saved = await dataStore.load();
  assert.equal(saved.debts.length + saved.debtPayments.length, 0);
  assert.equal(saved.movements.length, 1);
});

test('deudas: si el guardado falla no queda ni el pago ni el gasto', async () => {
  const { store, dataStore } = await setup();
  const d = await store.saveDebt(debtInput());
  if (!d.ok) return assert.fail('deuda');
  dataStore.failNextWrite();
  const r = await store.saveDebtPayment(d.debt.id, payInput());
  assert.equal(r.ok, false);
  assert.equal(store.getState().data.debtPayments.length, 0);
  assert.equal(store.getState().data.movements.length, 0);
  assert.equal((await dataStore.load()).movements.length, 0);
});

test('deudas: pestaña con datos viejos — pagar una deuda borrada en otra pestaña se rechaza', async () => {
  const { a, b, dataStore } = await twoTabs();
  const d = await a.saveDebt(debtInput());
  if (!d.ok) return assert.fail('deuda');
  await b.refresh();
  assert.ok((await a.deleteDebt(d.debt.id)).ok);
  const r = await b.saveDebtPayment(d.debt.id, payInput());
  assert.equal(r.ok, false);
  const saved = await dataStore.load();
  assert.equal(saved.debtPayments.length, 0);
  assert.equal(saved.movements.length, 0, 'no queda un gasto huérfano');
});

test('deudas: la demostración incluye deudas y se quita completa sin tocar lo real', async () => {
  const { store } = await setup();
  await store.saveMovement(income({ description: 'Mi ingreso real', amountText: '1000' }));
  const real = await store.saveDebt(debtInput({ name: 'Mi deuda real' }));
  assert.ok(real.ok);
  assert.ok((await store.loadDemoData()).ok);
  const demoDebts = store.getState().data.debts.filter((x) => x.isDemo);
  assert.ok(demoDebts.length >= 2, 'hay deudas de demostración');
  const demoPayment = await store.saveDebtPayment(demoDebts[0].id, payInput({ amountText: '10', kind: 'extra' }));
  assert.ok(demoPayment.ok && demoPayment.payment.isDemo === true && demoPayment.movement.isDemo === true);

  assert.ok((await store.removeDemoData()).ok);
  const d = store.getState().data;
  assert.deepEqual(d.debts.map((x) => x.name), ['Mi deuda real']);
  assert.equal(d.debtPayments.length, 0);
  assert.deepEqual(d.movements.map((m) => m.description), ['Mi ingreso real']);
});

// ---------------------------------------------------------------- activos (Etapa 4)

const assetInput = (/** @type {Record<string,string>} */ over = {}) => ({
  name: 'Mi carro', category: 'vehicles', subtype: 'car', description: '', valueText: '500,000', acquiredDate: '2026-03-10', ...over,
});

test('activos: crear guarda el valor inicial en la fecha de adquisición', async () => {
  const { store, dataStore } = await setup();
  const r = await store.saveAsset(assetInput());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.asset.valuations, [{ date: '2026-03-10', valueCents: 50_000_000 }]);
  assert.equal(store.getState().data.assets.length, 1);
  assert.equal((await dataStore.load()).assets.length, 1, 'quedó guardado en el almacén');
});

test('activos: con errores no se guarda nada', async () => {
  const { store, dataStore } = await setup();
  const r = await store.saveAsset(assetInput({ name: '', valueText: '0', acquiredDate: '2999-01-01' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.name && r.errors.value && r.errors.acquiredDate);
  assert.equal((await dataStore.load()).assets.length, 0);
});

test('activos: si falla el guardado, la pantalla no cambia', async () => {
  const { store, dataStore } = await setup();
  dataStore.failNextWrite();
  const r = await store.saveAsset(assetInput());
  assert.equal(r.ok, false);
  assert.equal(store.getState().data.assets.length, 0);
});

test('activos: editar no toca el historial de valores y mueve el primer valor con la fecha', async () => {
  const { store } = await setup();
  const created = await store.saveAsset(assetInput());
  assert.ok(created.ok);
  if (!created.ok) return;
  await store.saveAssetValuation(created.asset.id, { valueText: '450,000', date: '2026-06-01' });
  const edited = await store.saveAsset(assetInput({ name: 'Carro nuevo', valueText: '1', acquiredDate: '2026-02-01' }), created.asset.id);
  assert.ok(edited.ok);
  if (!edited.ok) return;
  assert.equal(edited.asset.name, 'Carro nuevo');
  assert.deepEqual(edited.asset.valuations, [{ date: '2026-02-01', valueCents: 50_000_000 }, { date: '2026-06-01', valueCents: 45_000_000 }]);
  const tooLate = await store.saveAsset(assetInput({ acquiredDate: '2026-06-15' }), created.asset.id);
  assert.equal(tooLate.ok, false, 'no puede quedar después de un valor ya registrado');
});

test('activos: actualizar el valor agrega un punto (o reemplaza el de la misma fecha) sin reescribir el pasado', async () => {
  const { store } = await setup();
  const created = await store.saveAsset(assetInput());
  assert.ok(created.ok);
  if (!created.ok) return;
  const id = created.asset.id;
  await store.saveAssetValuation(id, { valueText: '480,000', date: '2026-05-01' });
  await store.saveAssetValuation(id, { valueText: '470,000', date: '2026-05-01' });
  const a = store.getState().data.assets[0];
  assert.deepEqual(a.valuations, [{ date: '2026-03-10', valueCents: 50_000_000 }, { date: '2026-05-01', valueCents: 47_000_000 }]);
  assert.equal((await store.saveAssetValuation(id, { valueText: '1', date: '2026-03-09' })).ok, false, 'antes de adquirirlo');
  assert.equal((await store.saveAssetValuation(id, { valueText: '1', date: '2026-07-21' })).ok, false, 'futuro');
  assert.equal((await store.saveAssetValuation('no-existe', { valueText: '1', date: TODAY })).ok, false);
});

test('activos: borrar un valor; el primero no se puede borrar', async () => {
  const { store } = await setup();
  const created = await store.saveAsset(assetInput());
  assert.ok(created.ok);
  if (!created.ok) return;
  const id = created.asset.id;
  await store.saveAssetValuation(id, { valueText: '480,000', date: '2026-05-01' });
  assert.equal((await store.deleteAssetValuation(id, '2026-03-10')).ok, false);
  assert.equal((await store.deleteAssetValuation(id, '2026-04-01')).ok, false, 'no existe');
  assert.ok((await store.deleteAssetValuation(id, '2026-05-01')).ok);
  assert.equal(store.getState().data.assets[0].valuations.length, 1);
});

test('activos: borrar el activo no toca movimientos, metas ni deudas', async () => {
  const { store, dataStore } = await setup();
  await store.saveMovement(income());
  const created = await store.saveAsset(assetInput());
  assert.ok(created.ok);
  if (!created.ok) return;
  assert.ok((await store.deleteAsset(created.asset.id)).ok);
  assert.equal(store.getState().data.assets.length, 0);
  assert.equal(store.getState().data.movements.length, 1);
  assert.equal((await dataStore.load()).assets.length, 0);
  assert.equal((await store.deleteAsset(created.asset.id)).ok, false, 'ya no existe');
});

test('activos: la demostración trae activos DEMO y al quitarla solo se van esos', async () => {
  const { store } = await setup();
  const mine = await store.saveAsset(assetInput({ name: 'Mío' }));
  assert.ok(mine.ok);
  await store.loadDemoData();
  const withDemo = store.getState().data.assets;
  assert.equal(withDemo.filter((a) => a.isDemo).length, 3);
  assert.equal(withDemo.length, 4);
  await store.removeDemoData();
  const after = store.getState().data.assets;
  assert.deepEqual(after.map((a) => a.name), ['Mío']);
});

test('activos: importar un respaldo los trae, y borrar todo los quita', async () => {
  const { store } = await setup();
  await store.saveAsset(assetInput());
  const { json } = store.exportBackup();
  await store.clearAllData();
  assert.equal(store.getState().data.assets.length, 0);
  const r = await store.importBackup(json);
  assert.ok(r.ok);
  assert.equal(store.getState().data.assets.length, 1);
  assert.equal(r.ok && r.counts.assets, 1);
});
