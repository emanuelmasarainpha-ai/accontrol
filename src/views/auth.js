// @ts-check
// =============================================================================
// PANTALLAS DE ACCESO: entrar, crear cuenta, recuperar contraseña
// -----------------------------------------------------------------------------
// Solo dibujan (devuelven HTML seguro). Quien maneja los botones y habla con el servidor es
// app/authGate.js. Aparecen a pantalla completa, sin menús, antes de abrir la app.
// =============================================================================

import { PASSWORD_HINT } from '../domain/accounts.js';
import { eyeToggle } from '../ui/passwordToggle.js';
import { currentTheme, dayNightButton } from '../ui/theme.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/**
 * @typedef {'signin' | 'signup' | 'forgot' | 'recovery' | 'check-email' | 'reset-sent'} AuthMode
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
 */

/** Títulos de la pestaña del navegador por pantalla. @type {Record<AuthMode, string>} */
export const AUTH_TITLES = {
  signin: 'Entrar',
  signup: 'Crear cuenta',
  forgot: 'Recuperar contraseña',
  recovery: 'Contraseña nueva',
  'check-email': 'Confirma tu correo',
  'reset-sent': 'Escribe el código',
};

/** @param {AuthViewState} state */
export function renderAuth(state) {
  const body = {
    signin: signInPage,
    signup: signUpPage,
    forgot: forgotPage,
    recovery: recoveryPage,
    'check-email': checkEmailPage,
    'reset-sent': resetSentPage,
  }[state.mode](state);
  // El sol y la luna (modo claro / oscuro) también en las pantallas de acceso (0.14.6).
  return html`<section class="welcome welcome--form auth${state.intro ? ' auth--intro' : ''}" aria-labelledby="auth-title" data-auth-mode="${state.mode}"><div class="auth__theme">${dayNightButton(currentTheme())}</div>${body}</section>`;
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
    <div class="input-row">
      <input id="${id}" name="${name}" class="input" type="password" autocomplete="${autocomplete}" autocapitalize="none" spellcheck="false" aria-describedby="${id}-hint ${id}-error" />
      ${eyeToggle(id, label.toLowerCase())}
    </div>
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

/** @param {AuthViewState} state */
function signInPage(state) {
  return html`${head('Entra a ACCONTROL', 'Con tu correo y tu contraseña.')}
    ${noticeBlock(state.notice)}
    <form class="panel stack" data-auth-form="signin" novalidate>
      ${emailField(state.email)}
      ${passwordField('auth-password', 'password', 'Contraseña', 'current-password')}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${submitButton(state, 'Entrar')}
      <p class="auth__links"><button type="button" class="link-btn" data-auth-go="forgot">Olvidé mi contraseña</button></p>
    </form>
    <p class="auth__switch">¿Todavía no tienes cuenta? <button type="button" class="link-btn" data-auth-go="signup">Crear cuenta</button></p>
    ${LOCAL_DATA_NOTE}`;
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

/** @param {AuthViewState} state */
function forgotPage(state) {
  return html`${head('Recupera tu contraseña', 'Escribe tu correo y te enviamos un código de 6 dígitos para elegir una contraseña nueva.')}
    ${noticeBlock(state.notice)}
    <form class="panel stack" data-auth-form="forgot" novalidate>
      ${emailField(state.email)}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${submitButton(state, 'Enviar código')}
    </form>
    <p class="auth__switch"><button type="button" class="link-btn" data-auth-go="signin">Volver a entrar</button></p>`;
}

/** @param {AuthViewState} state */
function recoveryPage(state) {
  return html`${head('Elige tu contraseña nueva', 'Tu código (o el enlace del correo) es correcto. Escribe la contraseña que usarás desde ahora.')}
    ${noticeBlock(state.notice)}
    <form class="panel stack" data-auth-form="recovery" novalidate>
      ${passwordField('auth-password', 'password', 'Contraseña nueva', 'new-password', PASSWORD_HINT)}
      ${passwordField('auth-password2', 'password2', 'Repite la contraseña nueva', 'new-password')}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${submitButton(state, 'Guardar y entrar')}
    </form>`;
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

/** «Olvidé mi contraseña»: el código que deja elegir una contraseña nueva. @param {AuthViewState} state */
function resetSentPage(state) {
  return html`${head('Escribe el código', `Si ${state.email} tiene una cuenta, te enviamos un código de 6 dígitos. Con él eliges tu contraseña nueva.`)}
    ${noticeBlock(state.notice)}
    <form class="panel stack" data-auth-form="verify-recovery" novalidate>
      ${codeField()}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      ${submitButton(state, 'Continuar')}
      <p class="hint">Mira también en spam o promociones. Si el mensaje trae un enlace, también sirve abriéndolo en este dispositivo.</p>
      <div class="actions actions--start">
        ${resendButton(state, 'Enviar otro código')}
        <button type="button" class="btn btn--ghost" data-auth-go="signin">Volver a entrar</button>
      </div>
    </form>`;
}
