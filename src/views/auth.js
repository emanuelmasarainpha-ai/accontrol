// @ts-check
// =============================================================================
// PANTALLAS DE ACCESO: entrar, crear cuenta, recuperar contraseña
// -----------------------------------------------------------------------------
// Solo dibujan (devuelven HTML seguro). Quien maneja los botones y habla con el servidor es
// app/authGate.js. Aparecen a pantalla completa, sin menús, antes de abrir la app.
// =============================================================================

import { isGmail, maskEmail, PASSWORD_HINT, validateEmail } from '../domain/accounts.js';
import { passwordInput } from '../ui/passwordToggle.js';
import { currentTheme, dayNightButton } from '../ui/theme.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/**
 * @typedef {'signin' | 'signup' | 'forgot' | 'recovery' | 'check-email' | 'reset-sent' | 'recovery-done'} AuthMode
 */

/**
 * @typedef {Object} AuthViewState
 * @property {AuthMode} mode
 * @property {string} email       Correo escrito (se conserva al cambiar de pantalla).
 * @property {string} displayName Nombre escrito al crear la cuenta.
 * @property {{ kind: 'error' | 'info' | 'success', text: string } | null} notice Mensaje arriba del formulario.
 * @property {boolean} busy       Hay una petición en curso.
 * @property {boolean} canResend  Ya se puede volver a pedir el correo de confirmación.
 * @property {boolean} [intro]    Es la primera vez que se dibuja: la curva de arriba baja con su animación de entrada.
 * @property {'none' | 'checking' | 'on' | 'off' | 'unknown'} [google]  0.18.7: «Continuar con Google» ('none' = sin el botón).
 */

/** Títulos de la pestaña del navegador por pantalla. @type {Record<AuthMode, string>} */
export const AUTH_TITLES = {
  signin: 'Entrar',
  signup: 'Crear cuenta',
  forgot: 'Recuperar contraseña',
  recovery: 'Contraseña nueva',
  'check-email': 'Confirma tu correo',
  'reset-sent': 'Revisa tu correo',
  'recovery-done': 'Contraseña actualizada',
};

/** Pantallas del camino «Olvidé mi contraseña» (0.20.5): tienen su propio diseño, sin la curva de arriba. */
const RECOVER_MODES = new Set(['forgot', 'reset-sent', 'recovery', 'recovery-done']);

/** @param {AuthViewState} state */
export function renderAuth(state) {
  const body = {
    signin: signInPage,
    signup: signUpPage,
    forgot: forgotPage,
    recovery: recoveryPage,
    'check-email': checkEmailPage,
    'reset-sent': resetSentPage,
    'recovery-done': recoveryDonePage,
  }[state.mode](state);
  const recover = RECOVER_MODES.has(state.mode) ? ' auth--recover' : '';
  // El sol y la luna (modo claro / oscuro) también en las pantallas de acceso (0.14.6).
  return html`<section class="welcome welcome--form auth${recover}${state.intro ? ' auth--intro' : ''}" aria-labelledby="auth-title" data-auth-mode="${state.mode}"><div class="auth__theme">${dayNightButton(currentTheme())}</div>${body}</section>`;
}

/** @param {string} title @param {string} sub */
function head(title, sub) {
  return html`<header class="welcome__head">
    <img class="welcome__mark" src="icons/icon.svg" alt="" width="56" height="56" />
    <h1 class="welcome__title" id="auth-title">${title}</h1>
    <p class="welcome__sub">${sub}</p>
  </header>`;
}

/** @param {AuthViewState['notice']} notice */
function noticeBlock(notice) {
  if (!notice) return '';
  const role = notice.kind === 'error' ? 'alert' : 'status';
  return html`<p class="auth__notice auth__notice--${notice.kind}" role="${role}" data-auth-notice>${notice.text}</p>`;
}

/** @param {string} id @param {string} name @param {string} label @param {'current-password' | 'new-password'} autocomplete @param {string} [hint] */
function passwordField(id, name, label, autocomplete, hint) {
  return html`<div class="field" data-field="${name}">
    <label for="${id}">${label}</label>
    ${passwordInput({ id, name, autocomplete, describedBy: `${id}-hint ${id}-error`, label: label.toLowerCase() })}
    ${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : html`<span id="${id}-hint" hidden></span>`}
    <p class="field__error" id="${id}-error" data-error-for="${name}" hidden></p>
  </div>`;
}

/** @param {string} email @param {boolean} [first] */
function emailField(email, first = true) {
  return html`<div class="field" data-field="email">
    <label for="auth-email">Correo</label>
    <input id="auth-email" name="email" class="input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" value="${email}" ${first ? 'data-autofocus' : ''} aria-describedby="auth-email-error" />
    <p class="field__error" id="auth-email-error" data-error-for="email" hidden></p>
  </div>`;
}

/** @param {AuthViewState} state @param {string} label */
function submitButton(state, label) {
  return html`<div class="actions"><button type="submit" class="btn btn--primary btn--block" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Un momento…' : label}</button></div>`;
}

const LOCAL_DATA_NOTE = html`<p class="auth__fine">${icon('lock', 14)}<span>Tu contraseña la guarda el servidor de cuentas cifrada (nunca la ve ACCONTROL). Tus datos financieros se guardan <strong>en este dispositivo</strong>; dentro de la app puedes activar, si quieres, la <strong>copia en la nube</strong> (Ajustes).</span></p>`;

/** La «G» de Google (sus colores de marca, como piden sus normas para el botón de entrar). Decorativa. */
const GOOGLE_G = html`<svg class="google-g" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>`;

/**
 * 0.18.7: «o» y el botón de Google, debajo de «Entrar». Arranca desactivado: authGate lo activa cuando el servidor
 * confirma que Google está encendido (y, si no, dice por qué no).
 * @param {AuthViewState} state
 */
function googleBlock(state) {
  if (!state.google || state.google === 'none') return '';
  return html`<div class="auth__or" aria-hidden="true"><span>o</span></div>
    <button type="button" class="btn btn--google btn--block" data-auth-google ${state.google === 'on' ? '' : 'disabled'}>${GOOGLE_G}<span>Continuar con Google</span></button>
    <p class="hint auth__google-note" data-auth-google-note role="status" hidden></p>`;
}

/** @param {AuthViewState} state */
function signInPage(state) {
  return html`${head('Entra a ACCONTROL', 'Con tu correo y tu contraseña.')}
    ${noticeBlock(state.notice)}
    <form class="panel stack" data-auth-form="signin" novalidate>
      ${emailField(state.email)}
      ${passwordField('auth-password', 'password', 'Contraseña', 'current-password')}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${submitButton(state, 'Entrar')}
      ${googleBlock(state)}
      <p class="auth__links"><button type="button" class="link-btn" data-auth-go="forgot">Olvidé mi contraseña</button></p>
    </form>
    <p class="auth__switch">¿Todavía no tienes cuenta? <button type="button" class="link-btn" data-auth-go="signup">Crear cuenta</button></p>`;
}

/** @param {AuthViewState} state */
function signUpPage(state) {
  return html`${head('Crea tu cuenta', 'Un correo y una contraseña. Después eliges cómo usar ACCONTROL: personal, freelancer, emprendedor o empresa.')}
    ${noticeBlock(state.notice)}
    <form class="panel stack" data-auth-form="signup" novalidate>
      <div class="field" data-field="displayName">
        <label for="auth-name">Tu nombre <span class="muted">(opcional)</span></label>
        <input id="auth-name" name="displayName" class="input" type="text" autocomplete="given-name" maxlength="40" value="${state.displayName}" aria-describedby="auth-name-error" />
        <p class="field__error" id="auth-name-error" data-error-for="displayName" hidden></p>
      </div>
      ${emailField(state.email, false)}
      ${passwordField('auth-password', 'password', 'Contraseña', 'new-password', `${PASSWORD_HINT} Una frase larga es más fácil de recordar.`)}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${submitButton(state, 'Crear cuenta')}
    </form>
    <p class="auth__switch">¿Ya tienes cuenta? <button type="button" class="link-btn" data-auth-go="signin">Entrar</button></p>
    ${LOCAL_DATA_NOTE}`;
}

/**
 * Campo del código de 6 dígitos (0.14.6): se ve como 000-000 mientras escribes, acepta pegar el código (con o sin guion)
 * y tiene un botón «Pegar». El teclado del celular es numérico y puede ofrecer el código solo (one-time-code).
 */
function codeField() {
  return html`<div class="field" data-field="code">
    <label for="auth-code">Código de 6 dígitos</label>
    <div class="input-row">
      <input id="auth-code" name="code" class="input otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000-000" autocapitalize="none" spellcheck="false" data-otp-input data-autofocus aria-describedby="auth-code-hint auth-code-error" />
      <button type="button" class="btn btn--ghost" data-otp-paste>${icon('copy', 16)}Pegar</button>
    </div>
    <p class="hint" id="auth-code-hint">Cópialo del correo y pégalo aquí, con o sin guion. Sirve una sola vez y vence; si pides otro, el anterior deja de servir.</p>
    <p class="field__error" id="auth-code-error" data-error-for="code" hidden></p>
  </div>`;
}

/** @param {AuthViewState} state @param {string} label */
function resendButton(state, label) {
  return html`<button type="button" class="btn btn--ghost" data-auth-resend ${state.canResend && !state.busy ? '' : 'disabled'}>${label}</button>`;
}

/** Crear cuenta: el código que confirma el correo. @param {AuthViewState} state */
function checkEmailPage(state) {
  return html`${head('Confirma tu correo', `Te enviamos un código de 6 dígitos a ${state.email}. Escríbelo o pégalo aquí para activar tu cuenta.`)}
    ${noticeBlock(state.notice)}
    <form class="panel stack" data-auth-form="verify-signup" novalidate>
      ${codeField()}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${submitButton(state, 'Confirmar y entrar')}
      <p class="hint">¿No llegó? Mira en spam o promociones. Si ya tenías una cuenta con ese correo no llega nada: entra con tu contraseña o recupérala. Si el mensaje trae un enlace, también sirve abriéndolo en este dispositivo.</p>
      <div class="actions actions--start">
        ${resendButton(state, 'Reenviar código')}
        <button type="button" class="btn btn--ghost" data-auth-go="signin">Volver a entrar</button>
      </div>
    </form>`;
}

// =============================================================================
// «OLVIDÉ MI CONTRASEÑA» (0.20.5, pedido de la persona): cuatro pantallas de celular
//   1. ¿Olvidaste tu contraseña? → correo (el campo se resalta al escribir y marca ✓ cuando el formato es bueno)
//   2. Revisa tu correo → un sobre del que sube la carta, el correo con partes tapadas y el código de 6 dígitos
//   3. Crea tu contraseña nueva → barra de fuerza de 4 rayitas, casillas que se ponen verdes y repetirla
//   4. Contraseña actualizada → círculo verde con la palomita que se dibuja
// authGate.js actualiza en vivo el ✓, la barra, las casillas y el botón (sin volver a dibujar la pantalla).
// =============================================================================

/** Las reglas que se ven como casillas (las mismas que exige el servidor, ver domain/accounts.js). */
export const PASSWORD_RULES = /** @type {const} */ ([
  ['length', 'Al menos 8 caracteres'],
  ['upper', 'Una mayúscula'],
  ['lower', 'Una minúscula'],
  ['number', 'Un número'],
  ['symbol', 'Un símbolo (como ! # $ - _ .)'],
]);

/** Candado con la flecha de «volver a empezar» (pantalla 1). Decorativo. */
const LOCK_RESET_ART = html`<span class="recover__badge" aria-hidden="true"><svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M41 24A17 17 0 1 1 36 12"/><path d="M36 4.5V12h-7.5"/><rect x="17" y="22.5" width="14" height="11" rx="2.6"/><path d="M20 22.5v-2.8a4 4 0 0 1 8 0v2.8"/></svg></span>`;

/** Tres puntos de contraseña (pantalla 3). Decorativo. */
const PASSWORD_ART = html`<span class="recover__badge" aria-hidden="true"><svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" focusable="false"><rect x="5" y="14" width="38" height="20" rx="10"/><circle cx="15" cy="24" r="2.4" fill="currentColor" stroke="none"/><circle cx="24" cy="24" r="2.4" fill="currentColor" stroke="none"/><circle cx="33" cy="24" r="2.4" fill="currentColor" stroke="none"/></svg></span>`;

/** El sobre abierto con la carta que sube (pantalla 2). La animación está en views.css (.recover-mail). */
const MAIL_ART = html`<span class="recover-mail" aria-hidden="true"><svg viewBox="0 0 160 128" width="168" height="134" focusable="false">
  <path class="recover-mail__flap" d="M18 58 80 16l62 42z"/>
  <rect class="recover-mail__back" x="18" y="54" width="124" height="70" rx="10"/>
  <g class="recover-mail__letter">
    <rect class="recover-mail__paper" x="36" y="28" width="88" height="74" rx="7"/>
    <rect class="recover-mail__line" x="48" y="41" width="56" height="6" rx="3"/>
    <rect class="recover-mail__line recover-mail__line--soft" x="48" y="53" width="64" height="5" rx="2.5"/>
    <rect class="recover-mail__pill" x="48" y="65" width="30" height="9" rx="4.5"/>
  </g>
  <path class="recover-mail__front" d="M18 64 80 100l62-36v50a10 10 0 0 1-10 10H28a10 10 0 0 1-10-10z"/>
</svg></span>`;

const MAIL_ICON = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/></svg>`;
const CLOCK_ICON = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`;
const FOLDER_ICON = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>`;

/**
 * Arriba: volver y los 3 pasos (el actual, alargado; los hechos, llenos).
 * @param {AuthMode | ''} backTo  '' = sin botón de volver
 * @param {number} step 1–3
 */
function recoverBar(backTo, step) {
  return html`<div class="recover__bar">
    ${backTo ? html`<button type="button" class="recover__back" data-auth-go="${backTo}" aria-label="Volver">${icon('back', 20)}</button>` : html`<span></span>`}
    <ol class="recover__steps" aria-label="Paso ${String(step)} de 3">${[1, 2, 3].map((n) => html`<li class="${n < step ? 'is-done' : n === step ? 'is-on' : ''}"></li>`)}</ol>
    <span></span>
  </div>`;
}

/** @param {unknown} art @param {string} title @param {unknown} sub @param {boolean} [center] */
function recoverHead(art, title, sub, center = false) {
  return html`<header class="recover__head${center ? ' recover__head--center' : ''}">${art}
    <h1 class="recover__title" id="auth-title">${title}</h1>
    <p class="recover__sub">${sub}</p>
  </header>`;
}

/**
 * Botón principal abajo. Se ve apagado hasta que lo escrito está listo, pero se puede pulsar (y dice qué falta).
 * @param {AuthViewState} state @param {string} label @param {boolean} ready
 */
function recoverSubmit(state, label, ready) {
  return html`<div class="recover__foot"><button type="submit" class="btn btn--primary btn--block recover__cta${ready ? '' : ' is-waiting'}" data-recover-cta ${state.busy ? 'disabled' : ''}>${label}</button></div>`;
}

/** Pantalla 1. @param {AuthViewState} state */
function forgotPage(state) {
  const valid = validateEmail(state.email).ok;
  return html`${recoverBar('signin', 1)}
    ${recoverHead(LOCK_RESET_ART, '¿Olvidaste tu contraseña?', 'Tranquilo. Escribe el correo de tu cuenta y te enviamos un código de 6 dígitos para crear una nueva.')}
    ${noticeBlock(state.notice)}
    <form class="recover__form" data-auth-form="forgot" novalidate>
      <div class="field" data-field="email">
        <label for="auth-email">Correo</label>
        <div class="rfield${valid ? ' is-valid' : ''}" data-rfield>
          <span class="rfield__icon" aria-hidden="true">${MAIL_ICON}</span>
          <input id="auth-email" name="email" class="input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" value="${state.email}" placeholder="tucorreo@gmail.com" data-autofocus data-recover-email aria-describedby="auth-email-ok auth-email-error" />
          <span class="rfield__ok" aria-hidden="true">${icon('check', 18)}</span>
        </div>
        <p class="sr-only" id="auth-email-ok" data-email-ok aria-live="polite">${valid ? 'El correo está bien escrito.' : ''}</p>
        <p class="field__error" id="auth-email-error" data-error-for="email" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${recoverSubmit(state, 'Continuar', valid)}
    </form>`;
}

/** Pantalla 2. @param {AuthViewState} state */
function resetSentPage(state) {
  const where = isGmail(state.email) ? 'tu Gmail' : 'tu correo';
  return html`${recoverBar('forgot', 2)}
    ${recoverHead(MAIL_ART, `Revisa ${where}`, html`Si tienes una cuenta, te enviamos un código de 6 dígitos a <strong class="recover__email">${maskEmail(state.email)}</strong>`, true)}
    ${noticeBlock(state.notice)}
    <ul class="recover__tips" role="list">
      <li>${CLOCK_ICON}<span>El código sirve una sola vez y vence pronto. Si pides otro, el anterior deja de servir.</span></li>
      <li>${FOLDER_ICON}<span>¿No lo ves? Mira en spam o en promociones.</span></li>
    </ul>
    <form class="recover__form" data-auth-form="verify-recovery" novalidate>
      <div class="field" data-field="code">
        <label for="auth-code">Código de 6 dígitos</label>
        <div class="input-row">
          <input id="auth-code" name="code" class="input otp-input otp-input--big" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000-000" autocapitalize="none" spellcheck="false" data-otp-input data-autofocus aria-describedby="auth-code-error" />
          <button type="button" class="btn btn--ghost" data-otp-paste>${icon('copy', 16)}Pegar</button>
        </div>
        <p class="field__error" id="auth-code-error" data-error-for="code" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${recoverSubmit(state, 'Verificar código', false)}
      <p class="recover__resend"><button type="button" class="link-btn" data-auth-resend data-resend-label="Reenviar código" ${state.canResend && !state.busy ? '' : 'disabled'}>Reenviar código</button></p>
    </form>`;
}

/**
 * Campo de contraseña con candado a la izquierda y el ojo a la derecha.
 * @param {string} id @param {string} name @param {string} label @param {string} describedBy @param {boolean} [autofocus]
 */
function recoverPasswordInput(id, name, label, describedBy, autofocus = false) {
  return html`<div class="rfield rfield--pass" data-rfield>
    <span class="rfield__icon" aria-hidden="true">${icon('lock', 18)}</span>
    ${passwordInput({ id, name, autocomplete: 'new-password', describedBy, label, autofocus })}
  </div>`;
}

/** Pantalla 3 (también llega aquí el enlace del correo). Sin «volver»: el código ya se usó. @param {AuthViewState} state */
function recoveryPage(state) {
  return html`${recoverBar('', 3)}
    ${recoverHead(PASSWORD_ART, 'Crea tu contraseña nueva', 'Elige una segura que no hayas usado antes en esta cuenta.')}
    ${noticeBlock(state.notice)}
    <form class="recover__form" data-auth-form="recovery" novalidate>
      <div class="field" data-field="password">
        <label for="auth-password">Contraseña nueva</label>
        ${recoverPasswordInput('auth-password', 'password', 'contraseña nueva', 'pw-strength auth-password-error', true)}
        <div class="pw-meter" data-pw-meter data-level="empty" data-bars="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <p class="pw-meter__label" id="pw-strength" data-pw-label aria-live="polite"></p>
        <ul class="pw-checks" role="list" aria-label="Lo que necesita tu contraseña">${PASSWORD_RULES.map(
          ([key, text]) => html`<li data-pw-check="${key}"><span class="pw-checks__dot" aria-hidden="true">${icon('check', 12)}</span><span>${text}</span><span class="sr-only" data-pw-state>: falta</span></li>`,
        )}</ul>
        <p class="field__error" id="auth-password-error" data-error-for="password" hidden></p>
      </div>
      <div class="field" data-field="password2">
        <label for="auth-password2">Repite la contraseña</label>
        ${recoverPasswordInput('auth-password2', 'password2', 'contraseña repetida', 'pw-match auth-password2-error')}
        <p class="pw-match" id="pw-match" data-pw-match aria-live="polite"></p>
        <p class="field__error" id="auth-password2-error" data-error-for="password2" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${recoverSubmit(state, 'Guardar contraseña', false)}
    </form>`;
}

/** Pantalla 4: listo. La sesión ya está abierta: el botón entra a la app. */
function recoveryDonePage() {
  return html`<div class="recover__done">
      <span class="recover-done" aria-hidden="true"><svg viewBox="0 0 96 96" width="112" height="112" focusable="false">
        <circle class="recover-done__ring" cx="48" cy="48" r="40"/>
        <circle class="recover-done__disc" cx="48" cy="48" r="40"/>
        <path class="recover-done__check" d="M30 49.5 42.5 62 67 35.5"/>
      </svg></span>
      <h1 class="recover__title" id="auth-title">Contraseña actualizada</h1>
      <p class="recover__sub">Tu contraseña se cambió con éxito. Desde ahora entra con la nueva.</p>
    </div>
    <div class="recover__foot"><button type="button" class="btn btn--primary btn--block" data-auth-continue>Entrar a ACCONTROL</button></div>`;
}
