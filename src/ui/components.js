// @ts-check
// =============================================================================
// PIEZAS REUTILIZABLES DE PANTALLA
// Cada función devuelve una plantilla segura (html`...`).
// =============================================================================

import { addMonths, formatDate, monthKeyOf, monthLabel, plural } from '../domain/dates.js';
import { formatMoney, formatPercent, moneyParts } from '../domain/money.js';
import { GRANULARITIES, GRANULARITY_LABELS } from '../domain/summaries.js';
import { CLASSIFICATION_LABELS, TYPE_LABELS } from '../domain/types.js';
import { guillocheRosette } from './guilloche.js';
import { html } from './html.js';
import { icon } from './icons.js';

/** @typedef {import('./html.js').SafeHtml} SafeHtml */
/** @typedef {import('../domain/types.js').Movement} Movement */
/** @typedef {import('../domain/types.js').Contribution} Contribution */
/** @typedef {import('../domain/types.js').Goal} Goal */
/** @typedef {import('../domain/types.js').Category} Category */

/**
 * Monto con formato. `tone` pinta en verde (positivo) o rojo (alerta).
 * @param {number} cents
 * @param {{ sign?: boolean, decimals?: boolean, tone?: 'income' | 'alert' | 'auto' | 'none' }} [options]
 */
export function money(cents, { sign = false, decimals = true, tone = 'none' } = {}) {
  const resolved = tone === 'auto' ? (cents < 0 ? 'alert' : 'none') : tone;
  return html`<span class="money${resolved === 'income' ? ' money--income' : ''}${resolved === 'alert' ? ' money--alert' : ''}">${formatMoney(cents, { sign, decimals })}</span>`;
}

/**
 * Monto grande con los centavos más pequeños (para la cifra principal).
 * @param {number} cents
 */
export function heroMoney(cents) {
  const p = moneyParts(cents);
  // El monto exacto va en texto oculto para el lector de pantalla; lo visible (que puede «contar» al llegar a la
  // pantalla, ui/countUp.js) está oculto para él, así nunca anuncia cifras intermedias.
  return html`<span class="hero__amount${p.whole.length + (p.negative ? 1 : 0) > 9 ? ' hero__amount--long' : ''}" data-count-to="${cents}" data-count-style="hero">
    <span class="sr-only">${formatMoney(cents)}</span><span class="hero__symbol" aria-hidden="true" data-count-part="sign">${p.negative ? '-' : ''}${p.symbol}</span><span aria-hidden="true" data-count-part="whole">${p.whole}</span><span class="hero__cents" aria-hidden="true" data-count-part="fraction">.${p.fraction}</span>
  </span>`;
}

export function demoBadge() {
  return html`<span class="badge badge--demo" title="Dato de demostración">DEMO</span>`;
}

/**
 * Aviso fijo cuando hay datos de demostración en pantalla.
 * @param {boolean} visible
 */
export function demoBanner(visible) {
  if (!visible) return '';
  return html`<div class="banner" role="note">
    <p class="banner__text"><strong>Hay datos de demostración.</strong> Son inventados y están marcados como DEMO, pero <strong>cuentan en los totales</strong> mientras no los borres. Tus registros reales no se modifican.</p>
    <button type="button" class="btn btn--small btn--ghost" data-action="remove-demo">Borrar demostración</button>
  </div>`;
}

/**
 * @param {{ icon?: string, title: string, text: string | SafeHtml, actions?: SafeHtml | '' }} options
 */
export function emptyState({ icon: iconName = 'info', title, text, actions = '' }) {
  return html`<div class="empty">
    ${emptyArt(iconName)}
    <h3 class="empty__title">${title}</h3>
    <p class="empty__text">${text}</p>
    ${actions ? html`<div class="empty__actions">${actions}</div>` : ''}
  </div>`;
}

/**
 * Dibujo de los estados vacíos, del mundo «El billete dominicano»: un fragmento de la roseta de guilloché en el
 * color del espacio, con el ícono de la sección en un medallón. Sobrio (nada de confeti) y decorativo (aria-hidden).
 * @param {string} iconName
 */
export function emptyArt(iconName) {
  return html`<span class="empty__art" aria-hidden="true">
    ${guillocheRosette('empty__rosette')}
    <span class="empty__glyph">${icon(iconName, 26)}</span>
  </span>`;
}

/**
 * Selector de mes con flechas. Los botones llevan data-action="month-prev" / "month-next".
 * @param {string} monthKey @param {{ canGoNext: boolean }} options
 */
export function monthSelector(monthKey, { canGoNext }) {
  return html`<div class="month-selector" role="group" aria-label="Mes">
    <button type="button" class="icon-btn" data-action="month-prev" aria-label="Mes anterior">${icon('chevronLeft')}</button>
    <span class="month-selector__label" aria-live="polite">${monthLabel(monthKey)}</span>
    <button type="button" class="icon-btn" data-action="month-next" aria-label="Mes siguiente" ${canGoNext ? '' : 'disabled'}>${icon('chevronRight')}</button>
  </div>`;
}

/**
 * Selector Mensual | Trimestral | Anual. Los botones llevan data-action="period" y data-period.
 * @param {import('../domain/summaries.js').Granularity} active
 */
export function periodSwitch(active) {
  return html`<div class="period-switch" role="group" aria-label="Agrupar por">${GRANULARITIES.map(
    (g) => html`<button type="button" class="period-switch__btn" data-action="period" data-period="${g}" aria-pressed="${active === g ? 'true' : 'false'}">${GRANULARITY_LABELS[g]}</button>`,
  )}</div>`;
}

/**
 * "Tu ritmo actual" de una meta: cuánto aportas al mes, si así llegas a tiempo y para cuándo.
 * Es una estimación que supone que seguirás aportando igual, y el bloque lo dice.
 * @param {import('../domain/goals.js').GoalPace} pace @param {{ overdue: boolean }} options
 */
export function goalPaceBlock(pace, { overdue }) {
  if (pace.status === 'completed') return '';
  const windowText = pace.windowMonths === 1 ? 'el último mes' : `los últimos ${pace.windowMonths} meses`;
  const needed = pace.monthlyNeededCents > 0 ? formatMoney(pace.monthlyNeededCents, { decimals: false }) : null;
  const needText = needed && !overdue ? ` Para llegar a tiempo necesitarías aportar ${needed} al mes.` : '';

  /** @type {'good' | 'warn' | 'none'} */
  let tone = 'none';
  let figure = html`<span class="muted">Sin aportes</span>`;
  /** @type {string} */
  let text;
  if (pace.status === 'no-data') {
    text = 'Esta meta todavía no tiene aportes. Cuando aportes, aquí verás tu ritmo y para cuándo llegarías.';
  } else if (pace.status === 'stalled') {
    tone = 'warn';
    figure = html`<span class="money">${formatMoney(0, { decimals: false })} al mes</span>`;
    text = `En ${windowText} no aportaste a esta meta (o retiraste más de lo que aportaste), así que no hay un ritmo con el que calcular una fecha.${needText}`;
  } else {
    figure = html`<span class="money">${formatMoney(pace.monthlyPaceCents, { decimals: false })} al mes</span>`;
    const when = pace.projectedDate ? formatDate(pace.projectedDate) : '';
    if (pace.status === 'on-track') {
      tone = 'good';
      text = `A este ritmo la cumples hacia el ${when}, antes de tu fecha objetivo.`;
    } else {
      tone = 'warn';
      if (pace.tooFar) text = `A este ritmo tardarías más de 100 años en llegar.${needText}`;
      else if (overdue) text = `La fecha objetivo ya pasó. A este ritmo la cumplirías hacia el ${when}.`;
      else text = `A este ritmo la cumplirías hacia el ${when}, ${plural(pace.lateDays ?? 0, 'día', 'días')} después de tu fecha objetivo.${needText}`;
    }
  }
  return html`<div class="pace pace--${tone}">
    <p class="pace__head"><span class="pace__title">Tu ritmo actual</span><strong class="pace__figure">${figure}</strong></p>
    <p class="pace__text">${text}</p>
    ${pace.status === 'no-data' ? '' : html`<p class="pace__foot">Promedio de ${windowText}. Supone que sigues aportando igual: es una estimación, no una promesa.</p>`}
  </div>`;
}

/** Icono de cada estado de viabilidad: el estado nunca se dice solo con color. */
const FEASIBILITY_ICONS = /** @type {Record<string, string>} */ ({
  'on-track': 'check', viable: 'check', tight: 'info', unreachable: 'alert', overdue: 'alert', unknown: 'info',
});

/**
 * Viabilidad de una meta (domain/diagnosisCards.js → feasibilityText): una etiqueta con texto e icono y lo que significa.
 * @param {{ status: string, label: string, text: string }} t
 */
export function feasibilityBlock(t) {
  const tone = t.status === 'on-track' || t.status === 'viable' ? 'good' : t.status === 'tight' ? 'warn' : t.status === 'unreachable' || t.status === 'overdue' ? 'alert' : 'none';
  return html`<div class="pace pace--${tone} feas" data-feasibility="${t.status}">
    <p class="pace__head"><span class="pace__title">¿Cabe en tu capacidad de ahorro?</span><strong class="feas__label">${icon(FEASIBILITY_ICONS[t.status] ?? 'info', 14)}${t.label}</strong></p>
    <p class="pace__text">${t.text}</p>
  </div>`;
}

/**
 * Leyenda de un gráfico (siempre visible cuando hay 2 o más series).
 * @param {{ label: string, cls: string, value?: string }[]} items
 */
export function legend(items) {
  return html`<ul class="legend">${items.map(
    (i) => html`<li class="legend__item"><span class="swatch swatch--${i.cls}"></span><span class="legend__label">${i.label}</span>${i.value ? html`<span class="legend__value">${i.value}</span>` : ''}</li>`,
  )}</ul>`;
}

/**
 * Gemelo en tabla de un gráfico (accesible y sin depender del ratón).
 * @param {{ caption: string, headers: string[], rows: (string | number)[][] }} spec
 */
export function tableView({ caption, headers, rows }) {
  return html`<details class="table-view">
    <summary>Ver como tabla</summary>
    <div class="table-view__scroll">
      <table class="table">
        <caption class="sr-only">${caption}</caption>
        <thead><tr>${headers.map((h, i) => html`<th scope="col" class="${i > 0 ? 'num' : ''}">${h}</th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr>${r.map((cell, i) => (i === 0 ? html`<th scope="row">${cell}</th>` : html`<td class="num">${cell}</td>`))}</tr>`)}</tbody>
      </table>
    </div>
  </details>`;
}

/**
 * Cambio porcentual con flecha y color según sea bueno o malo.
 * @param {number | null} change @param {{ upIsGood: boolean, since: string }} options
 */
export function delta(change, { upIsGood, since }) {
  if (change === null) return html`<span class="delta delta--none">Sin mes anterior para comparar</span>`;
  const rounded = Math.round(change);
  if (rounded === 0) return html`<span class="delta delta--none">Igual que ${since}</span>`;
  const up = rounded > 0;
  const good = up === upIsGood;
  return html`<span class="delta ${good ? 'delta--good' : 'delta--bad'}">${icon(up ? 'arrowUp' : 'arrowDown', 14)}${Math.abs(rounded)}% vs. ${since}</span>`;
}

/**
 * Fila de un ingreso o gasto en la lista de Finanzas.
 * @param {Movement} m @param {Category | undefined} category
 * @param {string} [linkText]  A quién se le cobró («Ana Pérez · Logo»), si el ingreso está vinculado a un cliente.
 */
export function movementRow(m, category, linkText = '') {
  const isIncome = m.type === 'income';
  return html`<li class="row-item">
    <button type="button" class="row" data-action="edit-movement" data-id="${m.id}" aria-label="${TYPE_LABELS[m.type]}: ${m.description}, ${formatMoney(m.amountCents)}. Editar">
      <span class="row__main">
        <span class="row__top">
          <span class="tag tag--${m.type}">${TYPE_LABELS[m.type]}</span>
          ${m.isDemo ? demoBadge() : ''}
        </span>
        <span class="row__title">${m.description}</span>
        <span class="row__meta">
          <span>${category?.name ?? 'Sin categoría'}</span>
          <span class="chip">${CLASSIFICATION_LABELS[m.classification]}</span>
          ${linkText ? html`<span class="chip chip--client">${linkText}</span>` : ''}
        </span>
      </span>
      <span class="row__side">
        <span class="row__amount${isIncome ? ' row__amount--income' : ''}">${formatMoney(isIncome ? m.amountCents : -m.amountCents, { sign: isIncome })}</span>
        <span class="row__time">${m.time}</span>
      </span>
    </button>
  </li>`;
}

/**
 * Fila de un aporte o retiro de meta en la lista de Finanzas.
 * @param {Contribution} c @param {Goal | undefined} goal
 */
export function contributionRow(c, goal) {
  const isDeposit = c.kind === 'deposit';
  const label = isDeposit ? 'Ahorro' : 'Retiro de ahorro';
  return html`<li class="row-item">
    <button type="button" class="row" data-action="edit-contribution" data-id="${c.id}" aria-label="${label}: ${goal?.name ?? 'meta eliminada'}, ${formatMoney(c.amountCents)}. Editar">
      <span class="row__main">
        <span class="row__top">
          <span class="tag tag--saving">${label}</span>
          ${c.isDemo ? demoBadge() : ''}
        </span>
        <span class="row__title">${goal?.name ?? 'Meta eliminada'}</span>
        <span class="row__meta"><span>${c.note || (isDeposit ? 'Aporte a la meta' : 'Retiro de la meta')}</span></span>
      </span>
      <span class="row__side">
        <span class="row__amount">${formatMoney(isDeposit ? -c.amountCents : c.amountCents, { sign: !isDeposit })}</span>
        <span class="row__time">${c.time}</span>
      </span>
    </button>
  </li>`;
}

/**
 * Lista agrupada por día. `items` ya viene ordenado de más reciente a más antiguo.
 * @param {{ date: string, content: SafeHtml }[]} items
 */
export function groupedByDay(items) {
  /** @type {Map<string, SafeHtml[]>} */
  const groups = new Map();
  for (const item of items) {
    const list = groups.get(item.date) ?? [];
    list.push(item.content);
    groups.set(item.date, list);
  }
  return html`${[...groups.entries()].map(
    ([date, rows]) => html`<section class="day">
      <h3 class="day__title">${formatDate(date)}</h3>
      <ul class="rows">${rows}</ul>
    </section>`,
  )}`;
}

/**
 * Barra de progreso accesible (usa <progress>, que no necesita estilos en línea).
 * @param {number} percent 0-100 @param {string} label
 */
export function progress(percent, label) {
  const value = Math.round(percent * 10) / 10;
  // El contenedor lleva la «cortina» que descubre el relleno al llegar a la pantalla (motion.css); la barra nativa
  // queda igual para el lector de pantalla.
  return html`<span class="progress-wrap"><progress class="progress" max="100" value="${value}" aria-label="${label}">${value}%</progress></span>`;
}

/** @typedef {'movimientos' | 'resultados' | 'salud' | 'clientes' | 'departamentos' | 'inventario' | 'facturas' | 'fiado' | 'deudas' | 'patrimonio'} FinanceTab */

/**
 * Pestañas dentro de Finanzas: Movimientos | Resultados | Salud | Clientes | Departamentos | Inventario | Facturas | Fiado (cada una solo si el
 * espacio la usa) | Deudas | Patrimonio. Qué pestañas hay lo decide el espacio abierto (`store`), así cada pantalla de Finanzas muestra las
 * mismas y una pestaña nueva se añade aquí una sola vez.
 * @param {FinanceTab} active
 * @param {{ clientsEnabled: () => boolean, resultsEnabled: () => boolean, healthEnabled: () => boolean, departmentsEnabled: () => boolean, inventoryEnabled: () => boolean, invoicesEnabled: () => boolean, fiadoEnabled?: () => boolean }} store
 */
export function financeTabs(active, store) {
  /** @param {FinanceTab} id @param {string} label */
  const tab = (id, label) =>
    html`<a class="subtab" href="#/${id === 'movimientos' ? 'finanzas' : id}" aria-current="${active === id ? 'page' : 'false'}">${label}</a>`;
  return html`<nav class="subtabs" aria-label="Secciones de Finanzas">${tab('movimientos', 'Movimientos')}${store.resultsEnabled() ? tab('resultados', 'Resultados') : ''}${store.healthEnabled() ? tab('salud', 'Salud') : ''}${store.clientsEnabled() ? tab('clientes', 'Clientes') : ''}${store.departmentsEnabled() ? tab('departamentos', 'Departamentos') : ''}${store.inventoryEnabled() ? tab('inventario', 'Inventario') : ''}${store.invoicesEnabled() ? tab('facturas', 'Facturas') : ''}${store.fiadoEnabled?.() ? tab('fiado', 'Fiado') : ''}${tab('deudas', 'Deudas')}${tab('patrimonio', 'Patrimonio')}</nav>`;
}

/**
 * Una variación del patrimonio ("▲ +RD$ 2,000.00 (3.1%) · este mes · vs. cierre de junio").
 * @param {{ changeCents: number, percent: number | null } | null} change
 * @param {{ period: string, since: string, none: string }} labels
 */
function netWorthVariation(change, { period, since, none }) {
  if (change === null) return html`<li class="nw-hero__delta nw-hero__delta--none"><span>${period}</span><span>${none}</span></li>`;
  const up = change.changeCents > 0;
  const same = change.changeCents === 0;
  const pctText = change.percent === null ? '' : ` (${up ? '+' : ''}${formatPercent(change.percent)})`;
  return html`<li class="nw-hero__delta${up ? ' nw-hero__delta--up' : ''}">
    <span>${period}</span>
    <span class="nw-hero__change">${same ? '' : icon(up ? 'arrowUp' : 'arrowDown', 14)}${same ? 'Sin cambios' : `${formatMoney(change.changeCents, { sign: true })}${pctText}`} <span class="nw-hero__since">vs. ${since}</span></span>
  </li>`;
}

/**
 * Tarjeta principal del patrimonio neto (Inicio y Patrimonio).
 * @param {import('../domain/netWorth.js').NetWorthSummary} summary @param {string} today
 * @param {{ link?: boolean }} [options]
 */
export function netWorthCard(summary, today, { link = false } = {}) {
  const { now, monthly, annual } = summary;
  const prevMonth = monthLabel(addMonths(monthKeyOf(today), -1)).split(' ')[0];
  const yearBase = monthLabel(addMonths(monthKeyOf(today), -12));
  return html`<section class="nw-hero${now.netWorthCents < 0 ? ' nw-hero--negative' : ''}" aria-labelledby="nw-label">
    <div class="nw-hero__head">
      <p class="nw-hero__label" id="nw-label">Patrimonio neto</p>
      ${link ? html`<a class="nw-hero__link" href="#/patrimonio">Ver patrimonio</a>` : ''}
    </div>
    <p class="nw-hero__amount" data-count-to="${now.netWorthCents}" data-count-style="plain"><span class="sr-only">${formatMoney(now.netWorthCents)}</span><span aria-hidden="true" data-count-part="all">${formatMoney(now.netWorthCents)}</span></p>
    <p class="nw-hero__caption">Lo que tienes (${formatMoney(now.assetsCents)}) menos lo que debes (${formatMoney(now.liabilitiesCents)}).</p>
    <ul class="nw-hero__deltas">
      ${netWorthVariation(monthly, { period: 'Este mes', since: `cierre de ${prevMonth}`, none: 'Sin mes anterior para comparar' })}
      ${netWorthVariation(annual, { period: 'En el año', since: yearBase, none: 'Aún no hay un año de historial' })}
    </ul>
  </section>`;
}

/** Texto del nivel de riesgo. @type {Record<'low' | 'medium' | 'high', string>} */
const RISK_TEXT = { low: 'Riesgo bajo', medium: 'Riesgo medio', high: 'Riesgo alto' };

/**
 * Etiqueta de riesgo: punto de color + texto + puntaje (el color nunca va solo).
 * @param {'low' | 'medium' | 'high'} level @param {number | null} [score]
 */
export function riskBadge(level, score = null) {
  return html`<span class="risk risk--${level}"><span class="risk__dot" aria-hidden="true"></span>${RISK_TEXT[level]}${score === null ? '' : html` <span class="risk__score">${score}</span>`}</span>`;
}

/**
 * Botones para exportar (PDF, Excel, CSV). Los maneja la acción común "export" (app/actions.js).
 * @param {{ kind: 'month' | 'debts' | 'debt' | 'networth' | 'clients' | 'results' | 'health' | 'diagnosis' | 'inventory' | 'invoices' | 'departments', id?: string, month?: string, granularity?: string, label?: string }} target
 */
export function exportButtons({ kind, id = '', month = '', granularity = '', label = 'Exportar' }) {
  /** @param {'pdf' | 'xlsx' | 'csv'} format @param {string} text */
  const button = (format, text) =>
    html`<button type="button" class="btn btn--ghost btn--small" data-action="export" data-kind="${kind}" data-format="${format}" data-id="${id}" data-month="${month}" data-granularity="${granularity}">${icon('download', 16)}${text}</button>`;
  return html`<div class="export" role="group" aria-label="${label}">${button('pdf', 'PDF')}${button('xlsx', 'Excel')}${button('csv', 'CSV')}</div>`;
}
