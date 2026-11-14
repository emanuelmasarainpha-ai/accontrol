// @ts-check
// =============================================================================
// RESÚMENES Y CÁLCULOS DERIVADOS
// -----------------------------------------------------------------------------
// Principio del documento maestro (§16): cada dato se registra UNA sola vez y
// todo lo demás se CALCULA a partir de él. Nada de lo que sale de este archivo
// se guarda: se recalcula cada vez, así que nunca puede quedar desactualizado.
//
// Definiciones (están escritas aquí para que no haya dudas):
//   Balance del mes  = ingresos del mes - gastos del mes                  (§17)
//   Ahorrado en metas = aportes - retiros de todas las metas
//   Disponible       = saldo inicial + ingresos - gastos - ahorrado en metas
// Solo cuentan los registros con fecha de hoy o anterior.
// =============================================================================

import { addMonths, monthKeyOf, monthLabel, monthName, monthShortLabel } from './dates.js';
import { CLASSIFICATIONS_BY_TYPE } from './types.js';
import { percentOf } from './money.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').Movement} Movement */
/** @typedef {import('./types.js').Contribution} Contribution */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').MovementType} MovementType */
/** @typedef {import('./types.js').Classification} Classification */

/** @param {Contribution} c */
const signed = (c) => (c.kind === 'deposit' ? c.amountCents : -c.amountCents);

/**
 * Ingresos, gastos y balance de un mes.
 * @param {Movement[]} movements @param {string} monthKey
 */
export function monthTotals(movements, monthKey) {
  let incomeCents = 0;
  let expenseCents = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  for (const m of movements) {
    if (monthKeyOf(m.date) !== monthKey) continue;
    if (m.type === 'income') {
      incomeCents += m.amountCents;
      incomeCount += 1;
    } else {
      expenseCents += m.amountCents;
      expenseCount += 1;
    }
  }
  return { incomeCents, expenseCents, balanceCents: incomeCents - expenseCents, incomeCount, expenseCount };
}

/**
 * Aportes - retiros. Con `monthKey` solo cuenta ese mes.
 * @param {Contribution[]} contributions @param {string | null} [monthKey]
 */
export function netContributions(contributions, monthKey = null) {
  let total = 0;
  for (const c of contributions) {
    if (monthKey && monthKeyOf(c.date) !== monthKey) continue;
    total += signed(c);
  }
  return total;
}

/**
 * Totales generales de todo el historial hasta hoy.
 * @param {AppData} data @param {string} today
 */
export function overallTotals(data, today) {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const m of data.movements) {
    if (m.date > today) continue;
    if (m.type === 'income') incomeCents += m.amountCents;
    else expenseCents += m.amountCents;
  }
  const savedCents = data.contributions.reduce((sum, c) => (c.date > today ? sum : sum + signed(c)), 0);
  const openingCents = data.settings.openingBalanceCents;
  return {
    openingCents,
    incomeCents,
    expenseCents,
    savedCents,
    availableCents: openingCents + incomeCents - expenseCents - savedCents,
  };
}

/**
 * Serie mensual para gráficos.
 * @param {Movement[]} movements @param {Contribution[]} contributions @param {string[]} monthKeys
 */
export function monthlySeries(movements, contributions, monthKeys) {
  return monthKeys.map((monthKey) => {
    const t = monthTotals(movements, monthKey);
    return {
      monthKey,
      incomeCents: t.incomeCents,
      expenseCents: t.expenseCents,
      balanceCents: t.balanceCents,
      savedCents: netContributions(contributions, monthKey),
    };
  });
}

/** @typedef {'month' | 'quarter' | 'year'} Granularity */

/** Nombres de las vistas de Estadísticas (documento §6: mensual, trimestral y anual). */
export const GRANULARITY_LABELS = /** @type {const} */ ({ month: 'Mensual', quarter: 'Trimestral', year: 'Anual' });
export const GRANULARITIES = /** @type {Granularity[]} */ (['month', 'quarter', 'year']);

/** Cuántos períodos se muestran en cada vista (6 meses, 4 trimestres, 3 años). */
export const PERIOD_COUNT = /** @type {const} */ ({ month: 6, quarter: 4, year: 3 });

/**
 * @typedef {Object} PeriodTotals
 * @property {string} key            "2026-07", "2026-T3" o "2026".
 * @property {string} label          "julio 2026", "T3 2026 (julio–septiembre)" o "2026".
 * @property {string} shortLabel     Para el eje del gráfico: "jul", "T3 2026", "2026".
 * @property {string} firstMonth     Primer mes del período ("AAAA-MM").
 * @property {string} lastMonth      Último mes del período.
 * @property {number} incomeCents
 * @property {number} expenseCents
 * @property {number} balanceCents   Ingresos - gastos.
 * @property {number} savedCents     Aportes - retiros de metas.
 * @property {boolean} partial       true si el período todavía no terminó (solo cuenta lo registrado hasta hoy).
 */

/**
 * Ingresos y gastos por mes, trimestre calendario (T1 = ene–mar) o año calendario, terminando en el período
 * que contiene `endMonthKey`. Sirve para comparar períodos del mismo tamaño; el último puede estar a medias.
 * @param {Movement[]} movements @param {Contribution[]} contributions
 * @param {string} endMonthKey @param {Granularity} granularity @param {string} nowKey Mes actual ("AAAA-MM").
 * @returns {PeriodTotals[]}
 */
export function periodSeries(movements, contributions, endMonthKey, granularity, nowKey) {
  const [endYear, endMonth] = endMonthKey.split('-').map(Number);
  const count = PERIOD_COUNT[granularity];
  const monthsPer = granularity === 'month' ? 1 : granularity === 'quarter' ? 3 : 12;
  // Primer mes del período que contiene `endMonthKey`.
  const endFirst = granularity === 'month'
    ? endMonthKey
    : granularity === 'quarter'
      ? `${String(endYear).padStart(4, '0')}-${String(Math.floor((endMonth - 1) / 3) * 3 + 1).padStart(2, '0')}`
      : `${String(endYear).padStart(4, '0')}-01`;

  /** @type {PeriodTotals[]} */
  const periods = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const firstMonth = addMonths(endFirst, -i * monthsPer);
    const lastMonth = addMonths(firstMonth, monthsPer - 1);
    const year = firstMonth.slice(0, 4);
    const quarter = Math.floor((Number(firstMonth.slice(5, 7)) - 1) / 3) + 1;
    let key = firstMonth;
    let label = monthLabel(firstMonth);
    let shortLabel = monthShortLabel(firstMonth);
    if (granularity === 'quarter') {
      key = `${year}-T${quarter}`;
      label = `T${quarter} ${year} (${monthName(firstMonth)}–${monthName(lastMonth)})`;
      shortLabel = `T${quarter} ${year}`;
    } else if (granularity === 'year') {
      key = year;
      label = year;
      shortLabel = year;
    }

    let incomeCents = 0;
    let expenseCents = 0;
    for (const m of movements) {
      const mk = monthKeyOf(m.date);
      if (mk < firstMonth || mk > lastMonth) continue;
      if (m.type === 'income') incomeCents += m.amountCents;
      else expenseCents += m.amountCents;
    }
    let savedCents = 0;
    for (const c of contributions) {
      const mk = monthKeyOf(c.date);
      if (mk >= firstMonth && mk <= lastMonth) savedCents += signed(c);
    }
    periods.push({
      key, label, shortLabel, firstMonth, lastMonth,
      incomeCents, expenseCents, balanceCents: incomeCents - expenseCents, savedCents,
      partial: lastMonth >= nowKey,
    });
  }
  return periods;
}

/**
 * Dinero disponible al final de cada mes (para ver su evolución).
 * @param {AppData} data @param {string[]} monthKeys @param {string} today
 */
export function availableByMonthEnd(data, monthKeys, today) {
  return monthKeys.map((monthKey) => {
    let total = data.settings.openingBalanceCents;
    for (const m of data.movements) {
      if (m.date > today || monthKeyOf(m.date) > monthKey) continue;
      total += m.type === 'income' ? m.amountCents : -m.amountCents;
    }
    for (const c of data.contributions) {
      if (c.date > today || monthKeyOf(c.date) > monthKey) continue;
      total -= signed(c);
    }
    return { monthKey, availableCents: total };
  });
}

/**
 * Total por categoría en un mes, de mayor a menor.
 * @param {Movement[]} movements @param {Category[]} categories
 * @param {MovementType} type @param {string} monthKey
 */
export function totalsByCategory(movements, categories, type, monthKey) {
  /** @type {Map<string, { totalCents: number, count: number }>} */
  const map = new Map();
  let grand = 0;
  for (const m of movements) {
    if (m.type !== type || monthKeyOf(m.date) !== monthKey) continue;
    const entry = map.get(m.categoryId) ?? { totalCents: 0, count: 0 };
    entry.totalCents += m.amountCents;
    entry.count += 1;
    map.set(m.categoryId, entry);
    grand += m.amountCents;
  }
  return [...map.entries()]
    .map(([categoryId, e]) => ({
      categoryId,
      name: categories.find((c) => c.id === categoryId)?.name ?? 'Sin categoría',
      totalCents: e.totalCents,
      count: e.count,
      percent: percentOf(e.totalCents, grand),
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, 'es'));
}

/**
 * Reparto por clasificación (fijo / variable / extraordinario o discrecional) en un mes.
 * @param {Movement[]} movements @param {MovementType} type @param {string} monthKey
 * @returns {{ classification: Classification, totalCents: number, percent: number }[]}
 */
export function totalsByClassification(movements, type, monthKey) {
  const order = CLASSIFICATIONS_BY_TYPE[type];
  const sums = new Map(order.map((c) => [c, 0]));
  let grand = 0;
  for (const m of movements) {
    if (m.type !== type || monthKeyOf(m.date) !== monthKey) continue;
    sums.set(m.classification, (sums.get(m.classification) ?? 0) + m.amountCents);
    grand += m.amountCents;
  }
  return order.map((classification) => {
    const totalCents = sums.get(classification) ?? 0;
    return { classification, totalCents, percent: percentOf(totalCents, grand) };
  });
}

/**
 * Variación porcentual entre dos valores; null si no hay base de comparación.
 * @param {number} current @param {number} previous
 * @returns {number | null}
 */
export function changePercent(current, previous) {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Indicadores de la pantalla Estadísticas (documento §6) para un mes elegido.
 * Los promedios y "mayor/más frecuente" consideran todo el historial hasta ese mes.
 * @param {AppData} data @param {string} monthKey @param {string} today
 */
export function statsIndicators(data, monthKey, today) {
  const upTo = data.movements.filter((m) => m.date <= today && monthKeyOf(m.date) <= monthKey);
  const prevKey = shiftMonth(monthKey, -1);

  /** @param {MovementType} type */
  const averageMonthly = (type) => {
    /** @type {Map<string, number>} */
    const perMonth = new Map();
    for (const m of upTo) {
      if (m.type !== type) continue;
      perMonth.set(monthKeyOf(m.date), (perMonth.get(monthKeyOf(m.date)) ?? 0) + m.amountCents);
    }
    if (perMonth.size === 0) return null;
    const total = [...perMonth.values()].reduce((a, b) => a + b, 0);
    return Math.round(total / perMonth.size);
  };

  const incomes = upTo.filter((m) => m.type === 'income');
  const biggest = incomes.reduce((best, m) => (!best || m.amountCents > best.amountCents ? m : best), /** @type {Movement | null} */ (null));

  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const m of incomes) freq.set(m.categoryId, (freq.get(m.categoryId) ?? 0) + 1);
  const topFreq = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];

  const thisIncome = monthTotals(data.movements, monthKey).incomeCents;
  const thisExpense = monthTotals(data.movements, monthKey).expenseCents;
  const prev = monthTotals(data.movements, prevKey);

  const expenseCats = totalsByCategory(data.movements, data.categories, 'expense', monthKey);
  const monthNet = netContributions(data.contributions.filter((c) => c.date <= today), monthKey);

  return {
    income: {
      avgMonthlyCents: averageMonthly('income'),
      biggest,
      biggestCategoryName: biggest ? data.categories.find((c) => c.id === biggest.categoryId)?.name ?? 'Sin categoría' : null,
      mostFrequent: topFreq
        ? { name: data.categories.find((c) => c.id === topFreq[0])?.name ?? 'Sin categoría', count: topFreq[1] }
        : null,
      changePercent: changePercent(thisIncome, prev.incomeCents),
    },
    expense: {
      avgMonthlyCents: averageMonthly('expense'),
      top: expenseCats[0] ?? null,
      low: expenseCats.length >= 2 ? expenseCats[expenseCats.length - 1] : null,
      changePercent: changePercent(thisExpense, prev.expenseCents),
    },
    saving: {
      monthNetCents: monthNet,
      ratePercent: thisIncome > 0 ? percentOf(monthNet, thisIncome) : null,
      accumulatedCents: netContributions(data.contributions.filter((c) => c.date <= today)),
    },
  };
}

/** @param {string} monthKey @param {number} delta */
function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}
