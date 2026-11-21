// 0.18.7 — Pantalla de entrar sin panel, «Continuar con Google» (PKCE) y el ojo dentro del campo de contraseña.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { base64Url, createAuthClient, OAUTH_VERIFIER_KEY, pkceChallenge } from '../src/auth/authClient.js';
import { loginReturnQuery, NATIVE_LOGIN_RETURN } from '../src/app/nativeShell.js';
import { renderAuth } from '../src/views/auth.js';
import { passwordInput } from '../src/ui/passwordToggle.js';

const URL_ = 'https://p.supabase.co';
const NOW = 1_795_000_000_000;

/** Almacén en memoria y una red de mentira. */
function setup(answer = () => ({ status: 200, body: {} }), now = () => NOW) {
  const items = new Map();
  const storage = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v), removeItem: (k) => items.delete(k) };
  const calls = [];
  const auth = createAuthClient({
    url: URL_, publishableKey: 'k', storage: /** @type {any} */ (storage), now, locks: null,
    setTimer: () => 0, clearTimer: () => {},
    fetch: /** @type {any} */ (async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
      const { status, body } = answer(url, init);
      return { ok: status < 400, status, text: async () => JSON.stringify(body) };
    }),
  });
  return { auth, items, calls };
}

const SESSION_BODY = {
  access_token: 'a'.repeat(40), refresh_token: 'r'.repeat(20), expires_in: 3600, token_type: 'bearer',
  user: { id: '6f1c2b6e-3a4d-4c5e-9f00-1a2b3c4d5e6f', email: 'ana@gmail.com', user_metadata: { full_name: 'Ana' } },
};

describe('PKCE: la clave de un solo uso', () => {
  it('el desafío es el SHA-256 de la clave en base64url (comparado con node:crypto, otra implementación)', async () => {
    for (const v of ['dBjftJeZ4CVP-mJ92K9Uh8ufyWnp6R1TrKnrySOiwKA', 'x'.repeat(64), 'ñandú-🙂']) {
      assert.equal(await pkceChallenge(v), createHash('sha256').update(v).digest('base64url'), v);
    }
    assert.equal(base64Url(Uint8Array.from([251, 255, 191])), '-_-_');
  });
  it('ir a Google: guarda la clave y manda solo su huella', async () => {
    const { auth, items } = setup();
    const url = new URL(await auth.googleSignInUrl('https://accontrol.example/'));
    assert.equal(url.origin + url.pathname, `${URL_}/auth/v1/authorize`);
    assert.equal(url.searchParams.get('provider'), 'google');
    assert.equal(url.searchParams.get('redirect_to'), 'https://accontrol.example/');
    assert.equal(url.searchParams.get('code_challenge_method'), 's256');
    const saved = JSON.parse(items.get(OAUTH_VERIFIER_KEY));
    assert.ok(saved.verifier.length >= 43);
    assert.equal(url.searchParams.get('code_challenge'), await pkceChallenge(saved.verifier));
    assert.ok(!url.toString().includes(saved.verifier), 'la clave nunca sale del dispositivo');
  });
});

describe('la vuelta de Google', () => {
  it('cambia el código por la sesión con la clave guardada, y la clave sirve una sola vez', async () => {
    const { auth, items, calls } = setup(() => ({ status: 200, body: SESSION_BODY }));
    await auth.googleSignInUrl('https://accontrol.example/');
    const verifier = JSON.parse(items.get(OAUTH_VERIFIER_KEY)).verifier;
    assert.deepEqual(await auth.consumeOAuthCode('?code=abc123'), { kind: 'signed-in' });
    const call = calls.at(-1);
    assert.equal(call.url, `${URL_}/auth/v1/token?grant_type=pkce`);
    assert.deepEqual(call.body, { auth_code: 'abc123', code_verifier: verifier });
    assert.equal(auth.getUser()?.email, 'ana@gmail.com');
    assert.equal(items.has(OAUTH_VERIFIER_KEY), false);
    assert.equal((await auth.consumeOAuthCode('?code=otro')).kind, 'error', 'sin clave: no se acepta otro código');
  });
  it('un código que no se pidió en este dispositivo no abre sesión', async () => {
    const { auth, calls } = setup(() => ({ status: 200, body: SESSION_BODY }));
    const r = await auth.consumeOAuthCode('?code=robado');
    assert.equal(r.kind, 'error');
    assert.equal(calls.length, 0, 'ni siquiera se le pregunta al servidor');
    assert.equal(auth.getUser(), null);
  });
  it('si tardó más de 10 minutos, hay que empezar de nuevo', async () => {
    let now = NOW;
    const { auth } = setup(() => ({ status: 200, body: SESSION_BODY }), () => now);
    await auth.googleSignInUrl('https://accontrol.example/');
    now += 11 * 60 * 1000;
    assert.match(/** @type {any} */ (await auth.consumeOAuthCode('?code=abc')).message, /empieza otra vez/);
  });
  it('si la persona canceló en Google, lo dice; sin nada en la dirección, no hace nada', async () => {
    const { auth } = setup();
    await auth.googleSignInUrl('https://accontrol.example/');
    assert.equal((await auth.consumeOAuthCode('?error=access_denied&error_description=cancel')).kind, 'error');
    assert.deepEqual(await auth.consumeOAuthCode(''), { kind: 'none' });
    assert.deepEqual(await auth.consumeOAuthCode('?foo=1'), { kind: 'none' });
  });
  it('pregunta al servidor si Google está activado', async () => {
    const on = setup(() => ({ status: 200, body: { external: { google: true, email: true } } }));
    assert.deepEqual(await on.auth.providers(), { ok: true, google: true });
    const off = setup(() => ({ status: 200, body: { external: { google: false } } }));
    assert.deepEqual(await off.auth.providers(), { ok: true, google: false });
  });
});

describe('en la app de Android', () => {
  it('reconoce la vuelta a su dirección propia y nada más', () => {
    assert.equal(loginReturnQuery(`${NATIVE_LOGIN_RETURN}?code=abc`), 'code=abc');
    assert.equal(loginReturnQuery(`${NATIVE_LOGIN_RETURN}/?code=abc#x`), 'code=abc');
    assert.equal(loginReturnQuery('https://evil.example/?code=abc'), null);
    assert.equal(loginReturnQuery(undefined), null);
  });
  it('AndroidManifest abre la app con esa dirección', () => {
    const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    assert.match(manifest, /<data android:scheme="com\.accontrol\.app" android:host="login-callback" \/>/);
    assert.match(manifest, /android\.intent\.category\.BROWSABLE/);
  });
});

describe('la pantalla de entrar', () => {
  const base = { mode: /** @type {const} */ ('signin'), email: '', displayName: '', notice: null, busy: false, canResend: true };
  it('sin el panel alrededor de los campos (el estilo lo quita) y con Google debajo de «Entrar»', () => {
    const page = String(renderAuth({ ...base, google: 'checking' }));
    const entrar = page.indexOf('>Entrar<');
    const google = page.indexOf('Continuar con Google');
    assert.ok(entrar > 0 && google > entrar, 'Google va debajo de Entrar');
    assert.match(page, /data-auth-google disabled/, 'desactivado mientras no se sabe si Google está encendido');
    const css = readFileSync(new URL('../src/styles/views.css', import.meta.url), 'utf8');
    assert.match(css, /\.auth form\.panel \{[^}]*background: none;[^}]*box-shadow: none;/s);
  });
  it('sin dirección de vuelta no hay botón de Google', () => {
    assert.ok(!String(renderAuth({ ...base, google: 'none' })).includes('Continuar con Google'));
    assert.ok(!String(renderAuth(base)).includes('Continuar con Google'));
  });
  it('el ojo va dentro del campo y empieza escondido (aparece al escribir)', () => {
    const field = String(passwordInput({ id: 'x', name: 'password', autocomplete: 'current-password', describedBy: 'x-error', label: 'contraseña' }));
    assert.match(field, /<div class="input-pass">\s*<input id="x"[^>]*type="password"/);
    assert.match(field, /data-password-toggle="x"[^>]*hidden/);
    const page = String(renderAuth(base));
    assert.ok(!page.includes('input-row"><input id="auth-password"'), 'ya no hay botón al lado');
  });
});

describe('pantalla de entrar sin la nota de abajo (pedido de la persona)', () => {
  const base = { mode: /** @type {const} */ ('signin'), email: '', displayName: '', notice: null, busy: false, canResend: true };
  it('«Entrar» ya no trae la nota de la contraseña y los datos; «Crear cuenta» la conserva', () => {
    assert.ok(!String(renderAuth(base)).includes('nunca la ve ACCONTROL'));
    assert.ok(String(renderAuth({ ...base, mode: 'signup' })).includes('nunca la ve ACCONTROL'));
  });
});

describe('login: tema claro/oscuro (pedido de la persona)', () => {
  const css = readFileSync(new URL('../src/styles/views.css', import.meta.url), 'utf8');
  it('la curva de arriba cambia de color con el tema: lila con letras oscuras en claro, morado profundo con letras blancas en oscuro', () => {
    assert.match(css, /body\.is-auth \{[^}]*--auth-band: #ddd0f1;[^}]*--auth-band-ink: #34204f;/s);
    assert.match(css, /:root\[data-theme='dark'\] body\.is-auth \{[^}]*--auth-band: var\(--kind-deep\);[^}]*--auth-band-ink: #fff;/s);
    assert.match(css, /\.auth \.welcome__head::before \{[^}]*background: var\(--auth-band\);/s);
    assert.match(css, /\.auth \.welcome__head \{[^}]*color: var\(--auth-band-ink\);/s);
  });
  it('en PC el sol y la luna van fijos en la esquina de arriba a la derecha', () => {
    assert.match(css, /@media \(min-width: 900px\) \{\s*\.auth__theme \{[^}]*position: fixed;[^}]*top: [^;]+;[^}]*right: [^;]+;/s);
  });
});
