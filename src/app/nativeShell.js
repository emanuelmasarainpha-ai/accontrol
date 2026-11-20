// @ts-check
// =============================================================================
// LA APP DE ANDROID SE COMPORTA COMO UNA APP (0.18.0)
// -----------------------------------------------------------------------------
// · Barra de estado: los iconos (hora, batería) van oscuros con el tema claro y claros con el oscuro de ACCONTROL, aunque el
//   teléfono use otro tema (complemento SystemBars, que viene con Capacitor). El fondo de esa franja es la propia página
//   (viewport-fit=cover y los márgenes env(safe-area-inset-*) de los estilos).
// · Botón «atrás» (complemento oficial App): 1) cierra la ventana abierta, con su misma salida suave (como Esc); 2) si no
//   hay, vuelve a la pantalla anterior; 3) si no hay anterior, va a Inicio; 4) en Inicio, manda la app al fondo (como
//   Android 12+), sin cerrarla.
// En el navegador nada de esto se activa. Sin librerías: Capacitor.nativePromise / nativeCallback.
// =============================================================================

import { DEFAULT_ROUTE, routeFromHash } from './router.js';

/** @typedef {'light' | 'dark'} Theme */
/** @typedef {{ nativePromise: (p: string, m: string, o?: object) => Promise<any>, nativeCallback: (p: string, m: string, o: object, cb: (data: any, err?: any) => void) => unknown }} Bridge */

/**
 * Estilo de la barra de estado para el tema de ACCONTROL. En Capacitor, DARK = iconos claros (para fondos oscuros).
 * @param {Theme} theme @returns {'DARK' | 'LIGHT'}
 */
export function statusBarStyle(theme) {
  return theme === 'dark' ? 'DARK' : 'LIGHT';
}

/**
 * Qué hace el botón «atrás».
 * @param {{ dialogOpen: boolean, canGoBack: boolean, hash: string }} state
 * @returns {'close-dialog' | 'back' | 'home' | 'minimize'}
 */
export function backAction({ dialogOpen, canGoBack, hash }) {
  if (dialogOpen) return 'close-dialog';
  const atHome = routeFromHash(hash) === DEFAULT_ROUTE;
  if (canGoBack && !atHome) return 'back';
  if (!atHome && hash !== '') return 'home';
  return 'minimize';
}

/** @param {Bridge} cap @param {Theme} theme */
export function applyStatusBar(cap, theme) {
  void cap.nativePromise('SystemBars', 'setStyle', { style: statusBarStyle(theme), bar: 'StatusBar' }).catch(() => undefined);
}

/** Cierra la ventana como lo haría Esc: si la ventana tiene su salida suave (evento «cancel»), la usa. @param {HTMLDialogElement} dialog */
function closeLikeEscape(dialog) {
  const event = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(event);
  if (!event.defaultPrevented) dialog.close();
}

/**
 * Escucha el botón «atrás» de Android. Una sola vez, al arrancar.
 * @param {Bridge} cap
 */
export function installBackButton(cap) {
  cap.nativeCallback('App', 'addListener', { eventName: 'backButton' }, (data, error) => {
    if (error) return;
    const open = /** @type {HTMLDialogElement[]} */ ([...document.querySelectorAll('dialog[open]')]);
    const action = backAction({ dialogOpen: open.length > 0, canGoBack: data?.canGoBack === true, hash: window.location.hash });
    if (action === 'close-dialog') closeLikeEscape(open[open.length - 1]);
    else if (action === 'back') window.history.back();
    else if (action === 'home') window.location.hash = `#/${DEFAULT_ROUTE}`;
    else void cap.nativePromise('App', 'minimizeApp', {}).catch(() => undefined);
  });
}
