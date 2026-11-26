// @ts-check
// =============================================================================
// METAS (documento maestro §11 y §19)
// Primera versión: metas de ahorro con monto, fecha y progreso real, calculado
// a partir de los aportes y retiros que registras.
//
// Todavía NO existe (Etapa 3 en adelante): vincular metas a una cuenta,
// aportes automáticos, simulaciones ni metas de deuda o patrimonio.
// =============================================================================

import { formatDate } from '../domain/dates.js';
import { goalFeasibility } from '../domain/diagnosis.js';
import { feasibilityText } from '../domain/diagnosisCards.js';
import { goalPace, goalProgress, HORIZON_LABELS } from '../domain/goals.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { contributionRow, demoBadge, demoBanner, emptyState, feasibilityBlock, goalPaceBlock, money, progress } from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { goalArt } from '../ui/categoryArt.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openContributionForm, openGoalForm } from './forms.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/** Metas con el historial desplegado (se conserva mientras no recargues). */
const expanded = new Set();

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderGoals(store, ctx) {
  const { data } = store.getState();
  const today = store.today();

  const rows = data.goals
    .map((goal) => ({ goal, info: goalProgress(goal, data.contributions, today) }))
    .sort((a, b) => a.goal.targetDate.localeCompare(b.goal.targetDate) || a.goal.createdAt.localeCompare(b.goal.createdAt));
  const pending = rows.filter((r) => !r.info.completed);
  const done = rows.filter((r) => r.info.completed);
  const totalSaved = rows.reduce((sum, r) => sum + r.info.savedCents, 0);
  // ¿Cabe cada meta en la capacidad de ahorro? (una sola capacidad repartida por fecha; ver domain/diagnosis.js)
  const feasibility = goalFeasibility(data, today);
  const feasibilityById = new Map(feasibility.goals.map((g) => [g.goal.id, g]));

  /** @param {typeof rows[number]} row */
  const card = ({ goal, info }) => {
    const history = data.contributions
      .filter((c) => c.goalId === goal.id && c.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.createdAt.localeCompare(a.createdAt));
    const open = expanded.has(goal.id);
    const historyId = `goal-history-${goal.id}`;

    return html`<article class="goal${info.completed ? ' goal--done' : ''}" aria-labelledby="goal-name-${goal.id}">
      <header class="goal__head">
        ${goalArt(goal)}
        <div class="goal__title">
          <h3 class="goal__name" id="goal-name-${goal.id}">${goal.name}</h3>
          ${goal.description ? html`<p class="goal__desc">${goal.description}</p>` : ''}
        </div>
        <div class="goal__tags">
          <span class="chip">${HORIZON_LABELS[info.horizon]}</span>
          ${goal.isDemo ? demoBadge() : ''}
        </div>
      </header>

      ${progress(info.percent, `Progreso de la meta ${goal.name}`)}
      <p class="goal__figures">
        <span><strong>${formatMoney(info.savedCents)}</strong> de ${formatMoney(goal.targetCents)}</span>
        <span class="goal__percent">${formatPercent(info.percent)}</span>
      </p>

      <dl class="goal__facts">
        <div><dt>Falta</dt><dd>${info.completed ? html`${icon('check', 16)} Cumplida` : money(info.remainingCents)}</dd></div>
        <div><dt>Fecha objetivo</dt><dd>${formatDate(goal.targetDate)}</dd></div>
        <div><dt>Tiempo</dt><dd class="${info.overdue ? 'text-alert' : ''}">${info.timeLeftText}</dd></div>
        ${!info.completed && !info.overdue && info.monthlyNeededCents > 0
          ? html`<div><dt>Aporte mensual sugerido</dt><dd>${money(info.monthlyNeededCents, { decimals: false })}</dd></div>`
          : ''}
      </dl>

      ${goalPaceBlock(goalPace(goal, data.contributions, today), { overdue: info.overdue })}
      ${feasibilityById.has(goal.id) ? feasibilityBlock(feasibilityText(/** @type {import('../domain/diagnosis.js').GoalFeasibility} */ (feasibilityById.get(goal.id)), feasibility.capacityCents)) : ''}

      <div class="goal__actions">
        <button type="button" class="btn btn--primary btn--small" data-action="goal-deposit" data-id="${goal.id}">Aportar</button>
        <button type="button" class="btn btn--ghost btn--small" data-action="goal-withdraw" data-id="${goal.id}" ${info.savedCents > 0 ? '' : 'disabled'}>Retirar</button>
        <button type="button" class="btn btn--ghost btn--small" data-action="goal-edit" data-id="${goal.id}">Editar</button>
        <button type="button" class="link-btn goal__toggle" data-action="goal-history" data-id="${goal.id}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${historyId}">
          ${open ? 'Ocultar historial' : `Historial (${history.length})`}
        </button>
      </div>

      <div id="${historyId}" ${open ? '' : 'hidden'}>
        ${history.length === 0
          ? html`<p class="muted">Todavía no hay aportes para esta meta.</p>`
          : html`<ul class="rows">${history.map((c) => contributionRow(c, goal))}</ul>`}
      </div>
    </article>`;
  };

  const page = html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Metas</h1>
        <p class="page-subtitle">Cada meta tiene un propósito, un monto y una fecha.</p>
      </div>
      <button type="button" class="btn btn--primary" data-action="new-goal">${icon('plus', 18)}Nueva meta</button>
    </header>

    ${demoBanner(store.hasDemoData())}

    ${rows.length === 0
      ? html`<section class="panel">${emptyState({
          icon: 'target',
          title: 'Crea tu primera meta de ahorro',
          text: 'Define para qué quieres ahorrar, cuánto necesitas y para cuándo. Luego apartas dinero con “Aportar” y ves tu progreso real.',
          actions: html`<button type="button" class="btn btn--primary" data-action="new-goal">Crear una meta</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    <section class="panel panel--summary" aria-label="Resumen de metas">
      <dl class="kpis">
        <div class="kpi"><dt>Ahorrado en metas</dt><dd>${money(totalSaved)}</dd><dd class="kpi__note">Aportes menos retiros</dd></div>
        <div class="kpi"><dt>Metas en marcha</dt><dd class="kpi__big">${pending.length}</dd><dd class="kpi__note">${done.length} ${done.length === 1 ? 'cumplida' : 'cumplidas'}</dd></div>
      </dl>
      ${pending.length > 0
        ? html`<p class="panel__foot" id="goals-capacity">${feasibility.capacityCents === null
          ? 'Cuando registres ingresos y gastos de un mes, aquí verás si tus metas caben en lo que te sobra cada mes.'
          : `Lo que te sobra cada mes (${formatMoney(feasibility.capacityCents, { decimals: false })}) es uno solo para todas las metas: se reparte por orden de fecha. `}
          ${store.diagnosisEnabled() ? html`<a href="#/diagnostico">Ver el diagnóstico completo</a>` : ''}</p>`
        : ''}
    </section>

    ${pending.length > 0 ? html`<section class="goal-list" aria-label="Metas en marcha">${pending.map(card)}</section>` : ''}
    ${done.length > 0
      ? html`<h2 class="section-title">Cumplidas</h2><section class="goal-list" aria-label="Metas cumplidas">${done.map(card)}</section>`
      : ''}`}
  `;

  return {
    html: page,
    mount(root, signal) {
      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (!el) return;
          const goal = data.goals.find((g) => g.id === el.dataset.id);
          switch (el.dataset.action) {
            case 'goal-deposit':
              if (goal) openContributionForm(store, { goalId: goal.id, kind: 'deposit' });
              break;
            case 'goal-withdraw':
              if (goal) openContributionForm(store, { goalId: goal.id, kind: 'withdrawal' });
              break;
            case 'goal-edit':
              if (goal) openGoalForm(store, { goal });
              break;
            case 'goal-history':
              if (goal) {
                if (expanded.has(goal.id)) expanded.delete(goal.id);
                else expanded.add(goal.id);
                ctx.rerender();
              }
              break;
            default:
          }
        },
        { signal },
      );
    },
  };
}
