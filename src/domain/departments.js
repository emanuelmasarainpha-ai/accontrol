// @ts-check
// =============================================================================
// DEPARTAMENTOS Y PRESUPUESTOS POR ÁREA (espacios Empresa)
// -----------------------------------------------------------------------------
// Un DEPARTAMENTO es un área de la empresa (Ventas, Administración, Operaciones…) con un
// PRESUPUESTO MENSUAL de gastos. No hay empleados ni roles: eso espera a las cuentas.
//
// Los gastos de un departamento NO se guardan aparte: son gastos normales (Finanzas) que
// llevan el departamento al que se cargan (`departmentId`). Así cada gasto cuenta una sola
// vez en «Disponible», en los resultados y en los reportes, y lo gastado por un área es
// siempre la suma de sus gastos (no se puede desincronizar).
//
// Reglas (fijas y comprobables; NO es inteligencia artificial):
//   - Solo los GASTOS se asignan a un departamento (los ingresos, no).
//   - Los pagos de deudas NO se asignan: son devolución de dinero prestado y los resultados
//     ya los muestran aparte. Quedan fuera de «gasto operativo» (y de esta pantalla).
//   - Gasto operativo de un mes = gastos de ese mes (hasta hoy) que no son pagos de deudas.
//     Siempre: gastado por áreas + sin asignar = gasto operativo del mes.
//   - Presupuesto 0 = «sin presupuesto» (el área se mide, pero no se compara).
//   - Estado de un área con presupuesto: «En orden» por debajo del 80 %, «Cerca del límite» del
//     80 % al 100 % (incluido), «Excedido» por encima del 100 %.
//   - Se compara siempre con el presupuesto ACTUAL del área: si lo cambias, los meses
//     anteriores se miden con el nuevo valor (no se guarda historial de presupuestos).
//   - «Ritmo» (solo mes en curso, desde el día 5, con presupuesto y gasto): gasto hasta hoy ÷ días
//     transcurridos × días del mes. Es una proyección lineal, no una promesa.
// =============================================================================

import { cleanText } from './contact.js';
import { daysInMonth, monthKeyOf, monthKeysEndingAt, parseISO } from './dates.js';
import { formatMoney, MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Department} Department */
/** @typedef {import('./types.js').Movement} Movement */
/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */

/** @typedef {'none' | 'ok' | 'warning' | 'over'} BudgetStatus */

/** @type {Record<BudgetStatus, string>} */
export const BUDGET_STATUS_LABELS = {
  none: 'Sin presupuesto',
  ok: 'En orden',
  warning: 'Cerca del límite',
  over: 'Excedido',
};

/** A partir de este porcentaje del presupuesto el área pasa a «Cerca del límite». */
export const WARNING_PERCENT = 80;
/** Día del mes desde el cual se calcula el ritmo (antes hay muy pocos datos). */
export const PACE_FROM_DAY = 5;

/**
 * ¿Se ofrecen los departamentos en este espacio? En Empresa siempre; en los demás, solo si ya hay departamentos
 * (por ejemplo, si se restauró una copia que los traía), para que nunca queden datos escondidos.
 * @param {WorkspaceKind | null | undefined} workspaceKind @param {Pick<AppData, 'departments'>} data
 */
export function departmentsEnabled(workspaceKind, data) {
  return workspaceKind === 'company' || (data.departments ?? []).length > 0;
}

/** @param {string} text */
const fold = (text) => text.toLocaleLowerCase('es');

// ---- Validación -----------------------------------------------------------------------------------------

/**
 * Lo que llega del formulario (todo es texto).
 * @typedef {Object} DepartmentInput
 * @property {string} name
 * @property {string} [budgetText]   Presupuesto mensual; vacío o 0 = sin presupuesto.
 */

/**
 * Valida un departamento. No se permiten dos con el mismo nombre (aunque uno esté archivado).
 * @param {DepartmentInput} input
 * @param {{ departments: Department[], exceptId?: string | null }} context
 * @returns {{ ok: true, value: Pick<Department, 'name' | 'monthlyBudgetCents'> } | { ok: false, errors: Record<string, string> }}
 */
export function validateDepartment(input, { departments, exceptId = null }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const name = cleanText(input.name);

  if (!name) errors.name = 'Ponle un nombre al departamento.';
  else if (name.length > LIMITS.departmentName) errors.name = `Máximo ${LIMITS.departmentName} caracteres.`;
  else if (departments.some((d) => d.id !== exceptId && fold(d.name) === fold(name))) errors.name = 'Ya tienes un departamento con ese nombre.';
  else if (exceptId === null && departments.length >= LIMITS.maxDepartments) {
    errors.name = `Llegaste al máximo de ${LIMITS.maxDepartments} departamentos. Borra o reutiliza alguno.`;
  }

  let monthlyBudgetCents = 0;
  const budgetText = cleanText(input.budgetText);
  if (budgetText) {
    const money = parseMoney(budgetText);
    if (!money.ok) errors.budget = money.error;
    else if (money.cents > MAX_CENTS) errors.budget = 'El monto es demasiado grande.';
    else monthlyBudgetCents = money.cents;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, monthlyBudgetCents } };
}

/**
 * @param {Pick<Department, 'name' | 'monthlyBudgetCents'>} value
 * @param {{ id: string, nowISO: string, isDemo?: boolean }} extra
 * @returns {Department}
 */
export function buildDepartment(value, { id, nowISO, isDemo = false }) {
  return {
    id,
    name: value.name,
    monthlyBudgetCents: value.monthlyBudgetCents,
    archived: false,
    createdAt: nowISO,
    updatedAt: nowISO,
    ...(isDemo ? { isDemo: true } : {}),
  };
}

/**
 * @param {Department} existing @param {Pick<Department, 'name' | 'monthlyBudgetCents'>} value @param {string} nowISO
 * @returns {Department}
 */
export function applyDepartmentEdit(existing, value, nowISO) {
  return { ...existing, name: value.name, monthlyBudgetCents: value.monthlyBudgetCents, updatedAt: nowISO };
}

/** Cómo se muestra el departamento de un gasto («Ventas»), o '' si no tiene. @param {Pick<AppData, 'departments'>} data @param {{ departmentId?: string }} movement */
export function movementDepartmentText(data, movement) {
  if (!movement.departmentId) return '';
  return (data.departments ?? []).find((d) => d.id === movement.departmentId)?.name ?? '';
}

// ---- Cálculos ---------------------------------------------------------------------------------------------

/**
 * Gastos operativos de un mes: los del mes (hasta hoy) que no son pagos de deudas.
 * @param {AppData} data @param {string} monthKey @param {string} today
 * @returns {{ operating: Movement[], debtPaymentsCents: number }}
 */
export function monthExpenses(data, monthKey, today) {
  const debtMovementIds = new Set(data.debtPayments.map((p) => p.movementId));
  /** @type {Movement[]} */
  const operating = [];
  let debtPaymentsCents = 0;
  for (const m of data.movements) {
    if (m.type !== 'expense' || m.date > today || monthKeyOf(m.date) !== monthKey) continue;
    if (debtMovementIds.has(m.id)) debtPaymentsCents += m.amountCents;
    else operating.push(m);
  }
  return { operating, debtPaymentsCents };
}

/**
 * Estado de un área según lo gastado y su presupuesto (entero, sin decimales perdidos).
 * @param {number} spentCents @param {number} budgetCents
 * @returns {BudgetStatus}
 */
export function budgetStatus(spentCents, budgetCents) {
  if (budgetCents <= 0) return 'none';
  if (spentCents > budgetCents) return 'over';
  if (spentCents * 100 >= budgetCents * WARNING_PERCENT) return 'warning';
  return 'ok';
}

/**
 * @typedef {Object} DepartmentRow
 * @property {Department} department
 * @property {number} spentCents
 * @property {number} count               Cuántos gastos suman lo gastado.
 * @property {number} budgetCents         0 = sin presupuesto.
 * @property {BudgetStatus} status
 * @property {number | null} percent      Gastado ÷ presupuesto, en % redondeado (null si no hay presupuesto).
 * @property {number | null} remainingCents  Presupuesto − gastado (negativo si se excedió); null si no hay presupuesto.
 * @property {number | null} paceCents    Proyección al cierre del mes (solo mes en curso); null si no aplica.
 * @property {boolean} paceExceeds        A ese ritmo se pasaría del presupuesto sin haberlo hecho todavía.
 */

/**
 * El mes de un vistazo: cuánto gastó cada área frente a su presupuesto y cuánto quedó sin asignar.
 * Se listan los departamentos activos y, además, los archivados que tuvieron gastos ese mes.
 * @param {AppData} data @param {string} monthKey "AAAA-MM" @param {string} today "AAAA-MM-DD"
 */
export function departmentMonth(data, monthKey, today) {
  const departments = data.departments ?? [];
  const { operating, debtPaymentsCents } = monthExpenses(data, monthKey, today);
  const known = new Set(departments.map((d) => d.id));

  /** @type {Map<string, { cents: number, count: number }>} */
  const spentBy = new Map();
  let unassignedCents = 0;
  let unassignedCount = 0;
  for (const m of operating) {
    if (m.departmentId && known.has(m.departmentId)) {
      const entry = spentBy.get(m.departmentId) ?? { cents: 0, count: 0 };
      entry.cents += m.amountCents;
      entry.count += 1;
      spentBy.set(m.departmentId, entry);
    } else {
      unassignedCents += m.amountCents;
      unassignedCount += 1;
    }
  }

  const isCurrent = monthKey === monthKeyOf(today);
  const day = parseISO(today).d;
  const [y, mo] = monthKey.split('-').map(Number);

  /** @type {DepartmentRow[]} */
  const rows = departments
    .filter((d) => !d.archived || (spentBy.get(d.id)?.cents ?? 0) > 0)
    .map((department) => {
      const spent = spentBy.get(department.id) ?? { cents: 0, count: 0 };
      // Un área archivada ya no tiene presupuesto que cumplir: solo se muestra lo que gastó.
      const budgetCents = department.archived ? 0 : department.monthlyBudgetCents;
      const status = budgetStatus(spent.cents, budgetCents);
      const paceCents = isCurrent && budgetCents > 0 && spent.cents > 0 && day >= PACE_FROM_DAY
        ? Math.round((spent.cents / day) * daysInMonth(y, mo))
        : null;
      return {
        department,
        spentCents: spent.cents,
        count: spent.count,
        budgetCents,
        status,
        percent: budgetCents > 0 ? Math.round((spent.cents * 100) / budgetCents) : null,
        remainingCents: budgetCents > 0 ? budgetCents - spent.cents : null,
        paceCents,
        paceExceeds: paceCents !== null && paceCents > budgetCents && status !== 'over',
      };
    })
    .sort((a, b) => a.department.name.localeCompare(b.department.name, 'es'));

  const assignedCents = rows.reduce((sum, r) => sum + r.spentCents, 0);
  const budgeted = rows.filter((r) => r.budgetCents > 0);
  const budgetTotalCents = budgeted.reduce((sum, r) => sum + r.budgetCents, 0);
  const budgetedSpentCents = budgeted.reduce((sum, r) => sum + r.spentCents, 0);
  // Lo que sobra en unas áreas NO tapa lo que se pasó en otras: se cuentan por separado (y `remainingCents` es la diferencia).
  const overCents = budgeted.filter((r) => r.status === 'over').reduce((sum, r) => sum + r.spentCents - r.budgetCents, 0);
  const leftCents = budgeted.filter((r) => r.status !== 'over').reduce((sum, r) => sum + r.budgetCents - r.spentCents, 0);

  return {
    monthKey,
    rows,
    unassignedCents,
    unassignedCount,
    assignedCents,
    totalSpentCents: assignedCents + unassignedCents,
    budgetTotalCents,
    budgetedSpentCents,
    remainingCents: budgetTotalCents - budgetedSpentCents,
    overCents,
    leftCents,
    budgetedCount: budgeted.length,
    overCount: rows.filter((r) => r.status === 'over').length,
    debtPaymentsCents,
  };
}

/**
 * Lo gastado por un área en los últimos `count` meses (el último es `endMonth`), del más antiguo al más reciente.
 * @param {AppData} data @param {string} departmentId @param {string} endMonth @param {string} today @param {number} [count]
 */
export function departmentHistory(data, departmentId, endMonth, today, count = 6) {
  const keys = new Set(monthKeysEndingAt(endMonth, count));
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const key of keys) totals.set(key, 0);
  const debtMovementIds = new Set(data.debtPayments.map((p) => p.movementId));
  for (const m of data.movements) {
    if (m.type !== 'expense' || m.departmentId !== departmentId || m.date > today || debtMovementIds.has(m.id)) continue;
    const key = monthKeyOf(m.date);
    if (keys.has(key)) totals.set(key, (totals.get(key) ?? 0) + m.amountCents);
  }
  return monthKeysEndingAt(endMonth, count).map((monthKey) => ({ monthKey, spentCents: totals.get(monthKey) ?? 0 }));
}

/**
 * En qué categorías gastó un área en un mes, de mayor a menor.
 * @param {AppData} data @param {string} departmentId @param {string} monthKey @param {string} today
 * @returns {{ categoryId: string, cents: number, count: number }[]}
 */
export function departmentCategories(data, departmentId, monthKey, today) {
  /** @type {Map<string, { cents: number, count: number }>} */
  const by = new Map();
  for (const m of departmentExpenses(data, departmentId, monthKey, today)) {
    const entry = by.get(m.categoryId) ?? { cents: 0, count: 0 };
    entry.cents += m.amountCents;
    entry.count += 1;
    by.set(m.categoryId, entry);
  }
  return [...by.entries()].map(([categoryId, v]) => ({ categoryId, ...v })).sort((a, b) => b.cents - a.cents || a.categoryId.localeCompare(b.categoryId));
}

/** @param {Movement} a @param {Movement} b */
const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.createdAt.localeCompare(a.createdAt);

/**
 * Los gastos de un área en un mes (sin pagos de deudas), el más reciente primero.
 * @param {AppData} data @param {string} departmentId @param {string} monthKey @param {string} today
 */
export function departmentExpenses(data, departmentId, monthKey, today) {
  return monthExpenses(data, monthKey, today).operating.filter((m) => m.departmentId === departmentId).sort(newestFirst);
}

/**
 * Los gastos del mes que no se cargaron a ningún departamento (o a uno que ya no existe), el más reciente primero.
 * @param {AppData} data @param {string} monthKey @param {string} today
 */
export function unassignedExpenses(data, monthKey, today) {
  const known = new Set((data.departments ?? []).map((d) => d.id));
  return monthExpenses(data, monthKey, today).operating.filter((m) => !m.departmentId || !known.has(m.departmentId)).sort(newestFirst);
}

/**
 * Cuántos gastos tiene un departamento (de cualquier mes): si tiene, no se borra, se archiva.
 * @param {Pick<AppData, 'movements'>} data @param {string} departmentId
 */
export function departmentUsage(data, departmentId) {
  return { expenses: data.movements.filter((m) => m.departmentId === departmentId).length };
}

// ---- Avisos ---------------------------------------------------------------------------------------------

/**
 * Avisos del mes en curso: áreas que ya se pasaron de su presupuesto (rojo) y áreas cerca del límite.
 * @param {AppData} data @param {string} today
 * @returns {{ id: string, level: 'critical' | 'info', text: string }[]}
 */
export function departmentNotices(data, today) {
  if ((data.departments ?? []).length === 0) return [];
  const month = departmentMonth(data, monthKeyOf(today), today);
  const over = month.rows.filter((r) => r.status === 'over');
  const near = month.rows.filter((r) => r.status === 'warning');
  /** @type {{ id: string, level: 'critical' | 'info', text: string }[]} */
  const notices = [];
  if (over.length === 1) {
    const r = over[0];
    notices.push({
      id: 'departments-over',
      level: 'critical',
      text: `«${r.department.name}» ya se pasó de su presupuesto de este mes: ${formatMoney(r.spentCents)} de ${formatMoney(r.budgetCents)}. Mira «Departamentos».`,
    });
  } else if (over.length > 1) {
    notices.push({
      id: 'departments-over',
      level: 'critical',
      text: `${over.length} departamentos ya se pasaron de su presupuesto de este mes (${over.map((r) => `«${r.department.name}»`).join(', ')}). Mira «Departamentos».`,
    });
  }
  if (near.length > 0) {
    notices.push({
      id: 'departments-near',
      level: 'info',
      text: near.length === 1
        ? `«${near[0].department.name}» ya usó el ${near[0].percent} % de su presupuesto de este mes.`
        : `${near.length} departamentos están cerca de su límite de este mes (${near.map((r) => `«${r.department.name}»`).join(', ')}).`,
    });
  }
  return notices;
}
