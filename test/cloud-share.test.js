// 0.16.0 (paso 2) — Compartir un espacio desde el almacén de la nube: invitaciones, miembros y roles.
// Contra la base simulada (tools/mock-data-server.mjs), que imita la migración 20261117000100_invites.sql.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createCloudStore } from '../src/data/cloudStore.js';
import { buildDemoData } from '../src/domain/demo.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const URL_ = 'https://p.supabase.co';
const N = '2026-11-14T12:00:00.000Z';
const CODE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

const workspace = (kind, name) => ({ id: randomUUID(), kind, name, currency: 'DOP', openingBalanceCents: 0, isDefault: false, createdAt: N, updatedAt: N });

async function setup() {
  const mock = createMockAuthServer();
  /** @type {Record<string, { id: string, store: ReturnType<typeof createCloudStore> }>} */
  const people = {};
  for (const name of ['ana', 'beto', 'carla', 'dani']) {
    const r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email: `${name}@correo.com`, password: 'Vela9Lima!' }) });
    const token = r.body.access_token;
    const id = r.body.user.id;
    people[name] = { id, store: createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => id, fetch: mock.fetch }) };
  }
  const { ana, beto, carla, dani } = people;
  const shop = workspace('company', 'Empresa ABC');
  const mine = workspace('personal', 'Lo mío');
  assert.equal((await ana.store.saveWorkspaces([shop, mine])).ok, true);
  return { mock, ana, beto, carla, dani, shop, mine };
}

/** Ana invita y la persona acepta. */
async function join(owner, person, ws, role) {
  const inv = await owner.store.createInvite(ws.id, role);
  assert.equal(inv.ok, true, JSON.stringify(inv));
  const acc = await person.store.acceptInvite(inv.code);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  return acc;
}

describe('compartir: invitaciones', () => {
  it('el dueño crea un código XXXX-XXXX-XXXX que vence en 7 días; la nube solo guarda su huella', async () => {
    const { mock, ana, shop } = await setup();
    const inv = await ana.store.createInvite(shop.id, 'accountant');
    assert.equal(inv.ok, true);
    if (!inv.ok) return;
    assert.match(inv.code, CODE);
    const days = (Date.parse(inv.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7, `vence en ${days} días`);
    const stored = JSON.stringify(mock.data.invites);
    assert.ok(!stored.includes(inv.code) && !stored.includes(inv.code.replace(/-/g, '')), 'el código no se guarda');
  });

  it('aceptar: la persona entra con el rol de la invitación y ve el espacio con su rol', async () => {
    const { ana, beto, carla, shop } = await setup();
    const acc = await join(ana, beto, shop, 'admin');
    assert.deepEqual({ ws: acc.workspaceId, name: acc.workspaceName, role: acc.role }, { ws: shop.id, name: 'Empresa ABC', role: 'admin' });
    await join(ana, carla, shop, 'accountant');
    const seenByBeto = await beto.store.listWorkspaces();
    assert.equal(seenByBeto.ok && seenByBeto.workspaces.find((w) => w.workspace.id === shop.id)?.workspace.role, 'admin');
    const seenByCarla = await carla.store.listWorkspaces();
    assert.equal(seenByCarla.ok && seenByCarla.workspaces.find((w) => w.workspace.id === shop.id)?.workspace.role, 'accountant');
    const seenByAna = await ana.store.listWorkspaces();
    assert.equal(seenByAna.ok && 'role' in (seenByAna.workspaces.find((w) => w.workspace.id === shop.id)?.workspace ?? {}), false, 'el dueño no lleva rol (ausente = dueño)');
  });

  it('el código se acepta en minúsculas y sin guiones; no se puede usar dos veces', async () => {
    const { ana, beto, carla, shop } = await setup();
    const inv = await ana.store.createInvite(shop.id, 'accountant');
    if (!inv.ok) return assert.fail('invitación');
    assert.equal((await beto.store.acceptInvite(inv.code.toLowerCase().replace(/-/g, ' '))).ok, true);
    const again = await carla.store.acceptInvite(inv.code);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.error.message, 'El código no es válido o ya venció. Pide uno nuevo.');
  });

  it('el mismo mensaje para un código inventado, anulado o ya usado (no da pistas)', async () => {
    const { ana, beto, carla, dani, shop } = await setup();
    const fake = await dani.store.acceptInvite('AAAA-BBBB-CCCC');
    const inv = await ana.store.createInvite(shop.id, 'accountant');
    if (!inv.ok) return assert.fail('invitación');
    const list = await ana.store.listInvites(shop.id);
    if (!list.ok) return assert.fail('lista');
    assert.equal((await ana.store.revokeInvite(list.invites[0].id)).ok, true);
    const revoked = await beto.store.acceptInvite(inv.code);
    const inv2 = await ana.store.createInvite(shop.id, 'accountant');
    if (!inv2.ok) return assert.fail('invitación 2');
    await carla.store.acceptInvite(inv2.code);
    const used = await dani.store.acceptInvite(inv2.code);
    const messages = [fake, revoked, used].map((r) => (r.ok ? 'ACEPTÓ' : r.error.message));
    assert.deepEqual(new Set(messages).size, 1);
    assert.equal(messages[0], 'El código no es válido o ya venció. Pide uno nuevo.');
  });

  it('el espacio Personal no se comparte (con el motivo en español)', async () => {
    const { ana, mine } = await setup();
    const r = await ana.store.createInvite(mine.id, 'accountant');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.message, 'El espacio Personal no se comparte.');
  });

  it('quién puede invitar: el administrador solo contadores; el contador y alguien de fuera, nadie', async () => {
    const { ana, beto, carla, dani, shop } = await setup();
    await join(ana, beto, shop, 'admin');
    await join(ana, carla, shop, 'accountant');
    const adminAdmin = await beto.store.createInvite(shop.id, 'admin');
    assert.equal(adminAdmin.ok, false);
    if (!adminAdmin.ok) assert.equal(adminAdmin.error.message, 'Solo el dueño puede invitar administradores.');
    assert.equal((await beto.store.createInvite(shop.id, 'accountant')).ok, true);
    assert.equal((await carla.store.createInvite(shop.id, 'accountant')).ok, false);
    assert.equal((await dani.store.createInvite(shop.id, 'accountant')).ok, false);
  });

  it('la lista de invitaciones la ven dueño y administrador, nunca con el código ni su huella; el contador no la ve', async () => {
    const { ana, beto, carla, shop } = await setup();
    await join(ana, beto, shop, 'admin');
    await join(ana, carla, shop, 'accountant');
    await ana.store.createInvite(shop.id, 'accountant');
    const forAna = await ana.store.listInvites(shop.id);
    assert.equal(forAna.ok && forAna.invites.length, 3);
    if (forAna.ok) for (const inv of forAna.invites) assert.deepEqual(Object.keys(inv).sort(), ['createdAt', 'expiresAt', 'id', 'revokedAt', 'role', 'usedAt']);
    const forBeto = await beto.store.listInvites(shop.id);
    assert.equal(forBeto.ok && forBeto.invites.length, 3);
    const forCarla = await carla.store.listInvites(shop.id);
    assert.equal(forCarla.ok && forCarla.invites.length, 0);
  });
});

describe('compartir: miembros y roles', () => {
  it('lista de miembros: dueño primero; el correo de los demás solo lo ven dueño y administrador', async () => {
    const { ana, beto, carla, shop } = await setup();
    await join(ana, beto, shop, 'admin');
    await join(ana, carla, shop, 'accountant');
    const byAna = await ana.store.listMembers(shop.id);
    if (!byAna.ok) return assert.fail('lista');
    assert.deepEqual(byAna.members.map((m) => [m.role, m.email, m.isMe]), [
      ['owner', 'ana@correo.com', true], ['admin', 'beto@correo.com', false], ['accountant', 'carla@correo.com', false],
    ]);
    const byCarla = await carla.store.listMembers(shop.id);
    if (!byCarla.ok) return assert.fail('lista');
    assert.deepEqual(byCarla.members.map((m) => m.email), [null, null, 'carla@correo.com']);
  });

  it('alguien de fuera no ve los miembros', async () => {
    const { dani, shop } = await setup();
    const r = await dani.store.listMembers(shop.id);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.message, 'No perteneces a ese espacio.');
  });

  it('el contador ve los datos pero no puede guardar nada (la nube lo rechaza)', async () => {
    const { ana, carla, shop } = await setup();
    await join(ana, carla, shop, 'accountant');
    const move = { ...buildDemoData('2026-11-14', N).movements[0], id: randomUUID() };
    delete move.isDemo;
    assert.equal((await ana.store.push(shop.id, { movements: [move] })).ok, true);
    const pulled = await carla.store.pull(shop.id, {});
    assert.equal(pulled.ok && pulled.changes.movements?.length, 1, 'el contador ve el movimiento');
    const write = await carla.store.push(shop.id, { movements: [{ ...move, description: 'cambio del contador' }] });
    assert.equal(write.ok, false);
    if (!write.ok) assert.equal(write.error.code, 'forbidden');
  });

  it('solo el dueño cambia roles (y no el suyo); el cambio se ve en la lista de espacios de esa persona', async () => {
    const { ana, beto, carla, shop } = await setup();
    await join(ana, beto, shop, 'admin');
    await join(ana, carla, shop, 'accountant');
    assert.equal((await beto.store.setMemberRole(shop.id, carla.id, 'admin')).ok, false);
    const self = await ana.store.setMemberRole(shop.id, ana.id, 'admin');
    assert.equal(self.ok, false);
    if (!self.ok) assert.equal(self.error.message, 'No puedes cambiar tu propio rol.');
    assert.equal((await ana.store.setMemberRole(shop.id, beto.id, 'accountant')).ok, true);
    const seen = await beto.store.listWorkspaces();
    assert.equal(seen.ok && seen.workspaces.find((w) => w.workspace.id === shop.id)?.workspace.role, 'accountant');
    assert.equal((await beto.store.createInvite(shop.id, 'accountant')).ok, false, 'degradado: ya no invita');
  });

  it('quitar: el administrador solo quita contadores; nadie quita al dueño; quien sale de la lista deja de ver el espacio', async () => {
    const { ana, beto, carla, shop } = await setup();
    await join(ana, beto, shop, 'admin');
    await join(ana, carla, shop, 'accountant');
    assert.equal((await beto.store.removeMember(shop.id, ana.id)).ok, false);
    assert.equal((await carla.store.removeMember(shop.id, beto.id)).ok, false);
    assert.equal((await beto.store.removeMember(shop.id, carla.id)).ok, true);
    const seen = await carla.store.listWorkspaces();
    assert.equal(seen.ok && seen.workspaces.some((w) => w.workspace.id === shop.id), false);
    assert.equal((await ana.store.removeMember(shop.id, beto.id)).ok, true);
  });

  it('salir: un miembro puede irse; el dueño no', async () => {
    const { ana, beto, shop } = await setup();
    await join(ana, beto, shop, 'admin');
    const owner = await ana.store.leaveWorkspace(shop.id);
    assert.equal(owner.ok, false);
    if (!owner.ok) assert.equal(owner.error.message, 'El dueño no puede salir de su propio espacio.');
    assert.equal((await beto.store.leaveWorkspace(shop.id)).ok, true);
    const members = await ana.store.listMembers(shop.id);
    assert.equal(members.ok && members.members.length, 1);
  });

  it('eliminar la cuenta se niega si eres dueño de un espacio con otros miembros', async () => {
    const { mock, ana, beto, shop } = await setup();
    await join(ana, beto, shop, 'accountant');
    const token = (await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/token?grant_type=password`, headers: { apikey: 'k' }, body: JSON.stringify({ email: 'ana@correo.com', password: 'Vela9Lima!' }) })).body.access_token;
    const r = await mock.handle({ method: 'POST', url: `${URL_}/rest/v1/rpc/delete_my_account`, headers: { apikey: 'k', authorization: `Bearer ${token}` }, body: '{}' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Eres dueño de un espacio que tiene otros miembros/);
    assert.ok(mock.data.workspaces.has(shop.id), 'el espacio sigue ahí');
  });
});
