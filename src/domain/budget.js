// @ts-check
// =============================================================================
// PRESUPUESTO AUTOMÁTICO (documento maestro §4.3)
// -----------------------------------------------------------------------------
// El presupuesto no es una pantalla aparte: sale solo de tus ingresos, gastos,
// deudas y ahorros. Reglas (fijas y comprobables; NO es inteligencia artificial):
//
//   Disponible           saldo inicial + ingresos − gastos − lo apartado en metas.
//   Comprometido         cuotas de deudas que vencen de hoy al fin de este mes
//                        (incluye las ya vencidas que no has pagado).
//   Libre tras compromisos   Disponible − Comprometido.
//
//   Para la capacidad mensual se toma un "mes típico": el promedio de tus últimos
//   3 meses COMPLETOS con movimientos (si aún no hay ninguno, el mes en curso, y se
//   avisa de que es parcial). Los pagos de deudas se sacan de los gastos del
//   promedio para no contarlos dos veces.
//
//   Capacidad de ahorro      ingreso típico − gasto típico (sin deudas) − cuotas
//                            mensuales de tus deudas activas.
//   Capacidad de inversión   capacidad de ahorro − lo que tus metas en marcha piden
//                            aportar cada mes. Es lo que te sobra tras cumplir todo
//                            lo anterior. Es una estimación, no asesoría de inversión.
//
// Si no hay suficientes datos, la capacidad es `null` (no se inventa un número).
// =============================================================================

import { addMonths, monthKeyOf } from './dates.js';
import { committedThisMonth, debtPortfolio } from './debts.js';
import { goalProgress } from './goals.js';
import { overallTotals } from './summaries.js';

/** @typedef {import('./types.js').AppData} AppData */

/** Meses completos que se promedian. */
export const BASELINE_MONTHS = 3;

/**
 * "Mes típico" de ingresos y gastos (sin pagos de deudas).
 * @param {AppData} data @param {string} today
 */
export function monthlyBaseline(data, today) {
  const current = monthKeyOf(today);
  const debtMovementIds = new Set(data.debtPayments.map((p) => p.movementId));

  /** @param {string} key */
  const totalsOf = (key) => {
    let income = 0;
    let expense = 0;
    let any = false;
    for (const m of data.movements) {
      if (m.date > today || monthKeyOf(m.date) !== key) continue;
      if (m.type === 'income') {
        income += m.amountCents;
        any = true;
      } else if (!debtMovementIds.has(m.id)) {
        expense += m.amountCents;
        any = true;
      }
    }
    return { key, income, expense, any };
  };

  const previous = Array.from({ length: BASELINE_MONTHS }, (_, i) => totalsOf(addMonths(current, -(i + 1)))).filter((m) => m.any);
  const partial = previous.length === 0;
  const used = partial ? [totalsOf(current)].filter((m) => m.any) : previous;

  if (used.length === 0) return { hasData: false, partial: false, months: 0, incomeCents: 0, expenseCents: 0 };
  return {
    hasData: true,
    partial,
    months: used.length,
    incomeCents: Math.round(used.reduce((s, m) => s + m.income, 0) / used.length),
    expenseCents: Math.round(used.reduce((s, m) => s + m.expense, 0) / used.length),
  };
}

/**
 * @param {AppData} data @param {string} today
 */
export function buildBudget(data, today) {
  const available = overallTotals(data, today).availableCents;
  const portfolio = debtPortfolio(data, today);
  const committed = committedThisMonth(portfolio.items, today);
  const baseline = monthlyBaseline(data, today);

  const goalsMonthlyCents = data.goals.reduce((sum, goal) => {
    const info = goalProgress(goal, data.contributions, today);
    return info.completed || info.overdue ? sum : sum + info.monthlyNeededCents;
  }, 0);

  const debtServiceCents = portfolio.monthlyServiceCents;
  const savingsCapacityCents = baseline.hasData ? baseline.incomeCents - baseline.expenseCents - debtServiceCents : null;
  const investmentCapacityCents = savingsCapacityCents === null ? null : savingsCapacityCents - goalsMonthlyCents;

  return {
    availableCents: available,
    committedCents: committed.cents,
    committedCount: committed.count,
    freeAfterCommitmentsCents: available - committed.cents,
    baseline,
    debtServiceCents,
    goalsMonthlyCents,
    savingsCapacityCents,
    investmentCapacityCents,
  };
}
