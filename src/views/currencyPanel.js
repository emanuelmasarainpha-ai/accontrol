// @ts-check
// =============================================================================
// MONEDA DE LA CUENTA (0.18.3)
// La lista para elegir la moneda (en la pantalla de la primera vez y en Ajustes → General) y el bloque de Ajustes que
// la cambia. Todos los espacios de los que eres dueño usan la misma moneda. Cambiarla NO convierte los montos: solo
// cambia el símbolo con el que se muestran, y eso se dice con claridad antes de hacerlo.
// =============================================================================

import { CURRENCY_CODES, CURRENCIES, currencyLabel } from '../domain/currencies.js';
import { confirmDialog } from '../ui/dialog.js';
import { clearErrors, setBusy, showErrors } from '../ui/forms.js';
import { html } from '../ui/html.js';
import { toast } from '../ui/toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/**
 * La lista desplegable de monedas.
 * @param {{ id: string, value: string, describedBy?: string }} options
 */
export function currencySelect({ id, value, describedBy = '' }) {
  return html`<select id="${id}" name="currency" class="input" aria-describedby="${describedBy}">
    ${CURRENCY_CODES.map((code) => html`<option value="${code}" ${code === value ? 'selected' : ''}>${CURRENCIES[code].label} (${CURRENCIES[code].symbol})</option>`)}
  </select>`;
}

/** @param {Store} store */
export function currencyPanel(store) {
  const { workspaces } = store.getState();
  const owned = workspaces.filter((w) => (w.role ?? 'owner') === 'owner');
  const shared = workspaces.filter((w) => (w.role ?? 'owner') !== 'owner');
  const current = store.accountCurrency();
  return html`<section class="panel" aria-labelledby="set-currency">
    <h2 class="panel__title" id="set-currency">Moneda</h2>
    ${owned.length === 0
      ? html`<p>Todavía no eres dueño de ningún espacio. Los espacios que te compartieron usan la moneda que eligió su dueño.</p>`
      : html`<form class="stack" data-form="currency" novalidate>
          <div class="field" data-field="currency">
            <label for="set-currency-code">Moneda de tus espacios</label>
            ${currencySelect({ id: 'set-currency-code', value: current, describedBy: 'currency-hint currency-error' })}
            <p class="hint" id="currency-hint">Todos tus espacios usan la misma moneda. Cambiarla <strong>no convierte</strong> los montos: solo cambia el símbolo con el que se ven (un monto de 1,000.00 sigue siendo 1,000.00, con el símbolo nuevo).${shared.length > 0 ? ' Los espacios que te compartieron conservan la moneda de su dueño.' : ''}</p>
            <p class="field__error" id="currency-error" data-error-for="currency" hidden></p>
          </div>
          <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
          <div class="actions actions--start"><button type="submit" class="btn btn--ghost">Cambiar moneda</button></div>
        </form>`}
  </section>`;
}

/**
 * Escucha el formulario del bloque.
 * @param {Store} store @param {HTMLElement} root @param {AbortSignal} signal
 */
export function watchCurrency(store, root, signal) {
  const form = root.querySelector('[data-form="currency"]');
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const select = form.querySelector('select[name="currency"]');
    const code = select instanceof HTMLSelectElement ? select.value : '';
    const before = store.accountCurrency();
    if (code === before) {
      toast(`Tus espacios ya usan ${currencyLabel(code)}.`);
      return;
    }
    const ok = await confirmDialog({
      title: `¿Cambiar a ${currencyLabel(code)}?`,
      message: `Todos tus espacios pasarán a mostrarse en ${currencyLabel(code)}. Los montos NO se convierten: lo que hoy dice ${CURRENCIES[before].symbol} 1,000.00 dirá ${CURRENCIES[/** @type {keyof typeof CURRENCIES} */ (code)]?.symbol ?? ''} 1,000.00. Haz este cambio solo si tus montos ya están en esa moneda (por ejemplo, si te equivocaste al empezar).`,
      confirmLabel: 'Cambiar moneda',
    });
    if (!ok) {
      if (select instanceof HTMLSelectElement) select.value = before;
      return;
    }
    setBusy(form, true);
    const result = await store.setAccountCurrency(code);
    setBusy(form, false);
    if (!result.ok) showErrors(form, result.errors);
    else toast(`Listo: tus espacios usan ${currencyLabel(code)}.`);
  }, { signal });
}
