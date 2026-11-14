// @ts-check
// =============================================================================
// GAMIFICACIÓN: logros, rachas y niveles (documento maestro §13)
// -----------------------------------------------------------------------------
// Todo se CALCULA en el momento a partir de lo que registraste: no se guarda nada
// aparte (no hay «tabla de logros»). Eso tiene dos consecuencias, y las dos son
// a propósito:
//   - Es imposible tener un logro que tus datos no respalden. Si borras los
//     movimientos que sostenían un logro, deja de contar.
//   - La mejor racha y los logros cuentan solo lo que hay guardado hoy.
//
// Reglas (fijas, no es inteligencia artificial):
//   - SOLO cuentan datos reales. Los datos de demostración (isDemo) se ignoran por
//     completo: tocar el modo demo no te da puntos, rachas ni niveles.
//   - Un DÍA cuenta si tiene al menos un movimiento (ingreso o gasto) o un aporte a
//     una meta con esa fecha. La fecha es la del movimiento, la que ves en la lista.
//     Las fechas futuras no cuentan.
//   - Una SEMANA (lunes a domingo) o un MES cuenta si tiene al menos un día así.
//   - La racha actual sigue viva mientras el período de hoy no haya terminado:
//     si hoy aún no registras nada pero ayer sí, la racha NO se rompe todavía
//     (aparece «en riesgo»). Se rompe cuando termina un período completo sin registros.
//   - Los logros de constancia usan la MEJOR racha (no la actual), para que un
//     logro ganado no desaparezca cuando una racha se interrumpe.
//   - Cada logro vale 10 (bronce), 25 (plata) o 50 (oro) puntos; el nivel depende
//     solo de la suma de puntos de los logros obtenidos.
// =============================================================================

import { addDays, addMonths, monthKeyOf, parseISO, plural } from './dates.js';
import { debtStatus } from './debts.js';
import { goalProgress } from './goals.js';
import { netWorthAt } from './netWorth.js';
import { monthTotals } from './summaries.js';

/** @typedef {import('./types.js').AppData} AppData */

/** Puntos por nivel de dificultad del logro. */
export const TIER_POINTS = /** @type {const} */ ({ bronze: 10, silver: 25, gold: 50 });

/** @type {Record<keyof typeof TIER_POINTS, string>} */
export const TIER_LABELS = { bronze: 'Bronce', silver: 'Plata', gold: 'Oro' };

/**
 * Niveles. `min` = puntos necesarios para alcanzarlo. El último se alcanza con ~2/3 de los puntos que
 * ofrece cualquier espacio (ver la prueba «el nivel máximo es alcanzable»), así que es largo pero posible.
 */
export const LEVELS = [
  { name: 'Principiante financiero', min: 0, text: 'Estás empezando a ordenar tus finanzas.' },
  { name: 'Organizador', min: 30, text: 'Ya registras con orden y le tomas el ritmo a la app.' },
  { name: 'Ahorrador constante', min: 90, text: 'Tu hábito de registro y tus primeras metas se notan.' },
  { name: 'Planificador', min: 180, text: 'Planificas: metas, deudas y meses cerrados en positivo.' },
  { name: 'Estratega', min: 320, text: 'Llevas meses de constancia y tus números lo reflejan.' },
  { name: 'Constructor de patrimonio', min: 500, text: 'Constancia larga, metas cumplidas y patrimonio en crecimiento.' },
];

/** @typedef {'registro' | 'constancia' | 'ahorro' | 'metas' | 'deudas' | 'patrimonio' | 'clientes' | 'negocio'} AchievementGroup */

/** @type {Record<AchievementGroup, string>} Orden en que se muestran los grupos. */
export const GROUP_LABELS = {
  registro: 'Registro',
  constancia: 'Constancia',
  ahorro: 'Ahorro',
  metas: 'Metas',
  deudas: 'Deudas',
  patrimonio: 'Patrimonio',
  clientes: 'Clientes',
  negocio: 'Negocio',
};

/**
 * Qué partes de la app están activas en el espacio (decide qué logros se ofrecen: no se pide un logro
 * de clientes en un espacio que ni muestra clientes).
 * @typedef {Object} GamificationFeatures
 * @property {boolean} [clients]
 * @property {boolean} [inventory]
 * @property {boolean} [invoices]
 * @property {boolean} [departments]
 */

// ---------------------------------------------------------------------------
// Datos reales (sin demostración)
// ---------------------------------------------------------------------------

/**
 * @template {{ isDemo?: boolean }} T
 * @param {T[]} items
 */
const real = (items) => items.filter((x) => !x.isDemo);

/**
 * Copia de los datos SIN los registros de demostración.
 * @param {AppData} data
 * @returns {AppData}
 */
export function realData(data) {
  return {
    ...data,
    movements: real(data.movements),
    goals: real(data.goals),
    contributions: real(data.contributions),
    debts: real(data.debts),
    debtPayments: real(data.debtPayments),
    assets: real(data.assets),
    clients: real(data.clients),
    services: real(data.services),
    products: real(data.products),
    suppliers: real(data.suppliers),
    stockEntries: real(data.stockEntries),
    invoices: real(data.invoices),
    invoicePayments: real(data.invoicePayments),
    departments: real(data.departments),
  };
}

/**
 * Cuántos registros de demostración hay (se ignoran; sirve para avisar en pantalla).
 * @param {AppData} data
 */
export function demoRecordCount(data) {
  const all = [
    data.movements, data.goals, data.contributions, data.debts, data.debtPayments, data.assets, data.clients, data.services,
    data.products, data.suppliers, data.stockEntries, data.invoices, data.invoicePayments, data.departments,
  ];
  return all.reduce((sum, list) => sum + list.filter((x) => x.isDemo).length, 0);
}

// ---------------------------------------------------------------------------
// Rachas
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Streak
 * @property {number} current   Períodos seguidos que llegan hasta hoy (o hasta el período anterior si el de hoy aún está vacío).
 * @property {number} best      La racha más larga de todas.
 * @property {boolean} activeNow   ¿Ya hay registro en el período de hoy?
 * @property {boolean} atRisk   Hay racha, pero el período de hoy aún está vacío: registrar algo ahora la mantiene.
 */

/**
 * @param {Set<string>} keys Períodos con actividad.
 * @param {string} currentKey Período de hoy.
 * @param {(key: string, delta: number) => string} shift Mueve una clave de período `delta` períodos.
 * @returns {Streak}
 */
export function streakOf(keys, currentKey, shift) {
  const sorted = [...keys].sort();
  let best = 0;
  let run = 0;
  /** @type {string | null} */
  let previous = null;
  for (const key of sorted) {
    run = previous !== null && shift(previous, 1) === key ? run + 1 : 1;
    if (run > best) best = run;
    previous = key;
  }

  const activeNow = keys.has(currentKey);
  const start = activeNow ? currentKey : keys.has(shift(currentKey, -1)) ? shift(currentKey, -1) : null;
  let current = 0;
  if (start !== null) {
    for (let key = start; keys.has(key); key = shift(key, -1)) current += 1;
  }
  return { current, best, activeNow, atRisk: current > 0 && !activeNow };
}

/**
 * Lunes de la semana de una fecha (las semanas van de lunes a domingo).
 * @param {string} iso
 */
export function weekStart(iso) {
  const { y, m, d } = parseISO(iso);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(iso, -((weekday + 6) % 7));
}

/**
 * Días con registro (movimientos y aportes a metas con fecha hasta hoy). Solo datos reales.
 * @param {AppData} data @param {string} today
 * @returns {Set<string>}
 */
export function activityDays(data, today) {
  const days = new Set();
  for (const m of data.movements) if (!m.isDemo && m.date <= today) days.add(m.date);
  for (const c of data.contributions) if (!c.isDemo && c.date <= today) days.add(c.date);
  return days;
}

/**
 * Racha diaria, semanal y mensual.
 * @param {AppData} data @param {string} today
 */
export function streaks(data, today) {
  const days = activityDays(data, today);
  const weeks = new Set([...days].map(weekStart));
  const months = new Set([...days].map(monthKeyOf));
  return {
    daily: streakOf(days, today, addDays),
    weekly: streakOf(weeks, weekStart(today), (key, delta) => addDays(key, 7 * delta)),
    monthly: streakOf(months, monthKeyOf(today), addMonths),
    activeDays: days.size,
    firstDate: days.size === 0 ? null : [...days].sort()[0],
  };
}

// ---------------------------------------------------------------------------
// Logros
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Achievement
 * @property {string} id
 * @property {AchievementGroup} group
 * @property {keyof typeof TIER_POINTS} tier
 * @property {number} points
 * @property {string} title
 * @property {string} text      Qué hay que hacer.
 * @property {number} current   Cuánto llevas (nunca pasa de `target`).
 * @property {number} target
 * @property {boolean} done
 */

/**
 * @typedef {Object} Measures Todo lo que se mide una sola vez y de lo que salen los logros.
 * @property {number} movements
 * @property {number} categories
 * @property {ReturnType<typeof streaks>} streaks
 * @property {number} positiveMonths   Meses ya cerrados con más ingresos que gastos.
 * @property {number} goals
 * @property {number} deposits
 * @property {number} goalsCompleted
 * @property {number} debts
 * @property {number} debtPayments
 * @property {number} debtsPaid
 * @property {number} assets
 * @property {boolean} netWorthPositive
 * @property {number} clients
 * @property {number} clientIncomes
 * @property {number} clientExpenses
 * @property {number} servicesDone
 * @property {number} products
 * @property {number} sales
 * @property {number} invoices
 * @property {number} invoicePayments
 * @property {number} departments
 */

/**
 * Mide una sola vez todo lo necesario (solo datos reales).
 * @param {AppData} data @param {string} today
 * @returns {Measures}
 */
function measure(data, today) {
  const r = realData(data);
  const movements = r.movements.filter((m) => m.date <= today);
  const thisMonth = monthKeyOf(today);

  const closedMonths = new Set(movements.map((m) => monthKeyOf(m.date)).filter((key) => key < thisMonth));
  let positiveMonths = 0;
  for (const key of closedMonths) {
    const t = monthTotals(movements, key);
    if (t.incomeCents > t.expenseCents) positiveMonths += 1; // con gastos ≥ 0, esto ya exige ingresos > 0
  }

  const hasRecords = movements.length + r.contributions.length + r.assets.length + r.debts.length > 0;
  const netWorthPositive = hasRecords && netWorthAt(r, today).netWorthCents > 0;

  return {
    movements: movements.length,
    categories: new Set(movements.map((m) => m.categoryId)).size,
    streaks: streaks(r, today),
    positiveMonths,
    goals: r.goals.length,
    deposits: r.contributions.filter((c) => c.kind === 'deposit' && c.date <= today).length,
    goalsCompleted: r.goals.filter((g) => goalProgress(g, r.contributions, today).completed).length,
    debts: r.debts.length,
    debtPayments: r.debtPayments.length,
    // debtStatus ya toma solo los pagos de cada deuda.
    debtsPaid: r.debts.filter((d) => debtStatus(d, r.debtPayments, today).paid).length,
    assets: r.assets.length,
    netWorthPositive,
    clients: r.clients.length,
    clientIncomes: movements.filter((m) => m.type === 'income' && m.clientId).length,
    clientExpenses: movements.filter((m) => m.type === 'expense' && m.clientId).length,
    servicesDone: r.services.filter((s) => s.status === 'done').length,
    products: r.products.length,
    sales: r.stockEntries.filter((e) => e.kind === 'sale' && e.date <= today).length,
    invoices: r.invoices.filter((i) => !i.voidedAt).length,
    invoicePayments: r.invoicePayments.length,
    departments: r.departments.length,
  };
}

/**
 * @typedef {Object} Rule Definición fija de un logro.
 * @property {string} id
 * @property {AchievementGroup} group
 * @property {keyof typeof TIER_POINTS} tier
 * @property {string} title
 * @property {string} text
 * @property {number} target
 * @property {(m: Measures) => number} value  Cuánto lleva el usuario.
 * @property {keyof GamificationFeatures} [needs]  Solo se ofrece si esa parte de la app está activa en el espacio.
 */

/** @type {Rule[]} */
export const RULES = [
  // ---- Registro ----
  { id: 'reg-1', group: 'registro', tier: 'bronze', title: 'Primer paso', text: 'Registra tu primer movimiento.', target: 1, value: (m) => m.movements },
  { id: 'reg-10', group: 'registro', tier: 'bronze', title: 'Tomando el ritmo', text: 'Registra 10 movimientos.', target: 10, value: (m) => m.movements },
  { id: 'reg-50', group: 'registro', tier: 'silver', title: 'Registrador', text: 'Registra 50 movimientos.', target: 50, value: (m) => m.movements },
  { id: 'reg-200', group: 'registro', tier: 'silver', title: 'Contador de casa', text: 'Registra 200 movimientos.', target: 200, value: (m) => m.movements },
  { id: 'reg-1000', group: 'registro', tier: 'gold', title: 'Libro mayor', text: 'Registra 1,000 movimientos.', target: 1000, value: (m) => m.movements },
  { id: 'reg-cat-5', group: 'registro', tier: 'bronze', title: 'Todo en su lugar', text: 'Usa 5 categorías distintas en tus movimientos.', target: 5, value: (m) => m.categories },

  // ---- Constancia (mejor racha) ----
  { id: 'day-3', group: 'constancia', tier: 'bronze', title: 'Tres días seguidos', text: 'Registra algo 3 días seguidos.', target: 3, value: (m) => m.streaks.daily.best },
  { id: 'day-7', group: 'constancia', tier: 'silver', title: 'Una semana completa', text: 'Registra algo 7 días seguidos.', target: 7, value: (m) => m.streaks.daily.best },
  { id: 'day-30', group: 'constancia', tier: 'gold', title: 'Treinta días', text: 'Registra algo 30 días seguidos.', target: 30, value: (m) => m.streaks.daily.best },
  { id: 'day-100', group: 'constancia', tier: 'gold', title: 'Cien días', text: 'Registra algo 100 días seguidos.', target: 100, value: (m) => m.streaks.daily.best },
  { id: 'week-4', group: 'constancia', tier: 'silver', title: 'Un mes de semanas', text: 'Registra algo en 4 semanas seguidas.', target: 4, value: (m) => m.streaks.weekly.best },
  { id: 'week-12', group: 'constancia', tier: 'gold', title: 'Un trimestre de semanas', text: 'Registra algo en 12 semanas seguidas.', target: 12, value: (m) => m.streaks.weekly.best },
  { id: 'month-3', group: 'constancia', tier: 'silver', title: 'Tres meses', text: 'Registra algo en 3 meses seguidos.', target: 3, value: (m) => m.streaks.monthly.best },
  { id: 'month-6', group: 'constancia', tier: 'gold', title: 'Medio año', text: 'Registra algo en 6 meses seguidos.', target: 6, value: (m) => m.streaks.monthly.best },
  { id: 'month-12', group: 'constancia', tier: 'gold', title: 'Un año entero', text: 'Registra algo en 12 meses seguidos.', target: 12, value: (m) => m.streaks.monthly.best },

  // ---- Ahorro ----
  { id: 'save-1', group: 'ahorro', tier: 'bronze', title: 'Mes en positivo', text: 'Cierra un mes con más ingresos que gastos.', target: 1, value: (m) => m.positiveMonths },
  { id: 'save-3', group: 'ahorro', tier: 'silver', title: 'Tres meses en positivo', text: 'Cierra 3 meses con más ingresos que gastos.', target: 3, value: (m) => m.positiveMonths },
  { id: 'save-6', group: 'ahorro', tier: 'gold', title: 'Seis meses en positivo', text: 'Cierra 6 meses con más ingresos que gastos.', target: 6, value: (m) => m.positiveMonths },

  // ---- Metas ----
  { id: 'goal-1', group: 'metas', tier: 'bronze', title: 'Con un propósito', text: 'Crea tu primera meta.', target: 1, value: (m) => m.goals },
  { id: 'goal-deposit', group: 'metas', tier: 'bronze', title: 'A guardar', text: 'Haz tu primer aporte a una meta.', target: 1, value: (m) => m.deposits },
  { id: 'goal-done-1', group: 'metas', tier: 'silver', title: 'Meta cumplida', text: 'Cumple una meta (llega al monto objetivo).', target: 1, value: (m) => m.goalsCompleted },
  { id: 'goal-done-3', group: 'metas', tier: 'gold', title: 'Cumplidor', text: 'Cumple 3 metas.', target: 3, value: (m) => m.goalsCompleted },

  // ---- Deudas ----
  { id: 'debt-1', group: 'deudas', tier: 'bronze', title: 'Cuentas claras', text: 'Registra tu primera deuda.', target: 1, value: (m) => m.debts },
  { id: 'debt-pay', group: 'deudas', tier: 'bronze', title: 'Pagando lo que debes', text: 'Registra tu primer pago de una deuda.', target: 1, value: (m) => m.debtPayments },
  { id: 'debt-paid', group: 'deudas', tier: 'gold', title: 'Deuda liquidada', text: 'Termina de pagar una deuda.', target: 1, value: (m) => m.debtsPaid },

  // ---- Patrimonio ----
  { id: 'asset-1', group: 'patrimonio', tier: 'bronze', title: 'Lo que tienes', text: 'Registra tu primer activo.', target: 1, value: (m) => m.assets },
  { id: 'networth-pos', group: 'patrimonio', tier: 'bronze', title: 'Patrimonio positivo', text: 'Que tu patrimonio neto sea mayor que cero (con al menos un registro).', target: 1, value: (m) => (m.netWorthPositive ? 1 : 0) },

  // ---- Clientes (Freelancer, o espacios que ya usan clientes) ----
  { id: 'client-1', group: 'clientes', tier: 'bronze', title: 'Primer cliente', text: 'Registra tu primer cliente.', target: 1, value: (m) => m.clients, needs: 'clients' },
  { id: 'client-5', group: 'clientes', tier: 'silver', title: 'Cartera en marcha', text: 'Registra 5 clientes.', target: 5, value: (m) => m.clients, needs: 'clients' },
  { id: 'client-paid', group: 'clientes', tier: 'bronze', title: 'Primer cobro', text: 'Registra un ingreso de un cliente.', target: 1, value: (m) => m.clientIncomes, needs: 'clients' },
  { id: 'client-cost', group: 'clientes', tier: 'bronze', title: 'Rentabilidad real', text: 'Carga un gasto a un cliente para ver cuánto te deja de verdad.', target: 1, value: (m) => m.clientExpenses, needs: 'clients' },
  { id: 'service-done', group: 'clientes', tier: 'silver', title: 'Trabajo entregado', text: 'Marca un servicio como finalizado.', target: 1, value: (m) => m.servicesDone, needs: 'clients' },

  // ---- Negocio (Emprendedor y Empresa, o espacios que ya usan estas funciones) ----
  { id: 'product-1', group: 'negocio', tier: 'bronze', title: 'Primer producto', text: 'Registra tu primer producto en el inventario.', target: 1, value: (m) => m.products, needs: 'inventory' },
  { id: 'sale-1', group: 'negocio', tier: 'bronze', title: 'Primera venta', text: 'Registra tu primera venta de inventario.', target: 1, value: (m) => m.sales, needs: 'inventory' },
  { id: 'invoice-1', group: 'negocio', tier: 'bronze', title: 'Primera factura', text: 'Emite tu primera factura interna.', target: 1, value: (m) => m.invoices, needs: 'invoices' },
  { id: 'invoice-paid', group: 'negocio', tier: 'silver', title: 'Factura cobrada', text: 'Registra el cobro de una factura.', target: 1, value: (m) => m.invoicePayments, needs: 'invoices' },
  { id: 'dept-1', group: 'negocio', tier: 'bronze', title: 'Áreas definidas', text: 'Crea tu primer departamento.', target: 1, value: (m) => m.departments, needs: 'departments' },
];

/**
 * Nivel que corresponde a una cantidad de puntos.
 * @param {number} points
 */
export function levelFor(points) {
  let index = 0;
  LEVELS.forEach((level, i) => {
    if (points >= level.min) index = i;
  });
  const level = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  const span = next ? next.min - level.min : 0;
  return {
    index,
    number: index + 1,
    total: LEVELS.length,
    name: level.name,
    text: level.text,
    min: level.min,
    next: next ? { name: next.name, min: next.min } : null,
    pointsToNext: next ? next.min - points : 0,
    percentToNext: next ? Math.min(100, Math.max(0, ((points - level.min) / span) * 100)) : 100,
  };
}

/**
 * Resumen completo de gamificación de un espacio.
 * @param {AppData} data @param {string} today @param {GamificationFeatures} [features]
 */
export function gamification(data, today, features = {}) {
  const measures = measure(data, today);

  /** @type {Achievement[]} */
  const achievements = RULES.filter((rule) => !rule.needs || features[rule.needs]).map((rule) => {
    const value = rule.value(measures);
    return {
      id: rule.id,
      group: rule.group,
      tier: rule.tier,
      points: TIER_POINTS[rule.tier],
      title: rule.title,
      text: rule.text,
      current: Math.min(value, rule.target),
      target: rule.target,
      done: value >= rule.target,
    };
  });

  const points = achievements.filter((a) => a.done).reduce((sum, a) => sum + a.points, 0);
  const maxPoints = achievements.reduce((sum, a) => sum + a.points, 0);

  const groups = /** @type {AchievementGroup[]} */ (Object.keys(GROUP_LABELS))
    .map((id) => {
      const items = achievements.filter((a) => a.group === id);
      return { id, label: GROUP_LABELS[id], items, done: items.filter((a) => a.done).length, total: items.length };
    })
    .filter((g) => g.total > 0);

  // «Lo siguiente»: los pendientes que más cerca están (por porcentaje; a igualdad, el de menos puntos primero).
  const nextUp = achievements
    .filter((a) => !a.done && a.current > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target || a.points - b.points)
    .slice(0, 3);

  return {
    streaks: measures.streaks,
    achievements,
    groups,
    doneCount: achievements.filter((a) => a.done).length,
    totalCount: achievements.length,
    points,
    maxPoints,
    level: levelFor(points),
    nextUp,
    /** ¿Hay algún dato real? Si no, todo está en cero. */
    hasReal: measures.movements + measures.goals + measures.deposits + measures.debts + measures.assets > 0,
    /** Registros de demostración ignorados. */
    demoIgnored: demoRecordCount(data),
  };
}

/**
 * «3 días» / «1 semana» / «2 meses», para mostrar rachas.
 * @param {number} n @param {'day' | 'week' | 'month'} unit
 */
export function streakText(n, unit) {
  if (unit === 'day') return plural(n, 'día', 'días');
  if (unit === 'week') return plural(n, 'semana', 'semanas');
  return plural(n, 'mes', 'meses');
}
