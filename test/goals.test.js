import test from 'node:test';
import assert from 'node:assert/strict';
import { goalPace, goalProgress, goalSavedCents, primaryGoal, validateContribution, validateGoal } from '../src/domain/goals.js';
import { daysBetween } from '../src/domain/dates.js';

const today = '2026-07-10';

/** @param {Partial<import('../src/domain/types.js').Goal>} over */
const goal = (over = {}) => ({
  id: 'g1', name: 'Laptop', description: '', targetCents: 6_000_000, targetDate: '2026-12-10',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});
/** @param {string} goalId @param {'deposit'|'withdrawal'} kind @param {number} amountCents @param {string} id */
const contrib = (goalId, kind, amountCents, id = Math.random().toString()) => ({
  id, goalId, kind, amountCents, date: '2026-07-01', time: '10:00', note: '',
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
});

test('validateGoal: campos del documento §4.5', () => {
  const ok = validateGoal({ name: ' Laptop ', description: '', targetText: '60,000', targetDate: '2026-12-10' }, { today });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.name, 'Laptop');
    assert.equal(ok.value.targetCents, 6_000_000);
  }
  const bad = validateGoal({ name: '', description: '', targetText: '0', targetDate: '2026-07-01' }, { today });
  assert.ok(!bad.ok);
  if (!bad.ok) for (const f of ['name', 'target', 'targetDate']) assert.ok(bad.errors[f], f);
});

test('validateGoal: una meta ya vencida puede editarse sin cambiar su fecha', () => {
  const old = goal({ targetDate: '2026-06-01' });
  const input = { name: 'Laptop', description: '', targetText: '60000', targetDate: '2026-06-01' };
  assert.ok(!validateGoal(input, { today }).ok); // nueva con fecha pasada: no
  assert.ok(validateGoal(input, { today, existing: old }).ok); // existente sin cambiar fecha: sí
  assert.ok(!validateGoal({ ...input, targetDate: '2026-06-02' }, { today, existing: old }).ok);
});

test('lo ahorrado = aportes - retiros', () => {
  const list = [contrib('g1', 'deposit', 500_000), contrib('g1', 'deposit', 300_000), contrib('g1', 'withdrawal', 100_000), contrib('g2', 'deposit', 999_999)];
  assert.equal(goalSavedCents('g1', list), 700_000);
  assert.equal(goalSavedCents('g2', list), 999_999);
  assert.equal(goalSavedCents('g3', list), 0);
});

test('validateContribution: no se puede retirar más de lo ahorrado', () => {
  const input = { kind: 'withdrawal', amountText: '1000', date: '2026-07-10', time: '10:00', note: '' };
  assert.ok(!validateContribution(input, { today, savedCents: 99_999 }).ok);
  assert.ok(validateContribution(input, { today, savedCents: 100_000 }).ok);
  assert.ok(validateContribution({ ...input, kind: 'deposit' }, { today, savedCents: 0 }).ok);
  assert.ok(!validateContribution({ ...input, date: '2026-07-11' }, { today, savedCents: 1e9 }).ok);
  assert.ok(!validateContribution({ ...input, kind: 'otro' }, { today, savedCents: 1e9 }).ok);
});

test('goalProgress: porcentaje, faltante y tiempo restante', () => {
  const g = goal({ targetCents: 1_000_000, targetDate: '2026-10-10' });
  const p = goalProgress(g, [contrib('g1', 'deposit', 250_000)], today);
  assert.equal(p.savedCents, 250_000);
  assert.equal(p.remainingCents, 750_000);
  assert.equal(p.percent, 25);
  assert.equal(p.completed, false);
  assert.equal(p.timeLeftText, 'Quedan 3 meses');
  assert.equal(p.horizon, 'short');
  // Faltan 750,000 centavos en 92 días (~3.02 meses) -> unos 248,000 por mes, redondeado hacia arriba.
  assert.ok(p.monthlyNeededCents >= 248_000 && p.monthlyNeededCents <= 250_000, String(p.monthlyNeededCents));
});

test('goalProgress: meta cumplida, vencida y sin aportes', () => {
  const g = goal({ targetCents: 100_000 });
  const done = goalProgress(g, [contrib('g1', 'deposit', 150_000)], today);
  assert.equal(done.completed, true);
  assert.equal(done.percent, 100); // nunca pasa de 100
  assert.equal(done.remainingCents, 0);
  assert.equal(done.monthlyNeededCents, 0);
  assert.equal(done.timeLeftText, 'Meta cumplida');

  const late = goalProgress(goal({ targetDate: '2026-07-01' }), [], today);
  assert.equal(late.overdue, true);
  assert.equal(late.monthlyNeededCents, 0);
  assert.equal(late.timeLeftText, 'Venció hace 9 días');

  assert.equal(goalProgress(g, [], today).percent, 0);
});

test('goalProgress: corto / mediano / largo plazo (documento §11)', () => {
  const horizon = (/** @type {string} */ targetDate) => goalProgress(goal({ targetDate }), [], today).horizon;
  assert.equal(horizon('2027-07-09'), 'short'); // 11 meses y 30 días
  assert.equal(horizon('2027-07-10'), 'medium'); // exactamente 1 año
  assert.equal(horizon('2031-07-10'), 'medium'); // exactamente 5 años
  assert.equal(horizon('2031-07-11'), 'long'); // más de 5 años
});

test('goalProgress: si falta menos de un mes se pide todo lo que falta', () => {
  const g = goal({ targetCents: 100_000, targetDate: '2026-07-20' });
  assert.equal(goalProgress(g, [], today).monthlyNeededCents, 100_000);
});

test('primaryGoal: la pendiente con la fecha más cercana', () => {
  const a = goal({ id: 'a', targetDate: '2027-01-01' });
  const b = goal({ id: 'b', targetDate: '2026-09-01' });
  const c = goal({ id: 'c', targetDate: '2026-08-01', targetCents: 100 });
  const done = [contrib('c', 'deposit', 100)]; // c ya está cumplida
  assert.equal(primaryGoal([a, b, c], done)?.id, 'b');
  assert.equal(primaryGoal([], []), null);
  assert.equal(primaryGoal([c], done), null);
});

test('editar un aporte no puede dejar la meta en negativo', () => {
  // Había un aporte de 100 y un retiro de 80. Sin ese aporte la meta quedaría en -80.
  const input = { kind: 'deposit', amountText: '50', date: '2026-07-10', time: '10:00', note: '' };
  assert.ok(!validateContribution(input, { today, savedCents: -8000 }).ok);
  assert.ok(validateContribution({ ...input, amountText: '80' }, { today, savedCents: -8000 }).ok);
});

// ------------------------------------------------------------------ ritmo actual de una meta

/** Aporte con fecha propia. @param {'deposit'|'withdrawal'} kind @param {number} cents @param {string} date @param {string} goalId */
const on = (kind, cents, date, goalId = 'g1') => ({ ...contrib(goalId, kind, cents), date });

test('goalPace: una meta sin aportes no tiene ritmo ni fecha estimada', () => {
  const p = goalPace(goal(), [], today);
  assert.equal(p.status, 'no-data');
  assert.equal(p.monthlyPaceCents, 0);
  assert.equal(p.projectedDate, null);
  assert.ok(p.monthlyNeededCents > 0, 'sigue mostrando lo que haría falta');
});

test('goalPace: aportes constantes llegan a tiempo y la fecha sale de lo que falta / el ritmo', () => {
  // 10,000 al mes durante 3 meses: ahorrado 30,000 de 60,000.
  const list = [on('deposit', 1_000_000, '2026-05-15'), on('deposit', 1_000_000, '2026-06-15'), on('deposit', 1_000_000, '2026-07-05')];
  const p = goalPace(goal(), list, today);
  assert.equal(p.windowMonths, 3);
  assert.equal(p.windowStart, '2026-04-11');
  assert.equal(p.windowNetCents, 3_000_000);
  assert.equal(p.monthlyPaceCents, 1_000_000);
  // Faltan 30,000 a 10,000 por mes = 3 meses (92 días con meses de 30.4375 días).
  assert.equal(p.projectedDate, '2026-10-10');
  assert.equal(p.status, 'on-track');
  assert.equal(p.lateDays, null);
});

test('goalPace: a un ritmo muy lento se llega tarde y se dice cuántos días', () => {
  const list = [on('deposit', 100_000, '2026-06-20')];
  const p = goalPace(goal(), list, today);
  assert.equal(p.status, 'behind');
  assert.equal(p.monthlyPaceCents, 33_333);
  assert.ok(p.projectedDate && p.projectedDate > '2026-12-10');
  assert.equal(p.lateDays, daysBetween('2026-12-10', p.projectedDate ?? ''));
  assert.equal(p.tooFar, false);
});

test('goalPace: un ritmo diminuto no inventa una fecha de hace siglos', () => {
  const p = goalPace(goal(), [on('deposit', 100, '2026-07-01')], today);
  assert.equal(p.status, 'behind');
  assert.equal(p.tooFar, true);
  assert.equal(p.projectedDate, null);
});

test('goalPace: aportes viejos (fuera de los últimos 3 meses) no cuentan: ritmo detenido', () => {
  const p = goalPace(goal(), [on('deposit', 2_000_000, '2026-01-15')], today);
  assert.equal(p.status, 'stalled');
  assert.equal(p.monthlyPaceCents, 0);
  assert.equal(p.projectedDate, null);
});

test('goalPace: si retiraste más de lo que aportaste en el período, el ritmo es 0', () => {
  const list = [on('deposit', 500_000, '2026-06-01'), on('withdrawal', 700_000, '2026-06-10')];
  const p = goalPace(goal(), list, today);
  assert.equal(p.windowNetCents, -200_000);
  assert.equal(p.status, 'stalled');
  assert.equal(p.monthlyPaceCents, 0);
});

test('goalPace: una meta nueva promedia sobre 1 mes (no multiplica lo de unos pocos días)', () => {
  const g = goal({ createdAt: '2026-07-05T12:00:00.000Z' });
  const p = goalPace(g, [on('deposit', 600_000, '2026-07-06')], today);
  assert.equal(p.windowMonths, 1);
  assert.equal(p.monthlyPaceCents, 600_000);
});

test('goalPace: dos meses de historia se promedian entre 2', () => {
  const g = goal({ createdAt: '2026-05-01T12:00:00.000Z' });
  const p = goalPace(g, [on('deposit', 400_000, '2026-05-20'), on('deposit', 200_000, '2026-06-20')], today);
  assert.equal(p.windowMonths, 2);
  assert.equal(p.monthlyPaceCents, 300_000);
});

test('goalPace: solo cuentan los aportes de esa meta y de hoy hacia atrás', () => {
  const list = [on('deposit', 1_000_000, '2026-06-20'), on('deposit', 9_000_000, '2026-06-20', 'g2'), on('deposit', 5_000_000, '2026-07-20')];
  const p = goalPace(goal(), list, today);
  assert.equal(p.windowNetCents, 1_000_000);
});

test('goalPace: meta cumplida', () => {
  const p = goalPace(goal({ targetCents: 1_000_000 }), [on('deposit', 1_000_000, '2026-06-20')], today);
  assert.equal(p.status, 'completed');
  assert.equal(p.monthlyNeededCents, 0);
});

test('goalPace: meta vencida con ritmo: llegaría tarde y ya no se pide aporte mensual', () => {
  const g = goal({ targetDate: '2026-06-01' });
  const p = goalPace(g, [on('deposit', 1_000_000, '2026-07-01')], today);
  assert.equal(p.status, 'behind');
  assert.equal(p.monthlyNeededCents, 0);
  assert.ok(p.projectedDate && p.projectedDate > today);
});
