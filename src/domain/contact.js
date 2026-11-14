// @ts-check
// =============================================================================
// VALIDACIÓN DE DATOS DE CONTACTO (correo y teléfono)
// -----------------------------------------------------------------------------
// Compartida por los datos de la organización y por los clientes. Solo revisa que el
// formato sea razonable: no comprueba que el correo o el teléfono existan.
// =============================================================================

/** @param {string} email Ya recortado y sin espacios dobles. */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Al menos 7 números y solo símbolos de teléfono (+, espacios, guiones, paréntesis y puntos). @param {string} phone */
export function isValidPhone(phone) {
  return /^[0-9+()\-.\s]+$/.test(phone) && phone.replace(/\D/g, '').length >= 7;
}

export const EMAIL_ERROR = 'Escribe un correo válido, por ejemplo nombre@ejemplo.com.';
export const PHONE_ERROR = 'Escribe un teléfono válido (al menos 7 números; puedes usar +, espacios, guiones y paréntesis).';

/** Quita espacios de más y caracteres de control. @param {unknown} raw */
export function cleanText(raw) {
  // eslint-disable-next-line no-control-regex
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ');
}
