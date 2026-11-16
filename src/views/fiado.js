// @ts-check
// =============================================================================
// FIADO — QUIÉN ME DEBE (0.16.3, espacios Emprendedor y Empresa)
// Lista de clientes que te deben (lo fiado menos lo abonado), con buscador, y la ficha de cada uno con su estado de cuenta:
// fiados y abonos en orden, con el saldo después de cada uno. Desde aquí se fía, se cobra un abono y se copia el estado de
// cuenta para enviarlo por WhatsApp (ACCONTROL no envía mensajes).
//
// Todos los números salen de domain/fiado.js. Cada fiado es una factura interna y cada abono, uno o varios cobros con su
// ingreso: no hay datos aparte. Los botones son acciones comunes (app/actions.js) que abren views/fiado-forms.js.
// =============================================================================

import { formatDate, monthKeyOf, monthLabel, plural } from '../domain/dates.js';
import { creditText, customerLedger, customerLedgers, fiadoSummary, searchLedgers } from '../domain/fiado.js';
import { invoiceLabel } from '../domain/invoices.js';
import { formatMoney } from '../domain/money.js';
import { demoBadge, demoBanner, emptyState, financeTabs, money } from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/fiado.js').CustomerLedger} CustomerLedger */

/** Estado propio de la lista (se conserva mientras no recargues la página). */
const view = {
  /** @type {'owing' | 'all'} */
  filter: 'owing',
  query: '',
};

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderFiado(store, ctx) {
  if (!store.fiadoEnabled()) return { html: notAvailablePage() };
  const today = store.today();
  const key = ctx.params[0];
  if (key) return { html: detailPage(store, key, today) };
  const list = listPage(store, today);
  return {
    html: list.html,
    mount(root, signal) {
      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (el?.dataset.action !== 'fiado-filter') return;
          const value = el.dataset.value;
          if (value !== 'owing' && value !== 'all') return;
          view.filter = value;
          ctx.rerender();
        },
        { signal },
      );
      // La búsqueda solo redibuja la lista, para no perder el cursor al escribir.
      const search = root.querySelector('#fiado-search');
      const results = root.querySelector('#fiado-results');
      if (search instanceof HTMLInputElement && results instanceof HTMLElement) {
        search.addEventListener('input', () => { view.query = search.value; setHtml(results, list.results()); }, { signal });
      }
    },
  };
}

function notAvailablePage() {
  return html`
    <header class="page-header"><div><h1 class="page-title">Fiado</h1><p class="page-subtitle">Quién te debe.</p></div></header>
    <section class="panel">${emptyState({
      icon: 'user',
      title: 'El fiado es parte de los espacios Emprendedor y Empresa',
      text: 'Abre un espacio Emprendedor o Empresa para anotar lo que fías a tus clientes y los abonos que te hacen.',
      actions: html`<button type="button" class="btn btn--primary" data-action="workspace-menu">Ver mis espacios</button>
        <a class="btn btn--ghost" href="#/finanzas">Volver a Finanzas</a>`,
    })}</section>`;
}

/** Enlace a la ficha de un cliente (la clave puede llevar espacios y tildes). @param {string} key */
export const fiadoHref = (key) => `#/fiado/${encodeURIComponent(key)}`;

// =============================================================================
// LISTA
// =============================================================================

/** @param {Store} store @param {string} today */
function listPage(store, today) {
  const { data } = store.getState();
  const ledgers = customerLedgers(data, today);
  const monthKey = monthKeyOf(today);
  const summary = fiadoSummary(ledgers, monthKey);
  const owingCount = ledgers.filter((l) => l.balanceCents > 0).length;

  /** @param {CustomerLedger} l */
  const row = (l) => html`<li class="row-item">
    <a class="row" href="${fiadoHref(l.key)}" aria-label="${l.name}. Debe ${formatMoney(l.balanceCents)}. Ver estado de cuenta">
      <span class="row__main">
        <span class="row__top"><span class="row__title">${l.name}</span>${l.isDemo ? demoBadge() : ''}${l.overdueCents > 0 ? html`<span class="chip chip--alert">Vencido</span>` : ''}</span>
        <span class="row__meta">
          ${l.balanceCents > 0 ? html`<span>Debe desde el ${formatDate(l.oldestOpenDate)}</span>` : html`<span>Al día</span>`}
          <span>${l.lastPaymentDate ? `Último abono: ${formatDate(l.lastPaymentDate)}` : 'Sin abonos todavía'}</span>
          ${l.contact ? html`<span>${l.contact}</span>` : ''}
        </span>
      </span>
      <span class="row__side"><span class="row__amount${l.balanceCents > 0 ? '' : ' row__amount--income'}">${formatMoney(l.balanceCents)}</span><span class="row__time">${l.balanceCents > 0 ? 'debe' : 'al día'}</span></span>
    </a>
  </li>`;

  const results = () => {
    const base = view.filter === 'owing' ? ledgers.filter((l) => l.balanceCents > 0) : ledgers;
    const found = searchLedgers(base, view.query);
    if (found.length > 0) return html`<p class="muted count-line" role="status">${plural(found.length, 'cliente', 'clientes')}</p><ul class="rows">${found.map(row)}</ul>`;
    if (view.query.trim()) return html`<p class="muted empty-line" role="status">Nadie coincide con «${view.query.trim()}»${view.filter === 'owing' ? ' entre los que deben' : ''}.</p>`;
    return html`<p class="muted empty-line" role="status">${view.filter === 'owing' ? 'Nadie te debe en este momento. ¡Todos al día!' : 'Todavía no has fiado a nadie.'}</p>`;
  };

  const page = html`
    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Quién te debe: lo que fiaste y los abonos que te han hecho.</p>
      </div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--primary" data-action="credit-new">${icon('plus', 18)}Fiar</button>
      </div>
    </header>

    ${financeTabs('fiado', store)}
    ${demoBanner(store.hasDemoData())}

    ${ledgers.length === 0
      ? html`<section class="panel">${emptyState({
          icon: 'user',
          title: 'Nadie te debe por ahora',
          text: 'Cuando un cliente se lleve algo y te pague después, toca «Fiar» y anota su nombre y cuánto. Aquí verás cuánto te debe cada uno, le cobras abonos y le copias su estado de cuenta para enviárselo por WhatsApp. El cliente no necesita usar ACCONTROL.',
          actions: html`<button type="button" class="btn btn--primary" data-action="credit-new">Fiar</button>`,
        })}</section>`
      : html`
    <section class="panel panel--summary" aria-label="Resumen del fiado">
      <dl class="kpis">
        <div class="kpi"><dt>Te deben</dt><dd>${money(summary.totalCents)}</dd><dd class="kpi__note">${summary.customers === 0 ? 'Todos al día' : plural(summary.customers, 'cliente', 'clientes')}</dd></div>
        <div class="kpi"><dt>Abonado en ${monthLabel(monthKey)}</dt><dd>${money(summary.collectedThisMonthCents)}</dd><dd class="kpi__note">Se anotó como ingreso</dd></div>
        ${summary.overdueCents > 0 ? html`<div class="kpi"><dt>Vencido</dt><dd>${money(summary.overdueCents, { tone: 'alert' })}</dd><dd class="kpi__note">Con fecha de pago pasada</dd></div>` : ''}
      </dl>
      <p class="panel__foot">Cada fiado es una factura interna (F-0001…) y cada abono se anota como un ingreso en Movimientos. Lo que te deben no es dinero disponible hasta que te lo pagan.</p>
    </section>

    <section class="panel" aria-labelledby="fiado-title">
      <div class="panel__head"><h2 class="panel__title" id="fiado-title">Clientes</h2></div>
      <div class="toolbar">
        <div class="filter-group" role="group" aria-label="Filtrar clientes">
          <button type="button" class="filter-chip" data-action="fiado-filter" data-value="owing" aria-pressed="${view.filter === 'owing' ? 'true' : 'false'}">Deben (${owingCount})</button>
          <button type="button" class="filter-chip" data-action="fiado-filter" data-value="all" aria-pressed="${view.filter === 'all' ? 'true' : 'false'}">Todos (${ledgers.length})</button>
        </div>
        <div class="search">
          <label for="fiado-search" class="sr-only">Buscar cliente por nombre o teléfono</label>
          <input id="fiado-search" class="input" type="search" placeholder="Buscar por nombre o teléfono…" value="${view.query}" autocomplete="off" maxlength="80" />
        </div>
      </div>
      <div id="fiado-results">${results()}</div>
    </section>`}
  `;
  return { html: page, results };
}

// =============================================================================
// FICHA DE UN CLIENTE (estado de cuenta)
// =============================================================================

/** @param {Store} store @param {string} key @param {string} today */
function detailPage(store, key, today) {
  const ledger = customerLedger(store.getState().data, key, today);
  if (!ledger) {
    return html`
      <a class="back-link" href="#/fiado">${icon('back', 16)}Fiado</a>
      <section class="panel">${emptyState({
        icon: 'user',
        title: 'Ese cliente no tiene fiados',
        text: 'Pudo haberse anulado su último fiado, o se anotó en otro espacio.',
        actions: html`<a class="btn btn--primary" href="#/fiado">Volver a Fiado</a>`,
      })}</section>`;
  }
  const newestFirst = [...ledger.events].reverse();
  return html`
    <a class="back-link" href="#/fiado">${icon('back', 16)}Fiado</a>

    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">${ledger.name}</h1>
        <p class="page-subtitle">${ledger.contact || 'Sin teléfono anotado'}</p>
        ${ledger.isDemo ? html`<p class="debt__tags debt__tags--start">${demoBadge()}</p>` : ''}
      </div>
      <div class="page-header__actions">
        ${ledger.balanceCents > 0 ? html`<button type="button" class="btn btn--primary" data-action="credit-pay" data-key="${ledger.key}">${icon('plus', 18)}Cobrar abono</button>` : ''}
        <button type="button" class="btn btn--ghost" data-action="credit-new" data-name="${ledger.name}" data-contact="${ledger.contact}">Fiar más</button>
        <button type="button" class="btn btn--ghost" data-action="credit-statement" data-key="${ledger.key}">${icon('copy', 16)}Copiar estado de cuenta</button>
      </div>
    </header>

    <section class="panel panel--summary" aria-label="Lo que debe ${ledger.name}">
      <dl class="kpis">
        <div class="kpi"><dt>Debe</dt><dd>${money(ledger.balanceCents, { tone: ledger.overdueCents > 0 ? 'alert' : 'none' })}</dd><dd class="kpi__note">${ledger.balanceCents > 0 ? `desde el ${formatDate(ledger.oldestOpenDate)}` : 'Está al día'}</dd></div>
        <div class="kpi"><dt>Fiado en total</dt><dd>${money(ledger.billedCents)}</dd><dd class="kpi__note">${plural(ledger.positions.length, 'fiado', 'fiados')}</dd></div>
        <div class="kpi"><dt>Abonado en total</dt><dd>${money(ledger.paidCents)}</dd><dd class="kpi__note">${ledger.lastPaymentDate ? `último, el ${formatDate(ledger.lastPaymentDate)}` : 'Sin abonos todavía'}</dd></div>
      </dl>
    </section>

    <section class="panel" aria-labelledby="statement-title">
      <div class="panel__head"><h2 class="panel__title" id="statement-title">Estado de cuenta</h2></div>
      <ul class="rows">${newestFirst.map((e) => html`<li class="row-item"><div class="row row--static">
        <span class="row__main">
          <span class="row__title">${e.kind === 'credit' ? html`Fiado: <a href="#/facturas/${e.invoice.id}">${creditText(e.invoice)}</a>` : html`Abono${e.payment?.note ? ` · ${e.payment.note}` : ''}`}</span>
          <span class="row__meta"><span>${formatDate(e.date)}</span>${e.kind === 'payment' ? html`<span>a la factura <a href="#/facturas/${e.invoice.id}">${invoiceLabel(e.invoice)}</a></span>` : ''}<span>Después: debe ${formatMoney(e.balanceAfterCents)}</span></span>
        </span>
        <span class="row__side"><span class="row__amount${e.kind === 'payment' ? ' row__amount--income' : ''}">${e.kind === 'payment' ? '−' : '+'}${formatMoney(e.amountCents)}</span><span class="row__time">${e.kind === 'payment' ? 'abono' : 'fiado'}</span></span>
      </div></li>`)}</ul>
      <p class="panel__foot">Un abono se aplica primero a lo más viejo. Para anular un fiado, ábrelo (F-0001…) y anúlalo en Facturas; para borrar un abono, bórralo desde su factura. «Copiar estado de cuenta» prepara un mensaje que envías tú: ACCONTROL no envía mensajes.</p>
    </section>
  `;
}
