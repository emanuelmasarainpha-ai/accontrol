// @ts-check
// =============================================================================
// INGRESOS Y GASTOS: validación y construcción de registros
// -----------------------------------------------------------------------------
// Aquí viven las reglas del documento maestro §4.1 y §4.2: cada movimiento
// lleva monto, fecha, hora, descripción, clasificación y categoría.
// Las funciones no tocan la pantalla ni el almacenamiento: reciben datos y
// devuelven un resultado. Por eso se pueden probar fácilmente.
// =============================================================================

import { validateCategoryName } from './categories.js';
import { isValidISODate, isValidTime } from './dates.js';
import { checkForeign } from './exchange.js';
import { MAX_CENTS, parseMoney } from './money.js';
import { CLASSIFICATIONS_BY_TYPE, LIMITS } from './types.js';

/** @typedef {import('./types.js').Movement} Movement */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').MovementType} MovementType */
/** @typedef {import('./types.js').Classification} Classification */
/** @typedef {import('./types.js').Client} Client */
/** @typedef {import('./types.js').Service} Service */
/** @typedef {import('./types.js').Department} Department */

/**
 * Lo que llega del formulario (todo es texto).
 * @typedef {Object} MovementInput
 * @property {string} type
 * @property {string} amountText
 * @property {string} date
 * @property {string} time
 * @property {string} description
 * @property {string} classification
 * @property {string} categoryId            Id de una categoría existente, o "" si es nueva.
 * @property {string} [newCategoryName]     Nombre si el usuario eligió "Nueva categoría".
 * @property {string} [clientId]            Ingreso: de qué cliente viene el pago. Gasto: a qué cliente se le carga ("" = ninguno).
 * @property {string} [serviceId]           Solo ingresos: a qué servicio corresponde ("" = ninguno).
 * @property {string} [departmentId]        Solo gastos: a qué departamento se carga ("" = ninguno).
 * @property {string} [currency]            0.18.5: en qué moneda se pagó ("" o la del espacio = normal). Con otra, amountText es lo pagado en ESA moneda.
 * @property {string} [rateText]            0.18.5: la tasa de ese día (1 unidad de esa moneda = X de la del espacio).
 */

/**
 * Datos ya validados y limpios.
 * @typedef {Object} ValidMovement
 * @property {MovementType} type
 * @property {number} amountCents
 * @property {string} date
 * @property {string} time
 * @property {string} description
 * @property {Classification} classification
 * @property {string} categoryId            "" cuando hay que crear la categoría nueva.
 * @property {string} newCategoryName       "" cuando se usa una categoría existente.
 * @property {string} clientId              "" si el ingreso no es de un cliente.
 * @property {string} serviceId             "" si el ingreso no es de un servicio.
 * @property {string} departmentId          "" si el gasto no se carga a un departamento.
 * @property {{ currency: import('./currencies.js').CurrencyCode, amountCents: number, rateMicro: number } | null} foreign  0.18.5: lo pagado en otra moneda (amountCents ya está convertido).
 */

/**
 * @param {MovementInput} input
 * @param {{ categories: Category[], today: string, clients?: Client[], services?: Service[], departments?: Department[], baseCurrency?: string }} context
 *   baseCurrency (0.18.5): la moneda del espacio; sin ella no se aceptan pagos en otra moneda.
 * @returns {{ ok: true, value: ValidMovement } | { ok: false, errors: Record<string, string> }}
 */
export function validateMovement(input, { categories, today, clients = [], services = [], departments = [], baseCurrency = '' }) {
  /** @type {Record<string, string>} */
  const errors = {};

  const type = input.type === 'income' || input.type === 'expense' ? input.type : null;
  if (!type) errors.type = 'Elige si es un ingreso o un gasto.';

  let amountCents = 0;
  const money = parseMoney(input.amountText);
  if (!money.ok) {
    errors.amount = money.error;
  } else if (money.cents <= 0) {
    errors.amount = 'El monto debe ser mayor que cero.';
  } else if (money.cents > MAX_CENTS) {
    errors.amount = 'El monto es demasiado grande.';
  } else {
    amountCents = money.cents;
  }

  // 0.18.5: pagado en otra moneda. El monto escrito es el de esa moneda; se guarda convertido con la tasa.
  /** @type {ValidMovement['foreign']} */
  let foreign = null;
  const wantsForeign = input.currency !== undefined && input.currency !== '' && input.currency !== baseCurrency;
  if (wantsForeign && !baseCurrency) {
    errors.currency = 'En este espacio no se puede registrar en otra moneda.';
  } else if (wantsForeign) {
    const fx = checkForeign({ currency: input.currency, amountCents: amountCents || 1, rateText: input.rateText, baseCurrency });
    if (!fx.ok) Object.assign(errors, fx.errors);
    else if (fx.foreign && amountCents > 0) {
      foreign = { currency: fx.foreign.currency, amountCents, rateMicro: fx.foreign.rateMicro };
      amountCents = fx.foreign.convertedCents;
    }
  }

  if (!isValidISODate(input.date)) {
    errors.date = 'Elige una fecha válida.';
  } else if (input.date > today) {
    errors.date = 'La fecha no puede ser futura: registra solo lo que ya ocurrió.';
  }

  if (!isValidTime(input.time)) errors.time = 'Elige una hora válida.';

  const description = String(input.description ?? '').trim().replace(/\s+/g, ' ');
  if (!description) errors.description = 'Escribe una descripción.';
  else if (description.length > LIMITS.description) {
    errors.description = `Máximo ${LIMITS.description} caracteres.`;
  }

  /** @type {Classification | null} */
  let classification = null;
  if (type) {
    const allowed = CLASSIFICATIONS_BY_TYPE[type];
    const wanted = /** @type {Classification} */ (input.classification);
    if (allowed.includes(wanted)) classification = wanted;
    else errors.classification = 'Elige una clasificación.';
  }

  let categoryId = '';
  let newCategoryName = '';
  const wantsNew = String(input.newCategoryName ?? '').trim() !== '' && !input.categoryId;
  if (type && wantsNew) {
    const named = validateCategoryName(String(input.newCategoryName), type, categories);
    if (!named.ok) errors.category = named.error;
    else newCategoryName = named.name;
  } else if (type) {
    const found = categories.find((c) => c.id === input.categoryId);
    if (!found) errors.category = 'Elige una categoría.';
    else if (found.kind !== type) errors.category = 'Esa categoría no corresponde a este tipo.';
    else categoryId = found.id;
  }

  // Cliente y servicio. Un ingreso se vincula a un cliente (y a un servicio suyo, que ya trae a su cliente); un gasto
  // puede cargarse a un cliente (costo directo de trabajarle), pero no a un servicio.
  let clientId = '';
  let serviceId = '';
  const wantedClient = String(input.clientId ?? '');
  const wantedService = String(input.serviceId ?? '');
  if (wantedClient || wantedService) {
    if (type === 'expense' && wantedService) {
      errors.service = 'Solo los ingresos se vinculan a un servicio.';
    } else if (type === 'expense') {
      if (!clients.some((c) => c.id === wantedClient)) errors.client = 'Ese cliente ya no existe.';
      else clientId = wantedClient;
    } else if (wantedService) {
      const service = services.find((s) => s.id === wantedService);
      if (!service) errors.service = 'Ese servicio ya no existe.';
      else if (wantedClient && wantedClient !== service.clientId) errors.service = 'Ese servicio no es de ese cliente.';
      else if (!clients.some((c) => c.id === service.clientId)) errors.client = 'Ese cliente ya no existe.';
      else { serviceId = service.id; clientId = service.clientId; }
    } else if (!clients.some((c) => c.id === wantedClient)) {
      errors.client = 'Ese cliente ya no existe.';
    } else {
      clientId = wantedClient;
    }
  }

  // Departamento: solo los gastos se cargan a un área.
  let departmentId = '';
  const wantedDepartment = String(input.departmentId ?? '');
  if (wantedDepartment) {
    if (type === 'income') errors.department = 'Solo los gastos se cargan a un departamento.';
    else if (!departments.some((d) => d.id === wantedDepartment)) errors.department = 'Ese departamento ya no existe.';
    else departmentId = wantedDepartment;
  }

  if (Object.keys(errors).length > 0 || !type || !classification) return { ok: false, errors };

  return {
    ok: true,
    value: {
      type,
      amountCents,
      date: input.date,
      time: input.time,
      description,
      classification,
      categoryId,
      newCategoryName,
      clientId,
      serviceId,
      departmentId,
      foreign,
    },
  };
}

/**
 * Crea un movimiento nuevo.
 * @param {ValidMovement} value
 * @param {{ id: string, categoryId: string, nowISO: string }} extra
 * @returns {Movement}
 */
export function buildMovement(value, { id, categoryId, nowISO }) {
  return {
    id,
    type: value.type,
    amountCents: value.amountCents,
    date: value.date,
    time: value.time,
    description: value.description,
    classification: value.classification,
    categoryId,
    ...(value.clientId ? { clientId: value.clientId } : {}),
    ...(value.serviceId ? { serviceId: value.serviceId } : {}),
    ...(value.departmentId ? { departmentId: value.departmentId } : {}),
    ...foreignFields(value.foreign),
    createdAt: nowISO,
    updatedAt: nowISO,
  };
}

/**
 * Devuelve una copia del movimiento con los cambios aplicados.
 * Conserva id, fecha de creación y la marca de demostración.
 * @param {Movement} existing
 * @param {ValidMovement} value
 * @param {{ categoryId: string, nowISO: string }} extra
 * @returns {Movement}
 */
export function applyMovementEdit(existing, value, { categoryId, nowISO }) {
  // El vínculo y la moneda original los decide lo que se acaba de validar.
  const { clientId: _client, serviceId: _service, departmentId: _department, originalCurrency: _oc, originalAmountCents: _oa, exchangeRateMicro: _rate, ...rest } = existing;
  return {
    ...rest,
    type: existing.type, // el tipo no cambia al editar
    amountCents: value.amountCents,
    date: value.date,
    time: value.time,
    description: value.description,
    classification: value.classification,
    categoryId,
    ...(value.clientId ? { clientId: value.clientId } : {}),
    ...(value.serviceId ? { serviceId: value.serviceId } : {}),
    ...(value.departmentId ? { departmentId: value.departmentId } : {}),
    ...foreignFields(value.foreign),
    updatedAt: nowISO,
  };
}

/** Los tres campos de lo pagado en otra moneda (o ninguno). @param {ValidMovement['foreign']} foreign */
function foreignFields(foreign) {
  return foreign
    ? { originalCurrency: foreign.currency, originalAmountCents: foreign.amountCents, exchangeRateMicro: foreign.rateMicro }
    : {};
}

/**
 * Orden estándar de la lista: lo más reciente primero (fecha, hora y, si empatan, creación).
 * @param {{date: string, time: string, createdAt: string}} a
 * @param {{date: string, time: string, createdAt: string}} b
 */
export function compareNewestFirst(a, b) {
  return (
    b.date.localeCompare(a.date) ||
    b.time.localeCompare(a.time) ||
    b.createdAt.localeCompare(a.createdAt)
  );
}
