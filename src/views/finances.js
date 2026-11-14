// @ts-check
// =============================================================================
// FINANZAS (documento maestro §18)
// Centro operativo: todos los ingresos, gastos y ahorros de un mes, con filtro
// y búsqueda. Tocar un movimiento lo abre para editarlo o borrarlo.
// =============================================================================

import { movementLinkText } from '../domain/clients.js';
import { movementDepartmentText } from '../domain/departments.js';
import { addMonths, currentMonthKey, monthKeyOf, monthLabel } from '../domain/dates.js';
import { monthTotals, netContributions } from '../domain/summaries.js';
import { CLASSIFICATION_LABELS } from '../domain/types.js';
import { contributionRow, delta, demoBanner, emptyState, financeTabs, groupedByDay, monthSelector, movementRow, money } from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { html, setHtml } from '../ui/html.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/** Estado propio de esta pantalla (se conserva mientras no recargues la página). */
const view = {
  /** @type {string | null} null = el mes actual */
  monthKey: null,
  /** @type {'all' | 'income' | 'expense' | 'saving'} */
  filter: 'all',
  query: '',
};

const FILTERS = /** @type {const} */ ([
  { id: 'all', label: 'Todo' },
  { id: 'income', label: 'Ingresos' },
  { id: 'expense', label: 'Gastos' },
  { id: 'saving', label: 'Ahorro' },
]);

/** Quita tildes y mayúsculas para que "cafe" encuentre "Café". @param {string} text */
const normalize = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderFinances(store, ctx) {
  const { data } = store.getState();
  const today = store.today();
  const nowKey = currentMonthKey(store.now());
  const monthKey = view.monthKey ?? nowKey;
  const prevKey = addMonths(monthKey, -1);

  const totals = monthTotals(data.movements, monthKey);
  const prevTotals = monthTotals(data.movements, prevKey);
  const saved = netContributions(data.contributions.filter((c) => c.date <= today), monthKey);
  const hasAnything = data.movements.length > 0 || data.contributions.length > 0;

  /** Lista del mes, ya filtrada y agrupada por día. */
  const resultsHtml = () => {
    const needle = normalize(view.query.trim());

    /** @type {{ date: string, time: string, createdAt: string, content: import('../ui/html.js').SafeHtml, text: string }[]} */
    const items = [];

    if (view.filter === 'all' || view.filter === 'income' || view.filter === 'expense') {
      for (const m of data.movements) {
        if (monthKeyOf(m.date) !== monthKey) continue;
        if (view.filter !== 'all' && m.type !== view.filter) continue;
        const category = data.categories.find((c) => c.id === m.categoryId);
        const linkText = movementLinkText(data, m) || movementDepartmentText(data, m);
        items.push({
          date: m.date,
          time: m.time,
          createdAt: m.createdAt,
          content: movementRow(m, category, linkText),
          text: normalize(`${m.description} ${category?.name ?? ''} ${CLASSIFICATION_LABELS[m.classification]} ${linkText}`),
        });
      }
    }
    if (view.filter === 'all' || view.filter === 'saving') {
      for (const c of data.contributions) {
        if (monthKeyOf(c.date) !== monthKey || c.date > today) continue;
        const goal = data.goals.find((g) => g.id === c.goalId);
        items.push({
          date: c.date,
          time: c.time,
          createdAt: c.createdAt,
          content: contributionRow(c, goal),
          text: normalize(`${goal?.name ?? ''} ${c.note} ahorro`),
        });
      }
    }

    const found = needle ? items.filter((i) => i.text.includes(needle)) : items;
    found.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.createdAt.localeCompare(a.createdAt));

    if (found.length === 0) {
      const searching = needle !== '' || view.filter !== 'all';
      return searching
        ? html`<p class="muted empty-line" role="status">No hay movimientos con ese filtro en ${monthLabel(monthKey)}.</p>`
        : html`<p class="muted empty-line" role="status">No hay movimientos en ${monthLabel(monthKey)}.</p>`;
    }
    return html`<p class="muted count-line" role="status">${found.length} ${found.length === 1 ? 'registro' : 'registros'}</p>
      ${groupedByDay(found.map((i) => ({ date: i.date, content: i.content })))}`;
  };

  const page = html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Tus ingresos, gastos y ahorros. Toca un movimiento para editarlo.</p>
      </div>
    </header>

    ${financeTabs('movimientos', store)}
    ${demoBanner(store.hasDemoData())}

    ${hasAnything
      ? html`
    ${monthSelector(monthKey, { canGoNext: monthKey < nowKey })}

    <section class="panel" aria-label="Resumen de ${monthLabel(monthKey)}">
      <dl class="kpis">
        <div class="kpi"><dt>Ingresos</dt><dd>${money(totals.incomeCents)}</dd>
          <dd class="kpi__note">${delta(prevTotals.incomeCents > 0 ? ((totals.incomeCents - prevTotals.incomeCents) / prevTotals.incomeCents) * 100 : null, { upIsGood: true, since: 'mes anterior' })}</dd></div>
        <div class="kpi"><dt>Gastos</dt><dd>${money(totals.expenseCents)}</dd>
          <dd class="kpi__note">${delta(prevTotals.expenseCents > 0 ? ((totals.expenseCents - prevTotals.expenseCents) / prevTotals.expenseCents) * 100 : null, { upIsGood: false, since: 'mes anterior' })}</dd></div>
        <div class="kpi"><dt>Balance del mes</dt><dd>${money(totals.balanceCents, { tone: 'auto' })}</dd><dd class="kpi__note">Ingresos menos gastos</dd></div>
        <div class="kpi"><dt>Ahorro del mes</dt><dd>${money(saved, { tone: 'auto' })}</dd><dd class="kpi__note">Aportes menos retiros</dd></div>
      </dl>
    </section>

    <section class="panel" aria-label="Movimientos">
      <div class="toolbar">
        <div class="filter-group" role="group" aria-label="Filtrar por tipo">
          ${FILTERS.map(
            (f) => html`<button type="button" class="filter-chip" data-action="filter" data-value="${f.id}" aria-pressed="${view.filter === f.id ? 'true' : 'false'}">${f.label}</button>`,
          )}
        </div>
        <div class="search">
          <label for="fin-search" class="sr-only">Buscar en ${monthLabel(monthKey)}</label>
          <input id="fin-search" class="input" type="search" placeholder="Buscar en este mes…" value="${view.query}" autocomplete="off" maxlength="80" />
        </div>
      </div>
      <div id="fin-results">${resultsHtml()}</div>
    </section>`
      : html`<section class="panel">${emptyState({
          icon: 'swap',
          title: 'Tu primer movimiento te está esperando',
          text: 'Aquí verás todo lo que registres, organizado por día. Empieza con tu primer ingreso o gasto.',
          actions: html`<button type="button" class="btn btn--primary" data-action="add-income">Registrar ingreso</button>
            <button type="button" class="btn btn--ghost" data-action="add-expense">Registrar gasto</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`}
  `;

  return {
    html: page,
    mount(root, signal) {
      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (!el) return;
          const action = el.dataset.action;
          if (action === 'month-prev') {
            view.monthKey = addMonths(monthKey, -1);
            ctx.rerender();
          } else if (action === 'month-next' && monthKey < nowKey) {
            const next = addMonths(monthKey, 1);
            view.monthKey = next >= nowKey ? null : next;
            ctx.rerender();
          } else if (action === 'filter') {
            const value = el.dataset.value;
            if (value === 'all' || value === 'income' || value === 'expense' || value === 'saving') {
              view.filter = value;
              ctx.rerender();
            }
          }
        },
        { signal },
      );

      // La búsqueda solo redibuja la lista, para no perder el cursor al escribir.
      const search = root.querySelector('#fin-search');
      const results = root.querySelector('#fin-results');
      if (search instanceof HTMLInputElement && results instanceof HTMLElement) {
        search.addEventListener(
          'input',
          () => {
            view.query = search.value;
            setHtml(results, resultsHtml());
          },
          { signal },
        );
      }
    },
  };
}
