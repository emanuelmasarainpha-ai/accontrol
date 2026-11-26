// @ts-check
// =============================================================================
// PEQUEÑA CELEBRACIÓN (meta cumplida, logro conseguido)
// -----------------------------------------------------------------------------
// Una ráfaga corta de papelitos de colores desde el centro de la pantalla (motion.css: .celebrate). Es
// decorativa (aria-hidden): lo que se anuncia es el aviso con el texto. Con «reducir movimiento» no hay ráfaga.
// Las posiciones se ponen con style.setProperty desde aquí (lo permite la política de seguridad).
// =============================================================================

import { prefersReducedMotion } from './dialog.js';
import { html, raw, setHtml } from './html.js';

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

// =============================================================================
// EL MOMENTO DE FIESTA (0.20.9, paso 3 de «una app más creativa», pedido de la persona)
// -----------------------------------------------------------------------------
// Al cumplir una meta o ganar un logro: la pantalla se oscurece un poco, cae confeti por toda la pantalla, detrás
// gira un resplandor dorado y en el centro entra un TROFEO (meta) o una MEDALLA (logro) dando una vuelta completa;
// después flota y un brillo la cruza. Debajo: «¡Meta cumplida!» o «¡Logro conseguido!» y su nombre.
// Se va sola a los ~3 segundos o con un toque. Es decorativa (aria-hidden): lo que se anuncia es el aviso de
// siempre (toast). Con «reducir movimiento» no aparece (queda el aviso).
// =============================================================================

/** Cuánto dura el momento antes de irse solo. */
export const PARTY_MS = 3000;
/** Lo que dura la salida (debe coincidir con party-out en motion.css). */
const PARTY_OUT_MS = 240;
const CONFETTI = 42;
const CONFETTI_COLORS = ['', 'party__bit--gold', 'party__bit--pink', 'party__bit--green', 'party__bit--blue'];

/**
 * El confeti que cae: dónde empieza cada papelito (en % del ancho), cuánto se desvía, cuánto gira, cuánto tarda y
 * cuándo empieza. Puro (para probarlo).
 * @param {number} count @param {() => number} random
 */
export function confettiPieces(count, random = Math.random) {
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round(((i + random()) / count) * 100),
    dx: Math.round((random() - 0.5) * 160),
    rot: Math.round((random() - 0.5) * 900),
    fall: Math.round(1500 + random() * 1100),
    delay: Math.round(random() * 500),
  }));
}

/** Rayos del resplandor (12 triángulos alrededor del centro de 0 0 200 200). */
const GLOW_RAYS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6;
  const point = (/** @type {number} */ r, /** @type {number} */ da) => `${(100 + r * Math.cos(a + da)).toFixed(1)} ${(100 + r * Math.sin(a + da)).toFixed(1)}`;
  return `M100 100L${point(100, -0.12)}L${point(100, 0.12)}z`;
}).join('');

/** Brillo que cruza (dentro del recorte del dibujo). */
const SHINE = `<g class="party__shine"><path d="M30 -10h14L14 106H0z" fill="#fff" opacity=".55"/></g>`;

/** El trofeo de las metas (viewBox 0 0 96 96). */
const TROPHY = `<defs><clipPath id="party-clip-cup"><path d="M26 10h44v22a22 22 0 0 1-44 0z"/></clipPath></defs>
  <path class="party__gold-d" d="M26 16H14a4 4 0 0 0-4 4c0 10 7 18 17 19l1-6c-6-1-11-6-12-11h10zM70 16h12a4 4 0 0 1 4 4c0 10-7 18-17 19l-1-6c6-1 11-6 12-11H70z"/>
  <path class="party__gold" d="M26 10h44v22a22 22 0 0 1-44 0z"/>
  <path class="party__gold-d" d="M42 52h12v14H42z"/><rect class="party__gold" x="32" y="64" width="32" height="8" rx="3"/><rect class="party__base" x="26" y="72" width="44" height="12" rx="3"/>
  <path class="party__star" d="m48 18 3.4 7 7.6 1.1-5.5 5.3 1.3 7.6L48 35.4l-6.8 3.6 1.3-7.6-5.5-5.3 7.6-1.1z"/>
  <g clip-path="url(#party-clip-cup)">${SHINE}</g>`;

/** La medalla de los logros (viewBox 0 0 96 96). */
const MEDAL = `<defs><clipPath id="party-clip-medal"><circle cx="48" cy="60" r="26"/></clipPath></defs>
  <path class="party__ribbon" d="M28 4h16l12 30H40z"/><path class="party__ribbon party__ribbon--b" d="M68 4H52L40 34h16z"/>
  <circle class="party__gold" cx="48" cy="60" r="26"/><circle class="party__gold-d" cx="48" cy="60" r="19"/><circle class="party__gold" cx="48" cy="60" r="16"/>
  <path class="party__star" d="m48 48 3.5 7.2 7.9 1.1-5.7 5.6 1.3 7.8-7-3.7-7 3.7 1.3-7.8-5.7-5.6 7.9-1.1z"/>
  <g clip-path="url(#party-clip-medal)">${SHINE}</g>`;

/**
 * Lo que se ve en el centro. Puro (para probarlo): el nombre de la meta o el logro va escapado.
 * @param {{ kind: 'goal' | 'achievement', title: string }} moment
 */
export function partyMarkup({ kind, title }) {
  const goal = kind === 'goal';
  return html`<div class="party__card">
    <span class="party__glow"><svg viewBox="0 0 200 200" focusable="false"><path d="${GLOW_RAYS}"/></svg></span>
    <span class="party__medal"><span class="party__spin"><svg viewBox="0 0 96 96" focusable="false">${raw(goal ? TROPHY : MEDAL)}</svg></span></span>
    <p class="party__kicker">${goal ? '¡Meta cumplida!' : '¡Logro conseguido!'}</p>
    <p class="party__title">«${title}»</p>
    <p class="party__hint">Toca para seguir</p>
  </div>`;
}

/**
 * Lanza el momento de fiesta. Devuelve false si no se lanzó (reducir movimiento).
 * @param {{ kind: 'goal' | 'achievement', title: string }} moment
 */
export function celebrateMoment(moment) {
  if (prefersReducedMotion()) return false;
  document.querySelector('.party')?.remove();
  const host = document.createElement('div');
  host.className = 'party';
  host.setAttribute('aria-hidden', 'true');
  const rain = document.createElement('div');
  rain.className = 'party__rain';
  confettiPieces(CONFETTI).forEach((p, i) => {
    const bit = document.createElement('span');
    bit.className = `party__bit ${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}${i % 3 === 0 ? ' party__bit--round' : ''}`;
    bit.style.setProperty('--x', `${p.x}%`);
    bit.style.setProperty('--dx', `${p.dx}px`);
    bit.style.setProperty('--rot', `${p.rot}deg`);
    bit.style.setProperty('--fall', `${p.fall}ms`);
    bit.style.setProperty('--delay', `${p.delay}ms`);
    rain.append(bit);
  });
  const stage = document.createElement('div');
  setHtml(stage, partyMarkup(moment));
  host.append(rain, ...stage.childNodes);
  document.body.append(host);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    host.classList.add('party--leaving');
    window.setTimeout(() => host.remove(), PARTY_OUT_MS);
  };
  host.addEventListener('click', leave, { once: true });
  window.setTimeout(leave, PARTY_MS);
  return true;
}
