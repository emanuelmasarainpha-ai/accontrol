// Pruebas de las reglas de los espacios de trabajo (nombres, elegir el activo, migración).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspace, hasUserData, isWorkspaceKind, KIND_INFO, nextDefaultId, normalizeWorkspaceName, pickActiveWorkspace,
  PERSONAL_WORKSPACE_ID, planLegacyMigration, sortWorkspaces, suggestWorkspaceName, validateWorkspaceName, withDefault, WORKSPACE_KINDS,
} from '../src/domain/workspaces.js';
import { LIMITS } from '../src/domain/types.js';

const NOW = '2026-11-02T10:00:00.000Z';
/** @param {string} id @param {string} name @param {Record<string, any>} [over] */
const ws = (id, name, over = {}) => ({
  id, kind: 'personal', name, currency: 'DOP', openingBalanceCents: 0, isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

test('las cuatro modalidades existen y cada una tiene sus textos', () => {
  assert.deepEqual([...WORKSPACE_KINDS], ['personal', 'freelancer', 'entrepreneur', 'company']);
  for (const kind of WORKSPACE_KINDS) {
    const info = KIND_INFO[/** @type {keyof typeof KIND_INFO} */ (kind)];
    assert.ok(info.label && info.defaultName && info.tagline && info.icon, kind);
    assert.ok(info.included.length > 0, `${kind}: qué incluye hoy`);
    assert.ok(info.soon.length > 0, `${kind}: qué llega después`);
    assert.ok(isWorkspaceKind(kind));
  }
  assert.equal(isWorkspaceKind('admin'), false);
  assert.equal(isWorkspaceKind(undefined), false);
});

test('validateWorkspaceName: vacío, muy largo y repetido', () => {
  const existing = [ws('a', 'Mi negocio'), ws('b', 'Casa')];
  assert.deepEqual(validateWorkspaceName('  Tienda   Ana ', { existing }), { ok: true, name: 'Tienda Ana' });
  assert.equal(validateWorkspaceName('   ', { existing }).ok, false);
  const long = validateWorkspaceName('x'.repeat(LIMITS.workspaceName + 1), { existing });
  assert.equal(long.ok, false);
  const same = validateWorkspaceName('MI NEGOCIO', { existing });
  assert.equal(same.ok, false);
  assert.match(/** @type {any} */ (same).error, /ya tienes/i);
  // Al renombrar, el propio espacio no cuenta como repetido.
  assert.equal(validateWorkspaceName('mi negocio', { existing, exceptId: 'a' }).ok, true);
  assert.equal(normalizeWorkspaceName('  a   b '), 'a b');
});

test('suggestWorkspaceName: no repite nombres', () => {
  assert.equal(suggestWorkspaceName('entrepreneur', []), 'Mi emprendimiento');
  const one = [ws('a', 'Mi emprendimiento')];
  assert.equal(suggestWorkspaceName('entrepreneur', one), 'Mi emprendimiento 2');
  const two = [...one, ws('b', 'Mi emprendimiento 2')];
  assert.equal(suggestWorkspaceName('entrepreneur', two), 'Mi emprendimiento 3');
  assert.equal(suggestWorkspaceName('company', two), 'Mi empresa');
});

test('buildWorkspace arma el registro con moneda RD$ y fechas', () => {
  const w = buildWorkspace({ kind: 'freelancer', name: 'Diseño' }, { id: 'x1', nowISO: NOW });
  assert.deepEqual(w, {
    id: 'x1', kind: 'freelancer', name: 'Diseño', currency: 'DOP', openingBalanceCents: 0, isDefault: false, createdAt: NOW, updatedAt: NOW,
  });
});

test('pickActiveWorkspace: último usado, luego predeterminado, luego el más antiguo', () => {
  const a = ws('a', 'A', { createdAt: '2026-03-01T00:00:00.000Z' });
  const b = ws('b', 'B', { createdAt: '2026-02-01T00:00:00.000Z', isDefault: true });
  const c = ws('c', 'C', { createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(pickActiveWorkspace([], { displayName: '', lastWorkspaceId: null }), null);
  assert.equal(pickActiveWorkspace([a, b, c], { displayName: '', lastWorkspaceId: 'a' })?.id, 'a');
  assert.equal(pickActiveWorkspace([a, b, c], { displayName: '', lastWorkspaceId: null })?.id, 'b');
  // El último usado ya no existe (se borró): cae al predeterminado.
  assert.equal(pickActiveWorkspace([a, b, c], { displayName: '', lastWorkspaceId: 'zzz' })?.id, 'b');
  // Sin predeterminado: el más antiguo.
  assert.equal(pickActiveWorkspace([a, { ...b, isDefault: false }, c], { displayName: '', lastWorkspaceId: null })?.id, 'c');
});

test('sortWorkspaces ordena por fecha de creación', () => {
  const list = [ws('b', 'B', { createdAt: '2026-02-01T00:00:00.000Z' }), ws('a', 'A', { createdAt: '2026-01-01T00:00:00.000Z' })];
  assert.deepEqual(sortWorkspaces(list).map((w) => w.id), ['a', 'b']);
  assert.deepEqual(list.map((w) => w.id), ['b', 'a'], 'no cambia la lista original');
});

test('hasUserData: solo cuenta lo que puso la persona', () => {
  assert.equal(hasUserData({ records: 0 }), false);
  assert.equal(hasUserData({ records: 0, displayName: '   ', openingBalanceCents: 0 }), false);
  assert.equal(hasUserData({ records: 1 }), true);
  assert.equal(hasUserData({ records: 0, displayName: 'Ana' }), true);
  assert.equal(hasUserData({ records: 0, openingBalanceCents: 500 }), true);
});

test('planLegacyMigration: con datos crea «Mi espacio personal»; sin datos no crea nada', () => {
  assert.equal(planLegacyMigration({ records: 0 }, NOW), null);
  const plan = planLegacyMigration({ records: 12, displayName: 'Ana', openingBalanceCents: 150000 }, NOW);
  assert.ok(plan);
  assert.equal(plan.workspace.id, PERSONAL_WORKSPACE_ID);
  assert.equal(plan.workspace.kind, 'personal');
  assert.equal(plan.workspace.name, 'Mi espacio personal');
  assert.equal(plan.workspace.isDefault, true);
  assert.equal(plan.workspace.openingBalanceCents, 150000);
  assert.deepEqual(plan.profile, { displayName: 'Ana', lastWorkspaceId: PERSONAL_WORKSPACE_ID });
});

test('withDefault y nextDefaultId', () => {
  const list = [ws('a', 'A', { isDefault: true }), ws('b', 'B', { createdAt: '2026-02-01T00:00:00.000Z' })];
  const next = withDefault(list, 'b', NOW);
  assert.deepEqual(next.map((w) => [w.id, w.isDefault]), [['a', false], ['b', true]]);
  assert.equal(next[1].updatedAt, NOW);
  assert.equal(withDefault(list, 'a', NOW)[0], list[0], 'si no cambia, devuelve el mismo registro');

  assert.equal(nextDefaultId([]), null);
  assert.equal(nextDefaultId(list), null, 'ya hay uno predeterminado');
  assert.equal(nextDefaultId([ws('z', 'Z', { createdAt: '2026-05-01T00:00:00.000Z' }), ws('y', 'Y', { createdAt: '2026-04-01T00:00:00.000Z' })]), 'y');
});
