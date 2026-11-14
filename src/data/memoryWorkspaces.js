// @ts-check
// =============================================================================
// ESPACIOS EN MEMORIA
// -----------------------------------------------------------------------------
// Cumple el contrato `WorkspaceStore` sin guardar nada en disco (Node no tiene IndexedDB).
// Está construido igual que el almacén real: una sola tabla por tipo de registro, con el
// campo `workspaceId` en cada fila. Así las pruebas de aislamiento prueban la misma regla.
// =============================================================================

import { defaultCategories } from '../domain/categories.js';
import { defaultProfile, nextDefaultId, sortWorkspaces, withDefault } from '../domain/workspaces.js';
import { DATA_STORES, DELETION_FIELDS, isGlobalCategory, SCOPED_STORES, stamp, strip, visibleCategories, WORKSPACE_ERRORS } from './workspaceScope.js';

/** @typedef {import('./workspaceStore.js').WorkspaceStore} WorkspaceStore */
/** @typedef {import('./dataStore.js').DataStore} DataStore */
/** @typedef {import('../domain/types.js').AppData} AppData */
/** @typedef {import('../domain/types.js').Workspace} Workspace */
/** @typedef {import('../domain/types.js').Profile} Profile */

/**
 * @param {{ workspaces?: Workspace[], profile?: Profile, data?: Record<string, Partial<AppData>> }} [initial]
 *   `data` es el contenido de cada espacio, por id del espacio.
 * @returns {WorkspaceStore & { failNextWrite: () => void, rawRecords: (table: string) => any[] }}
 */
export function createMemoryWorkspaceStore(initial = {}) {
  /** @type {Map<string, Workspace>} */
  let workspaces = new Map();
  let profile = { ...defaultProfile(), ...(initial.profile ?? {}) };
  /** @type {Record<string, Map<string, any>>} */
  let tables = emptyTables();
  let shouldFail = false;

  function emptyTables() {
    return Object.fromEntries(SCOPED_STORES.map((name) => [name, new Map()]));
  }

  function seedBuiltIns() {
    for (const c of defaultCategories()) tables.categories.set(c.id, structuredClone(c));
  }

  /** Mete los registros de un espacio en las tablas (marcados con su espacio). */
  function fillWorkspace(/** @type {string} */ id, /** @type {Partial<AppData>} */ data) {
    for (const name of SCOPED_STORES) {
      for (const record of /** @type {any[]} */ (data[name] ?? [])) {
        tables[name].set(record.id, isGlobalCategory(record) ? structuredClone(record) : structuredClone(stamp(record, id)));
      }
    }
  }

  seedBuiltIns();
  for (const w of initial.workspaces ?? []) workspaces.set(w.id, structuredClone(w));
  for (const [id, data] of Object.entries(initial.data ?? {})) fillWorkspace(id, data);

  async function guard() {
    if (shouldFail) {
      shouldFail = false;
      throw new Error('Fallo de escritura simulado');
    }
  }

  /** @param {string} id */
  function need(id) {
    const found = workspaces.get(id);
    if (!found) throw new Error(WORKSPACE_ERRORS.gone);
    return found;
  }

  /** @param {string} id @returns {AppData} */
  function dataOf(id) {
    const ws = need(id);
    const own = (/** @type {string} */ name) => /** @type {any[]} */ ([...tables[name].values()].filter((r) => r.workspaceId === id).map((r) => strip(structuredClone(r))));
    return {
      categories: /** @type {any[]} */ (visibleCategories([...tables.categories.values()].map((r) => structuredClone(r)), id)),
      movements: own('movements'),
      goals: own('goals'),
      contributions: own('contributions'),
      debts: own('debts'),
      debtPayments: own('debtPayments'),
      assets: own('assets'),
      clients: own('clients'),
      services: own('services'),
      products: own('products'),
      suppliers: own('suppliers'),
      stockEntries: own('stockEntries'),
      invoices: own('invoices'),
      invoicePayments: own('invoicePayments'),
      departments: own('departments'),
      settings: { displayName: profile.displayName, openingBalanceCents: ws.openingBalanceCents },
    };
  }

  /** Borra los registros de un espacio (las categorías de fábrica no son de nadie). @param {string} id */
  function removeRecordsOf(id) {
    for (const name of SCOPED_STORES) {
      for (const [key, record] of tables[name]) if (record.workspaceId === id) tables[name].delete(key);
    }
  }

  /** @param {string} id @returns {DataStore} */
  function forWorkspace(id) {
    /** Los registros que se borrarían (los que no existen se ignoran). Falla si alguno es de OTRO espacio. @param {import('./dataStore.js').Deletions} deletions */
    const plannedDeletions = (deletions) => {
      /** @type {[string, string][]} */
      const doomed = [];
      for (const [name, field] of DELETION_FIELDS) {
        for (const key of deletions[field] ?? []) {
          const existing = tables[name].get(key);
          if (!existing) continue;
          if (existing.workspaceId !== id) throw new Error(WORKSPACE_ERRORS.collision);
          doomed.push([name, key]);
        }
      }
      return doomed;
    };

    return {
      async load() {
        return dataOf(id);
      },

      async putMany(changes, deletions = {}) {
        await guard();
        need(id);
        // Todo se comprueba ANTES de tocar nada: si un id es de otro espacio, no cambia ni se borra nada.
        const planned = [];
        for (const name of SCOPED_STORES) {
          for (const record of /** @type {any[]} */ (changes[name] ?? [])) {
            if (isGlobalCategory(record)) { planned.push([name, record.id, structuredClone(record)]); continue; }
            const existing = tables[name].get(record.id);
            if (existing && existing.workspaceId !== id) throw new Error(WORKSPACE_ERRORS.collision);
            planned.push([name, record.id, structuredClone(stamp(record, id))]);
          }
        }
        const doomed = plannedDeletions(deletions);
        for (const [name, key, record] of planned) tables[name].set(key, record);
        for (const [name, key] of doomed) tables[name].delete(key);
      },

      async deleteMany(deletions) {
        await guard();
        need(id);
        for (const [name, key] of plannedDeletions(deletions)) tables[name].delete(key);
      },

      async saveSettings(next) {
        await guard();
        const ws = need(id);
        workspaces.set(id, { ...ws, openingBalanceCents: next.openingBalanceCents, updatedAt: new Date().toISOString() });
        profile = { ...profile, displayName: next.displayName };
      },

      async replaceAll(data) {
        await guard();
        const ws = need(id);
        // Se comprueba ANTES de tocar nada: si algún id es de otro espacio, no se cambia nada.
        for (const name of SCOPED_STORES) {
          for (const record of /** @type {any[]} */ (data[name])) {
            if (isGlobalCategory(record)) continue;
            const existing = tables[name].get(record.id);
            if (existing && existing.workspaceId !== id) throw new Error(WORKSPACE_ERRORS.collision);
          }
        }
        removeRecordsOf(id);
        fillWorkspace(id, { ...data, categories: data.categories.filter((c) => !isGlobalCategory(c)) });
        workspaces.set(id, { ...ws, openingBalanceCents: data.settings.openingBalanceCents, updatedAt: new Date().toISOString() });
        profile = { ...profile, displayName: data.settings.displayName };
      },

      async clearAll() {
        await guard();
        const ws = need(id);
        removeRecordsOf(id);
        workspaces.set(id, { ...ws, openingBalanceCents: 0, updatedAt: new Date().toISOString() });
      },
    };
  }

  return {
    failNextWrite() { shouldFail = true; },
    rawRecords: (table) => [...tables[table].values()].map((r) => structuredClone(r)),

    async listWorkspaces() {
      return sortWorkspaces([...workspaces.values()]).map((w) => structuredClone(w));
    },

    async createWorkspace(workspace) {
      await guard();
      if (workspaces.has(workspace.id)) throw new Error(WORKSPACE_ERRORS.duplicate);
      if (workspace.isDefault) workspaces = new Map([...workspaces].map(([k, w]) => [k, w.isDefault ? { ...w, isDefault: false } : w]));
      workspaces.set(workspace.id, structuredClone(workspace));
    },

    async updateWorkspace(workspace) {
      await guard();
      need(workspace.id);
      if (workspace.isDefault) workspaces = new Map([...workspaces].map(([k, w]) => [k, w.isDefault && k !== workspace.id ? { ...w, isDefault: false } : w]));
      workspaces.set(workspace.id, structuredClone(workspace));
    },

    async deleteWorkspace(id) {
      await guard();
      if (!workspaces.has(id)) return;
      workspaces.delete(id);
      removeRecordsOf(id);
      const nextDefault = nextDefaultId([...workspaces.values()]);
      if (nextDefault) workspaces.set(nextDefault, { ...need(nextDefault), isDefault: true });
      if (profile.lastWorkspaceId === id) profile = { ...profile, lastWorkspaceId: null };
    },

    async setDefaultWorkspace(id) {
      await guard();
      need(id);
      const next = withDefault([...workspaces.values()], id, new Date().toISOString());
      workspaces = new Map(next.map((w) => [w.id, w]));
    },

    async getProfile() {
      return { ...profile };
    },

    async saveProfile(next) {
      await guard();
      profile = { ...next };
    },

    forWorkspace,

    async loadEverything() {
      return {
        profile: { ...profile },
        workspaces: sortWorkspaces([...workspaces.values()]).map((w) => ({ workspace: structuredClone(w), data: dataOf(w.id) })),
      };
    },

    async replaceEverything(snapshot) {
      await guard();
      // Se arma todo aparte y solo se instala si no hubo ningún choque de ids.
      const nextTables = emptyTables();
      for (const c of defaultCategories()) nextTables.categories.set(c.id, structuredClone(c));
      for (const { workspace, data } of snapshot.workspaces) {
        for (const name of SCOPED_STORES) {
          for (const record of /** @type {any[]} */ (data[name])) {
            if (isGlobalCategory(record)) continue;
            if (nextTables[name].has(record.id)) throw new Error(WORKSPACE_ERRORS.collision);
            nextTables[name].set(record.id, structuredClone(stamp(record, workspace.id)));
          }
        }
      }
      tables = nextTables;
      workspaces = new Map(snapshot.workspaces.map(({ workspace }) => [workspace.id, structuredClone(workspace)]));
      profile = { ...snapshot.profile };
    },

    async clearEverything() {
      await guard();
      tables = emptyTables();
      seedBuiltIns();
      workspaces = new Map();
      profile = defaultProfile();
    },
  };
}

// Para que `DATA_STORES` quede referenciado en los tipos de quien importe este módulo.
export { DATA_STORES };
