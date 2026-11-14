// @ts-check
// =============================================================================
// DIAGNÓSTICO FINANCIERO Y VIABILIDAD DE METAS (documento maestro §7 y §12, primer nivel)
// Pantalla «Diagnóstico» (#/diagnostico): los indicadores del espacio con su nivel (Bien / Atención / Riesgo), lo que
// falta para llegar a «Bien», qué mirar primero y si cada meta pendiente cabe en tu capacidad de ahorro.
//
// Los números salen de domain/diagnosis.js y los textos de domain/diagnosisCards.js: reglas fijas y comprobables
// sobre lo que registraste. NO es inteligencia artificial ni asesoría financiera. El nivel de cada indicador se dice
// con TEXTO e icono, no solo con color. Esta pantalla solo muestra.
// El espacio Empresa no la tiene: allí existe «Salud financiera».
// =============================================================================

import { DIAGNOSIS_THRESHOLDS, personalDiagnosis } from '../domain/diagnosis.js';
import {
  diagnosisBaselineText, diagnosisCards, diagnosisPriorities, diagnosisSummaryText, feasibilityText,
} from '../domain/diagnosisCards.js';
import { formatDate, plural } from '../domain/dates.js';
import { formatMoney } from '../domain/money.js';
import { demoBanner, emptyState, exportButtons, feasibilityBlock } from '../ui/components.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/** @type {Record<string, string>} */
const LEVEL_ICONS = { good: 'check', watch: 'info', risk: 'alert', unknown: 'info' };

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} _ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderDiagnosis(store, _ctx) {
  if (!store.diagnosisEnabled()) return { html: notAvailablePage(store) };

  const today = store.today();
  const { data } = store.getState();
  const hasAnything = data.movements.length + data.goals.length + data.contributions.length + data.debts.length + data.assets.length > 0;

  const header = html`
    <a class="back-link" href="#/estadisticas">${icon('back', 16)}Estadísticas</a>
    <header class="page-header">
      <div>
        <h1 class="page-title">Diagnóstico financiero</h1>
        <p class="page-subtitle">Cómo estás hoy y si tus metas caben, con reglas claras sobre lo que registraste.</p>
      </div>
    </header>
    ${demoBanner(store.hasDemoData())}`;

  if (!hasAnything) {
    return {
      html: html`${header}<section class="panel">${emptyState({
        icon: 'chart',
        title: 'Aún no hay datos para el diagnóstico',
        text: 'Registra tus ingresos y gastos (y, si las tienes, tus deudas y metas) y aquí verás qué tan bien va tu ahorro, cuántos meses cubre tu dinero libre y si tus metas caben.',
        actions: html`<button type="button" class="btn btn--primary" data-action="add-income">${icon('plus', 18)}Registrar ingreso</button>
          <button type="button" class="btn btn--ghost" data-action="add-expense">${icon('plus', 18)}Registrar gasto</button>
          <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
      })}</section>`,
    };
  }

  const d = personalDiagnosis(data, today);
  const cards = diagnosisCards(d);
  const priorities = diagnosisPriorities(d);
  const T = DIAGNOSIS_THRESHOLDS;
  const goals = d.feasibility.goals;

  return {
    html: html`
      ${header}

      <section class="panel" aria-labelledby="dg-title">
        <div class="panel__head"><h2 class="panel__title" id="dg-title">Resumen</h2></div>
        <p class="health-summary" id="dg-summary"><strong>${diagnosisSummaryText(d)}</strong></p>
        <p class="panel__sub">${diagnosisBaselineText(d)} No es inteligencia artificial ni asesoría financiera: son cuentas con reglas fijas sobre lo que registraste.</p>
        ${d.hasData && d.partial
          ? html`<p class="notice notice--warn" role="note" id="dg-partial">${icon('info', 18)}<span>Solo hay movimientos del mes en curso: el «mes típico» todavía es <strong>parcial</strong> y estos números pueden cambiar mucho cuando termine el mes.</span></p>`
          : ''}
      </section>

      <section class="panel" aria-labelledby="dg-first">
        <div class="panel__head"><h2 class="panel__title" id="dg-first">Qué mirar primero</h2></div>
        ${priorities.length === 0
          ? html`<p class="muted" id="dg-nothing">Con estas reglas no hay nada en riesgo ni en atención. ${d.counts.unknown > 0 ? 'Algunos indicadores aún no tienen datos para evaluarse.' : 'Sigue registrando para que el diagnóstico se mantenga al día.'}</p>`
          : html`<ol class="prio-list" id="dg-priorities">${priorities.map((p) => html`<li class="prio prio--${p.level}" data-prio="${p.id}">
              <p class="prio__head"><strong>${p.title}</strong> <span class="health__badge health__badge--${p.level}">${icon(LEVEL_ICONS[p.level] ?? 'info', 14)}${p.levelLabel}</span></p>
              <p class="prio__text">${p.text}</p>
            </li>`)}</ol>`}
      </section>

      <section class="panel" aria-labelledby="dg-indicators">
        <div class="panel__head"><h2 class="panel__title" id="dg-indicators">Indicadores</h2></div>
        <div class="health-grid">
          ${cards.map((c) => html`<article class="health health--${c.level}" aria-labelledby="dg-${c.id}" data-indicator="${c.id}" data-level="${c.level}">
            <header class="health__head">
              <h3 class="health__title" id="dg-${c.id}">${c.title}</h3>
              <span class="health__badge health__badge--${c.level}">${icon(LEVEL_ICONS[c.level] ?? 'info', 14)}${c.levelLabel}</span>
            </header>
            <p class="health__value">${c.value}</p>
            <p class="health__text">${c.text}</p>
            ${c.hint ? html`<p class="health__hint">${c.hint}</p>` : ''}
            ${c.details.length > 0
              ? html`<dl class="health__details">${c.details.map((r) => html`<div class="health__row"><dt>${r.label}</dt><dd>${r.value}</dd></div>`)}</dl>`
              : ''}
            <p class="health__rule">${c.rule}</p>
            ${c.link ? html`<p class="health__more"><button type="button" class="link-btn" data-action="go" data-route="${c.link.route}">${c.link.label}</button></p>` : ''}
          </article>`)}
        </div>
      </section>

      ${goals.length > 0
        ? html`<section class="panel" aria-labelledby="dg-goals">
            <div class="panel__head">
              <h2 class="panel__title" id="dg-goals">¿Caben tus metas?</h2>
              <button type="button" class="link-btn" data-action="go" data-route="metas">Ver mis metas</button>
            </div>
            <p class="panel__sub">${d.capacityCents === null
              ? 'Todavía no hay un mes con movimientos para estimar tu capacidad de ahorro.'
              : html`Tu capacidad de ahorro es <strong>${formatMoney(d.capacityCents)} al mes</strong> y es una sola para todas las metas: se reparte por orden de fecha, la que vence antes primero.`}</p>
            <ul class="viab-list" id="dg-goal-list">${d.feasibility.goals.map((g) => {
              const t = feasibilityText(g, d.capacityCents);
              return html`<li class="viab" data-goal="${g.goal.id}">
                <p class="viab__name"><strong>${g.goal.name}</strong> <span class="muted">· ${formatDate(g.goal.targetDate)} · ${g.progress.timeLeftText}</span></p>
                <dl class="viab__facts">
                  <div><dt>Falta</dt><dd>${formatMoney(g.progress.remainingCents, { decimals: false })}</dd></div>
                  ${g.status === 'overdue' ? '' : html`<div><dt>Necesita al mes</dt><dd>${formatMoney(g.neededCents, { decimals: false })}</dd></div>
                  <div><dt>Le toca de tu capacidad</dt><dd>${formatMoney(g.allocatedCents, { decimals: false })}</dd></div>`}
                </dl>
                ${feasibilityBlock(t)}
              </li>`;
            })}</ul>
            <p class="panel__foot">Las metas piden ${formatMoney(d.feasibility.totalNeededCents, { decimals: false })} al mes en total${d.feasibility.shortfallCents > 0
              ? ` y a tu capacidad le faltan ${formatMoney(d.feasibility.shortfallCents, { decimals: false })} al mes para cubrirlas todas` : ''}. ${plural(goals.length, 'meta pendiente', 'metas pendientes')}.</p>
          </section>`
        : ''}

      <section class="panel" aria-labelledby="dg-how">
        <div class="panel__head"><h2 class="panel__title" id="dg-how">Cómo se calcula</h2></div>
        <ul class="health-notes">
          <li>Todo parte de un <strong>mes típico</strong>: el promedio de tus últimos 3 meses completos con movimientos. Los pagos de deudas se sacan de los gastos para no contarlos dos veces; en su lugar se usan las cuotas mensuales de tus deudas activas.</li>
          <li>La <strong>tasa de ahorro</strong> es lo que te queda al mes (ingreso menos gastos y cuotas) entre tu ingreso: ${T.savings.good}% o más es <em>Bien</em>; ${T.savings.watch}% o más, <em>Atención</em>.</li>
          <li>El <strong>colchón de emergencia</strong> son los meses de gastos y cuotas que cubre tu dinero libre: ${T.emergency.good} o más es <em>Bien</em>; ${T.emergency.watch} o más, <em>Atención</em>. No cuenta lo que apartaste en metas ni tus activos.</li>
          <li>El <strong>peso de las deudas</strong> son tus cuotas mensuales entre tu ingreso: ${T.debtService.good}% o menos es <em>Bien</em>; hasta ${T.debtService.watch}%, <em>Atención</em> (los mismos cortes que Salud financiera de Empresa). Con cuotas vencidas sin pagar, el indicador de cuotas está en <em>Riesgo</em>.</li>
          <li>Una <strong>meta «Va al ritmo»</strong> si lo que aportas hoy alcanza a tiempo. Si no, se compara lo que necesita aportar cada mes con lo que le toca de tu capacidad de ahorro: <em>Viable</em> si le toca todo, <em>Ajustada</em> si le toca menos (se te dice cuándo llegarías) y <em>No alcanza</em> si no le toca nada.</li>
          <li>No hay una «nota» única a propósito: sería una precisión inventada. Los cortes son <strong>reglas generales</strong>; cada persona es distinta, así que úsalos para saber dónde mirar primero, no como una sentencia.</li>
          <li>Se supone que tus meses futuros se parecerán al mes típico: es una estimación, no una promesa. Los datos de demostración, si los hay, <strong>sí se incluyen</strong> en las cuentas (y por eso el aviso de arriba).</li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="dg-export">
        <div class="panel__head"><h2 class="panel__title" id="dg-export">Exportar el diagnóstico</h2></div>
        <p class="panel__sub">Los indicadores, la viabilidad de cada meta y la forma de calcularlos. Se crea en tu dispositivo.</p>
        ${exportButtons({ kind: 'diagnosis', label: 'Exportar el reporte de diagnóstico' })}
      </section>`,
  };
}

/**
 * Tarjeta corta de Inicio: cuántos indicadores hay en cada nivel y lo primero que conviene mirar.
 * @param {Store} store
 */
export function diagnosisHomeCard(store) {
  const d = personalDiagnosis(store.getState().data, store.today());
  const first = diagnosisPriorities(d)[0];
  return html`<section class="panel" aria-labelledby="dg-home-title" id="dg-home">
    <div class="panel__head">
      <h2 class="panel__title" id="dg-home-title">Diagnóstico</h2>
      <button type="button" class="link-btn" data-action="go" data-route="diagnostico">Ver diagnóstico</button>
    </div>
    <p class="health-summary"><strong>${diagnosisSummaryText(d)}</strong></p>
    ${first
      ? html`<p class="prio__head"><strong>Mira primero: ${first.title}</strong> <span class="health__badge health__badge--${first.level}">${icon(LEVEL_ICONS[first.level] ?? 'info', 14)}${first.levelLabel}</span></p>
        <p class="muted">${first.text}</p>`
      : html`<p class="muted">Con estas reglas no hay nada en riesgo ni en atención.</p>`}
    <p class="panel__foot">Reglas fijas sobre lo que registraste, no inteligencia artificial.${d.hasData && d.partial ? ' Las cifras son parciales: solo hay el mes en curso.' : ''}</p>
  </section>`;
}

/** @param {Store} store */
function notAvailablePage(store) {
  const workspace = store.activeWorkspace();
  return html`
    <a class="back-link" href="#/estadisticas">${icon('back', 16)}Estadísticas</a>
    <header class="page-header">
      <div>
        <h1 class="page-title">Diagnóstico financiero</h1>
        <p class="page-subtitle">Cómo estás hoy y si tus metas caben.</p>
      </div>
    </header>
    <section class="panel">${emptyState({
      icon: 'building',
      title: 'En Empresa el diagnóstico es «Salud financiera»',
      text: `${workspace ? `«${workspace.name}» es un espacio de empresa, que ya tiene sus propias señales (punto de equilibrio, meses de efectivo, deuda). ` : ''}La viabilidad de cada meta de ahorro la ves en la pantalla Metas.`,
      actions: html`<a class="btn btn--primary" href="#/salud">Ver Salud financiera</a>
        <a class="btn btn--ghost" href="#/metas">Ver mis metas</a>`,
    })}</section>`;
}
