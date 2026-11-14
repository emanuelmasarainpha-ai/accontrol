// @ts-check
// =============================================================================
// RECORRIDO GUIADO: ¿YA SE VIO O SE SALTÓ?
// -----------------------------------------------------------------------------
// Se recuerda por CUENTA y por TIPO de espacio (no por espacio): quien ya vio el recorrido de «Personal» no lo
// vuelve a ver al crear otro espacio Personal. Se guarda en localStorage (no en la base de datos de tus finanzas),
// así que el recuerdo es de ESTE dispositivo: en otro dispositivo se ofrece otra vez.
//
// Si el navegador no deja guardar (ventana privada, almacenamiento lleno o bloqueado), se recuerda solo mientras
// la página esté abierta: nunca se rompe la app por esto.
// =============================================================================

import { isWorkspaceKind } from '../domain/workspaces.js';

/** @typedef {import('../domain/types.js').WorkspaceKind} WorkspaceKind */
/** @typedef {'done' | 'skipped'} TourStatus  done = lo terminó; skipped = lo saltó o lo cerró antes */
/** @typedef {Partial<Record<WorkspaceKind, { status: TourStatus, at: string }>>} TourRecord */

export const TOUR_KEY_PREFIX = 'accontrol.tours.v1.';

/** Cuenta para el modo sin cuentas (sin servidor). */
export const LOCAL_ACCOUNT = 'local';

/**
 * Lee lo guardado, quedándose solo con lo válido (lo demás se ignora).
 * @param {unknown} raw  Texto guardado (o null)
 * @returns {TourRecord}
 */
export function parseTourRecord(raw) {
  if (typeof raw !== 'string' || raw === '' || raw.length > 4096) return {};
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  /** @type {TourRecord} */
  const record = {};
  for (const [kind, entry] of Object.entries(value)) {
    if (!isWorkspaceKind(kind) || !entry || typeof entry !== 'object') continue;
    const { status, at } = /** @type {{ status?: unknown, at?: unknown }} */ (entry);
    if ((status === 'done' || status === 'skipped') && typeof at === 'string' && at.length <= 40) record[kind] = { status, at };
  }
  return record;
}

/**
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void } | null} storage
 * @param {string} accountKey  Id de la cuenta (o LOCAL_ACCOUNT)
 */
export function createTourMemory(storage, accountKey) {
  const key = `${TOUR_KEY_PREFIX}${accountKey}`;
  /** Lo de esta sesión: sirve aunque el navegador no deje guardar. @type {TourRecord} */
  let cache = {};
  try {
    cache = parseTourRecord(storage?.getItem(key) ?? null);
  } catch {
    cache = {};
  }

  return {
    key,
    /** @param {WorkspaceKind} kind */
    hasSeen: (kind) => Boolean(cache[kind]),
    /** @param {WorkspaceKind} kind */
    statusOf: (kind) => cache[kind]?.status ?? null,
    /**
     * @param {WorkspaceKind} kind @param {TourStatus} status @param {string} nowISO
     * @returns {boolean} true si quedó guardado en el dispositivo
     */
    mark(kind, status, nowISO) {
      cache = { ...cache, [kind]: { status, at: nowISO } };
      try {
        if (!storage) return false;
        storage.setItem(key, JSON.stringify(cache));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** @typedef {ReturnType<typeof createTourMemory>} TourMemory */
