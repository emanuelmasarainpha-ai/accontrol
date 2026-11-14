// @ts-check
// =============================================================================
// MÓDULO EMPRENDEDOR (documento maestro §10): estado de resultados simplificado, indicadores, comparación entre
// períodos, proyección y avisos de negocio.
//
// Todo son CUENTAS CON REGLAS FIJAS sobre los ingresos y gastos que registraste en el espacio (no es inteligencia
// artificial) y se calcula siempre al momento: nada de esto se guarda. Dinero en centavos enteros.
//
// Cómo se definen las cifras (la pantalla las repite para que nadie tenga que adivinar):
//  - Ingresos / Gastos: los movimientos del espacio con fecha hasta hoy. «Separados de los personales» se cumple
//    porque cada espacio de trabajo tiene sus propios movimientos.
//  - Beneficio neto = ingresos - gastos. Se registra cuando entra o sale el dinero (no hay cuentas por cobrar ni
//    inventario todavía), así que beneficio y flujo de caja son el mismo número, salvo por los aportes a metas.
//  - Los pagos de deudas cuentan como gasto (así se registran) pero incluyen capital, que contablemente no es un
//    gasto del negocio; por eso se muestran aparte y se da también el «beneficio antes de pagos de deudas».
//  - Margen de ganancia = beneficio ÷ ingresos. Rentabilidad = beneficio ÷ gastos (lo que ganas por cada peso que
//    gastas). Si el denominador es 0, no hay porcentaje (null).
//  - Proyección: tendencia lineal (mínimos cuadrados) de los últimos meses COMPLETOS, con un rango igual a la
//    variación típica de tus resultados. Es una estimación matemática, no una promesa.
// =============================================================================

import { addMonths, monthKeyOf, monthKeysEndingAt, monthLabel, monthName } from './dates.js';
import { formatMoney } from './money.js';
import { changePercent } from './summaries.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */
/** @typedef {import('./summaries.js').Granularity} Granularity */
/** @typedef {import('./notices.js').Notice} Notice */

/** Modalidades que usan el módulo de resultados. */
const RESULT_KINDS = /** @type {WorkspaceKind[]} */ (['entrepreneur', 'company']);

/** ¿Este tipo de espacio muestra Resultados? @param {WorkspaceKind | null | undefined} kind */
export function resultsEnabled(kind) {
  return kind != null && RESULT_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PeriodBounds
 * @property {Granularity} granularity
 * @property {string} key        "2026-07", "2026-T3" o "2026".
 * @property {string} label      "julio 2026", "T3 2026 (julio–septiembre)" o "2026".
 * @property {string} firstMonth "AAAA-MM"
 * @property {string} lastMonth  "AAAA-MM"
 * @property {number} months     1, 3 o 12.
 */

const MONTHS_PER = /** @type {const} */ ({ month: 1, quarter: 3, year: 12 });

/**
 * El período (mes, trimestre calendario o año calendario) que contiene el mes indicado.
 * @param {Granularity} granularity @param {string} monthKey "AAAA-MM"
 * @returns {PeriodBounds}
 */
export function periodBounds(granularity, monthKey) {
  const year = monthKey.slice(0, 4);
  const month = Number(monthKey.slice(5, 7));
  const months = MONTHS_PER[granularity];
  let firstMonth = monthKey;
  if (granularity === 'quarter') firstMonth = `${year}-${String((Math.floor((month - 1) / 3)) * 3 + 1).padStart(2, '0')}`;
  else if (granularity === 'year') firstMonth = `${year}-01`;
  const lastMonth = addMonths(firstMonth, months - 1);
  let key = firstMonth;
  let label = monthLabel(firstMonth);
  if (granularity === 'quarter') {
    const q = Math.floor((Number(firstMonth.slice(5, 7)) - 1) / 3) + 1;
    key = `${year}-T${q}`;
    label = `T${q} ${year} (${monthName(firstMonth)}–${monthName(lastMonth)})`;
  } else if (granularity === 'year') {
    key = year;
    label = year;
  }
  return { granularity, key, label, firstMonth, lastMonth, months };
}

/**
 * El mismo tipo de período, desplazado cierta cantidad de meses (negativo = hacia atrás).
 * @param {PeriodBounds} bounds @param {number} deltaMonths
 */
export function shiftPeriod(bounds, deltaMonths) {
  return periodBounds(bounds.granularity, addMonths(bounds.firstMonth, deltaMonths));
}

// ---------------------------------------------------------------------------
// Estado de resultados
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CategoryRow
 * @property {string} categoryId
 * @property {string} name
 * @property {number} cents
 * @property {number} percent  Sobre el total de ingresos (o de gastos) del período.
 */

/**
 * @typedef {Object} IncomeStatement
 * @property {PeriodBounds} period
 * @property {boolean} partial               true si el período todavía no terminó (solo cuenta hasta hoy).
 * @property {boolean} hasData               Hubo al menos un ingreso o gasto.
 * @property {number} incomeCents
 * @property {number} expenseCents
 * @property {number} netCents               Beneficio neto = ingresos - gastos.
 * @property {number | null} marginPercent        Beneficio ÷ ingresos (null si no hubo ingresos).
 * @property {number | null} profitabilityPercent Beneficio ÷ gastos (null si no hubo gastos).
 * @property {number} debtPaymentsCents      Parte de los gastos que son pagos de deudas.
 * @property {number} netBeforeDebtCents     Beneficio antes de pagos de deudas.
 * @property {number} incomeCount
 * @property {number} expenseCount
 * @property {CategoryRow[]} incomeByCategory
 * @property {CategoryRow[]} expenseByCategory
 */

/**
 * @param {Map<string, number>} totals @param {number} total @param {Map<string, string>} names
 * @returns {CategoryRow[]}
 */
function categoryRows(totals, total, names) {
  /** @type {CategoryRow[]} */
  const rows = [...totals.entries()].map(([categoryId, cents]) => ({
    categoryId,
    name: names.get(categoryId) ?? 'Sin categoría',
    cents,
    percent: total > 0 ? (cents / total) * 100 : 0,
  }));
  rows.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, 'es'));
  return rows;
}

/**
 * Estado de resultados simplificado de un período: ingresos - gastos = beneficio neto, con sus porcentajes.
 * @param {AppData} data @param {PeriodBounds} period @param {string} today "AAAA-MM-DD"
 * @returns {IncomeStatement}
 */
export function incomeStatement(data, period, today) {
  const debtMovementIds = new Set(data.debtPayments.map((p) => p.movementId));
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  /** @type {Map<string, number>} */ const incomeCats = new Map();
  /** @type {Map<string, number>} */ const expenseCats = new Map();
  let incomeCents = 0;
  let expenseCents = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  let debtPaymentsCents = 0;
  for (const m of data.movements) {
    if (m.date > today) continue; // un respaldo puede traer fechas futuras: aún no pasaron
    const mk = monthKeyOf(m.date);
    if (mk < period.firstMonth || mk > period.lastMonth) continue;
    if (m.type === 'income') {
      incomeCents += m.amountCents;
      incomeCount += 1;
      incomeCats.set(m.categoryId, (incomeCats.get(m.categoryId) ?? 0) + m.amountCents);
    } else {
      expenseCents += m.amountCents;
      expenseCount += 1;
      expenseCats.set(m.categoryId, (expenseCats.get(m.categoryId) ?? 0) + m.amountCents);
      if (debtMovementIds.has(m.id)) debtPaymentsCents += m.amountCents;
    }
  }
  const netCents = incomeCents - expenseCents;
  return {
    period,
    partial: period.lastMonth >= today.slice(0, 7),
    hasData: incomeCount + expenseCount > 0,
    incomeCents,
    expenseCents,
    netCents,
    marginPercent: incomeCents > 0 ? (netCents / incomeCents) * 100 : null,
    profitabilityPercent: expenseCents > 0 ? (netCents / expenseCents) * 100 : null,
    debtPaymentsCents,
    netBeforeDebtCents: netCents + debtPaymentsCents,
    incomeCount,
    expenseCount,
    incomeByCategory: categoryRows(incomeCats, incomeCents, names),
    expenseByCategory: categoryRows(expenseCats, expenseCents, names),
  };
}

// ---------------------------------------------------------------------------
// Comparación entre períodos
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Delta
 * @property {number} diffCents          Actual - base.
 * @property {number | null} percent     Variación %; null si la base es 0 o negativa (no hay con qué comparar).
 */

/** @param {number} current @param {number} base @returns {Delta} */
const delta = (current, base) => ({ diffCents: current - base, percent: changePercent(current, base) });

/**
 * @typedef {Object} ComparisonColumn
 * @property {IncomeStatement} statement
 * @property {Delta} income
 * @property {Delta} expense
 * @property {Delta} net
 * @property {number | null} marginPoints   Diferencia del margen en puntos porcentuales (null si falta alguno).
 */

/**
 * @typedef {Object} PeriodComparison
 * @property {IncomeStatement} current
 * @property {ComparisonColumn} previous        El período anterior (mes anterior, trimestre anterior, año anterior).
 * @property {ComparisonColumn | null} yearAgo  El mismo período un año antes; null cuando ya es el período anterior (vista anual).
 */

/**
 * Compara el período actual con el anterior y con el mismo período del año anterior (§10).
 * @param {AppData} data @param {Granularity} granularity @param {string} monthKey Mes dentro del período a mirar.
 * @param {string} today
 * @returns {PeriodComparison}
 */
export function periodComparison(data, granularity, monthKey, today) {
  const bounds = periodBounds(granularity, monthKey);
  const current = incomeStatement(data, bounds, today);
  /** @param {PeriodBounds} other @returns {ComparisonColumn} */
  const column = (other) => {
    const statement = incomeStatement(data, other, today);
    return {
      statement,
      income: delta(current.incomeCents, statement.incomeCents),
      expense: delta(current.expenseCents, statement.expenseCents),
      net: delta(current.netCents, statement.netCents),
      marginPoints: current.marginPercent !== null && statement.marginPercent !== null ? current.marginPercent - statement.marginPercent : null,
    };
  };
  return {
    current,
    previous: column(shiftPeriod(bounds, -bounds.months)),
    yearAgo: granularity === 'year' ? null : column(shiftPeriod(bounds, -12)),
  };
}

// ---------------------------------------------------------------------------
// Meses: serie, acumulado y veredicto
// ---------------------------------------------------------------------------

/**
 * Ingresos y gastos por mes (solo hasta hoy), en una sola pasada.
 * @param {AppData} data @param {string} today
 * @returns {Map<string, { incomeCents: number, expenseCents: number, count: number }>}
 */
function monthBuckets(data, today) {
  /** @type {Map<string, { incomeCents: number, expenseCents: number, count: number }>} */
  const buckets = new Map();
  for (const m of data.movements) {
    if (m.date > today) continue;
    const key = monthKeyOf(m.date);
    const b = buckets.get(key) ?? { incomeCents: 0, expenseCents: 0, count: 0 };
    if (m.type === 'income') b.incomeCents += m.amountCents;
    else b.expenseCents += m.amountCents;
    b.count += 1;
    buckets.set(key, b);
  }
  return buckets;
}

/**
 * @typedef {Object} MonthResult
 * @property {string} key
 * @property {number} incomeCents
 * @property {number} expenseCents
 * @property {number} netCents
 * @property {number | null} marginPercent
 * @property {boolean} hasData
 */

/**
 * Resultados de los últimos `count` meses terminando en el mes de `today` (el último puede estar a medias).
 * @param {AppData} data @param {string} today @param {number} [count]
 * @returns {MonthResult[]}
 */
export function monthlyResults(data, today, count = 6) {
  const buckets = monthBuckets(data, today);
  return monthKeysEndingAt(today.slice(0, 7), count).map((key) => {
    const b = buckets.get(key);
    const incomeCents = b?.incomeCents ?? 0;
    const expenseCents = b?.expenseCents ?? 0;
    return {
      key,
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
      marginPercent: incomeCents > 0 ? ((incomeCents - expenseCents) / incomeCents) * 100 : null,
      hasData: (b?.count ?? 0) > 0,
    };
  });
}

/**
 * Beneficio acumulado: lo que va del año y desde el primer registro.
 * @param {AppData} data @param {string} today
 */
export function accumulatedProfit(data, today) {
  const year = today.slice(0, 4);
  let yearToDateCents = 0;
  let sinceStartCents = 0;
  /** @type {string | null} */
  let firstMonth = null;
  for (const [key, b] of monthBuckets(data, today)) {
    const net = b.incomeCents - b.expenseCents;
    sinceStartCents += net;
    if (key.slice(0, 4) === year) yearToDateCents += net;
    if (firstMonth === null || key < firstMonth) firstMonth = key;
  }
  return { year, yearToDateCents, sinceStartCents, firstMonth };
}

/**
 * Los meses completos de historia: desde el primer mes con registros hasta el mes anterior al actual.
 * @param {AppData} data @param {string} today
 * @returns {{ firstMonth: string | null, keys: string[], buckets: ReturnType<typeof monthBuckets> }}
 */
function completeMonths(data, today) {
  const buckets = monthBuckets(data, today);
  const nowKey = today.slice(0, 7);
  let firstMonth = null;
  for (const key of buckets.keys()) if (firstMonth === null || key < firstMonth) firstMonth = key;
  /** @type {string[]} */
  const keys = [];
  if (firstMonth !== null) {
    for (let k = firstMonth; k < nowKey; k = addMonths(k, 1)) keys.push(k);
  }
  return { firstMonth, keys, buckets };
}

/** Cuántos meses completos mira el veredicto. */
export const VERDICT_MONTHS = 3;

/**
 * ¿El negocio genera valor o solo movimiento de dinero? (el objetivo del §10). Mira los últimos meses COMPLETOS.
 * Devuelve null si todavía no hay al menos 2 meses completos con ingresos.
 * @param {AppData} data @param {string} today
 * @returns {{ state: 'value' | 'mixed' | 'movement', months: { key: string, netCents: number }[], profitableMonths: number, text: string } | null}
 */
export function businessVerdict(data, today) {
  const { keys, buckets } = completeMonths(data, today);
  const used = keys.slice(-VERDICT_MONTHS);
  if (used.length < 2) return null;
  const months = used.map((key) => {
    const b = buckets.get(key);
    return { key, netCents: (b?.incomeCents ?? 0) - (b?.expenseCents ?? 0), incomeCents: b?.incomeCents ?? 0 };
  });
  if (!months.some((m) => m.incomeCents > 0)) return null;
  const profitableMonths = months.filter((m) => m.netCents > 0).length;
  const n = months.length;
  /** @type {'value' | 'mixed' | 'movement'} */
  let state = 'mixed';
  let text = `Tu negocio tuvo beneficio en ${profitableMonths} de los últimos ${n} meses completos.`;
  if (profitableMonths === n) {
    state = 'value';
    text = `Tu negocio generó beneficio en cada uno de los últimos ${n} meses completos.`;
  } else if (profitableMonths === 0) {
    state = 'movement';
    text = `En los últimos ${n} meses completos entró dinero, pero los gastos igualaron o superaron a los ingresos: por ahora hay movimiento de dinero, no beneficio.`;
  }
  return { state, months: months.map(({ key, netCents }) => ({ key, netCents })), profitableMonths, text };
}

// ---------------------------------------------------------------------------
// Proyección
// ---------------------------------------------------------------------------

/** Mínimo de meses completos de historia para proyectar. */
export const MIN_PROJECTION_MONTHS = 3;
/** Máximo de meses completos recientes que se usan. */
export const PROJECTION_WINDOW = 6;
/** Cuántos meses hacia adelante se proyectan (empezando por el mes en curso). */
export const PROJECTION_HORIZON = 3;

/**
 * Recta de mínimos cuadrados de los valores (x = 0, 1, 2...).
 * @param {number[]} values
 */
function linearFit(values) {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  values.forEach((y, x) => {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) ** 2;
  });
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * Desviación típica de los residuos (cuánto se aleja cada mes de la recta). 0 con menos de 3 datos.
 * @param {number[]} values @param {{ slope: number, intercept: number }} fit
 */
function residualSd(values, fit) {
  const n = values.length;
  if (n < 3) return 0;
  const sse = values.reduce((s, y, x) => s + (y - (fit.intercept + fit.slope * x)) ** 2, 0);
  return Math.sqrt(sse / (n - 2));
}

/**
 * @typedef {Object} ProjectedMonth
 * @property {string} key
 * @property {boolean} current        Es el mes en curso (todavía a medias).
 * @property {number} incomeCents
 * @property {number} expenseCents
 * @property {number} netCents
 * @property {number} netLowCents     Extremo bajo del rango (beneficio - variación típica).
 * @property {number} netHighCents
 */

/**
 * @typedef {Object} Projection
 * @property {true} ok
 * @property {string[]} basisMonths           Meses completos usados.
 * @property {ProjectedMonth[]} months
 * @property {{ incomeCents: number, expenseCents: number, netCents: number }} totals   Suma de los meses proyectados.
 * @property {number} incomeSlopeCents        Cuánto sube (o baja) el ingreso por mes, en promedio.
 * @property {number} expenseSlopeCents
 * @property {boolean} lowConfidence
 * @property {string[]} reasons               Por qué la estimación es poco firme.
 */

/**
 * Proyecta ingresos, gastos y beneficio con la tendencia de los últimos meses completos (§10).
 * Si falta historia devuelve `ok: false` con el motivo, para que la pantalla lo explique en vez de inventar cifras.
 * @param {AppData} data @param {string} today
 * @returns {Projection | { ok: false, reason: 'no-data' | 'few-months', haveMonths: number, needMonths: number }}
 */
export function projectResults(data, today) {
  const { firstMonth, keys, buckets } = completeMonths(data, today);
  if (firstMonth === null) return { ok: false, reason: 'no-data', haveMonths: 0, needMonths: MIN_PROJECTION_MONTHS };
  if (keys.length < MIN_PROJECTION_MONTHS) {
    return { ok: false, reason: 'few-months', haveMonths: keys.length, needMonths: MIN_PROJECTION_MONTHS };
  }
  const basisMonths = keys.slice(-PROJECTION_WINDOW);
  const incomes = basisMonths.map((k) => buckets.get(k)?.incomeCents ?? 0);
  const expenses = basisMonths.map((k) => buckets.get(k)?.expenseCents ?? 0);
  const nets = incomes.map((v, i) => v - expenses[i]);
  const incomeFit = linearFit(incomes);
  const expenseFit = linearFit(expenses);
  const netFit = linearFit(nets);
  const sdNet = residualSd(nets, netFit);
  const k = basisMonths.length;
  const nowKey = today.slice(0, 7);

  /** @type {ProjectedMonth[]} */
  const months = [];
  for (let i = 0; i < PROJECTION_HORIZON; i += 1) {
    const x = k + i;
    const incomeCents = Math.max(0, Math.round(incomeFit.intercept + incomeFit.slope * x));
    const expenseCents = Math.max(0, Math.round(expenseFit.intercept + expenseFit.slope * x));
    const netCents = incomeCents - expenseCents;
    months.push({
      key: addMonths(nowKey, i),
      current: i === 0,
      incomeCents,
      expenseCents,
      netCents,
      netLowCents: Math.round(netCents - sdNet),
      netHighCents: Math.round(netCents + sdNet),
    });
  }

  /** @type {string[]} */
  const reasons = [];
  if (k < PROJECTION_WINDOW) reasons.push(`Solo hay ${k} meses completos de historia (con ${PROJECTION_WINDOW} o más la estimación es más firme).`);
  const meanNet = nets.reduce((s, v) => s + v, 0) / k;
  if (sdNet > Math.abs(meanNet)) reasons.push('Tus resultados cambian mucho de un mes a otro.');

  return {
    ok: true,
    basisMonths,
    months,
    totals: {
      incomeCents: months.reduce((s, m) => s + m.incomeCents, 0),
      expenseCents: months.reduce((s, m) => s + m.expenseCents, 0),
      netCents: months.reduce((s, m) => s + m.netCents, 0),
    },
    incomeSlopeCents: Math.round(incomeFit.slope),
    expenseSlopeCents: Math.round(expenseFit.slope),
    lowConfidence: reasons.length > 0,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Avisos de negocio
// ---------------------------------------------------------------------------

/** Subida de gastos (frente al mes anterior) a partir de la cual se avisa. */
export const EXPENSE_JUMP = 0.3;

/**
 * Avisos propios de un espacio de negocio (reglas fijas):
 *  - dos meses completos seguidos con pérdida (rojo);
 *  - los gastos del último mes completo subieron 30 % o más frente al anterior y más de lo que subieron los ingresos.
 * @param {AppData} data @param {string} today
 * @returns {Notice[]}
 */
export function businessNotices(data, today) {
  /** @type {Notice[]} */
  const notices = [];
  const { keys, buckets } = completeMonths(data, today);
  if (keys.length < 2) return notices;
  const last = keys[keys.length - 1];
  const before = keys[keys.length - 2];
  const a = buckets.get(before);
  const b = buckets.get(last);
  if (!a || !b) return notices;
  const netA = a.incomeCents - a.expenseCents;
  const netB = b.incomeCents - b.expenseCents;
  if (netA < 0 && netB < 0) {
    notices.push({
      id: 'business-loss-streak',
      level: 'critical',
      text: `Tu negocio cerró ${monthName(before)} y ${monthName(last)} con pérdida (${formatMoney(-netA)} y ${formatMoney(-netB)}). Revisa en Finanzas → Resultados qué gastos pesan más.`,
    });
  }
  const expenseGrowth = b.expenseCents - a.expenseCents;
  const incomeGrowth = b.incomeCents - a.incomeCents;
  if (a.expenseCents > 0 && b.expenseCents >= a.expenseCents * (1 + EXPENSE_JUMP) && expenseGrowth > incomeGrowth) {
    const percent = Math.round((expenseGrowth / a.expenseCents) * 100);
    notices.push({
      id: 'business-expenses-up',
      level: 'info',
      text: `Los gastos de ${monthName(last)} subieron ${percent} % frente a ${monthName(before)} (${formatMoney(expenseGrowth, { sign: true })}), más de lo que crecieron los ingresos (${formatMoney(incomeGrowth, { sign: true })}).`,
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------
// Categorías sugeridas para un negocio
// ---------------------------------------------------------------------------

/**
 * Categorías habituales de un negocio pequeño. No vienen de fábrica: el usuario las añade con un botón y después
 * son suyas (se pueden renombrar y borrar como cualquier categoría propia).
 * @type {ReadonlyArray<{ name: string, kind: 'income' | 'expense', classification: 'fixed' | 'variable' | 'extraordinary' | 'discretionary' }>}
 */
export const BUSINESS_CATEGORY_SUGGESTIONS = [
  { name: 'Servicios prestados', kind: 'income', classification: 'variable' },
  { name: 'Mercancía e insumos', kind: 'expense', classification: 'variable' },
  { name: 'Marketing y publicidad', kind: 'expense', classification: 'variable' },
  { name: 'Nómina y colaboradores', kind: 'expense', classification: 'fixed' },
  { name: 'Impuestos y tasas', kind: 'expense', classification: 'fixed' },
  { name: 'Software y suscripciones', kind: 'expense', classification: 'fixed' },
  { name: 'Servicios profesionales', kind: 'expense', classification: 'variable' },
  { name: 'Comisiones bancarias', kind: 'expense', classification: 'variable' },
  { name: 'Equipos y mantenimiento', kind: 'expense', classification: 'variable' },
];

for (const s of BUSINESS_CATEGORY_SUGGESTIONS) {
  if (s.name.length > LIMITS.categoryName) throw new Error(`Categoría sugerida demasiado larga: ${s.name}`);
}

/** @param {string} name */
const fold = (name) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

/**
 * Las sugerencias que todavía no existen (mismo nombre y tipo, sin importar mayúsculas).
 * @param {Category[]} categories
 */
export function missingBusinessCategories(categories) {
  return BUSINESS_CATEGORY_SUGGESTIONS.filter(
    (s) => !categories.some((c) => c.kind === s.kind && fold(c.name) === fold(s.name)),
  );
}
