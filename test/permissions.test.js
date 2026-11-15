// 0.16.1 (paso 1) — Roles a medida: módulos, niveles, dependencias, nombres y plantillas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_KINDS } from '../src/data/cloudRows.js';
import {
  allAt, allowsKind, atLeast, DEPENDENCIES, hasAnyAccess, LEVEL_NAMES, LEVELS, MODULE_IDS, MODULE_OF_KIND, MODULES, normalizePermissions,
  TEMPLATES, validateRoleName,
} from '../src/domain/permissions.js';

test('cada uno de los tipos de registro que viajan a la nube pertenece a exactamente un módulo', () => {
  const kinds = CLOUD_KINDS.map((k) => k.key).sort();
  assert.deepEqual(Object.keys(MODULE_OF_KIND).sort(), kinds);
  const all = MODULES.flatMap((m) => m.kinds);
  assert.equal(new Set(all).size, all.length, 'ningún tipo en dos módulos');
  assert.equal(MODULES.length, 8);
});

test('niveles en orden: cada uno incluye los anteriores', () => {
  assert.deepEqual(LEVELS, ['none', 'view', 'create', 'edit']);
  assert.deepEqual(Object.values(LEVEL_NAMES), ['Sin acceso', 'Ver', 'Registrar', 'Editar y borrar']);
  assert.equal(atLeast('edit', 'create'), true);
  assert.equal(atLeast('create', 'view'), true);
  assert.equal(atLeast('view', 'create'), false);
  assert.equal(atLeast('none', 'view'), false);
});

test('las dependencias solo apuntan a módulos que existen y no se apuntan a sí mismas', () => {
  for (const id of MODULE_IDS) {
    for (const dep of [...(DEPENDENCIES[id].same ?? []), ...(DEPENDENCIES[id].view ?? [])]) {
      assert.ok(MODULE_IDS.includes(dep), `${id} → ${dep}`);
      assert.notEqual(dep, id);
    }
  }
});

test('normalizar: rellena lo que falta, descarta lo raro y no inventa acceso', () => {
  const { permissions, raised } = normalizePermissions({ movements: 'view', invented: 'edit', assets: 'superadmin' });
  assert.deepEqual(permissions, { ...allAt('none'), movements: 'view' });
  assert.deepEqual(raised, []);
  assert.deepEqual(normalizePermissions(null).permissions, allAt('none'));
  assert.deepEqual(normalizePermissions('edit').permissions, allAt('none'));
});

test('dependencias: un cobro de factura crea un ingreso, así que «Facturas: Registrar» sube Movimientos, Inventario y Clientes', () => {
  const { permissions, raised } = normalizePermissions({ invoices: 'create' });
  assert.equal(permissions.invoices, 'create');
  assert.equal(permissions.movements, 'create');
  assert.equal(permissions.inventory, 'create');
  assert.equal(permissions.clients, 'view');
  assert.equal(permissions.assets, 'none', 'lo que no depende no se toca');
  assert.ok(raised.some((r) => r.module === 'movements' && r.because === 'invoices'));
  assert.ok(raised.some((r) => r.module === 'clients' && r.to === 'view'));
});

test('dependencias en cadena y sin bajar nunca lo que ya estaba más alto', () => {
  const { permissions } = normalizePermissions({ invoices: 'edit', movements: 'edit', clients: 'edit' });
  assert.equal(permissions.inventory, 'edit');
  assert.equal(permissions.movements, 'edit');
  assert.equal(permissions.clients, 'edit', 'Clientes ya estaba en Editar: no baja a Ver');
  // Una deuda en «Ver» solo pide ver los movimientos.
  assert.equal(normalizePermissions({ debts: 'view' }).permissions.movements, 'view');
  // Cada módulo con un nivel queda con sus dependencias cumplidas (para todas las combinaciones de un módulo).
  for (const id of MODULE_IDS) {
    for (const level of LEVELS) {
      const p = normalizePermissions({ [id]: level }).permissions;
      if (level === 'none') continue;
      for (const dep of DEPENDENCIES[id].same ?? []) assert.ok(atLeast(p[dep], level), `${id}:${level} → ${dep}`);
      for (const dep of DEPENDENCIES[id].view ?? []) assert.ok(atLeast(p[dep], 'view'), `${id}:${level} → ${dep} (ver)`);
    }
  }
});

test('normalizar dos veces da lo mismo (es estable)', () => {
  for (const t of TEMPLATES) {
    assert.deepEqual(normalizePermissions(t.permissions).permissions, t.permissions, t.name);
    assert.deepEqual(normalizePermissions(t.permissions).raised, [], t.name);
  }
});

test('qué permite un rol según el tipo de registro', () => {
  const cashier = TEMPLATES.find((t) => t.id === 'cashier')?.permissions ?? allAt('none');
  assert.equal(allowsKind(cashier, 'invoicePayments', 'create'), true);
  assert.equal(allowsKind(cashier, 'movements', 'create'), true);
  assert.equal(allowsKind(cashier, 'movements', 'edit'), false, 'el cajero corrige lo suyo, no lo de otros');
  assert.equal(allowsKind(cashier, 'clients', 'view'), true);
  assert.equal(allowsKind(cashier, 'clients', 'create'), false);
  assert.equal(allowsKind(cashier, 'debts', 'view'), false);
  assert.equal(allowsKind(cashier, 'algo-que-no-existe', 'view'), false);
});

test('nombre del rol: obligatorio, máximo 30, sin repetir y distinto de los fijos', () => {
  const existing = [{ id: 'r1', name: 'Cajero' }];
  assert.deepEqual(validateRoleName('  Encargado   de  tienda ', { existing }), { ok: true, name: 'Encargado de tienda' });
  assert.equal(validateRoleName('   ', { existing }).ok, false);
  assert.equal(validateRoleName('x'.repeat(31), { existing }).ok, false);
  assert.equal(validateRoleName('cajero', { existing }).ok, false, 'repetido sin mirar mayúsculas');
  assert.equal(validateRoleName('Cajero', { existing, exceptId: 'r1' }).ok, true, 'el mismo rol puede conservar su nombre');
  for (const fixed of ['Dueño', 'administrador', 'CONTADOR']) assert.equal(validateRoleName(fixed, { existing }).ok, false, fixed);
});

test('plantillas: un rol sin ningún acceso no sirve; las de Contador y Administrador reproducen los fijos', () => {
  assert.equal(hasAnyAccess(allAt('none')), false);
  for (const t of TEMPLATES) assert.equal(hasAnyAccess(t.permissions), true, t.name);
  assert.deepEqual(TEMPLATES.find((t) => t.id === 'accountant-like')?.permissions, allAt('view'));
  assert.deepEqual(TEMPLATES.find((t) => t.id === 'admin-like')?.permissions, allAt('edit'));
});
