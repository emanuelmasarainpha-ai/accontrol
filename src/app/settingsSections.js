// @ts-check
// =============================================================================
// AJUSTES POR SECCIONES (0.18.1)
// -----------------------------------------------------------------------------
// Ajustes era una sola página larga. Ahora abre con la lista de secciones (como los ajustes del teléfono) y cada una tiene
// su propia dirección: #/ajustes/general, #/ajustes/almacenamiento… Así el botón «atrás» vuelve a la lista.
// Aquí solo está QUÉ bloque va en QUÉ sección; cómo se dibuja cada bloque sigue en views/settings.js.
// =============================================================================

/**
 * @typedef {'plan' | 'account' | 'profile' | 'currency' | 'aboutYou' | 'device' | 'tour' | 'categories' | 'workspaces' | 'details' | 'members' | 'cloud'
 *   | 'backup' | 'autoBackup' | 'demo' | 'danger' | 'accountDanger' | 'privacy' | 'next'} SettingsBlock
 */

/**
 * @typedef {Object} SettingsSection
 * @property {string} id
 * @property {string} title
 * @property {string} summary
 * @property {string} icon       Nombre del ícono (ui/icons.js)
 * @property {SettingsBlock[]} blocks
 * @property {boolean} [needsAccount]  Solo si la app tiene cuentas (con SUPABASE_URL)
 */

/** Bloques que solo existen con cuenta, dentro de secciones que se ven siempre. @type {SettingsBlock[]} */
const ACCOUNT_ONLY_BLOCKS = ['aboutYou'];

/** @type {SettingsSection[]} */
export const SETTINGS_SECTIONS = [
  { id: 'general', title: 'General', summary: 'Tu nombre, saldo inicial, moneda, modo oscuro, vibración, categorías y recorrido guiado.', icon: 'sliders', blocks: ['profile', 'currency', 'device', 'categories', 'tour'] },
  { id: 'plan', title: 'Tu plan', summary: 'Gratis, Premium o Negocio: qué trae cada uno y cuál tienes.', icon: 'spark', blocks: ['plan'], needsAccount: true },
  { id: 'cuenta', title: 'Cuenta', summary: 'Tu correo, tu contraseña, cerrar sesión y eliminar la cuenta.', icon: 'user', blocks: ['account', 'accountDanger'], needsAccount: true },
  { id: 'espacios', title: 'Espacios y equipo', summary: 'Tus espacios de trabajo, los datos del negocio y quién más los usa.', icon: 'briefcase', blocks: ['workspaces', 'details', 'members'] },
  { id: 'almacenamiento', title: 'Almacenamiento y copias', summary: 'Copia en la nube, copia de seguridad (también automática), demostración y borrar todo.', icon: 'download', blocks: ['cloud', 'backup', 'autoBackup', 'demo', 'danger'] },
  { id: 'privacidad', title: 'Privacidad y seguridad', summary: 'Dónde están tus datos, cómo se protegen, el estado del almacenamiento y tus respuestas de «Sobre ti».', icon: 'lock', blocks: ['privacy', 'aboutYou'] },
  { id: 'acerca', title: 'Acerca de ACCONTROL', summary: 'La versión que usas y lo que viene.', icon: 'info', blocks: ['next'] },
];

/**
 * Las secciones que se ven: «Cuenta» solo si la app tiene cuentas (sin ellas, el aviso «funciona sin cuenta» va en General).
 * @param {{ hasAccount: boolean }} options
 * @returns {SettingsSection[]}
 */
export function visibleSections({ hasAccount }) {
  return SETTINGS_SECTIONS.filter((s) => hasAccount || !s.needsAccount).map((s) => {
    if (hasAccount) return s;
    // Sin cuentas no hay «Sobre ti» (0.18.4): las respuestas viven en la nube de tu cuenta.
    const blocks = s.blocks.filter((b) => !ACCOUNT_ONLY_BLOCKS.includes(b));
    return { ...s, blocks: s.id === 'general' ? /** @type {SettingsBlock[]} */ (['account', ...blocks]) : blocks };
  });
}

/**
 * La sección que pide la dirección (#/ajustes/<id>), o null para la lista de secciones.
 * @param {string[]} params lo que viene después de «ajustes» en la dirección
 * @param {{ hasAccount: boolean }} options
 * @returns {SettingsSection | null}
 */
export function sectionFromParams(params, options) {
  const id = params[0] ?? '';
  return visibleSections(options).find((s) => s.id === id) ?? null;
}
