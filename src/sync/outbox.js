// @ts-check
// =============================================================================
// BANDEJA DE PENDIENTES (0.15.0, paso 4)
// -----------------------------------------------------------------------------
// Anota QUÉ cambió (no una copia de los datos) para enviarlo a la nube cuando se pueda:
//   · «put» de un registro: se creó o editó → al enviar se manda la versión que haya EN ESE MOMENTO en el dispositivo;
//   · «del» de un registro: se borró → al enviar se comprueba que de verdad ya no está en el dispositivo;
//   · un espacio creado o cambiado, un espacio borrado, el predeterminado y el perfil.
//
// Cada anotación es UNA entrada en localStorage (clave propia), así dos pestañas que guardan a la vez no se pisan.
// Cada entrada lleva un número de versión: si algo vuelve a cambiar mientras se envía, la anotación nueva no se
// quita al terminar (se enviará en la vuelta siguiente).
// Si el navegador no deja usar localStorage (ventana privada), la bandeja vive en memoria mientras la página esté
// abierta: lo pendiente se envía igual, pero no sobrevive a cerrar la pestaña (el primer envío completo lo cubre).
// =============================================================================

/** @typedef {'put' | 'del' | 'ws' | 'wsdel' | 'default' | 'profile'} EntryType */
/**
 * @typedef {Object} OutboxEntry
 * @property {string} key   Clave completa en el almacenamiento.
 * @property {string} seq   Versión de la anotación.
 * @property {string} ws    Espacio ('' para el perfil).
 * @property {EntryType} type
 * @property {string} kind  Tipo de registro (movements…) para put/del; '' en los demás.
 * @property {string} id    Id del registro para put/del; '' en los demás.
 */

const VERSION = 'v1';

/** @param {string} userId */
export const outboxPrefix = (userId) => `accontrol.outbox.${VERSION}.${userId}.`;

/** Almacenamiento en memoria con la misma forma que localStorage. */
function memoryStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem: (/** @type {string} */ k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, String(v)),
    removeItem: (/** @type {string} */ k) => void map.delete(k),
    key: (/** @type {number} */ i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/**
 * @param {{ storage: Storage | null, userId: string, now?: () => number }} options
 */
export function createOutbox(options) {
  const prefix = outboxPrefix(options.userId);
  const nowMs = options.now ?? (() => Date.now());
  /** @type {Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>} */
  let storage = options.storage ?? memoryStorage();
  let memoryOnly = !options.storage;
  let counter = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();

  const nextSeq = () => `${nowMs().toString(36)}-${(counter += 1).toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

  /** Si escribir en localStorage falla (lleno o bloqueado), se pasa a memoria con lo que ya había. */
  function write(/** @type {string} */ key, /** @type {string} */ value) {
    try {
      storage.setItem(key, value);
    } catch {
      if (memoryOnly) throw new Error('No se pudo anotar el cambio pendiente.');
      const copy = memoryStorage();
      for (const entry of list()) copy.setItem(entry.key, entry.seq);
      storage = copy;
      memoryOnly = true;
      storage.setItem(key, value);
    }
  }

  /** @param {string} ws @param {EntryType} type @param {string} [kind] @param {string} [id] */
  function mark(ws, type, kind = '', id = '') {
    write(`${prefix}${ws}|${type}|${kind}|${id}`, nextSeq());
  }

  function changed() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('Error en un oyente de la bandeja:', error);
      }
    }
  }

  /** @returns {OutboxEntry[]} */
  function list() {
    /** @type {OutboxEntry[]} */
    const entries = [];
    let keys;
    try {
      keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k) => typeof k === 'string' && k.startsWith(prefix));
    } catch {
      return entries;
    }
    for (const key of /** @type {string[]} */ (keys)) {
      const [ws, type, kind, id] = key.slice(prefix.length).split('|');
      const seq = storage.getItem(key);
      if (seq === null || !['put', 'del', 'ws', 'wsdel', 'default', 'profile'].includes(type)) continue;
      entries.push({ key, seq, ws, type: /** @type {EntryType} */ (type), kind: kind ?? '', id: id ?? '' });
    }
    return entries;
  }

  return {
    /** true si lo pendiente solo está en memoria (no sobrevive a cerrar la pestaña). */
    isMemoryOnly: () => memoryOnly,

    /** @param {string} ws @param {string} kind @param {string[]} ids */
    markPut(ws, kind, ids) {
      if (ids.length === 0) return;
      for (const id of ids) mark(ws, 'put', kind, id);
      changed();
    },
    /** @param {string} ws @param {string} kind @param {string[]} ids */
    markDelete(ws, kind, ids) {
      if (ids.length === 0) return;
      for (const id of ids) mark(ws, 'del', kind, id);
      changed();
    },
    /** Se creó o cambió el espacio (nombre, saldo inicial, organización). @param {string} ws */
    markWorkspace(ws) {
      mark(ws, 'ws');
      changed();
    },
    /** @param {string} ws */
    markWorkspaceDeleted(ws) {
      mark(ws, 'wsdel');
      changed();
    },
    /** Cambió cuál es el espacio predeterminado. @param {string} ws */
    markDefault(ws) {
      // Solo vale el último elegido.
      for (const e of list()) if (e.type === 'default') storage.removeItem(e.key);
      mark(ws, 'default');
      changed();
    },
    markProfile() {
      mark('', 'profile');
      changed();
    },

    /** Lo pendiente ahora mismo (una foto: lo que se anote después no aparece). */
    snapshot: list,

    /** Cuántas anotaciones hay pendientes. */
    pendingCount: () => list().length,

    /**
     * Quita lo que ya se envió. Una entrada que volvió a anotarse después de la foto (otra versión) se conserva.
     * @param {OutboxEntry[]} entries
     */
    settle(entries) {
      for (const e of entries) {
        try {
          if (storage.getItem(e.key) === e.seq) storage.removeItem(e.key);
        } catch {
          // si no se puede quitar, se reenviará: subir es repetible
        }
      }
      changed();
    },

    /** Borra todo lo pendiente de esta cuenta (al eliminar la cuenta). */
    clear() {
      for (const e of list()) storage.removeItem(e.key);
      changed();
    },

    /** @param {() => void} listener @returns {() => void} */
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
