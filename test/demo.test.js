import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup, createBackup } from '../src/domain/backup.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildDemoData } from '../src/domain/demo.js';
import { debtPortfolio } from '../src/domain/debts.js';
import { goalSavedCents } from '../src/domain/goals.js';
import { overallTotals } from '../src/domain/summaries.js';

const nowISO = '2026-07-20T12:00:00.000Z';

// Se prueba con varias fechas, incluidas las "difíciles": día 1 del mes, 31 y bisiestos.
const days = ['2026-07-01', '2026-07-02', '2026-07-20', '2026-07-31', '2026-03-31', '2028-02-29', '2026-12-31', '2027-01-01'];

for (const today of days) {
  test(`datos de demostración coherentes (hoy = ${today})`, () => {
    const demo = buildDemoData(today, nowISO);
    assert.ok(demo.movements.length > 0);

    // Todo está marcado como demostración y su descripción lo dice.
    for (const r of [...demo.movements, ...demo.goals, ...demo.contributions, ...demo.debts, ...demo.debtPayments]) assert.equal(r.isDemo, true);
    assert.ok(demo.debts.every((d) => d.name.includes('demostración')));
    assert.ok(demo.movements.every((m) => m.description.includes('demostración')));
    assert.ok(demo.goals.every((g) => g.name.includes('demostración')));

    // Nunca hay fechas futuras.
    assert.ok(demo.movements.every((m) => m.date <= today), 'movimiento con fecha futura');
    assert.ok(demo.contributions.every((c) => c.date <= today), 'aporte con fecha futura');

    // IDs únicos y referencias válidas.
    const ids = [...demo.movements, ...demo.goals, ...demo.contributions, ...demo.debts, ...demo.debtPayments].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(demo.contributions.every((c) => demo.goals.some((g) => g.id === c.goalId)));
    assert.ok(demo.debtPayments.every((p) => p.date <= today), 'pago con fecha futura');
    assert.ok(demo.debtPayments.every((p) => demo.debts.some((d) => d.id === p.debtId)));
    assert.ok(demo.debtPayments.every((p) => demo.movements.some((m) => m.id === p.movementId && m.amountCents === p.amountCents)));

    // Pasa exactamente la misma validación que un respaldo real.
    const data = { categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, ...demo };
    const parsed = parseBackup(JSON.stringify(createBackup(data, nowISO)));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);

    // Ninguna meta de demostración supera su objetivo.
    for (const g of demo.goals) assert.ok(goalSavedCents(g.id, demo.contributions) <= g.targetCents);
  });
}

test('con la demostración en un día normal el disponible es positivo', () => {
  const today = '2026-07-20';
  const demo = buildDemoData(today, nowISO);
  const data = { categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, ...demo };
  assert.ok(overallTotals(data, today).availableCents > 0);
});

test('es determinista: mismas fechas, mismos montos', () => {
  const a = buildDemoData('2026-07-20', nowISO).movements.map((m) => [m.date, m.amountCents]);
  const b = buildDemoData('2026-07-20', nowISO).movements.map((m) => [m.date, m.amountCents]);
  assert.deepEqual(a, b);
});

test('las deudas de demostración tienen estados variados y ninguna está vencida', () => {
  const today = '2026-07-20';
  const demo = buildDemoData(today, nowISO);
  const data = { movements: demo.movements, debts: demo.debts, debtPayments: demo.debtPayments };
  const p = debtPortfolio(data, today);
  assert.equal(p.items.length, 3);
  assert.ok(p.items.every((i) => i.status.state !== 'overdue'));
  assert.ok(p.items.some((i) => i.status.state === 'due-soon'));
  assert.ok(p.short.length >= 1 && p.long.length >= 1);
  const loan = p.items.find((i) => i.debt.name.startsWith('Préstamo personal'));
  assert.equal(loan?.status.installmentsPaid, 3);
});
