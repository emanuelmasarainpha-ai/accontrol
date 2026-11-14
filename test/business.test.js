// Pruebas del módulo Emprendedor (domain/business.js): estado de resultados, comparación, acumulado, veredicto,
// proyección, avisos y categorías sugeridas. Cifras calculadas a mano; hoy = 2026-11-15.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_CATEGORY_SUGGESTIONS, EXPENSE_JUMP, MIN_PROJECTION_MONTHS, PROJECTION_HORIZON, PROJECTION_WINDOW, VERDICT_MONTHS,
  accumulatedProfit, businessNotices, businessVerdict, incomeStatement, missingBusinessCategories, monthlyResults,
  periodBounds, periodComparison, projectResults, resultsEnabled, shiftPeriod,
} from '../src/domain/business.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildBusinessDemo } from '../src/domain/demo.js';

const NOW = '2026-11-15T10:00:00.000Z';
const TODAY = '2026-11-15';
let seq = 0;
const mv = (type, date, amountCents, over = {}) => ({
  id: `m${++seq}`, type, amountCents, date, time: '10:00', description: 'x', classification: 'variable',
  categoryId: type === 'income' ? 'cat-inc-ventas' : 'cat-exp-otros', createdAt: NOW, updatedAt: NOW, ...over,
});
const inc = (date, cents, over) => mv('income', date, cents, over);
const exp = (date, cents, over) => mv('expense', date, cents, over);
/** @returns {any} */
const dataOf = (movements, extra = {}) => ({ categories: defaultCategories(), movements, debtPayments: [], ...extra });

// Escenario (RD$ en centavos; todo calculado a mano):
//   nov-2025: ingresó 1,000 gastó 600            (hace un año)
//   may..oct-2026: ingresos 2,000 / 3,000 / 4,000 / 5,000 / 6,000 / 7,000
//                  gastos   1,500 / 2,000 / 2,500 / 3,000 / 3,500 / 4,000  (en octubre, 400 son un pago de deuda)
//   nov-2026 (mes en curso, hasta el 15): ingresó 1,000 y gastó 500; además un ingreso fechado el 20 (aún no pasa)
function scenario() {
  const debtExpense = exp('2026-10-12', 40000, { categoryId: 'cat-exp-deudas' });
  const movements = [
    inc('2025-11-10', 100000), exp('2025-11-11', 60000),
    inc('2026-05-10', 200000), exp('2026-05-11', 150000),
    inc('2026-06-10', 300000), exp('2026-06-11', 200000),
    inc('2026-07-10', 400000), exp('2026-07-11', 250000),
    inc('2026-08-10', 500000), exp('2026-08-11', 300000),
    inc('2026-09-10', 600000), exp('2026-09-11', 350000),
    inc('2026-10-10', 700000), exp('2026-10-11', 360000), debtExpense,
    inc('2026-11-10', 100000), exp('2026-11-12', 50000),
    inc('2026-11-20', 99999900, { categoryId: 'cat-inc-otros' }), // futuro: no cuenta todavía
  ];
  return dataOf(movements, { debtPayments: [{ id: 'p1', debtId: 'd1', kind: 'regular', amountCents: 40000, date: '2026-10-12', time: '10:00', note: '', movementId: debtExpense.id, createdAt: NOW, updatedAt: NOW }] });
}

test('resultsEnabled: solo Emprendedor y Empresa', () => {
  assert.equal(resultsEnabled('entrepreneur'), true);
  assert.equal(resultsEnabled('company'), true);
  assert.equal(resultsEnabled('personal'), false);
  assert.equal(resultsEnabled('freelancer'), false);
  assert.equal(resultsEnabled(null), false);
  assert.equal(resultsEnabled(undefined), false);
});

test('periodBounds: mes, trimestre y año con sus etiquetas', () => {
  const m = periodBounds('month', '2026-11');
  assert.deepEqual([m.key, m.label, m.firstMonth, m.lastMonth, m.months], ['2026-11', 'noviembre 2026', '2026-11', '2026-11', 1]);
  const q = periodBounds('quarter', '2026-08');
  assert.deepEqual([q.key, q.firstMonth, q.lastMonth, q.months], ['2026-T3', '2026-07', '2026-09', 3]);
  assert.equal(q.label, 'T3 2026 (julio–septiembre)');
  const q4 = periodBounds('quarter', '2026-12');
  assert.deepEqual([q4.key, q4.firstMonth, q4.lastMonth], ['2026-T4', '2026-10', '2026-12']);
  const y = periodBounds('year', '2026-03');
  assert.deepEqual([y.key, y.label, y.firstMonth, y.lastMonth, y.months], ['2026', '2026', '2026-01', '2026-12', 12]);
});

test('shiftPeriod: hacia atrás y cruzando el año', () => {
  assert.equal(shiftPeriod(periodBounds('month', '2026-01'), -1).key, '2025-12');
  assert.equal(shiftPeriod(periodBounds('quarter', '2026-02'), -3).key, '2025-T4');
  assert.equal(shiftPeriod(periodBounds('month', '2026-11'), -12).key, '2025-11');
  assert.equal(shiftPeriod(periodBounds('year', '2026-06'), -12).key, '2025');
});

test('incomeStatement: octubre completo con pago de deuda separado', () => {
  const s = incomeStatement(scenario(), periodBounds('month', '2026-10'), TODAY);
  assert.equal(s.incomeCents, 700000);
  assert.equal(s.expenseCents, 400000);
  assert.equal(s.netCents, 300000);
  assert.ok(Math.abs((s.marginPercent ?? 0) - 42.857142857) < 1e-6);
  assert.equal(s.profitabilityPercent, 75);
  assert.equal(s.debtPaymentsCents, 40000);
  assert.equal(s.netBeforeDebtCents, 340000);
  assert.equal(s.partial, false);
  assert.equal(s.hasData, true);
  assert.deepEqual([s.incomeCount, s.expenseCount], [1, 2]);
  assert.deepEqual(s.expenseByCategory.map((r) => [r.categoryId, r.cents]), [['cat-exp-otros', 360000], ['cat-exp-deudas', 40000]]);
  assert.equal(s.expenseByCategory[0].name, 'Otros gastos');
  assert.equal(s.expenseByCategory[0].percent, 90);
  assert.deepEqual(s.incomeByCategory.map((r) => [r.name, r.cents, r.percent]), [['Ventas', 700000, 100]]);
});

test('incomeStatement: el mes en curso solo cuenta hasta hoy y se marca como a medias', () => {
  const s = incomeStatement(scenario(), periodBounds('month', '2026-11'), TODAY);
  assert.equal(s.incomeCents, 100000); // el ingreso del día 20 todavía no pasó
  assert.equal(s.expenseCents, 50000);
  assert.equal(s.netCents, 50000);
  assert.equal(s.partial, true);
  assert.equal(s.marginPercent, 50);
});

test('incomeStatement: trimestre y año', () => {
  const t3 = incomeStatement(scenario(), periodBounds('quarter', '2026-08'), TODAY); // jul, ago, sep
  assert.equal(t3.incomeCents, 1500000);
  assert.equal(t3.expenseCents, 900000);
  assert.equal(t3.netCents, 600000);
  assert.equal(t3.partial, false);
});

test('incomeStatement: año 2026 = may..oct + noviembre hasta hoy', () => {
  // ingresos: 2,000+3,000+4,000+5,000+6,000+7,000 = 27,000 → 2,700,000 c; + nov 100,000
  // gastos: 1,500+2,000+2,500+3,000+3,500+4,000 = 16,500 → 1,650,000 c; + nov 50,000
  const y = incomeStatement(scenario(), periodBounds('year', '2026-01'), TODAY);
  assert.equal(y.incomeCents, 2800000);
  assert.equal(y.expenseCents, 1700000);
  assert.equal(y.netCents, 1100000);
  assert.equal(y.partial, true);
});

test('incomeStatement: sin ingresos no hay margen, sin gastos no hay rentabilidad, sin datos hasData es false', () => {
  const onlyExpense = incomeStatement(dataOf([exp('2026-11-02', 5000)]), periodBounds('month', '2026-11'), TODAY);
  assert.equal(onlyExpense.marginPercent, null);
  assert.equal(onlyExpense.profitabilityPercent, -100);
  assert.equal(onlyExpense.netCents, -5000);
  const onlyIncome = incomeStatement(dataOf([inc('2026-11-02', 5000)]), periodBounds('month', '2026-11'), TODAY);
  assert.equal(onlyIncome.profitabilityPercent, null);
  assert.equal(onlyIncome.marginPercent, 100);
  const empty = incomeStatement(dataOf([]), periodBounds('month', '2026-11'), TODAY);
  assert.equal(empty.hasData, false);
  assert.equal(empty.marginPercent, null);
  assert.equal(empty.netCents, 0);
  assert.deepEqual(empty.incomeByCategory, []);
});

test('incomeStatement: las categorías salen de mayor a menor y, si empatan, por nombre', () => {
  const data = dataOf([
    exp('2026-11-02', 1000, { categoryId: 'cat-exp-agua' }),
    exp('2026-11-03', 5000, { categoryId: 'cat-exp-alquiler' }),
    exp('2026-11-04', 1000, { categoryId: 'cat-exp-alimentacion' }),
  ]);
  const rows = incomeStatement(data, periodBounds('month', '2026-11'), TODAY).expenseByCategory;
  assert.deepEqual(rows.map((r) => r.name), ['Alquiler', 'Agua', 'Alimentación']); // empate Agua / Alimentación → alfabético
});

test('incomeStatement: categoría desconocida sale como «Sin categoría»', () => {
  const s = incomeStatement(dataOf([inc('2026-11-02', 5000, { categoryId: 'ya-no-existe' })]), periodBounds('month', '2026-11'), TODAY);
  assert.equal(s.incomeByCategory[0].name, 'Sin categoría');
});

test('periodComparison (mes): noviembre contra octubre y contra noviembre del año anterior', () => {
  const c = periodComparison(scenario(), 'month', '2026-11', TODAY);
  assert.equal(c.current.netCents, 50000);
  // vs octubre (ingresos 700,000; gastos 400,000; neto 300,000)
  assert.deepEqual(c.previous.income, { diffCents: -600000, percent: ((100000 - 700000) / 700000) * 100 });
  assert.equal(c.previous.expense.diffCents, -350000);
  assert.equal(c.previous.net.diffCents, -250000);
  assert.ok(Math.abs((c.previous.net.percent ?? 0) - (-250000 / 300000) * 100) < 1e-9);
  // margen: 50 % ahora vs 42.857 % en octubre
  assert.ok(Math.abs((c.previous.marginPoints ?? 0) - (50 - (300000 / 700000) * 100)) < 1e-9);
  // vs noviembre de 2025 (ingresó 100,000; gastó 60,000; neto 40,000; margen 40 %)
  assert.ok(c.yearAgo);
  assert.equal(c.yearAgo.statement.period.key, '2025-11');
  assert.deepEqual(c.yearAgo.income, { diffCents: 0, percent: 0 });
  assert.equal(c.yearAgo.expense.diffCents, -10000);
  assert.ok(Math.abs((c.yearAgo.expense.percent ?? 0) - (-10000 / 60000) * 100) < 1e-9);
  assert.deepEqual(c.yearAgo.net, { diffCents: 10000, percent: 25 });
  assert.equal(c.yearAgo.marginPoints, 10);
});

test('periodComparison: sin base de comparación el porcentaje es null (pero la diferencia se muestra)', () => {
  const c = periodComparison(scenario(), 'month', '2026-05', TODAY); // abril 2026 no tiene registros
  assert.equal(c.previous.statement.hasData, false);
  assert.equal(c.previous.income.percent, null);
  assert.equal(c.previous.income.diffCents, 200000);
  assert.equal(c.previous.marginPoints, null);
});

test('periodComparison: un neto anterior negativo no da porcentaje', () => {
  const data = dataOf([exp('2026-10-05', 5000), inc('2026-11-05', 9000)]);
  const c = periodComparison(data, 'month', '2026-11', TODAY);
  assert.equal(c.previous.net.diffCents, 14000);
  assert.equal(c.previous.net.percent, null);
});

test('periodComparison (año): no repite el año anterior como «mismo período del año anterior»', () => {
  const c = periodComparison(scenario(), 'year', '2026-06', TODAY);
  assert.equal(c.yearAgo, null);
  assert.equal(c.previous.statement.period.key, '2025');
  assert.equal(c.previous.statement.incomeCents, 100000);
});

test('periodComparison (trimestre): T4 contra T3 y contra T4 del año anterior', () => {
  const c = periodComparison(scenario(), 'quarter', '2026-11', TODAY);
  assert.equal(c.current.period.key, '2026-T4');
  assert.equal(c.current.incomeCents, 800000); // octubre 700,000 + noviembre hasta hoy 100,000
  assert.equal(c.previous.statement.period.key, '2026-T3');
  assert.equal(c.previous.statement.incomeCents, 1500000);
  assert.equal(c.yearAgo?.statement.period.key, '2025-T4');
  assert.equal(c.yearAgo?.statement.incomeCents, 100000);
});

test('monthlyResults: seis meses terminando en el actual', () => {
  const r = monthlyResults(scenario(), TODAY);
  assert.deepEqual(r.map((x) => x.key), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(r.map((x) => x.netCents), [100000, 150000, 200000, 250000, 300000, 50000]);
  assert.equal(r[0].marginPercent, (100000 / 300000) * 100);
  const gap = monthlyResults(dataOf([inc('2026-09-01', 1000)]), TODAY, 3); // sept, oct, nov
  assert.deepEqual(gap.map((x) => x.hasData), [true, false, false]);
  assert.equal(gap[1].marginPercent, null);
});

test('accumulatedProfit: año en curso y desde el primer registro', () => {
  const a = accumulatedProfit(scenario(), TODAY);
  assert.equal(a.year, '2026');
  assert.equal(a.yearToDateCents, 1100000); // 50k+100k+150k+200k+250k+300k + 50k de noviembre
  assert.equal(a.sinceStartCents, 1140000); // + 40k de noviembre de 2025
  assert.equal(a.firstMonth, '2025-11');
  const none = accumulatedProfit(dataOf([]), TODAY);
  assert.deepEqual(none, { year: '2026', yearToDateCents: 0, sinceStartCents: 0, firstMonth: null });
});

test('projectResults: tendencia lineal exacta de los últimos 6 meses completos', () => {
  const p = projectResults(scenario(), TODAY);
  assert.ok(p.ok);
  assert.deepEqual(p.basisMonths, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(p.months.map((m) => m.key), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(p.months.map((m) => m.current), [true, false, false]);
  assert.deepEqual(p.months.map((m) => m.incomeCents), [800000, 900000, 1000000]); // +100,000 por mes
  assert.deepEqual(p.months.map((m) => m.expenseCents), [450000, 500000, 550000]); // +50,000 por mes
  assert.deepEqual(p.months.map((m) => m.netCents), [350000, 400000, 450000]);
  assert.deepEqual(p.months.map((m) => [m.netLowCents, m.netHighCents]), [[350000, 350000], [400000, 400000], [450000, 450000]]); // ajuste perfecto: sin variación
  assert.deepEqual(p.totals, { incomeCents: 2700000, expenseCents: 1500000, netCents: 1200000 });
  assert.equal(p.incomeSlopeCents, 100000);
  assert.equal(p.expenseSlopeCents, 50000);
  assert.equal(p.lowConfidence, false);
  assert.deepEqual(p.reasons, []);
});

test('projectResults: el rango usa la variación típica de los resultados', () => {
  // 4 meses completos (jul..oct) con neto 1,000,000 / 2,000,000 / 1,500,000 / 2,500,000: recta 1,150,000 + 400,000·x; sd = √(45/2)·100,000
  const data = dataOf([inc('2026-07-05', 1000000), inc('2026-08-05', 2000000), inc('2026-09-05', 1500000), inc('2026-10-05', 2500000)]);
  const p = projectResults(data, TODAY);
  assert.ok(p.ok);
  assert.equal(p.months[0].netCents, 2750000);
  assert.equal(p.months[0].netLowCents, 2275658);
  assert.equal(p.months[0].netHighCents, 3224342);
  assert.equal(p.months[2].netCents, 3550000); // x = 6
  assert.equal(p.lowConfidence, true); // solo 4 meses de historia
  assert.equal(p.reasons.length, 1);
  assert.match(p.reasons[0], /4 meses/);
});

test('projectResults: resultados muy cambiantes avisan y los meses sin registros cuentan como 0', () => {
  const data = dataOf([inc('2026-07-05', 1000000), inc('2026-08-05', 100000), inc('2026-09-05', 1000000), inc('2026-10-05', 100000)]);
  const p = projectResults(data, TODAY);
  assert.ok(p.ok);
  assert.ok(p.reasons.some((r) => /cambian mucho/.test(r)));
  // un mes vacío en medio entra como 0 (no se salta): jul 300,000 / ago sin registros / sep 600,000 / oct 900,000
  // media 450,000; sxy = 1,200,000; sxx = 5 → pendiente 240,000; ordenada 90,000; en x = 4 → 1,050,000
  // (si se saltara agosto saldrían 1,200,000)
  const withGap = projectResults(dataOf([inc('2026-07-05', 300000), inc('2026-09-05', 600000), inc('2026-10-05', 900000)]), TODAY);
  assert.ok(withGap.ok);
  assert.deepEqual(withGap.basisMonths, ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(withGap.months[0].incomeCents, 1050000);
});

test('projectResults: nunca proyecta valores negativos', () => {
  const data = dataOf([inc('2026-08-05', 300000), inc('2026-09-05', 200000), inc('2026-10-05', 100000)]);
  const p = projectResults(data, TODAY);
  assert.ok(p.ok);
  assert.deepEqual(p.months.map((m) => m.incomeCents), [0, 0, 0]); // 0, -100,000, -200,000 → se corta en 0
  assert.deepEqual(p.months.map((m) => m.expenseCents), [0, 0, 0]);
  assert.equal(p.months[0].netCents, 0);
});

test('projectResults: sin historia suficiente explica por qué en vez de inventar cifras', () => {
  assert.deepEqual(projectResults(dataOf([]), TODAY), { ok: false, reason: 'no-data', haveMonths: 0, needMonths: MIN_PROJECTION_MONTHS });
  // solo el mes en curso: ningún mes completo
  const onlyNow = projectResults(dataOf([inc('2026-11-02', 1000)]), TODAY);
  assert.deepEqual(onlyNow, { ok: false, reason: 'few-months', haveMonths: 0, needMonths: 3 });
  // dos meses completos
  const two = projectResults(dataOf([inc('2026-09-02', 1000), inc('2026-10-02', 2000)]), TODAY);
  assert.deepEqual(two, { ok: false, reason: 'few-months', haveMonths: 2, needMonths: 3 });
  // tres meses completos ya alcanzan
  assert.equal(projectResults(dataOf([inc('2026-08-02', 1000), inc('2026-09-02', 2000), inc('2026-10-02', 3000)]), TODAY).ok, true);
  // lo fechado a futuro no cuenta como historia
  assert.equal(projectResults(dataOf([inc('2026-09-02', 1000), inc('2026-10-02', 2000), inc('2027-01-02', 3000)]), TODAY).ok, false);
});

test('constantes del módulo', () => {
  assert.equal(PROJECTION_WINDOW, 6);
  assert.equal(PROJECTION_HORIZON, 3);
  assert.equal(VERDICT_MONTHS, 3);
  assert.equal(EXPENSE_JUMP, 0.3);
});

test('businessVerdict: valor, mixto, solo movimiento y sin datos suficientes', () => {
  const value = businessVerdict(scenario(), TODAY);
  assert.equal(value?.state, 'value');
  assert.deepEqual(value?.months.map((m) => m.key), ['2026-08', '2026-09', '2026-10']);
  assert.equal(value?.profitableMonths, 3);
  assert.match(value?.text ?? '', /cada uno de los últimos 3 meses/);

  const mixed = businessVerdict(dataOf([inc('2026-08-02', 5000), exp('2026-08-03', 9000), inc('2026-09-02', 9000), exp('2026-09-03', 5000), inc('2026-10-02', 9000), exp('2026-10-03', 5000)]), TODAY);
  assert.equal(mixed?.state, 'mixed');
  assert.equal(mixed?.profitableMonths, 2);
  assert.match(mixed?.text ?? '', /2 de los últimos 3/);

  const movement = businessVerdict(dataOf([inc('2026-09-02', 5000), exp('2026-09-03', 5000), inc('2026-10-02', 8000), exp('2026-10-03', 9000)]), TODAY);
  assert.equal(movement?.state, 'movement'); // empate (neto 0) tampoco es beneficio
  assert.equal(movement?.months.length, 2);
  assert.match(movement?.text ?? '', /movimiento de dinero, no beneficio/);

  assert.equal(businessVerdict(dataOf([inc('2026-10-02', 5000)]), TODAY), null); // un solo mes completo
  assert.equal(businessVerdict(dataOf([exp('2026-09-02', 5000), exp('2026-10-02', 5000)]), TODAY), null); // nunca hubo ingresos
  assert.equal(businessVerdict(dataOf([]), TODAY), null);
});

test('businessNotices: dos meses seguidos con pérdida es un aviso crítico', () => {
  const data = dataOf([inc('2026-09-02', 5000), exp('2026-09-03', 9000), inc('2026-10-02', 2000), exp('2026-10-03', 7000)]);
  const n = businessNotices(data, TODAY);
  const loss = n.find((x) => x.id === 'business-loss-streak');
  assert.ok(loss);
  assert.equal(loss.level, 'critical');
  assert.match(loss.text, /septiembre y octubre/);
  assert.match(loss.text, /RD\$ 40\.00 y RD\$ 50\.00/);
  // un mes en cero (ni gana ni pierde) tampoco cuenta como pérdida
  const zero = dataOf([inc('2026-09-02', 5000), exp('2026-09-03', 5000), inc('2026-10-02', 2000), exp('2026-10-03', 7000)]);
  assert.ok(!businessNotices(zero, TODAY).some((x) => x.id === 'business-loss-streak'));
  // una sola pérdida no alcanza
  const once = dataOf([inc('2026-09-02', 9000), exp('2026-09-03', 5000), inc('2026-10-02', 2000), exp('2026-10-03', 7000)]);
  assert.ok(!businessNotices(once, TODAY).some((x) => x.id === 'business-loss-streak'));
  // el mes en curso a medias no cuenta
  const current = dataOf([inc('2026-10-02', 9000), exp('2026-10-03', 5000), exp('2026-11-02', 9000)]);
  assert.deepEqual(businessNotices(current, TODAY), []);
});

test('businessNotices: gastos que suben 30 % o más y más que los ingresos', () => {
  const up = dataOf([inc('2026-09-02', 10000), exp('2026-09-03', 5000), inc('2026-10-02', 11000), exp('2026-10-03', 6500)]);
  const notice = businessNotices(up, TODAY).find((x) => x.id === 'business-expenses-up');
  assert.ok(notice);
  assert.equal(notice.level, 'info');
  assert.match(notice.text, /subieron 30 %/);
  assert.match(notice.text, /septiembre/);
  // 29 % no avisa
  const almost = dataOf([inc('2026-09-02', 10000), exp('2026-09-03', 10000), inc('2026-10-02', 10000), exp('2026-10-03', 12900)]);
  assert.ok(!businessNotices(almost, TODAY).some((x) => x.id === 'business-expenses-up'));
  // si los ingresos crecieron más que los gastos, no avisa
  const healthy = dataOf([inc('2026-09-02', 10000), exp('2026-09-03', 5000), inc('2026-10-02', 30000), exp('2026-10-03', 7000)]);
  assert.ok(!businessNotices(healthy, TODAY).some((x) => x.id === 'business-expenses-up'));
  // sin gastos el mes anterior no hay base
  const noBase = dataOf([inc('2026-09-02', 10000), inc('2026-10-02', 10000), exp('2026-10-03', 5000)]);
  assert.ok(!businessNotices(noBase, TODAY).some((x) => x.id === 'business-expenses-up'));
});

test('businessNotices: el escenario sano no genera avisos', () => {
  assert.deepEqual(businessNotices(scenario(), TODAY), []);
});

test('missingBusinessCategories: nombre y tipo, sin importar mayúsculas ni espacios', () => {
  const all = missingBusinessCategories(defaultCategories());
  assert.equal(all.length, BUSINESS_CATEGORY_SUGGESTIONS.length);
  const own = [
    ...defaultCategories(),
    { id: 'u1', name: '  marketing   Y publicidad ', kind: 'expense', defaultClassification: 'variable', builtIn: false },
    { id: 'u2', name: 'Servicios prestados', kind: 'expense', defaultClassification: 'variable', builtIn: false }, // otro tipo: no cuenta
  ];
  const missing = missingBusinessCategories(own).map((s) => s.name);
  assert.ok(!missing.includes('Marketing y publicidad'));
  assert.ok(missing.includes('Servicios prestados')); // existe, pero como gasto
  assert.equal(missing.length, BUSINESS_CATEGORY_SUGGESTIONS.length - 1);
});

test('categorías sugeridas: sin repetidos y con tipos válidos', () => {
  const names = BUSINESS_CATEGORY_SUGGESTIONS.map((s) => `${s.kind}:${s.name.toLocaleLowerCase('es')}`);
  assert.equal(new Set(names).size, names.length);
  assert.ok(BUSINESS_CATEGORY_SUGGESTIONS.every((s) => s.kind === 'income' || s.kind === 'expense'));
  const builtIn = new Set(defaultCategories().map((c) => `${c.kind}:${c.name.toLocaleLowerCase('es')}`));
  assert.ok(names.every((n) => !builtIn.has(n)), 'no repiten las categorías de fábrica');
});

// ---- Demostración de negocio ---------------------------------------------------------------------------------------

for (const today of ['2026-11-15', '2026-11-01', '2026-03-31', '2028-02-29', '2027-01-01', '2026-12-31']) {
  test(`demostración de negocio coherente (hoy = ${today})`, () => {
    const demo = buildBusinessDemo(today, NOW);
    assert.ok(demo.length > 0);
    assert.ok(demo.every((m) => m.isDemo === true && m.description.includes('demostración')));
    assert.ok(demo.every((m) => m.date <= today), 'fecha futura');
    assert.ok(demo.every((m) => Number.isInteger(m.amountCents) && m.amountCents > 0));
    assert.equal(new Set(demo.map((m) => m.id)).size, demo.length);
    const known = new Set(defaultCategories().map((c) => c.id));
    assert.ok(demo.every((m) => known.has(m.categoryId)), 'categoría de fábrica que no existe');
    const kinds = new Map(defaultCategories().map((c) => [c.id, c.kind]));
    assert.ok(demo.every((m) => kinds.get(m.categoryId) === m.type), 'tipo de categoría distinto al del movimiento');
  });
}

test('demostración de negocio: cifras calculadas a mano (hoy = 2026-11-15)', () => {
  const data = dataOf(buildBusinessDemo(TODAY, NOW));
  const monthly = monthlyResults(data, TODAY, 8);
  // abril (el más antiguo) ... noviembre (en curso): ventas 60,000 + 7,000 por mes, con un mes flojo (agosto: -15,000)
  assert.equal(monthly[0].key, '2026-04');
  assert.equal(monthly[0].incomeCents, 6000000);
  assert.equal(monthly[0].netCents, -170000); // 60,000 - 61,700: el primer mes termina en pérdida
  assert.equal(monthly[1].netCents, 264000); // mayo: 67,000 - 64,360
  assert.equal(monthly[4].incomeCents, 7300000); // agosto: el mes flojo (73,000)
  assert.equal(monthly[4].netCents, 636000);
  const oct = monthly[6]; // octubre: ventas 60,000 + 7,000·6 = 102,000; gastos 38,900 fijos + 38 % de 102,000 (38,760) = 77,660
  assert.equal(oct.incomeCents, 10200000);
  assert.equal(oct.expenseCents, 7766000);
  assert.equal(oct.netCents, 2434000);
  // el veredicto y la proyección tienen datos de sobra
  assert.equal(businessVerdict(data, TODAY)?.state, 'value');
  assert.equal(projectResults(data, TODAY).ok, true);
  assert.deepEqual(businessNotices(data, TODAY), []);
});
