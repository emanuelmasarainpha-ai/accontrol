import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { cloudKind } from '../src/data/cloudRows.js';
import { createCloudStore } from '../src/data/cloudStore.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { buildDemoData } from '../src/domain/demo.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import { createCursorStore, decide, entryTime, sameRecord } from '../src/sync/pull.js';
import { createSyncController, realCounts } from '../src/sync/syncController.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const T = '2026-11-13';
const N = '2026-11-13T12:00:00.000Z';
const URL_ = 'https://p.supabase.co';
const PASS = 'Vela9Lima!';
const real = (list) => list.map(({ isDemo, ...r }) => r);
const at = (min) => new Date(Date.parse(N) + min * 60_000).toISOString();

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

/** Un movimiento real con id nuevo. */
function movement(patch = {}) {
  return { ...real(buildDemoData(T, N).movements)[0], id: randomUUID(), description: 'Almuerzo', createdAt: N, updatedAt: N, ...patch };
}

/** Un dispositivo de la cuenta: su propio almacén, su propio localStorage y su propia sesión. */
async function device(mock, email, { workspaces = [], data = {} } = {}) {
  let r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/token?grant_type=password`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  if (r.status !== 200) r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  const token = r.body.access_token;
  const userId = r.body.user.id;
  const cloud = createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: mock.fetch });
  const local = createMemoryWorkspaceStore({ workspaces, data });
  const storage = fakeStorage();
  const controller = createSyncController({ cloud, local, storage, userId, engineOptions: noTimers });
  /** @type {any[]} */
  const remote = [];
  controller.api.onRemote((x) => remote.push(x));
  return { cloud, local, storage, controller, userId, remote, api: controller.api, store: controller.store };
}

/** La cuenta con un dispositivo A (con un espacio y un gasto) ya sincronizando, y un dispositivo B vacío. */
async function twoDevices() {
  const mock = createMockAuthServer();
  const ws = buildWorkspace({ kind: 'personal', name: 'Casa', isDefault: true }, { id: randomUUID(), nowISO: N });
  const lunch = movement();
  const A = await device(mock, 'ana@correo.com', { workspaces: [ws], data: { [ws.id]: { movements: [lunch] } } });
  assert.equal((await A.api.enable()).ok, true);
  const B = await device(mock, 'ana@correo.com');
  const r = await B.api.enable();
  assert.equal(r.ok, true, JSON.stringify(r));
  return { mock, ws, lunch, A, B };
}

const movements = cloudKind('movements');
const categories = cloudKind('categories');
const entry = (type, minutes) => ({ key: 'k', seq: `${Date.parse(at(minutes)).toString(36)}-1-x`, ws: 'w', type, kind: 'movements', id: 'm' });

describe('bajar de la nube: decidir cada registro', () => {
  const remoteLive = (m) => ({ record: movement({ id: 'm', updatedAt: at(m) }), deletedAt: null });
  const remoteGone = (m) => ({ record: movement({ id: 'm', updatedAt: at(0) }), deletedAt: at(m) });

  it('la hora de una anotación se lee de su número de versión', () => {
    assert.equal(entryTime(entry('put', 5).seq), Date.parse(at(5)));
    assert.equal(entryTime('basura'), null);
  });

  it('sin cambios aquí: se toma lo de la nube (nuevo, cambiado o borrado)', () => {
    assert.equal(decide({ kind: movements, remote: remoteLive(1), local: undefined }).action, 'put');
    assert.equal(decide({ kind: movements, remote: remoteLive(1), local: movement({ id: 'm', updatedAt: at(0) }) }).action, 'put');
    assert.equal(decide({ kind: movements, remote: remoteGone(1), local: movement({ id: 'm' }) }).action, 'delete');
    assert.equal(decide({ kind: movements, remote: remoteGone(1), local: undefined }).action, 'keep');
    for (const d of [decide({ kind: movements, remote: remoteLive(1), local: undefined }), decide({ kind: movements, remote: remoteGone(1), local: movement({ id: 'm' }) })]) {
      assert.equal(d.conflict, false);
    }
  });

  it('lo que llega igual a lo de aquí no se vuelve a escribir (el eco de lo que este dispositivo subió)', () => {
    const r = remoteLive(3);
    const d = decide({ kind: movements, remote: r, local: { ...r.record } });
    assert.deepEqual(d, { action: 'keep', conflict: false, settle: [] });
  });

  it('cambió en los dos lados: gana la nube si es más reciente, y se quita lo pendiente de aquí', () => {
    const put = entry('put', 2);
    const d = decide({ kind: movements, remote: remoteLive(5), local: movement({ id: 'm', description: 'Cena', updatedAt: at(2) }), put });
    assert.deepEqual(d, { action: 'put', conflict: true, settle: [put] });
  });

  it('cambió en los dos lados: gana lo de aquí si es más reciente (se enviará después)', () => {
    const put = entry('put', 9);
    const d = decide({ kind: movements, remote: remoteLive(5), local: movement({ id: 'm', description: 'Cena', updatedAt: at(9) }), put });
    assert.deepEqual(d, { action: 'keep', conflict: true, settle: [] });
  });

  it('a la misma hora exacta se queda lo de aquí (no se pierde nada en este dispositivo)', () => {
    const d = decide({ kind: movements, remote: remoteLive(5), local: movement({ id: 'm', description: 'Cena', updatedAt: at(5) }), put: entry('put', 5) });
    assert.equal(d.action, 'keep');
  });

  it('borrado en otro dispositivo DESPUÉS de editarlo aquí: se borra aquí', () => {
    const put = entry('put', 2);
    const d = decide({ kind: movements, remote: remoteGone(6), local: movement({ id: 'm', updatedAt: at(2) }), put });
    assert.deepEqual(d, { action: 'delete', conflict: true, settle: [put] });
  });

  it('editado aquí DESPUÉS de que otro dispositivo lo borrara: se conserva (y al subirlo vuelve a estar vivo)', () => {
    const d = decide({ kind: movements, remote: remoteGone(6), local: movement({ id: 'm', updatedAt: at(8) }), put: entry('put', 8) });
    assert.deepEqual(d, { action: 'keep', conflict: true, settle: [] });
  });

  it('borrado aquí y editado después en otro dispositivo: vuelve (la edición es más reciente)', () => {
    const del = entry('del', 3);
    const d = decide({ kind: movements, remote: remoteLive(7), local: undefined, del });
    assert.deepEqual(d, { action: 'put', conflict: true, settle: [del] });
  });

  it('borrado aquí después de la edición del otro dispositivo: sigue borrado (se enviará el borrado)', () => {
    const d = decide({ kind: movements, remote: remoteLive(2), local: undefined, del: entry('del', 7) });
    assert.deepEqual(d, { action: 'keep', conflict: true, settle: [] });
  });

  it('borrado en los dos lados: nada que hacer ni que enviar', () => {
    const del = entry('del', 3);
    assert.deepEqual(decide({ kind: movements, remote: remoteGone(2), local: undefined, del }), { action: 'keep', conflict: false, settle: [del] });
  });

  it('categorías (no tienen fecha): si cambió aquí, se queda lo de aquí', () => {
    const local = { id: 'c', name: 'Comida casa', kind: 'expense', defaultClassification: 'necessary', builtIn: false };
    const remote = { record: { ...local, name: 'Comida' }, deletedAt: null };
    assert.equal(decide({ kind: categories, remote, local, put: { ...entry('put', 1), kind: 'categories', id: 'c' } }).action, 'keep');
    assert.equal(decide({ kind: categories, remote, local }).action, 'put', 'sin cambio aquí, se toma la de la nube');
  });

  it('al juntar dispositivos, todo lo de aquí cuenta como cambio (gana el más reciente)', () => {
    const local = movement({ id: 'm', description: 'Cena', updatedAt: at(1) });
    assert.equal(decide({ kind: movements, remote: remoteLive(5), local, merge: true }).action, 'put');
    assert.equal(decide({ kind: movements, remote: remoteLive(0), local, merge: true }).action, 'keep');
    assert.equal(decide({ kind: movements, remote: remoteGone(9), local, merge: true }).action, 'delete');
    assert.equal(decide({ kind: movements, remote: remoteGone(0), local, merge: true }).action, 'keep');
  });

  it('un registro DEMO de aquí nunca se toca desde la nube', () => {
    const d = decide({ kind: movements, remote: remoteGone(9), local: movement({ id: 'm', isDemo: true }) });
    assert.equal(d.action, 'keep');
  });

  it('sameRecord compara solo lo que viaja (y las fechas por su valor, no por cómo se escriben)', () => {
    const a = movement({ id: 'm' });
    assert.equal(sameRecord(movements, a, { ...a, updatedAt: '2026-11-13T12:00:00Z' }), true);
    assert.equal(sameRecord(movements, a, { ...a, amountCents: a.amountCents + 1 }), false);
    assert.equal(sameRecord(movements, a, { ...a, extra: 'no viaja' }), true);
  });

  it('los cursores se recuerdan por cuenta y espacio, y se olvidan todos juntos', () => {
    const storage = fakeStorage();
    const c = createCursorStore(storage, 'u1');
    c.set('w1', { movements: { syncedAt: 'x', id: 'y' } });
    c.set('w2', { goals: { syncedAt: 'x', id: 'z' } });
    createCursorStore(storage, 'u2').set('w1', { a: { syncedAt: '1', id: '2' } });
    assert.deepEqual(createCursorStore(storage, 'u1').get('w1'), { movements: { syncedAt: 'x', id: 'y' } });
    c.clear();
    assert.deepEqual(c.get('w1'), {});
    assert.deepEqual(createCursorStore(storage, 'u2').get('w1'), { a: { syncedAt: '1', id: '2' } }, 'la otra cuenta no se toca');
  });
});

describe('dos dispositivos con la misma cuenta', () => {
  it('un dispositivo vacío trae todo lo de la nube al activar', async () => {
    const { ws, lunch, B } = await twoDevices();
    const list = await B.local.listWorkspaces();
    assert.deepEqual(list.map((w) => [w.id, w.name, w.isDefault]), [[ws.id, 'Casa', true]]);
    const data = await B.local.forWorkspace(ws.id).load();
    assert.deepEqual(data.movements.map((m) => m.id), [lunch.id]);
    assert.equal(data.movements[0].amountCents, lunch.amountCents);
  });

  it('lo nuevo de un dispositivo llega al otro, y se avisa a la pantalla', async () => {
    const { ws, A, B } = await twoDevices();
    const dinner = movement({ description: 'Cena', updatedAt: at(10) });
    await A.store.forWorkspace(ws.id).putMany({ movements: [dinner] });
    await A.api.syncNow();
    await B.api.syncNow();
    const data = await B.local.forWorkspace(ws.id).load();
    assert.ok(data.movements.some((m) => m.id === dinner.id && m.description === 'Cena'));
    assert.equal(B.remote.length, 1);
    assert.equal(B.remote[0].applied, 1);
    assert.equal(B.remote[0].conflicts, 0);
  });

  it('sin cambios nuevos, revisar la nube no escribe nada ni avisa', async () => {
    const { B } = await twoDevices();
    await B.api.syncNow();
    await B.api.syncNow();
    assert.equal(B.remote.length, 0);
  });

  it('una edición llega al otro dispositivo', async () => {
    const { ws, lunch, A, B } = await twoDevices();
    await A.store.forWorkspace(ws.id).putMany({ movements: [{ ...lunch, description: 'Almuerzo con Juan', updatedAt: at(10) }] });
    await A.api.syncNow();
    await B.api.syncNow();
    const m = (await B.local.forWorkspace(ws.id).load()).movements.find((x) => x.id === lunch.id);
    assert.equal(m.description, 'Almuerzo con Juan');
  });

  it('un borrado llega al otro dispositivo', async () => {
    const { ws, lunch, A, B } = await twoDevices();
    await A.store.forWorkspace(ws.id).deleteMany({ movementIds: [lunch.id] });
    await A.api.syncNow();
    await B.api.syncNow();
    assert.equal((await B.local.forWorkspace(ws.id).load()).movements.length, 0);
  });

  it('conflicto: la edición más reciente gana en los dos dispositivos, aunque la vieja se envíe después', async () => {
    const { mock, ws, lunch, A, B } = await twoDevices();
    // B edita sin internet a las 12:01; A edita a las 12:05 y lo envía.
    mock.offline = true;
    await B.store.forWorkspace(ws.id).putMany({ movements: [{ ...lunch, description: 'Versión vieja (B)', updatedAt: at(1) }] });
    await B.api.syncNow();
    mock.offline = false;
    await A.store.forWorkspace(ws.id).putMany({ movements: [{ ...lunch, description: 'Versión nueva (A)', updatedAt: at(5) }] });
    await A.api.syncNow();
    // B vuelve a tener internet: baja primero, ve que la de la nube es más nueva y NO sube la suya.
    await B.api.syncNow();
    const inB = (await B.local.forWorkspace(ws.id).load()).movements.find((x) => x.id === lunch.id);
    assert.equal(inB.description, 'Versión nueva (A)');
    assert.equal(mock.data.tables.movements.get(`${ws.id}|${lunch.id}`).description, 'Versión nueva (A)', 'la nube no se pisó con la vieja');
    assert.equal(B.api.state().status.pending, 0, 'lo pendiente de B se quitó');
    assert.equal(B.remote.at(-1).conflicts, 1, 'se avisa del conflicto');
  });

  it('conflicto: si lo de aquí es más reciente, se queda y se envía', async () => {
    const { mock, ws, lunch, A, B } = await twoDevices();
    await A.store.forWorkspace(ws.id).putMany({ movements: [{ ...lunch, description: 'Versión vieja (A)', updatedAt: at(2) }] });
    await A.api.syncNow();
    mock.offline = true;
    await B.store.forWorkspace(ws.id).putMany({ movements: [{ ...lunch, description: 'Versión nueva (B)', updatedAt: at(8) }] });
    await B.api.syncNow();
    mock.offline = false;
    await B.api.syncNow();
    assert.equal(mock.data.tables.movements.get(`${ws.id}|${lunch.id}`).description, 'Versión nueva (B)');
    await A.api.syncNow();
    const inA = (await A.local.forWorkspace(ws.id).load()).movements.find((x) => x.id === lunch.id);
    assert.equal(inA.description, 'Versión nueva (B)');
  });

  it('editado después de que el otro dispositivo lo borrara: vuelve a estar vivo en la nube y en el otro', async () => {
    const { mock, ws, lunch, A, B } = await twoDevices();
    mock.offline = true;
    await B.store.forWorkspace(ws.id).putMany({ movements: [{ ...lunch, description: 'Lo sigo usando', updatedAt: new Date(Date.now() + 60_000).toISOString() }] });
    await B.api.syncNow();
    mock.offline = false;
    await A.store.forWorkspace(ws.id).deleteMany({ movementIds: [lunch.id] });
    await A.api.syncNow();
    assert.notEqual(mock.data.tables.movements.get(`${ws.id}|${lunch.id}`).deleted_at, null);
    await B.api.syncNow();
    assert.equal(mock.data.tables.movements.get(`${ws.id}|${lunch.id}`).deleted_at, null, 'la edición más reciente lo revivió');
    await A.api.syncNow();
    const inA = (await A.local.forWorkspace(ws.id).load()).movements.find((x) => x.id === lunch.id);
    assert.equal(inA?.description, 'Lo sigo usando');
  });

  it('un espacio nuevo llega al otro dispositivo (sin quitarle su predeterminado)', async () => {
    const { ws, A, B } = await twoDevices();
    const shop = buildWorkspace({ kind: 'entrepreneur', name: 'Colmado' }, { id: randomUUID(), nowISO: at(3) });
    await A.store.createWorkspace(shop);
    await A.api.syncNow();
    await B.api.syncNow();
    const list = await B.local.listWorkspaces();
    assert.deepEqual(list.map((w) => w.name).sort(), ['Casa', 'Colmado']);
    assert.equal(list.find((w) => w.isDefault).id, ws.id);
    assert.deepEqual(B.remote.at(-1).addedWorkspaces, ['Colmado']);
  });

  it('cambiar el nombre de un espacio llega al otro dispositivo', async () => {
    const { ws, A, B } = await twoDevices();
    const [current] = await A.local.listWorkspaces();
    await A.store.updateWorkspace({ ...current, name: 'Casa nueva', updatedAt: at(4) });
    await A.api.syncNow();
    await B.api.syncNow();
    assert.equal((await B.local.listWorkspaces()).find((w) => w.id === ws.id).name, 'Casa nueva');
  });

  it('«Borrar de todos mis dispositivos» en uno quita los espacios del otro, y lo dice', async () => {
    const { ws, A, B } = await twoDevices();
    assert.deepEqual(await A.api.clearEverywhere(), { ok: true });
    await A.store.clearEverything();
    await B.api.syncNow();
    assert.deepEqual(await B.local.listWorkspaces(), []);
    assert.deepEqual(B.remote.at(-1).removedWorkspaces, ['Casa']);
    void ws;
  });

  it('los datos DEMO de un dispositivo nunca llegan al otro', async () => {
    const { ws, A, B } = await twoDevices();
    const demo = { ...buildDemoData(T, N).movements[0], id: randomUUID() };
    assert.equal(demo.isDemo, true);
    await A.store.forWorkspace(ws.id).putMany({ movements: [demo] });
    await A.api.syncNow();
    await B.api.syncNow();
    assert.equal((await B.local.forWorkspace(ws.id).load()).movements.some((m) => m.id === demo.id), false);
  });

  it('juntar: los dos dispositivos tenían datos distintos y terminan con lo mismo', async () => {
    const mock = createMockAuthServer();
    const casa = buildWorkspace({ kind: 'personal', name: 'Casa', isDefault: true }, { id: randomUUID(), nowISO: N });
    const cel = buildWorkspace({ kind: 'personal', name: 'Celular', isDefault: true }, { id: randomUUID(), nowISO: N });
    const A = await device(mock, 'ana@correo.com', { workspaces: [casa], data: { [casa.id]: { movements: [movement(), movement()] } } });
    await A.api.enable();
    const B = await device(mock, 'ana@correo.com', { workspaces: [cel], data: { [cel.id]: { movements: [movement()] } } });
    const r = await B.api.enable();
    assert.equal(r.ok, true, JSON.stringify(r));
    await A.api.syncNow();
    for (const d of [A, B]) {
      const names = (await d.local.listWorkspaces()).map((w) => w.name).sort();
      assert.deepEqual(names, ['Casa', 'Celular']);
      assert.equal((await d.local.forWorkspace(casa.id).load()).movements.length, 2);
      assert.equal((await d.local.forWorkspace(cel.id).load()).movements.length, 1);
    }
    assert.deepEqual(realCounts(await A.local.forWorkspace(cel.id).load()), realCounts(await B.local.forWorkspace(cel.id).load()));
  });

  it('activar de nuevo un dispositivo que estuvo apagado: lo borrado después en el otro se borra aquí', async () => {
    const { ws, lunch, A, B } = await twoDevices();
    B.api.disableOnThisDevice();
    // Mientras B está apagado, A borra el gasto (más tarde que la última edición del gasto).
    await A.store.forWorkspace(ws.id).deleteMany({ movementIds: [lunch.id] });
    await A.api.syncNow();
    const r = await B.api.enable();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((await B.local.forWorkspace(ws.id).load()).movements.length, 0);
  });

  it('recuerda hasta dónde bajó: la siguiente vez solo pide lo posterior', async () => {
    const { mock, ws, B } = await twoDevices();
    await B.api.syncNow();
    assert.ok(B.storage.getItem(`accontrol.cursor.v1.${B.userId}.${ws.id}`)?.includes('movements'), 'el cursor quedó guardado');
    /** @type {string[]} */
    const asked = [];
    const original = mock.handle;
    mock.handle = async (req) => {
      if (req.method === 'GET' && req.url.includes('/rest/v1/movements')) asked.push(decodeURIComponent(req.url));
      return original(req);
    };
    await B.api.syncNow();
    mock.handle = original;
    assert.ok(asked.length > 0 && asked.every((u) => u.includes('synced_at.gt.')), 'pide solo lo posterior al cursor');
  });

  it('juntar: un espacio que está aquí pero se borró en la nube se conserva y vuelve a estar vivo', async () => {
    const { mock, ws, lunch, A, B } = await twoDevices();
    B.api.disableOnThisDevice();
    await A.api.clearEverywhere();
    assert.notEqual(mock.data.workspaces.get(ws.id).deleted_at, null);
    const r = await B.api.enable();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual((await B.local.listWorkspaces()).map((w) => w.id), [ws.id], 'B conserva su espacio');
    assert.equal(mock.data.workspaces.get(ws.id).deleted_at, null, 'y en la nube vuelve a estar vivo');
    assert.ok(mock.data.live('movements', ws.id).some((m) => m.id === lunch.id));
  });

  it('sin internet, revisar la nube falla sin tocar nada de este dispositivo', async () => {
    const { mock, ws, B } = await twoDevices();
    const before = await B.local.forWorkspace(ws.id).load();
    mock.offline = true;
    await B.api.syncNow();
    assert.equal(B.api.state().status.lastError?.code, 'network');
    assert.deepEqual(await B.local.forWorkspace(ws.id).load(), before);
    mock.offline = false;
  });
});

describe('revisión periódica (paso 7): lo de otro dispositivo llega sin pulsar nada', () => {
  it('cada 3 minutos baja lo nuevo, avisa a la pantalla y vuelve a programarse', async () => {
    const { mock, ws, A } = await twoDevices();
    // Un tercer dispositivo de la misma cuenta, con relojes falsos para poder «adelantar» el tiempo.
    let r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/token?grant_type=password`, headers: { apikey: 'k' }, body: JSON.stringify({ email: 'ana@correo.com', password: PASS }) });
    const token = r.body.access_token;
    const userId = r.body.user.id;
    const cloud = createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: mock.fetch });
    const local = createMemoryWorkspaceStore();
    /** @type {Array<{ cb: () => void, ms: number }>} */
    const timers = [];
    const controller = createSyncController({
      cloud, local, storage: fakeStorage(), userId,
      engineOptions: { locks: null, setTimer: (cb, ms) => { const t = { cb, ms }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } },
    });
    const remote = [];
    controller.api.onRemote((x) => remote.push(x));
    assert.equal((await controller.api.enable()).ok, true);
    const polls = () => timers.filter((t) => t.ms === 180_000);
    const settle = () => new Promise((res) => setTimeout(res, 30));
    // Corre la revisión del arranque (0 ms), como pasaría al instante en la app.
    for (const t of timers.filter((x) => x.ms === 0)) { timers.splice(timers.indexOf(t), 1); t.cb(); }
    await settle();
    assert.equal(polls().length, 1, 'al activar queda programada la revisión de cada 3 minutos');

    // En A se registra un gasto y se envía.
    const dinner = movement({ description: 'Cena (otro dispositivo)' });
    await A.store.forWorkspace(ws.id).putMany({ movements: [dinner] });
    await A.api.syncNow();
    assert.equal((await local.forWorkspace(ws.id).load()).movements.some((m) => m.id === dinner.id), false);

    // Pasan 3 minutos: sin pulsar nada, llega.
    const tick = polls()[0];
    timers.splice(timers.indexOf(tick), 1);
    tick.cb();
    for (let i = 0; i < 50 && remote.length === 0; i += 1) await new Promise((res) => setTimeout(res, 10));
    assert.equal((await local.forWorkspace(ws.id).load()).movements.some((m) => m.id === dinner.id), true, 'el gasto llegó solo');
    assert.equal(remote.length, 1, 'se avisó a la pantalla para que se redibuje');
    assert.equal(polls().length, 1, 'la siguiente revisión quedó programada');
    controller.api.disableOnThisDevice();
    assert.equal(polls().length, 0, 'al apagar la copia, deja de revisar');
  });
});
