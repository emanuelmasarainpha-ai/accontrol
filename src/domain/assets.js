// @ts-check
// =============================================================================
// ACTIVOS (documento maestro §5)
// -----------------------------------------------------------------------------
// Un activo es algo que posees y que vale dinero: una cuenta, una inversión, un
// vehículo, una casa... Se registra a mano. Su valor cambia con el tiempo y cada
// cambio es un punto con fecha: así el historial del patrimonio no reescribe el
// pasado cuando hoy actualizas el valor.
//
// OJO para no contar dos veces: el dinero que ya registras con tus ingresos y
// gastos (lo "Disponible" y lo ahorrado en metas) YA cuenta en el patrimonio.
// Registra aquí solo lo que NO está en esos movimientos.
// =============================================================================

import { isValidISODate } from './dates.js';
import { MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Asset} Asset */
/** @typedef {import('./types.js').AssetCategory} AssetCategory */
/** @typedef {import('./types.js').AssetValuation} AssetValuation */

/**
 * Categorías y tipos del documento maestro §5.
 * @type {Record<AssetCategory, { label: string, hint: string, subtypes: Record<string, string> }>}
 */
export const ASSET_CATEGORIES = {
  cash: {
    label: 'Efectivo',
    hint: 'Dinero físico que NO has registrado como ingreso. Si ya lo cuentas en tu dinero disponible, no lo repitas aquí.',
    subtypes: {},
  },
  bank: {
    label: 'Cuentas bancarias',
    hint: 'Dinero en otras cuentas que NO está en tus movimientos. Si ya lo cuentas en tu dinero disponible, no lo repitas aquí.',
    subtypes: { savings: 'Cuenta de ahorro', checking: 'Cuenta corriente' },
  },
  investments: {
    label: 'Inversiones',
    hint: 'Pon el valor de mercado más reciente que conozcas.',
    subtypes: { stocks: 'Acciones', etf: 'ETFs', bonds: 'Bonos', funds: 'Fondos mutuos', certificates: 'Certificados financieros' },
  },
  vehicles: {
    label: 'Vehículos',
    hint: 'Pon lo que podrías venderlo hoy, no lo que pagaste.',
    subtypes: { car: 'Automóvil', motorcycle: 'Motocicleta', commercial: 'Vehículo comercial' },
  },
  realEstate: {
    label: 'Bienes inmobiliarios',
    hint: 'Pon el valor estimado de venta hoy. Si debes una hipoteca, regístrala en Deudas.',
    subtypes: { house: 'Casa', apartment: 'Apartamento', land: 'Terreno', commercial: 'Local comercial' },
  },
  business: {
    label: 'Negocios',
    hint: 'Tu parte del valor estimado de un negocio.',
    subtypes: { stake: 'Participación empresarial' },
  },
  other: {
    label: 'Otros activos',
    hint: 'Cualquier otra cosa de valor.',
    subtypes: { jewelry: 'Joyas', art: 'Obras de arte', collectibles: 'Coleccionables', equipment: 'Equipos especializados' },
  },
};

/** Orden de las categorías en pantalla. @type {AssetCategory[]} */
export const ASSET_CATEGORY_ORDER = ['cash', 'bank', 'investments', 'vehicles', 'realEstate', 'business', 'other'];

/** Fecha más antigua que se acepta (evita errores de tecleo como 0202). */
export const MIN_ASSET_DATE = '1900-01-01';

/** @param {unknown} value @returns {value is AssetCategory} */
export function isAssetCategory(value) {
  return typeof value === 'string' && Object.hasOwn(ASSET_CATEGORIES, value);
}

/** @param {AssetCategory} category @param {string} subtype */
export function isValidSubtype(category, subtype) {
  return subtype === '' || Object.hasOwn(ASSET_CATEGORIES[category].subtypes, subtype);
}

/** Nombre para mostrar del tipo de un activo. @param {Asset} asset */
export function assetTypeLabel(asset) {
  const cat = ASSET_CATEGORIES[asset.category];
  return asset.subtype && cat.subtypes[asset.subtype] ? cat.subtypes[asset.subtype] : cat.label;
}

/**
 * Valor vigente de un activo en una fecha: 0 antes de adquirirlo; después, el último valor registrado hasta ella.
 * @param {Asset} asset @param {string} date
 */
export function assetValueAt(asset, date) {
  if (date < asset.acquiredDate) return 0;
  let value = 0;
  for (const v of asset.valuations) {
    if (v.date > date) break;
    value = v.valueCents;
  }
  return value;
}

/** Valor más reciente registrado hasta hoy. @param {Asset} asset @param {string} today */
export function assetCurrentValue(asset, today) {
  return assetValueAt(asset, today);
}

/**
 * Ordena y deja un solo valor por fecha (el último que se haya puesto para esa fecha).
 * @param {AssetValuation[]} valuations
 * @returns {AssetValuation[]}
 */
export function normalizeValuations(valuations) {
  /** @type {Map<string, number>} */
  const byDate = new Map();
  for (const v of valuations) byDate.set(v.date, v.valueCents);
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, valueCents]) => ({ date, valueCents }));
}

/**
 * @typedef {Object} AssetInput
 * @property {string} name
 * @property {string} category
 * @property {string} subtype
 * @property {string} description
 * @property {string} valueText       Valor estimado (solo al crear; para cambiarlo después se actualiza el valor).
 * @property {string} acquiredDate
 */

/**
 * @param {AssetInput} input
 * @param {{ today: string, existing?: Asset | null }} context
 * @returns {{ ok: true, value: { name: string, category: AssetCategory, subtype: string, description: string, acquiredDate: string, valueCents: number } } | { ok: false, errors: Record<string, string> }}
 */
export function validateAsset(input, { today, existing = null }) {
  /** @type {Record<string, string>} */
  const errors = {};

  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Ponle un nombre a tu activo.';
  else if (name.length > LIMITS.assetName) errors.name = `Máximo ${LIMITS.assetName} caracteres.`;

  const category = isAssetCategory(input.category) ? input.category : null;
  if (!category) errors.category = 'Elige una categoría.';

  const subtype = String(input.subtype ?? '');
  if (category && !isValidSubtype(category, subtype)) errors.subtype = 'Elige un tipo de la lista.';

  const description = String(input.description ?? '').trim().replace(/\s+/g, ' ');
  if (description.length > LIMITS.assetDescription) errors.description = `Máximo ${LIMITS.assetDescription} caracteres.`;

  if (!isValidISODate(input.acquiredDate)) errors.acquiredDate = 'Elige una fecha válida.';
  else if (input.acquiredDate > today) errors.acquiredDate = 'La fecha de adquisición no puede ser futura.';
  else if (input.acquiredDate < MIN_ASSET_DATE) errors.acquiredDate = 'Esa fecha es demasiado antigua.';
  else if (existing && !errors.acquiredDate) {
    // Los demás valores ya registrados no pueden quedar antes de la adquisición.
    const earliestOther = existing.valuations.find((v) => v.date !== existing.acquiredDate);
    if (earliestOther && input.acquiredDate > earliestOther.date) {
      errors.acquiredDate = 'Hay valores registrados antes de esa fecha. Bórralos o elige una fecha anterior.';
    }
  }

  let valueCents = 0;
  if (!existing) {
    const money = parseMoney(input.valueText);
    if (!money.ok) errors.value = money.error;
    else if (money.cents <= 0) errors.value = 'El valor debe ser mayor que cero.';
    else if (money.cents > MAX_CENTS) errors.value = 'El monto es demasiado grande.';
    else valueCents = money.cents;
  }

  if (Object.keys(errors).length > 0 || !category) return { ok: false, errors };
  return { ok: true, value: { name, category, subtype, description, acquiredDate: input.acquiredDate, valueCents } };
}

/**
 * @typedef {Object} ValuationInput
 * @property {string} valueText
 * @property {string} date
 */

/**
 * Actualizar el valor de un activo en una fecha (si ya había un valor ese día, se reemplaza).
 * @param {ValuationInput} input
 * @param {{ today: string, asset: Asset }} context
 * @returns {{ ok: true, value: AssetValuation } | { ok: false, errors: Record<string, string> }}
 */
export function validateValuation(input, { today, asset }) {
  /** @type {Record<string, string>} */
  const errors = {};

  let valueCents = 0;
  const money = parseMoney(input.valueText);
  if (!money.ok) errors.value = money.error;
  else if (money.cents > MAX_CENTS) errors.value = 'El monto es demasiado grande.';
  else valueCents = money.cents;

  if (!isValidISODate(input.date)) errors.date = 'Elige una fecha válida.';
  else if (input.date > today) errors.date = 'La fecha no puede ser futura.';
  else if (input.date < asset.acquiredDate) errors.date = 'No puede ser antes de la fecha de adquisición.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { date: input.date, valueCents } };
}
