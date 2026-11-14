// @ts-check
// =============================================================================
// INVENTARIO (módulo de Emprendedor y Empresa)
// Lista de productos con su stock, su valor y su estado; las ventas y la ganancia bruta del mes; los proveedores y los
// últimos movimientos de stock. Al tocar un producto se abre su ficha, con el historial de compras, ventas y ajustes.
//
// Todos los números salen de domain/inventory.js. Los botones (Nuevo producto, Registrar compra/venta, Ajustar…) son
// acciones comunes (app/actions.js) que abren los formularios de views/inventory-forms.js.
// Todavía NO existen códigos de barras, varias bodegas, órdenes de compra ni cuentas por pagar a proveedores.
// =============================================================================

import { formatDate, monthKeyOf, monthLabel, plural } from '../domain/dates.js';
import {
  STOCK_KIND_LABELS, inventorySummary, productUsage, replayProduct, salesAnalysis, sortEntriesNewestFirst, stockPositions, supplierTotals,
} from '../domain/inventory.js';
import { invoiceLabel } from '../domain/invoices.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { demoBadge, demoBanner, emptyState, exportButtons, financeTabs, money } from '../ui/components.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/inventory.js').StockPosition} StockPosition */
/** @typedef {import('../domain/types.js').StockEntry} StockEntry */

/** Cantidad con separador de miles. @param {number} n */
const qty = (n) => n.toLocaleString('en-US');

/** @param {StockPosition['status']} status @param {boolean} hasMovements */
function statusChip(status, hasMovements) {
  if (status === 'ok') return html`<span class="chip chip--good">Bien</span>`;
  if (status === 'low') return html`<span class="chip chip--warn">Stock bajo</span>`;
  return hasMovements ? html`<span class="chip chip--alert">Agotado</span>` : html`<span class="chip">Sin movimientos</span>`;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderInventory(store, ctx) {
  if (!store.inventoryEnabled()) return { html: notAvailablePage(store) };
  const today = store.today();
  const detailId = ctx.params[0];
  return { html: detailId ? detailPage(store, detailId) : listPage(store, today) };
}

// =============================================================================
// NO DISPONIBLE (espacio personal o freelancer sin inventario)
// =============================================================================

/** @param {Store} store */
function notAvailablePage(store) {
  const workspace = store.activeWorkspace();
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Inventario</h1>
        <p class="page-subtitle">Productos, stock, proveedores, compras y ventas.</p>
      </div>
    </header>
    <section class="panel">${emptyState({
      icon: 'box',
      title: 'El inventario es parte de los espacios Emprendedor y Empresa',
      text: `${workspace ? `«${workspace.name}» no lo usa. ` : ''}Crea (o abre) un espacio Emprendedor o Empresa para llevar tus productos, cuánto stock te queda, a quién le compras y cuánto ganas con cada venta.`,
      actions: html`<button type="button" class="btn btn--primary" data-action="workspace-menu">Ver mis espacios</button>
        <a class="btn btn--ghost" href="#/finanzas">Volver a Finanzas</a>`,
    })}</section>`;
}

// =============================================================================
// LISTA
// =============================================================================

/** @param {Store} store @param {string} today */
function listPage(store, today) {
  const { data } = store.getState();
  const summary = inventorySummary(data);
  const monthKey = monthKeyOf(today);
  const sales = salesAnalysis(data, `${monthKey}-01`, today);
  const suppliers = supplierTotals(data);
  const activeSuppliers = suppliers.filter((s) => !s.supplier.archived);
  const archivedSuppliers = suppliers.filter((s) => s.supplier.archived);
  const productName = new Map(data.products.map((p) => [p.id, p.name]));
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  const invoiceById = new Map(data.invoices.map((i) => [i.id, i]));
  const hasMovements = new Set(data.stockEntries.map((e) => e.productId));
  const active = summary.positions.filter((p) => !p.product.archived);
  const archived = summary.positions.filter((p) => p.product.archived);
  const recent = sortEntriesNewestFirst(data.stockEntries).slice(0, 8);
  // Lo que costó la mercancía que salió en cada venta o merma (costo promedio del momento).
  /** @type {Map<string, number>} */
  const costOf = new Map();
  for (const p of data.products) {
    for (const r of replayProduct(data.stockEntries.filter((e) => e.productId === p.id)).rows) costOf.set(r.entry.id, r.costCents);
  }

  /** @param {StockPosition} p */
  const productRow = (p) => {
    const pr = p.product;
    return html`<li class="row-item">
      <a class="product-row${pr.archived ? ' product-row--archived' : ''}" href="#/inventario/${pr.id}" aria-label="${pr.name}. Ver ficha">
        <span class="product-row__main">
          <span class="product-row__top">
            <span class="product-row__name">${pr.name}</span>
            ${pr.archived ? html`<span class="chip">Archivado</span>` : statusChip(p.status, hasMovements.has(pr.id))}
            ${pr.isDemo ? demoBadge() : ''}
          </span>
          ${pr.sku ? html`<span class="product-row__sub">Código ${pr.sku}</span>` : ''}
          <span class="product-row__meta">
            <span>${pr.priceCents > 0 ? `Precio ${formatMoney(pr.priceCents)}` : 'Sin precio de venta'}</span>
            ${p.stock > 0 ? html`<span>Costo promedio ${formatMoney(p.avgCostCents)}</span>` : ''}
            ${pr.minStock > 0 ? html`<span>Avisar en ${qty(pr.minStock)}</span>` : ''}
          </span>
        </span>
        <span class="product-row__side">
          <span class="product-row__amount">${qty(p.stock)}</span>
          <span class="product-row__label">en stock (${pr.unit})</span>
          <span class="product-row__value">${formatMoney(p.valueCents)}</span>
        </span>
      </a>
    </li>`;
  };

  return html`
    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Tu mercancía: lo que tienes, lo que compras y lo que vendes.</p>
      </div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--primary" data-action="stock-sell">${icon('plus', 18)}Registrar venta</button>
        <button type="button" class="btn btn--ghost" data-action="stock-buy">Registrar compra</button>
        <button type="button" class="btn btn--ghost" data-action="new-product">Nuevo producto</button>
      </div>
    </header>

    ${financeTabs('inventario', store)}
    ${demoBanner(store.hasDemoData())}

    ${data.products.length === 0
      ? html`<section class="panel">${emptyState({
          icon: 'box',
          title: 'Tu estante está vacío por ahora',
          text: 'Crea los productos que compras y vendes. Cada compra suma stock y se anota como gasto; cada venta resta stock y se anota como ingreso. ACCONTROL te dice cuánto vale lo que tienes, qué se está agotando y cuánto ganas con cada producto.',
          actions: html`<button type="button" class="btn btn--primary" data-action="new-product">Nuevo producto</button>
            <button type="button" class="btn btn--ghost" data-action="new-supplier">Nuevo proveedor</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    <section class="panel panel--summary" aria-label="Resumen del inventario">
      <dl class="kpis">
        <div class="kpi"><dt>Valor del inventario</dt><dd>${money(summary.totalValueCents)}</dd><dd class="kpi__note">${plural(summary.totalUnits, 'unidad', 'unidades')} en ${plural(summary.activeProducts, 'producto activo', 'productos activos')}</dd></div>
        <div class="kpi"><dt>Stock bajo o agotado</dt><dd>${summary.alerts.length}</dd><dd class="kpi__note">${summary.alerts.length === 0 ? 'Todo en orden' : summary.outCount > 0 ? `${summary.outCount} agotados` : 'Por debajo del aviso'}</dd></div>
        <div class="kpi"><dt>Ventas de ${monthLabel(monthKey)}</dt><dd>${money(sales.revenueCents)}</dd><dd class="kpi__note">${sales.units === 0 ? 'Sin ventas este mes' : `${qty(sales.units)} vendidas`}</dd></div>
        <div class="kpi"><dt>Ganancia bruta del mes</dt><dd>${sales.units === 0 ? '—' : money(sales.profitCents, { tone: 'auto' })}</dd><dd class="kpi__note">${sales.marginPercent === null ? 'Aparece con la primera venta' : `Margen ${formatPercent(sales.marginPercent)}`}</dd></div>
      </dl>
      <p class="panel__foot">El valor se calcula a costo promedio: lo comprado menos lo que ya salió. «Ganancia bruta» es lo vendido menos lo que costó la mercancía vendida; no descuenta gastos fijos. Son cálculos con reglas fijas, no inteligencia artificial.</p>
    </section>

    ${summary.alerts.length > 0
      ? html`<p class="notice" role="status">${icon('alert', 18)}<span>${summary.alerts.length === 1 ? 'Stock bajo en un producto' : `Stock bajo en ${summary.alerts.length} productos`}: ${summary.alerts.slice(0, 4).map((a) => `«${a.product.name}» (${qty(a.stock)})`).join(', ')}${summary.alerts.length > 4 ? ` y ${summary.alerts.length - 4} más` : ''}.</span></p>`
      : ''}

    <section class="panel" aria-labelledby="products-title">
      <div class="panel__head">
        <h2 class="panel__title" id="products-title">Productos (${active.length})</h2>
        <button type="button" class="link-btn" data-action="new-product">Nuevo producto</button>
      </div>
      ${active.length === 0 ? html`<p class="muted">Todos tus productos están archivados.</p>` : html`<ul class="rows">${active.map(productRow)}</ul>`}
      ${archived.length > 0
        ? html`<details class="table-view"><summary>Archivados (${archived.length})</summary><ul class="rows">${archived.map(productRow)}</ul></details>`
        : ''}
    </section>

    ${sales.byProduct.length > 0
      ? html`<section class="panel" aria-labelledby="margin-title">
          <div class="panel__head"><h2 class="panel__title" id="margin-title">Lo que más dejó en ${monthLabel(monthKey)}</h2></div>
          <ul class="rows">${sales.byProduct.slice(0, 6).map(
            (r) => html`<li class="row-item"><div class="row row--static">
              <span class="row__main"><span class="row__title"><a href="#/inventario/${r.product.id}">${r.product.name}</a></span><span class="row__meta"><span>${qty(r.units)} vendidas</span><span>Ventas ${formatMoney(r.revenueCents)}</span><span>Costo ${formatMoney(r.costCents)}</span></span></span>
              <span class="row__side"><span class="row__amount row__amount--income">${formatMoney(r.profitCents)}</span><span class="row__time">${r.marginPercent === null ? '' : `margen ${formatPercent(r.marginPercent)}`}</span></span>
            </div></li>`,
          )}</ul>
          ${sales.shrinkUnits > 0 ? html`<p class="panel__foot">Además hubo ${plural(sales.shrinkUnits, 'unidad perdida', 'unidades perdidas')} por ajustes (mermas), que costaron ${formatMoney(sales.shrinkCostCents)} y no están en la ganancia de arriba.</p>` : ''}
        </section>`
      : ''}

    <section class="panel" aria-labelledby="suppliers-title">
      <div class="panel__head">
        <h2 class="panel__title" id="suppliers-title">Proveedores (${activeSuppliers.length})</h2>
        <button type="button" class="link-btn" data-action="new-supplier">Nuevo proveedor</button>
      </div>
      ${suppliers.length === 0
        ? html`<p class="muted">Todavía no tienes proveedores. Anota a quién le compras para saber cuánto le has comprado a cada uno. Es opcional: puedes registrar compras sin proveedor.</p>`
        : html`${activeSuppliers.length === 0 ? html`<p class="muted">Todos tus proveedores están archivados.</p>` : html`<ul class="rows">${activeSuppliers.map((t) => supplierRow(t))}</ul>`}
          ${archivedSuppliers.length > 0 ? html`<details class="table-view"><summary>Archivados (${archivedSuppliers.length})</summary><ul class="rows">${archivedSuppliers.map((t) => supplierRow(t))}</ul></details>` : ''}`}
    </section>

    <section class="panel" aria-labelledby="recent-title">
      <div class="panel__head"><h2 class="panel__title" id="recent-title">Últimos movimientos de stock</h2></div>
      ${recent.length === 0
        ? html`<p class="muted">Aún no hay compras, ventas ni ajustes. Empieza con «Registrar compra» para tener stock.</p>`
        : html`<ul class="rows">${recent.map((e) => stockRow(e, { name: productName.get(e.productId) ?? 'Producto', supplier: e.supplierId ? supplierName.get(e.supplierId) ?? '' : '', withLink: true, costCents: costOf.get(e.id) ?? 0, invoice: e.invoiceId ? invoiceById.get(e.invoiceId) ?? null : null }))}</ul>`}
      <p class="panel__foot">Cada compra se anota también como un gasto y cada venta como un ingreso en Movimientos; se borran juntos desde la ficha del producto. Las salidas de una factura se manejan desde la factura.</p>
    </section>

    <section class="panel" aria-labelledby="inventory-export">
      <div class="panel__head"><h2 class="panel__title" id="inventory-export">Exportar inventario</h2></div>
      <p class="panel__sub">Productos con su stock y su valor, todos los movimientos de stock, ventas y ganancia por producto, y proveedores. Se crea en tu dispositivo.</p>
      ${exportButtons({ kind: 'inventory', label: 'Exportar inventario' })}
    </section>`}
  `;
}

/** @param {ReturnType<typeof supplierTotals>[number]} t */
function supplierRow({ supplier, purchases, totalCents, lastDate }) {
  const contact = [supplier.contact, supplier.phone, supplier.email].filter(Boolean).join(' · ');
  return html`<li class="row-item">
    <button type="button" class="row" data-action="supplier-edit" data-id="${supplier.id}" aria-label="Proveedor ${supplier.name}. Editar">
      <span class="row__main">
        <span class="row__top"><span class="row__title">${supplier.name}</span>${supplier.archived ? html`<span class="chip">Archivado</span>` : ''}${supplier.isDemo ? demoBadge() : ''}</span>
        <span class="row__meta">
          ${contact ? html`<span>${contact}</span>` : ''}
          <span>${purchases === 0 ? 'Sin compras todavía' : `${plural(purchases, 'compra', 'compras')} · última ${formatDate(lastDate)}`}</span>
        </span>
      </span>
      <span class="row__side"><span class="row__amount">${formatMoney(totalCents)}</span><span class="row__time">comprado</span></span>
    </button>
  </li>`;
}

/**
 * Una línea del historial de stock.
 * @param {StockEntry} e
 * @param {{ name: string, supplier: string, withLink: boolean, costCents?: number, stockAfter?: number, deletable?: boolean, invoice?: import('../domain/types.js').Invoice | null }} o
 */
function stockRow(e, { name, supplier, withLink, costCents = 0, stockAfter, deletable = false, invoice = null }) {
  const units = Math.abs(e.quantity);
  const total = units * e.unitCents;
  const title = e.kind === 'adjustment'
    ? `Ajuste: ${e.quantity > 0 ? '+' : '−'}${qty(units)}`
    : `${STOCK_KIND_LABELS[e.kind]}: ${qty(units)} × ${formatMoney(e.unitCents)}`;
  return html`<li class="row-item"><div class="row row--static">
    <span class="row__main">
      <span class="row__top">
        <span class="tag${e.kind === 'sale' ? ' tag--income' : e.kind === 'purchase' ? ' tag--expense' : ' tag--adjust'}">${STOCK_KIND_LABELS[e.kind]}</span>
        ${e.isDemo ? demoBadge() : ''}
      </span>
      <span class="row__title">${withLink ? html`<a href="#/inventario/${e.productId}">${name}</a> · ` : ''}${title}</span>
      <span class="row__meta">
        <span>${formatDate(e.date)} · ${e.time}</span>
        ${supplier ? html`<span>Proveedor: ${supplier}</span>` : ''}
        ${invoice ? html`<span>De la factura <a href="#/facturas/${invoice.id}">${invoiceLabel(invoice)}</a> (${invoice.customerName})</span>` : e.note ? html`<span>${e.note}</span>` : ''}
        ${stockAfter === undefined ? '' : html`<span>Stock después: ${qty(stockAfter)}</span>`}
      </span>
    </span>
    <span class="row__side">
      ${e.kind === 'adjustment'
        ? html`<span class="row__amount">${e.quantity > 0 ? formatMoney(total) : costCents > 0 ? formatMoney(costCents) : '—'}</span><span class="row__time">${e.quantity > 0 ? 'valor sumado' : 'costo de la merma'}</span>`
        : html`<span class="row__amount${e.kind === 'sale' ? ' row__amount--income' : ''}">${formatMoney(total)}</span><span class="row__time">${e.kind === 'sale' && costCents > 0 ? `costo ${formatMoney(costCents)}` : 'total'}</span>`}
      ${deletable && !e.invoiceId ? html`<button type="button" class="btn btn--danger-ghost btn--small" data-action="stock-delete" data-id="${e.id}" aria-label="Eliminar este movimiento de stock">${icon('trash', 16)}Eliminar</button>` : ''}
    </span>
  </div></li>`;
}

// =============================================================================
// FICHA DE UN PRODUCTO
// =============================================================================

function missingPage() {
  return html`
    <a class="back-link" href="#/inventario">${icon('back', 16)}Inventario</a>
    <section class="panel">${emptyState({
      icon: 'box',
      title: 'Ese producto ya no existe',
      text: 'Pudo haberse borrado desde otra ventana.',
      actions: html`<a class="btn btn--primary" href="#/inventario">Volver a Inventario</a>`,
    })}</section>`;
}

/** @param {Store} store @param {string} id */
function detailPage(store, id) {
  const { data } = store.getState();
  const product = data.products.find((p) => p.id === id);
  if (!product) return missingPage();

  const position = /** @type {StockPosition} */ (stockPositions(data).find((p) => p.product.id === id));
  const entries = data.stockEntries.filter((e) => e.productId === id);
  const replay = replayProduct(entries);
  const rows = [...replay.rows].reverse();
  const usage = productUsage(data, id);
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  const invoiceById = new Map(data.invoices.map((i) => [i.id, i]));
  const purchased = entries.filter((e) => e.kind === 'purchase').reduce((s, e) => s + e.quantity, 0);
  const sold = entries.filter((e) => e.kind === 'sale').reduce((s, e) => s - e.quantity, 0);

  return html`
    <a class="back-link" href="#/inventario">${icon('back', 16)}Inventario</a>

    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">${product.name}</h1>
        <p class="page-subtitle">${product.sku ? `Código ${product.sku} · ` : ''}Se cuenta en: ${product.unit}</p>
        <p class="debt__tags debt__tags--start">${product.archived ? html`<span class="chip">Archivado</span>` : statusChip(position.status, entries.length > 0)}${product.isDemo ? demoBadge() : ''}</p>
      </div>
      <div class="page-header__actions">
        ${product.archived
          ? ''
          : html`<button type="button" class="btn btn--primary" data-action="stock-sell" data-product="${product.id}">${icon('plus', 18)}Registrar venta</button>
              <button type="button" class="btn btn--ghost" data-action="stock-buy" data-product="${product.id}">Registrar compra</button>
              <button type="button" class="btn btn--ghost" data-action="stock-adjust" data-product="${product.id}">Ajustar stock</button>`}
        <button type="button" class="btn btn--ghost" data-action="product-edit" data-id="${product.id}">Editar</button>
      </div>
    </header>

    ${demoBanner(store.hasDemoData())}

    <section class="panel" aria-label="Resumen del producto">
      <dl class="kpis">
        <div class="kpi"><dt>En stock</dt><dd>${qty(position.stock)}</dd><dd class="kpi__note">${product.unit}${product.minStock > 0 ? ` · aviso en ${qty(product.minStock)}` : ''}</dd></div>
        <div class="kpi"><dt>Valor en stock</dt><dd>${money(position.valueCents)}</dd><dd class="kpi__note">${position.stock > 0 ? `Costo promedio ${formatMoney(position.avgCostCents)}` : 'Sin unidades'}</dd></div>
        <div class="kpi"><dt>Precio de venta</dt><dd>${product.priceCents > 0 ? money(product.priceCents) : '—'}</dd><dd class="kpi__note">${product.priceCents > 0 && position.stock > 0 ? `Ganas ${formatMoney(product.priceCents - position.avgCostCents)} por unidad` : 'Por unidad'}</dd></div>
        <div class="kpi"><dt>Movimiento total</dt><dd>${qty(purchased)} / ${qty(sold)}</dd><dd class="kpi__note">Compradas / vendidas</dd></div>
      </dl>
      ${product.notes ? html`<p class="muted">Notas: ${product.notes}</p>` : ''}
    </section>

    <section class="panel" aria-labelledby="history-title">
      <div class="panel__head"><h2 class="panel__title" id="history-title">Historial de stock (${rows.length})</h2></div>
      ${rows.length === 0
        ? html`<p class="muted">Todavía no tiene movimientos. Registra una compra para meter mercancía al inventario.</p>`
        : html`<ul class="rows">${rows.map((r) => stockRow(r.entry, {
            name: product.name, supplier: r.entry.supplierId ? supplierName.get(r.entry.supplierId) ?? '' : '', withLink: false,
            costCents: r.costCents, stockAfter: r.stockAfter, deletable: true, invoice: r.entry.invoiceId ? invoiceById.get(r.entry.invoiceId) ?? null : null,
          }))}</ul>
          <p class="panel__foot">Un movimiento no se edita: si te equivocaste, elimínalo (se borra también su gasto o ingreso) y regístralo de nuevo. No se puede eliminar una compra si con eso el stock quedaría en negativo. Las salidas que vienen de una factura solo se quitan anulando la factura.</p>`}
    </section>

    <section class="panel" aria-labelledby="manage-title">
      <h2 class="panel__title" id="manage-title">Administrar producto</h2>
      <p class="muted">${product.archived
        ? 'Está archivado: no aparece al registrar compras ni ventas, pero su historial y su valor se conservan.'
        : 'Si ya no lo vendes, archívalo: deja de ofrecerse al comprar y vender, pero su historial se conserva.'}</p>
      <div class="actions actions--start">
        <button type="button" class="btn btn--ghost" data-action="product-archive" data-id="${product.id}" data-archived="${product.archived ? 'false' : 'true'}">${product.archived ? 'Reactivar producto' : 'Archivar producto'}</button>
        ${usage.entries === 0 && usage.invoices === 0
          ? html`<button type="button" class="btn btn--danger-ghost" data-action="product-delete" data-id="${product.id}">${icon('trash', 18)}Eliminar producto</button>`
          : html`<span class="muted">No se puede eliminar porque ${usage.entries > 0 ? `tiene ${plural(usage.entries, 'movimiento de stock', 'movimientos de stock')}` : `aparece en ${plural(usage.invoices, 'factura', 'facturas')}`}.</span>`}
      </div>
    </section>
  `;
}
