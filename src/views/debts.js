// @ts-check
// =============================================================================
// DEUDAS (documento maestro §4.4, §19 y §21)
// Lista de deudas (corto y largo plazo, de mayor a menor riesgo) y, al tocar una,
// su detalle: pagos, tabla de amortización y cómo se calculó el riesgo.
//
// Todos los números salen de domain/debts.js. Los botones (Registrar pago, Editar,
// Añadir deuda) son acciones comunes (app/actions.js).
//
// Todavía NO existe: conexión con bancos, recordatorios push ni simulaciones de
// refinanciamiento (etapas posteriores).
// =============================================================================

import { formatDate, plural } from '../domain/dates.js';
import {
  COLLATERAL_KIND_LABELS, FREQUENCY_LABELS, RISK_LABELS, collateralLabel, debtPortfolio, formatRate,
} from '../domain/debts.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { demoBadge, demoBanner, emptyState, exportButtons, financeTabs, money, progress, riskBadge } from '../ui/components.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/debts.js').DebtView} DebtView */
/** @typedef {import('../ui/html.js').SafeHtml} SafeHtml */

/** "hoy", "mañana", "en 5 días", "hace 3 días". @param {number} days */
export function dueText(days) {
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  if (days === -1) return 'ayer';
  return days > 0 ? `en ${days} días` : `hace ${plural(-days, 'día', 'días')}`;
}

/** "18 % anual" @param {import('../domain/types.js').Debt} debt */
const rateText = (debt) => `${formatRate(debt.rateBp)} ${debt.rateBasis === 'annual' ? 'anual' : 'mensual'}`;

/** Etiqueta del estado de una deuda. @param {DebtView} item */
export function stateChip({ status }) {
  if (status.state === 'paid') return html`<span class="chip chip--good">Pagada</span>`;
  if (status.state === 'overdue') {
    return html`<span class="chip chip--alert">${icon('alert', 12)}${plural(status.overdueCount, 'cuota vencida', 'cuotas vencidas')}</span>`;
  }
  if (status.state === 'due-soon') return html`<span class="chip chip--warn">Vence ${dueText(status.daysToNext ?? 0)}</span>`;
  return html`<span class="chip chip--good">Al día</span>`;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderDebts(store, ctx) {
  const { data } = store.getState();
  const today = store.today();
  const portfolio = debtPortfolio(data, today);

  const detailId = ctx.params[0];
  if (detailId) {
    const item = portfolio.items.find((i) => i.debt.id === detailId);
    return { html: item ? detailPage(store, item, today) : missingPage() };
  }
  return { html: listPage(store, portfolio, today) };
}

// =============================================================================
// LISTA
// =============================================================================

/**
 * @param {Store} store
 * @param {ReturnType<typeof debtPortfolio>} portfolio
 * @param {string} today
 */
function listPage(store, portfolio, today) {
  /** @param {DebtView} item */
  const card = (item) => {
    const { debt, status, risk } = item;
    const next = status.next;
    return html`<article class="debt${status.paid ? ' debt--paid' : ''}" aria-labelledby="debt-name-${debt.id}">
      <header class="debt__head">
        <div>
          <h3 class="debt__name" id="debt-name-${debt.id}"><a href="#/deudas/${debt.id}">${debt.name}</a></h3>
          <p class="debt__sub">${collateralLabel(debt.collateralKind, debt.collateralType)} · ${rateText(debt)} · ${FREQUENCY_LABELS[debt.frequency]}</p>
        </div>
        <div class="debt__tags">
          ${status.paid ? '' : riskBadge(risk.level, risk.score)}
          ${stateChip(item)}
          ${debt.isDemo ? demoBadge() : ''}
        </div>
      </header>

      ${progress(status.percentPaid, `Capital pagado de ${debt.name}`)}
      <p class="debt__figures">
        <span>${status.paid ? html`<strong>Pagada</strong> · ${formatMoney(debt.totalCents)}` : html`Debes <strong>${formatMoney(status.balanceCents)}</strong> de ${formatMoney(debt.totalCents)}`}</span>
        <span class="debt__percent">${formatPercent(status.percentPaid)}</span>
      </p>

      ${next
        ? html`<dl class="debt__facts">
            <div><dt>Próxima cuota</dt><dd class="${status.state === 'overdue' ? 'text-alert' : ''}">${formatDate(next.date)} · ${next.time}<br /><span class="debt__when">${dueText(status.daysToNext ?? 0)}</span></dd></div>
            <div><dt>Monto estimado</dt><dd>${money(next.paymentCents)}<br /><span class="debt__when">Interés ${formatMoney(next.interestCents)}</span></dd></div>
            <div><dt>Cuotas</dt><dd>${status.installmentsPaid} de ${status.installmentsTotal} pagadas</dd></div>
            <div><dt>Vence del todo</dt><dd>${formatDate(debt.finalDueDate)}</dd></div>
          </dl>`
        : ''}

      <div class="debt__actions">
        ${status.paid ? '' : html`<button type="button" class="btn btn--primary btn--small" data-action="debt-pay" data-id="${debt.id}">Registrar pago</button>`}
        <a class="btn btn--ghost btn--small" href="#/deudas/${debt.id}">Ver detalle</a>
        <button type="button" class="btn btn--ghost btn--small" data-action="debt-edit" data-id="${debt.id}">Editar</button>
      </div>
    </article>`;
  };

  /** @param {string} title @param {string} note @param {DebtView[]} items */
  const section = (title, note, items) =>
    items.length === 0
      ? ''
      : html`<h2 class="section-title">${title}</h2>
          <p class="muted section-note">${note}</p>
          <section class="debt-list" aria-label="${title}">${items.map(card)}</section>`;

  const dti = portfolio.debtToIncome;
  const hasActive = portfolio.active.length > 0;

  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Tus deudas, cuánto debes y cuándo pagar.</p>
      </div>
      <button type="button" class="btn btn--primary" data-action="new-debt">${icon('plus', 18)}Añadir deuda</button>
    </header>

    ${financeTabs('deudas', store)}
    ${demoBanner(store.hasDemoData())}

    ${portfolio.items.length === 0
      ? html`<section class="panel">${emptyState({
          icon: 'card',
          title: 'Aún no tienes deudas registradas',
          text: 'Registra un préstamo, una tarjeta u otra deuda con su tasa y fechas. ACCONTROL calcula tus cuotas, cuánto va a intereses y qué tan riesgosa es cada una.',
          actions: html`<button type="button" class="btn btn--primary" data-action="new-debt">Añadir deuda</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    <section class="panel panel--summary" aria-label="Resumen de deudas">
      <dl class="kpis">
        <div class="kpi"><dt>Total que debes</dt><dd>${money(portfolio.totalOwedCents)}</dd><dd class="kpi__note">${plural(portfolio.active.length, 'deuda activa', 'deudas activas')}</dd></div>
        <div class="kpi"><dt>Pagas al mes (aprox.)</dt><dd>${money(portfolio.monthlyServiceCents)}</dd><dd class="kpi__note">Tus cuotas llevadas a un mes</dd></div>
        <div class="kpi"><dt>Deuda frente a ingresos</dt><dd>${dti === null ? '—' : `${Math.round(dti * 100)} %`}</dd><dd class="kpi__note">${dti === null ? 'Sin ingresos recientes registrados' : 'De tu ingreso mensual promedio'}</dd></div>
        <div class="kpi"><dt>Riesgo promedio</dt><dd class="kpi__badge">${portfolio.avgRisk === null || portfolio.avgRiskLevel === null ? '—' : riskBadge(portfolio.avgRiskLevel, portfolio.avgRisk)}</dd><dd class="kpi__note">De 0 a 100</dd></div>
      </dl>
      ${hasActive
        ? html`<p class="panel__foot">Intereses ya pagados: <strong>${formatMoney(portfolio.interestPaidCents)}</strong> · Intereses por pagar si sigues el plan: <strong>${formatMoney(portfolio.interestRemainingCents)}</strong>. El riesgo se calcula con reglas fijas que puedes ver en cada deuda; no es inteligencia artificial.</p>`
        : ''}
    </section>

    ${section('Corto plazo', 'Menos de 12 meses para el vencimiento final. De mayor a menor riesgo.', portfolio.short)}
    ${section('Largo plazo', '12 meses o más para el vencimiento final. De mayor a menor riesgo.', portfolio.long)}
    ${section('Pagadas', 'Deudas que ya terminaste de pagar.', portfolio.paid)}

    <section class="panel" aria-labelledby="debts-export">
      <div class="panel__head"><h2 class="panel__title" id="debts-export">Exportar deudas</h2></div>
      <p class="panel__sub">Todas tus deudas, su estado y tus pagos. Se crea en tu dispositivo.</p>
      ${exportButtons({ kind: 'debts', label: 'Exportar deudas' })}
    </section>`}
  `;
}

// =============================================================================
// DETALLE
// =============================================================================

function missingPage() {
  return html`
    <a class="back-link" href="#/deudas">${icon('back', 16)}Deudas</a>
    <section class="panel">${emptyState({
      icon: 'card',
      title: 'Esa deuda ya no existe',
      text: 'Pudo haberse borrado desde otra ventana.',
      actions: html`<a class="btn btn--primary" href="#/deudas">Volver a Deudas</a>`,
    })}</section>`;
}

/**
 * @param {Store} store
 * @param {DebtView} item
 * @param {string} today
 */
function detailPage(store, item, today) {
  const { debt, status, risk, payments } = item;
  const next = status.next;
  const history = [...status.steps].reverse();
  const longSchedule = status.remaining.length > 24;

  return html`
    <a class="back-link" href="#/deudas">${icon('back', 16)}Deudas</a>

    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">${debt.name}</h1>
        <p class="page-subtitle">${collateralLabel(debt.collateralKind, debt.collateralType)} · ${COLLATERAL_KIND_LABELS[debt.collateralKind]}</p>
        <p class="debt__tags debt__tags--start">${status.paid ? '' : riskBadge(risk.level, risk.score)}${stateChip(item)}${debt.isDemo ? demoBadge() : ''}</p>
      </div>
      <div class="page-header__actions">
        ${status.paid ? '' : html`<button type="button" class="btn btn--primary" data-action="debt-pay" data-id="${debt.id}">${icon('plus', 18)}Registrar pago</button>`}
        <button type="button" class="btn btn--ghost" data-action="debt-edit" data-id="${debt.id}">Editar</button>
      </div>
    </header>

    ${demoBanner(store.hasDemoData())}

    ${status.state === 'overdue'
      ? html`<p class="notice notice--critical" role="status">${icon('alert', 18)}<span>Tienes ${plural(status.overdueCount, 'cuota vencida', 'cuotas vencidas')} por ${formatMoney(status.overdueCents)}. Registra el pago para ponerte al día.</span></p>`
      : status.state === 'due-soon' && next
        ? html`<p class="notice" role="status">${icon('info', 18)}<span>Tu próxima cuota (${formatMoney(next.paymentCents)}) vence ${dueText(status.daysToNext ?? 0)}.</span></p>`
        : ''}

    <section class="panel" aria-label="Resumen de la deuda">
      <dl class="kpis">
        <div class="kpi"><dt>${status.paid ? 'Monto de la deuda' : 'Debes'}</dt><dd>${money(status.paid ? debt.totalCents : status.balanceCents)}</dd><dd class="kpi__note">De ${formatMoney(debt.totalCents)} originales</dd></div>
        <div class="kpi"><dt>Capital pagado</dt><dd>${money(status.principalPaidCents)}</dd><dd class="kpi__note">${formatPercent(status.percentPaid)} de la deuda</dd></div>
        <div class="kpi"><dt>Intereses pagados</dt><dd>${money(status.interestPaidCents)}</dd><dd class="kpi__note">Hasta hoy</dd></div>
        <div class="kpi"><dt>Intereses por pagar</dt><dd>${money(status.interestRemainingCents)}</dd><dd class="kpi__note">Si sigues el plan</dd></div>
      </dl>
      ${progress(status.percentPaid, `Capital pagado de ${debt.name}`)}
    </section>

    ${next
      ? html`<section class="panel" aria-labelledby="next-title">
          <h2 class="panel__title" id="next-title">Próxima cuota</h2>
          <dl class="debt__facts debt__facts--wide">
            <div><dt>Fecha</dt><dd class="${status.state === 'overdue' ? 'text-alert' : ''}">${formatDate(next.date)} · ${next.time} (${dueText(status.daysToNext ?? 0)})</dd></div>
            <div><dt>Cuota estimada</dt><dd>${money(next.paymentCents)}</dd></div>
            <div><dt>De eso, interés</dt><dd>${money(next.interestCents)}</dd></div>
            <div><dt>De eso, capital</dt><dd>${money(next.principalCents)}</dd></div>
          </dl>
          <p class="panel__foot">Es una estimación sobre lo que debes hoy. Si pagas de más o de menos, las cuotas que faltan se recalculan y la fecha final no cambia.</p>
        </section>`
      : ''}

    ${status.paid
      ? ''
      : html`<section class="panel" aria-labelledby="risk-title">
          <div class="panel__head">
            <h2 class="panel__title" id="risk-title">Riesgo de esta deuda</h2>
            ${riskBadge(risk.level, risk.score)}
          </div>
          <ul class="risk-parts">
            ${risk.parts.map(
              (p) => html`<li class="risk-part">
                <span class="risk-part__label">${p.label}</span>
                <span class="risk-part__points">${p.points} de ${p.max}</span>
                ${progress((p.points / p.max) * 100, `${p.label}: ${p.points} de ${p.max} puntos`)}
                <span class="risk-part__detail">${p.detail}</span>
              </li>`,
            )}
          </ul>
          <details class="table-view">
            <summary>Cómo se calcula el riesgo</summary>
            <p class="muted">Es una puntuación de 0 a 100 que suma cinco partes: tasa de interés (hasta 30), cuánto de tu ingreso mensual se va en deudas (hasta 30), monto pendiente frente a un año de ingresos (hasta 15), tiempo restante (hasta 10) y vencimientos (hasta 15). De 0 a 30 es ${RISK_LABELS.low.toLowerCase()}, de 31 a 70 ${RISK_LABELS.medium.toLowerCase()} y de 71 a 100 ${RISK_LABELS.high.toLowerCase()}. Son reglas fijas que puedes comprobar; no es inteligencia artificial.${risk.incomeKnown ? '' : ' Como no hay ingresos registrados en los últimos 3 meses, las partes que dependen de tu ingreso usan un valor medio.'}</p>
          </details>
        </section>`}

    <section class="panel" aria-labelledby="payments-title">
      <div class="panel__head">
        <h2 class="panel__title" id="payments-title">Pagos registrados (${history.length})</h2>
      </div>
      ${status.problem ? html`<p class="notice notice--critical" role="alert">${icon('alert', 18)}<span>Hay un pago que no cuadra con el saldo de la deuda. Revísalo o bórralo.</span></p>` : ''}
      ${history.length === 0
        ? html`<p class="muted">Todavía no has registrado pagos de esta deuda.</p>`
        : html`<ul class="rows">${history.map(
            (step) => html`<li class="row-item">
              <button type="button" class="row" data-action="debt-payment-edit" data-id="${step.payment.id}" aria-label="${step.payment.kind === 'regular' ? 'Cuota' : 'Abono extra'} de ${formatMoney(step.payment.amountCents)} del ${formatDate(step.payment.date)}. Editar">
                <span class="row__main">
                  <span class="row__top">
                    <span class="tag tag--expense">${step.payment.kind === 'regular' ? `Cuota ${step.installmentNumber}` : 'Abono extra'}</span>
                    ${step.payment.isDemo ? demoBadge() : ''}
                  </span>
                  <span class="row__title">${formatDate(step.payment.date)} · ${step.payment.time}</span>
                  <span class="row__meta"><span>Interés ${formatMoney(step.interestCents)}</span><span>Capital ${formatMoney(step.principalCents)}</span><span>Quedó ${formatMoney(step.balanceAfterCents)}</span></span>
                </span>
                <span class="row__side"><span class="row__amount">${formatMoney(-step.payment.amountCents)}</span></span>
              </button>
            </li>`,
          )}</ul>`}
    </section>

    ${status.remaining.length > 0
      ? html`<section class="panel" aria-labelledby="schedule-title">
          <h2 class="panel__title" id="schedule-title">Tabla de amortización</h2>
          <p class="muted">${plural(status.remaining.length, 'cuota que falta', 'cuotas que faltan')}, calculadas sobre lo que debes hoy.</p>
          <details class="table-view" ${longSchedule ? '' : 'open'}>
            <summary>${longSchedule ? 'Ver la tabla completa' : 'Tabla de cuotas'}</summary>
            <div class="table-view__scroll">
              <table class="table">
                <caption class="sr-only">Cuotas que faltan de ${debt.name}</caption>
                <thead><tr><th scope="col">N.º</th><th scope="col">Fecha</th><th scope="col" class="num">Cuota</th><th scope="col" class="num">Interés</th><th scope="col" class="num">Capital</th><th scope="col" class="num">Saldo</th></tr></thead>
                <tbody>${status.remaining.map(
                  (r) => html`<tr class="${r.date < today ? 'row--overdue' : ''}"><th scope="row">${r.number}</th><td>${formatDate(r.date)}</td><td class="num">${formatMoney(r.paymentCents)}</td><td class="num">${formatMoney(r.interestCents)}</td><td class="num">${formatMoney(r.principalCents)}</td><td class="num">${formatMoney(r.balanceAfterCents)}</td></tr>`,
                )}</tbody>
              </table>
            </div>
          </details>
        </section>`
      : ''}

    <section class="panel" aria-labelledby="debt-export">
      <div class="panel__head"><h2 class="panel__title" id="debt-export">Exportar amortización</h2></div>
      <p class="panel__sub">Datos de la deuda, cuotas que faltan y pagos hechos.</p>
      ${exportButtons({ kind: 'debt', id: debt.id, label: `Exportar la amortización de ${debt.name}` })}
    </section>

    <section class="panel" aria-labelledby="terms-title">
      <h2 class="panel__title" id="terms-title">Datos de la deuda</h2>
      <dl class="debt__facts debt__facts--wide">
        <div><dt>Monto original</dt><dd>${formatMoney(debt.totalCents)}</dd></div>
        <div><dt>Tasa de interés</dt><dd>${rateText(debt)}</dd></div>
        <div><dt>Frecuencia de pago</dt><dd>${FREQUENCY_LABELS[debt.frequency]}</dd></div>
        <div><dt>Cuotas en total</dt><dd>${status.installmentsTotal}</dd></div>
        <div><dt>Primera cuota</dt><dd>${formatDate(debt.firstDueDate)} · ${debt.firstDueTime}</dd></div>
        <div><dt>Vencimiento final</dt><dd>${formatDate(debt.finalDueDate)} · ${debt.finalDueTime}</dd></div>
        <div><dt>Plazo</dt><dd>${status.term === 'short' ? 'Corto plazo' : 'Largo plazo'}</dd></div>
        <div><dt>Pagos hechos</dt><dd>${payments.length}</dd></div>
      </dl>
      ${debt.note ? html`<p class="muted">Nota: ${debt.note}</p>` : ''}
    </section>
  `;
}
