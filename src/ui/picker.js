// @ts-check
// =============================================================================
// SELECTORES PROPIOS (0.20.12, pedido de la persona: «esas interfaces de celular no tienen vida»)
// -----------------------------------------------------------------------------
// Las listas desplegables, la hora y la fecha ya no abren la ventanita gris del sistema: abren una hoja de ACCONTROL
// que sube desde abajo, con color y movimiento.
//   · Listas (<select>): cada opción con su dibujo (la categoría con el suyo, la moneda con su símbolo, lo demás con su
//     inicial en una burbuja de color), entrada escalonada, la elegida con su palomita que salta y buscador si son muchas.
//   · Hora: un cielo que cambia con la hora que eliges (mañana, tarde, noche), los números que saltan al cambiar,
//     a. m. / p. m., horas, minutos de 5 en 5 y ±1 minuto.
//   · Fecha: calendario del mes (lunes a domingo) con «Hoy» y «Ayer», flechas de mes y los días fuera de rango apagados.
// El campo de verdad (<select>, <input type="time|date">) sigue en el formulario: el selector solo le pone el valor y
// avisa con «input» y «change», como si lo hubiera cambiado la persona. Así toda la lógica que ya existía sigue igual
// (la categoría nueva, la tasa de cambio, los servicios del cliente…), sin tocar ni un formulario.
// Un solo oyente en document: sirve en todas las pantallas y ventanas. Un campo con data-native-picker se queda con
// el del sistema. Con el teclado: las flechas cambian la lista como siempre; Enter o Espacio abren el selector.
// =============================================================================

import { categoryArt } from './categoryArt.js';
import { openSheet, prefersReducedMotion } from './dialog.js';
import { $, $$ } from './dom.js';
import { haptic } from './haptics.js';
import { html, setHtml } from './html.js';
import { icon } from './icons.js';
import { skyArt } from './skyArt.js';
import { foldText } from '../domain/categoryArt.js';
import { dayPhase } from '../domain/dates.js';
import {
  currencySymbolOf, dateAllowed, dateValue, from12h, longDateLabel, monthAllowed, monthGrid, MONTHS, nudgeTime, parseDateValue,
  parseTimeValue, previousDay, shiftMonth, timeValue, to12h, todayValue, WEEKDAYS_SHORT,
} from '../domain/pickers.js';

/** @typedef {HTMLSelectElement | HTMLInputElement} PickableControl */

/** Los campos que abren un selector propio. */
export const PICKABLE = 'select.input, input.input[type="time"], input.input[type="date"]';
/** Desde cuántas opciones aparece el buscador. */
export const SEARCH_FROM = 12;
/** Cuánto se ve la palomita antes de cerrar la hoja (ms). */
const CLOSE_AFTER_PICK_MS = 170;
/** Cuántas filas entran escalonadas (las demás, de una vez). */
const STAGGERED_ROWS = 10;
/** Colores de las burbujas (clases pk-hue-0 … pk-hue-5 en components.css). */
const HUES = 6;

/**
 * El campo que abre un selector propio, si el toque cayó en uno.
 * @param {EventTarget | null} target
 * @returns {PickableControl | null}
 */
export function pickableControl(target) {
  if (!(target instanceof Element)) return null;
  const el = target.closest(PICKABLE);
  if (!(el instanceof HTMLSelectElement || el instanceof HTMLInputElement)) return null;
  if (el.disabled || el.hasAttribute('data-native-picker')) return null;
  if (el instanceof HTMLInputElement && el.readOnly) return null;
  if (el instanceof HTMLSelectElement && (el.multiple || el.size > 1)) return null;
  return el;
}

/** Nombre del campo para el título de la hoja. @param {PickableControl} control */
function controlTitle(control) {
  const label = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
  const text = label?.textContent?.trim() || control.getAttribute('aria-label') || control.closest('fieldset')?.querySelector('legend')?.textContent?.trim() || '';
  if (text) return text;
  return control instanceof HTMLInputElement && control.type === 'time' ? 'Hora' : control instanceof HTMLInputElement ? 'Fecha' : 'Elige una opción';
}

/** Avisar al formulario como si la persona hubiera cambiado el campo. @param {PickableControl} control */
function announce(control) {
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Devolver el foco al campo (solo con ratón o teclado: en el celular volvería a abrir el del sistema). @param {PickableControl} control */
function refocus(control) {
  if (window.matchMedia?.('(pointer: fine)').matches) control.focus({ preventScroll: true });
}

/** Volver a disparar una animación CSS de clase (quitar, forzar el dibujo y poner). @param {Element} el @param {string} name */
function replay(el, name) {
  el.classList.remove(name);
  void (/** @type {HTMLElement} */ (el).offsetWidth);
  el.classList.add(name);
}

/** Entrada escalonada de una lista (--pk-i en cada fila; las de después del tope entran todas juntas). @param {HTMLElement[]} rows */
function stagger(rows) {
  rows.forEach((row, i) => row.style.setProperty('--pk-i', String(Math.min(i, STAGGERED_ROWS))));
}

// =============================================================================
// LISTAS
// =============================================================================

/** El dibujo de cada opción. @param {HTMLSelectElement} select @param {HTMLOptionElement} option @param {number} index @param {string} kind */
function optionArt(select, option, index, kind) {
  if (option.value === '__new__') return html`<span class="pick-art pick-art--new">${icon('plus', 18)}</span>`;
  if (select.name === 'categoryId' && option.value) return categoryArt({ name: option.text }, kind, { size: 'sm' });
  if (!option.value) return html`<span class="pick-art pick-art--none" aria-hidden="true">—</span>`;
  const hue = `pick-art pk-hue-${index % HUES}`;
  if (select.name === 'currency') return html`<span class="${hue} pick-art--symbol" aria-hidden="true">${currencySymbolOf(option.text) || '¤'}</span>`;
  const initial = (option.text.match(/\p{L}|\p{N}/u)?.[0] ?? '•').toUpperCase();
  return html`<span class="${hue}" aria-hidden="true">${initial}</span>`;
}

/** Lista propia para un <select>. @param {HTMLSelectElement} select */
function openSelectPicker(select) {
  const kind = select.closest('[data-movement]')?.getAttribute('data-movement') ?? 'expense';
  const options = [...select.options].map((option, index) => ({ option, index })).filter(({ option }) => !option.hidden && !(option.disabled && option.value === ''));
  const searchable = options.length >= SEARCH_FROM;
  /** @type {string | null} */
  let group = null;
  const rows = options.map(({ option, index }, position) => {
    const parent = option.parentElement;
    const groupLabel = parent instanceof HTMLOptGroupElement ? parent.label : null;
    let heading = html``;
    if (groupLabel !== group) {
      group = groupLabel;
      if (groupLabel) heading = html`<li class="pick-group" role="presentation">${groupLabel}</li>`;
    }
    const current = index === select.selectedIndex;
    const label = option.value === '__new__' ? option.text.replace(/^[＋+]\s*/, '') : option.text;
    return html`${heading}<li role="presentation">
      <button type="button" class="pick-row${current ? ' is-current' : ''}${option.value === '__new__' ? ' pick-row--new' : ''}" data-pick-index="${index}" data-pick-text="${foldText(label)}"
        aria-pressed="${current ? 'true' : 'false'}" ${option.disabled ? 'disabled' : ''} ${current ? 'data-autofocus' : ''}>
        ${optionArt(select, option, position, kind)}
        <span class="pick-row__label">${label}</span>
        <span class="pick-row__check" aria-hidden="true">${icon('check', 16)}</span>
      </button>
    </li>`;
  });

  let picked = false;
  openSheet({
    title: controlTitle(select),
    className: 'sheet--picker',
    content: html`<div class="pick" data-picker="list">
      ${searchable ? html`<div class="pick-search"><input type="search" class="input" placeholder="Buscar…" aria-label="Buscar en la lista" autocomplete="off" data-pick-search /></div>` : ''}
      <ul class="pick-list" role="list">${rows}</ul>
      <p class="pick-empty muted" data-pick-empty hidden>No hay nada con ese nombre.</p>
    </div>`,
    onMount: (sheet, close) => {
      const buttons = /** @type {HTMLElement[]} */ ($$('[data-pick-index]', sheet));
      stagger(buttons);
      const search = sheet.querySelector('[data-pick-search]');
      search?.addEventListener('input', () => {
        const query = foldText(/** @type {HTMLInputElement} */ (search).value.trim());
        let shown = 0;
        for (const button of buttons) {
          const match = !query || (button.dataset.pickText ?? '').includes(query);
          /** @type {HTMLElement} */ (button.parentElement).hidden = !match;
          if (match) shown += 1;
        }
        for (const heading of $$('.pick-group', sheet)) /** @type {HTMLElement} */ (heading).hidden = Boolean(query);
        /** @type {HTMLElement} */ ($('[data-pick-empty]', sheet)).hidden = shown > 0;
      });
      sheet.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-pick-index]') : null;
        if (!(button instanceof HTMLButtonElement) || picked) return;
        picked = true;
        const index = Number(button.dataset.pickIndex);
        for (const other of buttons) {
          other.classList.toggle('is-current', other === button);
          other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
        }
        button.classList.add('is-picked');
        haptic('confirm');
        if (select.selectedIndex !== index) {
          select.selectedIndex = index;
          announce(select);
        }
        window.setTimeout(close, prefersReducedMotion() ? 0 : CLOSE_AFTER_PICK_MS);
      });
    },
    onClose: () => refocus(select),
  });
}

// =============================================================================
// HORA
// =============================================================================

const SUN = html`<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const MOON = html`<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M15 3a9 9 0 1 0 6 14.5A7.5 7.5 0 0 1 15 3z" fill="currentColor"/></svg>`;

/** Reloj propio para un <input type="time">. @param {HTMLInputElement} input */
function openTimePicker(input) {
  const now = new Date();
  let time = parseTimeValue(input.value) ?? { hour: now.getHours(), minute: now.getMinutes() };
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  openSheet({
    title: controlTitle(input),
    className: 'sheet--picker',
    content: html`<div class="pick tp" data-picker="time">
      <div class="tp__face">
        <span class="tp__sky" data-tp-sky></span>
        <p class="tp__time" aria-live="polite"><span class="tp__digits" data-tp-h></span><span class="tp__colon">:</span><span class="tp__digits" data-tp-m></span><span class="tp__ampm" data-tp-ampm></span></p>
      </div>
      <div class="tp__half" role="group" aria-label="Mañana o tarde">
        <button type="button" class="tp__halfbtn" data-tp-pm="0">${SUN}<span>a. m.</span></button>
        <button type="button" class="tp__halfbtn" data-tp-pm="1">${MOON}<span>p. m.</span></button>
      </div>
      <p class="tp__label">Hora</p>
      <div class="tp__grid" role="group" aria-label="Hora">${hours.map((h) => html`<button type="button" class="tp__chip" data-tp-hour="${h}">${h}</button>`)}</div>
      <p class="tp__label">Minutos</p>
      <div class="tp__grid" role="group" aria-label="Minutos">${minutes.map((m) => html`<button type="button" class="tp__chip" data-tp-minute="${m}">${String(m).padStart(2, '0')}</button>`)}</div>
      <div class="tp__fine">
        <button type="button" class="tp__nudge" data-tp-nudge="-1" aria-label="Un minuto menos">− 1 min</button>
        <button type="button" class="tp__nudge" data-tp-nudge="1" aria-label="Un minuto más">+ 1 min</button>
      </div>
      <div class="actions actions--split">
        <button type="button" class="btn btn--ghost" data-tp-now>Ahora</button>
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="button" class="btn btn--primary" data-tp-done data-autofocus>Listo</button>
        </span>
      </div>
    </div>`,
    onMount: (sheet, close) => {
      const sky = /** @type {HTMLElement} */ ($('[data-tp-sky]', sheet));
      const hourEl = /** @type {HTMLElement} */ ($('[data-tp-h]', sheet));
      const minuteEl = /** @type {HTMLElement} */ ($('[data-tp-m]', sheet));
      const ampmEl = /** @type {HTMLElement} */ ($('[data-tp-ampm]', sheet));
      /** @type {string | null} */
      let phase = null;
      const paint = (/** @type {{ bump?: boolean }} */ { bump = true } = {}) => {
        const { hour12, pm } = to12h(time.hour);
        const h = String(hour12);
        const m = String(time.minute).padStart(2, '0');
        const ap = pm ? 'p. m.' : 'a. m.';
        if (hourEl.textContent !== h) { hourEl.textContent = h; if (bump) replay(hourEl, 'is-bump'); }
        if (minuteEl.textContent !== m) { minuteEl.textContent = m; if (bump) replay(minuteEl, 'is-bump'); }
        if (ampmEl.textContent !== ap) { ampmEl.textContent = ap; if (bump) replay(ampmEl, 'is-bump'); }
        const nextPhase = dayPhase(time.hour);
        if (nextPhase !== phase) {
          phase = nextPhase;
          setHtml(sky, skyArt(nextPhase));
          if (bump) replay(sky, 'is-swap');
        }
        for (const b of $$('[data-tp-pm]', sheet)) b.setAttribute('aria-pressed', String(b.getAttribute('data-tp-pm') === (pm ? '1' : '0')));
        for (const b of $$('[data-tp-hour]', sheet)) b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-tp-hour')) === hour12));
        for (const b of $$('[data-tp-minute]', sheet)) b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-tp-minute')) === time.minute));
      };
      paint({ bump: false });
      sheet.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (!target) return;
        const { hour12, pm } = to12h(time.hour);
        if (target.hasAttribute('data-tp-pm')) time = { ...time, hour: from12h(hour12, target.getAttribute('data-tp-pm') === '1') };
        else if (target.hasAttribute('data-tp-hour')) time = { ...time, hour: from12h(Number(target.getAttribute('data-tp-hour')), pm) };
        else if (target.hasAttribute('data-tp-minute')) time = { ...time, minute: Number(target.getAttribute('data-tp-minute')) };
        else if (target.hasAttribute('data-tp-nudge')) time = nudgeTime(time, Number(target.getAttribute('data-tp-nudge')));
        else if (target.hasAttribute('data-tp-now')) {
          const n = new Date();
          time = { hour: n.getHours(), minute: n.getMinutes() };
        } else if (target.hasAttribute('data-tp-done')) {
          const value = timeValue(time.hour, time.minute);
          haptic('confirm');
          if (input.value !== value) {
            input.value = value;
            announce(input);
          }
          close();
          return;
        } else return;
        paint();
      });
    },
    onClose: () => refocus(input),
  });
}

// =============================================================================
// FECHA
// =============================================================================

/** Calendario propio para un <input type="date">. @param {HTMLInputElement} input */
function openDatePicker(input) {
  const today = todayValue();
  const min = input.min || '';
  const max = input.max || '';
  const chosen = parseDateValue(input.value);
  const start = chosen ?? parseDateValue(dateAllowed(today, min, max) ? today : max || min || today) ?? /** @type {import('../domain/pickers.js').DateParts} */ (parseDateValue(today));
  let view = { year: start.year, month: start.month };
  const yesterday = previousDay(today);
  const quick = [
    dateAllowed(today, min, max) ? html`<button type="button" class="tp__chip dp__quick" data-dp-pick="${today}">Hoy</button>` : '',
    dateAllowed(yesterday, min, max) ? html`<button type="button" class="tp__chip dp__quick" data-dp-pick="${yesterday}">Ayer</button>` : '',
    !input.required && input.value ? html`<button type="button" class="tp__chip dp__quick dp__quick--clear" data-dp-pick="">Sin fecha</button>` : '',
  ];
  let picked = false;
  openSheet({
    title: controlTitle(input),
    className: 'sheet--picker',
    content: html`<div class="pick dp" data-picker="date">
      <p class="dp__big" data-dp-label>${chosen ? longDateLabel(chosen) : 'Sin fecha'}</p>
      ${quick.some(Boolean) ? html`<div class="dp__quickrow">${quick}</div>` : ''}
      <div class="dp__nav">
        <button type="button" class="icon-btn" data-dp-step="-1" aria-label="Mes anterior">${icon('chevronLeft')}</button>
        <p class="dp__month" data-dp-month aria-live="polite"></p>
        <button type="button" class="icon-btn" data-dp-step="1" aria-label="Mes siguiente">${icon('chevronRight')}</button>
      </div>
      <div class="dp__week" aria-hidden="true">${WEEKDAYS_SHORT.map((d) => html`<span>${d}</span>`)}</div>
      <div class="dp__days" data-dp-days role="group"></div>
    </div>`,
    onMount: (sheet, close) => {
      const daysEl = /** @type {HTMLElement} */ ($('[data-dp-days]', sheet));
      const monthEl = /** @type {HTMLElement} */ ($('[data-dp-month]', sheet));
      const paint = (/** @type {number} */ direction) => {
        const { offset, days } = monthGrid(view.year, view.month);
        monthEl.textContent = `${MONTHS[view.month]} ${view.year}`;
        daysEl.setAttribute('aria-label', monthEl.textContent);
        setHtml(daysEl, html`${Array.from({ length: offset }, () => html`<span class="dp__pad"></span>`)}${Array.from({ length: days }, (_, i) => {
          const value = dateValue(view.year, view.month, i + 1);
          const classes = `dp__day${value === today ? ' is-today' : ''}${value === input.value ? ' is-current' : ''}`;
          return html`<button type="button" class="${classes}" data-dp-pick="${value}" aria-pressed="${value === input.value ? 'true' : 'false'}" aria-label="${longDateLabel({ year: view.year, month: view.month, day: i + 1 })}" ${dateAllowed(value, min, max) ? '' : 'disabled'}>${i + 1}</button>`;
        })}`);
        if (direction) replay(daysEl, direction > 0 ? 'is-from-right' : 'is-from-left');
        for (const b of $$('[data-dp-step]', sheet)) {
          const next = shiftMonth(view.year, view.month, Number(b.getAttribute('data-dp-step')));
          b.toggleAttribute('disabled', !monthAllowed(next.year, next.month, min, max));
        }
      };
      paint(0);
      const focusDay = sheet.querySelector('.dp__day.is-current') ?? sheet.querySelector('.dp__day.is-today');
      if (focusDay instanceof HTMLElement && window.matchMedia?.('(pointer: fine)').matches) focusDay.focus();
      sheet.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (!target || picked) return;
        if (target.hasAttribute('data-dp-step')) {
          const delta = Number(target.getAttribute('data-dp-step'));
          view = shiftMonth(view.year, view.month, delta);
          paint(delta);
          return;
        }
        if (!target.hasAttribute('data-dp-pick')) return;
        picked = true;
        const value = target.getAttribute('data-dp-pick') ?? '';
        const parts = parseDateValue(value);
        /** @type {HTMLElement} */ ($('[data-dp-label]', sheet)).textContent = parts ? longDateLabel(parts) : 'Sin fecha';
        for (const day of $$('.dp__day', sheet)) day.classList.toggle('is-current', day === target);
        target.classList.add('is-picked');
        haptic('confirm');
        if (input.value !== value) {
          input.value = value;
          announce(input);
        }
        window.setTimeout(close, prefersReducedMotion() ? 0 : CLOSE_AFTER_PICK_MS);
      });
    },
    onClose: () => refocus(input),
  });
}

// =============================================================================
// EL OYENTE ÚNICO
// =============================================================================

let pickerOpen = false;

/** Abre el selector propio que le toca al campo. @param {PickableControl} control */
export function openPicker(control) {
  if (pickerOpen) return;
  pickerOpen = true;
  const done = () => { pickerOpen = false; };
  // Cuando la hoja se cierra (por cualquier camino), se puede volver a abrir otra.
  const watch = new MutationObserver(() => {
    if (!document.querySelector('dialog.sheet--picker')) {
      watch.disconnect();
      done();
    }
  });
  try {
    if (control instanceof HTMLSelectElement) openSelectPicker(control);
    else if (control.type === 'time') openTimePicker(control);
    else openDatePicker(control);
    watch.observe(document.body, { childList: true });
  } catch (error) {
    done();
    throw error;
  }
}

let installed = false;

/**
 * Conecta los selectores propios en toda la app (se llama una vez al arrancar).
 * Toque: se cancela el del sistema al levantar el dedo (si no fue para desplazar la pantalla) y se abre el propio.
 * Ratón: igual al presionar. Teclado: Enter, Espacio, Alt+↓ o F4 sobre una lista.
 */
export function installPickers() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  /** @type {{ el: PickableControl, x: number, y: number } | null} */
  let touch = null;
  let lastTouchEnd = 0;
  document.addEventListener('touchstart', (event) => {
    const el = pickableControl(event.target);
    const t = event.touches[0];
    touch = el && t && event.touches.length === 1 ? { el, x: t.clientX, y: t.clientY } : null;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', (event) => {
    const t = event.touches[0];
    if (touch && t && Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 10) touch = null;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', (event) => {
    const el = pickableControl(event.target);
    if (!el) return;
    event.preventDefault(); // sin esto se abriría también la ventanita del sistema
    lastTouchEnd = Date.now();
    if (touch?.el === el) openPicker(el);
    touch = null;
  }, { capture: true, passive: false });
  document.addEventListener('mousedown', (event) => {
    const el = pickableControl(event.target);
    if (!el || event.button !== 0) return;
    event.preventDefault();
    if (Date.now() - lastTouchEnd > 800) openPicker(el);
  }, true);
  document.addEventListener('click', (event) => {
    if (pickableControl(event.target)) event.preventDefault();
  }, true);
  document.addEventListener('keydown', (event) => {
    const el = pickableControl(event.target);
    if (!(el instanceof HTMLSelectElement)) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'F4' || (event.altKey && event.key === 'ArrowDown')) {
      event.preventDefault();
      openPicker(el);
    }
  }, true);
}
