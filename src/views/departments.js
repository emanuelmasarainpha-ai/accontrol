// @ts-check
// =============================================================================
// DEPARTAMENTOS Y PRESUPUESTOS POR ÁREA (módulo de Empresa)
// Lista del mes (cuánto gastó cada área frente a su presupuesto, y los gastos sin departamento) y, al tocar un área, su ficha:
// los últimos 6 meses, en qué categorías gasta y sus gastos del mes.
//
// Todos los números salen de domain/departments.js: lo gastado por un área es la suma de los gastos que se le cargaron, nunca
// un dato aparte. Los botones (Nuevo departamento, Editar…) son acciones comunes (app/actions.js); el cambio de departamento
// de un gasto se maneja aquí mismo.
// =============================================================================

import { departmentCategories, departmentExpenses, departmentHistory, departmentMonth, unassignedExpenses, BUDGET_STATUS_LABELS } from '../domain/departments.js';
import { addMonths, formatDate, monthKeyOf, monthLabel, monthShortLabel, plural } from '../domain/dates.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { columnChart } from '../ui/charts.js';
import { demoBadge, demoBanner, emptyState, exportButtons, financeTabs, monthSelector, money } from '../ui/components.js';
import { actionTarget } from '../ui/dom.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Department} Department */
/** @typedef {import('../domain/types.js').Movement} Movement */
/** @typedef {import('../domain/departments.js').DepartmentRow} DepartmentRow */
/** @typedef {import('../domain/departments.js').BudgetStatus} BudgetStatus */

/** Cuántos gastos se listan como máximo (el resto se ve en Movimientos). */
const MAX_EXPENSE_ROWS = 25;

/** Estado propio de esta pantalla (se conserva mientras no recargues la página). */
const view = {
  /** @type {string | null} Mes que se mira; null = el mes en curso. */
  monthKey: null,
};

/** @param {BudgetStatus} status */
function statusChip(status) {
  const cls = status === 'over' ? ' chip--alert' : status === 'warning' ? ' chip--warn' : status === 'ok' ? ' chip--good' : '';
  return html`<span class="chip${cls}">${BUDGET_STATUS_LABELS[status]}</span>`;
}

/** Barra de uso del presupuesto. El color nunca va solo: siempre hay texto con el porcentaje y el estado. @param {DepartmentRow} r */
function budgetBar(r) {
  if (r.percent === null) return '';
  return html`<span class="progress-wrap"><progress class="progress progress--${r.status}" max="100" value="${Math.min(100, r.percent)}" aria-label="${r.department.name}: ${r.percent} % del presupuesto">${r.percent}%</progress></span>`;
}

/** Línea que cuenta el estado de un área en palabras. @param {DepartmentRow} r */
function budgetSentence(r) {
  if (r.remainingCents === null) return r.count === 0 ? 'Sin presupuesto · sin gastos este mes' : `Sin presupuesto · ${plural(r.count, 'gasto', 'gastos')}`;
  if (r.remainingCents < 0) return `Se pasó ${formatMoney(-r.remainingCents)} · ${r.percent} % del presupuesto`;
  return `Quedan ${formatMoney(r.remainingCents)} · ${r.percent} % del presupuesto`;
}

/** @param {DepartmentRow} r */
function paceNote(r) {
  if (r.paceCents === null) return '';
  return r.paceExceeds
    ? html`<span class="dept-row__pace dept-row__pace--warn">A este ritmo cerrarías el mes en ${formatMoney(r.paceCents)}, por encima del presupuesto.</span>`
    : html`<span class="dept-row__pace">A este ritmo cerrarías el mes en ${formatMoney(r.paceCents)}.</span>`;
}

/**
 * Un gasto con el selector para cargarlo (o moverlo) a un departamento. Sirve también para las compras de inventario, que no se
 * editan desde Movimientos.
 * @param {Movement} m @param {Department[]} choices Departamentos activos (más el actual, aunque esté archivado).
 * @param {{ categoryName: string, showDemo: boolean, withEmpty: boolean }} o
 */
function assignRow(m, choices, { categoryName, showDemo, withEmpty }) {
  const current = m.departmentId ?? '';
  return html`<li class="row-item"><div class="row row--static">
    <span class="row__main">
      <span class="row__title">${m.description}${showDemo && m.isDemo ? html` ${demoBadge()}` : ''}</span>
      <span class="row__meta"><span>${formatDate(m.date)}</span><span>${categoryName}</span></span>
    </span>
    <span class="row__side">
      <span class="row__amount">${formatMoney(-m.amountCents)}</span>
      <label class="sr-only" for="as-${m.id}">Departamento de «${m.description}»</label>
      <select id="as-${m.id}" class="input input--small assign-select" data-assign="${m.id}">
        ${withEmpty ? html`<option value="" ${current ? '' : 'selected'}>Sin departamento</option>` : html`<option value="" disabled ${current ? '' : 'selected'}>Elegir departamento…</option>`}
        ${choices.map((d) => html`<option value="${d.id}" ${d.id === current ? 'selected' : ''}>${d.name}${d.archived ? ' (archivado)' : ''}</option>`)}
      </select>
    </span>
  </div></li>`;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderDepartments(store, ctx) {
  if (!store.departmentsEnabled()) return { html: notAvailablePage(store) };
  const today = store.today();
  const nowKey = monthKeyOf(today);
  // Un mes del futuro no tiene sentido; si el reloj cambió de mes, se vuelve al mes en curso.
  if (view.monthKey !== null && view.monthKey >= nowKey) view.monthKey = null;
  const monthKey = view.monthKey ?? nowKey;
  const detailId = ctx.params[0];

  return {
    html: detailId ? detailPage(store, detailId, monthKey, today) : listPage(store, monthKey, today),
    mount(root, signal) {
      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (!el) return;
          if (el.dataset.action === 'month-prev') {
            view.monthKey = addMonths(monthKey, -1);
            ctx.rerender();
          } else if (el.dataset.action === 'month-next' && monthKey < nowKey) {
            const next = addMonths(monthKey, 1);
            view.monthKey = next >= nowKey ? null : next;
            ctx.rerender();
          }
        },
        { signal },
      );

      // Cargar un gasto a un departamento (o quitárselo) desde el selector de su fila.
      root.addEventListener(
        'change',
        async (event) => {
          const select = event.target;
          if (!(select instanceof HTMLSelectElement) || !select.dataset.assign) return;
          select.disabled = true;
          const result = await store.assignDepartment(select.dataset.assign, select.value);
          if (result.ok) {
            const name = store.getState().data.departments.find((d) => d.id === select.value)?.name;
            toast(name ? `Gasto cargado a «${name}».` : 'Gasto sin departamento.');
          } else toast(result.errors.form ?? 'No se pudo cambiar el departamento.', 'error');
          ctx.rerender();
        },
        { signal },
      );

      // Dibujar la gráfica de los últimos 6 meses de la ficha.
      const host = root.querySelector('#dept-history');
      if (detailId && host instanceof HTMLElement) {
        const series = departmentHistory(store.getState().data, detailId, monthKey, today);
        const stop = columnChart(host, {
          labels: series.map((s) => monthShortLabel(s.monthKey)),
          titles: series.map((s) => monthLabel(s.monthKey)),
          series: [{ name: 'Gastado', cls: 'expense', values: series.map((s) => s.spentCents) }],
          ariaLabel: `Gasto de los últimos 6 meses, hasta ${monthLabel(monthKey)}`,
        });
        signal.addEventListener('abort', stop);
      }
    },
  };
}

/** @param {Store} store */
function notAvailablePage(store) {
  const workspace = store.activeWorkspace();
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Departamentos</h1>
        <p class="page-subtitle">El gasto de cada área frente a su presupuesto.</p>
      </div>
    </header>
    <section class="panel">${emptyState({
      icon: 'building',
      title: 'Los departamentos son parte del espacio Empresa',
      text: `${workspace ? `«${workspace.name}» no los usa. ` : ''}Crea (o abre) un espacio Empresa para repartir los gastos por áreas y ponerle un presupuesto mensual a cada una.`,
      actions: html`<button type="button" class="btn btn--primary" data-action="workspace-menu">Ver mis espacios</button>
        <a class="btn btn--ghost" href="#/finanzas">Volver a Finanzas</a>`,
    })}</section>`;
}

// =============================================================================
// LISTA DEL MES
// =============================================================================

/** @param {Store} store @param {string} monthKey @param {string} today */
function listPage(store, monthKey, today) {
  const { data } = store.getState();
  const nowKey = monthKeyOf(today);
  const month = departmentMonth(data, monthKey, today);
  const categoryName = (/** @type {string} */ id) => data.categories.find((c) => c.id === id)?.name ?? 'Sin categoría';
  const active = data.departments.filter((d) => !d.archived).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const archived = data.departments.filter((d) => d.archived && !month.rows.some((r) => r.department.id === d.id));
  const unassigned = unassignedExpenses(data, monthKey, today);

  /** @param {DepartmentRow} r */
  const departmentRow = (r) => html`<li class="row-item">
    <a class="dept-row" href="#/departamentos/${r.department.id}" aria-label="${r.department.name}. ${budgetSentence(r)}. Ver ficha">
      <span class="dept-row__top">
        <span class="dept-row__name">${r.department.name}</span>
        ${r.department.archived ? html`<span class="chip">Archivado</span>` : ''}
        ${r.department.isDemo ? demoBadge() : ''}
        ${statusChip(r.status)}
      </span>
      <span class="dept-row__figures">
        <span class="dept-row__spent">${formatMoney(r.spentCents)}</span>
        <span class="dept-row__of">${r.budgetCents > 0 ? `de ${formatMoney(r.budgetCents)}` : 'sin presupuesto'}</span>
      </span>
      ${budgetBar(r)}
      <span class="dept-row__sentence">${budgetSentence(r)}</span>
      ${paceNote(r)}
    </a>
  </li>`;

  return html`
    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">El gasto de cada área frente a su presupuesto mensual.</p>
      </div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--primary" data-action="new-department">${icon('plus', 18)}Nuevo departamento</button>
      </div>
    </header>

    ${financeTabs('departamentos', store)}
    ${demoBanner(store.hasDemoData())}

    ${data.departments.length === 0
      ? html`<section class="panel">${emptyState({
          icon: 'building',
          title: 'Aún no tienes departamentos',
          text: 'Crea los departamentos de tu empresa (Ventas, Administración, Operaciones…) y ponle a cada uno un presupuesto mensual. Después, al registrar un gasto, eliges a qué departamento va, y ACCONTROL te muestra cuánto gasta cada área y te avisa cuando se acerca a su límite o se pasa. Los gastos que ya tienes quedan «sin departamento» hasta que los asignes.',
          actions: html`<button type="button" class="btn btn--primary" data-action="new-department">Nuevo departamento</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    <div class="toolbar">${monthSelector(monthKey, { canGoNext: monthKey < nowKey })}</div>

    <section class="panel panel--summary" aria-label="Resumen del mes por áreas">
      <dl class="kpis">
        <div class="kpi"><dt>Presupuesto de ${monthLabel(monthKey)}</dt><dd>${money(month.budgetTotalCents)}</dd><dd class="kpi__note">${month.budgetedCount === 0 ? 'Ninguna área tiene presupuesto' : plural(month.budgetedCount, 'área con presupuesto', 'áreas con presupuesto')}</dd></div>
        <div class="kpi"><dt>Gastado en esas áreas</dt><dd>${money(month.budgetedSpentCents)}</dd><dd class="kpi__note">${month.budgetTotalCents > 0 ? `${Math.round((month.budgetedSpentCents * 100) / month.budgetTotalCents)} % del presupuesto` : 'Pon un presupuesto para compararlo'}</dd></div>
        <div class="kpi"><dt>Excedido</dt><dd>${money(month.overCents, { tone: month.overCents > 0 ? 'alert' : 'none' })}</dd><dd class="kpi__note">${month.overCount === 0 ? 'Ninguna área excedida' : plural(month.overCount, 'área excedida', 'áreas excedidas')}</dd></div>
        <div class="kpi"><dt>Sin departamento</dt><dd>${money(month.unassignedCents)}</dd><dd class="kpi__note">${month.unassignedCount === 0 ? 'Todo asignado' : plural(month.unassignedCount, 'gasto sin asignar', 'gastos sin asignar')}</dd></div>
      </dl>
      <p class="panel__foot">Gasto de ${monthLabel(monthKey)}: ${formatMoney(month.totalSpentCents)} = ${formatMoney(month.assignedCents)} en áreas + ${formatMoney(month.unassignedCents)} sin departamento.${month.leftCents > 0 ? ` Queda sin gastar ${formatMoney(month.leftCents)} en las áreas que van dentro de su presupuesto.` : ''}${month.debtPaymentsCents > 0 ? ` No incluye ${formatMoney(month.debtPaymentsCents)} de pagos de deudas (no son gasto operativo).` : ''} Son cálculos con reglas fijas, no inteligencia artificial.</p>
    </section>

    <section class="panel" aria-labelledby="dept-title">
      <div class="panel__head">
        <h2 class="panel__title" id="dept-title">Áreas de ${monthLabel(monthKey)}</h2>
        <button type="button" class="link-btn" data-action="new-department">Nuevo departamento</button>
      </div>
      ${month.rows.length === 0
        ? html`<p class="muted">No hay áreas activas. Crea un departamento para empezar.</p>`
        : html`<ul class="rows">${month.rows.map(departmentRow)}</ul>`}
      <p class="panel__foot">«En orden» es menos del 80 % del presupuesto; «Cerca del límite», del 80 % al 100 %; «Excedido», más del 100 %. Se compara con el presupuesto que tiene cada área ahora: si lo cambias, los meses anteriores se miden con el nuevo valor. El «ritmo» proyecta el gasto del mes en curso de forma lineal, desde el día 5.</p>
    </section>

    ${unassigned.length > 0
      ? html`<section class="panel" aria-labelledby="unassigned-title">
          <div class="panel__head"><h2 class="panel__title" id="unassigned-title">Gastos sin departamento (${unassigned.length})</h2></div>
          ${active.length === 0
            ? html`<p class="muted">Crea o reactiva un departamento para poder cargarle estos gastos.</p>`
            : html`<p class="panel__sub">Elige a qué departamento va cada uno. El dinero no cambia: solo se reparte.</p>`}
          <ul class="rows">${unassigned.slice(0, MAX_EXPENSE_ROWS).map((m) => assignRow(m, active, { categoryName: categoryName(m.categoryId), showDemo: true, withEmpty: false }))}</ul>
          ${unassigned.length > MAX_EXPENSE_ROWS ? html`<p class="panel__foot">Y ${unassigned.length - MAX_EXPENSE_ROWS} más. Puedes asignar un departamento al editar cada gasto en Movimientos.</p>` : ''}
        </section>`
      : ''}

    ${archived.length > 0
      ? html`<section class="panel" aria-labelledby="archived-title">
          <div class="panel__head"><h2 class="panel__title" id="archived-title">Archivados (${archived.length})</h2></div>
          <ul class="rows">${archived.map((d) => html`<li class="row-item"><a class="dept-row dept-row--compact" href="#/departamentos/${d.id}" aria-label="${d.name}. Archivado. Ver ficha"><span class="dept-row__top"><span class="dept-row__name">${d.name}</span><span class="chip">Archivado</span>${d.isDemo ? demoBadge() : ''}</span></a></li>`)}</ul>
          <p class="panel__foot">Un área archivada no se ofrece al registrar gastos ni tiene presupuesto que cumplir; su historial se conserva y puedes reactivarla desde su ficha.</p>
        </section>`
      : ''}

    <section class="panel" aria-labelledby="dept-export">
      <div class="panel__head"><h2 class="panel__title" id="dept-export">Exportar ${monthLabel(monthKey)}</h2></div>
      <p class="panel__sub">Cada área con su presupuesto, lo gastado, lo que queda y el detalle de sus gastos del mes. Se crea en tu dispositivo.</p>
      ${exportButtons({ kind: 'departments', month: monthKey, label: 'Exportar departamentos' })}
    </section>`}
  `;
}

// =============================================================================
// FICHA DE UN DEPARTAMENTO
// =============================================================================

function missingPage() {
  return html`
    <a class="back-link" href="#/departamentos">${icon('back', 16)}Departamentos</a>
    <section class="panel">${emptyState({
      icon: 'building',
      title: 'Ese departamento no existe',
      text: 'Pudo haberse borrado, o ser de otro espacio.',
      actions: html`<a class="btn btn--primary" href="#/departamentos">Volver a Departamentos</a>`,
    })}</section>`;
}

/** @param {Store} store @param {string} id @param {string} monthKey @param {string} today */
function detailPage(store, id, monthKey, today) {
  const { data } = store.getState();
  const department = data.departments.find((d) => d.id === id);
  if (!department) return missingPage();
  const nowKey = monthKeyOf(today);
  const month = departmentMonth(data, monthKey, today);
  // Un área archivada que no gastó este mes no está en la lista del mes: se muestra con ceros.
  const row = month.rows.find((r) => r.department.id === id);
  const spent = row?.spentCents ?? 0;
  const budget = department.archived ? 0 : department.monthlyBudgetCents;
  const history = departmentHistory(data, id, monthKey, today);
  const categories = departmentCategories(data, id, monthKey, today);
  const expenses = departmentExpenses(data, id, monthKey, today);
  const categoryName = (/** @type {string} */ cid) => data.categories.find((c) => c.id === cid)?.name ?? 'Sin categoría';
  const choices = data.departments.filter((d) => !d.archived || d.id === id).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return html`
    <a class="back-link" href="#/departamentos">${icon('back', 16)}Departamentos</a>

    <header class="page-header page-header--wrap">
      <div>
        <h1 class="page-title">${department.name}</h1>
        <p class="page-subtitle">${department.archived ? 'Archivado · ' : ''}${department.monthlyBudgetCents > 0 ? `Presupuesto mensual: ${formatMoney(department.monthlyBudgetCents)}` : 'Sin presupuesto mensual'}${department.isDemo ? ' · ' : ''}${department.isDemo ? demoBadge() : ''}</p>
      </div>
      <div class="page-header__actions">
        <button type="button" class="btn btn--ghost" data-action="department-edit" data-id="${department.id}">Editar</button>
      </div>
    </header>

    ${financeTabs('departamentos', store)}
    ${demoBanner(store.hasDemoData())}

    <div class="toolbar">${monthSelector(monthKey, { canGoNext: monthKey < nowKey })}</div>

    <section class="panel panel--summary" aria-label="Resumen de ${department.name}">
      <dl class="kpis">
        <div class="kpi"><dt>Gastado en ${monthLabel(monthKey)}</dt><dd>${money(spent)}</dd><dd class="kpi__note">${plural(expenses.length, 'gasto', 'gastos')}</dd></div>
        <div class="kpi"><dt>Presupuesto</dt><dd>${budget > 0 ? money(budget) : '—'}</dd><dd class="kpi__note">${budget > 0 ? 'Mensual' : department.archived ? 'Archivado: sin presupuesto' : 'Sin presupuesto'}</dd></div>
        <div class="kpi"><dt>${row && row.remainingCents !== null && row.remainingCents < 0 ? 'Excedido' : 'Queda'}</dt><dd>${row && row.remainingCents !== null ? money(Math.abs(row.remainingCents), { tone: row.remainingCents < 0 ? 'alert' : 'none' }) : '—'}</dd><dd class="kpi__note">${row ? statusChip(row.status) : statusChip('none')}</dd></div>
        <div class="kpi"><dt>Uso del presupuesto</dt><dd>${row && row.percent !== null ? `${row.percent} %` : '—'}</dd><dd class="kpi__note">${row && row.percent !== null ? budgetBar(row) : 'Pon un presupuesto para medirlo'}</dd></div>
      </dl>
      ${row && row.paceCents !== null ? html`<p class="panel__foot">${row.paceExceeds ? `A este ritmo cerrarías ${monthLabel(monthKey)} en ${formatMoney(row.paceCents)}, por encima del presupuesto.` : `A este ritmo cerrarías ${monthLabel(monthKey)} en ${formatMoney(row.paceCents)}.`} Es una proyección lineal del gasto hasta hoy, no una promesa.</p>` : ''}
    </section>

    <section class="panel" aria-labelledby="hist-title">
      <div class="panel__head"><h2 class="panel__title" id="hist-title">Últimos 6 meses</h2></div>
      <div class="chart-host" id="dept-history" role="presentation"></div>
      <details class="table-view">
        <summary>Ver como tabla</summary>
        <div class="table-view__scroll"><table class="table">
          <caption class="sr-only">Gasto de ${department.name} por mes</caption>
          <thead><tr><th scope="col">Mes</th><th scope="col" class="num">Gastado</th><th scope="col" class="num">% del presupuesto actual</th></tr></thead>
          <tbody>${history.map((h) => html`<tr><th scope="row">${monthLabel(h.monthKey)}</th><td class="num">${formatMoney(h.spentCents)}</td><td class="num">${budget > 0 ? formatPercent((h.spentCents * 100) / budget) : '—'}</td></tr>`)}</tbody>
        </table></div>
      </details>
      <p class="panel__foot">Cada mes se compara con el presupuesto actual del área (no se guarda el historial de presupuestos). No incluye pagos de deudas.</p>
    </section>

    <section class="panel" aria-labelledby="cats-title">
      <div class="panel__head"><h2 class="panel__title" id="cats-title">En qué gasta en ${monthLabel(monthKey)}</h2></div>
      ${categories.length === 0
        ? html`<p class="muted">No hay gastos cargados a esta área en ${monthLabel(monthKey)}.</p>`
        : html`<ul class="rows">${categories.map((c) => html`<li class="row-item"><div class="row row--static">
            <span class="row__main"><span class="row__title">${categoryName(c.categoryId)}</span><span class="row__meta"><span>${plural(c.count, 'gasto', 'gastos')}</span><span>${spent > 0 ? formatPercent((c.cents * 100) / spent) : ''} del área</span></span></span>
            <span class="row__side"><span class="row__amount">${formatMoney(c.cents)}</span></span>
          </div></li>`)}</ul>`}
    </section>

    <section class="panel" aria-labelledby="exp-title">
      <div class="panel__head"><h2 class="panel__title" id="exp-title">Gastos de ${monthLabel(monthKey)} (${expenses.length})</h2></div>
      ${expenses.length === 0
        ? html`<p class="muted">Todavía no hay gastos.</p>`
        : html`<p class="panel__sub">Para mover un gasto a otro departamento, cambia su selector. El dinero no cambia: solo se reparte.</p>
          <ul class="rows">${expenses.slice(0, MAX_EXPENSE_ROWS).map((m) => assignRow(m, choices, { categoryName: categoryName(m.categoryId), showDemo: true, withEmpty: true }))}</ul>
          ${expenses.length > MAX_EXPENSE_ROWS ? html`<p class="panel__foot">Se muestran los ${MAX_EXPENSE_ROWS} más recientes de ${expenses.length}.</p>` : ''}`}
    </section>
  `;
}
