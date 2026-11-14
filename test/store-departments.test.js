// Departamentos en el store: crear/editar, asignar gastos, archivar, borrar con protección, aislamiento entre espacios,
// guardado todo-o-nada y demostración (con adopción de lo real al quitarla).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { departmentMonth, departmentNotices, unassignedExpenses } from '../src/domain/departments.js';
import { computeNotices } from '../src/domain/notices.js';
import { overallTotals } from '../src/domain/summaries.js';

const fixedNow = new Date(2026, 10, 15, 15, 30); // 15 nov 2026, 15:30
const TODAY = '2026-11-15';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}
/** @param {'personal' | 'freelancer' | 'entrepreneur' | 'company'} kind */
async function space(kind = 'company', name = 'Mi empresa') {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind, name })).ok);
  return { root, store };
}
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };
const data = (/** @type {any} */ store) => store.getState().data;
const stored = (/** @type {any} */ root, /** @type {string} */ table) => root.rawRecords(table);
const expenseIn = (/** @type {Record<string, string>} */ over = {}) => ({
  type: 'expense', amountText: '500', date: '2026-11-10', time: '09:00', description: 'Resma de papel', classification: 'variable', categoryId: 'cat-exp-otros', ...over,
});
const incomeIn = (/** @type {Record<string, string>} */ over = {}) => ({
  type: 'income', amountText: '900', date: '2026-11-10', time: '09:00', description: 'Venta', classification: 'variable', categoryId: 'cat-inc-ventas', ...over,
});
const debtIn = () => ({
  name: 'Préstamo', note: '', totalText: '100000', rateText: '12', rateBasis: 'annual', frequency: 'monthly', collateralKind: 'personal', collateralType: 'prestamo-personal',
  firstDueDate: '2026-07-01', firstDueTime: '09:00', finalDueDate: '2027-06-01', finalDueTime: '09:00',
});

test('departmentsEnabled: Empresa sí; Personal, Freelancer y Emprendedor, no', async () => {
  assert.equal((await space('company')).store.departmentsEnabled(), true);
  for (const kind of /** @type {const} */ (['personal', 'freelancer', 'entrepreneur'])) assert.equal((await space(kind)).store.departmentsEnabled(), false, kind);
});

// ---- Crear, editar, archivar, borrar --------------------------------------------------------------------------------

test('crear un departamento: queda guardado de verdad, con su espacio, y se puede editar', async () => {
  const { store, root } = await space();
  const created = must(await store.saveDepartment({ name: ' Ventas ', budgetText: '15,000' })).department;
  assert.deepEqual([created.name, created.monthlyBudgetCents, created.archived], ['Ventas', 1_500_000, false]);
  assert.equal(data(store).departments.length, 1);
  assert.equal(stored(root, 'departments').length, 1);
  assert.ok(stored(root, 'departments')[0].workspaceId);

  const edited = must(await store.saveDepartment({ name: 'Ventas y mercadeo', budgetText: '' }, created.id)).department;
  assert.deepEqual([edited.id, edited.name, edited.monthlyBudgetCents, edited.createdAt], [created.id, 'Ventas y mercadeo', 0, created.createdAt]);
  assert.equal(data(store).departments.length, 1);
  assert.notEqual(edited.updatedAt, created.updatedAt);
});

test('crear/editar: los errores llegan con el campo exacto y no se guarda nada', async () => {
  const { store, root } = await space();
  must(await store.saveDepartment({ name: 'Ventas' }));
  const dup = await store.saveDepartment({ name: 'ventas' });
  assert.ok(!dup.ok);
  assert.ok(dup.errors.name);
  const bad = await store.saveDepartment({ name: 'Compras', budgetText: 'abc' });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.budget);
  assert.equal(data(store).departments.length, 1);
  assert.equal(stored(root, 'departments').length, 1);
  const ghost = await store.saveDepartment({ name: 'X' }, 'no-existe');
  assert.ok(!ghost.ok);
});

test('si falla el guardado, no queda el departamento (ni en pantalla ni guardado)', async () => {
  const { store, root } = await space();
  root.failNextWrite();
  const r = await store.saveDepartment({ name: 'Ventas' });
  assert.ok(!r.ok);
  assert.equal(data(store).departments.length, 0);
  assert.equal(stored(root, 'departments').length, 0);
  must(await store.saveDepartment({ name: 'Ventas' })); // y la siguiente sí funciona
});

test('archivar y reactivar: conserva todo, solo cambia la marca', async () => {
  const { store } = await space();
  const dep = must(await store.saveDepartment({ name: 'Ventas', budgetText: '100' })).department;
  const archived = must(await store.setDepartmentArchived(dep.id, true)).department;
  assert.deepEqual([archived.archived, archived.name, archived.monthlyBudgetCents], [true, 'Ventas', 10_000]);
  assert.equal(must(await store.setDepartmentArchived(dep.id, false)).department.archived, false);
  assert.ok(!(await store.setDepartmentArchived('nope', true)).ok);
});

test('borrar: solo si no tiene gastos; con gastos se explica y se sugiere archivar', async () => {
  const { store, root } = await space();
  const used = must(await store.saveDepartment({ name: 'Ventas' })).department;
  const free = must(await store.saveDepartment({ name: 'Compras' })).department;
  must(await store.saveMovement(expenseIn({ departmentId: used.id })));
  const refused = await store.deleteDepartment(used.id);
  assert.ok(!refused.ok);
  assert.match(refused.errors.form, /archivarlo/);
  assert.equal(data(store).departments.length, 2);
  must(await store.deleteDepartment(free.id));
  assert.deepEqual(data(store).departments.map((d) => d.id), [used.id]);
  assert.equal(stored(root, 'departments').length, 1);
  assert.ok(!(await store.deleteDepartment(free.id)).ok); // ya no existe
});

// ---- Gastos cargados a un departamento --------------------------------------------------------------------------------------

test('registrar un gasto con departamento: se guarda en el gasto y el dinero cuenta una sola vez', async () => {
  const { store, root } = await space();
  const dep = must(await store.saveDepartment({ name: 'Ventas', budgetText: '1000' })).department;
  const before = overallTotals(data(store), TODAY).availableCents;
  const m = must(await store.saveMovement(expenseIn({ departmentId: dep.id }))).movement;
  assert.equal(m.departmentId, dep.id);
  assert.equal(stored(root, 'movements')[0].departmentId, dep.id);
  assert.equal(overallTotals(data(store), TODAY).availableCents, before - 50_000);
  const month = departmentMonth(data(store), '2026-11', TODAY);
  assert.equal(month.rows[0].spentCents, 50_000);
});

test('un ingreso no se carga a un departamento; un departamento inexistente tampoco', async () => {
  const { store } = await space();
  const dep = must(await store.saveDepartment({ name: 'Ventas' })).department;
  const income = await store.saveMovement(incomeIn({ departmentId: dep.id }));
  assert.ok(!income.ok);
  assert.ok(income.errors.department);
  const ghost = await store.saveMovement(expenseIn({ departmentId: 'zzz' }));
  assert.ok(!ghost.ok);
  assert.ok(ghost.errors.department);
  assert.equal(data(store).movements.length, 0);
});

test('editar un gasto: cambiar de departamento o quitárselo', async () => {
  const { store } = await space();
  const a = must(await store.saveDepartment({ name: 'A' })).department;
  const b = must(await store.saveDepartment({ name: 'B' })).department;
  const m = must(await store.saveMovement(expenseIn({ departmentId: a.id }))).movement;
  assert.equal(must(await store.saveMovement(expenseIn({ departmentId: b.id }), m.id)).movement.departmentId, b.id);
  const cleared = must(await store.saveMovement(expenseIn({ departmentId: '' }), m.id)).movement;
  assert.equal('departmentId' in cleared, false);
  assert.equal('departmentId' in data(store).movements[0], false);
});

test('assignDepartment: asigna, cambia y quita sin tocar el resto del gasto', async () => {
  const { store, root } = await space();
  const a = must(await store.saveDepartment({ name: 'A' })).department;
  const b = must(await store.saveDepartment({ name: 'B' })).department;
  const m = must(await store.saveMovement(expenseIn())).movement;
  const assigned = must(await store.assignDepartment(m.id, a.id)).movement;
  assert.deepEqual([assigned.departmentId, assigned.amountCents, assigned.description, assigned.createdAt], [a.id, m.amountCents, m.description, m.createdAt]);
  assert.equal(stored(root, 'movements')[0].departmentId, a.id);
  assert.equal(must(await store.assignDepartment(m.id, b.id)).movement.departmentId, b.id);
  const cleared = must(await store.assignDepartment(m.id, '')).movement;
  assert.equal('departmentId' in cleared, false);
  assert.equal('departmentId' in stored(root, 'movements')[0], false);
});

test('assignDepartment: asignar lo mismo no escribe nada', async () => {
  const { store } = await space();
  const a = must(await store.saveDepartment({ name: 'A' })).department;
  const m = must(await store.saveMovement(expenseIn({ departmentId: a.id }))).movement;
  const again = must(await store.assignDepartment(m.id, a.id)).movement;
  assert.equal(again.updatedAt, m.updatedAt);
  const none = must(await store.saveMovement(expenseIn({ description: 'Otro' }))).movement;
  assert.equal(must(await store.assignDepartment(none.id, '')).movement.updatedAt, none.updatedAt);
});

test('assignDepartment: rechaza ingresos, pagos de deudas, departamentos inexistentes o archivados y gastos que ya no existen', async () => {
  const { store } = await space();
  const a = must(await store.saveDepartment({ name: 'A' })).department;
  const old = must(await store.saveDepartment({ name: 'Vieja' })).department;
  const income = must(await store.saveMovement(incomeIn())).movement;
  const expense = must(await store.saveMovement(expenseIn())).movement;
  const refusedIncome = await store.assignDepartment(income.id, a.id);
  assert.ok(!refusedIncome.ok);
  assert.match(refusedIncome.errors.form, /Solo los gastos/);
  const ghost = await store.assignDepartment(expense.id, 'zzz');
  assert.ok(!ghost.ok);
  assert.match(ghost.errors.form, /ya no existe/);
  must(await store.setDepartmentArchived(old.id, true));
  const archived = await store.assignDepartment(expense.id, old.id);
  assert.ok(!archived.ok);
  assert.match(archived.errors.form, /archivado/);
  const gone = await store.assignDepartment('no-existe', a.id);
  assert.ok(!gone.ok);

  const debt = must(await store.saveDebt(debtIn())).debt;
  const payment = must(await store.saveDebtPayment(debt.id, { kind: 'regular', amountText: '8884.88', date: TODAY, time: '11:00', note: '' })).payment;
  const refusedDebt = await store.assignDepartment(payment.movementId, a.id);
  assert.ok(!refusedDebt.ok);
  assert.match(refusedDebt.errors.form, /pago de deuda/);
});

test('assignDepartment: un gasto ya asignado a un departamento archivado se puede dejar o quitar', async () => {
  const { store } = await space();
  const dep = must(await store.saveDepartment({ name: 'Vieja' })).department;
  const m = must(await store.saveMovement(expenseIn({ departmentId: dep.id }))).movement;
  must(await store.setDepartmentArchived(dep.id, true));
  assert.equal(must(await store.assignDepartment(m.id, dep.id)).movement.departmentId, dep.id); // lo mismo: sin problema
  assert.equal('departmentId' in must(await store.assignDepartment(m.id, '')).movement, false); // quitarlo, también
});

test('si falla el guardado al asignar, el gasto queda como estaba', async () => {
  const { store, root } = await space();
  const a = must(await store.saveDepartment({ name: 'A' })).department;
  const m = must(await store.saveMovement(expenseIn())).movement;
  root.failNextWrite();
  assert.ok(!(await store.assignDepartment(m.id, a.id)).ok);
  assert.equal('departmentId' in data(store).movements[0], false);
  assert.equal('departmentId' in stored(root, 'movements')[0], false);
});

test('las compras de inventario se cargan a un departamento al registrarlas o después', async () => {
  const { store } = await space();
  const dep = must(await store.saveDepartment({ name: 'Operaciones', budgetText: '5000' })).department;
  const product = must(await store.saveProduct({ name: 'Camisa', priceText: '250' })).product;
  const buy = (/** @type {Record<string, string>} */ over = {}) => ({ kind: 'purchase', productId: product.id, quantityText: '10', unitText: '100', date: '2026-11-01', supplierId: '', categoryId: 'cat-exp-otros', note: '', ...over });
  const first = must(await store.registerStock(buy({ departmentId: dep.id })));
  assert.equal(first.movement.departmentId, dep.id);
  const second = must(await store.registerStock(buy()));
  assert.equal('departmentId' in second.movement, false);
  // Esa compra no se puede editar desde Movimientos, pero sí cargarse a un departamento.
  assert.ok(!(await store.saveMovement(expenseIn(), second.movement.id)).ok);
  must(await store.assignDepartment(second.movement.id, dep.id));
  assert.equal(departmentMonth(data(store), '2026-11', TODAY).rows[0].spentCents, 200_000);
  // Una venta no lleva departamento.
  const sale = await store.registerStock(buy({ kind: 'sale', categoryId: 'cat-inc-ventas', quantityText: '1', departmentId: dep.id }));
  assert.ok(!sale.ok);
  assert.ok(sale.errors.department);
});

// ---- Avisos y aislamiento ---------------------------------------------------------------------------------------------------

test('el aviso de presupuesto excedido llega a Inicio (en Empresa, o donde ya haya departamentos)', async () => {
  const { store } = await space();
  const dep = must(await store.saveDepartment({ name: 'Ventas', budgetText: '100' })).department;
  must(await store.saveMovement(expenseIn({ departmentId: dep.id, amountText: '250' })));
  assert.equal(departmentNotices(data(store), TODAY)[0].id, 'departments-over');
  assert.ok(computeNotices(data(store), TODAY, { kind: 'company' }).some((n) => n.id === 'departments-over'));
  // Sin departamentos no hay aviso, sea cual sea el espacio; con departamentos, nunca quedan escondidos.
  assert.ok(computeNotices(data(store), TODAY, { kind: 'personal' }).some((n) => n.id === 'departments-over'));
  assert.ok(!computeNotices({ ...data(store), departments: [] }, TODAY, { kind: 'entrepreneur' }).some((n) => n.id === 'departments-over'));
});

test('cada espacio tiene sus departamentos: no se ven ni se mezclan, y el nombre puede repetirse entre espacios', async () => {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  const first = must(await store.createWorkspace({ kind: 'company', name: 'Empresa A' }));
  must(await store.saveDepartment({ name: 'Ventas', budgetText: '100' }));
  const second = must(await store.createWorkspace({ kind: 'company', name: 'Empresa B' }));
  assert.equal(data(store).departments.length, 0);
  must(await store.saveDepartment({ name: 'Ventas', budgetText: '200' })); // mismo nombre, otro espacio
  assert.equal(data(store).departments[0].monthlyBudgetCents, 20_000);
  must(await store.switchWorkspace(first.workspace.id));
  assert.deepEqual(data(store).departments.map((d) => d.monthlyBudgetCents), [10_000]);
  assert.equal(stored(root, 'departments').length, 2);
  // Al borrar un espacio se van sus departamentos y solo los suyos.
  must(await store.switchWorkspace(second.workspace.id));
  must(await store.deleteWorkspace(first.workspace.id));
  assert.equal(stored(root, 'departments').length, 1);
});

// ---- Respaldo ---------------------------------------------------------------------------------------------------------

test('copia de seguridad: los departamentos y los gastos cargados a ellos vuelven tal cual', async () => {
  const { store } = await space();
  const dep = must(await store.saveDepartment({ name: 'Ventas', budgetText: '1,234.56' })).department;
  must(await store.saveMovement(expenseIn({ departmentId: dep.id })));
  const backup = store.exportBackup();
  const before = JSON.stringify(data(store));
  const other = await space();
  const preview = other.store.inspectBackup(backup.json);
  assert.ok(preview.ok, JSON.stringify(preview));
  must(await other.store.importBackup(backup.json));
  assert.deepEqual(data(other.store).departments.map((d) => [d.name, d.monthlyBudgetCents]), [['Ventas', 123_456]]);
  assert.equal(data(other.store).movements[0].departmentId, dep.id);
  assert.equal(JSON.stringify(data(other.store).departments), JSON.stringify(JSON.parse(before).departments));
});

// ---- Demostración -----------------------------------------------------------------------------------------------------

test('demostración de Empresa: cuatro departamentos y los gastos repartidos; pagos de deudas sin departamento', async () => {
  const { store } = await space();
  must(await store.loadDemoData());
  const d = data(store);
  assert.deepEqual(d.departments.map((x) => x.name).sort(), ['Administración', 'Mercadeo', 'Operaciones', 'Ventas']);
  assert.ok(d.departments.every((x) => x.isDemo === true));
  const assigned = d.movements.filter((m) => m.departmentId);
  assert.ok(assigned.length > 10);
  assert.ok(assigned.every((m) => m.isDemo && m.type === 'expense'));
  const debtIds = new Set(d.debtPayments.map((p) => p.movementId));
  assert.ok(d.debtPayments.length > 0);
  assert.ok(assigned.every((m) => !debtIds.has(m.id)));
  // Todo gasto asignado apunta a un departamento que existe.
  assert.ok(assigned.every((m) => d.departments.some((x) => x.id === m.departmentId)));
  // Hay gastos sin asignar este mes (el combustible), para ver la lista.
  assert.ok(unassignedExpenses(d, '2026-11', TODAY).length > 0);
  // Y la pantalla tiene qué mostrar: el mes en curso tiene gasto repartido.
  const month = departmentMonth(d, '2026-11', TODAY);
  assert.ok(month.assignedCents > 0);
  assert.equal(month.totalSpentCents, month.assignedCents + month.unassignedCents);
});

test('demostración: en Emprendedor, Freelancer y Personal no hay departamentos', async () => {
  for (const kind of /** @type {const} */ (['entrepreneur', 'freelancer', 'personal'])) {
    const { store } = await space(kind);
    must(await store.loadDemoData());
    assert.equal(data(store).departments.length, 0, kind);
    assert.ok(data(store).movements.every((m) => !m.departmentId), kind);
  }
});

test('quitar la demostración borra sus departamentos y deja intacto lo real', async () => {
  const { store, root } = await space();
  const mine = must(await store.saveDepartment({ name: 'Mi área', budgetText: '100' })).department;
  const real = must(await store.saveMovement(expenseIn({ departmentId: mine.id }))).movement;
  must(await store.loadDemoData());
  assert.equal(data(store).departments.length, 5);
  must(await store.removeDemoData());
  assert.deepEqual(data(store).departments.map((x) => x.id), [mine.id]);
  assert.deepEqual(data(store).movements.map((m) => m.id), [real.id]);
  assert.equal(stored(root, 'departments').length, 1);
});

test('quitar la demostración: un departamento de ejemplo con un gasto REAL pasa a ser del usuario', async () => {
  const { store, root } = await space();
  must(await store.loadDemoData());
  const demoDep = data(store).departments.find((x) => x.name === 'Mercadeo');
  assert.ok(demoDep);
  const real = must(await store.saveMovement(expenseIn({ departmentId: demoDep.id, description: 'Volantes' }))).movement;
  must(await store.removeDemoData());
  assert.deepEqual(data(store).departments.map((x) => x.name), ['Mercadeo']);
  assert.equal('isDemo' in data(store).departments[0], false);
  assert.equal(data(store).movements.find((m) => m.id === real.id)?.departmentId, demoDep.id);
  assert.equal('isDemo' in stored(root, 'departments')[0], false);
  assert.equal(store.hasDemoData(), false);
});

test('cargar la demostración dos veces no duplica los departamentos', async () => {
  const { store } = await space();
  must(await store.loadDemoData());
  assert.ok(!(await store.loadDemoData()).ok);
  assert.equal(data(store).departments.length, 4);
});
