// El "cerebro" con clientes y servicios: crear, editar, archivar, borrar con reglas, vínculo con ingresos,
// aislamiento entre espacios, demostración y respaldo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { buildWorkspace } from '../src/domain/workspaces.js';

/**
 * Un segundo espacio del MISMO tipo, como los que quedaron de antes de la regla «uno de cada tipo» (0.17.4): se guarda
 * directo en el almacén (la app ya no deja crearlo) y se abre.
 * @param {any} root @param {any} store @param {import('../src/domain/types.js').WorkspaceKind} kind @param {string} name
 */
async function legacySecond(root, store, kind, name) {
  const workspace = buildWorkspace({ kind, name }, { id: crypto.randomUUID(), nowISO: '2026-01-01T00:00:00.000Z' });
  await root.createWorkspace(workspace);
  const opened = await store.switchWorkspace(workspace.id);
  if (!opened.ok) throw new Error(JSON.stringify(opened));
  return { ok: true, workspace };
}

const fixedNow = new Date(2026, 10, 2, 15, 30); // 2 nov 2026
const TODAY = '2026-11-02';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
async function freelancer(name = 'Diseño') {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind: 'freelancer', name })).ok);
  return { root, store };
}
const income = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'income', amountText: '1000', date: TODAY, time: '09:00', description: 'Pago', classification: 'variable', categoryId: 'cat-inc-ventas', ...over,
});
const clientInput = (/** @type {Record<string,string>} */ over = {}) => ({ firstName: 'Ana', lastName: 'Pérez', company: 'Estudio Sol', email: '', phone: '', country: '', notes: '', ...over });
const serviceInput = (/** @type {string} */ clientId, /** @type {Record<string,string>} */ over = {}) => ({
  clientId, name: 'Logo', priceText: '5,000', estimatedDaysText: '10', status: 'in_progress', startDate: '2026-10-20', ...over,
});
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };

async function withClientAndService() {
  const ctx = await freelancer();
  const { client } = must(await ctx.store.saveClient(clientInput()));
  const { service } = must(await ctx.store.saveService(serviceInput(client.id)));
  return { ...ctx, client, service };
}

test('cliente: se crea, queda guardado y otra pestaña lo ve', async () => {
  const { store, root } = await freelancer();
  const { client } = must(await store.saveClient(clientInput({ firstName: '  Ana ' })));
  assert.equal(client.firstName, 'Ana');
  assert.equal(client.archived, false);
  assert.deepEqual(store.getState().data.clients.map((c) => c.id), [client.id]);
  const tab2 = createStore(root, () => fixedNow);
  await tab2.init();
  assert.equal(tab2.getState().data.clients[0].company, 'Estudio Sol');
});

test('cliente: errores por campo y duplicado; no se guarda nada', async () => {
  const { store } = await freelancer();
  const bad = await store.saveClient(clientInput({ firstName: '', email: 'mal' }));
  assert.ok(!bad.ok && bad.errors.firstName && bad.errors.email);
  must(await store.saveClient(clientInput()));
  const dup = await store.saveClient(clientInput({ firstName: 'ana' }));
  assert.ok(!dup.ok && /Ya tienes un cliente/.test(dup.errors.firstName));
  assert.equal(store.getState().data.clients.length, 1);
});

test('cliente: editar conserva id y archivado; editar uno que ya no existe falla', async () => {
  const { store, client } = await withClientAndService();
  must(await store.setClientArchived(client.id, true));
  const edited = must(await store.saveClient(clientInput({ company: 'Sol SRL' }), client.id));
  assert.equal(edited.client.id, client.id);
  assert.equal(edited.client.archived, true);
  assert.equal(edited.client.company, 'Sol SRL');
  assert.equal(store.getState().data.clients.length, 1);
  const gone = await store.saveClient(clientInput(), 'fantasma');
  assert.ok(!gone.ok && /ya no existe/.test(gone.errors.form));
});

test('cliente: archivar y reactivar no pierde el historial', async () => {
  const { store, client, service } = await withClientAndService();
  must(await store.saveMovement(income({ clientId: client.id, serviceId: service.id })));
  must(await store.setClientArchived(client.id, true));
  assert.equal(store.getState().data.clients[0].archived, true);
  assert.equal(store.getState().data.services.length, 1);
  assert.equal(store.getState().data.movements.length, 1);
  must(await store.setClientArchived(client.id, false));
  assert.equal(store.getState().data.clients[0].archived, false);
  assert.ok(!(await store.setClientArchived('fantasma', true)).ok);
});

test('cliente: solo se borra si no tiene servicios, pagos ni gastos', async () => {
  const { store, client, service } = await withClientAndService();
  const blocked = await store.deleteClient(client.id);
  assert.ok(!blocked.ok && /servicios, pagos o gastos/.test(blocked.errors.form));
  must(await store.deleteService(service.id));
  must(await store.saveMovement(income({ clientId: client.id }))); // pago suelto
  const blocked2 = await store.deleteClient(client.id);
  assert.ok(!blocked2.ok, 'un pago sin servicio también cuenta');
  const m = store.getState().data.movements[0];
  must(await store.deleteMovement(m.id));
  must(await store.deleteClient(client.id));
  assert.deepEqual(store.getState().data.clients, []);
  assert.ok(!(await store.deleteClient(client.id)).ok, 'ya no existe');
});

test('servicio: se crea con su cliente y se edita', async () => {
  const { store, client, service } = await withClientAndService();
  assert.equal(service.clientId, client.id);
  assert.equal(service.priceCents, 500000);
  const edited = must(await store.saveService(serviceInput(client.id, { name: 'Logo y papelería', priceText: '6,500' }), service.id));
  assert.equal(edited.service.priceCents, 650000);
  assert.equal(store.getState().data.services.length, 1);
  const noClient = await store.saveService(serviceInput('fantasma'));
  assert.ok(!noClient.ok && noClient.errors.clientId);
  const badPrice = await store.saveService(serviceInput(client.id, { priceText: '0' }));
  assert.ok(!badPrice.ok && badPrice.errors.price);
});

test('servicio: cambia de estado y solo acepta los cuatro válidos', async () => {
  const { store, service } = await withClientAndService();
  for (const status of ['done', 'cancelled', 'pending', 'in_progress']) {
    assert.equal(must(await store.setServiceStatus(service.id, status)).service.status, status);
  }
  const bad = await store.setServiceStatus(service.id, 'hecho');
  assert.ok(!bad.ok);
  assert.equal(store.getState().data.services[0].status, 'in_progress');
  assert.ok(!(await store.setServiceStatus('fantasma', 'done')).ok);
});

test('servicio: con pagos no se borra ni cambia de cliente; sin pagos sí', async () => {
  const { store, client, service } = await withClientAndService();
  const other = must(await store.saveClient(clientInput({ firstName: 'Beto', lastName: '', company: '' }))).client;
  must(await store.saveMovement(income({ clientId: client.id, serviceId: service.id })));
  const noDelete = await store.deleteService(service.id);
  assert.ok(!noDelete.ok && /pagos registrados/.test(noDelete.errors.form));
  const move = await store.saveService(serviceInput(other.id), service.id);
  assert.ok(!move.ok && move.errors.clientId);
  const free = must(await store.saveService(serviceInput(client.id, { name: 'Otro servicio' }))).service;
  must(await store.deleteService(free.id));
  assert.equal(store.getState().data.services.length, 1);
});

test('ingreso vinculado: con servicio, con cliente, y la edición cambia o quita el vínculo', async () => {
  const { store, client, service } = await withClientAndService();
  const other = must(await store.saveClient(clientInput({ firstName: 'Beto', lastName: '', company: '' }))).client;
  const m1 = must(await store.saveMovement(income({ serviceId: service.id }))).movement;
  assert.equal(m1.clientId, client.id, 'el cliente viene del servicio');
  assert.equal(m1.serviceId, service.id);
  const m2 = must(await store.saveMovement(income({ clientId: other.id }), m1.id)).movement;
  assert.equal(m2.clientId, other.id);
  assert.ok(!('serviceId' in m2));
  const m3 = must(await store.saveMovement(income(), m1.id)).movement;
  assert.ok(!('clientId' in m3) && !('serviceId' in m3));
});

test('ingreso vinculado: servicio de otro cliente, cliente inexistente o un gasto con servicio se rechazan', async () => {
  const { store, client, service } = await withClientAndService();
  const other = must(await store.saveClient(clientInput({ firstName: 'Beto', lastName: '', company: '' }))).client;
  const wrong = await store.saveMovement(income({ clientId: other.id, serviceId: service.id }));
  assert.ok(!wrong.ok && wrong.errors.service);
  const ghost = await store.saveMovement(income({ clientId: 'fantasma' }));
  assert.ok(!ghost.ok && ghost.errors.client);
  const expense = await store.saveMovement(income({ type: 'expense', categoryId: 'cat-exp-otros', clientId: client.id, serviceId: service.id }));
  assert.ok(!expense.ok && expense.errors.service);
  const ghostExpense = await store.saveMovement(income({ type: 'expense', categoryId: 'cat-exp-otros', clientId: 'fantasma' }));
  assert.ok(!ghostExpense.ok && ghostExpense.errors.client);
  assert.equal(store.getState().data.movements.length, 0);
});

test('un fallo al guardar no cambia lo que se ve', async () => {
  const { store, root, client } = await withClientAndService();
  root.failNextWrite();
  const r = await store.saveClient(clientInput({ firstName: 'Carla', lastName: '', company: '' }));
  assert.ok(!r.ok);
  assert.equal(store.getState().data.clients.length, 1);
  root.failNextWrite();
  assert.ok(!(await store.setClientArchived(client.id, true)).ok);
  assert.equal(store.getState().data.clients[0].archived, false);
  root.failNextWrite();
  assert.ok(!(await store.saveService(serviceInput(client.id, { name: 'Nuevo' }))).ok);
  assert.equal(store.getState().data.services.length, 1);
});

test('aislamiento: los clientes y servicios de un espacio no se ven en otro', async () => {
  const { store, root, client } = await withClientAndService();
  const a = /** @type {string} */ (store.getState().activeWorkspaceId);
  must(await store.createWorkspace({ kind: 'personal', name: 'Mis cuentas' }));
  assert.deepEqual(store.getState().data.clients, []);
  assert.deepEqual(store.getState().data.services, []);
  // En el otro espacio no se puede vincular un ingreso a un cliente del primero.
  const leak = await store.saveMovement(income({ clientId: client.id }));
  assert.ok(!leak.ok && leak.errors.client);
  assert.equal(root.rawRecords('clients').length, 1);
  must(await store.switchWorkspace(a));
  assert.equal(store.getState().data.clients.length, 1);
  assert.equal(store.getState().data.services.length, 1);
});

test('borrar un espacio borra también sus clientes y servicios', async () => {
  const { store, root } = await withClientAndService();
  const b = must(await legacySecond(root, store, 'freelancer', 'Segundo'));
  assert.ok(b.ok);
  const secondId = /** @type {string} */ (store.getState().activeWorkspaceId);
  must(await store.saveClient(clientInput({ firstName: 'Zoila', lastName: '', company: '' })));
  assert.equal(root.rawRecords('clients').length, 2);
  const first = /** @type {string} */ (store.getState().workspaces.find((w) => w.id !== secondId)?.id);
  must(await store.switchWorkspace(first));
  must(await store.deleteWorkspace(secondId));
  assert.equal(root.rawRecords('clients').length, 1);
  assert.equal(root.rawRecords('services').length, 1);
});

test('demostración: en un espacio Freelancer trae clientes, servicios y pagos vinculados (y nada futuro)', async () => {
  const { store } = await freelancer();
  assert.equal(store.hasDemoData(), false);
  must(await store.loadDemoData());
  const d = store.getState().data;
  assert.equal(d.clients.length, 4);
  assert.ok(d.clients.every((c) => c.isDemo));
  assert.ok(d.services.every((s) => s.isDemo));
  assert.ok(d.services.some((s) => s.status === 'done') && d.services.some((s) => s.status === 'in_progress') && d.services.some((s) => s.status === 'pending') && d.services.some((s) => s.status === 'cancelled'));
  const links = d.movements.filter((m) => m.serviceId);
  assert.ok(links.length >= 8);
  for (const m of links) {
    assert.equal(m.type, 'income');
    assert.equal(d.services.find((s) => s.id === m.serviceId)?.clientId, m.clientId);
  }
  assert.ok(d.movements.every((m) => m.date <= TODAY), 'sin fechas futuras');
  assert.equal(store.hasDemoData(), true);
});

test('demostración: en un espacio Personal no se crean clientes', async () => {
  const store = createStore(createMemoryWorkspaceStore(), tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'personal', name: 'Mi espacio personal' }));
  must(await store.loadDemoData());
  assert.deepEqual(store.getState().data.clients, []);
  assert.deepEqual(store.getState().data.services, []);
});

test('quitar la demostración borra lo de ejemplo, pero lo REAL se conserva (un pago real pierde solo el servicio de ejemplo)', async () => {
  const { store, root } = await freelancer();
  must(await store.loadDemoData());
  const demoService = store.getState().data.services.find((s) => s.status === 'in_progress');
  assert.ok(demoService);
  const real = must(await store.saveMovement(income({ amountText: '777', description: 'Pago real', clientId: demoService.clientId, serviceId: demoService.id }))).movement;
  assert.equal(real.serviceId, demoService.id);
  // Un cliente y servicio reales no se tocan.
  const mine = must(await store.saveClient(clientInput({ firstName: 'Real', lastName: '', company: '' }))).client;
  must(await store.saveService(serviceInput(mine.id, { name: 'Servicio real' })));
  // Y alguien le puso un servicio real a OTRO cliente de ejemplo.
  const otherDemoClient = store.getState().data.clients.find((c) => c.id !== demoService.clientId && c.isDemo);
  assert.ok(otherDemoClient);
  const realOnDemoClient = must(await store.saveService(serviceInput(otherDemoClient.id, { name: 'Servicio real en cliente de ejemplo' }))).service;

  must(await store.removeDemoData());
  const d = store.getState().data;
  assert.deepEqual(d.clients.map((c) => c.id).sort(), [demoService.clientId, mine.id, otherDemoClient.id].sort(), 'los clientes con algo real se quedan');
  assert.ok(d.clients.every((c) => !c.isDemo), 'y dejan de ser «de demostración»');
  assert.deepEqual(d.services.map((x) => x.name).sort(), ['Servicio real', 'Servicio real en cliente de ejemplo']);
  assert.ok(d.services.some((x) => x.id === realOnDemoClient.id));
  assert.equal(d.movements.length, 1);
  assert.equal(d.movements[0].id, real.id);
  assert.equal(d.movements[0].amountCents, 77700);
  assert.equal(d.movements[0].clientId, demoService.clientId, 'conserva su cliente');
  assert.ok(!('serviceId' in d.movements[0]), 'pero ya no apunta al servicio de ejemplo que se borró');
  assert.equal(store.hasDemoData(), false);
  // Lo guardado coincide con lo que se ve y no queda nada colgando.
  assert.equal(root.rawRecords('clients').length, 3);
  assert.equal(root.rawRecords('services').length, 2);
  const ids = new Set(root.rawRecords('services').map((x) => x.id));
  assert.ok(root.rawRecords('movements').every((m) => !m.serviceId || ids.has(m.serviceId)));
});

test('quitar la demostración sin nada real borra todos los clientes y servicios de ejemplo', async () => {
  const { store, root } = await freelancer();
  must(await store.loadDemoData());
  must(await store.removeDemoData());
  const d = store.getState().data;
  assert.deepEqual([d.clients, d.services, d.movements], [[], [], []]);
  assert.equal(root.rawRecords('clients').length + root.rawRecords('services').length + root.rawRecords('movements').length, 0);
});

test('respaldo: exportar e importar conserva clientes, servicios y vínculos; la copia se revisa antes', async () => {
  const { store, client, service } = await withClientAndService();
  must(await store.saveMovement(income({ clientId: client.id, serviceId: service.id })));
  const backup = store.exportBackup();
  const inspected = store.inspectBackup(backup.json);
  assert.ok(inspected.ok && inspected.counts.clients === 1);
  must(await store.clearAllData());
  must(await store.createWorkspace({ kind: 'freelancer', name: 'Nuevo' }));
  assert.deepEqual(store.getState().data.clients, []);
  must(await store.importBackup(backup.json));
  const d = store.getState().data;
  assert.equal(d.clients.length, 1);
  assert.equal(d.services.length, 1);
  assert.equal(d.movements[0].serviceId, d.services[0].id);
});

test('copia completa: conserva los clientes de cada espacio', async () => {
  const { store, client, service } = await withClientAndService();
  must(await store.saveMovement(income({ clientId: client.id, serviceId: service.id })));
  const full = await store.exportFullBackup();
  assert.ok(full.ok);
  must(await store.clearAllData());
  const restored = must(await store.importBackup(full.json));
  assert.equal(restored.counts.clients, 1);
  assert.equal(store.getState().data.clients[0].id, client.id);
  assert.equal(store.getState().data.services[0].id, service.id);
});

// ---- Gastos cargados a un cliente (rentabilidad real) --------------------------------------------

const expenseFor = (/** @type {Record<string,string>} */ over = {}) => income({ type: 'expense', categoryId: 'cat-exp-otros', classification: 'variable', description: 'Licencia', ...over });

test('gasto cargado a un cliente: se guarda con su cliente, se puede mover y quitar, y no toca el dinero ya cobrado', async () => {
  const { store, client } = await withClientAndService();
  const other = must(await store.saveClient(clientInput({ firstName: 'Beto', lastName: '', company: '' }))).client;
  must(await store.saveMovement(income({ amountText: '10,000', clientId: client.id })));
  const available = () => store.getState().data.movements.reduce((s, m) => s + (m.type === 'income' ? m.amountCents : -m.amountCents), 0);
  const saved = must(await store.saveMovement(expenseFor({ amountText: '1,500', clientId: client.id }))).movement;
  assert.equal(saved.clientId, client.id);
  assert.equal(available(), 850000);
  const moved = must(await store.saveMovement(expenseFor({ amountText: '1,500', clientId: other.id }), saved.id)).movement;
  assert.equal(moved.clientId, other.id);
  const cleared = must(await store.saveMovement(expenseFor({ amountText: '1,500' }), saved.id)).movement;
  assert.ok(!('clientId' in cleared));
  assert.equal(available(), 850000, 'repartir el gasto entre clientes no cambia el dinero');
});

test('gasto cargado a un cliente: impide borrar al cliente (se archiva), y borrar el gasto lo libera', async () => {
  const { store, client } = await freelancer().then(async (c) => ({ ...c, client: must(await c.store.saveClient(clientInput())).client }));
  const exp = must(await store.saveMovement(expenseFor({ clientId: client.id }))).movement;
  const blocked = await store.deleteClient(client.id);
  assert.ok(!blocked.ok && /servicios, pagos o gastos/.test(blocked.errors.form));
  must(await store.setClientArchived(client.id, true));
  must(await store.setClientArchived(client.id, false));
  must(await store.deleteMovement(exp.id));
  must(await store.deleteClient(client.id));
});

test('gasto cargado a un cliente: en un espacio sin clientes se rechaza', async () => {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  must(await store.createWorkspace({ kind: 'personal', name: 'Casa' }));
  const r = await store.saveMovement(expenseFor({ clientId: 'c-de-otro-espacio' }));
  assert.ok(!r.ok && r.errors.client);
});

test('gasto cargado a un cliente: queda en el espacio de ese cliente y la demostración se lo lleva sin tocar lo tuyo', async () => {
  const { store } = await freelancer();
  must(await store.loadDemoData());
  const demo = store.getState().data;
  assert.ok(demo.movements.some((m) => m.type === 'expense' && m.clientId && m.isDemo), 'la demo trae gastos cargados a clientes');
  const demoClient = demo.clients[0];
  const mine = must(await store.saveMovement(expenseFor({ clientId: demoClient.id, description: 'Mío' }))).movement;
  must(await store.removeDemoData());
  const after = store.getState().data;
  assert.deepEqual(after.movements.map((m) => m.id), [mine.id], 'solo queda lo tuyo');
  assert.ok(after.clients.some((c) => c.id === demoClient.id && !c.isDemo), 'el cliente de demostración al que le cargaste un gasto pasa a ser tuyo');
  assert.equal(after.movements[0].clientId, demoClient.id);
});
