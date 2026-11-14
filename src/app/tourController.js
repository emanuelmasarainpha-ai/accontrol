// @ts-check
// =============================================================================
// RECORRIDO GUIADO: CUÁNDO SE OFRECE Y QUÉ SE RECUERDA
// -----------------------------------------------------------------------------
// · La primera vez que se abre un espacio de un tipo (Personal, Freelancer…) sale la bienvenida con dos botones:
//   «Empezar recorrido» y «Saltar, ya sé usar la app». Cerrarla también cuenta como saltar.
// · Al terminar o saltar se recuerda para ESA cuenta y ESE tipo (tourMemory.js); desde Ajustes se puede repetir.
// · Los pasos están en tourSteps.js; el motor que dibuja, en ui/tour.js.
// · 0.14.4: en los tipos de GUIDE.kinds lo conduce Chele (ui/guide.js), que también dice la bienvenida. Si su
//   dibujo no carga, la bienvenida es la ventana de siempre y el recorrido, la tarjeta normal.
// =============================================================================

import { KIND_INFO } from '../domain/workspaces.js';
import { choiceDialog } from '../ui/dialog.js';
import { loadGuideArt } from '../ui/guide.js';
import { runTour } from '../ui/tour.js';
import { toast } from '../ui/toast.js';
import { routeFromHash } from './router.js';
import { GUIDE, guideWelcome, hasTour, selectorsFor, stepsFor } from './tourSteps.js';

/** @typedef {import('../domain/types.js').WorkspaceKind} WorkspaceKind */
/** @typedef {import('./tourMemory.js').TourMemory} TourMemory */
/** @typedef {ReturnType<typeof import('./store.js').createStore>} Store */

/** Cuánto se espera a que la app dibuje la pantalla nueva después de cambiar de dirección. */
const NAVIGATION_WAIT_MS = 1000;

/**
 * ¿Hay que ofrecer la bienvenida ahora? Devuelve el tipo de espacio, o null.
 * @param {{ ready: boolean, kind: WorkspaceKind | null, busy: boolean, dialogOpen: boolean, memory: Pick<TourMemory, 'hasSeen'> }} input
 *   ready: datos cargados y con un espacio abierto (no en la pantalla de elegir modalidad)
 *   busy: ya hay una bienvenida o un recorrido en marcha
 *   dialogOpen: hay otra ventana abierta (un formulario, una confirmación): no se interrumpe
 * @returns {WorkspaceKind | null}
 */
export function tourToOffer({ ready, kind, busy, dialogOpen, memory }) {
  if (!ready || !kind || busy || dialogOpen) return null;
  if (!hasTour(kind) || memory.hasSeen(kind)) return null;
  return kind;
}

/**
 * Va a una pantalla y espera a que la app la dibuje.
 * @param {string} route
 * @returns {Promise<void>}
 */
export function navigateTo(route) {
  if (routeFromHash(window.location.hash) === route) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', onChange);
      // Un cuadro más: la app dibuja en su propio aviso de «hashchange», que va antes que este.
      requestAnimationFrame(() => resolve());
    };
    const onChange = () => done();
    const timer = window.setTimeout(done, NAVIGATION_WAIT_MS);
    window.addEventListener('hashchange', onChange);
    window.location.hash = `#/${route}`;
  });
}

/**
 * @param {{ store: Store, memory: TourMemory }} options
 */
export function createTourController({ store, memory }) {
  let busy = false;

  const activeKind = () => store.activeWorkspace()?.kind ?? null;
  const nowISO = () => store.now().toISOString();

  /**
   * El dibujo de Chele si conduce este tipo de espacio y cargó; si no, null (tarjeta normal).
   * @param {WorkspaceKind} kind
   */
  async function guideFor(kind) {
    return GUIDE.kinds.includes(kind) ? loadGuideArt() : null;
  }

  /**
   * @param {WorkspaceKind} kind
   * @param {SVGSVGElement | null} guide
   * @param {boolean} withWelcome  Chele dice antes la bienvenida (con «Empezar recorrido» / «Saltar…»).
   */
  function launch(kind, guide, withWelcome) {
    busy = true;
    const startRoute = routeFromHash(window.location.hash);
    runTour({
      label: `Recorrido por tu espacio ${KIND_INFO[kind].label}`,
      steps: stepsFor(kind).map((s) => ({ title: s.title, text: s.text, route: s.route, selectors: selectorsFor(s.target), mood: s.mood })),
      guide,
      guideName: guide ? GUIDE.name : '',
      intro: guide && withWelcome ? guideWelcome(kind) : undefined,
      navigate: navigateTo,
      onEnd(reason) {
        memory.mark(kind, reason, nowISO());
        busy = false;
        void navigateTo(startRoute);
        if (reason === 'skipped') toast('Puedes ver el recorrido cuando quieras en Ajustes.');
      },
    });
  }

  /** @param {WorkspaceKind} kind */
  async function start(kind) {
    if (busy || !hasTour(kind)) return;
    busy = true;
    launch(kind, await guideFor(kind), false);
  }

  /** @param {WorkspaceKind} kind */
  async function welcome(kind) {
    busy = true;
    const guide = await guideFor(kind);
    // Mientras cargaba el dibujo cambió el espacio o se abrió otra ventana: se ofrecerá en el próximo dibujo.
    if (activeKind() !== kind || document.querySelector('dialog[open]')) {
      busy = false;
      return;
    }
    if (guide) {
      // La bienvenida la dice Chele, dentro del mismo recorrido («Saltar…» cuenta como saltar, igual que antes).
      launch(kind, guide, true);
      return;
    }
    const info = KIND_INFO[kind];
    const answer = await choiceDialog({
      title: `Te damos la bienvenida a tu espacio ${info.label}`,
      message: 'Te muestro en la pantalla, paso a paso, dónde está cada función de este espacio. Toma un par de minutos y puedes verlo otra vez cuando quieras desde Ajustes.',
      choices: [
        { id: 'start', label: 'Empezar recorrido', primary: true },
        { id: 'skip', label: 'Saltar, ya sé usar la app' },
      ],
    });
    busy = false;
    if (answer === 'start') {
      launch(kind, null, false);
    } else {
      memory.mark(kind, 'skipped', nowISO());
      toast('Puedes ver el recorrido cuando quieras en Ajustes.');
    }
  }

  return {
    /** Se llama después de cada dibujo de pantalla: si toca, ofrece la bienvenida (un momento después). */
    maybeOffer() {
      if (busy) return;
      window.setTimeout(() => {
        const state = store.getState();
        const kind = tourToOffer({
          ready: state.status === 'ready' && state.activeWorkspaceId !== null,
          kind: activeKind(),
          busy,
          dialogOpen: document.querySelector('dialog[open]') !== null,
          memory,
        });
        if (kind) void welcome(kind);
      }, 0);
    },
    /** ¿El espacio abierto tiene recorrido? */
    available: () => hasTour(activeKind()),
    /** Empieza el recorrido del espacio abierto (botón «Ver el recorrido otra vez» de Ajustes). */
    startActive() {
      const kind = activeKind();
      if (kind) void start(kind);
    },
  };
}

/** @typedef {ReturnType<typeof createTourController>} TourController */
