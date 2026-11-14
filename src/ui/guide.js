// @ts-check
// =============================================================================
// CHELE, EL GUÍA DEL RECORRIDO (0.14.4)
// -----------------------------------------------------------------------------
// Lo que necesita el motor del recorrido (ui/tour.js) para que lo conduzca la mascota:
//   · loadGuideArt(): trae el dibujo (src/assets/chele.svg) y lo devuelve listo para meter en la página. Si no
//     carga (sin conexión y sin copia, archivo roto…), devuelve null y el recorrido usa la tarjeta normal.
//   · placeGuide(): dónde van Chele y su globo. Van juntos como un bloque que NUNCA se pone encima del elemento
//     resaltado ni de la barra de pestañas; si no cabe con Chele, va el globo solo.
//   · startTyping(): el texto aparece como si lo dijera; tocar el globo lo completa.
//
// Chele NO es inteligencia artificial: dice textos fijos escritos en app/tourSteps.js.
// El dibujo es decorativo (aria-hidden): el lector de pantalla recibe el texto completo del paso de una vez.
// =============================================================================

import { placeCard } from './tour.js';

/** Expresiones de Chele: saluda (bienvenida), señala (explicaciones), contento (al terminar). */
export const GUIDE_MOODS = /** @type {const} */ (['wave', 'point', 'happy']);
/** @typedef {typeof GUIDE_MOODS[number]} GuideMood */

/** Partes del dibujo que se animan: si falta alguna, el archivo no sirve y se usa la tarjeta normal. */
export const GUIDE_PARTS = ['chele-bob', 'chele-arm', 'chele-wave', 'chele-eyes', 'chele-eyes-happy', 'chele-mouth', 'chele-mouth-big', 'chele-shadow'];

/** Letras por segundo al «hablar» (rápido: un texto de 180 letras tarda unos 2 segundos). */
export const TYPING_CPS = 90;

const ART_URL = new URL('../assets/chele.svg', import.meta.url).href;

/**
 * Quita del dibujo todo lo que pueda ejecutar código o traer cosas de fuera (por si el archivo se cambiara).
 * @param {Element} root
 */
function sanitize(root) {
  for (const el of root.querySelectorAll('script, foreignObject, iframe, image, use')) el.remove();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || ((name === 'href' || name === 'xlink:href') && !attr.value.startsWith('#'))) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * Convierte el texto del archivo en el dibujo (o null si no es un SVG válido con todas sus partes).
 * @param {string} text
 * @param {(text: string) => Document} [parse]
 * @returns {SVGSVGElement | null}
 */
export function parseGuideArt(text, parse = (t) => new DOMParser().parseFromString(t, 'image/svg+xml')) {
  if (typeof text !== 'string' || !text.includes('<svg')) return null;
  const doc = parse(text);
  const svg = doc?.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return null;
  if (!GUIDE_PARTS.every((part) => svg.querySelector(`.${part}`))) return null;
  sanitize(svg);
  return /** @type {SVGSVGElement} */ (/** @type {unknown} */ (svg));
}

/** @type {Promise<SVGSVGElement | null> | null} */
let cached = null;

/**
 * Trae el dibujo de Chele (una sola descarga; después, copias). Nunca falla: si algo sale mal, null.
 * @param {{ fetchImpl?: typeof fetch, parse?: (text: string) => Document, fresh?: boolean }} [options]  (para las pruebas)
 * @returns {Promise<SVGSVGElement | null>}
 */
export async function loadGuideArt({ fetchImpl, parse, fresh = false } = {}) {
  const useCache = !fresh && !fetchImpl && !parse;
  if (!useCache || !cached) {
    const job = (async () => {
      try {
        const doFetch = fetchImpl ?? globalThis.fetch;
        if (typeof doFetch !== 'function') return null;
        const response = await doFetch(ART_URL);
        if (!response || !response.ok) return null;
        return parseGuideArt(await response.text(), parse);
      } catch {
        return null;
      }
    })();
    if (!useCache) return job;
    cached = job;
  }
  const art = await cached;
  if (!art) {
    cached = null; // se reintenta la próxima vez (por ejemplo, al volver la conexión)
    return null;
  }
  return /** @type {SVGSVGElement} */ (document.importNode(art, true));
}

/**
 * @typedef {{ top: number, left: number, width: number, height: number }} Box
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{
 *   bubble: { top: number, left: number },
 *   chele: { top: number, left: number } | null,
 *   tail: { edge: 'top' | 'bottom' | 'none', x: number },
 *   face: 'left' | 'right',
 *   dir: 'up' | 'down',
 *   side: 'below' | 'above' | 'over' | 'center',
 * }} GuideLayout
 */

/**
 * Dónde van Chele y su globo. Chele va al lado del globo (en el lado más cercano al elemento), los dos juntos
 * debajo o encima del elemento; el bloque nunca tapa el elemento ni entra en la franja de abajo (`inset`,
 * la barra de pestañas del celular). Si con Chele el bloque no cabe ni encima ni debajo, va el globo solo.
 * Sin elemento (bienvenida), el bloque va en el centro.
 * @param {Box | null} target  Recuadro resaltado (coordenadas de la ventana)
 * @param {Size} bubble
 * @param {Size | null} chele  null = sin Chele
 * @param {Size} viewport
 * @param {{ gap?: number, margin?: number, inset?: number, space?: number }} [options]
 * @returns {GuideLayout}
 */
export function placeGuide(target, bubble, chele, viewport, { gap = 14, margin = 16, inset = 0, space = 16 } = {}) {
  const area = { width: viewport.width, height: Math.max(0, viewport.height - inset) };

  /** @param {boolean} withChele */
  const layout = (withChele) => {
    const block = {
      width: bubble.width + (withChele && chele ? chele.width + space : 0),
      height: Math.max(bubble.height, withChele && chele ? chele.height : 0),
    };
    if (!target) {
      const left = Math.round(Math.max(margin, (area.width - block.width) / 2));
      const top = Math.round(Math.max(margin, (area.height - block.height) / 2));
      return { block, pos: { top, left, side: /** @type {'center'} */ ('center') } };
    }
    return { block, pos: placeCard(target, block, area, { gap, margin }) };
  };

  const fitsSideways = (withChele) => !withChele || !chele || bubble.width + chele.width + space <= area.width - 2 * margin;
  let withChele = Boolean(chele && chele.width > 0 && chele.height > 0) && fitsSideways(true);
  let { block, pos } = layout(withChele);
  if (withChele && pos.side === 'over') {
    // Con Chele no cabe sin tapar: el globo solo ocupa menos.
    withChele = false;
    ({ block, pos } = layout(false));
  }

  const targetCx = target ? target.left + target.width / 2 : -Infinity;
  const targetCy = target ? target.top + target.height / 2 : 0;
  // Chele en el lado del bloque más cercano al elemento.
  const cheleOnLeft = !target || targetCx <= pos.left + block.width / 2;
  // Debajo del elemento: alineados arriba (la colita queda cerca); encima: alineados abajo.
  const alignTop = pos.side === 'below';
  const yFor = (/** @type {number} */ height) => (alignTop ? pos.top : pos.top + block.height - height);

  const bubbleLeft = withChele && cheleOnLeft && chele ? pos.left + chele.width + space : pos.left;
  const bubbleTop = Math.round(yFor(bubble.height));
  const cheleBox = withChele && chele
    ? { left: Math.round(cheleOnLeft ? pos.left : pos.left + bubble.width + space), top: Math.round(yFor(chele.height)) }
    : null;

  const edge = pos.side === 'below' ? 'top' : pos.side === 'above' ? 'bottom' : 'none';
  const tailX = Math.round(Math.min(Math.max(targetCx - bubbleLeft, 24), bubble.width - 24));
  const cheleCx = cheleBox && chele ? cheleBox.left + chele.width / 2 : bubbleLeft;
  const cheleCy = cheleBox && chele ? cheleBox.top + chele.height / 2 : bubbleTop;

  return {
    bubble: { top: bubbleTop, left: Math.round(bubbleLeft) },
    chele: cheleBox,
    tail: { edge, x: edge === 'none' ? 0 : tailX },
    face: target && targetCx > cheleCx ? 'right' : target ? 'left' : 'right',
    dir: target && targetCy > cheleCy ? 'down' : 'up',
    side: pos.side,
  };
}

/**
 * ¿Se cruzan dos recuadros? (para las pruebas y para comprobar en la app)
 * @param {Box} a @param {Box} b
 */
export function overlaps(a, b) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * Escribe `text` poco a poco en dos partes: lo ya «dicho» (visible) y lo que falta (invisible, pero ocupa su
 * lugar: el globo tiene desde el principio su tamaño final y no salta). Con `instant`, todo de una vez.
 * @param {{ textContent: string | null }} said
 * @param {{ textContent: string | null }} rest
 * @param {string} text
 * @param {{ instant?: boolean, cps?: number }} [options]
 * @returns {{ finish: () => void, isDone: () => boolean }}
 */
export function startTyping(said, rest, text, { instant = false, cps = TYPING_CPS } = {}) {
  let frame = 0;
  let done = false;
  const show = (/** @type {number} */ n) => {
    said.textContent = text.slice(0, n);
    rest.textContent = text.slice(n);
  };
  const finish = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    done = true;
    show(text.length);
  };
  if (instant || !text || typeof requestAnimationFrame !== 'function') {
    finish();
    return { finish, isDone: () => done };
  }
  show(0);
  const start = performance.now();
  const tick = (/** @type {number} */ now) => {
    const n = Math.min(text.length, Math.floor(((now - start) / 1000) * cps));
    show(n);
    if (n >= text.length) {
      frame = 0;
      done = true;
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { finish, isDone: () => done };
}

/** ¿La persona pidió reducir el movimiento? (entonces: sin escritura animada ni movimiento) */
export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
