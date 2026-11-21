// @ts-check
// =============================================================================
// COPIA DE SEGURIDAD AUTOMÁTICA DIARIA (0.18.2)
// -----------------------------------------------------------------------------
// · Cada día, a la hora que elijas, la app hace la COPIA COMPLETA (la misma de «Exportar copia completa»; se importa igual).
// · Ni el navegador ni la app pueden despertarse solos a una hora exacta: si a esa hora la app está cerrada, la copia se
//   hace al abrirla después. Mientras está abierta se revisa cada minuto y al volver a la app.
// · Dónde: en la app de Android, Documentos/ACCONTROL del teléfono (se ve con el gestor de archivos); en el navegador, en
//   su propia memoria (IndexedDB), con un botón para descargar cada copia. Se guardan las últimas 7; las más viejas se borran.
// · Cada cuenta tiene sus copias: el nombre del archivo lleva una marca corta de la cuenta (no su correo) y la app solo
//   lista, lee y borra las suyas. Las preferencias también son por cuenta.
// · Sin espacios todavía (dispositivo nuevo) no se hace ninguna copia: no habría nada que guardar.
// =============================================================================

export const KEEP_COPIES = 7;
export const DEFAULT_TIME = '21:00';
/** Tras un fallo (por ejemplo, sin permiso), se espera esto antes de reintentar solo (no cada minuto). */
export const RETRY_AFTER_MS = 30 * 60_000;
const PREFS_KEY = 'accontrol.autobackup.v1';
const NATIVE_FOLDER = 'ACCONTROL';
const IDB_NAME = 'accontrol-autobackup';
const IDB_STORE = 'copies';

/** @typedef {{ enabled: boolean, time: string, lastRunISO: string | null, lastError: string | null, lastAttemptISO: string | null }} AutoBackupPrefs */
/** @typedef {{ list(): Promise<string[]>, read(name: string): Promise<string>, save(name: string, json: string): Promise<void>, remove(name: string): Promise<void>, where: string }} BackupTarget */

// ---------------------------------------------------------------------------
// Reglas (sin pantalla ni almacenamiento: se prueban solas)
// ---------------------------------------------------------------------------

/** «HH:MM» válida (00:00 a 23:59), o null. @param {unknown} text @returns {{ h: number, m: number } | null} */
export function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}

/**
 * El último momento programado que ya pasó: hoy a esa hora si ya llegó; si no, ayer a esa hora (hora del teléfono).
 * @param {Date} now @param {string} time
 */
export function lastScheduledMoment(now, time) {
  const t = parseTime(time) ?? /** @type {{ h: number, m: number }} */ (parseTime(DEFAULT_TIME));
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m, 0, 0);
  if (at.getTime() > now.getTime()) at.setDate(at.getDate() - 1);
  return at;
}

/**
 * ¿Toca hacer la copia? Sí si nunca se hizo o si la última es anterior al último momento programado.
 * @param {{ now: Date, time: string, lastRunISO: string | null }} input
 */
export function isDue({ now, time, lastRunISO }) {
  if (!lastRunISO) return true;
  const last = Date.parse(lastRunISO);
  if (Number.isNaN(last)) return true;
  return last < lastScheduledMoment(now, time).getTime();
}

/**
 * ¿Se espera antes de reintentar? Solo si la última vez falló y fue hace menos de RETRY_AFTER_MS.
 * @param {{ now: Date, lastError: string | null, lastAttemptISO: string | null }} input
 */
export function isBackingOff({ now, lastError, lastAttemptISO }) {
  if (!lastError || !lastAttemptISO) return false;
  const at = Date.parse(lastAttemptISO);
  return !Number.isNaN(at) && now.getTime() - at < RETRY_AFTER_MS;
}

/** Marca corta de la cuenta (no se puede volver al correo ni al id). @param {string} owner */
export function ownerTag(owner) {
  let hash = 0x811c9dc5;
  for (const ch of owner) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0');

/** Nombre del archivo: accontrol-auto-<marca>-AAAA-MM-DD-HHMM.json (hora del teléfono). @param {string} tag @param {Date} when */
export function autoFileName(tag, when) {
  return `accontrol-auto-${tag}-${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}-${two(when.getHours())}${two(when.getMinutes())}.json`;
}

/** Las copias de ESTA cuenta, de la más nueva a la más vieja. @param {string[]} names @param {string} tag */
export function copiesOf(names, tag) {
  const prefix = `accontrol-auto-${tag}-`;
  return names.filter((n) => n.startsWith(prefix) && n.endsWith('.json')).sort().reverse();
}

/** Las que sobran (más allá de las `keep` más nuevas). @param {string[]} names @param {string} tag @param {number} [keep] */
export function copiesToPrune(names, tag, keep = KEEP_COPIES) {
  return copiesOf(names, tag).slice(keep);
}

/** Fecha y hora legibles a partir del nombre del archivo («20 nov 2026 · 21:00»), o el nombre si no se entiende. @param {string} name */
export function copyLabel(name) {
  const match = /-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.json$/.exec(name);
  if (!match) return name;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]} ${match[1]} · ${match[4]}:${match[5]}`;
}

/**
 * Preferencias guardadas (por cuenta), con valores seguros si faltan o están dañadas.
 * @param {string | null} raw @returns {AutoBackupPrefs}
 */
export function parsePrefs(raw) {
  /** @type {AutoBackupPrefs} */
  const fallback = { enabled: false, time: DEFAULT_TIME, lastRunISO: null, lastError: null, lastAttemptISO: null };
  if (!raw) return fallback;
  try {
    const p = JSON.parse(raw);
    return {
      enabled: p?.enabled === true,
      time: parseTime(p?.time) ? String(p.time) : DEFAULT_TIME,
      lastRunISO: typeof p?.lastRunISO === 'string' ? p.lastRunISO : null,
      lastError: typeof p?.lastError === 'string' ? p.lastError : null,
      lastAttemptISO: typeof p?.lastAttemptISO === 'string' ? p.lastAttemptISO : null,
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Dónde se guardan
// ---------------------------------------------------------------------------

/**
 * App de Android: Documentos/ACCONTROL (complemento oficial Filesystem).
 * @param {{ nativePromise: (p: string, m: string, o?: object) => Promise<any> }} cap
 * @returns {BackupTarget}
 */
export function nativeTarget(cap) {
  const at = (/** @type {string} */ name) => ({ path: `${NATIVE_FOLDER}/${name}`, directory: 'DOCUMENTS' });
  return {
    where: 'Documentos/ACCONTROL de este teléfono',
    async list() {
      try {
        const result = await cap.nativePromise('Filesystem', 'readdir', { path: NATIVE_FOLDER, directory: 'DOCUMENTS' });
        return (result?.files ?? []).map((/** @type {any} */ f) => (typeof f === 'string' ? f : String(f?.name ?? ''))).filter(Boolean);
      } catch {
        return []; // la carpeta todavía no existe
      }
    },
    async read(name) {
      const result = await cap.nativePromise('Filesystem', 'readFile', { ...at(name), encoding: 'utf8' });
      return String(result?.data ?? '');
    },
    async save(name, json) {
      await cap.nativePromise('Filesystem', 'writeFile', { ...at(name), data: json, encoding: 'utf8', recursive: true });
    },
    async remove(name) {
      await cap.nativePromise('Filesystem', 'deleteFile', at(name));
    },
  };
}

/** Navegador: una base IndexedDB aparte, solo para las copias automáticas. @returns {BackupTarget} */
export function browserTarget() {
  /** @returns {Promise<IDBDatabase>} */
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE, { keyPath: 'name' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  /** @template T @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest<T>} work @returns {Promise<T>} */
  const run = async (mode, work) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const request = work(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    where: 'la memoria de este navegador',
    async list() {
      return (await run('readonly', (s) => s.getAllKeys())).map(String);
    },
    async read(name) {
      const row = /** @type {{ json?: string } | undefined} */ (await run('readonly', (s) => s.get(name)));
      if (!row?.json) throw new Error('Esa copia ya no está.');
      return row.json;
    },
    async save(name, json) {
      await run('readwrite', (s) => s.put({ name, json }));
    },
    async remove(name) {
      await run('readwrite', (s) => s.delete(name));
    },
  };
}

// ---------------------------------------------------------------------------
// El programador
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   store: { getState(): { workspaces: unknown[] }, exportFullBackup(): Promise<{ ok: true, json: string } | { ok: false, errors: { form?: string } }> },
 *   owner: string,
 *   target: BackupTarget,
 *   storage: { getItem(k: string): string | null, setItem(k: string, v: string): void } | null,
 *   now?: () => Date,
 * }} options
 */
export function createAutoBackup({ store, owner, target, storage, now = () => new Date() }) {
  const tag = ownerTag(owner);
  const key = `${PREFS_KEY}:${tag}`;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  let running = false;

  const read = () => {
    try {
      return parsePrefs(storage?.getItem(key) ?? null);
    } catch {
      return parsePrefs(null);
    }
  };
  /** @param {Partial<AutoBackupPrefs>} patch */
  const write = (patch) => {
    const next = { ...read(), ...patch };
    try {
      storage?.setItem(key, JSON.stringify(next));
    } catch {
      // Sin permiso para guardar preferencias: vale mientras la página esté abierta… y no más. Se avisa en la pantalla.
    }
    for (const fn of listeners) fn();
    return next;
  };

  /** Hace la copia ya. @returns {Promise<{ ok: true, name: string } | { ok: false, error: string }>} */
  async function runNow() {
    if (running) return { ok: false, error: 'Ya se está haciendo una copia.' };
    if (store.getState().workspaces.length === 0) return { ok: false, error: 'Todavía no hay espacios que copiar.' };
    running = true;
    write({ lastAttemptISO: now().toISOString() });
    try {
      const backup = await store.exportFullBackup();
      if (!backup.ok) throw new Error(backup.errors.form ?? 'No se pudo preparar la copia.');
      const name = autoFileName(tag, now());
      await target.save(name, backup.json);
      for (const old of copiesToPrune(await target.list(), tag)) await target.remove(old).catch(() => undefined);
      write({ lastRunISO: now().toISOString(), lastError: null });
      return { ok: true, name };
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'No se pudo guardar la copia.';
      console.error('Copia automática:', error);
      write({ lastError: message });
      return { ok: false, error: message };
    } finally {
      running = false;
    }
  }

  /** Si está activada y toca, la hace. */
  async function check() {
    const prefs = read();
    if (!prefs.enabled || !isDue({ now: now(), time: prefs.time, lastRunISO: prefs.lastRunISO })) return null;
    if (isBackingOff({ now: now(), lastError: prefs.lastError, lastAttemptISO: prefs.lastAttemptISO })) return null;
    return runNow();
  }

  return {
    where: target.where,
    prefs: read,
    /** @param {boolean} enabled */
    setEnabled(enabled) {
      write({ enabled });
      if (enabled) void check();
    },
    /** @param {string} time @returns {boolean} false si la hora no es válida */
    setTime(time) {
      if (!parseTime(time)) return false;
      write({ time });
      return true;
    },
    runNow,
    check,
    async list() {
      return copiesOf(await target.list(), tag);
    },
    /** @param {string} name */
    async read(name) {
      if (!copiesOf([name], tag).length) throw new Error('Esa copia no es de esta cuenta.');
      return target.read(name);
    },
    /** Borra todas las copias automáticas de ESTA cuenta. */
    async clear() {
      for (const name of copiesOf(await target.list(), tag)) await target.remove(name);
      write({ lastRunISO: null, lastError: null, lastAttemptISO: null });
    },
    /** @param {() => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Revisa al abrir, cada minuto y al volver a la app. Devuelve cómo pararlo. */
    start() {
      void check();
      const timer = setInterval(() => void check(), 60_000);
      const onVisible = () => {
        if (document.visibilityState === 'visible') void check();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
  };
}

/** @typedef {ReturnType<typeof createAutoBackup>} AutoBackup */
