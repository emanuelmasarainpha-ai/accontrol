// @ts-check
// =============================================================================
// VENTANAS EMERGENTES (hojas de formulario y confirmaciones)
// -----------------------------------------------------------------------------
// Usan el elemento nativo <dialog>, que ya incluye: bloqueo del fondo, tecla Esc
// para cerrar y manejo del foco con el teclado. En el celular se ven como una
// hoja que sube desde abajo; en la computadora, como una ventana centrada.
// =============================================================================

import { $ } from './dom.js';
import { html, setHtml } from './html.js';
import { haptic } from './haptics.js';
import { icon } from './icons.js';

/** @typedef {import('./html.js').SafeHtml} SafeHtml */

let dialogCounter = 0;

/** Tope de espera de la salida animada de una hoja (la animación dura --dur-base, 200 ms). */
const EXIT_FALLBACK_MS = 320;

/** ¿El sistema pide reducir el movimiento? */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

/**
 * Abre una hoja con título y contenido.
 * @param {Object} options
 * @param {string} options.title
 * @param {SafeHtml} options.content
 * @param {(sheet: HTMLDialogElement, close: () => void) => void} [options.onMount]
 *        Se llama cuando la hoja ya está en pantalla: aquí se conectan los eventos del formulario.
 * @param {() => void} [options.onClose]
 * @param {string} [options.className] clase extra de la hoja (los selectores propios usan «sheet--picker», 0.20.12)
 * @returns {{ element: HTMLDialogElement, close: () => void }}
 */
export function openSheet({ title, content, onMount, onClose, className = '' }) {
  const dialog = document.createElement('dialog');
  dialog.className = className ? `sheet ${className}` : 'sheet';
  const titleId = `sheet-title-${(dialogCounter += 1)}`;
  dialog.setAttribute('aria-labelledby', titleId);

  setHtml(
    dialog,
    html`<div class="sheet__panel">
      <header class="sheet__header">
        <h2 class="sheet__title" id="${titleId}">${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('close')}</button>
      </header>
      <div class="sheet__body">${content}</div>
    </div>`,
  );

  // Cerrar con una salida suave (motion.css: .sheet.is-closing). Con «reducir movimiento» o sin animación,
  // se cierra al instante. Por si el aviso de fin de animación no llega, hay un tope de tiempo.
  let closing = false;
  const close = () => {
    if (!dialog.open || closing) return;
    if (prefersReducedMotion()) {
      dialog.close();
      return;
    }
    closing = true;
    dialog.classList.add('is-closing');
    const finish = () => {
      window.clearTimeout(timer);
      if (dialog.open) dialog.close();
    };
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
    dialog.addEventListener('animationend', (event) => {
      if (event.target === dialog) finish();
    });
  };
  // Esc: el navegador cerraría de golpe; se usa la misma salida suave.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  dialog.addEventListener('click', (event) => {
    // Clic fuera del panel (en el fondo oscuro) o en el botón de cerrar.
    if (event.target === dialog || (event.target instanceof Element && event.target.closest('[data-close]'))) {
      close();
    }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });

  document.body.append(dialog);
  dialog.showModal();
  onMount?.(dialog, close);

  // Enfoca el primer campo marcado como principal (en el celular abre el teclado).
  const focusTarget = dialog.querySelector('[data-autofocus]');
  if (focusTarget instanceof HTMLElement) focusTarget.focus();

  return { element: dialog, close };
}

/**
 * Pregunta "¿Seguro?" y devuelve true si el usuario confirma.
 * @param {Object} options
 * @param {string} options.title
 * @param {string | SafeHtml} options.message
 * @param {string} [options.confirmLabel]
 * @param {boolean} [options.danger]   Pinta el botón en rojo (acciones destructivas).
 * @param {string} [options.requireText] Si se indica, el usuario debe escribir esa palabra para confirmar.
 * @param {string} [options.cancelLabel] Texto del botón que no confirma (por omisión, «Cancelar»).
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false, requireText, cancelLabel = 'Cancelar' }) {
  return new Promise((resolve) => {
    let answer = false;
    openSheet({
      title,
      content: html`<form class="stack" data-confirm-form novalidate>
        <p class="confirm__message">${message}</p>
        ${requireText
          ? html`<div class="field">
              <label for="confirm-text">Para continuar, escribe <strong>${requireText}</strong></label>
              <input id="confirm-text" class="input" type="text" autocomplete="off" autocapitalize="characters" data-autofocus />
            </div>`
          : ''}
        <div class="actions">
          <button type="button" class="btn btn--ghost" data-close>${cancelLabel}</button>
          <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" ${requireText ? 'disabled' : ''}>${confirmLabel}</button>
        </div>
      </form>`,
      onMount: (sheet, close) => {
        const form = $('form', sheet);
        const submit = $('button[type="submit"]', sheet);
        if (requireText) {
          const input = $('#confirm-text', sheet);
          input.addEventListener('input', () => {
            submit.toggleAttribute('disabled', /** @type {HTMLInputElement} */ (input).value.trim().toUpperCase() !== requireText.toUpperCase());
          });
        } else {
          submit.focus();
        }
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (submit.hasAttribute('disabled')) return;
          answer = true;
          haptic(danger ? 'warning' : 'confirm');
          close();
        });
      },
      onClose: () => resolve(answer),
    });
  });
}

/**
 * Pregunta con varias respuestas (por ejemplo "Sí / No / Cancelar") y devuelve el `id` elegido,
 * o null si el usuario cierra la ventana sin elegir.
 * @param {Object} options
 * @param {string} options.title
 * @param {string | SafeHtml} options.message
 * @param {{ id: string, label: string, note?: string, primary?: boolean }[]} options.choices
 * @returns {Promise<string | null>}
 */
export function choiceDialog({ title, message, choices }) {
  return new Promise((resolve) => {
    /** @type {string | null} */
    let answer = null;
    openSheet({
      title,
      content: html`<div class="stack">
        <p class="confirm__message">${message}</p>
        <div class="choices">
          ${choices.map(
            (c) => html`<button type="button" class="btn btn--block ${c.primary ? 'btn--primary' : 'btn--ghost'} choice" data-choice="${c.id}" ${c.primary ? 'data-autofocus' : ''}>
              <span class="choice__label">${c.label}</span>${c.note ? html`<small class="choice__note">${c.note}</small>` : ''}
            </button>`,
          )}
        </div>
      </div>`,
      onMount: (sheet, close) => {
        sheet.addEventListener('click', (event) => {
          const button = event.target instanceof Element ? event.target.closest('[data-choice]') : null;
          if (!(button instanceof HTMLElement)) return;
          answer = button.dataset.choice ?? null;
          close();
        });
      },
      onClose: () => resolve(answer),
    });
  });
}

/**
 * Muestra un mensaje informativo con un solo botón.
 * @param {string} title @param {string | SafeHtml} message @param {string} [buttonLabel]
 * @returns {Promise<void>}
 */
export function alertDialog(title, message, buttonLabel = 'Entendido') {
  return new Promise((resolve) => {
    openSheet({
      title,
      content: html`<div class="stack">
        <p class="confirm__message">${message}</p>
        <div class="actions"><button type="button" class="btn btn--primary" data-close data-autofocus>${buttonLabel}</button></div>
      </div>`,
      onClose: () => resolve(),
    });
  });
}
