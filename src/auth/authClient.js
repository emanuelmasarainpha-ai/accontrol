// @ts-check
// =============================================================================
// CLIENTE DE CUENTAS (Supabase Auth, correo y contraseña)
// -----------------------------------------------------------------------------
// Habla con el servidor de cuentas con `fetch`, sin librerías externas (así la política de seguridad de la
// app puede seguir sin permitir código de terceros). Hace seis cosas:
//   · crear cuenta · entrar · salir · recuperar contraseña · cambiar contraseña · borrar la cuenta
//   · guardar la sesión en este dispositivo y renovarla antes de que venza
//
// Cómo funciona la sesión:
//   · Al entrar, el servidor entrega un "token de acceso" (dura ~1 hora) y un "token de renovación".
//   · Se guardan en este dispositivo para no pedir la contraseña cada vez.
//   · La app abre SIN internet con la sesión guardada: los datos son locales. La renovación se intenta
//     en segundo plano; solo si el servidor responde que la sesión ya no vale (cuenta borrada, sesión
//     cerrada desde otro lugar) se vuelve a pedir la contraseña. Un fallo de red NUNCA cierra la sesión.
//   · Entre varias pestañas, la renovación se hace de una en una (un token de renovación solo sirve una vez).
//
// Todo lo externo (red, almacenamiento, reloj, candados, temporizadores) se inyecta: así se prueba entero.
// =============================================================================

import {
  authErrorMessage, isUserId, normalizeEmail, parseOtp, SESSION_LOST_CODES, validateDisplayName, validateEmail, validateNewPassword,
} from '../domain/accounts.js';

/** Dónde se guarda la sesión en este dispositivo. */
export const SESSION_KEY = 'accontrol.session.v1';

/**
 * Correos a los que ESTE navegador pidió un enlace (crear cuenta, reenviar confirmación, olvidé mi contraseña), con la
 * hora. Un enlace del correo solo abre sesión aquí si se pidió aquí: así nadie puede mandarte un enlace con SU sesión
 * para que, sin darte cuenta, registres tus datos en su cuenta (auditoría de seguridad, 2026-11-14).
 */
export const LINK_REQUESTS_KEY = 'accontrol.auth.linkRequests.v1';
/** Cuánto vale la anotación de un enlace pedido (los enlaces de Supabase vencen antes). */
const LINK_REQUEST_TTL_MS = 2 * 24 * 60 * 60 * 1000;
/** Se renueva cuando faltan menos de estos segundos para que venza. */
const REFRESH_MARGIN_S = 60;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TOKEN_LENGTH = 8192;
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Entrar con Google (0.18.7): la clave de un solo uso (PKCE) que se guarda al ir a Google y se usa al volver. Solo con
 * ella el servidor cambia el permiso que trae la dirección por una sesión: un permiso robado no sirve en otro equipo.
 */
export const OAUTH_VERIFIER_KEY = 'accontrol.auth.pkce.v1';
/** Cuánto vale esa clave: si la vuelta de Google tarda más, hay que empezar otra vez. */
const OAUTH_TTL_MS = 10 * 60 * 1000;

/** Bytes → base64 «para direcciones» (sin +, / ni =). @param {Uint8Array} bytes */
export function base64Url(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** El «desafío» que se manda a Google: SHA-256 de la clave, en base64url. @param {string} verifier */
export async function pkceChallenge(verifier) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * Entrar con Google directo, sin pasar por la dirección de Supabase (0.20.1, solo en el navegador): aquí se guardan
 * el «nonce» (código de un solo uso que Google mete en su respuesta firmada) y el «state» (marca de ida y vuelta).
 */
export const GOOGLE_IDT_KEY = 'accontrol.auth.google-idt.v1';

/** SHA-256 en hexadecimal (lo que Supabase compara con el nonce del token de Google). @param {string} text */
export async function sha256Hex(text) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {Object} AuthUser
 * @property {string} id           UUID de la cuenta.
 * @property {string} email
 * @property {string} displayName  Puede estar vacío.
 */

/**
 * @typedef {Object} AuthSession
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {number} expiresAt    Segundos desde 1970 en que vence el token de acceso.
 * @property {AuthUser} user
 */

/**
 * @typedef {Object} AuthError
 * @property {string} code     error_code del servidor, o 'network' | 'timeout' | 'validation' | 'invalid_response' | 'no_session'
 * @property {string} message  Texto en español para mostrar.
 * @property {number} status   Estado HTTP (0 = no hubo respuesta).
 * @property {string} [field]  Campo del formulario al que se refiere: 'email' | 'password' | 'displayName' | 'currentPassword' | 'code'.
 */

/** Errores del servidor que se refieren a la contraseña ACTUAL (falta o no es correcta). */
const CURRENT_PASSWORD_CODES = new Set(['current_password_required', 'current_password_invalid']);

/** @typedef {{ ok: false, error: AuthError }} Failure */
/** @typedef {{ ok: true, status: number, body: any }} Reply */

/**
 * @typedef {Object} AuthOptions
 * @property {string} url             Dirección del proyecto (https://xxxx.supabase.co).
 * @property {string} publishableKey  Llave PÚBLICA del proyecto (nunca una llave secreta).
 * @property {typeof fetch} [fetch]
 * @property {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} [storage]
 * @property {() => number} [now]     Milisegundos desde 1970.
 * @property {string} [redirectTo]    A dónde vuelven los enlaces de los correos (debe estar permitido en Supabase).
 * @property {{ request: (name: string, callback: () => Promise<any>) => Promise<any> } | null} [locks]
 * @property {(callback: () => void, ms: number) => any} [setTimer]
 * @property {(handle: any) => void} [clearTimer]
 */

/**
 * @typedef {'signed-in' | 'signed-out' | 'updated'} AuthEventType
 * @typedef {{ type: AuthEventType, session: AuthSession | null }} AuthEvent
 */

/** @returns {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} */
function browserStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // algunos navegadores lanzan un error con solo tocar localStorage (datos de sitios bloqueados)
  }
}

/**
 * Convierte la respuesta del servidor en una sesión válida, o null si le falta algo.
 * @param {any} body
 * @param {number} nowS
 * @returns {AuthSession | null}
 */
export function sessionFromBody(body, nowS) {
  if (!body || typeof body !== 'object') return null;
  const { access_token: accessToken, refresh_token: refreshToken, user } = body;
  if (typeof accessToken !== 'string' || accessToken === '' || accessToken.length > MAX_TOKEN_LENGTH) return null;
  if (typeof refreshToken !== 'string' || refreshToken === '' || refreshToken.length > MAX_TOKEN_LENGTH) return null;
  const parsed = userFromBody(user);
  if (!parsed) return null;
  const expiresIn = Number(body.expires_in);
  const expiresAt = Number.isFinite(Number(body.expires_at)) && Number(body.expires_at) > 0
    ? Number(body.expires_at)
    : nowS + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600);
  return { accessToken, refreshToken, expiresAt: Math.floor(expiresAt), user: parsed };
}

/**
 * @param {any} user
 * @returns {AuthUser | null}
 */
function userFromBody(user) {
  if (!user || typeof user !== 'object' || !isUserId(user.id)) return null;
  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const name = typeof meta.display_name === 'string' ? validateDisplayName(meta.display_name) : null;
  return {
    id: user.id,
    email: typeof user.email === 'string' ? normalizeEmail(user.email) : '',
    displayName: name && name.ok ? name.name : '',
  };
}

/**
 * Qué código de error corresponde a una respuesta fallida (el servidor usa dos formatos).
 * @param {any} body @param {number} status
 */
function errorCodeOf(body, status) {
  if (body && typeof body === 'object') {
    if (typeof body.error_code === 'string' && body.error_code) return body.error_code;
    const text = `${body.msg ?? ''} ${body.error_description ?? ''} ${body.message ?? ''}`.toLowerCase();
    if (text.includes('invalid login credentials')) return 'invalid_credentials';
    if (text.includes('email not confirmed')) return 'email_not_confirmed';
    if (text.includes('already registered')) return 'user_already_exists';
    if (typeof body.error === 'string' && body.error) return body.error;
    if (typeof body.code === 'string' && body.code) return body.code;
  }
  return status === 429 ? 'over_request_rate_limit' : 'unknown';
}

/**
 * @param {string} code @param {number} status @param {string} [field]
 * @returns {Failure}
 */
function failure(code, status, field) {
  return { ok: false, error: { code, status, message: authErrorMessage(code, status), ...(field ? { field } : {}) } };
}

/**
 * @param {string} message @param {'email' | 'password' | 'displayName' | 'currentPassword' | 'code'} field
 * @returns {Failure}
 */
function invalid(message, field) {
  return { ok: false, error: { code: 'validation', status: 0, message, field } };
}

/**
 * @param {AuthOptions} options
 */
export function createAuthClient(options) {
  const base = options.url.replace(/\/+$/, '');
  const fetchFn = options.fetch ?? ((/** @type {any[]} */ ...args) => /** @type {any} */ (globalThis.fetch)(...args));
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const nowMs = options.now ?? (() => Date.now());
  const redirectTo = options.redirectTo ?? '';
  const locks = options.locks === undefined ? (globalThis.navigator?.locks ?? null) : options.locks;
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));

  /** @type {AuthSession | null} */
  let session = null;
  /** Si no se puede guardar en el dispositivo (ventana privada), la sesión vive solo en memoria. */
  let memoryOnly = false;
  /** @type {Set<(event: AuthEvent) => void>} */
  const listeners = new Set();
  /** @type {any} */
  let timer = null;
  /** @type {Promise<AuthSession | null> | null} */
  let refreshing = null;

  const nowS = () => Math.floor(nowMs() / 1000);

  // ------------------------------------------------------------ almacenamiento
  /** @returns {AuthSession | null} */
  function readStored() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      const user = userFromBody(data.user);
      if (!user) return null;
      if (typeof data.accessToken !== 'string' || data.accessToken === '' || data.accessToken.length > MAX_TOKEN_LENGTH) return null;
      if (typeof data.refreshToken !== 'string' || data.refreshToken === '' || data.refreshToken.length > MAX_TOKEN_LENGTH) return null;
      if (!Number.isFinite(data.expiresAt)) return null;
      return { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: data.expiresAt, user };
    } catch {
      return null;
    }
  }

  /** @param {AuthSession | null} next */
  function writeStored(next) {
    if (!storage) {
      memoryOnly = true;
      return;
    }
    try {
      if (next) storage.setItem(SESSION_KEY, JSON.stringify(next));
      else storage.removeItem(SESSION_KEY);
    } catch {
      memoryOnly = true; // sin espacio o bloqueado: la sesión dura mientras la página esté abierta
    }
  }

  // ------------------------------------------------- enlaces pedidos desde aquí
  /** @returns {Record<string, number>} correo → cuándo se pidió (solo los que siguen vigentes) */
  function readLinkRequests() {
    if (!storage) return {};
    try {
      const data = JSON.parse(storage.getItem(LINK_REQUESTS_KEY) ?? '{}');
      /** @type {Record<string, number>} */
      const out = {};
      if (!data || typeof data !== 'object') return out;
      for (const [email, at] of Object.entries(data)) {
        if (typeof email === 'string' && Number.isFinite(at) && nowMs() - Number(at) < LINK_REQUEST_TTL_MS) out[email] = Number(at);
      }
      return out;
    } catch {
      return {};
    }
  }

  /** @param {Record<string, number>} map */
  function writeLinkRequests(map) {
    if (!storage) return;
    try {
      if (Object.keys(map).length) storage.setItem(LINK_REQUESTS_KEY, JSON.stringify(map));
      else storage.removeItem(LINK_REQUESTS_KEY);
    } catch {
      // Sin poder anotarlo, el enlace no abrirá sesión aquí; queda el código de 6 dígitos o la contraseña.
    }
  }

  /** @param {string} email ya normalizado */
  function rememberLinkRequest(email) {
    writeLinkRequests({ ...readLinkRequests(), [email]: nowMs() });
  }

  /** @param {string} email */
  function forgetLinkRequest(email) {
    const map = readLinkRequests();
    delete map[email];
    writeLinkRequests(map);
  }

  /** @param {AuthEventType} type */
  function emit(type) {
    for (const listener of [...listeners]) {
      try {
        listener({ type, session });
      } catch (error) {
        console.error('Error en un oyente de sesión:', error);
      }
    }
  }

  /** @param {AuthSession} next @param {AuthEventType} type */
  function setSession(next, type) {
    session = next;
    writeStored(next);
    scheduleRefresh();
    emit(type);
  }

  function clearSession() {
    const had = session !== null;
    session = null;
    writeStored(null);
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (had) emit('signed-out');
  }

  // ---------------------------------------------------------------------- red
  /**
   * @param {string} method
   * @param {string} path           Empieza con /auth/v1/… o /rest/v1/…
   * @param {{ body?: unknown, token?: string, query?: Record<string, string> }} [init]
   * @returns {Promise<Reply | Failure>}
   */
  async function request(method, path, init = {}) {
    const query = init.query && Object.keys(init.query).length > 0 ? `?${new URLSearchParams(init.query).toString()}` : '';
    /** @type {Record<string, string>} */
    const headers = { apikey: options.publishableKey, Accept: 'application/json' };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const abortTimer = controller ? setTimer(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await fetchFn(`${base}${path}${query}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller?.signal,
      });
      const text = await response.text();
      /** @type {any} */
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!response.ok) return failure(errorCodeOf(body, response.status), response.status);
      return { ok: true, status: response.status, body };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return failure(aborted ? 'timeout' : 'network', 0);
    } finally {
      if (abortTimer !== null) clearTimer(abortTimer);
    }
  }

  // ----------------------------------------------------------------- renovación
  /** @returns {Promise<AuthSession | null>} */
  function refreshOnce() {
    if (refreshing) return refreshing;
    const run = async () => {
      // Otra pestaña pudo renovar o cerrar la sesión mientras esperábamos el turno.
      const stored = memoryOnly ? session : readStored();
      if (!stored) {
        clearSession();
        return null;
      }
      if (session === null || stored.accessToken !== session.accessToken) {
        session = stored;
        scheduleRefresh();
      }
      if (stored.expiresAt - nowS() > REFRESH_MARGIN_S) return stored;

      const reply = await request('POST', '/auth/v1/token', {
        query: { grant_type: 'refresh_token' },
        body: { refresh_token: stored.refreshToken },
      });
      if (reply.ok) {
        const next = sessionFromBody(reply.body, nowS());
        if (next) {
          setSession(next, 'updated');
          return next;
        }
        return stored;
      }
      const { status } = reply.error;
      // Un 4xx (salvo "tiempo agotado" y "demasiadas peticiones") significa que el servidor rechazó esta sesión.
      const definitive = status >= 400 && status < 500 && status !== 408 && status !== 429;
      if (definitive) {
        clearSession();
        return null;
      }
      return stored; // sin red o servidor caído: se sigue con lo que hay y se reintenta después
    };
    const guarded = async () => (locks ? locks.request('accontrol-auth-refresh', run) : run());
    refreshing = guarded().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** @param {number} [delayMs] Si no se da, se renueva un minuto antes de que venza. */
  function scheduleRefresh(delayMs) {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!session) return;
    const wait = delayMs ?? Math.min(MAX_TIMER_MS, Math.max(5_000, (session.expiresAt - nowS() - REFRESH_MARGIN_S) * 1000));
    timer = setTimer(async () => {
      timer = null;
      const current = await refreshOnce();
      // Al renovar con éxito, setSession ya programó la siguiente. Si no se pudo (sin red), se reintenta en un minuto.
      if (current && timer === null && current.expiresAt - nowS() <= REFRESH_MARGIN_S) scheduleRefresh(60_000);
    }, wait);
    timer?.unref?.();
  }

  /**
   * El token de acceso vigente, renovado si hace falta. null si no hay sesión o no se pudo renovar a tiempo.
   * (La app NO lo necesita para abrir: sirve para hablar con la base de datos en la nube.)
   * @returns {Promise<string | null>}
   */
  async function getAccessToken() {
    if (!session) return null;
    const fresh = session.expiresAt - nowS() > REFRESH_MARGIN_S ? session : await refreshOnce();
    if (!fresh || fresh.expiresAt - nowS() <= 0) return null;
    return fresh.accessToken;
  }

  // ----------------------------------------------------------------- acciones
  /**
   * @param {Reply} reply
   * @returns {{ ok: true } | Failure}
   */
  function adoptSession(reply) {
    const next = sessionFromBody(reply.body, nowS());
    if (!next) return failure('invalid_response', reply.status);
    setSession(next, 'signed-in');
    return { ok: true };
  }

  /**
   * Manda el cambio de contraseña al servidor con la sesión abierta.
   * @param {{ password: string, current_password?: string }} body
   * @returns {Promise<{ ok: true } | Failure>}
   */
  async function putPassword(body) {
    const token = await getAccessToken();
    if (!token || !session) return failure('session_not_found', 401);
    const reply = await request('PUT', '/auth/v1/user', { token, body });
    if (!reply.ok) {
      if (SESSION_LOST_CODES.has(reply.error.code)) clearSession();
      return reply;
    }
    const user = userFromBody(reply.body);
    if (user && session) setSession({ ...session, user }, 'updated');
    return { ok: true };
  }

  /** @returns {Record<string, string>} */
  const redirectQuery = () => (redirectTo ? { redirect_to: redirectTo } : {});

  return {
    /**
     * Carga la sesión guardada. No espera a la red: si hay sesión, la app abre de inmediato.
     * @returns {AuthSession | null}
     */
    init() {
      session = readStored();
      if (session) {
        scheduleRefresh();
        if (session.expiresAt - nowS() <= REFRESH_MARGIN_S) void refreshOnce();
      }
      return session;
    },

    getSession: () => session,
    getUser: () => session?.user ?? null,
    /** true si no se pudo guardar la sesión en el dispositivo (se perderá al cerrar la página). */
    isMemoryOnly: () => memoryOnly,
    getAccessToken,

    /** @param {(event: AuthEvent) => void} listener */
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Crea la cuenta. Según la configuración del servidor, entra de una vez (`signedIn: true`) o pide confirmar
     * el correo primero (`signedIn: false`).
     * @param {{ email: string, password: string, displayName?: string }} input
     * @returns {Promise<{ ok: true, signedIn: boolean, email: string } | Failure>}
     */
    async signUp(input) {
      const email = validateEmail(input.email);
      if (!email.ok) return invalid(email.error, 'email');
      const password = validateNewPassword(input.password, email.email);
      if (!password.ok) return invalid(password.error, 'password');
      const name = validateDisplayName(input.displayName ?? '');
      if (!name.ok) return invalid(name.error, 'displayName');

      const reply = await request('POST', '/auth/v1/signup', {
        query: redirectQuery(),
        body: { email: email.email, password: input.password, data: name.name ? { display_name: name.name } : {} },
      });
      if (!reply.ok) return reply;
      if (reply.body && typeof reply.body.access_token === 'string') {
        const adopted = adoptSession(reply);
        return adopted.ok ? { ok: true, signedIn: true, email: email.email } : adopted;
      }
      // Con confirmación de correo activa no hay sesión todavía. Si el correo ya existía, el servidor responde igual
      // (para no revelar quién tiene cuenta); por eso el aviso de la pantalla es neutral.
      rememberLinkRequest(email.email);
      return { ok: true, signedIn: false, email: email.email };
    },

    /**
     * @param {{ email: string, password: string }} input
     * @returns {Promise<{ ok: true } | Failure>}
     */
    async signIn(input) {
      const email = validateEmail(input.email);
      if (!email.ok) return invalid(email.error, 'email');
      if (typeof input.password !== 'string' || input.password === '') return invalid('Escribe tu contraseña.', 'password');
      const reply = await request('POST', '/auth/v1/token', {
        query: { grant_type: 'password' },
        body: { email: email.email, password: input.password },
      });
      return reply.ok ? adoptSession(reply) : reply;
    },

    /**
     * Cierra la sesión en este dispositivo. Siempre la borra de aquí, aunque el servidor no responda.
     * Los datos guardados en este dispositivo NO se borran.
     */
    async signOut() {
      const token = session?.accessToken;
      if (token) await request('POST', '/auth/v1/logout', { token, query: { scope: 'local' } });
      clearSession();
    },

    /**
     * Envía el correo para elegir una contraseña nueva. Responde igual exista o no la cuenta.
     * @param {string} rawEmail
     * @returns {Promise<{ ok: true, email: string } | Failure>}
     */
    async requestPasswordReset(rawEmail) {
      const email = validateEmail(rawEmail);
      if (!email.ok) return invalid(email.error, 'email');
      const reply = await request('POST', '/auth/v1/recover', { query: redirectQuery(), body: { email: email.email } });
      if (reply.ok) rememberLinkRequest(email.email);
      return reply.ok ? { ok: true, email: email.email } : reply;
    },

    /**
     * Vuelve a enviar el correo de confirmación.
     * @param {string} rawEmail
     * @returns {Promise<{ ok: true } | Failure>}
     */
    async resendConfirmation(rawEmail) {
      const email = validateEmail(rawEmail);
      if (!email.ok) return invalid(email.error, 'email');
      const reply = await request('POST', '/auth/v1/resend', { query: redirectQuery(), body: { type: 'signup', email: email.email } });
      if (reply.ok) rememberLinkRequest(email.email);
      return reply.ok ? { ok: true } : reply;
    },

    /**
     * Comprueba el código de 6 dígitos que llegó al correo (0.14.6) y, si vale, abre la sesión.
     *  · type 'signup': confirma la cuenta recién creada.
     *  · type 'recovery': «Olvidé mi contraseña»; la sesión que abre es de recuperación (deja elegir la contraseña nueva
     *    sin pedir la actual, igual que el enlace del correo).
     * Quien decide si el código vale es el servidor (sirve una sola vez y vence); la app nunca lo guarda.
     * @param {{ email: string, code: string, type: 'signup' | 'recovery' }} input
     * @returns {Promise<{ ok: true } | Failure>}
     */
    async verifyCode(input) {
      const email = validateEmail(input.email);
      if (!email.ok) return invalid(email.error, 'email');
      const code = parseOtp(input.code);
      if (!code.ok) return invalid(code.error, 'code');
      if (input.type !== 'signup' && input.type !== 'recovery') return invalid('Tipo de código desconocido.', 'code');
      const reply = await request('POST', '/auth/v1/verify', { body: { type: input.type, email: email.email, token: code.code } });
      return reply.ok ? adoptSession(reply) : reply;
    },

    /**
     * Elige una contraseña nueva SIN pedir la actual. Solo para el enlace de recuperación («Olvidé mi contraseña»):
     * esa sesión viene del correo y el servidor no exige la actual en ella. Desde Cuenta se usa `changePassword`.
     * @param {string} newPassword
     * @returns {Promise<{ ok: true } | Failure>}
     */
    async updatePassword(newPassword) {
      const check = validateNewPassword(newPassword, session?.user.email ?? '');
      if (!check.ok) return invalid(check.error, 'password');
      return putPassword({ password: newPassword });
    },

    /**
     * Cambia la contraseña desde Cuenta: pide la ACTUAL y la manda al servidor (`current_password`) para que él
     * también la compruebe (si el proyecto tiene activada «exigir la contraseña actual»).
     * @param {{ currentPassword: string, newPassword: string }} input
     * @returns {Promise<{ ok: true } | Failure>}
     */
    async changePassword(input) {
      const current = typeof input.currentPassword === 'string' ? input.currentPassword : '';
      if (current === '') return invalid(authErrorMessage('current_password_required'), 'currentPassword');
      const check = validateNewPassword(input.newPassword, session?.user.email ?? '');
      if (!check.ok) return invalid(check.error, 'password');
      if (input.newPassword === current) return failure('same_password', 0, 'password');
      const reply = await putPassword({ password: input.newPassword, current_password: current });
      if (reply.ok) return reply;
      const field = CURRENT_PASSWORD_CODES.has(reply.error.code) ? 'currentPassword' : reply.error.code === 'same_password' ? 'password' : undefined;
      return field ? { ok: false, error: { ...reply.error, field } } : reply;
    },

    /**
     * Borra la cuenta y todo lo que tiene en la nube. No borra lo guardado en este dispositivo. Irreversible.
     * @returns {Promise<{ ok: true } | Failure>}
     */
    async deleteAccount() {
      const token = await getAccessToken();
      if (!token) return failure('session_not_found', 401);
      const reply = await request('POST', '/rest/v1/rpc/delete_my_account', { token, body: {} });
      if (!reply.ok) {
        if (reply.error.status === 401) return failure('session_not_found', 401);
        return reply;
      }
      clearSession();
      return { ok: true };
    },

    /**
     * Lee lo que dejan los enlaces de los correos en la dirección (#access_token=… o #error=…), valida la sesión
     * con el servidor y la guarda. El llamador debe limpiar la dirección después.
     * @param {string} hash  window.location.hash
     * @returns {Promise<{ kind: 'none' } | { kind: 'signed-in' } | { kind: 'recovery' } | { kind: 'error', message: string }>}
     */
    async consumeUrlHash(hash) {
      const raw = hash.startsWith('#') ? hash.slice(1) : hash;
      // Una ruta de la app (#/inicio) no trae parámetros: cae en { kind: 'none' } más abajo.
      const params = new URLSearchParams(raw);
      if (params.has('error') || params.has('error_code')) {
        const code = params.get('error_code') ?? params.get('error') ?? '';
        return { kind: 'error', message: authErrorMessage(code, 0) };
      }
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (!accessToken || !refreshToken || accessToken.length > MAX_TOKEN_LENGTH || refreshToken.length > MAX_TOKEN_LENGTH) {
        return { kind: 'none' };
      }
      // No se confía en el enlace tal cual: el servidor confirma que el token es real y dice de quién es.
      const reply = await request('GET', '/auth/v1/user', { token: accessToken });
      if (!reply.ok) return { kind: 'error', message: reply.error.message };
      const user = userFromBody(reply.body);
      if (!user) return { kind: 'error', message: authErrorMessage('invalid_response') };
      // Un enlace nunca cambia la cuenta que ya está abierta por otra.
      if (session && session.user.id !== user.id) {
        return { kind: 'error', message: 'Este enlace es de otra cuenta. Si quieres usarla, primero cierra la sesión actual.' };
      }
      // Sin sesión abierta, el enlace solo vale en el navegador donde se pidió (crear cuenta, reenviar, recuperar).
      if (!session && !Object.hasOwn(readLinkRequests(), user.email)) {
        return {
          kind: 'error',
          message: 'Por seguridad, abre el enlace en el mismo dispositivo y navegador donde lo pediste, o entra con tu correo y contraseña.',
        };
      }
      forgetLinkRequest(user.email);
      const expiresAt = Number(params.get('expires_at'));
      const expiresIn = Number(params.get('expires_in'));
      setSession(
        {
          accessToken,
          refreshToken,
          expiresAt: Math.floor(Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : nowS() + (expiresIn > 0 ? expiresIn : 3600)),
          user,
        },
        'signed-in',
      );
      return { kind: params.get('type') === 'recovery' ? 'recovery' : 'signed-in' };
    },

    /**
     * ¿Qué formas de entrar tiene activadas el servidor? (Google se activa en el panel de Supabase.)
     * @returns {Promise<{ ok: true, google: boolean } | Failure>}
     */
    async providers() {
      const reply = await request('GET', '/auth/v1/settings');
      if (!reply.ok) return reply;
      return { ok: true, google: reply.body?.external?.google === true };
    },

    /**
     * La dirección para entrar con Google. Guarda en el dispositivo la clave de un solo uso (PKCE) y manda a Google
     * solo su huella. `returnTo`: adónde vuelve (la página de la app, o la dirección de la app de Android).
     * @param {string} returnTo
     */
    async googleSignInUrl(returnTo) {
      const verifier = base64Url(globalThis.crypto.getRandomValues(new Uint8Array(48)));
      if (!storage) throw new Error('Sin almacenamiento');
      storage.setItem(OAUTH_VERIFIER_KEY, JSON.stringify({ verifier, at: nowMs() }));
      const query = new URLSearchParams({
        provider: 'google', redirect_to: returnTo, code_challenge: await pkceChallenge(verifier), code_challenge_method: 's256',
      });
      return `${base}/auth/v1/authorize?${query.toString()}`;
    },

    /**
     * 0.20.1 (navegador): la dirección para entrar con Google SIN pasar por la de Supabase, así Google muestra la
     * dirección de ACCONTROL. Google vuelve a `returnTo` con #id_token=… (su respuesta firmada) y la app se la da a
     * Supabase, que la comprueba. Se guardan en el dispositivo el nonce (de un solo uso; a Google solo va su huella)
     * y el state (para aceptar solo la vuelta del intento que empezó aquí).
     * @param {string} returnTo  la página de la app; debe estar registrada en Google como dirección de vuelta
     * @param {string} clientId  el «Client ID» web de Google (público)
     */
    async googleIdTokenUrl(returnTo, clientId) {
      if (!storage) throw new Error('Sin almacenamiento');
      const nonce = base64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
      const state = base64Url(globalThis.crypto.getRandomValues(new Uint8Array(24)));
      storage.setItem(GOOGLE_IDT_KEY, JSON.stringify({ nonce, state, at: nowMs() }));
      const query = new URLSearchParams({
        client_id: clientId, redirect_uri: returnTo, response_type: 'id_token', scope: 'openid email profile',
        nonce: await sha256Hex(nonce), state, prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
    },

    /**
     * 0.20.1: al volver de Google directo. La dirección trae #id_token=…&state=… (o #error=…&state=…). Solo se acepta
     * si el state coincide con el guardado y no pasó demasiado tiempo; el nonce se borra (sirve una sola vez).
     * El llamador limpia la dirección después.
     * @param {string} hash  window.location.hash
     * @returns {Promise<{ kind: 'none' } | { kind: 'signed-in' } | { kind: 'error', message: string }>}
     */
    async consumeGoogleIdToken(hash) {
      const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
      const idToken = params.get('id_token');
      const state = params.get('state');
      const googleError = params.get('error');
      if (!state || (!idToken && !googleError)) return { kind: 'none' };
      /** @type {{ nonce?: unknown, state?: unknown, at?: unknown } | null} */
      let saved = null;
      try {
        saved = JSON.parse(storage?.getItem(GOOGLE_IDT_KEY) ?? 'null');
      } catch {
        saved = null;
      }
      storage?.removeItem(GOOGLE_IDT_KEY);
      if (!saved || typeof saved.state !== 'string' || saved.state !== state) {
        return { kind: 'error', message: 'Por seguridad, empieza otra vez «Continuar con Google» en este dispositivo.' };
      }
      if (googleError) return { kind: 'error', message: 'No se pudo entrar con Google. Inténtalo de nuevo o entra con tu correo.' };
      if (typeof saved.nonce !== 'string' || typeof saved.at !== 'number' || nowMs() - saved.at > OAUTH_TTL_MS) {
        return { kind: 'error', message: 'Por seguridad, empieza otra vez «Continuar con Google» en este dispositivo.' };
      }
      if (!idToken || idToken.length > MAX_TOKEN_LENGTH) return { kind: 'error', message: authErrorMessage('invalid_response') };
      const reply = await request('POST', '/auth/v1/token', {
        query: { grant_type: 'id_token' }, body: { provider: 'google', id_token: idToken, nonce: saved.nonce },
      });
      if (!reply.ok) return { kind: 'error', message: reply.error.message };
      const adopted = adoptSession(reply);
      return adopted.ok ? { kind: 'signed-in' } : { kind: 'error', message: adopted.error.message };
    },

    /**
     * Al volver de Google: la dirección trae ?code=… (o ?error=…). Se cambia por una sesión con la clave guardada, que
     * se borra (sirve una sola vez). El llamador limpia la dirección después.
     * @param {string} search  window.location.search, o lo que viene después de «?» en la dirección de la app de Android
     * @returns {Promise<{ kind: 'none' } | { kind: 'signed-in' } | { kind: 'error', message: string }>}
     */
    async consumeOAuthCode(search) {
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const code = params.get('code');
      const oauthError = params.get('error_description') ?? params.get('error');
      if (!code && !oauthError) return { kind: 'none' };
      /** @type {{ verifier?: unknown, at?: unknown } | null} */
      let saved = null;
      try {
        saved = JSON.parse(storage?.getItem(OAUTH_VERIFIER_KEY) ?? 'null');
      } catch {
        saved = null;
      }
      storage?.removeItem(OAUTH_VERIFIER_KEY);
      if (oauthError) return { kind: 'error', message: 'No se pudo entrar con Google. Inténtalo de nuevo o entra con tu correo.' };
      if (!saved || typeof saved.verifier !== 'string' || typeof saved.at !== 'number' || nowMs() - saved.at > OAUTH_TTL_MS) {
        return { kind: 'error', message: 'Por seguridad, empieza otra vez «Continuar con Google» en este dispositivo.' };
      }
      if (!code || code.length > MAX_TOKEN_LENGTH) return { kind: 'error', message: authErrorMessage('invalid_response') };
      const reply = await request('POST', '/auth/v1/token', { query: { grant_type: 'pkce' }, body: { auth_code: code, code_verifier: saved.verifier } });
      if (!reply.ok) return { kind: 'error', message: reply.error.message };
      const adopted = adoptSession(reply);
      return adopted.ok ? { kind: 'signed-in' } : { kind: 'error', message: adopted.error.message };
    },

    /** Detiene la renovación automática (para pruebas y al cerrar). */
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      listeners.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createAuthClient>} AuthClient */
