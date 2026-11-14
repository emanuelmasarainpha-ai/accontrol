// @ts-check
// =============================================================================
// ALMACÉN CON BANDEJA (0.15.0, paso 4)
// -----------------------------------------------------------------------------
// Envuelve el almacén de espacios del dispositivo (WorkspaceStore) SIN cambiar cómo guarda: cada operación hace lo
// mismo que antes y, además, anota en la bandeja de pendientes qué cambió, para enviarlo a la nube.
//
//  · Si la sincronización está apagada (isEnabled() = false), no anota nada: es exactamente el almacén de siempre.
//  · Se anota ANTES de guardar: si el guardado local falla, lo anotado no hace daño, porque al enviar se comprueba
//    contra el dispositivo (un registro que no está no se sube; un borrado solo se envía si el registro ya no está).
//  · Si anotar falla, el guardado local sigue adelante igual: lo primero son tus datos en el dispositivo.
//  · Los datos de demostración no se anotan (no se suben a la nube).
// =============================================================================

import { CLOUD_KINDS } from '../data/cloudRows.js';

/** @typedef {import('../data/workspaceStore.js').WorkspaceStore} WorkspaceStore */
/** @typedef {import('../data/dataStore.js').DataStore} DataStore */
/** @typedef {import('../domain/types.js').AppData} AppData */
/** @typedef {ReturnType<typeof import('./outbox.js').createOutbox>} Outbox */

/** Ids de registros reales (sin demostración ni categorías de fábrica) de una lista. @param {any[] | undefined} list */
const realIds = (list) => (list ?? []).filter((r) => r && r.isDemo !== true && r.builtIn !== true).map((r) => String(r.id));

/**
 * Ids de cada tipo en unos datos. Con `onlyReal`, sin los de demostración ni las categorías de fábrica: esos nunca
 * están en la nube, así que tampoco se anota borrarlos (las de fábrica ni siquiera tienen id con forma de UUID y la
 * nube rechazaría la petición entera).
 * @param {AppData} data @param {boolean} onlyReal
 */
function idsByKind(data, onlyReal) {
  /** @type {Record<string, Set<string>>} */
  const out = {};
  for (const kind of CLOUD_KINDS) {
    const list = (/** @type {any} */ (data))[kind.key] ?? [];
    out[kind.key] = new Set(onlyReal ? realIds(list) : list.map((/** @type {any} */ r) => String(r.id)));
  }
  return out;
}

/**
 * Restaurar una copia con la sincronización activa es una decisión de AHORA: los registros reales restaurados se
 * marcan con la hora actual (`updatedAt`). Si no, algo que se borró después de hacer la copia no podría volver: la
 * nube no deja revivir un registro con una versión anterior a su borrado, y otro dispositivo lo volvería a borrar aquí.
 * Las categorías no llevan `updatedAt` y los datos DEMO no viajan: no se tocan.
 * @template {Record<string, any>} T @param {T} data @param {string} at @returns {T}
 */
export function stampRestored(data, at) {
  /** @type {Record<string, any>} */
  const out = { ...data };
  for (const kind of CLOUD_KINDS) {
    const list = data[kind.key];
    if (!Array.isArray(list)) continue;
    out[kind.key] = list.map((r) => (r && r.isDemo !== true && r.builtIn !== true && typeof r.updatedAt === 'string' ? { ...r, updatedAt: at } : r));
  }
  return /** @type {T} */ (out);
}

/**
 * @param {WorkspaceStore} inner
 * @param {Outbox} outbox
 * @param {() => boolean} isEnabled
 * @param {() => string} [nowISO] reloj (para las pruebas)
 * @returns {WorkspaceStore}
 */
export function withOutbox(inner, outbox, isEnabled, nowISO = () => new Date().toISOString()) {
  /** Anota sin dejar que un fallo de la bandeja impida guardar. @param {() => void} fn */
  const note = (fn) => {
    if (!isEnabled()) return;
    try {
      fn();
    } catch (error) {
      console.error('No se pudo anotar un cambio pendiente de enviar:', error);
    }
  };

  /** Anota todo lo que cambia al pasar de `before` a `after` en un espacio. @param {string} ws @param {AppData | null} before @param {AppData} after */
  function noteReplace(ws, before, after) {
    const old = before ? idsByKind(before, true) : null;
    const fresh = idsByKind(after, false);
    for (const kind of CLOUD_KINDS) {
      outbox.markPut(ws, kind.key, realIds((/** @type {any} */ (after))[kind.key]));
      if (old) outbox.markDelete(ws, kind.key, [...old[kind.key]].filter((id) => !fresh[kind.key].has(id)));
    }
    outbox.markWorkspace(ws);
  }

  /** @param {string} ws @param {DataStore} store @returns {DataStore} */
  function tracked(ws, store) {
    return {
      load: () => store.load(),
      async putMany(changes, deletions) {
        note(() => {
          for (const kind of CLOUD_KINDS) outbox.markPut(ws, kind.key, realIds((/** @type {any} */ (changes))[kind.key]));
          for (const kind of CLOUD_KINDS) outbox.markDelete(ws, kind.key, ((/** @type {any} */ (deletions ?? {}))[kind.idsKey] ?? []).map(String));
        });
        return store.putMany(changes, deletions);
      },
      async deleteMany(deletions) {
        note(() => {
          for (const kind of CLOUD_KINDS) outbox.markDelete(ws, kind.key, ((/** @type {any} */ (deletions))[kind.idsKey] ?? []).map(String));
        });
        return store.deleteMany(deletions);
      },
      async saveSettings(settings) {
        // El nombre va al perfil y el saldo inicial al espacio.
        note(() => {
          outbox.markWorkspace(ws);
          outbox.markProfile();
        });
        return store.saveSettings(settings);
      },
      async replaceAll(data) {
        if (isEnabled()) {
          const restored = stampRestored(data, nowISO());
          const before = await store.load().catch(() => null);
          note(() => {
            noteReplace(ws, before, restored);
            outbox.markProfile();
          });
          return store.replaceAll(restored);
        }
        return store.replaceAll(data);
      },
      async clearAll() {
        if (isEnabled()) {
          const before = await store.load().catch(() => null);
          note(() => {
            if (before) for (const kind of CLOUD_KINDS) outbox.markDelete(ws, kind.key, [...idsByKind(before, true)[kind.key]]);
            outbox.markWorkspace(ws);
            outbox.markProfile();
          });
        }
        return store.clearAll();
      },
    };
  }

  return {
    listWorkspaces: () => inner.listWorkspaces(),
    getProfile: () => inner.getProfile(),
    loadEverything: () => inner.loadEverything(),
    forWorkspace: (id) => tracked(id, inner.forWorkspace(id)),

    async createWorkspace(workspace) {
      note(() => {
        outbox.markWorkspace(workspace.id);
        if (workspace.isDefault) outbox.markDefault(workspace.id);
      });
      return inner.createWorkspace(workspace);
    },
    async updateWorkspace(workspace) {
      note(() => outbox.markWorkspace(workspace.id));
      return inner.updateWorkspace(workspace);
    },
    async deleteWorkspace(id) {
      // Un espacio compartido contigo (con rol) no se borra en la nube: es de otra persona (0.16.0).
      const shared = isEnabled() ? (await inner.listWorkspaces().catch(() => [])).some((w) => w.id === id && w.role) : false;
      if (!shared) note(() => outbox.markWorkspaceDeleted(id));
      return inner.deleteWorkspace(id);
    },
    async setDefaultWorkspace(id) {
      note(() => outbox.markDefault(id));
      return inner.setDefaultWorkspace(id);
    },
    async saveProfile(profile) {
      note(() => outbox.markProfile());
      return inner.saveProfile(profile);
    },
    async replaceEverything(original) {
      let snapshot = original;
      if (isEnabled()) {
        const at = nowISO();
        snapshot = { ...original, workspaces: original.workspaces.map((w) => ({ workspace: { ...w.workspace, updatedAt: at }, data: stampRestored(w.data, at) })) };
        const before = await inner.loadEverything().catch(() => null);
        note(() => {
          const kept = new Set(snapshot.workspaces.map((w) => w.workspace.id));
          for (const old of before?.workspaces ?? []) if (!kept.has(old.workspace.id) && !old.workspace.role) outbox.markWorkspaceDeleted(old.workspace.id);
          for (const { workspace, data } of snapshot.workspaces) {
            const prev = before?.workspaces.find((w) => w.workspace.id === workspace.id)?.data ?? null;
            noteReplace(workspace.id, prev, data);
            if (workspace.isDefault) outbox.markDefault(workspace.id);
          }
          outbox.markProfile();
        });
      }
      return inner.replaceEverything(snapshot);
    },
    async clearEverything() {
      if (isEnabled()) {
        const before = await inner.loadEverything().catch(() => null);
        note(() => {
          for (const old of before?.workspaces ?? []) if (!old.workspace.role) outbox.markWorkspaceDeleted(old.workspace.id);
          outbox.markProfile();
        });
      }
      return inner.clearEverything();
    },
  };
}
