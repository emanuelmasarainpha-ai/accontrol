import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createCloudStore } from '../src/data/cloudStore.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { buildDemoData, buildFreelancerDemo } from '../src/domain/demo.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import { createOutbox, outboxPrefix } from '../src/sync/outbox.js';
import { createSyncEngine, REJECTED_RETRY_MS, RETRY_DELAYS_MS } from '../src/sync/syncEngine.js';
import { withOutbox } from '../src/sync/trackedStore.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const T = '2026-11-13';
const N = '2026-11-13T12:00:00.000Z';
const UID = '11111111-1111-4111-8111-111111111111';
const real = (list) => list.map(({ isDemo, ...r }) => r);

/** localStorage de mentira (igual forma). */
function fakeStorage({ failOnSet = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failOnSet) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const summary = (outbox) => outbox.snapshot().map((e) => `${e.type}:${e.ws ? 'ws' : ''}:${e.kind}:${e.id ? 'id' : ''}`).sort();

describe('bandeja de pendientes', () => {
  it('anota cada cosa en su propia entrada, con prefijo de la cuenta', () => {
    const storage = fakeStorage();
    const box = createOutbox({ storage, userId: UID });
    box.markPut('W1', 'movements', ['a', 'b']);
    box.markDelete('W1', 'goals', ['g']);
    box.markWorkspace('W1');
    box.markProfile();
    assert.equal(box.pendingCount(), 5);
    assert.ok([...storage.map.keys()].every((k) => k.startsWith(outboxPrefix(UID))));
    const types = box.snapshot().map((e) => e.type).sort();
    assert.deepEqual(types, ['del', 'profile', 'put', 'put', 'ws']);
  });

  it('dos pestañas (dos bandejas sobre el mismo almacenamiento) ven las anotaciones de la otra', () => {
    const storage = fakeStorage();
    const a = createOutbox({ storage, userId: UID });
    const b = createOutbox({ storage, userId: UID });
    a.markPut('W1', 'movements', ['x']);
    b.markPut('W1', 'movements', ['y']);
    assert.deepEqual(a.snapshot().map((e) => e.id).sort(), ['x', 'y']);
  });

  it('al terminar un envío, conserva lo que volvió a cambiar mientras se enviaba', () => {
    const box = createOutbox({ storage: fakeStorage(), userId: UID });
    box.markPut('W1', 'movements', ['a', 'b']);
    const photo = box.snapshot();
    box.markPut('W1', 'movements', ['b']); // «b» se editó otra vez durante el envío
    box.settle(photo);
    assert.deepEqual(box.snapshot().map((e) => e.id), ['b']);
  });

  it('del predeterminado solo vale el último elegido', () => {
    const box = createOutbox({ storage: fakeStorage(), userId: UID });
    box.markDefault('W1');
    box.markDefault('W2');
    assert.deepEqual(box.snapshot().filter((e) => e.type === 'default').map((e) => e.ws), ['W2']);
  });

  it('no mezcla cuentas: cada una ve y borra solo lo suyo', () => {
    const storage = fakeStorage();
    const ana = createOutbox({ storage, userId: UID });
    const beto = createOutbox({ storage, userId: '22222222-2222-4222-8222-222222222222' });
    ana.markProfile();
    beto.markProfile();
    beto.clear();
    assert.equal(ana.pendingCount(), 1);
    assert.equal(beto.pendingCount(), 0);
  });

  it('si el navegador no deja guardar (lleno o ventana privada), sigue en memoria y lo dice', () => {
    const box = createOutbox({ storage: fakeStorage({ failOnSet: true }), userId: UID });
    box.markPut('W1', 'movements', ['a']);
    assert.equal(box.isMemoryOnly(), true);
    assert.equal(box.pendingCount(), 1);
    const none = createOutbox({ storage: null, userId: UID });
    none.markProfile();
    assert.equal(none.isMemoryOnly(), true);
    assert.equal(none.pendingCount(), 1);
  });

  it('avisa a sus oyentes cuando cambia', () => {
    const box = createOutbox({ storage: fakeStorage(), userId: UID });
    let calls = 0;
    const off = box.onChange(() => { calls += 1; });
    box.markProfile();
    box.settle(box.snapshot());
    off();
    box.markProfile();
    assert.equal(calls, 2);
  });
});

// ------------------------------------------------------------------ almacén con bandeja
function setupLocal(enabled = true) {
  const ws = buildWorkspace({ kind: 'personal', name: 'Personal', isDefault: true }, { id: randomUUID(), nowISO: N });
  const inner = createMemoryWorkspaceStore({ workspaces: [ws] });
  const outbox = createOutbox({ storage: fakeStorage(), userId: UID });
  const state = { enabled };
  const store = withOutbox(inner, outbox, () => state.enabled);
  return { ws, inner, outbox, store, state };
}

describe('almacén con bandeja: guarda igual que antes y anota lo que cambia', () => {
  it('con la sincronización apagada no anota nada', async () => {
    const { ws, outbox, store } = setupLocal(false);
    const demo = buildDemoData(T, N);
    await store.forWorkspace(ws.id).putMany({ movements: real(demo.movements.slice(0, 3)) });
    await store.forWorkspace(ws.id).saveSettings({ displayName: 'Ana', openingBalanceCents: 100 });
    await store.createWorkspace(buildWorkspace({ kind: 'freelancer', name: 'F' }, { id: randomUUID(), nowISO: N }));
    assert.equal(outbox.pendingCount(), 0);
  });

  it('el resultado en el dispositivo es idéntico con y sin bandeja', async () => {
    const a = setupLocal(true);
    const plain = createMemoryWorkspaceStore({ workspaces: [a.ws] });
    const demo = buildDemoData(T, N);
    const ops = async (s) => {
      const d = s.forWorkspace(a.ws.id);
      await d.putMany({ movements: real(demo.movements), goals: real(demo.goals), contributions: real(demo.contributions) });
      await d.deleteMany({ movementIds: [demo.movements[0].id] });
      await d.saveSettings({ displayName: 'Ana', openingBalanceCents: 5000 });
      await s.saveProfile({ displayName: 'Ana', lastWorkspaceId: a.ws.id });
    };
    await ops(a.store);
    await ops(plain);
    // Solo puede variar la hora en que se guardó el espacio (se guardan con milisegundos de diferencia).
    const sinHora = (snap) => ({ ...snap, workspaces: snap.workspaces.map(({ workspace, data }) => ({ workspace: { ...workspace, updatedAt: '-' }, data })) });
    assert.deepEqual(sinHora(await a.inner.loadEverything()), sinHora(await plain.loadEverything()));
  });

  it('anota los registros reales guardados y los borrados; NO los de demostración ni las categorías de fábrica', async () => {
    const { ws, outbox, store } = setupLocal();
    const demo = buildDemoData(T, N);
    const mine = real([demo.movements[1]])[0];
    await store.forWorkspace(ws.id).putMany(
      { movements: [demo.movements[0], mine], categories: [{ id: 'cat-x', name: 'X', kind: 'expense', defaultClassification: 'variable', builtIn: true }] },
      { goalIds: ['g1'] },
    );
    const snap = outbox.snapshot();
    assert.deepEqual(snap.filter((e) => e.type === 'put').map((e) => `${e.kind}:${e.id}`), [`movements:${mine.id}`]);
    assert.deepEqual(snap.filter((e) => e.type === 'del').map((e) => `${e.kind}:${e.id}`), ['goals:g1']);
  });

  it('cambiar el nombre o el saldo inicial anota el espacio y el perfil', async () => {
    const { ws, outbox, store } = setupLocal();
    await store.forWorkspace(ws.id).saveSettings({ displayName: 'Ana', openingBalanceCents: 100 });
    assert.deepEqual(summary(outbox), ['profile:::', 'ws:ws::']);
  });

  it('restaurar una copia anota lo nuevo y borra lo que ya no está', async () => {
    const { ws, outbox, store } = setupLocal();
    const demo = buildDemoData(T, N);
    const data = store.forWorkspace(ws.id);
    const goals = real(demo.goals);
    await data.putMany({ goals });
    outbox.settle(outbox.snapshot());
    const before = await data.load();
    await data.replaceAll({ ...before, goals: [goals[0]] });
    const snap = outbox.snapshot();
    assert.deepEqual(snap.filter((e) => e.type === 'del').map((e) => e.id), [goals[1].id]);
    assert.deepEqual(snap.filter((e) => e.type === 'put').map((e) => e.id), [goals[0].id]);
  });

  it('«borrar los datos del espacio» anota el borrado de cada registro', async () => {
    const { ws, outbox, store } = setupLocal();
    const goals = real(buildDemoData(T, N).goals);
    await store.forWorkspace(ws.id).putMany({ goals });
    outbox.settle(outbox.snapshot());
    await store.forWorkspace(ws.id).clearAll();
    assert.deepEqual(outbox.snapshot().filter((e) => e.type === 'del').map((e) => e.id).sort(), goals.map((g) => g.id).sort());
  });

  it('espacios: crear (y predeterminado), cambiar, borrar y elegir predeterminado quedan anotados', async () => {
    const { outbox, store } = setupLocal();
    const f = buildWorkspace({ kind: 'freelancer', name: 'F', isDefault: true }, { id: randomUUID(), nowISO: N });
    await store.createWorkspace(f);
    await store.updateWorkspace({ ...f, name: 'Freelance' });
    await store.setDefaultWorkspace(f.id);
    await store.deleteWorkspace(f.id);
    const types = outbox.snapshot().filter((e) => e.ws === f.id).map((e) => e.type).sort();
    assert.deepEqual(types, ['default', 'ws', 'wsdel']);
  });

  it('borrar TODO anota el borrado de cada espacio', async () => {
    const { ws, outbox, store } = setupLocal();
    await store.clearEverything();
    assert.deepEqual(outbox.snapshot().filter((e) => e.type === 'wsdel').map((e) => e.ws), [ws.id]);
  });

  it('si la bandeja falla, el guardado en el dispositivo se hace igual', async () => {
    const { ws, inner, store } = setupLocal();
    const broken = withOutbox(inner, { markPut() { throw new Error('bandeja rota'); }, markDelete() {}, markWorkspace() {}, markProfile() {} }, () => true);
    const goals = real(buildDemoData(T, N).goals);
    const original = console.error;
    console.error = () => {};
    try {
      await broken.forWorkspace(ws.id).putMany({ goals });
    } finally {
      console.error = original;
    }
    assert.equal((await store.forWorkspace(ws.id).load()).goals.length, goals.length);
  });

  it('si el guardado en el dispositivo falla, el error llega igual a quien guarda', async () => {
    const { ws, inner, store } = setupLocal();
    inner.failNextWrite();
    await assert.rejects(store.forWorkspace(ws.id).putMany({ goals: real(buildDemoData(T, N).goals) }), /simulado/);
  });
});

// ------------------------------------------------------------------ motor de envío
async function setupSync() {
  const mock = createMockAuthServer();
  const signup = await mock.handle({ method: 'POST', url: 'https://p.supabase.co/auth/v1/signup', headers: { apikey: 'k' }, body: JSON.stringify({ email: 'ana@correo.com', password: 'Vela9Lima!' }) });
  const token = signup.body.access_token;
  const userId = signup.body.user.id;
  const cloud = createCloudStore({ url: 'https://p.supabase.co', publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: mock.fetch });
  const ws = buildWorkspace({ kind: 'freelancer', name: 'Freelance', isDefault: true }, { id: randomUUID(), nowISO: N });
  const inner = createMemoryWorkspaceStore({ workspaces: [ws] });
  const outbox = createOutbox({ storage: fakeStorage(), userId });
  const store = withOutbox(inner, outbox, () => true);
  const timers = [];
  const engine = createSyncEngine({
    cloud, local: inner, outbox, locks: null,
    setTimer: (cb, ms) => { const t = { cb, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  return { mock, cloud, ws, inner, outbox, store, engine, timers, userId };
}

describe('motor de envío: vacía la bandeja contra la nube', () => {
  it('envía lo guardado (los 15 tipos que use el espacio) y la nube queda igual que el dispositivo, sin DEMO', async () => {
    const { mock, ws, outbox, store, engine } = await setupSync();
    const fr = buildFreelancerDemo(T, N);
    const data = { clients: real(fr.clients), services: real(fr.services), movements: real(fr.movements) };
    await store.forWorkspace(ws.id).putMany(data);
    await store.forWorkspace(ws.id).putMany({ goals: buildDemoData(T, N).goals }); // DEMO: no viaja
    const r = await engine.flush();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(outbox.pendingCount(), 0);
    assert.equal(mock.data.workspaces.get(ws.id).name, 'Freelance');
    for (const [key, table] of [['clients', 'clients'], ['services', 'services'], ['movements', 'movements']]) {
      assert.equal(mock.data.live(table, ws.id).length, data[key].length, table);
    }
    assert.equal(mock.data.live('goals', ws.id).length, 0);
  });

  it('manda la versión MÁS RECIENTE del dispositivo, aunque se haya editado varias veces', async () => {
    const { mock, ws, store, engine } = await setupSync();
    const goal = real(buildDemoData(T, N).goals)[0];
    const d = store.forWorkspace(ws.id);
    await d.putMany({ goals: [goal] });
    await d.putMany({ goals: [{ ...goal, name: 'Laptop', updatedAt: '2026-11-14T00:00:00.000Z' }] });
    await d.putMany({ goals: [{ ...goal, name: 'Laptop gamer', updatedAt: '2026-11-14T01:00:00.000Z' }] });
    await engine.flush();
    assert.deepEqual(mock.data.live('goals', ws.id).map((g) => g.name), ['Laptop gamer']);
  });

  it('un borrado se envía como marca; un borrado anotado de algo que SIGUE en el dispositivo no se envía', async () => {
    const { mock, ws, outbox, store, engine } = await setupSync();
    const goals = real(buildDemoData(T, N).goals);
    await store.forWorkspace(ws.id).putMany({ goals });
    await engine.flush();
    await store.forWorkspace(ws.id).deleteMany({ goalIds: [goals[0].id] });
    outbox.markDelete(ws.id, 'goals', [goals[1].id]); // anotación «de más»: goals[1] sigue en el dispositivo
    await engine.flush();
    assert.deepEqual(mock.data.live('goals', ws.id).map((g) => g.id), [goals[1].id]);
    assert.equal(mock.data.tables.goals.get(`${ws.id}|${goals[0].id}`).deleted_at !== null, true);
    assert.equal(outbox.pendingCount(), 0);
  });

  it('un espacio borrado se marca en la nube; si sigue en el dispositivo, no', async () => {
    const { mock, inner, outbox, store, engine } = await setupSync();
    const a = buildWorkspace({ kind: 'personal', name: 'A' }, { id: randomUUID(), nowISO: N });
    const b = buildWorkspace({ kind: 'company', name: 'B' }, { id: randomUUID(), nowISO: N });
    await store.createWorkspace(a);
    await store.createWorkspace(b);
    await engine.flush();
    await store.deleteWorkspace(a.id);
    outbox.markWorkspaceDeleted(b.id); // anotación «de más»: B sigue aquí
    await engine.flush();
    assert.notEqual(mock.data.workspaces.get(a.id).deleted_at, null);
    assert.equal(mock.data.workspaces.get(b.id).deleted_at, null);
    assert.equal((await inner.listWorkspaces()).some((w) => w.id === b.id), true);
  });

  it('un gasto nuevo NO revive un espacio que otro dispositivo borró (paso 7, hallado contra Supabase real)', async () => {
    const { mock, cloud, ws, store, engine } = await setupSync();
    await store.forWorkspace(ws.id).putMany({ clients: real(buildFreelancerDemo(T, N).clients).slice(0, 1) });
    assert.equal((await engine.flush()).ok, true);
    // Otro dispositivo borra el espacio (marca deleted_at) entre la bajada y la subida de esta vuelta.
    assert.equal((await cloud.markWorkspacesDeleted([ws.id])).ok, true);
    const deletedAt = mock.data.workspaces.get(ws.id).deleted_at;
    assert.notEqual(deletedAt, null);
    // Aquí se guarda otra cosa (no se tocó el espacio): al enviar, el espacio sigue borrado en la nube.
    await store.saveProfile({ displayName: 'Ana', lastWorkspaceId: ws.id });
    await engine.flush();
    assert.equal(mock.data.workspaces.get(ws.id).deleted_at, deletedAt, 'el espacio no debe revivir');
  });

  it('red de seguridad: un espacio de aquí que falta en la nube se crea al enviar sus datos', async () => {
    const { mock, ws, store, engine } = await setupSync(); // el espacio existe aquí y NO en la nube, sin anotación
    assert.equal(mock.data.workspaces.has(ws.id), false);
    await store.forWorkspace(ws.id).putMany({ clients: real(buildFreelancerDemo(T, N).clients).slice(0, 1) });
    assert.equal((await engine.flush()).ok, true);
    assert.equal(mock.data.workspaces.get(ws.id)?.deleted_at, null);
    assert.equal(mock.data.live('clients', ws.id).length, 1);
  });

  it('envía el perfil y el predeterminado', async () => {
    const { mock, ws, store, engine, userId } = await setupSync();
    const b = buildWorkspace({ kind: 'company', name: 'B' }, { id: randomUUID(), nowISO: N });
    await store.createWorkspace(b);
    await store.setDefaultWorkspace(b.id);
    await store.saveProfile({ displayName: 'Ana', lastWorkspaceId: ws.id });
    const r = await engine.flush();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(mock.data.profiles.get(userId).display_name, 'Ana');
    assert.equal(mock.data.profiles.get(userId).last_workspace_id, ws.id);
    assert.deepEqual(mock.data.members.filter((m) => m.is_default).map((m) => m.workspace_id), [b.id]);
  });

  it('sin internet: no pierde nada, reintenta a los 5 s y luego más espaciado; al volver la red, envía', async () => {
    const { mock, ws, outbox, store, engine, timers } = await setupSync();
    await store.forWorkspace(ws.id).putMany({ goals: real(buildDemoData(T, N).goals) });
    const pending = outbox.pendingCount();
    mock.offline = true;
    const r1 = await engine.flush();
    assert.equal(r1.ok, false);
    assert.equal(r1.error.code, 'network');
    assert.equal(outbox.pendingCount(), pending, 'lo pendiente sigue ahí');
    assert.deepEqual(timers.map((t) => t.ms), [RETRY_DELAYS_MS[0]]);
    assert.equal(engine.getStatus().lastError.code, 'network');
    await engine.flush();
    assert.deepEqual(timers.map((t) => t.ms), [RETRY_DELAYS_MS[1]]);
    mock.offline = false;
    const r3 = await engine.flush();
    assert.equal(r3.ok, true);
    assert.equal(outbox.pendingCount(), 0);
    assert.equal(engine.getStatus().lastError, null);
    assert.ok(engine.getStatus().lastSuccessAt);
  });

  it('si la nube rechaza los datos de un espacio, esos datos siguen pendientes (no se pierden de la bandeja)', async () => {
    const { mock, ws, outbox, store, engine } = await setupSync();
    const demo = buildDemoData(T, N);
    // Un pago que apunta a una deuda y un movimiento que la nube no tiene: la nube lo rechaza.
    const payment = real([demo.debtPayments[0]])[0];
    await store.forWorkspace(ws.id).putMany({ debtPayments: [payment] });
    const r = await engine.flush();
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'rejected');
    assert.equal(mock.data.workspaces.has(ws.id), true, 'el espacio sí se subió');
    assert.deepEqual(outbox.snapshot().filter((e) => e.type === 'put').map((e) => e.id), [payment.id]);
  });

  it('si la sesión venció no insiste solo; si la nube rechaza un dato, reintenta cada 10 minutos', async () => {
    const { mock, ws, store, engine, timers } = await setupSync();
    await store.forWorkspace(ws.id).putMany({ goals: real(buildDemoData(T, N).goals) });
    mock.failNext = { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } };
    const r = await engine.flush();
    assert.equal(r.error.code, 'session');
    assert.equal(timers.length, 0);
    mock.failNext = { status: 400, body: { code: '23514', message: 'check constraint' } };
    const r2 = await engine.flush();
    assert.equal(r2.error.code, 'rejected');
    assert.deepEqual(timers.map((t) => t.ms), [REJECTED_RETRY_MS]);
  });

  it('empieza solo: poco después de guardar, y enseguida al volver la conexión', async () => {
    const { ws, store, engine, timers } = await setupSync();
    const target = new EventTarget();
    engine.start({ debounceMs: 1500, onlineTarget: target });
    await store.forWorkspace(ws.id).putMany({ goals: real(buildDemoData(T, N).goals) });
    assert.equal(timers.at(-1).ms, 1500);
    target.dispatchEvent(new Event('online'));
    assert.equal(timers.at(-1).ms, 0);
    engine.stop();
    assert.equal(timers.length, 0);
  });

  it('dos envíos a la vez no se pisan: el segundo espera y hace otra vuelta', async () => {
    const { mock, ws, store, engine } = await setupSync();
    const goals = real(buildDemoData(T, N).goals);
    await store.forWorkspace(ws.id).putMany({ goals: [goals[0]] });
    const first = engine.flush();
    await store.forWorkspace(ws.id).putMany({ goals: [goals[1]] });
    const second = engine.flush(); // mientras corre el primero: espera a que termine y deja otra vuelta pedida
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(mock.count('POST /rest/v1/workspaces'), 1, 'no hubo dos envíos a la vez');
    await engine.flush(); // la vuelta pedida
    assert.equal(mock.data.live('goals', ws.id).length, 2);
  });
});
