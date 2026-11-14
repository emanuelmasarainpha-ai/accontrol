// @ts-check
// =============================================================================
// WORKSPACESTORE: el contrato de los espacios de trabajo
// -----------------------------------------------------------------------------
// Encima del contrato `DataStore` (que guarda y lee los datos de UN espacio) hay
// otro contrato que sabe de espacios: cuáles existen, cuál es el predeterminado,
// y cómo obtener el almacén de cada uno con `forWorkspace(id)`.
//
// Implementaciones:
//   indexedDbStore.js     -> la real (navegador)
//   memoryWorkspaces.js   -> en memoria (pruebas)
//   singleWorkspace.js    -> adapta un DataStore suelto a «un solo espacio» (pruebas del cerebro)
//
// Regla de aislamiento (la garantiza el almacén, no la pantalla): el almacén de un
// espacio NUNCA lee, cambia ni borra registros de otro espacio, aunque se le pasen sus ids.
// En la Etapa 2, un almacén en la nube cumplirá este mismo contrato.
// =============================================================================

/** @typedef {import('./dataStore.js').DataStore} DataStore */
/** @typedef {import('../domain/types.js').AppData} AppData */
/** @typedef {import('../domain/types.js').Workspace} Workspace */
/** @typedef {import('../domain/types.js').Profile} Profile */

/**
 * Todo lo guardado, espacio por espacio (para la copia de seguridad completa).
 * @typedef {Object} Snapshot
 * @property {Profile} profile
 * @property {{ workspace: Workspace, data: AppData }[]} workspaces
 */

/**
 * @typedef {Object} WorkspaceStore
 * @property {() => Promise<Workspace[]>} listWorkspaces
 * @property {(workspace: Workspace) => Promise<void>} createWorkspace
 *   Crea un espacio. Si viene como predeterminado, los demás dejan de serlo (todo en una operación).
 * @property {(workspace: Workspace) => Promise<void>} updateWorkspace
 *   Reemplaza el registro de un espacio que ya existe (renombrar, etc.).
 * @property {(id: string) => Promise<void>} deleteWorkspace
 *   Borra el espacio y TODOS sus registros.
 * @property {(id: string) => Promise<void>} setDefaultWorkspace
 * @property {() => Promise<Profile>} getProfile
 * @property {(profile: Profile) => Promise<void>} saveProfile
 * @property {(id: string) => DataStore} forWorkspace
 *   El almacén de los datos de ese espacio. Cumple el contrato de `dataStore.js`; su `saveSettings`
 *   reparte el nombre (perfil) y el saldo inicial (espacio).
 * @property {() => Promise<Snapshot>} loadEverything
 * @property {(snapshot: Snapshot) => Promise<void>} replaceEverything
 *   Sustituye TODO (espacios, perfil y datos) en una sola operación atómica.
 * @property {() => Promise<void>} clearEverything
 *   Borra todos los espacios y el perfil: la app vuelve a la pantalla de elegir modalidad.
 */

export {};
