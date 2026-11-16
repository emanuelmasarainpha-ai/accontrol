// @ts-check
// =============================================================================
// ROLES EN UN ESPACIO COMPARTIDO (0.16.0)
// -----------------------------------------------------------------------------
// Qué puede hacer cada persona en un espacio, según su rol. Es la MISMA regla que aplica la nube (RLS):
//   · Dueño:          todo (datos, nombre, datos de la organización, saldo inicial, borrar el espacio).
//   · Administrador:  registra y edita los datos; NO cambia el espacio en sí ni lo borra.
//   · Contador:       solo mira (y descarga reportes). No guarda nada.
// La app lo aplica también aquí para que la pantalla no ofrezca lo que la nube luego rechazaría o desharía.
// =============================================================================

/** @typedef {import('./types.js').Workspace} Workspace */
/** @typedef {import('./types.js').WorkspaceRole} WorkspaceRole */
/** @typedef {import('./permissions.js').Permissions} Permissions */
/** @typedef {import('./permissions.js').ModuleId} ModuleId */

import { allAt, atLeast, MODULE_IDS, MODULE_OF_KIND, MODULES, normalizePermissions } from './permissions.js';

/** @type {Record<WorkspaceRole, string>} */
export const ROLE_NAMES = { owner: 'Dueño', admin: 'Administrador', accountant: 'Contador', custom: 'Rol a medida' };

/** Tu rol en un espacio. Sin rol guardado = es tuyo. @param {Workspace | null | undefined} w @returns {WorkspaceRole} */
export const roleOf = (w) => w?.role ?? 'owner';

/**
 * Tus permisos en cada módulo de un espacio (0.16.1). Dueño y Administrador: «Editar y borrar» en todo; Contador: «Ver» en
 * todo; rol a medida: los suyos (normalizados, por si llegaran incompletos). Un rol a medida sin datos = sin acceso.
 * @param {Workspace | null | undefined} w @returns {Permissions}
 */
export function permissionsOf(w) {
  const role = roleOf(w);
  if (role === 'owner' || role === 'admin') return allAt('edit');
  if (role === 'accountant') return allAt('view');
  return normalizePermissions(w?.customRole?.permissions).permissions;
}

/** El nombre de tu rol para mostrar: «Dueño», «Contador»… o el del rol a medida («Cajero»). @param {Workspace | null | undefined} w */
export const roleLabel = (w) => (roleOf(w) === 'custom' ? w?.customRole?.name || ROLE_NAMES.custom : ROLE_NAMES[roleOf(w)]);

/** ¿Puedes registrar algo en este espacio? (en al menos un módulo). El Contador, no. @param {Workspace | null | undefined} w */
export const canEditData = (w) => { const p = permissionsOf(w); return MODULE_IDS.some((id) => atLeast(p[id], 'create')); };

/** ¿Puedes cambiar el espacio en sí (nombre, organización, saldo inicial) o borrarlo? Solo el dueño. @param {Workspace | null | undefined} w */
export const canManageWorkspace = (w) => roleOf(w) === 'owner';

export const READ_ONLY_MESSAGE =
  'Estás en este espacio como Contador: puedes ver y descargar reportes, pero no registrar ni cambiar nada. Si necesitas cambiar algo, pídeselo al dueño.';

export const OWNER_ONLY_MESSAGE = 'Este espacio es de otra persona: solo su dueño puede cambiar su nombre, sus datos o su saldo inicial.';

export const NOT_YOURS_TO_DELETE =
  'Este espacio es de otra persona: no puedes borrarlo. Si ya no quieres verlo, usa «Salir del espacio».';

/**
 * Botones (data-action) que registran o cambian datos. En un espacio de solo lectura no se muestran y, si alguno
 * llegara a pulsarse, no hacen nada más que explicar por qué.
 */
export const WRITE_ACTIONS = Object.freeze([
  'add-menu', 'add-income', 'add-expense', 'add-saving', 'edit-movement', 'edit-contribution',
  'new-goal', 'goal-deposit', 'goal-withdraw', 'goal-edit',
  'new-asset', 'asset-edit', 'asset-value',
  'new-debt', 'debt-pay', 'debt-edit', 'debt-payment-edit',
  'new-client', 'client-edit', 'client-archive', 'client-delete', 'client-pay', 'client-expense',
  'new-service', 'service-edit', 'service-delete',
  'new-product', 'product-edit', 'product-archive', 'product-delete',
  'new-supplier', 'supplier-edit', 'stock-buy', 'stock-sell', 'stock-adjust', 'stock-delete',
  'new-department', 'department-edit',
  'new-invoice', 'invoice-edit', 'invoice-pay', 'invoice-void', 'invoice-payment-delete',
  'credit-new', 'credit-pay',
  'pos-open', 'pos-charge',
  'cat-new', 'cat-edit', 'cat-delete', 'add-business-categories',
  'load-demo', 'remove-demo',
]);

/** Botones que cambian el espacio en sí: solo para el dueño. */
export const OWNER_ACTIONS = Object.freeze(['org-edit']);

/**
 * A qué módulo pertenece cada botón de escritura (0.16.1). Para verlo hay que poder «Registrar» en ese módulo; «all» =
 * escribe en todos (la demostración). Los que CAMBIAN un registro que ya existe están además en EDIT_ACTION_KIND.
 * @type {Readonly<Record<string, ModuleId | 'all'>>}
 */
export const ACTION_MODULE = Object.freeze({
  'add-menu': 'movements', 'add-income': 'movements', 'add-expense': 'movements', 'edit-movement': 'movements',
  'cat-new': 'movements', 'cat-edit': 'movements', 'cat-delete': 'movements', 'add-business-categories': 'movements',
  'add-saving': 'goals', 'edit-contribution': 'goals', 'new-goal': 'goals', 'goal-deposit': 'goals', 'goal-withdraw': 'goals', 'goal-edit': 'goals',
  'new-asset': 'assets', 'asset-edit': 'assets', 'asset-value': 'assets',
  'new-debt': 'debts', 'debt-pay': 'debts', 'debt-edit': 'debts', 'debt-payment-edit': 'debts',
  'new-client': 'clients', 'client-edit': 'clients', 'client-archive': 'clients', 'client-delete': 'clients',
  'new-service': 'clients', 'service-edit': 'clients', 'service-delete': 'clients',
  'client-pay': 'movements', 'client-expense': 'movements',
  'new-product': 'inventory', 'product-edit': 'inventory', 'product-archive': 'inventory', 'product-delete': 'inventory',
  'new-supplier': 'inventory', 'supplier-edit': 'inventory', 'stock-buy': 'inventory', 'stock-sell': 'inventory',
  'stock-adjust': 'inventory', 'stock-delete': 'inventory',
  'new-department': 'departments', 'department-edit': 'departments',
  'new-invoice': 'invoices', 'invoice-edit': 'invoices', 'invoice-pay': 'invoices', 'invoice-void': 'invoices', 'invoice-payment-delete': 'invoices',
  'credit-new': 'invoices', 'credit-pay': 'invoices',
  'pos-open': 'invoices', 'pos-charge': 'invoices',
  'load-demo': 'all', 'remove-demo': 'all',
});

/**
 * Botones que cambian un registro que YA existe, y de qué tipo es (data-id = su id). Con solo «Registrar» solo valen
 * para lo que creaste tú.
 * @type {Readonly<Record<string, string>>}
 */
export const EDIT_ACTION_KIND = Object.freeze({
  'edit-movement': 'movements', 'cat-edit': 'categories', 'cat-delete': 'categories',
  'edit-contribution': 'contributions', 'goal-edit': 'goals',
  'asset-edit': 'assets', 'asset-value': 'assets',
  'debt-edit': 'debts', 'debt-payment-edit': 'debtPayments',
  'client-edit': 'clients', 'client-archive': 'clients', 'client-delete': 'clients', 'service-edit': 'services', 'service-delete': 'services',
  'product-edit': 'products', 'product-archive': 'products', 'product-delete': 'products', 'supplier-edit': 'suppliers', 'stock-delete': 'stockEntries',
  'department-edit': 'departments',
  'invoice-edit': 'invoices', 'invoice-void': 'invoices', 'invoice-payment-delete': 'invoicePayments',
});

/** Pantallas propias de un módulo: sin acceso a él, no se muestran en el menú ni en las pestañas. @type {Readonly<Record<string, ModuleId>>} */
export const ROUTE_MODULE = Object.freeze({
  metas: 'goals', deudas: 'debts', patrimonio: 'assets', clientes: 'clients', inventario: 'inventory', facturas: 'invoices', fiado: 'invoices', caja: 'invoices', departamentos: 'departments',
});

/**
 * Lo que NO puedes hacer en un espacio, como palabras para el atributo `<html data-locked>`: «assets:view» (no ves
 * Patrimonio), «assets:create» (no registras en Patrimonio), «all:create» (no registras en todos: sin demostración).
 * @param {Workspace | null | undefined} w @returns {string[]}
 */
export function lockedTokens(w) {
  const p = permissionsOf(w);
  /** @type {string[]} */
  const out = [];
  for (const id of MODULE_IDS) {
    if (!atLeast(p[id], 'view')) out.push(`${id}:view`);
    if (!atLeast(p[id], 'create')) out.push(`${id}:create`);
  }
  if (!MODULE_IDS.every((id) => atLeast(p[id], 'create'))) out.push('all:create');
  return out;
}

/** ¿Es tuyo este registro? (sin «createdBy» = creado en este dispositivo). @param {any} record @param {string | null} me */
export const isMine = (record, me) => !record || !('createdBy' in record) || (me !== null && record.createdBy === me);

/**
 * ¿Te deja tu rol crear (sin `existing`) o cambiar/borrar (`existing`) un registro de este tipo?
 * @param {Workspace | null | undefined} w @param {string} kind @param {any} existing @param {string | null} me
 */
export function allowsWrite(w, kind, existing, me) {
  const level = permissionsOf(w)[MODULE_OF_KIND[kind]] ?? 'none';
  if (level === 'edit') return true;
  if (level !== 'create') return false;
  return !existing || isMine(existing, me);
}

/** Mensaje de solo lectura con el nombre del rol. @param {Workspace | null | undefined} w */
export const readOnlyMessage = (w) => (roleOf(w) === 'accountant'
  ? READ_ONLY_MESSAGE
  : `Estás en este espacio como ${roleLabel(w)}: puedes ver, pero tu rol no te deja registrar ni cambiar nada. Si lo necesitas, pídeselo al dueño.`);

/** Tu rol no te deja registrar en un módulo. @param {Workspace | null | undefined} w @param {ModuleId | 'all'} module */
export function noPermissionMessage(w, module) {
  const what = module === 'all' ? 'cargar o borrar los datos de demostración' : `registrar en «${MODULES.find((m) => m.id === module)?.label ?? module}»`;
  return `Tu rol («${roleLabel(w)}») no te deja ${what}. Si lo necesitas, pídeselo al dueño del espacio.`;
}

export const NOT_YOURS_MESSAGE =
  'Con tu rol solo puedes corregir o borrar lo que registraste tú. Si hay que cambiar esto, pídeselo al dueño o a un administrador.';

/**
 * Reglas de estilo que esconden los botones de escritura cuando la página está marcada como de solo lectura
 * (`<html data-read-only>`), los del dueño cuando no lo eres (`<html data-not-owner>`) y, con un rol a medida, los de
 * cada módulo según tus permisos (`<html data-locked="assets:create …">`) y las pantallas de los módulos que no ves.
 */
export function roleCss() {
  const hide = (/** @type {string} */ flag, /** @type {readonly string[]} */ names) =>
    names.map((n) => `[${flag}] [data-action="${n}"]`).join(',\n');
  const byModule = Object.entries(ACTION_MODULE).map(([action, module]) => `[data-locked~="${module}:create"] [data-action="${action}"]`).join(',\n');
  const routes = Object.entries(ROUTE_MODULE).map(([route, module]) => `[data-locked~="${module}:view"] a[href="#/${route}"]`).join(',\n');
  return `${hide('data-read-only', WRITE_ACTIONS)},\n[data-read-only] [data-write-only] { display: none !important; }\n` +
    `${hide('data-not-owner', OWNER_ACTIONS)},\n[data-not-owner] [data-owner-only] { display: none !important; }\n` +
    `${byModule} { display: none !important; }\n` +
    `${routes} { display: none !important; }\n`;
}
