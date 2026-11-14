// @ts-check
// =============================================================================
// PIEZAS COMPARTIDAS DE LOS FORMULARIOS
// Campo de monto, zona de error, vista previa del monto y manejo del resultado.
// =============================================================================

import { formatMoney, parseMoney } from '../domain/money.js';
import { $ } from '../ui/dom.js';
import { setBusy, showErrors } from '../ui/forms.js';
import { html } from '../ui/html.js';

/** Zona donde se muestra el error de un campo. @param {string} id */
export const fieldError = (id) => html`<p class="field__error" id="${id}-error" data-error-for="${id}" hidden></p>`;

/**
 * Campo de monto con símbolo y vista previa de cómo se interpretó lo escrito.
 * @param {{ id: string, name: string, label: string, value: string, errorKey: string, autofocus?: boolean }} o
 */
export function moneyField({ id, name, label, value, errorKey, autofocus = false }) {
  return html`<div class="field" data-field="${errorKey}">
    <label for="${id}">${label}</label>
    <div class="input-money">
      <span class="input-money__symbol" aria-hidden="true">RD$</span>
      <input id="${id}" name="${name}" class="input input--money" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${value}" ${autofocus ? 'data-autofocus' : ''} aria-describedby="${id}-hint ${errorKey}-error" />
    </div>
    <p class="hint" id="${id}-hint" data-preview-for="${id}"></p>
    ${fieldError(errorKey)}
  </div>`;
}

/** Muestra "Se registrará: RD$ 1,500.50" mientras el usuario escribe. @param {HTMLElement} root @param {string} inputId */
export function bindMoneyPreview(root, inputId) {
  const input = /** @type {HTMLInputElement} */ ($(`#${inputId}`, root));
  const preview = $(`[data-preview-for="${inputId}"]`, root);
  const update = () => {
    const text = input.value.trim();
    preview.classList.remove('hint--warn');
    if (!text) {
      preview.textContent = '';
      return;
    }
    const parsed = parseMoney(text);
    if (parsed.ok) preview.textContent = `Se registrará ${formatMoney(parsed.cents)}`;
    else {
      preview.textContent = parsed.error;
      preview.classList.add('hint--warn');
    }
  };
  input.addEventListener('input', update);
  update();
}

/**
 * Cierra la hoja, avisa y devuelve true si el resultado fue exitoso.
 * @param {HTMLFormElement} form
 * @param {{ ok: boolean, errors?: Record<string, string> }} result
 */
export function handleResult(form, result) {
  setBusy(form, false);
  if (!result.ok) {
    showErrors(form, result.errors ?? { form: 'No se pudo guardar.' });
    return false;
  }
  return true;
}
