import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBudget, monthlyBaseline } from '../src/domain/budget.js';

const today = '2026-07-20';
let n = 0;
/** @param {'income'|'expense'} type @param {string} date @param {number} pesos */
const mv = (type, date, pesos, id = `m${n++}`) => ({
  id, type, amountCents: pesos * 100, date, time: '10:00', description: 'x',
  classification: 'variable', categoryId: type === 'income' ? 'cat-inc-salario' : 'cat-exp-otros', createdAt: '', updatedAt: '',
});

/** @returns {import('../src/domain/types.js').AppData} */
const empty = () => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 },
  movements: [], goals: [], contributions: [], debts: [], debtPayments: [],
});

/** @param {Partial<import('../src/domain/types.js').Debt>} over */
const debtFixture = (over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 1_200_000, rateBp: 0, rateBasis: 'annual', frequency: 'monthly',
  collateralKind: 'personal', collateralType: 'prestamo-personal',
  firstDueDate: '2026-07-25', firstDueTime: '09:00', finalDueDate: '2027-06-25', finalDueTime: '09:00',
  createdAt: '', updatedAt: '', ...over,
}); // 12 cuotas de RD$ 1,000

test('sin movimientos: no se inventa ninguna capacidad', () => {
  const b = buildBudget(empty(), today);
  assert.equal(b.baseline.hasData, false);
  assert.equal(b.savingsCapacityCents, null);
  assert.equal(b.investmentCapacityCents, null);
  assert.equal(b.committedCents, 0);
});

test('mes típico: promedia solo los meses completos con datos y separa los pagos de deudas', () => {
  const d = empty();
  d.movements = [
    mv('income', '2026-06-01', 50000), mv('expense', '2026-06-10', 20000),
    mv('income', '2026-05-01', 40000), mv('expense', '2026-05-10', 10000),
    // abril sin movimientos: no cuenta como mes
    mv('income', '2026-07-01', 99999), // mes en curso: no entra si hay meses completos
    mv('expense', '2026-06-20', 5000, 'pay1'), // pago de deuda: se excluye de los gastos
  ];
  d.debtPayments = [{ id: 'p', debtId: 'd1', kind: 'regular', amountCents: 500_000, date: '2026-06-20', time: '10:00', note: '', movementId: 'pay1', createdAt: '', updatedAt: '' }];
  const b = monthlyBaseline(d, today);
  assert.equal(b.months, 2);
  assert.equal(b.partial, false);
  assert.equal(b.incomeCents, 4_500_000); // (50,000 + 40,000) / 2
  assert.equal(b.expenseCents, 1_500_000); // (20,000 + 10,000) / 2, sin los 5,000 de deuda
});

test('si no hay meses completos se usa el mes en curso y se marca como parcial', () => {
  const d = empty();
  d.movements = [mv('income', '2026-07-01', 30000), mv('expense', '2026-07-05', 6000)];
  const b = monthlyBaseline(d, today);
  assert.deepEqual([b.hasData, b.partial, b.months, b.incomeCents, b.expenseCents], [true, true, 1, 3_000_000, 600_000]);
});

test('capacidad de ahorro = ingreso − gasto típico − cuotas de deudas; inversión resta además las metas', () => {
  const d = empty();
  d.movements = [mv('income', '2026-06-01', 50000), mv('expense', '2026-06-10', 20000)];
  d.debts = [debtFixture()];
  d.goals = [{ id: 'g1', name: 'Viaje', description: '', targetCents: 600_000, targetDate: '2027-01-20', createdAt: '', updatedAt: '' }];
  const b = buildBudget(d, today);
  assert.equal(b.debtServiceCents, 100_000); // RD$ 1,000 al mes
  assert.equal(b.savingsCapacityCents, 5_000_000 - 2_000_000 - 100_000);
  assert.ok(b.goalsMonthlyCents > 0);
  assert.equal(b.investmentCapacityCents, (b.savingsCapacityCents ?? 0) - b.goalsMonthlyCents);
});

test('comprometido: cuotas de este mes (con las vencidas) y lo que queda libre', () => {
  const d = empty();
  d.settings.openingBalanceCents = 500_000;
  d.debts = [debtFixture({ firstDueDate: '2026-07-10', finalDueDate: '2027-06-10' })]; // la de julio ya venció y no se pagó
  const b = buildBudget(d, today);
  assert.equal(b.committedCents, 100_000);
  assert.equal(b.committedCount, 1);
  assert.equal(b.availableCents, 500_000);
  assert.equal(b.freeAfterCommitmentsCents, 400_000);

  d.settings.openingBalanceCents = 50_000;
  assert.equal(buildBudget(d, today).freeAfterCommitmentsCents, -50_000, 'si no alcanza, queda en negativo (se avisa en pantalla)');
});

test('una meta cumplida o vencida no cuenta en lo que hay que aportar cada mes', () => {
  const d = empty();
  d.movements = [mv('income', '2026-06-01', 50000), mv('expense', '2026-06-10', 20000)];
  d.goals = [
    { id: 'g1', name: 'Vencida', description: '', targetCents: 600_000, targetDate: '2026-07-01', createdAt: '', updatedAt: '' },
  ];
  assert.equal(buildBudget(d, today).goalsMonthlyCents, 0);
});
