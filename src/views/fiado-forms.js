// @ts-check
// =============================================================================
// FORMULARIOS DEL FIADO (0.16.3): fiar, cobrar un abono y copiar el estado de cuenta.
// Solo hablan con las acciones del store; las reglas viven en domain/fiado.js.
// =============================================================================

import { categoriesOfKind } from '../domain/categories.js';
import { customerKey, customerLedger, statementMessage } from '../domain/fiado.js';
import { customerSuggestions, lastCustomerDetails } from '../domain/invoices.js';
import { centsToInputValue, formatMoney } from '../domain/money.js';
import { LIMITS } from '../domain/types.js';
import { $ } from '../ui/dom.js';
import { openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy } from '../ui/forms.js';
import { haptic } from '../ui/haptics.js';
import { html } from '../ui/html.js';
import { toast } from '../ui/toast.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/** @param {{ id: string, name: string, label: string, value: string, max: number, placeholder?: string, type?: string, list?: string, autofocus?: boolean, inputmode?: string }} o */
function textField({ id, name, label, value, max, placeholder = '', type = 'text', list = '', autofocus = false, inputmode = '' }) {
  return html`<div class="field" data-field="${name}">
    <label for="${id}">${label}</label>
    <input id="${id}" name="${name}" class="input" type="${type}" ${list ? html`list="${list}"` : ''} ${inputmode ? html`inputmode="${inputmode}"` : ''} maxlength="${max}" autocomplete="off" placeholder="${placeholder}" value="${value}" ${autofocus ? 'data-autofocus' : ''} aria-describedby="${name}-error" />
    ${fieldError(name)}
  </div>`;
}

/** Categoría de ingreso que se propone para los abonos: «Ventas» si existe. @param {import('../domain/types.js').Category[]} all */
function incomeCategories(all) {
  const categories = categoriesOfKind(all, 'income');
  return { categories, preferred: categories.find((c) => c.id === 'cat-inc-ventas') ?? categories.find((c) => /^ventas?$/i.test(c.name)) ?? categories[0] };
}

// =============================================================================
// FIAR
// =============================================================================

/**
 * @param {Store} store
 * @param {{ customerName?: string, customerContact?: string }} [preset]  Desde la ficha de un cliente: ya con su nombre.
 */
export function openCreditForm(store, preset = {}) {
  const { data } = store.getState();
  const today = store.today();
  const names = customerSuggestions(data.invoices).slice(0, 200);
  const fixedName = Boolean(preset.customerName);

  openSheet({
    title: fixedName ? `Fiar a ${preset.customerName}` : 'Fiar',
    content: html`<form class="stack" novalidate data-form="credit">
      ${textField({ id: 'cr-name', name: 'customerName', label: '¿A quién le fías?', value: preset.customerName ?? '', max: LIMITS.customerName, placeholder: 'Ej.: Doña Rosa', list: 'cr-names', autofocus: !fixedName })}
      <datalist id="cr-names">${names.map((n) => html`<option value="${n}"></option>`)}</datalist>
      ${textField({ id: 'cr-description', name: 'description', label: '¿Qué se llevó? (opcional)', value: '', max: LIMITS.invoiceLine, placeholder: 'Ej.: Pan, leche y huevos' })}
      ${moneyField({ id: 'cr-amount', name: 'amountText', label: '¿Cuánto?', value: '', errorKey: 'amount', autofocus: fixedName })}
      <div class="field-row">
        <div class="field" data-field="date">
          <label for="cr-date">Fecha</label>
          <input id="cr-date" name="date" class="input" type="date" max="${today}" value="${today}" required aria-describedby="date-error" />
          ${fieldError('date')}
        </div>
        ${textField({ id: 'cr-contact', name: 'customerContact', label: 'Teléfono (opcional)', value: preset.customerContact ?? '', max: LIMITS.customerContact, placeholder: 'Ej.: 809-555-1234', type: 'tel', inputmode: 'tel' })}
      </div>
      <p class="hint">Se anota como una factura interna con la nota «Fiado». No suma a tu dinero disponible hasta que el cliente te pague. Si se lleva productos de tu inventario, usa «Nueva factura» en Facturas para que salgan del stock.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Anotar fiado</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      bindMoneyPreview(sheet, 'cr-amount');
      // Al elegir un cliente conocido, se rellena su teléfono si no se escribió otro.
      const name = /** @type {HTMLInputElement} */ ($('#cr-name', sheet));
      const contact = /** @type {HTMLInputElement} */ ($('#cr-contact', sheet));
      name.addEventListener('change', () => {
        const known = lastCustomerDetails(store.getState().data.invoices, name.value);
        if (known?.customerContact && !contact.value) contact.value = known.customerContact;
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.createCredit({
          customerName: v.customerName ?? '', customerContact: v.customerContact ?? '', description: v.description ?? '', amountText: v.amountText ?? '', date: v.date ?? '',
        });
        if (!handleResult(form, result)) return;
        close();
        if (!result.ok) return;
        haptic('confirm');
        const ledger = customerLedger(store.getState().data, customerKey(result.invoice), store.today());
        toast(`Fiado anotado. ${result.invoice.customerName} ahora debe ${formatMoney(ledger?.balanceCents ?? 0)}.`);
      });
    },
  });
}


// =============================================================================
// COBRAR UN ABONO
// =============================================================================

/** @param {Store} store @param {{ key: string }} options */
export function openCustomerPaymentForm(store, { key }) {
  const { data } = store.getState();
  const today = store.today();
  const ledger = customerLedger(data, key, today);
  if (!ledger || ledger.balanceCents === 0) {
    toast(ledger ? `${ledger.name} no debe nada.` : 'Ese cliente ya no tiene fiados.', 'info');
    return;
  }
  const { categories, preferred } = incomeCategories(data.categories);

  openSheet({
    title: `Abono de ${ledger.name}`,
    content: html`<form class="stack" novalidate data-form="credit-pay">
      <p class="muted">${ledger.name} debe <strong>${formatMoney(ledger.balanceCents)}</strong>${ledger.open.length > 1 ? ` en ${ledger.open.length} fiados` : ''}.</p>
      ${moneyField({ id: 'cp-amount', name: 'amountText', label: '¿Cuánto te pagó?', value: centsToInputValue(ledger.balanceCents), errorKey: 'amount', autofocus: true })}
      <div class="field-row">
        <div class="field" data-field="date">
          <label for="cp-date">Fecha del abono</label>
          <input id="cp-date" name="date" class="input" type="date" min="${ledger.oldestOpenDate}" max="${today}" value="${today}" required aria-describedby="date-error" />
          ${fieldError('date')}
        </div>
        <div class="field" data-field="category">
          <label for="cp-category">Categoría del ingreso</label>
          <select id="cp-category" name="categoryId" class="input" aria-describedby="category-error">
            ${categories.map((c) => html`<option value="${c.id}" ${c.id === preferred?.id ? 'selected' : ''}>${c.name}</option>`)}
          </select>
          ${fieldError('category')}
        </div>
      </div>
      ${textField({ id: 'cp-note', name: 'note', label: 'Nota (opcional)', value: '', max: LIMITS.paymentNote, placeholder: 'Ej.: Efectivo' })}
      <p class="hint">Se aplica primero a lo más viejo y se anota como ingreso en Movimientos (sube tu Disponible). Puede pagar en partes.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Registrar abono</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      bindMoneyPreview(sheet, 'cp-amount');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.addCustomerPayment(key, { amountText: v.amountText ?? '', date: v.date ?? '', categoryId: v.categoryId ?? '', note: v.note ?? '' });
        if (!handleResult(form, result)) return;
        close();
        if (!result.ok) return;
        haptic('confirm');
        const after = customerLedger(store.getState().data, key, store.today());
        const left = after?.balanceCents ?? 0;
        toast(`Abono de ${formatMoney(result.amountCents)} registrado. ${left > 0 ? `${ledger.name} ahora debe ${formatMoney(left)}.` : `${ledger.name} quedó al día.`}`);
      });
    },
  });
}

// =============================================================================
// ESTADO DE CUENTA: se COPIA para que la persona lo envíe. ACCONTROL no envía nada.
// =============================================================================

/** @param {Store} store @param {string} key */
export async function copyStatement(store, key) {
  const today = store.today();
  const ledger = customerLedger(store.getState().data, key, today);
  if (!ledger) return;
  const workspace = store.activeWorkspace();
  const text = statementMessage(ledger, { senderName: workspace?.organization?.legalName || workspace?.name || '', today });
  try {
    if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
    await navigator.clipboard.writeText(text);
    haptic('confirm');
    toast(`Estado de cuenta de ${ledger.name} copiado. Pégalo en WhatsApp y envíalo tú: ACCONTROL no lo envía.`);
  } catch {
    openSheet({
      title: `Estado de cuenta de ${ledger.name}`,
      content: html`<div class="stack">
        <p class="muted">Tu navegador no dejó copiarlo solo. Selecciona el texto (mantén pulsado en el teléfono), cópialo y envíalo tú por WhatsApp: ACCONTROL no envía mensajes.</p>
        <label for="statement-text">Mensaje</label>
        <textarea id="statement-text" class="input input--area reminder-text" rows="12" readonly>${text}</textarea>
        <div class="actions"><button type="button" class="btn btn--primary" data-close>Listo</button></div>
      </div>`,
      onMount: (sheet) => {
        const area = /** @type {HTMLTextAreaElement | null} */ (sheet.querySelector('#statement-text'));
        area?.focus();
        area?.select();
      },
    });
  }
}
