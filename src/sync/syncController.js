// @ts-check
// =============================================================================
// COPIA EN LA NUBE: CONTROL (0.15.0, paso 5)
// -----------------------------------------------------------------------------
// Une la bandeja, el motor de envío y el almacén de la nube, y decide cuándo está activa la sincronización.
//
//  · Se recuerda POR CUENTA y en este dispositivo: localStorage['accontrol.sync.v1.<cuenta>'] =
//    { enabled, firstUploadAt, asked }. Apagada (lo normal hasta que la persona la activa), la app guarda igual que
//    siempre y no anota nada.
//  · Activar = PRIMERA SUBIDA: todos los espacios y sus datos reales (los DEMO no), y al final se COMPRUEBA que la nube
//    tiene exactamente los mismos registros que el dispositivo. Si algo falla o no cuadra, se apaga de nuevo y se dice
//    por qué; volver a intentarlo es seguro (subir es repetible).
//  · Paso 6: activar en un dispositivo cuando la cuenta ya tiene datos en la nube (de otro dispositivo) los JUNTA:
//    primero se baja lo de la nube (gana el cambio más reciente de cada registro; los espacios de aquí se conservan) y
//    luego se sube lo de aquí. En un dispositivo vacío, activar es simplemente «traer mis datos».
//  · Una vez activa, el motor baja y sube solo; cuando llega algo de otro dispositivo se avisa (onRemote) para que la
//    pantalla se actualice y, si hubo conflictos o espacios que llegaron o se quitaron, se le diga a la persona.
//  · Borrar «de este dispositivo» apaga la sincronización aquí (la nube conserva todo). Borrar «de todos mis
//    dispositivos» marca como borrados en la nube todos los espacios de la cuenta, y solo si hay conexión.
// =============================================================================

import { CLOUD_KINDS } from '../data/cloudRows.js';
import { createOutbox } from './outbox.js';
import { createCursorStore, pullAll } from './pull.js';
import { createSyncEngine } from './syncEngine.js';
import { withOutbox } from './trackedStore.js';

/** @typedef {import('../data/workspaceStore.js').WorkspaceStore} WorkspaceStore */
/** @typedef {ReturnType<typeof import('../data/cloudStore.js').createCloudStore>} CloudStore */
/** @typedef {import('./syncEngine.js').SyncStatus} SyncStatus */
/** @typedef {import('../domain/types.js').AppData} AppData */

/** @typedef {{ enabled: boolean, firstUploadAt: string | null, asked: boolean }} SyncSettings */

/**
 * Lo que ven las pantallas.
 * @typedef {Object} SyncApi
 * @property {() => { enabled: boolean, asked: boolean, status: SyncStatus }} state
 * @property {() => Promise<{ ok: true, records: number, workspaces: number, downloaded: number, conflicts: number, addedWorkspaces: string[], sharedAdded: string[] } | { ok: false, reason: 'failed' | 'mismatch', message: string }>} enable
 * @property {() => Promise<{ ok: true, workspaces: string[] } | { ok: false, message: string }>} inspectCloud  Nombres de los espacios vivos que la cuenta tiene en la nube.
 * @property {() => Promise<void>} syncNow
 * @property {() => void} markAsked
 * @property {() => void} disableOnThisDevice
 * @property {() => Promise<{ ok: true } | { ok: false, message: string }>} clearEverywhere
 * @property {() => void} forget  Al eliminar la cuenta: olvida todo lo de la sincronización en este dispositivo.
 * @property {(listener: () => void) => () => void} onChange
 * @property {(listener: (result: PullResult) => void) => () => void} onRemote  Llegó algo de la nube a este dispositivo.
 */
/** @typedef {import('./pull.js').PullResult} PullResult */

/** @param {string} userId */
export const syncSettingsKey = (userId) => `accontrol.sync.v1.${userId}`;

/** Cuántos registros REALES (sin demostración ni categorías de fábrica) de cada tipo hay en unos datos. @param {AppData} data */
export function realCounts(data) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const kind of CLOUD_KINDS) {
    counts[kind.key] = ((/** @type {any} */ (data))[kind.key] ?? []).filter((/** @type {any} */ r) => r.isDemo !== true && r.builtIn !== true).length;
  }
  return counts;
}

/**
 * @param {{
 *   cloud: CloudStore,
 *   local: WorkspaceStore,
 *   storage: Storage | null,
 *   userId: string,
 *   engineOptions?: Partial<Parameters<typeof createSyncEngine>[0]>,
 * }} options
 */
export function createSyncController(options) {
  const { cloud, local, storage, userId } = options;
  const key = syncSettingsKey(userId);
  const outbox = createOutbox({ storage, userId });
  const cursors = createCursorStore(storage, userId);
  /** @type {Set<(result: PullResult) => void>} */
  const remoteListeners = new Set();
  /** @param {PullResult} result */
  function remoteChanged(result) {
    for (const listener of [...remoteListeners]) {
      try {
        listener(result);
      } catch (error) {
        console.error('Error en un oyente de lo bajado de la nube:', error);
      }
    }
  }
  const engine = createSyncEngine({ cloud, local, outbox, cursors, onPulled: remoteChanged, ...(options.engineOptions ?? {}) });
  /** @type {Set<() => void>} */
  const listeners = new Set();
  let started = false;
  let busy = false;

  /** @returns {SyncSettings} */
  function read() {
    try {
      const raw = storage?.getItem(key);
      const data = raw ? JSON.parse(raw) : {};
      return { enabled: data.enabled === true, firstUploadAt: typeof data.firstUploadAt === 'string' ? data.firstUploadAt : null, asked: data.asked === true };
    } catch {
      return { enabled: false, firstUploadAt: null, asked: false };
    }
  }
  /** En memoria también, por si el navegador no deja guardar. */
  let settings = read();
  /** @param {Partial<SyncSettings>} patch */
  function save(patch) {
    settings = { ...settings, ...patch };
    try {
      storage?.setItem(key, JSON.stringify(settings));
    } catch {
      // ventana privada: vale mientras la página esté abierta
    }
    changed();
  }
  function changed() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Error en un oyente de la copia en la nube:', error);
      }
    }
  }
  engine.onStatus(changed);

  // Si la página se cerró a mitad de la primera subida, quedó «a medio activar»: se apaga limpio y se puede volver a
  // activar (subir es repetible).
  if (settings.enabled && settings.firstUploadAt === null) {
    outbox.clear();
    cursors.clear();
    save({ enabled: false });
  }

  // La bandeja solo anota mientras la sincronización está activa (también durante la primera subida, para no perder
  // lo que se cambie mientras sube).
  const store = withOutbox(local, outbox, () => settings.enabled);

  function startEngine() {
    if (started) return;
    started = true;
    engine.start();
  }
  function stopEngine() {
    if (!started) return;
    started = false;
    engine.stop();
  }

  /** Apaga y limpia lo pendiente (tras un fallo de la primera subida o al apagar en este dispositivo). */
  function turnOff() {
    stopEngine();
    outbox.clear();
    cursors.clear();
    save({ enabled: false, firstUploadAt: null });
  }

  /** @type {SyncApi} */
  const api = {
    // Lo pendiente se cuenta en vivo (la bandeja puede cambiar sin que el motor esté encendido).
    state: () => ({
      enabled: settings.enabled && settings.firstUploadAt !== null, asked: settings.asked,
      status: { ...engine.getStatus(), pending: outbox.pendingCount() },
    }),

    async enable() {
      if (busy) return { ok: false, reason: 'failed', message: 'Ya se está activando.' };
      busy = true;
      try {
        save({ enabled: true, firstUploadAt: null, asked: true });
        const fail = (/** @type {string} */ message, /** @type {'failed' | 'mismatch'} */ reason = 'failed') => {
          turnOff();
          return { ok: /** @type {const} */ (false), reason, message };
        };
        // 1. Juntar: bajar todo lo de la nube (si hay) y combinarlo con lo de aquí (gana el cambio más reciente).
        cursors.clear();
        const pulled = await pullAll({ cloud, local, outbox, cursors, merge: true });
        if (!pulled.ok) return fail(pulled.error.message);
        // (Quien activa actualiza la pantalla y avisa con el resultado: aquí no se llama a onRemote para no avisar dos veces.)
        // 2. Subir todo lo de aquí (ya junto) y comprobar.
        const snapshot = await local.loadEverything();
        const here = new Set(snapshot.workspaces.map((w) => w.workspace.id));
        // Solo se suben los espacios TUYOS; en los compartidos contigo, los datos solo si puedes escribir (no Contador).
        const saved = await cloud.saveWorkspaces(snapshot.workspaces.filter((w) => !w.workspace.role).map((w) => w.workspace));
        if (!saved.ok) return fail(saved.error.message);
        const writable = snapshot.workspaces.filter((w) => w.workspace.role !== 'accountant');
        let records = 0;
        for (const { workspace, data } of writable) {
          const pushed = await cloud.push(workspace.id, /** @type {any} */ (data));
          if (!pushed.ok) return fail(pushed.error.message);
          records += pushed.sent;
        }
        const def = snapshot.workspaces.find((w) => w.workspace.isDefault);
        if (def) {
          const d = await cloud.setDefaultWorkspace(def.workspace.id);
          if (!d.ok) return fail(d.error.message);
        }
        const lastWorkspaceId = snapshot.profile.lastWorkspaceId && here.has(snapshot.profile.lastWorkspaceId) ? snapshot.profile.lastWorkspaceId : null;
        const p = await cloud.saveProfile({ displayName: snapshot.profile.displayName, lastWorkspaceId });
        if (!p.ok) return fail(p.error.message);
        // Comprobación: la nube debe tener exactamente lo mismo que el dispositivo (sin DEMO).
        for (const { workspace, data } of writable) {
          const counted = await cloud.countLive(workspace.id);
          if (!counted.ok) return fail(counted.error.message);
          const expected = realCounts(data);
          const wrong = CLOUD_KINDS.filter((k) => counted.counts[k.key] !== expected[k.key]);
          if (wrong.length > 0) {
            return fail(`La comprobación no cuadró en «${workspace.name}» (${wrong.map((k) => k.key).join(', ')}). No activé la copia en la nube; tus datos siguen intactos en este dispositivo. Inténtalo de nuevo.`, 'mismatch');
          }
        }
        save({ firstUploadAt: new Date().toISOString() });
        startEngine();
        return {
          ok: true, records, workspaces: snapshot.workspaces.length,
          downloaded: pulled.applied, conflicts: pulled.conflicts, addedWorkspaces: pulled.addedWorkspaces, sharedAdded: pulled.sharedAdded ?? [],
        };
      } catch (error) {
        console.error('Error en la primera subida:', error);
        turnOff();
        return { ok: false, reason: 'failed', message: 'No se pudieron leer tus datos del dispositivo para subirlos. No se activó la copia en la nube.' };
      } finally {
        busy = false;
      }
    },

    async inspectCloud() {
      const remote = await cloud.listWorkspaces();
      if (!remote.ok) return { ok: false, message: remote.error.message };
      return { ok: true, workspaces: remote.workspaces.filter((w) => w.deletedAt === null).map((w) => w.workspace.name) };
    },

    async syncNow() {
      if (api.state().enabled) await engine.flush();
    },

    markAsked() {
      if (!settings.asked) save({ asked: true });
    },

    disableOnThisDevice() {
      turnOff();
    },

    async clearEverywhere() {
      const remote = await cloud.listWorkspaces();
      if (!remote.ok) return { ok: false, message: `${remote.error.message} No se borró nada.` };
      // Solo los TUYOS: los compartidos contigo son de otra persona (para dejarlos está «Salir del espacio»).
      const ids = remote.workspaces.filter((w) => w.deletedAt === null && !w.workspace.role).map((w) => w.workspace.id);
      if (ids.length > 0) {
        const done = await cloud.markWorkspacesDeleted(ids);
        if (!done.ok) return { ok: false, message: `${done.error.message} No se borró nada en este dispositivo.` };
      }
      outbox.clear();
      return { ok: true };
    },

    forget() {
      stopEngine();
      outbox.clear();
      cursors.clear();
      try {
        storage?.removeItem(key);
      } catch {
        // nada que hacer
      }
      settings = { enabled: false, firstUploadAt: null, asked: false };
      changed();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onRemote(listener) {
      remoteListeners.add(listener);
      return () => remoteListeners.delete(listener);
    },
  };

  return {
    /** El almacén que debe usar la app (guarda igual que siempre y anota cuando la copia está activa). */
    store,
    api,
    /** Al arrancar: si la copia ya estaba activa, empieza a enviar lo pendiente. */
    start() {
      if (api.state().enabled) startEngine();
    },
  };
}
