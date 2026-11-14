// @ts-check
// =============================================================================
// LOGROS, RACHAS Y NIVELES (documento maestro §13)
// Pantalla «Logros» (#/logros) y la tarjeta «Tu nivel» de Inicio.
//
// Todo sale de domain/gamification.js y se calcula en el momento con tus datos
// REALES: los de demostración no suman. Nada de lo que se muestra aquí se guarda
// aparte. El estado de cada logro se dice con TEXTO («Logrado», «En progreso»,
// «Pendiente»), no solo con color.
// =============================================================================

import { LEVELS, TIER_LABELS, gamification, streakText } from '../domain/gamification.js';
import { plural } from '../domain/dates.js';
import { progress } from '../ui/components.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {ReturnType<typeof gamification>} Gamification */
/** @typedef {Gamification['achievements'][number]} Achievement */

/**
 * Gamificación del espacio abierto (los logros que se ofrecen dependen de las funciones que usa el espacio).
 * @param {Store} store
 * @returns {Gamification}
 */
export function gamificationFor(store) {
  return gamification(store.getState().data, store.today(), {
    clients: store.clientsEnabled(),
    inventory: store.inventoryEnabled(),
    invoices: store.invoicesEnabled(),
    departments: store.departmentsEnabled(),
  });
}

/**
 * Una racha como tarjeta pequeña.
 * @param {string} label @param {import('../domain/gamification.js').Streak} s @param {'day' | 'week' | 'month'} unit
 */
function streakKpi(label, s, unit) {
  const note = s.current === 0
    ? s.best > 0 ? `Mejor: ${streakText(s.best, unit)}` : 'Aún sin racha'
    : s.atRisk
      ? `En riesgo: registra algo ${unit === 'day' ? 'hoy' : unit === 'week' ? 'esta semana' : 'este mes'}`
      : `Mejor: ${streakText(s.best, unit)}`;
  return html`<div class="kpi">
    <dt>${label}</dt>
    <dd>${streakText(s.current, unit)}</dd>
    <dd class="kpi__note">${note}</dd>
  </div>`;
}

/**
 * Aviso cuando hay una racha diaria viva que se pierde si hoy no se registra nada.
 * @param {Gamification} g
 */
function riskNote(g) {
  const s = g.streaks.daily;
  if (!s.atRisk || s.current < 2) return '';
  return html`<p class="flow__alert flow__alert--soft" role="status">${icon('info', 16)}Llevas ${streakText(s.current, 'day')} seguidos. Registra algo hoy y tu racha sigue viva.</p>`;
}

/**
 * Tarjeta «Tu nivel» para Inicio.
 * @param {Gamification} g
 */
export function levelCard(g) {
  const { level } = g;
  return html`<section class="panel" aria-labelledby="gami-title" id="gami-card">
    <div class="panel__head">
      <h2 class="panel__title" id="gami-title">Tu nivel</h2>
      <button type="button" class="link-btn" data-action="go" data-route="logros">Ver logros</button>
    </div>
    <p class="level-line"><strong class="level-line__name">Nivel ${level.number} de ${level.total}: ${level.name}</strong>
      <span class="chip">${plural(g.points, 'punto', 'puntos')}</span></p>
    ${level.next
      ? html`${progress(level.percentToNext, `Avance hacia el nivel ${level.next.name}`)}
        <p class="muted">Te ${level.pointsToNext === 1 ? 'falta 1 punto' : `faltan ${level.pointsToNext} puntos`} para «${level.next.name}».</p>`
      : html`<p class="muted">Llegaste al nivel más alto. ¡Sigue así!</p>`}
    <dl class="kpis kpis--3">
      ${streakKpi('Racha diaria', g.streaks.daily, 'day')}
      ${streakKpi('Racha semanal', g.streaks.weekly, 'week')}
      ${streakKpi('Racha mensual', g.streaks.monthly, 'month')}
    </dl>
    ${riskNote(g)}
    <p class="panel__foot">${g.hasReal
      ? `${g.doneCount} de ${g.totalCount} logros.`
      : 'Registra tu primer movimiento para empezar a sumar puntos.'}
      ${g.demoIgnored > 0 ? ' Los datos de demostración no suman puntos ni rachas.' : ''}</p>
  </section>`;
}

/**
 * Un logro en la lista.
 * @param {Achievement} a
 */
function achievementItem(a) {
  const status = a.done ? 'Logrado' : a.current > 0 ? 'En progreso' : 'Pendiente';
  const state = a.done ? 'done' : a.current > 0 ? 'doing' : 'todo';
  return html`<li class="ach ach--${state}" data-achievement="${a.id}" data-state="${state}">
    <span class="ach__mark" aria-hidden="true">${a.done ? icon('check', 18) : ''}</span>
    <div class="ach__body">
      <p class="ach__title"><strong>${a.title}</strong> <span class="ach__status">${status}</span></p>
      <p class="ach__text">${a.text}</p>
      ${!a.done && a.target > 1
        ? html`<div class="ach__progress">${progress((a.current / a.target) * 100, `Avance de «${a.title}»`)}<span class="ach__count">${a.current} de ${a.target}</span></div>`
        : ''}
    </div>
    <span class="chip ach__tier">${TIER_LABELS[a.tier]} · ${a.points} pts</span>
  </li>`;
}

/**
 * @param {Store} store
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderAchievements(store) {
  const g = gamificationFor(store);
  const { level } = g;

  return {
    html: html`
      <a class="back-link" href="#/inicio">${icon('back', 16)}Inicio</a>
      <header class="page-header" data-tour="achievements">
        <div>
          <h1 class="page-title">Logros</h1>
          <p class="page-subtitle">Tu nivel, tus rachas y lo que ya conseguiste.</p>
        </div>
      </header>

      ${g.demoIgnored > 0
        ? html`<p class="notice notice--warn" role="note" id="gami-demo-note">${icon('info', 18)}<span>Hay ${plural(g.demoIgnored, 'registro', 'registros')} de demostración: <strong>no suman</strong> puntos, rachas ni logros. Solo cuenta lo que registras tú.</span></p>`
        : ''}

      <section class="panel" aria-labelledby="lvl-title">
        <div class="panel__head">
          <h2 class="panel__title" id="lvl-title">Nivel ${level.number} de ${level.total}: ${level.name}</h2>
          <span class="chip">${plural(g.points, 'punto', 'puntos')} de ${g.maxPoints}</span>
        </div>
        <p class="panel__sub">${level.text}</p>
        ${level.next
          ? html`${progress(level.percentToNext, `Avance hacia el nivel ${level.next.name}`)}
            <p class="muted">Te ${level.pointsToNext === 1 ? 'falta 1 punto' : `faltan ${level.pointsToNext} puntos`} para «${level.next.name}».</p>`
          : html`<p class="muted">Llegaste al nivel más alto.</p>`}
        <ol class="lvl-list" aria-label="Todos los niveles">${LEVELS.map((l, i) => html`<li class="lvl-list__item lvl-list__item--${i < level.index ? 'past' : i === level.index ? 'now' : 'next'}">
          <span class="lvl-list__name">${i + 1}. ${l.name}</span>
          <span class="lvl-list__meta">${l.min === 0 ? 'Desde el inicio' : `Desde ${l.min} puntos`} · ${i < level.index ? 'Alcanzado' : i === level.index ? 'Tu nivel' : 'Por alcanzar'}</span>
        </li>`)}</ol>
      </section>

      <section class="panel" aria-labelledby="streak-title">
        <div class="panel__head"><h2 class="panel__title" id="streak-title">Tus rachas</h2></div>
        <dl class="kpis kpis--3">
          ${streakKpi('Racha diaria', g.streaks.daily, 'day')}
          ${streakKpi('Racha semanal', g.streaks.weekly, 'week')}
          ${streakKpi('Racha mensual', g.streaks.monthly, 'month')}
        </dl>
        ${riskNote(g)}
        <p class="panel__foot">Un día cuenta si tiene al menos un movimiento o un aporte a una meta con esa fecha. Una semana (de lunes a domingo) o un mes cuenta si tiene al menos un día así.
          La racha no se rompe mientras el período de hoy no haya terminado. ${g.streaks.activeDays > 0 ? `Llevas ${plural(g.streaks.activeDays, 'día', 'días')} con registros.` : ''}</p>
      </section>

      ${g.nextUp.length > 0
        ? html`<section class="panel" aria-labelledby="next-title">
            <div class="panel__head"><h2 class="panel__title" id="next-title">Lo siguiente</h2></div>
            <ul class="ach-list ach-list--plain">${g.nextUp.map(achievementItem)}</ul>
          </section>`
        : ''}

      ${g.groups.map((group) => html`<section class="panel" aria-labelledby="grp-${group.id}">
        <div class="panel__head">
          <h2 class="panel__title" id="grp-${group.id}">${group.label}</h2>
          <span class="chip">${group.done} de ${group.total}</span>
        </div>
        <ul class="ach-list">${group.items.map(achievementItem)}</ul>
      </section>`)}

      <section class="panel" aria-labelledby="how-title">
        <div class="panel__head"><h2 class="panel__title" id="how-title">Cómo funciona</h2></div>
        <ul class="plain-list">
          <li>Los logros, las rachas y el nivel se <strong>calculan en el momento</strong> con lo que tienes guardado. No hay premios guardados aparte: si borras los registros que sostenían un logro, deja de contar.</li>
          <li>Cada logro vale 10 (bronce), 25 (plata) o 50 puntos (oro). Tu nivel sale solo de la suma de puntos.</li>
          <li>Los datos de demostración <strong>no cuentan</strong>. Cada espacio de trabajo tiene sus propios logros, rachas y nivel.</li>
          <li>Los logros de constancia usan tu <strong>mejor</strong> racha, así que no se pierden si una racha se interrumpe.</li>
          <li>La fecha que cuenta es la del movimiento, la misma que ves en tu lista. Las fechas futuras no cuentan.</li>
          <li>Son reglas fijas, no inteligencia artificial. Solo se ven en este dispositivo hasta que existan las cuentas en la nube.</li>
        </ul>
      </section>`,
  };
}
