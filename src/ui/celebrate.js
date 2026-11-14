// @ts-check
// =============================================================================
// PEQUEÑA CELEBRACIÓN (meta cumplida, logro conseguido)
// -----------------------------------------------------------------------------
// Una ráfaga corta de papelitos de colores desde el centro de la pantalla (motion.css: .celebrate). Es
// decorativa (aria-hidden): lo que se anuncia es el aviso con el texto. Con «reducir movimiento» no hay ráfaga.
// Las posiciones se ponen con style.setProperty desde aquí (lo permite la política de seguridad).
// =============================================================================

import { prefersReducedMotion } from './dialog.js';

const PIECES = 18;
const COLORS = ['', 'celebrate__piece--navy', 'celebrate__piece--gold'];
/** Cuánto queda el contenedor en pantalla (la ráfaga dura --dur-enter más el retraso mayor). */
const LIFETIME_MS = 700;

/**
 * Hacia dónde sale cada papelito: repartidos en círculo, con algo de variación. Puro (para probarlo).
 * @param {number} count @param {() => number} random
 */
export function burstVectors(count, random = Math.random) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const distance = 90 + random() * 90;
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance - 40),
      rot: Math.round((random() - 0.5) * 540),
      delay: Math.round(random() * 60),
    };
  });
}

/**
 * Lanza la ráfaga. Devuelve false si no se lanzó (reducir movimiento).
 * @param {{ x?: number, y?: number }} [at]  Centro en porcentaje de la pantalla (por defecto 50 % / 38 %).
 */
export function celebrate(at = {}) {
  if (prefersReducedMotion()) return false;
  const host = document.createElement('div');
  host.className = 'celebrate';
  host.setAttribute('aria-hidden', 'true');
  burstVectors(PIECES).forEach((v, i) => {
    const piece = document.createElement('span');
    piece.className = `celebrate__piece ${COLORS[i % COLORS.length]}${i % 4 === 0 ? ' celebrate__piece--round' : ''}`;
    piece.style.setProperty('--x', `${at.x ?? 50}%`);
    piece.style.setProperty('--y', `${at.y ?? 38}%`);
    piece.style.setProperty('--dx', `${v.dx}px`);
    piece.style.setProperty('--dy', `${v.dy}px`);
    piece.style.setProperty('--rot', `${v.rot}deg`);
    piece.style.setProperty('--delay', `${v.delay}ms`);
    host.append(piece);
  });
  document.body.append(host);
  window.setTimeout(() => host.remove(), LIFETIME_MS);
  return true;
}
