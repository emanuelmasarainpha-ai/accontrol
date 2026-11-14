// @ts-check
// =============================================================================
// PATRIMONIO (documento maestro §5 y §20)
// Patrimonio neto = Activos - Pasivos, con su evolución mes a mes y de dónde sale cada número.
//
// Todos los cálculos salen de domain/netWorth.js; aquí solo se dibuja. Los botones
// (Añadir activo, Editar, Actualizar valor) son acciones comunes (app/actions.js).
// =============================================================================

import { ASSET_CATEGORIES, ASSET_CATEGORY_ORDER, assetTypeLabel } from '../domain/assets.js';
import { formatDate, monthLabel, monthShortLabel, plural } from '../domain/dates.js';
import { assetBreakdown, netWorthSummary } from '../domain/netWorth.js';
import { formatMoney } from '../domain/money.js';
import { lineChart } from '../ui/charts.js';
import { demoBadge, demoBanner, emptyState, exportButtons, financeTabs, money, netWorthCard, tableView } from '../ui/components.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/**
 * @param {Store} store
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderNetWorth(store) {
  const { data } = store.getState();
  const today = store.today();
  const summary = netWorthSummary(data, today);
  const now = summary.now;
  const groups = assetBreakdown(now);
  const series = summary.series;
  const isEmpty = data.assets.length === 0 && data.debts.length === 0 && data.movements.length === 0 && data.settings.openingBalanceCents === 0;

  const assetLines = ASSET_CATEGORY_ORDER.map((key) => {
    const items = now.assets.filter((a) => a.asset.category === key).sort((a, b) => b.valueCents - a.valueCents);
    if (items.length === 0) return '';
    const total = groups.find((g) => g.key === key)?.valueCents ?? 0;
    return html`<div class="nw-group">
      <h3 class="nw-group__head"><span>${ASSET_CATEGORIES[key].label}</span><span>${money(total)}</span></h3>
      <ul class="nw-lines">${items.map(({ asset, valueCents }) => html`<li class="nw-line">
        <span class="nw-line__main">
          <span class="nw-line__name">${asset.name}</span>
          <span class="nw-line__meta">${assetTypeLabel(asset)} · desde ${formatDate(asset.acquiredDate)}${asset.valuations.length > 1 ? ` · ${plural(asset.valuations.length, 'valor registrado', 'valores registrados')}` : ''}</span>
        </span>
        <span class="nw-line__side">
          ${asset.isDemo ? demoBadge() : ''}
          <span class="nw-line__value">${money(valueCents)}</span>
          <button type="button" class="btn btn--ghost btn--small" data-action="asset-value" data-id="${asset.id}">Actualizar valor</button>
          <button type="button" class="btn btn--ghost btn--small" data-action="asset-edit" data-id="${asset.id}">Editar</button>
        </span>
      </li>`)}</ul>
    </div>`;
  });

  const debtLines = now.debts.sort((a, b) => b.balanceCents - a.balanceCents).map(
    ({ debt, balanceCents }) => html`<li class="nw-line">
      <span class="nw-line__main">
        <a class="nw-line__name" href="#/deudas/${debt.id}">${debt.name}</a>
        <span class="nw-line__meta">Lo que aún debes de esta deuda</span>
      </span>
      <span class="nw-line__side">${debt.isDemo ? demoBadge() : ''}<span class="nw-line__value">${money(balanceCents)}</span></span>
    </li>`,
  );

  return {
    html: html`
      <header class="page-header">
        <div>
          <h1 class="page-title">Finanzas</h1>
          <p class="page-subtitle">Tu patrimonio: lo que tienes menos lo que debes.</p>
        </div>
        <button type="button" class="btn btn--primary" data-action="new-asset">${icon('plus', 18)}Añadir activo</button>
      </header>

      ${financeTabs('patrimonio', store)}
      ${demoBanner(store.hasDemoData())}

      ${netWorthCard(summary, today)}

      ${now.moneyCents < 0
        ? html`<p class="notice notice--warn" role="note">${icon('alert', 18)}<span>Tu dinero registrado es negativo (${formatMoney(now.moneyCents)}): tus gastos superan lo que registraste como ingresos y saldo inicial. Probablemente falta anotar algún ingreso o tu saldo inicial; mientras tanto, tu patrimonio sale más bajo de lo real.</span></p>`
        : ''}

      ${isEmpty
        ? html`<section class="panel">${emptyState({
            icon: 'bank',
            title: 'Aquí verás cuánto vale todo lo tuyo',
            text: 'Tu patrimonio se calcula con tus ingresos, gastos, metas, deudas y los activos que registres (cuentas, inversiones, vehículos, inmuebles...).',
            actions: html`<button type="button" class="btn btn--primary" data-action="new-asset">Añadir activo</button>
              <button type="button" class="btn btn--ghost" data-action="load-demo">Ver con datos de demostración</button>`,
          })}</section>`
        : html`
      <section class="panel" aria-labelledby="nw-evo">
        <div class="panel__head"><h2 class="panel__title" id="nw-evo">Evolución del patrimonio</h2></div>
        <p class="panel__sub">Cierre de cada mes${series.length > 1 ? ` (${series.length} meses)` : ''}. Se reconstruye con tus registros.</p>
        ${series.length < 2
          ? html`<p class="muted">La evolución aparece cuando tengas registros de más de un mes.</p>`
          : html`<div class="chart-host" id="chart-networth" role="presentation"></div>
            ${tableView({
              caption: 'Activos, pasivos y patrimonio neto al cierre de cada mes',
              headers: ['Mes', 'Activos', 'Pasivos', 'Patrimonio neto'],
              rows: series.map((s) => [monthLabel(s.monthKey), formatMoney(s.point.assetsCents), formatMoney(s.point.liabilitiesCents), formatMoney(s.point.netWorthCents)]),
            })}`}
      </section>

      <section class="panel" aria-labelledby="nw-assets">
        <div class="panel__head">
          <h2 class="panel__title" id="nw-assets">Lo que tienes</h2>
          <strong>${money(now.assetsCents)}</strong>
        </div>
        <div class="nw-group">
          <h3 class="nw-group__head"><span>Tu dinero registrado</span><span>${money(now.moneyCents, { tone: 'auto' })}</span></h3>
          <ul class="nw-lines">
            <li class="nw-line"><span class="nw-line__main"><span class="nw-line__name">Dinero disponible</span><span class="nw-line__meta">Saldo inicial más ingresos, menos gastos y lo apartado en metas</span></span><span class="nw-line__side"><span class="nw-line__value">${money(now.availableCents, { tone: 'auto' })}</span></span></li>
            <li class="nw-line"><span class="nw-line__main"><a class="nw-line__name" href="#/metas">Ahorrado en metas</a><span class="nw-line__meta">Sigue siendo tuyo: solo está apartado</span></span><span class="nw-line__side"><span class="nw-line__value">${money(now.savedCents)}</span></span></li>
          </ul>
        </div>
        ${data.assets.length === 0
          ? html`<p class="nw-note">Aún no registraste otros activos. Añade una cuenta aparte, una inversión, un vehículo, un inmueble... para que cuenten en tu patrimonio.</p>`
          : assetLines}
        ${data.assets.some((a) => !now.assets.some((x) => x.asset.id === a.id))
          ? html`<p class="nw-note">Algún activo tiene fecha de adquisición posterior a hoy y no se cuenta.</p>`
          : ''}
        <p class="nw-note">Si un activo es dinero que ya cuentas arriba (por ejemplo, tu cuenta del banco que usas para tus ingresos y gastos), no lo repitas: se contaría dos veces.</p>
      </section>

      <section class="panel" aria-labelledby="nw-debts">
        <div class="panel__head">
          <h2 class="panel__title" id="nw-debts">Lo que debes</h2>
          <strong>${money(now.liabilitiesCents)}</strong>
        </div>
        ${now.debts.length === 0
          ? html`<p class="muted">No tienes deudas con saldo. Las deudas que registres en la pestaña <a href="#/deudas">Deudas</a> se restan aquí solas.</p>`
          : html`<ul class="nw-lines">${debtLines}</ul>
            <p class="nw-note">Una deuda cuenta desde que la registras (o desde su primer pago). Si el préstamo te dio dinero, anótalo como ingreso o como un activo; si no, tu patrimonio baja por el monto de la deuda, porque eso es lo que dicen tus registros.</p>`}
      </section>

      <section class="panel" aria-labelledby="nw-export">
        <div class="panel__head"><h2 class="panel__title" id="nw-export">Exportar patrimonio</h2></div>
        <p class="panel__sub">Resumen, activos, deudas y evolución mes a mes. Se crea en tu dispositivo.</p>
        ${exportButtons({ kind: 'networth', label: 'Exportar el patrimonio neto' })}
        <p class="panel__foot">El CSV trae solo la evolución mes a mes; el Excel y el PDF traen todo.</p>
      </section>

      <section class="panel" aria-labelledby="nw-how">
        <div class="panel__head"><h2 class="panel__title" id="nw-how">Cómo se calcula</h2></div>
        <p><strong>Patrimonio neto = Activos − Pasivos.</strong> Los activos son tu dinero registrado (disponible más ahorrado en metas) y los activos que anotas a mano, con el último valor que les pusiste. Los pasivos son lo que te falta por pagar de tus deudas. Se actualiza solo cada vez que registras algo, y el historial se reconstruye con las fechas de tus registros.</p>
        <p class="nw-note">Los valores de los activos son estimaciones tuyas: ACCONTROL no los consulta en ningún mercado. Esto no es asesoría financiera.</p>
      </section>`}
    `,
    mount: (root) => {
      const host = root.querySelector('#chart-networth');
      if (!(host instanceof HTMLElement) || series.length < 2) return undefined;
      return lineChart(host, {
        labels: series.map((s) => monthShortLabel(s.monthKey)),
        titles: series.map((s) => monthLabel(s.monthKey)),
        values: series.map((s) => s.point.netWorthCents),
        name: 'Patrimonio neto',
        cls: 'primary',
        zeroBase: false,
        ariaLabel: `Patrimonio neto al cierre de cada mes, de ${monthLabel(series[0].monthKey)} a ${monthLabel(series[series.length - 1].monthKey)}`,
      });
    },
  };
}
