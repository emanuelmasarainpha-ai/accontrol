// @ts-check
// =============================================================================
// AISLAMIENTO POR ESPACIO (funciones puras)
// -----------------------------------------------------------------------------
// En la base de datos, todos los registros de un espacio llevan un campo
// `workspaceId`. Estas funciones lo ponen al guardar, lo quitan al leer (los
// cálculos no lo necesitan) y deciden a quién pertenece cada registro.
//
// Las categorías de fábrica (`builtIn`) son iguales en todos los espacios y no
// llevan `workspaceId`; las que crea el usuario pertenecen al espacio donde se crearon.
// =============================================================================

/** Tablas cuyos registros pertenecen siempre a un espacio. */
export const DATA_STORES = /** @type {const} */ (['movements', 'goals', 'contributions', 'debts', 'debtPayments', 'assets', 'clients', 'services', 'products', 'suppliers', 'stockEntries', 'invoices', 'invoicePayments', 'departments']);

/** Todas las tablas con registros de un espacio (las anteriores más las categorías propias). */
export const SCOPED_STORES = /** @type {const} */ (['categories', ...DATA_STORES]);

/** Qué campo de `Deletions` corresponde a cada tabla. */
export const DELETION_FIELDS = /** @type {const} */ ([
  ['categories', 'categoryIds'],
  ['movements', 'movementIds'],
  ['goals', 'goalIds'],
  ['contributions', 'contributionIds'],
  ['debts', 'debtIds'],
  ['debtPayments', 'debtPaymentIds'],
  ['assets', 'assetIds'],
  ['clients', 'clientIds'],
  ['services', 'serviceIds'],
  ['products', 'productIds'],
  ['suppliers', 'supplierIds'],
  ['stockEntries', 'stockEntryIds'],
  ['invoices', 'invoiceIds'],
  ['invoicePayments', 'invoicePaymentIds'],
  ['departments', 'departmentIds'],
]);

/** Mensajes de los dos fallos propios del aislamiento (los usan todos los almacenes y las pruebas). */
export const WORKSPACE_ERRORS = {
  gone: 'Este espacio de trabajo ya no existe (quizá se borró en otra pestaña).',
  collision: 'Esos registros ya existen en otro espacio de trabajo y no se pueden mezclar.',
  duplicate: 'Ya existe un espacio con ese identificador.',
};

/**
 * @template {Record<string, any>} T
 * @param {T} record @param {string} workspaceId
 * @returns {T & { workspaceId: string }}
 */
export function stamp(record, workspaceId) {
  return { ...record, workspaceId };
}

/**
 * @template {Record<string, any>} T
 * @param {T} record
 * @returns {Omit<T, 'workspaceId'>}
 */
export function strip(record) {
  const { workspaceId: _ignored, ...rest } = record;
  return rest;
}

/** ¿Es una categoría de fábrica (compartida por todos los espacios)? @param {{ builtIn?: boolean }} category */
export function isGlobalCategory(category) {
  return category.builtIn === true;
}

/** @param {{ workspaceId?: string }} record @param {string} workspaceId */
export function ownedBy(record, workspaceId) {
  return record.workspaceId === workspaceId;
}

/**
 * Categorías que ve un espacio: las de fábrica y las que creó en él.
 * @template {{ builtIn?: boolean, workspaceId?: string }} C
 * @param {C[]} all @param {string} workspaceId
 * @returns {Omit<C, 'workspaceId'>[]}
 */
export function visibleCategories(all, workspaceId) {
  return all.filter((c) => isGlobalCategory(c) || ownedBy(c, workspaceId)).map(strip);
}
