// 0.16.0 (paso 3) — La sincronización con espacios COMPARTIDOS: dispositivos completos de varias personas.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createCloudStore } from '../src/data/cloudStore.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { buildDemoData } from '../src/domain/demo.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import { createSyncController } from '../src/sync/syncController.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const URL_ = 'https://p.supabase.co';
const T = '2026-11-14';
const N = '2026-11-14T12:00:00.000Z';
const PASS = 'Vela9Lima!';
const later = (min) => new Date(Date.parse(N) + min * 60_000).toISOString();

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; },
  };
}
const noTimers = { setTimer: () => ({}), clearTimer: () => {}, locks: null };
const movement = (patch = {}) => {
  const { isDemo: _d, ...base } = buildDemoData(T, N).movements[0];
  return { ...base, id: randomUUID(), description: 'Venta', createdAt: N, updatedAt: N, ...patch };
};

/** Un dispositivo de una persona: su almacén, su sesión y su sincronización (activada). */
async function device(mock, email, { workspaces = [], data = {} } = {}) {
  let r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/token?grant_type=password`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  if (r.status !== 200) r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  const token = r.body.access_token;
  const userId = r.body.user.id;
  /** Espía: cada petición que hace este dispositivo. @type {Array<{ method: string, url: string, body: string }>} */
  const calls = [];
  const spy = (url, init = {}) => { calls.push({ method: String(init.method ?? 'GET'), url: String(url), body: String(init.body ?? '') }); return mock.fetch(url, init); };
  const cloud = createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: spy });
  const local = createMemoryWorkspaceStore({ workspaces, data });
  const controller = createSyncController({ cloud, local, storage: fakeStorage(), userId, engineOptions: noTimers });
  /** @type {any[]} */
  const remote = [];
  controller.api.onRemote((x) => remote.push(x));
  const enabled = await controller.api.enable();
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  return { cloud, local, userId, remote, api: controller.api, store: controller.store, mock, calls };
}

/** Ana (dueña) con «Empresa ABC» y una venta; Beto invitado como `role`. */
async function shared(role = 'admin') {
  const mock = createMockAuthServer();
  const shop = buildWorkspace({ kind: 'company', name: 'Empresa ABC', isDefault: true }, { id: randomUUID(), nowISO: N });
  const sale = movement();
  const ana = await device(mock, 'ana@correo.com', { workspaces: [shop], data: { [shop.id]: { movements: [sale] } } });
  const own = buildWorkspace({ kind: 'personal', name: 'Lo de Beto', isDefault: true }, { id: randomUUID(), nowISO: N });
  const beto = await device(mock, 'beto@correo.com', { workspaces: [own] });
  const inv = await ana.cloud.createInvite(shop.id, role);
  assert.equal(inv.ok, true);
  if (!inv.ok) throw new Error('invitación');
  assert.equal((await beto.cloud.acceptInvite(inv.code)).ok, true);
  await beto.api.syncNow();
  return { mock, shop, sale, own, ana, beto };
}

/** ¿Este dispositivo intentó cambiar (PATCH/POST) la fila del espacio `id`? */
const touchedWorkspace = (dev, id) => dev.calls.some((c) => c.method !== 'GET' && c.url.includes('/rest/v1/workspaces') && (c.url.includes(id) || c.body.includes(id)));
const wsOf = async (dev, id) => (await dev.local.listWorkspaces()).find((w) => w.id === id);
const movesOf = async (dev, id) => (await dev.local.forWorkspace(id).load()).movements;

describe('sincronización con espacios compartidos', () => {
  it('al aceptar, el espacio llega al dispositivo con su rol, sus datos y un aviso propio', async () => {
    const { shop, sale, beto } = await shared('admin');
    const ws = await wsOf(beto, shop.id);
    assert.equal(ws?.role, 'admin');
    assert.equal(ws?.isDefault, false, 'no le quita el predeterminado a su propio espacio');
    assert.deepEqual((await movesOf(beto, shop.id)).map((m) => m.id), [sale.id]);
    assert.deepEqual(beto.remote.at(-1).sharedAdded, ['Empresa ABC']);
    assert.deepEqual(beto.remote.at(-1).addedWorkspaces, [], 'no dice «desde tu otro dispositivo»');
  });

  it('el administrador registra y edita: le llega a la dueña', async () => {
    const { shop, sale, ana, beto } = await shared('admin');
    await beto.store.forWorkspace(shop.id).putMany({ movements: [{ ...sale, description: 'Venta corregida', updatedAt: later(5) }, movement({ description: 'Nueva' })] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null);
    await ana.api.syncNow();
    const moves = await movesOf(ana, shop.id);
    assert.deepEqual(moves.map((m) => m.description).sort(), ['Nueva', 'Venta corregida']);
  });

  it('cambiar el espacio (nombre) sin ser el dueño: no atasca el envío y vuelve a lo de la nube', async () => {
    const { mock, shop, sale, beto } = await shared('admin');
    const ws = await wsOf(beto, shop.id);
    if (!ws) return assert.fail('espacio');
    await beto.store.updateWorkspace({ ...ws, name: 'Cambiado por Beto', updatedAt: later(5) });
    await beto.store.forWorkspace(shop.id).putMany({ movements: [{ ...sale, description: 'Otra', updatedAt: later(6) }] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null, 'el envío no se atasca');
    assert.equal(beto.api.state().status.pending, 0);
    assert.equal(mock.data.workspaces.get(shop.id).name, 'Empresa ABC', 'la nube no cambia');
    assert.equal(mock.data.live('movements', shop.id)[0].description, 'Otra', 'los datos sí se enviaron');
    await beto.api.syncNow();
    assert.equal((await wsOf(beto, shop.id))?.name, 'Empresa ABC', 'aquí vuelve el nombre de la nube');
  });

  it('el contador: lo que cambie en su dispositivo no se sube, no atasca nada y vuelve a quedar igual que la nube', async () => {
    const { mock, shop, sale, beto } = await shared('accountant');
    assert.equal((await wsOf(beto, shop.id))?.role, 'accountant');
    await beto.store.forWorkspace(shop.id).putMany({ movements: [{ ...sale, description: 'Cambio del contador', updatedAt: later(5) }] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null, 'no queda un error repitiéndose');
    assert.equal(beto.api.state().status.pending, 0);
    assert.equal(mock.data.live('movements', shop.id)[0].description, 'Venta', 'la nube no cambió');
    assert.equal((await movesOf(beto, shop.id))[0].description, 'Venta', 'tras UNA sincronización, su dispositivo ya volvió a lo de la nube');
  });

  it('cambio de rol: el dispositivo se entera y lo dice', async () => {
    const { shop, ana, beto } = await shared('admin');
    assert.equal((await ana.cloud.setMemberRole(shop.id, beto.userId, 'accountant')).ok, true);
    await beto.api.syncNow();
    assert.equal((await wsOf(beto, shop.id))?.role, 'accountant');
    assert.deepEqual(beto.remote.at(-1).roleChanges, [{ name: 'Empresa ABC', role: 'accountant', label: 'Contador' }]);
  });

  it('si te quitan, el espacio se quita de tu dispositivo (con aviso) y tus espacios no se tocan', async () => {
    const { shop, own, ana, beto } = await shared('admin');
    assert.equal((await ana.cloud.removeMember(shop.id, beto.userId)).ok, true);
    await beto.api.syncNow();
    assert.equal(await wsOf(beto, shop.id), undefined);
    assert.deepEqual(beto.remote.at(-1).lostAccess, ['Empresa ABC']);
    assert.ok(await wsOf(beto, own.id), 'su espacio sigue');
    assert.equal(beto.api.state().status.lastError, null);
  });

  it('si la dueña borra el espacio, también se quita del dispositivo del miembro', async () => {
    const { shop, ana, beto } = await shared('accountant');
    assert.equal((await ana.api.clearEverywhere()).ok, true);
    await beto.api.syncNow();
    assert.equal(await wsOf(beto, shop.id), undefined);
    assert.deepEqual(beto.remote.at(-1).lostAccess, ['Empresa ABC']);
  });

  it('«Borrar de todos mis dispositivos» de un miembro solo borra lo suyo, nunca el espacio de la dueña', async () => {
    const { mock, shop, own, beto } = await shared('admin');
    assert.equal((await beto.api.clearEverywhere()).ok, true);
    assert.equal(mock.data.workspaces.get(shop.id).deleted_at, null, 'el de Ana sigue vivo');
    assert.equal(touchedWorkspace(beto, shop.id), false, 'ni siquiera intenta tocar el espacio de Ana');
    assert.notEqual(mock.data.workspaces.get(own.id).deleted_at, null, 'el de Beto se marcó');
  });

  it('borrar en el dispositivo un espacio compartido no lo borra en la nube', async () => {
    const { mock, shop, beto } = await shared('admin');
    beto.calls.length = 0;
    await beto.store.deleteWorkspace(shop.id);
    await beto.api.syncNow();
    assert.equal(mock.data.workspaces.get(shop.id).deleted_at, null);
    assert.equal(touchedWorkspace(beto, shop.id), false, 'ni siquiera intenta marcarlo como borrado');
    assert.equal(beto.api.state().status.lastError, null);
  });

  it('volver a activar la copia en un dispositivo que tiene espacios compartidos funciona (solo sube lo suyo)', async () => {
    const { mock, shop, beto } = await shared('accountant');
    beto.api.disableOnThisDevice();
    const r = await beto.api.enable();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(mock.data.workspaces.get(shop.id).name, 'Empresa ABC');
    assert.equal((await wsOf(beto, shop.id))?.role, 'accountant');
  });
});

describe('motor de envío con espacios compartidos (sin bajar antes: un cambio justo entre la bajada y la subida)', () => {
  it('un cambio pendiente del espacio compartido no se envía ni atasca el envío', async () => {
    const { mock, shop, beto } = await shared('admin');
    const ws = await wsOf(beto, shop.id);
    if (!ws) return assert.fail('espacio');
    const { createSyncEngine } = await import('../src/sync/syncEngine.js');
    const { createOutbox } = await import('../src/sync/outbox.js');
    const outbox = createOutbox({ storage: fakeStorage(), userId: beto.userId });
    outbox.markWorkspace(shop.id);
    const engine = createSyncEngine({ cloud: beto.cloud, local: beto.local, outbox, locks: null, ...noTimers });
    await beto.local.updateWorkspace({ ...ws, name: 'Cambiado por Beto', updatedAt: later(9) });
    const r = await engine.flush();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(outbox.pendingCount(), 0);
    assert.equal(mock.data.workspaces.get(shop.id).name, 'Empresa ABC');
  });

  it('lo pendiente del contador no se sube, no atasca y fuerza bajar todo otra vez', async () => {
    const { mock, shop, sale, beto } = await shared('accountant');
    const { createSyncEngine } = await import('../src/sync/syncEngine.js');
    const { createOutbox } = await import('../src/sync/outbox.js');
    const outbox = createOutbox({ storage: fakeStorage(), userId: beto.userId });
    /** @type {string[]} */
    const removed = [];
    const cursors = { get: () => ({}), set: () => {}, remove: (ws) => removed.push(ws), clear: () => {} };
    await beto.local.forWorkspace(shop.id).putMany({ movements: [{ ...sale, description: 'Cambio del contador', updatedAt: later(9) }] });
    outbox.markPut(shop.id, 'movements', [sale.id]);
    const engine = createSyncEngine({ cloud: beto.cloud, local: beto.local, outbox, locks: null, ...noTimers });
    const sendOnly = await engine.flush(); // sin cursores: solo envía
    assert.equal(sendOnly.ok, true, JSON.stringify(sendOnly));
    assert.equal(outbox.pendingCount(), 0);
    assert.equal(mock.data.live('movements', shop.id)[0].description, 'Venta', 'la nube no cambió');
    outbox.markPut(shop.id, 'movements', [sale.id]);
    const withCursors = createSyncEngine({ cloud: beto.cloud, local: beto.local, outbox, locks: null, cursors: /** @type {any} */ (cursors), ...noTimers });
    // Con cursores primero baja: lo pendiente del contador ya se descarta en la bajada.
    assert.equal((await withCursors.flush()).ok, true);
    assert.equal(outbox.pendingCount(), 0);
  });

  it('borrar en el dispositivo un espacio compartido no anota borrarlo en la nube (ni sin bajar antes)', async () => {
    const { mock, shop, own, beto } = await shared('admin');
    const { createSyncEngine } = await import('../src/sync/syncEngine.js');
    const { createOutbox } = await import('../src/sync/outbox.js');
    const { withOutbox } = await import('../src/sync/trackedStore.js');
    const outbox = createOutbox({ storage: fakeStorage(), userId: beto.userId });
    const tracked = withOutbox(beto.local, outbox, () => true);
    await tracked.deleteWorkspace(shop.id);
    await tracked.deleteWorkspace(own.id);
    assert.deepEqual(outbox.snapshot().filter((e) => e.type === 'wsdel').map((e) => e.ws), [own.id], 'solo el suyo queda anotado');
    beto.calls.length = 0;
    const engine = createSyncEngine({ cloud: beto.cloud, local: beto.local, outbox, locks: null, ...noTimers });
    assert.equal((await engine.flush()).ok, true);
    assert.equal(touchedWorkspace(beto, shop.id), false);
    assert.equal(mock.data.workspaces.get(shop.id).deleted_at, null);
    assert.notEqual(mock.data.workspaces.get(own.id).deleted_at, null);
  });
});
