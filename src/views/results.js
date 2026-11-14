// @ts-check
// =============================================================================
// RESULTADOS (módulo Emprendedor y Empresa, documento maestro §10)
// El estado de resultados simplificado de tu negocio (ingresos - gastos = beneficio neto), sus indicadores (beneficio,
// acumulado, margen, rentabilidad, flujo de caja), la comparación con el período anterior y con el del año anterior,
// y una proyección con la tendencia de tus últimos meses.
//
// Todos los números salen de domain/business.js: son cuentas con reglas fijas sobre lo que registraste en ESTE espacio
// (no es inteligencia artificial). Esta pantalla solo los muestra y los explica.
// =============================================================================

import {
  PROJECTION_HORIZON, accumulatedProfit, businessVerdict, incomeStatement, missingBusinessCategories, monthlyResults,
  periodBounds, periodComparison, projectResults,
} from '../domain/business.js';
import { addMonths, monthLabel, monthShortLabel, plural } from '../domain/dates.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { GRANULARITY_LABELS, overallTotals } from '../domain/summaries.js';
import { columnChart, hBarChart } from '../ui/charts.js';
import { demoBanner, emptyState, exportButtons, financeTabs, legend, money, periodSwitch, tableView } from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/business.js').CategoryRow} CategoryRow */
/** @typedef {import('../domain/business.js').Delta} Delta */

/** Estado propio de esta pantalla (se conserva mientras no recargues la página). */
const view = {
  /** @type {import('../domain/summaries.js').Granularity} */
  granularity: 'month',
  /** @type {string | null} Un mes dentro del período mostrado; null = el período actual. */
  monthKey: null,
  /** Control que debe recuperar el foco después de volver a dibujar. @type {string | null} */
  refocus: null,
};

const MAX_BARS = 6;

/**
 * Deja las categorías más grandes y agrupa el resto en «Otras».
 * @param {CategoryRow[]} rows
 */
function topWithOthers(rows) {
  if (rows.length <= MAX_BARS) return rows.map((r) => ({ label: r.name, valueCents: r.cents, percent: r.percent }));
  const head = rows.slice(0, MAX_BARS - 1).map((r) => ({ label: r.name, valueCents: r.cents, percent: r.percent }));
  const rest = rows.slice(MAX_BARS - 1);
  head.push({ label: `Otras (${rest.length})`, valueCents: rest.reduce((s, r) => s + r.cents, 0), percent: rest.reduce((s, r) => s + r.percent, 0) });
  return head;
}

/** «+16.7%», «-8.3%», «igual» o, si no hay base para un porcentaje, la diferencia en dinero. @param {Delta} d */
export function changeText(d) {
  if (d.diffCents === 0) return 'igual';
  if (d.percent !== null) return `${d.percent > 0 ? '+' : ''}${formatPercent(d.percent)}`;
  return formatMoney(d.diffCents, { sign: true });
}

/** @param {number | null} value */
const pct = (value) => (value === null ? '—' : formatPercent(value));

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderResults(store, ctx) {
  const today = store.today();
  if (!store.resultsEnabled()) return { html: notAvailablePage(store) };

  const { data } = store.getState();
  const nowKey = today.slice(0, 7);
  const granularity = view.granularity;
  const anchor = view.monthKey ?? nowKey;
  const bounds = periodBounds(granularity, anchor);
  const canGoNext = bounds.lastMonth < nowKey;

  const hasAnything = data.movements.some((m) => m.date <= today);
  const statement = incomeStatement(data, bounds, today);
  const comparison = periodComparison(data, granularity, anchor, today);
  const accumulated = accumulatedProfit(data, today);
  const verdict = businessVerdict(data, today);
  const projection = projectResults(data, today);
  const series = monthlyResults(data, today, 6);
  const available = overallTotals(data, today).availableCents;
  const suggestions = missingBusinessCategories(data.categories);
  const offerCategories = suggestions.length > 0 && data.categories.every((c) => c.builtIn);
  const hasSeries = series.some((s) => s.hasData);
  const periodTitle = `${bounds.label}${statement.partial ? ' · en curso' : ''}`;

  const page = html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Cómo le va a tu negocio: lo que entra, lo que sale y lo que queda.</p>
      </div>
    </header>
    ${financeTabs('resultados', store)}
    ${demoBanner(store.hasDemoData())}

    ${!hasAnything
      ? html`<section class="panel">${emptyState({
          icon: 'chart',
          title: 'Tu negocio en números empieza aquí',
          text: 'Registra los ingresos y gastos de tu negocio (siempre separados de los de tus otros espacios) y aquí verás tu estado de resultados, tu margen, cómo vas frente al mes pasado y una proyección.',
          actions: html`<button type="button" class="btn btn--primary" data-action="add-income">${icon('plus', 18)}Registrar ingreso</button>
            <button type="button" class="btn btn--ghost" data-action="add-expense">${icon('plus', 18)}Registrar gasto</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    ${verdict
      ? html`<section class="verdict verdict--${verdict.state}" role="note" aria-label="¿Tu negocio genera valor?">
          <span class="verdict__icon">${icon(verdict.state === 'value' ? 'check' : verdict.state === 'mixed' ? 'info' : 'alert', 20)}</span>
          <p class="verdict__text"><strong>${verdict.state === 'value' ? 'Tu negocio genera valor.' : verdict.state === 'mixed' ? 'Resultados mixtos.' : 'Por ahora hay movimiento, no beneficio.'}</strong> ${verdict.text}</p>
        </section>`
      : ''}

    <div class="res-controls">
      ${periodSwitch(granularity)}
      <div class="month-selector" role="group" aria-label="Período">
        <button type="button" class="icon-btn" data-action="res-prev" aria-label="Período anterior">${icon('chevronLeft')}</button>
        <span class="month-selector__label month-selector__label--wide" aria-live="polite">${bounds.label}</span>
        <button type="button" class="icon-btn" data-action="res-next" aria-label="Período siguiente" ${canGoNext ? '' : 'disabled'}>${icon('chevronRight')}</button>
      </div>
    </div>

    <section class="panel" aria-labelledby="rs-title">
      <div class="panel__head"><h2 class="panel__title" id="rs-title">Estado de resultados</h2></div>
      <p class="panel__sub">${periodTitle}</p>
      ${statement.hasData
        ? html`<dl class="statement">
            <div class="statement__row"><dt>Ingresos del negocio</dt><dd>${money(statement.incomeCents, { tone: 'income' })}</dd></div>
            <div class="statement__row"><dt>Gastos del negocio</dt><dd>${money(statement.expenseCents)}</dd></div>
            ${statement.debtPaymentsCents > 0
              ? html`<div class="statement__row statement__row--sub"><dt>de los cuales, pagos de deudas</dt><dd>${money(statement.debtPaymentsCents)}</dd></div>`
              : ''}
            <div class="statement__row statement__row--total"><dt>Beneficio neto</dt><dd>${money(statement.netCents, { tone: 'auto' })}</dd></div>
            ${statement.debtPaymentsCents > 0
              ? html`<div class="statement__row statement__row--sub"><dt>Beneficio antes de pagos de deudas</dt><dd>${money(statement.netBeforeDebtCents, { tone: 'auto' })}</dd></div>`
              : ''}
          </dl>
          ${statement.partial ? html`<p class="panel__foot">Este período todavía no termina: solo suma lo registrado hasta hoy.</p>` : ''}
          ${statement.debtPaymentsCents > 0
            ? html`<p class="panel__foot">Los pagos de deudas se registran como gasto y incluyen el capital que devuelves, que no es un gasto del negocio. Por eso se muestran aparte y también se da el beneficio sin ellos.</p>`
            : ''}`
        : html`<p class="muted">No hay ingresos ni gastos en este período.</p>`}
    </section>

    <section class="panel" aria-labelledby="ind-title">
      <div class="panel__head"><h2 class="panel__title" id="ind-title">Indicadores</h2></div>
      <dl class="kpis">
        <div class="kpi"><dt>Beneficio de ${bounds.granularity === 'month' ? 'este mes' : 'este período'}</dt><dd>${money(statement.netCents, { tone: 'auto' })}</dd><dd class="kpi__note">${periodTitle}</dd></div>
        <div class="kpi"><dt>Margen de ganancia</dt><dd>${pct(statement.marginPercent)}</dd><dd class="kpi__note">${statement.marginPercent === null ? 'Sin ingresos en el período' : 'Del beneficio, por cada RD$ 100 que ingresan'}</dd></div>
        <div class="kpi"><dt>Rentabilidad</dt><dd>${pct(statement.profitabilityPercent)}</dd><dd class="kpi__note">${statement.profitabilityPercent === null ? 'Sin gastos en el período' : `Beneficio por cada peso que gastas (RD$ ${(statement.profitabilityPercent / 100).toFixed(2)})`}</dd></div>
        <div class="kpi"><dt>Beneficio acumulado de ${accumulated.year}</dt><dd>${money(accumulated.yearToDateCents, { tone: 'auto' })}</dd><dd class="kpi__note">${accumulated.firstMonth ? `Desde el primer registro (${monthLabel(accumulated.firstMonth)}): ${formatMoney(accumulated.sinceStartCents)}` : 'Sin registros todavía'}</dd></div>
      </dl>
      <p class="panel__foot">Margen = beneficio ÷ ingresos. Rentabilidad = beneficio ÷ gastos. Son cuentas con reglas fijas sobre lo que registraste, no inteligencia artificial.</p>
    </section>

    <section class="panel" aria-labelledby="cmp-title">
      <div class="panel__head"><h2 class="panel__title" id="cmp-title">Comparación</h2></div>
      <p class="panel__sub">${GRANULARITY_LABELS[granularity]}: ${periodTitle} frente a ${comparison.yearAgo ? 'el período anterior y el mismo período del año anterior' : 'el período anterior'}.</p>
      ${comparisonCards(comparison)}
      <p class="panel__foot">En cada tarjeta, lo grande es este período y debajo lo de los otros períodos con cuánto cambió este respecto a ellos. Si el otro período no tuvo ingresos o gastos, en lugar de un porcentaje se muestra la diferencia en dinero.${statement.partial ? ' Como este período sigue en curso, frente a períodos completos casi siempre se verá más bajo.' : ''}</p>
    </section>

    <section class="panel" aria-labelledby="flow-title">
      <div class="panel__head"><h2 class="panel__title" id="flow-title">Flujo de caja</h2></div>
      <p class="panel__sub">Lo que entró y lo que salió en los últimos 6 meses.</p>
      ${hasSeries
        ? html`${legend([{ label: 'Ingresos', cls: 'income' }, { label: 'Gastos', cls: 'expense' }])}
            <div class="chart-host" id="res-flow" role="presentation"></div>
            ${tableView({
              caption: 'Flujo de caja de los últimos 6 meses',
              headers: ['Mes', 'Ingresos', 'Gastos', 'Neto'],
              rows: series.map((s) => [monthLabel(s.key), formatMoney(s.incomeCents), formatMoney(s.expenseCents), formatMoney(s.netCents)]),
            })}`
        : html`<p class="muted">No hay ingresos ni gastos en estos seis meses.</p>`}
      <p class="panel__foot">Dinero disponible hoy en este espacio: <strong>${formatMoney(available)}</strong> (saldo inicial más ingresos, menos gastos y lo apartado en metas). Como la app anota el dinero cuando entra o sale, el flujo neto de cada mes coincide con el beneficio de ese mes.</p>
    </section>

    ${statement.hasData
      ? html`<div class="grid-2">
          <section class="panel" aria-labelledby="rs-inc">
            <div class="panel__head"><h2 class="panel__title" id="rs-inc">Ingresos por categoría</h2></div>
            <p class="panel__sub">${periodTitle} · total ${formatMoney(statement.incomeCents)}</p>
            ${statement.incomeByCategory.length > 0
              ? html`<div class="chart-host" id="res-inc" role="presentation"></div>
                  ${tableView({ caption: 'Ingresos por categoría', headers: ['Categoría', 'Monto', '% del total'], rows: statement.incomeByCategory.map((c) => [c.name, formatMoney(c.cents), formatPercent(c.percent)]) })}`
              : html`<p class="muted">Sin ingresos en este período.</p>`}
          </section>
          <section class="panel" aria-labelledby="rs-exp">
            <div class="panel__head"><h2 class="panel__title" id="rs-exp">Gastos por categoría</h2></div>
            <p class="panel__sub">${periodTitle} · total ${formatMoney(statement.expenseCents)}</p>
            ${statement.expenseByCategory.length > 0
              ? html`<div class="chart-host" id="res-exp" role="presentation"></div>
                  ${tableView({ caption: 'Gastos por categoría', headers: ['Categoría', 'Monto', '% del total'], rows: statement.expenseByCategory.map((c) => [c.name, formatMoney(c.cents), formatPercent(c.percent)]) })}`
              : html`<p class="muted">Sin gastos en este período.</p>`}
          </section>
        </div>`
      : ''}

    <section class="panel" aria-labelledby="proj-title">
      <div class="panel__head"><h2 class="panel__title" id="proj-title">Proyección</h2></div>
      ${projection.ok
        ? html`<p class="panel__sub">Los próximos ${PROJECTION_HORIZON} meses, con la tendencia de ${monthLabel(projection.basisMonths[0])} a ${monthLabel(projection.basisMonths[projection.basisMonths.length - 1])}.</p>
            <ul class="proj-list" aria-label="Proyección de ingresos, gastos y beneficio">
              ${projection.months.map((m) => html`<li class="proj">
                <p class="proj__month">${monthLabel(m.key)}${m.current ? html` <span class="proj__tag">en curso</span>` : ''}</p>
                <p class="proj__net">${money(m.netCents, { tone: 'auto' })}<span class="proj__net-label">beneficio estimado</span></p>
                <p class="proj__line">Ingresos ${formatMoney(m.incomeCents)} · Gastos ${formatMoney(m.expenseCents)}</p>
                <p class="proj__range">Rango del beneficio: ${formatMoney(m.netLowCents, { decimals: false })} a ${formatMoney(m.netHighCents, { decimals: false })}</p>
              </li>`)}
            </ul>
            <p class="panel__foot">En ${PROJECTION_HORIZON} meses: ingresos ${formatMoney(projection.totals.incomeCents, { decimals: false })}, gastos ${formatMoney(projection.totals.expenseCents, { decimals: false })} y beneficio ${formatMoney(projection.totals.netCents, { decimals: false })}.</p>
            ${projection.lowConfidence
              ? html`<div class="banner" role="note"><p class="banner__text"><strong>Tómala con cuidado.</strong> ${projection.reasons.join(' ')}</p></div>`
              : ''}
            <p class="panel__foot">Cómo se calcula: una tendencia lineal con tus últimos ${plural(projection.basisMonths.length, 'mes completo', 'meses completos')}. Tus ingresos cambian en promedio ${formatMoney(projection.incomeSlopeCents, { sign: true, decimals: false })} por mes y tus gastos ${formatMoney(projection.expenseSlopeCents, { sign: true, decimals: false })}. El rango es cuánto suelen apartarse tus resultados de esa tendencia. Es una estimación matemática, no una promesa: no conoce temporadas, campañas ni gastos que aún no registras.</p>`
        : html`<p class="muted">${projection.reason === 'no-data'
            ? 'Todavía no hay movimientos para proyectar.'
            : `Para proyectar necesito al menos ${projection.needMonths} meses completos con registros y por ahora hay ${projection.haveMonths}. Cuando tengas más historia, aquí aparecerán tus ingresos, gastos y beneficio estimados.`}</p>`}
    </section>

    <section class="panel" aria-labelledby="rs-export">
      <div class="panel__head"><h2 class="panel__title" id="rs-export">Exportar reporte de resultados</h2></div>
      <p class="panel__sub">${GRANULARITY_LABELS[granularity]}: ${bounds.label}. Resumen, comparación, categorías, últimos 6 meses y proyección. Se crea en tu dispositivo.</p>
      ${exportButtons({ kind: 'results', month: anchor, granularity, label: `Exportar el reporte de resultados, ${bounds.label}` })}
      <p class="panel__foot">El CSV trae solo la tabla de comparación; el Excel y el PDF traen todo.</p>
    </section>`}

    ${offerCategories
      ? html`<section class="panel" aria-labelledby="cat-title">
          <div class="panel__head"><h2 class="panel__title" id="cat-title">Categorías para tu negocio</h2></div>
          <p class="muted">Tu espacio solo tiene las categorías generales. Puedo añadir ${suggestions.length} habituales en un negocio (${suggestions.map((s) => s.name).join(', ')}) para que tus gastos queden mejor separados. Después son tuyas: las puedes renombrar o borrar.</p>
          <div class="actions actions--start"><button type="button" class="btn btn--primary btn--small" data-action="add-business-categories">${icon('plus', 16)}Añadir categorías de negocio</button></div>
        </section>`
      : ''}
  `;

  return {
    html: page,
    mount(root, signal) {
      /** @type {(() => void)[]} */
      const stops = [];
      /** @param {string} id @param {(host: HTMLElement) => () => void} render */
      const draw = (id, render) => {
        const host = root.querySelector(`#${id}`);
        if (host instanceof HTMLElement) stops.push(render(host));
      };
      draw('res-flow', (host) =>
        columnChart(host, {
          labels: series.map((s) => monthShortLabel(s.key)),
          titles: series.map((s) => monthLabel(s.key)),
          series: [
            { name: 'Ingresos', cls: 'income', values: series.map((s) => s.incomeCents) },
            { name: 'Gastos', cls: 'expense', values: series.map((s) => s.expenseCents) },
          ],
          ariaLabel: `Ingresos y gastos de los últimos 6 meses, hasta ${monthLabel(series[series.length - 1].key)}`,
        }));
      draw('res-inc', (host) => hBarChart(host, { items: topWithOthers(statement.incomeByCategory), cls: 'income', ariaLabel: `Ingresos por categoría, ${bounds.label}` }));
      draw('res-exp', (host) => hBarChart(host, { items: topWithOthers(statement.expenseByCategory), cls: 'expense', ariaLabel: `Gastos por categoría, ${bounds.label}` }));

      // Al cambiar de vista la pantalla se vuelve a dibujar: el foco vuelve al control que se usó.
      if (view.refocus) {
        const again = root.querySelector(view.refocus);
        if (again instanceof HTMLElement && !(again instanceof HTMLButtonElement && again.disabled)) again.focus({ preventScroll: true });
        view.refocus = null;
      }

      root.addEventListener(
        'click',
        async (event) => {
          const el = actionTarget(event.target);
          if (!el) return;
          const action = el.dataset.action;
          if (action === 'period') {
            const next = el.dataset.period;
            if (next === 'month' || next === 'quarter' || next === 'year') {
              view.granularity = next;
              view.refocus = `[data-action="period"][data-period="${next}"]`;
              ctx.rerender();
            }
          } else if (action === 'res-prev') {
            view.monthKey = addMonths(bounds.firstMonth, -bounds.months);
            view.refocus = '[data-action="res-prev"]';
            ctx.rerender();
          } else if (action === 'res-next' && canGoNext) {
            const next = addMonths(bounds.firstMonth, bounds.months);
            view.monthKey = next >= nowKey ? null : next;
            view.refocus = '[data-action="res-next"]';
            ctx.rerender();
          } else if (action === 'add-business-categories') {
            const result = await store.addBusinessCategories();
            if (result.ok) toast(result.added > 0 ? `Listo: ${plural(result.added, 'categoría añadida', 'categorías añadidas')}.` : 'Ya tenías esas categorías.', 'success');
            else toast(Object.values(result.errors)[0] ?? 'No se pudieron añadir las categorías.', 'error');
          }
        },
        { signal },
      );

      return () => stops.forEach((stop) => stop());
    },
  };
}

/**
 * Comparación en tarjetas (una por cifra): se lee igual de bien en un teléfono que en una pantalla grande.
 * @param {import('../domain/business.js').PeriodComparison} c
 */
function comparisonCards(c) {
  const others = [
    { title: 'Anterior', col: c.previous },
    ...(c.yearAgo ? [{ title: 'Año anterior', col: c.yearAgo }] : []),
  ];
  /** @type {{ title: string, now: string, rows: { who: string, text: string, change: string }[] }[]} */
  const metrics = [];
  /** @param {string} title @param {'income' | 'expense' | 'net'} key @param {number} nowCents */
  const money3 = (title, key, nowCents) => ({
    title,
    now: formatMoney(nowCents),
    rows: others.map(({ title: who, col }) => {
      if (!col.statement.hasData) return { who: `${who} (${col.statement.period.label})`, text: 'Sin registros', change: '' };
      const value = key === 'income' ? col.statement.incomeCents : key === 'expense' ? col.statement.expenseCents : col.statement.netCents;
      return { who: `${who} (${col.statement.period.label})`, text: formatMoney(value), change: changeText(col[key]) };
    }),
  });
  metrics.push(money3('Ingresos', 'income', c.current.incomeCents));
  metrics.push(money3('Gastos', 'expense', c.current.expenseCents));
  metrics.push(money3('Beneficio neto', 'net', c.current.netCents));
  metrics.push({
    title: 'Margen',
    now: c.current.marginPercent === null ? '—' : formatPercent(c.current.marginPercent),
    rows: others.map(({ title: who, col }) => {
      const label = `${who} (${col.statement.period.label})`;
      if (!col.statement.hasData || col.statement.marginPercent === null) return { who: label, text: '—', change: '' };
      const pts = col.marginPoints;
      return { who: label, text: formatPercent(col.statement.marginPercent), change: pts === null ? '' : `${pts > 0 ? '+' : ''}${(Math.round(pts * 10) / 10).toFixed(1)} pts` };
    }),
  });
  return html`<div class="cmp-grid">${metrics.map((m) => html`<section class="cmp" aria-label="${m.title}">
    <h3 class="cmp__title">${m.title}</h3>
    <p class="cmp__now">${m.now}</p>
    <dl class="cmp__list">${m.rows.map((r) => html`<div class="cmp__row"><dt>${r.who}</dt><dd>${r.text}${r.change ? html` <span class="cmp__chg">${r.change}</span>` : ''}</dd></div>`)}</dl>
  </section>`)}</div>`;
}

/** @param {Store} store */
function notAvailablePage(store) {
  const workspace = store.activeWorkspace();
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Resultados</h1>
        <p class="page-subtitle">El estado de resultados de tu negocio.</p>
      </div>
    </header>
    <section class="panel">${emptyState({
      icon: 'chart',
      title: 'Resultados es parte de los espacios Emprendedor y Empresa',
      text: `${workspace ? `«${workspace.name}» no es un espacio de negocio. ` : ''}Crea (o abre) un espacio Emprendedor o Empresa para ver tu beneficio, tu margen, cómo vas frente al mes pasado y una proyección.`,
      actions: html`<button type="button" class="btn btn--primary" data-action="workspace-menu">Ver mis espacios</button>
        <a class="btn btn--ghost" href="#/finanzas">Volver a Finanzas</a>`,
    })}</section>`;
}
