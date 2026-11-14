// @ts-check
// =============================================================================
// SALUD FINANCIERA DE LA EMPRESA (Empresa, fase 1: organización y finanzas)
// -----------------------------------------------------------------------------
// Cinco indicadores que salen SOLO de lo que ya registraste (movimientos con su
// clasificación fijo/variable, deudas, activos). Son reglas fijas y comprobables;
// NO es inteligencia artificial ni asesoría contable. Los umbrales de «bien /
// atención / riesgo» son reglas generales de la práctica financiera, no una
// verdad para tu caso: sirven para saber dónde mirar primero.
//
//   «Mes típico»         promedio de los últimos 3 meses COMPLETOS con movimientos
//                        (si aún no hay ninguno, el mes en curso, y se avisa de
//                        que es parcial). Igual que el presupuesto automático.
//   Costos fijos         gastos clasificados como Fijo o Discrecional (no cambian
//                        con lo que vendes).
//   Costos variables     gastos clasificados como Variable (suben con las ventas).
//   Servicio de deuda    cuotas mensuales de las deudas activas (del calendario
//                        de cada deuda); los pagos de deudas ya hechos NO cuentan
//                        dentro de los costos, para no contarlos dos veces.
//
//   1. Punto de equilibrio   ventas mensuales mínimas para no perder dinero:
//                            costos fijos ÷ margen de contribución, donde el margen de
//                            contribución = (ingresos − costos variables) ÷ ingresos.
//                            Se da sin deudas y con el servicio de deuda.
//                            Margen de seguridad = cuánto pueden caer tus ingresos
//                            antes de llegar a ese punto (con deudas).
//   2. Meses de efectivo     Disponible ÷ lo que sale cada mes (costos + servicio de deuda).
//   3. Deuda sobre activos   lo que debes ÷ lo que tienes (el patrimonio de la app).
//   4. Servicio de deuda     cuotas mensuales ÷ ingreso típico.
//   5. Cuotas a 30 días      lo que vence en los próximos 30 días (con lo vencido) frente al
//                            Disponible.
// =============================================================================

import { addDays, addMonths, monthKeyOf } from './dates.js';
import { debtPortfolio } from './debts.js';
import { netWorthAt } from './netWorth.js';
import { overallTotals } from './summaries.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */

/** Meses completos que se promedian para el «mes típico». */
export const HEALTH_MONTHS = 3;

/** Días hacia adelante que se miran para las cuotas que vencen. */
export const OBLIGATION_DAYS = 30;

/** @typedef {'good' | 'watch' | 'risk' | 'unknown'} HealthLevel */

export const HEALTH_LEVEL_LABELS = /** @type {const} */ ({
  good: 'Bien',
  watch: 'Atención',
  risk: 'Riesgo',
  unknown: 'Sin datos',
});

/** Umbrales (reglas generales, visibles para el usuario en la pantalla y en la documentación). */
export const HEALTH_THRESHOLDS = /** @type {const} */ ({
  /** Margen de seguridad con deudas, en %: ≥ 20 bien, ≥ 5 atención, menos riesgo. */
  safety: { good: 20, watch: 5 },
  /** Meses de efectivo: ≥ 6 bien, ≥ 3 atención, menos riesgo (con matices; ver `runwayLevel`). */
  runway: { good: 6, watch: 3 },
  /** Deuda sobre activos, en %: ≤ 40 bien, ≤ 60 atención, más riesgo. */
  leverage: { good: 40, watch: 60 },
  /** Servicio de deuda sobre ingresos, en %: ≤ 20 bien, ≤ 35 atención, más riesgo. */
  debtService: { good: 20, watch: 35 },
});

/**
 * ¿Este tipo de espacio tiene la pantalla «Salud financiera»? Solo Empresa.
 * @param {WorkspaceKind | null | undefined} kind
 */
export function healthEnabled(kind) {
  return kind === 'company';
}

/**
 * «Mes típico» con los gastos separados en fijos y variables (sin pagos de deudas).
 * @param {AppData} data @param {string} today
 */
export function costBaseline(data, today) {
  const current = monthKeyOf(today);
  const debtMovementIds = new Set(data.debtPayments.map((p) => p.movementId));

  /** @param {string} key */
  const totalsOf = (key) => {
    let income = 0;
    let fixed = 0;
    let variable = 0;
    let any = false;
    for (const m of data.movements) {
      if (m.date > today || monthKeyOf(m.date) !== key) continue;
      if (m.type === 'income') {
        income += m.amountCents;
        any = true;
      } else if (!debtMovementIds.has(m.id)) {
        // Fijo y discrecional no dependen de lo que vendes; variable sí.
        if (m.classification === 'variable') variable += m.amountCents;
        else fixed += m.amountCents;
        any = true;
      }
    }
    return { income, fixed, variable, any };
  };

  const previous = Array.from({ length: HEALTH_MONTHS }, (_, i) => totalsOf(addMonths(current, -(i + 1)))).filter((m) => m.any);
  const partial = previous.length === 0;
  const used = partial ? [totalsOf(current)].filter((m) => m.any) : previous;
  if (used.length === 0) return { hasData: false, partial: false, months: 0, incomeCents: 0, fixedCents: 0, variableCents: 0 };

  /** @param {'income' | 'fixed' | 'variable'} key */
  const average = (key) => Math.round(used.reduce((sum, m) => sum + m[key], 0) / used.length);
  return {
    hasData: true,
    partial,
    months: used.length,
    incomeCents: average('income'),
    fixedCents: average('fixed'),
    variableCents: average('variable'),
  };
}

/**
 * Nivel de un indicador "más es mejor" con dos cortes.
 * @param {number} value @param {{ good: number, watch: number }} cuts @returns {HealthLevel}
 */
function higherIsBetter(value, cuts) {
  return value >= cuts.good ? 'good' : value >= cuts.watch ? 'watch' : 'risk';
}

/**
 * Nivel de un indicador "menos es mejor" con dos cortes.
 * @param {number} value @param {{ good: number, watch: number }} cuts @returns {HealthLevel}
 */
function lowerIsBetter(value, cuts) {
  return value <= cuts.good ? 'good' : value <= cuts.watch ? 'watch' : 'risk';
}

/**
 * Nivel de los meses de efectivo. Menos de 1 mes siempre es riesgo; entre 1 y 6 meses depende de si el negocio
 * está perdiendo o ganando cada mes (un negocio que gana cada mes tiene menos urgencia por su colchón).
 * @param {number} months @param {number} monthlyNetCents @returns {HealthLevel}
 */
export function runwayLevel(months, monthlyNetCents) {
  const losing = monthlyNetCents < 0;
  if (months < 1) return 'risk';
  if (months < HEALTH_THRESHOLDS.runway.watch) return losing ? 'risk' : 'watch';
  if (months < HEALTH_THRESHOLDS.runway.good) return losing ? 'watch' : 'good';
  return 'good';
}

/**
 * @typedef {Object} BreakEven
 * @property {boolean} ok                     false si no se puede calcular.
 * @property {'no-data' | 'no-income' | 'no-margin' | null} reason
 * @property {number | null} contributionPercent  Margen de contribución (ingresos − variables) ÷ ingresos, en %.
 * @property {number | null} operatingCents   Ventas mensuales mínimas sin contar deudas.
 * @property {number | null} withDebtCents    Ventas mensuales mínimas contando el servicio de deuda.
 * @property {number | null} safetyPercent    Cuánto pueden caer los ingresos antes de llegar al punto con deudas (negativo = ya por debajo).
 */

/**
 * @typedef {Object} Runway
 * @property {number} cashCents               Disponible hoy.
 * @property {number} monthlyOutflowCents     Lo que sale cada mes: costos + servicio de deuda.
 * @property {number} monthlyNetCents         Ingreso típico − salida mensual.
 * @property {number | null} coverageMonths   Meses que cubre el efectivo (null si no hay salidas para medir).
 * @property {number | null} burnMonths       Meses hasta quedarte sin efectivo al ritmo actual (null si no estás perdiendo dinero cada mes).
 */

/**
 * @typedef {Object} Leverage
 * @property {number} assetsCents
 * @property {number} liabilitiesCents
 * @property {number | null} debtToAssetsPercent  null si no hay activos que comparar.
 */

/**
 * @typedef {Object} DebtLoad
 * @property {number} monthlyServiceCents
 * @property {number | null} percentOfIncome  null si no hay ingresos que comparar.
 */

/**
 * @typedef {Object} Obligations
 * @property {number} dueCents      Cuotas vencidas más las que vencen en los próximos 30 días.
 * @property {number} count
 * @property {number} overdueCents  La parte que ya venció.
 * @property {number} coverCents    Disponible − dueCents (negativo = no alcanza).
 */

/**
 * @typedef {Object} CompanyHealth
 * @property {boolean} hasData
 * @property {boolean} partial
 * @property {number} months
 * @property {{ incomeCents: number, fixedCents: number, variableCents: number, debtServiceCents: number }} baseline
 * @property {BreakEven} breakEven
 * @property {Runway} runway
 * @property {Leverage} leverage
 * @property {DebtLoad} debtLoad
 * @property {Obligations} obligations
 * @property {{ breakEven: HealthLevel, runway: HealthLevel, leverage: HealthLevel, debtService: HealthLevel, obligations: HealthLevel }} levels
 * @property {{ risk: number, watch: number, good: number, unknown: number }} counts
 */

/**
 * Los cinco indicadores de salud de la empresa con su nivel.
 * @param {AppData} data @param {string} today
 * @returns {CompanyHealth}
 */
export function companyHealth(data, today) {
  const baseline = costBaseline(data, today);
  const portfolio = debtPortfolio(data, today);
  const cashCents = overallTotals(data, today).availableCents;
  const debtServiceCents = portfolio.monthlyServiceCents;
  const income = baseline.incomeCents;

  // ---- 1. Punto de equilibrio ----------------------------------------------------------------------------------
  /** @type {BreakEven} */
  let breakEven = { ok: false, reason: 'no-data', contributionPercent: null, operatingCents: null, withDebtCents: null, safetyPercent: null };
  if (baseline.hasData) {
    if (income <= 0) {
      breakEven = { ok: false, reason: 'no-income', contributionPercent: null, operatingCents: null, withDebtCents: null, safetyPercent: null };
    } else {
      const contribution = (income - baseline.variableCents) / income;
      if (contribution <= 0) {
        breakEven = { ok: false, reason: 'no-margin', contributionPercent: contribution * 100, operatingCents: null, withDebtCents: null, safetyPercent: null };
      } else {
        const withDebt = (baseline.fixedCents + debtServiceCents) / contribution;
        breakEven = {
          ok: true,
          reason: null,
          contributionPercent: contribution * 100,
          operatingCents: Math.round(baseline.fixedCents / contribution),
          withDebtCents: Math.round(withDebt),
          safetyPercent: ((income - withDebt) / income) * 100,
        };
      }
    }
  }

  // ---- 2. Meses de efectivo ------------------------------------------------------------------------------------
  const monthlyOutflowCents = baseline.fixedCents + baseline.variableCents + debtServiceCents;
  const monthlyNetCents = income - monthlyOutflowCents;
  /** @type {Runway} */
  const runway = {
    cashCents,
    monthlyOutflowCents,
    monthlyNetCents,
    coverageMonths: baseline.hasData && monthlyOutflowCents > 0 ? Math.max(0, cashCents) / monthlyOutflowCents : null,
    burnMonths: baseline.hasData && monthlyNetCents < 0 ? Math.max(0, cashCents) / -monthlyNetCents : null,
  };

  // ---- 3. Deuda sobre activos ----------------------------------------------------------------------------------
  const point = netWorthAt(data, today);
  /** @type {Leverage} */
  const leverage = {
    assetsCents: point.assetsCents,
    liabilitiesCents: point.liabilitiesCents,
    debtToAssetsPercent: point.liabilitiesCents === 0 ? 0 : point.assetsCents > 0 ? (point.liabilitiesCents / point.assetsCents) * 100 : null,
  };

  // ---- 4. Servicio de deuda sobre ingresos ---------------------------------------------------------------------
  /** @type {DebtLoad} */
  const debtLoad = {
    monthlyServiceCents: debtServiceCents,
    percentOfIncome: debtServiceCents === 0 ? 0 : income > 0 ? (debtServiceCents / income) * 100 : null,
  };

  // ---- 5. Cuotas de los próximos 30 días -----------------------------------------------------------------------
  const horizon = addDays(today, OBLIGATION_DAYS);
  let dueCents = 0;
  let overdueCents = 0;
  let count = 0;
  for (const item of portfolio.active) {
    for (const row of item.status.remaining) {
      if (row.date > horizon) break;
      dueCents += row.paymentCents;
      count += 1;
      if (row.date < today) overdueCents += row.paymentCents;
    }
  }
  /** @type {Obligations} */
  const obligations = { dueCents, count, overdueCents, coverCents: cashCents - dueCents };

  // ---- Niveles -------------------------------------------------------------------------------------------------
  const hasDebts = portfolio.active.length > 0;
  /** @type {CompanyHealth['levels']} */
  const levels = {
    breakEven: !baseline.hasData || breakEven.reason === 'no-income' ? 'unknown' : !breakEven.ok ? 'risk' : higherIsBetter(/** @type {number} */ (breakEven.safetyPercent), HEALTH_THRESHOLDS.safety),
    runway: runway.coverageMonths === null ? 'unknown' : runwayLevel(runway.coverageMonths, monthlyNetCents),
    leverage: leverage.debtToAssetsPercent === null ? 'risk' : lowerIsBetter(leverage.debtToAssetsPercent, HEALTH_THRESHOLDS.leverage),
    debtService: debtLoad.percentOfIncome === null ? (baseline.hasData ? 'risk' : 'unknown') : lowerIsBetter(debtLoad.percentOfIncome, HEALTH_THRESHOLDS.debtService),
    obligations: !hasDebts || count === 0 ? 'good' : cashCents >= 2 * dueCents ? 'good' : cashCents >= dueCents ? 'watch' : 'risk',
  };
  // Si todavía no hay nada registrado (ni movimientos, ni deudas, ni activos) no se declara «bien» ningún indicador.
  if (!baseline.hasData && !hasDebts && data.assets.length === 0) {
    levels.leverage = 'unknown';
    levels.debtService = 'unknown';
    levels.obligations = 'unknown';
  }

  const counts = { risk: 0, watch: 0, good: 0, unknown: 0 };
  for (const level of Object.values(levels)) counts[level] += 1;

  return {
    hasData: baseline.hasData,
    partial: baseline.partial,
    months: baseline.months,
    baseline: { incomeCents: income, fixedCents: baseline.fixedCents, variableCents: baseline.variableCents, debtServiceCents },
    breakEven,
    runway,
    leverage,
    debtLoad,
    obligations,
    levels,
    counts,
  };
}

/**
 * Avisos de la empresa (solo espacios Empresa): sin colchón de efectivo o por debajo del punto de equilibrio.
 * Se calculan con reglas fijas y solo si hay al menos un mes completo de historia.
 * @param {AppData} data @param {string} today
 * @returns {{ id: string, level: 'critical' | 'info', text: string }[]}
 */
export function healthNotices(data, today) {
  const health = companyHealth(data, today);
  /** @type {{ id: string, level: 'critical' | 'info', text: string }[]} */
  const notices = [];
  if (!health.hasData || health.partial) return notices;

  const { coverageMonths } = health.runway;
  if (coverageMonths !== null && health.levels.runway === 'risk') {
    const months = coverageMonths < 1 ? 'menos de 1 mes' : `${coverageMonths.toFixed(1)} meses`;
    const losing = health.runway.monthlyNetCents < 0 ? ' Además, en un mes típico sale más dinero del que entra.' : '';
    notices.push({
      id: 'company-runway-low',
      level: coverageMonths < 1 ? 'critical' : 'info',
      text: `Tu efectivo cubre ${months} de lo que sale cada mes.${losing} Mira «Salud financiera».`,
    });
  }
  if (health.breakEven.ok && /** @type {number} */ (health.breakEven.safetyPercent) < 0) {
    notices.push({
      id: 'company-below-breakeven',
      level: 'info',
      text: 'Tus ingresos de un mes típico están por debajo del punto de equilibrio: con los costos fijos y las cuotas de deuda actuales, hoy se pierde dinero. Mira «Salud financiera».',
    });
  }
  return notices;
}
