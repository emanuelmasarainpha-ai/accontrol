// @ts-check
// =============================================================================
// CLIENTES Y SERVICIOS (documento maestro §9, Sistema Freelancer)
// -----------------------------------------------------------------------------
// Un CLIENTE es una persona o empresa a la que le prestas servicios. Un SERVICIO es
// un trabajo concreto para un cliente: nombre, precio acordado, duración estimada y
// estado (Pendiente, En proceso, Finalizado o Cancelado).
//
// Los PAGOS no se guardan aparte: son ingresos normales (Finanzas) vinculados a un
// cliente y, si se quiere, a un servicio. Así un pago cuenta una sola vez en
// «Disponible», en las estadísticas y en los reportes, y lo cobrado de un servicio es
// siempre la suma de sus ingresos vinculados (no se puede desincronizar).
// =============================================================================

import { EMAIL_ERROR, PHONE_ERROR, cleanText, isValidEmail, isValidPhone } from './contact.js';
import { isValidISODate } from './dates.js';
import { formatMoney, MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Client} Client */
/** @typedef {import('./types.js').Service} Service */
/** @typedef {import('./types.js').ServiceStatus} ServiceStatus */
/** @typedef {import('./types.js').AppData} AppData */

/** @type {readonly ServiceStatus[]} */
export const SERVICE_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'];

/** @type {Record<ServiceStatus, string>} */
export const SERVICE_STATUS_LABELS = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  done: 'Finalizado',
  cancelled: 'Cancelado',
};

export const MIN_SERVICE_DATE = '2000-01-01';
export const MAX_SERVICE_DATE = '2100-12-31';
export const MAX_ESTIMATED_DAYS = 3650;

/** @param {unknown} value @returns {value is ServiceStatus} */
export function isServiceStatus(value) {
  return typeof value === 'string' && /** @type {readonly string[]} */ (SERVICE_STATUSES).includes(value);
}

/**
 * De qué cliente es un movimiento: «Ana Pérez · Logo» en un ingreso con servicio, o solo el cliente (vacío si no está vinculado a uno).
 * @param {Pick<AppData, 'clients' | 'services'>} data @param {{ clientId?: string, serviceId?: string }} movement
 */
export function movementLinkText(data, movement) {
  if (!movement.clientId) return '';
  const client = data.clients.find((c) => c.id === movement.clientId);
  const service = movement.serviceId ? data.services.find((x) => x.id === movement.serviceId) : undefined;
  if (!client) return '';
  return service ? `${clientFullName(client)} · ${service.name}` : clientFullName(client);
}

/**
 * ¿Se ofrece el módulo de clientes en este espacio? En los espacios Freelancer siempre; en los demás, solo si ya
 * tienen clientes (por ejemplo, porque se restauró una copia que los traía), para que nunca queden datos escondidos.
 * @param {string | null | undefined} workspaceKind @param {Pick<AppData, 'clients'>} data
 */
export function clientsEnabled(workspaceKind, data) {
  return workspaceKind === 'freelancer' || data.clients.length > 0;
}

/** @param {string} text */
const fold = (text) => text.toLocaleLowerCase('es');

// ---- Clientes -------------------------------------------------------------------------------------

/**
 * Lo que llega del formulario (todo es texto).
 * @typedef {Object} ClientInput
 * @property {string} firstName @property {string} [lastName] @property {string} [company]
 * @property {string} [email] @property {string} [phone] @property {string} [country] @property {string} [notes]
 */

/** @param {Pick<Client, 'firstName' | 'lastName'>} c Nombre y apellido. */
export function clientFullName(c) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}

/** Cómo se muestra un cliente en listas: «Ana Pérez · Estudio Sol». @param {Pick<Client, 'firstName' | 'lastName' | 'company'>} c */
export function clientLabel(c) {
  return c.company ? `${clientFullName(c)} · ${c.company}` : clientFullName(c);
}

/**
 * Valida un cliente. Solo el nombre es obligatorio. No se permiten dos clientes con el mismo nombre, apellido y empresa.
 * @param {ClientInput} input
 * @param {{ clients: Client[], exceptId?: string | null }} context
 * @returns {{ ok: true, value: Pick<Client, 'firstName' | 'lastName' | 'company' | 'email' | 'phone' | 'country' | 'notes'> } | { ok: false, errors: Record<string, string> }}
 */
export function validateClient(input, { clients, exceptId = null }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const firstName = cleanText(input.firstName);
  const lastName = cleanText(input.lastName);
  const company = cleanText(input.company);
  const email = cleanText(input.email).replace(/\s+/g, '');
  const phone = cleanText(input.phone);
  const country = cleanText(input.country);
  const notes = cleanText(input.notes);

  if (!firstName) errors.firstName = 'Escribe el nombre del cliente.';
  else if (firstName.length > LIMITS.clientName) errors.firstName = `Máximo ${LIMITS.clientName} caracteres.`;
  if (lastName.length > LIMITS.clientName) errors.lastName = `Máximo ${LIMITS.clientName} caracteres.`;
  if (company.length > LIMITS.clientCompany) errors.company = `Máximo ${LIMITS.clientCompany} caracteres.`;
  if (email.length > LIMITS.clientEmail) errors.email = `Máximo ${LIMITS.clientEmail} caracteres.`;
  else if (email && !isValidEmail(email)) errors.email = EMAIL_ERROR;
  if (phone.length > LIMITS.clientPhone) errors.phone = `Máximo ${LIMITS.clientPhone} caracteres.`;
  else if (phone && !isValidPhone(phone)) errors.phone = PHONE_ERROR;
  if (country.length > LIMITS.clientCountry) errors.country = `Máximo ${LIMITS.clientCountry} caracteres.`;
  if (notes.length > LIMITS.clientNotes) errors.notes = `Máximo ${LIMITS.clientNotes} caracteres.`;

  if (!errors.firstName && !errors.lastName && !errors.company) {
    const key = fold(`${firstName}|${lastName}|${company}`);
    if (clients.some((c) => c.id !== exceptId && fold(`${c.firstName}|${c.lastName}|${c.company}`) === key)) {
      errors.firstName = 'Ya tienes un cliente con ese nombre y esa empresa.';
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { firstName, lastName, company, email, phone, country, notes } };
}

/**
 * @param {Omit<Client, 'id' | 'archived' | 'createdAt' | 'updatedAt' | 'isDemo'>} value
 * @param {{ id: string, nowISO: string }} extra
 * @returns {Client}
 */
export function buildClient(value, { id, nowISO }) {
  return { id, ...value, archived: false, createdAt: nowISO, updatedAt: nowISO };
}

/** Conserva id, fecha de creación, archivado y marca de demostración. @param {Client} existing @param {Omit<Client, 'id' | 'archived' | 'createdAt' | 'updatedAt' | 'isDemo'>} value @param {string} nowISO @returns {Client} */
export function applyClientEdit(existing, value, nowISO) {
  return { ...existing, ...value, updatedAt: nowISO };
}

/** Alfabético (sin importar tildes ni mayúsculas); los archivados al final. @param {Client[]} list */
export function sortClients(list) {
  return [...list].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || clientLabel(a).localeCompare(clientLabel(b), 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/**
 * Cuánto está usado un cliente: sirve para decidir si se puede borrar (solo si no tiene nada).
 * `payments` son los ingresos (pagos) y `expenses` los gastos que se le cargaron.
 * @param {Pick<AppData, 'services' | 'movements'> & Partial<Pick<AppData, 'invoices'>>} data @param {string} clientId
 */
export function clientUsage(data, clientId) {
  return {
    invoices: (data.invoices ?? []).filter((i) => i.clientId === clientId).length,
    services: data.services.filter((s) => s.clientId === clientId).length,
    payments: data.movements.filter((m) => m.clientId === clientId && m.type === 'income').length,
    expenses: data.movements.filter((m) => m.clientId === clientId && m.type === 'expense').length,
  };
}

// ---- Servicios ------------------------------------------------------------------------------------

/**
 * @typedef {Object} ServiceInput
 * @property {string} clientId @property {string} name @property {string} priceText
 * @property {string} [estimatedDaysText] @property {string} status @property {string} [startDate]
 */

/**
 * @param {ServiceInput} input
 * @param {{ clients: Client[], existing?: Service | null, linkedPayments?: number, invoiceLines?: number, billedCents?: number }} context
 *   `linkedPayments`: ingresos ya vinculados al servicio que se edita (con pagos, el cliente no puede cambiar).
 *   `invoiceLines`: líneas de facturas (también anuladas) que lo nombran: con ellas, el cliente no puede cambiar.
 *   `billedCents`: lo facturado en facturas vigentes: el precio no puede bajar de ahí (0.14.5, regla de una sola fuente).
 * @returns {{ ok: true, value: { clientId: string, name: string, priceCents: number, estimatedDays: number | null, status: ServiceStatus, startDate: string } } | { ok: false, errors: Record<string, string> }}
 */
export function validateService(input, { clients, existing = null, linkedPayments = 0, invoiceLines = 0, billedCents = 0 }) {
  /** @type {Record<string, string>} */
  const errors = {};

  const client = clients.find((c) => c.id === input.clientId);
  if (!client) errors.clientId = 'Elige un cliente.';
  else if (existing && existing.clientId !== client.id && linkedPayments > 0) {
    errors.clientId = 'Este servicio ya tiene pagos registrados: no se puede pasar a otro cliente.';
  } else if (existing && existing.clientId !== client.id && invoiceLines > 0) {
    errors.clientId = 'Este servicio está en una factura: no se puede pasar a otro cliente.';
  }

  const name = cleanText(input.name);
  if (!name) errors.name = 'Ponle un nombre al servicio.';
  else if (name.length > LIMITS.serviceName) errors.name = `Máximo ${LIMITS.serviceName} caracteres.`;

  let priceCents = 0;
  const money = parseMoney(input.priceText);
  if (!money.ok) errors.price = money.error;
  else if (money.cents <= 0) errors.price = 'El precio debe ser mayor que cero.';
  else if (money.cents > MAX_CENTS) errors.price = 'El monto es demasiado grande.';
  else if (money.cents < billedCents) errors.price = `Ya facturaste ${formatMoney(billedCents)} de este servicio: el precio no puede ser menor. Si te equivocaste, anula esa factura.`;
  else priceCents = money.cents;

  /** @type {number | null} */
  let estimatedDays = null;
  const daysText = cleanText(input.estimatedDaysText);
  if (daysText) {
    if (!/^\d{1,4}$/.test(daysText) || Number(daysText) < 1 || Number(daysText) > MAX_ESTIMATED_DAYS) {
      errors.estimatedDays = `Escribe un número de días entre 1 y ${MAX_ESTIMATED_DAYS}, o déjalo vacío.`;
    } else {
      estimatedDays = Number(daysText);
    }
  }

  const status = isServiceStatus(input.status) ? input.status : null;
  if (!status) errors.status = 'Elige un estado.';

  const startDate = cleanText(input.startDate);
  if (startDate) {
    if (!isValidISODate(startDate)) errors.startDate = 'Elige una fecha válida.';
    else if (startDate < MIN_SERVICE_DATE || startDate > MAX_SERVICE_DATE) errors.startDate = 'Esa fecha está fuera de rango.';
  }

  if (Object.keys(errors).length > 0 || !status) return { ok: false, errors };
  return { ok: true, value: { clientId: input.clientId, name, priceCents, estimatedDays, status, startDate } };
}

/**
 * @param {{ clientId: string, name: string, priceCents: number, estimatedDays: number | null, status: ServiceStatus, startDate: string }} value
 * @param {{ id: string, nowISO: string }} extra
 * @returns {Service}
 */
export function buildService(value, { id, nowISO }) {
  return { id, ...value, createdAt: nowISO, updatedAt: nowISO };
}

/** @param {Service} existing @param {{ clientId: string, name: string, priceCents: number, estimatedDays: number | null, status: ServiceStatus, startDate: string }} value @param {string} nowISO @returns {Service} */
export function applyServiceEdit(existing, value, nowISO) {
  return { ...existing, ...value, updatedAt: nowISO };
}

/** Lo más reciente primero (fecha de inicio o, si no tiene, de creación). @param {Service[]} list */
export function sortServices(list) {
  const key = (/** @type {Service} */ s) => s.startDate || s.createdAt.slice(0, 10);
  return [...list].sort((a, b) => key(b).localeCompare(key(a)) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
