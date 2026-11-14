// @ts-check
// =============================================================================
// AYUDAS PARA FORMULARIOS
// Convención de los formularios de ACCONTROL:
//   <div class="field" data-field="amount"> ... <p class="field__error" data-error-for="amount"></p> </div>
// El nombre de `data-field` coincide con la clave del error que devuelve la validación.
// =============================================================================

import { $$ } from './dom.js';

/**
 * Lee todos los campos de un formulario como texto.
 * @param {HTMLFormElement} form
 * @returns {Record<string, string>}
 */
export function readForm(form) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

/** @param {HTMLFormElement} form */
export function clearErrors(form) {
  for (const el of $$('[data-error-for]', form)) {
    el.textContent = '';
    el.hidden = true;
  }
  for (const el of $$('[aria-invalid="true"]', form)) el.removeAttribute('aria-invalid');
}

/**
 * Muestra los errores junto a cada campo y lleva el foco al primero.
 * Las claves sin campo (por ejemplo "form") se muestran en la zona de error general.
 * @param {HTMLFormElement} form
 * @param {Record<string, string>} errors
 */
export function showErrors(form, errors) {
  clearErrors(form);
  /** @type {HTMLElement | null} */
  let firstInvalid = null;

  for (const [key, message] of Object.entries(errors)) {
    const slot = form.querySelector(`[data-error-for="${key}"]`) ?? form.querySelector('[data-error-for="form"]');
    if (slot instanceof HTMLElement) {
      slot.textContent = message;
      slot.hidden = false;
    }
    const field = form.querySelector(`[data-field="${key}"] input, [data-field="${key}"] select, [data-field="${key}"] textarea`);
    if (field instanceof HTMLElement) {
      field.setAttribute('aria-invalid', 'true');
      firstInvalid ??= field;
    }
  }
  firstInvalid?.focus();
}

/**
 * Desactiva el botón de envío mientras se guarda (evita registros duplicados por doble clic).
 * @param {HTMLFormElement} form @param {boolean} busy
 */
export function setBusy(form, busy) {
  for (const button of $$('button[type="submit"]', form)) {
    button.toggleAttribute('disabled', busy);
  }
}
