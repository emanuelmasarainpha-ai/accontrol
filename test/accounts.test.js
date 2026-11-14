import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  authErrorMessage, databaseNameFor, EMAIL_MAX, isUserId, LEGACY_DB_NAME, normalizeEmail, missingPasswordParts, PASSWORD_HINT, PASSWORD_MAX_BYTES, PASSWORD_MIN, PASSWORD_SYMBOLS,
  SESSION_LOST_CODES, validateDisplayName, validateEmail, validateNewPassword,
} from '../src/domain/accounts.js';

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';

describe('correo', () => {
  it('normalizeEmail quita espacios y pasa a minúsculas; lo que no es texto queda vacío', () => {
    assert.equal(normalizeEmail('  Ana@Correo.COM \n'), 'ana@correo.com');
    assert.equal(normalizeEmail(undefined), '');
    assert.equal(normalizeEmail(42), '');
  });

  it('validateEmail acepta un correo normal y lo devuelve normalizado', () => {
    assert.deepEqual(validateEmail(' Ana@Correo.com '), { ok: true, email: 'ana@correo.com' });
  });

  it('validateEmail rechaza vacío, sin arroba, sin dominio y con espacios', () => {
    for (const bad of ['', '   ', 'ana', 'ana@', '@correo.com', 'ana@correo', 'a na@correo.com', 'ana@@correo.com']) {
      assert.equal(validateEmail(bad).ok, false, bad);
    }
    const empty = validateEmail('');
    assert.equal(empty.ok === false && empty.error, 'Escribe tu correo.');
  });

  it('validateEmail pone el límite en 254 caracteres (justo en el límite sí, uno más no)', () => {
    const at = (n) => `${'a'.repeat(n - '@x.com'.length)}@x.com`;
    assert.equal(at(EMAIL_MAX).length, EMAIL_MAX);
    assert.equal(validateEmail(at(EMAIL_MAX)).ok, true);
    assert.equal(validateEmail(at(EMAIL_MAX + 1)).ok, false);
  });
});

describe('contraseña nueva', () => {
  it('pide al menos 8 caracteres: con 7 no, con 8 sí', () => {
    assert.equal(PASSWORD_MIN, 8);
    assert.equal(validateNewPassword('Vela9Li').ok, false);
    assert.equal(validateNewPassword('Vela9Li!').ok, true);
  });

  it('cuenta caracteres, no bytes, para el mínimo (los emojis cuentan uno cada uno)', () => {
    assert.equal(validateNewPassword(`Aa1!${'😀'.repeat(4)}`).ok, true); // 8 caracteres
    assert.equal(validateNewPassword(`Aa1!${'😀'.repeat(3)}`).ok, false); // 7 caracteres
  });

  it('el máximo es de 72 bytes: 72 sí, 73 no; y los acentos pesan 2 bytes', () => {
    assert.equal(PASSWORD_MAX_BYTES, 72);
    assert.equal(validateNewPassword(`Aa1!${'a'.repeat(68)}`).ok, true); // 72 bytes
    assert.equal(validateNewPassword(`Aa1!${'a'.repeat(69)}`).ok, false); // 73 bytes
    assert.equal(validateNewPassword(`Aa1!${'é'.repeat(34)}`).ok, true); // 4 + 68 = 72 bytes
    assert.equal(validateNewPassword(`Aa1!${'é'.repeat(35)}`).ok, false); // 74 bytes
  });

  it('pide lo mismo que Supabase (Password requirements recomendada): minúscula, mayúscula, número y símbolo', () => {
    assert.equal(validateNewPassword('Mi-Casa-2026!').ok, true);
    assert.deepEqual(validateNewPassword('micasa2026!'), { ok: false, error: 'Le falta una mayúscula.' });
    assert.deepEqual(validateNewPassword('MICASA2026!'), { ok: false, error: 'Le falta una minúscula.' });
    assert.deepEqual(validateNewPassword('MiCasaGrande!'), { ok: false, error: 'Le falta un número.' });
    assert.deepEqual(validateNewPassword('MiCasa2026'), { ok: false, error: 'Le falta un símbolo (como ! # $ - _ .).' });
    assert.deepEqual(validateNewPassword('micasagrande'), { ok: false, error: 'Le falta una mayúscula, un número y un símbolo (como ! # $ - _ .).' });
  });

  it('como Supabase, la ñ y las tildes no cuentan como minúscula, ni el espacio como símbolo', () => {
    assert.equal(missingPasswordParts('ÑANDÚ 2026!').includes('una minúscula'), true);
    assert.equal(missingPasswordParts('Casa grande 26').includes('un símbolo (como ! # $ - _ .)'), true);
    for (const symbol of ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '-', '=', '[', ']', '{', '}', ';', "'", '\\', ':', '"', '|', '<', '>', '?', ',', '.', '/', '`', '~']) {
      assert.ok(PASSWORD_SYMBOLS.includes(symbol), `falta el símbolo ${symbol}`);
      assert.deepEqual(missingPasswordParts(`Casa2026${symbol}`), [], symbol);
    }
  });

  it('el texto de ayuda explica la regla completa', () => {
    assert.match(PASSWORD_HINT, /Mínimo 8 caracteres, con una minúscula, una mayúscula, un número y un símbolo/);
    assert.equal(validateNewPassword('Mi-Casa-2026!').ok, true, 'el ejemplo del texto cumple la regla');
  });

  it('rechaza vacío, solo espacios y no-texto', () => {
    assert.equal(validateNewPassword('').ok, false);
    assert.equal(validateNewPassword('        ').ok, false);
    assert.equal(validateNewPassword(undefined).ok, false);
    assert.equal(validateNewPassword(null).ok, false);
  });

  it('rechaza las contraseñas más obvias sin importar mayúsculas', () => {
    for (const bad of ['12345678', 'PASSWORD', 'Contraseña', 'qwerty123', 'ACCONTROL']) {
      assert.equal(validateNewPassword(bad).ok, false, bad);
    }
  });

  it('no deja usar el propio correo como contraseña', () => {
    assert.equal(validateNewPassword('Ana1@correo.com', 'ana1@correo.com').ok, false);
    assert.equal(validateNewPassword('Ana1@correo.com').ok, true);
  });
});

describe('nombre', () => {
  it('es opcional, limpia espacios y caracteres de control', () => {
    assert.deepEqual(validateDisplayName(undefined), { ok: true, name: '' });
    assert.deepEqual(validateDisplayName('  Ana   María\t\n'), { ok: true, name: 'Ana María' });
    assert.deepEqual(validateDisplayName('A\u0000B'), { ok: true, name: 'A B' });
  });

  it('admite hasta 40 caracteres: 40 sí, 41 no', () => {
    assert.equal(validateDisplayName('a'.repeat(40)).ok, true);
    assert.equal(validateDisplayName('a'.repeat(41)).ok, false);
  });
});

describe('mensajes de error', () => {
  it('traduce los códigos conocidos', () => {
    assert.equal(authErrorMessage('invalid_credentials'), 'Correo o contraseña incorrectos.');
    assert.match(authErrorMessage('email_not_confirmed'), /confirmas tu correo/);
    assert.match(authErrorMessage('user_already_exists'), /ya tiene una cuenta/);
    assert.match(authErrorMessage('network'), /conexión/);
    assert.match(authErrorMessage('timeout'), /tardó demasiado/);
    assert.match(authErrorMessage('email_address_not_authorized'), /autorizadas/);
  });

  it('un código desconocido usa el estado HTTP: 429 = demasiados intentos, 5xx = problema del servidor', () => {
    assert.match(authErrorMessage('algo_raro', 429), /Demasiados intentos/);
    assert.match(authErrorMessage('algo_raro', 503), /problema/);
    assert.equal(authErrorMessage('algo_raro', 400), 'No se pudo completar la acción. Inténtalo de nuevo.');
    assert.equal(authErrorMessage('algo_raro'), 'No se pudo completar la acción. Inténtalo de nuevo.');
  });

  it('nunca muestra texto en inglés del servidor', () => {
    for (const code of ['invalid_credentials', 'weak_password', 'otp_expired', 'bad_jwt', 'over_email_send_rate_limit', 'unknown']) {
      assert.doesNotMatch(authErrorMessage(code, 400), /\b(invalid|should|expired|password should)\b/i, code);
    }
  });

  it('SESSION_LOST_CODES reúne los códigos que obligan a entrar de nuevo, y solo esos', () => {
    for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'invalid_grant', 'bad_jwt']) {
      assert.equal(SESSION_LOST_CODES.has(code), true, code);
    }
    for (const code of ['network', 'timeout', 'invalid_credentials', 'over_request_rate_limit']) {
      assert.equal(SESSION_LOST_CODES.has(code), false, code);
    }
  });
});

describe('base de datos local por cuenta', () => {
  it('isUserId solo acepta UUID', () => {
    assert.equal(isUserId(UID_A), true);
    assert.equal(isUserId('abcdef12-3456-4789-8abc-def123456789'), true);
    assert.equal(isUserId('ABCDEF12-3456-4789-8ABC-DEF123456789'), false); // el servidor siempre los entrega en minúsculas
    for (const bad of ['', 'abc', '../evil', `${UID_A}x`, ` ${UID_A}`, 42, null, undefined]) assert.equal(isUserId(bad), false, String(bad));
  });

  it('la primera cuenta (o ninguna dueña todavía) se queda con la base de siempre', () => {
    assert.equal(databaseNameFor(UID_A, null), LEGACY_DB_NAME);
    assert.equal(databaseNameFor(UID_A, UID_A), LEGACY_DB_NAME);
    assert.equal(LEGACY_DB_NAME, 'accontrol');
  });

  it('otra cuenta en el mismo dispositivo usa una base propia, distinta por cuenta', () => {
    assert.equal(databaseNameFor(UID_B, UID_A), `accontrol-u-${UID_B}`);
    assert.notEqual(databaseNameFor(UID_B, UID_A), databaseNameFor(UID_A, UID_B));
  });

  it('con un identificador raro falla en lugar de armar un nombre peligroso', () => {
    assert.throws(() => databaseNameFor('../x', null), /no válido/);
    assert.throws(() => databaseNameFor('', UID_A), /no válido/);
  });
});
