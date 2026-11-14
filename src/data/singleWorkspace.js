// @ts-check
// =============================================================================
// UN SOLO ESPACIO
// -----------------------------------------------------------------------------
// Convierte un `DataStore` suelto en un `WorkspaceStore` con exactamente un espacio
// («Mi espacio personal»). Sirve para usar el "cerebro" (app/store.js) sobre un único
// conjunto de datos, y es lo que usan las pruebas automáticas de las acciones.
// No puede crear ni borrar espacios.
// =============================================================================

import { defaultProfile, PERSONAL_WORKSPACE_ID } from '../domain/workspaces.js';

/** @typedef {import('./dataStore.js').DataStore} DataStore */
/** @typedef {import('./workspaceStore.js').WorkspaceStore} WorkspaceStore */

/**
 * @param {DataStore} dataStore
 * @returns {WorkspaceStore}
 */
export function singleWorkspace(dataStore) {
  const stamp = new Date(0).toISOString();
  /** @type {import('../domain/types.js').Workspace} */
  const workspace = {
    id: PERSONAL_WORKSPACE_ID, kind: 'personal', name: 'Mi espacio personal', currency: 'DOP',
    openingBalanceCents: 0, isDefault: true, createdAt: stamp, updatedAt: stamp,
  };
  /** @type {import('../domain/types.js').Profile} */
  let profile = { ...defaultProfile(), lastWorkspaceId: workspace.id };
  const only = () => Promise.reject(new Error('Este almacén tiene un solo espacio de trabajo.'));

  return {
    listWorkspaces: async () => [{ ...workspace }],
    createWorkspace: only,
    updateWorkspace: only,
    deleteWorkspace: only,
    setDefaultWorkspace: async () => undefined,
    getProfile: async () => ({ ...profile }),
    saveProfile: async (next) => { profile = { ...next }; },
    forWorkspace: () => dataStore,
    loadEverything: async () => ({ profile: { ...profile }, workspaces: [{ workspace: { ...workspace }, data: await dataStore.load() }] }),
    replaceEverything: async (snapshot) => {
      const first = snapshot.workspaces[0];
      if (!first) throw new Error('La copia no trae ningún espacio.');
      await dataStore.replaceAll(first.data);
    },
    clearEverything: () => dataStore.clearAll(),
  };
}
