// @ts-check
// =============================================================================
// MÉTRICAS DEL FREELANCER (documento maestro §9)
// -----------------------------------------------------------------------------
// Todo se calcula con los mismos datos de siempre (ingresos, gastos, clientes y
// servicios); aquí no se guarda nada. Son reglas fijas y aritmética sobre lo que la
// persona registró: no son predicciones ni IA.
//
// Definiciones (las mismas en pantalla, reportes y avisos):
//  - «Cobrado» de un cliente o servicio = suma de los ingresos vinculados a él.
//  - «Por cobrar» (regla de UNA SOLA FUENTE, 0.14.5) = lo que aún no se ha facturado de los servicios EN PROCESO
//    o FINALIZADOS (precio − cobrado directo − facturado, sin pasar de cero) + el saldo de las facturas vigentes.
//    Lo facturado de un servicio lo cuenta SOLO su factura; lo sin facturar, SOLO el servicio. Los servicios
//    Pendientes (sin empezar) y Cancelados no cuentan (sus facturas sí, porque ya se emitieron).
//  - «Gastos del cliente» = los gastos que la persona cargó a ese cliente (costos directos de
//    trabajarle: licencias, viajes, materiales). Solo cuentan los que ella asigna; el resto son
//    «gastos generales» y NO se reparten entre clientes (no se inventa un reparto).
//  - «Neto» de un cliente = lo cobrado − sus gastos; «margen» = neto ÷ cobrado (sin margen si no
//    ha cobrado nada).
//  - «Más rentable» = el cliente con mayor neto positivo en el período. Si no se carga ningún
//    gasto a clientes, el neto es lo cobrado y coincide con «el que más paga».
//  - «Más recurrente» = el cliente con pagos en más meses distintos del período.
// =============================================================================

import { addMonths, monthKeyOf, monthKeysEndingAt } from './dates.js';
import { clientLabel, sortClients } from './clients.js';
import { billedByService, directPaidByService, invoicePositions } from './invoices.js';
import { percentOf } from './money.js';
import { monthTotals } from './summaries.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').Client} Client */
/** @typedef {import('./types.js').Service} Service */
/** @typedef {import('./types.js').Movement} Movement */

/** @typedef {'year' | 'all'} Range Este año, o todo el tiempo. */
/** @type {Record<Range, string>} */
export const RANGE_LABELS = { year: 'Este año', all: 'Todo el tiempo' };

/** Mínimo de pagos vinculados para avisar de que dependes de un cliente. */
export const CONCENTRATION_MIN_PAYMENTS = 3;
/** Porcentaje de los ingresos de los últimos 12 meses a partir del cual se avisa. */
export const CONCENTRATION_THRESHOLD = 60;

/** @param {Range} range @param {string} today @returns {{ from: string | null, to: string }} */
export function rangeBounds(range, today) {
  return { from: range === 'year' ? `${today.slice(0, 4)}-01-01` : null, to: today };
}

/** @param {string} date @param {{ from: string | null, to: string }} bounds */
const within = (date, { from, to }) => (from === null || date >= from) && date <= to;

/**
 * Lo cobrado directamente por cada servicio (ingresos vinculados al servicio hasta hoy). Los cobros de facturas no llevan
 * servicio: se ven en su factura. (Una sola definición, en invoices.js.)
 */
export const paidByService = directPaidByService;

/**
 * @typedef {Object} ServiceSummary
 * @property {Service} service
 * @property {number} paidCents       Cobrado (todos los ingresos vinculados).
 * @property {number} billedCents     Facturado en facturas vigentes (sin impuesto). Lo cuenta su factura, no el servicio.
 * @property {number} owedCents       Por cobrar SIN FACTURAR (solo si está En proceso o Finalizado): precio − cobrado − facturado.
 * @property {number} progressPercent Cobrado sobre el precio, de 0 a 100 (puede pasar de 100 si cobraron de más; se corta en 100).
 */

/**
 * @param {Service} service @param {Map<string, number>} paid  Cobrado directo por servicio.
 * @param {Map<string, number>} [billed]  Facturado por servicio (billedByService); sin facturas, vacío.
 * @returns {ServiceSummary}
 */
export function summarizeService(service, paid, billed = new Map()) {
  const paidCents = paid.get(service.id) ?? 0;
  const billedCents = billed.get(service.id) ?? 0;
  const counts = service.status === 'in_progress' || service.status === 'done';
  return {
    service,
    paidCents,
    billedCents,
    owedCents: counts ? Math.max(0, service.priceCents - paidCents - billedCents) : 0,
    progressPercent: Math.min(100, percentOf(paidCents, service.priceCents)),
  };
}

/**
 * @typedef {Object} ClientSummary
 * @property {Client} client
 * @property {number} incomeCents      Pagado en el período.
 * @property {number} expenseCents     Gastos cargados al cliente en el período.
 * @property {number} expenseCount     Cantidad de gastos cargados al cliente en el período.
 * @property {number} netCents         Cobrado − gastos del cliente (puede ser negativo).
 * @property {number | null} marginPercent  Neto ÷ cobrado × 100; null si no ha cobrado nada en el período.
 * @property {number} payments         Cantidad de pagos en el período.
 * @property {number} activeMonths     Meses distintos con pagos en el período.
 * @property {string | null} lastPaymentDate  Último pago (de todo el tiempo).
 * @property {number} sharePercent     Parte de los ingresos con cliente del período (0 a 100).
 * @property {number} owedCents        Por cobrar (de todo el tiempo): servicios sin facturar + saldo de sus facturas.
 * @property {number} invoiceOwedCents Parte de owedCents que está en facturas (saldo de sus facturas vigentes).
 * @property {{ total: number, pending: number, inProgress: number, done: number, cancelled: number }} services
 */

/**
 * Un renglón por cliente (archivados incluidos), con lo pagado en el período y lo que falta por cobrar.
 * @param {AppData} data @param {{ range: Range, today: string }} options
 * @returns {ClientSummary[]}
 */
export function clientSummaries(data, { range, today }) {
  const bounds = rangeBounds(range, today);
  const paid = paidByService(data.movements, today);
  const billed = billedByService(data.invoices ?? []);
  /** @type {Map<string, number>} */
  const invoiceOwed = new Map();
  for (const p of invoicePositions({ invoices: data.invoices ?? [], invoicePayments: data.invoicePayments ?? [] }, today)) {
    if (p.balanceCents > 0 && p.invoice.clientId) invoiceOwed.set(p.invoice.clientId, (invoiceOwed.get(p.invoice.clientId) ?? 0) + p.balanceCents);
  }

  /** @type {Map<string, { income: number, payments: number, expense: number, expenses: number, months: Set<string>, last: string | null }>} */
  const byClient = new Map();
  for (const c of data.clients) byClient.set(c.id, { income: 0, payments: 0, expense: 0, expenses: 0, months: new Set(), last: null });
  for (const m of data.movements) {
    if (!m.clientId || m.date > today) continue;
    const row = byClient.get(m.clientId);
    if (!row) continue; // vínculo roto (no debería pasar): no se cuenta
    if (m.type === 'expense') {
      if (within(m.date, bounds)) {
        row.expense += m.amountCents;
        row.expenses += 1;
      }
      continue;
    }
    if (row.last === null || m.date > row.last) row.last = m.date;
    if (!within(m.date, bounds)) continue;
    row.income += m.amountCents;
    row.payments += 1;
    row.months.add(monthKeyOf(m.date));
  }
  const totalLinked = [...byClient.values()].reduce((sum, r) => sum + r.income, 0);

  return sortClients(data.clients).map((client) => {
    const row = /** @type {NonNullable<ReturnType<typeof byClient.get>>} */ (byClient.get(client.id));
    const own = data.services.filter((s) => s.clientId === client.id);
    return {
      client,
      incomeCents: row.income,
      expenseCents: row.expense,
      expenseCount: row.expenses,
      netCents: row.income - row.expense,
      marginPercent: row.income > 0 ? percentOf(row.income - row.expense, row.income) : null,
      payments: row.payments,
      activeMonths: row.months.size,
      lastPaymentDate: row.last,
      sharePercent: percentOf(row.income, totalLinked),
      owedCents: own.reduce((sum, s) => sum + summarizeService(s, paid, billed).owedCents, 0) + (invoiceOwed.get(client.id) ?? 0),
      invoiceOwedCents: invoiceOwed.get(client.id) ?? 0,
      services: {
        total: own.length,
        pending: own.filter((s) => s.status === 'pending').length,
        inProgress: own.filter((s) => s.status === 'in_progress').length,
        done: own.filter((s) => s.status === 'done').length,
        cancelled: own.filter((s) => s.status === 'cancelled').length,
      },
    };
  });
}

/**
 * Desempates fijos: primero la métrica, luego lo pagado y por último el nombre.
 * @param {ClientSummary[]} rows @param {(r: ClientSummary) => number} metric @param {(r: ClientSummary) => number} [tie]
 */
function best(rows, metric, tie) {
  const candidates = rows.filter((r) => metric(r) > 0);
  candidates.sort(
    (a, b) => metric(b) - metric(a) || (tie ? tie(b) - tie(a) : 0) || b.incomeCents - a.incomeCents || clientLabel(a.client).localeCompare(clientLabel(b.client), 'es'),
  );
  return candidates[0] ?? null;
}

/**
 * Ranking de clientes (documento maestro §9): el más rentable (mayor neto: cobrado − sus gastos), el que más paga, el más
 * recurrente y el de mayor deuda pendiente. Cada uno es null si nadie cumple (por ejemplo, nadie debe nada).
 * `atLoss` lista los clientes cuyos gastos superan lo que han pagado en el período, del que más pierde al que menos.
 * @param {ClientSummary[]} rows
 */
export function clientRanking(rows) {
  return {
    mostProfitable: best(rows, (r) => r.netCents),
    topPayer: best(rows, (r) => r.incomeCents),
    mostRecurrent: best(rows, (r) => r.activeMonths, (r) => r.payments),
    mostOwing: best(rows, (r) => r.owedCents),
    atLoss: rows
      .filter((r) => r.netCents < 0)
      .sort((a, b) => a.netCents - b.netCents || clientLabel(a.client).localeCompare(clientLabel(b.client), 'es')),
  };
}

/**
 * De los gastos del período, cuánto se cargó a clientes y cuánto quedó como gasto general (sin cliente).
 * Sirve para que las cuentas cuadren a la vista: cargados + generales = total de gastos.
 * Un gasto cuyo cliente ya no existe (vínculo roto) cuenta como general.
 * @param {AppData} data @param {{ range: Range, today: string }} options
 */
export function clientCosts(data, { range, today }) {
  const bounds = rangeBounds(range, today);
  const known = new Set(data.clients.map((c) => c.id));
  let assignedCents = 0;
  let generalCents = 0;
  for (const m of data.movements) {
    if (m.type !== 'expense' || !within(m.date, bounds)) continue;
    if (m.clientId && known.has(m.clientId)) assignedCents += m.amountCents;
    else generalCents += m.amountCents;
  }
  return { assignedCents, generalCents, totalCents: assignedCents + generalCents };
}

/**
 * Servicios agrupados por nombre (sin importar mayúsculas), de los más vendidos a los menos.
 * «Vendido» = servicios no cancelados con ese nombre.
 * @param {AppData} data @param {string} today
 * @returns {{ name: string, count: number, agreedCents: number, paidCents: number }[]}
 */
export function topServices(data, today) {
  const paid = paidByService(data.movements, today);
  /** @type {Map<string, { name: string, count: number, agreedCents: number, paidCents: number }>} */
  const groups = new Map();
  for (const s of [...data.services].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (s.status === 'cancelled') continue;
    const key = s.name.toLocaleLowerCase('es');
    const g = groups.get(key) ?? { name: s.name, count: 0, agreedCents: 0, paidCents: 0 };
    g.count += 1;
    g.agreedCents += s.priceCents;
    g.paidCents += paid.get(s.id) ?? 0;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.paidCents - a.paidCents || a.name.localeCompare(b.name, 'es'));
}

/**
 * Flujo de caja del freelancer: lo del mes, lo acumulado del año y de siempre, y los últimos 6 meses.
 * Usa TODOS los ingresos y gastos del espacio (con o sin cliente), igual que el resto de la app.
 * @param {AppData} data @param {string} today
 */
export function freelancerFlow(data, today) {
  const monthKey = today.slice(0, 7);
  const past = data.movements.filter((m) => m.date <= today); // por si un respaldo trae fechas futuras
  const month = monthTotals(past, monthKey);
  let yearIncomeCents = 0;
  let yearExpenseCents = 0;
  let allIncomeCents = 0;
  let linkedIncomeCents = 0;
  for (const m of past) {
    if (m.type === 'income') {
      allIncomeCents += m.amountCents;
      if (m.clientId) linkedIncomeCents += m.amountCents;
      if (m.date.slice(0, 4) === today.slice(0, 4)) yearIncomeCents += m.amountCents;
    } else if (m.date.slice(0, 4) === today.slice(0, 4)) {
      yearExpenseCents += m.amountCents;
    }
  }
  const series = monthKeysEndingAt(monthKey, 6).map((key) => {
    const t = monthTotals(past, key);
    return { key, incomeCents: t.incomeCents, expenseCents: t.expenseCents, netCents: t.balanceCents };
  });
  return {
    monthKey,
    monthIncomeCents: month.incomeCents,
    monthExpenseCents: month.expenseCents,
    monthNetCents: month.balanceCents,
    yearIncomeCents,
    yearExpenseCents,
    yearNetCents: yearIncomeCents - yearExpenseCents,
    allIncomeCents,
    unlinkedIncomeCents: allIncomeCents - linkedIncomeCents,
    series,
  };
}

/**
 * Lo que falta por cobrar en total (regla de una sola fuente): los servicios con algo SIN FACTURAR y las facturas vigentes
 * con saldo. `rows` son los servicios (los más grandes primero); `invoices`, las facturas con saldo.
 * @param {AppData} data @param {string} today
 */
export function receivables(data, today) {
  const paid = paidByService(data.movements, today);
  const billed = billedByService(data.invoices ?? []);
  const rows = data.services.map((s) => summarizeService(s, paid, billed)).filter((r) => r.owedCents > 0);
  rows.sort((a, b) => b.owedCents - a.owedCents || a.service.name.localeCompare(b.service.name, 'es'));
  const invoices = invoicePositions({ invoices: data.invoices ?? [], invoicePayments: data.invoicePayments ?? [] }, today).filter((p) => p.balanceCents > 0);
  const servicesCents = rows.reduce((sum, r) => sum + r.owedCents, 0);
  const invoicesCents = invoices.reduce((sum, p) => sum + p.balanceCents, 0);
  return { totalCents: servicesCents + invoicesCents, servicesCents, invoicesCents, rows, invoices };
}

/**
 * Aviso de dependencia: un cliente trae la mayor parte de los ingresos de los últimos 12 meses.
 * Solo si hay al menos CONCENTRATION_MIN_PAYMENTS pagos vinculados (con menos, el porcentaje no dice nada).
 * @param {AppData} data @param {string} today
 * @returns {{ client: Client, percent: number, payments: number } | null}
 */
export function clientConcentration(data, today) {
  const since = `${addMonths(today.slice(0, 7), -11)}-01`;
  /** @type {Map<string, { cents: number, payments: number }>} */
  const byClient = new Map();
  let total = 0;
  let linkedPayments = 0;
  for (const m of data.movements) {
    if (m.type !== 'income' || m.date < since || m.date > today) continue;
    total += m.amountCents;
    if (!m.clientId) continue;
    linkedPayments += 1;
    const row = byClient.get(m.clientId) ?? { cents: 0, payments: 0 };
    row.cents += m.amountCents;
    row.payments += 1;
    byClient.set(m.clientId, row);
  }
  if (total <= 0 || linkedPayments < CONCENTRATION_MIN_PAYMENTS) return null;
  const [topId, top] = [...byClient.entries()].sort((a, b) => b[1].cents - a[1].cents || a[0].localeCompare(b[0]))[0] ?? [];
  const client = data.clients.find((c) => c.id === topId);
  if (!client || !top) return null;
  const percent = percentOf(top.cents, total);
  return percent >= CONCENTRATION_THRESHOLD ? { client, percent, payments: top.payments } : null;
}
