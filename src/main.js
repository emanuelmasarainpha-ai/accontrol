// @ts-check
// =============================================================================
// PUNTO DE ENTRADA
// Aquí se conectan las tres capas y se enciende la aplicación:
//   almacén de datos (IndexedDB)  ->  estado (store)  ->  pantallas (views)
//
// Desde la 0.14.0 hay una puerta antes de todo eso: sin sesión iniciada (correo y contraseña)
// no se crea ni el almacén ni las pantallas de la app; solo las de acceso.
//
// Para cambiar el almacenamiento (por ejemplo, a la nube con sincronización) solo hay
// que cambiar la línea que crea el almacén: el resto de la app no se entera.
// =============================================================================

import { createAccountApi } from './app/accountApi.js';
import { startApp } from './app/app.js';
import { createTourMemory, LOCAL_ACCOUNT } from './app/tourMemory.js';
import { emailReturnAddress, isNativeApp } from './app/platform.js';
import { installBackButton } from './app/nativeShell.js';
import { browserTarget, createAutoBackup, nativeTarget } from './app/autoBackup.js';
import { runAuthGate } from './app/authGate.js';
import { createStore } from './app/store.js';
import { createAuthClient, SESSION_KEY } from './auth/authClient.js';
import { claimNameAdoption, resolveDatabaseName } from './auth/localOwner.js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { createCloudStore } from './data/cloudStore.js';
import { createRatesClient, setRatesClient } from './data/ratesClient.js';
import { askAboutYouOnce } from './views/aboutYouPanel.js';
import { createIndexedDbStore } from './data/indexedDbStore.js';
import { centsToInputValue } from './domain/money.js';
import { playIntro } from './ui/intro.js';
import { installPasswordToggles } from './ui/passwordToggle.js';
import { installThemeToggle } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { createSyncController } from './sync/syncController.js';
import { askAboutCloudOnce, offerCloudRestore, remoteNotice } from './views/cloud.js';

/** @typedef {ReturnType<typeof import('./app/store.js').createStore>} Store */

/**
 * Si el navegador no deja abrir el almacenamiento (ventana privada, permisos...),
 * la app arranca igual y muestra un mensaje claro en lugar de quedarse en blanco.
 * @param {unknown} error
 * @returns {import('./data/workspaceStore.js').WorkspaceStore}
 */
function unavailableStore(error) {
  const message = error instanceof Error && error.message ? error.message : 'El almacenamiento del navegador no está disponible.';
  const fail = () => Promise.reject(new Error(message));
  const dataStore = { load: fail, putMany: fail, deleteMany: fail, saveSettings: fail, replaceAll: fail, clearAll: fail };
  return {
    listWorkspaces: fail, createWorkspace: fail, updateWorkspace: fail, deleteWorkspace: fail, setDefaultWorkspace: fail,
    getProfile: fail, saveProfile: fail, forWorkspace: () => dataStore, loadEverything: fail, replaceEverything: fail, clearEverything: fail,
  };
}

/** @param {string} [name] Base de datos local de esta cuenta (sin cuentas, la de siempre). */
async function openDataStore(name) {
  try {
    return await createIndexedDbStore(name ? { name } : {});
  } catch (error) {
    console.error('No se pudo abrir IndexedDB:', error);
    return unavailableStore(error);
  }
}

/**
 * Pide al navegador que no borre los datos si le falta espacio. Se pide solo cuando
 * ya hay algo que proteger, porque algunos navegadores muestran un aviso al usuario.
 * @param {Store} store
 */
function protectStorageWhenThereIsData(store) {
  let asked = false;
  const hasData = () => {
    const { data } = store.getState();
    return data.movements.length > 0 || data.goals.length > 0 || data.contributions.length > 0;
  };
  const ask = () => {
    if (asked || !hasData()) return;
    asked = true;
    void navigator.storage?.persist?.().catch(() => undefined);
  };
  ask();
  store.subscribe(ask);
}

/**
 * El Service Worker hace que la app abra sin internet y sea instalable.
 * Solo existe en páginas seguras (https o localhost).
 * En la app nativa (Android) no hace falta: los archivos ya vienen dentro de la app y las
 * versiones nuevas llegan al instalar la app actualizada, no por el aviso de «versión nueva».
 */
function registerServiceWorker() {
  if (isNativeApp() || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('No se pudo activar el modo sin conexión:', error);
    });
  };
  // Esperar a que la página termine de cargar para no competir con ella; pero si ya terminó, registrar ya.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/**
 * Mantiene al día las otras pestañas o ventanas de ACCONTROL abiertas en este mismo navegador
 * (por ejemplo, la app instalada y una pestaña normal comparten los mismos datos).
 * Sin esto, una pestaña con datos viejos podría validar contra información desactualizada.
 * El canal lleva el nombre de la base de datos: dos cuentas distintas no se avisan entre sí.
 * @param {Store} store @param {string} databaseName
 */
function keepTabsInSync(store, databaseName) {
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`accontrol-data:${databaseName}`) : null;
  if (channel) {
    store.onWrite(() => channel.postMessage('changed'));
    channel.addEventListener('message', () => void store.refresh());
  }
  // Respaldo para navegadores sin BroadcastChannel y para cuando el teléfono "despierta" la app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void store.refresh();
  });
  /** Avisa a las otras pestañas de que algo cambió por fuera de la pantalla (por ejemplo, llegó de la nube). */
  return () => channel?.postMessage('changed');
}

/** Dirección a la que vuelven los enlaces de los correos: esta misma página, sin la parte "#…" (vacía en la app nativa). */
function appAddress() {
  return emailReturnAddress(window.location, isNativeApp());
}

/** Quita de la barra de direcciones lo que dejó un enlace de correo (contiene tokens: no debe quedarse a la vista). */
function cleanAddress() {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

/**
 * Pone a la cuenta, en este dispositivo, el nombre que escribió al crearla, si todavía no tiene uno. Una sola vez.
 * @param {Store} store @param {import('./auth/authClient.js').AuthUser} user
 */
function adoptAccountName(store, user) {
  if (!user.displayName || !claimNameAdoption(localStorageOrNull(), user.id)) return;
  let done = false;
  const attempt = () => {
    const state = store.getState();
    if (done || state.status !== 'ready' || state.activeWorkspaceId === null) return;
    done = true;
    const { settings } = state.data;
    if (settings.displayName !== '') return;
    const opening = settings.openingBalanceCents;
    void store.saveSettings({ displayName: user.displayName, openingText: opening > 0 ? centsToInputValue(opening) : '' });
  };
  attempt();
  store.subscribe(attempt);
}

/** @returns {Storage | null} */
function localStorageOrNull() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Pide la sesión si hace falta y devuelve la cuenta, o null si la app corre sin cuentas (SUPABASE_URL vacío).
 * @param {HTMLElement} view
 * @param {Promise<void>} intro  La intro del logo: el login se dibuja cuando termina, para que se vea su entrada.
 */
async function signIn(view, intro) {
  if (!SUPABASE_URL) return null;
  const auth = createAuthClient({ url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, redirectTo: appAddress() });
  auth.init();

  // ¿Se abrió desde un enlace de un correo (confirmar cuenta, recuperar contraseña)?
  const link = await auth.consumeUrlHash(window.location.hash);
  if (link.kind !== 'none') cleanAddress();

  let user = auth.getUser();
  if ((link.kind === 'recovery' && user) || !user) await intro;
  if (link.kind === 'recovery' && user) {
    user = await runAuthGate({ auth, root: view, start: 'recovery' });
  } else if (!user) {
    user = await runAuthGate({ auth, root: view, notice: link.kind === 'error' ? { kind: 'error', text: link.message } : null });
  }

  // Desde aquí, si la sesión se cierra (en Ajustes, en otra pestaña, o porque el servidor la anuló), se vuelve a la
  // pantalla de acceso recargando: así no queda nada de la cuenta anterior en pantalla.
  const back = () => window.location.replace(`${window.location.pathname}${window.location.search}`);
  auth.onChange((event) => {
    if (event.type === 'signed-out') back();
  });
  const userId = user.id;
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY) return;
    if (event.newValue === null) return back(); // otra pestaña cerró la sesión
    try {
      if (JSON.parse(event.newValue)?.user?.id !== userId) back(); // otra pestaña entró con otra cuenta
    } catch {
      back();
    }
  });

  const account = createAccountApi(auth, user);
  return { user, account, auth, linkKind: link.kind, linkMessage: link.kind === 'error' ? link.message : '' };
}

async function main() {
  // Modo claro / oscuro: desde el primer momento (también en las pantallas de acceso).
  installThemeToggle();
  installPasswordToggles();
  // App de Android: el botón «atrás» cierra ventanas y vuelve atrás en vez de cerrar la app de golpe.
  if (isNativeApp()) installBackButton(/** @type {any} */ (window).Capacitor);
  const view = /** @type {HTMLElement} */ (document.getElementById('view'));
  // Intro del logo (0.18.5): corre mientras la app se prepara; el login o Inicio se dibujan cuando termina.
  const intro = playIntro();
  const session = await signIn(view, intro);
  const databaseName = session ? resolveDatabaseName(localStorageOrNull(), session.user.id) : undefined;

  const local = await openDataStore(databaseName);
  // Copia en la nube (0.15.0): solo con cuenta. Apagada, el almacén guarda exactamente igual que siempre.
  // Tasa de referencia automática (0.18.6): la función exchange-rates de Supabase. Sin cuentas no hay a quién preguntar.
  if (session) setRatesClient(createRatesClient({ url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, storage: localStorageOrNull() }));
  const cloud = session
    ? createCloudStore({
      url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY,
      getAccessToken: () => session.auth.getAccessToken(), getUserId: () => session.user.id,
    })
    : null;
  const sync = session && cloud
    ? createSyncController({ cloud, local, storage: localStorageOrNull(), userId: session.user.id })
    : null;
  // «Sobre ti» (0.18.4): respuestas opcionales de bienvenida, en una tabla que solo ve tu cuenta.
  /** @type {import('./views/aboutYouPanel.js').AboutYouApi | null} */
  const aboutYou = session && cloud
    ? { get: () => cloud.getAboutYou(), save: (about) => cloud.saveAboutYou(about), storage: localStorageOrNull(), userId: session.user.id }
    : null;
  const account = session && sync
    ? {
      ...session.account,
      sync: sync.api,
      aboutYou,
      // Al eliminar la cuenta, el servidor borra sus datos de la nube; aquí se olvida lo pendiente de enviar.
      deleteAccount: async () => {
        const result = await session.account.deleteAccount();
        if (result.ok) sync.api.forget();
        return result;
      },
    }
    : null;
  const store = createStore(sync ? sync.store : local, undefined, { userId: session ? session.user.id : null });
  // El recorrido guiado se recuerda por cuenta (y por tipo de espacio) en este dispositivo.
  const tourMemory = createTourMemory(localStorageOrNull(), session ? session.user.id : LOCAL_ACCOUNT);
  // Copia automática diaria (0.18.2): por cuenta; en la app de Android, en Documentos/ACCONTROL; en el navegador, en su memoria.
  const autoBackup = createAutoBackup({
    store,
    owner: databaseName ?? 'accontrol',
    target: isNativeApp() ? nativeTarget(/** @type {any} */ (window).Capacitor) : browserTarget(),
    storage: localStorageOrNull(),
  });
  await intro; // con sesión abierta, Inicio entra con su animación justo cuando se va la intro
  startApp(store, { account, tourMemory, autoBackup });
  await store.init();
  autoBackup.start();
  const tellOtherTabs = keepTabsInSync(store, databaseName ?? 'accontrol');
  protectStorageWhenThereIsData(store);
  if (session) adoptAccountName(store, session.user);
  if (session?.linkKind === 'signed-in') toast('Correo confirmado: ya estás dentro.');
  // Un enlace rechazado con la sesión ya abierta (por ejemplo, de otra cuenta): se dice por qué no se usó.
  if (session?.linkKind === 'error' && session.linkMessage) toast(session.linkMessage, 'error');
  if (sync) {
    // Lo que llega de otros dispositivos: se vuelve a leer lo guardado (la pantalla se actualiza sola) y, si hubo
    // conflictos o espacios que llegaron o se quitaron, se dice.
    sync.api.onRemote((result) => {
      void store.refresh();
      tellOtherTabs();
      const text = remoteNotice(result);
      if (text) toast(text);
    });
    // Al volver a la app (por ejemplo, el teléfono despierta), se revisa la nube.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sync.api.syncNow();
    });
  }
  sync?.start();
  if (sync && session) {
    void (async () => {
      // Dispositivo nuevo sin espacios y la cuenta ya tiene datos en la nube: se ofrece traerlos antes de empezar de cero.
      const offered = await offerCloudRestore(sync.api, store, session.user.email).catch((error) => {
        console.error('No se pudo ofrecer traer los datos de la nube:', error);
        return 'none';
      });
      // Si dijo «Empezar de cero aquí», ya decidió: no se le vuelve a preguntar por la nube.
      if (offered === 'declined') sync.api.markAsked();
      // Primero «Sobre ti» (0.18.4) y después «¿Guardar tus datos en la nube?»: cada una una sola vez, sin
      // interrumpir el recorrido guiado ni otra ventana (se reintenta cada 20 s).
      const ready = () => store.getState().activeWorkspaceId !== null && !document.body.classList.contains('is-touring');
      const tryAskCloud = async () => {
        if ((await askAboutCloudOnce(sync.api, ready)) === 'later') setTimeout(tryAskCloud, 20_000);
      };
      const tryAskAboutYou = async () => {
        const asked = await askAboutYouOnce(aboutYou, ready).catch((error) => {
          console.error('No se pudo preguntar «Sobre ti»:', error);
          return 'done';
        });
        if (asked === 'later') setTimeout(tryAskAboutYou, 20_000);
        else setTimeout(tryAskCloud, 1500);
      };
      setTimeout(tryAskAboutYou, 4000);
    })();
  }
  registerServiceWorker();
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('Error no controlado:', event.reason);
  toast('Ocurrió un error inesperado. Si algo no se guardó, vuelve a intentarlo.', 'error');
});

main().catch((error) => {
  console.error(error);
  const view = document.getElementById('view');
  if (view) view.textContent = 'ACCONTROL no pudo arrancar. Recarga la página; si continúa, revisa la consola del navegador.';
});
