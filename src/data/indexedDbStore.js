// @ts-check
// =============================================================================
// ALMACÉN EN EL NAVEGADOR (IndexedDB)
// -----------------------------------------------------------------------------
// IndexedDB es la base de datos que traen todos los navegadores. Los datos
// quedan en ESTE dispositivo y ESTE navegador (no se comparten con tu otro
// dispositivo ni salen a internet). Sobreviven aunque cierres la app.
//
// Cada operación es una "transacción": o se guarda completa, o no se guarda.
//
// ESPACIOS DE TRABAJO (versión 4): todos los registros viven en las mismas tablas, y cada
// uno lleva el campo `workspaceId` que dice a qué espacio pertenece. `forWorkspace(id)`
// entrega un almacén que SOLO ve y toca los registros de ese espacio; si se le pide
// cambiar o borrar un registro de otro espacio, falla sin guardar nada.
// Las categorías de fábrica no llevan `workspaceId`: son iguales en todos los espacios.
// =============================================================================

import { defaultCategories } from '../domain/categories.js';
import { defaultProfile, nextDefaultId, planLegacyMigration, sortWorkspaces, withDefault } from '../domain/workspaces.js';
import {
  DATA_STORES, DELETION_FIELDS, isGlobalCategory, SCOPED_STORES, stamp, strip, visibleCategories, WORKSPACE_ERRORS,
} from './workspaceScope.js';

/** @typedef {import('./dataStore.js').DataStore} DataStore */
/** @typedef {import('./workspaceStore.js').WorkspaceStore} WorkspaceStore */
/** @typedef {import('../domain/types.js').AppData} AppData */
/** @typedef {import('../domain/types.js').Workspace} Workspace */
/** @typedef {import('../domain/types.js').Profile} Profile */

/** Base de datos de siempre. Con cuentas (0.14.0), cada cuenta abre la suya: ver auth/localOwner.js. */
const DB_NAME = 'accontrol';
/** Sube este número cuando cambies la estructura de las tablas y añade el paso en `upgrade`. */
const DB_VERSION = 8;

/**
 * Las tablas que existían cuando se creó la versión 4 (espacios de trabajo). La actualización a la versión 4 usa SIEMPRE
 * esta lista fija: así sigue funcionando aunque después se añadan tablas nuevas (las crea su propio paso).
 */
const V4_DATA_STORES = /** @type {const} */ (['movements', 'goals', 'contributions', 'debts', 'debtPayments', 'assets']);
const V4_SCOPED_STORES = /** @type {const} */ (['categories', ...V4_DATA_STORES]);

const ALL_STORES = /** @type {const} */ ([...SCOPED_STORES, 'settings', 'workspaces']);
/** Clave de los ajustes viejos (antes de los espacios). Después de actualizar queda sin usar. */
const LEGACY_SETTINGS_KEY = 'main';
/** Clave del perfil (nombre y último espacio usado). */
const PROFILE_KEY = 'profile';

/** @param {string} name @returns {Promise<IDBDatabase>} */
function openDatabase(name) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no permite guardar datos (IndexedDB no está disponible).'));
      return;
    }
    const request = indexedDB.open(name, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const tx = request.transaction;
      if (tx) upgrade(request.result, event.oldVersion, tx);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Si otra pestaña pide actualizar la base de datos, nos apartamos.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña. Ciérrala e inténtalo de nuevo.'));
    request.onerror = () => reject(new Error(`No se pudo abrir el almacenamiento: ${request.error?.message ?? 'error desconocido'}`));
  });
}

/**
 * Crea o actualiza la estructura. Cada versión futura añade su bloque `if`.
 * @param {IDBDatabase} db @param {number} oldVersion @param {IDBTransaction} tx  la transacción de la actualización
 */
function upgrade(db, oldVersion, tx) {
  if (oldVersion < 1) {
    db.createObjectStore('categories', { keyPath: 'id' });
    db.createObjectStore('movements', { keyPath: 'id' }).createIndex('date', 'date');
    db.createObjectStore('goals', { keyPath: 'id' });
    db.createObjectStore('contributions', { keyPath: 'id' }).createIndex('goalId', 'goalId');
    db.createObjectStore('settings', { keyPath: 'key' });
  }
  // Versión 2 (Etapa 3): deudas y sus pagos. Quien ya tenía la versión 1 conserva todos sus datos.
  if (oldVersion < 2) {
    db.createObjectStore('debts', { keyPath: 'id' });
    db.createObjectStore('debtPayments', { keyPath: 'id' }).createIndex('debtId', 'debtId');
  }
  if (oldVersion < 3) {
    db.createObjectStore('assets', { keyPath: 'id' });
  }
  // Versión 4 (espacios de trabajo): cada tabla con registros de un espacio recibe un índice por espacio,
  // y nace la tabla de espacios. Quien ya tenía datos los conserva TODOS, en «Mi espacio personal».
  if (oldVersion < 4) {
    for (const name of V4_SCOPED_STORES) tx.objectStore(name).createIndex('workspaceId', 'workspaceId');
    db.createObjectStore('workspaces', { keyPath: 'id' });
    if (oldVersion >= 1) migrateToWorkspaces(tx);
  }
  // Versión 5 (módulo Freelancer): clientes y servicios, cada uno con su índice por espacio. No se toca ningún dato existente.
  if (oldVersion < 5) {
    for (const name of ['clients', 'services']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('workspaceId', 'workspaceId');
  }
  // Versión 6 (inventario): productos, proveedores y movimientos de stock, cada uno con su índice por espacio.
  // Los de stock, además, con índice por producto. No se toca ningún dato existente.
  if (oldVersion < 6) {
    for (const name of ['products', 'suppliers', 'stockEntries']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('workspaceId', 'workspaceId');
    tx.objectStore('stockEntries').createIndex('productId', 'productId');
  }
  // Versión 7 (facturas internas): facturas y sus cobros, cada uno con su índice por espacio; los cobros, además, por factura.
  // No se toca ningún dato existente.
  if (oldVersion < 7) {
    for (const name of ['invoices', 'invoicePayments']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('workspaceId', 'workspaceId');
    tx.objectStore('invoicePayments').createIndex('invoiceId', 'invoiceId');
  }
  // Versión 8 (departamentos y presupuestos por área): una tabla con su índice por espacio. No se toca ningún dato existente
  // (los gastos que se asignen a un departamento llevarán un campo nuevo; los de antes simplemente no lo tienen).
  if (oldVersion < 8) {
    db.createObjectStore('departments', { keyPath: 'id' }).createIndex('workspaceId', 'workspaceId');
  }
}

/**
 * Convierte una instalación anterior (sin espacios) a la versión 4 (con las tablas de entonces), dentro de la misma transacción de la
 * actualización: si algo falla, la base queda como estaba (versión 3) y no se pierde nada.
 * @param {IDBTransaction} tx
 */
function migrateToWorkspaces(tx) {
  const reads = Object.fromEntries(V4_SCOPED_STORES.map((name) => [name, tx.objectStore(name).getAll()]));
  const legacy = tx.objectStore('settings').get(LEGACY_SETTINGS_KEY);
  let pending = V4_SCOPED_STORES.length + 1;

  const apply = () => {
    const customCategories = /** @type {any[]} */ (reads.categories.result).filter((c) => !isGlobalCategory(c));
    const records = customCategories.length + V4_DATA_STORES.reduce((sum, name) => sum + reads[name].result.length, 0);
    const saved = legacy.result;
    const plan = planLegacyMigration(
      { records, displayName: saved?.displayName ?? '', openingBalanceCents: saved?.openingBalanceCents ?? 0 },
      new Date().toISOString(),
    );
    if (!plan) return; // Instalación sin datos del usuario: verá la pantalla de elegir modalidad.

    const id = plan.workspace.id;
    tx.objectStore('workspaces').put(plan.workspace);
    tx.objectStore('settings').put({ key: PROFILE_KEY, ...plan.profile });
    for (const c of customCategories) tx.objectStore('categories').put(stamp(c, id));
    for (const name of V4_DATA_STORES) {
      for (const record of /** @type {any[]} */ (reads[name].result)) tx.objectStore(name).put(stamp(record, id));
    }
  };

  const oneMore = () => { pending -= 1; if (pending === 0) apply(); };
  for (const request of [...Object.values(reads), legacy]) request.onsuccess = oneMore;
}

/**
 * Ejecuta trabajo dentro de una transacción y espera a que quede GUARDADA en disco.
 * `work` recibe también `fail(error)`: aborta la transacción (no se guarda NADA) y hace que la
 * promesa falle con ese error.
 * @template T
 * @param {IDBDatabase} db
 * @param {readonly string[]} storeNames
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction, fail: (error: Error) => void) => T} work
 * @returns {Promise<T>}
 */
function transact(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      // 'strict' pide al navegador confirmar la escritura en disco antes de terminar.
      tx = db.transaction([...storeNames], mode, { durability: 'strict' });
    } catch {
      tx = db.transaction([...storeNames], mode);
    }
    /** @type {T} */
    let result;
    /** @type {Error | null} */
    let problem = null;
    /** @param {Error} error */
    const fail = (error) => {
      if (problem === null) problem = error;
      try { tx.abort(); } catch { /* ya terminó */ }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = (event) => reject(problem ?? /** @type {IDBRequest} */ (event.target)?.error ?? tx.error ?? new Error('Error al guardar los datos.'));
    tx.onabort = () => reject(problem ?? tx.error ?? new Error('La operación se canceló y no se guardó nada.'));
    try {
      result = work(tx, fail);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Agrega registros que NO deben existir todavía (si el id ya existe es de otro espacio: se cancela todo).
 * @param {IDBObjectStore} store @param {any[]} records @param {(error: Error) => void} fail
 */
function addAll(store, records, fail) {
  for (const record of records) {
    const request = store.add(record);
    request.onerror = (event) => {
      event.preventDefault();
      fail(new Error(WORKSPACE_ERRORS.collision));
    };
  }
}

/**
 * Siembra las categorías de fábrica si faltan (todas las categorías de fábrica juntas).
 * @param {IDBObjectStore} store @param {any[]} rows lo que ya hay en la tabla
 * @returns {any[]} las filas, con las de fábrica incluidas
 */
function ensureBuiltIns(store, rows) {
  if (rows.some(isGlobalCategory)) return rows;
  const defaults = defaultCategories();
  for (const c of defaults) store.put(c);
  return [...rows, ...defaults];
}

/**
 * Crea el almacén del navegador.
 * @param {{ name?: string }} [options] name: nombre de la base de datos (cada cuenta de un mismo dispositivo usa la suya).
 * @returns {Promise<WorkspaceStore>}
 */
export async function createIndexedDbStore({ name = DB_NAME } = {}) {
  const db = await openDatabase(name);

  /** @param {Workspace} workspace @param {string} nowISO */
  const withoutDefault = (workspace, nowISO) => ({ ...workspace, isDefault: false, updatedAt: nowISO });

  /**
   * Un almacén que solo ve los registros del espacio `id`.
   * @param {string} id
   * @returns {DataStore}
   */
  function forWorkspace(id) {
    /**
     * Comprueba que el espacio exista (si se borró en otra pestaña, no se escribe nada) y sigue con `next`.
     * @param {IDBTransaction} tx @param {(workspace: Workspace) => void} next @param {(error: Error) => void} fail
     */
    const withWorkspace = (tx, next, fail) => {
      const request = tx.objectStore('workspaces').get(id);
      request.onsuccess = () => {
        if (!request.result) fail(new Error(WORKSPACE_ERRORS.gone));
        else next(request.result);
      };
    };

    /** Guarda y borra en UNA transacción. @param {import('./dataStore.js').Changes} changes @param {import('./dataStore.js').Deletions} [deletions] */
    const write = async (changes, deletions = {}) => {
      const putNames = SCOPED_STORES.filter((n) => (changes[n]?.length ?? 0) > 0);
      const plan = DELETION_FIELDS.map(([name, field]) => /** @type {const} */ ([name, deletions[field] ?? []])).filter(([, ids]) => ids.length > 0);
      if (putNames.length === 0 && plan.length === 0) return;
      const names = [...new Set([...putNames, ...plan.map(([n]) => n)])];
      // Guardar y borrar van en UNA transacción: o cambia todo, o no cambia nada.
      await transact(db, ['workspaces', ...names], 'readwrite', (tx, fail) => {
        withWorkspace(tx, () => {
          for (const name of putNames) {
            const store = tx.objectStore(name);
            for (const record of /** @type {any[]} */ (changes[name] ?? [])) {
              if (isGlobalCategory(record)) { store.put(record); continue; }
              // Un id que ya existe en OTRO espacio nunca se pisa.
              const existing = store.get(record.id);
              existing.onsuccess = () => {
                if (existing.result && existing.result.workspaceId !== id) fail(new Error(WORKSPACE_ERRORS.collision));
                else store.put(stamp(record, id));
              };
            }
          }
          for (const [name, ids] of plan) {
            const store = tx.objectStore(name);
            for (const key of ids) {
              const existing = store.get(key);
              existing.onsuccess = () => {
                if (!existing.result) return;
                if (existing.result.workspaceId !== id) fail(new Error(WORKSPACE_ERRORS.collision));
                else store.delete(key);
              };
            }
          }
        }, fail);
      });
    };

    return {
      async load() {
        // Se lee y, si es la primera vez, se siembran las categorías, en UNA transacción.
        return transact(db, ALL_STORES, 'readwrite', (tx, fail) => {
          /** @type {AppData} */
          const data = {
            categories: [], movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [],
            settings: { displayName: '', openingBalanceCents: 0 },
          };
          withWorkspace(tx, (workspace) => {
            const profile = tx.objectStore('settings').get(PROFILE_KEY);
            profile.onsuccess = () => {
              data.settings = { displayName: profile.result?.displayName ?? '', openingBalanceCents: workspace.openingBalanceCents };
            };
            const categories = tx.objectStore('categories').getAll();
            categories.onsuccess = () => {
              const rows = ensureBuiltIns(tx.objectStore('categories'), categories.result);
              data.categories = /** @type {any[]} */ (visibleCategories(rows, id));
            };
            for (const name of DATA_STORES) {
              const request = tx.objectStore(name).index('workspaceId').getAll(id);
              request.onsuccess = () => { data[name] = /** @type {any[]} */ (request.result.map(strip)); };
            }
          }, fail);
          return data;
        });
      },

      putMany: write,

      deleteMany: (deletions) => write({}, deletions),

      async saveSettings(settings) {
        await transact(db, ['workspaces', 'settings'], 'readwrite', (tx, fail) => {
          withWorkspace(tx, (workspace) => {
            // El saldo inicial es de este espacio; el nombre es de la persona (perfil).
            tx.objectStore('workspaces').put({ ...workspace, openingBalanceCents: settings.openingBalanceCents, updatedAt: new Date().toISOString() });
            const profile = tx.objectStore('settings').get(PROFILE_KEY);
            profile.onsuccess = () => {
              tx.objectStore('settings').put({ ...defaultProfile(), ...(profile.result ?? {}), key: PROFILE_KEY, displayName: settings.displayName });
            };
          }, fail);
        });
      },

      async replaceAll(data) {
        await transact(db, ALL_STORES, 'readwrite', (tx, fail) => {
          withWorkspace(tx, (workspace) => {
            ensureBuiltInsInTx(tx);
            // Primero se borra lo de ESTE espacio y después se agrega lo nuevo: si un id choca con
            // otro espacio, se cancela todo y no cambia nada.
            for (const name of SCOPED_STORES) {
              const store = tx.objectStore(name);
              const keys = store.index('workspaceId').getAllKeys(id);
              keys.onsuccess = () => {
                for (const key of keys.result) store.delete(key);
                const incoming = /** @type {any[]} */ (data[name]).filter((r) => !isGlobalCategory(r));
                addAll(store, incoming.map((r) => stamp(r, id)), fail);
              };
            }
            tx.objectStore('workspaces').put({ ...workspace, openingBalanceCents: data.settings.openingBalanceCents, updatedAt: new Date().toISOString() });
            const profile = tx.objectStore('settings').get(PROFILE_KEY);
            profile.onsuccess = () => {
              tx.objectStore('settings').put({ ...defaultProfile(), ...(profile.result ?? {}), key: PROFILE_KEY, displayName: data.settings.displayName });
            };
          }, fail);
        });
      },

      async clearAll() {
        await transact(db, ALL_STORES, 'readwrite', (tx, fail) => {
          withWorkspace(tx, (workspace) => {
            for (const name of SCOPED_STORES) {
              const store = tx.objectStore(name);
              const keys = store.index('workspaceId').getAllKeys(id);
              keys.onsuccess = () => { for (const key of keys.result) store.delete(key); };
            }
            tx.objectStore('workspaces').put({ ...workspace, openingBalanceCents: 0, updatedAt: new Date().toISOString() });
          }, fail);
        });
      },
    };
  }

  /** Si no hay categorías de fábrica, las siembra (dentro de una transacción que incluya `categories`). @param {IDBTransaction} tx */
  function ensureBuiltInsInTx(tx) {
    const store = tx.objectStore('categories');
    const rows = store.getAll();
    rows.onsuccess = () => { ensureBuiltIns(store, rows.result); };
  }

  return {
    async listWorkspaces() {
      return transact(db, ['workspaces'], 'readonly', (tx) => {
        /** @type {Workspace[]} */
        const list = [];
        const request = tx.objectStore('workspaces').getAll();
        request.onsuccess = () => { list.push(...sortWorkspaces(request.result)); };
        return list;
      });
    },

    async createWorkspace(workspace) {
      await transact(db, ['workspaces'], 'readwrite', (tx, fail) => {
        const store = tx.objectStore('workspaces');
        const all = store.getAll();
        all.onsuccess = () => {
          /** @type {Workspace[]} */
          const list = all.result;
          if (list.some((w) => w.id === workspace.id)) { fail(new Error(WORKSPACE_ERRORS.duplicate)); return; }
          if (workspace.isDefault) for (const other of list) if (other.isDefault) store.put(withoutDefault(other, workspace.updatedAt));
          store.put(workspace);
        };
      });
    },

    async updateWorkspace(workspace) {
      await transact(db, ['workspaces'], 'readwrite', (tx, fail) => {
        const store = tx.objectStore('workspaces');
        const all = store.getAll();
        all.onsuccess = () => {
          /** @type {Workspace[]} */
          const list = all.result;
          if (!list.some((w) => w.id === workspace.id)) { fail(new Error(WORKSPACE_ERRORS.gone)); return; }
          if (workspace.isDefault) for (const other of list) if (other.isDefault && other.id !== workspace.id) store.put(withoutDefault(other, workspace.updatedAt));
          store.put(workspace);
        };
      });
    },

    async deleteWorkspace(id) {
      await transact(db, ALL_STORES, 'readwrite', (tx) => {
        const workspaces = tx.objectStore('workspaces');
        const existing = workspaces.get(id);
        existing.onsuccess = () => {
          if (!existing.result) return; // ya estaba borrado
          workspaces.delete(id);
          for (const name of SCOPED_STORES) {
            const store = tx.objectStore(name);
            const keys = store.index('workspaceId').getAllKeys(id);
            keys.onsuccess = () => { for (const key of keys.result) store.delete(key); };
          }
          // Si era el predeterminado, el más antiguo que quede pasa a serlo.
          const remaining = workspaces.getAll();
          remaining.onsuccess = () => {
            const next = nextDefaultId(remaining.result);
            const found = remaining.result.find((/** @type {Workspace} */ w) => w.id === next);
            if (found) workspaces.put({ ...found, isDefault: true, updatedAt: new Date().toISOString() });
          };
          const profile = tx.objectStore('settings').get(PROFILE_KEY);
          profile.onsuccess = () => {
            if (profile.result?.lastWorkspaceId === id) tx.objectStore('settings').put({ ...profile.result, lastWorkspaceId: null });
          };
        };
      });
    },

    async setDefaultWorkspace(id) {
      await transact(db, ['workspaces'], 'readwrite', (tx, fail) => {
        const store = tx.objectStore('workspaces');
        const all = store.getAll();
        all.onsuccess = () => {
          /** @type {Workspace[]} */
          const list = all.result;
          if (!list.some((w) => w.id === id)) { fail(new Error(WORKSPACE_ERRORS.gone)); return; }
          const next = withDefault(list, id, new Date().toISOString());
          next.forEach((w, i) => { if (w !== list[i]) store.put(w); });
        };
      });
    },

    async getProfile() {
      return transact(db, ['settings'], 'readonly', (tx) => {
        /** @type {Profile} */
        const profile = defaultProfile();
        const request = tx.objectStore('settings').get(PROFILE_KEY);
        request.onsuccess = () => {
          if (request.result) {
            profile.displayName = request.result.displayName ?? '';
            profile.lastWorkspaceId = request.result.lastWorkspaceId ?? null;
          }
        };
        return profile;
      });
    },

    async saveProfile(profile) {
      await transact(db, ['settings'], 'readwrite', (tx) => {
        tx.objectStore('settings').put({ key: PROFILE_KEY, displayName: profile.displayName, lastWorkspaceId: profile.lastWorkspaceId });
      });
    },

    forWorkspace,

    async loadEverything() {
      return transact(db, ALL_STORES, 'readonly', (tx) => {
        /** @type {import('./workspaceStore.js').Snapshot} */
        const snapshot = { profile: defaultProfile(), workspaces: [] };
        const reads = Object.fromEntries(ALL_STORES.map((name) => [name, tx.objectStore(name).getAll()]));
        const profile = tx.objectStore('settings').get(PROFILE_KEY);
        let pending = ALL_STORES.length + 1;
        const build = () => {
          const saved = profile.result;
          snapshot.profile = { displayName: saved?.displayName ?? '', lastWorkspaceId: saved?.lastWorkspaceId ?? null };
          const categories = reads.categories.result.some(isGlobalCategory) ? reads.categories.result : [...reads.categories.result, ...defaultCategories()];
          for (const workspace of sortWorkspaces(reads.workspaces.result)) {
            /** @type {AppData} */
            const data = {
              categories: /** @type {any[]} */ (visibleCategories(categories, workspace.id)),
              movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [],
              settings: { displayName: snapshot.profile.displayName, openingBalanceCents: workspace.openingBalanceCents },
            };
            for (const name of DATA_STORES) {
              data[name] = /** @type {any[]} */ (reads[name].result.filter((/** @type {any} */ r) => r.workspaceId === workspace.id).map(strip));
            }
            snapshot.workspaces.push({ workspace, data });
          }
        };
        const oneMore = () => { pending -= 1; if (pending === 0) build(); };
        for (const request of [...Object.values(reads), profile]) request.onsuccess = oneMore;
        return snapshot;
      });
    },

    async replaceEverything(snapshot) {
      await transact(db, ALL_STORES, 'readwrite', (tx, fail) => {
        for (const name of ALL_STORES) tx.objectStore(name).clear();
        for (const c of defaultCategories()) tx.objectStore('categories').put(c);
        tx.objectStore('settings').put({ key: PROFILE_KEY, displayName: snapshot.profile.displayName, lastWorkspaceId: snapshot.profile.lastWorkspaceId });
        for (const { workspace, data } of snapshot.workspaces) {
          tx.objectStore('workspaces').put(workspace);
          for (const name of SCOPED_STORES) {
            const incoming = /** @type {any[]} */ (data[name]).filter((r) => !isGlobalCategory(r));
            addAll(tx.objectStore(name), incoming.map((r) => stamp(r, workspace.id)), fail);
          }
        }
      });
    },

    async clearEverything() {
      await transact(db, ALL_STORES, 'readwrite', (tx) => {
        for (const name of ALL_STORES) tx.objectStore(name).clear();
        for (const c of defaultCategories()) tx.objectStore('categories').put(c);
      });
    },
  };
}
