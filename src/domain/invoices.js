// @ts-check
// =============================================================================
// FACTURAS INTERNAS (espacios Emprendedor, Empresa y, desde la 0.14.5, Freelancer)
// -----------------------------------------------------------------------------
// Una factura interna sirve para llevar el control de lo que vendes y de lo que te falta por
// cobrar. NO es un comprobante fiscal (no se envía a ninguna autoridad ni tiene validez tributaria):
// cada factura lo dice en su PDF.
//
// El dinero no se duplica y nada se guarda dos veces:
//  - la factura NO guarda totales ni lo cobrado: el subtotal, el impuesto y el total salen de sus líneas;
//    lo cobrado sale de sus cobros;
//  - cada COBRO crea, en la misma operación, un ingreso normal (Finanzas). Así el dinero cuenta una sola vez en
//    «Disponible», en Resultados y en los reportes, y el cobro y su ingreso se borran juntos;
//  - las líneas que llevan un producto del inventario sacan esas unidades al emitir la factura (una venta de
//    stock SIN dinero: el dinero entra al cobrar) y las devuelven al anularla.
//
// Freelancer (0.14.5): la factura se liga a la FICHA del cliente (clientId) y cada línea puede facturar un SERVICIO de ese
// cliente (serviceId). Regla de UNA SOLA FUENTE para lo «por cobrar»:
//  - lo ya facturado de un servicio lo cuenta la factura (su saldo = total − cobros, con impuesto);
//  - lo que el servicio aún no ha facturado lo cuenta el servicio (precio − cobrado directo − facturado, mínimo 0);
//  - un servicio nunca se factura por encima de lo que le queda (serviceBillingRoom), así la suma nunca pasa de su precio;
//  - el ingreso de cada cobro lleva el cliente (cuenta en su «cobrado» una sola vez) pero NO el servicio.
//
// Una factura emitida no se edita (ni sus líneas, ni su fecha, ni su impuesto): si algo está mal, se anula y se emite otra.
// Las facturas nunca se borran, así la numeración no tiene huecos ni se repite.
// =============================================================================

import { cleanText, isValidEmail, isValidPhone } from './contact.js';
import { addDays, daysBetween, formatDate, isValidISODate } from './dates.js';
import { MAX_QUANTITY, negativeMessage, replayProduct } from './inventory.js';
import { formatMoney, MAX_CENTS, parseMoney } from './money.js';
import { CLASSIFICATIONS_BY_TYPE, LIMITS } from './types.js';

/** @typedef {import('./types.js').Invoice} Invoice */
/** @typedef {import('./types.js').InvoiceLine} InvoiceLine */
/** @typedef {import('./types.js').InvoicePayment} InvoicePayment */
/** @typedef {import('./types.js').StockEntry} StockEntry */
/** @typedef {import('./types.js').Product} Product */
/** @typedef {import('./types.js').Movement} Movement */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */
/** @typedef {import('./types.js').Client} Client */
/** @typedef {import('./types.js').Service} Service */

export const MIN_INVOICE_DATE = '2000-01-01';
/** Las facturas no se emiten con vencimiento más allá de 10 años (evita fechas absurdas). */
export const MAX_DUE_DAYS = 3650;
export const MAX_TAX_BP = 10_000;

/** @typedef {'open' | 'partial' | 'overdue' | 'paid' | 'void'} InvoiceStatus */

/** @type {Record<InvoiceStatus, string>} */
export const INVOICE_STATUS_LABELS = {
  open: 'Emitida',
  partial: 'Cobro parcial',
  overdue: 'Vencida',
  paid: 'Cobrada',
  void: 'Anulada',
};

/** La leyenda que lleva cada factura impresa. */
export const NOT_FISCAL_NOTE = 'Documento interno de control. No es un comprobante fiscal ni tiene validez tributaria.';

/**
 * ¿Se ofrecen las facturas en este espacio? En Freelancer, Emprendedor y Empresa siempre; en Personal, solo si ya hay facturas
 * (por ejemplo, si se restauró una copia que las traía), para que nunca queden datos escondidos.
 * @param {WorkspaceKind | null | undefined} workspaceKind @param {Pick<AppData, 'invoices'>} data
 */
export function invoicesEnabled(workspaceKind, data) {
  return workspaceKind === 'freelancer' || workspaceKind === 'entrepreneur' || workspaceKind === 'company' || data.invoices.length > 0;
}

/** a ÷ b redondeado al entero más cercano (mitades hacia arriba), sin perder precisión. @param {number} a @param {number} b */
function roundDiv(a, b) {
  const num = BigInt(a);
  const den = BigInt(b);
  return Number((num * 2n + den) / (den * 2n));
}

// ---- Numeración ---------------------------------------------------------------------------------------

/** «F-0001» (las de demostración: «DEMO-001», para que nunca se mezclen con las reales). @param {Pick<Invoice, 'number' | 'isDemo'>} invoice */
export function invoiceLabel(invoice) {
  return invoice.isDemo ? `DEMO-${String(invoice.number).padStart(3, '0')}` : `F-${String(invoice.number).padStart(4, '0')}`;
}

/**
 * El siguiente consecutivo. Las facturas de demostración llevan su propia serie: así, al quitarla, la numeración de las
 * facturas reales no queda con huecos.
 * @param {Pick<Invoice, 'number' | 'isDemo'>[]} invoices @param {boolean} [isDemo]
 */
export function nextInvoiceNumber(invoices, isDemo = false) {
  return invoices.filter((i) => (i.isDemo === true) === isDemo).reduce((max, i) => Math.max(max, i.number), 0) + 1;
}

// ---- Totales y estado (todo calculado) --------------------------------------------------------------------

/** @param {Pick<InvoiceLine, 'quantity' | 'unitCents'>} line */
export function lineTotalCents(line) {
  return line.quantity * line.unitCents;
}

/**
 * Subtotal, impuesto y total. El impuesto se redondea al centavo más cercano.
 * @param {Pick<Invoice, 'lines' | 'taxRateBp'>} invoice
 */
export function invoiceTotals(invoice) {
  const subtotalCents = invoice.lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  const taxCents = roundDiv(subtotalCents * invoice.taxRateBp, 10_000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/**
 * @typedef {Object} InvoicePosition
 * @property {Invoice} invoice
 * @property {InvoicePayment[]} payments   Sus cobros, del más antiguo al más reciente.
 * @property {number} subtotalCents
 * @property {number} taxCents
 * @property {number} totalCents
 * @property {number} paidCents
 * @property {number} balanceCents        Lo que falta por cobrar (0 si está cobrada o anulada).
 * @property {InvoiceStatus} status
 * @property {number} daysOverdue         Días de atraso (0 si no está vencida).
 */

/** @param {InvoicePayment[]} payments */
function sortPayments(payments) {
  return [...payments].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Situación de una factura hoy. Una factura anulada no se cobra: su saldo es 0.
 * Si venció y aún se debe algo, es «Vencida» aunque tenga cobros parciales.
 * @param {Invoice} invoice @param {InvoicePayment[]} allPayments Los cobros de todas las facturas. @param {string} today
 * @returns {InvoicePosition}
 */
export function invoicePosition(invoice, allPayments, today) {
  const payments = sortPayments(allPayments.filter((p) => p.invoiceId === invoice.id));
  const totals = invoiceTotals(invoice);
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const isVoid = invoice.voidedAt !== undefined;
  const balanceCents = isVoid ? 0 : Math.max(0, totals.totalCents - paidCents);
  const pastDue = invoice.dueDate !== '' && invoice.dueDate < today;
  /** @type {InvoiceStatus} */
  let status = 'open';
  if (isVoid) status = 'void';
  else if (balanceCents === 0) status = 'paid';
  else if (pastDue) status = 'overdue';
  else if (paidCents > 0) status = 'partial';
  return { invoice, payments, ...totals, paidCents, balanceCents, status, daysOverdue: status === 'overdue' ? daysBetween(invoice.dueDate, today) : 0 };
}

/** Las más recientes primero (por fecha de emisión y número). @param {Invoice[]} list */
export function sortInvoicesNewestFirst(list) {
  return [...list].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number - a.number || a.id.localeCompare(b.id));
}

/** Situación de todas las facturas, las más recientes primero. @param {Pick<AppData, 'invoices' | 'invoicePayments'>} data @param {string} today */
export function invoicePositions(data, today) {
  return sortInvoicesNewestFirst(data.invoices).map((i) => invoicePosition(i, data.invoicePayments, today));
}

// ---- Cuentas por cobrar ----------------------------------------------------------------------------------

/** Nombre sin tildes, en minúsculas y con un solo espacio entre palabras (0.16.3). @param {string} name */
export function foldName(name) {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}

/**
 * Quién es el cliente de una factura (0.16.3): su ficha, si la lleva; si no, su nombre sin tildes, mayúsculas ni espacios de más
 * («José  Pérez» y «jose perez» son la misma persona). @param {Pick<Invoice, 'clientId' | 'customerName'>} invoice
 */
export function customerKey(invoice) {
  return invoice.clientId ? `c:${invoice.clientId}` : `n:${foldName(invoice.customerName)}`;
}

/**
 * @typedef {Object} CustomerReceivable
 * @property {string} key             Quién es (customerKey): sirve para abrir su ficha en «Fiado».
 * @property {string} customerName
 * @property {number} invoices        Facturas con saldo.
 * @property {number} balanceCents
 * @property {number} overdueCents
 * @property {number} oldestDaysOverdue
 */

/**
 * Lo que te deben, cuánto está vencido y de quién. Los tramos de atraso cuentan días desde el vencimiento.
 * Una factura sin fecha de vencimiento se considera «por vencer» (no hay fecha de la que contar).
 * @param {Pick<AppData, 'invoices' | 'invoicePayments'>} data @param {string} today
 */
export function invoiceReceivables(data, today) {
  const open = invoicePositions(data, today).filter((p) => p.balanceCents > 0);
  const aging = { current: 0, d1to30: 0, d31to60: 0, d61plus: 0 };
  /** @type {Map<string, CustomerReceivable>} */
  const byCustomer = new Map();
  for (const p of open) {
    if (p.daysOverdue === 0) aging.current += p.balanceCents;
    else if (p.daysOverdue <= 30) aging.d1to30 += p.balanceCents;
    else if (p.daysOverdue <= 60) aging.d31to60 += p.balanceCents;
    else aging.d61plus += p.balanceCents;
    const key = customerKey(p.invoice);
    const row = byCustomer.get(key) ?? { key, customerName: p.invoice.customerName, invoices: 0, balanceCents: 0, overdueCents: 0, oldestDaysOverdue: 0 };
    row.invoices += 1;
    row.balanceCents += p.balanceCents;
    if (p.daysOverdue > 0) row.overdueCents += p.balanceCents;
    row.oldestDaysOverdue = Math.max(row.oldestDaysOverdue, p.daysOverdue);
    byCustomer.set(key, row);
  }
  const customers = [...byCustomer.values()].sort((a, b) => b.balanceCents - a.balanceCents || a.customerName.localeCompare(b.customerName, 'es', { sensitivity: 'base' }));
  const overdue = open.filter((p) => p.status === 'overdue');
  return {
    totalCents: open.reduce((s, p) => s + p.balanceCents, 0),
    openCount: open.length,
    overdueCents: overdue.reduce((s, p) => s + p.balanceCents, 0),
    overdueCount: overdue.length,
    oldestDaysOverdue: overdue.reduce((m, p) => Math.max(m, p.daysOverdue), 0),
    aging,
    customers,
  };
}

/**
 * Lo facturado (facturas vigentes emitidas) y lo cobrado entre dos fechas, ambas incluidas.
 * @param {Pick<AppData, 'invoices' | 'invoicePayments'>} data @param {string} from @param {string} to
 */
export function invoiceActivity(data, from, to) {
  const billed = data.invoices.filter((i) => i.voidedAt === undefined && i.issueDate >= from && i.issueDate <= to);
  const active = new Set(data.invoices.filter((i) => i.voidedAt === undefined).map((i) => i.id));
  return {
    billedCount: billed.length,
    billedCents: billed.reduce((s, i) => s + invoiceTotals(i).totalCents, 0),
    collectedCents: data.invoicePayments.filter((p) => active.has(p.invoiceId) && p.date >= from && p.date <= to).reduce((s, p) => s + p.amountCents, 0),
  };
}

/** Nombres de clientes ya usados (para sugerirlos al facturar), del más reciente al más antiguo, sin repetir. @param {Invoice[]} invoices */
export function customerSuggestions(invoices) {
  const seen = new Set();
  /** @type {string[]} */
  const names = [];
  for (const i of sortInvoicesNewestFirst(invoices)) {
    const key = i.customerName.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(i.customerName);
  }
  return names;
}

/**
 * Los datos más recientes de un cliente (para rellenar RNC y contacto al elegirlo). @param {Invoice[]} invoices @param {string} name
 */
export function lastCustomerDetails(invoices, name) {
  const wanted = name.trim().toLocaleLowerCase('es');
  const found = sortInvoicesNewestFirst(invoices).find((i) => i.customerName.toLocaleLowerCase('es') === wanted);
  return found ? { customerTaxId: found.customerTaxId, customerContact: found.customerContact } : null;
}

// ---- Facturas y servicios (Freelancer, 0.14.5) -------------------------------------------------------------

/**
 * Lo facturado de cada servicio en facturas VIGENTES: la suma de sus líneas (cantidad × precio, sin impuesto).
 * Una factura anulada no cuenta: al anularla, lo de sus servicios vuelve a estar «sin facturar».
 * @param {Pick<Invoice, 'id' | 'lines' | 'voidedAt'>[]} invoices @param {string | null} [exceptInvoiceId]
 * @returns {Map<string, number>}
 */
export function billedByService(invoices, exceptInvoiceId = null) {
  /** @type {Map<string, number>} */
  const billed = new Map();
  for (const invoice of invoices) {
    if (invoice.voidedAt !== undefined || invoice.id === exceptInvoiceId) continue;
    for (const line of invoice.lines) {
      if (line.serviceId) billed.set(line.serviceId, (billed.get(line.serviceId) ?? 0) + lineTotalCents(line));
    }
  }
  return billed;
}

/**
 * Lo cobrado DIRECTAMENTE de cada servicio: los ingresos que vinculaste a mano a ese servicio, hasta hoy.
 * Los cobros de facturas no llevan servicio (los cuenta la factura), así que aquí no aparecen.
 * @param {Pick<Movement, 'type' | 'serviceId' | 'date' | 'amountCents'>[]} movements @param {string} today
 * @returns {Map<string, number>}
 */
export function directPaidByService(movements, today) {
  /** @type {Map<string, number>} */
  const paid = new Map();
  for (const m of movements) {
    if (m.type !== 'income' || !m.serviceId || m.date > today) continue;
    paid.set(m.serviceId, (paid.get(m.serviceId) ?? 0) + m.amountCents);
  }
  return paid;
}

/**
 * Lo que a un servicio le queda por facturar: precio − cobrado directo − ya facturado en facturas vigentes, nunca menos de 0.
 * @param {Pick<Service, 'id' | 'priceCents'>} service
 * @param {{ movements: Movement[], invoices: Invoice[], today: string }} data
 */
export function serviceBillingRoom(service, { movements, invoices, today }) {
  const paid = directPaidByService(movements, today).get(service.id) ?? 0;
  const billed = billedByService(invoices).get(service.id) ?? 0;
  return Math.max(0, service.priceCents - paid - billed);
}

// ---- Emitir una factura ---------------------------------------------------------------------------------

/**
 * @typedef {Object} InvoiceLineInput
 * @property {string} description
 * @property {string} [productId]  "" = sin producto del inventario
 * @property {string} [serviceId]  "" = sin servicio (solo Freelancer)
 * @property {string} quantityText
 * @property {string} unitText
 */

/**
 * Lo que llega del formulario (todo es texto).
 * @typedef {Object} InvoiceInput
 * @property {string} [clientId] Ficha del cliente (Freelancer); "" = cliente escrito a mano
 * @property {string} customerName @property {string} [customerTaxId] @property {string} [customerContact]
 * @property {string} issueDate @property {string} [dueDate] @property {string} [taxText] Porcentaje: «18», «18,5»…
 * @property {string} [notes] @property {InvoiceLineInput[]} lines
 */

/**
 * @typedef {Object} ValidInvoice
 * @property {string} customerName @property {string} customerTaxId @property {string} customerContact
 * @property {string} issueDate @property {string} dueDate @property {number} taxRateBp @property {string} notes
 * @property {InvoiceLine[]} lines @property {string} [clientId]
 */

/**
 * Porcentaje escrito como texto («18», «18.5», «7,25») a centésimas de por ciento (1850), sin decimales de coma flotante.
 * @param {string} text @returns {number | null} null si no es un porcentaje de 0 a 100 con hasta 2 decimales
 */
export function parseTaxPercent(text) {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return bp > MAX_TAX_BP ? null : bp;
}

/** 1800 → «18», 725 → «7.25» (para mostrar y para rellenar el formulario). @param {number} bp */
export function formatTaxPercent(bp) {
  const text = (bp / 100).toFixed(2).replace(/\.?0+$/, '');
  return text === '' ? '0' : text;
}

/**
 * @param {string} dueDate @param {string} issueDate @param {Record<string, string>} errors
 * @returns {string}
 */
function checkDueDate(dueDate, issueDate, errors) {
  if (dueDate === '') return '';
  if (!isValidISODate(dueDate)) errors.dueDate = 'Elige una fecha de vencimiento válida o déjala vacía.';
  else if (isValidISODate(issueDate) && dueDate < issueDate) errors.dueDate = 'El vencimiento no puede ser anterior a la fecha de la factura.';
  else if (isValidISODate(issueDate) && dueDate > addDays(issueDate, MAX_DUE_DAYS)) errors.dueDate = 'Ese vencimiento está demasiado lejos.';
  return dueDate;
}

/**
 * Valida los datos del cliente y el vencimiento (comunes a emitir y a editar).
 * @param {{ customerName: string, customerTaxId?: string, customerContact?: string, notes?: string }} input @param {Record<string, string>} errors
 */
function checkCustomer(input, errors) {
  const customerName = cleanText(input.customerName);
  const customerTaxId = cleanText(input.customerTaxId);
  const customerContact = cleanText(input.customerContact);
  const notes = cleanText(input.notes);
  if (!customerName) errors.customerName = 'Escribe el nombre del cliente.';
  else if (customerName.length > LIMITS.customerName) errors.customerName = `Máximo ${LIMITS.customerName} caracteres.`;
  if (customerTaxId.length > LIMITS.customerTaxId) errors.customerTaxId = `Máximo ${LIMITS.customerTaxId} caracteres.`;
  if (customerContact.length > LIMITS.customerContact) errors.customerContact = `Máximo ${LIMITS.customerContact} caracteres.`;
  else if (customerContact && !isValidEmail(customerContact.replace(/\s+/g, '')) && !isValidPhone(customerContact)) {
    errors.customerContact = 'Escribe un correo o un teléfono válido, o déjalo vacío.';
  }
  if (notes.length > LIMITS.invoiceNotes) errors.notes = `Máximo ${LIMITS.invoiceNotes} caracteres.`;
  return { customerName, customerTaxId, customerContact, notes };
}

/**
 * Valida una factura nueva, incluida la regla de oro del inventario: ninguna salida puede dejar el stock en negativo
 * en ningún momento (tampoco con fechas pasadas). Los errores de cada línea se llaman `line0`, `line1`… con el campo
 * (`line0.description`, `line0.quantity`, `line0.unit`, `line0.product`).
 * @param {InvoiceInput} input
 * @param {{ products: Product[], entries: StockEntry[], today: string, time: string, nowISO: string,
 *   clients?: Client[], services?: Service[], movements?: Movement[], invoices?: Invoice[], requireClient?: boolean }} context
 *   `time` y `nowISO` son los que tendrán las salidas de stock al guardarse (el orden entre movimientos del mismo día depende de ellos).
 *   Freelancer: `clients`, `services`, `movements` e `invoices` para comprobar el cliente y lo que le queda a cada servicio;
 *   `requireClient`: la factura debe llevar la ficha de un cliente.
 * @returns {{ ok: true, value: ValidInvoice } | { ok: false, errors: Record<string, string> }}
 */
export function validateInvoice(input, { products, entries, today, time, nowISO, clients = [], services = [], movements = [], invoices = [], requireClient = false }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const { customerName, customerTaxId, customerContact, notes } = checkCustomer(input, errors);

  const clientId = String(input.clientId ?? '');
  const client = clientId ? clients.find((c) => c.id === clientId) : null;
  if (!clientId && requireClient) errors.clientId = 'Elige el cliente de tu lista.';
  else if (clientId && !client) errors.clientId = 'Ese cliente ya no existe.';
  else if (client?.archived) errors.clientId = 'Ese cliente está archivado: reactívalo para facturarle.';

  const issueDate = String(input.issueDate ?? '');
  if (!isValidISODate(issueDate)) errors.issueDate = 'Elige una fecha válida.';
  else if (issueDate > today) errors.issueDate = 'La fecha no puede ser futura: emite solo facturas de lo que ya vendiste.';
  else if (issueDate < MIN_INVOICE_DATE) errors.issueDate = 'Esa fecha está fuera de rango.';
  const dueDate = checkDueDate(String(input.dueDate ?? '').trim(), issueDate, errors);

  let taxRateBp = 0;
  const taxText = cleanText(input.taxText);
  if (taxText) {
    const bp = parseTaxPercent(taxText);
    if (bp === null) errors.tax = 'Escribe un porcentaje de 0 a 100 (por ejemplo 18), con hasta 2 decimales.';
    else taxRateBp = bp;
  }

  /** @type {InvoiceLine[]} */
  const lines = [];
  const inputLines = Array.isArray(input.lines) ? input.lines : [];
  if (inputLines.length === 0) errors.lines = 'Agrega al menos una línea a la factura.';
  else if (inputLines.length > LIMITS.invoiceLines) errors.lines = `Una factura puede tener hasta ${LIMITS.invoiceLines} líneas.`;
  inputLines.slice(0, LIMITS.invoiceLines).forEach((raw, i) => {
    const key = `line${i}`;
    const description = cleanText(raw.description);
    const productId = String(raw.productId ?? '');
    const product = productId ? products.find((p) => p.id === productId) : null;
    if (productId && !product) errors[`${key}.product`] = 'Ese producto ya no existe.';
    else if (product?.archived) errors[`${key}.product`] = 'Ese producto está archivado: reactívalo para venderlo.';
    const serviceId = String(raw.serviceId ?? '');
    const service = serviceId ? services.find((sv) => sv.id === serviceId) : null;
    if (serviceId && productId) errors[`${key}.service`] = 'Una línea lleva un producto o un servicio, no los dos.';
    else if (serviceId && !service) errors[`${key}.service`] = 'Ese servicio ya no existe.';
    else if (service && (!client || service.clientId !== client.id)) errors[`${key}.service`] = 'Ese servicio no es del cliente de esta factura.';
    else if (service?.status === 'cancelled') errors[`${key}.service`] = 'Ese servicio está cancelado: no se factura.';
    if (!description) errors[`${key}.description`] = 'Describe lo que vendes.';
    else if (description.length > LIMITS.invoiceLine) errors[`${key}.description`] = `Máximo ${LIMITS.invoiceLine} caracteres.`;

    const quantityText = cleanText(raw.quantityText);
    let quantity = 0;
    if (!/^\d{1,8}$/.test(quantityText)) errors[`${key}.quantity`] = 'Escribe un número entero de unidades, por ejemplo 3.';
    else if (Number(quantityText) < 1) errors[`${key}.quantity`] = 'La cantidad debe ser al menos 1.';
    else if (Number(quantityText) > MAX_QUANTITY) errors[`${key}.quantity`] = `Máximo ${MAX_QUANTITY.toLocaleString('en-US')} unidades por línea.`;
    else quantity = Number(quantityText);

    let unitCents = 0;
    const unitText = cleanText(raw.unitText);
    const money = parseMoney(unitText);
    if (!unitText) errors[`${key}.unit`] = 'Escribe el precio por unidad.';
    else if (!money.ok) errors[`${key}.unit`] = money.error;
    else if (money.cents <= 0) errors[`${key}.unit`] = 'El precio por unidad debe ser mayor que cero.';
    else unitCents = money.cents;
    if (!errors[`${key}.unit`] && !errors[`${key}.quantity`] && quantity * unitCents > MAX_CENTS) errors[`${key}.unit`] = 'El total de la línea es demasiado grande.';

    lines.push({ description, quantity, unitCents, ...(productId && product ? { productId } : {}), ...(serviceId && service ? { serviceId } : {}) });
  });

  // Regla de una sola fuente: lo que se factura de un servicio no puede pasar de lo que le queda por facturar.
  /** @type {Map<string, { total: number, first: number }>} */
  const perService = new Map();
  lines.forEach((line, i) => {
    if (!line.serviceId || errors[`line${i}.service`] || errors[`line${i}.quantity`] || errors[`line${i}.unit`]) return;
    const row = perService.get(line.serviceId) ?? { total: 0, first: i };
    row.total += lineTotalCents(line);
    perService.set(line.serviceId, row);
  });
  for (const [serviceId, row] of perService) {
    const service = /** @type {Service} */ (services.find((sv) => sv.id === serviceId));
    const room = serviceBillingRoom(service, { movements, invoices, today });
    if (row.total <= room) continue;
    errors[`line${row.first}.unit`] = room === 0
      ? `«${service.name}» ya está facturado o cobrado por completo. Si el precio cambió, edítalo primero en el servicio.`
      : `Pasa de lo que queda por facturar de «${service.name}» (${formatMoney(room)}). Si el precio cambió, edítalo primero en el servicio.`;
  }

  if (!errors.lines && Object.keys(errors).every((k) => !k.startsWith('line') && k !== 'tax') && lines.length > 0) {
    const total = invoiceTotals({ lines, taxRateBp }).totalCents;
    if (total > MAX_CENTS) errors.lines = 'El total de la factura es demasiado grande.';
  }

  // Regla de oro del inventario: las unidades que salen deben existir. Se prueba producto por producto con las salidas
  // ya guardadas MÁS las de esta factura, en el orden en que quedarían.
  if (!errors.issueDate && !errors.lines && inputLines.length > 0) {
    const drafts = stockEntriesFromLines(lines, { invoiceId: '~nueva', ids: lines.map((_, i) => `~linea-${i}`), issueDate, time, nowISO, label: '' });
    for (const productId of new Set(drafts.map((d) => d.productId))) {
      const product = products.find((p) => p.id === productId);
      if (!product) continue;
      const problem = replayProduct([...entries.filter((e) => e.productId === productId), ...drafts.filter((d) => d.productId === productId)]).firstNegative;
      if (!problem) continue;
      const lineIndex = Number(problem.entry.id.startsWith('~linea-') ? problem.entry.id.slice('~linea-'.length) : -1);
      if (lineIndex >= 0) {
        if (!errors[`line${lineIndex}.quantity`]) errors[`line${lineIndex}.quantity`] = negativeMessage(product, problem, true);
      } else if (!errors.issueDate) {
        errors.issueDate = negativeMessage(product, problem, false);
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { customerName, customerTaxId, customerContact, issueDate, dueDate, taxRateBp, notes, lines, ...(client ? { clientId: client.id } : {}) } };
}

/**
 * Las salidas de stock de las líneas que llevan producto (una por línea).
 * @param {InvoiceLine[]} lines
 * @param {{ invoiceId: string, ids: string[], issueDate: string, time: string, nowISO: string, label: string, isDemo?: boolean }} extra
 *   `ids`: un id por línea (en el mismo orden); solo se usan los de las líneas con producto.
 * @returns {StockEntry[]}
 */
export function stockEntriesFromLines(lines, { invoiceId, ids, issueDate, time, nowISO, label, isDemo }) {
  /** @type {StockEntry[]} */
  const entries = [];
  lines.forEach((line, i) => {
    if (!line.productId) return;
    entries.push({
      id: ids[i], productId: line.productId, kind: 'sale', quantity: -line.quantity, unitCents: line.unitCents, date: issueDate, time,
      invoiceId, note: label, createdAt: nowISO, updatedAt: nowISO, ...(isDemo ? { isDemo: true } : {}),
    });
  });
  return entries;
}

/**
 * @param {ValidInvoice} value @param {{ id: string, number: number, nowISO: string, isDemo?: boolean }} extra
 * @returns {Invoice}
 */
export function buildInvoice(value, { id, number, nowISO, isDemo }) {
  return { id, number, ...value, createdAt: nowISO, updatedAt: nowISO, ...(isDemo ? { isDemo: true } : {}) };
}

// ---- Editar los datos que no tocan el dinero -----------------------------------------------------------------

/**
 * Lo que sí se puede cambiar después de emitir: el cliente (nombre, RNC y contacto), el vencimiento y las notas.
 * @typedef {Object} InvoiceEditInput
 * @property {string} customerName @property {string} [customerTaxId] @property {string} [customerContact] @property {string} [dueDate] @property {string} [notes]
 */

/**
 * @param {InvoiceEditInput} input @param {Invoice} invoice
 * @returns {{ ok: true, value: Pick<Invoice, 'customerName' | 'customerTaxId' | 'customerContact' | 'dueDate' | 'notes'> } | { ok: false, errors: Record<string, string> }}
 */
export function validateInvoiceEdit(input, invoice) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (invoice.voidedAt !== undefined) errors.form = 'Esta factura está anulada y ya no se puede cambiar.';
  const { customerName, customerTaxId, customerContact, notes } = checkCustomer(input, errors);
  const dueDate = checkDueDate(String(input.dueDate ?? '').trim(), invoice.issueDate, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { customerName, customerTaxId, customerContact, dueDate, notes } };
}

// ---- Anular -----------------------------------------------------------------------------------------------

/**
 * ¿Se puede anular? No si ya está anulada ni si tiene cobros (primero se borran los cobros, para que el dinero no quede huérfano).
 * @param {Invoice} invoice @param {InvoicePayment[]} payments Los cobros de todas las facturas.
 * @returns {string | null} el motivo, si no se puede
 */
export function voidProblem(invoice, payments) {
  if (invoice.voidedAt !== undefined) return 'Esta factura ya está anulada.';
  const own = payments.filter((p) => p.invoiceId === invoice.id).length;
  if (own > 0) {
    return `Esta factura tiene ${own === 1 ? 'un cobro registrado' : `${own} cobros registrados`}. Borra primero ${own === 1 ? 'ese cobro' : 'esos cobros'} (su ingreso se quita también) y después anula la factura.`;
  }
  return null;
}

// ---- Cobros ---------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} PaymentInput
 * @property {string} amountText @property {string} date @property {string} [categoryId] @property {string} [note]
 */

/** @typedef {{ amountCents: number, date: string, categoryId: string, note: string }} ValidPayment */

/**
 * Valida un cobro: positivo, que no pase de lo que falta, con fecha entre la de la factura y hoy, y una categoría de ingreso.
 * @param {PaymentInput} input
 * @param {{ invoice: Invoice, payments: InvoicePayment[], categories: Category[], today: string }} context  `payments`: los de todas las facturas.
 * @returns {{ ok: true, value: ValidPayment } | { ok: false, errors: Record<string, string> }}
 */
export function validateInvoicePayment(input, { invoice, payments, categories, today }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const position = invoicePosition(invoice, payments, today);
  if (invoice.voidedAt !== undefined) errors.form = 'Esta factura está anulada: no se puede cobrar.';
  else if (position.balanceCents === 0) errors.form = 'Esta factura ya está cobrada por completo.';

  let amountCents = 0;
  const money = parseMoney(input.amountText);
  if (!cleanText(input.amountText)) errors.amount = 'Escribe cuánto te pagaron.';
  else if (!money.ok) errors.amount = money.error;
  else if (money.cents <= 0) errors.amount = 'El cobro debe ser mayor que cero.';
  else if (!errors.form && money.cents > position.balanceCents) errors.amount = `Solo faltan ${formatMoney(position.balanceCents)} por cobrar de esta factura.`;
  else amountCents = money.cents;

  if (!isValidISODate(input.date)) errors.date = 'Elige una fecha válida.';
  else if (input.date > today) errors.date = 'La fecha no puede ser futura: registra solo lo que ya cobraste.';
  else if (input.date < invoice.issueDate) errors.date = 'El cobro no puede ser anterior a la fecha de la factura.';

  const category = categories.find((c) => c.id === input.categoryId);
  if (!category) errors.category = 'Elige una categoría.';
  else if (category.kind !== 'income') errors.category = 'Esa categoría no es de ingresos.';

  const note = cleanText(input.note);
  if (note.length > LIMITS.paymentNote) errors.note = `Máximo ${LIMITS.paymentNote} caracteres.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { amountCents, date: input.date, categoryId: category?.id ?? '', note } };
}

/** Descripción del ingreso de un cobro (máximo `LIMITS.description` caracteres). @param {Invoice} invoice */
export function paymentDescription(invoice) {
  const text = `Cobro ${invoiceLabel(invoice)}: ${invoice.customerName}`;
  return text.length > LIMITS.description ? `${text.slice(0, LIMITS.description - 1).trimEnd()}…` : text;
}

/**
 * El ingreso que acompaña a un cobro.
 * @param {ValidPayment} value @param {Invoice} invoice @param {Category} category
 * @param {{ id: string, time: string, nowISO: string, isDemo?: boolean }} extra
 * @returns {Movement}
 */
export function buildPaymentMovement(value, invoice, category, { id, time, nowISO, isDemo }) {
  const wanted = category.defaultClassification;
  return {
    id,
    type: 'income',
    amountCents: value.amountCents,
    date: value.date,
    time,
    description: paymentDescription(invoice),
    classification: CLASSIFICATIONS_BY_TYPE.income.includes(wanted) ? wanted : 'variable',
    categoryId: category.id,
    // El cobro cuenta en lo «cobrado» del cliente (una sola vez). No lleva servicio: lo facturado del servicio ya lo cuenta la factura.
    ...(invoice.clientId ? { clientId: invoice.clientId } : {}),
    createdAt: nowISO,
    updatedAt: nowISO,
    ...(isDemo ? { isDemo: true } : {}),
  };
}

/**
 * @param {ValidPayment} value @param {{ id: string, invoiceId: string, time: string, nowISO: string, movementId: string, isDemo?: boolean }} extra
 * @returns {InvoicePayment}
 */
export function buildInvoicePayment(value, { id, invoiceId, time, nowISO, movementId, isDemo }) {
  return {
    id, invoiceId, amountCents: value.amountCents, date: value.date, time, note: value.note, movementId,
    createdAt: nowISO, updatedAt: nowISO, ...(isDemo ? { isDemo: true } : {}),
  };
}

// ---- Avisos ----------------------------------------------------------------------------------------------------

/**
 * Aviso de facturas vencidas (reglas fijas, no IA). Rojo si alguna lleva más de 30 días de atraso.
 * @param {Pick<AppData, 'invoices' | 'invoicePayments'>} data @param {string} today
 * @returns {{ id: string, level: 'critical' | 'info', text: string }[]}
 */
export function invoiceNotices(data, today) {
  const r = invoiceReceivables(data, today);
  if (r.overdueCount === 0) return [];
  return [{
    id: 'invoices-overdue',
    level: r.oldestDaysOverdue > 30 ? 'critical' : 'info',
    text: `${r.overdueCount === 1 ? 'Tienes una factura vencida' : `Tienes ${r.overdueCount} facturas vencidas`} por ${formatMoney(r.overdueCents)} (la más atrasada, ${r.oldestDaysOverdue} ${r.oldestDaysOverdue === 1 ? 'día' : 'días'}). Mira «Facturas».`,
  }];
}

/** Para mostrar fechas de vencimiento: «vence el 5 jul 2026» o «sin vencimiento». @param {Invoice} invoice */
export function dueText(invoice) {
  return invoice.dueDate ? `vence el ${formatDate(invoice.dueDate)}` : 'sin vencimiento';
}

// ---- Recordatorios de cobro (0.14.5) ------------------------------------------------------------------------------

/**
 * Facturas vencidas con saldo, de la más atrasada a la menos. ACCONTROL NO envía recordatorios: esta lista sirve para que
 * la persona copie el mensaje y lo mande ella (los envíos automáticos llegan con las notificaciones, etapa 0.18).
 * @param {Pick<AppData, 'invoices' | 'invoicePayments'>} data @param {string} today
 */
export function overdueInvoices(data, today) {
  return invoicePositions(data, today)
    .filter((p) => p.status === 'overdue')
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.invoice.number - b.invoice.number);
}

/**
 * Mensaje de recordatorio de cobro, listo para copiar y enviar por WhatsApp o correo. Solo datos de la factura: fecha,
 * vencimiento, saldo y lo ya recibido. Cortés y sin amenazas.
 * @param {InvoicePosition} position @param {{ senderName?: string }} [options]  senderName: quien firma (puede ir vacío)
 */
export function reminderMessage(position, { senderName = '' } = {}) {
  const { invoice } = position;
  const due = invoice.dueDate
    ? position.status === 'overdue' ? `, que venció el ${formatDate(invoice.dueDate)}` : `, que vence el ${formatDate(invoice.dueDate)}`
    : '';
  const paid = position.paidCents > 0 ? ` Ya recibí ${formatMoney(position.paidCents)} de ${formatMoney(position.totalCents)}.` : '';
  const lines = [
    `Hola, ${invoice.customerName}.`,
    `Te escribo para recordarte la factura ${invoiceLabel(invoice)} del ${formatDate(invoice.issueDate)}${due}. El saldo pendiente es de ${formatMoney(position.balanceCents)}.${paid}`,
    '¿Me confirmas cuándo podrás pagarla? Si ya la pagaste, por favor ignora este mensaje. ¡Gracias!',
  ];
  const sender = cleanText(senderName);
  if (sender) lines.push(sender);
  return lines.join('\n\n');
}
