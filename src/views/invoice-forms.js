// @ts-check
// =============================================================================
// FORMULARIOS DE FACTURAS INTERNAS (espacios Emprendedor, Empresa y Freelancer)
// En Freelancer (0.14.5) el cliente se elige de la lista de clientes y cada línea puede facturar un servicio de ese cliente
// (se propone lo que le queda por facturar; nunca se puede pasar de ahí: regla de una sola fuente).
// -----------------------------------------------------------------------------
// Emitir una factura (con varias líneas), editar los datos que no tocan el dinero y registrar un cobro.
// Solo hablan con las acciones del store; las reglas viven en domain/invoices.js.
// Emitir descuenta del stock las líneas que llevan producto; cada cobro crea además un ingreso en Movimientos
// (los crea el store en la misma operación).
// =============================================================================

import { categoriesOfKind } from '../domain/categories.js';
import { clientLabel, sortClients, sortServices } from '../domain/clients.js';
import { addDays } from '../domain/dates.js';
import { sortProducts, stockPositions } from '../domain/inventory.js';
import {
  customerSuggestions, formatTaxPercent, invoiceLabel, invoicePosition, invoiceTotals, lastCustomerDetails, parseTaxPercent, reminderMessage, serviceBillingRoom, sortInvoicesNewestFirst,
} from '../domain/invoices.js';
import { centsToInputValue, formatMoney, parseMoney } from '../domain/money.js';
import { LIMITS } from '../domain/types.js';
import { $, $$ } from '../ui/dom.js';
import { openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy } from '../ui/forms.js';
import { html, setHtml } from '../ui/html.js';
import { haptic } from '../ui/haptics.js';
import { toast } from '../ui/toast.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Invoice} Invoice */

/** Campo de texto simple con su zona de error. @param {{ id: string, name: string, label: string, value: string, max: number, placeholder?: string, type?: string, list?: string, autofocus?: boolean }} o */
function textField({ id, name, label, value, max, placeholder = '', type = 'text', list = '', autofocus = false }) {
  return html`<div class="field" data-field="${name}">
    <label for="${id}">${label}</label>
    <input id="${id}" name="${name}" class="input" type="${type}" ${list ? html`list="${list}"` : ''} maxlength="${max}" autocomplete="off" placeholder="${placeholder}" value="${value}" ${autofocus ? 'data-autofocus' : ''} aria-describedby="${name}-error" />
    ${fieldError(name)}
  </div>`;
}

// =============================================================================
// EMITIR UNA FACTURA
// =============================================================================

/**
 * @typedef {Object} LineState
 * @property {string} productId @property {string} serviceId @property {string} description @property {string} quantity @property {string} unit
 * @property {boolean} descTouched @property {boolean} unitTouched
 */

/** @returns {LineState} */
const emptyLine = () => ({ productId: '', serviceId: '', description: '', quantity: '1', unit: '', descTouched: false, unitTouched: false });

/**
 * @param {Store} store
 * @param {{ clientId?: string, serviceId?: string }} [preset]  Freelancer: abrir ya con un cliente (y un servicio) elegidos.
 */
export function openInvoiceForm(store, preset = {}) {
  const { data } = store.getState();
  const today = store.today();
  // Freelancer: cliente de la lista y servicios por línea (sin inventario).
  const freelance = store.activeWorkspace()?.kind === 'freelancer';
  const clients = sortClients(data.clients).filter((c) => !c.archived || c.id === preset.clientId);
  /** @type {string} */
  let clientId = freelance && clients.some((c) => c.id === preset.clientId) ? /** @type {string} */ (preset.clientId) : '';
  /** Servicios que se pueden facturar al cliente elegido, con lo que les queda. @returns {{ id: string, name: string, room: number }[]} */
  const billableServices = () =>
    sortServices(data.services.filter((sv) => sv.clientId === clientId && sv.status !== 'cancelled'))
      .map((sv) => ({ id: sv.id, name: sv.name, room: serviceBillingRoom(sv, { movements: data.movements, invoices: data.invoices, today }) }));
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const products = sortProducts(data.products).filter((p) => !p.archived);
  const stock = new Map(stockPositions(data).map((p) => [p.product.id, p]));
  const names = customerSuggestions(data.invoices);
  const newest = sortInvoicesNewestFirst(data.invoices.filter((i) => !i.isDemo))[0] ?? sortInvoicesNewestFirst(data.invoices)[0];
  const lastTax = newest && newest.taxRateBp > 0 ? formatTaxPercent(newest.taxRateBp) : '';

  /** @type {LineState[]} */
  let lines = [emptyLine()];
  if (clientId && preset.serviceId) {
    const svc = billableServices().find((x) => x.id === preset.serviceId);
    if (svc) lines = [{ ...emptyLine(), serviceId: svc.id, description: svc.name, unit: svc.room > 0 ? centsToInputValue(svc.room) : '' }];
  }

  /** @param {number} i @param {LineState} line */
  const lineBlock = (i, line) => html`<div class="invoice-line" role="group" aria-label="Línea ${i + 1}" data-line="${i}">
    <div class="invoice-line__head">
      <span>Línea ${i + 1}</span>
      ${lines.length > 1 ? html`<button type="button" class="link-btn" data-remove-line="${i}" aria-label="Quitar la línea ${i + 1}">Quitar</button>` : ''}
    </div>
    ${freelance
      ? html`<div class="field" data-field="line${i}.service">
          <label for="il-${i}-service">Servicio del cliente (opcional)</label>
          <select id="il-${i}-service" name="line${i}.service" class="input" data-line-service aria-describedby="il-${i}-room line${i}.service-error" ${clientId ? '' : 'disabled'}>
            <option value="" ${line.serviceId === '' ? 'selected' : ''}>${clientId ? 'Sin servicio (otro concepto)' : 'Elige primero el cliente'}</option>
            ${billableServices().map((sv) => html`<option value="${sv.id}" ${sv.id === line.serviceId ? 'selected' : ''} ${sv.room === 0 && sv.id !== line.serviceId ? 'disabled' : ''}>${sv.name} — ${sv.room > 0 ? `quedan ${formatMoney(sv.room)} por facturar` : 'ya facturado o cobrado'}</option>`)}
          </select>
          <p class="hint" id="il-${i}-room" data-line-room></p>
          ${fieldError(`line${i}.service`)}
        </div>`
      : products.length > 0
      ? html`<div class="field" data-field="line${i}.product">
          <label for="il-${i}-product">Producto del inventario (opcional)</label>
          <select id="il-${i}-product" name="line${i}.product" class="input" data-line-product aria-describedby="il-${i}-stock line${i}.product-error">
            <option value="" ${line.productId === '' ? 'selected' : ''}>Sin producto (servicio o venta libre)</option>
            ${products.map((p) => html`<option value="${p.id}" ${p.id === line.productId ? 'selected' : ''}>${p.name}</option>`)}
          </select>
          <p class="hint" id="il-${i}-stock" data-line-stock></p>
          ${fieldError(`line${i}.product`)}
        </div>`
      : ''}
    <div class="field" data-field="line${i}.description">
      <label for="il-${i}-desc">Descripción</label>
      <input id="il-${i}-desc" name="line${i}.description" class="input" type="text" maxlength="${LIMITS.invoiceLine}" autocomplete="off" placeholder="Ej.: Camisa azul talla M" value="${line.description}" ${line.descTouched ? 'data-touched="1"' : ''} data-line-desc aria-describedby="line${i}.description-error" />
      ${fieldError(`line${i}.description`)}
    </div>
    <div class="invoice-line__grid">
      <div class="field" data-field="line${i}.quantity">
        <label for="il-${i}-qty">Cantidad</label>
        <input id="il-${i}-qty" name="line${i}.quantity" class="input" type="text" inputmode="numeric" maxlength="9" autocomplete="off" value="${line.quantity}" data-line-qty aria-describedby="line${i}.quantity-error" />
        ${fieldError(`line${i}.quantity`)}
      </div>
      <div class="field" data-field="line${i}.unit">
        <label for="il-${i}-unit">Precio por unidad</label>
        <div class="input-money">
          <span class="input-money__symbol" aria-hidden="true">RD$</span>
          <input id="il-${i}-unit" name="line${i}.unit" class="input input--money" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${line.unit}" ${line.unitTouched ? 'data-touched="1"' : ''} data-line-unit aria-describedby="line${i}.unit-error" />
        </div>
        ${fieldError(`line${i}.unit`)}
      </div>
    </div>
    <p class="hint" data-line-total></p>
  </div>`;

  openSheet({
    title: 'Nueva factura',
    content: html`<form class="stack" novalidate>
      ${freelance
        ? html`<div class="field" data-field="clientId">
            <label for="iv-client">Cliente</label>
            <select id="iv-client" name="clientId" class="input" data-autofocus aria-describedby="iv-client-hint clientId-error">
              <option value="" ${clientId === '' ? 'selected' : ''}>Elige un cliente…</option>
              ${clients.map((c) => html`<option value="${c.id}" ${c.id === clientId ? 'selected' : ''}>${clientLabel(c)}${c.isDemo ? ' (DEMO)' : ''}</option>`)}
            </select>
            <p class="hint" id="iv-client-hint">${clients.length === 0 ? 'Aún no tienes clientes: créalo primero en Finanzas → Clientes.' : 'La factura queda ligada a su ficha: su cobro cuenta en lo cobrado de ese cliente.'}</p>
            ${fieldError('clientId')}
          </div>`
        : html`<datalist id="il-customers">${names.map((n) => html`<option value="${n}"></option>`)}</datalist>`}
      ${textField({ id: 'iv-customer', name: 'customerName', label: freelance ? 'Nombre en la factura' : 'Cliente', value: clientId ? clientLabel(/** @type {any} */ (clientById.get(clientId))) : '', max: LIMITS.customerName, placeholder: 'Ej.: Hotel Sol', list: freelance ? '' : 'il-customers', autofocus: !freelance })}
      <div class="field-row">
        ${textField({ id: 'iv-taxid', name: 'customerTaxId', label: 'RNC o cédula (opcional)', value: '', max: LIMITS.customerTaxId })}
        ${textField({ id: 'iv-contact', name: 'customerContact', label: 'Correo o teléfono (opcional)', value: clientId ? clientById.get(clientId)?.email || clientById.get(clientId)?.phone || '' : '', max: LIMITS.customerContact })}
      </div>
      <div class="field-row">
        <div class="field" data-field="issueDate">
          <label for="iv-date">Fecha de la factura</label>
          <input id="iv-date" name="issueDate" class="input" type="date" max="${today}" value="${today}" required aria-describedby="issueDate-error" />
          ${fieldError('issueDate')}
        </div>
        <div class="field" data-field="dueDate">
          <label for="iv-due">Vence el (opcional)</label>
          <input id="iv-due" name="dueDate" class="input" type="date" aria-describedby="iv-due-hint dueDate-error" />
          <p class="hint invoice-due-quick" id="iv-due-hint">
            <button type="button" class="link-btn" data-due-days="0">Al contado</button>
            <button type="button" class="link-btn" data-due-days="15">15 días</button>
            <button type="button" class="link-btn" data-due-days="30">30 días</button>
            <button type="button" class="link-btn" data-due-days="60">60 días</button>
          </p>
          ${fieldError('dueDate')}
        </div>
      </div>

      <div class="invoice-lines" data-lines aria-label="Líneas de la factura">${lines.map((l, i) => lineBlock(i, l))}</div>
      <div class="actions actions--start">
        <button type="button" class="btn btn--ghost btn--small" data-add-line>Agregar otra línea</button>
      </div>
      ${fieldError('lines')}

      <div class="field" data-field="tax">
        <label for="iv-tax">Impuesto en % (opcional)</label>
        <input id="iv-tax" name="taxText" class="input" type="text" inputmode="decimal" maxlength="6" autocomplete="off" placeholder="Ej.: 18" value="${lastTax}" aria-describedby="iv-tax-hint tax-error" />
        <p class="hint" id="iv-tax-hint">Porcentaje que se suma al subtotal. Déjalo vacío si no aplicas impuesto.${lastTax ? ' Se rellenó con el de tu última factura.' : ''}</p>
        ${fieldError('tax')}
      </div>
      ${textField({ id: 'iv-notes', name: 'notes', label: 'Notas (opcional)', value: '', max: LIMITS.invoiceNotes, placeholder: 'Ej.: Pago por transferencia' })}

      <dl class="invoice-totals" data-totals aria-live="polite"></dl>
      <p class="hint">Es un documento interno de control, no un comprobante fiscal. Una factura emitida no se edita (solo nombre, contacto, vencimiento y notas): si algo está mal, se anula y se emite otra. ${freelance ? 'Lo facturado de un servicio deja de contarse en el servicio y pasa a la factura: nunca se cuenta dos veces.' : 'Las líneas con producto del inventario descuentan el stock.'}</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions">
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Emitir factura</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      const container = $('[data-lines]', sheet);
      const addButton = /** @type {HTMLButtonElement} */ ($('[data-add-line]', sheet));
      const totals = $('[data-totals]', sheet);
      const customer = /** @type {HTMLInputElement} */ ($('#iv-customer', sheet));
      const taxId = /** @type {HTMLInputElement} */ ($('#iv-taxid', sheet));
      const contact = /** @type {HTMLInputElement} */ ($('#iv-contact', sheet));
      const dateInput = /** @type {HTMLInputElement} */ ($('#iv-date', sheet));
      const dueInput = /** @type {HTMLInputElement} */ ($('#iv-due', sheet));
      const taxInput = /** @type {HTMLInputElement} */ ($('#iv-tax', sheet));

      /** Lee las líneas tal como están en pantalla (para no perder lo escrito al agregar o quitar). */
      const readLines = () =>
        /** @type {LineState[]} */ ($$('.invoice-line', container).map((block) => {
          const val = (/** @type {string} */ sel) => /** @type {HTMLInputElement | null} */ (block.querySelector(sel));
          return {
            productId: val('[data-line-product]')?.value ?? '',
            serviceId: val('[data-line-service]')?.value ?? '',
            description: val('[data-line-desc]')?.value ?? '',
            quantity: val('[data-line-qty]')?.value ?? '',
            unit: val('[data-line-unit]')?.value ?? '',
            descTouched: val('[data-line-desc]')?.dataset.touched === '1',
            unitTouched: val('[data-line-unit]')?.dataset.touched === '1',
          };
        }));

      const drawLines = () => {
        setHtml(container, html`${lines.map((l, i) => lineBlock(i, l))}`);
        addButton.hidden = lines.length >= LIMITS.invoiceLines;
        refresh();
      };

      /** Pistas por línea (stock disponible y total de la línea) y totales de la factura. */
      const refresh = () => {
        let subtotal = 0;
        for (const block of $$('.invoice-line', container)) {
          const productId = /** @type {HTMLSelectElement | null} */ (block.querySelector('[data-line-product]'))?.value ?? '';
          const qtyText = /** @type {HTMLInputElement} */ ($('[data-line-qty]', block)).value.trim();
          const unit = parseMoney(/** @type {HTMLInputElement} */ ($('[data-line-unit]', block)).value.trim());
          const position = productId ? stock.get(productId) : undefined;
          const stockHint = block.querySelector('[data-line-stock]');
          if (stockHint) {
            stockHint.textContent = !position ? '' : position.status === 'untracked'
              ? 'Sin control de stock: no se descuentan unidades.'
              : `En stock ahora: ${position.stock} (${position.product.unit}).`;
          }
          const serviceId = /** @type {HTMLSelectElement | null} */ (block.querySelector('[data-line-service]'))?.value ?? '';
          const roomHint = block.querySelector('[data-line-room]');
          const svc = serviceId ? billableServices().find((x) => x.id === serviceId) : undefined;
          if (roomHint) roomHint.textContent = svc ? `Queda por facturar de este servicio: ${formatMoney(svc.room)}.` : '';
          const qty = /^\d{1,8}$/.test(qtyText) ? Number(qtyText) : 0;
          const totalHint = $('[data-line-total]', block);
          if (qty > 0 && unit.ok && unit.cents > 0) {
            subtotal += qty * unit.cents;
            totalHint.textContent = `Total de la línea: ${formatMoney(qty * unit.cents)}`;
          } else totalHint.textContent = '';
        }
        const taxText = taxInput.value.trim();
        const bp = taxText === '' ? 0 : parseTaxPercent(taxText);
        if (subtotal > 0 && bp !== null) {
          const t = invoiceTotals({ lines: [{ description: '', quantity: 1, unitCents: subtotal }], taxRateBp: bp });
          setHtml(totals, html`<div><dt>Subtotal</dt><dd>${formatMoney(t.subtotalCents)}</dd></div>
            <div><dt>Impuesto (${formatTaxPercent(bp)} %)</dt><dd>${formatMoney(t.taxCents)}</dd></div>
            <div class="invoice-totals__total"><dt>Total</dt><dd>${formatMoney(t.totalCents)}</dd></div>`);
        } else setHtml(totals, html``);
      };

      // Freelancer: al elegir un servicio se sugieren su nombre y lo que le queda por facturar (mientras no los hayas escrito tú).
      container.addEventListener('change', (event) => {
        const select = event.target;
        if (!(select instanceof HTMLSelectElement) || select.dataset.lineService === undefined) return;
        const block = /** @type {HTMLElement} */ (select.closest('.invoice-line'));
        const svc = billableServices().find((x) => x.id === select.value);
        const desc = /** @type {HTMLInputElement} */ ($('[data-line-desc]', block));
        const unit = /** @type {HTMLInputElement} */ ($('[data-line-unit]', block));
        const qty = /** @type {HTMLInputElement} */ ($('[data-line-qty]', block));
        if (svc && desc.dataset.touched !== '1') desc.value = svc.name;
        if (svc && unit.dataset.touched !== '1') {
          unit.value = svc.room > 0 ? centsToInputValue(svc.room) : '';
          qty.value = '1';
        }
        refresh();
      });
      // Cada línea: al elegir un producto se sugiere su nombre y su precio (mientras no los hayas escrito tú).
      container.addEventListener('change', (event) => {
        const select = event.target;
        if (!(select instanceof HTMLSelectElement) || select.dataset.lineProduct === undefined) return;
        const block = /** @type {HTMLElement} */ (select.closest('.invoice-line'));
        const product = products.find((p) => p.id === select.value);
        const desc = /** @type {HTMLInputElement} */ ($('[data-line-desc]', block));
        const unit = /** @type {HTMLInputElement} */ ($('[data-line-unit]', block));
        if (product && desc.dataset.touched !== '1') desc.value = product.name;
        if (product && unit.dataset.touched !== '1') unit.value = product.priceCents > 0 ? centsToInputValue(product.priceCents) : '';
        refresh();
      });
      container.addEventListener('input', (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.dataset.lineDesc !== undefined || input.dataset.lineUnit !== undefined) input.dataset.touched = '1';
        refresh();
      });
      container.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-remove-line]') : null;
        if (!(button instanceof HTMLElement)) return;
        lines = readLines();
        lines.splice(Number(button.dataset.removeLine), 1);
        if (lines.length === 0) lines = [emptyLine()];
        drawLines();
      });
      addButton.addEventListener('click', () => {
        lines = readLines();
        if (lines.length >= LIMITS.invoiceLines) return;
        lines.push(emptyLine());
        drawLines();
        const last = $$('.invoice-line', container).at(-1)?.querySelector('[data-line-product], [data-line-desc]');
        if (last instanceof HTMLElement) last.focus();
      });
      taxInput.addEventListener('input', refresh);

      // Al elegir un cliente que ya conoces se rellenan su RNC y su contacto (si no los escribiste).
      const fillCustomer = () => {
        const found = lastCustomerDetails(data.invoices, customer.value);
        if (!found) return;
        if (!taxId.value.trim()) taxId.value = found.customerTaxId;
        if (!contact.value.trim()) contact.value = found.customerContact;
      };
      if (!freelance) {
        customer.addEventListener('change', fillCustomer);
        customer.addEventListener('blur', fillCustomer);
      }
      // Freelancer: al elegir el cliente se rellenan su nombre y su contacto, y las líneas ofrecen SUS servicios.
      const clientSelect = /** @type {HTMLSelectElement | null} */ (sheet.querySelector('#iv-client'));
      clientSelect?.addEventListener('change', () => {
        clientId = clientSelect.value;
        const c = clientById.get(clientId);
        customer.value = c ? clientLabel(c) : '';
        contact.value = c ? c.email || c.phone : '';
        lines = readLines().map((l) => ({ ...l, serviceId: '' }));
        drawLines();
      });

      // Plazos rápidos: los días se cuentan desde la fecha de la factura.
      for (const button of $$('[data-due-days]', sheet)) {
        button.addEventListener('click', () => {
          const days = Number(button.dataset.dueDays);
          dueInput.value = days === 0 || !dateInput.value ? '' : addDays(dateInput.value, days);
        });
      }

      refresh();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.createInvoice({
          clientId: freelance ? v.clientId ?? '' : '',
          customerName: v.customerName ?? '',
          customerTaxId: v.customerTaxId ?? '',
          customerContact: v.customerContact ?? '',
          issueDate: v.issueDate ?? '',
          dueDate: v.dueDate ?? '',
          taxText: v.taxText ?? '',
          notes: v.notes ?? '',
          lines: readLines().map((l) => ({ description: l.description, productId: l.productId, serviceId: l.serviceId, quantityText: l.quantity, unitText: l.unit })),
        });
        if (!handleResult(form, result)) return;
        close();
        if (!result.ok) return;
        haptic('confirm');
        toast(`Factura ${invoiceLabel(result.invoice)} emitida.${result.entries.length > 0 ? ' Se descontó el stock de los productos vendidos.' : ''}`);
        window.location.hash = `#/facturas/${result.invoice.id}`;
      });
    },
  });
}

// =============================================================================
// EDITAR DATOS DE LA FACTURA (cliente, vencimiento, notas)
// =============================================================================

/**
 * @param {Store} store
 * @param {{ invoice: Invoice }} options
 */
export function openInvoiceEditForm(store, { invoice }) {
  const { data } = store.getState();
  const names = customerSuggestions(data.invoices);

  openSheet({
    title: `Editar factura ${invoiceLabel(invoice)}`,
    content: html`<form class="stack" novalidate>
      <datalist id="ie-customers">${names.map((n) => html`<option value="${n}"></option>`)}</datalist>
      ${textField({ id: 'ie-customer', name: 'customerName', label: 'Cliente', value: invoice.customerName, max: LIMITS.customerName, list: 'ie-customers', autofocus: true })}
      <div class="field-row">
        ${textField({ id: 'ie-taxid', name: 'customerTaxId', label: 'RNC o cédula (opcional)', value: invoice.customerTaxId, max: LIMITS.customerTaxId })}
        ${textField({ id: 'ie-contact', name: 'customerContact', label: 'Correo o teléfono (opcional)', value: invoice.customerContact, max: LIMITS.customerContact })}
      </div>
      <div class="field" data-field="dueDate">
        <label for="ie-due">Vence el (opcional)</label>
        <input id="ie-due" name="dueDate" class="input" type="date" min="${invoice.issueDate}" value="${invoice.dueDate}" aria-describedby="dueDate-error" />
        ${fieldError('dueDate')}
      </div>
      ${textField({ id: 'ie-notes', name: 'notes', label: 'Notas (opcional)', value: invoice.notes, max: LIMITS.invoiceNotes })}
      <p class="hint">Aquí solo se cambian los datos del cliente, el vencimiento y las notas. Las líneas, la fecha y el impuesto no se editan: si algo está mal, anula la factura y emite otra.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveInvoiceEdit(invoice.id, {
          customerName: v.customerName ?? '', customerTaxId: v.customerTaxId ?? '', customerContact: v.customerContact ?? '',
          dueDate: v.dueDate ?? '', notes: v.notes ?? '',
        });
        if (!handleResult(form, result)) return;
        close();
        toast('Cambios guardados.');
      });
    },
  });
}

// =============================================================================
// REGISTRAR UN COBRO
// =============================================================================

/**
 * @param {Store} store
 * @param {{ invoiceId: string }} options
 */
export function openInvoicePaymentForm(store, { invoiceId }) {
  const { data } = store.getState();
  const today = store.today();
  const invoice = data.invoices.find((i) => i.id === invoiceId);
  if (!invoice) {
    toast('Esa factura ya no existe.', 'error');
    return;
  }
  const position = invoicePosition(invoice, data.invoicePayments, today);
  if (position.balanceCents === 0) {
    toast(invoice.voidedAt !== undefined ? 'Esta factura está anulada: no se puede cobrar.' : 'Esta factura ya está cobrada por completo.', 'info');
    return;
  }
  const categories = categoriesOfKind(data.categories, 'income');
  const defaultCategory = categories.find((c) => c.id === 'cat-inc-ventas') ?? categories.find((c) => /^ventas?$/i.test(c.name)) ?? categories[0];

  openSheet({
    title: `Cobro de la factura ${invoiceLabel(invoice)}`,
    content: html`<form class="stack" novalidate>
      <p class="muted">${invoice.customerName} · total ${formatMoney(position.totalCents)} · falta <strong>${formatMoney(position.balanceCents)}</strong></p>
      ${moneyField({ id: 'ip-amount', name: 'amountText', label: '¿Cuánto te pagaron?', value: centsToInputValue(position.balanceCents), errorKey: 'amount', autofocus: true })}
      <div class="field-row">
        <div class="field" data-field="date">
          <label for="ip-date">Fecha del cobro</label>
          <input id="ip-date" name="date" class="input" type="date" min="${invoice.issueDate}" max="${today}" value="${today}" required aria-describedby="date-error" />
          ${fieldError('date')}
        </div>
        <div class="field" data-field="category">
          <label for="ip-category">Categoría del ingreso</label>
          <select id="ip-category" name="categoryId" class="input" aria-describedby="category-error">
            ${categories.map((c) => html`<option value="${c.id}" ${c.id === defaultCategory?.id ? 'selected' : ''}>${c.name}</option>`)}
          </select>
          ${fieldError('category')}
        </div>
      </div>
      ${textField({ id: 'ip-note', name: 'note', label: 'Nota (opcional)', value: '', max: LIMITS.paymentNote, placeholder: 'Ej.: Transferencia del banco' })}
      <p class="hint">El cobro se anota también como un ingreso en Movimientos (sube tu Disponible). Puedes cobrar la factura en partes.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Registrar cobro</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      bindMoneyPreview(sheet, 'ip-amount');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.addInvoicePayment(invoice.id, {
          amountText: v.amountText ?? '', date: v.date ?? '', categoryId: v.categoryId ?? '', note: v.note ?? '',
        });
        if (!handleResult(form, result)) return;
        close();
        if (!result.ok) return;
        haptic('confirm');
        toast(`Cobro de ${formatMoney(result.payment.amountCents)} registrado. Se anotó como ingreso en Movimientos.`);
      });
    },
  });
}

// =============================================================================
// RECORDATORIO DE COBRO (0.14.5): se COPIA para que la persona lo envíe. ACCONTROL no envía nada.
// =============================================================================

/**
 * Copia el mensaje de recordatorio de una factura. Si el navegador no deja copiar, lo muestra para copiarlo a mano.
 * @param {Store} store @param {string} invoiceId
 */
export async function copyInvoiceReminder(store, invoiceId) {
  const { data } = store.getState();
  const invoice = data.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return;
  const position = invoicePosition(invoice, data.invoicePayments, store.today());
  const text = reminderMessage(position, { senderName: store.activeWorkspace()?.organization?.legalName ?? '' });
  try {
    if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
    await navigator.clipboard.writeText(text);
    haptic('confirm');
    toast(`Mensaje de ${invoiceLabel(invoice)} copiado. Pégalo en WhatsApp o en tu correo y envíalo tú: ACCONTROL no lo envía.`);
  } catch {
    openSheet({
      title: `Recordatorio de ${invoiceLabel(invoice)}`,
      content: html`<div class="stack">
        <p class="muted">Tu navegador no dejó copiarlo solo. Selecciona el texto (mantén pulsado en el teléfono), cópialo y envíalo tú por WhatsApp o correo: ACCONTROL no envía mensajes.</p>
        <label for="reminder-text">Mensaje</label>
        <textarea id="reminder-text" class="input input--area reminder-text" rows="9" readonly>${text}</textarea>
        <div class="actions"><button type="button" class="btn btn--primary" data-close>Listo</button></div>
      </div>`,
      onMount: (sheet) => {
        const area = /** @type {HTMLTextAreaElement | null} */ (sheet.querySelector('#reminder-text'));
        area?.focus();
        area?.select();
      },
    });
  }
}
