import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { goalFeasibility, personalDiagnosis } from '../src/domain/diagnosis.js';
import {
  diagnosisBaselineText, diagnosisCards, diagnosisPriorities, diagnosisSummaryText, feasibilityText,
} from '../src/domain/diagnosisCards.js';

// Mismas cifras que en diagnosis.test.js: hoy = 20 de julio de 2026 y el «mes típico» sale de junio.
const today = '2026-07-20';
let n = 0;
/** @param {'income'|'expense'} type @param {string} date @param {number} pesos */
const mv = (type, date, pesos) => ({
  id: `m${n++}`, type, amountCents: pesos * 100, date, time: '10:00', description: 'x',
  classification: /** @type {const} */ ('variable'), categoryId: type === 'income' ? 'cat-inc-salario' : 'cat-exp-otros', createdAt: '', updatedAt: '',
});
/** @param {Partial<import('../src/domain/types.js').AppData>} over @returns {import('../src/domain/types.js').AppData} */
const data = (over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 },
  movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], ...over,
});
const june = (/** @type {number} */ income, /** @type {number} */ expense) => [mv('income', '2026-06-05', income), mv('expense', '2026-06-10', expense)];
/** @param {string} id @param {number} pesos @param {string} targetDate @param {Partial<import('../src/domain/types.js').Goal>} over */
const goal = (id, pesos, targetDate, over = {}) => ({
  id, name: `Meta ${id}`, description: '', targetCents: pesos * 100, targetDate,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', ...over,
});
const debt = (/** @type {Partial<import('../src/domain/types.js').Debt>} */ over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 12_000_00, rateBp: 0, rateBasis: /** @type {const} */ ('annual'), frequency: /** @type {const} */ ('monthly'),
  collateralKind: /** @type {const} */ ('personal'), collateralType: 'prestamo-personal',
  firstDueDate: '2026-07-25', firstDueTime: '09:00', finalDueDate: '2027-06-25', finalDueTime: '09:00',
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...over,
});

/** @param {ReturnType<typeof diagnosisCards>} cards @param {string} id */
const card = (cards, id) => /** @type {NonNullable<ReturnType<typeof diagnosisCards>[number]>} */ (cards.find((c) => c.id === id));

/** Un caso con todos los indicadores a la vista. */
const full = () => data({
  movements: june(100_000, 85_000),
  debts: [debt({ firstDueDate: '2026-06-25', finalDueDate: '2027-05-25' })],
  goals: [goal('a', 20_000, '2026-08-10'), goal('b', 20_000, '2026-08-15')],
});

test('una tarjeta por indicador, en el mismo orden y con el nivel en palabras', () => {
  const d = personalDiagnosis(full(), today);
  const cards = diagnosisCards(d);
  assert.deepEqual(cards.map((c) => c.id), d.indicators.map((i) => i.id));
  const labels = { good: 'Bien', watch: 'Atención', risk: 'Riesgo', unknown: 'Sin datos' };
  for (const [k, c] of cards.entries()) assert.equal(c.levelLabel, labels[d.indicators[k].level]);
});

test('ningún texto muestra «undefined», «NaN» ni «null», en ningún caso', () => {
  const casos = [
    data(),
    data({ movements: [mv('income', '2026-06-05', 50_000)] }),
    data({ movements: [mv('expense', '2026-06-05', 5_000)], debts: [debt()], goals: [goal('a', 1_000, '2026-08-10')] }),
    data({ movements: june(100_000, 120_000), debts: [debt({ totalCents: 600_000_00 })], goals: [goal('a', 9_000, '2026-07-20'), goal('b', 9_000, '2026-07-01')] }),
    data({ movements: [mv('income', '2026-07-05', 30_000), mv('expense', '2026-07-06', 6_000)] }),
    data({ goals: [goal('a', 1_000, '2026-08-10')] }),
    full(),
  ];
  for (const c of casos) {
    const d = personalDiagnosis(c, today);
    const texts = [
      diagnosisBaselineText(d), diagnosisSummaryText(d),
      ...diagnosisCards(d).flatMap((x) => [x.title, x.levelLabel, x.value, x.text, x.hint, x.rule, ...x.details.flatMap((r) => [r.label, r.value])]),
      ...diagnosisPriorities(d).map((p) => p.text),
      ...d.feasibility.goals.map((g) => feasibilityText(g, d.capacityCents).text),
    ];
    for (const t of texts) assert.doesNotMatch(t, /undefined|NaN|null|\[object/, t);
  }
});

test('tasa de ahorro: dice las cifras del mes típico y lo que falta para «Bien»', () => {
  const d = personalDiagnosis(data({ movements: june(100_000, 85_000) }), today);
  const c = card(diagnosisCards(d), 'savings');
  assert.equal(c.value, '15%');
  assert.equal(c.level, 'watch');
  assert.match(c.text, /entran RD\$ 100,000\.00 y salen RD\$ 85,000\.00 en gastos/);
  assert.match(c.text, /Te quedan RD\$ 15,000\.00 al mes: el 15% de tu ingreso/);
  assert.match(c.hint, /20% de tu ingreso, RD\$ 20,000\.00 al mes\) te faltan RD\$ 5,000\.00 al mes/);
  assert.equal(c.rule, '20% o más de tu ingreso = Bien; entre 10% y 20% = Atención; menos de 10% = Riesgo.');
  assert.deepEqual(c.details.map((r) => r.value), ['RD$ 100,000.00', 'RD$ 85,000.00', 'RD$ 0.00', '+RD$ 15,000.00']);
  assert.deepEqual(c.link, { route: 'finanzas', label: 'Ver mis finanzas' });
});

test('tasa de ahorro: cuando gastas más de lo que ganas lo dice así y no hay «llegaste»', () => {
  const c = card(diagnosisCards(personalDiagnosis(data({ movements: june(100_000, 120_000) }), today)), 'savings');
  assert.equal(c.value, '-20%');
  assert.match(c.text, /Gastas RD\$ 20,000\.00 más de lo que entra cada mes/);
  assert.match(c.hint, /te faltan RD\$ 40,000\.00 al mes/);
});

test('cuando ya está «Bien» no hay nada que corregir: la sugerencia queda vacía', () => {
  const d = personalDiagnosis(data({ movements: june(100_000, 50_000) }), today);
  assert.equal(card(diagnosisCards(d), 'savings').hint, '');
});

test('sin datos: todas las tarjetas lo dicen con palabras y sin cifras inventadas', () => {
  const d = personalDiagnosis(data(), today);
  const cards = diagnosisCards(d);
  assert.equal(cards.length, 2);
  for (const c of cards) {
    assert.equal(c.levelLabel, 'Sin datos');
    assert.equal(c.value, '—');
    assert.match(c.text, /Todavía no hay datos suficientes/);
  }
  assert.equal(diagnosisSummaryText(d), 'Todavía no hay datos para hacer el diagnóstico.');
  assert.deepEqual(diagnosisPriorities(d), []);
  assert.equal(diagnosisBaselineText(d), 'Aún no hay movimientos para calcular un mes típico.');
});

test('colchón de emergencia: explica qué cuenta, el hueco y cuánto tardarías en cerrarlo', () => {
  // Disponible 20,000 (80,000 − 60,000 apartados); sale 20,000 al mes → 1 mes. Capacidad 80,000 al mes.
  const d = personalDiagnosis(data({
    movements: june(100_000, 20_000), goals: [goal('g', 100_000, '2027-12-31')],
    contributions: [{ id: 'c1', goalId: 'g', kind: 'deposit', amountCents: 6_000_000, date: '2026-07-01', time: '09:00', note: '', createdAt: '', updatedAt: '' }],
  }), today);
  const c = card(diagnosisCards(d), 'emergency');
  assert.equal(c.value, '1.0 mes');
  assert.match(c.text, /cubriría 1\.0 mes de lo que sale cada mes \(RD\$ 20,000\.00/);
  assert.match(c.text, /No cuenta lo que tienes apartado en metas ni tus activos/);
  assert.match(c.hint, /6 meses = RD\$ 120,000\.00\) te faltan RD\$ 100,000\.00/);
  assert.match(c.hint, /tardarías 1\.3 meses/);
});

test('colchón de emergencia: sin capacidad de ahorro dice que primero hay que liberar dinero', () => {
  const d = personalDiagnosis(data({ movements: june(20_000, 20_000) }), today);
  const c = card(diagnosisCards(d), 'emergency');
  assert.match(c.hint, /primero hay que liberar dinero cada mes/);
  assert.doesNotMatch(c.hint, /tardarías/);
});

test('peso de las deudas y cuotas vencidas: nombran la deuda y lo que habría que bajar', () => {
  const d = personalDiagnosis(data({
    movements: june(100_000, 10_000),
    debts: [debt({ totalCents: 360_000_00, firstDueDate: '2026-06-25', finalDueDate: '2027-05-25' })], // cuota 30,000 = 30 %
  }), today);
  const cards = diagnosisCards(d);
  const load = card(cards, 'debtLoad');
  assert.equal(load.value, '30%');
  assert.equal(load.level, 'watch');
  assert.match(load.text, /pagas RD\$ 30,000\.00 al mes: el 30% de tu ingreso/);
  assert.match(load.hint, /deberían bajar RD\$ 10,000\.00 al mes/);
  const late = card(cards, 'lateDebts');
  assert.equal(late.value, '1');
  assert.match(late.text, /1 cuota vencida sin pagar en Préstamo/);
  assert.ok(late.hint.length > 0);

  const alDia = card(diagnosisCards(personalDiagnosis(data({ movements: june(100_000, 10_000), debts: [debt()] }), today)), 'lateDebts');
  assert.deepEqual([alDia.value, alDia.hint], ['Ninguna', '']);
  assert.match(alDia.text, /al día/);
});

test('metas: cuenta cuántas caben y reparte el hueco; las demás cifras salen del detalle', () => {
  const d = personalDiagnosis(data({
    movements: june(50_000, 20_000), goals: [goal('a', 20_000, '2026-08-10'), goal('b', 20_000, '2026-08-15')],
  }), today);
  const c = card(diagnosisCards(d), 'goals');
  assert.equal(c.value, '1 de 2');
  assert.match(c.text, /1 de tus 2 metas pendientes va al ritmo o cabe en tu capacidad de ahorro \(RD\$ 30,000\.00 al mes/);
  assert.match(c.hint, /piden aportar RD\$ 40,000\.00 al mes y tu capacidad de ahorro es RD\$ 30,000\.00: faltan RD\$ 10,000\.00 al mes/);
  assert.deepEqual(Object.fromEntries(c.details.map((r) => [r.label, r.value])), {
    'Van al ritmo': '0', 'Viables con tu capacidad': '1', 'Ajustadas (llegarías más tarde)': '1', 'No alcanzan': '0', Vencidas: '0',
    'Sin datos para evaluarlas': '0', 'Piden aportar al mes': 'RD$ 40,000.00', 'Tu capacidad de ahorro al mes': 'RD$ 30,000.00',
  });
});

test('metas: con una sola meta el texto va en singular, y sin datos no se inventan cifras', () => {
  const una = card(diagnosisCards(personalDiagnosis(data({ movements: june(50_000, 20_000), goals: [goal('a', 1_000, '2026-08-10')] }), today)), 'goals');
  assert.match(una.text, /^Tu única meta pendiente va al ritmo o cabe en tu capacidad de ahorro/);
  const ninguna = card(diagnosisCards(personalDiagnosis(data({ movements: june(20_000, 25_000), goals: [goal('a', 1_000, '2026-08-10')] }), today)), 'goals');
  assert.match(ninguna.text, /^Tu única meta pendiente no va al ritmo ni cabe/);
  const dos = card(diagnosisCards(personalDiagnosis(data({ movements: june(20_000, 25_000), goals: [goal('a', 1_000, '2026-08-10'), goal('b', 1_000, '2026-08-11')] }), today)), 'goals');
  assert.match(dos.text, /^Ninguna de tus 2 metas pendientes va al ritmo ni cabe/);
  const varias = card(diagnosisCards(personalDiagnosis(data({ movements: june(100_000, 10_000), goals: [goal('a', 1_000, '2026-08-10'), goal('b', 1_000, '2026-08-11'), goal('c', 1_000, '2026-07-01')] }), today)), 'goals');
  assert.match(varias.text, /^2 de tus 3 metas pendientes van al ritmo o caben/);
  const sin = card(diagnosisCards(personalDiagnosis(data({ goals: [goal('a', 1_000, '2026-08-10')] }), today)), 'goals');
  assert.equal(sin.value, '—');
  assert.match(sin.text, /todavía no hay un mes con movimientos/);
  assert.equal(sin.hint, '');
});

test('patrimonio neto: positivo, cero y negativo se dicen distinto', () => {
  const pos = card(diagnosisCards(personalDiagnosis(data({ movements: june(100_000, 20_000) }), today)), 'netWorth');
  assert.equal(pos.value, 'RD$ 80,000.00');
  assert.match(pos.text, /te quedan RD\$ 80,000\.00/);
  assert.equal(pos.hint, '');

  const cero = card(diagnosisCards(personalDiagnosis(data({ movements: [mv('income', '2026-06-05', 100), mv('expense', '2026-06-06', 100)] }), today)), 'netWorth');
  assert.match(cero.text, /es justo lo que debes/);
  assert.ok(cero.hint.length > 0);

  const neg = card(diagnosisCards(personalDiagnosis(data({ movements: june(10_000, 5_000), debts: [debt()] }), today)), 'netWorth');
  assert.match(neg.text, /debes RD\$ 7,000\.00 más de lo que tienes/);
  assert.match(neg.hint, /bajar deudas o sumar dinero y activos/);
});

test('el resumen cuenta los niveles y las prioridades dejan fuera lo que está «Bien» o «Sin datos»', () => {
  const d = personalDiagnosis(full(), today);
  assert.equal(diagnosisSummaryText(d), [
    d.counts.risk && `${d.counts.risk} en riesgo`, d.counts.watch && `${d.counts.watch} en atención`,
    d.counts.good && `${d.counts.good} bien`, d.counts.unknown && `${d.counts.unknown} sin datos`,
  ].filter(Boolean).join(' · '));
  const prios = diagnosisPriorities(d);
  assert.deepEqual(prios.map((p) => p.id), d.priorities.filter((i) => i.level === 'risk' || i.level === 'watch').map((i) => i.id));
  for (const p of prios) assert.ok(['Riesgo', 'Atención'].includes(p.levelLabel));
  // El texto de una prioridad es lo que falta para «Bien» (no la descripción larga).
  assert.match(prios[0].text, /^Para llegar a «Bien»|^Registra|^Tienes|^Las metas/);

  const ok = personalDiagnosis(data({ movements: june(100_000, 50_000), settings: { displayName: '', openingBalanceCents: 100_000_000 } }), today);
  assert.equal(ok.counts.good, ok.indicators.length);
  assert.deepEqual(diagnosisPriorities(ok), []);
});

test('el texto del mes típico distingue mes parcial, un mes y varios meses', () => {
  assert.match(diagnosisBaselineText({ hasData: true, partial: true, months: 1 }), /parciales/);
  assert.equal(diagnosisBaselineText({ hasData: true, partial: false, months: 1 }), 'Mes típico: tu último mes completo con movimientos.');
  assert.equal(diagnosisBaselineText({ hasData: true, partial: false, months: 3 }), 'Mes típico: el promedio de tus últimos 3 meses completos con movimientos.');
});

// ---------------------------------------------------------------------------
// Viabilidad de cada meta
// ---------------------------------------------------------------------------

test('viabilidad por meta: cada estado se explica con sus números', () => {
  // Capacidad 30,000; tres metas de menos de un mes (necesitan todo lo que les falta).
  const d = data({
    movements: june(50_000, 20_000),
    goals: [goal('a', 20_000, '2026-08-10'), goal('b', 20_000, '2026-08-15'), goal('c', 5_000, '2026-08-18'), goal('late', 7_000, '2026-07-01'), goal('hoy', 7_000, today)],
  });
  const f = goalFeasibility(d, today);
  const by = Object.fromEntries(f.goals.map((g) => [g.goal.id, feasibilityText(g, f.capacityCents)]));
  assert.equal(by.a.label, 'Viable');
  assert.match(by.a.text, /Necesitas aportar RD\$ 20,000\.00 al mes y tu capacidad de ahorro lo cubre \(le tocan RD\$ 20,000\.00/);
  assert.equal(by.b.label, 'Ajustada');
  assert.match(by.b.text, /solo le tocan RD\$ 10,000\.00.*llegarías hacia el 19 sep 2026, no el 15 ago 2026\. Para llegar a tiempo faltan RD\$ 10,000\.00 al mes/);
  assert.equal(by.c.label, 'No alcanza');
  assert.match(by.c.text, /tu capacidad de ahorro ya se va en metas que vencen antes\. Para llegar a tiempo faltan RD\$ 5,000\.00 al mes/);
  assert.equal(by.late.label, 'Vencida');
  assert.match(by.late.text, /La fecha objetivo pasó y aún faltan RD\$ 7,000\.00/);
  assert.match(by.hoy.text, /La fecha objetivo es hoy y aún faltan RD\$ 7,000\.00/);
});

test('viabilidad por meta: «Va al ritmo», sin dinero que sobre y sin datos', () => {
  const ritmo = goalFeasibility(data({
    movements: june(50_000, 20_000), goals: [goal('g', 6_000, '2026-10-20', { createdAt: '2026-05-01T00:00:00.000Z' })],
    contributions: [{ id: 'c1', goalId: 'g', kind: 'deposit', amountCents: 300_000, date: '2026-07-10', time: '09:00', note: '', createdAt: '', updatedAt: '' }],
  }), today);
  const r = feasibilityText(ritmo.goals[0], ritmo.capacityCents);
  assert.equal(r.label, 'Va al ritmo');
  assert.match(r.text, /Con lo que aportas hoy \(RD\$ 1,500\.00 al mes\) la completarías hacia el 19 sep 2026/);

  const sinSobrante = goalFeasibility(data({ movements: june(20_000, 25_000), goals: [goal('g', 5_000, '2026-08-10')] }), today);
  assert.match(feasibilityText(sinSobrante.goals[0], sinSobrante.capacityCents).text, /hoy no te sobra dinero cada mes\. Para llegar a tiempo faltan RD\$ 5,000\.00 al mes/);

  const sinDatos = goalFeasibility(data({ goals: [goal('g', 5_000, '2026-08-10')] }), today);
  const s = feasibilityText(sinDatos.goals[0], sinDatos.capacityCents);
  assert.equal(s.label, 'Sin datos');
  assert.match(s.text, /no hay un mes con movimientos/);
});

test('viabilidad por meta: con RD$ 1 al mes y una meta enorme dice que tardaría más de 100 años', () => {
  const f = goalFeasibility(data({ movements: [{ ...mv('income', '2026-06-05', 0), amountCents: 2_000_100 }, mv('expense', '2026-06-10', 20_000)], goals: [goal('g', 5_000, '2026-08-10')] }), today);
  assert.equal(f.goals[0].status, 'unreachable');
  assert.match(feasibilityText(f.goals[0], f.capacityCents).text, /Con los RD\$ 1\.00 al mes que le tocan tardarías más de 100 años/);
});

test('casos justos: capacidad exactamente 0, dos cuotas vencidas, capacidad negativa en el hueco de metas y un solo centavo', () => {
  // Capacidad 0: «Te quedan RD$ 0.00», no «Gastas … más».
  const cero = card(diagnosisCards(personalDiagnosis(data({ movements: june(20_000, 20_000) }), today)), 'savings');
  assert.match(cero.text, /Te quedan RD\$ 0\.00 al mes: el 0% de tu ingreso/);
  assert.doesNotMatch(cero.text, /Gastas/);

  // Dos cuotas vencidas (de mayo y junio): plural.
  const dos = personalDiagnosis(data({
    movements: june(100_000, 10_000), debts: [debt({ firstDueDate: '2026-05-25', finalDueDate: '2027-04-25' })],
  }), today);
  assert.match(card(diagnosisCards(dos), 'lateDebts').text, /Tienes 2 cuotas vencidas sin pagar en Préstamo/);

  // Capacidad negativa: el hueco de las metas se mide contra 0, no contra una cifra negativa.
  const neg = card(diagnosisCards(personalDiagnosis(data({ movements: june(20_000, 25_000), goals: [goal('a', 5_000, '2026-08-10')] }), today)), 'goals');
  assert.match(neg.hint, /tu capacidad de ahorro es RD\$ 0\.00: faltan RD\$ 5,000\.00 al mes/);

  // Un solo centavo al mes también es «le toca algo» (no «no le toca nada»).
  const unCentavo = goalFeasibility(data({
    movements: [{ ...mv('income', '2026-06-05', 0), amountCents: 2_000_001 }, mv('expense', '2026-06-10', 20_000)],
    goals: [{ ...goal('a', 0, '2026-08-10'), targetCents: 1_201 }],
  }), today);
  assert.equal(unCentavo.goals[0].allocatedCents, 1);
  assert.match(feasibilityText(unCentavo.goals[0], unCentavo.capacityCents).text, /Con los RD\$ 0\.01 al mes que le tocan tardarías más de 100 años/);
});
