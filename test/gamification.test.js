// Pruebas de gamificación: rachas (día, semana, mes), logros, puntos y niveles. Solo cuentan datos reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_LABELS, LEVELS, RULES, TIER_POINTS, activityDays, demoRecordCount, gamification, levelFor, realData, streakOf, streakText,
  streaks, weekStart,
} from '../src/domain/gamification.js';
import { addDays, addMonths } from '../src/domain/dates.js';
import { defaultSettings } from '../src/domain/settings.js';

const TODAY = '2026-11-09'; // lunes

/** @returns {any} */
const base = (over = {}) => ({
  categories: [], movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [],
  products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], settings: defaultSettings(), ...over,
});

let seq = 0;
const stamp = (date) => `${date}T10:00:00.000Z`;
const mv = (date, type = 'income', amountCents = 100_000, over = {}) => ({
  id: `m${++seq}`, type, amountCents, date, time: '10:00', description: 'x', classification: type === 'income' ? 'fixed' : 'variable',
  categoryId: 'cat-1', createdAt: stamp(date), updatedAt: stamp(date), ...over,
});
const goal = (id, targetCents, over = {}) => ({ id, name: id, description: '', targetCents, targetDate: '2027-12-31', createdAt: stamp('2026-01-01'), updatedAt: stamp('2026-01-01'), ...over });
const dep = (goalId, amountCents, date, over = {}) => ({
  id: `k${++seq}`, goalId, kind: 'deposit', amountCents, date, time: '10:00', note: '', createdAt: stamp(date), updatedAt: stamp(date), ...over,
});
const debt = (over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 100_000, rateBp: 0, rateBasis: 'annual', frequency: 'monthly',
  collateralKind: 'personal', collateralType: 'prestamo-personal', firstDueDate: '2026-12-01', firstDueTime: '09:00',
  finalDueDate: '2027-06-01', finalDueTime: '09:00', createdAt: stamp('2026-10-01'), updatedAt: stamp('2026-10-01'), ...over,
});
const payment = (amountCents, over = {}) => ({
  id: `p${++seq}`, debtId: 'd1', kind: 'extra', amountCents, date: '2026-11-01', time: '10:00', note: '', movementId: 'mx',
  createdAt: stamp('2026-11-01'), updatedAt: stamp('2026-11-01'), ...over,
});

/** @param {string[]} dates días con un ingreso */
const daysData = (dates, over = {}) => base({ movements: dates.map((d) => mv(d)), ...over });
const byId = (result, id) => result.achievements.find((a) => a.id === id);

// ------------------------------------------------------------------ semanas y rachas

test('weekStart: las semanas van de lunes a domingo', () => {
  assert.equal(weekStart('2026-11-09'), '2026-11-09'); // lunes
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // domingo
  assert.equal(weekStart('2026-11-08'), '2026-11-02'); // domingo anterior
  assert.equal(weekStart('2026-01-01'), '2025-12-29'); // cruza el año
  assert.equal(weekStart('2028-03-01'), '2028-02-28'); // año bisiesto
});

test('streakOf: racha actual y mejor racha', () => {
  const keys = new Set(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09']);
  const s = streakOf(keys, TODAY, addDays);
  assert.deepEqual(s, { current: 1, best: 3, activeNow: true, atRisk: false });
});

test('racha diaria: si hoy aún no registras pero ayer sí, sigue viva y queda «en riesgo»', () => {
  const s = streaks(daysData(['2026-11-06', '2026-11-07', '2026-11-08']), TODAY).daily;
  assert.deepEqual(s, { current: 3, best: 3, activeNow: false, atRisk: true });
});

test('racha diaria: registrar hoy la mantiene y la suma', () => {
  const s = streaks(daysData(['2026-11-07', '2026-11-08', '2026-11-09']), TODAY).daily;
  assert.deepEqual(s, { current: 3, best: 3, activeNow: true, atRisk: false });
});

test('racha diaria: un día vacío completo la rompe (anteayer no basta)', () => {
  const s = streaks(daysData(['2026-11-05', '2026-11-06', '2026-11-07']), TODAY).daily;
  assert.equal(s.current, 0);
  assert.equal(s.best, 3, 'la mejor racha se conserva');
  assert.equal(s.atRisk, false);
});

test('racha diaria: un hueco en medio deja solo la parte reciente', () => {
  const s = streaks(daysData(['2026-11-03', '2026-11-04', '2026-11-06', '2026-11-08']), TODAY).daily;
  assert.equal(s.current, 1);
  assert.equal(s.best, 2);
  assert.equal(s.atRisk, true);
});

test('racha diaria: cruza fin de mes, fin de año y el 29 de febrero', () => {
  assert.equal(streaks(daysData(['2026-12-30', '2026-12-31', '2027-01-01']), '2027-01-01').daily.current, 3);
  assert.equal(streaks(daysData(['2028-02-28', '2028-02-29', '2028-03-01']), '2028-03-01').daily.best, 3);
  assert.equal(streaks(daysData(['2027-02-28', '2027-03-01']), '2027-03-01').daily.best, 2, '2027 no es bisiesto: el 28 de febrero va seguido del 1 de marzo');
});

test('racha: sin registros todo es 0', () => {
  const s = streaks(base(), TODAY);
  assert.deepEqual(s.daily, { current: 0, best: 0, activeNow: false, atRisk: false });
  assert.deepEqual(s.weekly, { current: 0, best: 0, activeNow: false, atRisk: false });
  assert.deepEqual(s.monthly, { current: 0, best: 0, activeNow: false, atRisk: false });
  assert.equal(s.activeDays, 0);
  assert.equal(s.firstDate, null);
});

test('racha: varios movimientos el mismo día cuentan como un solo día', () => {
  const s = streaks(daysData(['2026-11-09', '2026-11-09', '2026-11-09']), TODAY);
  assert.equal(s.daily.current, 1);
  assert.equal(s.activeDays, 1);
  assert.equal(s.firstDate, '2026-11-09');
});

test('racha: los aportes a metas también cuentan como día con registro', () => {
  const data = base({ goals: [goal('g1', 500_000)], contributions: [dep('g1', 1000, '2026-11-08'), dep('g1', 1000, '2026-11-09')] });
  assert.equal(streaks(data, TODAY).daily.current, 2);
  assert.equal(activityDays(data, TODAY).size, 2);
});

test('racha: las fechas futuras no cuentan', () => {
  const data = daysData(['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.equal(streaks(data, TODAY).daily.current, 1);
  assert.equal(streaks(data, TODAY).activeDays, 1);
});

test('racha: un aporte a una meta con fecha futura tampoco cuenta', () => {
  const data = base({ goals: [goal('g1', 500_000)], contributions: [dep('g1', 1000, '2026-11-10'), dep('g1', 1000, '2026-12-01')] });
  assert.equal(activityDays(data, TODAY).size, 0);
  assert.equal(streaks(data, TODAY).daily.current, 0);
});

test('racha: los datos de demostración NO cuentan', () => {
  const data = base({
    movements: [mv('2026-11-07', 'income', 100, { isDemo: true }), mv('2026-11-08', 'income', 100, { isDemo: true }), mv('2026-11-09', 'expense', 100, { isDemo: true })],
    goals: [goal('g1', 500_000, { isDemo: true })],
    contributions: [dep('g1', 1000, '2026-11-06', { isDemo: true })],
  });
  const s = streaks(data, TODAY);
  assert.equal(s.daily.current, 0);
  assert.equal(s.daily.best, 0);
  assert.equal(s.activeDays, 0);
  assert.equal(activityDays(data, TODAY).size, 0);
});

test('racha: demostración mezclada con datos reales solo suma los reales', () => {
  const data = base({ movements: [mv('2026-11-09'), mv('2026-11-08', 'income', 100, { isDemo: true }), mv('2026-11-07', 'income', 100, { isDemo: true })] });
  assert.equal(streaks(data, TODAY).daily.current, 1);
});

test('racha semanal: semanas seguidas con al menos un día con registro', () => {
  // Semanas (lunes): 12-oct, 19-oct, [26-oct vacía], 2-nov; hoy es lunes 9-nov (semana sin registros todavía).
  const s = streaks(daysData(['2026-10-14', '2026-10-21', '2026-11-04']), TODAY).weekly;
  assert.equal(s.best, 2);
  assert.equal(s.current, 1, 'la semana pasada sí tuvo registro; la anterior no');
  assert.equal(s.atRisk, true, 'la semana de hoy aún está vacía');
  assert.equal(s.activeNow, false);
});

test('racha semanal: domingo y lunes pertenecen a semanas distintas', () => {
  const s = streaks(daysData(['2026-11-08', '2026-11-09']), TODAY).weekly;
  assert.equal(s.current, 2);
  assert.equal(s.best, 2);
  assert.equal(s.activeNow, true);
});

test('racha mensual: meses seguidos, también entre años', () => {
  const m = streaks(daysData(['2025-11-15', '2025-12-15', '2026-01-15']), '2026-01-20').monthly;
  assert.deepEqual(m, { current: 3, best: 3, activeNow: true, atRisk: false });
  const gap = streaks(daysData(['2026-07-10', '2026-08-10', '2026-10-10', '2026-11-02']), TODAY).monthly;
  assert.equal(gap.best, 2);
  assert.equal(gap.current, 2);
});

test('racha mensual: el mes pasado sin registros hoy → en riesgo', () => {
  const m = streaks(daysData(['2026-09-10', '2026-10-10']), TODAY).monthly;
  assert.deepEqual(m, { current: 2, best: 2, activeNow: false, atRisk: true });
});

// ------------------------------------------------------------------ datos reales

test('realData quita todo lo de demostración y no toca lo real ni modifica la entrada', () => {
  const input = base({
    movements: [mv('2026-11-01'), mv('2026-11-02', 'income', 1, { isDemo: true })],
    goals: [goal('g1', 100), goal('g2', 100, { isDemo: true })],
    clients: [{ id: 'c1', isDemo: true }, { id: 'c2' }],
    invoices: [{ id: 'i1', isDemo: true }],
  });
  const copy = structuredClone(input);
  const out = realData(input);
  assert.equal(out.movements.length, 1);
  assert.equal(out.goals.length, 1);
  assert.deepEqual(out.clients, [{ id: 'c2' }]);
  assert.equal(out.invoices.length, 0);
  assert.deepEqual(input, copy, 'no modifica los datos de entrada');
  assert.equal(demoRecordCount(input), 4);
});

// ------------------------------------------------------------------ logros

test('sin datos: ningún logro, 0 puntos, nivel «Principiante financiero»', () => {
  const g = gamification(base(), TODAY);
  assert.equal(g.doneCount, 0);
  assert.equal(g.points, 0);
  assert.equal(g.level.name, 'Principiante financiero');
  assert.equal(g.level.number, 1);
  assert.equal(g.hasReal, false);
  assert.equal(g.demoIgnored, 0);
  assert.deepEqual(g.nextUp, []);
});

test('solo demostración: 0 puntos y el aviso sabe cuántos registros se ignoraron', () => {
  const data = base({
    movements: Array.from({ length: 60 }, (_, i) => mv(addDays('2026-09-01', i), 'income', 100, { isDemo: true })),
    goals: [goal('g1', 100, { isDemo: true })],
  });
  const g = gamification(data, TODAY);
  assert.equal(g.points, 0);
  assert.equal(g.doneCount, 0);
  assert.equal(g.level.number, 1);
  assert.equal(g.hasReal, false);
  assert.equal(g.demoIgnored, 61);
});

test('demostración en TODAS las colecciones a la vez: ningún logro, 0 puntos', () => {
  const demo = { isDemo: true };
  const asset = { id: 'a1', name: 'Carro', category: 'vehicles', subtype: 'car', description: '', acquiredDate: '2026-03-10', valuations: [{ date: '2026-03-10', valueCents: 5_000_000 }], createdAt: stamp('2026-03-10'), updatedAt: stamp('2026-03-10'), ...demo };
  const data = base({
    movements: [mv('2026-10-01', 'income', 500, { clientId: 'c1', ...demo }), mv('2026-10-02', 'expense', 100, { clientId: 'c1', ...demo })],
    goals: [goal('g1', 1000, demo)], contributions: [dep('g1', 1000, '2026-10-03', demo)],
    debts: [debt(demo)], debtPayments: [payment(100_000, demo)], assets: [asset],
    clients: [{ id: 'c1', ...demo }], services: [{ id: 's1', status: 'done', ...demo }],
    products: [{ id: 'p1', ...demo }], suppliers: [{ id: 'su1', ...demo }], stockEntries: [{ id: 'e1', kind: 'sale', date: '2026-10-04', ...demo }],
    invoices: [{ id: 'i1', ...demo }], invoicePayments: [{ id: 'ip1', ...demo }], departments: [{ id: 'dp1', ...demo }],
  });
  const g = gamification(data, TODAY, { clients: true, inventory: true, invoices: true, departments: true });
  assert.equal(g.doneCount, 0, g.achievements.filter((a) => a.done).map((a) => a.id).join(', '));
  assert.equal(g.points, 0);
  assert.equal(g.level.number, 1);
  assert.equal(g.hasReal, false);
  assert.equal(g.demoIgnored, 15, "2 movimientos + 13 registros más, uno por colección");
  assert.deepEqual(g.nextUp, []);
});

test('movimientos: los umbrales 1, 10, 50, 200 y 1000; el avance nunca pasa de la meta', () => {
  const ten = gamification(daysData(Array.from({ length: 10 }, (_, i) => addDays('2026-10-01', i))), TODAY);
  assert.equal(byId(ten, 'reg-1').done, true);
  assert.equal(byId(ten, 'reg-10').done, true);
  assert.equal(byId(ten, 'reg-50').done, false);
  assert.equal(byId(ten, 'reg-50').current, 10);
  assert.equal(byId(ten, 'reg-1').current, 1, 'se muestra 1 de 1, no 10 de 1');
  const nine = gamification(daysData(Array.from({ length: 9 }, (_, i) => addDays('2026-10-01', i))), TODAY);
  assert.equal(byId(nine, 'reg-10').done, false);
  assert.equal(byId(nine, 'reg-10').current, 9);
});

test('lo que tiene fecha futura no cuenta para los logros (movimientos, aportes ni ventas)', () => {
  const nine = Array.from({ length: 9 }, (_, i) => addDays('2026-10-01', i));
  const g = gamification(daysData([...nine, '2026-11-10']), TODAY);
  assert.equal(byId(g, 'reg-10').current, 9, 'el movimiento de mañana no es el décimo');
  assert.equal(byId(g, 'reg-10').done, false);

  const future = gamification(base({
    goals: [goal('g1', 100_000)], contributions: [dep('g1', 100_000, '2026-11-10')],
    stockEntries: [{ id: 'e1', kind: 'sale', date: '2026-11-10' }],
  }), TODAY, { inventory: true });
  assert.equal(byId(future, 'goal-deposit').done, false);
  assert.equal(byId(future, 'sale-1').done, false);
});

test('categorías distintas: 5 categorías → «Todo en su lugar»', () => {
  const four = base({ movements: ['a', 'b', 'c', 'd'].map((c, i) => mv(`2026-10-0${i + 1}`, 'expense', 100, { categoryId: c })) });
  assert.equal(byId(gamification(four, TODAY), 'reg-cat-5').done, false);
  assert.equal(byId(gamification(four, TODAY), 'reg-cat-5').current, 4);
  const five = base({ movements: ['a', 'b', 'c', 'd', 'e', 'e'].map((c, i) => mv(`2026-10-0${i + 1}`, 'expense', 100, { categoryId: c })) });
  assert.equal(byId(gamification(five, TODAY), 'reg-cat-5').done, true);
});

test('logros de constancia usan la MEJOR racha: no se pierden al romperse la racha', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
  const g = gamification(daysData(dates), TODAY);
  assert.equal(g.streaks.daily.current, 0);
  assert.equal(byId(g, 'day-3').done, true);
  assert.equal(byId(g, 'day-7').done, true);
  assert.equal(byId(g, 'day-30').done, false);
  assert.equal(byId(g, 'day-30').current, 7);
});

test('logros semanales y mensuales de constancia', () => {
  // 4 semanas seguidas (lunes 5/12/19/26 de octubre) y 3 meses (sep, oct, nov).
  const g = gamification(daysData(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-09-20', '2026-11-02']), TODAY);
  assert.equal(g.streaks.weekly.best, 5, 'del 5 de octubre al 2 de noviembre son 5 semanas seguidas');
  assert.equal(byId(g, 'week-4').done, true);
  assert.equal(byId(g, 'week-12').done, false);
  assert.equal(byId(g, 'month-3').done, true);
  assert.equal(byId(g, 'month-6').done, false);
});

test('mes en positivo: solo meses ya cerrados, con ingresos mayores que gastos', () => {
  const data = base({
    movements: [
      mv('2026-08-05', 'income', 100_000), mv('2026-08-10', 'expense', 40_000), // agosto: +60,000 ✔
      mv('2026-09-05', 'income', 100_000), mv('2026-09-10', 'expense', 100_000), // septiembre: empate ✘
      mv('2026-10-05', 'expense', 5_000), // octubre: solo gastos ✘
      mv('2026-11-02', 'income', 900_000), // noviembre: mes en curso, no cuenta aunque va en positivo
    ],
  });
  const g = gamification(data, TODAY);
  assert.equal(byId(g, 'save-1').done, true);
  assert.equal(byId(g, 'save-1').current, 1);
  assert.equal(byId(g, 'save-3').current, 1);
  assert.equal(byId(g, 'save-3').done, false);
});

test('mes en positivo: los gastos de demostración no empujan el resultado', () => {
  const data = base({ movements: [mv('2026-08-05', 'income', 100_000), mv('2026-08-10', 'expense', 900_000, { isDemo: true })] });
  assert.equal(byId(gamification(data, TODAY), 'save-1').done, true);
});

test('metas: crear, aportar y cumplir (el retiro quita el cumplimiento)', () => {
  const none = gamification(base({ goals: [goal('g1', 100_000)] }), TODAY);
  assert.equal(byId(none, 'goal-1').done, true);
  assert.equal(byId(none, 'goal-deposit').done, false);
  assert.equal(byId(none, 'goal-done-1').done, false);

  const half = gamification(base({ goals: [goal('g1', 100_000)], contributions: [dep('g1', 50_000, '2026-11-01')] }), TODAY);
  assert.equal(byId(half, 'goal-deposit').done, true);
  assert.equal(byId(half, 'goal-done-1').done, false);

  const full = gamification(base({ goals: [goal('g1', 100_000)], contributions: [dep('g1', 100_000, '2026-11-01')] }), TODAY);
  assert.equal(byId(full, 'goal-done-1').done, true);

  const withdrawn = gamification(base({
    goals: [goal('g1', 100_000)],
    contributions: [dep('g1', 100_000, '2026-11-01'), dep('g1', 30_000, '2026-11-02', { kind: 'withdrawal' })],
  }), TODAY);
  assert.equal(byId(withdrawn, 'goal-done-1').done, false);
});

test('metas: un retiro suelto no es un aporte', () => {
  const g = gamification(base({ goals: [goal('g1', 100_000)], contributions: [dep('g1', 500, '2026-11-02', { kind: 'withdrawal' })] }), TODAY);
  assert.equal(byId(g, 'goal-deposit').done, false);
});

test('metas: tres metas cumplidas → «Cumplidor»; una meta de demostración cumplida no cuenta', () => {
  const goals = ['g1', 'g2', 'g3'].map((id) => goal(id, 1000));
  const contributions = ['g1', 'g2', 'g3'].map((id) => dep(id, 1000, '2026-11-01'));
  assert.equal(byId(gamification(base({ goals, contributions }), TODAY), 'goal-done-3').done, true);
  const demoGoals = goals.map((g) => ({ ...g, isDemo: true }));
  assert.equal(byId(gamification(base({ goals: demoGoals, contributions }), TODAY), 'goal-1').done, false);
  assert.equal(byId(gamification(base({ goals: [goals[0], ...demoGoals.slice(1)], contributions }), TODAY), 'goal-done-3').current, 1);
});

test('deudas: registrar, pagar y liquidar', () => {
  const only = gamification(base({ debts: [debt()] }), TODAY);
  assert.equal(byId(only, 'debt-1').done, true);
  assert.equal(byId(only, 'debt-pay').done, false);
  assert.equal(byId(only, 'debt-paid').done, false);

  const partial = gamification(base({ debts: [debt()], debtPayments: [payment(40_000)] }), TODAY);
  assert.equal(byId(partial, 'debt-pay').done, true);
  assert.equal(byId(partial, 'debt-paid').done, false);

  const paid = gamification(base({ debts: [debt()], debtPayments: [payment(100_000)] }), TODAY);
  assert.equal(byId(paid, 'debt-paid').done, true);
});

test('deudas: los pagos de otra deuda no liquidan esta', () => {
  const d1 = debt({ id: 'd1', totalCents: 100_000 });
  const d2 = debt({ id: 'd2', totalCents: 900_000 });
  const g = gamification(base({ debts: [d1, d2], debtPayments: [payment(100_000, { debtId: 'd2' })] }), TODAY);
  assert.equal(byId(g, 'debt-pay').done, true);
  assert.equal(byId(g, 'debt-paid').done, false, 'se pagó 100,000 de la deuda de 900,000, no la de 100,000');
  const both = gamification(base({ debts: [d1, d2], debtPayments: [payment(100_000, { debtId: 'd1' })] }), TODAY);
  assert.equal(byId(both, 'debt-paid').done, true);
});

test('deudas: pagos de demostración no liquidan una deuda real', () => {
  const g = gamification(base({ debts: [debt()], debtPayments: [payment(100_000, { isDemo: true })] }), TODAY);
  assert.equal(byId(g, 'debt-pay').done, false);
  assert.equal(byId(g, 'debt-paid').done, false);
});

test('patrimonio: exactamente cero no es positivo', () => {
  const g = gamification(base({ movements: [mv('2026-11-01', 'income', 50_000), mv('2026-11-02', 'expense', 50_000)] }), TODAY);
  assert.equal(byId(g, 'networth-pos').done, false);
  const one = gamification(base({ movements: [mv('2026-11-01', 'income', 50_000), mv('2026-11-02', 'expense', 49_999)] }), TODAY);
  assert.equal(byId(one, 'networth-pos').done, true);
});

test('patrimonio: activo registrado y patrimonio neto positivo (necesita algún registro)', () => {
  const asset = { id: 'a1', name: 'Carro', category: 'vehicles', subtype: 'car', description: '', acquiredDate: '2026-03-10', valuations: [{ date: '2026-03-10', valueCents: 5_000_000 }], createdAt: stamp('2026-03-10'), updatedAt: stamp('2026-03-10') };
  const g = gamification(base({ assets: [asset] }), TODAY);
  assert.equal(byId(g, 'asset-1').done, true);
  assert.equal(byId(g, 'networth-pos').done, true);

  const negative = gamification(base({ movements: [mv('2026-11-01', 'expense', 50_000)] }), TODAY);
  assert.equal(byId(negative, 'networth-pos').done, false);

  const openingOnly = gamification(base({ settings: { displayName: '', openingBalanceCents: 9_000_000 } }), TODAY);
  assert.equal(byId(openingOnly, 'networth-pos').done, false, 'un saldo inicial sin ningún registro no es un logro');

  const demoAsset = gamification(base({ assets: [{ ...asset, isDemo: true }] }), TODAY);
  assert.equal(byId(demoAsset, 'asset-1').done, false);
  assert.equal(byId(demoAsset, 'networth-pos').done, false);
});

test('clientes: los logros solo se ofrecen si el espacio usa clientes', () => {
  const data = base({
    clients: [{ id: 'c1', firstName: 'Ana' }, { id: 'c2', firstName: 'Beto' }],
    services: [{ id: 's1', status: 'done' }, { id: 's2', status: 'pending' }],
    movements: [mv('2026-11-01', 'income', 500, { clientId: 'c1' }), mv('2026-11-02', 'expense', 100, { clientId: 'c1' })],
  });
  assert.equal(byId(gamification(data, TODAY), 'client-1'), undefined);
  assert.equal(byId(gamification(data, TODAY, { clients: false }), 'client-1'), undefined);
  const g = gamification(data, TODAY, { clients: true });
  assert.equal(byId(g, 'client-1').done, true);
  assert.equal(byId(g, 'client-5').done, false);
  assert.equal(byId(g, 'client-5').current, 2);
  assert.equal(byId(g, 'client-paid').done, true);
  assert.equal(byId(g, 'client-cost').done, true);
  assert.equal(byId(g, 'service-done').done, true);
});

test('clientes: solo un servicio finalizado cuenta (no en proceso, pendiente ni cancelado)', () => {
  const services = ['pending', 'in_progress', 'cancelled'].map((status, i) => ({ id: `s${i}`, status }));
  assert.equal(byId(gamification(base({ services }), TODAY, { clients: true }), 'service-done').done, false);
  assert.equal(byId(gamification(base({ services: [...services, { id: 'sd', status: 'done' }] }), TODAY, { clients: true }), 'service-done').done, true);
});

test('clientes: un ingreso de cliente no es un gasto cargado, ni al revés', () => {
  const onlyIncome = gamification(base({ movements: [mv('2026-11-01', 'income', 500, { clientId: 'c1' })] }), TODAY, { clients: true });
  assert.equal(byId(onlyIncome, 'client-paid').done, true);
  assert.equal(byId(onlyIncome, 'client-cost').done, false);
});

test('clientes: ingreso y gasto sin cliente no cuentan; un gasto cargado no cuenta como cobro', () => {
  const data = base({ movements: [mv('2026-11-01', 'income', 500), mv('2026-11-02', 'expense', 100, { clientId: 'c1' })] });
  const g = gamification(data, TODAY, { clients: true });
  assert.equal(byId(g, 'client-paid').done, false);
  assert.equal(byId(g, 'client-cost').done, true);
});

test('negocio: productos, ventas, facturas (las anuladas no cuentan), cobros y departamentos', () => {
  const data = base({
    products: [{ id: 'p1' }],
    stockEntries: [{ id: 'e1', kind: 'purchase', date: '2026-11-01' }, { id: 'e2', kind: 'sale', date: '2026-11-02' }],
    invoices: [{ id: 'i1', voidedAt: '2026-11-03T10:00:00.000Z' }, { id: 'i2' }],
    invoicePayments: [{ id: 'ip1' }],
    departments: [{ id: 'dp1' }],
  });
  const all = { inventory: true, invoices: true, departments: true };
  const g = gamification(data, TODAY, all);
  for (const id of ['product-1', 'sale-1', 'invoice-1', 'invoice-paid', 'dept-1']) assert.equal(byId(g, id).done, true, id);

  const onlyVoided = gamification(base({ invoices: [{ id: 'i1', voidedAt: '2026-11-03T10:00:00.000Z' }] }), TODAY, all);
  assert.equal(byId(onlyVoided, 'invoice-1').done, false);

  const purchaseOnly = gamification(base({ stockEntries: [{ id: 'e1', kind: 'purchase', date: '2026-11-01' }] }), TODAY, all);
  assert.equal(byId(purchaseOnly, 'sale-1').done, false);
  const adjustmentOnly = gamification(base({ stockEntries: [{ id: 'e1', kind: 'adjustment', date: '2026-11-01' }] }), TODAY, all);
  assert.equal(byId(adjustmentOnly, 'sale-1').done, false, 'un ajuste de conteo no es una venta');

  assert.equal(byId(gamification(data, TODAY), 'product-1'), undefined, 'sin la función activa, no se ofrece');
  assert.equal(byId(gamification(data, TODAY, { inventory: true }), 'invoice-1'), undefined);
});

// ------------------------------------------------------------------ niveles y puntos

test('niveles: los límites exactos', () => {
  const names = LEVELS.map((l) => l.name);
  assert.deepEqual(names, ['Principiante financiero', 'Organizador', 'Ahorrador constante', 'Planificador', 'Estratega', 'Constructor de patrimonio']);
  assert.deepEqual(LEVELS.map((l) => l.min), [0, 30, 90, 180, 320, 500]);
  for (const [points, expected] of [[0, 0], [29, 0], [30, 1], [89, 1], [90, 2], [179, 2], [180, 3], [319, 3], [320, 4], [499, 4], [500, 5], [5000, 5]]) {
    assert.equal(levelFor(points).index, expected, `${points} puntos`);
  }
});

test('niveles: cuánto falta para el siguiente y el avance dentro del nivel', () => {
  const l = levelFor(45); // nivel 2 (30–89): lleva 15 de 60
  assert.equal(l.name, 'Organizador');
  assert.equal(l.number, 2);
  assert.equal(l.total, 6);
  assert.deepEqual(l.next, { name: 'Ahorrador constante', min: 90 });
  assert.equal(l.pointsToNext, 45);
  assert.equal(l.percentToNext, 25);
  assert.equal(levelFor(30).percentToNext, 0, 'recién subido: 0 % del tramo siguiente');
  assert.equal(levelFor(0).pointsToNext, 30);
});

test('nivel máximo: sin siguiente, 100 % y nada que sumar', () => {
  const l = levelFor(500);
  assert.equal(l.name, 'Constructor de patrimonio');
  assert.equal(l.next, null);
  assert.equal(l.pointsToNext, 0);
  assert.equal(l.percentToNext, 100);
});

test('los puntos son la suma de los logros obtenidos (10, 25 o 50 por logro)', () => {
  assert.deepEqual(TIER_POINTS, { bronze: 10, silver: 25, gold: 50 });
  const data = base({
    movements: Array.from({ length: 10 }, (_, i) => mv(addDays('2026-10-01', i))), // reg-1 + reg-10 (20) + day-3 (10) + day-7 (25)
    goals: [goal('g1', 1000)], // goal-1 (10)
  });
  const g = gamification(data, TODAY);
  const done = g.achievements.filter((a) => a.done).map((a) => a.id).sort();
  assert.deepEqual(done, ['day-3', 'day-7', 'goal-1', 'networth-pos', 'reg-1', 'reg-10', 'save-1'].sort(), 'octubre quedó cerrado en positivo y el patrimonio es positivo');
  const expected = g.achievements.filter((a) => a.done).reduce((s, a) => s + TIER_POINTS[a.tier], 0);
  assert.equal(g.points, expected);
  assert.equal(g.points, 10 + 10 + 10 + 25 + 10 + 10 + 10, 'reg-1, reg-10, day-3, day-7, goal-1, networth-pos, save-1');
  assert.equal(g.points, 85);
  assert.equal(g.level.name, 'Organizador', '85 puntos están entre 30 y 89');
  assert.equal(g.doneCount, 7);
});

test('catálogo de logros: ids únicos, metas ≥ 1, grupos conocidos', () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  for (const r of RULES) {
    assert.ok(r.target >= 1, r.id);
    assert.ok(r.tier in TIER_POINTS, r.id);
    assert.ok(r.group in GROUP_LABELS, r.id);
    assert.ok(r.title.length > 0 && r.text.length > 0, r.id);
  }
});

test('el nivel máximo es alcanzable en cualquier espacio (el más pobre en logros incluido)', () => {
  const top = LEVELS[LEVELS.length - 1].min;
  const personal = gamification(base(), TODAY);
  assert.ok(personal.maxPoints >= top, `Personal ofrece ${personal.maxPoints} puntos y el nivel máximo pide ${top}`);
  assert.ok(top <= personal.maxPoints * 0.75, 'el nivel máximo debe ser largo pero no exigir casi todo');
  const all = gamification(base(), TODAY, { clients: true, inventory: true, invoices: true, departments: true });
  assert.ok(all.maxPoints > personal.maxPoints);
  assert.equal(all.totalCount, RULES.length);
});

test('logros: «hecho» ⇔ el avance llega a la meta; el avance nunca la supera', () => {
  const data = daysData(Array.from({ length: 40 }, (_, i) => addDays('2026-09-20', i)));
  const g = gamification(data, TODAY, { clients: true, inventory: true, invoices: true, departments: true });
  for (const a of g.achievements) {
    assert.equal(a.done, a.current === a.target, a.id);
    assert.ok(a.current <= a.target, a.id);
    assert.equal(a.points, TIER_POINTS[a.tier], a.id);
  }
});

test('grupos: solo los que tienen logros, en el orden fijo, con su cuenta', () => {
  const personal = gamification(base(), TODAY);
  assert.deepEqual(personal.groups.map((g) => g.id), ['registro', 'constancia', 'ahorro', 'metas', 'deudas', 'patrimonio']);
  const freelancer = gamification(base(), TODAY, { clients: true });
  assert.deepEqual(freelancer.groups.map((g) => g.id), ['registro', 'constancia', 'ahorro', 'metas', 'deudas', 'patrimonio', 'clientes']);
  const g = gamification(daysData(['2026-11-09']), TODAY);
  const registro = g.groups.find((x) => x.id === 'registro');
  assert.equal(registro?.total, 6);
  assert.equal(registro?.done, 1);
  assert.equal(g.groups.reduce((s, x) => s + x.total, 0), g.totalCount);
  assert.equal(g.groups.reduce((s, x) => s + x.done, 0), g.doneCount);
});

test('«lo siguiente»: los pendientes más avanzados primero, máximo 3, sin los que están en cero', () => {
  const data = base({
    movements: Array.from({ length: 40 }, (_, i) => mv(addDays('2026-08-01', i * 2), 'expense', 100, { categoryId: `c${i % 3}` })),
  });
  const g = gamification(data, TODAY);
  assert.ok(g.nextUp.length <= 3);
  assert.ok(g.nextUp.every((a) => !a.done && a.current > 0));
  const ratios = g.nextUp.map((a) => a.current / a.target);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => b - a));
  assert.equal(g.nextUp[0].id, 'reg-50', '40 de 50 es el más avanzado');
});

test('gamification no modifica los datos de entrada y da el mismo resultado dos veces', () => {
  const data = base({
    movements: [mv('2026-11-01'), mv('2026-10-01', 'expense', 100, { isDemo: true })],
    goals: [goal('g1', 1000)], contributions: [dep('g1', 1000, '2026-11-02')], debts: [debt()], debtPayments: [payment(1000)],
  });
  const copy = structuredClone(data);
  const first = gamification(data, TODAY, { clients: true });
  assert.deepEqual(data, copy);
  assert.deepEqual(gamification(data, TODAY, { clients: true }), first);
});

test('streakText: singular y plural', () => {
  assert.equal(streakText(1, 'day'), '1 día');
  assert.equal(streakText(5, 'day'), '5 días');
  assert.equal(streakText(1, 'week'), '1 semana');
  assert.equal(streakText(2, 'week'), '2 semanas');
  assert.equal(streakText(1, 'month'), '1 mes');
  assert.equal(streakText(0, 'month'), '0 meses');
});

test('addMonths sigue siendo la base de la racha mensual (diciembre → enero)', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});
