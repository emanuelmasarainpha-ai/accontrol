// 0.16.0 (paso 5) — Miembros: invitar, unirse con un código, cambiar rol, quitar, anular y salir, a través de
// account.sync.share (lo que usa la pantalla Miembros), con dispositivos completos contra la nube simulada.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createCloudStore } from '../src/data/cloudStore.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { buildDemoData } from '../src/domain/demo.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import {
  canRevoke, invitableRoles, inviteMessage, isShareable, memberActions, normalizeInviteCode,
} from '../src/domain/sharing.js';
import { createSyncController } from '../src/sync/syncController.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const URL_ = 'https://p.supabase.co';
const T = '2026-11-14';
const N = '2026-11-14T12:00:00.000Z';
const PASS = 'Vela9Lima!';
const CODE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

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

/** Un dispositivo de una persona. `enable: false` = con la copia en la nube apagada. */
async function device(mock, email, { workspaces = [], data = {}, enable = true } = {}) {
  let r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/token?grant_type=password`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  if (r.status !== 200) r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  const token = r.body.access_token;
  const userId = r.body.user.id;
  /** @type {string[]} */
  const calls = [];
  const spy = (url, init = {}) => { calls.push(`${init.method ?? 'GET'} ${url}`); return mock.fetch(url, init); };
  const cloud = createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: spy });
  const local = createMemoryWorkspaceStore({ workspaces, data });
  const storage = fakeStorage();
  const controller = createSyncController({ cloud, local, storage, userId, engineOptions: noTimers });
  /** @type {any[]} */
  const remote = [];
  controller.api.onRemote((x) => remote.push(x));
  if (enable) assert.equal((await controller.api.enable()).ok, true);
  return { cloud, local, userId, remote, api: controller.api, share: controller.api.share, store: controller.store, storage, calls };
}

/** Ana (dueña de «Empresa ABC», con una venta) y Beto (con su espacio personal), sin compartir todavía. */
async function people() {
  const mock = createMockAuthServer();
  const shop = buildWorkspace({ kind: 'company', name: 'Empresa ABC', isDefault: true }, { id: randomUUID(), nowISO: N });
  const sale = movement();
  const ana = await device(mock, 'ana@correo.com', { workspaces: [shop], data: { [shop.id]: { movements: [sale] } } });
  const own = buildWorkspace({ kind: 'personal', name: 'Lo de Beto', isDefault: true }, { id: randomUUID(), nowISO: N });
  const beto = await device(mock, 'beto@correo.com', { workspaces: [own] });
  return { mock, shop, sale, own, ana, beto };
}

/** Ana invita a Beto con `role` y él se une con el código. */
async function joined(role) {
  const ctx = await people();
  const inv = await ctx.ana.share.invite(ctx.shop.id, role);
  assert.equal(inv.ok, true, JSON.stringify(inv));
  const join = await ctx.beto.share.join(inv.ok ? inv.code : '');
  assert.equal(join.ok, true, JSON.stringify(join));
  assert.equal(join.ok && join.role, role, 'se une con el rol de la invitación');
  assert.equal((await wsOf(ctx.beto, ctx.shop.id))?.role, role);
  return ctx;
}

const wsOf = async (dev, id) => (await dev.local.listWorkspaces()).find((w) => w.id === id);

// ------------------------------------------------------------------ reglas (sin nube)

describe('reglas para compartir', () => {
  const base = buildWorkspace({ kind: 'company', name: 'X', isDefault: false }, { id: 'a', nowISO: N });
  it('el Personal no se comparte; el dueño invita admin y contador; el admin solo contador; el contador a nadie', () => {
    assert.equal(isShareable({ ...base, kind: 'personal' }), false);
    assert.deepEqual(invitableRoles({ ...base, kind: 'personal' }), []);
    assert.deepEqual(invitableRoles(base), ['admin', 'accountant']);
    assert.deepEqual(invitableRoles({ ...base, role: 'admin' }), ['accountant']);
    assert.deepEqual(invitableRoles({ ...base, role: 'accountant' }), []);
  });
  it('quién cambia el rol, quita y anula (igual que la nube)', () => {
    const m = (role, isMe = false) => ({ role, isMe });
    assert.deepEqual(memberActions('owner', m('admin')), { changeRole: true, remove: true });
    assert.deepEqual(memberActions('owner', m('owner', true)), { changeRole: false, remove: false });
    assert.deepEqual(memberActions('admin', m('accountant')), { changeRole: false, remove: true });
    assert.deepEqual(memberActions('admin', m('admin')), { changeRole: false, remove: false });
    assert.deepEqual(memberActions('admin', m('admin', true)), { changeRole: false, remove: false });
    assert.deepEqual(memberActions('accountant', m('accountant')), { changeRole: false, remove: false });
    // Sobre ti mismo nunca (para irte está «Salir del espacio»), sea cual sea la combinación.
    for (const mine of ['owner', 'admin', 'accountant']) for (const theirs of ['admin', 'accountant']) {
      assert.deepEqual(memberActions(mine, m(theirs, true)), { changeRole: false, remove: false }, mine + '/' + theirs);
    }
    assert.equal(canRevoke('owner', { role: 'admin' }), true);
    assert.equal(canRevoke('admin', { role: 'accountant' }), true);
    assert.equal(canRevoke('admin', { role: 'admin' }), false);
    assert.equal(canRevoke('accountant', { role: 'accountant' }), false);
  });
  it('el código se acepta pegado de cualquier forma, y se rechaza si no puede ser uno', () => {
    assert.equal(normalizeInviteCode(' abcd-efgh-jkmn '), 'ABCD-EFGH-JKMN');
    assert.equal(normalizeInviteCode('abcdefghjkmn'), 'ABCD-EFGH-JKMN');
    assert.equal(normalizeInviteCode('ABCD EFGH JKMN'), 'ABCD-EFGH-JKMN');
    assert.equal(normalizeInviteCode('ABCD-EFGH-JKM'), null, 'corto');
    assert.equal(normalizeInviteCode('ABCD-EFGH-JKM0'), null, 'el 0 no existe en los códigos');
    assert.equal(normalizeInviteCode('ABCD-EFGH-JKMI'), null, 'la I tampoco');
    assert.equal(normalizeInviteCode(''), null);
  });
  it('el mensaje para enviar lleva el espacio, el rol, el código, la fecha y los pasos', () => {
    const text = inviteMessage({ workspaceName: 'Empresa ABC', code: 'ABCD-EFGH-JKMN', role: 'accountant', expires: '21 nov 2026' });
    for (const part of ['«Empresa ABC»', 'Contador', 'ABCD-EFGH-JKMN', '21 nov 2026', 'Unirme con un código', 'una sola vez']) assert.ok(text.includes(part), part);
  });
});

// ------------------------------------------------------------------ con la nube

describe('miembros a través de account.sync.share', () => {
  it('sin la copia en la nube no se comparte (y no se llama a la nube)', async () => {
    const mock = createMockAuthServer();
    const shop = buildWorkspace({ kind: 'company', name: 'Empresa ABC', isDefault: true }, { id: randomUUID(), nowISO: N });
    const off = await device(mock, 'ana@correo.com', { workspaces: [shop], enable: false });
    const before = off.calls.length;
    for (const r of [await off.share.invite(shop.id, 'accountant'), await off.share.list(shop.id), await off.share.join('ABCD-EFGH-JKMN'), await off.share.leave(shop.id)]) {
      assert.equal(r.ok, false);
      assert.match(!r.ok ? r.message : '', /activar la copia en la nube/);
    }
    assert.equal(off.calls.length, before);
  });

  it('invitar → unirse: el espacio llega al momento con su rol y sus datos; la invitación ya no queda pendiente', async () => {
    const { mock, shop, sale, ana, beto } = await people();
    const inv = await ana.share.invite(shop.id, 'accountant');
    assert.equal(inv.ok, true);
    assert.match(inv.ok ? inv.code : '', CODE);
    const pending = await ana.share.list(shop.id);
    assert.equal(pending.ok && pending.invites.length, 1);
    assert.deepEqual(pending.ok && pending.members.map((m) => [m.role, m.isMe]), [['owner', true]]);

    const join = await beto.share.join(inv.ok ? inv.code.toLowerCase() : '');
    assert.deepEqual(join.ok && { name: join.workspaceName, role: join.role, id: join.workspaceId }, { name: 'Empresa ABC', role: 'accountant', id: shop.id });
    assert.equal((await wsOf(beto, shop.id))?.role, 'accountant', 'ya está en su dispositivo sin esperar');
    assert.deepEqual((await beto.local.forWorkspace(shop.id).load()).movements.map((m) => m.id), [sale.id]);

    const after = await ana.share.list(shop.id);
    assert.deepEqual(after.ok && after.members.map((m) => m.role), ['owner', 'accountant']);
    assert.equal(after.ok && after.invites.length, 0, 'usada: ya no está pendiente');
    // El mismo código no sirve dos veces.
    const carla = await device(mock, 'carla@correo.com');
    assert.equal((await carla.share.join(inv.ok ? inv.code : '')).ok, false);
  });

  it('unirse mientras ya hay una sincronización en marcha: igual trae el espacio (fallo visto contra la nube real)', async () => {
    const { shop, ana, beto } = await people();
    const inv = await ana.share.invite(shop.id, 'accountant');
    const busy = beto.api.syncNow(); // esta vuelta empezó ANTES de aceptar el código
    const join = await beto.share.join(inv.ok ? inv.code : '');
    await busy;
    assert.equal(join.ok, true);
    assert.equal((await wsOf(beto, shop.id))?.role, 'accountant', 'el espacio ya está en el dispositivo al terminar «unirse»');
  });

  it('«Sincronizar ahora» durante una vuelta en marcha hace otra bajada después (no se pierde)', async () => {
    const { shop, sale, ana, beto } = await joined('admin');
    const busy = beto.api.syncNow();
    // Mientras tanto, la dueña cambia algo en la nube.
    await ana.store.forWorkspace(shop.id).putMany({ movements: [{ ...sale, description: 'Cambiada', updatedAt: new Date(Date.now() + 60_000).toISOString() }] });
    await ana.api.syncNow();
    await beto.api.syncNow();
    await busy;
    const moves = (await beto.local.forWorkspace(shop.id).load()).movements;
    assert.deepEqual(moves.map((m) => m.description), ['Cambiada']);
  });

  it('invitar en un espacio recién creado que todavía no subió: primero lo sube', async () => {
    const { ana } = await people();
    const fresh = buildWorkspace({ kind: 'entrepreneur', name: 'Tienda nueva', isDefault: false }, { id: randomUUID(), nowISO: N });
    await ana.store.createWorkspace(fresh); // anotado en la bandeja; sin temporizadores, nadie lo ha enviado
    const inv = await ana.share.invite(fresh.id, 'admin');
    assert.equal(inv.ok, true, JSON.stringify(inv));
  });

  it('el Personal no se comparte (lo dice la nube)', async () => {
    const { own, beto } = await people();
    const inv = await beto.share.invite(own.id, 'accountant');
    assert.equal(inv.ok, false);
    assert.match(!inv.ok ? inv.message : '', /Personal no se comparte/);
  });

  it('el Contador ve los miembros pero no las invitaciones (ni se piden a la nube)', async () => {
    const { shop, ana, beto } = await joined('accountant');
    await ana.share.invite(shop.id, 'accountant');
    beto.calls.length = 0;
    const list = await beto.share.list(shop.id);
    assert.equal(list.ok, true);
    assert.deepEqual(list.ok && list.invites, []);
    assert.equal(list.ok && list.members.length, 2);
    assert.ok(!beto.calls.some((c) => c.includes('workspace_invites')));
    const inv = await beto.share.invite(shop.id, 'accountant');
    assert.equal(inv.ok, false, 'tampoco puede invitar');
  });

  it('la dueña cambia el rol y le llega a Beto; como Administrador invita contadores pero no administradores', async () => {
    const { shop, ana, beto } = await joined('accountant');
    const list = await ana.share.list(shop.id);
    const betoId = list.ok ? list.members.find((m) => !m.isMe)?.userId ?? '' : '';
    assert.equal((await ana.share.setRole(shop.id, betoId, 'admin')).ok, true);
    await beto.api.syncNow();
    assert.equal((await wsOf(beto, shop.id))?.role, 'admin');
    assert.equal((await beto.share.invite(shop.id, 'accountant')).ok, true);
    const admin = await beto.share.invite(shop.id, 'admin');
    assert.equal(admin.ok, false);
    assert.match(!admin.ok ? admin.message : '', /Solo el dueño puede invitar administradores/);
  });

  it('anular: el código deja de servir', async () => {
    const { shop, ana, beto } = await people();
    const inv = await ana.share.invite(shop.id, 'accountant');
    const list = await ana.share.list(shop.id);
    const id = list.ok ? list.invites[0].id : '';
    assert.equal((await ana.share.revoke(id)).ok, true);
    const after = await ana.share.list(shop.id);
    assert.equal(after.ok && after.invites.length, 0);
    const join = await beto.share.join(inv.ok ? inv.code : '');
    assert.equal(join.ok, false);
    assert.equal(await wsOf(beto, shop.id), undefined);
  });

  it('quitar a un miembro: desaparece de su dispositivo en la siguiente sincronización', async () => {
    const { shop, ana, beto, own } = await joined('admin');
    const list = await ana.share.list(shop.id);
    const betoId = list.ok ? list.members.find((m) => !m.isMe)?.userId ?? '' : '';
    assert.equal((await ana.share.remove(shop.id, betoId)).ok, true);
    await beto.api.syncNow();
    assert.equal(await wsOf(beto, shop.id), undefined);
    assert.deepEqual(beto.remote.at(-1).lostAccess, ['Empresa ABC']);
    assert.ok(await wsOf(beto, own.id), 'su espacio propio sigue');
    const again = await ana.share.list(shop.id);
    assert.deepEqual(again.ok && again.members.map((m) => m.role), ['owner']);
  });

  it('salir: se quita al momento de su dispositivo, no vuelve al sincronizar y los datos de la dueña siguen', async () => {
    const { shop, sale, ana, beto, own } = await joined('admin');
    // Algo pendiente de enviar en ese espacio: al salir se descarta (ya no podría enviarse).
    await beto.store.forWorkspace(shop.id).putMany({ movements: [movement({ description: 'Sin enviar' })] });
    const left = await beto.share.leave(shop.id);
    assert.equal(left.ok, true);
    assert.equal(await wsOf(beto, shop.id), undefined, 'quitado al momento');
    assert.ok(![...Array(beto.storage.length).keys()].some((i) => (beto.storage.key(i) ?? '').includes(shop.id)), 'sin cursores ni pendientes de ese espacio');
    await beto.api.syncNow();
    assert.equal(await wsOf(beto, shop.id), undefined, 'no vuelve');
    assert.equal(beto.api.state().status.lastError, null);
    assert.ok(await wsOf(beto, own.id));
    await ana.api.syncNow();
    const moves = (await ana.local.forWorkspace(shop.id).load()).movements.map((m) => m.description);
    assert.deepEqual(moves, [sale.description], 'lo de la dueña sigue y lo que Beto no envió no llegó');
    const list = await ana.share.list(shop.id);
    assert.deepEqual(list.ok && list.members.map((m) => m.role), ['owner']);
  });

  it('la dueña no puede salir de su propio espacio', async () => {
    const { shop, ana } = await people();
    const r = await ana.share.leave(shop.id);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.message : '', /dueño no puede salir/);
    assert.ok(await wsOf(ana, shop.id), 'y no se quitó de su dispositivo');
  });
});
