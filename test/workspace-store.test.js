// Pruebas del aislamiento entre espacios de trabajo (almacén en memoria, con la misma regla que el real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { singleWorkspace } from '../src/data/singleWorkspace.js';
import { createMemoryStore } from '../src/data/memoryStore.js';
import { isGlobalCategory, ownedBy, stamp, strip, visibleCategories, WORKSPACE_ERRORS } from '../src/data/workspaceScope.js';
import { defaultCategories } from '../src/domain/categories.js';

const NOW = '2026-11-02T10:00:00.000Z';
/** @param {string} id @param {string} name @param {Record<string, any>} [over] */
const ws = (id, name, over = {}) => ({
  id, kind: 'personal', name, currency: 'DOP', openingBalanceCents: 0, isDefault: false, createdAt: NOW, updatedAt: NOW, ...over,
});
/** @param {string} id @param {Record<string, any>} [over] */
const movement = (id, over = {}) => ({
  id, type: 'expense', amountCents: 80000, date: '2026-11-01', time: '10:00', description: 'Prueba', classification: 'variable',
  categoryId: 'cat-exp-otros', createdAt: NOW, updatedAt: NOW, ...over,
});
/** @param {string} id @param {string} name */
const customCategory = (id, name) => ({ id, name, kind: 'expense', defaultClassification: 'variable', builtIn: false });

/** Dos espacios, A (predeterminado) y B, con un movimiento propio cada uno. */
function setup() {
  const root = createMemoryWorkspaceStore({
    workspaces: [ws('A', 'Personal', { isDefault: true }), ws('B', 'Mi negocio', { createdAt: '2026-11-03T00:00:00.000Z' })],
    profile: { displayName: 'Ana', lastWorkspaceId: 'A' },
    data: { A: { movements: [movement('m-a')] }, B: { movements: [movement('m-b', { description: 'Del negocio' })] } },
  });
  return { root, a: root.forWorkspace('A'), b: root.forWorkspace('B') };
}

test('cada espacio solo ve sus propios registros', async () => {
  const { a, b } = setup();
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-a']);
  assert.deepEqual((await b.load()).movements.map((m) => m.id), ['m-b']);
  assert.equal('workspaceId' in (await a.load()).movements[0], false, 'el campo interno no sale del almacén');
});

test('lo que se guarda en un espacio no aparece en el otro', async () => {
  const { a, b } = setup();
  await a.putMany({ movements: [movement('m-a2')], goals: [] });
  assert.deepEqual((await a.load()).movements.map((m) => m.id).sort(), ['m-a', 'm-a2']);
  assert.deepEqual((await b.load()).movements.map((m) => m.id), ['m-b']);
});

test('no se puede pisar ni borrar un registro de otro espacio, y no se guarda NADA de esa operación', async () => {
  const { a, b } = setup();
  await assert.rejects(a.putMany({ movements: [movement('m-new'), movement('m-b', { description: 'Robado' })] }), { message: WORKSPACE_ERRORS.collision });
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-a'], 'ni siquiera el registro nuevo se guardó');
  assert.equal((await b.load()).movements[0].description, 'Del negocio');

  await assert.rejects(a.deleteMany({ movementIds: ['m-a', 'm-b'] }), { message: WORKSPACE_ERRORS.collision });
  assert.equal((await a.load()).movements.length, 1, 'tampoco se borró el propio');
  assert.equal((await b.load()).movements.length, 1);

  // Borrar un id que no existe no es un error (igual que antes).
  await a.deleteMany({ movementIds: ['no-existe'] });
});

test('categorías: las de fábrica son de todos; las personalizadas, de cada espacio', async () => {
  const { a, b } = setup();
  await a.putMany({ categories: [customCategory('c-1', 'Gimnasio')] });
  const dataA = await a.load();
  const dataB = await b.load();
  assert.ok(dataA.categories.some((c) => c.id === 'c-1'));
  assert.ok(!dataB.categories.some((c) => c.id === 'c-1'));
  const builtIn = defaultCategories().length;
  assert.equal(dataA.categories.filter((c) => c.builtIn).length, builtIn);
  assert.equal(dataB.categories.filter((c) => c.builtIn).length, builtIn);
  // Otro espacio no puede usar el mismo id para una categoría propia.
  await assert.rejects(b.putMany({ categories: [customCategory('c-1', 'Otra')] }), { message: WORKSPACE_ERRORS.collision });
  await assert.rejects(b.deleteMany({ categoryIds: ['c-1'] }), { message: WORKSPACE_ERRORS.collision });
});

test('replaceAll cambia solo el espacio indicado', async () => {
  const { a, b } = setup();
  const incoming = { ...(await a.load()), movements: [movement('m-restaurado')], settings: { displayName: 'Ana', openingBalanceCents: 250000 } };
  await a.replaceAll(incoming);
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-restaurado']);
  assert.equal((await a.load()).settings.openingBalanceCents, 250000);
  assert.deepEqual((await b.load()).movements.map((m) => m.id), ['m-b']);
  assert.equal((await b.load()).settings.openingBalanceCents, 0, 'el saldo inicial es de cada espacio');
});

test('replaceAll con un id de otro espacio se rechaza entero', async () => {
  const { a } = setup();
  const before = await a.load();
  await assert.rejects(a.replaceAll({ ...before, movements: [movement('m-nuevo'), movement('m-b')] }), { message: WORKSPACE_ERRORS.collision });
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-a'], 'lo anterior sigue intacto');
});

test('saveSettings: el saldo inicial es del espacio y el nombre es de la persona', async () => {
  const { root, a, b } = setup();
  await a.saveSettings({ displayName: 'Ana María', openingBalanceCents: 99900 });
  assert.equal((await a.load()).settings.openingBalanceCents, 99900);
  assert.equal((await b.load()).settings.openingBalanceCents, 0);
  assert.equal((await a.load()).settings.displayName, 'Ana María');
  assert.equal((await b.load()).settings.displayName, 'Ana María');
  assert.equal((await root.getProfile()).lastWorkspaceId, 'A', 'guardar ajustes no cambia el último espacio usado');
});

test('clearAll de un espacio no toca a los demás y deja el saldo en cero', async () => {
  const { a, b } = setup();
  await a.saveSettings({ displayName: 'Ana', openingBalanceCents: 5000 });
  await a.clearAll();
  const dataA = await a.load();
  assert.equal(dataA.movements.length, 0);
  assert.equal(dataA.settings.openingBalanceCents, 0);
  assert.equal((await b.load()).movements.length, 1);
});

test('un fallo de escritura no deja nada a medias', async () => {
  const { root, a } = setup();
  root.failNextWrite();
  await assert.rejects(a.putMany({ movements: [movement('m-x')] }), { message: /simulado/ });
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-a']);
});

test('crear espacios: solo uno es el predeterminado', async () => {
  const { root } = setup();
  await root.createWorkspace(ws('C', 'Empresa', { kind: 'company', isDefault: true, createdAt: '2026-11-04T00:00:00.000Z' }));
  const list = await root.listWorkspaces();
  assert.deepEqual(list.map((w) => [w.id, w.isDefault]), [['A', false], ['B', false], ['C', true]]);
  await assert.rejects(root.createWorkspace(ws('C', 'Otra')), { message: WORKSPACE_ERRORS.duplicate });
  await root.setDefaultWorkspace('B');
  assert.deepEqual((await root.listWorkspaces()).map((w) => w.isDefault), [false, true, false]);
  await assert.rejects(root.setDefaultWorkspace('nope'), { message: WORKSPACE_ERRORS.gone });
});

test('renombrar (updateWorkspace) conserva los datos', async () => {
  const { root, b } = setup();
  const current = (await root.listWorkspaces()).find((w) => w.id === 'B');
  assert.ok(current);
  await root.updateWorkspace({ ...current, name: 'Tienda de Ana', updatedAt: '2026-11-05T00:00:00.000Z' });
  assert.equal((await root.listWorkspaces()).find((w) => w.id === 'B')?.name, 'Tienda de Ana');
  assert.equal((await b.load()).movements.length, 1);
  await assert.rejects(root.updateWorkspace(ws('nope', 'X')), { message: WORKSPACE_ERRORS.gone });
});

test('borrar un espacio borra TODOS sus datos y ninguno de los demás', async () => {
  const { root, a, b } = setup();
  await b.putMany({ categories: [customCategory('c-b', 'Insumos')] });
  await root.deleteWorkspace('B');
  assert.deepEqual((await root.listWorkspaces()).map((w) => w.id), ['A']);
  assert.equal(root.rawRecords('movements').filter((r) => r.workspaceId === 'B').length, 0);
  assert.equal(root.rawRecords('categories').some((c) => c.id === 'c-b'), false);
  assert.equal((await a.load()).movements.length, 1);
  assert.equal(root.rawRecords('categories').filter(isGlobalCategory).length, defaultCategories().length, 'las de fábrica siguen');
});

test('borrar el predeterminado: otro pasa a serlo; y el «último usado» se limpia', async () => {
  const { root } = setup();
  await root.deleteWorkspace('A');
  const list = await root.listWorkspaces();
  assert.deepEqual(list.map((w) => [w.id, w.isDefault]), [['B', true]]);
  assert.equal((await root.getProfile()).lastWorkspaceId, null);
  await root.deleteWorkspace('A'); // ya no existe: no es un error
});

test('un almacén de un espacio borrado ya no puede escribir (queda avisado, no crea registros huérfanos)', async () => {
  const { root, b } = setup();
  await root.deleteWorkspace('B');
  await assert.rejects(b.putMany({ movements: [movement('m-huerfano')] }), { message: WORKSPACE_ERRORS.gone });
  await assert.rejects(b.load(), { message: WORKSPACE_ERRORS.gone });
  assert.equal(root.rawRecords('movements').some((r) => r.id === 'm-huerfano'), false);
});

test('copia completa: loadEverything → replaceEverything devuelve exactamente lo mismo', async () => {
  const { root, a } = setup();
  await a.putMany({ categories: [customCategory('c-a', 'Gimnasio')], goals: [] });
  const snapshot = await root.loadEverything();
  assert.equal(snapshot.workspaces.length, 2);
  assert.equal(snapshot.profile.displayName, 'Ana');

  const other = createMemoryWorkspaceStore();
  await other.replaceEverything(snapshot);
  assert.deepEqual(await other.loadEverything(), snapshot);
});

test('replaceEverything con el mismo id en dos espacios se rechaza y no cambia nada', async () => {
  const { root } = setup();
  const before = await root.loadEverything();
  const broken = structuredClone(before);
  broken.workspaces[1].data.movements = [movement('m-a')]; // mismo id que en el espacio A
  await assert.rejects(root.replaceEverything(broken), { message: WORKSPACE_ERRORS.collision });
  assert.deepEqual(await root.loadEverything(), before);
});

test('clearEverything: sin espacios, sin perfil, con las categorías de fábrica', async () => {
  const { root } = setup();
  await root.clearEverything();
  assert.deepEqual(await root.listWorkspaces(), []);
  assert.deepEqual(await root.getProfile(), { displayName: '', lastWorkspaceId: null });
  assert.equal(root.rawRecords('movements').length, 0);
  assert.equal(root.rawRecords('categories').length, defaultCategories().length);
});

test('funciones de aislamiento: stamp, strip, ownedBy, visibleCategories', () => {
  const stamped = stamp({ id: '1' }, 'A');
  assert.deepEqual(stamped, { id: '1', workspaceId: 'A' });
  assert.deepEqual(strip(stamped), { id: '1' });
  assert.equal(ownedBy(stamped, 'A'), true);
  assert.equal(ownedBy(stamped, 'B'), false);
  const all = [{ id: 'f', builtIn: true }, { id: 'x', workspaceId: 'A' }, { id: 'y', workspaceId: 'B' }];
  assert.deepEqual(visibleCategories(all, 'A').map((c) => c.id), ['f', 'x']);
});

test('guardar y borrar en una sola operación: se hacen juntos o no se hace nada', async () => {
  const { a, b } = setup();
  // Guarda uno nuevo y borra el propio, a la vez.
  await a.putMany({ movements: [movement('m-a2')] }, { movementIds: ['m-a'] });
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-a2']);
  // Si lo que se borra es de otro espacio, no se guarda ni se borra NADA.
  await assert.rejects(a.putMany({ movements: [movement('m-a3')] }, { movementIds: ['m-a2', 'm-b'] }), { message: WORKSPACE_ERRORS.collision });
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-a2'], 'ni se guardó el nuevo ni se borró el propio');
  assert.deepEqual((await b.load()).movements.map((m) => m.id), ['m-b']);
  // Y si lo que se guarda pisa un registro ajeno, tampoco se borra lo propio.
  await assert.rejects(a.putMany({ movements: [movement('m-b', { description: 'Robado' })] }, { movementIds: ['m-a2'] }), { message: WORKSPACE_ERRORS.collision });
  assert.deepEqual((await a.load()).movements.map((m) => m.id), ['m-a2']);
  assert.equal((await b.load()).movements[0].description, 'Del negocio');
});

test('las facturas y sus cobros también son de cada espacio (guardar y borrar)', async () => {
  const { a, b } = setup();
  const invoice = (/** @type {string} */ id) => ({
    id, number: 1, customerName: 'X', customerTaxId: '', customerContact: '', issueDate: '2026-11-01', dueDate: '', lines: [{ description: 'x', quantity: 1, unitCents: 100 }],
    taxRateBp: 0, notes: '', createdAt: NOW, updatedAt: NOW,
  });
  const pay = (/** @type {string} */ id, /** @type {string} */ invoiceId) => ({ id, invoiceId, amountCents: 100, date: '2026-11-02', time: '10:00', note: '', movementId: 'm-x', createdAt: NOW, updatedAt: NOW });
  await a.putMany({ invoices: [invoice('i-a')], invoicePayments: [pay('p-a', 'i-a')] });
  assert.deepEqual((await a.load()).invoices.map((i) => i.id), ['i-a']);
  assert.deepEqual((await a.load()).invoicePayments.map((i) => i.id), ['p-a']);
  assert.deepEqual([(await b.load()).invoices.length, (await b.load()).invoicePayments.length], [0, 0]);
  await assert.rejects(b.putMany({ invoices: [invoice('i-a')] }), { message: WORKSPACE_ERRORS.collision });
  await assert.rejects(b.deleteMany({ invoiceIds: ['i-a'], invoicePaymentIds: ['p-a'] }), { message: WORKSPACE_ERRORS.collision });
  await a.deleteMany({ invoiceIds: ['i-a'], invoicePaymentIds: ['p-a'] });
  assert.deepEqual([(await a.load()).invoices.length, (await a.load()).invoicePayments.length], [0, 0]);
});

test('el almacén suelto en memoria también guarda y borra a la vez', async () => {
  const data = createMemoryStore();
  await data.putMany({ movements: [movement('m1'), movement('m2')] });
  await data.putMany({ movements: [movement('m3')] }, { movementIds: ['m1'] });
  assert.deepEqual((await data.load()).movements.map((m) => m.id).sort(), ['m2', 'm3']);
  await data.putMany({}, { movementIds: ['m2'] });
  assert.deepEqual((await data.load()).movements.map((m) => m.id), ['m3']);
});

test('singleWorkspace: un solo espacio sobre un DataStore suelto', async () => {
  const data = createMemoryStore();
  const root = singleWorkspace(data);
  const list = await root.listWorkspaces();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'ws-personal');
  assert.equal(root.forWorkspace('ws-personal'), data);
  await assert.rejects(root.createWorkspace(ws('Z', 'Otro')), /un solo espacio/);
  await assert.rejects(root.deleteWorkspace('ws-personal'), /un solo espacio/);
  const everything = await root.loadEverything();
  assert.equal(everything.workspaces.length, 1);
});
