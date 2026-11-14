// @ts-check
// =============================================================================
// AJUSTES DEL USUARIO
// =============================================================================

import { MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Settings} Settings */

/** @returns {Settings} */
export function defaultSettings() {
  return { displayName: '', openingBalanceCents: 0 };
}

/**
 * @param {{ displayName: string, openingText: string }} input
 * @returns {{ ok: true, value: Settings } | { ok: false, errors: Record<string, string> }}
 */
export function validateSettings(input) {
  /** @type {Record<string, string>} */
  const errors = {};

  const displayName = String(input.displayName ?? '').trim().replace(/\s+/g, ' ');
  if (displayName.length > LIMITS.displayName) {
    errors.displayName = `Máximo ${LIMITS.displayName} caracteres.`;
  }

  let openingBalanceCents = 0;
  if (String(input.openingText ?? '').trim() !== '') {
    const money = parseMoney(input.openingText);
    if (!money.ok) errors.opening = money.error;
    else if (money.cents > MAX_CENTS) errors.opening = 'El monto es demasiado grande.';
    else openingBalanceCents = money.cents;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { displayName, openingBalanceCents } };
}
