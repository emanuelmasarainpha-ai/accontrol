// @ts-check
// =============================================================================
// INSTALAR LA APP DESDE EL NAVEGADOR (0.20.4)
// -----------------------------------------------------------------------------
// Chrome, Edge y los navegadores de Android avisan con el evento «beforeinstallprompt» cuando la página se puede
// instalar. Se guarda ese evento y, cuando la persona pulsa «Instalar ACCONTROL» en Ajustes, se abre la ventana de
// instalación del navegador. Safari (iPhone, iPad y Mac) y Firefox no tienen ese evento: ahí se explican los pasos.
// En la app de Android (Capacitor) y en la app ya instalada no hay nada que instalar.
// No se llama a preventDefault: si el navegador quiere mostrar su propio aviso de instalar, lo sigue mostrando.
// =============================================================================

/**
 * Qué se puede ofrecer en este dispositivo:
 *   · 'native'    dentro de la app de Android: nada que instalar.
 *   · 'installed' ya abierta como app instalada (o se acaba de instalar).
 *   · 'prompt'    el navegador deja abrir su ventana de instalar: botón «Instalar ACCONTROL».
 *   · 'ios'       iPhone o iPad: Compartir → «Añadir a pantalla de inicio».
 *   · 'manual'    otro navegador: los pasos desde su menú.
 * @typedef {'native' | 'installed' | 'prompt' | 'ios' | 'manual'} InstallKind
 */

/**
 * La regla, sin tocar el navegador (para las pruebas).
 * @param {{ native: boolean, standalone: boolean, installed: boolean, hasPrompt: boolean, ios: boolean }} facts
 * @returns {InstallKind}
 */
export function installKind({ native, standalone, installed, hasPrompt, ios }) {
  if (native) return 'native';
  if (standalone || installed) return 'installed';
  if (hasPrompt) return 'prompt';
  if (ios) return 'ios';
  return 'manual';
}

/**
 * ¿iPhone o iPad? (Los iPad nuevos dicen ser una Mac, pero tienen pantalla táctil.)
 * @param {{ userAgent: string, platform?: string, maxTouchPoints?: number }} nav
 */
export function isAppleMobile(nav) {
  if (/iphone|ipad|ipod/i.test(nav.userAgent)) return true;
  return /mac/i.test(nav.platform ?? '') && (nav.maxTouchPoints ?? 0) > 1;
}

/** @type {{ prompt: () => Promise<void>, userChoice: Promise<{ outcome: string }> } | null} */
let deferred = null;
let justInstalled = false;
/** @type {Set<() => void>} */
const listeners = new Set();
const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * Empieza a escuchar al navegador. Se llama una vez al arrancar, antes de que llegue el evento.
 * @param {Window} [win]
 */
export function listenForInstall(win = window) {
  win.addEventListener('beforeinstallprompt', (event) => {
    deferred = /** @type {any} */ (event);
    notify();
  });
  win.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    notify();
  });
}

/** ¿Se abrió como app instalada? */
function runningStandalone() {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
  } catch {
    // Navegador sin matchMedia: se sigue con lo de Safari.
  }
  return /** @type {any} */ (navigator).standalone === true;
}

/** @param {boolean} native @returns {InstallKind} */
export function currentInstallKind(native) {
  return installKind({
    native,
    standalone: runningStandalone(),
    installed: justInstalled,
    hasPrompt: deferred !== null,
    ios: isAppleMobile({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
  });
}

/**
 * Abre la ventana de instalar del navegador.
 * @returns {Promise<'accepted' | 'dismissed' | 'unavailable'>}
 */
export async function promptInstall() {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null; // el navegador deja usar cada evento una sola vez
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    notify();
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    notify();
    return 'unavailable';
  }
}

/** Avisa cuando cambia lo que se puede ofrecer. @param {() => void} listener */
export function onInstallChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
