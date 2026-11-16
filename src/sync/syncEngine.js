// @ts-check
// =============================================================================
// MOTOR DE ENVÍO (0.15.0, paso 4)
// -----------------------------------------------------------------------------
// Vacía la bandeja de pendientes enviando a la nube lo anotado. Lee del DISPOSITIVO en el momento de enviar:
//   · un registro anotado que ya no existe aquí no se sube;
//   · un borrado anotado solo se envía si el registro de verdad ya no está aquí;
//   · un espacio anotado como borrado solo se marca en la nube si ya no existe aquí.
// Así, aunque una anotación quede de más (por ejemplo, si un guardado local falló), nunca se borra en la nube algo
// que sigue en el dispositivo.
//
// Orden de cada envío: espacios (todos los del dispositivo, para que los registros y el perfil tengan a qué apuntar)
// → datos de cada espacio → espacios borrados → predeterminado → perfil. Cada grupo que termina bien se quita de la
// bandeja; si uno falla, lo demás que ya se envió queda enviado y el resto espera al siguiente intento.
// Reintentos: sin red o con la nube caída, 5 s, 30 s, 2 min y luego cada 5 min; al volver la conexión, enseguida.
//
// Paso 6: con `cursors`, cada vuelta PRIMERO BAJA lo nuevo de la nube (pull.js decide los conflictos: gana el cambio
// más reciente) y DESPUÉS sube lo de aquí. Así nunca se sube una versión vieja encima de una más nueva de otro
// dispositivo. Además se revisa la nube al arrancar, al volver la conexión y cada `pollMs`.
// =============================================================================

import { atLeast, MODULE_OF_KIND } from '../domain/permissions.js';
import { permissionsOf } from '../domain/roles.js';
import { CLOUD_KINDS, cloudKind } from '../data/cloudRows.js';
import { pullAll } from './pull.js';

/** @typedef {import('../data/workspaceStore.js').WorkspaceStore} WorkspaceStore */
/** @typedef {ReturnType<typeof import('../data/cloudStore.js').createCloudStore>} CloudStore */
/** @typedef {ReturnType<typeof import('./outbox.js').createOutbox>} Outbox */
/** @typedef {import('./outbox.js').OutboxEntry} OutboxEntry */
/** @typedef {import('../data/cloudStore.js').CloudError} CloudError */

/**
 * @typedef {Object} SyncStatus
 * @property {number} pending          Anotaciones sin enviar.
 * @property {boolean} running         Enviando ahora.
 * @property {CloudError | null} lastError
 * @property {string | null} lastSuccessAt  Fecha-hora ISO del último envío completo.
 * @property {number | null} nextRetryAt    Cuándo se reintenta (ms), si hubo error.
 */

export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 300_000];
/** Si la nube rechazó un dato (o no da permiso), insistir enseguida no sirve: se reintenta cada 10 minutos. */
export const REJECTED_RETRY_MS = 600_000;

/**
 * @param {{
 *   cloud: CloudStore,
 *   local: WorkspaceStore,
 *   outbox: Outbox,
 *   now?: () => number,
 *   setTimer?: (cb: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 *   locks?: { request: (name: string, cb: () => Promise<any>) => Promise<any> } | null,
 *   lockName?: string,
 *   cursors?: ReturnType<typeof import('./pull.js').createCursorStore> | null,
 *   onPulled?: (result: import('./pull.js').PullResult) => void,
 * }} options
 */
export function createSyncEngine(options) {
  const { cloud, local, outbox } = options;
  const nowMs = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
  const locks = options.locks === undefined ? (globalThis.navigator?.locks ?? null) : options.locks;
  const lockName = options.lockName ?? 'accontrol-sync';

  /** @type {SyncStatus} */
  let status = { pending: outbox.pendingCount(), running: false, lastError: null, lastSuccessAt: null, nextRetryAt: null };
  /** @type {Set<(s: SyncStatus) => void>} */
  const listeners = new Set();
  /** @type {any} */
  let timer = null;
  let failures = 0;
  /** @type {Promise<any> | null} */
  let running = null;
  let again = false;

  /** @param {Partial<SyncStatus>} patch */
  function update(patch) {
    status = { ...status, ...patch, pending: outbox.pendingCount() };
    for (const listener of [...listeners]) {
      try {
        listener(status);
      } catch (error) {
        console.error('Error en un oyente de la sincronización:', error);
      }
    }
  }

  /** @param {number} ms */
  function schedule(ms) {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, ms);
    timer?.unref?.();
  }

  /** Un envío completo de lo pendiente. @returns {Promise<{ ok: true, sent: number } | { ok: false, error: CloudError }>} */
  async function sendAll() {
    const entries = outbox.snapshot();
    if (entries.length === 0) return { ok: true, sent: 0 };
    let sent = 0;
    const workspaces = await local.listWorkspaces();
    const here = new Set(workspaces.map((w) => w.id));

    // 1. Espacios. Los que cambiaron aquí se guardan (y reviven si estaban marcados como borrados). Los demás solo se
    //    CREAN si faltan en la nube, sin tocar los existentes: antes se guardaban todos con cada cambio y eso revivía,
    //    con una versión más vieja, un espacio que otro dispositivo borró entre la bajada y la subida de esta vuelta.
    //    Solo los TUYOS (sin rol): uno compartido contigo ya existe en la nube y solo su dueño puede cambiarlo; intentarlo
    //    haría que la nube rechace todo el envío una y otra vez (0.16.0).
    const wsEntries = entries.filter((e) => e.type === 'ws');
    const changedWs = new Set(wsEntries.map((e) => e.ws));
    const owned = workspaces.filter((w) => !w.role);
    const toSave = owned.filter((w) => changedWs.has(w.id));
    const toEnsure = owned.filter((w) => !changedWs.has(w.id));
    /** Permisos en cada espacio (0.16.1): Contador = «Ver» en todo; rol a medida = los suyos. */
    const permsOf = new Map(workspaces.map((w) => [w.id, permissionsOf(w)]));
    /** Tu cuenta: para saber qué registros creaste tú (un rol con «Registrar» solo cambia lo suyo). */
    const me = typeof cloud.me === 'function' ? cloud.me() : null;
    if (toSave.length > 0) {
      const saved = await cloud.saveWorkspaces(toSave);
      if (!saved.ok) return saved;
    }
    if (toEnsure.length > 0) {
      const ensured = await cloud.ensureWorkspaces(toEnsure);
      if (!ensured.ok) return ensured;
    }
    outbox.settle(wsEntries);

    // 2. Datos de cada espacio.
    /** @type {Map<string, OutboxEntry[]>} */
    const byWs = new Map();
    for (const e of entries) if (e.type === 'put' || e.type === 'del') byWs.set(e.ws, [...(byWs.get(e.ws) ?? []), e]);
    for (let [ws, group] of byWs) {
      if (!here.has(ws)) {
        outbox.settle(group); // el espacio ya no existe aquí: lo cubre el borrado del espacio
        continue;
      }
      const data = /** @type {any} */ (await local.forWorkspace(ws).load());
      // Lo que tu rol no permite (0.16.1) no se sube: la nube lo rechazaría y atascaría todo el envío. Se descarta y se
      // baja todo otra vez, para que aquí quede igual que la nube. (Contador: todo; rol a medida: los módulos donde no
      // puedes registrar y, con «Registrar», lo que no creaste tú.)
      const perms = permsOf.get(ws);
      /** @param {OutboxEntry} e */
      const allowed = (e) => {
        if (!perms) return true;
        const level = perms[/** @type {import('../domain/permissions.js').ModuleId} */ (MODULE_OF_KIND[e.kind])] ?? 'none';
        if (!atLeast(level, 'create')) return false;
        if (level === 'edit' || e.type !== 'put') return true;
        const record = (data[e.kind] ?? []).find((/** @type {any} */ r) => String(r.id) === e.id);
        return !record || !('createdBy' in record) || record.createdBy === me;
      };
      const refused = group.filter((e) => !allowed(e));
      if (refused.length > 0) {
        outbox.settle(refused);
        options.cursors?.remove(ws);
        group = group.filter((e) => allowed(e));
        if (group.length === 0) continue;
      }
      /** @type {Record<string, any[]>} */
      const changes = {};
      /** @type {Record<string, string[]>} */
      const deletions = {};
      for (const kind of CLOUD_KINDS) {
        const byId = new Map((data[kind.key] ?? []).map((/** @type {any} */ r) => [String(r.id), r]));
        const puts = group.filter((e) => e.type === 'put' && e.kind === kind.key).map((e) => byId.get(e.id)).filter(Boolean);
        const dels = group.filter((e) => e.type === 'del' && e.kind === kind.key && !byId.has(e.id)).map((e) => e.id);
        if (puts.length) changes[kind.key] = puts;
        if (dels.length) deletions[cloudKind(kind.key).idsKey] = [...new Set(dels)];
      }
      const pushed = await cloud.push(ws, changes, deletions);
      if (!pushed.ok) return pushed;
      sent += pushed.sent + pushed.deleted;
      outbox.settle(group);
    }

    // 3. Espacios borrados (solo si de verdad ya no están en el dispositivo).
    const gone = entries.filter((e) => e.type === 'wsdel');
    const toDelete = [...new Set(gone.filter((e) => !here.has(e.ws)).map((e) => e.ws))];
    if (toDelete.length > 0) {
      const marked = await cloud.markWorkspacesDeleted(toDelete);
      if (!marked.ok) return marked;
    }
    outbox.settle(gone);

    // 4. Predeterminado.
    const def = entries.filter((e) => e.type === 'default');
    const chosen = def.at(-1);
    if (chosen && here.has(chosen.ws)) {
      const done = await cloud.setDefaultWorkspace(chosen.ws);
      if (!done.ok) return done;
    }
    outbox.settle(def);

    // 5. Perfil.
    const prof = entries.filter((e) => e.type === 'profile');
    if (prof.length > 0) {
      const profile = await local.getProfile();
      const lastWorkspaceId = profile.lastWorkspaceId && here.has(profile.lastWorkspaceId) ? profile.lastWorkspaceId : null;
      const done = await cloud.saveProfile({ displayName: profile.displayName, lastWorkspaceId });
      if (!done.ok) return done;
      outbox.settle(prof);
    }
    return { ok: true, sent };
  }

  /**
   * Baja lo nuevo y envía lo pendiente ahora. Si ya hay una vuelta en marcha, esa empezó ANTES de esta petición: se
   * espera a que termine y se hace otra, así quien pide «sincronizar ahora» (o acaba de unirse a un espacio) recibe una
   * bajada hecha DESPUÉS de pedirla. (Antes se devolvía la vuelta en marcha y, si no quedaba nada por enviar, la
   * petición se perdía: contra la nube real, un espacio recién compartido no llegaba hasta la siguiente revisión.)
   */
  async function flush() {
    if (running) {
      await running.catch(() => undefined);
      // Mientras se esperaba, otra petición pudo empezar ya una vuelta nueva (posterior a esta petición): vale esa.
      if (running) return running;
    }
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    update({ running: true });
    const work = async () => {
      try {
        if (options.cursors) {
          const pulled = await pullAll({ cloud, local, outbox, cursors: options.cursors });
          if (!pulled.ok) return pulled;
          const sharing = (pulled.sharedAdded?.length ?? 0) + (pulled.lostAccess?.length ?? 0) + (pulled.roleChanges?.length ?? 0);
          if (pulled.applied + pulled.conflicts + pulled.addedWorkspaces.length + pulled.removedWorkspaces.length + sharing > 0) {
            try {
              options.onPulled?.(pulled);
            } catch (error) {
              console.error('Error al avisar de lo bajado de la nube:', error);
            }
          }
        }
        return await sendAll();
      } catch (error) {
        console.error('Error al leer o guardar en el dispositivo para sincronizar:', error);
        return { ok: false, error: { code: 'rejected', status: 0, message: 'No se pudieron leer o guardar tus datos en el dispositivo para sincronizarlos.' } };
      }
    };
    running = (locks ? locks.request(lockName, work) : work()).then((/** @type {any} */ result) => {
      running = null;
      if (result.ok) {
        failures = 0;
        update({ running: false, lastError: null, lastSuccessAt: new Date(nowMs()).toISOString(), nextRetryAt: null });
        if (again || outbox.pendingCount() > 0) {
          again = false;
          if (outbox.pendingCount() > 0) schedule(0);
        }
      } else {
        again = false;
        const code = result.error.code;
        // Sin sesión no se insiste solo: se reintenta cuando haya un cambio nuevo o al volver a entrar.
        const wait = code === 'session' ? null
          : code === 'rejected' || code === 'forbidden' ? REJECTED_RETRY_MS
            : RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
        failures += 1;
        if (wait !== null) schedule(wait);
        update({ running: false, lastError: result.error, nextRetryAt: wait === null ? null : nowMs() + wait });
      }
      return result;
    });
    return running;
  }

  /** @type {Array<() => void>} */
  let unsubscribe = [];

  return {
    flush,
    /** El estado actual (para mostrarlo en Ajustes). */
    getStatus: () => status,
    /** @param {(s: SyncStatus) => void} listener @returns {() => void} */
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Empieza a enviar solo: poco después de cada cambio, al volver la conexión y al arrancar si quedó algo.
     * Con cursores (paso 6), además baja lo nuevo al arrancar y cada `pollMs` (por omisión, 3 minutos).
     * @param {{ debounceMs?: number, pollMs?: number, onlineTarget?: { addEventListener: Function, removeEventListener: Function } | null }} [opts]
     */
    start(opts = {}) {
      const debounceMs = opts.debounceMs ?? 1_500;
      if (options.cursors) {
        const pollMs = opts.pollMs ?? 180_000;
        /** @type {any} */
        let poll = null;
        let stopped = false;
        const tick = () => {
          poll = setTimer(() => {
            poll = null;
            if (stopped) return;
            // Solo si no hay ya un intento programado (un reintento tras un error manda sobre la revisión periódica).
            if (timer === null) void flush();
            tick();
          }, pollMs);
          poll?.unref?.();
        };
        tick();
        unsubscribe.push(() => {
          stopped = true;
          if (poll !== null) clearTimer(poll);
        });
      }
      const online = () => {
        failures = 0;
        schedule(0);
      };
      unsubscribe.push(outbox.onChange(() => {
        update({});
        if (!status.running) schedule(debounceMs);
        else again = true;
      }));
      const target = opts.onlineTarget === undefined ? (typeof window === 'undefined' ? null : window) : opts.onlineTarget;
      if (target) {
        target.addEventListener('online', online);
        unsubscribe.push(() => target.removeEventListener('online', online));
      }
      if (options.cursors || outbox.pendingCount() > 0) schedule(0);
    },
    stop() {
      for (const fn of unsubscribe) fn();
      unsubscribe = [];
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
