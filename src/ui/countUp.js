// @ts-check
// =============================================================================
// MONTOS QUE «CUENTAN» HASTA SU VALOR (solo efecto visual)
// -----------------------------------------------------------------------------
// Al llegar a una pantalla, los montos grandes marcados con data-count-to="<centavos>" suben rápido desde 0
// hasta su valor. Reglas:
//   · El valor FINAL es exactamente el de la pantalla, al centavo: al terminar se escribe el mismo texto que
//     dibujó la pantalla (no un cálculo nuevo).
//   · El lector de pantalla no oye números intermedios: lee un texto oculto con el monto exacto (sr-only) y las
//     cifras que se mueven están marcadas aria-hidden.
//   · Con «reducir movimiento», no hay animación.
//   · Los valores intermedios son siempre centavos enteros (nunca 0.1 + 0.2).
// =============================================================================

import { formatMoney, moneyParts } from '../domain/money.js';

/** Dura lo mismo que una entrada (--dur-enter, 280 ms): corto, para no hacer esperar. */
export const COUNT_MS = 280;

/** Curva de frenado (como --ease-out). @param {number} t 0..1 */
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * El monto que se muestra en el momento `t` (0 = empieza, 1 = termina), en centavos ENTEROS.
 * En t >= 1 devuelve exactamente `toCents`.
 * @param {number} fromCents @param {number} toCents @param {number} t
 */
export function countValueAt(fromCents, toCents, t) {
  if (!(t < 1)) return toCents;
  const clamped = Math.max(0, t);
  return Math.round(fromCents + (toCents - fromCents) * easeOutCubic(clamped));
}

/**
 * Los textos visibles de un monto en cada estilo de la app.
 * hero  = Inicio («Disponible»): signo y símbolo, enteros y centavos por separado.
 * plain = una sola cadena: «RD$ 1,234.56».
 * @param {number} cents @param {'hero' | 'plain'} style
 * @returns {Record<string, string>}
 */
export function countParts(cents, style) {
  if (style === 'plain') return { all: formatMoney(cents) };
  const p = moneyParts(cents);
  return { sign: `${p.negative ? '-' : ''}${p.symbol}`, whole: p.whole, fraction: `.${p.fraction}` };
}

/**
 * Hace contar los montos marcados dentro de `root`. Devuelve una función que lo detiene y deja los valores finales.
 * @param {ParentNode} root
 * @param {{ reduced?: boolean, now?: () => number, frame?: (cb: FrameRequestCallback) => number, cancel?: (id: number) => void }} [options]
 */
export function countUp(root, options = {}) {
  const reduced = options.reduced ?? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  if (reduced) return () => {};
  const now = options.now ?? (() => performance.now());
  const frame = options.frame ?? ((cb) => requestAnimationFrame(cb));
  const cancel = options.cancel ?? ((id) => cancelAnimationFrame(id));

  /** @type {{ to: number, style: 'hero' | 'plain', parts: Record<string, HTMLElement>, finals: Record<string, string> }[]} */
  const items = [];
  for (const el of root.querySelectorAll('[data-count-to]')) {
    const to = Number(el.getAttribute('data-count-to'));
    const style = el.getAttribute('data-count-style') === 'plain' ? 'plain' : 'hero';
    if (!Number.isSafeInteger(to) || to === 0) continue;
    /** @type {Record<string, HTMLElement>} */
    const parts = {};
    /** @type {Record<string, string>} */
    const finals = {};
    for (const part of el.querySelectorAll('[data-count-part]')) {
      const name = part.getAttribute('data-count-part') ?? '';
      parts[name] = /** @type {HTMLElement} */ (part);
      finals[name] = part.textContent ?? ''; // lo que dibujó la pantalla: el final exacto
    }
    if (Object.keys(parts).length > 0) items.push({ to, style, parts, finals });
  }
  if (items.length === 0) return () => {};

  const start = now();
  let id = 0;
  let done = false;
  const finish = () => {
    done = true;
    for (const item of items) for (const [name, el] of Object.entries(item.parts)) el.textContent = item.finals[name];
  };
  const tick = () => {
    if (done) return;
    const t = (now() - start) / COUNT_MS;
    if (t >= 1) {
      finish();
      return;
    }
    for (const item of items) {
      const texts = countParts(countValueAt(0, item.to, t), item.style);
      for (const [name, el] of Object.entries(item.parts)) if (name in texts) el.textContent = texts[name];
    }
    id = frame(tick);
  };
  tick();
  return () => {
    cancel(id);
    if (!done) finish();
  };
}
