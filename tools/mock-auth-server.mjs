// =============================================================================
// SERVIDOR DE CUENTAS SIMULADO — SOLO PARA PRUEBAS
// -----------------------------------------------------------------------------
// Imita lo que responde Supabase Auth (registro, entrar, renovar, salir, recuperar, cambiar contraseña, borrar
// cuenta) para poder probar la app SIN internet y sin tocar el proyecto real. Se usa desde las pruebas
// automáticas (como `fetch`) y desde las pruebas en navegador (interceptando las peticiones).
//
// NO es Supabase: respeta los formatos de respuesta y los códigos de error que usa el cliente, pero no
// reproduce todo (límites de envío reales, correo, contraseñas filtradas…). Lo que se prueba contra el
// servidor real hay que probarlo a mano (ver docs/BASE_DE_DATOS.md).
// =============================================================================
import { randomInt, randomUUID } from 'node:crypto';

import { createMockDataServer } from './mock-data-server.mjs';

/** Cuánto vale un código de 6 dígitos (Supabase: «Email OTP Expiration», 1 hora por omisión). */
const OTP_EXPIRES_S = 3600;

/**
 * @param {{ confirmEmails?: boolean, requireCurrentPassword?: boolean, now?: () => number, expiresIn?: number }} [options]
 *   confirmEmails: true = hay que confirmar el correo antes de entrar (como un proyecto con confirmación activa).
 *   requireCurrentPassword: true (por omisión) = como un proyecto con la opción «exigir la contraseña actual»
 *     activada: para cambiar la contraseña hay que mandar `current_password`, salvo en una sesión que viene del
 *     enlace de recuperación (igual que Supabase Auth: `if !session.IsRecovery()`).
 */
export function createMockAuthServer(options = {}) {
  const confirmEmails = options.confirmEmails ?? false;
  const requireCurrentPassword = options.requireCurrentPassword ?? true;
  const nowMs = options.now ?? (() => Date.now());
  const expiresIn = options.expiresIn ?? 3600;

  /** @type {Map<string, { id: string, email: string, password: string, confirmed: boolean, metadata: Record<string, any> }>} */
  const users = new Map();
  /** recovery: la sesión nació del enlace de recuperación (y lo sigue siendo al renovarse). */
  /** @type {Map<string, { userId: string, expiresAt: number, recovery: boolean }>} */
  const accessTokens = new Map();
  /** @type {Map<string, { userId: string, used: boolean, recovery: boolean }>} */
  const refreshTokens = new Map();
  /** Códigos de 6 dígitos vigentes (0.14.6): uno por correo y tipo; pedir otro anula el anterior. */
  /** @type {Map<string, { code: string, expiresAt: number, used: boolean }>} */
  const codes = new Map();
  let counter = 0;
  /** La base de datos simulada (0.15.0): /rest/v1/… salvo borrar la cuenta. */
  const data = createMockDataServer({ now: nowMs });

  const server = {
    users,
    data,
    /** Todas las peticiones recibidas: { method, path, query, body, token }. */
    /** @type {Array<{ method: string, path: string, query: Record<string, string>, body: any, token: string | null, apikey: string | null }>} */
    calls: [],
    /** Correos "enviados": { kind: 'confirm' | 'recovery', to, code } (code = el de 6 dígitos que traería el mensaje). */
    /** @type {Array<{ kind: string, to: string, code: string }>} */
    emails: [],

    /** El último código enviado a ese correo (lo que la persona leería en su bandeja). @param {string} email @param {'confirm' | 'recovery'} kind */
    lastCode(email, kind) {
      return codes.get(`${kind}:${email.toLowerCase()}`)?.code ?? null;
    },
    /** true = el servidor no responde (como si no hubiera internet). */
    offline: false,
    /** Si se pone, la PRÓXIMA petición devuelve este error: { status, body }. */
    /** @type {null | { status: number, body: any }} */
    failNext: null,
    /** Retraso artificial en milisegundos antes de responder (para probar estados "cargando"). */
    delayMs: 0,

    /** Cuántas veces se llamó a un punto (por ejemplo 'POST /auth/v1/token'). @param {string} key */
    count(key) {
      return server.calls.filter((c) => `${c.method} ${c.path}` === key).length;
    },

    /** Marca el correo como confirmado (equivale a abrir el enlace del mensaje). @param {string} email */
    confirm(email) {
      const user = users.get(email.toLowerCase());
      if (user) user.confirmed = true;
    },

    /**
     * Lo que dejaría en la dirección el enlace de un correo: "#access_token=…&type=recovery".
     * @param {'recovery' | 'signup'} type @param {string} email
     */
    emailLinkHash(type, email) {
      const user = users.get(email.toLowerCase());
      if (!user) throw new Error(`No existe ${email}`);
      if (type === 'signup') user.confirmed = true;
      const session = issue(user, type === 'recovery');
      const params = new URLSearchParams({
        access_token: session.access_token, refresh_token: session.refresh_token, expires_in: String(expiresIn),
        expires_at: String(session.expires_at), token_type: 'bearer', type,
      });
      return `#${params.toString()}`;
    },

    /** Vence ya el token de acceso indicado (para probar la renovación). @param {string} token */
    expireAccessToken(token) {
      const record = accessTokens.get(token);
      if (record) record.expiresAt = 0;
    },

    /** Invalida todas las sesiones de una cuenta (como cerrar sesión en todos lados o borrar al usuario). @param {string} email */
    revokeAll(email) {
      const user = users.get(email.toLowerCase());
      if (!user) return;
      for (const [k, v] of accessTokens) if (v.userId === user.id) accessTokens.delete(k);
      for (const [k, v] of refreshTokens) if (v.userId === user.id) refreshTokens.delete(k);
    },

    /**
     * @param {{ method: string, url: string, headers?: Record<string, string>, body?: string | null }} req
     * @returns {Promise<{ status: number, body: any }>}
     */
    async handle(req) {
      if (server.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, server.delayMs));
      if (server.offline) throw new TypeError('Failed to fetch');
      const url = new URL(req.url);
      const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const auth = headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      /** @type {any} */
      let body = null;
      if (req.body) {
        try {
          body = JSON.parse(req.body);
        } catch {
          return reply(400, { code: 400, error_code: 'bad_json', msg: 'Could not parse request body as JSON' });
        }
      }
      const query = Object.fromEntries(url.searchParams.entries());
      server.calls.push({ method: req.method, path: url.pathname, query, body, token, apikey: headers.apikey ?? null });

      if (server.failNext) {
        const next = server.failNext;
        server.failNext = null;
        return reply(next.status, next.body);
      }
      if (!headers.apikey) return reply(401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' });

      const route = `${req.method} ${url.pathname}`;
      if (url.pathname.startsWith('/rest/v1/') && route !== 'POST /rest/v1/rpc/delete_my_account') {
        const user = userFor(token);
        return data.handle({ method: req.method, path: url.pathname, params: url.searchParams, headers, body, user: user ? { id: user.id } : null });
      }
      switch (route) {
        case 'POST /auth/v1/signup': return signUp(body);
        case 'POST /auth/v1/token': return query.grant_type === 'refresh_token' ? refresh(body) : password(body, query.grant_type);
        case 'POST /auth/v1/logout': return logout(token);
        case 'POST /auth/v1/recover': return recover(body);
        case 'POST /auth/v1/resend': return resend(body);
        case 'POST /auth/v1/verify': return verify(body);
        case 'GET /auth/v1/user': return getUser(token);
        case 'PUT /auth/v1/user': return putUser(token, body);
        case 'POST /rest/v1/rpc/delete_my_account': return deleteAccount(token);
        default: return reply(404, { code: 404, error_code: 'not_found', msg: `Unknown route ${route}` });
      }
    },

    /** Como `fetch`, para inyectar en el cliente. @type {typeof fetch} */
    fetch: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
      // Como un navegador: si quien llama cancela (tiempo agotado), la petición termina con AbortError.
      const handled = server.handle({ method: init.method ?? 'GET', url: String(url), headers: init.headers, body: init.body });
      /** @type {AbortSignal | undefined} */
      const signal = init.signal;
      const aborted = signal
        ? new Promise((_, reject) => {
          const fire = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
          if (signal.aborted) fire();
          else signal.addEventListener('abort', fire, { once: true });
        })
        : null;
      const result = await (aborted ? Promise.race([handled, aborted]) : handled);
      return new Response(result.status === 204 ? null : JSON.stringify(result.body), {
        status: result.status, headers: { 'Content-Type': 'application/json' },
      });
    }),
  };

  // ---------------------------------------------------------------- internos
  /** @param {number} status @param {any} body */
  function reply(status, body) {
    return { status, body };
  }

  /** @param {{ id: string, email: string, confirmed: boolean, metadata: Record<string, any> }} user */
  function userJson(user) {
    return {
      id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
      email_confirmed_at: user.confirmed ? new Date(nowMs()).toISOString() : null,
      user_metadata: user.metadata, app_metadata: { provider: 'email', providers: ['email'] },
      identities: [{ identity_id: randomUUID(), provider: 'email' }],
    };
  }

  /**
   * @param {{ id: string, email: string, confirmed: boolean, metadata: Record<string, any> }} user
   * @param {boolean} [recovery]  true = sesión del enlace de recuperación
   */
  function issue(user, recovery = false) {
    counter += 1;
    const access = `access-${counter}-${randomUUID()}`;
    const refreshToken = `refresh-${counter}-${randomUUID()}`;
    const expiresAt = Math.floor(nowMs() / 1000) + expiresIn;
    accessTokens.set(access, { userId: user.id, expiresAt, recovery });
    refreshTokens.set(refreshToken, { userId: user.id, used: false, recovery });
    return {
      access_token: access, token_type: 'bearer', expires_in: expiresIn, expires_at: expiresAt, refresh_token: refreshToken,
      user: userJson(user),
    };
  }

  /** @param {string | null} token */
  function userFor(token) {
    if (!token) return null;
    const record = accessTokens.get(token);
    if (!record || record.expiresAt <= Math.floor(nowMs() / 1000)) return null;
    for (const user of users.values()) if (user.id === record.userId) return user;
    return null;
  }

  const BAD_JWT = { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature, token is expired' };

  /** @param {any} body */
  function signUp(body) {
    const email = String(body?.email ?? '').toLowerCase();
    const pass = String(body?.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply(400, { code: 400, error_code: 'email_address_invalid', msg: `Email address "${email}" is invalid` });
    if (pass.length < 6) return reply(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.', weak_password: { reasons: ['length'] } });
    if (users.has(email)) {
      if (!confirmEmails) return reply(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      // Con confirmación activa el servidor finge éxito para no revelar quién tiene cuenta.
      return reply(200, { id: randomUUID(), aud: 'authenticated', role: '', email, identities: [], user_metadata: {} });
    }
    const user = { id: randomUUID(), email, password: pass, confirmed: !confirmEmails, metadata: body?.data && typeof body.data === 'object' ? body.data : {} };
    users.set(email, user);
    if (confirmEmails) {
      sendCode('confirm', email);
      return reply(200, { ...userJson(user), confirmation_sent_at: new Date(nowMs()).toISOString() });
    }
    return reply(200, issue(user));
  }

  /** @param {any} body @param {string} [grant] */
  function password(body, grant) {
    if (grant !== 'password') return reply(400, { code: 400, error_code: 'unsupported_grant_type', msg: 'unsupported grant type' });
    const user = users.get(String(body?.email ?? '').toLowerCase());
    if (!user || user.password !== body?.password) return reply(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    if (!user.confirmed) return reply(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
    return reply(200, issue(user));
  }

  /** @param {any} body */
  function refresh(body) {
    const record = refreshTokens.get(String(body?.refresh_token ?? ''));
    if (!record) return reply(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' });
    if (record.used) return reply(400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' });
    record.used = true;
    const user = [...users.values()].find((u) => u.id === record.userId);
    if (!user) return reply(400, { code: 400, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
    return reply(200, issue(user, record.recovery));
  }

  /** @param {string | null} token */
  function logout(token) {
    if (token) accessTokens.delete(token);
    return reply(204, null);
  }

  /** @param {any} body */
  function recover(body) {
    const email = String(body?.email ?? '').toLowerCase();
    if (users.has(email)) sendCode('recovery', email);
    return reply(200, {}); // igual exista o no la cuenta
  }

  /** @param {any} body */
  function resend(body) {
    const email = String(body?.email ?? '').toLowerCase();
    if (users.has(email)) sendCode('confirm', email);
    return reply(200, {});
  }

  /**
   * «Envía» un código de 6 dígitos (queda en server.emails). El anterior del mismo tipo deja de valer.
   * @param {'confirm' | 'recovery'} kind @param {string} email
   */
  function sendCode(kind, email) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    codes.set(`${kind}:${email}`, { code, expiresAt: Math.floor(nowMs() / 1000) + OTP_EXPIRES_S, used: false });
    server.emails.push({ kind, to: email, code });
  }

  /**
   * Comprueba un código como Supabase (POST /auth/v1/verify con type, email y token): vale una sola vez, vence, y si
   * no coincide responde lo mismo que si venció (no revela si la cuenta existe).
   * @param {any} body
   */
  function verify(body) {
    const type = String(body?.type ?? '');
    const email = String(body?.email ?? '').toLowerCase();
    const token = String(body?.token ?? '');
    const kind = type === 'signup' || type === 'email' ? 'confirm' : type === 'recovery' ? 'recovery' : null;
    const EXPIRED = reply(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    if (!kind) return reply(400, { code: 400, error_code: 'validation_failed', msg: 'Verify requires a verification type' });
    const record = codes.get(`${kind}:${email}`);
    const user = users.get(email);
    if (!record || !user || record.used || record.expiresAt <= Math.floor(nowMs() / 1000) || record.code !== token) return EXPIRED;
    record.used = true;
    if (kind === 'confirm') user.confirmed = true;
    return reply(200, issue(user, kind === 'recovery'));
  }

  /** @param {string | null} token */
  function getUser(token) {
    const user = userFor(token);
    return user ? reply(200, userJson(user)) : reply(401, BAD_JWT);
  }

  /** @param {string | null} token @param {any} body */
  function putUser(token, body) {
    const user = userFor(token);
    if (!user) return reply(401, BAD_JWT);
    const next = String(body?.password ?? '');
    // Mismo orden que Supabase Auth: primero la contraseña actual (salvo en recuperación), después «igual a la de antes».
    const recovery = accessTokens.get(/** @type {string} */ (token))?.recovery ?? false;
    if (next && requireCurrentPassword && !recovery) {
      const current = body?.current_password;
      if (typeof current !== 'string' || current === '') return reply(400, { code: 400, error_code: 'current_password_required', msg: 'Current password required when setting new password.' });
      if (current !== user.password) return reply(400, { code: 400, error_code: 'current_password_invalid', msg: 'Current password required when setting new password.' });
    }
    if (next.length < 6) return reply(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.', weak_password: { reasons: ['length'] } });
    if (next === user.password) return reply(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
    user.password = next;
    return reply(200, userJson(user));
  }

  /** @param {string | null} token */
  function deleteAccount(token) {
    const user = userFor(token);
    if (!user) return reply(401, { code: 'PGRST301', message: 'JWT expired' });
    server.revokeAll(user.email);
    data.deleteUser(user.id);
    users.delete(user.email);
    return reply(204, null);
  }

  return server;
}
