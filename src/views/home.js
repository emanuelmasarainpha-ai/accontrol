// @ts-check
// =============================================================================
// INICIO (documento maestro §17)
// Saludo, dinero disponible, resumen del mes, meta principal, avisos y últimos
// movimientos. Todo se calcula en el momento a partir de los datos guardados.
//
// Del documento §17 todavía NO están (se construyen en etapas posteriores):
//   Patrimonio neto (Etapa 4), Alertas IA (Etapa 5).
// =============================================================================

import { accumulatedProfit, businessVerdict, incomeStatement, periodBounds, periodComparison, projectResults } from '../domain/business.js';
import { clientFullName, movementLinkText } from '../domain/clients.js';
import { movementDepartmentText } from '../domain/departments.js';
import { companyHealth } from '../domain/company.js';
import { inventorySummary } from '../domain/inventory.js';
import { invoiceReceivables } from '../domain/invoices.js';
import { healthSummaryText } from '../domain/companyCards.js';
import { clientRanking, clientSummaries, freelancerFlow, receivables, topServices } from '../domain/freelance.js';
import { addMonths, currentMonthKey, dayPhase, formatDate, formatDateLong, greetingFor, monthLabel, monthName, monthShortLabel, plural } from '../domain/dates.js';
import { skyArt } from '../ui/skyArt.js';
import { buildBudget } from '../domain/budget.js';
import { netWorthSummary } from '../domain/netWorth.js';
import { debtPortfolio } from '../domain/debts.js';
import { goalProgress, primaryGoal } from '../domain/goals.js';
import { centsToInputValue, currencySymbol, formatMoney, formatPercent } from '../domain/money.js';
import { compareNewestFirst } from '../domain/movements.js';
import { computeNotices } from '../domain/notices.js';
import {
  changePercent, monthlySeries, monthTotals, netContributions, overallTotals,
} from '../domain/summaries.js';
import { columnChart, segmentBar } from '../ui/charts.js';
import { guillocheRosette } from '../ui/guilloche.js';
import {
  delta, demoBanner, emptyState, heroMoney, legend, money, movementRow, netWorthCard, progress, riskBadge, tableView,
} from '../ui/components.js';
import { $ } from '../ui/dom.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { isOrganizationEmpty } from '../domain/organization.js';
import { KIND_INFO } from '../domain/workspaces.js';
import { dueText } from './debts.js';
import { gamificationFor, levelCard } from './achievements.js';
import { diagnosisHomeCard } from './diagnosis.js';
import { changeText } from './results.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/**
 * Franja de microtexto de seguridad del «billete» (decorativa, como en los billetes de verdad): el nombre del
 * espacio repetido. Va oculta para el lector de pantalla.
 * @param {string} name
 */
export function microtext(name) {
  const unit = `${name.toLocaleUpperCase('es')} · ACCONTROL · ${currencySymbol()} · `;
  return unit.repeat(Math.max(4, Math.ceil(240 / unit.length)));
}

/**
 * @param {Store} store
 * @returns {{ html: import('../ui/html.js').SafeHtml, mount: (root: HTMLElement, signal: AbortSignal) => (() => void) }}
 */
export function renderHome(store) {
  const { data } = store.getState();
  const today = store.today();
  const monthKey = currentMonthKey(store.now());
  const prevKey = addMonths(monthKey, -1);

  const totals = overallTotals(data, today);
  const month = monthTotals(data.movements, monthKey);
  const prev = monthTotals(data.movements, prevKey);
  const monthSaved = netContributions(data.contributions.filter((c) => c.date <= today), monthKey);
  const hasDemo = store.hasDemoData();
  const isEmpty = data.movements.length === 0 && data.goals.length === 0 && data.contributions.length === 0 && data.debts.length === 0;

  const workspace = store.activeWorkspace();
  const name = data.settings.displayName;
  const hour = store.now().getHours();
  const greeting = `${greetingFor(hour)}${name ? `, ${name}` : ''}`;

  // ---- Reparto del mes: ¿a dónde fue lo que ingresó? ------------------------
  const savedPositive = Math.max(0, monthSaved);
  const free = month.incomeCents - month.expenseCents - savedPositive;
  const overspent = month.incomeCents > 0 && free < 0;
  const spentWithoutIncome = month.incomeCents === 0 && (month.expenseCents > 0 || savedPositive > 0);
  const flowSegments = [
    { label: 'Gastos', valueCents: month.expenseCents, cls: 'expense' },
    { label: 'Apartado en metas', valueCents: savedPositive, cls: 'saving' },
    { label: 'Libre', valueCents: Math.max(0, free), cls: 'free' },
  ];
  const flowTotal = flowSegments.reduce((s, x) => s + x.valueCents, 0);

  // ---- Meta principal, avisos y movimientos recientes -----------------------
  const goal = primaryGoal(data.goals, data.contributions);
  const goalInfo = goal ? goalProgress(goal, data.contributions, today) : null;
  const notices = computeNotices(data, today, { kind: workspace?.kind ?? null }).slice(0, 4);
  const recent = [...data.movements].sort(compareNewestFirst).slice(0, 5);

  // ---- Próximas deudas: las 3 cuotas que vencen primero ------------------------
  const debts = debtPortfolio(data, today);
  const netWorth = netWorthSummary(data, today);
  const upcomingDebts = debts.active
    .filter((i) => i.status.next)
    .sort((a, b) => (a.status.next?.date ?? '').localeCompare(b.status.next?.date ?? '') || b.risk.score - a.risk.score)
    .slice(0, 3);

  const budget = buildBudget(data, today);

  // ---- Panel Freelancer (solo en espacios que usan clientes) ----------------------------------------------
  const fl = store.clientsEnabled()
    ? (() => {
        const rows = clientSummaries(data, { range: 'year', today });
        return {
          hasClients: data.clients.length > 0,
          flow: freelancerFlow(data, today),
          owed: receivables(data, today),
          ranking: clientRanking(rows),
          services: topServices(data, today).slice(0, 3),
        };
      })()
    : null;

  // ---- Panel de negocio (Emprendedor y Empresa) ---------------------------------------------------------------
  const biz = store.resultsEnabled()
    ? {
        hasData: data.movements.some((m) => m.date <= today),
        statement: incomeStatement(data, periodBounds('month', monthKey), today),
        comparison: periodComparison(data, 'month', monthKey, today),
        accumulated: accumulatedProfit(data, today),
        verdict: businessVerdict(data, today),
        projection: projectResults(data, today),
        health: store.healthEnabled() ? companyHealth(data, today) : null,
        inventory: store.inventoryEnabled() ? inventorySummary(data) : null,
        receivables: store.invoicesEnabled() && data.invoices.length > 0 ? invoiceReceivables(data, today) : null,
      }
    : null;

  // ---- Tendencia de 6 meses --------------------------------------------------
  const monthKeys = Array.from({ length: 6 }, (_, i) => addMonths(monthKey, i - 5));
  const series = monthlySeries(data.movements, data.contributions, monthKeys);
  const hasTrend = series.some((s) => s.incomeCents > 0 || s.expenseCents > 0);

  const page = html`
    <header class="page-header page-header--sky">
      <div>
        <h1 class="page-title">${greeting}</h1>
        <p class="page-subtitle">${workspace ? `${workspace.name} · ` : ''}${formatDateLong(today)}</p>
      </div>
      ${skyArt(dayPhase(hour))}
    </header>

    <section class="hero${totals.availableCents < 0 ? ' hero--negative' : ''}" aria-labelledby="hero-label" data-tour="home-available">
      ${guillocheRosette('hero__rosette')}
      <p class="hero__label" id="hero-label">Disponible${hasDemo ? html` <span class="badge badge--demo hero__demo">DEMO</span>` : ''}</p>
      ${heroMoney(totals.availableCents)}
      <p class="hero__caption">Tu saldo inicial más ingresos, menos gastos y lo que apartaste en metas.</p>
      <div class="hero__actions">
        <button type="button" class="btn btn--primary" data-action="add-income">${icon('plus', 18)}Registrar ingreso</button>
        <button type="button" class="btn btn--ghost" data-action="add-expense">${icon('plus', 18)}Registrar gasto</button>
      </div>
      <span class="hero__micro" aria-hidden="true">${microtext(workspace?.name ?? 'ACCONTROL')}</span>
    </section>

    ${demoBanner(hasDemo)}
    ${workspace && workspace.kind === 'freelancer'
      ? html`<div class="banner" role="note">
          <p class="banner__text"><strong>Espacio Freelancer.</strong> Lleva tus clientes y servicios en <a href="#/clientes">Finanzas → Clientes</a> y vincula cada cobro a su cliente: así ves quién te paga más y quién te debe. Aún no están (${KIND_INFO.freelancer.soon.join('; ').toLowerCase()}).${isOrganizationEmpty(workspace.organization) ? html` <a href="#/ajustes/espacios">Completa tus datos profesionales</a> para que salgan en tus reportes.` : ''}</p>
        </div>`
      : workspace && (workspace.kind === 'entrepreneur' || workspace.kind === 'company')
      ? html`<div class="banner" role="note">
          <p class="banner__text"><strong>Espacio ${KIND_INFO[workspace.kind].label}.</strong> Mira cómo le va a tu negocio en <a href="#/resultados">Finanzas → Resultados</a>: beneficio, margen, comparación con el mes anterior y proyección.${workspace.kind === 'company' ? html` Y en <a href="#/salud">Finanzas → Salud</a>: punto de equilibrio, meses de efectivo y peso de la deuda.` : ''} Lleva tus productos, stock, proveedores y ganancia por producto en <a href="#/inventario">Finanzas → Inventario</a>, y lo que te deben en <a href="#/facturas">Finanzas → Facturas</a>. Lo demás de esta modalidad (${KIND_INFO[workspace.kind].soon.join('; ').toLowerCase()}) aún no está.${isOrganizationEmpty(workspace.organization) ? html` <a href="#/ajustes/espacios">Completa los datos de tu negocio</a> para que salgan en tus reportes.` : ''}</p>
        </div>`
      : ''}

    ${fl ? freelancerPanel(fl, monthKey, today) : ''}
    ${biz ? businessPanel(biz, monthKey, prevKey) : ''}

    ${isEmpty ? '' : netWorthCard(netWorth, today, { link: true })}

    ${isEmpty
      ? html`<section class="panel panel--welcome" aria-labelledby="welcome-title">
          ${emptyState({
            icon: 'home',
            title: 'Aquí empieza tu historia financiera',
            text: 'Registra un ingreso o un gasto y aquí verás tu balance, tus metas y tus gráficos. Todo se guarda en este dispositivo.',
            actions: html`<button type="button" class="btn btn--primary" data-action="add-income">Registrar ingreso</button>
              <button type="button" class="btn btn--ghost" data-action="add-expense">Registrar gasto</button>
              <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
          })}
          ${name
            ? ''
            : html`<form class="welcome-name" data-form="name" novalidate>
                <label for="welcome-name-input">¿Cómo te llamas? Así te saludo en esta pantalla.</label>
                <div class="inline-form">
                  <input id="welcome-name-input" class="input" name="displayName" type="text" maxlength="40" autocomplete="given-name" />
                  <button type="submit" class="btn btn--ghost">Guardar nombre</button>
                </div>
              </form>`}
        </section>`
      : html`
    <section class="panel" aria-labelledby="month-title">
      <div class="panel__head">
        <h2 class="panel__title" id="month-title">${monthLabel(monthKey)}</h2>
      </div>
      <dl class="kpis">
        <div class="kpi">
          <dt>Ingresos</dt>
          <dd>${money(month.incomeCents)}</dd>
          <dd class="kpi__note">${delta(changePercent(month.incomeCents, prev.incomeCents), { upIsGood: true, since: monthName(prevKey) })}</dd>
        </div>
        <div class="kpi">
          <dt>Gastos</dt>
          <dd>${money(month.expenseCents)}</dd>
          <dd class="kpi__note">${delta(changePercent(month.expenseCents, prev.expenseCents), { upIsGood: false, since: monthName(prevKey) })}</dd>
        </div>
        <div class="kpi">
          <dt>Balance del mes</dt>
          <dd>${money(month.balanceCents, { tone: 'auto' })}</dd>
          <dd class="kpi__note">Ingresos menos gastos</dd>
        </div>
        <div class="kpi">
          <dt>Ahorrado en metas</dt>
          <dd>${money(totals.savedCents)}</dd>
          <dd class="kpi__note">${data.goals.length === 0 ? 'Aún sin metas' : `${monthSaved >= 0 ? '+' : '-'}${formatMoney(Math.abs(monthSaved), { decimals: false }).replace('-', '')} este mes`}</dd>
        </div>
      </dl>

      <div class="flow">
        <h3 class="flow__title">¿A dónde fue lo que ingresó este mes?</h3>
        ${flowTotal > 0
          ? html`<div class="chart-host" id="flow-chart" role="presentation"></div>
              ${legend(flowSegments.map((s) => ({ label: s.label, cls: s.cls, value: formatMoney(s.valueCents, { decimals: false }) })))}`
          : html`<p class="muted">Todavía no hay movimientos este mes.</p>`}
        ${overspent
          ? html`<p class="flow__alert" role="status">${icon('alert', 16)}Este mes gastaste y apartaste ${formatMoney(-free)} más de lo que ingresó.</p>`
          : ''}
        ${spentWithoutIncome ? html`<p class="muted flow__note">Aún no registras ingresos este mes, por eso la barra muestra solo salidas.</p>` : ''}
      </div>
    </section>

    <div class="grid-2">
      <section class="panel" aria-labelledby="goal-title">
        <div class="panel__head">
          <h2 class="panel__title" id="goal-title">Meta principal</h2>
          <button type="button" class="link-btn" data-action="go" data-route="metas">Ver metas</button>
        </div>
        ${goal && goalInfo
          ? html`<div class="main-goal">
              <p class="main-goal__name">${goal.name}</p>
              ${progress(goalInfo.percent, `Progreso de ${goal.name}`)}
              <p class="main-goal__figures"><strong>${formatMoney(goalInfo.savedCents, { decimals: false })}</strong> de ${formatMoney(goal.targetCents, { decimals: false })} (${formatPercent(goalInfo.percent)})</p>
              <p class="muted">${goalInfo.timeLeftText}.${goalInfo.monthlyNeededCents > 0 ? ` Para llegar a tiempo necesitas aportar unos ${formatMoney(goalInfo.monthlyNeededCents, { decimals: false })} al mes.` : ''}</p>
              ${goal.isDemo ? html`<span class="badge badge--demo">DEMO</span>` : ''}
            </div>`
          : data.goals.length > 0
            ? html`<p class="muted">¡Todas tus metas están cumplidas!</p>`
            : emptyState({ icon: 'target', title: 'Sin metas todavía', text: 'Una meta tiene un propósito, un monto y una fecha.', actions: html`<button type="button" class="btn btn--ghost" data-action="new-goal">Crear una meta</button>` })}
      </section>

      <section class="panel" aria-labelledby="notices-title">
        <div class="panel__head"><h2 class="panel__title" id="notices-title">Avisos</h2></div>
        ${notices.length === 0
          ? html`<p class="muted">Sin avisos por ahora.</p>`
          : html`<ul class="notices">${notices.map(
              (n) => html`<li class="notice notice--${n.level}">${icon(n.level === 'critical' ? 'alert' : 'info', 18)}<span>${n.text}</span></li>`,
            )}</ul>`}
        <p class="panel__foot">Son reglas simples sobre tus datos, no inteligencia artificial.</p>
      </section>
    </div>

    ${isEmpty || !store.diagnosisEnabled() ? '' : diagnosisHomeCard(store)}
    ${isEmpty ? '' : levelCard(gamificationFor(store))}

    <div class="grid-2">
      <section class="panel" aria-labelledby="debts-title">
        <div class="panel__head">
          <h2 class="panel__title" id="debts-title">Próximas deudas</h2>
          <button type="button" class="link-btn" data-action="go" data-route="deudas">Ver deudas</button>
        </div>
        ${upcomingDebts.length === 0
          ? data.debts.length === 0
            ? html`<p class="muted">Sin deudas registradas.</p>
                <div class="actions actions--start"><button type="button" class="btn btn--ghost btn--small" data-action="new-debt">Añadir deuda</button></div>`
            : html`<p class="muted">No tienes cuotas pendientes. ¡Bien hecho!</p>`
          : html`<ul class="upcoming">${upcomingDebts.map((i) => {
              const next = /** @type {NonNullable<typeof i.status.next>} */ (i.status.next);
              return html`<li class="upcoming__item">
                <a class="upcoming__link" href="#/deudas/${i.debt.id}">
                  <span class="upcoming__main">
                    <span class="upcoming__name">${i.debt.name}</span>
                    <span class="upcoming__when${i.status.state === 'overdue' ? ' text-alert' : ''}">${i.status.state === 'overdue' ? 'Vencida' : 'Vence'} ${dueText(i.status.daysToNext ?? 0)} · ${formatDate(next.date)}</span>
                  </span>
                  <span class="upcoming__side">
                    <span class="upcoming__amount">${formatMoney(next.paymentCents)}</span>
                    ${riskBadge(i.risk.level, i.risk.score)}
                  </span>
                </a>
              </li>`;
            })}</ul>`}
      </section>

      <section class="panel" aria-labelledby="budget-title" data-tour="home-budget">
        <div class="panel__head"><h2 class="panel__title" id="budget-title">Presupuesto</h2></div>
        <dl class="budget">
          <div class="budget__row"><dt>Disponible hoy</dt><dd>${money(budget.availableCents, { tone: 'auto' })}</dd></div>
          <div class="budget__row"><dt>Comprometido este mes<small>${budget.committedCount === 0 ? 'Ninguna cuota de deuda vence antes de fin de mes' : `${plural(budget.committedCount, 'cuota de deuda', 'cuotas de deudas')} que vencen antes de fin de mes`}</small></dt><dd>${money(budget.committedCents)}</dd></div>
          <div class="budget__row budget__row--total"><dt>Te quedaría libre</dt><dd>${money(budget.freeAfterCommitmentsCents, { tone: 'auto' })}</dd></div>
        </dl>
        ${budget.freeAfterCommitmentsCents < 0
          ? html`<p class="flow__alert" role="status">${icon('alert', 16)}Tu dinero disponible no alcanza para las cuotas de este mes.</p>`
          : ''}

        <h3 class="budget__subtitle">Capacidad mensual estimada</h3>
        ${budget.savingsCapacityCents === null || budget.investmentCapacityCents === null
          ? html`<p class="muted">Cuando registres ingresos y gastos de un mes, aquí verás cuánto puedes ahorrar e invertir.</p>`
          : html`<dl class="budget">
              <div class="budget__row"><dt>Ingreso típico</dt><dd>${money(budget.baseline.incomeCents)}</dd></div>
              <div class="budget__row"><dt>Gasto típico<small>Sin contar pagos de deudas</small></dt><dd>${money(-budget.baseline.expenseCents)}</dd></div>
              <div class="budget__row"><dt>Cuotas de deudas<small>Equivalente mensual</small></dt><dd>${money(-budget.debtServiceCents)}</dd></div>
              <div class="budget__row budget__row--total"><dt>Capacidad de ahorro</dt><dd>${money(budget.savingsCapacityCents, { tone: 'auto' })}</dd></div>
              <div class="budget__row"><dt>Aportes que piden tus metas<small>Lo sugerido por mes</small></dt><dd>${money(-budget.goalsMonthlyCents)}</dd></div>
              <div class="budget__row budget__row--total"><dt>Capacidad de inversión</dt><dd>${money(budget.investmentCapacityCents, { tone: 'auto' })}</dd></div>
            </dl>
            ${budget.savingsCapacityCents < 0
              ? html`<p class="flow__alert" role="status">${icon('alert', 16)}Tus gastos y deudas superan tu ingreso típico en ${formatMoney(-budget.savingsCapacityCents)} al mes.</p>`
              : budget.investmentCapacityCents < 0
                ? html`<p class="flow__alert" role="status">${icon('alert', 16)}Tus metas piden aportar ${formatMoney(-budget.investmentCapacityCents)} más de lo que te sobra cada mes. Puedes alargar la fecha de alguna meta.</p>`
                : ''}
            <p class="panel__foot">${budget.baseline.partial
              ? 'Estimación con este mes en curso, porque aún no tienes un mes completo registrado.'
              : `Estimación con el promedio de tus últimos ${plural(budget.baseline.months, 'mes completo', 'meses completos')}.`} Es un cálculo con reglas fijas, no inteligencia artificial ni asesoría de inversión.</p>`}
      </section>
    </div>

    <section class="panel" aria-labelledby="trend-title">
      <div class="panel__head"><h2 class="panel__title" id="trend-title">Últimos 6 meses</h2></div>
      ${hasTrend
        ? html`${legend([{ label: 'Ingresos', cls: 'income' }, { label: 'Gastos', cls: 'expense' }])}
            <div class="chart-host" id="trend-chart" role="presentation"></div>
            ${tableView({
              caption: 'Ingresos y gastos de los últimos 6 meses',
              headers: ['Mes', 'Ingresos', 'Gastos'],
              rows: series.map((s) => [monthLabel(s.monthKey), formatMoney(s.incomeCents), formatMoney(s.expenseCents)]),
            })}`
        : html`<p class="muted">Cuando registres movimientos verás aquí cómo cambian mes a mes.</p>`}
    </section>

    <section class="panel" aria-labelledby="recent-title">
      <div class="panel__head">
        <h2 class="panel__title" id="recent-title">Últimos movimientos</h2>
        <button type="button" class="link-btn" data-action="go" data-route="finanzas">Ver todos</button>
      </div>
      ${recent.length === 0
        ? html`<p class="muted">Aquí aparecerán tus ingresos y gastos más recientes.</p>`
        : html`<ul class="rows">${recent.map((m) => movementRow(m, data.categories.find((c) => c.id === m.categoryId), movementLinkText(data, m) || movementDepartmentText(data, m)))}</ul>`}
    </section>`}
  `;

  return {
    html: page,
    mount(root, signal) {
      const cleanups = [];

      const flowHost = root.querySelector('#flow-chart');
      if (flowHost instanceof HTMLElement) {
        cleanups.push(
          segmentBar(flowHost, {
            segments: flowSegments,
            totalCents: flowTotal,
            ariaLabel: `Reparto de ${monthLabel(monthKey)}: gastos, apartado en metas y dinero libre`,
          }),
        );
      }
      const trendHost = root.querySelector('#trend-chart');
      if (trendHost instanceof HTMLElement) {
        cleanups.push(
          columnChart(trendHost, {
            labels: series.map((s) => monthShortLabel(s.monthKey)),
            titles: series.map((s) => monthLabel(s.monthKey)),
            series: [
              { name: 'Ingresos', cls: 'income', values: series.map((s) => s.incomeCents) },
              { name: 'Gastos', cls: 'expense', values: series.map((s) => s.expenseCents) },
            ],
            ariaLabel: 'Ingresos y gastos de los últimos 6 meses',
          }),
        );
      }

      // Guardar el nombre desde la tarjeta de bienvenida.
      const nameForm = root.querySelector('[data-form="name"]');
      if (nameForm instanceof HTMLFormElement) {
        nameForm.addEventListener(
          'submit',
          async (event) => {
            event.preventDefault();
            const value = /** @type {HTMLInputElement} */ ($('input[name="displayName"]', nameForm)).value;
            const opening = store.getState().data.settings.openingBalanceCents;
            const result = await store.saveSettings({
              displayName: value,
              openingText: opening > 0 ? centsToInputValue(opening) : '',
            });
            if (!result.ok) toast(Object.values(result.errors)[0] ?? 'No se pudo guardar el nombre.', 'error');
          },
          { signal },
        );
      }

      return () => cleanups.forEach((stop) => stop());
    },
  };
}


/**
 * Panel propio de la modalidad Freelancer (documento maestro §9): ingresos y flujo de caja, lo que te deben,
 * el ranking de clientes y los servicios más vendidos. Todo sale de domain/freelance.js.
 * @param {{ hasClients: boolean, flow: ReturnType<typeof freelancerFlow>, owed: ReturnType<typeof receivables>, ranking: ReturnType<typeof clientRanking>, services: ReturnType<typeof topServices> }} fl
 * @param {string} monthKey @param {string} today
 */
function freelancerPanel(fl, monthKey, today) {
  if (!fl.hasClients) {
    return html`<section class="panel" aria-labelledby="fl-title">
      <div class="panel__head"><h2 class="panel__title" id="fl-title">Tu trabajo freelance</h2></div>
      <p class="muted">Registra a tus clientes y los servicios que les vendes. Al cobrar, vincula el ingreso al cliente y aquí verás quién te paga más, quién te debe y cómo va tu flujo de caja.</p>
      <div class="actions actions--start">
        <button type="button" class="btn btn--primary btn--small" data-action="new-client">${icon('plus', 16)}Nuevo cliente</button>
        <button type="button" class="btn btn--ghost btn--small" data-action="load-demo">Ver con datos de demostración</button>
      </div>
    </section>`;
  }
  const { flow, owed, ranking, services } = fl;
  /** @param {string} label @param {{ client: import('../domain/types.js').Client } | null} r @param {string} detail */
  const tile = (label, r, detail) => html`<li class="rank">
    <p class="rank__label">${label}</p>
    ${r ? html`<p class="rank__name"><a href="#/clientes/${r.client.id}">${clientFullName(r.client)}</a></p>` : html`<p class="rank__name rank__name--none">—</p>`}
    <p class="rank__detail">${r ? detail : 'Sin datos todavía'}</p>
  </li>`;
  return html`<section class="panel" aria-labelledby="fl-title">
    <div class="panel__head">
      <h2 class="panel__title" id="fl-title">Tu trabajo freelance</h2>
      <button type="button" class="link-btn" data-action="go" data-route="clientes">Ver clientes</button>
    </div>
    <dl class="kpis">
      <div class="kpi"><dt>Flujo neto de ${monthName(monthKey)}</dt><dd>${money(flow.monthNetCents, { tone: 'auto' })}</dd><dd class="kpi__note">Ingresó ${formatMoney(flow.monthIncomeCents, { decimals: false })} · salió ${formatMoney(flow.monthExpenseCents, { decimals: false })}</dd></div>
      <div class="kpi"><dt>Acumulado de ${today.slice(0, 4)}</dt><dd>${money(flow.yearNetCents, { tone: 'auto' })}</dd><dd class="kpi__note">Ingresos ${formatMoney(flow.yearIncomeCents, { decimals: false })}</dd></div>
      <div class="kpi"><dt>Por cobrar</dt><dd>${money(owed.totalCents)}</dd><dd class="kpi__note">${owed.totalCents === 0 ? 'Nada pendiente' : [owed.rows.length > 0 ? plural(owed.rows.length, 'servicio sin facturar', 'servicios sin facturar') : '', owed.invoices.length > 0 ? plural(owed.invoices.length, 'factura', 'facturas') : ''].filter(Boolean).join(' · ')}</dd></div>
      <div class="kpi"><dt>Cobros sin cliente</dt><dd>${money(flow.unlinkedIncomeCents)}</dd><dd class="kpi__note">${flow.unlinkedIncomeCents > 0 ? 'Vincúlalos a un cliente al editarlos' : 'Todo está vinculado'}</dd></div>
    </dl>

    <h3 class="budget__subtitle">Ranking de clientes · este año</h3>
    <ul class="rank-grid">
      ${tile('Más rentable', ranking.mostProfitable, ranking.mostProfitable ? (ranking.mostProfitable.expenseCents > 0 ? `Te deja ${formatMoney(ranking.mostProfitable.netCents, { decimals: false })} (cobrado − gastos)` : `${formatMoney(ranking.mostProfitable.incomeCents, { decimals: false })} cobrados`) : '')}
      ${tile('Más recurrente', ranking.mostRecurrent, ranking.mostRecurrent ? `Pagó en ${plural(ranking.mostRecurrent.activeMonths, 'mes', 'meses')}` : '')}
      ${tile('Mayor deuda pendiente', ranking.mostOwing, ranking.mostOwing ? `Te debe ${formatMoney(ranking.mostOwing.owedCents, { decimals: false })}` : '')}
    </ul>

    ${services.length > 0
      ? html`<h3 class="budget__subtitle">Servicios más vendidos</h3>
          <ul class="rows">${services.map(
            (s) => html`<li class="row-item"><div class="row row--static">
              <span class="row__main"><span class="row__title">${s.name}</span><span class="row__meta"><span>${plural(s.count, 'vez', 'veces')}</span></span></span>
              <span class="row__side"><span class="row__amount row__amount--income">${formatMoney(s.paidCents, { decimals: false })}</span><span class="row__time">cobrado</span></span>
            </div></li>`,
          )}</ul>`
      : ''}

    ${tableView({
      caption: 'Flujo de caja de los últimos 6 meses',
      headers: ['Mes', 'Ingresos', 'Gastos', 'Neto'],
      rows: flow.series.map((s) => [monthLabel(s.key), formatMoney(s.incomeCents), formatMoney(s.expenseCents), formatMoney(s.netCents)]),
    })}
    <p class="panel__foot">Son cuentas con reglas fijas sobre lo que registraste, no inteligencia artificial. «Más rentable» es el cliente que más te deja: lo que cobraste menos los gastos que cargaste a él (los gastos generales no se reparten).</p>
  </section>`;
}


/**
 * Panel propio de las modalidades Emprendedor y Empresa (documento maestro §10): beneficio del mes, cómo va frente al mes
 * anterior, beneficio acumulado del año y proyección. Todo sale de domain/business.js.
 * @param {{ hasData: boolean, statement: ReturnType<typeof incomeStatement>, comparison: ReturnType<typeof periodComparison>, accumulated: ReturnType<typeof accumulatedProfit>, verdict: ReturnType<typeof businessVerdict>, projection: ReturnType<typeof projectResults>, health: ReturnType<typeof companyHealth> | null, inventory: ReturnType<typeof inventorySummary> | null, receivables: ReturnType<typeof invoiceReceivables> | null }} biz
 * @param {string} monthKey @param {string} prevKey
 */
function businessPanel(biz, monthKey, prevKey) {
  if (!biz.hasData) {
    return html`<section class="panel" aria-labelledby="biz-title">
      <div class="panel__head"><h2 class="panel__title" id="biz-title">Tu negocio</h2></div>
      <p class="muted">Registra los ingresos y gastos de tu negocio. Aquí verás tu beneficio del mes, tu margen, cómo vas frente al mes pasado y una proyección.</p>
      <div class="actions actions--start">
        <button type="button" class="btn btn--ghost btn--small" data-action="load-demo">Ver con datos de demostración</button>
      </div>
    </section>`;
  }
  const { statement, comparison, accumulated, verdict, projection } = biz;
  const prev = comparison.previous;
  const next = projection.ok ? projection.months[0] : null;
  return html`<section class="panel" aria-labelledby="biz-title">
    <div class="panel__head">
      <h2 class="panel__title" id="biz-title">Tu negocio</h2>
      <button type="button" class="link-btn" data-action="go" data-route="resultados">Ver resultados</button>
    </div>
    <dl class="kpis">
      <div class="kpi"><dt>Beneficio de ${monthName(monthKey)}</dt><dd>${money(statement.netCents, { tone: 'auto' })}</dd><dd class="kpi__note">${statement.marginPercent === null ? 'Sin ingresos este mes' : `Margen ${formatPercent(statement.marginPercent)}`} · ingresó ${formatMoney(statement.incomeCents, { decimals: false })}, salió ${formatMoney(statement.expenseCents, { decimals: false })}</dd></div>
      <div class="kpi"><dt>Frente a ${monthName(prevKey)}</dt>${prev.statement.hasData
        ? html`<dd>${money(prev.net.diffCents, { sign: true, tone: 'auto' })}</dd><dd class="kpi__note">${monthName(prevKey)}: ${formatMoney(prev.statement.netCents, { decimals: false })}${prev.net.percent === null ? '' : ` · ${changeText(prev.net)}`}${statement.partial ? ' · este mes sigue en curso' : ''}</dd>`
        : html`<dd>—</dd><dd class="kpi__note">Sin registros en ${monthName(prevKey)}</dd>`}</div>
      <div class="kpi"><dt>Beneficio acumulado de ${accumulated.year}</dt><dd>${money(accumulated.yearToDateCents, { tone: 'auto' })}</dd><dd class="kpi__note">Desde el primer registro: ${formatMoney(accumulated.sinceStartCents, { decimals: false })}</dd></div>
      <div class="kpi"><dt>Proyección de ${monthName(monthKey)}</dt>${next
        ? html`<dd>${money(next.netCents, { tone: 'auto' })}</dd><dd class="kpi__note">Mes completo, estimado · entre ${formatMoney(next.netLowCents, { decimals: false })} y ${formatMoney(next.netHighCents, { decimals: false })}</dd>`
        : html`<dd>—</dd><dd class="kpi__note">${projection.ok ? '' : `Necesita ${projection.needMonths} meses completos de historia (hay ${projection.haveMonths})`}</dd>`}</div>
    </dl>
    ${verdict ? html`<p class="panel__foot"><strong>${verdict.state === 'value' ? 'Genera valor.' : verdict.state === 'mixed' ? 'Resultados mixtos.' : 'Hay movimiento, no beneficio.'}</strong> ${verdict.text}</p>` : ''}
    ${biz.inventory && biz.inventory.positions.length > 0
      ? html`<p class="panel__foot" id="biz-inventory"><strong>Inventario:</strong> ${formatMoney(biz.inventory.totalValueCents, { decimals: false })} en ${plural(biz.inventory.activeProducts, 'producto', 'productos')}${biz.inventory.alerts.length > 0 ? html` · <strong class="text-alert">${biz.inventory.alerts.length === 1 ? '1 con stock bajo' : `${biz.inventory.alerts.length} con stock bajo`}</strong>` : ''}. <button type="button" class="link-btn" data-action="go" data-route="inventario">Ver inventario</button></p>`
      : ''}
    ${biz.receivables
      ? html`<p class="panel__foot" id="biz-receivables"><strong>Por cobrar:</strong> ${formatMoney(biz.receivables.totalCents, { decimals: false })} en ${plural(biz.receivables.openCount, 'factura', 'facturas')}${biz.receivables.overdueCount > 0 ? html` · <strong class="text-alert">${formatMoney(biz.receivables.overdueCents, { decimals: false })} vencido</strong>` : ''}. <button type="button" class="link-btn" data-action="go" data-route="facturas">Ver facturas</button></p>`
      : ''}
    ${biz.health ? html`<p class="panel__foot" id="biz-health"><strong>Salud financiera:</strong> ${healthSummaryText(biz.health)}. <button type="button" class="link-btn" data-action="go" data-route="salud">Ver salud financiera</button></p>` : ''}
  </section>`;
}
