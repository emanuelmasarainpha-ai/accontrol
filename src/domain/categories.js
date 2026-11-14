// @ts-check
// =============================================================================
// CATEGORÍAS
// -----------------------------------------------------------------------------
// Las categorías de fábrica salen de los ejemplos del documento maestro
// (§4.1 y §4.2). Tienen IDs fijos ("cat-inc-salario") para que sean iguales en
// todos tus dispositivos cuando exista la sincronización. Las que crea el
// usuario reciben un UUID.
//
// `defaultClassification` solo SUGIERE la clasificación al elegir la categoría;
// en cada movimiento el usuario puede cambiarla.
// =============================================================================

import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').MovementType} MovementType */
/** @typedef {import('./types.js').Classification} Classification */

/**
 * @param {string} id @param {string} name @param {MovementType} kind @param {Classification} cls
 * @returns {Category}
 */
const cat = (id, name, kind, cls) => ({ id, name, kind, defaultClassification: cls, builtIn: true });

/** @type {Category[]} */
export const DEFAULT_CATEGORIES = [
  // Ingresos
  cat('cat-inc-salario', 'Salario', 'income', 'fixed'),
  cat('cat-inc-pension', 'Pensión', 'income', 'fixed'),
  cat('cat-inc-alquiler', 'Alquiler recibido', 'income', 'fixed'),
  cat('cat-inc-comisiones', 'Comisiones', 'income', 'variable'),
  cat('cat-inc-ventas', 'Ventas', 'income', 'variable'),
  cat('cat-inc-propinas', 'Propinas', 'income', 'variable'),
  cat('cat-inc-bonificaciones', 'Bonificaciones', 'income', 'extraordinary'),
  cat('cat-inc-regalos', 'Premios y regalos', 'income', 'extraordinary'),
  cat('cat-inc-otros', 'Otros ingresos', 'income', 'variable'),
  // Gastos
  cat('cat-exp-alquiler', 'Alquiler', 'expense', 'fixed'),
  cat('cat-exp-electricidad', 'Electricidad', 'expense', 'fixed'),
  cat('cat-exp-agua', 'Agua', 'expense', 'fixed'),
  cat('cat-exp-internet', 'Internet', 'expense', 'fixed'),
  cat('cat-exp-transporte', 'Transporte', 'expense', 'fixed'),
  cat('cat-exp-alimentacion', 'Alimentación', 'expense', 'variable'),
  cat('cat-exp-combustible', 'Combustible', 'expense', 'variable'),
  cat('cat-exp-salud', 'Salud y medicamentos', 'expense', 'variable'),
  cat('cat-exp-ropa', 'Ropa', 'expense', 'discretionary'),
  cat('cat-exp-restaurantes', 'Restaurantes', 'expense', 'discretionary'),
  cat('cat-exp-entretenimiento', 'Entretenimiento', 'expense', 'discretionary'),
  cat('cat-exp-deudas', 'Pago de deudas', 'expense', 'fixed'),
  cat('cat-exp-otros', 'Otros gastos', 'expense', 'variable'),
];

/** Categoría que usan los pagos de deudas (se crea cuando se necesita si todavía no existe). */
export const DEBT_CATEGORY_ID = 'cat-exp-deudas';

/**
 * Categoría para el gasto vinculado a un pago de deuda. Si no existe la de fábrica pero el usuario
 * ya tiene una categoría de gastos con ese mismo nombre, se usa esa (no se duplican nombres).
 * @param {Category[]} categories
 * @returns {{ category: Category, created: boolean }}
 */
export function ensureDebtCategory(categories) {
  const norm = (/** @type {string} */ name) => name.trim().toLocaleLowerCase('es');
  const builtIn = /** @type {Category} */ (defaultCategories().find((c) => c.id === DEBT_CATEGORY_ID));
  const existing =
    categories.find((c) => c.id === DEBT_CATEGORY_ID) ??
    categories.find((c) => c.kind === 'expense' && norm(c.name) === norm(builtIn.name));
  return existing ? { category: existing, created: false } : { category: builtIn, created: true };
}

/**
 * Copia nueva de las categorías de fábrica (para que nadie modifique la lista original).
 * @returns {Category[]}
 */
export function defaultCategories() {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

/**
 * @param {Category[]} categories @param {MovementType} kind
 */
export function categoriesOfKind(categories, kind) {
  return categories
    .filter((c) => c.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Valida el nombre de una categoría nueva o renombrada.
 * @param {string} rawName
 * @param {MovementType} kind
 * @param {Category[]} categories
 * @param {string | null} [editingId] Si se está renombrando, el id de esa categoría.
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateCategoryName(rawName, kind, categories, editingId = null) {
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Escribe un nombre para la categoría.' };
  if (name.length > LIMITS.categoryName) {
    return { ok: false, error: `Máximo ${LIMITS.categoryName} caracteres.` };
  }
  const clash = categories.some(
    (c) => c.kind === kind && c.id !== editingId && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) return { ok: false, error: 'Ya existe una categoría con ese nombre.' };
  return { ok: true, name };
}
