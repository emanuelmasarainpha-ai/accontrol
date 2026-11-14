// @ts-check
// =============================================================================
// ESTADÍSTICAS (documento maestro §6 y §20)
// Todo sale de los movimientos y aportes registrados: ningún dato inventado.
//
// Análisis descriptivo ("qué pasó") por mes, trimestre o año, la evolución de lo que
// debes y el ritmo de cada meta, más la exportación del reporte. El patrimonio neto
// tiene su propia pantalla (Finanzas > Patrimonio). Las proyecciones con inteligencia
// artificial son de una etapa posterior.
// =============================================================================

import { addMonths, currentMonthKey, formatDate, monthLabel, monthShortLabel } from '../domain/dates.js';
import { goalPace, goalProgress } from '../domain/goals.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { debtEvolution } from '../domain/netWorth.js';
import {
  availableByMonthEnd, GRANULARITY_LABELS, monthTotals, periodSeries, statsIndicators, totalsByCategory,
  totalsByClassification,
} from '../domain/summaries.js';
import { CLASSIFICATION_LABELS_PLURAL } from '../domain/types.js';
import { columnChart, hBarChart, lineChart, segmentBar } from '../ui/charts.js';
import { debtByCategory, debtPortfolio } from '../domain/debts.js';
import {
  delta, demoBanner, emptyState, exportButtons, goalPaceBlock, legend, monthSelector, money, periodSwitch, progress, riskBadge, tableView,
} from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

const view = {
  /** @type {string | null} null = el mes actual */
  monthKey: null,
  /** @type {import('../domain/summaries.js').Granularity} */
  granularity: 'month',
  /** Control que debe recuperar el foco después de volver a dibujar la pantalla. @type {string | null} */
  refocus: null,
};

const MAX_BARS = 7;

/**
 * Deja las 7 primeras categorías y agrupa el resto en "Otras".
 * @param {{ name: string, totalCents: number, percent: number }[]} list
 */
function topWithOthers(list) {
  if (list.length <= MAX_BARS) return list.map((c) => ({ label: c.name, valueCents: c.totalCents, percent: c.percent }));
  const head = list.slice(0, MAX_BARS - 1).map((c) => ({ label: c.name, valueCents: c.totalCents, percent: c.percent }));
  const rest = list.slice(MAX_BARS - 1);
  head.push({
    label: `Otras (${rest.length})`,
    valueCents: rest.reduce((s, c) => s + c.totalCents, 0),
    percent: rest.reduce((s, c) => s + c.percent, 0),
  });
  return head;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderStats(store, ctx) {
  const { data } = store.getState();
  const today = store.today();
  const nowKey = currentMonthKey(store.now());
  const monthKey = view.monthKey ?? nowKey;
  const prevKey = addMonths(monthKey, -1);
  const hasAnything = data.movements.length > 0 || data.contributions.length > 0;

  const granularity = view.granularity;
  const periods = periodSeries(data.movements, data.contributions, monthKey, granularity, nowKey);
  const hasSeries = periods.some((p) => p.incomeCents > 0 || p.expenseCents > 0);
  const lastPeriod = periods[periods.length - 1];
  const flowSub = {
    month: `Seis meses terminando en ${monthLabel(monthKey)}.`,
    quarter: `Cuatro trimestres de calendario terminando en ${lastPeriod.label}.`,
    year: `Tres años de calendario terminando en ${lastPeriod.label}.`,
  }[granularity];
  /** @param {import('../domain/summaries.js').PeriodTotals} p */
  const periodTitle = (p) => (p.partial && granularity !== 'month' ? `${p.label} · en curso` : p.label);

  // "Dinero disponible" se queda mensual: es un saldo al cierre de cada mes.
  const monthKeys = Array.from({ length: 6 }, (_, i) => addMonths(monthKey, i - 5));
  const available = availableByMonthEnd(data, monthKeys, today);

  const expenseCats = totalsByCategory(data.movements, data.categories, 'expense', monthKey);
  const incomeCats = totalsByCategory(data.movements, data.categories, 'income', monthKey);
  const expenseBars = topWithOthers(expenseCats);
  const incomeBars = topWithOthers(incomeCats);

  const totals = monthTotals(data.movements, monthKey);
  const expenseClasses = totalsByClassification(data.movements, 'expense', monthKey);
  const incomeClasses = totalsByClassification(data.movements, 'income', monthKey);
  const ind = statsIndicators(data, monthKey, today);

  const goalRows = data.goals
    .map((goal) => ({ goal, info: goalProgress(goal, data.contributions, today), pace: goalPace(goal, data.contributions, today) }))
    .sort((a, b) => a.goal.targetDate.localeCompare(b.goal.targetDate));

  const debts = debtPortfolio(data, today);
  const owedSeries = debtEvolution(data, today);
  const hasOwedHistory = owedSeries.length >= 2 && owedSeries.some((o) => o.owedCents > 0);
  const debtCats = debtByCategory(debts.items);
  const debtBars = topWithOthers(
    debtCats.map((c) => ({ name: c.label, totalCents: c.balanceCents, percent: debts.totalOwedCents > 0 ? (c.balanceCents / debts.totalOwedCents) * 100 : 0 })),
  );

  const expenseRamp = ['ord-1', 'ord-2', 'ord-3'];
  const incomeRamp = ['inc-1', 'inc-2', 'inc-3'];

  /**
   * @param {{ classification: keyof typeof CLASSIFICATION_LABELS_PLURAL, totalCents: number, percent: number }[]} classes
   * @param {string[]} ramp
   */
  const classLegend = (classes, ramp) =>
    legend(classes.map((c, i) => ({
      label: CLASSIFICATION_LABELS_PLURAL[c.classification],
      cls: ramp[i],
      value: `${formatMoney(c.totalCents, { decimals: false })} · ${formatPercent(c.percent)}`,
    })));

  /** @param {number | null} cents */
  const moneyOrDash = (cents) => (cents === null ? html`<span class="muted">Sin datos</span>` : money(cents));

  const page = html`
    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">Estadísticas</h1>
        <p class="page-subtitle">Lo que ha pasado con tu dinero, calculado con lo que registraste.</p>
      </div>
      <div class="page-header__actions">
        ${store.diagnosisEnabled() ? html`<a class="btn btn--ghost" href="#/diagnostico" data-tour="stats-diagnosis">${icon('chart', 18)}Diagnóstico</a>` : ''}
        <a class="btn btn--ghost" href="#/calculadoras" data-tour="stats-calculators">${icon('calculator', 18)}Calculadoras</a>
      </div>
    </header>

    ${demoBanner(store.hasDemoData())}

    ${!hasAnything
      ? html`<section class="panel">${emptyState({
          icon: 'chart',
          title: 'Tus estadísticas aparecerán aquí',
          text: 'Las estadísticas se calculan con tus movimientos y aportes. Registra algunos y aparecerán aquí.',
          actions: html`<button type="button" class="btn btn--primary" data-action="add-income">Registrar ingreso</button>
            <button type="button" class="btn btn--ghost" data-action="add-expense">Registrar gasto</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    ${monthSelector(monthKey, { canGoNext: monthKey < nowKey })}

    <section class="panel" aria-labelledby="st-flow">
      <div class="panel__head"><h2 class="panel__title" id="st-flow">Ingresos y gastos</h2></div>
      <p class="panel__sub">${flowSub}</p>
      ${periodSwitch(granularity)}
      ${hasSeries
        ? html`${legend([{ label: 'Ingresos', cls: 'income' }, { label: 'Gastos', cls: 'expense' }])}
            <div class="chart-host" id="chart-cols" role="presentation"></div>
            ${tableView({
              caption: `Ingresos y gastos (${GRANULARITY_LABELS[granularity].toLowerCase()})`,
              headers: [{ month: 'Mes', quarter: 'Trimestre', year: 'Año' }[granularity], 'Ingresos', 'Gastos', 'Balance'],
              rows: periods.map((p) => [periodTitle(p), formatMoney(p.incomeCents), formatMoney(p.expenseCents), formatMoney(p.balanceCents)]),
            })}
            ${granularity !== 'month' && lastPeriod.partial
              ? html`<p class="panel__foot">El último período todavía no termina: solo suma lo registrado hasta hoy, así que no es comparable con los anteriores.</p>`
              : ''}`
        : html`<p class="muted">No hay ingresos ni gastos en ${{ month: 'estos seis meses', quarter: 'estos cuatro trimestres', year: 'estos tres años' }[granularity]}.</p>`}
    </section>

    <section class="panel" aria-labelledby="st-avail">
      <div class="panel__head"><h2 class="panel__title" id="st-avail">Dinero disponible al cierre de cada mes</h2></div>
      <p class="panel__sub">Saldo inicial más ingresos, menos gastos y lo apartado en metas.</p>
      <div class="chart-host" id="chart-line" role="presentation"></div>
      ${tableView({
        caption: 'Dinero disponible al cierre de cada mes',
        headers: ['Mes', 'Disponible'],
        rows: available.map((a) => [monthLabel(a.monthKey), formatMoney(a.availableCents)]),
      })}
    </section>

    <div class="grid-2">
      <section class="panel" aria-labelledby="st-exp">
        <div class="panel__head"><h2 class="panel__title" id="st-exp">Gastos por categoría</h2></div>
        <p class="panel__sub">${monthLabel(monthKey)} · total ${formatMoney(totals.expenseCents)}</p>
        ${expenseCats.length > 0
          ? html`<div class="chart-host" id="chart-exp" role="presentation"></div>
              ${tableView({
                caption: 'Gastos por categoría',
                headers: ['Categoría', 'Monto', '% del total'],
                rows: expenseCats.map((c) => [c.name, formatMoney(c.totalCents), formatPercent(c.percent)]),
              })}`
          : html`<p class="muted">Sin gastos en este mes.</p>`}
      </section>

      <section class="panel" aria-labelledby="st-inc">
        <div class="panel__head"><h2 class="panel__title" id="st-inc">Ingresos por categoría</h2></div>
        <p class="panel__sub">${monthLabel(monthKey)} · total ${formatMoney(totals.incomeCents)}</p>
        ${incomeCats.length > 0
          ? html`<div class="chart-host" id="chart-inc" role="presentation"></div>
              ${tableView({
                caption: 'Ingresos por categoría',
                headers: ['Categoría', 'Monto', '% del total'],
                rows: incomeCats.map((c) => [c.name, formatMoney(c.totalCents), formatPercent(c.percent)]),
              })}`
          : html`<p class="muted">Sin ingresos en este mes.</p>`}
      </section>
    </div>

    <div class="grid-2">
      <section class="panel" aria-labelledby="st-cexp">
        <div class="panel__head"><h2 class="panel__title" id="st-cexp">Cómo se clasifican tus gastos</h2></div>
        <p class="panel__sub">Fijos, variables y discrecionales.</p>
        ${totals.expenseCents > 0
          ? html`<div class="chart-host" id="chart-cexp" role="presentation"></div>${classLegend(expenseClasses, expenseRamp)}`
          : html`<p class="muted">Sin gastos en este mes.</p>`}
      </section>
      <section class="panel" aria-labelledby="st-cinc">
        <div class="panel__head"><h2 class="panel__title" id="st-cinc">Cómo se clasifican tus ingresos</h2></div>
        <p class="panel__sub">Fijos, variables y extraordinarios.</p>
        ${totals.incomeCents > 0
          ? html`<div class="chart-host" id="chart-cinc" role="presentation"></div>${classLegend(incomeClasses, incomeRamp)}`
          : html`<p class="muted">Sin ingresos en este mes.</p>`}
      </section>
    </div>

    <section class="panel" aria-labelledby="st-ind">
      <div class="panel__head"><h2 class="panel__title" id="st-ind">Indicadores</h2></div>
      <div class="indicators">
        <div class="indicator-group">
          <h3 class="indicator-group__title">Ingresos</h3>
          <dl class="facts">
            <div><dt>Promedio mensual</dt><dd>${moneyOrDash(ind.income.avgMonthlyCents)}</dd></div>
            <div><dt>Mayor ingreso registrado</dt><dd>${ind.income.biggest
              ? html`${money(ind.income.biggest.amountCents)}<span class="facts__note">${ind.income.biggest.description} · ${ind.income.biggestCategoryName} · ${formatDate(ind.income.biggest.date)}</span>`
              : html`<span class="muted">Sin datos</span>`}</dd></div>
            <div><dt>Fuente más frecuente</dt><dd>${ind.income.mostFrequent
              ? html`${ind.income.mostFrequent.name}<span class="facts__note">${ind.income.mostFrequent.count} ${ind.income.mostFrequent.count === 1 ? 'vez' : 'veces'}</span>`
              : html`<span class="muted">Sin datos</span>`}</dd></div>
            <div><dt>Cambio frente a ${monthLabel(prevKey)}</dt><dd>${delta(ind.income.changePercent, { upIsGood: true, since: monthLabel(prevKey) })}</dd></div>
          </dl>
        </div>
        <div class="indicator-group">
          <h3 class="indicator-group__title">Gastos</h3>
          <dl class="facts">
            <div><dt>Promedio mensual</dt><dd>${moneyOrDash(ind.expense.avgMonthlyCents)}</dd></div>
            <div><dt>Categoría de mayor consumo</dt><dd>${ind.expense.top
              ? html`${ind.expense.top.name}<span class="facts__note">${formatMoney(ind.expense.top.totalCents)} · ${formatPercent(ind.expense.top.percent)} de tus gastos</span>`
              : html`<span class="muted">Sin gastos este mes</span>`}</dd></div>
            <div><dt>Categoría de menor consumo</dt><dd>${ind.expense.low
              ? html`${ind.expense.low.name}<span class="facts__note">${formatMoney(ind.expense.low.totalCents)} · ${formatPercent(ind.expense.low.percent)}</span>`
              : html`<span class="muted">Hacen falta al menos dos categorías</span>`}</dd></div>
            <div><dt>Cambio frente a ${monthLabel(prevKey)}</dt><dd>${delta(ind.expense.changePercent, { upIsGood: false, since: monthLabel(prevKey) })}</dd></div>
          </dl>
        </div>
        <div class="indicator-group">
          <h3 class="indicator-group__title">Ahorro</h3>
          <dl class="facts">
            <div><dt>Ahorro neto del mes</dt><dd>${money(ind.saving.monthNetCents, { tone: 'auto' })}</dd></div>
            <div><dt>Tasa de ahorro</dt><dd>${ind.saving.ratePercent === null
              ? html`<span class="muted">Sin ingresos este mes</span>`
              : html`${formatPercent(ind.saving.ratePercent)}<span class="facts__note">de tus ingresos del mes</span>`}</dd></div>
            <div><dt>Ahorro acumulado en metas</dt><dd>${money(ind.saving.accumulatedCents)}</dd></div>
          </dl>
        </div>
      </div>
      <p class="panel__foot">Los promedios usan solo los meses que tienen registros, hasta ${monthLabel(monthKey)}.</p>
    </section>

    <section class="panel" aria-labelledby="st-goals">
      <div class="panel__head">
        <h2 class="panel__title" id="st-goals">Progreso de metas</h2>
        <button type="button" class="link-btn" data-action="go" data-route="metas">Ver metas</button>
      </div>
      ${goalRows.length === 0
        ? html`<p class="muted">Aún no tienes metas.</p>`
        : html`<ul class="goal-progress">${goalRows.map(
            ({ goal, info, pace }) => html`<li>
              <div class="goal-progress__head"><span>${goal.name}</span><span class="muted">${formatPercent(info.percent)}</span></div>
              ${progress(info.percent, `Progreso de ${goal.name}`)}
              ${goalPaceBlock(pace, { overdue: info.overdue })}
            </li>`,
          )}</ul>`}
    </section>

    <section class="panel" aria-labelledby="st-debts">
      <div class="panel__head">
        <h2 class="panel__title" id="st-debts">Deudas</h2>
        <button type="button" class="link-btn" data-action="go" data-route="deudas">Ver deudas</button>
      </div>
      ${debts.items.length === 0
        ? html`<p class="muted">Aún no tienes deudas registradas.</p>`
        : html`<dl class="kpis">
              <div class="kpi"><dt>Total que debes</dt><dd>${money(debts.totalOwedCents)}</dd><dd class="kpi__note">${debts.active.length} activas · ${debts.paid.length} pagadas</dd></div>
              <div class="kpi"><dt>Intereses pagados</dt><dd>${money(debts.interestPaidCents)}</dd><dd class="kpi__note">Hasta hoy</dd></div>
              <div class="kpi"><dt>Intereses por pagar</dt><dd>${money(debts.interestRemainingCents)}</dd><dd class="kpi__note">Si sigues el plan</dd></div>
              <div class="kpi"><dt>Riesgo promedio</dt><dd class="kpi__badge">${debts.avgRisk === null || debts.avgRiskLevel === null ? '—' : riskBadge(debts.avgRiskLevel, debts.avgRisk)}</dd><dd class="kpi__note">De 0 a 100</dd></div>
            </dl>
            <h3 class="indicator-group__title">Lo que debes, mes a mes</h3>
            ${hasOwedHistory
              ? html`<div class="chart-host" id="chart-owed" role="presentation"></div>
                  ${tableView({
                    caption: 'Total que debes al cierre de cada mes',
                    headers: ['Mes', 'Debes', 'Deudas con saldo'],
                    rows: owedSeries.map((o) => [monthLabel(o.monthKey), formatMoney(o.owedCents), o.activeCount]),
                  })}
                  <p class="panel__foot">Cada punto es el cierre del mes (el último es hoy). Baja solo con el capital que pagas, no con los intereses.</p>`
              : html`<p class="muted">La gráfica aparece cuando haya al menos dos meses de historia con deudas.</p>`}
            ${debtCats.length > 0
              ? html`<h3 class="indicator-group__title">Deuda por tipo de garantía</h3>
                  <div class="chart-host" id="chart-debts" role="presentation"></div>
                  ${tableView({
                    caption: 'Deuda pendiente por tipo de garantía',
                    headers: ['Garantía', 'Debes', 'Deudas'],
                    rows: debtCats.map((c) => [c.label, formatMoney(c.balanceCents), c.count]),
                  })}`
              : html`<p class="muted">No tienes deudas pendientes.</p>`}`}
    </section>

    <section class="panel" aria-labelledby="st-export">
      <div class="panel__head"><h2 class="panel__title" id="st-export">Exportar reporte de ${monthLabel(monthKey)}</h2></div>
      <p class="panel__sub">Resumen, categorías y todos los movimientos del mes. Se crea en tu dispositivo.</p>
      ${exportButtons({ kind: 'month', month: monthKey, label: `Exportar el reporte de ${monthLabel(monthKey)}` })}
      <p class="panel__foot">El CSV trae solo la lista de movimientos; el Excel y el PDF traen también el resumen.</p>
    </section>`}
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

      draw('chart-cols', (host) =>
        columnChart(host, {
          labels: periods.map((p) => p.shortLabel),
          titles: periods.map(periodTitle),
          series: [
            { name: 'Ingresos', cls: 'income', values: periods.map((p) => p.incomeCents) },
            { name: 'Gastos', cls: 'expense', values: periods.map((p) => p.expenseCents) },
          ],
          ariaLabel: `Ingresos y gastos (${GRANULARITY_LABELS[granularity].toLowerCase()}), terminando en ${lastPeriod.label}`,
        }));
      draw('chart-owed', (host) =>
        lineChart(host, {
          labels: owedSeries.map((o) => monthShortLabel(o.monthKey)),
          titles: owedSeries.map((o) => monthLabel(o.monthKey)),
          values: owedSeries.map((o) => o.owedCents),
          name: 'Debes',
          cls: 'expense',
          ariaLabel: `Total que debes al cierre de cada mes, de ${monthLabel(owedSeries[0].monthKey)} a ${monthLabel(owedSeries[owedSeries.length - 1].monthKey)}`,
        }));
      draw('chart-line', (host) =>
        lineChart(host, {
          labels: available.map((a) => monthShortLabel(a.monthKey)),
          titles: available.map((a) => monthLabel(a.monthKey)),
          values: available.map((a) => a.availableCents),
          name: 'Disponible',
          cls: 'primary',
          ariaLabel: 'Dinero disponible al cierre de cada mes',
        }));
      draw('chart-exp', (host) => hBarChart(host, { items: expenseBars, cls: 'expense', ariaLabel: `Gastos por categoría en ${monthLabel(monthKey)}` }));
      draw('chart-inc', (host) => hBarChart(host, { items: incomeBars, cls: 'income', ariaLabel: `Ingresos por categoría en ${monthLabel(monthKey)}` }));
      draw('chart-debts', (host) => hBarChart(host, { items: debtBars, cls: 'expense', ariaLabel: 'Deuda pendiente por tipo de garantía' }));
      draw('chart-cexp', (host) =>
        segmentBar(host, {
          segments: expenseClasses.map((c, i) => ({ label: CLASSIFICATION_LABELS_PLURAL[c.classification], valueCents: c.totalCents, cls: expenseRamp[i] })),
          totalCents: totals.expenseCents,
          ariaLabel: `Gastos de ${monthLabel(monthKey)} por clasificación`,
        }));
      draw('chart-cinc', (host) =>
        segmentBar(host, {
          segments: incomeClasses.map((c, i) => ({ label: CLASSIFICATION_LABELS_PLURAL[c.classification], valueCents: c.totalCents, cls: incomeRamp[i] })),
          totalCents: totals.incomeCents,
          ariaLabel: `Ingresos de ${monthLabel(monthKey)} por clasificación`,
        }));

      // Al cambiar de vista la pantalla se vuelve a dibujar: el foco vuelve al botón que se usó (teclado y lectores de pantalla).
      if (view.refocus) {
        const again = root.querySelector(`[data-action="period"][data-period="${view.refocus}"]`);
        if (again instanceof HTMLElement) again.focus({ preventScroll: true });
        view.refocus = null;
      }

      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (!el) return;
          if (el.dataset.action === 'period') {
            const next = el.dataset.period;
            if (next === 'month' || next === 'quarter' || next === 'year') {
              view.granularity = next;
              view.refocus = next;
              ctx.rerender();
            }
          } else if (el.dataset.action === 'month-prev') {
            view.monthKey = prevKey;
            ctx.rerender();
          } else if (el.dataset.action === 'month-next' && monthKey < nowKey) {
            const next = addMonths(monthKey, 1);
            view.monthKey = next >= nowKey ? null : next;
            ctx.rerender();
          }
        },
        { signal },
      );

      return () => stops.forEach((stop) => stop());
    },
  };
}
