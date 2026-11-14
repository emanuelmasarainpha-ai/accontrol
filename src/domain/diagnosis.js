// @ts-check
// =============================================================================
// DIAGNÓSTICO FINANCIERO Y VIABILIDAD DE METAS (documento maestro §7 y §12, primer nivel)
// -----------------------------------------------------------------------------
// Reglas FIJAS y comprobables sobre lo que ya registraste. NO es inteligencia artificial,
// no predice nada y no es asesoría financiera: los cortes de «bien / atención / riesgo» son
// reglas generales de la práctica financiera (se muestran en pantalla) y sirven para saber
// dónde mirar primero. No hay una «nota» única: sería una precisión inventada.
//
// Todo parte del «mes típico» del presupuesto automático (domain/budget.js): el promedio de
// tus últimos 3 meses completos con movimientos (o el mes en curso, avisando que es parcial),
// con los pagos de deudas fuera de los gastos para no contarlos dos veces.
//
// INDICADORES (personal; en Empresa existe la pantalla «Salud financiera» y no se duplican):
//   1. Tasa de ahorro      capacidad de ahorro ÷ ingreso típico.     Bien ≥ 20 % · Atención ≥ 10 % · Riesgo < 10 %.
//                          capacidad de ahorro = ingreso − gasto típico − cuotas mensuales.
//   2. Colchón             Disponible ÷ salidas mensuales (gasto típico + cuotas).   Bien ≥ 6 meses · Atención ≥ 3.
//                          No cuenta lo apartado en metas ni los activos: es solo el dinero libre.
//   3. Peso de deudas      cuotas mensuales ÷ ingreso típico.        Bien ≤ 20 % · Atención ≤ 35 % (los mismos cortes de Empresa).
//   4. Cuotas vencidas     cuotas ya vencidas sin pagar.             Bien = ninguna · Riesgo = alguna.
//   5. Metas               cuántas metas pendientes van al ritmo o caben (ver abajo).
//   6. Patrimonio neto     lo que tienes − lo que debes.             Bien > 0 · Atención ≤ 0.
// Los indicadores 3 y 4 solo aparecen si hay deudas activas; el 5 solo si hay metas pendientes y el 6
// solo si hay algún registro. Un indicador sin datos suficientes sale «Sin datos», nunca «Bien».
//
// VIABILIDAD DE UNA META (cada meta pendiente, ordenadas por fecha objetivo):
//   necesita      lo que hay que aportar al mes para llegar a tiempo (goalProgress.monthlyNeededCents).
//   ritmo actual  lo que aportas hoy (goalPace): si ya alcanza a tiempo, la meta «Va al ritmo».
//   Tu capacidad de ahorro es UNA SOLA para todas las metas: se reparte por orden de fecha (la que vence
//   antes se sirve primero) y cada meta recibe como máximo lo que necesita.
//   - Va al ritmo   tu ritmo actual ya llega a tiempo (aun así consume parte de la capacidad).
//   - Viable        a la meta le toca todo lo que necesita.
//   - Ajustada      le toca menos de lo que necesita pero más de cero: con eso llegarías más tarde (se da la fecha).
//   - No alcanza    no le toca nada (o lo que le toca tardaría más de 100 años en completarla).
//   - Vencida       la fecha llegó (hoy o antes) y falta dinero.
//   - Sin datos     no hay un mes con movimientos para estimar la capacidad y el ritmo actual no alcanza.
// =============================================================================

import { buildBudget } from './budget.js';
import { HEALTH_THRESHOLDS } from './company.js';
import { addDays } from './dates.js';
import { debtPortfolio } from './debts.js';
import { goalPace, goalProgress } from './goals.js';
import { netWorthAt } from './netWorth.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').Goal} Goal */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */
/** @typedef {import('./company.js').HealthLevel} HealthLevel */

const DAYS_PER_MONTH = 30.4375;
/** Más allá de 100 años no se da una fecha (igual que el ritmo de las metas): se dice «No alcanza». */
const MAX_PROJECTION_MONTHS = 1200;

/** Cortes de los indicadores (reglas generales, a la vista del usuario). */
export const DIAGNOSIS_THRESHOLDS = /** @type {const} */ ({
  /** Tasa de ahorro, % del ingreso típico: ≥ 20 bien, ≥ 10 atención, menos riesgo. */
  savings: { good: 20, watch: 10 },
  /** Meses de gastos cubiertos por el Disponible: ≥ 6 bien, ≥ 3 atención, menos riesgo. */
  emergency: { good: 6, watch: 3 },
  /** Peso de las cuotas, % del ingreso típico: ≤ 20 bien, ≤ 35 atención, más riesgo (los mismos de Empresa). */
  debtService: HEALTH_THRESHOLDS.debtService,
});

/**
 * ¿Este espacio tiene la pantalla «Diagnóstico»? Todos menos Empresa, que tiene su «Salud financiera».
 * (La viabilidad de cada meta se ve en la pantalla Metas de todos los espacios.)
 * @param {WorkspaceKind | null | undefined} kind
 */
export function diagnosisEnabled(kind) {
  return kind !== 'company';
}

// Los niveles se deciden con ENTEROS (centavos × 100 contra centavos × corte), no con el porcentaje ya
// dividido: así un caso justo en el corte (20,00 %) no cambia de nivel por un redondeo de decimales.
/** @param {number} part @param {number} whole @param {{ good: number, watch: number }} cuts @returns {HealthLevel} */
const higherIsBetter = (part, whole, cuts) => (part * 100 >= whole * cuts.good ? 'good' : part * 100 >= whole * cuts.watch ? 'watch' : 'risk');
/** @param {number} part @param {number} whole @param {{ good: number, watch: number }} cuts @returns {HealthLevel} */
const lowerIsBetter = (part, whole, cuts) => (part * 100 <= whole * cuts.good ? 'good' : part * 100 <= whole * cuts.watch ? 'watch' : 'risk');

// ---------------------------------------------------------------------------
// Viabilidad de metas
// ---------------------------------------------------------------------------

/** @typedef {'on-track' | 'viable' | 'tight' | 'unreachable' | 'overdue' | 'unknown'} FeasibilityStatus */

/** @type {Record<FeasibilityStatus, string>} */
export const FEASIBILITY_LABELS = {
  'on-track': 'Va al ritmo',
  viable: 'Viable',
  tight: 'Ajustada',
  unreachable: 'No alcanza',
  overdue: 'Vencida',
  unknown: 'Sin datos',
};

/**
 * @typedef {Object} GoalFeasibility
 * @property {Goal} goal
 * @property {ReturnType<typeof goalProgress>} progress
 * @property {ReturnType<typeof goalPace>} pace
 * @property {FeasibilityStatus} status
 * @property {number} neededCents      Aporte mensual para llegar a tiempo (0 si la fecha ya llegó).
 * @property {number} paceCents        Lo que aportas hoy al mes (promedio de los últimos meses).
 * @property {number} allocatedCents   Lo que le toca de tu capacidad de ahorro (por orden de fecha).
 * @property {number | null} extraMonthlyCents  Lo que faltaría aportar al mes para llegar a tiempo (null si no se puede estimar).
 * @property {string | null} suggestedDate  Con lo que le toca de tu capacidad (solo «Ajustada»): cuándo llegarías.
 * @property {string | null} paceDate       Con tu ritmo actual: cuándo llegarías (null si no aportas o es demasiado lejos).
 */

/**
 * Viabilidad de cada meta pendiente repartiendo UNA capacidad de ahorro por orden de fecha.
 * @param {AppData} data @param {string} today
 * @param {ReturnType<typeof buildBudget>} [budget]
 */
export function goalFeasibility(data, today, budget = buildBudget(data, today)) {
  const capacityCents = budget.savingsCapacityCents;

  const pending = data.goals
    .map((goal) => ({ goal, progress: goalProgress(goal, data.contributions, today) }))
    .filter((x) => !x.progress.completed)
    .sort((a, b) => a.goal.targetDate.localeCompare(b.goal.targetDate) || a.goal.createdAt.localeCompare(b.goal.createdAt) || a.goal.id.localeCompare(b.goal.id));

  let left = capacityCents === null ? 0 : Math.max(0, capacityCents);

  /** @type {GoalFeasibility[]} */
  const goals = pending.map(({ goal, progress }) => {
    const pace = goalPace(goal, data.contributions, today);
    const paceCents = pace.monthlyPaceCents;
    const paceDate = pace.projectedDate;

    // La fecha llegó (hoy o antes) y falta dinero: ya no hay «aporte mensual» que calcular.
    if (progress.daysLeft <= 0) {
      return { goal, progress, pace, status: 'overdue', neededCents: 0, paceCents, allocatedCents: 0, extraMonthlyCents: null, suggestedDate: null, paceDate };
    }

    const neededCents = progress.monthlyNeededCents;
    const allocatedCents = Math.min(neededCents, left);
    left -= allocatedCents;

    /** @type {FeasibilityStatus} */
    let status;
    if (pace.status === 'on-track') status = 'on-track';
    else if (capacityCents === null) status = 'unknown';
    else if (allocatedCents >= neededCents) status = 'viable';
    else if (allocatedCents > 0 && progress.remainingCents / allocatedCents <= MAX_PROJECTION_MONTHS) status = 'tight';
    else status = 'unreachable';

    // «Va al ritmo» no necesita más aporte aunque la capacidad ya esté repartida; «Viable» tampoco (le toca todo).
    const extraMonthlyCents = status === 'on-track' ? 0 : status === 'unknown' ? null : neededCents - allocatedCents;
    const suggestedDate = status === 'tight' ? addDays(today, Math.ceil((progress.remainingCents / allocatedCents) * DAYS_PER_MONTH)) : null;
    return { goal, progress, pace, status, neededCents, paceCents, allocatedCents, extraMonthlyCents, suggestedDate, paceDate };
  });

  /** @type {Record<FeasibilityStatus, number>} */
  const counts = { 'on-track': 0, viable: 0, tight: 0, unreachable: 0, overdue: 0, unknown: 0 };
  for (const g of goals) counts[g.status] += 1;

  const totalNeededCents = goals.reduce((sum, g) => sum + g.neededCents, 0);
  return {
    goals,
    counts,
    capacityCents,
    baseline: budget.baseline,
    totalNeededCents,
    /** Lo que las metas piden y tu capacidad no cubre (0 si cubre o si no se puede estimar). */
    shortfallCents: capacityCents === null ? 0 : Math.max(0, totalNeededCents - Math.max(0, capacityCents)),
  };
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

/** @typedef {'savings' | 'emergency' | 'debtLoad' | 'lateDebts' | 'goals' | 'netWorth'} IndicatorId */

/**
 * @typedef {Object} Indicator
 * @property {IndicatorId} id
 * @property {HealthLevel} level
 * @property {number | null} value   Cifra principal (% / meses / cuotas / metas que caben / centavos); null sin datos.
 * @property {number | null} gapCents  Lo que faltaría para llegar a «Bien» (centavos; por mes en la tasa de ahorro). null si no aplica.
 * @property {number | null} monthsToClose  Meses que tardarías en cerrar `gapCents` con tu capacidad de ahorro (null si no aplica o no hay capacidad).
 */

/** Orden fijo de los indicadores (y desempate al ordenar por urgencia). @type {IndicatorId[]} */
export const INDICATOR_ORDER = ['savings', 'emergency', 'debtLoad', 'lateDebts', 'goals', 'netWorth'];

const LEVEL_URGENCY = /** @type {const} */ ({ risk: 0, watch: 1, unknown: 2, good: 3 });

/**
 * Diagnóstico completo: los indicadores que aplican, con su nivel y lo que falta para «Bien».
 * @param {AppData} data @param {string} today
 */
export function personalDiagnosis(data, today) {
  const budget = buildBudget(data, today);
  const baseline = budget.baseline;
  const portfolio = debtPortfolio(data, today);
  const feasibility = goalFeasibility(data, today, budget);
  const point = netWorthAt(data, today);

  const income = baseline.incomeCents;
  const typicalExpense = baseline.expenseCents;
  const debtService = budget.debtServiceCents;
  const cash = budget.availableCents;
  const capacity = budget.savingsCapacityCents;
  const hasDebts = portfolio.active.length > 0;
  const lateInstallments = portfolio.active.reduce((sum, d) => sum + d.status.overdueCount, 0);
  const lateDebtNames = portfolio.active.filter((d) => d.status.overdueCount > 0).map((d) => d.debt.name);

  /** Meses de capacidad de ahorro que cuesta cubrir un hueco (solo se llama con huecos > 0). @param {number} gap */
  const monthsToClose = (gap) => (capacity !== null && capacity > 0 ? gap / capacity : null);

  // ---- 1. Tasa de ahorro ----
  /** @type {Indicator} */
  let savings;
  if (!baseline.hasData) savings = { id: 'savings', level: 'unknown', value: null, gapCents: null, monthsToClose: null };
  else if (income <= 0) savings = { id: 'savings', level: 'risk', value: null, gapCents: null, monthsToClose: null };
  else {
    const saved = /** @type {number} */ (capacity); // con datos, la capacidad nunca es null
    const level = higherIsBetter(saved, income, DIAGNOSIS_THRESHOLDS.savings);
    const gap = level === 'good' ? 0 : Math.ceil((income * DIAGNOSIS_THRESHOLDS.savings.good) / 100) - saved; // fuera de «Bien» siempre es > 0
    savings = { id: 'savings', level, value: (saved / income) * 100, gapCents: gap, monthsToClose: null };
  }

  // ---- 2. Colchón de emergencia ----
  const outflow = typicalExpense + debtService;
  /** @type {Indicator} */
  let emergency;
  if (!baseline.hasData || outflow <= 0) emergency = { id: 'emergency', level: 'unknown', value: null, gapCents: null, monthsToClose: null };
  else {
    const free = Math.max(0, cash);
    const cuts = DIAGNOSIS_THRESHOLDS.emergency;
    const level = free >= cuts.good * outflow ? 'good' : free >= cuts.watch * outflow ? 'watch' : 'risk';
    const gap = level === 'good' ? 0 : cuts.good * outflow - free;
    emergency = { id: 'emergency', level, value: free / outflow, gapCents: gap, monthsToClose: monthsToClose(gap) };
  }

  // ---- 3. Peso de las deudas ----
  /** @type {Indicator | null} */
  let debtLoad = null;
  if (hasDebts) {
    if (!baseline.hasData) debtLoad = { id: 'debtLoad', level: 'unknown', value: null, gapCents: null, monthsToClose: null };
    else if (income <= 0) debtLoad = { id: 'debtLoad', level: 'risk', value: null, gapCents: null, monthsToClose: null };
    else {
      const percent = (debtService / income) * 100;
      const level = lowerIsBetter(debtService, income, DIAGNOSIS_THRESHOLDS.debtService);
      // Lo que habría que bajar las cuotas mensuales para quedar en el corte de «Bien».
      const gap = level === 'good' ? 0 : debtService - Math.floor((income * DIAGNOSIS_THRESHOLDS.debtService.good) / 100); // fuera de «Bien» siempre es > 0
      debtLoad = { id: 'debtLoad', level, value: percent, gapCents: gap, monthsToClose: null };
    }
  }

  // ---- 4. Cuotas vencidas ----
  /** @type {Indicator | null} */
  const lateDebts = hasDebts
    ? { id: 'lateDebts', level: lateInstallments === 0 ? 'good' : 'risk', value: lateInstallments, gapCents: null, monthsToClose: null }
    : null;

  // ---- 5. Metas ----
  const pendingGoals = feasibility.goals.length;
  /** @type {Indicator | null} */
  let goals = null;
  if (pendingGoals > 0) {
    const ok = feasibility.counts['on-track'] + feasibility.counts.viable;
    /** @type {HealthLevel} */
    const level = feasibility.counts.unknown === pendingGoals ? 'unknown' : ok === pendingGoals ? 'good' : ok * 2 >= pendingGoals ? 'watch' : 'risk';
    goals = { id: 'goals', level, value: ok, gapCents: level === 'good' ? 0 : feasibility.shortfallCents, monthsToClose: null };
  }

  // ---- 6. Patrimonio neto ----
  const hasRecords = data.movements.length + data.assets.length + data.debts.length + data.contributions.length > 0;
  /** @type {Indicator | null} */
  const netWorth = hasRecords
    ? { id: 'netWorth', level: point.netWorthCents > 0 ? 'good' : 'watch', value: point.netWorthCents, gapCents: null, monthsToClose: null }
    : null;

  /** @type {Indicator[]} */
  const indicators = [savings, emergency, debtLoad, lateDebts, goals, netWorth].filter((x) => x !== null);

  const counts = { risk: 0, watch: 0, good: 0, unknown: 0 };
  for (const i of indicators) counts[i.level] += 1;

  // «Qué mirar primero»: del más urgente al menos. `sort` es estable, así que a igualdad queda el orden fijo de arriba.
  const priorities = [...indicators].sort((a, b) => LEVEL_URGENCY[a.level] - LEVEL_URGENCY[b.level]);

  return {
    hasData: baseline.hasData,
    partial: baseline.partial,
    months: baseline.months,
    baseline: { incomeCents: income, expenseCents: typicalExpense, debtServiceCents: debtService },
    capacityCents: capacity,
    cashCents: cash,
    outflowCents: outflow,
    netWorth: point,
    lateDebtNames,
    feasibility,
    indicators,
    counts,
    priorities,
  };
}
