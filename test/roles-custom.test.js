// 0.16.1 (paso 4) — Permisos por módulo en la app: el «cerebro» (store) y las reglas de pantalla con un rol a medida.
// «Cajero» = Movimientos, Inventario y Facturas: Registrar; Clientes: Ver; lo demás (Metas, Patrimonio…): sin acceso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import { buildFreelancerDemo } from '../src/domain/demo.js';
import { allAt, MODULE_OF_KIND, normalizePermissions, TEMPLATES } from '../src/domain/permissions.js';
import {
  ACTION_MODULE, allowsWrite, EDIT_ACTION_KIND, isMine, lockedTokens, NOT_YOURS_MESSAGE, roleCss, ROUTE_MODULE, WRITE_ACTIONS,
} from '../src/domain/roles.js';

const fixedNow = new Date(2026, 10, 16, 10, 0);
const TODAY = '2026-11-16';
const ME = 'beto-0000';
const ANA = 'ana-0000';
const SHARED = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const CASHIER = /** @type {any} */ (TEMPLATES.find((t) => t.id === 'cashier')).permissions;

function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
const expense = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'expense', amountText: '800', date: TODAY, time: '14:30',
  description: 'Compra', classification: 'variable', categoryId: 'cat-exp-otros', ...over,
});

/**
 * Beto abre «Tienda de Ana» con un rol a medida. Hay un gasto de Ana, uno guardado antes de la 0.16.1 (sin creador) y
 * un cliente de Ana.
 * @param {import('../src/domain/permissions.js').Permissions} permissions @param {string} [name]
 */
async function asRole(permissions, name = 'Cajero') {
  const shared = { ...buildWorkspace({ kind: 'business', name: 'Tienda de Ana', isDefault: true }, { id: SHARED, nowISO: fixedNow.toISOString() }), role: /** @type {const} */ ('custom'), customRole: { id: 'r1', name, permissions } };
  const base = { type: 'expense', amountCents: 50000, date: TODAY, time: '09:00', classification: 'variable', categoryId: 'cat-exp-otros', createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString() };
  const client = { ...buildFreelancerDemo(TODAY, fixedNow.toISOString()).clients[0], id: 'c-ana', createdBy: ANA };
  delete (/** @type {any} */ (client)).isDemo;
  const root = createMemoryWorkspaceStore({
    workspaces: [shared],
    data: { [SHARED]: { movements: [{ ...base, id: 'm-ana', description: 'De Ana', createdBy: ANA }, { ...base, id: 'm-viejo', description: 'Antiguo', createdBy: null }], clients: [client] } },
  });
  const store = createStore(root, tickingClock(), { userId: ME });
  await store.init();
  return { root, store };
}
const saved = async (root) => root.forWorkspace(SHARED).load();

// ------------------------------------------------------------------ reglas puras

test('reglas: cada botón de escritura tiene módulo; los de cambiar algo que existe, un tipo de ese mismo módulo', () => {
  assert.deepEqual([...WRITE_ACTIONS].sort(), Object.keys(ACTION_MODULE).sort());
  for (const [action, kind] of Object.entries(EDIT_ACTION_KIND)) {
    assert.ok(kind in MODULE_OF_KIND, `${action}: ${kind}`);
    assert.equal(MODULE_OF_KIND[kind], ACTION_MODULE[action], `${action}: el tipo y el botón son del mismo módulo`);
  }
});

test('reglas: «tuyo» = creado aquí (sin creador) o por ti; lo de antes de la 0.16.1 (creador vacío) no es de nadie', () => {
  assert.equal(isMine({ id: 'x' }, ME), true);
  assert.equal(isMine({ id: 'x', createdBy: ME }, ME), true);
  assert.equal(isMine({ id: 'x', createdBy: ANA }, ME), false);
  assert.equal(isMine({ id: 'x', createdBy: null }, ME), false);
  assert.equal(isMine({ id: 'x', createdBy: ME }, null), false, 'sin saber quién eres, nada es «tuyo» si tiene creador');
  const w = /** @type {any} */ ({ role: 'custom', customRole: { id: 'r', name: 'Cajero', permissions: CASHIER } });
  assert.equal(allowsWrite(w, 'movements', null, ME), true, 'crear');
  assert.equal(allowsWrite(w, 'movements', { createdBy: ME }, ME), true, 'cambiar lo suyo');
  assert.equal(allowsWrite(w, 'movements', { createdBy: ANA }, ME), false, 'cambiar lo ajeno');
  assert.equal(allowsWrite(w, 'clients', null, ME), false, 'solo ve clientes');
  assert.equal(allowsWrite(w, 'assets', null, ME), false, 'no ve patrimonio');
  assert.equal(allowsWrite(/** @type {any} */ ({}), 'assets', { createdBy: ANA }, ME), true, 'el dueño, todo');
});

test('pantalla: lo que el cajero no puede, como palabras para <html data-locked>, y las reglas de estilo que lo esconden', () => {
  const locks = lockedTokens(/** @type {any} */ ({ role: 'custom', customRole: { id: 'r', name: 'Cajero', permissions: CASHIER } }));
  for (const t of ['assets:view', 'assets:create', 'goals:view', 'clients:create', 'all:create']) assert.ok(locks.includes(t), t);
  for (const t of ['movements:create', 'movements:view', 'clients:view', 'invoices:create']) assert.ok(!locks.includes(t), t);
  assert.deepEqual(lockedTokens(null), [], 'el dueño no tiene nada bloqueado');
  assert.ok(lockedTokens(/** @type {any} */ ({ role: 'accountant' })).includes('movements:create'));
  const css = roleCss();
  assert.ok(css.includes('[data-locked~="assets:create"] [data-action="new-asset"]'));
  assert.ok(css.includes('[data-locked~="all:create"] [data-action="load-demo"]'));
  for (const [route, module] of Object.entries(ROUTE_MODULE)) assert.ok(css.includes(`[data-locked~="${module}:view"] a[href="#/${route}"]`), route);
  const index = readFileSync(new URL('../src/app/router.js', import.meta.url), 'utf8');
  for (const route of Object.keys(ROUTE_MODULE)) assert.ok(index.includes(`id: '${route}'`), `la pantalla «${route}» existe`);
});

// ------------------------------------------------------------------ el «cerebro» con un rol a medida

test('cajero: registra un gasto nuevo y corrige el suyo', async () => {
  const { root, store } = await asRole(CASHIER);
  const r = await store.saveMovement(expense({ description: 'Mío' }));
  assert.ok(r.ok, JSON.stringify(r));
  const id = r.ok ? r.movement.id : '';
  assert.ok((await store.saveMovement(expense({ description: 'Mío corregido' }), id)).ok);
  assert.equal((await saved(root)).movements.find((m) => m.id === id)?.description, 'Mío corregido');
  assert.ok((await store.deleteMovement(id)).ok, 'y puede borrar lo suyo');
});

test('cajero: no cambia ni borra lo que registró otra persona (ni lo de antes de la 0.16.1), y el mensaje lo explica', async () => {
  const { root, store } = await asRole(CASHIER);
  const edit = await store.saveMovement(expense({ description: 'Tocado' }), 'm-ana');
  assert.equal(!edit.ok && edit.errors.form, NOT_YOURS_MESSAGE);
  const del = await store.deleteMovement('m-ana');
  assert.equal(!del.ok && del.errors.form, NOT_YOURS_MESSAGE);
  const old = await store.saveMovement(expense({ description: 'Tocado' }), 'm-viejo');
  assert.equal(!old.ok && old.errors.form, NOT_YOURS_MESSAGE);
  const data = await saved(root);
  assert.equal(data.movements.find((m) => m.id === 'm-ana')?.description, 'De Ana');
  assert.equal(data.movements.find((m) => m.id === 'm-viejo')?.description, 'Antiguo');
});

test('cajero: en un módulo sin acceso (Metas) o de solo ver (Clientes) no guarda, y el mensaje nombra el rol y el módulo', async () => {
  const { root, store } = await asRole(CASHIER);
  const goal = await store.saveGoal({ name: 'Viaje', description: '', targetText: '1000', targetDate: '2027-12-31' });
  assert.equal(goal.ok, false);
  assert.match(!goal.ok ? goal.errors.form : '', /«Cajero».*«Metas y aportes»/);
  const archived = await store.setClientArchived('c-ana', true);
  assert.equal(archived.ok, false);
  assert.match(!archived.ok ? archived.errors.form : '', /«Clientes y servicios»/);
  assert.equal((await saved(root)).clients[0].archived, false);
  const demo = await store.loadDemoData();
  assert.equal(demo.ok, false, 'la demostración escribe en todos los módulos');
});

test('con «Editar y borrar» en Movimientos sí cambia lo de otra persona', async () => {
  const { root, store } = await asRole(normalizePermissions({ movements: 'edit' }).permissions, 'Encargado de caja');
  assert.ok((await store.saveMovement(expense({ description: 'Corregido por el encargado' }), 'm-ana')).ok);
  assert.equal((await saved(root)).movements.find((m) => m.id === 'm-ana')?.description, 'Corregido por el encargado');
  // Pero solo en Movimientos: una meta sigue sin poder crearla (editar en un módulo no da permiso en los demás).
  const goal = await store.saveGoal({ name: 'Viaje', description: '', targetText: '1000', targetDate: '2027-12-31' });
  assert.equal(goal.ok, false);
});

test('un rol a medida que solo ve: de solo lectura, con su nombre en el mensaje', async () => {
  const { store } = await asRole(normalizePermissions({ movements: 'view', assets: 'view' }).permissions, 'Auditor');
  assert.equal(store.canEditData(), false);
  const r = await store.saveMovement(expense());
  assert.match(!r.ok ? r.errors.form : '', /como Auditor/);
});

test('el dueño y el administrador siguen como antes (todo «Editar y borrar»)', async () => {
  const { store } = await asRole(allAt('edit'), 'Casi administrador');
  assert.ok((await store.saveMovement(expense({ description: 'x' }), 'm-ana')).ok);
});
