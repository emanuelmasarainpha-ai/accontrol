// @ts-check
// =============================================================================
// ALMACÉN DE LA NUBE (0.15.0, paso 3)
// -----------------------------------------------------------------------------
// Habla con la base de datos de Supabase (API REST) con la sesión de la persona. Las reglas de seguridad por fila
// (RLS) de la base deciden qué puede leer y escribir: aquí no hay ninguna llave secreta.
//
// Garantías:
//  · Los datos de DEMOSTRACIÓN nunca se suben (decisión de la 0.15.0): se descartan aquí, en el nivel más bajo.
//  · Se sube en ORDEN DE DEPENDENCIA (primero clientes, luego sus servicios, luego los movimientos que apuntan a
//    ellos…): cada petición es una transacción en la base y un registro no puede apuntar a otro que aún no existe.
//  · Subir es repetible: si se corta a la mitad, volver a enviar lo mismo no duplica nada (upsert por espacio + id).
//  · Borrar = marcar `deleted_at` (nadie tiene permiso de DELETE en la base); así los otros dispositivos se enteran.
//  · Bajar usa un cursor por tabla: la marca `synced_at` EXACTA del servidor (con microsegundos) y el id, para no
//    repetir ni saltarse filas aunque muchas tengan la misma hora.
//  · Nunca lanza por errores de red o del servidor: devuelve { ok: false, error } con un mensaje en español.
// =============================================================================

import { CLOUD_KINDS, cloudKind, fromRow, toRow, workspaceFromRow, workspaceToRow } from './cloudRows.js';

/** @typedef {import('../domain/types.js').Workspace} Workspace */
/** @typedef {import('./dataStore.js').Changes} Changes */
/** @typedef {import('./dataStore.js').Deletions} Deletions */

/** @typedef {{ code: CloudErrorCode, status: number, message: string, detail?: string }} CloudError */
/** @typedef {'network' | 'timeout' | 'session' | 'forbidden' | 'rejected' | 'server'} CloudErrorCode */
/** @typedef {{ ok: false, error: CloudError }} CloudFailure */

/** Cursor de una tabla: hasta dónde se bajó. */
/** @typedef {{ syncedAt: string, id: string }} Cursor */
/** @typedef {Record<string, Cursor>} Cursors */

/** Orden de subida: cada tipo va después de aquellos a los que apunta. */
export const PUSH_ORDER = [
  'categories', 'departments', 'clients', 'services', 'goals', 'debts', 'assets', 'products', 'suppliers',
  'movements', 'invoices', 'contributions', 'debtPayments', 'stockEntries', 'invoicePayments',
];

const MESSAGES = {
  network: 'No hay conexión con la nube. Tus datos siguen guardados en este dispositivo; se intentará de nuevo.',
  timeout: 'La nube tardó demasiado en responder. Se intentará de nuevo.',
  session: 'Tu sesión venció. Entra de nuevo para seguir sincronizando.',
  forbidden: 'La nube no permite guardar en este espacio con tu cuenta.',
  rejected: 'La nube rechazó un dato. Tus datos siguen guardados en este dispositivo.',
  server: 'La nube tuvo un problema. Se intentará de nuevo en unos minutos.',
};

/** @param {CloudErrorCode} code @param {number} status @param {string} [detail] @returns {CloudFailure} */
function fail(code, status, detail) {
  return { ok: false, error: { code, status, message: MESSAGES[code], ...(detail ? { detail } : {}) } };
}

/** Qué tipo de error es una respuesta de la API. @param {number} status @param {any} body @returns {CloudErrorCode} */
function classify(status, body) {
  if (status === 401 || body?.code === 'PGRST301' || body?.code === 'PGRST303') return 'session';
  if (status === 403 || body?.code === '42501') return 'forbidden';
  if (status >= 500) return 'server';
  if (status === 408) return 'timeout';
  return 'rejected';
}

/** Valor para un filtro de PostgREST que puede llevar «.», «:» o «,» (fechas-hora): entre comillas. @param {string} v */
const quoted = (v) => `"${v.replace(/"/g, '')}"`;

/**
 * @param {{
 *   url: string,
 *   publishableKey: string,
 *   getAccessToken: () => Promise<string | null>,
 *   getUserId: () => string | null,
 *   fetch?: typeof fetch,
 *   batchSize?: number,
 *   pageSize?: number,
 *   timeoutMs?: number,
 * }} options
 */
export function createCloudStore(options) {
  const base = options.url.replace(/\/+$/, '');
  const fetchFn = options.fetch ?? ((/** @type {any[]} */ ...args) => /** @type {any} */ (globalThis.fetch)(...args));
  const batchSize = options.batchSize ?? 500;
  const pageSize = options.pageSize ?? 1000;
  const timeoutMs = options.timeoutMs ?? 20_000;

  /**
   * @param {string} method
   * @param {string} path  /rest/v1/…
   * @param {{ query?: Record<string, string>, body?: unknown, prefer?: string }} [init]
   * @returns {Promise<{ ok: true, status: number, body: any } | CloudFailure>}
   */
  async function call(method, path, init = {}) {
    const token = await options.getAccessToken();
    if (!token) return fail('session', 401);
    const query = init.query ? `?${new URLSearchParams(init.query).toString()}` : '';
    /** @type {Record<string, string>} */
    const headers = { apikey: options.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.prefer) headers.Prefer = init.prefer;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchFn(`${base}${path}${query}`, {
        method, headers, credentials: 'omit', cache: 'no-store', signal: controller?.signal,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await response.text();
      /** @type {any} */
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!response.ok) return fail(classify(response.status, body), response.status, typeof body?.message === 'string' ? body.message.slice(0, 300) : undefined);
      return { ok: true, status: response.status, body };
    } catch (error) {
      return fail(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network', 0);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  /** Divide una lista en trozos. @template T @param {T[]} list @returns {T[][]} */
  const chunks = (list) => Array.from({ length: Math.ceil(list.length / batchSize) }, (_, i) => list.slice(i * batchSize, (i + 1) * batchSize));

  return {
    // ------------------------------------------------------------------ espacios
    /**
     * Los espacios de la persona en la nube (también los borrados, con su marca).
     * @returns {Promise<{ ok: true, workspaces: Array<{ workspace: Workspace, deletedAt: string | null }> } | CloudFailure>}
     */
    async listWorkspaces() {
      const userId = options.getUserId();
      if (!userId) return fail('session', 401);
      const [rows, mine] = await Promise.all([
        call('GET', '/rest/v1/workspaces', { query: { select: '*', order: 'created_at.asc,id.asc' } }),
        call('GET', '/rest/v1/workspace_members', { query: { select: 'workspace_id,is_default', user_id: `eq.${userId}` } }),
      ]);
      if (!rows.ok) return rows;
      if (!mine.ok) return mine;
      const defaults = new Set((mine.body ?? []).filter((m) => m.is_default).map((m) => m.workspace_id));
      try {
        return { ok: true, workspaces: (rows.body ?? []).map((/** @type {any} */ r) => workspaceFromRow(r, defaults.has(r.id))) };
      } catch (error) {
        return fail('rejected', 0, String(/** @type {Error} */ (error).message));
      }
    },

    /**
     * Crea o actualiza espacios (quien llama queda como dueño de los nuevos).
     * @param {Workspace[]} workspaces
     * @returns {Promise<{ ok: true } | CloudFailure>}
     */
    async saveWorkspaces(workspaces) {
      if (workspaces.length === 0) return { ok: true };
      const reply = await call('POST', '/rest/v1/workspaces', {
        query: { on_conflict: 'id' }, prefer: 'resolution=merge-duplicates,return=minimal',
        // deleted_at: null → si estaba marcado como borrado, vuelve a estar vivo (lo de este dispositivo es lo más reciente).
        body: workspaces.map((w) => ({ ...workspaceToRow(w), deleted_at: null })),
      });
      return reply.ok ? { ok: true } : reply;
    },

    /**
     * Marca espacios como borrados (`deleted_at`). Es una marca: la fila sigue en la nube, así los otros dispositivos
     * se enteran. El borrado definitivo es otra cosa (función delete_workspace_permanently, solo el dueño).
     * @param {string[]} ids
     * @param {string} [deletedAt]
     * @returns {Promise<{ ok: true } | CloudFailure>}
     */
    async markWorkspacesDeleted(ids, deletedAt = new Date().toISOString()) {
      for (const batch of chunks(ids)) {
        const reply = await call('PATCH', '/rest/v1/workspaces', {
          query: { id: `in.(${batch.map(quoted).join(',')})` }, prefer: 'return=minimal', body: { deleted_at: deletedAt, updated_at: deletedAt },
        });
        if (!reply.ok) return reply;
      }
      return { ok: true };
    },

    /** @param {string} workspaceId @returns {Promise<{ ok: true } | CloudFailure>} */
    async setDefaultWorkspace(workspaceId) {
      const reply = await call('POST', '/rest/v1/rpc/set_default_workspace', { body: { ws: workspaceId } });
      return reply.ok ? { ok: true } : reply;
    },

    /**
     * Nombre para el saludo y último espacio usado.
     * @param {{ displayName: string, lastWorkspaceId: string | null }} profile
     * @returns {Promise<{ ok: true } | CloudFailure>}
     */
    async saveProfile(profile) {
      const userId = options.getUserId();
      if (!userId) return fail('session', 401);
      const reply = await call('PATCH', '/rest/v1/profiles', {
        query: { user_id: `eq.${userId}` }, prefer: 'return=minimal',
        body: { display_name: profile.displayName, last_workspace_id: profile.lastWorkspaceId },
      });
      return reply.ok ? { ok: true } : reply;
    },

    // ------------------------------------------------------------------ datos de un espacio
    /**
     * Sube cambios y borrados de un espacio. Los datos de demostración no se suben.
     * Si falla a la mitad, lo ya enviado queda en la nube y volver a llamar con lo mismo es seguro.
     * @param {string} workspaceId
     * @param {Changes} changes
     * @param {Deletions} [deletions]
     * @param {string} [deletedAt] Fecha-hora ISO del borrado (por omisión, ahora).
     * @returns {Promise<{ ok: true, sent: number, skippedDemo: number, deleted: number } | CloudFailure>}
     */
    async push(workspaceId, changes, deletions = {}, deletedAt = new Date().toISOString()) {
      let sent = 0;
      let skippedDemo = 0;
      let deleted = 0;
      for (const key of PUSH_ORDER) {
        /** @type {Record<string, any>[]} */
        const records = /** @type {any} */ (changes)[key] ?? [];
        const real = records.filter((r) => r.isDemo !== true && !(key === 'categories' && r.builtIn));
        skippedDemo += records.filter((r) => r.isDemo === true).length;
        /** @type {Record<string, unknown>[]} */
        let rows;
        try {
          // deleted_at: null → subir un registro lo deja vivo (si se borró en otro dispositivo y este cambio es más
          // reciente, vuelve; la sincronización decide antes de subir cuál es el más reciente).
          rows = real.map((r) => ({ ...toRow(key, r, workspaceId), deleted_at: null }));
        } catch (error) {
          return fail('rejected', 0, String(/** @type {Error} */ (error).message));
        }
        for (const batch of chunks(rows)) {
          const reply = await call('POST', `/rest/v1/${cloudKind(key).table}`, {
            query: { on_conflict: 'workspace_id,id' }, prefer: 'resolution=merge-duplicates,return=minimal', body: batch,
          });
          if (!reply.ok) return reply;
          sent += batch.length;
        }
      }
      // Borrados: hijos primero (al revés del orden de subida). Es una marca; la fila sigue en la nube.
      for (const key of [...PUSH_ORDER].reverse()) {
        /** @type {string[]} */
        const ids = /** @type {any} */ (deletions)[cloudKind(key).idsKey] ?? [];
        for (const batch of chunks(ids)) {
          const reply = await call('PATCH', `/rest/v1/${cloudKind(key).table}`, {
            query: { workspace_id: `eq.${workspaceId}`, id: `in.(${batch.map(quoted).join(',')})` },
            prefer: 'return=minimal', body: { deleted_at: deletedAt, updated_at: deletedAt },
          });
          if (!reply.ok) return reply;
          deleted += batch.length;
        }
      }
      return { ok: true, sent, skippedDemo, deleted };
    },

    /**
     * Baja lo que cambió en un espacio desde los cursores dados (sin cursores: todo).
     * @param {string} workspaceId
     * @param {Cursors} [cursors]
     * @returns {Promise<{ ok: true, changes: Record<string, Array<{ record: Record<string, any>, deletedAt: string | null }>>, cursors: Cursors } | CloudFailure>}
     */
    async pull(workspaceId, cursors = {}) {
      /** @type {Record<string, Array<{ record: Record<string, any>, deletedAt: string | null }>>} */
      const changes = {};
      /** @type {Cursors} */
      const next = { ...cursors };
      for (const kind of CLOUD_KINDS) {
        changes[kind.key] = [];
        for (;;) {
          const cursor = next[kind.key];
          /** @type {Record<string, string>} */
          const query = { select: '*', workspace_id: `eq.${workspaceId}`, order: 'synced_at.asc,id.asc', limit: String(pageSize) };
          if (cursor) query.or = `(synced_at.gt.${quoted(cursor.syncedAt)},and(synced_at.eq.${quoted(cursor.syncedAt)},id.gt.${cursor.id}))`;
          const reply = await call('GET', `/rest/v1/${kind.table}`, { query });
          if (!reply.ok) return reply;
          /** @type {any[]} */
          const rows = Array.isArray(reply.body) ? reply.body : [];
          try {
            for (const row of rows) changes[kind.key].push(fromRow(kind.key, row));
          } catch (error) {
            return fail('rejected', 0, String(/** @type {Error} */ (error).message));
          }
          if (rows.length > 0) {
            const last = rows[rows.length - 1];
            next[kind.key] = { syncedAt: String(last.synced_at), id: String(last.id) };
          }
          if (rows.length < pageSize) break;
        }
      }
      return { ok: true, changes, cursors: next };
    },

    /**
     * Cuántos registros VIVOS (sin borrar) hay de cada tipo en la nube para un espacio. Sirve para comprobar la
     * primera subida: deben coincidir con los del dispositivo (sin contar los de demostración).
     * @param {string} workspaceId
     * @returns {Promise<{ ok: true, counts: Record<string, number> } | CloudFailure>}
     */
    async countLive(workspaceId) {
      /** @type {Record<string, number>} */
      const counts = {};
      for (const kind of CLOUD_KINDS) {
        counts[kind.key] = 0;
        let after = '';
        for (;;) {
          /** @type {Record<string, string>} */
          const query = { select: 'id', workspace_id: `eq.${workspaceId}`, deleted_at: 'is.null', order: 'id.asc', limit: String(pageSize) };
          if (after) query.id = `gt.${after}`;
          const reply = await call('GET', `/rest/v1/${kind.table}`, { query });
          if (!reply.ok) return reply;
          /** @type {any[]} */
          const rows = Array.isArray(reply.body) ? reply.body : [];
          counts[kind.key] += rows.length;
          if (rows.length < pageSize) break;
          after = String(rows[rows.length - 1].id);
        }
      }
      return { ok: true, counts };
    },
  };
}
