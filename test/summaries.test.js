import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { computeNotices } from '../src/domain/notices.js';
import {
  availableByMonthEnd, changePercent, monthlySeries, monthTotals, netContributions, overallTotals, periodSeries,
  statsIndicators, totalsByCategory, totalsByClassification,
} from '../src/domain/summaries.js';

const today = '2026-07-20';
let n = 0;
/** @param {'income'|'expense'} type @param {string} date @param {number} pesos @param {string} categoryId @param {string} classification */
const mv = (type, date, pesos, categoryId, classification = 'variable') => ({
  id: `m${n++}`, type, amountCents: pesos * 100, date, time: '10:00', description: 'x',
  classification, categoryId, createdAt: '', updatedAt: '',
});
/** @param {'deposit'|'withdrawal'} kind @param {string} date @param {number} pesos */
const ct = (kind, date, pesos, goalId = 'g1') => ({
  id: `c${n++}`, goalId, kind, amountCents: pesos * 100, date, time: '09:00', note: '', createdAt: '', updatedAt: '',
});

/** @returns {import('../src/domain/types.js').AppData} */
const sample = () => ({
  categories: defaultCategories(),
  settings: { displayName: '', openingBalanceCents: 1_000_000 }, // saldo inicial RD$ 10,000
  goals: [],
  debts: [],
  debtPayments: [],
  clients: [],
  services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [],
  movements: [
    mv('income', '2026-06-01', 40000, 'cat-inc-salario', 'fixed'),
    mv('expense', '2026-06-05', 10000, 'cat-exp-alquiler', 'fixed'),
    mv('expense', '2026-06-10', 5000, 'cat-exp-alimentacion'),
    mv('income', '2026-07-01', 50000, 'cat-inc-salario', 'fixed'),
    mv('income', '2026-07-09', 6000, 'cat-inc-comisiones'),
    mv('expense', '2026-07-03', 15000, 'cat-exp-alquiler', 'fixed'),
    mv('expense', '2026-07-12', 3000, 'cat-exp-alimentacion'),
    mv('expense', '2026-07-15', 2000, 'cat-exp-restaurantes', 'discretionary'),
    mv('expense', '2026-07-18', 1000, 'cat-exp-ropa', 'discretionary'),
  ],
  contributions: [
    ct('deposit', '2026-06-20', 8000),
    ct('deposit', '2026-07-05', 5000),
    ct('withdrawal', '2026-07-08', 1000),
  ],
});

test('monthTotals: ingresos, gastos y balance del mes (documento §17)', () => {
  const t = monthTotals(sample().movements, '2026-07');
  assert.equal(t.incomeCents, 5_600_000);
  assert.equal(t.expenseCents, 2_100_000);
  assert.equal(t.balanceCents, 3_500_000);
  assert.equal(t.incomeCount, 2);
  assert.equal(t.expenseCount, 4);
  assert.equal(monthTotals([], '2026-07').balanceCents, 0);
});

test('netContributions: aportes - retiros', () => {
  const { contributions } = sample();
  assert.equal(netContributions(contributions), 1_200_000);
  assert.equal(netContributions(contributions, '2026-07'), 400_000);
  assert.equal(netContributions(contributions, '2026-05'), 0);
});

test('overallTotals: Disponible = saldo inicial + ingresos - gastos - ahorrado', () => {
  const t = overallTotals(sample(), today);
  assert.equal(t.incomeCents, 9_600_000);
  assert.equal(t.expenseCents, 3_600_000);
  assert.equal(t.savedCents, 1_200_000);
  // 10,000 + 96,000 - 36,000 - 12,000 = 58,000
  assert.equal(t.availableCents, 5_800_000);
});

test('registros con fecha futura no cuentan (por si llegan en un respaldo)', () => {
  const data = sample();
  data.movements.push(mv('income', '2026-07-25', 99999, 'cat-inc-salario', 'fixed'));
  data.contributions.push(ct('deposit', '2026-07-25', 1000));
  assert.equal(overallTotals(data, today).availableCents, 5_800_000);
});

test('monthlySeries y availableByMonthEnd', () => {
  const data = sample();
  const series = monthlySeries(data.movements, data.contributions, ['2026-05', '2026-06', '2026-07']);
  assert.deepEqual(series.map((s) => s.incomeCents), [0, 4_000_000, 5_600_000]);
  assert.deepEqual(series.map((s) => s.savedCents), [0, 800_000, 400_000]);
  const evolution = availableByMonthEnd(data, ['2026-05', '2026-06', '2026-07'], today);
  // Mayo: solo el saldo inicial. Junio: 10,000 + 40,000 - 15,000 - 8,000 = 27,000. Julio: 58,000.
  assert.deepEqual(evolution.map((e) => e.availableCents), [1_000_000, 2_700_000, 5_800_000]);
});

test('totalsByCategory: de mayor a menor, con porcentajes que suman 100', () => {
  const { movements, categories } = sample();
  const rows = totalsByCategory(movements, categories, 'expense', '2026-07');
  assert.deepEqual(rows.map((r) => r.name), ['Alquiler', 'Alimentación', 'Restaurantes', 'Ropa']);
  assert.equal(rows[0].totalCents, 1_500_000);
  const sum = rows.reduce((s, r) => s + r.percent, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
  assert.deepEqual(totalsByCategory(movements, categories, 'expense', '2026-01'), []);
});

test('totalsByClassification incluye las tres clases aunque estén en cero', () => {
  const rows = totalsByClassification(sample().movements, 'expense', '2026-07');
  assert.deepEqual(rows.map((r) => r.classification), ['fixed', 'variable', 'discretionary']);
  assert.deepEqual(rows.map((r) => r.totalCents), [1_500_000, 300_000, 300_000]);
  const income = totalsByClassification(sample().movements, 'income', '2026-07');
  assert.deepEqual(income.map((r) => r.classification), ['fixed', 'variable', 'extraordinary']);
  assert.equal(income[2].totalCents, 0);
});

test('changePercent: sin base de comparación devuelve null', () => {
  assert.equal(changePercent(150, 100), 50);
  assert.equal(changePercent(50, 100), -50);
  assert.equal(changePercent(100, 0), null);
});

test('statsIndicators (documento §6)', () => {
  const s = statsIndicators(sample(), '2026-07', today);
  // Ingreso promedio: (40,000 en junio + 56,000 en julio) / 2 meses
  assert.equal(s.income.avgMonthlyCents, 4_800_000);
  assert.equal(s.income.biggest?.amountCents, 5_000_000);
  assert.equal(s.income.biggestCategoryName, 'Salario');
  assert.deepEqual(s.income.mostFrequent, { name: 'Salario', count: 2 });
  assert.equal(Math.round(s.income.changePercent ?? 0), 40); // 56,000 vs 40,000
  // Gasto promedio: (15,000 junio + 21,000 julio) / 2
  assert.equal(s.expense.avgMonthlyCents, 1_800_000);
  assert.equal(s.expense.top?.name, 'Alquiler');
  assert.equal(s.expense.low?.name, 'Ropa');
  assert.equal(Math.round(s.expense.changePercent ?? 0), 40);
  // Ahorro: 4,000 netos en julio sobre 56,000 de ingresos
  assert.equal(s.saving.monthNetCents, 400_000);
  assert.equal(Math.round((s.saving.ratePercent ?? 0) * 100) / 100, 7.14);
  assert.equal(s.saving.accumulatedCents, 1_200_000);
});

test('statsIndicators con datos vacíos no falla ni inventa números', () => {
  const empty = { categories: defaultCategories(), movements: [], goals: [], contributions: [], settings: { displayName: '', openingBalanceCents: 0 } };
  const s = statsIndicators(empty, '2026-07', today);
  assert.equal(s.income.avgMonthlyCents, null);
  assert.equal(s.income.biggest, null);
  assert.equal(s.income.mostFrequent, null);
  assert.equal(s.income.changePercent, null);
  assert.equal(s.expense.top, null);
  assert.equal(s.expense.low, null);
  assert.equal(s.saving.ratePercent, null);
});

test('un solo gasto no cuenta como "categoría de menor consumo"', () => {
  const data = sample();
  data.movements = [mv('expense', '2026-07-03', 100, 'cat-exp-agua', 'fixed')];
  const s = statsIndicators(data, '2026-07', today);
  assert.equal(s.expense.top?.name, 'Agua');
  assert.equal(s.expense.low, null);
});

test('avisos: disponible negativo, gasto mayor que ingreso y metas por vencer', () => {
  const data = sample();
  assert.deepEqual(computeNotices(data, today), []);

  data.movements.push(mv('expense', '2026-07-19', 90000, 'cat-exp-otros'));
  const ids = computeNotices(data, today).map((x) => x.id);
  assert.ok(ids.includes('available-negative'));
  assert.ok(ids.includes('month-overspent'));
  assert.ok(computeNotices(data, today).every((x) => x.level === 'critical'));

  const withGoal = sample();
  withGoal.goals.push({ id: 'g1', name: 'Viaje', description: '', targetCents: 5_000_000, targetDate: '2026-07-30', createdAt: '', updatedAt: '' });
  const soon = computeNotices(withGoal, today).find((x) => x.id === 'goal-soon-g1');
  assert.ok(soon && soon.level === 'info');
  assert.match(soon.text, /vence en 10 días/);

  withGoal.goals[0].targetDate = '2026-07-10';
  const overdue = computeNotices(withGoal, today).find((x) => x.id === 'goal-overdue-g1');
  assert.ok(overdue && overdue.level === 'critical');
});

test('avisos: sin ingresos este mes es informativo, no alarma', () => {
  const data = sample();
  data.movements = [mv('expense', '2026-07-03', 100, 'cat-exp-agua', 'fixed')];
  const notice = computeNotices(data, today).find((x) => x.id === 'month-no-income');
  assert.ok(notice && notice.level === 'info');
});

/** @param {Partial<import('../src/domain/types.js').Debt>} over */
const debtFixture = (over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 12_000_000, rateBp: 0, rateBasis: 'annual', frequency: 'monthly',
  collateralKind: 'personal', collateralType: 'prestamo-personal',
  firstDueDate: '2026-08-01', firstDueTime: '09:00', finalDueDate: '2027-07-01', finalDueTime: '09:00',
  createdAt: '', updatedAt: '', ...over,
});

test('avisos de deudas: vencida (rojo), cuota próxima (info) y sin aviso si falta mucho', () => {
  const data = sample();
  data.debts = [debtFixture({ firstDueDate: '2026-08-01' })]; // cuota dentro de 12 días: sin aviso
  assert.deepEqual(computeNotices(data, today).filter((x) => x.id.startsWith('debt-')), []);

  data.debts = [debtFixture({ firstDueDate: '2026-07-25', finalDueDate: '2027-06-25' })]; // en 5 días
  const soon = computeNotices(data, today).find((x) => x.id === 'debt-soon-d1');
  assert.ok(soon && soon.level === 'info');
  assert.match(soon.text, /vence en 5 días/);
  assert.match(soon.text, /son interés/);

  data.debts = [debtFixture({ firstDueDate: '2026-07-10', finalDueDate: '2027-06-10' })]; // venció hace 10 días
  const late = computeNotices(data, today).find((x) => x.id === 'debt-overdue-d1');
  assert.ok(late && late.level === 'critical');
  assert.match(late.text, /1 cuota vencida/);
});

test('avisos de deudas: vencimiento final cercano y deuda pagada no avisa', () => {
  const data = sample();
  data.debts = [debtFixture({ firstDueDate: '2026-08-10', finalDueDate: '2026-08-10' })]; // única cuota, en 21 días
  const fin = computeNotices(data, today).find((x) => x.id === 'debt-final-d1');
  assert.ok(fin && fin.level === 'info');
  assert.match(fin.text, /vence del todo en 21 días/);

  data.debts = [debtFixture({ totalCents: 100_000, firstDueDate: '2026-07-10', finalDueDate: '2026-07-10' })];
  data.debtPayments = [{
    id: 'p1', debtId: 'd1', kind: 'regular', amountCents: 100_000, date: '2026-07-10', time: '10:00', note: '',
    movementId: 'mx', createdAt: '', updatedAt: '',
  }];
  assert.deepEqual(computeNotices(data, today).filter((x) => x.id.startsWith('debt-')), []);
});

// ------------------------------------------------------------------ períodos: mensual, trimestral, anual

test('periodSeries mensual coincide con monthlySeries', () => {
  const { movements, contributions } = sample();
  const p = periodSeries(movements, contributions, '2026-07', 'month', '2026-07');
  assert.equal(p.length, 6);
  assert.deepEqual(p.map((x) => x.key), ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
  const m = monthlySeries(movements, contributions, p.map((x) => x.key));
  assert.deepEqual(p.map((x) => [x.incomeCents, x.expenseCents, x.balanceCents, x.savedCents]), m.map((x) => [x.incomeCents, x.expenseCents, x.balanceCents, x.savedCents]));
  assert.equal(p.at(-1)?.partial, true, 'el mes actual está a medias');
  assert.equal(p.at(-2)?.partial, false);
});

test('periodSeries trimestral: trimestres de calendario, el último a medias', () => {
  const { movements, contributions } = sample();
  const p = periodSeries(movements, contributions, '2026-07', 'quarter', '2026-07');
  assert.deepEqual(p.map((x) => x.key), ['2025-T4', '2026-T1', '2026-T2', '2026-T3']);
  assert.equal(p[3].label, 'T3 2026 (julio–septiembre)');
  assert.equal(p[3].shortLabel, 'T3 2026');
  assert.equal(p[2].label, 'T2 2026 (abril–junio)');
  // T2 = junio: ingresos 40,000, gastos 15,000, aportes 8,000.
  assert.deepEqual([p[2].incomeCents, p[2].expenseCents, p[2].balanceCents, p[2].savedCents], [4_000_000, 1_500_000, 2_500_000, 800_000]);
  // T3 = julio: ingresos 56,000, gastos 21,000, aportes 5,000 - 1,000.
  assert.deepEqual([p[3].incomeCents, p[3].expenseCents, p[3].balanceCents, p[3].savedCents], [5_600_000, 2_100_000, 3_500_000, 400_000]);
  assert.deepEqual(p.map((x) => x.partial), [false, false, false, true]);
  assert.equal(p[0].incomeCents, 0);
});

test('periodSeries trimestral: cruza el cambio de año', () => {
  const p = periodSeries([], [], '2026-01', 'quarter', '2026-07');
  assert.deepEqual(p.map((x) => x.key), ['2025-T2', '2025-T3', '2025-T4', '2026-T1']);
  assert.deepEqual(p.map((x) => x.firstMonth), ['2025-04', '2025-07', '2025-10', '2026-01']);
  assert.deepEqual(p.map((x) => x.partial), [false, false, false, false], 'T1 2026 ya terminó en julio de 2026');
});

test('periodSeries anual: años de calendario', () => {
  const { movements, contributions } = sample();
  const p = periodSeries(movements, contributions, '2026-07', 'year', '2026-07');
  assert.deepEqual(p.map((x) => x.key), ['2024', '2025', '2026']);
  assert.equal(p[2].label, '2026');
  assert.equal(p[2].incomeCents, 9_600_000);
  assert.equal(p[2].expenseCents, 3_600_000);
  assert.equal(p[2].partial, true);
  assert.equal(p[1].partial, false);
});

test('periodSeries: mirar un mes pasado ya no muestra el período como a medias', () => {
  const { movements, contributions } = sample();
  const p = periodSeries(movements, contributions, '2026-06', 'quarter', '2026-07');
  assert.equal(p.at(-1)?.key, '2026-T2');
  assert.equal(p.at(-1)?.partial, false);
  // Lo de julio (T3) no entra en el trimestre de junio.
  assert.equal(p.at(-1)?.incomeCents, 4_000_000);
});
