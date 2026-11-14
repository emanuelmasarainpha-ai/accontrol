// Respaldo de clientes, servicios y pagos vinculados (versión 5 del formato).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, createFullBackup, parseAnyBackup, parseBackup } from '../src/domain/backup.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildDemoData, buildFreelancerDemo } from '../src/domain/demo.js';
import { SCHEMA_VERSION } from '../src/domain/types.js';

const today = '2026-07-20';
const nowISO = '2026-07-20T12:00:00.000Z';

function freelancerData() {
  const demo = buildDemoData(today, nowISO);
  const fl = buildFreelancerDemo(today, nowISO);
  return {
    categories: defaultCategories(),
    movements: [...demo.movements, ...fl.movements],
    goals: demo.goals, contributions: demo.contributions, debts: demo.debts, debtPayments: demo.debtPayments, assets: demo.assets,
    clients: fl.clients, services: fl.services, products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [],
    settings: { displayName: 'Ana', openingBalanceCents: 0 },
  };
}
/** @param {(b: any) => void} change @param {{ today?: string }} [options] */
function corrupt(change, options = {}) {
  const backup = JSON.parse(JSON.stringify(createBackup(freelancerData(), nowISO)));
  change(backup);
  return parseBackup(JSON.stringify(backup), options);
}
const linked = (/** @type {any} */ b) => b.data.movements.filter((/** @type {any} */ m) => m.serviceId);
const rejects = (/** @type {(b: any) => void} */ change, /** @type {RegExp} */ message) => {
  const r = corrupt(change, { today });
  assert.ok(!r.ok, 'debía rechazarse');
  if (!r.ok) assert.match(r.error, message);
};

test('el formato es la versión 8 (la 5 añadió clientes y servicios; la 6, el inventario; la 7, las facturas; la 8, los departamentos)', () => {
  assert.equal(SCHEMA_VERSION, 8);
  assert.equal(createBackup(freelancerData(), nowISO).schemaVersion, 8);
});

test('clientes, servicios y pagos vinculados se exportan e importan tal cual', () => {
  const data = freelancerData();
  assert.ok(data.clients.length > 0 && data.services.length > 0 && data.movements.some((m) => m.clientId && m.serviceId));
  const r = parseBackup(JSON.stringify(createBackup(data, nowISO)), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual(r.data, data);
});

test('la copia completa también los conserva', () => {
  const data = freelancerData();
  const snap = {
    profile: { displayName: 'Ana', lastWorkspaceId: 'w1' },
    workspaces: [{ workspace: { id: 'w1', kind: /** @type {const} */ ('freelancer'), name: 'Mi trabajo', currency: /** @type {const} */ ('DOP'), openingBalanceCents: 0, isDefault: true, createdAt: nowISO, updatedAt: nowISO }, data }],
  };
  const r = parseAnyBackup(JSON.stringify(createFullBackup(snap, nowISO)), { today });
  assert.ok(r.ok && r.kind === 'full', r.ok ? '' : r.error);
  if (r.ok && r.kind === 'full') assert.deepEqual(r.workspaces[0].data, data);
});

test('un respaldo anterior (sin clientes ni servicios) se importa con listas vacías', () => {
  const backup = JSON.parse(JSON.stringify(createBackup(freelancerData(), nowISO)));
  delete backup.data.clients;
  delete backup.data.services;
  backup.data.movements = backup.data.movements.filter((/** @type {any} */ m) => !m.clientId);
  backup.schemaVersion = 4;
  const r = parseBackup(JSON.stringify(backup), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual([r.data.clients, r.data.services], [[], []]);
});

test('cliente: campos obligatorios, formatos y máximos', () => {
  rejects((b) => { b.data.clients[0].firstName = ''; }, /Cliente #1/);
  rejects((b) => { b.data.clients[0].firstName = 'x'.repeat(61); }, /Cliente #1/);
  rejects((b) => { b.data.clients[0].email = 'sin-arroba'; }, /correo/);
  rejects((b) => { b.data.clients[0].phone = '12'; }, /teléfono/);
  rejects((b) => { b.data.clients[0].archived = 'no'; }, /archivado/);
  rejects((b) => { b.data.clients[0].notes = 'n'.repeat(201); }, /notas/);
  rejects((b) => { delete b.data.clients[0].createdAt; }, /fecha de registro/);
  rejects((b) => { b.data.clients[1].id = b.data.clients[0].id; }, /repetido/);
  rejects((b) => { b.data.clients = {}; }, /clients|no es válida/);
  rejects((b) => { b.data.clients[0].lastName = 5; }, /apellido/);
  assert.ok(corrupt((b) => { b.data.clients[0].email = 'ana@sol.do'; b.data.clients[0].phone = '+1 809 555 0100'; }, { today }).ok);
});

test('servicio: cliente existente, precio, duración, estado y fecha', () => {
  rejects((b) => { b.data.services[0].clientId = 'fantasma'; }, /cliente que no existe/);
  rejects((b) => { b.data.services[0].priceCents = 0; }, /monto/);
  rejects((b) => { b.data.services[0].priceCents = 1.5; }, /monto/);
  rejects((b) => { b.data.services[0].estimatedDays = 0; }, /duración/);
  rejects((b) => { b.data.services[0].estimatedDays = 4000; }, /duración/);
  rejects((b) => { b.data.services[0].estimatedDays = undefined; }, /duración/);
  rejects((b) => { b.data.services[0].status = 'hecho'; }, /estado/);
  rejects((b) => { b.data.services[0].startDate = '2026-02-30'; }, /fecha de inicio/);
  rejects((b) => { b.data.services[0].startDate = '1999-01-01'; }, /fecha de inicio/);
  rejects((b) => { b.data.services[1].id = b.data.services[0].id; }, /repetido/);
  assert.ok(corrupt((b) => { b.data.services[0].estimatedDays = null; b.data.services[0].startDate = ''; }, { today }).ok);
});

test('pago vinculado: cliente y servicio deben existir y coincidir', () => {
  rejects((b) => { linked(b)[0].clientId = 'fantasma'; }, /cliente que no existe/);
  rejects((b) => { linked(b)[0].serviceId = 'fantasma'; }, /servicio que no existe/);
  rejects((b) => { const m = linked(b)[0]; const other = b.data.clients.find((/** @type {any} */ c) => c.id !== m.clientId); m.clientId = other.id; }, /su servicio no es de su cliente/);
  rejects((b) => { const m = linked(b)[0]; delete m.clientId; }, /cliente que no existe/);
  // Un pago con cliente pero sin servicio es válido (pago suelto).
  assert.ok(corrupt((b) => { delete linked(b)[0].serviceId; }, { today }).ok);
});

test('los campos desconocidos de clientes y servicios se descartan', () => {
  const r = corrupt((b) => { b.data.clients[0].rol = 'admin'; b.data.services[0].hack = '<script>'; });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal('rol' in r.data.clients[0], false);
    assert.equal('hack' in r.data.services[0], false);
  }
});

// ---- Gastos cargados a un cliente ------------------------------------------------------------------

const clientExpenses = (/** @type {any} */ b) => b.data.movements.filter((/** @type {any} */ m) => m.type === 'expense' && m.clientId);
const plainExpense = (/** @type {any} */ b) => b.data.movements.find((/** @type {any} */ m) => m.type === 'expense' && !m.clientId && !b.data.debtPayments.some((/** @type {any} */ p) => p.movementId === m.id));

test('la demostración trae gastos cargados a clientes y viajan completos en la copia', () => {
  const data = freelancerData();
  const charged = data.movements.filter((m) => m.type === 'expense' && m.clientId);
  assert.ok(charged.length >= 5, 'hay gastos cargados a clientes para probar');
  assert.ok(data.movements.some((m) => m.type === 'expense' && !m.clientId), 'y gastos generales sin cliente');
  const r = parseBackup(JSON.stringify(createBackup(data, nowISO)), { today });
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual(r.data.movements.filter((m) => m.type === 'expense' && m.clientId).map((m) => [m.id, m.clientId]), charged.map((m) => [m.id, m.clientId]));
});

test('un gasto puede llevar cliente en la copia, pero ese cliente debe existir en ella', () => {
  assert.ok(corrupt((b) => { plainExpense(b).clientId = b.data.clients[0].id; }, { today }).ok);
  rejects((b) => { clientExpenses(b)[0].clientId = 'fantasma'; }, /cliente que no existe/);
  rejects((b) => { plainExpense(b).clientId = ''; }, /cliente que no existe/);
  rejects((b) => { const m = clientExpenses(b)[0]; b.data.clients = b.data.clients.filter((/** @type {any} */ c) => c.id !== m.clientId); b.data.services = b.data.services.filter((/** @type {any} */ s) => s.clientId !== m.clientId); b.data.movements = b.data.movements.filter((/** @type {any} */ x) => x.clientId !== m.clientId || x === m); }, /cliente que no existe/);
});

test('un gasto no puede llevar servicio (solo los ingresos se vinculan a un servicio)', () => {
  rejects((b) => { const m = clientExpenses(b)[0]; m.serviceId = b.data.services[0].id; }, /solo un ingreso puede estar vinculado a un servicio/);
});

test('un pago de deuda no se carga a un cliente', () => {
  rejects((b) => {
    const debtMovement = b.data.movements.find((/** @type {any} */ m) => b.data.debtPayments.some((/** @type {any} */ p) => p.movementId === m.id));
    assert.ok(debtMovement, 'el escenario tiene pagos de deuda');
    debtMovement.clientId = b.data.clients[0].id;
  }, /un pago de deuda no se carga a un cliente/);
});
