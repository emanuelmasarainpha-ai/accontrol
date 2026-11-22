// @ts-check
// =============================================================================
// ARRANQUE DE LA INTERFAZ
// -----------------------------------------------------------------------------
// Une las piezas:  datos (store)  +  ruta actual  ->  pantalla.
//
// Cada pantalla es una función  (store, ctx) => { html, mount? }
//   html   plantilla segura con el contenido
//   mount  (opcional) conecta eventos y gráficos una vez que el HTML está en
//          pantalla; devuelve una función de limpieza
// Cuando cambian los datos o la ruta, se vuelve a dibujar la pantalla actual.
// =============================================================================

import { renderAchievements } from '../views/achievements.js';
import { renderAi } from '../views/ai.js';
import { renderClients } from '../views/clients.js';
import { renderHealth } from '../views/health.js';
import { renderInventory } from '../views/inventory.js';
import { renderDepartments } from '../views/departments.js';
import { renderInvoices } from '../views/invoices.js';
import { renderFiado } from '../views/fiado.js';
import { renderPos } from '../views/pos.js';
import { renderResults } from '../views/results.js';
import { renderDebts } from '../views/debts.js';
import { renderFinances } from '../views/finances.js';
import { renderGoals } from '../views/goals.js';
import { renderHome } from '../views/home.js';
import { renderCalculators } from '../views/calculators.js';
import { renderDiagnosis } from '../views/diagnosis.js';
import { renderNetWorth } from '../views/networth.js';
import { renderOnboarding } from '../views/onboarding.js';
import { renderSettings } from '../views/settings.js';
import { renderStats } from '../views/stats.js';
import { updateWorkspaceSwitchers } from '../views/workspaces.js';
import { $, $$, actionTarget } from '../ui/dom.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { countUp } from '../ui/countUp.js';
import { hideTip } from '../ui/tooltip.js';
import {
  ACTION_MODULE, canEditData, canManageWorkspace, EDIT_ACTION_KIND, isMine, lockedTokens, noPermissionMessage, NOT_YOURS_MESSAGE, OWNER_ACTIONS,
  OWNER_ONLY_MESSAGE, permissionsOf, readOnlyMessage, roleLabel,
} from '../domain/roles.js';
import { atLeast, MODULE_IDS } from '../domain/permissions.js';
import { todayISO } from '../domain/dates.js';
import { canUse, limitReached, ROUTE_FEATURE } from '../domain/plans.js';
import { lockedScreen, openUpgrade } from '../views/plans.js';
import { currentPlan, onPlanChange } from './plan.js';
import { toast } from '../ui/toast.js';
import { runCommonAction } from './actions.js';
import { ROUTES, routeById, routeFromHash, routeParams } from './router.js';
import { watchCelebrations } from './celebrations.js';
import { createTourController } from './tourController.js';
import { createTourMemory, LOCAL_ACCOUNT } from './tourMemory.js';

/** @typedef {ReturnType<typeof import('./store.js').createStore>} Store */

/**
 * La cuenta con la sesión abierta, tal como la ven las pantallas (no saben nada del servidor de cuentas).
 * @typedef {Object} AccountApi
 * @property {string} email
 * @property {() => Promise<void>} signOut                       Cierra la sesión (la página se recarga sola y vuelve a pedir el acceso).
 * @property {(input: { currentPassword: string, newPassword: string }) => Promise<{ ok: true } | { ok: false, error: string, field?: string }>} changePassword
 *   Pide la contraseña actual (el servidor también la comprueba). `field`: 'currentPassword' | 'password' si el error es de un campo.
 * @property {() => Promise<{ ok: true } | { ok: false, error: string }>} deleteAccount
 * @property {import('../sync/syncController.js').SyncApi | null} [sync]  Copia en la nube (0.15.0); null o ausente sin cuentas.
 * @property {import('../views/aboutYouPanel.js').AboutYouApi | null} [aboutYou]  Sobre ti (0.18.4): las respuestas de bienvenida en la nube.
 */

/**
 * @typedef {Object} ViewContext
 * @property {() => void} rerender  Vuelve a dibujar la pantalla actual (después de cambiar el estado propio de la pantalla).
 * @property {string[]} params      Lo que viene después de la pantalla en la dirección: "#/deudas/abc" -> ["abc"].
 * @property {AccountApi | null} account  La cuenta con sesión abierta; null si la app corre sin cuentas (modo local).
 * @property {{ available: () => boolean, start: () => void }} tour  Recorrido guiado del espacio abierto (botón de Ajustes).
 * @property {import('./autoBackup.js').AutoBackup | null} autoBackup  Copia automática diaria (0.18.2); null en pruebas.
 */

/**
 * @typedef {Object} RenderedView
 * @property {import('../ui/html.js').SafeHtml} html
 * @property {(root: HTMLElement, signal: AbortSignal) => (void | (() => void))} [mount]
 */

/** @type {Record<string, (store: Store, ctx: ViewContext) => RenderedView>} */
const VIEWS = {
  inicio: renderHome,
  logros: renderAchievements,
  finanzas: renderFinances,
  clientes: renderClients,
  resultados: renderResults,
  salud: renderHealth,
  inventario: renderInventory,
  facturas: renderInvoices,
  fiado: renderFiado,
  caja: renderPos,
  departamentos: renderDepartments,
  deudas: renderDebts,
  patrimonio: renderNetWorth,
  calculadoras: renderCalculators,
  diagnostico: renderDiagnosis,
  metas: renderGoals,
  estadisticas: renderStats,
  ia: renderAi,
  ajustes: renderSettings,
};

const APP_NAME = 'ACCONTROL';

/**
 * @param {Store} store
 * @param {{ account?: AccountApi | null, tourMemory?: import('./tourMemory.js').TourMemory, autoBackup?: import('./autoBackup.js').AutoBackup | null }} [options]
 *   tourMemory: dónde se recuerda si ya se vio el recorrido (por cuenta); sin él, solo mientras la página esté abierta.
 */
export function startApp(store, { account = null, tourMemory = createTourMemory(null, LOCAL_ACCOUNT), autoBackup = null } = {}) {
  const view = $('#view');
  drawChrome();
  const tours = createTourController({ store, memory: tourMemory });
  const tour = { available: tours.available, start: tours.startActive };
  watchCelebrations(store);

  /** @type {AbortController} */
  let controller = new AbortController();
  /** @type {(() => void) | void} */
  let cleanup;
  let lastRoute = '';
  /** Detiene la cuenta de los montos y deja su valor exacto. */
  let stopCounting = () => {};

  /** @param {boolean} routeChanged */
  function render(routeChanged) {
    const state = store.getState();
    const routeId = routeFromHash(window.location.hash);
    const route = routeById(routeId);

    // Soltar lo de la pantalla anterior (eventos, observadores de tamaño, globos).
    controller.abort();
    controller = new AbortController();
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;
    stopCounting();
    stopCounting = () => {};
    hideTip();

    // Sin ningún espacio de trabajo (primera vez, navegador nuevo o tras borrar todo) se muestra la pantalla de elegir
    // modalidad a pantalla completa: sin menús, porque todavía no hay nada que navegar.
    const onboarding = state.status === 'ready' && state.activeWorkspaceId === null;
    document.body.classList.toggle('is-onboarding', onboarding);
    updateWorkspaceSwitchers(state);
    // Roles (0.16.0): marcas para los estilos de src/styles/roles.css, que esconden lo que tu rol no permite.
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null;
    const readOnly = !onboarding && activeWs !== null && !canEditData(activeWs);
    document.documentElement.toggleAttribute('data-read-only', readOnly);
    document.documentElement.toggleAttribute('data-not-owner', !onboarding && activeWs !== null && !canManageWorkspace(activeWs));
    // Roles a medida (0.16.1): lo que tu rol no permite en cada módulo («assets:create»…), para los mismos estilos.
    const locks = !onboarding && activeWs ? lockedTokens(activeWs).join(' ') : '';
    if (locks) document.documentElement.setAttribute('data-locked', locks);
    else document.documentElement.removeAttribute('data-locked');
    paintWorkspaceKind(state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.kind ?? null);

    markActiveRoute(routeId);
    // La caja (0.17.1) ocupa toda la pantalla: sin menú lateral, barra superior, pestañas ni botón flotante.
    document.documentElement.toggleAttribute('data-pos', !onboarding && routeId === 'caja');
    document.title = onboarding ? `Bienvenido · ${APP_NAME}` : `${route.label} · ${APP_NAME}`;

    if (state.status === 'loading') {
      setHtml(view, html`<p class="loading" role="status">Cargando tus datos…</p>`);
      return;
    }
    if (state.status === 'error') {
      setHtml(view, loadErrorView(state.error));
      return;
    }

    const scrollY = window.scrollY;
    // Marcas solo para los estilos: qué pantalla es y si se acaba de LLEGAR a ella (la entrada animada se ve al
    // cambiar de pantalla, no cada vez que se guarda un dato y la pantalla se vuelve a dibujar).
    view.dataset.screen = onboarding ? 'bienvenida' : routeId;
    if (routeChanged || routeId !== lastRoute) view.dataset.enter = '';
    else delete view.dataset.enter;
    const context = { rerender: () => render(false), params: routeParams(window.location.hash), account, tour, autoBackup };
    // Planes (0.20.0): una pantalla que tu plan no trae se cambia por la del candado (dentro de un espacio de Negocio, todo abierto).
    const lockedFeature = onboarding ? undefined : ROUTE_FEATURE[routeId];
    const rendered = onboarding
      ? renderOnboarding(store, context)
      : lockedFeature && !canUse(currentPlan(), lockedFeature, activeWs?.kind ?? null)
        ? lockedScreen(lockedFeature, route.label)
        : VIEWS[routeId](store, context);
    setHtml(view, readOnly && activeWs ? html`${roleBanner(activeWs)}${rendered.html}` : rendered.html);
    cleanup = rendered.mount?.(view, controller.signal);
    revealActiveSubtab();
    // Los montos grandes «cuentan» al llegar a la pantalla (no al guardar; nunca durante el recorrido guiado).
    if ('enter' in view.dataset && !document.body.classList.contains('is-touring')) stopCounting = countUp(view);
    if (!onboarding) tours.maybeOffer();

    if (routeChanged || routeId !== lastRoute) {
      window.scrollTo(0, 0);
      view.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, scrollY);
    }
    lastRoute = routeId;
  }

  window.addEventListener('hashchange', () => render(true));
  store.subscribe(() => render(false));
  // Si la nube dice otro plan (por ejemplo, al volver a la app), la pantalla se vuelve a dibujar.
  onPlanChange(() => render(false));

  // Roles (0.16.0): un botón que tu rol no permite no hace nada más que explicar por qué. Se escucha en la fase de
  // «captura» (antes que la pantalla), así ningún formulario llega a abrirse. Es la segunda defensa: los botones ya
  // están escondidos, y el almacén tampoco guardaría.
  document.addEventListener('click', (event) => {
    const element = actionTarget(event.target);
    const name = element?.dataset.action;
    if (!name) return;
    const active = store.activeWorkspace();
    const blocked = OWNER_ACTIONS.includes(name) && !canManageWorkspace(active) ? OWNER_ONLY_MESSAGE : writeRefusal(store, name, element);
    if (blocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast(blocked, 'info');
      return;
    }
    // Planes (0.20.0): lo que tu plan no trae abre el aviso con los planes en vez del formulario.
    const upgrade = planRefusal(store, name);
    if (!upgrade) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Si venía del menú «Añadir», ese menú se cierra: el aviso queda solo.
    const menu = element.closest('dialog');
    if (menu instanceof HTMLDialogElement) menu.close();
    openUpgrade(upgrade);
  }, { capture: true });

  // Un solo oyente para los botones comunes (añadir, editar, demostración...),
  // estén en la pantalla, en el menú lateral o en el botón flotante.
  document.addEventListener('click', (event) => {
    const element = actionTarget(event.target);
    if (!element || element.closest('dialog')) return;
    const name = element.dataset.action;
    if (name && runCommonAction(store, name, element)) event.preventDefault();
  });

  render(true);
}

/**
 * ¿Te deja tu rol usar este botón de escritura? (0.16.1) Devuelve el motivo si no, o null. Sin permiso de «Registrar» en
 * su módulo, nada; con solo «Registrar», los que cambian algo que ya existe solo valen para lo que creaste tú.
 * @param {Store} store @param {string} name @param {HTMLElement} element @returns {string | null}
 */
function writeRefusal(store, name, element) {
  const module = ACTION_MODULE[name];
  if (!module) return null;
  const active = store.activeWorkspace();
  if (!canEditData(active)) return readOnlyMessage(active);
  const perms = permissionsOf(active);
  const allowed = module === 'all' ? MODULE_IDS.every((m) => atLeast(perms[m], 'create')) : atLeast(perms[module], 'create');
  if (!allowed) return noPermissionMessage(active, module);
  const kind = EDIT_ACTION_KIND[name];
  if (kind && module !== 'all' && perms[module] === 'create') {
    const record = (/** @type {any} */ (store.getState().data))[kind]?.find((/** @type {any} */ r) => r.id === element.dataset.id);
    if (record && !isMine(record, store.me())) return NOT_YOURS_MESSAGE;
  }
  return null;
}

/**
 * ¿Trae tu plan lo que pide este botón? (0.20.0) Devuelve por qué no, o null. Las copias de seguridad nunca se bloquean.
 * @param {Store} store @param {string} name
 * @returns {{ feature: import('../domain/plans.js').Feature } | { limit: 'goals' | 'debts' } | null}
 */
export function planRefusal(store, name) {
  const plan = currentPlan();
  const kind = store.activeWorkspace()?.kind ?? null;
  if (name === 'export' && !canUse(plan, 'reports', kind)) return { feature: 'reports' };
  if (name === 'new-asset' && !canUse(plan, 'netWorth', kind)) return { feature: 'netWorth' };
  const { data } = store.getState();
  if (name === 'new-goal' && limitReached(plan, 'goals', data, todayISO(new Date()), kind)) return { limit: 'goals' };
  if (name === 'new-debt' && limitReached(plan, 'debts', data, todayISO(new Date()), kind)) return { limit: 'debts' };
  return null;
}

/**
 * Aviso arriba de cada pantalla cuando el espacio abierto es de solo lectura para ti (Contador).
 * @param {import('../domain/types.js').Workspace} workspace
 */
function roleBanner(workspace) {
  return html`<div class="banner banner--role" role="note" data-role-banner>
    <p class="banner__text"><strong>Solo lectura.</strong> Estás en «${workspace.name}» como ${roleLabel(workspace)}: puedes ver todo y descargar reportes, pero no registrar ni cambiar nada.</p>
  </div>`;
}

/**
 * Las pestañas de Finanzas se deslizan en pantallas angostas: deja a la vista la que está abierta
 * (solo mueve la fila de pestañas, nunca la página).
 */
function revealActiveSubtab() {
  const bar = document.querySelector('.subtabs');
  const current = bar?.querySelector('[aria-current="page"]');
  if (!(bar instanceof HTMLElement) || !(current instanceof HTMLElement) || bar.scrollWidth <= bar.clientWidth) return;
  bar.scrollLeft = Math.max(0, current.offsetLeft - (bar.clientWidth - current.offsetWidth) / 2);
}

/** Dibuja los íconos y enlaces del menú (una sola vez). */
function drawChrome() {
  const side = $('#nav-side');
  const tabs = $('#nav-tabs');

  setHtml(
    side,
    html`${ROUTES.filter((r) => !r.secondary && !r.hidden).map(
      (r) => html`<li><a class="nav__link" href="#/${r.id}" data-route="${r.id}">${icon(r.icon, 20)}<span>${r.label}</span></a></li>`,
    )}`,
  );
  setHtml(
    tabs,
    html`${ROUTES.filter((r) => !r.secondary && !r.hidden).map(
      (r) => html`<li><a class="tab" href="#/${r.id}" data-route="${r.id}">${icon(r.icon, 22)}<span>${r.short}</span></a></li>`,
    )}`,
  );
  for (const host of $$('[data-icon]')) {
    const name = host.getAttribute('data-icon') ?? 'info';
    const size = Number(host.getAttribute('data-icon-size') ?? 20);
    setHtml(host, icon(name, size));
  }
}

/**
 * El color del espacio abierto (cada tipo es una «denominación», tokens.css): lo usan la barra, los botones
 * principales y «el billete» de Inicio. También tiñe la barra del navegador en el celular.
 * @param {string | null} kind
 */
function paintWorkspaceKind(kind) {
  if (document.body.dataset.kind === (kind ?? undefined)) return;
  if (kind) document.body.dataset.kind = kind;
  else delete document.body.dataset.kind;
  const deep = getComputedStyle(document.body).getPropertyValue('--kind-deep').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && deep) meta.setAttribute('content', deep);
}

/** @param {string} routeId */
function markActiveRoute(routeId) {
  // Una subpantalla (Deudas) marca como activa a su pantalla madre del menú (Finanzas).
  const menuId = routeById(routeId).parent ?? routeId;
  for (const link of $$('a[data-route]')) {
    if (link.getAttribute('data-route') === menuId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/** @param {string} message */
function loadErrorView(message) {
  return html`<section class="panel panel--error" role="alert">
    <h1 class="page-title">No se pudieron abrir tus datos</h1>
    <p>ACCONTROL guarda tus datos en este navegador, pero ahora no puede acceder a ese almacenamiento.</p>
    <p class="muted">Motivo técnico: ${message}</p>
    <ul class="plain-list">
      <li>Si estás en una ventana privada o de incógnito, abre ACCONTROL en una ventana normal.</li>
      <li>Revisa que el navegador permita guardar datos de sitios y que haya espacio libre.</li>
      <li>Tus datos anteriores no se han borrado: esto solo impide verlos por ahora.</li>
    </ul>
    <button type="button" class="btn btn--primary" data-action="reload">Reintentar</button>
  </section>`;
}
