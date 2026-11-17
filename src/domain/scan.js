// @ts-check
// =============================================================================
// PISTOLA LECTORA DE CÓDIGOS (0.17.2)
// -----------------------------------------------------------------------------
// Una pistola lectora (de código de barras o de QR) funciona como un teclado: «escribe» el código muy rápido y pulsa
// Enter. Cuando el cursor está en el buscador de la caja, eso ya basta. Cuando NO está en ningún campo (por ejemplo, después
// de tocar un producto), este lector junta las teclas que llegan seguidas y, al Enter, entrega el código. Distingue la
// pistola de una persona por la velocidad: entre tecla y tecla la pistola tarda unos pocos milisegundos.
// =============================================================================

/** Mínimo de caracteres para considerar que fue un código. */
export const MIN_CODE_LENGTH = 3;
/** Máximo de milisegundos entre una tecla y la siguiente para que cuente como la misma lectura. */
export const MAX_GAP_MS = 60;
/** Máximo de caracteres de un código (como el código de un producto). */
export const MAX_CODE_LENGTH = 30;

/**
 * Crea un lector. `key(tecla, milisegundos)` devuelve el código cuando llega Enter tras una lectura rápida; si no, null.
 * @param {{ minLength?: number, maxGapMs?: number }} [options]
 */
export function createScanReader({ minLength = MIN_CODE_LENGTH, maxGapMs = MAX_GAP_MS } = {}) {
  let buffer = '';
  let last = -Infinity;
  return {
    /** @param {string} key  Como KeyboardEvent.key. @param {number} at  Momento en milisegundos. @returns {string | null} */
    key(key, at) {
      const tooSlow = at - last > maxGapMs;
      last = at;
      // Tras una pausa empieza una lectura nueva (aunque la primera tecla sea Shift).
      if (tooSlow && key !== 'Enter') buffer = '';
      if (key === 'Enter') {
        const code = buffer;
        buffer = '';
        return !tooSlow && code.length >= minLength ? code : null;
      }
      if (key.length !== 1) return null; // Shift, flechas…: no cuentan
      buffer = (buffer + key).slice(0, MAX_CODE_LENGTH);
      return null;
    },
    reset() { buffer = ''; last = -Infinity; },
  };
}
