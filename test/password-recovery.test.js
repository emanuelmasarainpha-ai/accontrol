// 0.20.5 — «Olvidé mi contraseña» con diseño de celular: fuerza de la contraseña, correo con partes tapadas y pantallas.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isGmail, maskEmail, passwordStrength, validateNewPassword } from '../src/domain/accounts.js';
import { PASSWORD_RULES, renderAuth } from '../src/views/auth.js';

const base = { email: 'dailyflutterui@gmail.com', displayName: '', notice: null, busy: false, canResend: true };
const page = (mode, patch = {}) => renderAuth({ ...base, mode, ...patch }).toString();

describe('fuerza de la contraseña', () => {
  it('vacía: sin rayitas ni nombre', () => {
    assert.deepEqual({ ...passwordStrength(''), checks: undefined }, { checks: undefined, met: 0, bars: 0, level: 'empty', label: '' });
  });
  it('de 1 a 4 rayitas según las reglas que cumple', () => {
    assert.equal(passwordStrength('casa').level, 'weak'); // solo minúsculas
    assert.equal(passwordStrength('casa20').bars, 1); // minúscula y número: 2 reglas → Débil
    assert.equal(passwordStrength('casa2026').level, 'fair'); // + largo: 3 reglas → Regular
    assert.equal(passwordStrength('Casa2026').level, 'good'); // + mayúscula: 4 → Buena
    const strong = passwordStrength('Mi-Casa-2026!');
    assert.equal(strong.level, 'strong');
    assert.equal(strong.bars, 4);
    assert.equal(strong.label, 'Fuerte');
    assert.deepEqual(strong.checks, { length: true, lower: true, upper: true, number: true, symbol: true });
  });
  it('«Fuerte» coincide con la regla del servidor (las 5 casillas = se puede guardar)', () => {
    for (const pw of ['Mi-Casa-2026!', 'Tr3s.Perros', 'Zz9#zzzz']) {
      assert.equal(passwordStrength(pw).level, 'strong', pw);
      assert.equal(validateNewPassword(pw).ok, true, pw);
    }
  });
  it('una contraseña de las que todos prueban se queda en Débil', () => {
    assert.equal(passwordStrength('Tablas20').level, 'good'); // 4 reglas, no es común
    assert.equal(passwordStrength('Passw0rd').level, 'weak'); // 4 reglas, pero es de las primeras que se prueban
    assert.equal(passwordStrength('accontrol123').level, 'weak');
  });
  it('las casillas de la pantalla son las mismas 5 reglas', () => {
    assert.deepEqual(PASSWORD_RULES.map(([k]) => k).sort(), Object.keys(passwordStrength('x').checks).sort());
  });
});

describe('correo con partes tapadas', () => {
  it('deja la primera y la última letra del nombre y el dominio entero', () => {
    assert.equal(maskEmail('dailyflutterui@gmail.com'), 'd••••••i@gmail.com');
    assert.equal(maskEmail('Ana@Correo.com'), 'a•a@correo.com');
    assert.equal(maskEmail('jo@x.do'), 'j•@x.do');
    assert.equal(maskEmail('j@x.do'), 'j•@x.do');
  });
  it('reconoce Gmail para decir «Revisa tu Gmail»', () => {
    assert.equal(isGmail('a@gmail.com'), true);
    assert.equal(isGmail(' A@GoogleMail.com '), true);
    assert.equal(isGmail('a@hotmail.com'), false);
    assert.equal(isGmail('a@gmail.com.do'), false);
  });
});

describe('las cuatro pantallas', () => {
  it('1. ¿Olvidaste tu contraseña?: paso 1 de 3, candado, correo con ✓ solo si está bien escrito', () => {
    const empty = page('forgot', { email: '' });
    assert.match(empty, /¿Olvidaste tu contraseña\?/);
    assert.match(empty, /aria-label="Paso 1 de 3"/);
    assert.match(empty, /class="recover__badge"/);
    assert.match(empty, /class="rfield" data-rfield/);
    assert.match(empty, /recover__cta is-waiting/);
    const ok = page('forgot');
    assert.match(ok, /class="rfield is-valid" data-rfield/);
    assert.doesNotMatch(ok, /is-waiting/);
  });
  it('2. Revisa tu Gmail: sobre, correo tapado, código y reenviar con cuenta regresiva', () => {
    const out = page('reset-sent', { canResend: false });
    assert.match(out, /Revisa tu Gmail/);
    assert.match(out, /class="recover-mail"/);
    assert.match(out, /d••••••i@gmail\.com/);
    assert.doesNotMatch(out, /dailyflutterui@gmail\.com/);
    assert.match(out, /aria-label="Paso 2 de 3"/);
    assert.match(out, /data-resend-label="Reenviar código" disabled/);
    assert.match(page('reset-sent', { email: 'ana@hotmail.com' }), /Revisa tu correo/);
  });
  it('3. Crea tu contraseña nueva: barra de 4 rayitas, 5 casillas, repetirla y sin «volver» (el código ya se usó)', () => {
    const out = page('recovery');
    assert.match(out, /Crea tu contraseña nueva/);
    assert.equal((out.match(/<i><\/i>/g) ?? []).length, 4);
    assert.equal((out.match(/data-pw-check=/g) ?? []).length, 5);
    assert.match(out, /name="password2"/);
    assert.doesNotMatch(out, /recover__back/);
  });
  it('4. Contraseña actualizada: palomita y botón para entrar', () => {
    const out = page('recovery-done');
    assert.match(out, /Contraseña actualizada/);
    assert.match(out, /class="recover-done"/);
    assert.match(out, /data-auth-continue/);
  });
});
