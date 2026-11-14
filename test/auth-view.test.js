import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountDangerPanel, accountPanel, passwordForm, runAccountAction, submitPasswordChange } from '../src/views/account.js';
import { AUTH_TITLES, renderAuth } from '../src/views/auth.js';

const base = { mode: 'signin', email: '', displayName: '', notice: null, busy: false, canResend: true };
const page = (patch) => renderAuth({ ...base, ...patch }).toString();

describe('pantallas de acceso', () => {
  const modes = ['signin', 'signup', 'forgot', 'recovery', 'check-email', 'reset-sent'];

  it('cada pantalla tiene su título principal y un título de pestaña', () => {
    for (const mode of modes) {
      const out = page({ mode, email: 'ana@correo.com' });
      assert.match(out, /<h1 class="welcome__title" id="auth-title">/, mode);
      assert.match(out, new RegExp(`data-auth-mode="${mode}"`), mode);
      assert.ok(AUTH_TITLES[mode], mode);
    }
  });

  it('los formularios traen los atributos que usan los administradores de contraseñas', () => {
    const signin = page({ mode: 'signin' });
    assert.match(signin, /autocomplete="current-password"/);
    assert.match(signin, /autocomplete="email"/);
    const signup = page({ mode: 'signup' });
    assert.match(signup, /autocomplete="new-password"/);
    assert.match(signup, /autocomplete="given-name"/);
    assert.match(page({ mode: 'recovery' }), /name="password2"/);
  });

  it('todas las contraseñas son type=password y tienen su botón de mostrar', () => {
    for (const mode of ['signin', 'signup', 'recovery']) {
      const out = page({ mode });
      const fields = out.match(/type="password"/g)?.length ?? 0;
      const toggles = out.match(/data-password-toggle=/g)?.length ?? 0;
      assert.ok(fields >= 1, mode);
      assert.equal(toggles, fields, mode);
    }
  });

  it('el correo escrito se muestra como texto, nunca como código (XSS)', () => {
    const evil = '"><img src=x onerror=alert(1)>@a.co';
    for (const mode of modes) {
      const out = page({ mode, email: evil });
      assert.doesNotMatch(out, /<img src=x/, mode);
      assert.doesNotMatch(out, /"><img/, mode);
    }
    assert.match(page({ mode: 'signin', email: evil }), /value="&quot;&gt;&lt;img/);
  });

  it('el nombre escrito también se escapa', () => {
    assert.doesNotMatch(page({ mode: 'signup', displayName: '"><script>x</script>' }), /<script>/);
  });

  it('el aviso de error se anuncia como alerta y los otros como estado', () => {
    assert.match(page({ notice: { kind: 'error', text: 'Mal' } }), /role="alert" data-auth-notice/);
    assert.match(page({ notice: { kind: 'info', text: 'Bien' } }), /role="status" data-auth-notice/);
    assert.doesNotMatch(page({ notice: null }), /data-auth-notice/);
  });

  it('el aviso se escapa', () => {
    assert.doesNotMatch(page({ notice: { kind: 'error', text: '<b>x</b>' } }), /<b>x<\/b>/);
  });

  it('con una petición en curso el botón principal está desactivado y dice "Un momento…"', () => {
    const out = page({ mode: 'signin', busy: true });
    assert.match(out, /disabled>Un momento…<\/button>/);
    assert.match(page({ mode: 'signin', busy: false }), />Entrar<\/button>/);
  });

  it('reenviar el correo solo está disponible cuando toca', () => {
    assert.match(page({ mode: 'check-email', email: 'a@b.co', canResend: true }), /data-auth-resend >Reenviar|data-auth-resend\s*>Reenviar/);
    assert.match(page({ mode: 'check-email', email: 'a@b.co', canResend: false }), /data-auth-resend disabled>/);
    assert.match(page({ mode: 'check-email', email: 'a@b.co', canResend: true, busy: true }), /data-auth-resend disabled>/);
  });

  it('la pantalla de revisar el correo no promete que la cuenta exista (no revela quién tiene cuenta)', () => {
    assert.match(page({ mode: 'reset-sent', email: 'a@b.co' }), /Si a@b\.co tiene una cuenta/);
    assert.match(page({ mode: 'check-email', email: 'a@b.co' }), /Si ya tenías una cuenta/);
  });

  it('entrar y crear cuenta dicen con honestidad dónde están los datos', () => {
    for (const mode of ['signin', 'signup']) {
      assert.match(page({ mode }), /se guardan <strong>en este dispositivo<\/strong>/, mode);
      assert.match(page({ mode }), /copia en la nube/, mode);
    }
  });

  it('entrar enlaza a crear cuenta y a recuperar; crear cuenta enlaza a entrar', () => {
    const signin = page({ mode: 'signin' });
    assert.match(signin, /data-auth-go="signup"/);
    assert.match(signin, /data-auth-go="forgot"/);
    assert.match(page({ mode: 'signup' }), /data-auth-go="signin"/);
    assert.match(page({ mode: 'forgot' }), /data-auth-go="signin"/);
  });

  it('los mensajes de error de campo tienen su lugar (data-error-for)', () => {
    assert.match(page({ mode: 'signin' }), /data-error-for="email"/);
    assert.match(page({ mode: 'signin' }), /data-error-for="password"/);
    assert.match(page({ mode: 'signin' }), /data-error-for="form"/);
    assert.match(page({ mode: 'signup' }), /data-error-for="displayName"/);
    assert.match(page({ mode: 'recovery' }), /data-error-for="password2"/);
  });
});

describe('Ajustes → Cuenta', () => {
  const account = { email: 'ana@correo.com', signOut: async () => {}, changePassword: async () => ({ ok: true }), deleteAccount: async () => ({ ok: true }) };

  it('sin cuenta (modo local) lo dice y no ofrece cerrar sesión ni eliminar', () => {
    const panel = accountPanel(null).toString();
    assert.match(panel, /sin cuenta/);
    assert.doesNotMatch(panel, /account-signout|account-delete/);
    assert.equal(accountDangerPanel(null), '');
  });

  it('con cuenta muestra el correo (escapado) y los botones', () => {
    const panel = accountPanel({ ...account, email: '<i>x</i>@a.co' }).toString();
    assert.doesNotMatch(panel, /<i>x<\/i>/);
    const ok = accountPanel(account).toString();
    assert.match(ok, /data-account-email>ana@correo\.com</);
    assert.match(ok, /data-action="account-signout"/);
    assert.match(ok, /data-action="account-password"/);
    assert.match(accountDangerPanel(account).toString(), /data-action="account-delete"/);
  });

  it('dice con claridad que los datos siguen solo en este dispositivo y que cerrar sesión no los borra', () => {
    const panel = accountPanel(account).toString();
    assert.match(panel, /solo en este dispositivo/);
    assert.match(panel, /se conservan/);
    assert.match(accountDangerPanel(account).toString(), /No borra los datos guardados en este dispositivo/);
  });

  it('runAccountAction atiende solo las acciones de la cuenta', () => {
    let out = 0;
    const spy = { ...account, signOut: async () => { out += 1; } };
    assert.equal(runAccountAction(spy, 'account-signout'), true);
    assert.equal(out, 1);
    assert.equal(runAccountAction(spy, 'cat-new'), false);
    assert.equal(runAccountAction(spy, undefined), false);
    assert.equal(runAccountAction(spy, 'account-otra'), false);
    assert.equal(runAccountAction(null, 'account-signout'), false);
  });
});

describe('Ajustes → Cuenta → Cambiar contraseña', () => {
  /** Cuenta falsa que recuerda qué se le pidió. @param {any} [reply] */
  function spyAccount(reply = { ok: true }) {
    const calls = [];
    return { calls, email: 'ana@correo.com', signOut: async () => {}, deleteAccount: async () => ({ ok: true }), changePassword: async (input) => { calls.push(input); return reply; } };
  }
  const fill = (over = {}) => ({ currentPassword: 'Vela9Lima', password: 'Nueva-Clave-77', password2: 'Nueva-Clave-77', ...over });

  it('el formulario tiene tres campos: actual (primero, con el foco), nueva y repetir', () => {
    const form = passwordForm().toString();
    const names = [...form.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(names, ['currentPassword', 'password', 'password2']);
    assert.match(form, /<label for="pw-current">Contraseña actual<\/label>/);
    assert.match(form, /name="currentPassword"[^>]*autocomplete="current-password"[^>]*data-autofocus/);
    assert.match(form, /name="password"[^>]*autocomplete="new-password"/);
    for (const field of ['currentPassword', 'password', 'password2', 'form']) assert.match(form, new RegExp(`data-error-for="${field}"`));
    assert.equal((form.match(/data-autofocus/g) ?? []).length, 1);
  });

  it('todo bien: manda la actual y la nueva a la cuenta', async () => {
    const account = spyAccount();
    assert.deepEqual(await submitPasswordChange(account, fill()), { ok: true });
    assert.deepEqual(account.calls, [{ currentPassword: 'Vela9Lima', newPassword: 'Nueva-Clave-77' }]);
  });

  it('actual vacía: lo pide en su campo y no llama a la cuenta', async () => {
    const account = spyAccount();
    for (const values of [fill({ currentPassword: '' }), { password: 'Nueva-Clave-77', password2: 'Nueva-Clave-77' }]) {
      assert.deepEqual(await submitPasswordChange(account, values), { ok: false, errors: { currentPassword: 'Escribe tu contraseña actual.' } });
    }
    assert.equal(account.calls.length, 0);
  });

  it('la nueva y la repetida no coinciden: lo dice y no llama a la cuenta', async () => {
    const account = spyAccount();
    assert.deepEqual(await submitPasswordChange(account, fill({ password2: 'Otra-Clave-88' })), { ok: false, errors: { password2: 'Las dos contraseñas deben ser iguales.' } });
    assert.equal(account.calls.length, 0);
  });

  it('actual incorrecta (respuesta de la cuenta): el mensaje va al campo «actual»', async () => {
    const account = spyAccount({ ok: false, error: 'La contraseña actual no es correcta.', field: 'currentPassword' });
    assert.deepEqual(await submitPasswordChange(account, fill()), { ok: false, errors: { currentPassword: 'La contraseña actual no es correcta.' } });
  });

  it('un error sin campo va al aviso general del formulario', async () => {
    const account = spyAccount({ ok: false, error: 'No hay conexión con el servidor.' });
    assert.deepEqual(await submitPasswordChange(account, fill()), { ok: false, errors: { form: 'No hay conexión con el servidor.' } });
  });
});
