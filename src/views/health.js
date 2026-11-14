// @ts-check
// =============================================================================
// SALUD FINANCIERA (módulo Empresa, fase 1)
// Cinco señales sobre la solidez de la empresa con lo que registraste en ESTE espacio: punto de equilibrio, meses de
// efectivo, deuda sobre activos, peso de las cuotas y cuotas a 30 días. Cada una dice en palabras qué significa y con
// qué regla se le pone «Bien», «Atención» o «Riesgo».
//
// Los números salen de domain/company.js y los textos de domain/companyCards.js (reglas fijas, no inteligencia
// artificial ni asesoría contable). Esta pantalla solo los muestra.
// =============================================================================

import { companyHealth, HEALTH_THRESHOLDS } from '../domain/company.js';
import { baselineText, healthCards, healthSummaryText } from '../domain/companyCards.js';
import { demoBanner, emptyState, exportButtons, financeTabs } from '../ui/components.js';
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
export function renderHealth(store, _ctx) {
  if (!store.healthEnabled()) return { html: notAvailablePage(store) };

  const today = store.today();
  const { data } = store.getState();
  const health = companyHealth(data, today);
  const cards = healthCards(health);
  const hasAnything = health.hasData || data.debts.length > 0 || data.assets.length > 0;
  const T = HEALTH_THRESHOLDS;

  const page = html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Finanzas</h1>
        <p class="page-subtitle">Cómo le va a tu negocio: lo que entra, lo que sale y lo que queda.</p>
      </div>
    </header>
    ${financeTabs('salud', store)}
    ${demoBanner(store.hasDemoData())}

    ${!hasAnything
      ? html`<section class="panel">${emptyState({
          icon: 'building',
          title: 'Aún no hay datos para evaluar la empresa',
          text: 'Registra los ingresos y gastos de la empresa (clasificando cada gasto como fijo, variable o discrecional) y tus deudas, y aquí verás cuánto necesitas vender para no perder, cuántos meses cubre tu efectivo y qué peso tiene tu deuda.',
          actions: html`<button type="button" class="btn btn--primary" data-action="add-income">${icon('plus', 18)}Registrar ingreso</button>
            <button type="button" class="btn btn--ghost" data-action="add-expense">${icon('plus', 18)}Registrar gasto</button>
            <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
        })}</section>`
      : html`
    <section class="panel" aria-labelledby="hl-title">
      <div class="panel__head"><h2 class="panel__title" id="hl-title">Salud financiera de la empresa</h2></div>
      <p class="health-summary" id="hl-summary"><strong>${healthSummaryText(health)}</strong></p>
      <p class="panel__sub">${baselineText(health)} No es inteligencia artificial ni asesoría contable: son cuentas con reglas fijas sobre lo que registraste.</p>
      <div class="health-grid">
        ${cards.map((c) => html`<article class="health health--${c.level}" aria-labelledby="hl-${c.id}">
          <header class="health__head">
            <h3 class="health__title" id="hl-${c.id}">${c.title}</h3>
            <span class="health__badge health__badge--${c.level}">${icon(LEVEL_ICONS[c.level] ?? 'info', 14)}${c.levelLabel}</span>
          </header>
          <p class="health__value">${c.value}</p>
          <p class="health__text">${c.text}</p>
          ${c.details.length > 0
            ? html`<dl class="health__details">${c.details.map((d) => html`<div class="health__row"><dt>${d.label}</dt><dd>${d.value}</dd></div>`)}</dl>`
            : ''}
          <p class="health__rule">${c.rule}</p>
        </article>`)}
      </div>
    </section>

    <section class="panel" aria-labelledby="hl-how">
      <div class="panel__head"><h2 class="panel__title" id="hl-how">Cómo se calculan</h2></div>
      <ul class="health-notes">
        <li>Los <strong>costos fijos</strong> son los gastos que clasificaste como <em>Fijo</em> o <em>Discrecional</em>; los <strong>costos variables</strong>, los <em>Variable</em>. Si clasificas bien tus gastos, estas cuentas serán más fieles.</li>
        <li>El <strong>punto de equilibrio</strong> es lo que necesitas ingresar al mes para no perder dinero: costos fijos más cuotas de deuda, entre el margen de contribución (ingresos menos costos variables, entre ingresos).</li>
        <li>Los <strong>pagos de deudas</strong> que ya hiciste no se cuentan como costos (para no contarlos dos veces); en su lugar se usan las cuotas que siguen por pagar.</li>
        <li>Los <strong>activos</strong> son tu dinero registrado más los activos que anotaste en Patrimonio; las deudas, lo que falta por pagar.</li>
        <li>Los cortes de <em>Bien / Atención / Riesgo</em> (${T.safety.good}% de margen de seguridad, ${T.runway.good} meses de efectivo, ${T.leverage.good}% de deuda sobre activos, ${T.debtService.good}% de cuotas sobre ingresos) son <strong>reglas generales</strong>: cada negocio es distinto, así que úsalos para saber dónde mirar primero, no como una sentencia.</li>
        <li>Todo es de <strong>base de caja</strong> y no incluye todavía inventario, facturas por cobrar ni cuentas por pagar a proveedores.</li>
      </ul>
    </section>

    <section class="panel" aria-labelledby="hl-export">
      <div class="panel__head"><h2 class="panel__title" id="hl-export">Exportar reporte de salud financiera</h2></div>
      <p class="panel__sub">Las cinco señales con sus cifras y la forma de calcularlas. Se crea en tu dispositivo.</p>
      ${exportButtons({ kind: 'health', label: 'Exportar el reporte de salud financiera' })}
    </section>`}
  `;
  return { html: page };
}

/** @param {Store} store */
function notAvailablePage(store) {
  const workspace = store.activeWorkspace();
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Salud financiera</h1>
        <p class="page-subtitle">La solidez de tu empresa en cinco señales.</p>
      </div>
    </header>
    <section class="panel">${emptyState({
      icon: 'building',
      title: 'La salud financiera es parte del espacio Empresa',
      text: `${workspace ? `«${workspace.name}» no es un espacio de empresa. ` : ''}Crea (o abre) un espacio Empresa para ver cuánto necesitas vender para no perder, cuántos meses cubre tu efectivo y qué peso tiene tu deuda.`,
      actions: html`<button type="button" class="btn btn--primary" data-action="workspace-menu">Ver mis espacios</button>
        <a class="btn btn--ghost" href="#/finanzas">Volver a Finanzas</a>`,
    })}</section>`;
}
