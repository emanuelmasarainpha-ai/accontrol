// Pruebas de los permisos por rol en la app (0.16.0, paso 4): qué puede hacer el Dueño, el Administrador y el Contador
// en un espacio compartido, tanto en el «cerebro» (store) como en lo que la pantalla esconde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { buildWorkspace } from '../src/domain/workspaces.js';
import {
  canEditData, canManageWorkspace, NOT_YOURS_TO_DELETE, OWNER_ACTIONS, OWNER_ONLY_MESSAGE, READ_ONLY_MESSAGE, roleCss, roleOf, ROLE_NAMES, WRITE_ACTIONS,
} from '../src/domain/roles.js';
import { ROLES_CSS_PATH, rolesCssFile } from '../tools/make-roles-css.mjs';
import { createBackup } from '../src/domain/backup.js';

const fixedNow = new Date(2026, 10, 14, 10, 0);
const TODAY = '2026-11-14';
const SHARED_ID = '7b0d5c1e-2f4a-4c1b-9a51-0d8f6a3e9c21';

function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}

const expense = (/** @type {Record<string,string>} */ over = {}) => ({
  type: 'expense', amountText: '800', date: TODAY, time: '14:30',
  description: 'Compra', classification: 'variable', categoryId: 'cat-exp-otros', ...over,
});

/**
 * Un espacio propio («Mío») y uno compartido conmigo («Tienda de Ana», con el rol dado), abierto este último.
 * @param {'admin' | 'accountant'} role
 */
async function withShared(role) {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind: 'personal', name: 'Mío' })).ok);
  const shared = { ...buildWorkspace({ kind: 'business', name: 'Tienda de Ana', isDefault: false }, { id: SHARED_ID, nowISO: fixedNow.toISOString() }), openingBalanceCents: 50000, role };
  await root.createWorkspace(shared);
  assert.ok((await store.switchWorkspace(SHARED_ID)).ok);
  return { root, store };
}

/** Lo que hay guardado en el dispositivo para el espacio compartido. @param {any} root */
const savedShared = (root) => root.forWorkspace(SHARED_ID).load();

// ------------------------------------------------------------------ reglas

test('reglas: sin rol eres el dueño; el Contador no edita; solo el dueño administra el espacio', () => {
  const mine = buildWorkspace({ kind: 'personal', name: 'Mío', isDefault: true }, { id: 'a', nowISO: fixedNow.toISOString() });
  assert.equal(roleOf(mine), 'owner');
  assert.equal(roleOf(null), 'owner');
  assert.equal(canEditData(mine), true);
  assert.equal(canManageWorkspace(mine), true);
  assert.equal(canEditData({ ...mine, role: 'admin' }), true);
  assert.equal(canManageWorkspace({ ...mine, role: 'admin' }), false);
  assert.equal(canEditData({ ...mine, role: 'accountant' }), false);
  assert.equal(canManageWorkspace({ ...mine, role: 'accountant' }), false);
  assert.deepEqual(ROLE_NAMES, { owner: 'Dueño', admin: 'Administrador', accountant: 'Contador', custom: 'Rol a medida' });
});

test('estilos: src/styles/roles.css está al día con las reglas (npm run roles-css) y lo carga index.html', () => {
  assert.equal(readFileSync(ROLES_CSS_PATH, 'utf8'), rolesCssFile());
  const css = roleCss();
  for (const name of WRITE_ACTIONS) assert.ok(css.includes(`[data-read-only] [data-action="${name}"]`), name);
  for (const name of OWNER_ACTIONS) assert.ok(css.includes(`[data-not-owner] [data-action="${name}"]`), name);
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /href="src\/styles\/roles\.css"/);
});

test('estilos: cada botón de la lista de escritura existe de verdad en la app (sin nombres con errores)', () => {
  // Todas las pantallas (no se usa una lista a mano: una pantalla nueva no puede quedarse fuera).
  const sources = ['views', 'app', 'ui']
    .flatMap((dir) => readdirSync(new URL(`../src/${dir}/`, import.meta.url)).filter((n) => n.endsWith('.js'))
      .map((n) => readFileSync(new URL(`../src/${dir}/${n}`, import.meta.url), 'utf8')))
    .join('\n');
  for (const name of [...WRITE_ACTIONS, ...OWNER_ACTIONS]) {
    assert.ok(sources.includes(`'${name}'`) || sources.includes(`"${name}"`), `«${name}» no aparece en la app`);
  }
});

test('estilos: toda acción común que abre un formulario o guarda está en la lista de escritura', () => {
  const actions = readFileSync(new URL('../src/app/actions.js', import.meta.url), 'utf8');
  const handled = [...actions.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
  // Las únicas acciones comunes que NO cambian datos: navegar, recargar, exportar, copiar un texto y abrir el selector.
  const readOnly = new Set(['workspace-menu', 'export', 'go', 'reload', 'invoice-reminder', 'credit-statement']);
  const missing = handled.filter((name) => !readOnly.has(name) && !WRITE_ACTIONS.includes(name));
  assert.deepEqual(missing, [], 'acciones que cambian datos y un Contador podría pulsar');
});

// ------------------------------------------------------------------ Contador

test('Contador: no se guarda nada, ni en pantalla ni en el dispositivo, y el mensaje lo explica', async () => {
  const { root, store } = await withShared('accountant');
  assert.equal(store.activeRole(), 'accountant');
  assert.equal(store.canEditData(), false);
  const r = await store.saveMovement(expense());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.errors.form, READ_ONLY_MESSAGE);
  assert.equal(store.getState().data.movements.length, 0);
  assert.equal((await savedShared(root)).movements.length, 0);
  // Tampoco la demostración, ni metas, ni categorías.
  assert.equal((await store.loadDemoData()).ok, false);
  assert.equal((await store.saveGoal({ name: 'Viaje', targetText: '1000', deadline: '' })).ok, false);
  assert.equal((await savedShared(root)).goals.length, 0);
  assert.equal((await store.saveCategory({ name: 'Nueva', kind: 'expense', classification: 'variable' })).ok, false);
});

test('Contador: puede cambiar SU nombre (es de su perfil), pero no el saldo inicial del espacio', async () => {
  const { root, store } = await withShared('accountant');
  const opening = store.getState().data.settings.openingBalanceCents;
  assert.equal(opening, 50000);
  const named = await store.saveSettings({ displayName: 'Luis', openingText: '500' });
  assert.ok(named.ok);
  assert.equal(store.getState().profile.displayName, 'Luis');
  assert.equal((await root.getProfile()).displayName, 'Luis');
  const changed = await store.saveSettings({ displayName: 'Luis', openingText: '999' });
  assert.equal(changed.ok, false);
  assert.match(!changed.ok ? changed.errors.opening : '', /Solo el dueño/);
  assert.equal((await root.listWorkspaces()).find((w) => w.id === SHARED_ID)?.openingBalanceCents, 50000);
});

test('Contador: un cambio de rol que llega de la nube se respeta sin volver a abrir el espacio', async () => {
  const { root, store } = await withShared('accountant');
  assert.equal((await store.saveMovement(expense())).ok, false);
  // La nube lo sube a Administrador: ya puede registrar.
  const w = (await root.listWorkspaces()).find((x) => x.id === SHARED_ID);
  await root.updateWorkspace({ .../** @type {any} */ (w), role: 'admin' });
  await store.refresh();
  assert.equal(store.activeRole(), 'admin');
  assert.ok((await store.saveMovement(expense())).ok);
  // Y lo bajan otra vez a Contador: deja de poder, aunque el espacio siga abierto.
  await root.updateWorkspace({ .../** @type {any} */ (w), role: 'accountant' });
  await store.refresh();
  assert.equal((await store.saveMovement(expense({ description: 'Otra' }))).ok, false);
  assert.equal((await savedShared(root)).movements.length, 1);
});

// ------------------------------------------------------------------ Administrador

test('Administrador: registra y edita datos con normalidad', async () => {
  const { root, store } = await withShared('admin');
  assert.equal(store.canEditData(), true);
  assert.equal(store.canManageWorkspace(), false);
  const r = await store.saveMovement(expense());
  assert.ok(r.ok);
  assert.equal((await savedShared(root)).movements.length, 1);
  assert.ok((await store.deleteMovement(r.ok ? r.movement.id : '')).ok);
});

test('Administrador: no renombra, no cambia la organización, no borra el espacio ni restaura una copia sobre él', async () => {
  const { root, store } = await withShared('admin');
  const renamed = await store.renameWorkspace(SHARED_ID, 'Otro nombre');
  assert.equal(!renamed.ok && renamed.errors.form, OWNER_ONLY_MESSAGE);
  const org = await store.updateOrganization(SHARED_ID, { legalName: 'Otra SRL' });
  assert.equal(!org.ok && org.errors.form, OWNER_ONLY_MESSAGE);
  const deleted = await store.deleteWorkspace(SHARED_ID);
  assert.equal(!deleted.ok && deleted.errors.form, NOT_YOURS_TO_DELETE);
  const backup = JSON.stringify(createBackup(store.getState().data, fixedNow.toISOString()));
  const restored = await store.importBackup(backup);
  assert.equal(restored.ok, false);
  assert.match(!restored.ok ? restored.errors.form : '', /Solo su dueño/);
  const after = (await root.listWorkspaces()).find((w) => w.id === SHARED_ID);
  assert.equal(after?.name, 'Tienda de Ana');
  assert.equal(after?.organization, undefined);
});

test('Administrador: el saldo inicial tampoco (es del espacio, y la nube solo deja al dueño)', async () => {
  const { store } = await withShared('admin');
  const r = await store.saveSettings({ displayName: 'Ana', openingText: '1' });
  assert.equal(r.ok, false);
  assert.ok((await store.saveSettings({ displayName: 'Ana', openingText: '500' })).ok);
});

// ------------------------------------------------------------------ Dueño

test('Dueño: en su propio espacio todo sigue igual (renombrar, saldo inicial, borrar)', async () => {
  const { store } = await withShared('admin');
  const mine = store.getState().workspaces.find((w) => w.id !== SHARED_ID);
  assert.ok(mine);
  assert.ok((await store.switchWorkspace(mine.id)).ok);
  assert.equal(store.activeRole(), 'owner');
  assert.ok((await store.renameWorkspace(mine.id, 'Lo mío')).ok);
  assert.ok((await store.saveSettings({ displayName: 'Yo', openingText: '1234' })).ok);
  assert.equal(store.getState().data.settings.openingBalanceCents, 123400);
  assert.ok((await store.saveMovement(expense())).ok);
  assert.ok((await store.deleteWorkspace(mine.id)).ok);
});
