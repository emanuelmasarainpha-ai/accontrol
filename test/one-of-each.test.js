// 0.17.4 — Un espacio de cada tipo por cuenta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { availableKinds, buildWorkspace, oneOfEachMessage, ownedWorkspaceOfKind } from '../src/domain/workspaces.js';

/** @param {string} kind @param {string} name @param {string} [role] */
const ws = (kind, name, role) => ({ kind, name, ...(role ? { role } : {}) });
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };

test('qué tipos quedan por crear', () => {
  assert.deepEqual(availableKinds([]), ['personal', 'freelancer', 'entrepreneur', 'company']);
  assert.deepEqual(availableKinds([ws('personal', 'Yo'), ws('company', 'ABC')]), ['freelancer', 'entrepreneur']);
});

test('un espacio compartido contigo (no eres dueño) no cuenta: puedes tener el tuyo de ese tipo', () => {
  const list = [ws('entrepreneur', 'Colmado de Ana', 'admin'), ws('company', 'Empresa de Beto', 'custom')];
  assert.equal(ownedWorkspaceOfKind(list, 'entrepreneur'), null);
  assert.deepEqual(availableKinds(list), ['personal', 'freelancer', 'entrepreneur', 'company']);
  assert.equal(ownedWorkspaceOfKind([...list, ws('entrepreneur', 'Mi tienda', 'owner')], 'entrepreneur')?.name, 'Mi tienda');
});

test('el aviso dice cuál tienes y qué hacer', () => {
  assert.equal(oneOfEachMessage({ kind: 'entrepreneur', name: 'Mi tienda' }), 'Ya tienes un espacio Emprendedor («Mi tienda»). Solo puedes tener uno de cada tipo: ábrelo desde tus espacios.');
});

test('store: no deja crear un segundo espacio del mismo tipo, pero sí uno de otro tipo', async () => {
  const store = createStore(createMemoryWorkspaceStore(), () => new Date(2026, 10, 16, 10, 0));
  await store.init();
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi tienda' }));
  const again = await store.createWorkspace({ kind: 'entrepreneur', name: 'Otra tienda' });
  assert.equal(again.ok, false);
  if (!again.ok) assert.match(again.errors.kind, /Ya tienes un espacio Emprendedor \(«Mi tienda»\)/);
  must(await store.createWorkspace({ kind: 'company', name: 'Mi empresa' }));
  assert.deepEqual(store.getState().workspaces.map((w) => w.kind).sort(), ['company', 'entrepreneur']);
});

test('store: los espacios repetidos de antes de la regla se conservan con sus datos', async () => {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, () => new Date(2026, 10, 16, 10, 0));
  await store.init();
  const first = must(await store.createWorkspace({ kind: 'personal', name: 'Casa' })).workspace;
  const old = buildWorkspace({ kind: 'personal', name: 'Casa vieja' }, { id: crypto.randomUUID(), nowISO: '2026-01-01T00:00:00.000Z' });
  await root.createWorkspace(old);
  must(await store.switchWorkspace(old.id));
  must(await store.saveMovement({ type: 'income', amountText: '500', date: '2026-11-10', time: '09:00', description: 'Sueldo', categoryId: 'cat-inc-salario', classification: 'fixed' }));
  assert.equal(store.getState().workspaces.length, 2, 'los dos siguen');
  assert.equal(store.getState().data.movements.length, 1, 'y el de antes conserva sus datos');
  must(await store.switchWorkspace(first.id));
  assert.equal((await store.createWorkspace({ kind: 'personal', name: 'Tercera' })).ok, false, 'pero no se crea otro');
});

test('store: un espacio compartido contigo del mismo tipo no impide crear el tuyo', async () => {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, () => new Date(2026, 10, 16, 10, 0));
  await store.init();
  must(await store.createWorkspace({ kind: 'personal', name: 'Casa' }));
  const shared = { ...buildWorkspace({ kind: 'entrepreneur', name: 'Colmado de Ana' }, { id: crypto.randomUUID(), nowISO: '2026-01-01T00:00:00.000Z' }), role: /** @type {const} */ ('admin') };
  await root.createWorkspace(shared);
  must(await store.switchWorkspace(shared.id));
  must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Mi propia tienda' }));
});
