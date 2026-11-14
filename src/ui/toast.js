// @ts-check
// Avisos breves ("Gasto guardado.") que desaparecen solos. Los lectores de
// pantalla los anuncian porque el contenedor es una región `aria-live`.
// Entran subiendo y salen bajando (motion.css); con «reducir movimiento», aparecen y se van al instante.

import { $ } from './dom.js';
import { prefersReducedMotion } from './dialog.js';

/** Tope de espera de la salida animada (la animación dura --dur-base, 200 ms). */
const EXIT_FALLBACK_MS = 320;

/**
 * Quita un aviso con su salida suave.
 * @param {HTMLElement} item
 */
function dismiss(item) {
  if (!item.isConnected || item.classList.contains('is-leaving')) return;
  if (prefersReducedMotion()) {
    item.remove();
    return;
  }
  item.classList.add('is-leaving');
  const timer = window.setTimeout(() => item.remove(), EXIT_FALLBACK_MS);
  item.addEventListener('animationend', () => {
    window.clearTimeout(timer);
    item.remove();
  });
}

/**
 * @param {string} message
 * @param {'success' | 'error' | 'info'} [kind]
 */
export function toast(message, kind = 'success') {
  const host = $('#toasts');
  const item = document.createElement('div');
  item.className = `toast toast--${kind}`;
  item.textContent = message; // textContent: nunca interpreta HTML
  host.append(item);
  // Nunca más de 3 avisos a la vez: se quitan los más antiguos (sin esperar su salida, para no apilar).
  const live = [...host.children].filter((el) => !el.classList.contains('is-leaving'));
  for (const old of live.slice(0, Math.max(0, live.length - 3))) old.remove();
  const lifetime = kind === 'error' ? 7000 : 3800;
  window.setTimeout(() => dismiss(item), lifetime);
  item.addEventListener('click', () => dismiss(item));
}
