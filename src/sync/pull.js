// @ts-check
// =============================================================================
// BAJAR DE LA NUBE Y JUNTAR (0.15.0, paso 6)
// -----------------------------------------------------------------------------
// Trae a ESTE dispositivo lo que cambió en la nube (hecho en otros dispositivos) y lo junta con lo de aquí.
//
//  · Cursores: por cada espacio y tipo se recuerda hasta dónde se bajó (synced_at + id de la última fila). La próxima
//    vez solo se pide lo posterior. Se guardan en localStorage['accontrol.cursor.v1.<cuenta>.<espacio>'].
//  · Si un registro NO cambió aquí (no hay nada pendiente de enviar), se toma el de la nube tal cual: versión nueva,
//    o se borra si en la nube está marcado como borrado.
//  · CONFLICTO = el mismo registro cambió aquí (pendiente de enviar) y en la nube. GANA EL CAMBIO MÁS RECIENTE:
//      - fecha de la nube: updatedAt del registro (o deleted_at si se borró);
//      - fecha de aquí: updatedAt del registro (o, si se borró aquí, la hora en que se anotó el borrado).
//    Si gana la nube, se aplica y se quita lo pendiente de aquí; si gana lo de aquí, no se toca y se enviará después.
//    Cada conflicto se cuenta para avisar a la persona.
//  · «Juntar» (merge: true, al activar la copia en un dispositivo que ya tiene datos): todo lo de aquí cuenta como
//    cambio sin enviar, con la misma regla del más reciente. Los espacios de aquí se conservan siempre (se vuelven a
//    subir aunque en la nube estuvieran borrados) y los de la nube que no están aquí se agregan.
//  · Espacios: uno nuevo en la nube se crea aquí; uno borrado en la nube se borra aquí (salvo que aquí haya un cambio
//    más reciente sin enviar).
//  · Los datos de aquí y la bandeja se leen DESPUÉS de bajar y se escribe sin esperas en medio: un cambio que la
//    persona hizo mientras se bajaba ya está en la bandeja y cuenta como «cambió aquí».
// =============================================================================

import { CLOUD_KINDS } from '../data/cloudRows.js';

/** @typedef {import('../data/workspaceStore.js').WorkspaceStore} WorkspaceStore */
/** @typedef {import('../domain/types.js').Workspace} Workspace */
/** @typedef {ReturnType<typeof import('../data/cloudStore.js').createCloudStore>} CloudStore */
/** @typedef {ReturnType<typeof import('./outbox.js').createOutbox>} Outbox */
/** @typedef {import('./outbox.js').OutboxEntry} OutboxEntry */
/** @typedef {import('../data/cloudStore.js').CloudError} CloudError */
/** @typedef {Record<string, { syncedAt: string, id: string }>} Cursors */

/**
 * Lo que pasó al bajar.
 * @typedef {Object} PullResult
 * @property {true} ok
 * @property {number} applied            Registros que cambiaron en este dispositivo.
 * @property {number} conflicts          Registros que cambiaron en los dos lados (se quedó el más reciente).
 * @property {string[]} addedWorkspaces  Nombres de los espacios que llegaron de la nube.
 * @property {string[]} removedWorkspaces Nombres de los espacios que se quitaron porque se borraron en otro dispositivo.
 */

const CURSOR_VERSION = 'v1';

/** @param {string} userId */
export const cursorPrefix = (userId) => `accontrol.cursor.${CURSOR_VERSION}.${userId}.`;

/**
 * Dónde se recuerdan los cursores (con respaldo en memoria si el navegador no deja guardar).
 * @param {Storage | null} storage @param {string} userId
 */
export function createCursorStore(storage, userId) {
  const prefix = cursorPrefix(userId);
  /** @type {Map<string, string>} */
  const memory = new Map();
  return {
    /** @param {string} ws @returns {Cursors} */
    get(ws) {
      let raw = memory.get(ws) ?? null;
      try {
        raw = storage?.getItem(prefix + ws) ?? raw;
      } catch {
        // se usa lo de memoria
      }
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    },
    /** @param {string} ws @param {Cursors} cursors */
    set(ws, cursors) {
      const raw = JSON.stringify(cursors);
      memory.set(ws, raw);
      try {
        storage?.setItem(prefix + ws, raw);
      } catch {
        // vale mientras la página esté abierta; si se pierde, se baja todo otra vez (es repetible)
      }
    },
    /** @param {string} ws */
    remove(ws) {
      memory.delete(ws);
      try {
        storage?.removeItem(prefix + ws);
      } catch {
        // nada que hacer
      }
    },
    /** Olvida todos los cursores de esta cuenta (al apagar la copia o eliminar la cuenta). */
    clear() {
      memory.clear();
      try {
        if (!storage) return;
        const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k) => typeof k === 'string' && k.startsWith(prefix));
        for (const k of /** @type {string[]} */ (keys)) storage.removeItem(k);
      } catch {
        // nada que hacer
      }
    },
  };
}

/** Milisegundos de una fecha-hora ISO (null si no hay o no es válida). @param {unknown} iso */
const ms = (iso) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

/** Hora en que se anotó algo en la bandeja (el número de versión empieza con la hora en base 36). @param {string} seq */
export function entryTime(seq) {
  const head = String(seq).split('-')[0];
  if (!/^[0-9a-z]{1,12}$/.test(head)) return null;
  const t = parseInt(head, 36);
  // Una hora con sentido (del año 2000 en adelante); lo demás no es una versión escrita por la bandeja.
  return Number.isSafeInteger(t) && t >= 946_684_800_000 ? t : null;
}

/** ¿Dos registros del mismo tipo tienen lo mismo en todo lo que viaja a la nube? @param {import('../data/cloudRows.js').CloudKind} kind @param {any} a @param {any} b */
export function sameRecord(kind, a, b) {
  const pick = (/** @type {any} */ r) => JSON.stringify([
    ...kind.fields.map((f) => {
      const v = r?.[f];
      if (v === undefined || v === null || v === '') return null;
      if (kind.timestamps?.includes(f)) return ms(v);
      return v;
    }),
    r?.isDemo === true,
  ]);
  return pick(a) === pick(b);
}

/** @param {Workspace} a @param {Workspace} b */
const sameWorkspace = (a, b) =>
  a.name === b.name && a.kind === b.kind && a.currency === b.currency && a.openingBalanceCents === b.openingBalanceCents &&
  JSON.stringify(a.organization ?? null) === JSON.stringify(b.organization ?? null);

/**
 * Qué hacer con UN registro que llegó de la nube.
 * @param {{
 *   kind: import('../data/cloudRows.js').CloudKind,
 *   remote: { record: Record<string, any>, deletedAt: string | null },
 *   local: Record<string, any> | undefined,
 *   put?: OutboxEntry,
 *   del?: OutboxEntry,
 *   merge?: boolean,
 * }} input
 * @returns {{ action: 'put' | 'delete' | 'keep', conflict: boolean, settle: OutboxEntry[] }}
 */
export function decide({ kind, remote, local, put, del, merge = false }) {
  const pending = /** @type {OutboxEntry[]} */ ([put, del].filter(Boolean));
  // Un registro de demostración de aquí nunca se toca desde la nube (no debería compartir id, pero por si acaso).
  if (local?.isDemo === true) return { action: 'keep', conflict: false, settle: [] };
  const changedHere = merge ? local !== undefined : (put !== undefined && local !== undefined) || (del !== undefined && local === undefined);

  if (!changedHere) {
    if (remote.deletedAt !== null) return { action: local ? 'delete' : 'keep', conflict: false, settle: [] };
    if (local && sameRecord(kind, local, remote.record)) return { action: 'keep', conflict: false, settle: [] };
    return { action: 'put', conflict: false, settle: [] };
  }

  // Cambió aquí. Si en realidad quedó igual que en la nube, no hay conflicto ni nada que enviar.
  if (local && remote.deletedAt === null && sameRecord(kind, local, remote.record)) return { action: 'keep', conflict: false, settle: pending };
  if (!local && remote.deletedAt !== null) return { action: 'keep', conflict: false, settle: pending }; // borrado en los dos

  const remoteTime = remote.deletedAt !== null ? ms(remote.deletedAt) : ms(remote.record.updatedAt);
  const localTime = local
    ? (ms(local.updatedAt) ?? (put ? entryTime(put.seq) : null))
    : (del ? entryTime(del.seq) : null);
  // Sin fecha de un lado (por ejemplo, categorías, que no la tienen) se queda lo de aquí: no se pierde nada en este
  // dispositivo y la nube recibe esta versión.
  const cloudWins = remoteTime !== null && localTime !== null && remoteTime > localTime;
  if (!cloudWins) return { action: 'keep', conflict: true, settle: [] };
  return { action: remote.deletedAt !== null ? 'delete' : 'put', conflict: true, settle: pending };
}

/** @param {string} type @param {string} ws @param {string} kind @param {string} id */
const entryKey = (type, ws, kind, id) => `${type}|${ws}|${kind}|${id}`;

/**
 * Baja lo nuevo de la nube y lo junta con este dispositivo.
 * @param {{
 *   cloud: CloudStore,
 *   local: WorkspaceStore,
 *   outbox: Outbox,
 *   cursors: ReturnType<typeof createCursorStore>,
 *   merge?: boolean,
 * }} options
 * @returns {Promise<PullResult | { ok: false, error: CloudError }>}
 */
export async function pullAll({ cloud, local, outbox, cursors, merge = false }) {
  /** @type {PullResult} */
  const result = { ok: true, applied: 0, conflicts: 0, addedWorkspaces: [], removedWorkspaces: [] };
  const remote = await cloud.listWorkspaces();
  if (!remote.ok) return remote;

  // ------------------------------------------------------------ espacios
  const here = await local.listWorkspaces();
  const byId = new Map(here.map((w) => [w.id, w]));
  const hadNone = here.length === 0;
  const pendingWs = outbox.snapshot().filter((e) => e.type === 'ws');
  /** @type {string[]} */
  const toPull = [];
  for (const { workspace, deletedAt } of remote.workspaces) {
    const mine = byId.get(workspace.id);
    const changedHere = merge || pendingWs.some((e) => e.ws === workspace.id);
    if (deletedAt !== null) {
      if (!mine) continue;
      if (merge) {
        // Al juntar, lo de aquí se conserva y se vuelve a subir. Se marca con la hora de AHORA (y siempre después del
        // borrado): es una decisión tomada ahora, y la nube no deja revivir algo con una versión anterior a su borrado.
        const keptAt = new Date(Math.max(Date.now(), (ms(deletedAt) ?? 0) + 1)).toISOString();
        await local.updateWorkspace({ ...mine, updatedAt: keptAt });
        toPull.push(mine.id);
        continue;
      }
      const keepHere = changedHere && (ms(mine.updatedAt) ?? 0) > (ms(deletedAt) ?? Infinity);
      if (keepHere) {
        result.conflicts += 1;
        toPull.push(mine.id);
        continue;
      }
      await local.deleteWorkspace(mine.id);
      cursors.remove(mine.id);
      outbox.settle(outbox.snapshot().filter((e) => e.ws === mine.id));
      result.removedWorkspaces.push(mine.name);
      continue;
    }
    if (!mine) {
      await local.createWorkspace({ ...workspace, isDefault: hadNone ? workspace.isDefault : false });
      cursors.remove(workspace.id);
      result.addedWorkspaces.push(workspace.name);
      toPull.push(workspace.id);
      continue;
    }
    toPull.push(mine.id);
    if (sameWorkspace(mine, workspace)) continue;
    const cloudNewer = (ms(workspace.updatedAt) ?? 0) > (ms(mine.updatedAt) ?? 0);
    if (changedHere) result.conflicts += 1;
    if (cloudNewer) {
      // El predeterminado es de cada dispositivo: no se cambia desde la nube.
      await local.updateWorkspace({ ...workspace, isDefault: mine.isDefault });
      outbox.settle(pendingWs.filter((e) => e.ws === mine.id));
    }
  }

  // ------------------------------------------------------------ datos de cada espacio
  for (const ws of toPull) {
    const from = merge ? {} : cursors.get(ws);
    const pulled = await cloud.pull(ws, from);
    if (!pulled.ok) return pulled;
    const store = local.forWorkspace(ws);
    // Si la persona guardó algo mientras se leían los datos (la bandeja cambió), se vuelve a leer, para comparar
    // siempre contra lo último de aquí.
    const mark = () => outbox.snapshot().filter((e) => e.ws === ws);
    const sig = (/** @type {OutboxEntry[]} */ list) => list.map((e) => `${e.key}=${e.seq}`).sort().join(',');
    /** @type {any} */
    let data;
    let before = mark();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      data = await store.load();
      const after = mark();
      const same = sig(after) === sig(before);
      before = after;
      if (same) break;
    }
    const seqOf = new Map(before.map((e) => [entryKey(e.type, e.ws, e.kind, e.id), e]));

    /** @type {Record<string, any[]>} */
    const changes = {};
    /** @type {Record<string, string[]>} */
    const deletions = {};
    /** @type {OutboxEntry[]} */
    const settle = [];
    let touched = 0;
    for (const kind of CLOUD_KINDS) {
      const localById = new Map((data[kind.key] ?? []).map((/** @type {any} */ r) => [String(r.id), r]));
      // Si la misma fila llegó dos veces (cambió durante la bajada), vale la última.
      /** @type {Map<string, { record: Record<string, any>, deletedAt: string | null }>} */
      const latest = new Map();
      for (const row of pulled.changes[kind.key] ?? []) latest.set(String(row.record.id), row);
      for (const [id, row] of latest) {
        const d = decide({
          kind, remote: row, local: localById.get(id), merge,
          put: seqOf.get(entryKey('put', ws, kind.key, id)), del: seqOf.get(entryKey('del', ws, kind.key, id)),
        });
        if (d.conflict) result.conflicts += 1;
        settle.push(...d.settle);
        if (d.action === 'put') (changes[kind.key] ??= []).push(row.record);
        if (d.action === 'delete') (deletions[kind.idsKey] ??= []).push(id);
        if (d.action !== 'keep') touched += 1;
      }
    }

    // Desde que se leyeron los datos y la bandeja (arriba) hasta aquí no hay ninguna espera: un cambio hecho en esta
    // pestaña no puede colarse en medio. settle() además solo quita lo pendiente si no volvió a anotarse.
    if (touched > 0) await store.putMany(/** @type {any} */ (changes), /** @type {any} */ (deletions));
    result.applied += touched;
    outbox.settle(settle);
    cursors.set(ws, pulled.cursors);
  }
  return result;
}
