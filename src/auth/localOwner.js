// @ts-check
// =============================================================================
// QUÉ DATOS LOCALES ABRE CADA CUENTA EN ESTE DISPOSITIVO
// -----------------------------------------------------------------------------
// Antes de que existieran las cuentas, ACCONTROL guardaba todo en una base de datos del navegador llamada
// «accontrol». Para no perder nada de eso:
//   · la PRIMERA cuenta que entra en este dispositivo se queda con esa base (y se anota quién es);
//   · cualquier otra cuenta que entre después usa una base propia, vacía y separada.
// Así dos personas que comparten un teléfono o una computadora no ven los datos una de la otra
// (aunque los datos de cada una siguen sin cifrar en el dispositivo: ver Ajustes → Privacidad).
// =============================================================================

import { databaseNameFor, isUserId } from '../domain/accounts.js';

/** Dónde se anota quién se quedó con la base de siempre. */
export const LEGACY_OWNER_KEY = 'accontrol.legacyDbOwner';
/** Prefijo de la marca «ya se le puso a esta cuenta el nombre que escribió al crearla». */
export const NAME_ADOPTED_PREFIX = 'accontrol.nameAdopted.';

/** @typedef {Pick<Storage, 'getItem' | 'setItem'> | null} SimpleStorage */

/**
 * @param {SimpleStorage} storage
 * @param {string} key
 * @returns {string | null}
 */
function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {SimpleStorage} storage
 * @param {string} key @param {string} value
 */
function write(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Sin poder anotarlo (almacenamiento bloqueado), la cuenta usa igualmente la base de siempre.
  }
}

/**
 * Nombre de la base de datos local que debe abrir esta cuenta. Si todavía nadie se había quedado con la base de
 * siempre, esta cuenta se la queda (y queda anotado).
 * @param {SimpleStorage} storage @param {string} userId
 */
export function resolveDatabaseName(storage, userId) {
  let owner = read(storage, LEGACY_OWNER_KEY);
  if (owner !== null && !isUserId(owner)) owner = null; // anotación dañada: se trata como "nadie"
  if (owner === null) {
    write(storage, LEGACY_OWNER_KEY, userId);
    owner = userId;
  }
  return databaseNameFor(userId, owner);
}

/**
 * ¿Hay que ponerle a esta cuenta, en este dispositivo, el nombre que escribió al crearla? Solo se hace UNA vez:
 * si después lo borra a propósito en Ajustes, no vuelve a aparecer.
 * @param {SimpleStorage} storage @param {string} userId
 */
export function claimNameAdoption(storage, userId) {
  const key = `${NAME_ADOPTED_PREFIX}${userId}`;
  if (read(storage, key) !== null) return false;
  write(storage, key, '1');
  return true;
}
