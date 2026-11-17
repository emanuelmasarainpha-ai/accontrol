// Pruebas del "cerebro" con varios espacios de trabajo: crear, cambiar, aislamiento, copias y borrado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { overallTotals } from '../src/domain/summaries.js';
import { LIMITS } from '../src/domain/types.js';

const fixedNow = new Date(2026, 10, 2, 15, 30); // 2 nov 2026
const TODAY = '2026-11-02';

/** Un reloj que avanza un segundo en cada lectura: así los espacios se crean en un orden claro (como en la vida real). */
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}

/** Arranca la app SIN espacios (primera vez). */
async function firstOpen() {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  return { root, store };
}

/** Arranca con «Mi espacio personal» creado. */
async function withPersonal() {
  const ctx = await firstOpen();
  const r = await ctx.store.createWorkspace({ kind: 'personal', name: 'Mi espacio personal' });
  assert.ok(r.ok);
  return ctx;
}

const expense = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'expense', amountText: '800', date: TODAY, time: '14:30',
  description: 'Compra', classification: 'variable', categoryId: 'cat-exp-otros', ...over,
});
const income = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'income', amountText: '5000', date: TODAY, time: '09:00',
  description: 'Venta', classification: 'variable', categoryId: 'cat-inc-ventas', ...over,
});

test('primera vez: sin espacios, la app queda lista esperando que se elija modalidad', async () => {
  const { store } = await firstOpen();
  const s = store.getState();
  assert.equal(s.status, 'ready');
  assert.deepEqual(s.workspaces, []);
  assert.equal(s.activeWorkspaceId, null);
  assert.equal(store.activeWorkspace(), null);
});

test('crear el primer espacio: queda abierto, predeterminado y con las categorías de fábrica', async () => {
  const { store, root } = await firstOpen();
  const r = await store.createWorkspace({ kind: 'freelancer', name: '  Diseño   gráfico ' });
  assert.ok(r.ok);
  const s = store.getState();
  assert.equal(s.workspaces.length, 1);
  assert.equal(s.workspaces[0].name, 'Diseño gráfico');
  assert.equal(s.workspaces[0].kind, 'freelancer');
  assert.equal(s.workspaces[0].isDefault, true);
  assert.equal(s.activeWorkspaceId, s.workspaces[0].id);
  assert.ok(s.data.categories.length > 15);
  assert.equal((await root.getProfile()).lastWorkspaceId, s.activeWorkspaceId);
});

test('crear espacio: valida modalidad, nombre repetido y uno de cada tipo (0.17.4)', async () => {
  const { store } = await withPersonal();
  const bad = await store.createWorkspace({ kind: 'admin', name: 'X' });
  assert.ok(!bad.ok);
  const empty = await store.createWorkspace({ kind: 'company', name: '   ' });
  assert.ok(!empty.ok && !empty.ok && empty.errors.name);
  const dup = await store.createWorkspace({ kind: 'company', name: 'mi ESPACIO personal' });
  assert.ok(!dup.ok && dup.errors.name);
  assert.equal(store.getState().workspaces.length, 1);

  for (const kind of /** @type {const} */ (['freelancer', 'entrepreneur', 'company'])) assert.ok((await store.createWorkspace({ kind, name: `Mi ${kind}` })).ok, kind);
  assert.equal(store.getState().workspaces.length, 4, 'uno de cada tipo');
  for (const kind of /** @type {const} */ (['personal', 'freelancer', 'entrepreneur', 'company'])) {
    const again = await store.createWorkspace({ kind, name: `Otro ${kind}` });
    assert.ok(!again.ok, kind);
    if (!again.ok) assert.match(again.errors.kind, /Ya tienes un espacio .* Solo puedes tener uno de cada tipo/, kind);
  }
  assert.equal(store.getState().workspaces.length, 4, 'no se creó ninguno más');
  assert.ok(LIMITS.maxWorkspaces >= 4);
});

test('aislamiento: lo registrado en un espacio no aparece en otro, y al volver sigue ahí', async () => {
  const { store } = await withPersonal();
  const personalId = /** @type {string} */ (store.getState().activeWorkspaceId);
  assert.ok((await store.saveMovement(income({ amountText: '9000' }))).ok);

  const made = await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi negocio' });
  assert.ok(made.ok);
  assert.equal(store.getState().data.movements.length, 0, 'el espacio nuevo empieza vacío');
  assert.equal(overallTotals(store.getState().data, TODAY).availableCents, 0);
  assert.ok((await store.saveMovement(expense({ amountText: '120' }))).ok);
  assert.equal(store.getState().data.movements.length, 1);

  assert.ok((await store.switchWorkspace(personalId)).ok);
  assert.equal(store.getState().data.movements.length, 1);
  assert.equal(store.getState().data.movements[0].amountCents, 900000);
  assert.equal(overallTotals(store.getState().data, TODAY).availableCents, 900000);
});

test('el saldo inicial es de cada espacio; el nombre de la persona es de todos', async () => {
  const { store } = await withPersonal();
  const a = /** @type {string} */ (store.getState().activeWorkspaceId);
  assert.ok((await store.saveSettings({ displayName: 'Ana', openingText: '1000' })).ok);
  await store.createWorkspace({ kind: 'company', name: 'Empresa ABC' });
  assert.equal(store.getState().data.settings.openingBalanceCents, 0);
  assert.equal(store.getState().data.settings.displayName, 'Ana');
  assert.ok((await store.saveSettings({ displayName: 'Ana', openingText: '250' })).ok);
  assert.equal(store.getState().workspaces.find((w) => w.id !== a)?.openingBalanceCents, 25000);
  await store.switchWorkspace(a);
  assert.equal(store.getState().data.settings.openingBalanceCents, 100000);
});

test('las categorías propias son de cada espacio', async () => {
  const { store } = await withPersonal();
  const a = /** @type {string} */ (store.getState().activeWorkspaceId);
  assert.ok((await store.saveCategory({ name: 'Gimnasio', kind: 'expense', defaultClassification: 'discretionary' }, null)).ok);
  assert.ok(store.getState().data.categories.some((c) => c.name === 'Gimnasio'));
  await store.createWorkspace({ kind: 'freelancer', name: 'Diseño' });
  assert.ok(!store.getState().data.categories.some((c) => c.name === 'Gimnasio'));
  // El mismo nombre se puede usar en otro espacio.
  assert.ok((await store.saveCategory({ name: 'Gimnasio', kind: 'expense', defaultClassification: 'discretionary' }, null)).ok);
  await store.switchWorkspace(a);
  assert.equal(store.getState().data.categories.filter((c) => c.name === 'Gimnasio').length, 1);
});

test('renombrar y elegir el predeterminado', async () => {
  const { store } = await withPersonal();
  const a = /** @type {string} */ (store.getState().activeWorkspaceId);
  await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi emprendimiento' });
  const b = /** @type {string} */ (store.getState().activeWorkspaceId);
  assert.deepEqual(store.getState().workspaces.map((w) => w.isDefault), [true, false]);

  const dup = await store.renameWorkspace(b, 'MI ESPACIO PERSONAL');
  assert.ok(!dup.ok);
  assert.ok((await store.renameWorkspace(b, 'Tienda de Ana')).ok);
  assert.equal(store.activeWorkspace()?.name, 'Tienda de Ana');
  assert.ok((await store.renameWorkspace(a, '  mi espacio personal ')).ok, 'su propio nombre no cuenta como repetido');

  assert.ok((await store.setDefaultWorkspace(b)).ok);
  assert.deepEqual(store.getState().workspaces.map((w) => w.isDefault), [false, true]);
});

test('borrar un espacio: se abre otro; el último no se puede borrar', async () => {
  const { store } = await withPersonal();
  const a = /** @type {string} */ (store.getState().activeWorkspaceId);
  assert.ok((await store.saveMovement(income())).ok);
  await store.createWorkspace({ kind: 'company', name: 'Empresa ABC' });
  const b = /** @type {string} */ (store.getState().activeWorkspaceId);
  assert.ok((await store.saveMovement(expense())).ok);

  assert.ok((await store.deleteWorkspace(b)).ok);
  assert.equal(store.getState().workspaces.length, 1);
  assert.equal(store.getState().activeWorkspaceId, a, 'se abre el que quedó');
  assert.equal(store.getState().data.movements.length, 1, 'y conserva sus datos');

  const last = await store.deleteWorkspace(a);
  assert.ok(!last.ok && last.errors.form);
  assert.equal(store.getState().workspaces.length, 1);
});

test('borrar un espacio que NO está abierto no cambia el que se está usando', async () => {
  const { store } = await withPersonal();
  const a = /** @type {string} */ (store.getState().activeWorkspaceId);
  await store.createWorkspace({ kind: 'company', name: 'Empresa ABC' });
  const b = /** @type {string} */ (store.getState().activeWorkspaceId);
  await store.switchWorkspace(a);
  assert.ok((await store.deleteWorkspace(b)).ok);
  assert.equal(store.getState().activeWorkspaceId, a);
  assert.deepEqual(store.getState().workspaces.map((w) => w.id), [a]);
});

test('arrancar de nuevo abre el último espacio usado', async () => {
  const { store, root } = await withPersonal();
  await store.createWorkspace({ kind: 'freelancer', name: 'Diseño' });
  const b = store.getState().activeWorkspaceId;
  const reopened = createStore(root, () => fixedNow);
  await reopened.init();
  assert.equal(reopened.getState().activeWorkspaceId, b);
});

test('otra pestaña borra el espacio abierto: esta pestaña pasa a otro y NO aplica el cambio pedido en silencio', async () => {
  const { store: tab1, root } = await withPersonal();
  const a = /** @type {string} */ (tab1.getState().activeWorkspaceId);
  await tab1.createWorkspace({ kind: 'entrepreneur', name: 'Mi negocio' });
  const b = /** @type {string} */ (tab1.getState().activeWorkspaceId);

  const tab2 = createStore(root, () => fixedNow);
  await tab2.init();
  assert.equal(tab2.getState().activeWorkspaceId, b);

  await tab1.switchWorkspace(a);
  assert.ok((await tab1.deleteWorkspace(b)).ok);

  const result = await tab2.saveMovement(income({ description: 'Debía ir al negocio' }));
  assert.ok(!result.ok && /ya no existe/.test(result.errors.form));
  assert.equal(tab2.getState().activeWorkspaceId, a, 'la pestaña quedó en otro espacio');
  assert.equal(tab2.getState().data.movements.length, 0, 'y el movimiento no se guardó en ninguna parte');
  assert.equal(tab1.getState().data.movements.length, 0);
});

test('otra pestaña crea el primer espacio: esta pestaña (en la pantalla de elegir) lo abre al refrescar', async () => {
  const { store: tab1, root } = await firstOpen();
  const tab2 = createStore(root, () => fixedNow);
  await tab2.init();
  assert.ok((await tab2.createWorkspace({ kind: 'personal', name: 'Mi espacio personal' })).ok);
  await tab1.refresh();
  assert.equal(tab1.getState().workspaces.length, 1);
  assert.equal(tab1.getState().activeWorkspaceId, tab2.getState().activeWorkspaceId);
});

test('un fallo al crear el espacio no deja nada a medias', async () => {
  const { store, root } = await firstOpen();
  root.failNextWrite();
  const r = await store.createWorkspace({ kind: 'personal', name: 'Mi espacio personal' });
  assert.ok(!r.ok);
  assert.deepEqual(await root.listWorkspaces(), []);
  assert.equal(store.getState().activeWorkspaceId, null);
});

test('hasDemoData también mira los activos de demostración', async () => {
  const { store } = await withPersonal();
  assert.equal(store.hasDemoData(), false);
  assert.ok((await store.loadDemoData()).ok);
  assert.equal(store.hasDemoData(), true);
  // Solo quedan activos de demostración: igual cuenta como «hay demostración» (y se puede quitar).
  const s = store.getState().data;
  assert.ok(s.assets.some((a) => a.isDemo));
  assert.ok((await store.removeDemoData()).ok);
  assert.equal(store.hasDemoData(), false);
  assert.equal(store.getState().data.assets.length, 0);
});

// ---- Copias de seguridad ------------------------------------------------------------------

test('copia de un espacio: el archivo lleva el nombre del espacio cuando hay varios', async () => {
  const { store } = await withPersonal();
  assert.equal(store.exportBackup().fileName, 'accontrol-respaldo-2026-11-02.json');
  await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi negocio' });
  assert.equal(store.exportBackup().fileName, 'accontrol-respaldo-mi-negocio-2026-11-02.json');
});

test('copia completa: borrar todo y restaurar devuelve TODOS los espacios con sus datos', async () => {
  const { store } = await withPersonal();
  assert.ok((await store.saveSettings({ displayName: 'Ana', openingText: '1000' })).ok);
  assert.ok((await store.saveMovement(income({ amountText: '9000' }))).ok);
  await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi negocio' });
  assert.ok((await store.saveMovement(expense({ amountText: '120' }))).ok);
  const businessId = store.getState().activeWorkspaceId;

  const exported = await store.exportFullBackup();
  assert.ok(exported.ok);
  if (!exported.ok) return;
  assert.equal(exported.fileName, 'accontrol-respaldo-completo-2026-11-02.json');

  const inspected = store.inspectBackup(exported.json);
  assert.ok(inspected.ok && inspected.kind === 'full');
  if (inspected.ok && inspected.kind === 'full') {
    assert.deepEqual(inspected.workspaceNames, ['Mi espacio personal', 'Mi negocio']);
    assert.equal(inspected.counts.movements, 2);
  }

  assert.ok((await store.clearAllData()).ok);
  assert.deepEqual(store.getState().workspaces, []);
  assert.equal(store.getState().activeWorkspaceId, null);

  const restored = await store.importBackup(exported.json);
  assert.ok(restored.ok);
  assert.equal(store.getState().workspaces.length, 2);
  assert.equal(store.getState().activeWorkspaceId, businessId, 'se abre el último espacio usado');
  assert.equal(store.getState().data.movements.length, 1);
  assert.equal(store.getState().profile.displayName, 'Ana');
  const personal = store.getState().workspaces.find((w) => w.name === 'Mi espacio personal');
  assert.ok(personal);
  assert.ok((await store.switchWorkspace(personal.id)).ok);
  assert.equal(store.getState().data.movements[0].amountCents, 900000);
  assert.equal(store.getState().data.settings.openingBalanceCents, 100000);
});

test('importar la copia de un espacio reemplaza solo el espacio abierto', async () => {
  const { store } = await withPersonal();
  assert.ok((await store.saveMovement(income({ amountText: '700' }))).ok);
  const backup = store.exportBackup();

  const personal = /** @type {string} */ (store.getState().activeWorkspaceId);
  await store.createWorkspace({ kind: 'freelancer', name: 'Diseño' });
  assert.ok((await store.saveMovement(expense({ amountText: '55' }))).ok);
  await store.switchWorkspace(personal);
  assert.ok((await store.saveMovement(income({ amountText: '1', description: 'Extra' }))).ok);

  const inspected = store.inspectBackup(backup.json);
  assert.ok(inspected.ok && inspected.kind === 'workspace' && inspected.sourceName === 'Mi espacio personal');

  const r = await store.importBackup(backup.json);
  assert.ok(r.ok);
  assert.equal(store.getState().data.movements.length, 1, 'el espacio abierto quedó como en la copia');
  const other = store.getState().workspaces.find((w) => w.id !== personal);
  assert.ok(other);
  await store.switchWorkspace(other.id);
  assert.equal(store.getState().data.movements.length, 1, 'el otro espacio no se tocó');
  assert.equal(store.getState().data.movements[0].amountCents, 5500);
});

test('importar la copia de un espacio dentro de OTRO espacio (mismos ids) se rechaza con una explicación', async () => {
  const { store } = await withPersonal();
  assert.ok((await store.saveMovement(income())).ok);
  const backup = store.exportBackup();
  await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi negocio' });
  const before = JSON.stringify(store.getState().data);
  const r = await store.importBackup(backup.json);
  assert.ok(!r.ok && /otro de tus espacios/.test(r.errors.form));
  assert.equal(JSON.stringify(store.getState().data), before, 'no cambió nada');
});

test('un archivo que no es una copia se rechaza igual que antes', async () => {
  const { store } = await withPersonal();
  const r = await store.importBackup('{"app":"accontrol","schemaVersion":1,"data":{}}');
  assert.ok(!r.ok);
  const info = store.inspectBackup('no es json');
  assert.ok(!info.ok);
});

test('borrar todo con espacios: vuelve a la pantalla de elegir modalidad', async () => {
  const { store } = await withPersonal();
  await store.createWorkspace({ kind: 'company', name: 'Empresa ABC' });
  assert.ok((await store.clearAllData()).ok);
  assert.equal(store.getState().status, 'ready');
  assert.deepEqual(store.getState().workspaces, []);
  assert.equal(store.getState().activeWorkspaceId, null);
  assert.equal(store.getState().data.movements.length, 0);
});
