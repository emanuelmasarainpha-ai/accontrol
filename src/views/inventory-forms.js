// @ts-check
// =============================================================================
// FORMULARIOS DE INVENTARIO (espacios Emprendedor y Empresa)
// -----------------------------------------------------------------------------
// Producto (crear / editar / borrar), proveedor (crear / editar / archivar / borrar) y movimiento de stock:
// compra, venta o ajuste. Solo hablan con las acciones del store; las reglas viven en domain/inventory.js.
// Una compra crea además un gasto y una venta un ingreso en Movimientos (los crea el store en la misma operación).
// =============================================================================

import { categoriesOfKind } from '../domain/categories.js';
import {
  MAX_QUANTITY, STOCK_KIND_LABELS, productGroup, productGroups, productImage, productUsage, sortProducts, sortSuppliers, stockPositions, supplierUsage, tracksStock,
} from '../domain/inventory.js';
import { centsToInputValue, formatMoney, parseMoney } from '../domain/money.js';
import { LIMITS } from '../domain/types.js';
import { $ } from '../ui/dom.js';
import { confirmDialog, openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { shrinkProductImage } from '../ui/image.js';
import { toast } from '../ui/toast.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Product} Product */
/** @typedef {import('../domain/types.js').Supplier} Supplier */
/** @typedef {import('../domain/types.js').StockKind} StockKind */

/** Campo de texto simple con su zona de error. @param {{ id: string, name: string, label: string, value: string, max: number, placeholder?: string, type?: string, inputmode?: string, autofocus?: boolean }} o */
function textField({ id, name, label, value, max, placeholder = '', type = 'text', inputmode = '', autofocus = false }) {
  return html`<div class="field" data-field="${name}">
    <label for="${id}">${label}</label>
    <input id="${id}" name="${name}" class="input" type="${type}" ${inputmode ? html`inputmode="${inputmode}"` : ''} maxlength="${max}" autocomplete="off" placeholder="${placeholder}" value="${value}" ${autofocus ? 'data-autofocus' : ''} aria-describedby="${name}-error" />
    ${fieldError(name)}
  </div>`;
}

// =============================================================================
// PRODUCTO
// =============================================================================

/**
 * @param {Store} store
 * @param {{ product?: Product | null }} [options]
 */
export function openProductForm(store, { product = null } = {}) {
  const isEdit = product !== null;
  const { data } = store.getState();
  const usage = product ? productUsage(data, product.id) : { entries: 0, invoices: 0 };
  const entries = usage.entries + usage.invoices;
  const groups = productGroups(data.products);
  const tracked = product ? tracksStock(product) : true;
  // Un producto con movimientos de stock no puede dejar de contarse (sus unidades quedarían sin explicar).
  const lockTracking = usage.entries > 0 && tracked;
  /** @param {string} dataUrl */
  const photoBox = (dataUrl) => (dataUrl
    ? html`<img class="product-photo__img" src="${dataUrl}" alt="Foto del producto" width="96" height="96" />`
    : html`<span class="product-photo__empty" aria-hidden="true">${icon('box', 32)}</span>`);

  openSheet({
    title: isEdit ? 'Editar producto' : 'Nuevo producto',
    content: html`<form class="stack" novalidate data-form="product">
      <div class="field product-photo" data-field="image">
        <span class="product-photo__box" data-photo-box>${photoBox(product ? productImage(product) : '')}</span>
        <span class="product-photo__side">
          <span class="product-photo__label">Foto (opcional)</span>
          <span class="product-photo__actions">
            <label class="btn btn--ghost btn--small" for="pr-photo">${icon('upload', 16)}Elegir foto</label>
            <button type="button" class="btn btn--ghost btn--small" data-photo-clear ${product && productImage(product) ? '' : 'hidden'}>Quitar foto</button>
          </span>
          <input id="pr-photo" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/*" data-photo-input />
          <input type="hidden" name="imageData" value="${product ? productImage(product) : ''}" data-photo-value />
          <span class="hint">Se guarda una miniatura liviana. Se ve en la lista y en la caja.</span>
          ${fieldError('image')}
        </span>
      </div>
      ${textField({ id: 'pr-name', name: 'name', label: 'Nombre', value: product?.name ?? '', max: LIMITS.productName, placeholder: 'Ej.: Camisa azul talla M', autofocus: !isEdit })}
      <div class="field" data-field="group">
        <label for="pr-group">Grupo (opcional)</label>
        <input id="pr-group" name="groupText" class="input" type="text" list="pr-groups" maxlength="${LIMITS.productGroup}" autocomplete="off" placeholder="Ej.: Bebidas, Dulces, Limpieza" value="${product ? productGroup(product) : ''}" aria-describedby="pr-group-hint group-error" />
        <datalist id="pr-groups">${groups.map((g) => html`<option value="${g}"></option>`)}</datalist>
        <p class="hint" id="pr-group-hint">En la caja, los productos se filtran por grupo.</p>
        ${fieldError('group')}
      </div>
      <div class="field-row">
        ${textField({ id: 'pr-sku', name: 'sku', label: 'Código (opcional; puedes escanearlo)', value: product?.sku ?? '', max: LIMITS.productSku, placeholder: 'Ej.: 7460001234567' })}
        ${textField({ id: 'pr-unit', name: 'unit', label: 'Unidad', value: product?.unit ?? 'unidad', max: LIMITS.productUnit, placeholder: 'Ej.: unidad, caja, libra' })}
      </div>
      ${moneyField({ id: 'pr-price', name: 'priceText', label: 'Precio de venta por unidad (opcional)', value: product && product.priceCents > 0 ? centsToInputValue(product.priceCents) : '', errorKey: 'price' })}
      <div class="field" data-field="trackStock">
        <label class="switch-row" for="pr-untracked">
          <span class="switch-row__text">
            <strong>Sin control de stock</strong>
            <small id="pr-untracked-hint">${lockTracking
              ? 'Este producto ya tiene compras, ventas o ajustes, así que sigue contando su stock. Si lo vendes suelto, archívalo y crea otro sin control de stock.'
              : 'Para lo que se vende sin contar unidades (por ejemplo gomitas sueltas): se vende y se cobra, pero no lleva stock, compras ni avisos.'}</small>
          </span>
          <input type="checkbox" class="switch" id="pr-untracked" name="untracked" value="1" ${tracked ? '' : 'checked'} ${lockTracking ? 'disabled' : ''} aria-describedby="pr-untracked-hint trackStock-error" data-untracked />
        </label>
        ${fieldError('trackStock')}
      </div>
      <div class="field" data-field="minStock" data-min-stock ${tracked ? '' : 'hidden'}>
        <label for="pr-min">Avisarme cuando queden (opcional)</label>
        <input id="pr-min" name="minStockText" class="input" type="text" inputmode="numeric" maxlength="7" autocomplete="off" placeholder="Ej.: 5" value="${product && product.minStock > 0 ? product.minStock : ''}" aria-describedby="pr-min-hint minStock-error" />
        <p class="hint" id="pr-min-hint">Cuando el stock llegue a esa cantidad (o menos) verás un aviso de «Stock bajo». Déjalo vacío si no lo necesitas.</p>
        ${fieldError('minStock')}
      </div>
      ${textField({ id: 'pr-notes', name: 'notes', label: 'Notas (opcional)', value: product?.notes ?? '', max: LIMITS.productNotes })}

      <p class="hint">Solo el nombre es obligatorio. El stock no se escribe aquí: se calcula con tus compras, ventas y ajustes.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions ${isEdit && entries === 0 ? 'actions--split' : ''}">
        ${isEdit && entries === 0 ? html`<button type="button" class="btn btn--danger-ghost" data-delete>${icon('trash', 18)}Eliminar</button>` : ''}
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      bindMoneyPreview(sheet, 'pr-price');

      // «Sin control de stock» esconde el aviso de stock bajo (no aplica).
      const untracked = /** @type {HTMLInputElement} */ ($('[data-untracked]', sheet));
      const minField = /** @type {HTMLElement} */ ($('[data-min-stock]', sheet));
      untracked.addEventListener('change', () => { minField.hidden = untracked.checked; });

      // Foto: se reduce en el dispositivo y se guarda en un campo oculto hasta pulsar «Guardar».
      const photoInput = /** @type {HTMLInputElement} */ ($('[data-photo-input]', sheet));
      const photoValue = /** @type {HTMLInputElement} */ ($('[data-photo-value]', sheet));
      const photoBoxEl = /** @type {HTMLElement} */ ($('[data-photo-box]', sheet));
      const photoClear = /** @type {HTMLButtonElement} */ ($('[data-photo-clear]', sheet));
      const photoError = sheet.querySelector('[data-error-for="image"]');
      const setPhoto = (/** @type {string} */ dataUrl) => {
        photoValue.value = dataUrl;
        setHtml(photoBoxEl, photoBox(dataUrl));
        photoClear.hidden = !dataUrl;
      };
      photoInput.addEventListener('change', async () => {
        const file = photoInput.files?.[0];
        photoInput.value = '';
        if (!file) return;
        if (photoError instanceof HTMLElement) { photoError.textContent = ''; photoError.hidden = true; }
        photoBoxEl.setAttribute('aria-busy', 'true');
        const result = await shrinkProductImage(file);
        photoBoxEl.removeAttribute('aria-busy');
        if (result.ok) setPhoto(result.dataUrl);
        else if (photoError instanceof HTMLElement) { photoError.textContent = result.error; photoError.hidden = false; }
      });
      photoClear.addEventListener('click', () => setPhoto(''));

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveProduct(
          {
            name: v.name ?? '', sku: v.sku ?? '', unit: v.unit ?? '', priceText: v.priceText ?? '', minStockText: v.minStockText ?? '', notes: v.notes ?? '',
            groupText: v.groupText ?? '', imageData: v.imageData ?? '',
            // Una casilla desactivada no se envía: entonces se conserva lo que tenía.
            trackStock: untracked.disabled ? tracked : !untracked.checked,
          },
          product?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Cambios guardados.' : result.ok && !tracksStock(result.product) ? 'Producto guardado, sin control de stock: ya se puede vender.' : 'Producto guardado. Ahora registra su primera compra para tener stock.');
        if (!isEdit && result.ok) window.location.hash = `#/inventario/${result.product.id}`;
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && product) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '¿Eliminar este producto?',
            message: `Se borrará «${product.name}». Solo se puede borrar un producto sin compras, ventas ni ajustes; si los tiene, archívalo. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteProduct(product.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Producto eliminado.');
          window.location.hash = '#/inventario';
        });
      }
    },
  });
}

// =============================================================================
// PROVEEDOR
// =============================================================================

/**
 * @param {Store} store
 * @param {{ supplier?: Supplier | null }} [options]
 */
export function openSupplierForm(store, { supplier = null } = {}) {
  const isEdit = supplier !== null;
  const { data } = store.getState();
  const purchases = supplier ? supplierUsage(data, supplier.id).purchases : 0;

  openSheet({
    title: isEdit ? 'Editar proveedor' : 'Nuevo proveedor',
    content: html`<form class="stack" novalidate>
      ${textField({ id: 'su-name', name: 'name', label: 'Nombre', value: supplier?.name ?? '', max: LIMITS.supplierName, placeholder: 'Ej.: Distribuidora Caribe', autofocus: !isEdit })}
      ${textField({ id: 'su-contact', name: 'contact', label: 'Persona de contacto (opcional)', value: supplier?.contact ?? '', max: LIMITS.supplierContact })}
      <div class="field-row">
        ${textField({ id: 'su-email', name: 'email', label: 'Correo (opcional)', value: supplier?.email ?? '', max: LIMITS.supplierEmail, type: 'email', placeholder: 'ventas@ejemplo.com' })}
        ${textField({ id: 'su-phone', name: 'phone', label: 'Teléfono (opcional)', value: supplier?.phone ?? '', max: LIMITS.supplierPhone, type: 'tel', placeholder: '+1 809 555 0100' })}
      </div>
      ${textField({ id: 'su-notes', name: 'notes', label: 'Notas (opcional)', value: supplier?.notes ?? '', max: LIMITS.supplierNotes, placeholder: 'Ej.: Entrega los jueves' })}

      <p class="hint">Solo el nombre es obligatorio. Estos datos se quedan en este dispositivo y los ves solo tú.</p>
      ${isEdit && purchases > 0 ? html`<p class="hint">Tiene ${purchases === 1 ? '1 compra registrada' : `${purchases} compras registradas`}: no se puede eliminar, pero sí archivar.</p>` : ''}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions ${isEdit ? 'actions--split' : ''}">
        ${isEdit
          ? html`<span class="actions__group actions__group--start">
              <button type="button" class="btn btn--ghost" data-archive>${supplier?.archived ? 'Reactivar' : 'Archivar'}</button>
              ${purchases === 0 ? html`<button type="button" class="btn btn--danger-ghost" data-delete>${icon('trash', 18)}Eliminar</button>` : ''}
            </span>`
          : ''}
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
        const result = await store.saveSupplier(
          { name: v.name ?? '', contact: v.contact ?? '', email: v.email ?? '', phone: v.phone ?? '', notes: v.notes ?? '' },
          supplier?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Cambios guardados.' : 'Proveedor guardado.');
      });

      const archiveButton = sheet.querySelector('[data-archive]');
      if (archiveButton && supplier) {
        archiveButton.addEventListener('click', async () => {
          const result = await store.setSupplierArchived(supplier.id, !supplier.archived);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast(supplier.archived ? 'Proveedor reactivado.' : 'Proveedor archivado. Sus compras se conservan.');
        });
      }

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && supplier) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '¿Eliminar este proveedor?',
            message: `Se borrará «${supplier.name}». Solo se puede borrar un proveedor sin compras; si las tiene, archívalo. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteSupplier(supplier.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Proveedor eliminado.');
        });
      }
    },
  });
}

// =============================================================================
// COMPRA, VENTA Y AJUSTE DE STOCK
// =============================================================================

const TITLES = { purchase: 'Registrar compra', sale: 'Registrar venta', adjustment: 'Ajustar stock' };

/** Categoría que se sugiere: una que se llame «Mercancía…» (compras) o «Ventas» (ventas), y si no, «Otros…». @param {import('../domain/types.js').Category[]} list @param {'purchase' | 'sale'} kind */
function suggestedCategory(list, kind) {
  const byName = list.find((c) => (kind === 'purchase' ? /^mercanc|^inventario|^insumos/i : /^ventas?$/i).test(c.name));
  return byName ?? list.find((c) => c.id === (kind === 'purchase' ? 'cat-exp-otros' : 'cat-inc-ventas')) ?? list[0];
}

/**
 * @param {Store} store
 * @param {{ kind: StockKind, productId?: string }} options
 */
export function openStockForm(store, { kind, productId = '' }) {
  const { data } = store.getState();
  const today = store.today();
  const products = sortProducts(data.products).filter((p) => !p.archived && tracksStock(p));
  if (products.length === 0) {
    toast(data.products.some((p) => !p.archived) ? 'Tus productos no llevan control de stock: no tienen compras ni ajustes. Crea uno que sí lo lleve.' : 'Primero crea un producto: es lo que vas a comprar y vender.', 'info');
    openProductForm(store);
    return;
  }
  const positions = new Map(stockPositions(data).map((p) => [p.product.id, p]));
  const lastCost = new Map(); // costo de la última compra de cada producto
  for (const e of [...data.stockEntries].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))) {
    if (e.kind === 'purchase') lastCost.set(e.productId, e.unitCents);
  }
  const moneyKind = kind === 'purchase' ? 'expense' : 'income';
  const categories = kind === 'adjustment' ? [] : categoriesOfKind(data.categories, moneyKind);
  const defaultCategory = kind === 'adjustment' ? undefined : suggestedCategory(categories, kind);
  const suppliers = sortSuppliers(data.suppliers).filter((s) => !s.archived);
  const chosen = products.find((p) => p.id === productId);
  const unitLabel = kind === 'purchase' ? 'Costo por unidad' : kind === 'sale' ? 'Precio de venta por unidad' : 'Costo por unidad (solo si suma)';

  /** Valor que se sugiere para el monto por unidad de un producto. @param {string} id */
  const suggestedUnit = (id) => {
    const position = positions.get(id);
    if (!position) return '';
    const cents = kind === 'sale' ? position.product.priceCents : kind === 'purchase' ? lastCost.get(id) ?? 0 : position.avgCostCents;
    return cents > 0 ? centsToInputValue(cents) : '';
  };

  openSheet({
    title: TITLES[kind],
    content: html`<form class="stack" novalidate>
      <input type="hidden" name="kind" value="${kind}" />
      <div class="field" data-field="product">
        <label for="st-product">Producto</label>
        <select id="st-product" name="productId" class="input" ${chosen ? '' : 'data-autofocus'} aria-describedby="st-available product-error">
          ${chosen ? '' : html`<option value="" selected disabled>Elige un producto</option>`}
          ${products.map((p) => html`<option value="${p.id}" ${p.id === chosen?.id ? 'selected' : ''}>${p.name}</option>`)}
        </select>
        <p class="hint" id="st-available" data-available></p>
        ${fieldError('product')}
      </div>

      ${kind === 'adjustment'
        ? html`<fieldset class="field" data-field="direction">
            <legend>¿Qué pasó?</legend>
            <div class="segmented" role="radiogroup">
              <label class="segmented__option"><input type="radio" name="direction" value="add" checked /><span>Sumar unidades</span></label>
              <label class="segmented__option"><input type="radio" name="direction" value="remove" /><span>Restar unidades</span></label>
            </div>
            <p class="hint">Un ajuste corrige el stock (conteo físico, merma, rotura, regalo…) y no mueve dinero: no crea ingreso ni gasto.</p>
          </fieldset>`
        : ''}

      <div class="field-row">
        <div class="field" data-field="quantity">
          <label for="st-qty">Cantidad</label>
          <input id="st-qty" name="quantityText" class="input" type="text" inputmode="numeric" maxlength="9" autocomplete="off" placeholder="Ej.: 12" ${chosen ? 'data-autofocus' : ''} aria-describedby="quantity-error" />
          ${fieldError('quantity')}
        </div>
        <div class="field" data-field="date">
          <label for="st-date">Fecha</label>
          <input id="st-date" name="date" class="input" type="date" max="${today}" value="${today}" required aria-describedby="date-error" />
          ${fieldError('date')}
        </div>
      </div>

      <div data-unit-wrap>
        ${moneyField({ id: 'st-unit', name: 'unitText', label: unitLabel, value: chosen ? suggestedUnit(chosen.id) : '', errorKey: 'unit' })}
      </div>
      <p class="hint" data-total></p>

      ${kind === 'purchase'
        ? html`<div class="field" data-field="supplier">
            <label for="st-supplier">Proveedor (opcional)</label>
            <select id="st-supplier" name="supplierId" class="input">
              <option value="" selected>Sin proveedor</option>
              ${suppliers.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
            </select>
            ${suppliers.length === 0 ? html`<p class="hint">Aún no tienes proveedores. Puedes crearlos desde Inventario → Proveedores.</p>` : ''}
            ${fieldError('supplier')}
          </div>`
        : ''}

      ${kind === 'adjustment'
        ? ''
        : html`<div class="field" data-field="category">
            <label for="st-category">${kind === 'purchase' ? 'Categoría del gasto' : 'Categoría del ingreso'}</label>
            <select id="st-category" name="categoryId" class="input" aria-describedby="category-error">
              ${categories.map((c) => html`<option value="${c.id}" ${c.id === defaultCategory?.id ? 'selected' : ''}>${c.name}</option>`)}
            </select>
            <p class="hint">${kind === 'purchase'
              ? 'La compra también se anota como un gasto en Movimientos (baja tu Disponible).'
              : 'La venta también se anota como un ingreso en Movimientos (sube tu Disponible).'}</p>
            ${fieldError('category')}
          </div>`}

      <div class="field" data-field="note">
        <label for="st-note">Nota (opcional)</label>
        <input id="st-note" name="note" class="input" type="text" maxlength="${LIMITS.stockNote}" autocomplete="off" placeholder="${kind === 'adjustment' ? 'Ej.: Conteo físico del sábado' : 'Ej.: Factura 1234'}" aria-describedby="note-error" />
        ${fieldError('note')}
      </div>

      <p class="hint">Las cantidades son números enteros (hasta ${MAX_QUANTITY.toLocaleString('en-US')} por movimiento). No se puede vender más de lo que hay.</p>
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
      const productSelect = /** @type {HTMLSelectElement} */ ($('#st-product', sheet));
      const qtyInput = /** @type {HTMLInputElement} */ ($('#st-qty', sheet));
      const unitInput = /** @type {HTMLInputElement} */ ($('#st-unit', sheet));
      const unitWrap = /** @type {HTMLElement} */ ($('[data-unit-wrap]', sheet));
      const totalHint = $('[data-total]', sheet);
      const availableHint = $('[data-available]', sheet);
      let unitTouched = false;
      bindMoneyPreview(sheet, 'st-unit');

      /** ¿El ajuste resta? (el selector «Restar» o un signo menos escrito a mano). */
      const removing = () => {
        if (kind !== 'adjustment') return false;
        const direction = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="direction"]:checked'));
        return direction?.value === 'remove' || qtyInput.value.trim().startsWith('-');
      };
      /** El texto de cantidad que entiende el dominio: el ajuste que resta lleva signo menos. */
      const quantityText = () => {
        const text = qtyInput.value.trim();
        return removing() && !text.startsWith('-') ? `-${text.replace(/^\+/, '')}` : text;
      };

      const refresh = () => {
        const position = positions.get(productSelect.value);
        availableHint.textContent = position ? `En stock ahora: ${position.stock} (${position.product.unit}).` : '';
        if (kind === 'adjustment') unitWrap.hidden = removing();
        const q = quantityText();
        const qty = /^[+-]?\d{1,8}$/.test(q) ? Math.abs(Number(q)) : 0;
        const unit = parseMoney(unitInput.value.trim());
        if (kind !== 'adjustment' && qty > 0 && unit.ok && unit.cents > 0) {
          totalHint.textContent = `Total: ${formatMoney(qty * unit.cents)}`;
        } else if (kind === 'adjustment' && !removing() && qty > 0 && unit.ok && unit.cents > 0) {
          totalHint.textContent = `Valor que se suma al inventario: ${formatMoney(qty * unit.cents)}`;
        } else totalHint.textContent = '';
      };

      productSelect.addEventListener('change', () => {
        if (!unitTouched) unitInput.value = suggestedUnit(productSelect.value);
        unitInput.dispatchEvent(new Event('input'));
        refresh();
      });
      unitInput.addEventListener('input', () => {
        if (document.activeElement === unitInput) unitTouched = true;
        refresh();
      });
      qtyInput.addEventListener('input', refresh);
      for (const radio of form.querySelectorAll('input[name="direction"]')) radio.addEventListener('change', refresh);
      refresh();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.registerStock({
          kind,
          productId: v.productId ?? '',
          quantityText: quantityText(),
          unitText: removing() ? '' : v.unitText ?? '',
          date: v.date ?? '',
          supplierId: v.supplierId ?? '',
          categoryId: v.categoryId ?? '',
          note: v.note ?? '',
        });
        if (!handleResult(form, result)) return;
        close();
        if (!result.ok) return;
        const name = data.products.find((p) => p.id === result.entry.productId)?.name ?? 'producto';
        const units = Math.abs(result.entry.quantity);
        if (result.movement) {
          toast(`${STOCK_KIND_LABELS[kind]} guardada: ${units} × ${name}. Se anotó ${kind === 'purchase' ? 'un gasto' : 'un ingreso'} de ${formatMoney(result.movement.amountCents)} en Movimientos.`);
        } else toast(`Ajuste guardado: ${result.entry.quantity > 0 ? '+' : '−'}${units} × ${name}.`);
      });
    },
  });
}
