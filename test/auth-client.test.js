import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAccountApi } from '../src/app/accountApi.js';
import { createAuthClient, LINK_REQUESTS_KEY, SESSION_KEY, sessionFromBody } from '../src/auth/authClient.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const URL = 'https://proyecto.supabase.co';
const KEY = 'sb_publishable_prueba';
const GOOD_PASSWORD = 'Vela9Lima!'; // cumple la regla de Supabase: minúscula, mayúscula, número y símbolo
const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** El reloj es UNO solo para el cliente y el servidor simulado: así los vencimientos coinciden. */
let clockMs = Date.UTC(2026, 10, 11, 12, 0, 0);
const mockServer = (options = {}) => createMockAuthServer({ now: () => clockMs, ...options });

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

/** Reloj y temporizadores falsos: el tiempo solo avanza cuando la prueba lo dice. */
function fakeTime() {
  const timers = [];
  return {
    now: () => clockMs,
    advance: (ms) => {
      clockMs += ms;
    },
    timers,
    setTimer: (callback, ms) => {
      const handle = { callback, ms, cleared: false, fired: false, unref() {} };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => {
      if (handle) handle.cleared = true;
    },
    /** Los que siguen esperando (los de "tiempo máximo de una petición" se limpian solos al terminar). */
    pending: () => timers.filter((h) => !h.cleared && !h.fired),
    async fire(handle) {
      handle.fired = true;
      await handle.callback();
    },
  };
}

function setup({ server = mockServer(), storage = memoryStorage(), time = fakeTime(), locks = null, redirectTo = 'https://app.test/' } = {}) {
  const auth = createAuthClient({
    url: URL, publishableKey: KEY, fetch: server.fetch, storage, now: time.now, locks,
    setTimer: time.setTimer, clearTimer: time.clearTimer, redirectTo,
  });
  const events = [];
  auth.onChange((event) => events.push(event.type));
  return { auth, server, storage, time, events };
}

const stored = (storage) => JSON.parse(storage.map.get(SESSION_KEY) ?? 'null');

async function signedUp(ctx, email = 'ana@correo.com') {
  const result = await ctx.auth.signUp({ email, password: GOOD_PASSWORD, displayName: 'Ana' });
  assert.equal(result.ok, true);
  return result;
}

describe('crear cuenta', () => {
  it('sin confirmación de correo: entra de una vez, guarda la sesión y manda lo esperado al servidor', async () => {
    const ctx = setup();
    const result = await ctx.auth.signUp({ email: '  Ana@Correo.com ', password: GOOD_PASSWORD, displayName: ' Ana  María ' });
    assert.deepEqual(result, { ok: true, signedIn: true, email: 'ana@correo.com' });

    const call = ctx.server.calls[0];
    assert.equal(`${call.method} ${call.path}`, 'POST /auth/v1/signup');
    assert.deepEqual(call.body, { email: 'ana@correo.com', password: GOOD_PASSWORD, data: { display_name: 'Ana María' } });
    assert.equal(call.query.redirect_to, 'https://app.test/');
    assert.equal(call.apikey, KEY);
    assert.equal(call.token, null, 'al crear la cuenta no hay sesión: no se manda Authorization');

    const user = ctx.auth.getUser();
    assert.equal(user?.email, 'ana@correo.com');
    assert.equal(user?.displayName, 'Ana María');
    const saved = stored(ctx.storage);
    assert.equal(saved.user.id, user?.id);
    assert.equal(typeof saved.accessToken, 'string');
    assert.deepEqual(ctx.events, ['signed-in']);
  });

  it('con confirmación de correo: no hay sesión, se avisa que falta confirmar y nada se guarda', async () => {
    const ctx = setup({ server: mockServer({ confirmEmails: true }) });
    const result = await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.deepEqual(result, { ok: true, signedIn: false, email: 'ana@correo.com' });
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.has(SESSION_KEY), false, 'no se guarda ninguna sesión');
    assert.deepEqual([...ctx.storage.map.keys()], [LINK_REQUESTS_KEY], 'solo se anota que el enlace se pidió aquí');
    assert.deepEqual(ctx.server.emails.map(({ kind, to }) => ({ kind, to })), [{ kind: 'confirm', to: 'ana@correo.com' }]);
    assert.equal(ctx.server.emails[0].code.length, 6, 'el mensaje trae un código de 6 dígitos');
    assert.deepEqual(ctx.events, []);
  });

  it('un nombre vacío no manda el campo display_name', async () => {
    const ctx = setup();
    await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD, displayName: '   ' });
    assert.deepEqual(ctx.server.calls[0].body.data, {});
  });

  it('valida antes de molestar al servidor: correo, contraseña y nombre', async () => {
    const ctx = setup();
    const badEmail = await ctx.auth.signUp({ email: 'ana', password: GOOD_PASSWORD });
    assert.equal(badEmail.ok === false && badEmail.error.field, 'email');
    const weak = await ctx.auth.signUp({ email: 'ana@correo.com', password: '1234' });
    assert.equal(weak.ok === false && weak.error.field, 'password');
    const longName = await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD, displayName: 'x'.repeat(41) });
    assert.equal(longName.ok === false && longName.error.field, 'displayName');
    assert.equal(ctx.server.calls.length, 0, 'ninguna petición salió');
    assert.equal(badEmail.ok === false && badEmail.error.code, 'validation');
  });

  it('correo ya registrado (sin confirmación): mensaje claro en español', async () => {
    const ctx = setup();
    await signedUp(ctx);
    await ctx.auth.signOut();
    const again = await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.equal(again.ok, false);
    assert.equal(again.ok === false && again.error.code, 'user_already_exists');
    assert.match(again.ok === false ? again.error.message : '', /ya tiene una cuenta/);
  });

  it('correo ya registrado (con confirmación): responde igual que uno nuevo, sin revelar nada', async () => {
    const ctx = setup({ server: mockServer({ confirmEmails: true }) });
    await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    const again = await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.deepEqual(again, { ok: true, signedIn: false, email: 'ana@correo.com' });
  });

  it('si no hay red devuelve un error de conexión y no deja sesión', async () => {
    const ctx = setup();
    ctx.server.offline = true;
    const result = await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.equal(result.ok === false && result.error.code, 'network');
    assert.match(result.ok === false ? result.error.message : '', /conexión/);
    assert.equal(ctx.auth.getSession(), null);
  });
});

describe('entrar', () => {
  it('con la contraseña correcta guarda la sesión; el correo no distingue mayúsculas ni espacios', async () => {
    const server = mockServer();
    await signedUp(setup({ server }));
    const ctx = setup({ server });
    const result = await ctx.auth.signIn({ email: ' ANA@correo.COM ', password: GOOD_PASSWORD });
    assert.deepEqual(result, { ok: true });
    const call = ctx.server.calls.at(-1);
    assert.equal(call.query.grant_type, 'password');
    assert.equal(call.body.email, 'ana@correo.com');
    assert.equal(ctx.auth.getUser()?.email, 'ana@correo.com');
    assert.deepEqual(ctx.events, ['signed-in']);
  });

  it('contraseña incorrecta: mensaje en español, sin sesión ni evento', async () => {
    const server = mockServer();
    await signedUp(setup({ server }));
    const ctx = setup({ server });
    const result = await ctx.auth.signIn({ email: 'ana@correo.com', password: 'otra-cosa-1' });
    assert.equal(result.ok === false && result.error.code, 'invalid_credentials');
    assert.equal(result.ok === false && result.error.message, 'Correo o contraseña incorrectos.');
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.size, 0);
    assert.deepEqual(ctx.events, []);
  });

  it('correo sin confirmar: lo dice', async () => {
    const server = mockServer({ confirmEmails: true });
    const ctx = setup({ server });
    await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    const result = await ctx.auth.signIn({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.equal(result.ok === false && result.error.code, 'email_not_confirmed');
    server.confirm('ana@correo.com');
    assert.deepEqual(await ctx.auth.signIn({ email: 'ana@correo.com', password: GOOD_PASSWORD }), { ok: true });
  });

  it('no manda nada al servidor si falta el correo o la contraseña', async () => {
    const ctx = setup();
    const noEmail = await ctx.auth.signIn({ email: '', password: 'x' });
    assert.equal(noEmail.ok === false && noEmail.error.field, 'email');
    const noPassword = await ctx.auth.signIn({ email: 'ana@correo.com', password: '' });
    assert.equal(noPassword.ok === false && noPassword.error.field, 'password');
    assert.equal(ctx.server.calls.length, 0);
  });

  it('entrar NO exige que la contraseña cumpla las reglas de creación (la que ya existe no se juzga)', async () => {
    const server = mockServer();
    server.users.set('vieja@correo.com', { id: UID, email: 'vieja@correo.com', password: 'abc123', confirmed: true, metadata: {} });
    const ctx = setup({ server });
    assert.deepEqual(await ctx.auth.signIn({ email: 'vieja@correo.com', password: 'abc123' }), { ok: true });
  });

  it('un servidor caído (500) o saturado (429) da un mensaje distinto a "contraseña incorrecta"', async () => {
    const ctx = setup();
    ctx.server.failNext = { status: 500, body: { message: 'boom' } };
    const down = await ctx.auth.signIn({ email: 'ana@correo.com', password: 'x' });
    assert.match(down.ok === false ? down.error.message : '', /problema/);
    ctx.server.failNext = { status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'too many' } };
    const busy = await ctx.auth.signIn({ email: 'ana@correo.com', password: 'x' });
    assert.match(busy.ok === false ? busy.error.message : '', /Demasiados intentos/);
  });

  it('una respuesta 200 sin tokens no cuenta como sesión', async () => {
    const ctx = setup();
    ctx.server.failNext = { status: 200, body: {} };
    const result = await ctx.auth.signIn({ email: 'ana@correo.com', password: 'x' });
    assert.equal(result.ok === false && result.error.code, 'invalid_response');
    assert.equal(ctx.auth.getSession(), null);
  });

  it('si la petición tarda más del máximo, se corta y se avisa', async () => {
    const time = fakeTime();
    const hanging = (url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('abortado'), { name: 'AbortError' })));
    });
    const auth = createAuthClient({
      url: URL, publishableKey: KEY, fetch: hanging, storage: memoryStorage(), now: time.now, locks: null,
      setTimer: time.setTimer, clearTimer: time.clearTimer,
    });
    const pending = auth.signIn({ email: 'ana@correo.com', password: 'x' });
    await new Promise((resolve) => setImmediate(resolve));
    const abort = time.pending().find((h) => h.ms === 15_000);
    assert.ok(abort, 'hay un tiempo máximo de 15 segundos');
    await time.fire(abort);
    const result = await pending;
    assert.equal(result.ok === false && result.error.code, 'timeout');
  });
});

describe('salir', () => {
  it('avisa al servidor, borra la sesión de este dispositivo y emite signed-out', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const token = ctx.auth.getSession()?.accessToken;
    await ctx.auth.signOut();
    const logout = ctx.server.calls.find((c) => c.path === '/auth/v1/logout');
    assert.equal(logout?.token, token);
    assert.equal(logout?.query.scope, 'local');
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.has(SESSION_KEY), false);
    assert.deepEqual(ctx.events, ['signed-in', 'signed-out']);
  });

  it('sin internet también cierra la sesión aquí', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.server.offline = true;
    await ctx.auth.signOut();
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.has(SESSION_KEY), false);
  });

  it('sin sesión no llama al servidor ni emite nada', async () => {
    const ctx = setup();
    await ctx.auth.signOut();
    assert.equal(ctx.server.calls.length, 0);
    assert.deepEqual(ctx.events, []);
  });

  it('deja de renovar: ya no queda ningún temporizador pendiente', async () => {
    const ctx = setup();
    await signedUp(ctx);
    assert.equal(ctx.time.pending().length, 1);
    await ctx.auth.signOut();
    assert.equal(ctx.time.pending().length, 0);
  });
});

describe('abrir con la sesión guardada', () => {
  it('init() recupera la sesión sin llamar a la red', async () => {
    const first = setup();
    await signedUp(first);
    const ctx = setup({ server: mockServer(), storage: first.storage, time: first.time });
    const session = ctx.auth.init();
    assert.equal(session?.user.email, 'ana@correo.com');
    assert.equal(ctx.server.calls.length, 0);
  });

  it('sin nada guardado devuelve null', () => {
    assert.equal(setup().auth.init(), null);
  });

  for (const [name, value] of [
    ['texto que no es JSON', '{no es json'],
    ['un valor que no es objeto', '42'],
    ['sin tokens', JSON.stringify({ user: { id: UID, email: 'a@b.co' }, expiresAt: 9e9 })],
    ['con un id de cuenta raro', JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 9e9, user: { id: '../x', email: 'a@b.co' } })],
    ['con vencimiento que no es número', JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 'mañana', user: { id: UID, email: 'a@b.co' } })],
    ['con un token gigante', JSON.stringify({ accessToken: 'a'.repeat(9000), refreshToken: 'r', expiresAt: 9e9, user: { id: UID, email: 'a@b.co' } })],
  ]) {
    it(`lo guardado dañado se ignora: ${name}`, () => {
      const ctx = setup({ storage: memoryStorage({ [SESSION_KEY]: value }) });
      assert.equal(ctx.auth.init(), null);
      assert.equal(ctx.auth.getUser(), null);
    });
  }

  it('con el token vencido y SIN internet, la app sigue abierta (la sesión no se pierde)', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.time.advance(2 * 3600 * 1000);
    const again = setup({ server: mockServer(), storage: ctx.storage, time: ctx.time });
    again.server.offline = true;
    const session = again.auth.init();
    assert.equal(session?.user.email, 'ana@correo.com');
    assert.equal(await again.auth.getAccessToken(), null, 'no hay token válido para la nube');
    assert.ok(again.auth.getSession(), 'pero la sesión sigue');
    assert.equal(ctx.storage.map.has(SESSION_KEY), true);
    assert.deepEqual(again.events, []);
  });

  it('con el token por vencer e internet, init() lo renueva en segundo plano', async () => {
    const server = mockServer();
    const first = setup({ server });
    await signedUp(first);
    const oldToken = first.auth.getSession()?.accessToken;
    first.time.advance(3580 * 1000); // faltan 20 s
    const ctx = setup({ server, storage: first.storage, time: first.time });
    ctx.auth.init();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(server.count('POST /auth/v1/token'), 1);
    assert.notEqual(ctx.auth.getSession()?.accessToken, oldToken);
    assert.equal(stored(first.storage).accessToken, ctx.auth.getSession()?.accessToken);
  });
});

describe('renovar la sesión', () => {
  it('getAccessToken devuelve el actual sin red mientras falte más de un minuto', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const calls = ctx.server.calls.length;
    assert.equal(await ctx.auth.getAccessToken(), ctx.auth.getSession()?.accessToken);
    assert.equal(ctx.server.calls.length, calls);
  });

  it('a menos de un minuto de vencer renueva, guarda los tokens nuevos y emite updated', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const before = ctx.auth.getSession();
    ctx.time.advance(3545 * 1000);
    const token = await ctx.auth.getAccessToken();
    assert.notEqual(token, before?.accessToken);
    assert.notEqual(ctx.auth.getSession()?.refreshToken, before?.refreshToken);
    assert.equal(stored(ctx.storage).refreshToken, ctx.auth.getSession()?.refreshToken);
    assert.deepEqual(ctx.events, ['signed-in', 'updated']);
    const refresh = ctx.server.calls.at(-1);
    assert.equal(refresh.query.grant_type, 'refresh_token');
    assert.equal(refresh.body.refresh_token, before?.refreshToken);
  });

  it('varias peticiones a la vez provocan UNA sola renovación (el token de renovación sirve una vez)', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.time.advance(3545 * 1000);
    const tokens = await Promise.all([ctx.auth.getAccessToken(), ctx.auth.getAccessToken(), ctx.auth.getAccessToken()]);
    assert.equal(new Set(tokens).size, 1);
    assert.equal(ctx.server.count('POST /auth/v1/token'), 1); // crear la cuenta usa /signup; la única llamada a /token es la renovación
    assert.equal(ctx.server.calls.filter((c) => c.query.grant_type === 'refresh_token').length, 1);
  });

  it('si el servidor dice que la sesión ya no existe, se cierra y se emite signed-out', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.server.revokeAll('ana@correo.com');
    ctx.time.advance(3545 * 1000);
    assert.equal(await ctx.auth.getAccessToken(), null);
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.has(SESSION_KEY), false);
    assert.deepEqual(ctx.events, ['signed-in', 'signed-out']);
  });

  it('también con el formato antiguo de error (invalid_grant)', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.server.failNext = { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' } };
    ctx.time.advance(3545 * 1000);
    assert.equal(await ctx.auth.getAccessToken(), null);
    assert.equal(ctx.auth.getSession(), null);
  });

  for (const [name, fail] of [
    ['sin internet', (server) => { server.offline = true; }],
    ['servidor caído (503)', (server) => { server.failNext = { status: 503, body: {} }; }],
    ['demasiadas peticiones (429)', (server) => { server.failNext = { status: 429, body: { error_code: 'over_request_rate_limit' } }; }],
  ]) {
    it(`un fallo pasajero (${name}) NO cierra la sesión`, async () => {
      const ctx = setup();
      await signedUp(ctx);
      const kept = ctx.auth.getSession();
      fail(ctx.server);
      ctx.time.advance(3545 * 1000); // quedan 55 s: todavía sirve
      assert.equal(await ctx.auth.getAccessToken(), kept?.accessToken);
      assert.equal(ctx.auth.getSession()?.accessToken, kept?.accessToken);
      assert.equal(ctx.storage.map.has(SESSION_KEY), true);
      assert.deepEqual(ctx.events, ['signed-in']);
    });
  }

  it('si el token ya venció y no hay forma de renovarlo, no se entrega, pero la sesión se conserva', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.server.offline = true;
    ctx.time.advance(3601 * 1000);
    assert.equal(await ctx.auth.getAccessToken(), null);
    assert.ok(ctx.auth.getSession());
  });

  it('programa la renovación un minuto antes de que venza y, al cumplirse, renueva y programa la siguiente', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const [first] = ctx.time.pending();
    assert.equal(first.ms, (3600 - 60) * 1000);
    ctx.time.advance(first.ms);
    await ctx.time.fire(first);
    assert.equal(ctx.server.calls.filter((c) => c.query.grant_type === 'refresh_token').length, 1);
    const next = ctx.time.pending();
    assert.equal(next.length, 1);
    assert.equal(next[0].ms, (3600 - 60) * 1000);
  });

  it('nunca programa la renovación para "ya mismo": mínimo 5 segundos, aunque el token dure muy poco', async () => {
    const ctx = setup({ server: mockServer({ expiresIn: 50 }) }); // 50 s de vida: menos que el margen de un minuto
    await signedUp(ctx);
    const [timer] = ctx.time.pending();
    assert.equal(timer.ms, 5_000);
  });

  it('si al cumplirse el plazo no hay red, reintenta en un minuto en lugar de rendirse', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const [first] = ctx.time.pending();
    ctx.time.advance(first.ms);
    ctx.server.offline = true;
    await ctx.time.fire(first);
    const [retry] = ctx.time.pending();
    assert.equal(retry.ms, 60_000);
    assert.ok(ctx.auth.getSession());
  });

  it('con otra pestaña: si ya renovó, usa lo guardado sin pedir otra renovación', async () => {
    const server = mockServer();
    const tabA = setup({ server });
    await signedUp(tabA);
    const tabB = setup({ server, storage: tabA.storage, time: tabA.time });
    tabB.auth.init();
    tabA.time.advance(3545 * 1000);
    const tokenFromA = await tabA.auth.getAccessToken(); // la pestaña A renueva
    assert.equal(server.calls.filter((c) => c.query.grant_type === 'refresh_token').length, 1);
    const tokenFromB = await tabB.auth.getAccessToken(); // la B encuentra los tokens nuevos guardados
    assert.equal(tokenFromB, tokenFromA);
    assert.equal(server.calls.filter((c) => c.query.grant_type === 'refresh_token').length, 1, 'no se pidió una segunda renovación');
  });

  it('con otra pestaña: si cerró la sesión, esta también se entera al renovar', async () => {
    const server = mockServer();
    const tabA = setup({ server });
    await signedUp(tabA);
    const tabB = setup({ server, storage: tabA.storage, time: tabA.time });
    tabB.auth.init();
    tabA.storage.removeItem(SESSION_KEY);
    tabA.time.advance(3545 * 1000);
    assert.equal(await tabB.auth.getAccessToken(), null);
    assert.equal(tabB.auth.getSession(), null);
    assert.deepEqual(tabB.events, ['signed-out']);
  });

  it('usa el candado entre pestañas con un nombre fijo, y la renovación corre dentro de él', async () => {
    const used = [];
    const locks = { request: async (name, callback) => { used.push(name); return callback(); } };
    const ctx = setup({ locks });
    await signedUp(ctx);
    ctx.time.advance(3545 * 1000);
    await ctx.auth.getAccessToken();
    assert.deepEqual(used, ['accontrol-auth-refresh']);
  });
});

describe('recuperar contraseña', () => {
  it('pide el correo con el enlace de vuelta a la app', async () => {
    const server = mockServer();
    await signedUp(setup({ server }));
    const ctx = setup({ server });
    const result = await ctx.auth.requestPasswordReset(' ANA@correo.com ');
    assert.deepEqual(result, { ok: true, email: 'ana@correo.com' });
    const call = ctx.server.calls.at(-1);
    assert.equal(call.path, '/auth/v1/recover');
    assert.equal(call.query.redirect_to, 'https://app.test/');
    const { kind, to, code } = /** @type {any} */ (server.emails.at(-1));
    assert.deepEqual({ kind, to }, { kind: 'recovery', to: 'ana@correo.com' });
    assert.equal(code.length, 6, 'el mensaje trae un código de 6 dígitos');
  });

  it('responde igual para un correo que no existe (no revela quién tiene cuenta)', async () => {
    const ctx = setup();
    const result = await ctx.auth.requestPasswordReset('nadie@correo.com');
    assert.deepEqual(result, { ok: true, email: 'nadie@correo.com' });
    assert.equal(ctx.server.emails.length, 0);
  });

  it('un correo mal escrito no sale al servidor', async () => {
    const ctx = setup();
    const result = await ctx.auth.requestPasswordReset('ana');
    assert.equal(result.ok === false && result.error.field, 'email');
    assert.equal(ctx.server.calls.length, 0);
  });

  it('si el servidor limita los envíos, lo dice', async () => {
    const ctx = setup();
    ctx.server.failNext = { status: 429, body: { code: 429, error_code: 'over_email_send_rate_limit', msg: 'rate limit' } };
    const result = await ctx.auth.requestPasswordReset('ana@correo.com');
    assert.match(result.ok === false ? result.error.message : '', /demasiados correos/);
  });

  it('resendConfirmation reenvía la confirmación', async () => {
    const server = mockServer({ confirmEmails: true });
    const ctx = setup({ server });
    await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.deepEqual(await ctx.auth.resendConfirmation('ana@correo.com'), { ok: true });
    assert.equal(server.emails.filter((e) => e.kind === 'confirm').length, 2);
    assert.deepEqual(server.calls.at(-1).body, { type: 'signup', email: 'ana@correo.com' });
  });
});

describe('enlaces de los correos (#access_token=…)', () => {
  it('una ruta normal de la app o una dirección vacía no se tocan', async () => {
    const ctx = setup();
    for (const hash of ['', '#', '#/inicio', '#/deudas/abc']) assert.deepEqual(await ctx.auth.consumeUrlHash(hash), { kind: 'none' }, hash);
    assert.equal(ctx.server.calls.length, 0);
  });

  it('enlace de recuperación: el servidor confirma el token, se guarda la sesión y se avisa kind=recovery', async () => {
    const server = mockServer();
    await signedUp(setup({ server }));
    const ctx = setup({ server });
    await ctx.auth.requestPasswordReset('ana@correo.com'); // se pidió en este navegador
    const hash = server.emailLinkHash('recovery', 'ana@correo.com');
    assert.deepEqual(await ctx.auth.consumeUrlHash(hash), { kind: 'recovery' });
    assert.equal(server.calls.at(-1).path, '/auth/v1/user');
    assert.equal(ctx.auth.getUser()?.email, 'ana@correo.com');
    assert.equal(stored(ctx.storage).user.email, 'ana@correo.com');
    assert.deepEqual(ctx.events, ['signed-in']);
  });

  it('enlace de confirmación de cuenta: entra directamente', async () => {
    const server = mockServer({ confirmEmails: true });
    const ctx = setup({ server });
    await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    const hash = server.emailLinkHash('signup', 'ana@correo.com');
    assert.deepEqual(await ctx.auth.consumeUrlHash(hash), { kind: 'signed-in' });
    assert.equal(ctx.auth.getUser()?.email, 'ana@correo.com');
  });

  it('enlace vencido (#error=…&error_code=otp_expired): mensaje en español y no se guarda nada', async () => {
    const ctx = setup();
    const result = await ctx.auth.consumeUrlHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    assert.equal(result.kind, 'error');
    assert.match(result.kind === 'error' ? result.message : '', /venció/);
    assert.equal(ctx.storage.map.size, 0);
    assert.equal(ctx.server.calls.length, 0);
  });

  it('un token inventado no entra: el servidor lo rechaza y no se guarda nada', async () => {
    const ctx = setup();
    const result = await ctx.auth.consumeUrlHash('#access_token=inventado&refresh_token=inventado&type=recovery&expires_in=3600');
    assert.equal(result.kind, 'error');
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.size, 0);
  });

  it('con solo uno de los dos tokens, o con tokens gigantes, no se hace nada', async () => {
    const ctx = setup();
    assert.deepEqual(await ctx.auth.consumeUrlHash('#access_token=solo'), { kind: 'none' });
    assert.deepEqual(await ctx.auth.consumeUrlHash(`#access_token=${'a'.repeat(9000)}&refresh_token=r`), { kind: 'none' });
    assert.equal(ctx.server.calls.length, 0);
  });

  it('un enlace con la sesión de OTRA cuenta no reemplaza la sesión abierta', async () => {
    const server = mockServer();
    const victima = setup({ server });
    await signedUp(victima); // ana@correo.com, con sesión abierta
    const antes = victima.auth.getSession();
    // El atacante tiene su propia cuenta y manda un enlace con SU sesión.
    await setup({ server }).auth.signUp({ email: 'otro@correo.com', password: GOOD_PASSWORD });
    const result = await victima.auth.consumeUrlHash(server.emailLinkHash('recovery', 'otro@correo.com'));
    assert.equal(result.kind, 'error');
    assert.match(result.kind === 'error' ? result.message : '', /otra cuenta/);
    assert.deepEqual(victima.auth.getSession(), antes, 'la sesión de la víctima sigue igual');
    assert.equal(stored(victima.storage).user.email, 'ana@correo.com');
  });

  it('sin sesión, un enlace que este navegador NO pidió no abre sesión', async () => {
    const server = mockServer();
    await signedUp(setup({ server }));
    const ctx = setup({ server }); // otro navegador, nunca pidió nada
    const result = await ctx.auth.consumeUrlHash(server.emailLinkHash('recovery', 'ana@correo.com'));
    assert.equal(result.kind, 'error');
    assert.match(result.kind === 'error' ? result.message : '', /mismo dispositivo/);
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.has(SESSION_KEY), false);
  });

  it('un enlace pedido aquí para OTRO correo tampoco abre sesión', async () => {
    const server = mockServer();
    await signedUp(setup({ server }));
    await setup({ server }).auth.signUp({ email: 'otro@correo.com', password: GOOD_PASSWORD });
    const ctx = setup({ server });
    await ctx.auth.requestPasswordReset('ana@correo.com');
    const result = await ctx.auth.consumeUrlHash(server.emailLinkHash('recovery', 'otro@correo.com'));
    assert.equal(result.kind, 'error');
    assert.equal(ctx.auth.getSession(), null);
  });

  it('la anotación del enlace pedido se usa una sola vez', async () => {
    const server = mockServer();
    await signedUp(setup({ server }));
    const ctx = setup({ server });
    await ctx.auth.requestPasswordReset('ana@correo.com');
    assert.deepEqual(await ctx.auth.consumeUrlHash(server.emailLinkHash('recovery', 'ana@correo.com')), { kind: 'recovery' });
    assert.equal(ctx.storage.map.has(LINK_REQUESTS_KEY), false);
  });
});

/** Puede entrar con esa contraseña (en otro "dispositivo") @param {any} server @param {string} password */
async function canSignIn(server, password) {
  return (await setup({ server }).auth.signIn({ email: 'ana@correo.com', password })).ok;
}

describe('cambiar contraseña desde Cuenta (pide la actual)', () => {
  it('con la actual correcta: cambia, manda current_password y se entra con la nueva', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    assert.deepEqual(await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' }), { ok: true });
    const call = server.calls.at(-1);
    assert.equal(`${call.method} ${call.path}`, 'PUT /auth/v1/user');
    assert.equal(call.token, ctx.auth.getSession()?.accessToken);
    assert.deepEqual(call.body, { password: 'Nueva-Clave-77', current_password: GOOD_PASSWORD });
    assert.equal(await canSignIn(server, 'Nueva-Clave-77'), true);
    assert.equal(await canSignIn(server, GOOD_PASSWORD), false);
  });

  it('actual incorrecta: el servidor la rechaza, el error va al campo «actual» y la contraseña NO cambia', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    const result = await ctx.auth.changePassword({ currentPassword: 'No-Es-La-Mia-1', newPassword: 'Nueva-Clave-77' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'current_password_invalid');
    assert.equal(result.ok === false && result.error.field, 'currentPassword');
    assert.equal(result.ok === false && result.error.message, 'La contraseña actual no es correcta.');
    assert.equal(server.count('PUT /auth/v1/user'), 1);
    assert.ok(ctx.auth.getSession(), 'una contraseña actual equivocada no cierra la sesión');
    assert.equal(await canSignIn(server, GOOD_PASSWORD), true);
    assert.equal(await canSignIn(server, 'Nueva-Clave-77'), false);
  });

  it('actual vacía: se pide sin salir al servidor', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const calls = ctx.server.calls.length;
    for (const currentPassword of ['', undefined]) {
      const result = await ctx.auth.changePassword({ currentPassword, newPassword: 'Nueva-Clave-77' });
      assert.equal(result.ok === false && result.error.field, 'currentPassword');
      assert.equal(result.ok === false && result.error.message, 'Escribe tu contraseña actual.');
    }
    assert.equal(ctx.server.calls.length, calls);
  });

  it('la nueva igual a la actual: se dice sin salir al servidor, en el campo «nueva»', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const calls = ctx.server.calls.length;
    const result = await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: GOOD_PASSWORD });
    assert.equal(result.ok === false && result.error.code, 'same_password');
    assert.equal(result.ok === false && result.error.field, 'password');
    assert.match(result.ok === false ? result.error.message : '', /distinta/);
    assert.equal(ctx.server.calls.length, calls);
  });

  it('si el servidor responde que falta la actual o que es igual, el error va al campo correcto', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.server.failNext = { status: 400, body: { code: 400, error_code: 'current_password_required', msg: 'Current password required when setting new password.' } };
    let result = await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' });
    assert.equal(result.ok === false && result.error.field, 'currentPassword');
    assert.equal(result.ok === false && result.error.message, 'Escribe tu contraseña actual.');
    ctx.server.failNext = { status: 422, body: { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' } };
    result = await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' });
    assert.equal(result.ok === false && result.error.field, 'password');
    ctx.server.failNext = { status: 500, body: { code: 500, error_code: 'unexpected_failure', msg: 'x' } };
    result = await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' });
    assert.equal(result.ok === false && result.error.field, undefined);
  });

  it('una contraseña nueva débil se rechaza sin salir al servidor', async () => {
    const ctx = setup();
    await signedUp(ctx);
    const calls = ctx.server.calls.length;
    const result = await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: '1234' });
    assert.equal(result.ok === false && result.error.code, 'validation');
    assert.equal(result.ok === false && result.error.field, 'password');
    assert.equal(ctx.server.calls.length, calls);
  });

  it('sin sesión no se puede', async () => {
    const ctx = setup();
    const result = await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' });
    assert.equal(result.ok === false && result.error.code, 'session_not_found');
    assert.equal(ctx.server.calls.length, 0);
  });

  it('si el servidor dice que la sesión ya no vale, se cierra', async () => {
    const ctx = setup();
    await signedUp(ctx);
    ctx.server.revokeAll('ana@correo.com');
    const result = await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' });
    assert.equal(result.ok, false);
    assert.equal(ctx.auth.getSession(), null);
  });
});

describe('cuenta para las pantallas (createAccountApi)', () => {
  it('changePassword va por el camino que pide la actual y devuelve el error con su campo', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    const account = createAccountApi(ctx.auth, { email: 'ana@correo.com' });
    assert.deepEqual(await account.changePassword({ currentPassword: 'No-Es-La-Mia-1', newPassword: 'Nueva-Clave-77' }), { ok: false, error: 'La contraseña actual no es correcta.', field: 'currentPassword' });
    assert.deepEqual(await account.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' }), { ok: true });
    assert.equal(server.calls.at(-1).body.current_password, GOOD_PASSWORD);
    assert.equal(await canSignIn(server, 'Nueva-Clave-77'), true);
  });
});

describe('servidor simulado: exige la contraseña actual como Supabase', () => {
  it('sesión normal sin current_password (o con una equivocada): rechazada, aunque la app no la valide', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    let result = await ctx.auth.updatePassword('Nueva-Clave-77');
    assert.equal(result.ok === false && result.error.code, 'current_password_required');
    assert.equal(result.ok === false && result.error.status, 400);
    assert.equal(await canSignIn(server, GOOD_PASSWORD), true);
    // Con la actual equivocada, el servidor la rechaza ANTES de mirar si la nueva es igual (mismo orden que Supabase).
    const token = ctx.auth.getSession()?.accessToken;
    const reply = await server.handle({ method: 'PUT', url: `${URL}/auth/v1/user`, headers: { apikey: KEY, Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: GOOD_PASSWORD, current_password: 'otra' }) });
    assert.equal(reply.status, 400);
    assert.equal(reply.body.error_code, 'current_password_invalid');
    result = await ctx.auth.updatePassword(GOOD_PASSWORD);
    assert.equal(result.ok === false && result.error.code, 'current_password_required');
  });

  it('con la opción apagada (requireCurrentPassword: false) acepta el cambio sin la actual', async () => {
    const server = mockServer({ requireCurrentPassword: false });
    const ctx = setup({ server });
    await signedUp(ctx);
    assert.deepEqual(await ctx.auth.updatePassword('Nueva-Clave-77'), { ok: true });
    assert.equal(await canSignIn(server, 'Nueva-Clave-77'), true);
  });
});

describe('contraseña nueva desde el enlace de «Olvidé mi contraseña» (NO pide la actual)', () => {
  /** Sesión abierta desde el enlace del correo de recuperación. */
  async function recoverySetup() {
    const server = mockServer();
    await signedUp(setup({ server }));
    const ctx = setup({ server });
    await ctx.auth.requestPasswordReset('ana@correo.com'); // «Olvidé mi contraseña» en este navegador
    assert.deepEqual(await ctx.auth.consumeUrlHash(server.emailLinkHash('recovery', 'ana@correo.com')), { kind: 'recovery' });
    return { server, ctx };
  }

  it('cambia la contraseña sin mandar la actual y se entra con la nueva', async () => {
    const { server, ctx } = await recoverySetup();
    assert.deepEqual(await ctx.auth.updatePassword('Nueva-Clave-77'), { ok: true });
    assert.deepEqual(server.calls.at(-1).body, { password: 'Nueva-Clave-77' });
    assert.equal(await canSignIn(server, 'Nueva-Clave-77'), true);
    assert.equal(await canSignIn(server, GOOD_PASSWORD), false);
  });

  it('aunque la sesión del enlace se renueve, sigue sin pedir la actual', async () => {
    const { server, ctx } = await recoverySetup();
    const before = ctx.auth.getSession()?.accessToken;
    ctx.time.advance(3545 * 1000);
    const token = await ctx.auth.getAccessToken();
    assert.ok(token);
    assert.notEqual(token, before);
    assert.deepEqual(await ctx.auth.updatePassword('Nueva-Clave-77'), { ok: true });
    assert.equal(await canSignIn(server, 'Nueva-Clave-77'), true);
  });

  it('la misma contraseña de antes: lo dice', async () => {
    const { ctx } = await recoverySetup();
    const result = await ctx.auth.updatePassword(GOOD_PASSWORD);
    assert.equal(result.ok === false && result.error.code, 'same_password');
    assert.match(result.ok === false ? result.error.message : '', /distinta/);
  });

  it('una contraseña débil se rechaza sin salir al servidor', async () => {
    const { ctx } = await recoverySetup();
    const calls = ctx.server.calls.length;
    const result = await ctx.auth.updatePassword('1234');
    assert.equal(result.ok === false && result.error.code, 'validation');
    assert.equal(ctx.server.calls.length, calls);
  });

  it('sin sesión no se puede', async () => {
    const ctx = setup();
    const result = await ctx.auth.updatePassword('Nueva-Clave-77');
    assert.equal(result.ok === false && result.error.code, 'session_not_found');
    assert.equal(ctx.server.calls.length, 0);
  });

  it('si el servidor dice que la sesión ya no vale, se cierra', async () => {
    const { ctx } = await recoverySetup();
    ctx.server.revokeAll('ana@correo.com');
    const result = await ctx.auth.updatePassword('Nueva-Clave-77');
    assert.equal(result.ok, false);
    assert.equal(ctx.auth.getSession(), null);
  });
});

describe('borrar la cuenta', () => {
  /** 0.20.3: pide el código al correo y lo escribe (lo que haría la persona). */
  async function confirmByEmail(ctx, email = 'ana@correo.com') {
    assert.deepEqual(await ctx.auth.requestDeletionCode(), { ok: true, email });
    return ctx.auth.confirmDeletionCode(/** @type {string} */ (ctx.server.lastCode(email, 'confirm')));
  }

  it('con el código del correo: llama a la función del servidor con esa sesión, borra la cuenta y cierra la sesión', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    assert.deepEqual(await confirmByEmail(ctx), { ok: true });
    const token = ctx.auth.getSession()?.accessToken;
    assert.deepEqual(await ctx.auth.deleteAccount(), { ok: true });
    const call = server.calls.at(-1);
    assert.equal(`${call.method} ${call.path}`, 'POST /rest/v1/rpc/delete_my_account');
    assert.equal(call.token, token);
    assert.equal(server.users.size, 0);
    assert.equal(ctx.auth.getSession(), null);
    assert.equal(ctx.storage.map.has(SESSION_KEY), false);
    assert.equal(ctx.events.at(-1), 'signed-out');
  });

  it('0.20.3: pedir el código manda un correo a la cuenta abierta, sin crear cuentas nuevas', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    await ctx.auth.requestDeletionCode();
    const call = server.calls.at(-1);
    assert.equal(`${call.method} ${call.path}`, 'POST /auth/v1/otp');
    assert.deepEqual(call.body, { email: 'ana@correo.com', create_user: false });
    assert.equal(server.emails.at(-1)?.to, 'ana@correo.com');
  });

  it('0.20.3: SIN el código del correo el servidor no borra nada (aunque la sesión esté abierta)', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    const result = await ctx.auth.deleteAccount();
    assert.equal(result.ok === false && result.error.code, 'confirmar_correo');
    assert.match(result.ok === false ? result.error.message : '', /confirma primero con el código/);
    assert.equal(server.users.size, 1);
    assert.ok(ctx.auth.getSession(), 'la sesión sigue');
  });

  it('0.20.3: un código equivocado no sirve y no cambia la sesión', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    const before = ctx.auth.getSession()?.accessToken;
    await ctx.auth.requestDeletionCode();
    const real = /** @type {string} */ (server.lastCode('ana@correo.com', 'confirm'));
    const wrong = real === '000000' ? '111111' : '000000';
    const result = await ctx.auth.confirmDeletionCode(wrong);
    assert.equal(result.ok === false && result.error.code, 'otp_expired');
    assert.equal(ctx.auth.getSession()?.accessToken, before);
    assert.equal((await ctx.auth.deleteAccount()).ok, false, 'sigue sin poder borrar');
    assert.equal(server.users.size, 1);
  });

  it('0.20.3: la confirmación vale 15 minutos; después hay que pedir otro código', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    await confirmByEmail(ctx);
    clockMs += 16 * 60 * 1000;
    const result = await ctx.auth.deleteAccount();
    assert.equal(result.ok === false && result.error.code, 'confirmar_correo');
    assert.equal(server.users.size, 1);
  });

  it('0.20.3: el código solo se acepta si abre la MISMA cuenta', async () => {
    const server = mockServer();
    // Un servidor que, al comprobar el código, respondiera con OTRA cuenta: la app no debe cambiar de cuenta.
    const realFetch = server.fetch;
    const tampered = /** @type {any} */ ({
      ...server,
      fetch: async (url, init) => {
        const res = await realFetch(url, init);
        if (!String(url).includes('/auth/v1/verify') || !res.ok) return res;
        const body = await res.json();
        return new Response(JSON.stringify({ ...body, user: { ...body.user, id: UID } }), { status: 200 });
      },
    });
    const ctx = setup({ server: tampered });
    await signedUp(ctx);
    const anaId = ctx.auth.getUser()?.id;
    assert.notEqual(anaId, UID);
    const before = ctx.auth.getSession()?.accessToken;
    await ctx.auth.requestDeletionCode();
    const result = await ctx.auth.confirmDeletionCode(/** @type {string} */ (server.lastCode('ana@correo.com', 'confirm')));
    assert.equal(result.ok === false && result.error.code, 'invalid_response');
    assert.equal(ctx.auth.getUser()?.id, anaId, 'sigue abierta la cuenta de Ana');
    assert.equal(ctx.auth.getSession()?.accessToken, before, 'y con la misma sesión');
  });

  it('0.20.3: sin sesión no pide código', async () => {
    const ctx = setup();
    const result = await ctx.auth.requestDeletionCode();
    assert.equal(result.ok === false && result.error.code, 'session_not_found');
    assert.equal(ctx.server.calls.length, 0);
  });

  it('si falla (sin red), la sesión y la cuenta siguen como estaban', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    server.offline = true;
    const result = await ctx.auth.deleteAccount();
    assert.equal(result.ok === false && result.error.code, 'network');
    assert.ok(ctx.auth.getSession());
    assert.equal(server.users.size, 1);
  });

  it('sin sesión no hace nada', async () => {
    const ctx = setup();
    const result = await ctx.auth.deleteAccount();
    assert.equal(result.ok === false && result.error.code, 'session_not_found');
    assert.equal(ctx.server.calls.length, 0);
  });
});

describe('almacenamiento no disponible', () => {
  it('sin almacenamiento (null) la sesión vive en memoria y se avisa', async () => {
    const server = mockServer();
    const auth = createAuthClient({ url: URL, publishableKey: KEY, fetch: server.fetch, storage: null, locks: null, setTimer: fakeTime().setTimer, clearTimer: () => {} });
    assert.equal(auth.isMemoryOnly(), false);
    await auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.ok(auth.getSession());
    assert.equal(auth.isMemoryOnly(), true);
  });

  it('si escribir falla (lleno o bloqueado) no se rompe: la sesión queda en memoria', async () => {
    const server = mockServer();
    const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('bloqueado'); } };
    const auth = createAuthClient({ url: URL, publishableKey: KEY, fetch: server.fetch, storage, locks: null, setTimer: fakeTime().setTimer, clearTimer: () => {} });
    assert.deepEqual(await auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD }), { ok: true, signedIn: true, email: 'ana@correo.com' });
    assert.equal(auth.isMemoryOnly(), true);
    await auth.signOut();
    assert.equal(auth.getSession(), null);
  });

  it('con sesión solo en memoria, renovar usa la memoria (no se pierde por no poder leer el almacén)', async () => {
    const server = mockServer();
    const time = fakeTime();
    const auth = createAuthClient({ url: URL, publishableKey: KEY, fetch: server.fetch, storage: null, now: time.now, locks: null, setTimer: time.setTimer, clearTimer: time.clearTimer });
    await auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    const before = auth.getSession()?.accessToken;
    time.advance(3545 * 1000);
    const token = await auth.getAccessToken();
    assert.ok(token);
    assert.notEqual(token, before);
    assert.ok(auth.getSession());
  });
});

describe('seguridad de lo que se envía', () => {
  it('siempre va la llave pública; el token de usuario solo en las llamadas que lo necesitan', async () => {
    const server = mockServer();
    const ctx = setup({ server });
    await signedUp(ctx);
    await ctx.auth.requestPasswordReset('ana@correo.com');
    await ctx.auth.changePassword({ currentPassword: GOOD_PASSWORD, newPassword: 'Nueva-Clave-77' });
    await ctx.auth.signOut();
    for (const call of server.calls) assert.equal(call.apikey, KEY, `${call.method} ${call.path}`);
    const withToken = server.calls.filter((c) => c.token).map((c) => `${c.method} ${c.path}`);
    assert.deepEqual(withToken, ['PUT /auth/v1/user', 'POST /auth/v1/logout']);
  });

  it('no manda cookies ni deja que el navegador guarde las respuestas', async () => {
    const seen = [];
    const server = mockServer();
    const spy = (url, init) => {
      seen.push(init);
      return server.fetch(url, init);
    };
    const auth = createAuthClient({ url: URL, publishableKey: KEY, fetch: spy, storage: memoryStorage(), locks: null, setTimer: fakeTime().setTimer, clearTimer: () => {} });
    await auth.signIn({ email: 'ana@correo.com', password: 'x' });
    assert.equal(seen[0].credentials, 'omit');
    assert.equal(seen[0].cache, 'no-store');
  });

  it('una barra al final de la dirección del proyecto no rompe las rutas', async () => {
    const server = mockServer();
    const auth = createAuthClient({ url: `${URL}///`, publishableKey: KEY, fetch: server.fetch, storage: memoryStorage(), locks: null, setTimer: fakeTime().setTimer, clearTimer: () => {} });
    await auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    assert.equal(server.calls[0].path, '/auth/v1/signup');
  });

  it('sin redirectTo no se manda redirect_to', async () => {
    const ctx = setup({ redirectTo: '' });
    await ctx.auth.signUp({ email: 'ana@correo.com', password: GOOD_PASSWORD });
    await ctx.auth.requestPasswordReset('ana@correo.com');
    for (const call of ctx.server.calls) assert.equal('redirect_to' in call.query, false);
  });
});

describe('sessionFromBody', () => {
  const user = { id: UID, email: 'Ana@Correo.com', user_metadata: { display_name: ' Ana ' } };

  it('prefiere expires_at; si no, calcula con expires_in; si no, una hora', () => {
    const base = { access_token: 'a', refresh_token: 'r', user };
    assert.equal(sessionFromBody({ ...base, expires_at: 5000, expires_in: 10 }, 100)?.expiresAt, 5000);
    assert.equal(sessionFromBody({ ...base, expires_in: 600 }, 100)?.expiresAt, 700);
    assert.equal(sessionFromBody(base, 100)?.expiresAt, 3700);
    assert.equal(sessionFromBody({ ...base, expires_in: -5 }, 100)?.expiresAt, 3700);
  });

  it('normaliza el correo y limpia el nombre', () => {
    const session = sessionFromBody({ access_token: 'a', refresh_token: 'r', user: { ...user, user_metadata: { display_name: ` ${'x'.repeat(60)} ` } } }, 0);
    assert.equal(session?.user.email, 'ana@correo.com');
    assert.equal(session?.user.displayName, '', 'un nombre demasiado largo se descarta en vez de cortarse a medias');
    assert.equal(sessionFromBody({ access_token: 'a', refresh_token: 'r', user }, 0)?.user.displayName, 'Ana');
  });

  it('devuelve null si falta algo esencial', () => {
    assert.equal(sessionFromBody(null, 0), null);
    assert.equal(sessionFromBody({}, 0), null);
    assert.equal(sessionFromBody({ access_token: '', refresh_token: 'r', user }, 0), null);
    assert.equal(sessionFromBody({ access_token: 'a', refresh_token: '', user }, 0), null);
    assert.equal(sessionFromBody({ access_token: 'a', refresh_token: 'r' }, 0), null);
    assert.equal(sessionFromBody({ access_token: 'a', refresh_token: 'r', user: { id: 'no-uuid' } }, 0), null);
  });
});
