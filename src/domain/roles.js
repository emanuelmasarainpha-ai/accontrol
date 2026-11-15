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

/** @type {Record<WorkspaceRole, string>} */
export const ROLE_NAMES = { owner: 'Dueño', admin: 'Administrador', accountant: 'Contador' };

/** Tu rol en un espacio. Sin rol guardado = es tuyo. @param {Workspace | null | undefined} w @returns {WorkspaceRole} */
export const roleOf = (w) => w?.role ?? 'owner';

/** ¿Puedes registrar, editar o borrar datos en este espacio? @param {Workspace | null | undefined} w */
export const canEditData = (w) => roleOf(w) !== 'accountant';

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
  'cat-new', 'cat-edit', 'cat-delete', 'add-business-categories',
  'load-demo', 'remove-demo',
]);

/** Botones que cambian el espacio en sí: solo para el dueño. */
export const OWNER_ACTIONS = Object.freeze(['org-edit']);

/**
 * Reglas de estilo que esconden los botones de escritura cuando la página está marcada como de solo lectura
 * (`<html data-read-only>`), y los del dueño cuando no lo eres (`<html data-not-owner>`).
 */
export function roleCss() {
  const hide = (/** @type {string} */ flag, /** @type {readonly string[]} */ names) =>
    names.map((n) => `[${flag}] [data-action="${n}"]`).join(',\n');
  return `${hide('data-read-only', WRITE_ACTIONS)},\n[data-read-only] [data-write-only] { display: none !important; }\n` +
    `${hide('data-not-owner', OWNER_ACTIONS)},\n[data-not-owner] [data-owner-only] { display: none !important; }\n`;
}
