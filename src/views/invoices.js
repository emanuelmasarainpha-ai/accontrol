// @ts-check
// =============================================================================
// FACTURAS INTERNAS (módulo de Emprendedor, Empresa y, desde la 0.14.5, Freelancer)
// Lista de facturas con lo que te deben (por vencer y vencido), quién te debe, lo facturado y cobrado del mes, y al tocar
// una factura, su ficha: datos del cliente, líneas, totales, cobros y el PDF.
//
// Todos los números salen de domain/invoices.js. Los botones (Nueva factura, Registrar cobro, Anular…) son acciones comunes
// (app/actions.js) que abren los formularios de views/invoice-forms.js.
// Las facturas son documentos INTERNOS de control: no son comprobantes fiscales ni se envían a ninguna autoridad.
// Recordatorios de cobro: la app solo COPIA un mensaje para que la persona lo envíe; no envía nada (eso llega con las
// notificaciones, etapa 0.18).
// =============================================================================

import { formatDate, monthKeyOf, monthLabel, plural } from '../domain/dates.js';
import {
  INVOICE_STATUS_LABELS, NOT_FISCAL_NOTE, dueText, formatTaxPercent, invoiceActivity, invoiceLabel, invoicePositions, invoiceReceivables, overdueInvoices,
} from '../domain/invoices.js';
import { clientLabel } from '../domain/clients.js';
import { formatMoney } from '../domain/money.js';
import { demoBadge, demoBanner, emptyState, exportButtons, financeTabs, money } from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/invoices.js').InvoicePosition} InvoicePosition */
/** @typedef {'all' | 'pending' | 'overdue' | 'paid' | 'void'} Filter */

/** Estado propio de esta pantalla (se conserva mientras no recargues la página). */
const view = {
  /** @type {Filter} */
  filter: 'all',
};

/** @type {{ id: Filter, label: string }[]} */
const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'pending', label: 'Por cobrar' },
  { id: 'overdue', label: 'Vencidas' },
  { id: 'paid', label: 'Cobradas' },
  { id: 'void', label: 'Anuladas' },
];

/** @param {InvoicePosition} p @param {Filter} filter */
function matches(p, filter) {
  if (filter === 'all') return true;
  if (filter === 'pending') return p.balanceCents > 0;
  return p.status === filter;
}

/** @param {InvoicePosition['status']} status */
export function invoiceStatusChip(status) {
  const cls = status === 'paid' ? ' chip--good' : status === 'overdue' ? ' chip--alert' : status === 'partial' ? ' chip--progress' : status === 'void' ? ' chip--void' : '';
  return html`<span class="chip${cls}">${INVOICE_STATUS_LABELS[status]}</span>`;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderInvoices(store, ctx) {
  if (!store.invoicesEnabled()) return { html: notAvailablePage(store) };
  const today = store.today();
  const detailId = ctx.params[0];
  return {
    html: detailId ? detailPage(store, detailId, today) : listPage(store, today),
    mount(root, signal) {
      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (el?.dataset.action !== 'invoice-filter') return;
          const value = FILTERS.find((f) => f.id === el.dataset.value)?.id;
          if (value) {
            view.filter = value;
            ctx.rerender();
          }
        },
        { signal },
      );
    },
  };
}

// =============================================================================
// NO DISPONIBLE (espacio personal o freelancer sin facturas)
// =============================================================================

/** @param {Store} store */
function notAvailablePage(store) {
  const workspace = store.activeWorkspace();
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Facturas</h1>
        <p class="page-subtitle">Lo que facturas y lo que te falta por cobrar.</p>
      </div>
    </header>
    <section class="panel">${emptyState({
      icon: 'receipt',
      title: 'Las facturas son parte de los espacios Freelancer, Emprendedor y Empresa',
      text: `${workspace ? `«${workspace.name}» no las usa. ` : ''}Crea (o abre) un espacio Freelancer, Emprendedor o Empresa para emitir facturas internas, registrar cobros y saber quién te debe.`,
      actions: html`<button type="button" class="btn btn--primary" data-action="workspace-menu">Ver mis espacios</button>
        <a class="btn btn--ghost" href="#/finanzas">Volver a Finanzas</a>`,
    })}</section>`;
}

// =============================================================================
// LISTA
// =============================================================================

/** @param {InvoicePosition} p */
function invoiceRow(p) {
  const inv = p.invoice;
  const label = invoiceLabel(inv);
  const late = p.status === 'overdue';
  const dueLine = inv.dueDate ? `${late ? 'venció' : 'vence'} el ${formatDate(inv.dueDate)}` : 'sin vencimiento';
  return html`<li class="row-item">
    <a class="invoice-row${p.status === 'void' ? ' invoice-row--void' : ''}" href="#/facturas/${inv.id}" aria-label="Factura ${label}, ${inv.customerName}, ${INVOICE_STATUS_LABELS[p.status]}. Ver factura">
      <span class="invoice-row__main">
        <span class="invoice-row__top">
          <span class="invoice-row__name">${inv.customerName}</span>
          ${invoiceStatusChip(p.status)}
          ${inv.isDemo ? demoBadge() : ''}
        </span>
        <span class="invoice-row__sub">${label} · ${formatDate(inv.issueDate)}</span>
        <span class="invoice-row__meta">
          <span>${dueLine}${late ? ` · ${plural(p.daysOverdue, 'día', 'días')} de atraso` : ''}</span>
          <span>${plural(inv.lines.length, 'línea', 'líneas')}</span>
        </span>
      </span>
      <span class="invoice-row__side">
        <span class="invoice-row__amount">${formatMoney(p.totalCents)}</span>
        ${p.status === 'void'
          ? html`<span class="invoice-row__label">Anulada</span>`
          : p.balanceCents === 0
            ? html`<span class="invoice-row__owed invoice-row__owed--paid">Cobrada</span>`
            : html`<span class="invoice-row__owed${late ? ' invoice-row__owed--late' : ''}">Falta ${formatMoney(p.balanceCents)}</span>`}
      </span>
    </a>
  </li>`;
}

/** @param {Store} store @param {string} today */
function listPage(store, today) {
  const { data } = store.getState();
  const positions = invoicePositions(data, today);
  const receivables = invoiceReceivables(data, today);
  const monthKey = monthKeyOf(today);
  const activity = invoiceActivity(data, `${monthKey}-01`, today);
  const visible = positions.filter((p) => matches(p, view.filter));
  const count = (/** @type {Filter} */ f) => positions.filter((p) => matches(p, f)).length;
  const { aging } = receivables;

  return html`
    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Tus facturas internas y lo que te falta por cobrar.</p>
      </div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--primary" data-action="new-invoice">${icon('plus', 18)}Nueva factura</button>
      </div>
    </header>

    ${financeTabs('facturas', store)}
    ${demoBanner(store.hasDemoData())}

    ${positions.length === 0
      ? html`<section class="panel">${emptyState({
          icon: 'receipt',
          title: 'Aún no has emitido facturas',
          text: 'Emite una factura para llevar el control de lo que vendes a crédito: ACCONTROL te dice cuánto te deben, quién y desde cuándo. Cada cobro que registres se anota también como un ingreso en Movimientos. Son documentos internos de control, no comprobantes fiscales.',
          actions: html`<button type="button" class="btn btn--primary" data-action="new-invoice">Nueva factura</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    <section class="panel panel--summary" aria-label="Resumen de facturas">
      <dl class="kpis">
        <div class="kpi"><dt>Por cobrar</dt><dd>${money(receivables.totalCents)}</dd><dd class="kpi__note">${receivables.openCount === 0 ? 'Nada pendiente' : plural(receivables.openCount, 'factura con saldo', 'facturas con saldo')}</dd></div>
        <div class="kpi"><dt>Vencido</dt><dd>${money(receivables.overdueCents, { tone: receivables.overdueCents > 0 ? 'alert' : 'none' })}</dd><dd class="kpi__note">${receivables.overdueCount === 0 ? 'Ninguna vencida' : `${plural(receivables.overdueCount, 'factura', 'facturas')} · la más atrasada, ${plural(receivables.oldestDaysOverdue, 'día', 'días')}`}</dd></div>
        <div class="kpi"><dt>Facturado en ${monthLabel(monthKey)}</dt><dd>${money(activity.billedCents)}</dd><dd class="kpi__note">${activity.billedCount === 0 ? 'Sin facturas este mes' : plural(activity.billedCount, 'factura emitida', 'facturas emitidas')}</dd></div>
        <div class="kpi"><dt>Cobrado en ${monthLabel(monthKey)}</dt><dd>${money(activity.collectedCents)}</dd><dd class="kpi__note">De cualquier factura</dd></div>
      </dl>
      <p class="panel__foot">Lo facturado no es ingreso hasta que lo cobras: cada cobro se anota como ingreso en Movimientos y en Resultados (por fecha de cobro). Son cálculos con reglas fijas, no inteligencia artificial.</p>
    </section>

    ${receivables.totalCents > 0
      ? html`<section class="panel" aria-labelledby="aging-title">
          <div class="panel__head"><h2 class="panel__title" id="aging-title">Cuánto lleva vencido</h2></div>
          <dl class="aging">
            <div class="aging__cell"><dt>Por vencer</dt><dd>${formatMoney(aging.current)}</dd></div>
            <div class="aging__cell${aging.d1to30 > 0 ? ' aging__cell--late' : ''}"><dt>1 a 30 días</dt><dd>${formatMoney(aging.d1to30)}</dd></div>
            <div class="aging__cell${aging.d31to60 > 0 ? ' aging__cell--late' : ''}"><dt>31 a 60 días</dt><dd>${formatMoney(aging.d31to60)}</dd></div>
            <div class="aging__cell${aging.d61plus > 0 ? ' aging__cell--late' : ''}"><dt>Más de 60 días</dt><dd>${formatMoney(aging.d61plus)}</dd></div>
          </dl>
          <p class="panel__foot">Los días se cuentan desde el vencimiento. Una factura sin fecha de vencimiento se muestra como «por vencer».</p>
        </section>

        <section class="panel" aria-labelledby="owing-title">
          <div class="panel__head"><h2 class="panel__title" id="owing-title">Quién te debe</h2></div>
          <ul class="rows">${receivables.customers.slice(0, 6).map((c) => {
            const inner = html`<span class="row__main"><span class="row__title">${c.customerName}</span><span class="row__meta"><span>${plural(c.invoices, 'factura', 'facturas')}</span>${c.oldestDaysOverdue > 0 ? html`<span>la más atrasada, ${plural(c.oldestDaysOverdue, 'día', 'días')}</span>` : html`<span>al día</span>`}</span></span>
              <span class="row__side"><span class="row__amount">${formatMoney(c.balanceCents)}</span>${c.overdueCents > 0 ? html`<span class="row__time">${formatMoney(c.overdueCents)} vencido</span>` : ''}</span>`;
            // Con «Fiado» (0.16.3), cada cliente abre su estado de cuenta.
            return html`<li class="row-item">${store.fiadoEnabled()
              ? html`<a class="row" href="#/fiado/${encodeURIComponent(c.key)}" aria-label="${c.customerName}. Ver estado de cuenta">${inner}</a>`
              : html`<div class="row row--static">${inner}</div>`}</li>`;
          })}</ul>
          ${receivables.customers.length > 6 ? html`<p class="panel__foot">Y ${receivables.customers.length - 6} clientes más con saldo.</p>` : ''}
        </section>`
      : ''}

    ${reminderPanel(overdueInvoices(data, today))}

    <section class="panel" aria-labelledby="invoices-title">
      <div class="panel__head">
        <h2 class="panel__title" id="invoices-title">Facturas (${positions.length})</h2>
        <button type="button" class="link-btn" data-action="new-invoice">Nueva factura</button>
      </div>
      <div class="filter-group" role="group" aria-label="Filtrar facturas">
        ${FILTERS.map((f) => html`<button type="button" class="filter-chip" data-action="invoice-filter" data-value="${f.id}" aria-pressed="${view.filter === f.id ? 'true' : 'false'}">${f.label} (${count(f.id)})</button>`)}
      </div>
      ${visible.length === 0
        ? html`<p class="muted">No hay facturas en «${FILTERS.find((f) => f.id === view.filter)?.label ?? ''}».</p>`
        : html`<ul class="rows">${visible.map(invoiceRow)}</ul>`}
      <p class="panel__foot">${NOT_FISCAL_NOTE} Una factura emitida no se edita: si algo está mal, se anula y se emite otra. Las facturas nunca se borran, así la numeración no tiene huecos.</p>
    </section>

    <section class="panel" aria-labelledby="invoices-export">
      <div class="panel__head"><h2 class="panel__title" id="invoices-export">Exportar facturas</h2></div>
      <p class="panel__sub">Todas las facturas con sus líneas, cobros, saldos y cuentas por cobrar por cliente. Se crea en tu dispositivo. El PDF de cada factura está en su ficha.</p>
      ${exportButtons({ kind: 'invoices', label: 'Exportar facturas' })}
    </section>`}
  `;
}

/**
 * Recordatorios de cobro: las vencidas, de la más atrasada a la menos, cada una con su botón para COPIAR un mensaje.
 * @param {InvoicePosition[]} overdue
 */
function reminderPanel(overdue) {
  if (overdue.length === 0) return '';
  const shown = overdue.slice(0, 8);
  return html`<section class="panel" aria-labelledby="reminders-title">
    <div class="panel__head"><h2 class="panel__title" id="reminders-title">Recordatorios de cobro (${overdue.length})</h2></div>
    <p class="panel__sub">Facturas vencidas que aún te deben. Copia un mensaje listo y envíalo tú por WhatsApp o correo: <strong>ACCONTROL no envía mensajes</strong> por ti.</p>
    <ul class="rows">${shown.map((p) => html`<li class="row-item"><div class="row row--static reminder-row">
      <span class="row__main">
        <span class="row__top"><a class="row__title" href="#/facturas/${p.invoice.id}">${p.invoice.customerName}</a>${p.invoice.isDemo ? demoBadge() : ''}</span>
        <span class="row__meta"><span>${invoiceLabel(p.invoice)}</span><span class="text-alert">${plural(p.daysOverdue, 'día', 'días')} de atraso</span><span>debe ${formatMoney(p.balanceCents)}</span></span>
      </span>
      <span class="row__side">
        <button type="button" class="btn btn--ghost btn--small" data-action="invoice-reminder" data-id="${p.invoice.id}" aria-label="Copiar mensaje de recordatorio de ${invoiceLabel(p.invoice)} para ${p.invoice.customerName}">${icon('copy', 16)}Copiar mensaje de recordatorio</button>
      </span>
    </div></li>`)}</ul>
    ${overdue.length > shown.length ? html`<p class="panel__foot">Y ${overdue.length - shown.length} vencidas más: están en la lista con el filtro «Vencidas».</p>` : ''}
  </section>`;
}

// =============================================================================
// FICHA DE UNA FACTURA
// =============================================================================

function missingPage() {
  return html`
    <a class="back-link" href="#/facturas">${icon('back', 16)}Facturas</a>
    <section class="panel">${emptyState({
      icon: 'receipt',
      title: 'Esa factura no existe',
      text: 'Pudo haberse emitido en otro espacio o desde otra ventana.',
      actions: html`<a class="btn btn--primary" href="#/facturas">Volver a Facturas</a>`,
    })}</section>`;
}

/** @param {Store} store @param {string} id @param {string} today */
function detailPage(store, id, today) {
  const { data } = store.getState();
  const invoice = data.invoices.find((i) => i.id === id);
  if (!invoice) return missingPage();
  const p = invoicePositions({ invoices: [invoice], invoicePayments: data.invoicePayments }, today)[0];
  const label = invoiceLabel(invoice);
  const isVoid = p.status === 'void';
  const products = new Map(data.products.map((x) => [x.id, x.name]));
  const services = new Map(data.services.map((x) => [x.id, x.name]));
  const client = invoice.clientId ? data.clients.find((c) => c.id === invoice.clientId) : undefined;
  const hasStock = invoice.lines.some((l) => l.productId);

  return html`
    <a class="back-link" href="#/facturas">${icon('back', 16)}Facturas</a>

    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">Factura ${label}</h1>
        <p class="page-subtitle">${invoice.customerName}</p>
        <p class="debt__tags debt__tags--start">${invoiceStatusChip(p.status)}${invoice.isDemo ? demoBadge() : ''}</p>
      </div>
      <div class="page-header__actions">
        ${isVoid
          ? ''
          : html`${p.balanceCents > 0 ? html`<button type="button" class="btn btn--primary" data-action="invoice-pay" data-id="${invoice.id}">${icon('plus', 18)}Registrar cobro</button>` : ''}
              ${p.status === 'overdue' ? html`<button type="button" class="btn btn--ghost" data-action="invoice-reminder" data-id="${invoice.id}">${icon('copy', 16)}Copiar mensaje de recordatorio</button>` : ''}
              <button type="button" class="btn btn--ghost" data-action="invoice-edit" data-id="${invoice.id}">Editar datos</button>`}
        <button type="button" class="btn btn--ghost" data-action="export" data-kind="invoice" data-format="pdf" data-id="${invoice.id}">${icon('download', 16)}Descargar PDF</button>
      </div>
    </header>

    ${demoBanner(store.hasDemoData())}

    <section class="panel" aria-label="Resumen de la factura">
      <dl class="kpis">
        <div class="kpi"><dt>Total</dt><dd>${money(p.totalCents)}</dd><dd class="kpi__note">${invoice.taxRateBp > 0 ? `Incluye impuesto de ${formatMoney(p.taxCents)} (${formatTaxPercent(invoice.taxRateBp)} %)` : 'Sin impuesto'}</dd></div>
        <div class="kpi"><dt>Cobrado</dt><dd>${money(p.paidCents)}</dd><dd class="kpi__note">${p.payments.length === 0 ? 'Sin cobros' : plural(p.payments.length, 'cobro', 'cobros')}</dd></div>
        <div class="kpi"><dt>Por cobrar</dt><dd>${isVoid ? '—' : money(p.balanceCents)}</dd><dd class="kpi__note">${isVoid ? 'Factura anulada' : p.balanceCents === 0 ? 'Cobrada por completo' : p.status === 'overdue' ? `${plural(p.daysOverdue, 'día', 'días')} de atraso` : 'Pendiente'}</dd></div>
        <div class="kpi"><dt>Fecha</dt><dd>${formatDate(invoice.issueDate)}</dd><dd class="kpi__note">${dueText(invoice)}</dd></div>
      </dl>
    </section>

    <section class="panel" aria-labelledby="customer-title">
      <div class="panel__head"><h2 class="panel__title" id="customer-title">Cliente</h2></div>
      <dl class="health__details">
        <div class="health__row"><dt>Nombre</dt><dd>${invoice.customerName}</dd></div>
        ${client ? html`<div class="health__row"><dt>Ficha</dt><dd><a href="#/clientes/${client.id}">${clientLabel(client)}</a></dd></div>` : ''}
        ${invoice.customerTaxId ? html`<div class="health__row"><dt>RNC / cédula</dt><dd>${invoice.customerTaxId}</dd></div>` : ''}
        ${invoice.customerContact ? html`<div class="health__row"><dt>Contacto</dt><dd>${invoice.customerContact}</dd></div>` : ''}
        ${invoice.notes ? html`<div class="health__row"><dt>Notas</dt><dd>${invoice.notes}</dd></div>` : ''}
      </dl>
    </section>

    <section class="panel" aria-labelledby="lines-title">
      <div class="panel__head"><h2 class="panel__title" id="lines-title">Detalle</h2></div>
      <table class="invoice-table">
        <thead><tr><th scope="col">Descripción</th><th scope="col">Cant.</th><th scope="col">Precio</th><th scope="col">Total</th></tr></thead>
        <tbody>${invoice.lines.map((l) => html`<tr>
          <td>${l.description}${l.productId && products.has(l.productId) ? html`<br /><a class="muted" href="#/inventario/${l.productId}">${products.get(l.productId)} (inventario)</a>` : ''}${l.serviceId && services.has(l.serviceId) && invoice.clientId ? html`<br /><a class="muted" href="#/clientes/${invoice.clientId}">Servicio: ${services.get(l.serviceId)}</a>` : ''}</td>
          <td>${l.quantity.toLocaleString('en-US')}</td>
          <td>${formatMoney(l.unitCents)}</td>
          <td>${formatMoney(l.quantity * l.unitCents)}</td>
        </tr>`)}</tbody>
      </table>
      <dl class="invoice-totals">
        <div><dt>Subtotal</dt><dd>${formatMoney(p.subtotalCents)}</dd></div>
        <div><dt>Impuesto (${formatTaxPercent(invoice.taxRateBp)} %)</dt><dd>${formatMoney(p.taxCents)}</dd></div>
        <div class="invoice-totals__total"><dt>Total</dt><dd>${formatMoney(p.totalCents)}</dd></div>
      </dl>
      ${invoice.lines.some((l) => l.serviceId) ? html`<p class="panel__foot">${isVoid ? 'Anulada: lo de estos servicios vuelve a contarse como «sin facturar» en el cliente.' : 'Lo facturado de estos servicios ya no se cuenta en el servicio: lo cuenta esta factura (nunca dos veces).'}</p>` : ''}
      ${hasStock ? html`<p class="panel__foot">${isVoid ? 'Al anular la factura, las unidades de inventario volvieron al stock.' : 'Las líneas con producto del inventario ya descontaron esas unidades del stock al emitir la factura.'}</p>` : ''}
    </section>

    <section class="panel" aria-labelledby="payments-title">
      <div class="panel__head">
        <h2 class="panel__title" id="payments-title">Cobros (${p.payments.length})</h2>
        ${!isVoid && p.balanceCents > 0 ? html`<button type="button" class="link-btn" data-action="invoice-pay" data-id="${invoice.id}">Registrar cobro</button>` : ''}
      </div>
      ${p.payments.length === 0
        ? html`<p class="muted">${isVoid ? 'Esta factura se anuló sin cobros.' : 'Todavía no has cobrado nada de esta factura.'}</p>`
        : html`<ul class="rows">${p.payments.map((pay) => html`<li class="row-item"><div class="row row--static">
            <span class="row__main">
              <span class="row__top"><span class="tag tag--income">Cobro</span>${pay.isDemo ? demoBadge() : ''}</span>
              <span class="row__title">${formatDate(pay.date)} · ${pay.time}</span>
              ${pay.note ? html`<span class="row__meta"><span>${pay.note}</span></span>` : ''}
            </span>
            <span class="row__side">
              <span class="row__amount row__amount--income">${formatMoney(pay.amountCents)}</span>
              <button type="button" class="btn btn--danger-ghost btn--small" data-action="invoice-payment-delete" data-id="${pay.id}" aria-label="Eliminar este cobro">${icon('trash', 16)}Eliminar</button>
            </span>
          </div></li>`)}</ul>
          <p class="panel__foot">Cada cobro se anotó también como un ingreso en Movimientos; al eliminarlo se quita ese ingreso. Un cobro no se edita: elimínalo y regístralo de nuevo.</p>`}
    </section>

    <section class="panel" aria-labelledby="void-title">
      <h2 class="panel__title" id="void-title">Anular factura</h2>
      ${isVoid
        ? html`<p class="muted">Anulada el ${formatDate(/** @type {string} */ (invoice.voidedAt).slice(0, 10))}. Se conserva con su número para que la numeración no tenga huecos, pero ya no cuenta como factura vigente.</p>`
        : html`<p class="muted">Si algo está mal (cliente, líneas, precios o impuesto), anula esta factura y emite otra. ${p.payments.length > 0 ? 'Primero elimina sus cobros.' : hasStock ? 'Las unidades de inventario vuelven al stock.' : ''}</p>
          <div class="actions actions--start"><button type="button" class="btn btn--danger-ghost" data-action="invoice-void" data-id="${invoice.id}">Anular factura</button></div>`}
    </section>

    <p class="muted">${NOT_FISCAL_NOTE}</p>
  `;
}
