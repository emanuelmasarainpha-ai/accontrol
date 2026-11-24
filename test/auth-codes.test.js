// 0.14.6 — Código de 6 dígitos por correo al crear la cuenta y al recuperar la contraseña (Supabase: POST /auth/v1/verify).
// El código lo decide el servidor: vale una sola vez, vence y pedir otro anula el anterior. La app solo lo lee y lo envía.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAuthClient } from '../src/auth/authClient.js';
import { formatOtpInput, OTP_LENGTH, parseOtp } from '../src/domain/accounts.js';
import { renderAuth } from '../src/views/auth.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const GOOD = 'Clave-larga-2026';

/** Cliente de cuentas con el servidor simulado y un reloj que se puede adelantar. */
function setup({ confirmEmails = true } = {}) {
  let now = Date.UTC(2026, 10, 12, 12, 0, 0);
  const server = createMockAuthServer({ confirmEmails, now: () => now });
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
  const auth = createAuthClient({
    url: 'https://proyecto.test', publishableKey: 'clave-publica', fetch: server.fetch, storage, now: () => now,
    redirectTo: 'https://app.test/',
  });
  return { server, auth, map, advance: (ms) => { now += ms; } };
}

describe('leer el código escrito o pegado', () => {
  it('acepta 6 dígitos con o sin guion o espacio, y el código dentro del texto del correo', () => {
    for (const text of ['123456', '123-456', ' 123 456 ', 'Tu código de ACCONTROL es 123-456. Vence en 1 hora.']) {
      assert.deepEqual(parseOtp(text), { ok: true, code: '123456' }, text);
    }
  });
  it('nunca adivina: incompleto, de más, dos códigos o vacío dan un aviso claro', () => {
    for (const text of ['12345', '1234567', '111-222 y 333-444', 'abc', '', null]) assert.equal(parseOtp(text).ok, false, String(text));
    assert.match(/** @type {any} */ (parseOtp('')).error, /6 dígitos/);
  });
  it('se ve como 000-000 mientras se escribe (solo dígitos, máximo 6)', () => {
    assert.equal(OTP_LENGTH, 6);
    assert.equal(formatOtpInput('1'), '1');
    assert.equal(formatOtpInput('123'), '123');
    assert.equal(formatOtpInput('1234'), '123-4');
    assert.equal(formatOtpInput('12a3-4567x'), '123-456');
  });
});

describe('crear cuenta con código', () => {
  it('el código correcto confirma la cuenta y abre la sesión', async () => {
    const { server, auth } = setup();
    assert.deepEqual(await auth.signUp({ email: 'ana@correo.com', password: GOOD }), { ok: true, signedIn: false, email: 'ana@correo.com' });
    const code = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    assert.match(code, /^\d{6}$/);
    const result = await auth.verifyCode({ email: 'ana@correo.com', code: `${code.slice(0, 3)}-${code.slice(3)}`, type: 'signup' });
    assert.deepEqual(result, { ok: true });
    assert.equal(auth.getUser()?.email, 'ana@correo.com');
    const call = server.calls.at(-1);
    assert.equal(call?.path, '/auth/v1/verify');
    assert.deepEqual(call?.body, { type: 'signup', email: 'ana@correo.com', token: code });
    // Ya confirmada: entra con su contraseña.
    await auth.signOut();
    assert.deepEqual(await auth.signIn({ email: 'ana@correo.com', password: GOOD }), { ok: true });
  });

  it('un código equivocado no entra y lo dice en el campo del código', async () => {
    const { server, auth } = setup();
    await auth.signUp({ email: 'ana@correo.com', password: GOOD });
    const code = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    const wrong = code === '000000' ? '111111' : '000000';
    const result = await auth.verifyCode({ email: 'ana@correo.com', code: wrong, type: 'signup' });
    assert.equal(result.ok, false);
    assert.equal(/** @type {any} */ (result).error.code, 'otp_expired');
    assert.match(/** @type {any} */ (result).error.message, /código no es correcto, venció o ya se usó/);
    assert.equal(auth.getSession(), null);
  });

  it('el código sirve una sola vez', async () => {
    const { server, auth } = setup();
    await auth.signUp({ email: 'ana@correo.com', password: GOOD });
    const code = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    assert.equal((await auth.verifyCode({ email: 'ana@correo.com', code, type: 'signup' })).ok, true);
    await auth.signOut();
    assert.equal((await auth.verifyCode({ email: 'ana@correo.com', code, type: 'signup' })).ok, false);
  });

  it('pedir otro código anula el anterior', async () => {
    const { server, auth } = setup();
    await auth.signUp({ email: 'ana@correo.com', password: GOOD });
    const first = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    let second = first;
    while (second === first) {
      await auth.resendConfirmation('ana@correo.com');
      second = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    }
    assert.equal((await auth.verifyCode({ email: 'ana@correo.com', code: first, type: 'signup' })).ok, false, 'el viejo ya no sirve');
    assert.equal((await auth.verifyCode({ email: 'ana@correo.com', code: second, type: 'signup' })).ok, true);
  });

  it('el código vence (1 hora en el servidor simulado, como Supabase por omisión)', async () => {
    const { server, auth, advance } = setup();
    await auth.signUp({ email: 'ana@correo.com', password: GOOD });
    const code = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    advance(3601 * 1000);
    assert.equal((await auth.verifyCode({ email: 'ana@correo.com', code, type: 'signup' })).ok, false);
  });

  it('lo mal escrito ni siquiera se envía al servidor', async () => {
    const { server, auth } = setup();
    const before = server.calls.length;
    const result = await auth.verifyCode({ email: 'ana@correo.com', code: '12-34', type: 'signup' });
    assert.equal(/** @type {any} */ (result).error.field, 'code');
    assert.equal(server.calls.length, before);
  });
});

describe('recuperar la contraseña con código', () => {
  it('el código de recuperación abre una sesión que deja poner la contraseña nueva sin la actual', async () => {
    const { server, auth } = setup({ confirmEmails: false });
    await auth.signUp({ email: 'ana@correo.com', password: GOOD });
    await auth.signOut();
    await auth.requestPasswordReset('ana@correo.com');
    const code = /** @type {string} */ (server.lastCode('ana@correo.com', 'recovery'));
    assert.deepEqual(await auth.verifyCode({ email: 'ana@correo.com', code, type: 'recovery' }), { ok: true });
    assert.deepEqual(await auth.updatePassword('Otra-clave-larga-99'), { ok: true });
    await auth.signOut();
    assert.equal((await auth.signIn({ email: 'ana@correo.com', password: GOOD })).ok, false, 'la vieja ya no sirve');
    assert.deepEqual(await auth.signIn({ email: 'ana@correo.com', password: 'Otra-clave-larga-99' }), { ok: true });
  });

  it('un código de crear cuenta no sirve para recuperar (y al revés)', async () => {
    const { server, auth } = setup();
    await auth.signUp({ email: 'ana@correo.com', password: GOOD });
    const confirm = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    assert.equal((await auth.verifyCode({ email: 'ana@correo.com', code: confirm, type: 'recovery' })).ok, false);
  });

  it('para un correo sin cuenta responde igual que un código malo (no revela quién tiene cuenta)', async () => {
    const { auth } = setup();
    const result = await auth.verifyCode({ email: 'nadie@correo.com', code: '123456', type: 'recovery' });
    assert.equal(/** @type {any} */ (result).error.code, 'otp_expired');
  });
});

describe('las pantallas del código', () => {
  const base = { email: 'ana@correo.com', displayName: '', notice: null, busy: false, canResend: true };
  for (const [mode, form] of [['check-email', 'verify-signup'], ['reset-sent', 'verify-recovery']]) {
    it(`«${mode}» pide el código con un campo 000-000, botón Pegar y Reenviar`, () => {
      const out = renderAuth({ ...base, mode: /** @type {any} */ (mode) }).toString();
      assert.match(out, new RegExp(`data-auth-form="${form}"`));
      // 0.20.5: en «Olvidé mi contraseña» el campo es más grande (otp-input--big) y el correo se ve con partes tapadas.
      assert.match(out, /<input id="auth-code" name="code" class="input otp-input( otp-input--big)?" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000-000"/);
      assert.match(out, /data-otp-paste/);
      assert.match(out, /data-auth-resend/);
      assert.match(out, mode === 'reset-sent' ? /a•a@correo\.com/ : /ana@correo\.com/);
      assert.doesNotMatch(out, /\bIA\b/);
    });
  }
  it('mientras corre la espera para reenviar, el botón está desactivado', () => {
    const out = renderAuth({ ...base, mode: 'check-email', canResend: false }).toString();
    assert.match(out, /data-auth-resend disabled/);
  });
});
