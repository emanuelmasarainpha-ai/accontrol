// Departamentos y presupuestos por área: reglas de validación, estados, cálculos del mes (cifras hechas a mano) y avisos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import {
  BUDGET_STATUS_LABELS, PACE_FROM_DAY, WARNING_PERCENT, applyDepartmentEdit, budgetStatus, buildDepartment, departmentCategories,
  departmentExpenses, departmentHistory, departmentMonth, departmentNotices, departmentUsage, departmentsEnabled, monthExpenses,
  movementDepartmentText, unassignedExpenses, validateDepartment,
} from '../src/domain/departments.js';
import { applyMovementEdit, buildMovement, validateMovement } from '../src/domain/movements.js';
import { validateStockEntry } from '../src/domain/inventory.js';
import { LIMITS } from '../src/domain/types.js';

const TODAY = '2026-11-15'; // noviembre tiene 30 días
const NOW = '2026-11-15T12:00:00.000Z';
let seq = 0;

/** @param {string} id @param {number} budgetPesos @param {Record<string, any>} [over] */
const dep = (id, budgetPesos, over = {}) => ({
  id, name: id.toUpperCase(), monthlyBudgetCents: budgetPesos * 100, archived: false, createdAt: NOW, updatedAt: NOW, ...over,
});
/** Un gasto de `pesos` en `date`, cargado (o no) a un departamento. */
const exp = (/** @type {string} */ date, /** @type {number} */ pesos, /** @type {string | undefined} */ departmentId, /** @type {Record<string, any>} */ over = {}) => ({
  id: `m${++seq}`, type: /** @type {const} */ ('expense'), amountCents: Math.round(pesos * 100), date, time: '10:00', description: 'x', classification: /** @type {const} */ ('variable'),
  categoryId: 'cat-exp-otros', createdAt: NOW, updatedAt: NOW, ...(departmentId ? { departmentId } : {}), ...over,
});
const inc = (/** @type {string} */ date, /** @type {number} */ pesos) => ({ ...exp(date, pesos, undefined), type: /** @type {const} */ ('income'), categoryId: 'cat-inc-ventas' });
/** @returns {import('../src/domain/types.js').AppData} */
const dataOf = (movements = [], departments = [], over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements, goals: [], contributions: [],
  debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments, ...over,
});

// ---- Disponibilidad ------------------------------------------------------------------------------------------------

test('departmentsEnabled: Empresa siempre; los demás, solo si ya hay departamentos', () => {
  assert.equal(departmentsEnabled('company', dataOf()), true);
  for (const kind of /** @type {const} */ (['personal', 'freelancer', 'entrepreneur'])) assert.equal(departmentsEnabled(kind, dataOf()), false, kind);
  assert.equal(departmentsEnabled('personal', dataOf([], [dep('a', 0)])), true);
  assert.equal(departmentsEnabled(null, dataOf()), false);
});

// ---- Validación ------------------------------------------------------------------------------------------------------

test('validateDepartment: nombre y presupuesto válidos; vacío o 0 = sin presupuesto', () => {
  const ok = validateDepartment({ name: '  Ventas   y  mercadeo ', budgetText: '25,000.50' }, { departments: [] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { name: 'Ventas y mercadeo', monthlyBudgetCents: 2_500_050 });
  for (const budgetText of [undefined, '', '   ', '0']) {
    const r = validateDepartment({ name: 'Ventas', budgetText }, { departments: [] });
    assert.ok(r.ok, String(budgetText));
    if (r.ok) assert.equal(r.value.monthlyBudgetCents, 0);
  }
});

test('validateDepartment: cada dato inválido se explica', () => {
  const ctx = { departments: [dep('a', 0, { name: 'Ventas' })] };
  /** @type {[any, string][]} */
  const cases = [
    [{ name: '' }, 'name'],
    [{ name: '   ' }, 'name'],
    [{ name: 'x'.repeat(LIMITS.departmentName + 1) }, 'name'],
    [{ name: 'ventas' }, 'name'], // repetido sin importar mayúsculas
    [{ name: 'VENTAS' }, 'name'],
    [{ name: 'Compras', budgetText: 'abc' }, 'budget'],
    [{ name: 'Compras', budgetText: '-5' }, 'budget'],
    [{ name: 'Compras', budgetText: '1000000000000' }, 'budget'],
  ];
  for (const [input, field] of cases) {
    const r = validateDepartment(input, ctx);
    assert.ok(!r.ok, JSON.stringify(input));
    if (!r.ok) assert.ok(r.errors[field], `${JSON.stringify(input)} → ${field}`);
  }
  assert.ok(validateDepartment({ name: 'x'.repeat(LIMITS.departmentName) }, { departments: [] }).ok); // el máximo exacto se acepta
});

test('validateDepartment: un presupuesto demasiado grande se rechaza en su campo (el tope vale también justo en el límite)', () => {
  const tooBig = validateDepartment({ name: 'Ventas', budgetText: '1000000000.00' }, { departments: [] });
  assert.ok(!tooBig.ok);
  if (!tooBig.ok) assert.match(tooBig.errors.budget, /demasiado grande/);
  const edge = validateDepartment({ name: 'Ventas', budgetText: '999999999.99' }, { departments: [] });
  assert.ok(edge.ok);
});

test('validateDepartment: al editar se puede conservar el propio nombre, pero no copiar el de otro', () => {
  const list = [dep('a', 0, { name: 'Ventas' }), dep('b', 0, { name: 'Compras' })];
  assert.ok(validateDepartment({ name: 'VENTAS' }, { departments: list, exceptId: 'a' }).ok);
  assert.ok(!validateDepartment({ name: 'Compras' }, { departments: list, exceptId: 'a' }).ok);
});

test('validateDepartment: máximo de departamentos al crear (no al editar)', () => {
  const full = Array.from({ length: LIMITS.maxDepartments }, (_, i) => dep(`d${i}`, 0, { name: `Área ${i}` }));
  const r = validateDepartment({ name: 'Una más' }, { departments: full });
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.name, /máximo/);
  assert.ok(validateDepartment({ name: 'Área 0 renombrada' }, { departments: full, exceptId: 'd0' }).ok);
  assert.ok(validateDepartment({ name: 'Una más' }, { departments: full.slice(1) }).ok);
});

test('buildDepartment / applyDepartmentEdit: crear y editar sin tocar lo demás', () => {
  const d = buildDepartment({ name: 'Ventas', monthlyBudgetCents: 500_000 }, { id: 'x1', nowISO: NOW });
  assert.deepEqual(d, { id: 'x1', name: 'Ventas', monthlyBudgetCents: 500_000, archived: false, createdAt: NOW, updatedAt: NOW });
  assert.equal(buildDepartment({ name: 'V', monthlyBudgetCents: 0 }, { id: 'x2', nowISO: NOW, isDemo: true }).isDemo, true);
  const edited = applyDepartmentEdit({ ...d, archived: true, isDemo: true }, { name: 'Ventas 2', monthlyBudgetCents: 0 }, '2026-12-01T00:00:00.000Z');
  assert.deepEqual(edited, { id: 'x1', name: 'Ventas 2', monthlyBudgetCents: 0, archived: true, createdAt: NOW, updatedAt: '2026-12-01T00:00:00.000Z', isDemo: true });
});

// ---- Estado frente al presupuesto -----------------------------------------------------------------------------------

test('budgetStatus: en orden por debajo del 80 %, cerca del límite del 80 % al 100 % incluido, excedido por encima', () => {
  assert.equal(WARNING_PERCENT, 80);
  assert.equal(budgetStatus(0, 100_000), 'ok');
  assert.equal(budgetStatus(79_999, 100_000), 'ok');
  assert.equal(budgetStatus(80_000, 100_000), 'warning');
  assert.equal(budgetStatus(100_000, 100_000), 'warning'); // justo en el límite no es «excedido»
  assert.equal(budgetStatus(100_001, 100_000), 'over');
  assert.equal(budgetStatus(5_000_000, 0), 'none');
  assert.equal(budgetStatus(0, 0), 'none');
  assert.deepEqual(Object.keys(BUDGET_STATUS_LABELS).sort(), ['none', 'ok', 'over', 'warning']);
});

test('budgetStatus: la frontera se decide al centavo, sin redondear', () => {
  assert.equal(budgetStatus(8_000, 10_001), 'ok'); // 80,00 % de 100,01 → 79,99 %
  assert.equal(budgetStatus(8_001, 10_001), 'warning'); // 80,0 % exacto o más
  assert.equal(budgetStatus(10_001, 10_001), 'warning');
  assert.equal(budgetStatus(10_002, 10_001), 'over');
});

// ---- El mes de un vistazo ---------------------------------------------------------------------------------------------

/** Noviembre: Ventas (presupuesto 10,000) gastó 8,500; Compras (sin presupuesto) 2,000; Admin (3,000) 4,000; 1,500 sin asignar. */
function novemberData() {
  const movements = [
    exp('2026-11-02', 5000, 'ven'), exp('2026-11-10', 3500, 'ven'), // Ventas 8,500 (85 % → cerca del límite)
    exp('2026-11-03', 2000, 'com'), // Compras 2,000 (sin presupuesto)
    exp('2026-11-04', 1000, 'adm'), exp('2026-11-12', 3000, 'adm'), // Admin 4,000 de 3,000 (excedido)
    exp('2026-11-05', 1500), // sin asignar
    exp('2026-10-30', 9999, 'ven'), // otro mes: no cuenta
    exp('2026-11-20', 7777, 'ven'), // futuro: no cuenta
    inc('2026-11-06', 50000), // un ingreso nunca cuenta como gasto
  ];
  return dataOf(movements, [dep('ven', 10000), dep('com', 0), dep('adm', 3000)]);
}

test('departmentMonth: cada área frente a su presupuesto (cifras a mano)', () => {
  const m = departmentMonth(novemberData(), '2026-11', TODAY);
  const byId = Object.fromEntries(m.rows.map((r) => [r.department.id, r]));
  assert.deepEqual(m.rows.map((r) => r.department.id), ['adm', 'com', 'ven']); // por nombre
  assert.deepEqual([byId.ven.spentCents, byId.ven.count, byId.ven.budgetCents, byId.ven.status, byId.ven.percent, byId.ven.remainingCents], [850_000, 2, 1_000_000, 'warning', 85, 150_000]);
  assert.deepEqual([byId.com.spentCents, byId.com.count, byId.com.budgetCents, byId.com.status, byId.com.percent, byId.com.remainingCents], [200_000, 1, 0, 'none', null, null]);
  assert.deepEqual([byId.adm.spentCents, byId.adm.count, byId.adm.budgetCents, byId.adm.status, byId.adm.percent, byId.adm.remainingCents], [400_000, 2, 300_000, 'over', 133, -100_000]);
});

test('departmentMonth: el porcentaje se redondea al entero más cercano (no se trunca)', () => {
  // 2,000 de 3,000 = 66.67 % → 67; 1,000 de 3,000 = 33.33 % → 33; 1,250 de 2,500 = 50 % exacto.
  const data = dataOf(
    [exp('2026-11-03', 2000, 'a'), exp('2026-11-03', 1000, 'b'), exp('2026-11-03', 1250, 'c')],
    [dep('a', 3000), dep('b', 3000), dep('c', 2500)],
  );
  const byId = Object.fromEntries(departmentMonth(data, '2026-11', TODAY).rows.map((r) => [r.department.id, r]));
  assert.deepEqual([byId.a.percent, byId.b.percent, byId.c.percent], [67, 33, 50]);
});

test('departmentMonth: totales y la regla «por áreas + sin asignar = gasto operativo»', () => {
  const m = departmentMonth(novemberData(), '2026-11', TODAY);
  assert.equal(m.assignedCents, 850_000 + 200_000 + 400_000);
  assert.equal(m.unassignedCents, 150_000);
  assert.equal(m.unassignedCount, 1);
  assert.equal(m.totalSpentCents, 1_600_000);
  assert.equal(m.totalSpentCents, m.assignedCents + m.unassignedCents);
  // El presupuesto solo suma las áreas que lo tienen (Compras no entra): 10,000 + 3,000 = 13,000; gastaron 8,500 + 4,000.
  assert.equal(m.budgetTotalCents, 1_300_000);
  assert.equal(m.budgetedSpentCents, 1_250_000);
  assert.equal(m.remainingCents, 50_000); // neto: lo que sobra en Ventas tapa lo que se pasó Administración…
  assert.equal(m.overCents, 100_000); // …pero por separado: Administración se pasó 1,000
  assert.equal(m.leftCents, 150_000); // y a Ventas le quedan 1,500
  assert.equal(m.leftCents - m.overCents, m.remainingCents);
  assert.equal(m.budgetedCount, 2);
  assert.equal(m.overCount, 1);
  assert.equal(m.debtPaymentsCents, 0);
});

test('departmentMonth: un mes sin gastos da todo en cero (pero lista las áreas activas)', () => {
  const m = departmentMonth(novemberData(), '2026-09', TODAY);
  assert.equal(m.totalSpentCents, 0);
  assert.equal(m.rows.length, 3);
  assert.ok(m.rows.every((r) => r.spentCents === 0 && r.count === 0));
  assert.deepEqual(m.rows.map((r) => r.status), ['ok', 'none', 'ok']);
  assert.equal(m.remainingCents, 1_300_000);
  assert.deepEqual([m.overCents, m.leftCents], [0, 1_300_000]);
});

test('departmentMonth: los pagos de deudas no cuentan como gasto de ningún área (quedan aparte)', () => {
  const debtPay = exp('2026-11-08', 4000, 'ven'); // aunque un archivo editado lo cargara a un área
  const base = novemberData();
  const data = { ...base, movements: [...base.movements, debtPay], debtPayments: [{ id: 'p1', debtId: 'd1', kind: /** @type {const} */ ('regular'), amountCents: 400_000, date: '2026-11-08', time: '10:00', movementId: debtPay.id, createdAt: NOW, updatedAt: NOW }] };
  const m = departmentMonth(data, '2026-11', TODAY);
  assert.equal(m.rows.find((r) => r.department.id === 'ven')?.spentCents, 850_000);
  assert.equal(m.totalSpentCents, 1_600_000);
  assert.equal(m.debtPaymentsCents, 400_000);
  assert.equal(monthExpenses(data, '2026-11', TODAY).operating.length, 6);
});

test('departmentMonth: un área archivada solo aparece si gastó ese mes, y ya no tiene presupuesto que cumplir', () => {
  const data = dataOf([exp('2026-11-03', 700, 'old'), exp('2026-10-03', 300, 'older')], [
    dep('old', 500, { archived: true }), dep('older', 500, { archived: true }), dep('live', 1000),
  ]);
  const nov = departmentMonth(data, '2026-11', TODAY);
  assert.deepEqual(nov.rows.map((r) => r.department.id), ['live', 'old']); // 'older' no gastó en noviembre
  const old = nov.rows.find((r) => r.department.id === 'old');
  assert.deepEqual([old?.budgetCents, old?.status, old?.percent, old?.spentCents], [0, 'none', null, 70_000]);
  assert.equal(nov.budgetTotalCents, 100_000); // solo la activa
  assert.equal(nov.assignedCents, 70_000); // lo del archivado sí cuenta como gastado por áreas
  assert.equal(nov.totalSpentCents, 70_000);
});

test('departmentMonth: un gasto cargado a un departamento que ya no existe cuenta como sin asignar', () => {
  const data = dataOf([exp('2026-11-03', 100, 'fantasma'), exp('2026-11-04', 50, 'a')], [dep('a', 0)]);
  const m = departmentMonth(data, '2026-11', TODAY);
  assert.equal(m.unassignedCents, 10_000);
  assert.equal(m.assignedCents, 5_000);
  assert.equal(m.totalSpentCents, 15_000);
  assert.deepEqual(unassignedExpenses(data, '2026-11', TODAY).map((x) => x.amountCents), [10_000]);
});

test('departmentMonth: sin departamentos todo es «sin asignar»', () => {
  const m = departmentMonth(dataOf([exp('2026-11-03', 100), exp('2026-11-04', 50)]), '2026-11', TODAY);
  assert.equal(m.rows.length, 0);
  assert.equal(m.unassignedCents, 15_000);
  assert.equal(m.budgetTotalCents, 0);
});

// ---- Ritmo del mes ---------------------------------------------------------------------------------------------------

test('ritmo: gasto ÷ días transcurridos × días del mes (solo mes en curso, desde el día 5, con presupuesto)', () => {
  assert.equal(PACE_FROM_DAY, 5);
  // Hoy es el 15 de un mes de 30 días: 150,000 gastados → 300,000 al cierre.
  const ok = departmentMonth(dataOf([exp('2026-11-03', 1500, 'a')], [dep('a', 4000)]), '2026-11', TODAY).rows[0];
  assert.equal(ok.paceCents, 300_000);
  assert.equal(ok.paceExceeds, false);
  // 2,500 en 15 días → 5,000 al cierre: se pasaría de 4,000 sin haberse pasado todavía.
  const risky = departmentMonth(dataOf([exp('2026-11-03', 2500, 'a')], [dep('a', 4000)]), '2026-11', TODAY).rows[0];
  assert.equal(risky.status, 'ok');
  assert.equal(risky.paceCents, 500_000);
  assert.equal(risky.paceExceeds, true);
  // Si ya se pasó, no se repite el aviso del ritmo.
  const over = departmentMonth(dataOf([exp('2026-11-03', 4500, 'a')], [dep('a', 4000)]), '2026-11', TODAY).rows[0];
  assert.equal(over.status, 'over');
  assert.equal(over.paceExceeds, false);
});

test('ritmo: no se calcula en meses pasados, antes del día 5, sin gasto ni sin presupuesto', () => {
  const data = dataOf([exp('2026-11-02', 100, 'a'), exp('2026-10-02', 100, 'a')], [dep('a', 1000), dep('b', 0)]);
  assert.equal(departmentMonth(data, '2026-10', TODAY).rows[0].paceCents, null);
  assert.equal(departmentMonth(data, '2026-11', '2026-11-04').rows[0].paceCents, null); // día 4
  assert.notEqual(departmentMonth(data, '2026-11', '2026-11-05').rows[0].paceCents, null); // día 5
  assert.equal(departmentMonth(dataOf([], [dep('a', 1000)]), '2026-11', TODAY).rows[0].paceCents, null); // sin gasto
  assert.equal(departmentMonth(dataOf([exp('2026-11-02', 100, 'b')], [dep('b', 0)]), '2026-11', TODAY).rows[0].paceCents, null); // sin presupuesto
});

test('ritmo: usa los días reales del mes (febrero de 28 y de 29 días)', () => {
  const feb = (/** @type {string} */ today) => departmentMonth(dataOf([exp(`${today.slice(0, 8)}01`, 1000, 'a')], [dep('a', 5000)]), today.slice(0, 7), today).rows[0].paceCents;
  assert.equal(feb('2027-02-14'), Math.round((100_000 / 14) * 28));
  assert.equal(feb('2028-02-14'), Math.round((100_000 / 14) * 29));
});

// ---- Historia, categorías y listas ------------------------------------------------------------------------------------

test('departmentHistory: seis meses terminando en el pedido, con ceros, solo de ese departamento y sin pagos de deudas ni futuro', () => {
  const debtPay = exp('2026-09-09', 999, 'a');
  const data = dataOf([
    exp('2026-11-02', 100, 'a'), exp('2026-11-03', 50, 'a'), exp('2026-09-01', 70, 'a'), exp('2026-06-30', 30, 'a'),
    exp('2026-05-31', 5000, 'a'), // fuera de la ventana de 6 meses (jun–nov)
    exp('2026-11-04', 9000, 'b'), // de otro departamento
    exp('2026-11-20', 8000, 'a'), // futuro
    debtPay,
  ], [dep('a', 0), dep('b', 0)], { debtPayments: [{ id: 'p', debtId: 'd', kind: 'regular', amountCents: 99_900, date: '2026-09-09', time: '10:00', movementId: debtPay.id, createdAt: NOW, updatedAt: NOW }] });
  const h = departmentHistory(data, 'a', '2026-11', TODAY);
  assert.deepEqual(h.map((x) => x.monthKey), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(h.map((x) => x.spentCents), [3_000, 0, 0, 7_000, 0, 15_000]);
  assert.equal(departmentHistory(data, 'a', '2026-11', TODAY, 2).length, 2);
});

test('departmentCategories: de mayor a menor gasto, con empate estable', () => {
  const data = dataOf([
    exp('2026-11-02', 100, 'a', { categoryId: 'cat-exp-agua' }), exp('2026-11-03', 300, 'a', { categoryId: 'cat-exp-alquiler' }),
    exp('2026-11-04', 150, 'a', { categoryId: 'cat-exp-agua' }), exp('2026-11-05', 250, 'a', { categoryId: 'cat-exp-internet' }),
    exp('2026-11-06', 999, 'b', { categoryId: 'cat-exp-agua' }),
  ], [dep('a', 0), dep('b', 0)]);
  assert.deepEqual(departmentCategories(data, 'a', '2026-11', TODAY), [
    { categoryId: 'cat-exp-alquiler', cents: 30_000, count: 1 },
    { categoryId: 'cat-exp-agua', cents: 25_000, count: 2 },
    { categoryId: 'cat-exp-internet', cents: 25_000, count: 1 },
  ]);
});

test('departmentExpenses y unassignedExpenses: lo más reciente primero y sin mezclar', () => {
  const a1 = exp('2026-11-02', 100, 'a');
  const a2 = exp('2026-11-09', 200, 'a');
  const none = exp('2026-11-05', 300);
  const data = dataOf([a1, none, a2], [dep('a', 0)]);
  assert.deepEqual(departmentExpenses(data, 'a', '2026-11', TODAY).map((m) => m.id), [a2.id, a1.id]);
  assert.deepEqual(unassignedExpenses(data, '2026-11', TODAY).map((m) => m.id), [none.id]);
});

test('departmentUsage: cuenta los gastos de cualquier mes', () => {
  const data = dataOf([exp('2026-11-02', 1, 'a'), exp('2025-01-02', 1, 'a'), exp('2026-11-03', 1, 'b'), exp('2026-11-04', 1)]);
  assert.deepEqual(departmentUsage(data, 'a'), { expenses: 2 });
  assert.deepEqual(departmentUsage(data, 'z'), { expenses: 0 });
});

test('movementDepartmentText: el nombre del departamento, o vacío', () => {
  const data = dataOf([], [dep('a', 0, { name: 'Ventas' })]);
  assert.equal(movementDepartmentText(data, { departmentId: 'a' }), 'Ventas');
  assert.equal(movementDepartmentText(data, { departmentId: 'x' }), '');
  assert.equal(movementDepartmentText(data, {}), '');
});

// ---- Avisos ----------------------------------------------------------------------------------------------------------

test('avisos: uno en rojo por las áreas excedidas y uno informativo por las cercanas al límite', () => {
  const n = departmentNotices(novemberData(), TODAY);
  assert.deepEqual(n.map((x) => [x.id, x.level]), [['departments-over', 'critical'], ['departments-near', 'info']]);
  assert.match(n[0].text, /«ADM» ya se pasó de su presupuesto/);
  assert.match(n[0].text, /RD\$ ?4,000\.00 de RD\$ ?3,000\.00/);
  assert.match(n[1].text, /«VEN» ya usó el 85 %/);
});

test('avisos: con varias áreas excedidas o cercanas se listan juntas', () => {
  const data = dataOf([exp('2026-11-02', 200, 'a'), exp('2026-11-03', 300, 'b'), exp('2026-11-04', 90, 'c'), exp('2026-11-05', 85, 'd')], [dep('a', 100), dep('b', 100), dep('c', 100), dep('d', 100)]);
  const [over, near] = departmentNotices(data, TODAY);
  assert.match(over.text, /^2 departamentos ya se pasaron de su presupuesto de este mes \(«A», «B»\)/);
  assert.match(near.text, /^2 departamentos están cerca de su límite de este mes \(«C», «D»\)/);
});

test('avisos: sin departamentos, sin presupuestos o con todo en orden no hay avisos; solo cuenta el mes en curso', () => {
  assert.deepEqual(departmentNotices(dataOf([exp('2026-11-02', 100)]), TODAY), []);
  assert.deepEqual(departmentNotices(dataOf([exp('2026-11-02', 100000, 'a')], [dep('a', 0)]), TODAY), []);
  assert.deepEqual(departmentNotices(dataOf([exp('2026-11-02', 10, 'a')], [dep('a', 100)]), TODAY), []);
  assert.deepEqual(departmentNotices(dataOf([exp('2026-10-02', 500, 'a')], [dep('a', 100)]), TODAY), []); // se pasó en octubre, no ahora
});

// ---- Gastos: el departamento al registrar ---------------------------------------------------------------------------------

/** @param {Record<string, any>} [over] */
const movementInput = (over = {}) => ({
  type: 'expense', amountText: '100', date: '2026-11-10', time: '09:00', description: 'Resma de papel', classification: 'variable', categoryId: 'cat-exp-otros', ...over,
});
const movementCtx = (/** @type {any} */ extra = {}) => ({ categories: defaultCategories(), today: TODAY, departments: [dep('a', 0)], ...extra });

test('validateMovement: un gasto puede cargarse a un departamento; sin él queda vacío', () => {
  const r = validateMovement(movementInput({ departmentId: 'a' }), movementCtx());
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.departmentId, 'a');
  const none = validateMovement(movementInput(), movementCtx());
  assert.ok(none.ok);
  if (none.ok) assert.equal(none.value.departmentId, '');
});

test('validateMovement: un ingreso no se carga a un departamento y el departamento debe existir', () => {
  const income = validateMovement(movementInput({ type: 'income', categoryId: 'cat-inc-ventas', classification: 'variable', departmentId: 'a' }), movementCtx());
  assert.ok(!income.ok);
  if (!income.ok) assert.match(income.errors.department, /Solo los gastos/);
  const ghost = validateMovement(movementInput({ departmentId: 'zzz' }), movementCtx());
  assert.ok(!ghost.ok);
  if (!ghost.ok) assert.match(ghost.errors.department, /ya no existe/);
  const noList = validateMovement(movementInput({ departmentId: 'a' }), { categories: defaultCategories(), today: TODAY });
  assert.ok(!noList.ok); // sin lista de departamentos no se acepta ninguno
});

test('buildMovement y applyMovementEdit: el departamento se guarda, se cambia y se quita', () => {
  const v = validateMovement(movementInput({ departmentId: 'a' }), movementCtx());
  assert.ok(v.ok);
  if (!v.ok) return;
  const created = buildMovement(v.value, { id: 'm1', categoryId: 'cat-exp-otros', nowISO: NOW });
  assert.equal(created.departmentId, 'a');
  const without = validateMovement(movementInput(), movementCtx());
  assert.ok(without.ok);
  if (!without.ok) return;
  assert.equal('departmentId' in buildMovement(without.value, { id: 'm2', categoryId: 'cat-exp-otros', nowISO: NOW }), false);
  const cleared = applyMovementEdit(created, without.value, { categoryId: 'cat-exp-otros', nowISO: NOW });
  assert.equal('departmentId' in cleared, false);
  const b = validateMovement(movementInput({ departmentId: 'b' }), movementCtx({ departments: [dep('b', 0)] }));
  assert.ok(b.ok);
  if (b.ok) assert.equal(applyMovementEdit(created, b.value, { categoryId: 'cat-exp-otros', nowISO: NOW }).departmentId, 'b');
});

/** @param {Record<string, any>} [over] */
const stockInput = (over = {}) => ({ kind: 'purchase', productId: 'p1', quantityText: '5', unitText: '10', date: '2026-11-10', categoryId: 'cat-exp-otros', ...over });
const stockCtx = (/** @type {any} */ extra = {}) => ({
  products: [{ id: 'p1', name: 'Camisa', sku: '', unit: 'unidad', priceCents: 0, minStock: 0, notes: '', archived: false, createdAt: NOW, updatedAt: NOW }],
  suppliers: [], categories: defaultCategories(), entries: [], today: TODAY, time: '10:00', nowISO: NOW, departments: [dep('a', 0)], ...extra,
});

test('compras de inventario: el gasto puede cargarse a un departamento; ventas y ajustes, no', () => {
  const ok = validateStockEntry(stockInput({ departmentId: 'a' }), stockCtx());
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.departmentId, 'a');
  const entries = [{ id: 'e1', productId: 'p1', kind: /** @type {const} */ ('purchase'), quantity: 10, unitCents: 100, date: '2026-11-01', time: '08:00', note: '', createdAt: NOW, updatedAt: NOW }];
  const sale = validateStockEntry(stockInput({ kind: 'sale', categoryId: 'cat-inc-ventas', departmentId: 'a' }), stockCtx({ entries }));
  assert.ok(!sale.ok);
  if (!sale.ok) assert.match(sale.errors.department, /Solo las compras/);
  const adjust = validateStockEntry(stockInput({ kind: 'adjustment', categoryId: '', departmentId: 'a' }), stockCtx());
  assert.ok(!adjust.ok);
  const ghost = validateStockEntry(stockInput({ departmentId: 'zzz' }), stockCtx());
  assert.ok(!ghost.ok);
  if (!ghost.ok) assert.match(ghost.errors.department, /ya no existe/);
  const plain = validateStockEntry(stockInput(), stockCtx());
  assert.ok(plain.ok);
  if (plain.ok) assert.equal(plain.value.departmentId, '');
});
