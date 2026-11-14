// @ts-check
// =============================================================================
// AVISOS (reglas simples y transparentes)
// -----------------------------------------------------------------------------
// OJO: esto NO es inteligencia artificial. Son reglas fijas que cualquiera puede
// leer y comprobar. Las "Alertas IA" del documento maestro (§12, §21) llegan en
// la Etapa 5; hasta entonces la app solo muestra estos avisos.
// =============================================================================

import { businessNotices, resultsEnabled } from './business.js';
import { daysBetween } from './dates.js';
import { clientFullName } from './clients.js';
import { healthEnabled, healthNotices } from './company.js';
import { debtPortfolio } from './debts.js';
import { departmentNotices, departmentsEnabled } from './departments.js';
import { clientConcentration, clientRanking, clientSummaries, receivables } from './freelance.js';
import { goalProgress } from './goals.js';
import { inventoryNotices } from './inventory.js';
import { invoiceNotices, invoicesEnabled } from './invoices.js';
import { formatMoney } from './money.js';
import { monthTotals, overallTotals } from './summaries.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */

/**
 * @typedef {Object} Notice
 * @property {string} id
 * @property {'critical' | 'info'} level  critical = se pinta en rojo.
 * @property {string} text
 */

/**
 * @param {AppData} data @param {string} today "AAAA-MM-DD"
 * @param {{ kind?: WorkspaceKind | null }} [options] Tipo del espacio abierto: los de negocio suman avisos de resultados.
 * @returns {Notice[]}
 */
export function computeNotices(data, today, { kind = null } = {}) {
  /** @type {Notice[]} */
  const notices = [];
  const monthKey = today.slice(0, 7);

  const totals = overallTotals(data, today);
  if (totals.availableCents < 0) {
    notices.push({
      id: 'available-negative',
      level: 'critical',
      text: `Tu dinero disponible está en ${formatMoney(totals.availableCents)}. Revisa si falta registrar algún ingreso o tu saldo inicial.`,
    });
  }

  const month = monthTotals(data.movements, monthKey);
  if (month.incomeCents > 0 && month.expenseCents > month.incomeCents) {
    notices.push({
      id: 'month-overspent',
      level: 'critical',
      text: `Este mes gastaste ${formatMoney(month.expenseCents - month.incomeCents)} más de lo que ingresó.`,
    });
  } else if (month.incomeCents === 0 && month.expenseCents > 0) {
    notices.push({
      id: 'month-no-income',
      level: 'info',
      text: `Este mes llevas ${formatMoney(month.expenseCents)} en gastos y todavía no registras ingresos.`,
    });
  }

  for (const goal of data.goals) {
    const p = goalProgress(goal, data.contributions, today);
    if (p.completed) continue;
    if (p.overdue) {
      notices.push({
        id: `goal-overdue-${goal.id}`,
        level: 'critical',
        text: `La meta «${goal.name}» ${p.timeLeftText.toLowerCase()} y aún faltan ${formatMoney(p.remainingCents)}.`,
      });
    } else if (p.daysLeft <= 30) {
      notices.push({
        id: `goal-soon-${goal.id}`,
        level: 'info',
        text: `La meta «${goal.name}» vence ${p.daysLeft === 0 ? 'hoy' : `en ${p.daysLeft} ${p.daysLeft === 1 ? 'día' : 'días'}`} y faltan ${formatMoney(p.remainingCents)}.`,
      });
    }
  }

  // ---- Deudas: vencidas (rojo), cuota próxima y vencimiento final cercano (informativos) ----
  for (const item of debtPortfolio(data, today).active) {
    const { debt, status } = item;
    const next = status.next;
    if (status.state === 'overdue') {
      notices.push({
        id: `debt-overdue-${debt.id}`,
        level: 'critical',
        text: `La deuda «${debt.name}» tiene ${status.overdueCount} ${status.overdueCount === 1 ? 'cuota vencida' : 'cuotas vencidas'} por ${formatMoney(status.overdueCents)}.`,
      });
    } else if (status.state === 'due-soon' && next) {
      const when = status.daysToNext === 0 ? 'hoy' : status.daysToNext === 1 ? 'mañana' : `en ${status.daysToNext} días`;
      notices.push({
        id: `debt-soon-${debt.id}`,
        level: 'info',
        text: `La cuota de «${debt.name}» (${formatMoney(next.paymentCents)}, de los cuales ${formatMoney(next.interestCents)} son interés) vence ${when}.`,
      });
    } else {
      const daysToFinal = daysBetween(today, debt.finalDueDate);
      if (daysToFinal >= 0 && daysToFinal <= 30) {
        notices.push({
          id: `debt-final-${debt.id}`,
          level: 'info',
          text: `La deuda «${debt.name}» vence del todo ${daysToFinal === 0 ? 'hoy' : `en ${daysToFinal} ${daysToFinal === 1 ? 'día' : 'días'}`} y aún debes ${formatMoney(status.balanceCents)}.`,
        });
      }
    }
  }

  // ---- Clientes (módulo Freelancer): solo aparecen si el espacio usa clientes -------------------------------
  if (data.clients.length > 0) {
    const finished = receivables(data, today).rows.filter((r) => r.service.status === 'done');
    if (finished.length > 0) {
      const total = finished.reduce((sum, r) => sum + r.owedCents, 0);
      notices.push({
        id: 'receivable-done',
        level: 'info',
        text: `Tienes ${formatMoney(total)} por cobrar de ${finished.length === 1 ? 'un servicio ya finalizado' : `${finished.length} servicios ya finalizados`}.`,
      });
    }
    const dependence = clientConcentration(data, today);
    if (dependence) {
      notices.push({
        id: 'client-concentration',
        level: 'info',
        text: `«${clientFullName(dependence.client)}» te pagó el ${Math.round(dependence.percent)} % de tus ingresos de los últimos 12 meses. Depender de un solo cliente es un riesgo.`,
      });
    }
    // Clientes a los que les cargaste más gastos de lo que te han pagado este año (puede ser solo que aún no cobras).
    const atLoss = clientRanking(clientSummaries(data, { range: 'year', today })).atLoss;
    if (atLoss.length > 0) {
      const worst = atLoss[0];
      const others = atLoss.length - 1;
      notices.push({
        id: 'client-at-loss',
        level: 'info',
        text: `Los gastos que cargaste a «${clientFullName(worst.client)}» (${formatMoney(worst.expenseCents)}) superan lo que te ha pagado este año (${formatMoney(worst.incomeCents)})${others > 0 ? `; pasa lo mismo con ${others === 1 ? 'otro cliente más' : `${others} clientes más`}` : ''}. Si todavía no cobras, es normal; si ya cobraste, revisa si te conviene.`,
      });
    }
  }

  // ---- Negocio (Emprendedor y Empresa): pérdidas seguidas y gastos que se disparan -----------------------------
  if (resultsEnabled(kind)) notices.push(...businessNotices(data, today));
  // ---- Empresa: poco efectivo o por debajo del punto de equilibrio ----------------------------------------------
  if (healthEnabled(kind)) notices.push(...healthNotices(data, today));
  // ---- Inventario: stock bajo o agotado en los productos que pidieron aviso ---------------------------------------
  if (data.products.length > 0) notices.push(...inventoryNotices(data));
  // ---- Facturas internas: facturas vencidas por cobrar (solo donde existen las facturas) ----------------------------
  if (invoicesEnabled(kind, data)) notices.push(...invoiceNotices(data, today));
  // ---- Departamentos: áreas que se pasaron de su presupuesto del mes o están cerca del límite -------------------------
  if (departmentsEnabled(kind, data)) notices.push(...departmentNotices(data, today));

  return notices.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1));
}
