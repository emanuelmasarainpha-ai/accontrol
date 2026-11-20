// @ts-check
// =============================================================================
// MODO CLARO / OSCURO (0.14.4)
// -----------------------------------------------------------------------------
// · El interruptor (0.14.6) es el sol y la luna en PNG sin fondo: al pasar a oscuro el sol gira y se hunde mientras la
//   luna entra girando y saltan chispas de estrellas; al volver, la luna se va y el sol sube con chispas doradas. Solo se mueven transform y opacity (components.css) y,
//   con «reducir movimiento», cambia sin animación.
// · El tema es una preferencia de ESTE dispositivo (localStorage), no un dato financiero. Por defecto, claro.
// · src/theme-boot.js lo aplica antes de dibujar la página (sin destello claro al abrir de noche).
// · Lo que cambia los colores es <html data-theme="dark"> (tokens.css, «el billete de noche»).
// =============================================================================

import { applyStatusBar } from '../app/nativeShell.js';
import { isNativeApp } from '../app/platform.js';
import { html, setHtml } from './html.js';

export const THEME_KEY = 'accontrol.theme.v1';
/** @typedef {'light' | 'dark'} Theme */

/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void } | null} PrefStorage */

/** @returns {PrefStorage} */
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * El tema guardado (claro si nunca se eligió, si el valor es raro o si el navegador no deja leer).
 * @param {PrefStorage} [storage]
 * @returns {Theme}
 */
export function readTheme(storage = defaultStorage()) {
  try {
    return storage?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** @param {Theme} theme @param {PrefStorage} [storage] */
export function saveTheme(theme, storage = defaultStorage()) {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Sin permiso para guardar: vale mientras la página esté abierta.
  }
}

/** El tema que se ve ahora. @returns {Theme} */
export function currentTheme() {
  if (typeof document === 'undefined') return 'light'; // fuera del navegador (pruebas)
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Texto del botón según el tema (dice lo que hará). @param {Theme} theme */
export const toggleTitle = (theme) => (theme === 'dark' ? 'Cambiar a modo claro (amanece)' : 'Cambiar a modo oscuro (anochece)');

/** Las imágenes del sol y la luna (PNG sin fondo, en src/assets). */
const SUN_URL = new URL('../assets/sun.png', import.meta.url).href;
const MOON_URL = new URL('../assets/moon.png', import.meta.url).href;

/**
 * El dibujo del interruptor: el sol y la luna (PNG sin fondo) y cuatro chispas que saltan al cambiar.
 * Decorativo: las imágenes no tienen texto alternativo (el botón dice «Modo oscuro» y si está activado, aria-pressed).
 */
export function dayNightArt() {
  return html`<span class="daynight__art" aria-hidden="true">
    <img class="dn-sun" src="${SUN_URL}" alt="" width="96" height="96" decoding="async" draggable="false" />
    <img class="dn-moon" src="${MOON_URL}" alt="" width="96" height="96" decoding="async" draggable="false" />
    <span class="dn-spark dn-spark--1"></span><span class="dn-spark dn-spark--2"></span><span class="dn-spark dn-spark--3"></span><span class="dn-spark dn-spark--4"></span>
  </span>`;
}

/**
 * El botón del sol y la luna.
 * @param {Theme} theme  El tema que se ve ahora
 * @param {{ large?: boolean }} [options]  large: el de Ajustes (más grande)
 */
export function dayNightButton(theme, { large = false } = {}) {
  return html`<button type="button" class="daynight${large ? ' daynight--lg' : ''}" data-action="toggle-theme" aria-pressed="${theme === 'dark' ? 'true' : 'false'}" aria-label="Modo oscuro" title="${toggleTitle(theme)}">${dayNightArt()}</button>`;
}

/** Pone a todos los interruptores (barra, menú, Ajustes) en el estado actual. */
function syncToggles() {
  const theme = currentTheme();
  for (const button of document.querySelectorAll('[data-action="toggle-theme"]')) {
    if (!button.querySelector('.daynight__art')) setHtml(/** @type {HTMLElement} */ (button), dayNightArt());
    button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    button.setAttribute('title', toggleTitle(theme));
  }
  for (const label of document.querySelectorAll('[data-theme-label]')) label.textContent = theme === 'dark' ? 'Activado' : 'Desactivado';
}

/**
 * Cambia el tema, lo recuerda en este dispositivo y retiñe la barra del navegador del celular.
 * @param {Theme} theme
 * @param {PrefStorage} [storage]
 */
export function setTheme(theme, storage = defaultStorage()) {
  document.documentElement.dataset.theme = theme;
  saveTheme(theme, storage);
  syncToggles();
  const deep = getComputedStyle(document.body).getPropertyValue('--kind-deep').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && deep) meta.setAttribute('content', deep);
  syncNativeStatusBar();
}

/** En la app de Android, los iconos de la barra de estado siguen el tema de ACCONTROL (no el del teléfono). */
function syncNativeStatusBar() {
  if (isNativeApp()) applyStatusBar(/** @type {any} */ (window).Capacitor, currentTheme());
}

let installed = false;

/** Aplica el tema guardado, dibuja los interruptores y escucha sus toques (una sola vez, al arrancar). */
export function installThemeToggle() {
  document.documentElement.dataset.theme = readTheme();
  syncToggles();
  syncNativeStatusBar();
  if (installed) return;
  installed = true;
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-action="toggle-theme"]') : null;
    if (!button) return;
    event.preventDefault();
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    // La animación creativa (chispas) solo al tocar; el sol y la luna se colocan solos por el tema.
    for (const toggle of document.querySelectorAll('[data-action="toggle-theme"]')) {
      toggle.classList.remove('is-switching');
      void (/** @type {HTMLElement} */ (toggle)).offsetWidth;
      toggle.classList.add('is-switching');
      window.setTimeout(() => toggle.classList.remove('is-switching'), 420);
    }
  });
}

/** Para las pantallas que se dibujan después (Ajustes): pone sus interruptores al día. */
export const refreshThemeToggles = syncToggles;
