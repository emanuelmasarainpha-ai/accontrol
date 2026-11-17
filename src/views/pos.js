// @ts-check
// =============================================================================
// CAJA — MODO FACTURACIÓN (0.17.1, espacios Emprendedor y Empresa)
// Pantalla completa y táctil: a la izquierda los productos (foto, nombre, precio y lo que queda), con grupos y buscador; a
// la derecha (abajo en el celular) la venta actual con sus cantidades y el total. «Cobrar» abre el cobro: efectivo (con
// la devuelta), tarjeta, transferencia o fiado. Al cobrar se crea la factura, sale del inventario y entra el dinero.
//
// Las reglas viven en domain/pos.js y la venta la guarda store.posSale (todo o nada). El carrito vive en esta pantalla
// (uno por espacio) mientras no recargues la página.
// La pistola lectora de códigos escribe el código en el buscador y pulsa Enter: el producto entra al carrito.
// =============================================================================

import { customerSuggestions, invoiceLabel } from '../domain/invoices.js';
import { productGroup, productImage, stockPositions, tracksStock } from '../domain/inventory.js';
import { centsToInputValue, formatMoney } from '../domain/money.js';
import {
  PAYMENT_METHODS, WALK_IN_CUSTOMER, addToCart, availableUnits, cartTotals, cashChange, isPaymentMethod, posGroups, posProducts, productForCode,
  quickCashOptions, reconcileCart, setCartPrice, setCartQuantity,
} from '../domain/pos.js';
import { createScanReader } from '../domain/scan.js';
import { LIMITS } from '../domain/types.js';
import { cameraScanSupported, openCameraScanner } from '../ui/camera-scan.js';
import { demoBadge, emptyState } from '../ui/components.js';
import { $ } from '../ui/dom.js';
import { openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy } from '../ui/forms.js';
import { haptic } from '../ui/haptics.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { printTicket } from '../ui/ticket.js';
import { toast } from '../ui/toast.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/pos.js').CartLine} CartLine */
/** @typedef {import('../domain/inventory.js').StockPosition} StockPosition */

/** Estado de la caja (se conserva mientras no recargues la página). */
const view = {
  /** @type {string | null} null = todos los grupos */
  group: null,
  query: '',
  /** Impuesto que se aplica a la venta, en centésimas de por ciento (0 o 1800). */
  taxBp: 0,
};
/** Un carrito por espacio de trabajo. @type {Map<string, CartLine[]>} */
const carts = new Map();

/** «Imprimir el ticket al cobrar» (de este dispositivo; si el navegador no deja guardar, queda apagado). */
const AUTO_PRINT_KEY = 'accontrol.pos.autoprint.v1';
const autoPrint = {
  get() { try { return localStorage.getItem(AUTO_PRINT_KEY) === '1'; } catch { return false; } },
  /** @param {boolean} on */
  set(on) { try { if (on) localStorage.setItem(AUTO_PRINT_KEY, '1'); else localStorage.removeItem(AUTO_PRINT_KEY); } catch { /* sin almacenamiento */ } },
};

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderPos(store, ctx) {
  const workspace = store.activeWorkspace();
  if (!store.inventoryEnabled() || !store.invoicesEnabled()) return { html: notAvailablePage() };
  const wsId = workspace?.id ?? '';
  const { data } = store.getState();
  const positions = stockPositions(data);
  const byId = new Map(positions.map((p) => [p.product.id, p]));

  // Si otra persona (u otro dispositivo) vendió mientras tanto, el carrito baja a lo que queda.
  const fixed = reconcileCart(carts.get(wsId) ?? [], positions);
  if (fixed.changed && (carts.get(wsId) ?? []).length > 0) toast('Se ajustó la venta: algunos productos ya no tienen tantas unidades.', 'info');
  carts.set(wsId, fixed.cart);
  const cart = () => carts.get(wsId) ?? [];
  const setCart = (/** @type {CartLine[]} */ next) => carts.set(wsId, next);

  const groups = posGroups(data.products);
  if (view.group !== null && !groups.some((g) => g.toLocaleLowerCase('es') === /** @type {string} */ (view.group).toLocaleLowerCase('es'))) view.group = null;
  const sellable = positions.filter((p) => !p.product.archived);

  /** @param {StockPosition} p */
  const card = (p) => {
    const pr = p.product;
    const image = productImage(pr);
    const left = availableUnits(p);
    const out = left === 0;
    return html`<li><button type="button" class="pos-card" data-pos-add="${pr.id}" ${out ? 'aria-disabled="true"' : ''} aria-label="${pr.name}, ${pr.priceCents > 0 ? formatMoney(pr.priceCents) : 'sin precio'}${out ? ', agotado' : ''}. Agregar a la venta">
      <span class="pos-card__img" aria-hidden="true">${image ? html`<img src="${image}" alt="" width="96" height="96" loading="lazy" />` : pr.name.slice(0, 1).toLocaleUpperCase('es')}</span>
      <span class="pos-card__name">${pr.name}</span>
      <span class="pos-card__price">${pr.priceCents > 0 ? formatMoney(pr.priceCents) : 'Sin precio'}</span>
      <span class="pos-card__stock${out ? ' pos-card__stock--out' : ''}">${!tracksStock(pr) ? 'Sin conteo' : out ? 'Agotado' : `Quedan ${left}`}</span>
      ${pr.isDemo ? demoBadge() : ''}
    </button></li>`;
  };

  const gridHtml = () => {
    const found = posProducts(positions, view);
    if (sellable.length === 0) return html`<p class="muted empty-line">No hay productos para vender.</p>`;
    if (found.length === 0) return html`<p class="muted empty-line" role="status">Ningún producto coincide${view.query.trim() ? ` con «${view.query.trim()}»` : ' en este grupo'}.</p>`;
    return html`<ul class="pos-grid">${found.map(card)}</ul>`;
  };

  const cartHtml = () => {
    const lines = cart();
    const t = cartTotals(lines, view.taxBp);
    return html`
      <div class="pos-cart__head">
        <h2 class="pos-cart__title" id="pos-cart-title">Venta actual${t.units > 0 ? ` (${t.units})` : ''}</h2>
        ${lines.length > 0 ? html`<button type="button" class="link-btn" data-pos-clear>Vaciar</button>` : ''}
      </div>
      ${lines.length === 0
        ? html`<p class="muted pos-cart__empty">Toca un producto para agregarlo, o pasa su código por el lector.</p>`
        : html`<ul class="pos-lines">${lines.map((l) => {
            const p = byId.get(l.productId);
            const name = p?.product.name ?? 'Producto';
            return html`<li class="pos-line">
              <span class="pos-line__main">
                <span class="pos-line__name">${name}</span>
                <button type="button" class="pos-line__price" data-pos-price="${l.productId}" aria-label="Cambiar el precio de ${name} (${l.unitCents > 0 ? formatMoney(l.unitCents) : 'sin precio'})">${l.unitCents > 0 ? `${formatMoney(l.unitCents)} c/u` : 'Poner precio'}</button>
              </span>
              <span class="pos-qty" role="group" aria-label="Cantidad de ${name}">
                <button type="button" class="pos-qty__btn" data-pos-dec="${l.productId}" aria-label="Uno menos">−</button>
                <span class="pos-qty__n" aria-live="polite">${l.quantity}</span>
                <button type="button" class="pos-qty__btn" data-pos-inc="${l.productId}" aria-label="Uno más">+</button>
              </span>
              <span class="pos-line__total">${formatMoney(l.quantity * l.unitCents)}</span>
            </li>`;
          })}</ul>`}
      <dl class="pos-totals">
        <div><dt>Subtotal</dt><dd>${formatMoney(t.subtotalCents)}</dd></div>
        <div>
          <dt><label class="pos-tax"><input type="checkbox" data-pos-tax ${view.taxBp > 0 ? 'checked' : ''} /> ITBIS 18 %</label></dt>
          <dd>${formatMoney(t.taxCents)}</dd>
        </div>
        <div class="pos-totals__total"><dt>Total</dt><dd data-pos-total>${formatMoney(t.totalCents)}</dd></div>
      </dl>
      <button type="button" class="btn btn--primary btn--block pos-charge" data-action="pos-charge" ${lines.length === 0 ? 'disabled' : ''}>Cobrar ${formatMoney(t.totalCents)}</button>`;
  };

  const payBarHtml = () => {
    const t = cartTotals(cart(), view.taxBp);
    return html`<button type="button" class="pos-paybar__link" data-pos-jump>${t.units === 0 ? 'Venta vacía' : `${t.units} ${t.units === 1 ? 'artículo' : 'artículos'} · ${formatMoney(t.totalCents)}`}<span>Ver venta</span></button>`;
  };

  const page = html`
    <div class="pos">
      <header class="pos-bar">
        <a class="pos-bar__exit" href="#/inventario">${icon('back', 18)}Salir de la caja</a>
        <span class="pos-bar__title">Caja · ${workspace?.name ?? ''}</span>
        <button type="button" class="btn btn--ghost btn--small" data-pos-camera hidden>Cámara</button>
        <button type="button" class="btn btn--ghost btn--small pos-bar__full" data-pos-fullscreen hidden>Pantalla completa</button>
      </header>

      ${sellable.length === 0
        ? html`<section class="panel">${emptyState({
            icon: 'box',
            title: 'Todavía no hay productos para vender',
            text: 'Crea tus productos en Inventario (con su precio y, si quieres, su foto y su grupo). Después vuelve a la caja para vender tocándolos.',
            actions: html`<a class="btn btn--primary" href="#/inventario">Ir a Inventario</a>`,
          })}</section>`
        : html`
      <div class="pos-layout">
        <section class="pos-products" aria-label="Productos">
          <div class="pos-search">
            <label for="pos-search" class="sr-only">Buscar producto o escribir su código</label>
            <input id="pos-search" class="input" type="search" placeholder="Buscar o pasar el código…" value="${view.query}" autocomplete="off" maxlength="80" enterkeyhint="go" />
          </div>
          ${groups.length > 0
            ? html`<div class="filter-group pos-groups" role="group" aria-label="Grupos">
                <button type="button" class="filter-chip" data-pos-group="*" aria-pressed="${view.group === null ? 'true' : 'false'}">Todos</button>
                ${groups.map((g) => html`<button type="button" class="filter-chip" data-pos-group="${g}" aria-pressed="${view.group !== null && view.group.toLocaleLowerCase('es') === g.toLocaleLowerCase('es') ? 'true' : 'false'}">${g || 'Sin grupo'}</button>`)}
              </div>`
            : ''}
          <div id="pos-grid">${gridHtml()}</div>
        </section>
        <aside class="pos-cart" id="pos-cart" aria-labelledby="pos-cart-title" data-pos-cart>${cartHtml()}</aside>
      </div>
      <div class="pos-paybar" data-pos-paybar>${payBarHtml()}</div>`}
    </div>`;

  return {
    html: page,
    mount(root, signal) {
      const cartEl = root.querySelector('[data-pos-cart]');
      const gridEl = root.querySelector('#pos-grid');
      const payBar = root.querySelector('[data-pos-paybar]');
      const refreshCart = () => {
        if (cartEl instanceof HTMLElement) setHtml(cartEl, cartHtml());
        if (payBar instanceof HTMLElement) setHtml(payBar, payBarHtml());
      };
      const refreshGrid = () => { if (gridEl instanceof HTMLElement) setHtml(gridEl, gridHtml()); };
      /** @param {string} id */
      const add = (id) => {
        const p = byId.get(id);
        if (!p) return;
        const r = addToCart(cart(), p);
        if (!r.ok) { toast(r.error, 'info'); return; }
        setCart(r.cart);
        refreshCart();
      };

      root.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const el = /** @type {HTMLElement | null} */ (target.closest('[data-pos-add], [data-pos-inc], [data-pos-dec], [data-pos-price], [data-pos-clear], [data-pos-group], [data-pos-fullscreen], [data-pos-camera], [data-pos-jump], [data-action="pos-charge"]'));
        if (!el) return;
        if (el.dataset.posAdd) add(el.dataset.posAdd);
        else if (el.dataset.posInc) add(el.dataset.posInc);
        else if (el.dataset.posDec) {
          const id = el.dataset.posDec;
          const line = cart().find((l) => l.productId === id);
          if (!line) return;
          const r = setCartQuantity(cart(), id, line.quantity - 1, byId.get(id));
          if (r.ok) { setCart(r.cart); refreshCart(); }
        } else if (el.dataset.posPrice) openPriceSheet(el.dataset.posPrice);
        else if ('posClear' in el.dataset) { setCart([]); refreshCart(); }
        else if ('posCamera' in el.dataset) openCameraScanner({ onCode: (code) => addByCode(code) });
        else if ('posJump' in el.dataset) root.querySelector('[data-pos-cart]')?.scrollIntoView({ block: 'start' });
        else if (el.dataset.posGroup !== undefined) {
          view.group = el.dataset.posGroup === '*' ? null : el.dataset.posGroup;
          ctx.rerender();
        } else if ('posFullscreen' in el.dataset) {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => toast('Este navegador no deja usar la pantalla completa.', 'info'));
        } else if (el.dataset.action === 'pos-charge') openCharge();
      }, { signal });

      root.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement && 'posTax' in event.target.dataset) {
          view.taxBp = event.target.checked ? 1800 : 0;
          refreshCart();
        }
      }, { signal });

      // Buscador: filtra al escribir; Enter (lo que hace la pistola lectora) agrega el producto de ese código.
      const search = root.querySelector('#pos-search');
      if (search instanceof HTMLInputElement) {
        search.addEventListener('input', () => { view.query = search.value; refreshGrid(); }, { signal });
        search.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (!search.value.trim()) { toast('Escribe un nombre o pasa un código.', 'info'); return; }
          if (!addByCode(search.value)) return;
          search.value = '';
          view.query = '';
          refreshGrid();
        }, { signal });
        // En la computadora, el cursor queda listo en el buscador (para la pistola lectora).
        // (Un momento después: al llegar a una pantalla, la app pone el foco en ella.)
        if (window.matchMedia('(pointer: fine)').matches) window.setTimeout(() => { if (search.isConnected) search.focus({ preventScroll: true }); }, 0);
      }

      // Pistola lectora con el cursor fuera de los campos (por ejemplo, después de tocar un producto): se reconoce por la
      // velocidad de las teclas y el Enter del final (domain/scan.js).
      const reader = createScanReader();
      document.addEventListener('keydown', (event) => {
        const t = event.target;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || document.querySelector('dialog[open]')) { reader.reset(); return; }
        const code = reader.key(event.key, event.timeStamp);
        if (code) { event.preventDefault(); addByCode(code); }
      }, { signal });

      const camera = root.querySelector('[data-pos-camera]');
      if (camera instanceof HTMLElement && cameraScanSupported()) camera.hidden = false;

      const full = root.querySelector('[data-pos-fullscreen]');
      if (full instanceof HTMLElement && document.fullscreenEnabled) full.hidden = false;

      /** Agrega el producto de un código (pistola o cámara). @param {string} code @returns {boolean} */
      function addByCode(code) {
        const found = productForCode(positions, code);
        if (!found) { toast(`No encontré un producto con el código «${code.trim()}».`, 'info'); return false; }
        add(found.product.id);
        return true;
      }

      /** @param {string} id */
      function openPriceSheet(id) {
        const line = cart().find((l) => l.productId === id);
        const p = byId.get(id);
        if (!line || !p) return;
        openSheet({
          title: `Precio de ${p.product.name}`,
          content: html`<form class="stack" novalidate data-form="pos-price">
            ${moneyField({ id: 'pos-price', name: 'priceText', label: 'Precio por unidad en esta venta', value: line.unitCents > 0 ? centsToInputValue(line.unitCents) : '', errorKey: 'price', autofocus: true })}
            <p class="hint">Solo cambia en esta venta. Para cambiarlo siempre, edita el producto en Inventario.</p>
            <div class="actions"><span class="actions__group">
              <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
              <button type="submit" class="btn btn--primary">Listo</button>
            </span></div>
          </form>`,
          onMount: (sheet, close) => {
            const form = /** @type {HTMLFormElement} */ ($('form', sheet));
            bindMoneyPreview(sheet, 'pos-price');
            form.addEventListener('submit', (event) => {
              event.preventDefault();
              clearErrors(form);
              const r = setCartPrice(cart(), id, readForm(form).priceText ?? '');
              if (!r.ok) { handleResult(form, { ok: false, errors: { price: r.error } }); return; }
              setCart(r.cart);
              close();
              refreshCart();
            });
          },
        });
      }

      function openCharge() {
        const lines = cart();
        if (lines.length === 0) return;
        const t = cartTotals(lines, view.taxBp);
        const names = customerSuggestions(store.getState().data.invoices).filter((n) => n !== WALK_IN_CUSTOMER).slice(0, 200);
        openSheet({
          title: `Cobrar ${formatMoney(t.totalCents)}`,
          content: html`<div data-charge><form class="stack" novalidate data-form="pos-charge">
            <fieldset class="pos-methods">
              <legend>¿Cómo paga?</legend>
              ${PAYMENT_METHODS.map((m, i) => html`<label class="pos-method"><input type="radio" name="method" value="${m.id}" ${i === 0 ? 'checked' : ''} /><span>${m.label}</span></label>`)}
              ${fieldError('method')}
            </fieldset>
            <div data-cash>
              ${moneyField({ id: 'pos-received', name: 'receivedText', label: '¿Cuánto te entregó? (vacío = exacto)', value: '', errorKey: 'received' })}
              <div class="pos-bills" role="group" aria-label="Billetes">
                ${quickCashOptions(t.totalCents).map((b) => html`<button type="button" class="btn btn--ghost btn--small" data-bill="${b}">${formatMoney(b)}</button>`)}
              </div>
              <p class="pos-change" data-change aria-live="polite"></p>
            </div>
            <div class="field" data-field="customerName">
              <label for="pos-customer" data-customer-label>Cliente (opcional)</label>
              <input id="pos-customer" name="customerName" class="input" type="text" list="pos-customers" maxlength="${LIMITS.customerName}" autocomplete="off" placeholder="${WALK_IN_CUSTOMER}" aria-describedby="customerName-error" />
              <datalist id="pos-customers">${names.map((n) => html`<option value="${n}"></option>`)}</datalist>
              ${fieldError('customerName')}
            </div>
            <label class="pos-autoprint"><input type="checkbox" name="autoPrint" value="1" ${autoPrint.get() ? 'checked' : ''} /> Imprimir el ticket al cobrar</label>
            <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
            <div class="actions"><span class="actions__group">
              <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
              <button type="submit" class="btn btn--primary" data-confirm>Cobrar ${formatMoney(t.totalCents)}</button>
            </span></div>
          </form></div>`,
          onMount: (sheet, close) => {
            const form = /** @type {HTMLFormElement} */ ($('form', sheet));
            const cashBox = /** @type {HTMLElement} */ ($('[data-cash]', sheet));
            const received = /** @type {HTMLInputElement} */ ($('#pos-received', sheet));
            const changeEl = /** @type {HTMLElement} */ ($('[data-change]', sheet));
            const customerLabel = /** @type {HTMLElement} */ ($('[data-customer-label]', sheet));
            const confirm = /** @type {HTMLButtonElement} */ ($('[data-confirm]', sheet));
            const method = () => (/** @type {HTMLInputElement | null} */ (form.querySelector('input[name="method"]:checked'))?.value ?? 'cash');
            const update = () => {
              const m = method();
              cashBox.hidden = m !== 'cash';
              customerLabel.textContent = m === 'credit' ? 'Cliente (obligatorio para fiar)' : 'Cliente (opcional)';
              confirm.textContent = m === 'credit' ? `Fiar ${formatMoney(t.totalCents)}` : `Cobrar ${formatMoney(t.totalCents)}`;
              if (m === 'cash') {
                const c = cashChange(t.totalCents, received.value);
                changeEl.textContent = !c.ok ? c.error : c.changeCents > 0 ? `Devuelta: ${formatMoney(c.changeCents)}` : 'Pago exacto.';
                changeEl.classList.toggle('pos-change--short', !c.ok);
              }
            };
            form.addEventListener('change', update);
            received.addEventListener('input', update);
            sheet.addEventListener('click', (event) => {
              const bill = event.target instanceof Element ? /** @type {HTMLElement | null} */ (event.target.closest('[data-bill]')) : null;
              if (!bill) return;
              received.value = centsToInputValue(Number(bill.dataset.bill));
              update();
            });
            update();
            form.addEventListener('submit', async (event) => {
              event.preventDefault();
              clearErrors(form);
              setBusy(form, true);
              const v = readForm(form);
              const m = isPaymentMethod(v.method) ? v.method : 'cash';
              const result = await store.posSale({
                cart: cart(), method: m, customerName: v.customerName ?? '', receivedText: m === 'cash' ? v.receivedText ?? '' : '',
                taxText: view.taxBp > 0 ? String(view.taxBp / 100) : '', date: store.today(),
              });
              if (!handleResult(form, result) || !result.ok) return;
              haptic('confirm');
              // La pantalla ya se volvió a dibujar al guardar (con la venta todavía llena): se vacía y se dibuja otra vez.
              setCart([]);
              ctx.rerender();
              const label = invoiceLabel(result.invoice);
              const wantsPrint = v.autoPrint === '1';
              autoPrint.set(wantsPrint);
              const box = /** @type {HTMLElement} */ ($('[data-charge]', sheet));
              setHtml(box, html`<div class="pos-done" role="status">
                <span class="pos-done__icon" aria-hidden="true">${icon('check', 36)}</span>
                <p class="pos-done__title">${result.method === 'credit' ? `Fiado anotado a ${result.invoice.customerName}` : 'Venta cobrada'}</p>
                <p class="pos-done__amount">${formatMoney(result.totalCents)}</p>
                ${result.changeCents > 0 ? html`<p class="pos-done__change">Devuelta: <strong>${formatMoney(result.changeCents)}</strong></p>` : ''}
                <p class="muted">Factura ${label} · ${result.method === 'credit' ? 'queda en «Fiado»' : 'se anotó como ingreso'}${result.entries.length > 0 ? ' · el inventario se actualizó' : ''}.</p>
                <div class="actions"><span class="actions__group">
                  <button type="button" class="btn btn--ghost" data-go-invoice="${result.invoice.id}">Ver factura</button>
                  <button type="button" class="btn btn--ghost" data-print-ticket>Imprimir ticket</button>
                  <button type="button" class="btn btn--primary" data-close data-autofocus>Nueva venta</button>
                </span></div>
              </div>`);
              /** @type {HTMLElement | null} */ (box.querySelector('[data-autofocus]'))?.focus();
              box.querySelector('[data-go-invoice]')?.addEventListener('click', () => { close(); window.location.hash = `#/facturas/${result.invoice.id}`; });
              box.querySelector('[data-print-ticket]')?.addEventListener('click', () => printTicket(store, result.invoice.id));
              if (wantsPrint) window.setTimeout(() => printTicket(store, result.invoice.id), 50);
            });
          },
        });
      }
    },
  };
}

function notAvailablePage() {
  return html`<section class="panel">${emptyState({
    icon: 'box',
    title: 'La caja es parte de los espacios Emprendedor y Empresa',
    text: 'Abre un espacio Emprendedor o Empresa para vender tus productos tocándolos, cobrar y facturar desde la caja.',
    actions: html`<button type="button" class="btn btn--primary" data-action="workspace-menu">Ver mis espacios</button>
      <a class="btn btn--ghost" href="#/finanzas">Volver a Finanzas</a>`,
  })}</section>`;
}
