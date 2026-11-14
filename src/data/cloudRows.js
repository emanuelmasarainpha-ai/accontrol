// @ts-check
// =============================================================================
// TRADUCTOR APP ⇄ NUBE (0.15.0, paso 2)
// -----------------------------------------------------------------------------
// Convierte los registros de la app (camelCase, como en domain/types.js) en filas de las tablas de Supabase
// (snake_case, como en supabase/migrations/) y al revés. Es puro: no se conecta a nada.
//
// Reglas:
//  · Cada tipo declara EXACTAMENTE sus campos: lo que no esté en la lista no viaja en ninguna dirección.
//  · Montos y cantidades siguen siendo enteros (centavos); si llegaran como texto se convierten y se comprueban.
//  · Campo opcional ausente en la app ([clientId], [voidedAt]…) ⇄ null en la nube.
//  · Fecha vacía "" en la app (inicio de un servicio, vencimiento de una factura) ⇄ null en la nube.
//  · Fechas-hora: se devuelven en el mismo formato ISO que usa la app (2026-11-13T07:44:00.000Z).
//  · isDemo: en la nube siempre true/false; en la app solo aparece cuando es true.
//  · Las categorías de fábrica NO se suben (ya están en la tabla builtin_categories).
// =============================================================================

/** @typedef {import('../domain/types.js').AppData} AppData */

/**
 * @typedef {Object} CloudKind
 * @property {string} key        Nombre de la lista en AppData y en Changes (movements, invoices…).
 * @property {string} idsKey     Nombre de la lista de ids en Deletions (movementIds…).
 * @property {string} table      Tabla de Supabase.
 * @property {string[]} fields   Campos de la app que viajan (sin isDemo, que se trata aparte).
 * @property {string[]} [optional]   Campos que en la app pueden faltar (⇄ null).
 * @property {string[]} [emptyDate]  Fechas que en la app son "" cuando no hay (⇄ null).
 * @property {string[]} [timestamps] Fechas-hora ISO.
 * @property {string[]} [integers]   Números enteros (montos en centavos, cantidades, tasas).
 * @property {boolean} [noDemo]      El tipo no lleva marca de demostración en la app.
 */

const STAMPS = ['createdAt', 'updatedAt'];

/** @type {CloudKind[]} */
export const CLOUD_KINDS = [
  { key: 'categories', idsKey: 'categoryIds', table: 'categories', fields: ['id', 'name', 'kind', 'defaultClassification'], noDemo: true },
  { key: 'departments', idsKey: 'departmentIds', table: 'departments', fields: ['id', 'name', 'monthlyBudgetCents', 'archived', ...STAMPS], timestamps: STAMPS, integers: ['monthlyBudgetCents'] },
  {
    key: 'clients', idsKey: 'clientIds', table: 'clients',
    fields: ['id', 'firstName', 'lastName', 'company', 'email', 'phone', 'country', 'notes', 'archived', ...STAMPS], timestamps: STAMPS,
  },
  {
    key: 'services', idsKey: 'serviceIds', table: 'services',
    fields: ['id', 'clientId', 'name', 'priceCents', 'estimatedDays', 'status', 'startDate', ...STAMPS],
    emptyDate: ['startDate'], timestamps: STAMPS, integers: ['priceCents', 'estimatedDays'],
  },
  {
    key: 'movements', idsKey: 'movementIds', table: 'movements',
    fields: ['id', 'type', 'amountCents', 'date', 'time', 'description', 'classification', 'categoryId', 'clientId', 'serviceId', 'departmentId', ...STAMPS],
    optional: ['clientId', 'serviceId', 'departmentId'], timestamps: STAMPS, integers: ['amountCents'],
  },
  { key: 'goals', idsKey: 'goalIds', table: 'goals', fields: ['id', 'name', 'description', 'targetCents', 'targetDate', ...STAMPS], timestamps: STAMPS, integers: ['targetCents'] },
  {
    key: 'contributions', idsKey: 'contributionIds', table: 'contributions',
    fields: ['id', 'goalId', 'kind', 'amountCents', 'date', 'time', 'note', ...STAMPS], timestamps: STAMPS, integers: ['amountCents'],
  },
  {
    key: 'debts', idsKey: 'debtIds', table: 'debts',
    fields: ['id', 'name', 'note', 'totalCents', 'rateBp', 'rateBasis', 'frequency', 'collateralKind', 'collateralType', 'firstDueDate', 'firstDueTime', 'finalDueDate', 'finalDueTime', ...STAMPS],
    timestamps: STAMPS, integers: ['totalCents', 'rateBp'],
  },
  {
    key: 'debtPayments', idsKey: 'debtPaymentIds', table: 'debt_payments',
    fields: ['id', 'debtId', 'kind', 'amountCents', 'date', 'time', 'note', 'movementId', ...STAMPS], timestamps: STAMPS, integers: ['amountCents'],
  },
  {
    key: 'assets', idsKey: 'assetIds', table: 'assets',
    fields: ['id', 'name', 'category', 'subtype', 'description', 'acquiredDate', 'valuations', ...STAMPS], timestamps: STAMPS,
  },
  {
    key: 'products', idsKey: 'productIds', table: 'products',
    fields: ['id', 'name', 'sku', 'unit', 'priceCents', 'minStock', 'notes', 'archived', ...STAMPS], timestamps: STAMPS, integers: ['priceCents', 'minStock'],
  },
  { key: 'suppliers', idsKey: 'supplierIds', table: 'suppliers', fields: ['id', 'name', 'contact', 'email', 'phone', 'notes', 'archived', ...STAMPS], timestamps: STAMPS },
  {
    key: 'stockEntries', idsKey: 'stockEntryIds', table: 'stock_entries',
    fields: ['id', 'productId', 'kind', 'quantity', 'unitCents', 'date', 'time', 'supplierId', 'movementId', 'invoiceId', 'note', ...STAMPS],
    optional: ['supplierId', 'movementId', 'invoiceId'], timestamps: STAMPS, integers: ['quantity', 'unitCents'],
  },
  {
    key: 'invoices', idsKey: 'invoiceIds', table: 'invoices',
    fields: ['id', 'number', 'clientId', 'customerName', 'customerTaxId', 'customerContact', 'issueDate', 'dueDate', 'lines', 'taxRateBp', 'notes', 'voidedAt', ...STAMPS],
    optional: ['clientId', 'voidedAt'], emptyDate: ['dueDate'], timestamps: ['voidedAt', ...STAMPS], integers: ['number', 'taxRateBp'],
  },
  {
    key: 'invoicePayments', idsKey: 'invoicePaymentIds', table: 'invoice_payments',
    fields: ['id', 'invoiceId', 'amountCents', 'date', 'time', 'note', 'movementId', ...STAMPS], timestamps: STAMPS, integers: ['amountCents'],
  },
];

/** @param {string} key */
export function cloudKind(key) {
  const kind = CLOUD_KINDS.find((k) => k.key === key);
  if (!kind) throw new Error(`Tipo de registro desconocido: ${key}`);
  return kind;
}

/** movementId → movement_id @param {string} name */
export const toSnake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** @param {unknown} value @param {string} field */
function toInteger(value, field) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new Error(`«${field}» no es un número entero válido.`);
  return n;
}

/** @param {unknown} value @param {string} field */
function toIso(value, field) {
  const d = typeof value === 'string' ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw new Error(`«${field}» no es una fecha-hora válida.`);
  return d.toISOString();
}

/**
 * Registro de la app → fila de la nube.
 * @param {string} key Tipo (movements, invoices…).
 * @param {Record<string, any>} record
 * @param {string} workspaceId
 * @returns {Record<string, unknown>}
 */
export function toRow(key, record, workspaceId) {
  const kind = cloudKind(key);
  if (key === 'categories' && record.builtIn) throw new Error('Las categorías de fábrica no se suben a la nube.');
  /** @type {Record<string, unknown>} */
  const row = { workspace_id: workspaceId };
  for (const field of kind.fields) {
    let value = record[field];
    if (value === undefined || value === null) {
      if (kind.optional?.includes(field) || (field === 'estimatedDays' && value === null)) value = null;
      else throw new Error(`Falta «${field}» en un registro de ${key}.`);
    } else if (kind.emptyDate?.includes(field) && value === '') value = null;
    else if (kind.integers?.includes(field)) value = toInteger(value, field);
    else if (kind.timestamps?.includes(field)) value = toIso(value, field);
    row[toSnake(field)] = value;
  }
  if (!kind.noDemo) row.is_demo = record.isDemo === true;
  return row;
}

// ------------------------------------------------------------------ espacios de trabajo

/** Campos de la organización (domain/types.js: Organization). Todos texto. */
const ORGANIZATION_FIELDS = ['legalName', 'taxId', 'activity', 'email', 'phone', 'address'];

/**
 * Espacio de la app → fila de `workspaces`. `isDefault` NO va aquí: es de la persona (workspace_members) y se cambia
 * con la función set_default_workspace. `created_by` lo pone el servidor (es quien tiene la sesión).
 * @param {import('../domain/types.js').Workspace} workspace
 */
export function workspaceToRow(workspace) {
  return {
    id: workspace.id,
    kind: workspace.kind,
    name: workspace.name,
    currency: workspace.currency,
    opening_balance_cents: toInteger(workspace.openingBalanceCents, 'openingBalanceCents'),
    organization: workspace.organization
      ? Object.fromEntries(ORGANIZATION_FIELDS.map((f) => [f, String(workspace.organization?.[/** @type {keyof import('../domain/types.js').Organization} */ (f)] ?? '')]))
      : null,
    created_at: toIso(workspace.createdAt, 'createdAt'),
    updated_at: toIso(workspace.updatedAt, 'updatedAt'),
  };
}

/**
 * Fila de `workspaces` (+ si es el predeterminado de esta persona) → espacio de la app.
 * @param {Record<string, any>} row
 * @param {boolean} isDefault
 * @returns {{ workspace: import('../domain/types.js').Workspace, deletedAt: string | null }}
 */
export function workspaceFromRow(row, isDefault, role = 'owner') {
  for (const col of ['id', 'kind', 'name', 'currency', 'created_at', 'updated_at']) {
    if (typeof row[col] !== 'string' || row[col] === '') throw new Error(`La nube devolvió un espacio sin «${col}».`);
  }
  /** @type {import('../domain/types.js').Workspace} */
  const workspace = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    currency: row.currency,
    openingBalanceCents: toInteger(row.opening_balance_cents ?? 0, 'opening_balance_cents'),
    isDefault,
    createdAt: toIso(row.created_at, 'created_at'),
    updatedAt: toIso(row.updated_at, 'updated_at'),
  };
  if (row.organization && typeof row.organization === 'object') {
    workspace.organization = /** @type {import('../domain/types.js').Organization} */ (
      Object.fromEntries(ORGANIZATION_FIELDS.map((f) => [f, typeof row.organization[f] === 'string' ? row.organization[f] : '']))
    );
  }
  // El rol solo se guarda si NO eres el dueño (ausente = dueño, como en todos los espacios de antes de la 0.16.0).
  if (role === 'admin' || role === 'accountant') workspace.role = role;
  return { workspace, deletedAt: row.deleted_at ? toIso(row.deleted_at, 'deleted_at') : null };
}

/**
 * Fila de la nube → registro de la app, más lo que la sincronización necesita saber de ella.
 * @param {string} key
 * @param {Record<string, any>} row
 * @returns {{ record: Record<string, any>, deletedAt: string | null, syncedAt: string | null }}
 */
export function fromRow(key, row) {
  const kind = cloudKind(key);
  /** @type {Record<string, any>} */
  const record = {};
  for (const field of kind.fields) {
    const value = row[toSnake(field)];
    if (value === undefined || value === null) {
      if (kind.optional?.includes(field)) continue;
      if (kind.emptyDate?.includes(field)) { record[field] = ''; continue; }
      if (field === 'estimatedDays') { record[field] = null; continue; }
      throw new Error(`La nube devolvió un registro de ${key} sin «${field}».`);
    }
    if (kind.integers?.includes(field)) record[field] = toInteger(value, field);
    else if (kind.timestamps?.includes(field)) record[field] = toIso(value, field);
    else record[field] = value;
  }
  if (key === 'categories') record.builtIn = false;
  if (!kind.noDemo && row.is_demo === true) record.isDemo = true;
  return {
    record,
    deletedAt: row.deleted_at ? toIso(row.deleted_at, 'deleted_at') : null,
    syncedAt: row.synced_at ? toIso(row.synced_at, 'synced_at') : null,
  };
}
