// @ts-check
// =============================================================================
// MOSTRAR / OCULTAR CONTRASEÑA CON UN OJO (0.14.6)
// -----------------------------------------------------------------------------
// · Contraseña oculta → ojo cerrado; visible → ojo abierto. El botón dice «Mostrar …» y su estado (aria-pressed).
// · Al cambiar, el párpado se cierra o se abre y una «estela» desenfocada del ojo aparece y se desvanece: da la
//   sensación de desenfoque de movimiento. El desenfoque es FIJO (filter en CSS, no se anima): solo se animan
//   transform y opacity, como en toda la app. Con «reducir movimiento», cambia sin animación.
// · Un solo oyente en document: sirve en las pantallas de acceso y en las ventanas (Cambiar contraseña).
// · 0.18.7 (pedido de la persona): el ojo va DENTRO del campo, al final, y solo aparece cuando hay algo escrito. Así el
//   campo de la contraseña mide lo mismo que el del correo. Si se borra todo, el ojo se va y la contraseña vuelve a
//   ocultarse.
// =============================================================================

import { html } from './html.js';

/** El dibujo del ojo: abierto, cerrado (párpado con pestañas) y la estela desenfocada. Decorativo. */
function eyeArt() {
  return html`<svg class="eye" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <g class="eye__trail">
      <path d="M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.9 16.2 2.5 12z"/>
      <circle cx="12" cy="12" r="3.2"/>
    </g>
    <g class="eye__open">
      <path d="M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.9 16.2 2.5 12z"/>
      <circle cx="12" cy="12" r="3.2"/>
      <circle cx="13.3" cy="10.7" r="0.9" fill="currentColor" stroke="none"/>
    </g>
    <g class="eye__closed">
      <path d="M2.5 10.5c2.4 3.7 5.6 5.5 9.5 5.5s7.1-1.8 9.5-5.5"/>
      <path d="M5.6 14.4 4.3 16.3M9.4 15.8l-.5 2.2M14.6 15.8l.5 2.2M18.4 14.4l1.3 1.9"/>
    </g>
  </svg>`;
}

/**
 * Botón del ojo para un campo de contraseña.
 * @param {string} inputId  id del <input type="password">
 * @param {string} label    nombre del campo en minúsculas («contraseña», «contraseña nueva»…)
 */
export function eyeToggle(inputId, label) {
  return html`<button type="button" class="eye-toggle" data-password-toggle="${inputId}" aria-pressed="false" aria-label="Mostrar ${label}" title="Mostrar ${label}" hidden>${eyeArt()}</button>`;
}

/**
 * Campo de contraseña con el ojo dentro, al final (aparece al escribir). 0.18.7.
 * @param {{ id: string, name: string, autocomplete: 'current-password' | 'new-password', describedBy: string, label: string, autofocus?: boolean }} o
 */
export function passwordInput({ id, name, autocomplete, describedBy, label, autofocus = false }) {
  return html`<div class="input-pass">
    <input id="${id}" name="${name}" class="input" type="password" autocomplete="${autocomplete}" autocapitalize="none" spellcheck="false" ${autofocus ? 'data-autofocus' : ''} aria-describedby="${describedBy}" />
    ${eyeToggle(id, label)}
  </div>`;
}

/**
 * Muestra el ojo solo si el campo tiene algo; vacío, lo quita y vuelve a ocultar la contraseña.
 * @param {HTMLInputElement} input
 */
export function syncEye(input) {
  const button = input.parentElement?.querySelector(`[data-password-toggle="${input.id}"]`);
  if (!(button instanceof HTMLButtonElement)) return;
  const empty = input.value === '';
  button.hidden = empty;
  if (empty && input.type !== 'password') {
    input.type = 'password';
    const label = (button.getAttribute('aria-label') ?? '').replace(/^(Mostrar|Ocultar) /, '');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', describe(false, label));
    button.setAttribute('title', describe(false, label));
  }
}

/** Texto del botón según el estado. @param {boolean} shown @param {string} label */
const describe = (shown, label) => `${shown ? 'Ocultar' : 'Mostrar'} ${label}`;

let installed = false;

/** Escucha los toques de todos los ojos de la app (una sola vez, al arrancar). */
export function installPasswordToggles() {
  if (installed) return;
  installed = true;
  // Al escribir (o borrar, o pegar) en un campo de contraseña con ojo: aparece o se va.
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.closest('.input-pass')) syncEye(event.target);
  });
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-password-toggle]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const input = document.getElementById(button.dataset.passwordToggle ?? '');
    if (!(input instanceof HTMLInputElement)) return;
    const shown = input.type === 'password';
    // El cursor se queda donde estaba: cambiar el tipo no mueve lo escrito.
    const { selectionStart, selectionEnd } = input;
    input.type = shown ? 'text' : 'password';
    if (document.activeElement === input && selectionStart !== null) input.setSelectionRange(selectionStart, selectionEnd);
    const label = (button.getAttribute('aria-label') ?? '').replace(/^(Mostrar|Ocultar) /, '');
    button.setAttribute('aria-pressed', String(shown));
    button.setAttribute('aria-label', describe(shown, label));
    button.setAttribute('title', describe(shown, label));
    // La estela: se reinicia en cada toque (aunque se toque rápido varias veces).
    button.classList.remove('is-moving');
    void button.offsetWidth;
    button.classList.add('is-moving');
    window.setTimeout(() => button.classList.remove('is-moving'), 320);
  });
}
