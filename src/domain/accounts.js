// @ts-check
// =============================================================================
// CUENTAS: reglas puras del inicio de sesión (sin red, sin pantalla)
// -----------------------------------------------------------------------------
// Validación de correo, contraseña y nombre; mensajes en español para los errores del servidor de cuentas
// (Supabase Auth); y la regla de qué base de datos local usa cada cuenta en un mismo dispositivo.
// =============================================================================

import { EMAIL_ERROR, isValidEmail } from './contact.js';
import { LIMITS } from './types.js';

/** Mínimo y máximo de la contraseña. El máximo existe porque el servidor solo usa los primeros 72 bytes. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;
export const EMAIL_MAX = 254;

/**
 * Símbolos que Supabase cuenta como «symbol» en la regla «Lowercase, uppercase letters, digits and symbols», la que está
 * activada en el proyecto (Authentication → Password requirements). Las letras que cuenta son solo a–z y A–Z (sin tildes ni ñ).
 */
export const PASSWORD_SYMBOLS = '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~';

/** Lo que se le explica a la persona al elegir una contraseña (la misma regla que exige el servidor). */
export const PASSWORD_HINT = `Mínimo ${PASSWORD_MIN} caracteres, con una minúscula, una mayúscula, un número y un símbolo (por ejemplo: Mi-Casa-2026!).`;

/**
 * Qué le falta a una contraseña para cumplir la regla del servidor (vacío = cumple).
 * @param {string} raw
 * @returns {string[]}
 */
export function missingPasswordParts(raw) {
  const missing = [];
  if (!/[a-z]/.test(raw)) missing.push('una minúscula');
  if (!/[A-Z]/.test(raw)) missing.push('una mayúscula');
  if (!/[0-9]/.test(raw)) missing.push('un número');
  if (![...raw].some((c) => PASSWORD_SYMBOLS.includes(c))) missing.push('un símbolo (como ! # $ - _ .)');
  return missing;
}

/** «a», «a y b», «a, b y c». @param {string[]} items */
const joinList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`);

/** Contraseñas que cualquiera probaría primero. No es una lista completa: solo corta lo más obvio. */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'passw0rd',
  'qwertyui', 'qwerty123', 'abcd1234', 'abc12345', 'contrasena', 'contraseña', 'contrasena1', 'iloveyou', 'admin123',
  'accontrol', 'accontrol1', 'accontrol123',
]);

/**
 * Deja el correo listo para enviarlo: sin espacios en los bordes y en minúsculas (el servidor lo guarda así).
 * @param {unknown} raw
 */
export function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, email: string } | { ok: false, error: string }}
 */
export function validateEmail(raw) {
  const email = normalizeEmail(raw);
  if (email === '') return { ok: false, error: 'Escribe tu correo.' };
  if (email.length > EMAIL_MAX || !isValidEmail(email)) return { ok: false, error: EMAIL_ERROR };
  return { ok: true, email };
}

/**
 * Regla para CREAR o CAMBIAR una contraseña. (Al entrar no se valida: la que ya existe no se juzga.)
 * @param {unknown} raw
 * @param {string} [email] Si se da, la contraseña no puede ser el propio correo.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateNewPassword(raw, email = '') {
  if (typeof raw !== 'string' || raw === '') return { ok: false, error: 'Escribe una contraseña.' };
  if ([...raw].length < PASSWORD_MIN) return { ok: false, error: `Usa al menos ${PASSWORD_MIN} caracteres.` };
  if (new TextEncoder().encode(raw).length > PASSWORD_MAX_BYTES) {
    return { ok: false, error: `Es demasiado larga (máximo ${PASSWORD_MAX_BYTES} caracteres).` };
  }
  if (raw.trim() === '') return { ok: false, error: 'La contraseña no puede ser solo espacios.' };
  const missing = missingPasswordParts(raw);
  if (missing.length > 0) return { ok: false, error: `Le falta ${joinList(missing)}.` };
  if (COMMON_PASSWORDS.has(raw.toLowerCase())) return { ok: false, error: 'Esa contraseña es de las primeras que se prueban. Elige otra.' };
  if (email !== '' && raw.toLowerCase() === normalizeEmail(email)) return { ok: false, error: 'No uses tu correo como contraseña.' };
  return { ok: true };
}

/**
 * Nombre para el saludo (opcional).
 * @param {unknown} raw
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateDisplayName(raw) {
  // Se quitan caracteres de control y se juntan espacios repetidos.
  const name = (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...name].length > LIMITS.displayName) return { ok: false, error: `Máximo ${LIMITS.displayName} caracteres.` };
  return { ok: true, name };
}

/**
 * Textos para las respuestas de error del servidor de cuentas. La clave es el `error_code` de Supabase Auth.
 * @type {Record<string, string>}
 */
const ERROR_TEXTS = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Todavía no confirmas tu correo. Escribe el código de 6 dígitos que te enviamos (mira también en spam).',
  user_already_exists: 'Ese correo ya tiene una cuenta. Entra con tu contraseña o recupérala.',
  // 0.20.2: el servidor no deja crear cuentas nuevas con Google (gancho «Before User Created»).
  google_sin_cuenta: 'Esa cuenta de Google todavía no está registrada en ACCONTROL. Primero crea tu cuenta con tu correo y una contraseña (puede ser el mismo correo de Google); después podrás entrar con Google.',
  email_exists: 'Ese correo ya tiene una cuenta. Entra con tu contraseña o recupérala.',
  // 0.20.3: borrar la cuenta pide confirmar con el código del correo (de hace 15 minutos o menos).
  confirmar_correo: 'Para eliminar tu cuenta, confirma primero con el código que te enviamos al correo (vale 15 minutos). Empieza otra vez «Eliminar mi cuenta».',
  weak_password: 'Esa contraseña no cumple las reglas: al menos 8 caracteres con una minúscula, una mayúscula, un número y un símbolo.',
  same_password: 'La contraseña nueva debe ser distinta de la actual.',
  current_password_required: 'Escribe tu contraseña actual.',
  current_password_invalid: 'La contraseña actual no es correcta.',
  signup_disabled: 'Por ahora no se pueden crear cuentas nuevas.',
  email_provider_disabled: 'El acceso con correo está desactivado en el servidor.',
  email_address_invalid: 'Ese correo no es válido.',
  email_address_not_authorized: 'Por ahora el servicio de correo solo puede escribir a direcciones autorizadas por el administrador de ACCONTROL.',
  otp_expired: 'El código no es correcto, venció o ya se usó. Revisa el último correo que te llegó o pide un código nuevo.',
  bad_jwt: 'El enlace no es válido o ya venció. Pide uno nuevo.',
  invalid_response: 'El servidor respondió algo inesperado. Inténtalo de nuevo.',
  over_email_send_rate_limit: 'Se enviaron demasiados correos. Espera unos minutos e inténtalo de nuevo.',
  over_request_rate_limit: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  session_not_found: 'Tu sesión venció. Entra de nuevo.',
  session_expired: 'Tu sesión venció. Entra de nuevo.',
  refresh_token_not_found: 'Tu sesión venció. Entra de nuevo.',
  refresh_token_already_used: 'Tu sesión venció. Entra de nuevo.',
  user_not_found: 'Tu sesión venció. Entra de nuevo.',
  user_banned: 'Esta cuenta está suspendida.',
  reauthentication_needed: 'Por seguridad, entra de nuevo para cambiar la contraseña.',
  network: 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
  timeout: 'El servidor tardó demasiado en responder. Inténtalo de nuevo.',
};

// ------------------------------------------------- código de 6 dígitos del correo (0.14.6)

/** Dígitos del código que llega al correo (en Supabase: Authentication → Email → «Email OTP Length», 6). */
export const OTP_LENGTH = 6;

/**
 * Saca el código de lo escrito o pegado. Acepta «123456», «123-456», «123 456» y también un texto más largo con el
 * código dentro (por si se copia el mensaje entero). Nunca adivina: si no hay exactamente un código claro, lo dice.
 * @param {unknown} raw
 * @returns {{ ok: true, code: string } | { ok: false, error: string }}
 */
export function parseOtp(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const digits = text.replace(/\D/g, '');
  if (digits.length === 0) return { ok: false, error: 'Escribe o pega el código de 6 dígitos que te llegó al correo.' };
  if (digits.length === OTP_LENGTH && /^[\d\s-]+$/.test(text)) return { ok: true, code: digits };
  const found = [...text.matchAll(/(?<!\d)(\d{3})[\s-]?(\d{3})(?!\d)/g)];
  if (found.length === 1) return { ok: true, code: found[0][1] + found[0][2] };
  return { ok: false, error: 'El código tiene 6 dígitos (por ejemplo 123-456).' };
}

/**
 * Cómo se ve mientras se escribe: «123456» → «123-456» (máximo 6 dígitos).
 * @param {unknown} raw
 */
export function formatOtpInput(raw) {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH);
  return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
}

/** Códigos que significan "esta sesión ya no sirve" (hay que volver a entrar). */
export const SESSION_LOST_CODES = new Set([
  'session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used', 'user_not_found',
  'invalid_grant', 'bad_jwt',
]);

/**
 * Mensaje en español para un error del servidor.
 * @param {string} code error_code de Supabase Auth, o 'network' / 'timeout'
 * @param {number} [status]
 */
export function authErrorMessage(code, status = 0) {
  const known = ERROR_TEXTS[code];
  if (known) return known;
  if (status === 429) return ERROR_TEXTS.over_request_rate_limit;
  if (status >= 500) return 'El servidor tuvo un problema. Inténtalo de nuevo en unos minutos.';
  return 'No se pudo completar la acción. Inténtalo de nuevo.';
}

// ------------------------------------------------- base de datos local por cuenta

/** Nombre de la base de datos que usaba ACCONTROL antes de existir las cuentas. */
export const LEGACY_DB_NAME = 'accontrol';

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @param {unknown} id */
export function isUserId(id) {
  return typeof id === 'string' && USER_ID_RE.test(id);
}

/**
 * Qué base de datos local abre cada cuenta en este dispositivo.
 *  · La PRIMERA cuenta que entra se queda con la base de siempre (así no se pierde lo que ya había guardado antes
 *    de que existieran las cuentas).
 *  · Cualquier otra cuenta que entre después en el mismo dispositivo usa la suya, vacía y separada.
 * @param {string} userId
 * @param {string | null} legacyOwnerId Quién se quedó con la base de siempre (null = nadie todavía).
 */
export function databaseNameFor(userId, legacyOwnerId) {
  if (!isUserId(userId)) throw new Error('Identificador de cuenta no válido.');
  if (legacyOwnerId === null || legacyOwnerId === userId) return LEGACY_DB_NAME;
  return `${LEGACY_DB_NAME}-u-${userId}`;
}
