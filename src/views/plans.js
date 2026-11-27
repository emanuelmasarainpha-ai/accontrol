// @ts-check
// =============================================================================
// PLANES EN PANTALLA (0.20.0): «Tu plan» en Ajustes, la pantalla con candado y el aviso «Esto es Premium»
// -----------------------------------------------------------------------------
// TODAVÍA NO SE PUEDE PAGAR. El botón de pago dice «Próximamente» y no hace nada: no se simula ningún cobro.
// Las reglas (qué trae cada plan) están en domain/plans.js; el plan de la cuenta, en app/plan.js.
// =============================================================================

import { FEATURE_PLAN, featureMessage, limitMessage, PLAN_IDS, PLANS } from '../domain/plans.js';
import { openSheet } from '../ui/dialog.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {import('../domain/plans.js').PlanId} PlanId */
/** @typedef {import('../domain/plans.js').PlanRow} PlanRow */
/** @typedef {import('../domain/plans.js').Feature} Feature */

/** Dónde se ven los planes. */
export const PLANS_HREF = '#/ajustes/plan';

const NOT_YET = 'Todavía no se puede pagar desde ACCONTROL: el pago con Google Play llega en una próxima versión.';

/** Lo que trae un plan, como lista. @param {PlanId} id */
const includesList = (id) => html`<ul class="plan-card__list">${PLANS[id].includes.map((line) => html`<li>${icon('check', 16)}<span>${line}</span></li>`)}</ul>`;

/**
 * Una tarjeta de plan.
 * @param {PlanId} id @param {PlanId} current
 */
function planCard(id, current) {
  const isCurrent = id === current;
  return html`<article class="plan-card${isCurrent ? ' plan-card--current' : ''}" data-plan-card="${id}" aria-labelledby="plan-${id}">
    <header class="plan-card__head">
      <h3 class="plan-card__name" id="plan-${id}">${PLANS[id].label}</h3>
      ${isCurrent ? html`<span class="badge badge--plan">Tu plan</span>` : ''}
    </header>
    <p class="plan-card__price">${PLANS[id].price}</p>
    <p class="plan-card__tagline">${PLANS[id].tagline}</p>
    ${includesList(id)}
  </article>`;
}

/**
 * Frase sobre el origen del plan (prueba abierta, regalo, fecha de fin).
 * @param {PlanRow | null} row
 */
function originNote(row) {
  if (!row) return '';
  const until = row.expiresAt ? ` hasta el ${new Date(row.expiresAt).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
  if (row.source === 'beta') return html`<p class="plan-note">${icon('info', 16)}<span>Estás en la <strong>prueba abierta</strong> de ACCONTROL: tu cuenta tiene el plan ${PLANS[row.plan]?.label ?? ''} gratis${until}, mientras la app no haya salido.</span></p>`;
  if (row.source === 'manual') return html`<p class="plan-note">${icon('info', 16)}<span>Este plan te lo dio ACCONTROL${until}.</span></p>`;
  return until ? html`<p class="plan-note">${icon('info', 16)}<span>Vigente${until}.</span></p>` : '';
}

/**
 * Bloque «Tu plan» de Ajustes.
 * @param {PlanId} current @param {PlanRow | null} row
 */
export function planPanel(current, row) {
  return html`<section class="panel" aria-labelledby="set-plan" data-plan-panel="${current}">
    <h2 class="panel__title" id="set-plan">Tu plan: ${PLANS[current].label}</h2>
    ${originNote(row)}
    <div class="plan-grid">${PLAN_IDS.map((id) => planCard(id, current))}</div>
    <div class="actions actions--start">
      <button type="button" class="btn btn--primary" disabled aria-describedby="plan-not-yet">Mejorar mi plan · Próximamente</button>
    </div>
    <p class="panel__foot" id="plan-not-yet">${NOT_YET} Los precios son de referencia y pueden cambiar antes del lanzamiento. Las copias de seguridad siempre son gratis: tus datos siempre se pueden sacar.</p>
  </section>`;
}

/**
 * Pantalla con candado (en lugar de una pantalla que tu plan no trae).
 * 0.20.11 (pedido de la persona): arriba, la flecha para volver a la sección de donde cuelga (Patrimonio → Finanzas,
 * Diagnóstico y Calculadoras → Estadísticas); sin ella había que volver a tocar el módulo en el menú.
 * @param {Feature} feature @param {string} title
 * @param {{ id: string, label: string } | null} [back] la sección a la que vuelve la flecha
 * @returns {import('../app/app.js').RenderedView}
 */
export function lockedScreen(feature, title, back = null) {
  const plan = FEATURE_PLAN[feature];
  return {
    html: html`<header class="page-header">
        <div>
          ${back ? html`<a class="back-link" href="#/${back.id}" data-locked-back>${icon('back', 16)}${back.label}</a>` : ''}
          <h1 class="page-title">${title}</h1>
          <p class="page-subtitle">${featureMessage(feature)}</p>
        </div>
      </header>
      <section class="panel panel--locked" aria-labelledby="locked-title" data-locked-feature="${feature}">
        <span class="empty__icon">${icon('lock', 22)}</span>
        <h2 class="panel__title" id="locked-title">Con ${PLANS[plan].label} tienes</h2>
        ${includesList(plan)}
        <div class="actions actions--start">
          <a class="btn btn--primary" href="${PLANS_HREF}">Ver los planes</a>
        </div>
      </section>`,
  };
}

/**
 * Aviso «Esto es Premium / Negocio» o «llegaste al límite» (en lugar de abrir el formulario).
 * @param {{ feature: Feature } | { limit: 'goals' | 'debts' }} why
 */
export function openUpgrade(why) {
  const plan = 'feature' in why ? FEATURE_PLAN[why.feature] : 'premium';
  const message = 'feature' in why ? featureMessage(why.feature) : limitMessage(why.limit);
  openSheet({
    title: `Plan ${PLANS[plan].label}`,
    content: html`<div class="upgrade" data-upgrade="${'feature' in why ? why.feature : why.limit}">
      <p class="upgrade__message">${icon('lock', 18)}<span>${message}</span></p>
      ${includesList(plan)}
      <p class="muted">${NOT_YET}</p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Ahora no</button>
        <a class="btn btn--primary" href="${PLANS_HREF}" data-close>Ver los planes</a>
      </div>
    </div>`,
  });
}
