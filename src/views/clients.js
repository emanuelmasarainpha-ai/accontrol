// @ts-check
// =============================================================================
// CLIENTES (módulo Freelancer, documento maestro §9)
// Lista de clientes con lo que te han pagado, los gastos que les cargaste (rentabilidad real: neto y margen) y lo que te
// deben, el ranking (más rentable, más recurrente, mayor deuda), los servicios más vendidos y, al tocar un cliente, su
// ficha: servicios con su estado, pagos y gastos.
//
// Todos los números salen de domain/freelance.js. Los botones (Nuevo cliente, Registrar pago, Editar...) son acciones
// comunes (app/actions.js). Desde la 0.14.5 la ficha muestra sus facturas y cada servicio lo facturado (regla de una sola
// fuente: lo facturado lo cuenta la factura). La app NO envía recordatorios: solo los copia (views/invoice-forms.js).
// =============================================================================

import {
  SERVICE_STATUSES, SERVICE_STATUS_LABELS, clientFullName, clientLabel, clientUsage, sortServices,
} from '../domain/clients.js';
import { formatDate, plural } from '../domain/dates.js';
import {
  CONCENTRATION_THRESHOLD, RANGE_LABELS, clientConcentration, clientCosts, clientRanking, clientSummaries, paidByService, receivables,
  summarizeService, topServices,
} from '../domain/freelance.js';
import { billedByService, invoiceLabel, invoicePositions } from '../domain/invoices.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { compareNewestFirst } from '../domain/movements.js';
import { demoBadge, demoBanner, emptyState, exportButtons, financeTabs, money, movementRow, progress } from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { invoiceStatusChip } from './invoices.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/freelance.js').ClientSummary} ClientSummary */
/** @typedef {import('../domain/types.js').ServiceStatus} ServiceStatus */

/** Estado propio de esta pantalla (se conserva mientras no recargues la página). */
const view = {
  /** @type {import('../domain/freelance.js').Range} */
  range: 'year',
};

/** @param {ServiceStatus} status */
export function statusChip(status) {
  const cls = status === 'done' ? 'chip--good' : status === 'in_progress' ? 'chip--progress' : '';
  return html`<span class="chip ${cls}">${SERVICE_STATUS_LABELS[status]}</span>`;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderClients(store, ctx) {
  const today = store.today();
  const detailId = ctx.params[0];

  if (!store.clientsEnabled()) return { html: notAvailablePage(store) };
  const page = detailId ? detailPage(store, detailId, today) : listPage(store, today);

  return {
    html: page,
    mount(root, signal) {
      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (el?.dataset.action !== 'range') return;
          const value = el.dataset.value;
          if (value === 'year' || value === 'all') {
            view.range = value;
            ctx.rerender();
          }
        },
        { signal },
      );
      // Cambiar el estado de un servicio desde su ficha.
      root.addEventListener(
        'change',
        async (event) => {
          const select = event.target;
          if (!(select instanceof HTMLSelectElement) || select.dataset.serviceStatus === undefined) return;
          const result = await store.setServiceStatus(select.dataset.id ?? '', select.value);
          if (result.ok) toast(`Estado: ${SERVICE_STATUS_LABELS[result.service.status]}.`);
          else {
            toast(result.errors.form ?? 'No se pudo cambiar el estado.', 'error');
            ctx.rerender();
          }
        },
        { signal },
      );
    },
  };
}

// =============================================================================
// NO DISPONIBLE (espacio que no es Freelancer y sin clientes)
// =============================================================================

/** @param {Store} store */
function notAvailablePage(store) {
  const workspace = store.activeWorkspace();
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Clientes</h1>
        <p class="page-subtitle">Cobros y servicios por cliente.</p>
      </div>
    </header>
    <section class="panel">${emptyState({
      icon: 'user',
      title: 'Los clientes son parte del espacio Freelancer',
      text: `${workspace ? `«${workspace.name}» no es un espacio Freelancer. ` : ''}Crea (o abre) un espacio Freelancer para llevar tus clientes, los servicios que les vendes, lo que te han pagado y lo que te deben.`,
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
  const range = view.range;
  const rows = clientSummaries(data, { range, today });
  const ranking = clientRanking(rows);
  const costs = clientCosts(data, { range, today });
  const owed = receivables(data, today);
  const concentration = clientConcentration(data, today);
  const services = topServices(data, today).slice(0, 5);
  const collected = rows.reduce((sum, r) => sum + r.incomeCents, 0);
  const payingClients = rows.filter((r) => r.incomeCents > 0).length;
  const clientNet = collected - costs.assignedCents;
  const inProgress = data.services.filter((s) => s.status === 'in_progress').length;
  const active = rows.filter((r) => !r.client.archived);
  const archived = rows.filter((r) => r.client.archived);

  /** @param {ClientSummary} r */
  const clientRow = (r) => {
    const c = r.client;
    return html`<li class="row-item">
      <a class="client-row${c.archived ? ' client-row--archived' : ''}" href="#/clientes/${c.id}" aria-label="${clientLabel(c)}. Ver ficha">
        <span class="client-row__main">
          <span class="client-row__top">
            <span class="client-row__name">${clientFullName(c)}</span>
            ${c.archived ? html`<span class="chip">Archivado</span>` : ''}
            ${c.isDemo ? demoBadge() : ''}
          </span>
          ${c.company ? html`<span class="client-row__sub">${c.company}</span>` : ''}
          <span class="client-row__meta">
            <span>${plural(r.payments, 'pago', 'pagos')}</span>
            <span>${plural(r.services.total, 'servicio', 'servicios')}</span>
            ${r.lastPaymentDate ? html`<span>Último pago: ${formatDate(r.lastPaymentDate)}</span>` : html`<span>Sin pagos todavía</span>`}
          </span>
          ${r.expenseCount > 0
            ? html`<span class="client-row__meta">
                <span>Gastos cargados ${formatMoney(r.expenseCents)}</span>
                <span>Neto ${formatMoney(r.netCents)}${r.marginPercent === null ? '' : ` · margen ${formatPercent(Math.round(r.marginPercent))}`}</span>
                ${r.netCents < 0 ? html`<span class="chip chip--warn">En pérdida</span>` : ''}
              </span>`
            : ''}
          ${r.incomeCents > 0 ? progress(r.sharePercent, `${clientFullName(c)}: ${formatPercent(r.sharePercent)} de lo cobrado a clientes`) : ''}
        </span>
        <span class="client-row__side">
          <span class="client-row__amount">${formatMoney(r.incomeCents)}</span>
          <span class="client-row__label">${RANGE_LABELS[range].toLowerCase()}</span>
          ${r.owedCents > 0 ? html`<span class="client-row__owed">Por cobrar ${formatMoney(r.owedCents)}</span>` : ''}
        </span>
      </a>
    </li>`;
  };

  /** @param {string} label @param {ClientSummary | null} r @param {(r: ClientSummary) => string} detail @param {string} empty */
  const tile = (label, r, detail, empty) => html`<li class="rank">
    <p class="rank__label">${label}</p>
    ${r
      ? html`<p class="rank__name"><a href="#/clientes/${r.client.id}">${clientFullName(r.client)}</a></p><p class="rank__detail">${detail(r)}</p>`
      : html`<p class="rank__name rank__name--none">—</p><p class="rank__detail">${empty}</p>`}
  </li>`;

  return html`
    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Tus clientes, lo que te pagan y lo que te deben.</p>
      </div>
      <button type="button" class="btn btn--primary" data-action="new-client" data-tour="clients-new">${icon('plus', 18)}Nuevo cliente</button>
    </header>

    ${financeTabs('clientes', store)}
    ${demoBanner(store.hasDemoData())}

    ${data.clients.length === 0
      ? html`<section class="panel">${emptyState({
          icon: 'user',
          title: 'Tu lista de clientes empieza aquí',
          text: 'Registra a quién le vendes tus servicios. Al cobrar, vincula el ingreso a su cliente y ACCONTROL te muestra cuánto te paga cada uno, quién te debe y de quién dependes más.',
          actions: html`<button type="button" class="btn btn--primary" data-action="new-client">Nuevo cliente</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    <div class="toolbar">
      <div class="filter-group" role="group" aria-label="Período">
        ${/** @type {const} */ (['year', 'all']).map(
          (id) => html`<button type="button" class="filter-chip" data-action="range" data-value="${id}" aria-pressed="${range === id ? 'true' : 'false'}">${RANGE_LABELS[id]}</button>`,
        )}
      </div>
    </div>

    <section class="panel panel--summary" aria-label="Resumen de clientes">
      <dl class="kpis">
        <div class="kpi"><dt>Cobrado a clientes</dt><dd>${money(collected)}</dd><dd class="kpi__note">${RANGE_LABELS[range]}</dd></div>
        <div class="kpi"><dt>Por cobrar</dt><dd>${money(owed.totalCents)}</dd><dd class="kpi__note">${owed.rows.length === 0 ? 'Nada pendiente' : plural(owed.rows.length, 'servicio con saldo', 'servicios con saldo')}</dd></div>
        <div class="kpi"><dt>Clientes que pagaron</dt><dd>${payingClients}</dd><dd class="kpi__note">De ${plural(active.length, 'cliente activo', 'clientes activos')}</dd></div>
        <div class="kpi"><dt>Servicios en proceso</dt><dd>${inProgress}</dd><dd class="kpi__note">${plural(data.services.length, 'servicio en total', 'servicios en total')}</dd></div>
      </dl>
      <p class="panel__foot">«Cobrado» es la suma de los ingresos vinculados a cada cliente. «Por cobrar» es lo que falta pagar de los servicios En proceso y Finalizados. Son cálculos con reglas fijas, no inteligencia artificial.</p>
    </section>

    ${concentration
      ? html`<p class="notice" role="status">${icon('info', 18)}<span>«${clientFullName(concentration.client)}» te pagó el ${Math.round(concentration.percent)} % de tus ingresos de los últimos 12 meses (${plural(concentration.payments, 'pago', 'pagos')}). Depender tanto de un solo cliente es un riesgo: si se va, tus ingresos caen de golpe. El aviso aparece desde ${CONCENTRATION_THRESHOLD} %.</span></p>`
      : ''}

    ${ranking.atLoss.length > 0
      ? html`<p class="notice" role="status">${icon('info', 18)}<span>${ranking.atLoss.length === 1 ? 'Un cliente tiene' : `${ranking.atLoss.length} clientes tienen`} más gastos cargados que pagos en este período: ${ranking.atLoss.slice(0, 3).map((r, i) => html`${i > 0 ? ', ' : ''}<a href="#/clientes/${r.client.id}">${clientFullName(r.client)}</a> (neto ${formatMoney(r.netCents)})`)}${ranking.atLoss.length > 3 ? ' y más' : ''}. Si todavía no cobras, es normal; si ya cobraste, revisa si te conviene.</span></p>`
      : ''}

    <section class="panel" aria-labelledby="profit-title">
      <div class="panel__head"><h2 class="panel__title" id="profit-title">Rentabilidad de clientes</h2></div>
      <dl class="kpis">
        <div class="kpi"><dt>Gastos cargados a clientes</dt><dd>${money(costs.assignedCents)}</dd><dd class="kpi__note">${RANGE_LABELS[range]}</dd></div>
        <div class="kpi"><dt>Neto de clientes</dt><dd>${money(clientNet, { tone: 'auto' })}</dd><dd class="kpi__note">Cobrado − gastos cargados${collected > 0 ? ` · margen ${formatPercent(Math.round((clientNet / collected) * 100))}` : ''}</dd></div>
        <div class="kpi"><dt>Gastos generales</dt><dd>${money(costs.generalCents)}</dd><dd class="kpi__note">Sin cliente: no se reparten</dd></div>
        <div class="kpi"><dt>Clientes en pérdida</dt><dd>${ranking.atLoss.length}</dd><dd class="kpi__note">${ranking.atLoss.length === 0 ? 'Ninguno' : 'Gastos mayores a lo cobrado'}</dd></div>
      </dl>
      <p class="panel__foot">${costs.assignedCents === 0
        ? 'Aún no cargaste gastos a ningún cliente. Al registrar un gasto, elige «Cargar a un cliente» si fue para trabajarle (una licencia, un viaje, materiales): así ves cuánto te deja de verdad cada uno.'
        : `Gastos del período: ${formatMoney(costs.totalCents)} = ${formatMoney(costs.assignedCents)} cargados a clientes + ${formatMoney(costs.generalCents)} generales. Solo cuentan los gastos que tú le cargas a un cliente; los generales no se reparten entre ellos.`}</p>
    </section>

    <section class="panel" aria-labelledby="rank-title">
      <div class="panel__head"><h2 class="panel__title" id="rank-title">Ranking de clientes</h2></div>
      <ul class="rank-grid">
        ${tile('Más rentable', ranking.mostProfitable, (r) => (r.expenseCents > 0 ? `Te deja ${formatMoney(r.netCents)} (${formatMoney(r.incomeCents)} cobrados − ${formatMoney(r.expenseCents)} en gastos)` : `${formatMoney(r.incomeCents)} cobrados (${formatPercent(r.sharePercent)} de lo cobrado a clientes)`), 'Aún no hay un cliente que te deje beneficio en este período.')}
        ${ranking.topPayer && ranking.mostProfitable && ranking.topPayer.client.id !== ranking.mostProfitable.client.id
          ? tile('El que más paga', ranking.topPayer, (r) => `${formatMoney(r.incomeCents)} cobrados, pero con ${formatMoney(r.expenseCents)} en gastos te deja ${formatMoney(r.netCents)}`, '')
          : ''}
        ${tile('Más recurrente', ranking.mostRecurrent, (r) => `Pagó en ${plural(r.activeMonths, 'mes distinto', 'meses distintos')} · ${plural(r.payments, 'pago', 'pagos')}`, 'Aún no hay pagos de clientes en este período.')}
        ${tile('Mayor deuda pendiente', ranking.mostOwing, (r) => `Te debe ${formatMoney(r.owedCents)}`, 'Nadie te debe nada ahora.')}
      </ul>
      <p class="panel__foot">«Más rentable» es el cliente que más te deja: lo cobrado menos los gastos que le cargaste (si no cargas gastos a clientes, es el que más te ha pagado). «Más recurrente» es el que pagó en más meses distintos.</p>
    </section>

    <section class="panel" aria-labelledby="clients-title">
      <div class="panel__head"><h2 class="panel__title" id="clients-title">Clientes (${active.length})</h2></div>
      ${active.length === 0 ? html`<p class="muted">Todos tus clientes están archivados.</p>` : html`<ul class="rows">${active.map(clientRow)}</ul>`}
      ${archived.length > 0
        ? html`<details class="table-view"><summary>Archivados (${archived.length})</summary><ul class="rows">${archived.map(clientRow)}</ul></details>`
        : ''}
    </section>

    ${services.length > 0
      ? html`<section class="panel" aria-labelledby="top-services-title">
          <div class="panel__head"><h2 class="panel__title" id="top-services-title">Servicios más vendidos</h2></div>
          <ul class="rows">${services.map(
            (s) => html`<li class="row-item"><div class="row row--static">
              <span class="row__main"><span class="row__title">${s.name}</span><span class="row__meta"><span>${plural(s.count, 'vez', 'veces')}</span><span>Acordado ${formatMoney(s.agreedCents)}</span></span></span>
              <span class="row__side"><span class="row__amount row__amount--income">${formatMoney(s.paidCents)}</span><span class="row__time">cobrado</span></span>
            </div></li>`,
          )}</ul>
          <p class="panel__foot">Se agrupan por nombre del servicio (sin contar los cancelados).</p>
        </section>`
      : ''}

    <section class="panel" aria-labelledby="clients-export">
      <div class="panel__head"><h2 class="panel__title" id="clients-export">Exportar clientes</h2></div>
      <p class="panel__sub">Cada cliente con lo cobrado, los gastos que le cargaste, su neto, lo que falta por cobrar y sus servicios. Se crea en tu dispositivo.</p>
      ${exportButtons({ kind: 'clients', label: 'Exportar clientes' })}
    </section>`}
  `;
}

// =============================================================================
// FICHA DE UN CLIENTE
// =============================================================================

function missingPage() {
  return html`
    <a class="back-link" href="#/clientes">${icon('back', 16)}Clientes</a>
    <section class="panel">${emptyState({
      icon: 'user',
      title: 'Ese cliente ya no existe',
      text: 'Pudo haberse borrado desde otra ventana.',
      actions: html`<a class="btn btn--primary" href="#/clientes">Volver a Clientes</a>`,
    })}</section>`;
}

/** @param {Store} store @param {string} id @param {string} today */
function detailPage(store, id, today) {
  const { data } = store.getState();
  const client = data.clients.find((c) => c.id === id);
  if (!client) return missingPage();

  const summary = /** @type {ClientSummary} */ (clientSummaries(data, { range: 'all', today }).find((r) => r.client.id === id));
  const usage = clientUsage(data, id);
  const paid = paidByService(data.movements, today);
  const billed = billedByService(data.invoices);
  const services = sortServices(data.services.filter((s) => s.clientId === id)).map((s) => summarizeService(s, paid, billed));
  // Facturas de este cliente (0.14.5) y, para la lista de pagos, qué ingreso es el cobro de qué factura.
  const invoices = invoicePositions({ invoices: data.invoices.filter((i) => i.clientId === id), invoicePayments: data.invoicePayments }, today);
  const invoiceOfMovement = new Map(data.invoicePayments.map((p) => [p.movementId, data.invoices.find((i) => i.id === p.invoiceId)]));
  const canInvoice = store.invoicesEnabled() && !client.archived;
  const payments = data.movements.filter((m) => m.type === 'income' && m.clientId === id).sort(compareNewestFirst);
  const costRows = data.movements.filter((m) => m.type === 'expense' && m.clientId === id).sort(compareNewestFirst);
  const costTotal = costRows.reduce((sum, m) => sum + m.amountCents, 0);
  const serviceName = new Map(data.services.map((s) => [s.id, s.name]));
  const contact = [
    ['Correo', client.email], ['Teléfono', client.phone], ['País', client.country],
  ].filter(([, value]) => value !== '');

  return html`
    <a class="back-link" href="#/clientes">${icon('back', 16)}Clientes</a>

    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">${clientFullName(client)}</h1>
        ${client.company ? html`<p class="page-subtitle">${client.company}</p>` : ''}
        <p class="debt__tags debt__tags--start">${client.archived ? html`<span class="chip">Archivado</span>` : ''}${client.isDemo ? demoBadge() : ''}</p>
      </div>
      <div class="page-header__actions">
        ${client.archived ? '' : html`<button type="button" class="btn btn--primary" data-action="client-pay" data-client="${client.id}">${icon('plus', 18)}Registrar pago</button>`}
        ${client.archived ? '' : html`<button type="button" class="btn btn--ghost" data-action="client-expense" data-client="${client.id}">Registrar gasto</button>`}
        ${canInvoice ? html`<button type="button" class="btn btn--ghost" data-action="new-invoice" data-client-id="${client.id}">Nueva factura</button>` : ''}
        <button type="button" class="btn btn--ghost" data-action="new-service" data-client="${client.id}">Nuevo servicio</button>
        <button type="button" class="btn btn--ghost" data-action="client-edit" data-id="${client.id}">Editar</button>
      </div>
    </header>

    ${demoBanner(store.hasDemoData())}

    <section class="panel" aria-label="Resumen del cliente">
      <dl class="kpis">
        <div class="kpi"><dt>Cobrado</dt><dd>${money(summary.incomeCents)}</dd><dd class="kpi__note">${plural(summary.payments, 'pago', 'pagos')} en total</dd></div>
        <div class="kpi"><dt>Por cobrar</dt><dd>${money(summary.owedCents)}</dd><dd class="kpi__note">${summary.owedCents === 0 ? 'Nada pendiente' : summary.invoiceOwedCents > 0 ? `${formatMoney(summary.invoiceOwedCents)} en facturas · ${formatMoney(summary.owedCents - summary.invoiceOwedCents)} sin facturar` : 'De servicios En proceso y Finalizados (sin facturar)'}</dd></div>
        <div class="kpi"><dt>Servicios</dt><dd>${summary.services.total}</dd><dd class="kpi__note">${summary.services.inProgress} en proceso · ${summary.services.done} finalizados</dd></div>
        <div class="kpi"><dt>Último pago</dt><dd>${summary.lastPaymentDate ? formatDate(summary.lastPaymentDate) : '—'}</dd><dd class="kpi__note">${summary.activeMonths > 0 ? `Pagó en ${plural(summary.activeMonths, 'mes', 'meses')}` : 'Sin pagos todavía'}</dd></div>
      </dl>
      <dl class="kpis" aria-label="Rentabilidad del cliente">
        <div class="kpi"><dt>Gastos cargados</dt><dd>${money(summary.expenseCents)}</dd><dd class="kpi__note">${plural(summary.expenseCount, 'gasto', 'gastos')} en total</dd></div>
        <div class="kpi"><dt>Neto</dt><dd>${money(summary.netCents, { tone: 'auto' })}</dd><dd class="kpi__note">Cobrado − gastos${summary.netCents < 0 ? ' · En pérdida' : ''}</dd></div>
        <div class="kpi"><dt>Margen</dt><dd>${summary.marginPercent === null ? '—' : formatPercent(Math.round(summary.marginPercent))}</dd><dd class="kpi__note">${summary.marginPercent === null ? 'Sin cobros todavía' : 'Del neto sobre lo cobrado'}</dd></div>
      </dl>
      ${contact.length > 0 || client.notes
        ? html`<dl class="debt__facts debt__facts--wide">${contact.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>
            ${client.notes ? html`<p class="muted">Notas: ${client.notes}</p>` : ''}`
        : ''}
    </section>

    <section class="panel" aria-labelledby="services-title">
      <div class="panel__head">
        <h2 class="panel__title" id="services-title">Servicios (${services.length})</h2>
        <button type="button" class="link-btn" data-action="new-service" data-client="${client.id}">Nuevo servicio</button>
      </div>
      ${services.length === 0
        ? html`<p class="muted">Todavía no le has registrado servicios. Un servicio es lo que le vendes: su precio, su estado y lo que va pagando.</p>`
        : html`<ul class="service-list">${services.map(
            ({ service: s, paidCents, billedCents, owedCents, progressPercent }) => html`<li class="service">
              <div class="service__head">
                <div>
                  <h3 class="service__name">${s.name}</h3>
                  <p class="service__sub">${s.startDate ? `Desde ${formatDate(s.startDate)}` : 'Sin fecha de inicio'}${s.estimatedDays ? ` · ${plural(s.estimatedDays, 'día', 'días')} estimados` : ''}</p>
                </div>
                <div class="debt__tags">${statusChip(s.status)}${s.isDemo ? demoBadge() : ''}</div>
              </div>
              ${progress(progressPercent, `Cobrado de ${s.name}`)}
              <dl class="debt__facts">
                <div><dt>Precio</dt><dd>${formatMoney(s.priceCents)}</dd></div>
                <div><dt>Cobrado directo</dt><dd>${formatMoney(paidCents)}${paidCents > s.priceCents ? html` <span class="debt__when">(de más: ${formatMoney(paidCents - s.priceCents)})</span>` : ''}</dd></div>
                ${billedCents > 0 ? html`<div><dt>Facturado</dt><dd>${formatMoney(billedCents)} <span class="debt__when">(lo cuenta su factura)</span></dd></div>` : ''}
                <div><dt>Por cobrar sin facturar</dt><dd class="${owedCents > 0 ? 'text-alert' : ''}">${formatMoney(owedCents)}${s.status === 'pending' || s.status === 'cancelled' ? html` <span class="debt__when">(no cuenta: ${SERVICE_STATUS_LABELS[s.status].toLowerCase()})</span>` : ''}</dd></div>
              </dl>
              <div class="service__actions">
                <label class="service__status"><span class="sr-only">Estado de ${s.name}</span>
                  <select class="input input--small" data-service-status data-id="${s.id}">
                    ${SERVICE_STATUSES.map((st) => html`<option value="${st}" ${st === s.status ? 'selected' : ''}>${SERVICE_STATUS_LABELS[st]}</option>`)}
                  </select>
                </label>
                ${client.archived || s.status === 'cancelled' ? '' : html`<button type="button" class="btn btn--primary btn--small" data-action="client-pay" data-client="${client.id}" data-service="${s.id}">Registrar pago</button>`}
                ${canInvoice && s.status !== 'cancelled' && Math.max(0, s.priceCents - paidCents - billedCents) > 0 ? html`<button type="button" class="btn btn--ghost btn--small" data-action="new-invoice" data-client-id="${client.id}" data-service-id="${s.id}">Facturar</button>` : ''}
                <button type="button" class="btn btn--ghost btn--small" data-action="service-edit" data-id="${s.id}">Editar</button>
              </div>
            </li>`,
          )}</ul>`}
    </section>

    ${invoices.length > 0 || canInvoice
      ? html`<section class="panel" aria-labelledby="client-invoices-title">
          <div class="panel__head">
            <h2 class="panel__title" id="client-invoices-title">Facturas (${invoices.length})</h2>
            ${canInvoice ? html`<button type="button" class="link-btn" data-action="new-invoice" data-client-id="${client.id}">Nueva factura</button>` : ''}
          </div>
          ${invoices.length === 0
            ? html`<p class="muted">Aún no le has facturado. Al facturar un servicio, lo facturado deja de contarse en el servicio y pasa a la factura: nunca se cuenta dos veces.</p>`
            : html`<ul class="rows">${invoices.map((p) => html`<li class="row-item"><a class="row" href="#/facturas/${p.invoice.id}">
                <span class="row__main">
                  <span class="row__top"><span class="row__title">${invoiceLabel(p.invoice)}</span>${invoiceStatusChip(p.status)}${p.invoice.isDemo ? demoBadge() : ''}</span>
                  <span class="row__meta"><span>${formatDate(p.invoice.issueDate)}</span><span>total ${formatMoney(p.totalCents)}</span></span>
                </span>
                <span class="row__side"><span class="row__amount">${p.status === 'void' ? 'Anulada' : p.balanceCents === 0 ? 'Cobrada' : `Falta ${formatMoney(p.balanceCents)}`}</span></span>
              </a></li>`)}</ul>`}
        </section>`
      : ''}

    <section class="panel" aria-labelledby="payments-title">
      <div class="panel__head"><h2 class="panel__title" id="payments-title">Pagos recibidos (${payments.length})</h2></div>
      ${payments.length === 0
        ? html`<p class="muted">Cuando registres un ingreso y elijas a este cliente, aparecerá aquí.</p>`
        : html`<ul class="rows">${payments.map((m) =>
            movementRow(m, data.categories.find((c) => c.id === m.categoryId), m.serviceId ? serviceName.get(m.serviceId) ?? '' : invoiceOfMovement.get(m.id) ? `Cobro de ${invoiceLabel(/** @type {any} */ (invoiceOfMovement.get(m.id)))}` : 'Pago suelto'),
          )}</ul>`}
    </section>

    <section class="panel" aria-labelledby="costs-title">
      <div class="panel__head">
        <h2 class="panel__title" id="costs-title">Gastos cargados (${costRows.length})</h2>
        ${client.archived ? '' : html`<button type="button" class="link-btn" data-action="client-expense" data-client="${client.id}">Registrar gasto</button>`}
      </div>
      ${costRows.length === 0
        ? html`<p class="muted">Aquí van los gastos que le cargues a este cliente: una licencia, un viaje, materiales. Cuando registres un gasto y elijas «Cargar a un cliente», aparecerá aquí y se resta de lo que te deja.</p>`
        : html`<ul class="rows">${costRows.map((m) => movementRow(m, data.categories.find((c) => c.id === m.categoryId), ''))}</ul>
            <p class="panel__foot">Total cargado: ${formatMoney(costTotal)}. Para quitarle un gasto a este cliente, edítalo y elige «Sin cliente».</p>`}
    </section>

    <section class="panel" aria-labelledby="manage-title">
      <h2 class="panel__title" id="manage-title">Administrar cliente</h2>
      <p class="muted">${client.archived
        ? 'Está archivado: no aparece al registrar pagos ni servicios nuevos, pero su historial se conserva.'
        : 'Si ya no trabajas con este cliente, archívalo: deja de ofrecerse al registrar pagos, pero su historial se conserva.'}</p>
      <div class="actions actions--start">
        <button type="button" class="btn btn--ghost" data-action="client-archive" data-id="${client.id}" data-archived="${client.archived ? 'false' : 'true'}">${client.archived ? 'Reactivar cliente' : 'Archivar cliente'}</button>
        ${usage.invoices === 0 && usage.services === 0 && usage.payments === 0 && usage.expenses === 0
          ? html`<button type="button" class="btn btn--danger-ghost" data-action="client-delete" data-id="${client.id}">${icon('trash', 18)}Eliminar cliente</button>`
          : html`<span class="muted">No se puede eliminar porque tiene ${plural(usage.invoices, 'factura', 'facturas')}, ${plural(usage.services, 'servicio', 'servicios')}, ${plural(usage.payments, 'pago', 'pagos')} y ${plural(usage.expenses, 'gasto', 'gastos')}.</span>`}
      </div>
    </section>
  `;
}
