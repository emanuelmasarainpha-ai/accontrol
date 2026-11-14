// @ts-check
// =============================================================================
// MOTOR DEL RECORRIDO GUIADO
// -----------------------------------------------------------------------------
// Oscurece la pantalla, resalta UN elemento real y muestra una tarjeta junto a él con título, explicación,
// «Paso 3 de 8» y los botones Atrás / Siguiente (o Terminar) / Saltar.
//
// No sabe nada de ACCONTROL: recibe los pasos (título, texto, selectores CSS y pantalla) y una función para
// navegar. Lo que es de la app (qué pasos, cuándo ofrecerlo, qué recordar) está en app/tourController.js.
//
// Cómo está hecho:
//   · Todo vive dentro de un <dialog> modal a pantalla completa: el navegador deja el resto de la app inerte
//     (no se puede tocar ni enfocar), el foco queda dentro y Esc lo cierra.
//   · El oscurecido es la sombra gigante de un recuadro («spot») colocado sobre el elemento.
//   · Las posiciones se ponen con `element.style` desde aquí (lo permite la política de seguridad de
//     index.html; lo que prohíbe son los estilos escritos dentro del HTML).
//   · Si un elemento no existe o está oculto (por ejemplo, el menú lateral en el celular), se prueba el
//     siguiente selector; si ninguno está visible, el paso se quita y el recorrido sigue.
//   · La posición se recalcula al girar el celular, cambiar el tamaño de la ventana o hacer scroll.
//   · Con `guide` (0.14.4) lo conduce Chele: la tarjeta se vuelve su globo de diálogo (con una colita hacia el
//     elemento), él va al lado con la expresión de cada paso y el texto aparece como si lo dijera. Sin `guide`
//     (el dibujo no cargó), todo es la tarjeta normal de siempre.
// =============================================================================

import { placeGuide, prefersReducedMotion, startTyping } from './guide.js';
import { html, setHtml } from './html.js';

/** @typedef {import('./guide.js').GuideMood} GuideMood */

/**
 * @typedef {Object} EngineStep
 * @property {string} title
 * @property {string} text
 * @property {string[]} selectors  En orden de preferencia: se resalta el primero que esté visible.
 * @property {string} [route]      Pantalla a la que hay que ir antes de mostrar el paso.
 * @property {GuideMood} [mood]    Expresión de Chele en este paso (si no dice, señala).
 */

/**
 * Bienvenida dicha por Chele antes del primer paso (sin elemento resaltado).
 * @typedef {Object} EngineIntro
 * @property {string} title
 * @property {string} text
 * @property {GuideMood} mood
 * @property {string} startLabel  «Empezar recorrido»
 * @property {string} skipLabel   «Saltar, ya sé usar la app»
 */

/** Cuánto se espera a que aparezca el elemento de un paso (después de cambiar de pantalla). */
export const TARGET_WAIT_MS = 1500;
/** Aire alrededor del elemento resaltado. */
const SPOT_PAD = 6;
/** Al desplazar la página, el elemento queda a esta distancia de arriba (debajo de la barra superior del celular). */
const REVEAL_TOP = 88;

/**
 * Dónde poner la tarjeta: debajo del elemento si cabe, si no encima, y si no cabe en ningún lado, sobre la
 * pantalla en la mitad contraria a la del elemento (para no taparlo). Siempre dentro de la pantalla.
 * @param {{ top: number, left: number, width: number, height: number }} target  Rectángulo del elemento (coordenadas de la ventana)
 * @param {{ width: number, height: number }} card
 * @param {{ width: number, height: number }} viewport
 * @param {{ gap?: number, margin?: number }} [options]
 * @returns {{ top: number, left: number, side: 'below' | 'above' | 'over' }}
 */
export function placeCard(target, card, viewport, { gap = 12, margin = 16 } = {}) {
  const bottom = target.top + target.height;
  const maxLeft = Math.max(margin, viewport.width - card.width - margin);
  const left = Math.round(Math.min(Math.max(target.left + target.width / 2 - card.width / 2, margin), maxLeft));
  const maxTop = Math.max(margin, viewport.height - card.height - margin);
  if (viewport.height - bottom - margin >= card.height + gap) return { top: Math.round(bottom + gap), left, side: 'below' };
  if (target.top - margin >= card.height + gap) return { top: Math.round(target.top - gap - card.height), left, side: 'above' };
  const targetInTopHalf = target.top + target.height / 2 < viewport.height / 2;
  return { top: Math.round(targetInTopHalf ? maxTop : margin), left, side: 'over' };
}

/**
 * Recuadro del resaltado: el elemento con un poco de aire, recortado a la pantalla.
 * @param {{ top: number, left: number, width: number, height: number }} target
 * @param {{ width: number, height: number }} viewport
 */
export function spotRect(target, viewport, pad = SPOT_PAD) {
  const top = Math.max(0, target.top - pad);
  const left = Math.max(0, target.left - pad);
  const right = Math.min(viewport.width, target.left + target.width + pad);
  const bottom = Math.min(viewport.height, target.top + target.height + pad);
  return { top: Math.round(top), left: Math.round(left), width: Math.max(0, Math.round(right - left)), height: Math.max(0, Math.round(bottom - top)) };
}

/**
 * ¿Se ve el elemento? (existe, no está escondido y ocupa lugar en la pantalla)
 * @param {Element | null} el
 */
export function isShown(el) {
  if (!(el instanceof HTMLElement) || !el.isConnected || el.closest('[hidden]')) return false;
  if (el.getClientRects().length === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
}

/**
 * El primer elemento visible de la lista de selectores (o null).
 * @param {string[]} selectors
 */
export function findVisible(selectors) {
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (isShown(el)) return /** @type {HTMLElement} */ (el);
    }
  }
  return null;
}

/**
 * Espera (sin bloquear) a que aparezca un elemento visible.
 * @param {string[]} selectors @param {() => boolean} cancelled
 * @returns {Promise<HTMLElement | null>}
 */
function waitForVisible(selectors, cancelled) {
  const deadline = Date.now() + TARGET_WAIT_MS;
  return new Promise((resolve) => {
    const check = () => {
      if (cancelled()) return resolve(null);
      const el = findVisible(selectors);
      if (el) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      window.setTimeout(check, 50);
    };
    check();
  });
}

/**
 * Empieza el recorrido.
 * @param {Object} options
 * @param {EngineStep[]} options.steps
 * @param {(route: string) => Promise<void>} options.navigate  Ir a una pantalla; se cumple cuando ya está dibujada (si ya estás en ella, enseguida).
 * @param {(reason: 'done' | 'skipped') => void} options.onEnd  done = pulsó Terminar; skipped = Saltar, Esc o no había nada que mostrar.
 * @param {string} [options.label]                           Nombre del recorrido para el lector de pantalla.
 * @param {SVGSVGElement | null} [options.guide]              Dibujo de Chele (de loadGuideArt); sin él, tarjeta normal.
 * @param {string} [options.guideName]                        Nombre del guía, delante de «Paso X de N».
 * @param {EngineIntro} [options.intro]                       Bienvenida dicha por el guía (solo con `guide`).
 * @returns {{ stop: () => void }}
 */
export function runTour({ steps, navigate, onEnd, label = 'Recorrido guiado', guide = null, guideName = '', intro }) {
  const list = [...steps];
  let index = -1;
  let turn = 0;
  let ended = false;
  /** @type {HTMLElement | null} */
  let current = null;
  let frame = 0;
  /** Mostrando la bienvenida del guía (antes del paso 1). */
  let inIntro = Boolean(guide && intro);
  /** @type {{ finish: () => void, isDone: () => boolean } | null} */
  let typing = null;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const controller = new AbortController();
  const { signal } = controller;

  const dialog = document.createElement('dialog');
  dialog.className = guide ? 'tour tour--guided' : 'tour';
  dialog.setAttribute('aria-label', label);
  // El texto se escribe en dos partes que ve la persona (lo ya dicho y lo que falta, invisible pero ocupando su
  // lugar) y entero, de una vez, en «tour-text» para el lector de pantalla.
  setHtml(
    dialog,
    html`<div class="tour__spot" hidden></div>
      ${guide ? html`<div class="tour__guide" aria-hidden="true"></div>` : ''}
      <div class="tour__card" tabindex="-1" role="group" aria-labelledby="tour-title" aria-describedby="tour-progress tour-text">
        ${guide ? html`<span class="tour__tail" aria-hidden="true"></span>` : ''}
        <p class="tour__progress" id="tour-progress"></p>
        <h2 class="tour__title" id="tour-title"></h2>
        <p class="tour__text" aria-hidden="true"><span class="tour__said"></span><span class="tour__rest"></span></p>
        <p class="sr-only" id="tour-text"></p>
        <div class="tour__actions">
          <button type="button" class="link-btn tour__skip" data-tour-do="skip">Saltar</button>
          <span class="tour__nav">
            <button type="button" class="btn btn--ghost btn--small" data-tour-do="back">Atrás</button>
            <button type="button" class="btn btn--primary btn--small" data-tour-do="next">Siguiente</button>
          </span>
        </div>
      </div>`,
  );
  const spot = /** @type {HTMLElement} */ (dialog.querySelector('.tour__spot'));
  const card = /** @type {HTMLElement} */ (dialog.querySelector('.tour__card'));
  const progress = /** @type {HTMLElement} */ (dialog.querySelector('.tour__progress'));
  const title = /** @type {HTMLElement} */ (dialog.querySelector('.tour__title'));
  const said = /** @type {HTMLElement} */ (dialog.querySelector('.tour__said'));
  const rest = /** @type {HTMLElement} */ (dialog.querySelector('.tour__rest'));
  const srText = /** @type {HTMLElement} */ (dialog.querySelector('#tour-text'));
  const backBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-tour-do="back"]'));
  const nextBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-tour-do="next"]'));
  const skipBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('[data-tour-do="skip"]'));
  const guideBox = /** @type {HTMLElement | null} */ (dialog.querySelector('.tour__guide'));
  const tail = /** @type {HTMLElement | null} */ (dialog.querySelector('.tour__tail'));
  if (guide && guideBox) guideBox.append(guide);

  /**
   * Pone el texto del paso: entero para el lector de pantalla y, a la vista, «dicho» poco a poco por el guía
   * (de una vez sin guía o con «reducir movimiento»).
   * @param {string} value
   */
  function say(value) {
    typing?.finish();
    srText.textContent = value;
    typing = startTyping(said, rest, value, { instant: !guide || prefersReducedMotion() });
  }

  /** @param {GuideMood} mood */
  function setMood(mood) {
    if (guide) guide.dataset.mood = mood;
  }

  /** @param {'done' | 'skipped'} reason */
  function end(reason) {
    if (ended) return;
    ended = true;
    turn += 1;
    typing?.finish();
    controller.abort();
    resizeObserver?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (dialog.open) dialog.close();
    dialog.remove();
    document.body.classList.remove('is-touring');
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    onEnd(reason);
  }

  function viewport() {
    return { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
  }

  /**
   * Franja de abajo que el guía no debe pisar: la barra de pestañas del celular (si se ve).
   * @returns {number}
   */
  function bottomInset() {
    const bar = document.querySelector('.tabbar');
    if (!(bar instanceof HTMLElement) || !isShown(bar)) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, viewport().height - rect.top);
  }

  /**
   * Coloca a Chele y su globo (con la colita hacia el elemento). `box` = recuadro resaltado, o null.
   * @param {{ top: number, left: number, width: number, height: number } | null} box
   */
  function placeWithGuide(box) {
    if (!guideBox) return;
    const vp = viewport();
    const gap = parseFloat(getComputedStyle(dialog).getPropertyValue('--guide-gap'));
    const options = { inset: bottomInset(), space: Number.isFinite(gap) ? gap : 16 };
    const measure = () => ({ width: card.offsetWidth, height: card.offsetHeight });
    // Primero con Chele al lado (globo más estrecho); si así no cabe sin tapar, el globo solo y a lo ancho.
    dialog.classList.remove('is-solo');
    let layout = placeGuide(box, measure(), { width: guideBox.offsetWidth, height: guideBox.offsetHeight }, vp, options);
    if (!layout.chele) {
      dialog.classList.add('is-solo');
      layout = placeGuide(box, measure(), null, vp, options);
    }
    card.style.transform = `translate(${layout.bubble.left}px, ${layout.bubble.top}px)`;
    card.dataset.side = layout.side;
    card.dataset.tail = layout.tail.edge;
    if (tail) tail.style.transform = `translateX(${layout.tail.x - 8}px) rotate(45deg)`;
    guideBox.classList.toggle('is-away', !layout.chele);
    if (layout.chele) guideBox.style.transform = `translate(${layout.chele.left}px, ${layout.chele.top}px)`;
    guideBox.dataset.face = layout.face;
    if (guide) guide.dataset.dir = layout.dir;
    // La primera vez aparece en su sitio; después se desliza de un lugar a otro.
    if (!guideBox.classList.contains('is-placed')) requestAnimationFrame(() => guideBox.classList.add('is-placed'));
  }

  /** Coloca el resaltado y la tarjeta donde corresponde ahora mismo. */
  function place() {
    frame = 0;
    if (ended) return;
    if (inIntro) {
      spot.hidden = true;
      placeWithGuide(null);
      return;
    }
    if (index < 0) return;
    if (!isShown(current)) current = findVisible(list[index].selectors);
    const vp = viewport();
    const cardSize = { width: card.offsetWidth, height: card.offsetHeight };
    if (!current && guide) {
      spot.hidden = true;
      placeWithGuide(null);
      return;
    }
    if (!current) {
      // El elemento desapareció (por ejemplo, al girar el celular cambió el menú): tarjeta abajo, sin resaltado.
      spot.hidden = true;
      const fallback = placeCard({ top: 0, left: vp.width / 2, width: 0, height: 0 }, cardSize, vp);
      card.style.transform = `translate(${fallback.left}px, ${fallback.top}px)`;
      return;
    }
    const rect = current.getBoundingClientRect();
    const box = spotRect(rect, vp);
    spot.hidden = false;
    // Solo transform se anima (suave); el tamaño cambia al instante.
    spot.style.transform = `translate(${box.left}px, ${box.top}px)`;
    spot.style.width = `${box.width}px`;
    spot.style.height = `${box.height}px`;
    if (guide) {
      placeWithGuide(box);
      return;
    }
    const where = placeCard(box, cardSize, vp);
    card.style.transform = `translate(${where.left}px, ${where.top}px)`;
    card.dataset.side = where.side;
  }

  function schedule() {
    if (!frame && !ended) frame = requestAnimationFrame(place);
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;

  /**
   * Si el elemento no se ve entero, o no deja sitio para la tarjeta, se desplaza la página para dejarlo cerca de
   * arriba (con sitio debajo para la tarjeta). El salto es instantáneo: con un desplazamiento suave la tarjeta
   * «volaría» por la pantalla mientras tanto.
   * @param {HTMLElement} el
   */
  function reveal(el) {
    // Si está en una fila que se desliza de lado (las pestañas de Finanzas en el celular), se desliza esa fila
    // hasta dejarlo a la vista. `block: 'nearest'` no mueve la página si ya se ve de arriba a abajo.
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    const rect = el.getBoundingClientRect();
    const vp = viewport();
    const blockHeight = guideBox ? Math.max(card.offsetHeight, guideBox.offsetHeight) : card.offsetHeight;
    const need = blockHeight + 12 + 16 + (guideBox ? bottomInset() : 0);
    const fullyVisible = rect.top >= REVEAL_TOP && rect.bottom <= vp.height;
    const roomForCard = vp.height - rect.bottom >= need || rect.top >= need;
    if (fullyVisible && roomForCard) return;
    const before = window.scrollY;
    window.scrollTo({ top: Math.max(0, before + rect.top - REVEAL_TOP), behavior: 'auto' });
  }

  /**
   * Muestra el paso `i`. Si su elemento no aparece, lo quita y sigue en la misma dirección.
   * @param {number} i @param {1 | -1} direction
   */
  async function show(i, direction) {
    const mine = (turn += 1);
    card.setAttribute('aria-busy', 'true');
    let target = Math.min(Math.max(i, 0), list.length - 1);
    for (;;) {
      if (list.length === 0) return end('skipped');
      const step = list[target];
      if (step.route) await navigate(step.route);
      if (ended || mine !== turn) return;
      const el = await waitForVisible(step.selectors, () => ended || mine !== turn);
      if (ended || mine !== turn) return;
      if (el) {
        index = target;
        current = el;
        break;
      }
      list.splice(target, 1);
      if (list.length === 0) return end('skipped');
      if (direction < 0) target -= 1;
      target = Math.min(Math.max(target, 0), list.length - 1);
    }
    const step = list[index];
    const last = index === list.length - 1;
    progress.textContent = guideName ? `${guideName} · Paso ${index + 1} de ${list.length}` : `Paso ${index + 1} de ${list.length}`;
    title.textContent = step.title;
    setMood(step.mood ?? 'point');
    say(step.text);
    backBtn.disabled = index === 0;
    nextBtn.textContent = last ? 'Terminar' : 'Siguiente';
    card.removeAttribute('aria-busy');
    resizeObserver?.disconnect();
    resizeObserver?.observe(document.documentElement);
    if (current) {
      resizeObserver?.observe(current);
      reveal(current);
    }
    place();
    card.focus({ preventScroll: true });
  }

  /** La bienvenida: el guía saluda en el centro, sin resaltar nada, con sus dos botones. */
  function showIntro() {
    if (!intro) return;
    progress.hidden = true;
    backBtn.hidden = true;
    skipBtn.textContent = intro.skipLabel;
    nextBtn.textContent = intro.startLabel;
    title.textContent = intro.title;
    setMood(intro.mood);
    say(intro.text);
    place();
    card.focus({ preventScroll: true });
  }

  /** De la bienvenida al paso 1: los botones vuelven a ser los del recorrido. */
  function leaveIntro() {
    inIntro = false;
    progress.hidden = false;
    backBtn.hidden = false;
    skipBtn.textContent = 'Saltar';
    void show(0, 1);
  }

  function next() {
    if (inIntro) return leaveIntro();
    if (index < 0 || card.hasAttribute('aria-busy')) return;
    if (index >= list.length - 1) end('done');
    else void show(index + 1, 1);
  }

  function back() {
    if (inIntro || index <= 0 || card.hasAttribute('aria-busy')) return;
    void show(index - 1, -1);
  }

  dialog.addEventListener(
    'click',
    (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-tour-do]') : null;
      if (!(button instanceof HTMLElement)) {
        // Tocar el globo (fuera de los botones) completa el texto al instante.
        if (event.target instanceof Node && card.contains(event.target)) typing?.finish();
        return;
      }
      const action = button.dataset.tourDo;
      if (action === 'next') next();
      else if (action === 'back') back();
      else if (action === 'skip') end('skipped');
    },
    { signal },
  );
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        // Enter sobre un botón ya lo pulsa el navegador; en el resto de la tarjeta, avanza.
        event.preventDefault();
        next();
      }
    },
    { signal },
  );
  // Esc: el navegador avisa con «cancel» (y a veces cierra el diálogo directamente): en los dos casos, se salta.
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      end('skipped');
    },
    { signal },
  );
  dialog.addEventListener('close', () => end('skipped'), { signal });

  window.addEventListener('resize', schedule, { signal });
  window.addEventListener('orientationchange', schedule, { signal });
  document.addEventListener('scroll', schedule, { signal, capture: true, passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { signal });
  window.visualViewport?.addEventListener('scroll', schedule, { signal });

  document.body.append(dialog);
  document.body.classList.add('is-touring');
  dialog.showModal();
  if (inIntro) showIntro();
  else void show(0, 1);

  return { stop: () => end('skipped') };
}
