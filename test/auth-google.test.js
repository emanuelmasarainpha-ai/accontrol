// 0.18.7 — Pantalla de entrar sin panel, «Continuar con Google» (PKCE) y el ojo dentro del campo de contraseña.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  base64Url, createAuthClient, emailFromIdToken, GOOGLE_IDT_KEY, GOOGLE_NO_ACCOUNT_MARK, OAUTH_VERIFIER_KEY, pkceChallenge, sha256Hex,
} from '../src/auth/authClient.js';
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

describe('0.20.1: Google directo en el navegador (sin pasar por la dirección de Supabase)', () => {
  const CLIENT = '123-abc.apps.googleusercontent.com';
  const BACK = 'https://accontrol.example/';
  /** Va a Google y devuelve lo que se guardó y la dirección. */
  async function start(auth, items) {
    const url = new URL(await auth.googleIdTokenUrl(BACK, CLIENT));
    const saved = JSON.parse(items.get(GOOGLE_IDT_KEY));
    return { url, saved };
  }

  it('el nonce que va a Google es el SHA-256 en hexadecimal (comparado con node:crypto)', async () => {
    for (const v of ['abc', 'x'.repeat(43), 'ñandú-🙂']) assert.equal(await sha256Hex(v), createHash('sha256').update(v).digest('hex'), v);
  });
  it('ir a Google: directo a accounts.google.com, vuelve a la app, pide solo nombre y correo; a Google va la huella del nonce', async () => {
    const { auth, items, calls } = setup();
    const { url, saved } = await start(auth, items);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), CLIENT);
    assert.equal(url.searchParams.get('redirect_uri'), BACK, 'vuelve a ACCONTROL, no a supabase.co');
    assert.equal(url.searchParams.get('response_type'), 'id_token');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('state'), saved.state);
    assert.equal(url.searchParams.get('nonce'), await sha256Hex(saved.nonce));
    assert.notEqual(url.searchParams.get('nonce'), saved.nonce, 'el nonce sin cifrar nunca sale del dispositivo hacia Google');
    assert.ok(saved.nonce.length >= 40 && saved.state.length >= 30, 'aleatorios largos');
    assert.equal(calls.length, 0, 'ir a Google no le pregunta nada a Supabase');
  });
  it('al volver, da el token a Supabase con el nonce sin cifrar y abre sesión; sirve una sola vez', async () => {
    const { auth, items, calls } = setup(() => ({ status: 200, body: SESSION_BODY }));
    const { saved } = await start(auth, items);
    assert.deepEqual(await auth.consumeGoogleIdToken(`#state=${saved.state}&id_token=eyJ.token.firma`), { kind: 'signed-in' });
    const call = calls.at(-1);
    assert.equal(call.url, `${URL_}/auth/v1/token?grant_type=id_token`);
    assert.deepEqual(call.body, { provider: 'google', id_token: 'eyJ.token.firma', nonce: saved.nonce });
    assert.equal(auth.getUser()?.email, 'ana@gmail.com');
    assert.equal(items.has(GOOGLE_IDT_KEY), false);
    assert.equal((await auth.consumeGoogleIdToken(`#state=${saved.state}&id_token=otro`)).kind, 'error', 'repetir la vuelta no vale');
  });
  it('una vuelta con otra marca (state) no abre sesión ni se le pregunta a Supabase', async () => {
    const { auth, items, calls } = setup(() => ({ status: 200, body: SESSION_BODY }));
    await start(auth, items);
    const r = await auth.consumeGoogleIdToken('#state=ajena&id_token=eyJ.robado');
    assert.equal(r.kind, 'error');
    assert.equal(calls.length, 0);
    assert.equal(auth.getUser(), null);
    const sin = setup(() => ({ status: 200, body: SESSION_BODY }));
    assert.equal((await sin.auth.consumeGoogleIdToken('#state=x&id_token=eyJ.robado')).kind, 'error', 'sin intento guardado tampoco');
    assert.equal(sin.calls.length, 0);
  });
  it('si tardó más de 10 minutos, hay que empezar de nuevo', async () => {
    let now = NOW;
    const { auth, items, calls } = setup(() => ({ status: 200, body: SESSION_BODY }), () => now);
    const { saved } = await start(auth, items);
    now += 11 * 60 * 1000;
    assert.match(/** @type {any} */ (await auth.consumeGoogleIdToken(`#state=${saved.state}&id_token=t`)).message, /empieza otra vez/);
    assert.equal(calls.length, 0);
  });
  it('si la persona canceló en Google lo dice; si Supabase rechaza el token, no abre sesión', async () => {
    const a = setup();
    const { saved } = await start(a.auth, a.items);
    assert.match(/** @type {any} */ (await a.auth.consumeGoogleIdToken(`#error=access_denied&state=${saved.state}`)).message, /No se pudo entrar con Google/);
    const b = setup(() => ({ status: 400, body: { error_code: 'bad_jwt', msg: 'nonce mismatch' } }));
    const s2 = await start(b.auth, b.items);
    assert.equal((await b.auth.consumeGoogleIdToken(`#state=${s2.saved.state}&id_token=t`)).kind, 'error');
    assert.equal(b.auth.getUser(), null);
  });
  it('lo demás no es de Google: rutas de la app y enlaces de correo siguen su camino', async () => {
    const { auth } = setup();
    for (const h of ['', '#/inicio', '#access_token=a&refresh_token=r&type=recovery', '#error=otp_expired&error_code=otp_expired']) {
      assert.deepEqual(await auth.consumeGoogleIdToken(h), { kind: 'none' }, h);
    }
  });
});

describe('0.20.2: Google solo para quien ya tiene cuenta (como GitHub)', () => {
  const CLIENT = '123-abc.apps.googleusercontent.com';
  const HOOK_SQL = readFileSync(new URL('../supabase/migrations/20261126000100_google_solo_cuentas.sql', import.meta.url), 'utf8');
  /** Un id_token de mentira con el correo dentro (como los de Google: cabecera.datos.firma en base64url). */
  const fakeIdToken = (email) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ email, sub: '1' })).toString('base64url')}.firma`;
  const REJECTED = { status: 403, body: { code: 403, error_code: 'unexpected_failure', msg: 'sin_cuenta_google: esta cuenta de Google todavía no tiene cuenta en ACCONTROL.' } };

  it('la regla del servidor rechaza cuentas nuevas que no vienen del correo, y solo la puede usar el servidor de cuentas', () => {
    assert.match(HOOK_SQL, /create or replace function public\.hook_google_solo_cuentas\(event jsonb\)/);
    assert.match(HOOK_SQL, /if provider <> 'email' then/);
    assert.match(HOOK_SQL, /'http_code', 403/);
    assert.ok(HOOK_SQL.includes(GOOGLE_NO_ACCOUNT_MARK), 'el mensaje lleva la marca que la app reconoce');
    assert.match(HOOK_SQL, /set search_path = ''/);
    assert.match(HOOK_SQL, /grant execute on function public\.hook_google_solo_cuentas\(jsonb\) to supabase_auth_admin/);
    assert.match(HOOK_SQL, /revoke execute on function public\.hook_google_solo_cuentas\(jsonb\) from authenticated, anon, public/);
    assert.doesNotMatch(HOOK_SQL, /security definer|insert |update |delete /i, 'no toca datos');
  });
  it('web: si Google no tiene cuenta, lo explica, manda a «Crear cuenta» y deja escrito el correo de Google', async () => {
    const { auth, items } = setup(() => REJECTED);
    const url = new URL(await auth.googleIdTokenUrl('https://accontrol.example/', CLIENT));
    const r = /** @type {any} */ (await auth.consumeGoogleIdToken(`#state=${url.searchParams.get('state')}&id_token=${fakeIdToken('nuevo@gmail.com')}`));
    assert.equal(r.kind, 'error');
    assert.equal(r.signup, true);
    assert.equal(r.email, 'nuevo@gmail.com');
    assert.match(r.message, /Primero crea tu cuenta con tu correo/);
    assert.equal(auth.getUser(), null, 'no abre sesión');
    assert.equal(items.has(GOOGLE_IDT_KEY), false);
  });
  it('otros errores de Supabase no mandan a «Crear cuenta»', async () => {
    const { auth } = setup(() => ({ status: 400, body: { error_code: 'bad_jwt', msg: 'nonce mismatch' } }));
    const url = new URL(await auth.googleIdTokenUrl('https://accontrol.example/', CLIENT));
    const r = /** @type {any} */ (await auth.consumeGoogleIdToken(`#state=${url.searchParams.get('state')}&id_token=${fakeIdToken('a@b.com')}`));
    assert.equal(r.kind, 'error');
    assert.equal(r.signup, undefined);
  });
  it('Android (por Supabase): el rechazo llega en la dirección y también se reconoce', async () => {
    const { auth } = setup();
    await auth.googleSignInUrl('https://accontrol.example/');
    const r = /** @type {any} */ (await auth.consumeOAuthCode(`?error=server_error&error_description=${encodeURIComponent('sin_cuenta_google: esta cuenta…')}`));
    assert.equal(r.kind, 'error');
    assert.equal(r.signup, true);
    assert.match(r.message, /Primero crea tu cuenta/);
  });
  it('el correo de la respuesta de Google se lee aunque tenga tildes; si viene roto, queda vacío', () => {
    assert.equal(emailFromIdToken(fakeIdToken('josé@gmail.com')), 'josé@gmail.com');
    assert.equal(emailFromIdToken('no-es-un-token'), '');
    assert.equal(emailFromIdToken('a.%%%.c'), '');
  });
  it('quien ya tiene cuenta entra normal con Google (la regla solo actúa al CREAR una cuenta)', async () => {
    const { auth } = setup(() => ({ status: 200, body: SESSION_BODY }));
    const url = new URL(await auth.googleIdTokenUrl('https://accontrol.example/', CLIENT));
    assert.deepEqual(await auth.consumeGoogleIdToken(`#state=${url.searchParams.get('state')}&id_token=${fakeIdToken('ana@gmail.com')}`), { kind: 'signed-in' });
  });
  it('la pantalla de «Crear cuenta» se puede abrir con el correo ya escrito y no ofrece Google', () => {
    const page = String(renderAuth({ mode: 'signup', email: 'nuevo@gmail.com', displayName: '', notice: { kind: 'info', text: 'x' }, busy: false, canResend: true, google: 'on' }));
    assert.match(page, /value="nuevo@gmail\.com"/);
    assert.doesNotMatch(page, /data-auth-google/);
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
