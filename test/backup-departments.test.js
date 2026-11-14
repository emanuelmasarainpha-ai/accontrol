// Respaldo de los departamentos (versión 8 del formato): ida y vuelta, copias antiguas y archivos manipulados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, createFullBackup, parseAnyBackup, parseBackup } from '../src/domain/backup.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo, buildCompanyDemo, buildDepartmentDemo, buildInventoryDemo } from '../src/domain/demo.js';
import { LIMITS } from '../src/domain/types.js';

const today = '2026-07-20';
const nowISO = '2026-07-20T12:00:00.000Z';

/**
 * Una empresa con el negocio de demostración, su deuda con pagos, inventario y cuatro departamentos: los gastos de operación van
 * cargados a su departamento (también las compras de inventario) y los pagos de deudas, no. Más un departamento propio archivado.
 */
function departmentData() {
  const company = buildCompanyDemo(today, nowISO);
  const inventory = buildInventoryDemo(today, nowISO);
  const base = [...buildBusinessDemo(today, nowISO), ...company.movements, ...inventory.movements];
  const demo = buildDepartmentDemo(base, today, nowISO);
  const mine = { id: 'dep-mine', name: 'Legal', monthlyBudgetCents: 0, archived: true, createdAt: nowISO, updatedAt: nowISO };
  return {
    categories: defaultCategories(),
    movements: demo.movements,
    goals: [], contributions: [], debts: company.debts, debtPayments: company.debtPayments, assets: company.assets, clients: [], services: [],
    products: inventory.products, suppliers: inventory.suppliers, stockEntries: inventory.stockEntries, invoices: [], invoicePayments: [],
    departments: [...demo.departments, mine],
    settings: { displayName: 'Ana', openingBalanceCents: 0 },
  };
}

/** @param {(b: any) => void} change */
function corrupt(change) {
  const backup = JSON.parse(JSON.stringify(createBackup(departmentData(), nowISO)));
  change(backup);
  return parseBackup(JSON.stringify(backup), { today });
}
const rejects = (/** @type {(b: any) => void} */ change, /** @type {RegExp} */ message) => {
  const r = corrupt(change);
  assert.ok(!r.ok, 'debía rechazarse');
  if (!r.ok) assert.match(r.error, message);
};
const accepts = (/** @type {(b: any) => void} */ change) => {
  const r = corrupt(change);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r;
};
const dep = (/** @type {any} */ b, /** @type {string} */ name) => b.data.departments.find((/** @type {any} */ d) => d.name === name);

test('el fixture es válido: la copia intacta se acepta y tiene de todo', () => {
  const data = departmentData();
  assert.equal(data.departments.length, 5);
  assert.ok(data.movements.filter((m) => m.departmentId).length > 10);
  assert.ok(data.movements.some((m) => m.departmentId && data.stockEntries.some((e) => e.movementId === m.id))); // una compra de inventario con departamento
  assert.ok(data.debtPayments.length > 0);
  accepts(() => {});
});

test('departamentos y gastos cargados a ellos se exportan e importan tal cual', () => {
  const data = departmentData();
  const r = parseBackup(JSON.stringify(createBackup(data, nowISO)), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) {
    assert.deepEqual(r.data.departments, data.departments);
    assert.deepEqual(r.data.movements.map((m) => m.departmentId), data.movements.map((m) => m.departmentId));
    assert.deepEqual(r.data, data);
  }
});

test('la copia completa también los conserva', () => {
  const data = departmentData();
  const workspace = {
    id: 'w1', kind: /** @type {const} */ ('company'), name: 'Mi empresa', currency: /** @type {const} */ ('DOP'), openingBalanceCents: 0, isDefault: true,
    createdAt: nowISO, updatedAt: nowISO,
  };
  const full = createFullBackup({ profile: { displayName: 'Ana', lastWorkspaceId: 'w1' }, workspaces: [{ workspace, data }] }, nowISO);
  const r = parseAnyBackup(JSON.stringify(full), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok && r.kind === 'full') assert.deepEqual(r.workspaces[0].data.departments, data.departments);
  else assert.fail('debía ser una copia completa');
});

test('un respaldo anterior (versión 7, sin departamentos) se importa con la lista vacía', () => {
  const old = JSON.parse(JSON.stringify(createBackup({ ...departmentData(), movements: [], debts: [], debtPayments: [], products: [], suppliers: [], stockEntries: [], departments: [] }, nowISO)));
  old.schemaVersion = 7;
  delete old.data.departments;
  const r = parseBackup(JSON.stringify(old), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual(r.data.departments, []);
});

test('un respaldo de una versión más nueva se rechaza', () => {
  rejects((b) => { b.schemaVersion = 9; }, /más nueva/);
});

test('la sección de departamentos debe ser una lista', () => {
  for (const bad of [{}, 'x', 5, null]) rejects((b) => { b.data.departments = bad; }, /departments/);
});

// ---- Cada dato del departamento ---------------------------------------------------------------------------------------------

test('departamento: cada dato inválido se rechaza con su motivo', () => {
  /** @type {[string, (d: any) => void, RegExp][]} */
  const cases = [
    ['nombre vacío', (d) => { d.name = ''; }, /nombre/],
    ['nombre solo espacios', (d) => { d.name = '   '; }, /nombre/],
    ['nombre que no es texto', (d) => { d.name = 5; }, /nombre/],
    ['nombre demasiado largo', (d) => { d.name = 'x'.repeat(LIMITS.departmentName + 1); }, /nombre/],
    ['presupuesto negativo', (d) => { d.monthlyBudgetCents = -1; }, /presupuesto/],
    ['presupuesto con decimales', (d) => { d.monthlyBudgetCents = 10.5; }, /presupuesto/],
    ['presupuesto en texto', (d) => { d.monthlyBudgetCents = '100'; }, /presupuesto/],
    ['presupuesto ausente', (d) => { delete d.monthlyBudgetCents; }, /presupuesto/],
    ['presupuesto gigante', (d) => { d.monthlyBudgetCents = 1e12; }, /presupuesto/],
    ['presupuesto infinito', (d) => { d.monthlyBudgetCents = null; }, /presupuesto/],
    ['archivado que no es booleano', (d) => { d.archived = 'no'; }, /archivado/],
    ['archivado ausente', (d) => { delete d.archived; }, /archivado/],
    ['fecha de creación inválida', (d) => { d.createdAt = 'ayer'; }, /fecha/],
    ['sin id', (d) => { delete d.id; }, /id/],
  ];
  for (const [label, mutate, message] of cases) {
    const r = corrupt((b) => mutate(dep(b, 'Ventas')));
    assert.ok(!r.ok, label);
    if (!r.ok) assert.match(r.error, message, label);
  }
});

test('departamento: el presupuesto 0 (sin presupuesto) y el máximo exacto se aceptan', () => {
  accepts((b) => { dep(b, 'Mercadeo').monthlyBudgetCents = 0; });
  accepts((b) => { dep(b, 'Ventas').monthlyBudgetCents = 99_999_999_999; });
  accepts((b) => { dep(b, 'Ventas').name = 'x'.repeat(LIMITS.departmentName); });
});

test('departamento: no se aceptan ids ni nombres repetidos, ni más del máximo', () => {
  rejects((b) => { dep(b, 'Ventas').id = dep(b, 'Legal').id; }, /repetido/);
  rejects((b) => { b.data.departments[0].id = b.data.movements[0].id; }, /repetido/); // el id lo usa otro registro
  rejects((b) => { dep(b, 'Ventas').name = 'LEGAL'; }, /repetido/); // mismo nombre sin importar mayúsculas
  rejects((b) => {
    b.data.departments = Array.from({ length: LIMITS.maxDepartments + 1 }, (_, i) => ({ ...b.data.departments[0], id: `x${i}`, name: `Área ${i}` }));
    for (const m of b.data.movements) delete m.departmentId;
  }, /más de/);
});

test('la marca de demostración solo se acepta como true y se conserva', () => {
  const r = accepts((b) => { dep(b, 'Legal').isDemo = 'sí'; dep(b, 'Ventas').isDemo = true; });
  if (r.ok) {
    assert.equal('isDemo' in (r.data.departments.find((d) => d.name === 'Legal') ?? {}), false);
    assert.equal(r.data.departments.find((d) => d.name === 'Ventas')?.isDemo, true);
  }
});

// ---- El departamento de un gasto --------------------------------------------------------------------------------------------

/** @param {any} b @param {(m: any) => boolean} pick */
const movementWhere = (b, pick) => b.data.movements.find(pick);

test('gasto: el departamento debe existir en el respaldo', () => {
  rejects((b) => { movementWhere(b, (m) => m.departmentId).departmentId = 'no-existe'; }, /departamento que no existe/);
  rejects((b) => { movementWhere(b, (m) => m.departmentId).departmentId = 5; }, /departamento que no existe/);
  rejects((b) => { movementWhere(b, (m) => m.departmentId).departmentId = ''; }, /departamento que no existe/);
  rejects((b) => { movementWhere(b, (m) => m.departmentId).departmentId = null; }, /departamento que no existe/);
});

test('un ingreso no puede estar cargado a un departamento', () => {
  rejects((b) => { movementWhere(b, (m) => m.type === 'income').departmentId = dep(b, 'Ventas').id; }, /solo un gasto/);
});

test('un pago de deuda no puede estar cargado a un departamento', () => {
  rejects((b) => {
    const id = b.data.debtPayments[0].movementId;
    movementWhere(b, (m) => m.id === id).departmentId = dep(b, 'Ventas').id;
  }, /pago de deuda/);
});

test('un gasto de una compra de inventario sí puede estar cargado a un departamento', () => {
  const r = accepts((b) => {
    const purchase = b.data.stockEntries.find((/** @type {any} */ e) => e.movementId);
    movementWhere(b, (m) => m.id === purchase.movementId).departmentId = dep(b, 'Operaciones').id;
  });
  assert.ok(r.ok);
});

test('un gasto puede apuntar a un departamento archivado (su historial se conserva)', () => {
  accepts((b) => { movementWhere(b, (m) => m.type === 'expense' && !m.departmentId && !b.data.debtPayments.some((/** @type {any} */ p) => p.movementId === m.id)).departmentId = dep(b, 'Legal').id; });
});

test('quitar un departamento del archivo deja huérfanos a sus gastos y se rechaza', () => {
  rejects((b) => { b.data.departments = b.data.departments.filter((/** @type {any} */ d) => d.name !== 'Ventas'); }, /departamento que no existe/);
});
