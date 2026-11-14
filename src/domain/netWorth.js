// @ts-check
// =============================================================================
// PATRIMONIO NETO (documento maestro §5 y §20)
//
//   Patrimonio neto = Activos totales - Pasivos totales
//
// Activos = el dinero que registras con tus ingresos y gastos (lo disponible + lo
//           ahorrado en metas) + los activos que registras a mano (cuentas, inversiones,
//           vehículos, inmuebles...).
// Pasivos = lo que debes en tus deudas.
//
// Todo se CALCULA al momento a partir de tus registros (nada se guarda duplicado),
// así que al registrar un ingreso, un gasto, una deuda o un activo el patrimonio ya
// está actualizado, y la "evolución" se puede reconstruir para cualquier fecha pasada.
//
// Una deuda cuenta desde la fecha en que la registras o desde su primer pago (lo que
// ocurra primero). Si el dinero del préstamo no lo registras como ingreso o como un
// activo, el patrimonio baja por el monto de la deuda: es lo que dicen tus registros.
// =============================================================================

import { ASSET_CATEGORIES, ASSET_CATEGORY_ORDER, assetValueAt } from './assets.js';
import { replayPayments } from './debts.js';
import { addMonths, daysInMonth, monthKeyOf, toISODate } from './dates.js';
import { changePercent } from './summaries.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').Asset} Asset */
/** @typedef {import('./types.js').Debt} Debt */

/** Último día de un mes "AAAA-MM". @param {string} monthKey */
export function monthEnd(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${monthKey}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/**
 * Datos de cada deuda ya "repasados" una vez (los pagos, en orden), para consultar su saldo en cualquier fecha.
 * @param {AppData} data
 * @returns {{ debt: Debt, startDate: string, steps: { date: string, principalCents: number }[] }[]}
 */
function debtTimelines(data) {
  return data.debts.map((debt) => {
    const replay = replayPayments(debt, data.debtPayments);
    const steps = replay.steps.map((s) => ({ date: s.payment.date, principalCents: s.principalCents }));
    // `createdAt` es un instante: se pasa a la fecha LOCAL para no adelantar la deuda un día por la zona horaria.
    let start = toISODate(new Date(debt.createdAt));
    for (const s of steps) if (s.date < start) start = s.date;
    return { debt, startDate: start, steps };
  });
}

/**
 * Cuánto se debe de una deuda en una fecha (0 si aún no existía).
 * @param {{ debt: Debt, startDate: string, steps: { date: string, principalCents: number }[] }} line @param {string} date
 */
function debtBalanceAt(line, date) {
  if (date < line.startDate) return 0;
  let balance = line.debt.totalCents;
  for (const s of line.steps) if (s.date <= date) balance -= s.principalCents;
  return Math.max(0, balance);
}

/**
 * @typedef {Object} NetWorthPoint
 * @property {string} asOf
 * @property {number} availableCents       Dinero disponible (lo que puedes gastar).
 * @property {number} savedCents           Lo ahorrado en metas.
 * @property {number} moneyCents           Dinero registrado = disponible + ahorrado (puede ser negativo si falta registrar ingresos).
 * @property {{ asset: Asset, valueCents: number }[]} assets   Activos manuales con su valor en esa fecha (solo los ya adquiridos).
 * @property {number} assetsManualCents
 * @property {number} assetsCents          Activos totales = dinero registrado + activos manuales.
 * @property {{ debt: Debt, balanceCents: number }[]} debts
 * @property {number} liabilitiesCents     Pasivos totales (lo que se debe).
 * @property {number} netWorthCents
 */

/**
 * @typedef {ReturnType<typeof debtTimelines>} DebtTimelines
 */

/**
 * Dinero registrado (movimientos y aportes) hasta una fecha.
 * @param {AppData} data @param {string} asOf
 */
function moneyAt(data, asOf) {
  let money = data.settings.openingBalanceCents;
  let saved = 0;
  for (const m of data.movements) {
    if (m.date > asOf) continue;
    money += m.type === 'income' ? m.amountCents : -m.amountCents;
  }
  for (const c of data.contributions) {
    if (c.date > asOf) continue;
    saved += c.kind === 'deposit' ? c.amountCents : -c.amountCents;
  }
  // availableCents = lo que queda después de apartar lo ahorrado.
  return { moneyCents: money, savedCents: saved, availableCents: money - saved };
}

/**
 * Patrimonio en una fecha.
 * @param {AppData} data @param {string} asOf @param {DebtTimelines} [timelines]
 * @returns {NetWorthPoint}
 */
export function netWorthAt(data, asOf, timelines = debtTimelines(data)) {
  const { moneyCents, savedCents, availableCents } = moneyAt(data, asOf);
  const assets = data.assets
    .filter((a) => a.acquiredDate <= asOf)
    .map((asset) => ({ asset, valueCents: assetValueAt(asset, asOf) }));
  const assetsManualCents = assets.reduce((s, a) => s + a.valueCents, 0);
  const debts = timelines
    .map((line) => ({ debt: line.debt, balanceCents: debtBalanceAt(line, asOf) }))
    .filter((d) => d.balanceCents > 0);
  const liabilitiesCents = debts.reduce((s, d) => s + d.balanceCents, 0);
  const assetsCents = moneyCents + assetsManualCents;
  return {
    asOf, availableCents, savedCents, moneyCents, assets, assetsManualCents, assetsCents,
    debts, liabilitiesCents, netWorthCents: assetsCents - liabilitiesCents,
  };
}

/**
 * Fecha del primer registro de cualquier tipo (null si no hay ninguno).
 * @param {AppData} data @param {DebtTimelines} timelines
 */
function firstActivityDate(data, timelines) {
  /** @type {string[]} */
  const dates = [
    ...data.movements.map((m) => m.date),
    ...data.contributions.map((c) => c.date),
    ...data.assets.map((a) => a.acquiredDate),
    ...timelines.map((t) => t.startDate),
  ];
  return dates.length === 0 ? null : dates.reduce((a, b) => (a < b ? a : b));
}

/**
 * @typedef {Object} NetWorthSummary
 * @property {NetWorthPoint} now
 * @property {{ changeCents: number, percent: number | null } | null} monthly   Frente al cierre del mes anterior; null si aún no hay un mes anterior con registros.
 * @property {{ changeCents: number, percent: number | null } | null} annual    Frente al cierre del mismo mes del año pasado; null si no hay tanto historial.
 * @property {{ monthKey: string, point: NetWorthPoint }[]} series              Cierre de cada mes (el último punto es "hoy").
 * @property {boolean} hasAnything  false si no hay ni un registro (patrimonio = saldo inicial).
 */

/**
 * Resumen completo del patrimonio: hoy, variaciones y evolución mensual.
 * @param {AppData} data @param {string} today @param {{ months?: number }} [options]
 * @returns {NetWorthSummary}
 */
export function netWorthSummary(data, today, { months = 12 } = {}) {
  const timelines = debtTimelines(data);
  const currentKey = monthKeyOf(today);
  const now = netWorthAt(data, today, timelines);
  const first = firstActivityDate(data, timelines);

  /** @param {string} monthKey */
  const closing = (monthKey) => netWorthAt(data, monthKey === currentKey ? today : monthEnd(monthKey), timelines);

  /** @param {string} baseKey @returns {{ changeCents: number, percent: number | null } | null} */
  const versus = (baseKey) => {
    // Hace falta algún registro hasta el cierre de ese mes para que la comparación signifique algo.
    if (first === null || first > monthEnd(baseKey)) return null;
    const base = closing(baseKey);
    return { changeCents: now.netWorthCents - base.netWorthCents, percent: changePercent(now.netWorthCents, base.netWorthCents) };
  };

  // La serie empieza en el primer registro (o solo "hoy" si aún no hay ninguno), con un máximo de `months` meses.
  const earliestKey = addMonths(currentKey, -(months - 1));
  const startKey = first === null ? currentKey : monthKeyOf(first) > earliestKey ? monthKeyOf(first) : earliestKey;
  /** @type {NetWorthSummary['series']} */
  const series = [];
  for (let key = startKey; key <= currentKey; key = addMonths(key, 1)) series.push({ monthKey: key, point: closing(key) });

  return {
    now,
    monthly: versus(addMonths(currentKey, -1)),
    annual: versus(addMonths(currentKey, -12)),
    series,
    hasAnything: first !== null,
  };
}

/**
 * Cuánto se debía al cierre de cada mes (el último punto es "hoy"). Sale de las mismas deudas y pagos que el
 * patrimonio, así que las dos pantallas siempre coinciden. Empieza en el primer registro (máximo `months` meses).
 * @param {AppData} data @param {string} today @param {{ months?: number }} [options]
 * @returns {{ monthKey: string, owedCents: number, activeCount: number }[]}
 */
export function debtEvolution(data, today, { months = 12 } = {}) {
  return netWorthSummary(data, today, { months }).series.map(({ monthKey, point }) => ({
    monthKey, owedCents: point.liabilitiesCents, activeCount: point.debts.length,
  }));
}

/**
 * Activos manuales agrupados por categoría, de mayor a menor valor (solo las categorías con algo).
 * @param {NetWorthPoint} point
 * @returns {{ key: string, label: string, valueCents: number, count: number }[]}
 */
export function assetBreakdown(point) {
  return ASSET_CATEGORY_ORDER
    .map((key) => {
      const items = point.assets.filter((a) => a.asset.category === key);
      return { key, label: ASSET_CATEGORIES[key].label, valueCents: items.reduce((s, a) => s + a.valueCents, 0), count: items.length };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.valueCents - a.valueCents);
}
