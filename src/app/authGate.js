// @ts-check
// =============================================================================
// PUERTA DE ENTRADA: la app no abre hasta que haya una sesión
// -----------------------------------------------------------------------------
// Dibuja las pantallas de acceso (views/auth.js), atiende sus botones y habla con el cliente de cuentas.
// `runAuthGate` devuelve una promesa que se cumple cuando la persona ya entró (o creó su cuenta y entró).
// Mientras tanto la app de verdad (menús, datos) ni siquiera se ha creado: nada de lo financiero está a la vista.
// =============================================================================

import { formatOtpInput, parseOtp, passwordStrength, validateEmail, validateNewPassword } from '../domain/accounts.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { setHtml } from '../ui/html.js';
import { paintBrowserBar } from '../ui/theme.js';
import { AUTH_TITLES, renderAuth } from '../views/auth.js';

/** @typedef {import('../auth/authClient.js').AuthClient} AuthClient */
/** @typedef {import('../auth/authClient.js').AuthUser} AuthUser */
/** @typedef {import('../views/auth.js').AuthMode} AuthMode */
/** @typedef {import('../views/auth.js').AuthViewState} AuthViewState */

/** Cuánto hay que esperar para pedir de nuevo el correo de confirmación (el servidor también limita los envíos). */
export const RESEND_COOLDOWN_MS = 60_000;

/** Lo que dura la salida de la pantalla de acceso (debe coincidir con `auth-out` en views.css). */
const LEAVE_MS = 260;

/**
 * @param {Object} options
 * @param {AuthClient} options.auth
 * @param {HTMLElement} options.root        Donde se dibujan las pantallas.
 * @param {AuthMode} [options.start]        Pantalla inicial (por defecto «entrar»).
 * @param {AuthViewState['notice']} [options.notice]  Mensaje inicial (por ejemplo, «el enlace venció»).
 * @param {() => void} [options.onDraw]     Se llama después de cada dibujo (para pruebas).
 * @param {string} [options.googleReturn]   0.18.7: adónde vuelve «Continuar con Google» ('' = sin el botón).
 * @param {string} [options.googleClientId] 0.20.1: con él (solo en el navegador), Google directo, sin pasar por la
 *                                          dirección de Supabase. Vacío = como antes.
 * @param {string} [options.email]          0.20.2: correo ya escrito al abrir (el de Google, si no tenía cuenta).
 * @returns {Promise<AuthUser>}
 */
export function runAuthGate({ auth, root, start = 'signin', notice = null, onDraw, googleReturn = '', googleClientId = '', email = '' }) {
  return new Promise((resolve) => {
    /** @type {AuthViewState} */
    let state = { mode: start, email, displayName: '', notice, busy: false, canResend: true, google: googleReturn ? 'checking' : 'none' };
    const controller = new AbortController();
    const { signal } = controller;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let resendTimer = null;
    /** 0.20.5: cuándo se puede volver a pedir el código (cuenta regresiva «Reenviar código en 0:42»). */
    let resendReadyAt = 0;
    /** @type {ReturnType<typeof setInterval> | null} */
    let resendTicker = null;
    let working = false;
    let intro = true;
    let leaving = false;

    document.body.classList.add('is-onboarding', 'is-auth');
    paintBrowserBar();

    /** @param {AuthUser} user */
    function finish(user) {
      controller.abort();
      if (resendTimer !== null) clearTimeout(resendTimer);
      if (resendTicker !== null) clearInterval(resendTicker);
      const done = () => {
        document.body.classList.remove('is-auth');
        paintBrowserBar();
        resolve(user);
      };
      // Salida suave (0.18.5): la curva sube y el formulario se desvanece; luego la app entra con su propia animación.
      const screen = root.querySelector('.auth');
      const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (screen && !calm) {
        leaving = true;
        screen.classList.add('auth--leaving');
        setTimeout(done, LEAVE_MS);
      } else {
        done();
      }
    }

    /** @param {boolean} focus Llevar el foco al primer campo (no en el primer dibujo: no abrir el teclado del celular de golpe). */
    function draw(focus) {
      setHtml(root, renderAuth({ ...state, intro }));
      intro = false; // la curva solo baja la primera vez; al cambiar de pantalla ya está puesta
      document.title = `${AUTH_TITLES[state.mode]} · ACCONTROL`;
      if (focus) {
        const first = root.querySelector('form input');
        if (first instanceof HTMLElement) first.focus();
        else root.querySelector('#auth-title')?.setAttribute('tabindex', '-1');
      }
      showGoogle();
      syncRecover();
      paintResend();
      onDraw?.();
    }

    /**
     * 0.18.7: el botón de Google según lo que diga el servidor. Se cambia en su sitio (sin redibujar) para no borrar
     * lo que la persona ya escribió.
     */
    function showGoogle() {
      const button = root.querySelector('[data-auth-google]');
      const note = root.querySelector('[data-auth-google-note]');
      if (!(button instanceof HTMLButtonElement) || !(note instanceof HTMLElement)) return;
      button.disabled = state.google !== 'on';
      note.hidden = state.google === 'on' || state.google === 'checking';
      note.textContent = state.google === 'off'
        ? 'Entrar con Google todavía no está activado en ACCONTROL. Por ahora entra con tu correo.'
        : 'No se pudo comprobar si se puede entrar con Google. Revisa tu conexión.';
    }

    if (googleReturn) {
      void auth.providers().then((result) => {
        state = { ...state, google: result.ok ? (result.google ? 'on' : 'off') : 'unknown' };
        showGoogle();
      });
    }

    /** Guarda lo escrito antes de cambiar de pantalla, para no obligar a escribirlo otra vez. */
    function rememberFields() {
      const email = root.querySelector('input[name="email"]');
      if (email instanceof HTMLInputElement) state = { ...state, email: email.value };
      const name = root.querySelector('input[name="displayName"]');
      if (name instanceof HTMLInputElement) state = { ...state, displayName: name.value };
    }

    /** @param {AuthMode} mode @param {AuthViewState['notice']} [next] */
    function go(mode, next = null) {
      rememberFields();
      state = { ...state, mode, notice: next };
      draw(true);
    }

    /**
     * 0.20.5: «Reenviar código en 0:42» mientras no se puede pedir otro (solo el botón con data-resend-label).
     * Se cambia el texto en su sitio, sin redibujar: no se borra el código que se esté escribiendo.
     */
    function paintResend() {
      const left = Math.max(0, Math.ceil((resendReadyAt - Date.now()) / 1000));
      const button = root.querySelector('[data-resend-label]');
      if (button instanceof HTMLButtonElement) {
        const label = button.dataset.resendLabel ?? '';
        button.textContent = left > 0 ? `${label} en ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : label;
      }
      if (left === 0 && resendTicker !== null) {
        clearInterval(resendTicker);
        resendTicker = null;
      }
    }

    /**
     * 0.20.5: lo que cambia en vivo en «Olvidé mi contraseña» sin volver a dibujar: el ✓ del correo, la barra de fuerza,
     * las casillas, si las dos contraseñas coinciden y si el botón principal se ve listo.
     */
    function syncRecover() {
      const form = root.querySelector('form[data-auth-form]');
      if (!(form instanceof HTMLFormElement)) return;
      const cta = form.querySelector('[data-recover-cta]');
      if (!cta) return;
      /** @param {string} name */
      const valueOf = (name) => {
        const input = form.querySelector(`input[name="${name}"]`);
        return input instanceof HTMLInputElement ? input.value : '';
      };
      let ready = false;
      const kind = form.dataset.authForm;
      if (kind === 'forgot') {
        ready = validateEmail(valueOf('email')).ok;
        form.querySelector('[data-rfield]')?.classList.toggle('is-valid', ready);
        const say = form.querySelector('[data-email-ok]');
        if (say) say.textContent = ready ? 'El correo está bien escrito.' : '';
      } else if (kind === 'verify-recovery') {
        ready = parseOtp(valueOf('code')).ok;
      } else if (kind === 'recovery') {
        const password = valueOf('password');
        const again = valueOf('password2');
        const strength = passwordStrength(password);
        const meter = form.querySelector('[data-pw-meter]');
        if (meter instanceof HTMLElement) {
          meter.dataset.level = strength.level;
          meter.dataset.bars = String(strength.bars);
        }
        const label = form.querySelector('[data-pw-label]');
        if (label instanceof HTMLElement) {
          label.textContent = strength.label ? `Seguridad: ${strength.label}` : '';
          label.dataset.level = strength.level;
        }
        for (const item of form.querySelectorAll('[data-pw-check]')) {
          if (!(item instanceof HTMLElement)) continue;
          const met = strength.checks[/** @type {keyof typeof strength.checks} */ (item.dataset.pwCheck)] === true;
          item.classList.toggle('is-met', met);
          const say = item.querySelector('[data-pw-state]');
          if (say) say.textContent = met ? ': listo' : ': falta';
        }
        const match = form.querySelector('[data-pw-match]');
        const same = again !== '' && again === password;
        const differs = again !== '' && again !== password && again.length >= password.length;
        if (match instanceof HTMLElement) {
          match.textContent = same ? 'Las contraseñas coinciden.' : differs ? 'Todavía no coinciden.' : '';
          match.classList.toggle('is-ok', same);
          match.classList.toggle('is-bad', differs);
        }
        ready = validateNewPassword(password, state.email).ok && same;
      }
      cta.classList.toggle('is-waiting', !ready);
    }

    function startResendCooldown() {
      state = { ...state, canResend: false };
      resendReadyAt = Date.now() + RESEND_COOLDOWN_MS;
      if (resendTicker === null) resendTicker = setInterval(paintResend, 1000);
      if (resendTimer !== null) clearTimeout(resendTimer);
      resendTimer = setTimeout(() => {
        state = { ...state, canResend: true };
        // Solo se reactiva el botón (sin volver a dibujar): así no se borra el código que la persona esté escribiendo.
        const button = root.querySelector('[data-auth-resend]');
        if (button instanceof HTMLButtonElement) button.disabled = false;
      }, RESEND_COOLDOWN_MS);
    }

    /**
     * Muestra el error del servidor junto al campo que corresponde (o en la zona general).
     * @param {HTMLFormElement} form @param {{ field?: string, message: string }} error
     */
    function fail(form, error) {
      showErrors(form, { [error.field ?? 'form']: error.message });
    }

    /** @type {Record<string, (form: HTMLFormElement, values: Record<string, string>) => Promise<void>>} */
    const submitters = {
      async signin(form, values) {
        const result = await auth.signIn({ email: values.email ?? '', password: values.password ?? '' });
        if (result.ok) {
          const user = auth.getUser();
          if (user) finish(user);
          return;
        }
        if (result.error.code === 'email_not_confirmed') {
          rememberFields();
          state = { ...state, email: values.email ?? state.email, canResend: true };
          go('check-email', { kind: 'info', text: result.error.message });
          return;
        }
        fail(form, result.error);
      },

      async signup(form, values) {
        const result = await auth.signUp({ email: values.email ?? '', password: values.password ?? '', displayName: values.displayName ?? '' });
        if (!result.ok) {
          fail(form, result.error);
          return;
        }
        if (result.signedIn) {
          const user = auth.getUser();
          if (user) finish(user);
          return;
        }
        rememberFields();
        state = { ...state, email: result.email };
        startResendCooldown(); // acaba de salir un correo: no se ofrece reenviarlo de inmediato
        go('check-email');
      },

      async forgot(form, values) {
        const result = await auth.requestPasswordReset(values.email ?? '');
        if (!result.ok) {
          fail(form, result.error);
          return;
        }
        state = { ...state, email: result.email };
        startResendCooldown(); // acaba de salir un código: no se ofrece pedir otro de inmediato
        go('reset-sent');
      },

      // 0.14.6: el código de 6 dígitos que confirma la cuenta nueva.
      async 'verify-signup'(form, values) {
        const result = await auth.verifyCode({ email: state.email, code: values.code ?? '', type: 'signup' });
        if (!result.ok) {
          fail(form, result.error.code === 'otp_expired' ? { ...result.error, field: 'code' } : result.error);
          return;
        }
        const user = auth.getUser();
        if (user) finish(user);
      },

      // 0.14.6: el código de «Olvidé mi contraseña»; si vale, se elige la contraseña nueva.
      async 'verify-recovery'(form, values) {
        const result = await auth.verifyCode({ email: state.email, code: values.code ?? '', type: 'recovery' });
        if (!result.ok) {
          fail(form, result.error.code === 'otp_expired' ? { ...result.error, field: 'code' } : result.error);
          return;
        }
        go('recovery');
      },

      async recovery(form, values) {
        if ((values.password ?? '') !== (values.password2 ?? '')) {
          showErrors(form, { password2: 'Las dos contraseñas deben ser iguales.' });
          return;
        }
        const result = await auth.updatePassword(values.password ?? '');
        if (!result.ok) {
          fail(form, result.error);
          // Si la sesión del enlace ya no sirve, no hay nada más que hacer aquí: a entrar de nuevo.
          if (result.error.code === 'session_not_found' || result.error.code === 'bad_jwt') {
            go('signin', { kind: 'error', text: 'Tu código o tu enlace ya no sirve. Pide uno nuevo desde «Olvidé mi contraseña».' });
          }
          return;
        }
        // 0.20.5: antes de entrar, la pantalla «Contraseña actualizada» (la sesión ya está abierta).
        go('recovery-done');
      },
    };

    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset.authForm) return;
        event.preventDefault();
        if (working) return; // un segundo Enter o toque mientras espera no manda otra petición
        const submit = submitters[form.dataset.authForm];
        if (!submit) return;
        working = true;
        clearErrors(form);
        setBusy(form, true);
        const button = form.querySelector('button[type="submit"]');
        const label = button?.textContent ?? '';
        if (button) {
          // Tres puntos que laten (CSS) en vez de texto; el lector de pantalla sigue oyendo «Un momento…».
          button.classList.add('is-loading');
          button.textContent = '';
          const dots = document.createElement('span');
          dots.className = 'btn__dots';
          dots.setAttribute('aria-hidden', 'true');
          dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
          const say = document.createElement('span');
          say.className = 'sr-only';
          say.textContent = 'Un momento…';
          button.append(dots, say);
        }
        try {
          await submit(form, readForm(form));
        } catch (error) {
          console.error('Error inesperado en el acceso:', error);
          if (form.isConnected) showErrors(form, { form: 'Algo salió mal. Inténtalo de nuevo.' });
        } finally {
          working = false;
          if (form.isConnected && !leaving) {
            setBusy(form, false);
            if (button) {
              button.classList.remove('is-loading');
              button.textContent = label;
            }
            syncRecover();
          }
        }
      },
      { signal },
    );

    root.addEventListener(
      'click',
      async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const go_ = target.closest('[data-auth-go]');
        if (go_ instanceof HTMLElement) {
          go(/** @type {AuthMode} */ (go_.dataset.authGo));
          return;
        }

        // «Continuar con Google» (0.18.7): se va a Google (en la app de Android, al navegador del teléfono) y vuelve.
        // 0.20.1: en el navegador, con el Client ID, directo a Google (Google muestra la dirección de ACCONTROL).
        if (target.closest('[data-auth-google]') && state.google === 'on' && !working) {
          working = true;
          try {
            window.location.assign(googleClientId
              ? await auth.googleIdTokenUrl(googleReturn, googleClientId)
              : await auth.googleSignInUrl(googleReturn));
          } catch {
            working = false;
            state = { ...state, notice: { kind: 'error', text: 'No se pudo abrir Google en este dispositivo. Entra con tu correo.' } };
            draw(false);
          }
          return;
        }

        // 0.20.5: «Entrar a ACCONTROL» después de «Contraseña actualizada».
        if (target.closest('[data-auth-continue]')) {
          const user = auth.getUser();
          if (user) finish(user);
          else go('signin', { kind: 'info', text: 'Tu contraseña se cambió. Entra con ella.' });
          return;
        }

        // El ojo de mostrar u ocultar la contraseña lo atiende ui/passwordToggle.js (en toda la app).
        if (target.closest('[data-password-toggle]')) return;

        // «Pegar»: lee el portapapeles (si el navegador lo permite) y saca el código, aunque se copiara el mensaje entero.
        if (target.closest('[data-otp-paste]')) {
          const input = root.querySelector('[data-otp-input]');
          const form = input instanceof HTMLInputElement ? input.form : null;
          if (!(input instanceof HTMLInputElement) || !form) return;
          clearErrors(form);
          let text = '';
          try {
            text = (await navigator.clipboard?.readText?.()) ?? '';
          } catch {
            text = '';
          }
          const parsed = parseOtp(text);
          if (parsed.ok) {
            input.value = formatOtpInput(parsed.code);
            syncRecover();
            /** @type {HTMLButtonElement | null} */ (form.querySelector('button[type="submit"]'))?.focus();
          } else {
            showErrors(form, { code: text ? parsed.error : 'Tu navegador no deja pegar con este botón: mantén pulsado el campo (o pulsa Ctrl+V) y elige «Pegar».' });
            input.focus();
          }
          return;
        }

        // Reenviar: un código nuevo del mismo tipo (el anterior deja de servir).
        if (target.closest('[data-auth-resend]') && !working && state.canResend) {
          working = true;
          const result = state.mode === 'reset-sent' ? await auth.requestPasswordReset(state.email) : await auth.resendConfirmation(state.email);
          working = false;
          if (result.ok) {
            startResendCooldown();
            state = { ...state, notice: { kind: 'success', text: `Listo: enviamos un código nuevo a ${state.email}. El anterior ya no sirve.` } };
          } else {
            state = { ...state, notice: { kind: 'error', text: result.error.message } };
          }
          if (state.mode === 'check-email' || state.mode === 'reset-sent') draw(true);
        }
      },
      { signal },
    );

    // El código se ve como 000-000 mientras se escribe o se pega (solo dígitos, máximo 6).
    root.addEventListener(
      'input',
      (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.dataset.otpInput !== undefined) {
          const pasted = parseOtp(input.value);
          const next = formatOtpInput(pasted.ok ? pasted.code : input.value);
          if (next !== input.value) input.value = next;
        }
        syncRecover();
      },
      { signal },
    );

    draw(false);
  });
}
