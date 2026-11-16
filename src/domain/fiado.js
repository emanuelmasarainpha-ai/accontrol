// @ts-check
// =============================================================================
// QUIÉN ME DEBE (FIADO) — 0.16.3 (espacios Emprendedor y Empresa)
// -----------------------------------------------------------------------------
// En un colmado o un negocio pequeño se «fía»: el cliente se lleva algo y paga después, a veces en abonos. El cliente NO
// necesita usar ACCONTROL.
//
// No hay datos nuevos: cada fiado es una FACTURA INTERNA (con su número, sus líneas y, si lleva productos, su salida del
// inventario) y cada abono es uno o varios COBROS de esas facturas, cada uno con su ingreso. Así:
//  - lo que te deben se cuenta de una sola fuente (las facturas), igual en «Facturas» y aquí;
//  - el dinero entra a «Disponible» y a Resultados cuando se cobra, nunca dos veces;
//  - el fiado sigue las mismas reglas ya probadas (inventario, anulación, numeración, permisos, nube).
//
// Un CLIENTE del fiado se reconoce por la ficha del cliente (si la factura la lleva) o por su NOMBRE, sin mirar tildes,
// mayúsculas ni espacios de más: «José  Pérez» y «jose perez» son la misma persona.
//
// Un ABONO se reparte empezando por la deuda MÁS VIEJA (fecha de la factura y luego su número), y solo entre las facturas
// emitidas hasta la fecha del abono. Nunca puede pasar de lo que se debe.
// =============================================================================

import { cleanText } from './contact.js';
import { formatDate, isValidISODate } from './dates.js';
import { customerKey, foldName, invoiceLabel, invoicePosition, invoicesEnabled } from './invoices.js';

export { customerKey, foldName };
import { formatMoney, MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Invoice} Invoice */
/** @typedef {import('./types.js').InvoicePayment} InvoicePayment */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./invoices.js').InvoicePosition} InvoicePosition */
/** @typedef {import('./invoices.js').InvoiceInput} InvoiceInput */

/** Nota que llevan las facturas creadas con «Fiar» (se ve en la factura y en su PDF). */
export const CREDIT_NOTE = 'Fiado';
/** Lo que se pone en la línea si no se dice qué se llevó. */
export const DEFAULT_CREDIT_DESCRIPTION = 'Fiado';

/**
 * ¿Se ofrece «Fiado» en este espacio? Donde hay facturas, menos en Freelancer (allí las facturas van ligadas a la ficha
 * de un cliente y lo pendiente se ve en Clientes).
 * @param {import('./types.js').WorkspaceKind | null | undefined} workspaceKind @param {Pick<AppData, 'invoices'>} data
 */
export function fiadoEnabled(workspaceKind, data) {
  return workspaceKind !== 'freelancer' && invoicesEnabled(workspaceKind, data);
}

/** Del más viejo al más nuevo: fecha de la factura, número y id. @param {Invoice} a @param {Invoice} b */
const oldestFirst = (a, b) => a.issueDate.localeCompare(b.issueDate) || a.number - b.number || a.id.localeCompare(b.id);

/**
 * @typedef {Object} LedgerEvent   Una línea del estado de cuenta.
 * @property {'credit' | 'payment'} kind   Fiado (sube lo que debe) o abono (lo baja).
 * @property {string} date
 * @property {string} time
 * @property {number} amountCents          Siempre positivo.
 * @property {Invoice} invoice
 * @property {InvoicePayment} [payment]
 * @property {number} balanceAfterCents    Lo que debía después de este movimiento.
 */

/**
 * @typedef {Object} CustomerLedger
 * @property {string} key
 * @property {string} name                 El nombre de su factura más reciente.
 * @property {string} contact              El contacto más reciente que se anotó ('' si ninguno).
 * @property {string} [clientId]
 * @property {InvoicePosition[]} positions Sus facturas vigentes, de la más vieja a la más nueva.
 * @property {InvoicePosition[]} open      Las que tienen saldo, de la más vieja a la más nueva.
 * @property {number} billedCents          Todo lo fiado (facturas vigentes, con impuesto).
 * @property {number} paidCents            Todo lo abonado.
 * @property {number} balanceCents         Lo que debe hoy.
 * @property {number} overdueCents         De lo que debe, lo vencido.
 * @property {number} oldestDaysOverdue
 * @property {string} oldestOpenDate       Fecha de la deuda más vieja sin pagar ('' si no debe nada).
 * @property {string} lastPaymentDate      Fecha del último abono ('' si nunca abonó).
 * @property {boolean} isDemo              Todas sus facturas son de demostración.
 * @property {LedgerEvent[]} events        Fiados y abonos en orden, con el saldo después de cada uno.
 */

/**
 * Todos los clientes con facturas vigentes, los que más deben primero (y luego por nombre).
 * @param {Pick<AppData, 'invoices' | 'invoicePayments'>} data @param {string} today
 * @returns {CustomerLedger[]}
 */
export function customerLedgers(data, today) {
  /** @type {Map<string, Invoice[]>} */
  const groups = new Map();
  for (const invoice of data.invoices) {
    if (invoice.voidedAt !== undefined) continue;
    const key = customerKey(invoice);
    const list = groups.get(key);
    if (list) list.push(invoice);
    else groups.set(key, [invoice]);
  }
  const ledgers = [...groups].map(([key, invoices]) => buildLedger(key, invoices.sort(oldestFirst), data.invoicePayments, today));
  return ledgers.sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.key.localeCompare(b.key));
}

/**
 * Un cliente por su clave, o null si no tiene facturas vigentes.
 * @param {Pick<AppData, 'invoices' | 'invoicePayments'>} data @param {string} key @param {string} today
 */
export function customerLedger(data, key, today) {
  const invoices = data.invoices.filter((i) => i.voidedAt === undefined && customerKey(i) === key).sort(oldestFirst);
  return invoices.length === 0 ? null : buildLedger(key, invoices, data.invoicePayments, today);
}

/** @param {string} key @param {Invoice[]} invoices De la más vieja a la más nueva. @param {InvoicePayment[]} allPayments @param {string} today @returns {CustomerLedger} */
function buildLedger(key, invoices, allPayments, today) {
  const positions = invoices.map((i) => invoicePosition(i, allPayments, today));
  const open = positions.filter((p) => p.balanceCents > 0);
  const newest = invoices[invoices.length - 1];
  const contact = [...invoices].reverse().find((i) => i.customerContact)?.customerContact ?? '';
  /** @type {Omit<LedgerEvent, 'balanceAfterCents'>[]} */
  const raw = [];
  for (const p of positions) {
    raw.push({ kind: 'credit', date: p.invoice.issueDate, time: '', amountCents: p.totalCents, invoice: p.invoice });
    for (const payment of p.payments) raw.push({ kind: 'payment', date: payment.date, time: payment.time, amountCents: payment.amountCents, invoice: p.invoice, payment });
  }
  // Mismo día: primero el fiado y luego el abono (no se abona lo que aún no se fió).
  raw.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'credit' ? -1 : 1) || a.time.localeCompare(b.time) || oldestFirst(a.invoice, b.invoice));
  let running = 0;
  const events = raw.map((e) => {
    running += e.kind === 'credit' ? e.amountCents : -e.amountCents;
    return { ...e, balanceAfterCents: running };
  });
  const payments = positions.flatMap((p) => p.payments);
  return {
    key,
    name: newest.customerName,
    contact,
    ...(newest.clientId ? { clientId: newest.clientId } : {}),
    positions,
    open,
    billedCents: positions.reduce((s, p) => s + p.totalCents, 0),
    paidCents: positions.reduce((s, p) => s + p.paidCents, 0),
    balanceCents: open.reduce((s, p) => s + p.balanceCents, 0),
    overdueCents: open.filter((p) => p.status === 'overdue').reduce((s, p) => s + p.balanceCents, 0),
    oldestDaysOverdue: open.reduce((m, p) => Math.max(m, p.daysOverdue), 0),
    oldestOpenDate: open[0]?.invoice.issueDate ?? '',
    lastPaymentDate: payments.reduce((m, p) => (p.date > m ? p.date : m), ''),
    isDemo: invoices.every((i) => i.isDemo === true),
    events,
  };
}

/**
 * Resumen para la cabecera: cuánto te deben en total, cuántos clientes y cuánto se abonó este mes.
 * @param {CustomerLedger[]} ledgers @param {string} monthKey "AAAA-MM"
 */
export function fiadoSummary(ledgers, monthKey) {
  const owing = ledgers.filter((l) => l.balanceCents > 0);
  return {
    totalCents: owing.reduce((s, l) => s + l.balanceCents, 0),
    customers: owing.length,
    overdueCents: owing.reduce((s, l) => s + l.overdueCents, 0),
    collectedThisMonthCents: ledgers.flatMap((l) => l.events).filter((e) => e.kind === 'payment' && e.date.startsWith(`${monthKey}-`)).reduce((s, e) => s + e.amountCents, 0),
  };
}

/** Busca por nombre o contacto, sin tildes ni mayúsculas. @param {CustomerLedger[]} ledgers @param {string} query */
export function searchLedgers(ledgers, query) {
  const needle = foldName(query);
  return needle ? ledgers.filter((l) => foldName(`${l.name} ${l.contact}`).includes(needle)) : ledgers;
}

// ---- Fiar ------------------------------------------------------------------------------------------------

/**
 * Lo que llega del formulario «Fiar» (todo es texto).
 * @typedef {Object} CreditInput
 * @property {string} customerName @property {string} [customerContact] @property {string} [description] @property {string} amountText
 * @property {string} date @property {string} [dueDate]
 */

/**
 * Convierte un fiado rápido en una factura de una línea (sin producto ni impuesto, con la nota «Fiado»). La validan las
 * mismas reglas que cualquier factura (validateInvoice).
 * @param {CreditInput} input @returns {InvoiceInput}
 */
export function creditInvoiceInput(input) {
  return {
    customerName: input.customerName,
    customerContact: input.customerContact ?? '',
    customerTaxId: '',
    issueDate: input.date,
    dueDate: input.dueDate ?? '',
    taxText: '',
    notes: CREDIT_NOTE,
    lines: [{ description: cleanText(input.description) || DEFAULT_CREDIT_DESCRIPTION, quantityText: '1', unitText: input.amountText, productId: '', serviceId: '' }],
  };
}

/** Los errores de la factura, con los nombres de los campos del formulario «Fiar». @param {Record<string, string>} errors */
export function creditErrors(errors) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(errors)) {
    const name = k === 'line0.unit' ? 'amount' : k === 'line0.description' ? 'description' : k === 'issueDate' ? 'date' : k.startsWith('line') ? 'form' : k;
    if (!out[name]) out[name] = name === 'amount' ? v.replace('El precio por unidad', 'Lo fiado').replace('Escribe el precio por unidad.', 'Escribe cuánto se llevó fiado.') : v;
  }
  return out;
}

// ---- Abonar ----------------------------------------------------------------------------------------------

/**
 * Reparte un abono empezando por la deuda más vieja. Solo entre las facturas emitidas hasta la fecha del abono.
 * @param {InvoicePosition[]} open Con saldo, de la más vieja a la más nueva. @param {number} amountCents @param {string} date
 * @returns {{ invoiceId: string, amountCents: number }[]}
 */
export function allocatePayment(open, amountCents, date) {
  /** @type {{ invoiceId: string, amountCents: number }[]} */
  const out = [];
  let left = amountCents;
  for (const p of open) {
    if (left <= 0) break;
    if (p.invoice.issueDate > date || p.balanceCents <= 0) continue;
    const take = Math.min(left, p.balanceCents);
    out.push({ invoiceId: p.invoice.id, amountCents: take });
    left -= take;
  }
  return out;
}

/**
 * @typedef {Object} CustomerPaymentInput
 * @property {string} amountText @property {string} date @property {string} categoryId @property {string} [note]
 */

/**
 * @typedef {Object} ValidCustomerPayment
 * @property {number} amountCents @property {string} date @property {string} categoryId @property {string} note
 * @property {{ invoiceId: string, amountCents: number }[]} allocations
 */

/**
 * Valida un abono de un cliente y lo reparte.
 * @param {CustomerPaymentInput} input @param {{ ledger: CustomerLedger | null, categories: Category[], today: string }} context
 * @returns {{ ok: true, value: ValidCustomerPayment } | { ok: false, errors: Record<string, string> }}
 */
export function validateCustomerPayment(input, { ledger, categories, today }) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!ledger) return { ok: false, errors: { form: 'Ese cliente ya no tiene fiados.' } };
  if (ledger.balanceCents === 0) errors.form = `${ledger.name} no debe nada.`;

  const date = String(input.date ?? '');
  if (!isValidISODate(date)) errors.date = 'Elige una fecha válida.';
  else if (date > today) errors.date = 'La fecha no puede ser futura: registra solo lo que ya te pagaron.';
  else if (ledger.oldestOpenDate && date < ledger.oldestOpenDate) errors.date = `La deuda más vieja es del ${formatDate(ledger.oldestOpenDate)}: el abono no puede ser anterior.`;

  let amountCents = 0;
  const amountText = cleanText(input.amountText);
  const money = parseMoney(amountText);
  if (!amountText) errors.amount = 'Escribe cuánto te pagó.';
  else if (!money.ok) errors.amount = money.error;
  else if (money.cents <= 0) errors.amount = 'El abono debe ser mayor que cero.';
  else if (money.cents > MAX_CENTS) errors.amount = 'El monto es demasiado grande.';
  else amountCents = money.cents;

  let allocations = /** @type {{ invoiceId: string, amountCents: number }[]} */ ([]);
  if (!errors.form && !errors.date && amountCents > 0) {
    const due = ledger.open.filter((p) => p.invoice.issueDate <= date).reduce((s, p) => s + p.balanceCents, 0);
    if (amountCents > due) {
      errors.amount = due === ledger.balanceCents
        ? `${ledger.name} debe ${formatMoney(due)}: el abono no puede pasar de ahí.`
        : `Hasta el ${formatDate(date)}, ${ledger.name} debía ${formatMoney(due)}: el abono no puede pasar de ahí.`;
    } else {
      allocations = allocatePayment(ledger.open, amountCents, date);
    }
  }

  const category = categories.find((c) => c.id === input.categoryId);
  if (!category) errors.category = 'Elige una categoría.';
  else if (category.kind !== 'income') errors.category = 'Esa categoría no es de ingresos.';

  const note = cleanText(input.note);
  if (note.length > LIMITS.paymentNote) errors.note = `Máximo ${LIMITS.paymentNote} caracteres.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { amountCents, date, categoryId: category?.id ?? '', note, allocations } };
}

// ---- Estado de cuenta ------------------------------------------------------------------------------------

/** Cuántos movimientos recientes lleva el mensaje del estado de cuenta (para que se lea en WhatsApp). */
export const STATEMENT_EVENTS = 10;

/**
 * Estado de cuenta para copiar y enviar por WhatsApp (ACCONTROL no envía mensajes): los últimos movimientos y el saldo.
 * @param {CustomerLedger} ledger @param {{ senderName?: string, today: string }} options
 */
export function statementMessage(ledger, { senderName = '', today }) {
  const recent = ledger.events.slice(-STATEMENT_EVENTS);
  const sender = cleanText(senderName);
  const lines = [`Hola, ${ledger.name}.`, `Este es tu estado de cuenta${sender ? ` con ${sender}` : ''} al ${formatDate(today)}:`];
  if (ledger.events.length > recent.length) lines.push(`(los últimos ${recent.length} movimientos)`);
  for (const e of recent) {
    lines.push(e.kind === 'credit'
      ? `• ${formatDate(e.date)}: ${creditText(e.invoice)} — ${formatMoney(e.amountCents)}`
      : `• ${formatDate(e.date)}: abono — −${formatMoney(e.amountCents)}`);
  }
  lines.push(ledger.balanceCents > 0 ? `Saldo pendiente: ${formatMoney(ledger.balanceCents)}.` : 'Estás al día: no debes nada. ¡Gracias!');
  if (ledger.balanceCents > 0) lines.push('Si ya pagaste, por favor ignora este mensaje. ¡Gracias!');
  if (sender) lines.push(sender);
  return lines.join('\n');
}

/** Qué se llevó, en palabras: «Pan y leche (F-0003)». @param {Invoice} invoice */
export function creditText(invoice) {
  const first = invoice.lines[0]?.description ?? DEFAULT_CREDIT_DESCRIPTION;
  const more = invoice.lines.length > 1 ? ` y ${invoice.lines.length - 1} más` : '';
  return `${first}${more} (${invoiceLabel(invoice)})`;
}
