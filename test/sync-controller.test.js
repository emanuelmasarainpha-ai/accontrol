import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createCloudStore } from '../src/data/cloudStore.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { buildDemoData, buildFreelancerDemo } from '../src/domain/demo.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import { createSyncController, realCounts, syncSettingsKey } from '../src/sync/syncController.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const T = '2026-11-13';
const N = '2026-11-13T12:00:00.000Z';
const URL_ = 'https://p.supabase.co';
const real = (list) => list.map(({ isDemo, ...r }) => r);

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const noTimers = { setTimer: () => ({}), clearTimer: () => {}, locks: null };

/** Una cuenta en el servidor simulado y un dispositivo con dos espacios con datos reales y DEMO. */
async function setup({ email = 'ana@correo.com', mock = createMockAuthServer(), storage = fakeStorage(), wrapCloud = (c) => c } = {}) {
  const r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: 'Vela9Lima!' }) });
  const token = r.body.access_token;
  const userId = r.body.user.id;
  const cloud = wrapCloud(createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: mock.fetch }));
  const personal = buildWorkspace({ kind: 'personal', name: 'Personal', isDefault: true }, { id: randomUUID(), nowISO: N });
  const freelance = buildWorkspace({ kind: 'freelancer', name: 'Freelance' }, { id: randomUUID(), nowISO: N });
  const demo = buildDemoData(T, N);
  const fr = buildFreelancerDemo(T, N);
  const local = createMemoryWorkspaceStore({
    workspaces: [personal, freelance],
    profile: { displayName: 'Ana', lastWorkspaceId: freelance.id },
    data: {
      [personal.id]: { movements: [...real(demo.movements.slice(0, 20)), ...demo.movements.slice(20, 25)], goals: real(demo.goals), contributions: real(demo.contributions) },
      [freelance.id]: { clients: real(fr.clients), services: real(fr.services), movements: real(fr.movements) },
    },
  });
  const controller = createSyncController({ cloud, local, storage, userId, engineOptions: noTimers });
  return { mock, cloud, local, controller, storage, userId, personal, freelance, token };
}

describe('copia en la nube: activar (primera subida)', () => {
  it('sube todo lo real, comprueba que la nube cuenta lo mismo y queda activada', async () => {
    const { mock, local, controller, personal, freelance, userId } = await setup();
    assert.equal(controller.api.state().enabled, false);
    const result = await controller.api.enable();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.workspaces, 2);
    assert.equal(controller.api.state().enabled, true);
    for (const ws of [personal, freelance]) {
      const data = await local.forWorkspace(ws.id).load();
      const expected = realCounts(data);
      const counted = Object.fromEntries(Object.keys(expected).map((k) => [k, 0]));
      const table = { movements: 'movements', goals: 'goals', contributions: 'contributions', clients: 'clients', services: 'services' };
      for (const [key, t] of Object.entries(table)) counted[key] = mock.data.live(t, ws.id).length;
      for (const key of Object.keys(table)) assert.equal(counted[key], expected[key], `${ws.name} ${key}`);
    }
    assert.equal(mock.data.live('movements', personal.id).length, 20, 'los 5 movimientos DEMO no subieron');
    assert.equal(result.records, 20 + 2 + 7 + 4 + 9 + 21);
    assert.equal(mock.data.profiles.get(userId).display_name, 'Ana');
    assert.equal(mock.data.profiles.get(userId).last_workspace_id, freelance.id);
    assert.deepEqual(mock.data.members.filter((m) => m.is_default).map((m) => m.workspace_id), [personal.id]);
  });

  it('una vez activada, lo que se guarde después se anota y se envía', async () => {
    const { mock, controller, personal } = await setup();
    await controller.api.enable();
    const goal = { ...real(buildDemoData(T, N).goals)[0], id: randomUUID(), name: 'Viaje' };
    await controller.store.forWorkspace(personal.id).putMany({ goals: [goal] });
    assert.equal(controller.api.state().status.pending, 1);
    await controller.api.syncNow();
    assert.equal(controller.api.state().status.pending, 0);
    assert.ok(mock.data.live('goals', personal.id).some((g) => g.name === 'Viaje'));
  });

  it('apagada, guardar no anota nada (la app guarda como siempre)', async () => {
    const { controller, personal } = await setup();
    await controller.store.forWorkspace(personal.id).putMany({ goals: [{ ...real(buildDemoData(T, N).goals)[0], id: randomUUID() }] });
    assert.equal(controller.api.state().status.pending, 0);
  });

  it('si la nube ya tiene espacios de otro dispositivo, los JUNTA con los de aquí y comprueba', async () => {
    const mock = createMockAuthServer();
    const otro = await setup({ mock });
    await otro.controller.api.enable(); // «el otro dispositivo» ya subió lo suyo
    // Mismo usuario, otro dispositivo: entrar con la misma cuenta.
    const login = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/token?grant_type=password`, headers: { apikey: 'k' }, body: JSON.stringify({ email: 'ana@correo.com', password: 'Vela9Lima!' }) });
    const cloud = createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => login.body.access_token, getUserId: () => otro.userId, fetch: mock.fetch });
    const mine = buildWorkspace({ kind: 'personal', name: 'Del celular', isDefault: true }, { id: randomUUID(), nowISO: N });
    const goal = { ...real(buildDemoData(T, N).goals)[0], id: randomUUID(), name: 'Meta del celular' };
    const local = createMemoryWorkspaceStore({ workspaces: [mine], data: { [mine.id]: { goals: [goal] } } });
    const controller = createSyncController({ cloud, local, storage: fakeStorage(), userId: otro.userId, engineOptions: noTimers });
    const r = await controller.api.enable();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.workspaces, 3, 'los 2 del otro dispositivo + el de aquí');
    assert.deepEqual(r.addedWorkspaces.sort(), ['Freelance', 'Personal']);
    assert.ok(r.downloaded > 0);
    assert.equal(r.conflicts, 0);
    const ids = (await local.listWorkspaces()).map((w) => w.id).sort();
    assert.deepEqual(ids, [mine.id, otro.personal.id, otro.freelance.id].sort());
    assert.equal((await local.listWorkspaces()).filter((w) => w.isDefault).length, 1, 'sigue habiendo un solo predeterminado');
    assert.equal((await local.listWorkspaces()).find((w) => w.isDefault).id, mine.id, 'el predeterminado de aquí no cambia');
    // Lo del otro dispositivo llegó completo (lo real; los DEMO nunca subieron).
    assert.deepEqual(realCounts(await local.forWorkspace(otro.personal.id).load()), realCounts(await otro.local.forWorkspace(otro.personal.id).load()));
    // Y lo de aquí está en la nube.
    assert.equal(mock.data.live('goals', mine.id).length, 1);
    assert.equal(controller.api.state().enabled, true);
  });

  it('si se corta a la mitad, queda apagada, sin pendientes, y volver a activar funciona', async () => {
    const { mock, controller } = await setup();
    let calls = 0;
    const original = mock.handle;
    mock.handle = async (req) => {
      calls += 1;
      if (calls === 4) throw new TypeError('Failed to fetch'); // se va el internet a mitad de la subida
      return original(req);
    };
    const r = await controller.api.enable();
    assert.equal(r.ok, false);
    assert.match(r.message, /conexión/);
    assert.equal(controller.api.state().enabled, false);
    assert.equal(controller.api.state().status.pending, 0);
    mock.handle = original;
    const again = await controller.api.enable();
    assert.equal(again.ok, true, JSON.stringify(again));
  });

  it('si la comprobación no cuadra, NO queda activada y lo dice', async () => {
    const { controller } = await setup({
      wrapCloud: (c) => ({ ...c, countLive: async (ws) => { const r = await c.countLive(ws); return r.ok ? { ok: true, counts: { ...r.counts, goals: r.counts.goals + 1 } } : r; } }),
    });
    const r = await controller.api.enable();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'mismatch');
    assert.match(r.message, /no cuadró/);
    assert.equal(controller.api.state().enabled, false);
  });

  it('si la página se cerró a mitad de la primera subida, al abrir de nuevo queda apagada y limpia', async () => {
    const storage = fakeStorage();
    const first = await setup({ storage });
    storage.setItem(syncSettingsKey(first.userId), JSON.stringify({ enabled: true, firstUploadAt: null, asked: true }));
    storage.setItem(`accontrol.outbox.v1.${first.userId}.X|put|goals|g1`, 'seq');
    const controller = createSyncController({ cloud: first.cloud, local: first.local, storage, userId: first.userId, engineOptions: noTimers });
    assert.equal(controller.api.state().enabled, false);
    assert.equal(controller.api.state().status.pending, 0);
    assert.equal(JSON.parse(storage.getItem(syncSettingsKey(first.userId))).enabled, false);
  });

  it('se recuerda por cuenta: otra cuenta en el mismo dispositivo empieza apagada', async () => {
    const storage = fakeStorage();
    const mock = createMockAuthServer();
    const ana = await setup({ storage, mock });
    await ana.controller.api.enable();
    const beto = await setup({ storage, mock, email: 'beto@correo.com' });
    assert.equal(beto.controller.api.state().enabled, false);
    const anaAgain = createSyncController({ cloud: ana.cloud, local: ana.local, storage, userId: ana.userId, engineOptions: noTimers });
    assert.equal(anaAgain.api.state().enabled, true);
  });
});

describe('copia en la nube: la pregunta, apagar y borrar', () => {
  it('la pregunta se recuerda como hecha', async () => {
    const { controller, storage, userId } = await setup();
    assert.equal(controller.api.state().asked, false);
    controller.api.markAsked();
    assert.equal(controller.api.state().asked, true);
    assert.equal(JSON.parse(storage.getItem(syncSettingsKey(userId))).asked, true);
  });

  it('«Borrar de este dispositivo»: apaga aquí y el borrado local NO llega a la nube', async () => {
    const { mock, controller, personal } = await setup();
    await controller.api.enable();
    const before = mock.data.live('movements', personal.id).length;
    controller.api.disableOnThisDevice();
    await controller.store.clearEverything();
    await controller.api.syncNow();
    assert.equal(controller.api.state().enabled, false);
    assert.equal(controller.api.state().status.pending, 0);
    assert.equal(mock.data.workspaces.get(personal.id).deleted_at, null, 'el espacio sigue en la nube');
    assert.equal(mock.data.live('movements', personal.id).length, before);
  });

  it('«Borrar de todos mis dispositivos»: marca como borrados en la nube TODOS los espacios de la cuenta', async () => {
    const { mock, controller, personal, freelance } = await setup();
    await controller.api.enable();
    const r = await controller.api.clearEverywhere();
    assert.deepEqual(r, { ok: true });
    for (const ws of [personal, freelance]) assert.notEqual(mock.data.workspaces.get(ws.id).deleted_at, null);
  });

  it('«Borrar de todos mis dispositivos» sin internet no borra nada y lo dice', async () => {
    const { mock, controller, personal } = await setup();
    await controller.api.enable();
    mock.offline = true;
    const r = await controller.api.clearEverywhere();
    assert.equal(r.ok, false);
    assert.match(r.message, /No se borró nada/);
    mock.offline = false;
    assert.equal(mock.data.workspaces.get(personal.id).deleted_at, null);
  });

  it('al eliminar la cuenta, se olvida todo lo de la sincronización en este dispositivo', async () => {
    const { controller, storage, userId, personal } = await setup();
    await controller.api.enable();
    await controller.store.forWorkspace(personal.id).putMany({ goals: [{ ...real(buildDemoData(T, N).goals)[0], id: randomUUID() }] });
    controller.api.forget();
    assert.equal(storage.getItem(syncSettingsKey(userId)), null);
    assert.equal([...storage.map.keys()].some((k) => k.includes(userId)), false);
    assert.equal(controller.api.state().enabled, false);
  });
});
