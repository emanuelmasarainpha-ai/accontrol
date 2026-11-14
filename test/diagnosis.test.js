import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import {
  DIAGNOSIS_THRESHOLDS, FEASIBILITY_LABELS, INDICATOR_ORDER, diagnosisEnabled, goalFeasibility, personalDiagnosis,
} from '../src/domain/diagnosis.js';
import { buildBudget } from '../src/domain/budget.js';
import { HEALTH_THRESHOLDS } from '../src/domain/company.js';

// Todas las cifras están calculadas a mano. Hoy = 20 de julio de 2026; el «mes típico» sale de junio.
const today = '2026-07-20';
let n = 0;

/** @param {'income'|'expense'} type @param {string} date @param {number} pesos */
const mv = (type, date, pesos, id = `m${n++}`) => ({
  id, type, amountCents: pesos * 100, date, time: '10:00', description: 'x',
  classification: /** @type {const} */ ('variable'), categoryId: type === 'income' ? 'cat-inc-salario' : 'cat-exp-otros', createdAt: '', updatedAt: '',
});

/** @param {Partial<import('../src/domain/types.js').AppData>} over @returns {import('../src/domain/types.js').AppData} */
const data = (over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 },
  movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], ...over,
});

/** Junio con ingreso y gasto dados (en pesos): define el mes típico. */
const june = (income, expense) => [mv('income', '2026-06-05', income), mv('expense', '2026-06-10', expense)];

/** @param {string} id @param {number} pesos @param {string} targetDate @param {Partial<import('../src/domain/types.js').Goal>} over */
const goal = (id, pesos, targetDate, over = {}) => ({
  id, name: `Meta ${id}`, description: '', targetCents: pesos * 100, targetDate,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', ...over,
});

/** @param {string} goalId @param {number} pesos @param {string} date @param {'deposit'|'withdrawal'} kind */
const contrib = (goalId, pesos, date, kind = 'deposit') => ({
  id: `c${n++}`, goalId, kind, amountCents: pesos * 100, date, time: '09:00', note: '',
  createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`,
});

/** Préstamo a 0 % con 12 cuotas mensuales iguales: la cuota mensual es total / 12. @param {Partial<import('../src/domain/types.js').Debt>} over */
const debt = (over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 120_000_00, rateBp: 0, rateBasis: /** @type {const} */ ('annual'), frequency: /** @type {const} */ ('monthly'),
  collateralKind: /** @type {const} */ ('personal'), collateralType: 'prestamo-personal',
  firstDueDate: '2026-07-25', firstDueTime: '09:00', finalDueDate: '2027-06-25', finalDueTime: '09:00',
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...over,
});

/** @param {ReturnType<typeof personalDiagnosis>} d @param {string} id */
const ind = (d, id) => d.indicators.find((i) => i.id === id);

// ---------------------------------------------------------------------------
// Cortes y textos básicos
// ---------------------------------------------------------------------------

test('los cortes son los del documento: ahorro 20/10, colchón 6/3 meses y deudas 20/35 (los mismos de Empresa)', () => {
  assert.deepEqual(DIAGNOSIS_THRESHOLDS.savings, { good: 20, watch: 10 });
  assert.deepEqual(DIAGNOSIS_THRESHOLDS.emergency, { good: 6, watch: 3 });
  assert.deepEqual(DIAGNOSIS_THRESHOLDS.debtService, HEALTH_THRESHOLDS.debtService);
});

test('la pantalla de diagnóstico existe en todos los espacios menos Empresa (que tiene Salud financiera)', () => {
  assert.equal(diagnosisEnabled('company'), false);
  for (const kind of ['personal', 'freelancer', 'entrepreneur', 'family', null, undefined]) assert.equal(diagnosisEnabled(/** @type {any} */ (kind)), true, String(kind));
});

test('cada estado de viabilidad tiene su texto', () => {
  assert.deepEqual(Object.keys(FEASIBILITY_LABELS).sort(), ['on-track', 'overdue', 'tight', 'unknown', 'unreachable', 'viable']);
  for (const label of Object.values(FEASIBILITY_LABELS)) assert.ok(label.length > 0);
});

// ---------------------------------------------------------------------------
// Viabilidad de metas
// ---------------------------------------------------------------------------

test('una sola capacidad de ahorro se reparte por fecha: viable, ajustada y no alcanza', () => {
  // Capacidad: 50,000 − 20,000 = 30,000. Las tres metas vencen en menos de un mes, así que cada una necesita TODO lo que le falta.
  const d = data({
    movements: june(50_000, 20_000),
    goals: [
      goal('c', 5_000, '2026-08-18'), // la última en fecha
      goal('a', 20_000, '2026-08-10'),
      goal('b', 20_000, '2026-08-15'),
    ],
  });
  const f = goalFeasibility(d, today);
  assert.equal(f.capacityCents, 3_000_000);
  assert.deepEqual(f.goals.map((g) => g.goal.id), ['a', 'b', 'c'], 'ordenadas por fecha, no por el orden en que se guardaron');
  const [a, b, c] = f.goals;
  assert.deepEqual([a.status, a.neededCents, a.allocatedCents, a.extraMonthlyCents, a.suggestedDate], ['viable', 2_000_000, 2_000_000, 0, null]);
  // A b le quedan 10,000 de los 20,000 que necesita: tarda el doble (2 meses = 61 días) → 19 de septiembre.
  assert.deepEqual([b.status, b.neededCents, b.allocatedCents, b.extraMonthlyCents, b.suggestedDate], ['tight', 2_000_000, 1_000_000, 1_000_000, '2026-09-19']);
  // Ya no queda nada para c.
  assert.deepEqual([c.status, c.neededCents, c.allocatedCents, c.extraMonthlyCents, c.suggestedDate], ['unreachable', 500_000, 0, 500_000, null]);
  assert.deepEqual(f.counts, { 'on-track': 0, viable: 1, tight: 1, unreachable: 1, overdue: 0, unknown: 0 });
  assert.equal(f.totalNeededCents, 4_500_000);
  assert.equal(f.shortfallCents, 1_500_000, 'piden 45,000 y la capacidad es 30,000');
});

test('el desempate a igual fecha es por creación y luego por id (el orden es siempre el mismo)', () => {
  const d = data({
    movements: june(50_000, 20_000),
    goals: [
      goal('z', 20_000, '2026-08-10', { createdAt: '2026-07-02T00:00:00.000Z' }),
      goal('y', 20_000, '2026-08-10', { createdAt: '2026-07-01T00:00:00.000Z' }),
      goal('x', 20_000, '2026-08-10', { createdAt: '2026-07-02T00:00:00.000Z' }),
    ],
  });
  assert.deepEqual(goalFeasibility(d, today).goals.map((g) => g.goal.id), ['y', 'x', 'z']);
});

test('una meta cumplida no entra; una vencida (o que vence hoy) no consume capacidad', () => {
  const d = data({
    movements: june(50_000, 20_000),
    goals: [
      goal('done', 1_000, '2026-08-10'),
      goal('late', 9_000, '2026-07-01'),
      goal('today', 9_000, today),
      goal('ok', 20_000, '2026-08-10'),
    ],
    contributions: [contrib('done', 1_000, '2026-07-02')],
  });
  const f = goalFeasibility(d, today);
  assert.deepEqual(f.goals.map((g) => g.goal.id), ['late', 'today', 'ok'], 'la cumplida no aparece');
  const [late, due, ok] = f.goals;
  assert.deepEqual([late.status, late.neededCents, late.allocatedCents, late.extraMonthlyCents], ['overdue', 0, 0, null]);
  assert.equal(due.status, 'overdue', 'cuando la fecha es hoy ya no hay aporte mensual que calcular');
  assert.deepEqual([ok.status, ok.allocatedCents], ['viable', 2_000_000], 'la vencida no le quitó nada de la capacidad');
  assert.equal(f.counts.overdue, 2);
  assert.equal(f.totalNeededCents, 2_000_000);
});

test('«Va al ritmo» cuando lo que ya aportas alcanza a tiempo, y aun así gasta capacidad', () => {
  // Creada el 1 de mayo; aportó 3,000 el 10 de julio → 2 meses de historia → 1,500 al mes. Faltan 3,000 → 2 meses (61 días) → 19 de septiembre, antes del 20 de octubre.
  const d = data({
    movements: june(50_000, 20_000),
    goals: [goal('g', 6_000, '2026-10-20', { createdAt: '2026-05-01T00:00:00.000Z' })],
    contributions: [contrib('g', 3_000, '2026-07-10')],
  });
  const [g] = goalFeasibility(d, today).goals;
  assert.equal(g.status, 'on-track');
  assert.equal(g.paceCents, 150_000);
  assert.equal(g.paceDate, '2026-09-19');
  assert.equal(g.neededCents, 99_300, 'faltan 3,000 en 92 días (3,02 meses): 993 al mes, redondeado al peso hacia arriba');
  assert.equal(g.allocatedCents, 99_300);
  assert.equal(g.extraMonthlyCents, 0);
});

test('«Va al ritmo» también sin datos para estimar la capacidad; lo demás queda «Sin datos»', () => {
  const d = data({
    goals: [
      goal('g', 6_000, '2026-10-20', { createdAt: '2026-05-01T00:00:00.000Z' }),
      goal('h', 9_000, '2026-12-20'),
    ],
    contributions: [contrib('g', 3_000, '2026-07-10')],
  });
  const f = goalFeasibility(d, today);
  assert.equal(f.capacityCents, null);
  assert.deepEqual(f.goals.map((g) => g.status), ['on-track', 'unknown']);
  const h = f.goals[1];
  assert.deepEqual([h.allocatedCents, h.extraMonthlyCents, h.suggestedDate], [0, null, null], 'sin datos no se inventa ningún faltante');
  assert.equal(f.shortfallCents, 0);
});

test('capacidad negativa o cero: ninguna meta que no va al ritmo cabe', () => {
  const gastaMas = data({ movements: june(20_000, 25_000), goals: [goal('g', 5_000, '2026-08-10')] });
  const f = goalFeasibility(gastaMas, today);
  assert.equal(f.capacityCents, -500_000);
  assert.deepEqual([f.goals[0].status, f.goals[0].allocatedCents, f.goals[0].extraMonthlyCents], ['unreachable', 0, 500_000]);
  assert.equal(f.shortfallCents, 500_000, 'el faltante se mide contra una capacidad de 0, no contra una negativa');

  const exacto = data({ movements: june(20_000, 20_000), goals: [goal('g', 5_000, '2026-08-10')] });
  assert.equal(goalFeasibility(exacto, today).goals[0].status, 'unreachable');
});

test('una meta que cabe justo con lo que le toca es «Viable» (no «Ajustada»)', () => {
  const d = data({ movements: june(30_000, 10_000), goals: [goal('g', 20_000, '2026-08-10')] }); // capacidad 20,000 = lo que necesita
  const [g] = goalFeasibility(d, today).goals;
  assert.deepEqual([g.status, g.allocatedCents, g.neededCents], ['viable', 2_000_000, 2_000_000]);
  const un_peso_menos = data({ movements: june(30_000, 10_001), goals: [goal('g', 20_000, '2026-08-10')] });
  assert.equal(goalFeasibility(un_peso_menos, today).goals[0].status, 'tight');
});

test('la fecha sugerida usa lo que FALTA, no el aporte mensual, y se redondea hacia arriba', () => {
  // Capacidad 5,000. Meta de 15,000 en menos de un mes: 15,000 ÷ 5,000 = 3 meses = 91,31 días → 92 → 20 de octubre.
  const redondeo = data({ movements: june(25_000, 20_000), goals: [goal('g', 15_000, '2026-08-10')] });
  assert.equal(goalFeasibility(redondeo, today).goals[0].suggestedDate, '2026-10-20');

  // Meta de 12,000 para el 20 de octubre (3,02 meses): necesita 3,971 al mes pero solo le tocan 2,000.
  // Faltan 12,000 → 6 meses = 182,6 días → 183 → 19 de enero de 2027 (con el aporte mensual daría 61 días: otra fecha).
  const largo = data({ movements: june(22_000, 20_000), goals: [goal('g', 12_000, '2026-10-20')] });
  const [g] = goalFeasibility(largo, today).goals;
  assert.deepEqual([g.status, g.neededCents, g.allocatedCents, g.suggestedDate], ['tight', 397_100, 200_000, '2027-01-19']);
});

test('una meta ajustada puede recibir hasta un solo centavo; si tardaría más de 100 años ya es «No alcanza»', () => {
  /** @param {number} sobranCents @param {number} metaCents */
  const caso = (sobranCents, metaCents) => {
    const d = data({
      movements: [
        { ...mv('income', '2026-06-05', 0), amountCents: 2_000_000 + sobranCents },
        mv('expense', '2026-06-10', 20_000),
      ],
      goals: [{ ...goal('g', 0, '2026-08-10'), targetCents: metaCents }],
    });
    return goalFeasibility(d, today).goals[0];
  };
  const unCentavo = caso(1, 1_200);
  assert.deepEqual([unCentavo.status, unCentavo.allocatedCents], ['tight', 1], '1.200 meses (100 años) todavía se da');
  const demasiado = caso(1, 1_201);
  assert.deepEqual([demasiado.status, demasiado.allocatedCents, demasiado.suggestedDate, demasiado.extraMonthlyCents], ['unreachable', 1, null, 1_200]);
  assert.equal(caso(100, 500_000).status, 'unreachable', 'con RD$ 1 al mes una meta de RD$ 5,000 tardaría 5.000 meses');
});

test('«Va al ritmo» no pide más aporte aunque la capacidad ya se haya repartido', () => {
  // Capacidad 50. Las dos metas van al ritmo (aportes al día) pero ninguna cabe en 50 al mes.
  const creada = { createdAt: '2026-05-01T00:00:00.000Z' };
  const d = data({
    movements: june(10_000, 9_950),
    goals: [goal('g1', 6_000, '2026-10-20', creada), goal('g2', 6_000, '2026-10-20', creada)],
    contributions: [contrib('g1', 3_000, '2026-07-10'), contrib('g2', 3_000, '2026-07-10')],
  });
  const f = goalFeasibility(d, today);
  assert.deepEqual(f.goals.map((g) => g.status), ['on-track', 'on-track']);
  assert.deepEqual(f.goals.map((g) => g.extraMonthlyCents), [0, 0]);
  assert.deepEqual(f.goals.map((g) => g.allocatedCents), [5_000, 0], 'la capacidad (50) se acaba en la primera');
  assert.equal(f.shortfallCents, 99_300 * 2 - 5_000, 'el faltante de capacidad sí se informa');
  // Pero en el indicador de metas, si todas van al ritmo está «Bien» y no hay hueco que cerrar.
  const g = ind(personalDiagnosis(d, today), 'goals');
  assert.deepEqual([g?.level, g?.gapCents], ['good', 0]);
});

test('sin metas: nada que repartir', () => {
  const f = goalFeasibility(data({ movements: june(50_000, 20_000) }), today);
  assert.deepEqual(f.goals, []);
  assert.deepEqual([f.totalNeededCents, f.shortfallCents], [0, 0]);
});

test('usa el presupuesto que se le pasa en vez de recalcularlo', () => {
  const d = data({ movements: june(50_000, 20_000), goals: [goal('g', 5_000, '2026-08-10')] });
  const budget = { ...buildBudget(d, today), savingsCapacityCents: 100_000 };
  const [g] = goalFeasibility(d, today, budget).goals;
  assert.deepEqual([g.status, g.allocatedCents], ['tight', 100_000]);
});

test('la fecha sugerida de una meta ajustada es la que alcanza con lo que le toca, redondeada hacia arriba', () => {
  // Le toca 3,000 al mes de 20,000: 20,000 / 3,000 = 6,667 meses → 202,9 días → 203 → 9 de febrero de 2027.
  const d = data({ movements: june(23_000, 20_000), goals: [goal('g', 20_000, '2026-08-10')] });
  const [g] = goalFeasibility(d, today).goals;
  assert.equal(g.status, 'tight');
  assert.equal(g.allocatedCents, 300_000);
  assert.equal(g.suggestedDate, '2027-02-08');
});

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

test('sin datos: solo ahorro y colchón, ambos «Sin datos» (nunca «Bien» por defecto)', () => {
  const d = personalDiagnosis(data(), today);
  assert.equal(d.hasData, false);
  assert.deepEqual(d.indicators.map((i) => [i.id, i.level, i.value]), [['savings', 'unknown', null], ['emergency', 'unknown', null]]);
  assert.deepEqual(d.counts, { risk: 0, watch: 0, good: 0, unknown: 2 });
  assert.equal(d.capacityCents, null);
});

test('tasa de ahorro: los cortes exactos, en 20 % y 10 %', () => {
  // Ingreso 100,000; el gasto fija el ahorro.
  const nivel = (gasto) => personalDiagnosis(data({ movements: june(100_000, gasto) }), today);
  const at = (gasto) => ind(nivel(gasto), 'savings');
  assert.equal(at(80_000)?.level, 'good', 'justo 20,00 %');
  assert.equal(at(80_001)?.level, 'watch', '19,999 %');
  assert.equal(at(90_000)?.level, 'watch', 'justo 10,00 %');
  assert.equal(at(90_001)?.level, 'risk', '9,999 %');
  assert.equal(at(100_000)?.level, 'risk', '0 %');
  assert.equal(at(120_000)?.level, 'risk', 'gastas más de lo que ganas');
  assert.equal(at(80_000)?.value, 20);
  assert.equal(at(120_000)?.value, -20);
});

test('tasa de ahorro: lo que falta para llegar a «Bien» se mide por mes', () => {
  const s = ind(personalDiagnosis(data({ movements: june(100_000, 80_001) }), today), 'savings');
  assert.equal(s?.gapCents, 100, 'faltan RD$ 1 al mes para el 20 %');
  const good = ind(personalDiagnosis(data({ movements: june(100_000, 50_000) }), today), 'savings');
  assert.equal(good?.gapCents, 0);
  const negative = ind(personalDiagnosis(data({ movements: june(100_000, 120_000) }), today), 'savings');
  assert.equal(negative?.gapCents, 4_000_000, 'hay que subir de −20,000 a +20,000');
});

test('tasa de ahorro: sin ingresos en el mes típico es «Riesgo» sin porcentaje', () => {
  const d = personalDiagnosis(data({ movements: [mv('expense', '2026-06-10', 5_000)] }), today);
  const s = ind(d, 'savings');
  assert.deepEqual([s?.level, s?.value, s?.gapCents], ['risk', null, null]);
});

test('los ahorros de las metas no suman a la tasa: sale solo de ingresos, gastos y cuotas', () => {
  const sinMeta = personalDiagnosis(data({ movements: june(100_000, 80_000) }), today);
  const conMeta = personalDiagnosis(data({
    movements: june(100_000, 80_000), goals: [goal('g', 50_000, '2027-01-01')], contributions: [contrib('g', 9_000, '2026-06-20')],
  }), today);
  assert.equal(ind(sinMeta, 'savings')?.value, ind(conMeta, 'savings')?.value);
});

test('colchón de emergencia: meses de salidas que cubre el dinero libre, con los cortes exactos', () => {
  // Salidas mensuales = gasto típico 20,000 (sin cuotas). Disponible = saldo inicial + 100,000 − 20,000.
  const con = (saldoInicial, extra = {}) => ind(personalDiagnosis(data({
    movements: june(100_000, 20_000), settings: { displayName: '', openingBalanceCents: saldoInicial * 100 }, ...extra,
  }), today), 'emergency');
  assert.deepEqual([con(40_000)?.level, con(40_000)?.value], ['good', 6], 'justo 6 meses (120,000 ÷ 20,000)');
  assert.equal(con(39_999)?.level, 'watch', 'un peso menos de 6 meses');
  assert.equal(con(-20_000)?.level, 'watch', 'justo 3 meses (60,000 ÷ 20,000)');
  assert.equal(con(-20_001)?.level, 'risk');
  assert.equal(con(-80_000)?.level, 'risk', 'disponible 0');
  assert.deepEqual([con(-120_000)?.level, con(-120_000)?.value, con(-120_000)?.gapCents], ['risk', 0, 12_000_000], 'si el disponible es negativo cuenta 0 meses');
});

test('colchón de emergencia: lo apartado en metas no cuenta, y el hueco se traduce en meses de capacidad', () => {
  // Capacidad 80,000 al mes. Disponible = 80,000 − 60,000 apartados = 20,000 → 1 mes de 20,000.
  const d = personalDiagnosis(data({
    movements: june(100_000, 20_000), goals: [goal('g', 100_000, '2027-12-31')], contributions: [contrib('g', 60_000, '2026-07-01')],
  }), today);
  assert.equal(d.cashCents, 2_000_000);
  const e = ind(d, 'emergency');
  assert.deepEqual([e?.level, e?.value], ['risk', 1]);
  assert.equal(e?.gapCents, 10_000_000, 'para 6 meses (120,000) faltan 100,000');
  assert.equal(e?.monthsToClose, 100_000 / 80_000, '100,000 ÷ 8,000,00 de capacidad = 1,25 meses');
});

test('colchón de emergencia: las cuotas de deudas entran en las salidas mensuales', () => {
  // Cuota 1,000 al mes (12.000 / 12): salidas = 20,000 + 1,000.
  const d = personalDiagnosis(data({
    movements: june(100_000, 20_000), debts: [debt({ totalCents: 12_000_00 })], settings: { displayName: '', openingBalanceCents: 0 },
  }), today);
  assert.equal(d.baseline.debtServiceCents, 100_000);
  assert.equal(d.outflowCents, 2_100_000);
  assert.equal(ind(d, 'emergency')?.value, 8_000_000 / 2_100_000);
});

test('colchón de emergencia: sin gastos ni cuotas no se puede dividir, queda «Sin datos»', () => {
  const d = personalDiagnosis(data({ movements: [mv('income', '2026-06-05', 50_000)] }), today);
  assert.deepEqual([ind(d, 'emergency')?.level, ind(d, 'emergency')?.value], ['unknown', null]);
  assert.equal(ind(d, 'savings')?.level, 'good', 'el ahorro sí se puede medir');
});

test('peso de las deudas: solo aparece con deudas activas y respeta los cortes 20 % y 35 %', () => {
  assert.equal(ind(personalDiagnosis(data({ movements: june(100_000, 10_000) }), today), 'debtLoad'), undefined);
  assert.equal(ind(personalDiagnosis(data({ movements: june(100_000, 10_000) }), today), 'lateDebts'), undefined);

  // Ingreso 100,000; la cuota mensual es total ÷ 12.
  const con = (cuota) => ind(personalDiagnosis(data({ movements: june(100_000, 10_000), debts: [debt({ totalCents: cuota * 100 * 12 })] }), today), 'debtLoad');
  assert.deepEqual([con(20_000)?.level, con(20_000)?.value], ['good', 20], 'justo 20 %');
  assert.equal(con(20_001)?.level, 'watch');
  assert.equal(con(35_000)?.level, 'watch', 'justo 35 %');
  assert.equal(con(35_001)?.level, 'risk');
  // Para quedar en 20 % habría que bajar la cuota 15,000.
  assert.equal(con(35_000)?.gapCents, 1_500_000);
  assert.equal(con(20_000)?.gapCents, 0);
});

test('peso de las deudas: sin ingresos es «Riesgo» y sin datos «Sin datos»', () => {
  const sinIngreso = personalDiagnosis(data({ movements: [mv('expense', '2026-06-10', 100)], debts: [debt()] }), today);
  assert.deepEqual([ind(sinIngreso, 'debtLoad')?.level, ind(sinIngreso, 'debtLoad')?.value], ['risk', null]);
  const sinDatos = personalDiagnosis(data({ debts: [debt()] }), today);
  assert.equal(ind(sinDatos, 'debtLoad')?.level, 'unknown');
});

test('cuotas vencidas: «Bien» si no hay ninguna, «Riesgo» con alguna, y nombra las deudas', () => {
  const alDia = personalDiagnosis(data({ movements: june(100_000, 10_000), debts: [debt()] }), today); // primera cuota el 25 de julio
  assert.deepEqual([ind(alDia, 'lateDebts')?.level, ind(alDia, 'lateDebts')?.value], ['good', 0]);
  assert.deepEqual(alDia.lateDebtNames, []);

  const atrasada = personalDiagnosis(data({
    movements: june(100_000, 10_000),
    debts: [debt({ firstDueDate: '2026-06-25', finalDueDate: '2027-05-25' }), debt({ id: 'd2', name: 'Tarjeta' })],
  }), today);
  assert.deepEqual([ind(atrasada, 'lateDebts')?.level, ind(atrasada, 'lateDebts')?.value], ['risk', 1]);
  assert.deepEqual(atrasada.lateDebtNames, ['Préstamo']);
});

test('una deuda ya pagada del todo no cuenta como deuda activa', () => {
  const pagada = debt({ totalCents: 0 });
  const d = personalDiagnosis(data({ movements: june(100_000, 10_000), debts: [pagada] }), today);
  assert.equal(ind(d, 'debtLoad'), undefined);
});

test('metas: «Bien» si todas van bien, «Atención» si al menos la mitad, «Riesgo» si menos de la mitad', () => {
  const base = { movements: june(100_000, 10_000) }; // capacidad 90,000: sobra
  const goals = (n_ok, n_bad) => [
    ...Array.from({ length: n_ok }, (_, i) => goal(`ok${i}`, 1_000, '2026-08-10')),
    ...Array.from({ length: n_bad }, (_, i) => goal(`bad${i}`, 1_000, '2026-07-01')), // vencidas
  ];
  const level = (o, b) => ind(personalDiagnosis(data({ ...base, goals: goals(o, b) }), today), 'goals');
  assert.deepEqual([level(2, 0)?.level, level(2, 0)?.value], ['good', 2]);
  assert.deepEqual([level(1, 1)?.level, level(1, 1)?.value], ['watch', 1], '1 de 2 es justo la mitad');
  assert.deepEqual([level(1, 2)?.level, level(1, 2)?.value], ['risk', 1], '1 de 3 es menos de la mitad');
  assert.equal(level(0, 1)?.level, 'risk');
  assert.equal(ind(personalDiagnosis(data(base), today), 'goals'), undefined, 'sin metas pendientes no hay indicador');
});

test('metas: el hueco es lo que piden las metas y la capacidad no cubre; con todo «Sin datos» no se inventa', () => {
  const malas = personalDiagnosis(data({
    movements: june(50_000, 20_000), goals: [goal('a', 20_000, '2026-08-10'), goal('b', 20_000, '2026-08-15')],
  }), today);
  const g = ind(malas, 'goals');
  assert.deepEqual([g?.level, g?.value, g?.gapCents], ['watch', 1, 1_000_000], 'una cabe, otra no: faltan 10,000 al mes');

  const sinDatos = personalDiagnosis(data({ goals: [goal('a', 20_000, '2026-08-10')] }), today);
  assert.deepEqual([ind(sinDatos, 'goals')?.level, ind(sinDatos, 'goals')?.gapCents], ['unknown', 0]);

  // Sin datos para estimar la capacidad, pero una meta va al ritmo y otra no se puede evaluar: no es «Sin datos» del todo.
  const mixto = personalDiagnosis(data({
    goals: [goal('g', 6_000, '2026-10-20', { createdAt: '2026-05-01T00:00:00.000Z' }), goal('h', 9_000, '2026-12-20')],
    contributions: [contrib('g', 3_000, '2026-07-10')],
  }), today);
  assert.deepEqual([ind(mixto, 'goals')?.level, ind(mixto, 'goals')?.value], ['watch', 1]);
});

test('meses para cerrar el hueco: solo con una capacidad de ahorro positiva', () => {
  const sin = (ingreso, gasto) => ind(personalDiagnosis(data({
    movements: june(ingreso, gasto), goals: [goal('g', 100_000, '2027-12-31')], contributions: [contrib('g', 1_000, '2026-07-01')],
    settings: { displayName: '', openingBalanceCents: 0 },
  }), today), 'emergency');
  assert.ok((sin(30_000, 20_000)?.monthsToClose ?? 0) > 0, 'capacidad positiva');
  assert.equal(sin(20_000, 20_000)?.monthsToClose, null, 'capacidad 0: nunca se cierra');
  assert.equal(sin(10_000, 20_000)?.monthsToClose, null, 'capacidad negativa: tampoco');
  assert.equal(sin(20_000, 20_000)?.level, 'risk');
});

test('los indicadores salen siempre en el orden fijo', () => {
  const d = personalDiagnosis(data({
    movements: june(100_000, 95_000), debts: [debt()], goals: [goal('a', 1_000, '2026-08-10')],
  }), today);
  assert.deepEqual(d.indicators.map((i) => i.id), INDICATOR_ORDER);
});

test('patrimonio neto: aparece con cualquier registro; «Bien» solo si es positivo', () => {
  assert.equal(ind(personalDiagnosis(data(), today), 'netWorth'), undefined);

  const positivo = ind(personalDiagnosis(data({ movements: june(100_000, 20_000) }), today), 'netWorth');
  assert.deepEqual([positivo?.level, positivo?.value], ['good', 8_000_000]);

  // Debes más de lo que tienes: 80,000 en caja contra una deuda de 120,000.
  const negativo = personalDiagnosis(data({ movements: june(100_000, 20_000), debts: [debt()] }), today);
  const nw = ind(negativo, 'netWorth');
  assert.equal(nw?.level, 'watch');
  assert.ok((nw?.value ?? 0) < 0);

  // Exactamente cero no es «Bien».
  const cero = ind(personalDiagnosis(data({ movements: [mv('income', '2026-06-05', 1_000), mv('expense', '2026-06-06', 1_000)] }), today), 'netWorth');
  assert.deepEqual([cero?.level, cero?.value], ['watch', 0]);
});

test('patrimonio neto: con solo un activo, solo una deuda o solo un aporte a una meta ya hay registros', () => {
  const activo = {
    id: 'a1', name: 'Carro', category: /** @type {const} */ ('vehicles'), subtype: 'car', description: '', acquiredDate: '2026-03-10',
    valuations: [{ date: '2026-03-10', valueCents: 5_000_000 }], createdAt: '2026-03-10T10:00:00.000Z', updatedAt: '2026-03-10T10:00:00.000Z',
  };
  assert.equal(ind(personalDiagnosis(data({ assets: [activo] }), today), 'netWorth')?.value, 5_000_000);
  const soloDeuda = ind(personalDiagnosis(data({ debts: [debt({ totalCents: 12_000_00 })] }), today), 'netWorth');
  assert.deepEqual([soloDeuda?.level, soloDeuda?.value], ['watch', -1_200_000]);
  const soloAporte = ind(personalDiagnosis(data({ goals: [goal('g', 5_000, '2027-01-01')], contributions: [contrib('g', 100, '2026-07-01')] }), today), 'netWorth');
  // Apartar dinero para una meta lo mueve de un bolsillo a otro: no cambia el patrimonio (aquí no entró dinero, así que es 0).
  assert.deepEqual([soloAporte?.level, soloAporte?.value], ['watch', 0]);
});

test('un movimiento con fecha futura no entra en nada del diagnóstico', () => {
  const futuro = data({ movements: [...june(100_000, 80_000), mv('income', '2026-08-01', 500_000)] });
  const d = personalDiagnosis(futuro, today);
  assert.equal(d.cashCents, 100_000 * 100 - 80_000 * 100 + 0);
  assert.equal(ind(d, 'savings')?.value, 20);
});

test('con solo el mes en curso se avisa de que es parcial', () => {
  const d = personalDiagnosis(data({ movements: [mv('income', '2026-07-05', 30_000), mv('expense', '2026-07-06', 6_000)] }), today);
  assert.deepEqual([d.hasData, d.partial, d.months], [true, true, 1]);
  const completo = personalDiagnosis(data({ movements: june(30_000, 6_000) }), today);
  assert.deepEqual([completo.partial, completo.months], [false, 1]);
});

test('prioridades: del más urgente al menos y, a igualdad, en el orden fijo de los indicadores', () => {
  const d = personalDiagnosis(data({
    movements: june(100_000, 95_000), // ahorro 5 % → riesgo
    settings: { displayName: '', openingBalanceCents: 0 },
    debts: [debt({ firstDueDate: '2026-06-25', finalDueDate: '2027-05-25', totalCents: 12_000_00 })], // atrasada → riesgo; peso 1 % → bien
    goals: [goal('a', 1_000, '2026-08-10'), goal('b', 1_000, '2026-07-01')], // 1 de 2 va bien → atención... (capacidad 5,000 − 1,000 de cuota)
  }), today);
  const order = d.priorities.map((i) => `${i.id}:${i.level}`);
  // Riesgo (en orden fijo) → atención → sin datos → bien.
  const rank = { risk: 0, watch: 1, unknown: 2, good: 3 };
  for (let i = 1; i < d.priorities.length; i += 1) {
    const a = d.priorities[i - 1];
    const b = d.priorities[i];
    assert.ok(rank[a.level] < rank[b.level] || (rank[a.level] === rank[b.level] && INDICATOR_ORDER.indexOf(a.id) < INDICATOR_ORDER.indexOf(b.id)), order.join(' → '));
  }
  assert.equal(d.priorities[0].id, 'savings', 'ahorro y cuotas vencidas están en riesgo; el ahorro va primero por el orden fijo');
  assert.equal(d.priorities[1].id, 'emergency');
  assert.equal(d.priorities.length, d.indicators.length);
});

test('las prioridades ponen «Sin datos» después de «Atención» y antes de «Bien»', () => {
  // Sin gastos ni cuotas: el colchón queda sin datos; el ahorro es bueno (100 %); el patrimonio es bueno.
  const d = personalDiagnosis(data({ movements: [mv('income', '2026-06-05', 50_000)], goals: [goal('a', 20_000, '2026-08-10'), goal('b', 20_000, '2026-08-11')] }), today);
  // capacidad 50,000: caben las dos → metas «Bien».
  assert.deepEqual(d.priorities.map((i) => `${i.id}:${i.level}`), ['emergency:unknown', 'savings:good', 'goals:good', 'netWorth:good']);
});

test('el conteo por nivel suma todos los indicadores', () => {
  const d = personalDiagnosis(data({ movements: june(100_000, 95_000), debts: [debt()], goals: [goal('a', 1_000, '2026-08-10')] }), today);
  assert.equal(d.counts.risk + d.counts.watch + d.counts.good + d.counts.unknown, d.indicators.length);
});

test('no modifica los datos que recibe', () => {
  const d = data({
    movements: june(100_000, 95_000), debts: [debt({ firstDueDate: '2026-06-25', finalDueDate: '2027-05-25' })],
    goals: [goal('a', 20_000, '2026-08-10'), goal('b', 20_000, '2026-07-01')], contributions: [contrib('a', 500, '2026-07-02')],
  });
  const before = JSON.stringify(d);
  personalDiagnosis(d, today);
  goalFeasibility(d, today);
  assert.equal(JSON.stringify(d), before);
});

test('los datos de demostración se incluyen (el diagnóstico es una calculadora, no un logro)', () => {
  const demoMv = { ...mv('income', '2026-06-05', 100_000), isDemo: true };
  const d = personalDiagnosis(data({ movements: [demoMv, { ...mv('expense', '2026-06-10', 10_000), isDemo: true }] }), today);
  assert.equal(ind(d, 'savings')?.level, 'good');
});
