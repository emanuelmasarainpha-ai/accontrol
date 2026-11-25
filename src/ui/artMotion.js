// @ts-check
// =============================================================================
// IMÁGENES EN MOVIMIENTO (0.20.6)
// -----------------------------------------------------------------------------
// Los dibujos de las categorías se mueven solos (la moneda flota, el vapor sube…). Quien lo prefiera quieto lo apaga
// en Ajustes → General → «Este dispositivo». Se recuerda en este dispositivo (no es un dato financiero).
// Apagado = <html data-art-motion="off">, y el CSS deja de animar los dibujos. Con «reducir movimiento» del sistema
// tampoco se mueven, aunque esto esté encendido.
// =============================================================================

export const ART_MOTION_KEY = 'accontrol.artMotion.v1';

/** @returns {Pick<Storage, 'getItem' | 'setItem'> | null} */
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** ¿Se mueven los dibujos? (encendido salvo que se haya apagado). @param {Pick<Storage, 'getItem'> | null} [storage] */
export function artMotionEnabled(storage = defaultStorage()) {
  try {
    return storage?.getItem(ART_MOTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Pone o quita la marca en <html>. @param {boolean} [on] */
export function applyArtMotion(on = artMotionEnabled()) {
  if (typeof document === 'undefined') return;
  if (on) delete document.documentElement.dataset.artMotion;
  else document.documentElement.dataset.artMotion = 'off';
}

/**
 * Enciende o apaga y lo recuerda. Devuelve false si el navegador no deja guardarlo (igual se aplica ahora).
 * @param {boolean} on @param {Pick<Storage, 'setItem'> | null} [storage]
 */
export function setArtMotion(on, storage = defaultStorage()) {
  applyArtMotion(on);
  try {
    if (!storage) return false;
    storage.setItem(ART_MOTION_KEY, on ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}
