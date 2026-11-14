// @ts-check
// =============================================================================
// VIBRACIÓN CORTA AL CONFIRMAR ACCIONES IMPORTANTES (opcional)
// -----------------------------------------------------------------------------
// Solo en navegadores que la tienen (Chrome de Android; el iPhone no la ofrece a las páginas web). Se puede
// apagar en Ajustes → Este dispositivo. La preferencia es de ESTE dispositivo (localStorage), no un dato
// financiero. Si el navegador no deja guardar, queda encendida y nada se rompe.
// =============================================================================

export const VIBRATION_KEY = 'accontrol.vibration.v1';

/** Patrones en milisegundos: cortos, para que se sientan como un «clic», no como una llamada. */
export const PATTERNS = {
  /** Algo guardado (un gasto, un aporte, un pago). */
  confirm: 12,
  /** Confirmaste algo que borra o reemplaza datos. */
  warning: 30,
  /** Meta cumplida o logro conseguido. */
  success: [14, 60, 22],
};

/** @typedef {keyof typeof PATTERNS} HapticKind */
/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void } | null} PrefStorage */

/** @returns {PrefStorage} */
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * ¿Está encendida la vibración? (encendida si nunca se tocó)
 * @param {PrefStorage} [storage]
 */
export function vibrationEnabled(storage = defaultStorage()) {
  try {
    return storage?.getItem(VIBRATION_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * @param {boolean} on @param {PrefStorage} [storage]
 * @returns {boolean} true si quedó guardado
 */
export function setVibration(on, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(VIBRATION_KEY, on ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

/** ¿Este navegador puede vibrar? @param {{ vibrate?: unknown } | undefined} [nav] */
export function canVibrate(nav = typeof navigator === 'undefined' ? undefined : navigator) {
  return typeof nav?.vibrate === 'function';
}

/**
 * Vibra (si está encendida y el navegador puede).
 * @param {HapticKind} kind
 * @param {{ storage?: PrefStorage, nav?: { vibrate?: (pattern: number | number[]) => boolean } }} [options]
 * @returns {boolean} true si se pidió la vibración
 */
export function haptic(kind, options = {}) {
  const nav = options.nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (!vibrationEnabled(options.storage ?? defaultStorage()) || !canVibrate(nav)) return false;
  try {
    return Boolean(/** @type {any} */ (nav).vibrate(PATTERNS[kind]));
  } catch {
    return false;
  }
}
