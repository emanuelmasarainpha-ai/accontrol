// 0.16.1 (paso 3) — Sincronización con roles a medida: dispositivos completos de dos personas contra la nube simulada.
// Ana (dueña de «Empresa ABC», con una venta y un activo) crea el rol «Cajero» y se lo da a Beto.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createCloudStore } from '../src/data/cloudStore.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { buildDemoData } from '../src/domain/demo.js';
import { normalizePermissions, TEMPLATES } from '../src/domain/permissions.js';
import { canEditData, permissionsOf, roleLabel } from '../src/domain/roles.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import { createSyncController } from '../src/sync/syncController.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const URL_ = 'https://p.supabase.co';
const T = '2026-11-16';
const N = '2026-11-16T12:00:00.000Z';
const PASS = 'Vela9Lima!';
const later = (min) => new Date(Date.parse(N) + min * 60_000).toISOString();
const CASHIER = /** @type {any} */ (TEMPLATES.find((t) => t.id === 'cashier')).permissions;

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
const asset = () => {
  const { isDemo: _d, ...base } = buildDemoData(T, N).assets[0];
  return { ...base, id: randomUUID(), name: 'Caja fuerte', createdAt: N, updatedAt: N };
};

/** Un dispositivo de una persona, con la copia en la nube activada. */
async function device(mock, email, { workspaces = [], data = {} } = {}) {
  let r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/token?grant_type=password`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  if (r.status !== 200) r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: PASS }) });
  const token = r.body.access_token;
  const userId = r.body.user.id;
  const cloud = createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: mock.fetch });
  const local = createMemoryWorkspaceStore({ workspaces, data });
  const controller = createSyncController({ cloud, local, storage: fakeStorage(), userId, engineOptions: noTimers });
  /** @type {any[]} */
  const remote = [];
  controller.api.onRemote((x) => remote.push(x));
  const enabled = await controller.api.enable();
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  return { cloud, local, userId, remote, api: controller.api, share: controller.api.share, store: controller.store };
}

/** Ana con «Empresa ABC» (una venta y un activo); Beto entra con el rol `permissions` («Cajero» si no se dice). */
async function withRole(permissions = CASHIER, name = 'Cajero') {
  const mock = createMockAuthServer();
  const shop = buildWorkspace({ kind: 'company', name: 'Empresa ABC', isDefault: true }, { id: randomUUID(), nowISO: N });
  const sale = movement();
  const box = asset();
  const ana = await device(mock, 'ana@correo.com', { workspaces: [shop], data: { [shop.id]: { movements: [sale], assets: [box] } } });
  const own = buildWorkspace({ kind: 'personal', name: 'Lo de Beto', isDefault: true }, { id: randomUUID(), nowISO: N });
  const beto = await device(mock, 'beto@correo.com', { workspaces: [own] });
  const made = await ana.share.createRole(shop.id, name, permissions);
  assert.equal(made.ok, true, JSON.stringify(made));
  const roleId = made.ok ? made.id : '';
  const inv = await ana.share.invite(shop.id, 'custom', roleId);
  assert.equal(inv.ok, true, JSON.stringify(inv));
  const joined = await beto.share.join(inv.ok ? inv.code : '');
  assert.equal(joined.ok, true, JSON.stringify(joined));
  return { mock, shop, sale, box, own, ana, beto, roleId, joined };
}

const wsOf = async (dev, id) => (await dev.local.listWorkspaces()).find((w) => w.id === id);
const dataOf = async (dev, id) => dev.local.forWorkspace(id).load();
const live = (mock, table, ws) => mock.data.live(table, ws);

describe('sincronización con roles a medida', () => {
  it('al unirse llega el rol con su nombre y sus permisos, y el aviso lo nombra', async () => {
    const { shop, beto, joined } = await withRole();
    assert.deepEqual(joined.ok && { role: joined.role, roleName: joined.roleName }, { role: 'custom', roleName: 'Cajero' });
    const ws = await wsOf(beto, shop.id);
    assert.equal(ws?.role, 'custom');
    assert.equal(ws?.customRole?.name, 'Cajero');
    assert.deepEqual(permissionsOf(ws), CASHIER);
    assert.equal(roleLabel(ws), 'Cajero');
    assert.equal(canEditData(ws), true);
  });

  it('solo baja lo que el rol deja ver: la venta sí, el patrimonio no; cada registro trae quién lo creó', async () => {
    const { shop, sale, ana, beto } = await withRole();
    const data = await dataOf(beto, shop.id);
    assert.deepEqual(data.movements.map((m) => m.id), [sale.id]);
    assert.equal(data.movements[0].createdBy, ana.userId);
    assert.deepEqual(data.assets, [], 'sin acceso a Patrimonio');
  });

  it('lo que registra el cajero llega a la dueña; puede corregir lo suyo', async () => {
    const { mock, shop, ana, beto } = await withRole();
    const mine = movement({ description: 'Venta del cajero' });
    await beto.store.forWorkspace(shop.id).putMany({ movements: [mine] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null);
    const row = live(mock, 'movements', shop.id).find((m) => m.id === mine.id);
    assert.equal(row?.created_by, beto.userId);
    // Lo corrige después de que llegó (ya trae createdBy = él).
    await beto.api.syncNow();
    const back = (await dataOf(beto, shop.id)).movements.find((m) => m.id === mine.id);
    await beto.store.forWorkspace(shop.id).putMany({ movements: [{ ...back, description: 'Venta corregida', updatedAt: later(5) }] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null);
    assert.equal(live(mock, 'movements', shop.id).find((m) => m.id === mine.id)?.description, 'Venta corregida');
    await ana.api.syncNow();
    assert.ok((await dataOf(ana, shop.id)).movements.some((m) => m.description === 'Venta corregida'));
  });

  it('la venta de la dueña (con solo «Registrar») no se sube, no atasca y vuelve aquí a como está en la nube', async () => {
    const { mock, shop, sale, beto } = await withRole();
    const theirs = (await dataOf(beto, shop.id)).movements.find((m) => m.id === sale.id);
    await beto.store.forWorkspace(shop.id).putMany({ movements: [{ ...theirs, description: 'Cambiada por Beto', updatedAt: later(5) }] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null, 'no se atasca');
    assert.equal(live(mock, 'movements', shop.id).find((m) => m.id === sale.id)?.description, 'Venta', 'la nube no cambió');
    await beto.api.syncNow();
    const after = await dataOf(beto, shop.id);
    assert.equal(after.movements.find((m) => m.id === sale.id)?.description, 'Venta', 'aquí vuelve a como está en la nube');
  });

  it('si la dueña cambia su venta mientras el cajero tiene un cambio sin enviar en ella, manda la nube al momento', async () => {
    const { shop, sale, ana, beto } = await withRole();
    const theirs = (await dataOf(beto, shop.id)).movements.find((m) => m.id === sale.id);
    await beto.store.forWorkspace(shop.id).putMany({ movements: [{ ...theirs, description: 'Cambiada por Beto', updatedAt: later(5) }] });
    // La dueña la cambia en la nube (aunque su cambio sea «más viejo» que el de Beto, el de Beto no vale: no es suyo).
    await ana.store.forWorkspace(shop.id).putMany({ movements: [{ ...sale, description: 'Cambiada por Ana', updatedAt: later(1) }] });
    await ana.api.syncNow();
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null);
    assert.equal((await dataOf(beto, shop.id)).movements.find((m) => m.id === sale.id)?.description, 'Cambiada por Ana');
  });

  it('en un módulo que solo puede ver (Clientes) lo que cree aquí no se sube y no atasca', async () => {
    const { mock, shop, beto } = await withRole();
    const { isDemo: _d, ...client } = buildDemoData(T, N).clients?.[0] ?? { id: '', firstName: 'Luis', lastName: '', company: '', email: '', phone: '', country: '', notes: '', archived: false };
    await beto.store.forWorkspace(shop.id).putMany({ clients: [{ ...client, id: randomUUID(), firstName: 'Luis', createdAt: N, updatedAt: N }] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null, 'no se atasca');
    assert.equal(live(mock, 'clients', shop.id).length, 0, 'no llegó a la nube');
  });

  it('en un módulo que no puede ver (Patrimonio) lo que cree aquí no se sube y se quita de este dispositivo', async () => {
    const { mock, shop, beto } = await withRole();
    await beto.store.forWorkspace(shop.id).putMany({ assets: [asset()] });
    await beto.api.syncNow();
    assert.equal(beto.api.state().status.lastError, null, 'no se atasca');
    assert.equal(live(mock, 'assets', shop.id).length, 1, 'solo el de la dueña');
    assert.deepEqual((await dataOf(beto, shop.id)).assets, []);
  });

  it('si la dueña cambia los permisos del rol, al cajero le llegan (y ve lo que antes no)', async () => {
    const { shop, ana, beto, roleId } = await withRole();
    const more = normalizePermissions({ ...CASHIER, assets: 'view' }).permissions;
    assert.equal((await ana.share.updateRole(roleId, 'Cajero', more)).ok, true);
    await beto.api.syncNow();
    assert.deepEqual(permissionsOf(await wsOf(beto, shop.id)).assets, 'view');
    assert.deepEqual(beto.remote.at(-1).roleChanges, [{ name: 'Empresa ABC', role: 'custom', label: 'Cajero' }]);
    assert.equal((await dataOf(beto, shop.id)).assets.length, 1, 'ahora ve el activo');
  });

  it('si le cambian a un rol que no ve un módulo, lo de ese módulo se quita de su dispositivo', async () => {
    const { shop, ana, beto } = await withRole();
    assert.equal((await dataOf(beto, shop.id)).movements.length, 1);
    const only = normalizePermissions({ assets: 'view' }).permissions;
    const made = await ana.share.createRole(shop.id, 'Solo patrimonio', only);
    const list = await ana.share.list(shop.id);
    const betoId = list.ok ? list.members.find((m) => !m.isMe)?.userId ?? '' : '';
    assert.equal((await ana.share.setRole(shop.id, betoId, 'custom', made.ok ? made.id : '')).ok, true);
    await beto.api.syncNow();
    const data = await dataOf(beto, shop.id);
    assert.deepEqual(data.movements, [], 'ya no ve los movimientos');
    assert.equal(data.assets.length, 1);
    assert.equal(roleLabel(await wsOf(beto, shop.id)), 'Solo patrimonio');
    assert.equal(canEditData(await wsOf(beto, shop.id)), false, 'solo ve: es de solo lectura');
  });

  it('la lista de miembros dice el nombre del rol a medida', async () => {
    const { shop, ana } = await withRole();
    const list = await ana.share.list(shop.id);
    const member = list.ok ? list.members.find((m) => !m.isMe) : null;
    assert.deepEqual(member && { role: member.role, name: member.customRoleName }, { role: 'custom', name: 'Cajero' });
    const roles = await ana.share.roles(shop.id);
    assert.deepEqual(roles.ok && roles.roles.map((r) => r.name), ['Cajero']);
  });

  it('un rol en uso no se borra; cambiándole el rol a la persona, sí', async () => {
    const { shop, ana, roleId } = await withRole();
    const blocked = await ana.share.deleteRole(roleId);
    assert.equal(blocked.ok, false);
    assert.match(!blocked.ok ? blocked.message : '', /lo tiene 1 persona/);
    const list = await ana.share.list(shop.id);
    const betoId = list.ok ? list.members.find((m) => !m.isMe)?.userId ?? '' : '';
    assert.equal((await ana.share.setRole(shop.id, betoId, 'accountant')).ok, true);
    assert.equal((await ana.share.deleteRole(roleId)).ok, true);
  });

  it('un segundo dispositivo del cajero activa la copia sin que la nube rechace nada', async () => {
    const { mock, shop, beto } = await withRole();
    const mine = movement({ description: 'Del cajero' });
    await beto.store.forWorkspace(shop.id).putMany({ movements: [mine] });
    await beto.api.syncNow();
    const other = await device(mock, 'beto@correo.com');
    const ws = await wsOf(other, shop.id);
    assert.equal(roleLabel(ws), 'Cajero');
    const data = await dataOf(other, shop.id);
    assert.equal(data.movements.length, 2);
    assert.deepEqual(data.assets, []);
  });
});
