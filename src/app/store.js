// @ts-check
// =============================================================================
// EL ESTADO DE LA APLICACIÓN (el "cerebro")
// -----------------------------------------------------------------------------
// Aquí se juntan las tres capas:
//   domain/  -> valida y calcula
//   data/    -> guarda
//   views/   -> muestra (las pantallas LEEN de aquí y llaman a estas acciones)
//
// REGLA DE SEGURIDAD DE DATOS: primero se GUARDA en el almacén y solo si el
// guardado tuvo éxito se actualiza lo que ve el usuario. Así la pantalla nunca
// muestra como guardado algo que no lo está.
//
// Las acciones se ejecutan una detrás de otra (cola), para que dos clics rápidos
// no se pisen entre sí.
//
// Cada acción devuelve { ok: true, ... } o { ok: false, errors } con mensajes
// listos para mostrar al usuario.
// =============================================================================

import { normalizeValuations, validateAsset, validateValuation } from '../domain/assets.js';
import { missingBusinessCategories, resultsEnabled } from '../domain/business.js';
import { healthEnabled } from '../domain/company.js';
import { diagnosisEnabled } from '../domain/diagnosis.js';
import { applyClientEdit, applyServiceEdit, buildClient, buildService, clientsEnabled, clientUsage, isServiceStatus, validateClient, validateService } from '../domain/clients.js';
import { backupFileName, createBackup, createFullBackup, fullBackupFileName, parseAnyBackup } from '../domain/backup.js';
import { defaultCategories, ensureDebtCategory, validateCategoryName } from '../domain/categories.js';
import { currentTime, todayISO } from '../domain/dates.js';
import { buildBusinessDemo, buildCompanyDemo, buildDemoData, buildDepartmentDemo, buildFreelancerDemo, buildFreelancerInvoiceDemo, buildInventoryDemo, buildInvoiceDemo } from '../domain/demo.js';
import { applyDepartmentEdit, buildDepartment, departmentsEnabled, departmentUsage, validateDepartment } from '../domain/departments.js';
import { paymentMovementFields, paymentsFitDebt, validateDebt, validatePayment } from '../domain/debts.js';
import { goalSavedCents, validateContribution, validateGoal } from '../domain/goals.js';
import {
  applyProductEdit, applySupplierEdit, buildProduct, buildStockEntry, buildStockMovement, buildSupplier, deletionProblem, inventoryEnabled,
  productUsage, supplierUsage, validateProduct, validateStockEntry, validateSupplier,
} from '../domain/inventory.js';
import {
  buildInvoice, buildInvoicePayment, buildPaymentMovement, invoiceLabel, invoicesEnabled, nextInvoiceNumber, stockEntriesFromLines,
  billedByService, validateInvoice, validateInvoiceEdit, validateInvoicePayment, voidProblem,
} from '../domain/invoices.js';
import { formatMoney } from '../domain/money.js';
import { newId } from '../domain/ids.js';
import { isOrganizationEmpty, kindHasOrganization, validateOrganization } from '../domain/organization.js';
import { applyMovementEdit, buildMovement, validateMovement } from '../domain/movements.js';
import { defaultSettings, validateSettings } from '../domain/settings.js';
import { overallTotals } from '../domain/summaries.js';
import { CLASSIFICATIONS_BY_TYPE, LIMITS } from '../domain/types.js';
import {
  buildWorkspace, defaultProfile, isWorkspaceKind, pickActiveWorkspace, validateWorkspaceName, withDefault,
} from '../domain/workspaces.js';
import { canEditData, canManageWorkspace, NOT_YOURS_TO_DELETE, OWNER_ONLY_MESSAGE, READ_ONLY_MESSAGE, roleOf } from '../domain/roles.js';
import { singleWorkspace } from '../data/singleWorkspace.js';
import { WORKSPACE_ERRORS } from '../data/workspaceScope.js';

/** @typedef {import('../domain/types.js').AppData} AppData */
/** @typedef {import('../domain/types.js').Movement} Movement */
/** @typedef {import('../domain/types.js').Goal} Goal */
/** @typedef {import('../domain/types.js').Contribution} Contribution */
/** @typedef {import('../domain/types.js').Category} Category */
/** @typedef {import('../domain/types.js').Asset} Asset */
/** @typedef {import('../domain/types.js').Client} Client */
/** @typedef {import('../domain/types.js').Service} Service */
/** @typedef {import('../domain/types.js').Product} Product */
/** @typedef {import('../domain/types.js').Supplier} Supplier */
/** @typedef {import('../domain/types.js').StockEntry} StockEntry */
/** @typedef {import('../domain/types.js').Invoice} Invoice */
/** @typedef {import('../domain/types.js').InvoicePayment} InvoicePayment */
/** @typedef {import('../domain/types.js').Department} Department */
/** @typedef {import('../domain/types.js').Debt} Debt */
/** @typedef {import('../domain/types.js').DebtPayment} DebtPayment */
/** @typedef {import('../domain/types.js').Workspace} Workspace */
/** @typedef {import('../domain/types.js').Profile} Profile */
/** @typedef {import('../data/dataStore.js').DataStore} DataStore */
/** @typedef {import('../data/workspaceStore.js').WorkspaceStore} WorkspaceStore */

/**
 * @typedef {Object} AppState
 * @property {'loading' | 'ready' | 'error'} status
 * @property {string} error  Mensaje cuando status = 'error'.
 * @property {AppData} data  Los datos del espacio de trabajo ABIERTO (todo lo demás de la app trabaja sobre esto).
 * @property {Workspace[]} workspaces  Todos los espacios, del más antiguo al más nuevo. Vacío = primera vez: hay que elegir modalidad.
 * @property {string | null} activeWorkspaceId  El espacio abierto en ESTA pestaña (null mientras no haya ninguno).
 * @property {Profile} profile
 */

/**
 * @typedef {{ ok: false, errors: Record<string, string>, needsFunds?: { availableCents: number, shortfallCents: number } }} Failure
 * `needsFunds`: el aporte supera el dinero disponible; la pantalla debe preguntar de dónde sale la diferencia.
 */

/** @returns {AppData} */
function emptyData() {
  return { categories: [], movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], settings: defaultSettings() };
}

const SAVE_FAILED =
  'No se pudo guardar en este dispositivo. Tus datos no cambiaron. Si el problema continúa, exporta una copia de seguridad.';

/** Fallos que tienen una explicación propia (en vez del mensaje general de «no se pudo guardar»). */
/** Lo lanza el candado de solo lectura (Contador) cuando algo intenta guardar en su espacio. */
const READ_ONLY_ERROR = 'accontrol:espacio-de-solo-lectura';

const KNOWN_PROBLEMS = new Map([
  [READ_ONLY_ERROR, READ_ONLY_MESSAGE],
  [WORKSPACE_ERRORS.collision, 'Esta copia trae registros que ya existen en otro de tus espacios y no se pueden mezclar. Impórtala en el espacio donde se creó, o usa una copia completa.'],
  [WORKSPACE_ERRORS.gone, 'Este espacio de trabajo ya no existe (quizá se borró en otra pestaña). Cambia de espacio e inténtalo de nuevo.'],
]);

const MOVED = 'El espacio en el que estabas ya no existe (se borró en otra pestaña). Se abrió otro: revisa y repite la operación.';

/** Almacén de relleno mientras no hay ningún espacio abierto: no guarda nada y lo dice. @type {DataStore} */
const NO_WORKSPACE = {
  load: () => Promise.resolve(emptyData()),
  putMany: () => Promise.reject(new Error('No hay un espacio de trabajo abierto.')),
  deleteMany: () => Promise.reject(new Error('No hay un espacio de trabajo abierto.')),
  saveSettings: () => Promise.reject(new Error('No hay un espacio de trabajo abierto.')),
  replaceAll: () => Promise.reject(new Error('No hay un espacio de trabajo abierto.')),
  clearAll: () => Promise.reject(new Error('No hay un espacio de trabajo abierto.')),
};

/**
 * Categorías de fábrica que faltan en una lista (por id, o con el mismo nombre y tipo).
 * @param {Category[]} existing
 * @returns {Category[]}
 */
function missingBuiltInCategories(existing) {
  const norm = (/** @type {string} */ name) => name.trim().toLocaleLowerCase('es');
  return defaultCategories().filter(
    (b) => !existing.some((c) => c.id === b.id || (c.kind === b.kind && norm(c.name) === norm(b.name))),
  );
}

const LINKED_TO_STOCK =
  'Este movimiento viene de una compra o una venta de inventario. Cámbialo o bórralo desde Inventario para que el stock siga cuadrando.';

const LINKED_TO_INVOICE =
  'Este ingreso es el cobro de una factura. Edítalo o bórralo desde Facturas para que el saldo de la factura siga cuadrando.';

const STOCK_FROM_INVOICE =
  'Esta salida de inventario viene de una factura. Para devolverla al stock, anula la factura desde Facturas.';

const LINKED_TO_DEBT =
  'Este gasto es el pago de una deuda. Edítalo o bórralo desde Deudas para que el saldo de la deuda siga cuadrando.';

/** @param {string} message @returns {Failure} */
const formFail = (message) => ({ ok: false, errors: { form: message } });

/**
 * @param {WorkspaceStore | DataStore} source  El almacén de espacios de trabajo. (Un almacén suelto también vale:
 *   se trata como una app con un solo espacio. Así se prueban las acciones sin montar espacios.)
 * @param {() => Date} [clock]  Reloj (se puede reemplazar en las pruebas).
 */
export function createStore(source, clock = () => new Date()) {
  /** @type {WorkspaceStore} */
  const root = 'forWorkspace' in source ? source : singleWorkspace(source);
  /** El almacén del espacio abierto: cambia cuando la persona cambia de espacio. @type {DataStore} */
  let dataStore = NO_WORKSPACE;
  /** @type {AppState} */
  let state = { status: 'loading', error: '', data: emptyData(), workspaces: [], activeWorkspaceId: null, profile: defaultProfile() };
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {Set<() => void>} Avisan cada vez que algo se guardó (para sincronizar otras pestañas). */
  const writeListeners = new Set();
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  const today = () => todayISO(clock());
  const nowISO = () => clock().toISOString();

  function emit() {
    for (const listener of listeners) listener();
  }

  /**
   * Abre el almacén de un espacio con el CANDADO de roles: si en ese espacio eres Contador, ningún guardado llega al
   * dispositivo (ni, por tanto, a la nube). El rol se mira en el momento de guardar, así que un cambio de rol que llega
   * de la nube se respeta sin volver a abrir el espacio. Leer siempre se puede.
   * @param {string} id @returns {DataStore}
   */
  function openStore(id) {
    const inner = root.forWorkspace(id);
    const locked = () => !canEditData(state.workspaces.find((w) => w.id === id));
    /** @template {any[]} A @template R @param {(...args: A) => Promise<R>} fn */
    const guard = (fn) => (/** @type {A} */ ...args) => (locked() ? Promise.reject(new Error(READ_ONLY_ERROR)) : fn(...args));
    return {
      load: () => inner.load(),
      putMany: guard((changes, deletions) => inner.putMany(changes, deletions)),
      deleteMany: guard((deletions) => inner.deleteMany(deletions)),
      saveSettings: guard((settings) => inner.saveSettings(settings)),
      replaceAll: guard((data) => inner.replaceAll(data)),
      clearAll: guard(() => inner.clearAll()),
    };
  }

  /** @param {(data: AppData) => AppData} change */
  function updateData(change) {
    state = { ...state, data: change(state.data) };
    emit();
  }

  /**
   * Ejecuta una acción en cola.
   * @template T
   * @param {() => Promise<T>} job
   * @returns {Promise<T>}
   */
  function enqueue(job) {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Intenta guardar; si falla, devuelve el mensaje de error en lugar de lanzar.
   * @param {() => Promise<void>} write
   * @returns {Promise<Failure | null>}
   */
  async function tryWrite(write) {
    try {
      await write();
      for (const listener of writeListeners) listener();
      return null;
    } catch (error) {
      console.error('Error de almacenamiento:', error);
      return formFail((error instanceof Error && KNOWN_PROBLEMS.get(error.message)) || SAVE_FAILED);
    }
  }

  /** @template T @param {T[]} list @param {T & {id: string}} item */
  const upsert = (list, item) =>
    list.some((x) => /** @type {any} */ (x).id === item.id)
      ? list.map((x) => (/** @type {any} */ (x).id === item.id ? item : x))
      : [...list, item];

  /**
   * Vuelve a leer lo guardado. `lenient`: para las acciones que administran espacios (cambiar, crear, borrar...),
   * a las que no les afecta que el espacio abierto haya cambiado. Se usa antes de las acciones que protegen el dinero (aportes,
   * borrar metas...) porque OTRA pestaña o ventana pudo haber cambiado los datos mientras tanto,
   * y validar contra una copia vieja podría dejar una meta en saldo negativo.
   * @returns {Promise<Failure | null>}
   */
  async function reloadFromStorage({ lenient = false } = {}) {
    try {
      const [workspaces, profile] = await Promise.all([root.listWorkspaces(), root.getProfile()]);
      let activeId = state.activeWorkspaceId;
      // El espacio abierto pudo borrarse en otra pestaña (o, sin espacios, otra pestaña pudo crear el primero).
      if (!activeId || !workspaces.some((w) => w.id === activeId)) activeId = pickActiveWorkspace(workspaces, profile)?.id ?? null;
      const store = activeId ? (activeId === state.activeWorkspaceId ? dataStore : openStore(activeId)) : NO_WORKSPACE;
      const data = activeId ? await store.load() : emptyData();
      const next = { status: /** @type {const} */ ('ready'), error: '', data, workspaces, activeWorkspaceId: activeId, profile };
      const seen = (/** @type {AppState} */ x) => JSON.stringify([x.data, x.workspaces, x.activeWorkspaceId, x.profile.displayName]);
      const moved = state.status === 'ready' && state.activeWorkspaceId !== null && activeId !== state.activeWorkspaceId;
      dataStore = store;
      if (state.status !== 'ready' || seen(next) !== seen(state)) {
        state = next;
        emit();
      }
      // Una acción sobre los datos que se pidió en un espacio que ya no existe NO se aplica al espacio nuevo en silencio.
      if (moved && !lenient) return formFail(MOVED);
      return null;
    } catch (error) {
      console.error('No se pudo releer el almacenamiento:', error);
      return formFail((error instanceof Error && KNOWN_PROBLEMS.get(error.message)) || SAVE_FAILED);
    }
  }

  /**
   * Abre un espacio de trabajo: carga sus datos y lo deja como el activo (y como «último usado»).
   * Si algo falla, no cambia nada.
   * @param {string} id
   * @returns {Promise<Failure | null>}
   */
  async function activateWorkspace(id) {
    try {
      const store = openStore(id);
      const data = await store.load();
      const [workspaces, saved] = await Promise.all([root.listWorkspaces(), root.getProfile()]);
      const profile = { ...saved, lastWorkspaceId: id };
      try {
        await root.saveProfile(profile);
      } catch (error) {
        console.error('No se pudo guardar el último espacio usado:', error); // no impide cambiar de espacio
      }
      dataStore = store;
      state = { status: 'ready', error: '', data, workspaces, activeWorkspaceId: id, profile };
      emit();
      return null;
    } catch (error) {
      console.error('No se pudo abrir el espacio de trabajo:', error);
      return formFail((error instanceof Error && KNOWN_PROBLEMS.get(error.message)) || SAVE_FAILED);
    }
  }

  /** Modalidad del espacio abierto (null si todavía no hay ninguno). */
  const activeKind = () => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.kind ?? null;

  function hasDemoData() {
    const d = state.data;
    return (
      d.movements.some((m) => m.isDemo) || d.goals.some((g) => g.isDemo) || d.contributions.some((c) => c.isDemo) ||
      d.debts.some((x) => x.isDemo) || d.debtPayments.some((x) => x.isDemo) || d.assets.some((a) => a.isDemo) ||
      d.clients.some((c) => c.isDemo) || d.services.some((x) => x.isDemo) ||
      d.products.some((x) => x.isDemo) || d.suppliers.some((x) => x.isDemo) || d.stockEntries.some((x) => x.isDemo) ||
      d.invoices.some((x) => x.isDemo) || d.invoicePayments.some((x) => x.isDemo) || d.departments.some((x) => x.isDemo)
    );
  }

  return {
    getState: () => state,

    /** ¿Se muestran los clientes en el espacio abierto? (siempre en Freelancer; en otros, solo si ya hay clientes). */
    clientsEnabled: () => clientsEnabled(activeKind(), state.data),

    /** ¿Se muestra Resultados (estado de resultados, indicadores, proyección) en el espacio abierto? Emprendedor y Empresa. */
    resultsEnabled: () => resultsEnabled(activeKind()),
    /** ¿Se muestra el inventario (productos, proveedores, compras y ventas)? Emprendedor y Empresa; en otros, solo si ya hay datos. */
    inventoryEnabled: () => inventoryEnabled(activeKind(), state.data),
    /** ¿Se muestran las facturas internas? Emprendedor y Empresa; en otros, solo si ya hay facturas. */
    invoicesEnabled: () => invoicesEnabled(activeKind(), state.data),
    /** ¿Se muestran los departamentos y sus presupuestos? Solo el espacio Empresa; en otros, solo si ya hay departamentos. */
    departmentsEnabled: () => departmentsEnabled(activeKind(), state.data),

    /** ¿Se muestra Salud financiera (punto de equilibrio, meses de efectivo, deuda)? Solo el espacio Empresa. */
    healthEnabled: () => healthEnabled(activeKind()),

    /** ¿Se muestra la pantalla Diagnóstico (indicadores y viabilidad de metas)? Todos los espacios menos Empresa, que tiene Salud financiera. */
    diagnosisEnabled: () => diagnosisEnabled(activeKind()),

    /** @param {() => void} listener @returns {() => void} función para dejar de escuchar */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Avisa cuando algo se guardó en este dispositivo (main.js lo usa para avisar a otras pestañas).
     * @param {() => void} listener @returns {() => void}
     */
    onWrite(listener) {
      writeListeners.add(listener);
      return () => writeListeners.delete(listener);
    },

    /** Relee lo guardado (otra pestaña cambió datos, o la pestaña volvió a primer plano). */
    refresh() {
      // Con flecha: enqueue le pasa a cada tarea el resultado de la anterior, y reloadFromStorage lo tomaría por sus
      // opciones (con `null` fallaba en silencio y la pantalla no se actualizaba con lo bajado de la nube).
      return enqueue(() => reloadFromStorage());
    },

    today,
    /** Fecha y hora actuales según el reloj de la app. */
    now: () => clock(),

    /** Carga los espacios y los datos del que se abre primero. Se llama una vez al arrancar. */
    async init() {
      try {
        const [workspaces, profile] = await Promise.all([root.listWorkspaces(), root.getProfile()]);
        const active = pickActiveWorkspace(workspaces, profile);
        let data = emptyData();
        if (active) {
          dataStore = openStore(active.id);
          data = await dataStore.load();
        }
        state = { status: 'ready', error: '', data, workspaces, activeWorkspaceId: active?.id ?? null, profile };
      } catch (error) {
        dataStore = NO_WORKSPACE;
        console.error(error);
        state = {
          status: 'error',
          error: error instanceof Error ? error.message : 'No se pudieron cargar los datos.',
          data: emptyData(),
          workspaces: [],
          activeWorkspaceId: null,
          profile: defaultProfile(),
        };
      }
      emit();
    },

    // ----------------------------------------------------- espacios de trabajo

    /** El espacio abierto en esta pestaña, o null si todavía no hay ninguno. */
    activeWorkspace: () => state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null,

    /** Tu rol en el espacio abierto (0.16.0): 'owner' si es tuyo. */
    activeRole: () => roleOf(state.workspaces.find((w) => w.id === state.activeWorkspaceId)),
    /** ¿Puedes registrar o cambiar datos en el espacio abierto? (el Contador, no). */
    canEditData: () => canEditData(state.workspaces.find((w) => w.id === state.activeWorkspaceId)),
    /** ¿Eres el dueño del espacio abierto? (solo el dueño cambia su nombre, organización y saldo inicial). */
    canManageWorkspace: () => canManageWorkspace(state.workspaces.find((w) => w.id === state.activeWorkspaceId)),

    /**
     * Crea un espacio de trabajo y lo abre. La primera vez (pantalla de elegir modalidad) también sirve.
     * @param {{ kind: string, name: string }} input
     * @returns {Promise<{ ok: true, workspace: Workspace } | Failure>}
     */
    createWorkspace(input) {
      return enqueue(async () => {
        const stale = await reloadFromStorage({ lenient: true });
        if (stale) return stale;
        if (!isWorkspaceKind(input.kind)) return { ok: false, errors: { kind: 'Elige para qué vas a usar ACCONTROL.' } };
        if (state.workspaces.length >= LIMITS.maxWorkspaces) {
          return formFail(`Puedes tener hasta ${LIMITS.maxWorkspaces} espacios de trabajo.`);
        }
        const named = validateWorkspaceName(input.name, { existing: state.workspaces });
        if (!named.ok) return { ok: false, errors: { name: named.error } };
        const workspace = buildWorkspace(
          { kind: input.kind, name: named.name, isDefault: state.workspaces.length === 0 },
          { id: newId(), nowISO: nowISO() },
        );
        const failure = await tryWrite(() => root.createWorkspace(workspace));
        if (failure) return failure;
        const opened = await activateWorkspace(workspace.id);
        if (opened) return opened;
        return { ok: /** @type {const} */ (true), workspace };
      });
    },

    /**
     * Cambia al espacio indicado (en esta pestaña).
     * @param {string} id
     * @returns {Promise<{ ok: true } | Failure>}
     */
    switchWorkspace(id) {
      return enqueue(async () => {
        if (id === state.activeWorkspaceId) return { ok: /** @type {const} */ (true) };
        const stale = await reloadFromStorage({ lenient: true });
        if (stale) return stale;
        if (!state.workspaces.some((w) => w.id === id)) return formFail('Ese espacio ya no existe.');
        const failure = await activateWorkspace(id);
        return failure ?? { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * @param {string} id @param {string} rawName
     * @returns {Promise<{ ok: true } | Failure>}
     */
    renameWorkspace(id, rawName) {
      return enqueue(async () => {
        const stale = await reloadFromStorage({ lenient: true });
        if (stale) return stale;
        const current = state.workspaces.find((w) => w.id === id);
        if (!current) return formFail('Ese espacio ya no existe.');
        if (!canManageWorkspace(current)) return formFail(OWNER_ONLY_MESSAGE);
        const named = validateWorkspaceName(rawName, { existing: state.workspaces, exceptId: id });
        if (!named.ok) return { ok: false, errors: { name: named.error } };
        const next = { ...current, name: named.name, updatedAt: nowISO() };
        const failure = await tryWrite(() => root.updateWorkspace(next));
        if (failure) return failure;
        state = { ...state, workspaces: state.workspaces.map((w) => (w.id === id ? next : w)) };
        emit();
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Guarda los datos de la organización de un espacio (Freelancer, Emprendedor o Empresa). Todo vacío = borrarlos.
     * @param {string} id @param {unknown} raw
     * @returns {Promise<{ ok: true } | Failure>}
     */
    updateOrganization(id, raw) {
      return enqueue(async () => {
        const stale = await reloadFromStorage({ lenient: true });
        if (stale) return stale;
        const current = state.workspaces.find((w) => w.id === id);
        if (!current) return formFail('Ese espacio ya no existe.');
        if (!canManageWorkspace(current)) return formFail(OWNER_ONLY_MESSAGE);
        if (!kindHasOrganization(current.kind)) return formFail('Un espacio Personal no lleva datos de organización.');
        const checked = validateOrganization(raw);
        if (!checked.ok) return { ok: false, errors: /** @type {Record<string, string>} */ (checked.errors) };
        const { organization: _previous, ...rest } = current;
        const next = { ...rest, ...(isOrganizationEmpty(checked.organization) ? {} : { organization: checked.organization }), updatedAt: nowISO() };
        const failure = await tryWrite(() => root.updateWorkspace(next));
        if (failure) return failure;
        state = { ...state, workspaces: state.workspaces.map((w) => (w.id === id ? next : w)) };
        emit();
        return { ok: /** @type {const} */ (true) };
      });
    },

    /** El espacio que se abre primero si no hay un «último usado». @param {string} id */
    setDefaultWorkspace(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage({ lenient: true });
        if (stale) return stale;
        if (!state.workspaces.some((w) => w.id === id)) return formFail('Ese espacio ya no existe.');
        const failure = await tryWrite(() => root.setDefaultWorkspace(id));
        if (failure) return failure;
        state = { ...state, workspaces: withDefault(state.workspaces, id, nowISO()) };
        emit();
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Borra un espacio y TODOS sus datos. Siempre debe quedar al menos uno.
     * @param {string} id
     */
    deleteWorkspace(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage({ lenient: true });
        if (stale) return stale;
        const target = state.workspaces.find((w) => w.id === id);
        if (!target) return formFail('Ese espacio ya no existe.');
        if (!canManageWorkspace(target)) return formFail(NOT_YOURS_TO_DELETE);
        if (state.workspaces.length <= 1) {
          return formFail('Debes conservar al menos un espacio. Para empezar de cero usa «Borrar todos mis datos» en Ajustes.');
        }
        const failure = await tryWrite(() => root.deleteWorkspace(id));
        if (failure) return failure;
        // Si era el abierto, se abre otro (reloadFromStorage lo elige); si no, solo cambia la lista.
        const reloaded = await reloadFromStorage({ lenient: true });
        if (reloaded) return reloaded;
        return { ok: /** @type {const} */ (true) };
      });
    },

    // ---------------------------------------------------------------- movimientos

    /**
     * Crea o edita un ingreso/gasto.
     * @param {import('../domain/movements.js').MovementInput} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, movement: Movement } | Failure>}
     */
    saveMovement(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const existing = editingId ? data.movements.find((m) => m.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese movimiento ya no existe.');
        if (editingId && data.debtPayments.some((p) => p.movementId === editingId)) return formFail(LINKED_TO_DEBT);
        if (editingId && data.stockEntries.some((e) => e.movementId === editingId)) return formFail(LINKED_TO_STOCK);
        if (editingId && data.invoicePayments.some((p) => p.movementId === editingId)) return formFail(LINKED_TO_INVOICE);

        // El tipo no se puede cambiar al editar.
        const checked = validateMovement(existing ? { ...input, type: existing.type } : input, {
          categories: data.categories,
          today: today(),
          clients: data.clients,
          services: data.services,
          departments: data.departments,
        });
        if (!checked.ok) return checked;
        const value = checked.value;

        /** @type {Category | null} */
        let newCategory = null;
        let categoryId = value.categoryId;
        if (value.newCategoryName) {
          newCategory = {
            id: newId(),
            name: value.newCategoryName,
            kind: value.type,
            defaultClassification: value.classification,
            builtIn: false,
          };
          categoryId = newCategory.id;
        }

        const movement = existing
          ? applyMovementEdit(existing, value, { categoryId, nowISO: nowISO() })
          : buildMovement(value, { id: newId(), categoryId, nowISO: nowISO() });

        const failure = await tryWrite(() =>
          dataStore.putMany({ categories: newCategory ? [newCategory] : [], movements: [movement] }),
        );
        if (failure) return failure;

        updateData((d) => ({
          ...d,
          categories: newCategory ? [...d.categories, newCategory] : d.categories,
          movements: upsert(d.movements, movement),
        }));
        return { ok: true, movement };
      });
    },

    /** @param {string} id */
    deleteMovement(id) {
      return enqueue(async () => {
        if (!state.data.movements.some((m) => m.id === id)) return formFail('Ese movimiento ya no existe.');
        if (state.data.debtPayments.some((p) => p.movementId === id)) return formFail(LINKED_TO_DEBT);
        if (state.data.stockEntries.some((e) => e.movementId === id)) return formFail(LINKED_TO_STOCK);
        if (state.data.invoicePayments.some((p) => p.movementId === id)) return formFail(LINKED_TO_INVOICE);
        const failure = await tryWrite(() => dataStore.deleteMany({ movementIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, movements: d.movements.filter((m) => m.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    // ---------------------------------------------------------------------- metas

    /**
     * @param {import('../domain/goals.js').GoalInput} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, goal: Goal } | Failure>}
     */
    saveGoal(input, editingId = null) {
      return enqueue(async () => {
        const existing = editingId ? state.data.goals.find((g) => g.id === editingId) : null;
        if (editingId && !existing) return formFail('Esa meta ya no existe.');

        const checked = validateGoal(input, { today: today(), existing });
        if (!checked.ok) return checked;

        const now = nowISO();
        /** @type {Goal} */
        const goal = existing
          ? { ...existing, ...checked.value, updatedAt: now }
          : { id: newId(), ...checked.value, createdAt: now, updatedAt: now };

        const failure = await tryWrite(() => dataStore.putMany({ goals: [goal] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, goals: upsert(d.goals, goal) }));
        return { ok: true, goal };
      });
    },

    /**
     * Borra la meta y todos sus aportes (ese dinero vuelve a estar disponible).
     * @param {string} id
     */
    deleteGoal(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.goals.some((g) => g.id === id)) return formFail('Esa meta ya no existe.');
        const contributionIds = state.data.contributions.filter((c) => c.goalId === id).map((c) => c.id);
        const failure = await tryWrite(() => dataStore.deleteMany({ goalIds: [id], contributionIds }));
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          goals: d.goals.filter((g) => g.id !== id),
          contributions: d.contributions.filter((c) => c.goalId !== id),
        }));
        return { ok: /** @type {const} */ (true), removedContributions: contributionIds.length };
      });
    },

    /**
     * Crea o edita un aporte/retiro de una meta.
     *
     * Un aporte NO puede dejar el dinero disponible en negativo: apartar dinero que no está en tu saldo
     * "fabricaría" dinero. Si el aporte lo supera, se devuelve `needsFunds` y la pantalla pregunta de dónde
     * sale la diferencia. Si el usuario confirma que es dinero que no había registrado (`coverShortfall`),
     * se registra esa diferencia como un ingreso y el aporte, en una sola operación.
     * @param {string} goalId
     * @param {import('../domain/goals.js').ContributionInput} input
     * @param {string | null} [editingId]
     * @param {{ coverShortfall?: boolean }} [options]
     * @returns {Promise<{ ok: true, contribution: Contribution, coveredCents: number } | Failure>}
     */
    saveContribution(goalId, input, editingId = null, options = {}) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const goal = data.goals.find((g) => g.id === goalId);
        if (!goal) return formFail('Esa meta ya no existe.');
        const existing = editingId ? data.contributions.find((c) => c.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese aporte ya no existe.');
        // Un aporte no se puede "mudar" a otra meta: eso se salta la protección contra saldos negativos.
        if (existing && existing.goalId !== goalId) return formFail('Un aporte no se puede mover a otra meta.');

        const checked = validateContribution(input, {
          today: today(),
          savedCents: goalSavedCents(goalId, data.contributions, editingId),
        });
        if (!checked.ok) return checked;

        // ¿Cabe en el dinero disponible? (solo los aportes que empeoran la situación)
        let shortfallCents = 0;
        if (checked.value.kind === 'deposit') {
          const without = { ...data, contributions: data.contributions.filter((c) => c.id !== editingId) };
          const currentAvailable = overallTotals(data, today()).availableCents;
          const availableWithout = overallTotals(without, today()).availableCents;
          const after = availableWithout - checked.value.amountCents;
          if (after < 0 && after < currentAvailable) shortfallCents = Math.min(checked.value.amountCents, -after);
        }
        if (shortfallCents > 0 && !options.coverShortfall) {
          const free = checked.value.amountCents - shortfallCents;
          return {
            ok: false,
            errors: { amount: `Ese aporte supera tu dinero disponible (${formatMoney(free)}).` },
            needsFunds: { availableCents: free, shortfallCents },
          };
        }

        const now = nowISO();
        /** @type {Contribution} */
        const contribution = existing
          ? { ...existing, ...checked.value, updatedAt: now }
          : {
              id: newId(), goalId, ...checked.value, createdAt: now, updatedAt: now,
              // Un aporte a una meta de demostración también es de demostración,
              // para que al quitar la demo no queden aportes huérfanos.
              ...(goal.isDemo ? { isDemo: true } : {}),
            };

        // Dinero que el usuario confirmó que no había registrado: se anota como ingreso extraordinario.
        /** @type {Movement | null} */
        let fundsIncome = null;
        /** @type {Category | null} */
        let fundsCategory = null;
        if (shortfallCents > 0) {
          const builtIn = /** @type {Category} */ (defaultCategories().find((c) => c.id === 'cat-inc-otros'));
          const found = data.categories.find((c) => c.id === builtIn.id);
          if (!found) fundsCategory = builtIn;
          fundsIncome = {
            id: newId(),
            type: 'income',
            amountCents: shortfallCents,
            date: contribution.date,
            time: contribution.time,
            description: `Dinero para la meta «${goal.name}»`.slice(0, 80),
            classification: 'extraordinary',
            categoryId: builtIn.id,
            createdAt: now,
            updatedAt: now,
            ...(goal.isDemo ? { isDemo: true } : {}),
          };
        }

        const income = fundsIncome;
        const category = fundsCategory;
        const failure = await tryWrite(() =>
          dataStore.putMany({
            categories: category ? [category] : [],
            movements: income ? [income] : [],
            contributions: [contribution],
          }),
        );
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          categories: category ? [...d.categories, category] : d.categories,
          movements: income ? [...d.movements, income] : d.movements,
          contributions: upsert(d.contributions, contribution),
        }));
        return { ok: true, contribution, coveredCents: shortfallCents };
      });
    },

    /** @param {string} id */
    deleteContribution(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const contribution = state.data.contributions.find((c) => c.id === id);
        if (!contribution) return formFail('Ese aporte ya no existe.');
        if (goalSavedCents(contribution.goalId, state.data.contributions, id) < 0) {
          return formFail('No se puede borrar este aporte: hay retiros posteriores que dependen de él. Borra primero esos retiros.');
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ contributionIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, contributions: d.contributions.filter((c) => c.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    // --------------------------------------------------------------------- deudas

    /**
     * Crea o edita una deuda (documento §4.4).
     * @param {import('../domain/debts.js').DebtInput} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, debt: Debt } | Failure>}
     */
    saveDebt(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const existing = editingId ? data.debts.find((x) => x.id === editingId) : null;
        if (editingId && !existing) return formFail('Esa deuda ya no existe.');

        const checked = validateDebt(input);
        if (!checked.ok) return checked;

        const now = nowISO();
        /** @type {Debt} */
        const debt = existing
          ? { ...existing, ...checked.value, updatedAt: now }
          : { id: newId(), ...checked.value, createdAt: now, updatedAt: now };

        /** @type {Movement[]} */
        let renamed = [];
        if (existing) {
          const payments = data.debtPayments.filter((p) => p.debtId === debt.id);
          // Si cambias el monto, la tasa o las fechas, los pagos que ya hiciste deben seguir cabiendo.
          if (!paymentsFitDebt(debt, payments)) {
            return formFail('Con estos datos, los pagos que ya registraste superarían lo que se debe. Ajusta o borra primero esos pagos.');
          }
          // Los gastos vinculados llevan el nombre de la deuda en su descripción.
          if (existing.name !== debt.name) {
            renamed = payments.flatMap((p) => {
              const movement = data.movements.find((m) => m.id === p.movementId);
              if (!movement) return [];
              const fields = paymentMovementFields(debt, p, movement.categoryId);
              return [{ ...movement, description: fields.description, updatedAt: now }];
            });
          }
        }

        const failure = await tryWrite(() => dataStore.putMany({ debts: [debt], movements: renamed }));
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          debts: upsert(d.debts, debt),
          movements: renamed.length > 0 ? d.movements.map((m) => renamed.find((r) => r.id === m.id) ?? m) : d.movements,
        }));
        return { ok: true, debt };
      });
    },

    // -------------------------------------------------------------------------
    // Activos (Etapa 4)
    // -------------------------------------------------------------------------

    /**
     * Crea o edita un activo. Al crear, el valor estimado es su primer valor (en la fecha de adquisición).
     * Al editar NO se toca el historial de valores: para cambiar el valor se usa `saveAssetValuation`.
     * @param {import('../domain/assets.js').AssetInput} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, asset: Asset } | Failure>}
     */
    saveAsset(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = editingId ? state.data.assets.find((a) => a.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese activo ya no existe.');

        const checked = validateAsset(input, { today: today(), existing });
        if (!checked.ok) return checked;
        const { valueCents, ...fields } = checked.value;

        const now = nowISO();
        /** @type {Asset} */
        const asset = existing
          ? {
              ...existing, ...fields, updatedAt: now,
              // Si cambia la fecha de adquisición, el primer valor se mueve con ella.
              valuations: normalizeValuations(
                existing.valuations.map((v) => (v.date === existing.acquiredDate ? { ...v, date: fields.acquiredDate } : v)),
              ),
            }
          : { id: newId(), ...fields, valuations: [{ date: fields.acquiredDate, valueCents }], createdAt: now, updatedAt: now };

        const failure = await tryWrite(() => dataStore.putMany({ assets: [asset] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, assets: upsert(d.assets, asset) }));
        return { ok: true, asset };
      });
    },

    /**
     * Registra el valor de un activo en una fecha (si ya había uno ese día, lo reemplaza).
     * @param {string} assetId
     * @param {import('../domain/assets.js').ValuationInput} input
     * @returns {Promise<{ ok: true, asset: Asset } | Failure>}
     */
    saveAssetValuation(assetId, input) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.assets.find((a) => a.id === assetId);
        if (!existing) return formFail('Ese activo ya no existe.');
        const checked = validateValuation(input, { today: today(), asset: existing });
        if (!checked.ok) return checked;
        /** @type {Asset} */
        const asset = { ...existing, valuations: normalizeValuations([...existing.valuations, checked.value]), updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ assets: [asset] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, assets: upsert(d.assets, asset) }));
        return { ok: true, asset };
      });
    },

    /**
     * Borra un valor registrado de un activo. El primero (el de la fecha de adquisición) no se borra: se corrige
     * registrando otro valor en esa misma fecha, o se borra el activo.
     * @param {string} assetId @param {string} date
     * @returns {Promise<{ ok: true, asset: Asset } | Failure>}
     */
    deleteAssetValuation(assetId, date) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.assets.find((a) => a.id === assetId);
        if (!existing) return formFail('Ese activo ya no existe.');
        if (date === existing.acquiredDate) return formFail('El primer valor no se puede borrar. Corrígelo registrando otro valor en esa misma fecha.');
        if (!existing.valuations.some((v) => v.date === date)) return formFail('Ese valor ya no existe.');
        /** @type {Asset} */
        const asset = { ...existing, valuations: existing.valuations.filter((v) => v.date !== date), updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ assets: [asset] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, assets: upsert(d.assets, asset) }));
        return { ok: true, asset };
      });
    },

    /** @param {string} id */
    deleteAsset(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.assets.some((a) => a.id === id)) return formFail('Ese activo ya no existe.');
        const failure = await tryWrite(() => dataStore.deleteMany({ assetIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, assets: d.assets.filter((a) => a.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    // -------------------------------------------------------------------------
    // Clientes y servicios (módulo Freelancer)
    // -------------------------------------------------------------------------

    /**
     * Crea o edita un cliente.
     * @param {import('../domain/clients.js').ClientInput} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, client: Client } | Failure>}
     */
    saveClient(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = editingId ? state.data.clients.find((c) => c.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese cliente ya no existe.');
        const checked = validateClient(input, { clients: state.data.clients, exceptId: editingId });
        if (!checked.ok) return checked;
        const client = existing
          ? applyClientEdit(existing, checked.value, nowISO())
          : buildClient(checked.value, { id: newId(), nowISO: nowISO() });
        const failure = await tryWrite(() => dataStore.putMany({ clients: [client] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, clients: upsert(d.clients, client) }));
        return { ok: true, client };
      });
    },

    /**
     * Archiva un cliente (deja de ofrecerse al registrar pagos y servicios, pero conserva todo su historial) o lo reactiva.
     * @param {string} id @param {boolean} archived
     * @returns {Promise<{ ok: true, client: Client } | Failure>}
     */
    setClientArchived(id, archived) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.clients.find((c) => c.id === id);
        if (!existing) return formFail('Ese cliente ya no existe.');
        /** @type {Client} */
        const client = { ...existing, archived, updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ clients: [client] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, clients: upsert(d.clients, client) }));
        return { ok: true, client };
      });
    },

    /**
     * Borra un cliente SOLO si no tiene servicios, pagos ni gastos cargados (si los tiene, se archiva: así no se pierde su historial).
     * @param {string} id
     */
    deleteClient(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.clients.some((c) => c.id === id)) return formFail('Ese cliente ya no existe.');
        const usage = clientUsage(state.data, id);
        if (usage.invoices > 0 || usage.services > 0 || usage.payments > 0 || usage.expenses > 0) {
          return formFail('Este cliente tiene facturas, servicios, pagos o gastos registrados, así que no se puede borrar. Puedes archivarlo para dejar de verlo en las listas.');
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ clientIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Crea o edita un servicio de un cliente.
     * @param {import('../domain/clients.js').ServiceInput} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, service: Service } | Failure>}
     */
    saveService(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = editingId ? state.data.services.find((x) => x.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese servicio ya no existe.');
        const linkedPayments = existing ? state.data.movements.filter((m) => m.serviceId === existing.id).length : 0;
        const invoiceLines = existing ? state.data.invoices.flatMap((i) => i.lines).filter((l) => l.serviceId === existing.id).length : 0;
        const billedCents = existing ? billedByService(state.data.invoices).get(existing.id) ?? 0 : 0;
        const checked = validateService(input, { clients: state.data.clients, existing, linkedPayments, invoiceLines, billedCents });
        if (!checked.ok) return checked;
        const service = existing
          ? applyServiceEdit(existing, checked.value, nowISO())
          : buildService(checked.value, { id: newId(), nowISO: nowISO() });
        const failure = await tryWrite(() => dataStore.putMany({ services: [service] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, services: upsert(d.services, service) }));
        return { ok: true, service };
      });
    },

    /**
     * Cambia solo el estado de un servicio (Pendiente, En proceso, Finalizado, Cancelado).
     * @param {string} id @param {string} status
     * @returns {Promise<{ ok: true, service: Service } | Failure>}
     */
    setServiceStatus(id, status) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.services.find((x) => x.id === id);
        if (!existing) return formFail('Ese servicio ya no existe.');
        if (!isServiceStatus(status)) return formFail('Ese estado no es válido.');
        /** @type {Service} */
        const service = { ...existing, status, updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ services: [service] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, services: upsert(d.services, service) }));
        return { ok: true, service };
      });
    },

    /**
     * Borra un servicio SOLO si no tiene pagos vinculados (si los tiene, se cambia a «Cancelado»).
     * @param {string} id
     */
    deleteService(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.services.some((x) => x.id === id)) return formFail('Ese servicio ya no existe.');
        if (state.data.movements.some((m) => m.serviceId === id)) {
          return formFail('Este servicio tiene pagos registrados, así que no se puede borrar. Puedes marcarlo como Cancelado.');
        }
        if (state.data.invoices.some((i) => i.lines.some((l) => l.serviceId === id))) {
          return formFail('Este servicio está en una factura (aunque esté anulada, se conserva), así que no se puede borrar. Puedes marcarlo como Cancelado.');
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ serviceIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, services: d.services.filter((x) => x.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    // ----------------------------------------------------- inventario (Emprendedor y Empresa)

    /**
     * Crea o edita un producto.
     * @param {import('../domain/inventory.js').ProductInput} input @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, product: Product } | Failure>}
     */
    saveProduct(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = editingId ? state.data.products.find((x) => x.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese producto ya no existe.');
        const checked = validateProduct(input, { products: state.data.products, exceptId: editingId });
        if (!checked.ok) return checked;
        const product = existing
          ? applyProductEdit(existing, checked.value, nowISO())
          : buildProduct(checked.value, { id: newId(), nowISO: nowISO() });
        const failure = await tryWrite(() => dataStore.putMany({ products: [product] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, products: upsert(d.products, product) }));
        return { ok: true, product };
      });
    },

    /**
     * Archiva un producto (deja de ofrecerse al comprar y vender, pero conserva su historial) o lo reactiva.
     * @param {string} id @param {boolean} archived
     * @returns {Promise<{ ok: true, product: Product } | Failure>}
     */
    setProductArchived(id, archived) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.products.find((x) => x.id === id);
        if (!existing) return formFail('Ese producto ya no existe.');
        /** @type {Product} */
        const product = { ...existing, archived, updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ products: [product] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, products: upsert(d.products, product) }));
        return { ok: true, product };
      });
    },

    /**
     * Borra un producto SOLO si no tiene movimientos de stock (si los tiene, se archiva).
     * @param {string} id
     */
    deleteProduct(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.products.some((x) => x.id === id)) return formFail('Ese producto ya no existe.');
        const usage = productUsage(state.data, id);
        if (usage.entries > 0 || usage.invoices > 0) {
          return formFail(usage.entries > 0
            ? 'Este producto tiene compras, ventas o ajustes registrados, así que no se puede borrar. Puedes archivarlo.'
            : 'Este producto aparece en facturas, así que no se puede borrar. Puedes archivarlo.');
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ productIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, products: d.products.filter((x) => x.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Crea o edita un proveedor.
     * @param {import('../domain/inventory.js').SupplierInput} input @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, supplier: Supplier } | Failure>}
     */
    saveSupplier(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = editingId ? state.data.suppliers.find((x) => x.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese proveedor ya no existe.');
        const checked = validateSupplier(input, { suppliers: state.data.suppliers, exceptId: editingId });
        if (!checked.ok) return checked;
        const supplier = existing
          ? applySupplierEdit(existing, checked.value, nowISO())
          : buildSupplier(checked.value, { id: newId(), nowISO: nowISO() });
        const failure = await tryWrite(() => dataStore.putMany({ suppliers: [supplier] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, suppliers: upsert(d.suppliers, supplier) }));
        return { ok: true, supplier };
      });
    },

    /** @param {string} id @param {boolean} archived @returns {Promise<{ ok: true, supplier: Supplier } | Failure>} */
    setSupplierArchived(id, archived) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.suppliers.find((x) => x.id === id);
        if (!existing) return formFail('Ese proveedor ya no existe.');
        /** @type {Supplier} */
        const supplier = { ...existing, archived, updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ suppliers: [supplier] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, suppliers: upsert(d.suppliers, supplier) }));
        return { ok: true, supplier };
      });
    },

    /** Borra un proveedor SOLO si no tiene compras (si las tiene, se archiva). @param {string} id */
    deleteSupplier(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.suppliers.some((x) => x.id === id)) return formFail('Ese proveedor ya no existe.');
        if (supplierUsage(state.data, id).purchases > 0) {
          return formFail('Este proveedor tiene compras registradas, así que no se puede borrar. Puedes archivarlo.');
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ supplierIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, suppliers: d.suppliers.filter((x) => x.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    // ------------------------------------------------------------ departamentos

    /**
     * Crea o edita un departamento (nombre y presupuesto mensual).
     * @param {import('../domain/departments.js').DepartmentInput} input @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, department: Department } | Failure>}
     */
    saveDepartment(input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = editingId ? state.data.departments.find((x) => x.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese departamento ya no existe.');
        const checked = validateDepartment(input, { departments: state.data.departments, exceptId: editingId });
        if (!checked.ok) return checked;
        const department = existing
          ? applyDepartmentEdit(existing, checked.value, nowISO())
          : buildDepartment(checked.value, { id: newId(), nowISO: nowISO() });
        const failure = await tryWrite(() => dataStore.putMany({ departments: [department] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, departments: upsert(d.departments, department) }));
        return { ok: true, department };
      });
    },

    /**
     * Archiva un departamento (deja de ofrecerse al registrar gastos y deja de tener presupuesto que cumplir, pero conserva su
     * historial) o lo reactiva.
     * @param {string} id @param {boolean} archived
     * @returns {Promise<{ ok: true, department: Department } | Failure>}
     */
    setDepartmentArchived(id, archived) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.departments.find((x) => x.id === id);
        if (!existing) return formFail('Ese departamento ya no existe.');
        /** @type {Department} */
        const department = { ...existing, archived, updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ departments: [department] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, departments: upsert(d.departments, department) }));
        return { ok: true, department };
      });
    },

    /** Borra un departamento SOLO si no tiene gastos (si los tiene, se archiva: así no se pierde su historial). @param {string} id */
    deleteDepartment(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.departments.some((x) => x.id === id)) return formFail('Ese departamento ya no existe.');
        if (departmentUsage(state.data, id).expenses > 0) {
          return formFail('Este departamento tiene gastos cargados, así que no se puede borrar. Puedes archivarlo.');
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ departmentIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, departments: d.departments.filter((x) => x.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Carga un gasto a un departamento (o se lo quita con ""). Solo cambia ese dato: sirve también para los gastos que no se pueden
     * editar desde Movimientos (las compras de inventario). Los ingresos y los pagos de deudas no se cargan a un departamento.
     * @param {string} movementId @param {string} departmentId  "" = dejarlo sin departamento.
     * @returns {Promise<{ ok: true, movement: Movement } | Failure>}
     */
    assignDepartment(movementId, departmentId) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const existing = data.movements.find((m) => m.id === movementId);
        if (!existing) return formFail('Ese movimiento ya no existe.');
        if (existing.type !== 'expense') return formFail('Solo los gastos se cargan a un departamento.');
        if (data.debtPayments.some((p) => p.movementId === movementId)) return formFail('Un pago de deuda no se carga a un departamento.');
        if (departmentId) {
          const target = data.departments.find((x) => x.id === departmentId);
          if (!target) return formFail('Ese departamento ya no existe.');
          if (target.archived && existing.departmentId !== departmentId) return formFail('Ese departamento está archivado: reactívalo para cargarle gastos.');
        }
        if ((existing.departmentId ?? '') === departmentId) return { ok: true, movement: existing };
        const { departmentId: _previous, ...rest } = existing;
        /** @type {Movement} */
        const movement = { ...rest, ...(departmentId ? { departmentId } : {}), updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ movements: [movement] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, movements: upsert(d.movements, movement) }));
        return { ok: true, movement };
      });
    },

    /**
     * Registra una compra, una venta o un ajuste de stock. Compras y ventas crean en la MISMA operación su gasto o ingreso
     * (se guardan los dos o ninguno), así el dinero y el stock nunca quedan descuadrados. Si el producto es de demostración,
     * el movimiento también lo es y se va con él.
     * @param {import('../domain/inventory.js').StockInput} input
     * @returns {Promise<{ ok: true, entry: StockEntry, movement: Movement | null } | Failure>}
     */
    registerStock(input) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const now = nowISO();
        const time = currentTime(clock());
        const checked = validateStockEntry(input, {
          products: data.products, suppliers: data.suppliers, categories: data.categories, entries: data.stockEntries,
          today: today(), time, nowISO: now, departments: data.departments,
        });
        if (!checked.ok) return checked;
        const value = checked.value;
        const product = data.products.find((p) => p.id === value.productId);
        if (!product) return formFail('Ese producto ya no existe.');
        const isDemo = product.isDemo === true;

        /** @type {Movement | null} */
        let movement = null;
        if (value.kind !== 'adjustment') {
          const category = data.categories.find((c) => c.id === value.categoryId);
          if (!category) return formFail('Esa categoría ya no existe.');
          movement = buildStockMovement(value, product, category, { id: newId(), time, nowISO: now, isDemo });
        }
        /** @type {StockEntry} */
        const entry = { ...buildStockEntry(value, { id: newId(), time, nowISO: now, movementId: movement?.id }), ...(isDemo ? { isDemo: true } : {}) };

        const failure = await tryWrite(() => dataStore.putMany({ movements: movement ? [movement] : [], stockEntries: [entry] }));
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          movements: movement ? upsert(d.movements, movement) : d.movements,
          stockEntries: upsert(d.stockEntries, entry),
        }));
        return { ok: true, entry, movement };
      });
    },

    /**
     * Borra un movimiento de stock y, si lo tiene, su gasto o ingreso (ese dinero vuelve a su lugar). No se permite si el
     * stock quedaría en negativo en algún momento (por ejemplo, borrar una compra cuya mercancía ya se vendió).
     * @param {string} id
     */
    deleteStockEntry(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const entry = state.data.stockEntries.find((e) => e.id === id);
        if (!entry) return formFail('Ese movimiento de stock ya no existe.');
        if (entry.invoiceId) return formFail(STOCK_FROM_INVOICE);
        const problem = deletionProblem(state.data.stockEntries, id, state.data.products);
        if (problem) return formFail(problem);
        const movementIds = entry.movementId ? [entry.movementId] : [];
        const failure = await tryWrite(() => dataStore.deleteMany({ stockEntryIds: [id], movementIds }));
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          stockEntries: d.stockEntries.filter((e) => e.id !== id),
          movements: d.movements.filter((m) => !movementIds.includes(m.id)),
        }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    // ---------------------------------------------------------------- facturas internas

    /**
     * Emite una factura interna. Las líneas que llevan un producto sacan esas unidades del inventario en la MISMA operación
     * (se guardan la factura y sus salidas, o nada): así el stock y las facturas nunca quedan descuadrados. El dinero no se
     * registra aquí sino al cobrar. Una factura que vende productos de demostración también es de demostración.
     * @param {import('../domain/invoices.js').InvoiceInput} input
     * @returns {Promise<{ ok: true, invoice: Invoice, entries: StockEntry[] } | Failure>}
     */
    createInvoice(input) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const now = nowISO();
        const time = currentTime(clock());
        const checked = validateInvoice(input, {
          products: data.products, entries: data.stockEntries, today: today(), time, nowISO: now,
          // Freelancer (0.14.5): cliente de la lista y servicios con lo que les queda por facturar.
          clients: data.clients, services: data.services, movements: data.movements, invoices: data.invoices, requireClient: activeKind() === 'freelancer',
        });
        if (!checked.ok) return checked;
        const value = checked.value;
        const invoiceClient = value.clientId ? data.clients.find((c) => c.id === value.clientId) : null;
        const soldProducts = value.lines.flatMap((l) => (l.productId ? [data.products.find((p) => p.id === l.productId)] : []));
        const demoCount = soldProducts.filter((p) => p?.isDemo === true).length;
        if (demoCount > 0 && demoCount < soldProducts.length) {
          return { ok: false, errors: { lines: 'No mezcles productos de demostración con productos tuyos en la misma factura: haz una factura para cada tipo.' } };
        }
        // Una factura a un cliente de demostración también es de demostración (DEMO-001…), como la de un producto de demostración.
        if (invoiceClient?.isDemo === true && demoCount < soldProducts.length) {
          return { ok: false, errors: { lines: 'No mezcles productos tuyos en la factura de un cliente de demostración.' } };
        }
        const isDemo = demoCount > 0 || invoiceClient?.isDemo === true;
        const invoice = buildInvoice(value, { id: newId(), number: nextInvoiceNumber(data.invoices, isDemo), nowISO: now, isDemo });
        const entries = stockEntriesFromLines(invoice.lines, {
          invoiceId: invoice.id, ids: invoice.lines.map(() => newId()), issueDate: invoice.issueDate, time, nowISO: now,
          label: `Factura ${invoiceLabel(invoice)}`, isDemo,
        });
        const failure = await tryWrite(() => dataStore.putMany({ invoices: [invoice], stockEntries: entries }));
        if (failure) return failure;
        updateData((d) => ({ ...d, invoices: upsert(d.invoices, invoice), stockEntries: [...d.stockEntries, ...entries] }));
        return { ok: true, invoice, entries };
      });
    },

    /**
     * Cambia lo que no toca el dinero de una factura ya emitida: el cliente, el vencimiento y las notas.
     * @param {string} id @param {import('../domain/invoices.js').InvoiceEditInput} input
     * @returns {Promise<{ ok: true, invoice: Invoice } | Failure>}
     */
    saveInvoiceEdit(id, input) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.invoices.find((x) => x.id === id);
        if (!existing) return formFail('Esa factura ya no existe.');
        const checked = validateInvoiceEdit(input, existing);
        if (!checked.ok) return checked;
        /** @type {Invoice} */
        const invoice = { ...existing, ...checked.value, updatedAt: nowISO() };
        const failure = await tryWrite(() => dataStore.putMany({ invoices: [invoice] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, invoices: upsert(d.invoices, invoice) }));
        return { ok: true, invoice };
      });
    },

    /**
     * Anula una factura: queda en la lista como «Anulada» (su número no se reutiliza) y sus salidas de inventario se devuelven al
     * stock, todo en una sola operación. No se puede si tiene cobros: primero se borran (con su ingreso).
     * @param {string} id
     * @returns {Promise<{ ok: true, invoice: Invoice } | Failure>}
     */
    voidInvoice(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const existing = state.data.invoices.find((x) => x.id === id);
        if (!existing) return formFail('Esa factura ya no existe.');
        const problem = voidProblem(existing, state.data.invoicePayments);
        if (problem) return formFail(problem);
        const now = nowISO();
        const stockEntryIds = state.data.stockEntries.filter((e) => e.invoiceId === id).map((e) => e.id);
        /** @type {Invoice} */
        const invoice = { ...existing, voidedAt: now, updatedAt: now };
        const failure = await tryWrite(() => dataStore.putMany({ invoices: [invoice] }, { stockEntryIds }));
        if (failure) return failure;
        updateData((d) => ({ ...d, invoices: upsert(d.invoices, invoice), stockEntries: d.stockEntries.filter((e) => !stockEntryIds.includes(e.id)) }));
        return { ok: true, invoice };
      });
    },

    /**
     * Registra un cobro de una factura. Crea en la MISMA operación su ingreso (se guardan los dos o ninguno).
     * @param {string} invoiceId @param {import('../domain/invoices.js').PaymentInput} input
     * @returns {Promise<{ ok: true, payment: InvoicePayment, movement: Movement } | Failure>}
     */
    addInvoicePayment(invoiceId, input) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const invoice = data.invoices.find((x) => x.id === invoiceId);
        if (!invoice) return formFail('Esa factura ya no existe.');
        const checked = validateInvoicePayment(input, { invoice, payments: data.invoicePayments, categories: data.categories, today: today() });
        if (!checked.ok) return checked;
        const category = data.categories.find((c) => c.id === checked.value.categoryId);
        if (!category) return formFail('Esa categoría ya no existe.');
        const now = nowISO();
        const time = currentTime(clock());
        const isDemo = invoice.isDemo === true;
        const movement = buildPaymentMovement(checked.value, invoice, category, { id: newId(), time, nowISO: now, isDemo });
        const payment = buildInvoicePayment(checked.value, { id: newId(), invoiceId, time, nowISO: now, movementId: movement.id, isDemo });
        const failure = await tryWrite(() => dataStore.putMany({ movements: [movement], invoicePayments: [payment] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, movements: upsert(d.movements, movement), invoicePayments: upsert(d.invoicePayments, payment) }));
        return { ok: true, payment, movement };
      });
    },

    /**
     * Borra un cobro y su ingreso (ese dinero deja de estar disponible y la factura vuelve a deber ese monto).
     * @param {string} id
     */
    deleteInvoicePayment(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const payment = state.data.invoicePayments.find((p) => p.id === id);
        if (!payment) return formFail('Ese cobro ya no existe.');
        const failure = await tryWrite(() => dataStore.deleteMany({ invoicePaymentIds: [id], movementIds: [payment.movementId] }));
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          invoicePayments: d.invoicePayments.filter((p) => p.id !== id),
          movements: d.movements.filter((m) => m.id !== payment.movementId),
        }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Borra la deuda, sus pagos y los gastos vinculados a esos pagos (ese dinero vuelve a estar disponible).
     * @param {string} id
     */
    deleteDebt(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!state.data.debts.some((x) => x.id === id)) return formFail('Esa deuda ya no existe.');
        const payments = state.data.debtPayments.filter((p) => p.debtId === id);
        const debtPaymentIds = payments.map((p) => p.id);
        const movementIds = payments.map((p) => p.movementId);
        const failure = await tryWrite(() => dataStore.deleteMany({ debtIds: [id], debtPaymentIds, movementIds }));
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          debts: d.debts.filter((x) => x.id !== id),
          debtPayments: d.debtPayments.filter((p) => p.debtId !== id),
          movements: d.movements.filter((m) => !movementIds.includes(m.id)),
        }));
        return {
          ok: /** @type {const} */ (true),
          removedPayments: payments.length,
          removedCents: payments.reduce((sum, p) => sum + p.amountCents, 0),
        };
      });
    },

    /**
     * Registra o edita un pago de una deuda. Crea (o actualiza) el gasto vinculado en la misma operación.
     * @param {string} debtId
     * @param {import('../domain/debts.js').PaymentInput} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, payment: DebtPayment, movement: Movement } | Failure>}
     */
    saveDebtPayment(debtId, input, editingId = null) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const data = state.data;
        const debt = data.debts.find((x) => x.id === debtId);
        if (!debt) return formFail('Esa deuda ya no existe.');
        const existing = editingId ? data.debtPayments.find((p) => p.id === editingId) : null;
        if (editingId && !existing) return formFail('Ese pago ya no existe.');
        if (existing && existing.debtId !== debtId) return formFail('Un pago no se puede mover a otra deuda.');

        const checked = validatePayment(input, {
          today: today(),
          debt,
          payments: data.debtPayments.filter((p) => p.debtId === debtId),
          editingId,
        });
        if (!checked.ok) return checked;
        const value = checked.value;

        const now = nowISO();
        const { category, created } = ensureDebtCategory(data.categories);
        const oldMovement = existing ? data.movements.find((m) => m.id === existing.movementId) : null;
        const fields = paymentMovementFields(debt, value, oldMovement?.categoryId ?? category.id);

        /** @type {Movement} */
        const movement = oldMovement
          ? { ...oldMovement, ...fields, updatedAt: now }
          : {
              id: existing?.movementId ?? newId(), ...fields, createdAt: now, updatedAt: now,
              // Un pago de una deuda de demostración también es de demostración (para quitarlo junto con ella).
              ...(debt.isDemo ? { isDemo: true } : {}),
            };
        /** @type {DebtPayment} */
        const payment = existing
          ? { ...existing, ...value, movementId: movement.id, updatedAt: now }
          : {
              id: newId(), debtId, ...value, movementId: movement.id, createdAt: now, updatedAt: now,
              ...(debt.isDemo ? { isDemo: true } : {}),
            };

        const needsCategory = created && !oldMovement;
        const failure = await tryWrite(() =>
          dataStore.putMany({ categories: needsCategory ? [category] : [], movements: [movement], debtPayments: [payment] }),
        );
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          categories: needsCategory ? [...d.categories, category] : d.categories,
          movements: upsert(d.movements, movement),
          debtPayments: upsert(d.debtPayments, payment),
        }));
        return { ok: true, payment, movement };
      });
    },

    /** @param {string} id */
    deleteDebtPayment(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const payment = state.data.debtPayments.find((p) => p.id === id);
        if (!payment) return formFail('Ese pago ya no existe.');
        const debt = state.data.debts.find((x) => x.id === payment.debtId);
        if (debt) {
          const rest = state.data.debtPayments.filter((p) => p.debtId === debt.id && p.id !== id);
          if (!paymentsFitDebt(debt, rest)) {
            return formFail('No se puede borrar este pago: hay pagos posteriores que dependen de él. Borra primero esos pagos.');
          }
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ debtPaymentIds: [id], movementIds: [payment.movementId] }));
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          debtPayments: d.debtPayments.filter((p) => p.id !== id),
          movements: d.movements.filter((m) => m.id !== payment.movementId),
        }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    // ----------------------------------------------------------------- categorías

    /**
     * Crea una categoría propia, o renombra una propia existente.
     * @param {{ name: string, kind: 'income' | 'expense', defaultClassification: string }} input
     * @param {string | null} [editingId]
     * @returns {Promise<{ ok: true, category: Category } | Failure>}
     */
    saveCategory(input, editingId = null) {
      return enqueue(async () => {
        const existing = editingId ? state.data.categories.find((c) => c.id === editingId) : null;
        if (editingId && !existing) return formFail('Esa categoría ya no existe.');
        if (existing?.builtIn) return formFail('Las categorías que vienen con la app no se pueden renombrar.');

        const kind = existing ? existing.kind : input.kind;
        if (!existing) {
          if (kind !== 'income' && kind !== 'expense') return formFail('Tipo de categoría no válido.');
          if (!CLASSIFICATIONS_BY_TYPE[kind].includes(/** @type {any} */ (input.defaultClassification))) {
            return { ok: false, errors: { defaultClassification: 'Esa clasificación no corresponde a ese tipo.' } };
          }
        }
        const named = validateCategoryName(input.name, kind, state.data.categories, editingId);
        if (!named.ok) return { ok: false, errors: { name: named.error } };

        /** @type {Category} */
        const category = existing
          ? { ...existing, name: named.name }
          : {
              id: newId(),
              name: named.name,
              kind,
              defaultClassification: /** @type {any} */ (input.defaultClassification),
              builtIn: false,
            };
        const failure = await tryWrite(() => dataStore.putMany({ categories: [category] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, categories: upsert(d.categories, category) }));
        return { ok: true, category };
      });
    },

    /** @param {string} id */
    deleteCategory(id) {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        const category = state.data.categories.find((c) => c.id === id);
        if (!category) return formFail('Esa categoría ya no existe.');
        if (category.builtIn) return formFail('Las categorías que vienen con la app no se pueden borrar.');
        const uses = state.data.movements.filter((m) => m.categoryId === id).length;
        if (uses > 0) {
          return formFail(`No se puede borrar: la usan ${uses} movimiento${uses === 1 ? '' : 's'}.`);
        }
        const failure = await tryWrite(() => dataStore.deleteMany({ categoryIds: [id] }));
        if (failure) return failure;
        updateData((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== id) }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Añade al espacio de negocio abierto las categorías sugeridas que todavía no tiene (mismo nombre y tipo).
     * Son categorías propias del espacio: se pueden renombrar y borrar como cualquiera.
     * @returns {Promise<{ ok: true, added: number } | Failure>}
     */
    addBusinessCategories() {
      return enqueue(async () => {
        const stale = await reloadFromStorage();
        if (stale) return stale;
        if (!resultsEnabled(activeKind())) return formFail('Las categorías de negocio son para los espacios Emprendedor y Empresa.');
        /** @type {Category[]} */
        const created = [];
        for (const s of missingBusinessCategories(state.data.categories)) {
          const named = validateCategoryName(s.name, s.kind, [...state.data.categories, ...created]);
          if (!named.ok) continue; // ya existe con otra forma de escribirse: no se duplica
          created.push({ id: newId(), name: named.name, kind: s.kind, defaultClassification: s.classification, builtIn: false });
        }
        if (created.length === 0) return { ok: /** @type {const} */ (true), added: 0 };
        const failure = await tryWrite(() => dataStore.putMany({ categories: created }));
        if (failure) return failure;
        updateData((d) => ({ ...d, categories: [...d.categories, ...created] }));
        return { ok: /** @type {const} */ (true), added: created.length };
      });
    },

    // -------------------------------------------------------------------- ajustes

    /** @param {{ displayName: string, openingText: string }} input */
    saveSettings(input) {
      return enqueue(async () => {
        const checked = validateSettings(input);
        if (!checked.ok) return checked;
        const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
        if (active && !canManageWorkspace(active)) {
          // En un espacio de otra persona solo cambias TU nombre (es de tu perfil); el saldo inicial es del dueño.
          if (checked.value.openingBalanceCents !== state.data.settings.openingBalanceCents) {
            return { ok: /** @type {const} */ (false), errors: { opening: 'Solo el dueño de este espacio puede cambiar su saldo inicial.' } };
          }
          const profile = { ...state.profile, displayName: checked.value.displayName };
          const saved = await tryWrite(() => root.saveProfile(profile));
          if (saved) return saved;
          state = { ...state, data: { ...state.data, settings: checked.value }, profile };
          emit();
          return { ok: /** @type {const} */ (true) };
        }
        const failure = await tryWrite(() => dataStore.saveSettings(checked.value));
        if (failure) return failure;
        // El nombre es de la persona (todos los espacios); el saldo inicial es del espacio abierto.
        state = {
          ...state,
          data: { ...state.data, settings: checked.value },
          profile: { ...state.profile, displayName: checked.value.displayName },
          workspaces: state.workspaces.map((w) =>
            w.id === state.activeWorkspaceId ? { ...w, openingBalanceCents: checked.value.openingBalanceCents } : w),
        };
        emit();
        return { ok: /** @type {const} */ (true) };
      });
    },

    // ---------------------------------------------------- demostración y respaldos

    hasDemoData,

    /** Carga datos de ejemplo, todos marcados como DEMO. */
    loadDemoData() {
      return enqueue(async () => {
        if (hasDemoData()) return formFail('Ya hay datos de demostración cargados.');
        // En un espacio de negocio (Emprendedor o Empresa) la demostración es un negocio inventado, no finanzas personales.
        const base = resultsEnabled(activeKind())
          ? { movements: buildBusinessDemo(today(), nowISO()), goals: [], contributions: [], debts: [], debtPayments: [], assets: [] }
          : buildDemoData(today(), nowISO());
        // En un espacio Empresa se suman una deuda y un activo de ejemplo, para que «Salud financiera» tenga qué medir.
        const company = activeKind() === 'company' ? buildCompanyDemo(today(), nowISO()) : null;
        const demo = company
          ? { ...base, movements: [...base.movements, ...company.movements], debts: company.debts, debtPayments: company.debtPayments, assets: company.assets }
          : base;
        // En un espacio Freelancer, la demostración incluye también clientes, servicios y pagos vinculados.
        const freelance = activeKind() === 'freelancer' ? buildFreelancerDemo(today(), nowISO()) : { clients: [], services: [], movements: [] };
        // En un negocio (Emprendedor o Empresa) la demostración incluye también productos, proveedores y sus compras y ventas.
        const inventory = resultsEnabled(activeKind())
          ? buildInventoryDemo(today(), nowISO())
          : { products: [], suppliers: [], stockEntries: [], movements: [] };
        // Y también cinco facturas internas con sus cobros (con todos los estados posibles).
        // En Freelancer (0.14.5), tres facturas ligadas a los clientes y servicios de la demostración.
        const invoicing = resultsEnabled(activeKind())
          ? buildInvoiceDemo(today(), nowISO())
          : activeKind() === 'freelancer'
            ? buildFreelancerInvoiceDemo(freelance, today(), nowISO())
            : { invoices: [], invoicePayments: [], movements: [] };
        // Todos los movimientos de la demostración. En un espacio Empresa, además, vienen cuatro departamentos con presupuesto y
        // los gastos de operación ya cargados a su departamento.
        const allMovements = [...demo.movements, ...freelance.movements, ...inventory.movements, ...invoicing.movements];
        const departmental = activeKind() === 'company'
          ? buildDepartmentDemo(allMovements, today(), nowISO())
          : { departments: /** @type {Department[]} */ ([]), movements: allMovements };
        // La demostración usa las categorías de fábrica; si faltan (p. ej. tras importar un respaldo vacío), se añaden.
        const missing = missingBuiltInCategories(state.data.categories);
        const failure = await tryWrite(() =>
          dataStore.putMany({
            ...demo, movements: departmental.movements,
            clients: freelance.clients, services: freelance.services,
            products: inventory.products, suppliers: inventory.suppliers, stockEntries: inventory.stockEntries,
            invoices: invoicing.invoices, invoicePayments: invoicing.invoicePayments, departments: departmental.departments, categories: missing,
          }),
        );
        if (failure) return failure;
        updateData((d) => ({
          ...d,
          categories: [...d.categories, ...missing],
          clients: [...d.clients, ...freelance.clients],
          services: [...d.services, ...freelance.services],
          products: [...d.products, ...inventory.products],
          suppliers: [...d.suppliers, ...inventory.suppliers],
          stockEntries: [...d.stockEntries, ...inventory.stockEntries],
          invoices: [...d.invoices, ...invoicing.invoices],
          invoicePayments: [...d.invoicePayments, ...invoicing.invoicePayments],
          departments: [...d.departments, ...departmental.departments],
          movements: [...d.movements, ...departmental.movements],
          goals: [...d.goals, ...demo.goals],
          contributions: [...d.contributions, ...demo.contributions],
          debts: [...d.debts, ...demo.debts],
          debtPayments: [...d.debtPayments, ...demo.debtPayments],
          assets: [...d.assets, ...demo.assets],
        }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    /** Borra SOLO lo marcado como demostración. */
    removeDemoData() {
      return enqueue(async () => {
        const d = state.data;
        const goalIds = d.goals.filter((g) => g.isDemo).map((g) => g.id);
        const contributionIds = d.contributions
          .filter((c) => c.isDemo || goalIds.includes(c.goalId))
          .map((c) => c.id);
        const debtIds = d.debts.filter((x) => x.isDemo).map((x) => x.id);
        const demoPayments = d.debtPayments.filter((p) => p.isDemo || debtIds.includes(p.debtId));
        const debtPaymentIds = demoPayments.map((p) => p.id);
        // Productos de demostración: se van con todos sus movimientos de stock y el gasto o ingreso de cada uno.
        const productIds = d.products.filter((x) => x.isDemo).map((x) => x.id);
        // Las facturas de demostración se van con sus cobros (y el ingreso de cada cobro) y con sus salidas de inventario.
        const invoiceIds = d.invoices.filter((x) => x.isDemo).map((x) => x.id);
        const demoInvoicePayments = d.invoicePayments.filter((p) => p.isDemo || invoiceIds.includes(p.invoiceId));
        const invoicePaymentIds = demoInvoicePayments.map((p) => p.id);
        const demoEntries = d.stockEntries.filter((e) => e.isDemo || productIds.includes(e.productId) || (e.invoiceId !== undefined && invoiceIds.includes(e.invoiceId)));
        const stockEntryIds = demoEntries.map((e) => e.id);
        // Los gastos vinculados a pagos y a compras de demostración se van con ellos.
        const movementIds = [
          ...new Set([
            ...d.movements.filter((m) => m.isDemo).map((m) => m.id),
            ...demoPayments.map((p) => p.movementId),
            ...demoInvoicePayments.map((p) => p.movementId),
            ...demoEntries.flatMap((e) => (e.movementId ? [e.movementId] : [])),
          ]),
        ];
        // Un proveedor de ejemplo al que la persona le registró una compra REAL pasa a ser suyo (no se pierde el vínculo).
        const demoSuppliers = d.suppliers.filter((x) => x.isDemo);
        const adoptedSuppliers = demoSuppliers
          .filter((x) => d.stockEntries.some((e) => e.supplierId === x.id && !stockEntryIds.includes(e.id)))
          .map((x) => {
            const { isDemo: _demo, ...rest } = x;
            return /** @type {Supplier} */ ({ ...rest, updatedAt: nowISO() });
          });
        const adoptedSupplierIds = adoptedSuppliers.map((x) => x.id);
        const supplierIds = demoSuppliers.filter((x) => !adoptedSupplierIds.includes(x.id)).map((x) => x.id);
        const assetIds = d.assets.filter((a) => a.isDemo).map((a) => a.id);
        // Clientes y servicios de demostración se van. Pero lo que la persona registró de VERDAD no se pierde:
        //  - un cliente de ejemplo con un servicio o un pago reales pasa a ser un cliente suyo (deja de ser «de demostración»);
        //  - un pago real vinculado a un servicio de ejemplo se queda con su cliente y solo pierde el servicio.
        const demoClients = d.clients.filter((c) => c.isDemo);
        const adopted = demoClients
          .filter((c) => d.services.some((x) => x.clientId === c.id && !x.isDemo) || d.movements.some((m) => m.clientId === c.id && !m.isDemo))
          .map((c) => {
            const { isDemo: _demo, ...rest } = c;
            return /** @type {Client} */ ({ ...rest, updatedAt: nowISO() });
          });
        const adoptedIds = adopted.map((c) => c.id);
        const clientIds = demoClients.filter((c) => !adoptedIds.includes(c.id)).map((c) => c.id);
        const serviceIds = d.services.filter((x) => x.isDemo).map((x) => x.id);
        const unlinked = d.movements
          .filter((m) => !movementIds.includes(m.id) && m.serviceId && serviceIds.includes(m.serviceId))
          .map((m) => {
            const { serviceId: _service, ...rest } = m;
            return /** @type {Movement} */ ({ ...rest, updatedAt: nowISO() });
          });
        // Un departamento de ejemplo al que la persona le cargó un gasto REAL pasa a ser suyo (no se pierde el vínculo).
        const demoDepartments = d.departments.filter((x) => x.isDemo);
        const adoptedDepartments = demoDepartments
          .filter((x) => d.movements.some((m) => m.departmentId === x.id && !movementIds.includes(m.id)))
          .map((x) => {
            const { isDemo: _demo, ...rest } = x;
            return /** @type {Department} */ ({ ...rest, updatedAt: nowISO() });
          });
        const adoptedDepartmentIds = adoptedDepartments.map((x) => x.id);
        const departmentIds = demoDepartments.filter((x) => !adoptedDepartmentIds.includes(x.id)).map((x) => x.id);
        const keeping = unlinked.length > 0 || adopted.length > 0 || adoptedSuppliers.length > 0 || adoptedDepartments.length > 0;
        if (keeping) {
          const keepFailure = await tryWrite(() => dataStore.putMany({ movements: unlinked, clients: adopted, suppliers: adoptedSuppliers, departments: adoptedDepartments }));
          if (keepFailure) return keepFailure;
        }
        const failure = await tryWrite(() =>
          dataStore.deleteMany({ movementIds, goalIds, contributionIds, debtIds, debtPaymentIds, assetIds, clientIds, serviceIds, productIds, supplierIds, stockEntryIds, invoiceIds, invoicePaymentIds, departmentIds }),
        );
        if (failure) {
          if (keeping) await reloadFromStorage(); // ya se guardó lo que se conserva: que la pantalla lo refleje
          return failure;
        }
        updateData((x) => ({
          ...x,
          clients: x.clients.filter((c) => !clientIds.includes(c.id)).map((c) => adopted.find((a) => a.id === c.id) ?? c),
          services: x.services.filter((v) => !serviceIds.includes(v.id)),
          products: x.products.filter((v) => !productIds.includes(v.id)),
          suppliers: x.suppliers.filter((v) => !supplierIds.includes(v.id)).map((v) => adoptedSuppliers.find((a) => a.id === v.id) ?? v),
          stockEntries: x.stockEntries.filter((v) => !stockEntryIds.includes(v.id)),
          invoices: x.invoices.filter((v) => !invoiceIds.includes(v.id)),
          invoicePayments: x.invoicePayments.filter((v) => !invoicePaymentIds.includes(v.id)),
          departments: x.departments.filter((v) => !departmentIds.includes(v.id)).map((v) => adoptedDepartments.find((a) => a.id === v.id) ?? v),
          movements: x.movements.filter((m) => !movementIds.includes(m.id)).map((m) => unlinked.find((u) => u.id === m.id) ?? m),
          goals: x.goals.filter((g) => !goalIds.includes(g.id)),
          contributions: x.contributions.filter((c) => !contributionIds.includes(c.id)),
          debts: x.debts.filter((v) => !debtIds.includes(v.id)),
          debtPayments: x.debtPayments.filter((p) => !debtPaymentIds.includes(p.id)),
          assets: x.assets.filter((a) => !assetIds.includes(a.id)),
        }));
        return { ok: /** @type {const} */ (true) };
      });
    },

    /**
     * Prepara la copia de seguridad del espacio ABIERTO (no toca el almacén). Si hay varios espacios,
     * el nombre del archivo lleva el del espacio para no confundirlas.
     */
    exportBackup() {
      const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null;
      const backup = createBackup(state.data, nowISO(), workspace ? { kind: workspace.kind, name: workspace.name } : undefined);
      const label = workspace && state.workspaces.length > 1 ? workspace.name : undefined;
      return { fileName: backupFileName(today(), label), json: JSON.stringify(backup, null, 2) };
    },

    /**
     * Prepara la copia COMPLETA: todos los espacios y el nombre de la persona.
     * @returns {Promise<{ ok: true, fileName: string, json: string } | Failure>}
     */
    async exportFullBackup() {
      try {
        const snapshot = await root.loadEverything();
        const backup = createFullBackup(snapshot, nowISO());
        return { ok: true, fileName: fullBackupFileName(today()), json: JSON.stringify(backup, null, 2) };
      } catch (error) {
        console.error('No se pudo preparar la copia completa:', error);
        return formFail('No se pudo leer lo guardado para armar la copia. Inténtalo de nuevo.');
      }
    },

    /**
     * Revisa un archivo de copia SIN importarlo, para que la pantalla pueda explicar qué va a pasar
     * (¿reemplaza el espacio abierto o reemplaza todo?) antes de pedir confirmación.
     * @param {string} text
     * @returns {{ ok: true, kind: 'workspace', sourceName: string | null, sourceKind: import('../domain/types.js').WorkspaceKind | null, counts: { movements: number, goals: number, debts: number, assets: number, clients: number, products: number, invoices: number } }
     *   | { ok: true, kind: 'full', workspaceNames: string[], counts: { movements: number, goals: number, debts: number, assets: number, clients: number, products: number, invoices: number } }
     *   | { ok: false, error: string }}
     */
    inspectBackup(text) {
      const parsed = parseAnyBackup(text, { today: today() });
      if (!parsed.ok) return parsed;
      /** @param {AppData[]} list */
      const sum = (list) => ({
        movements: list.reduce((n, d) => n + d.movements.length, 0),
        goals: list.reduce((n, d) => n + d.goals.length, 0),
        debts: list.reduce((n, d) => n + d.debts.length, 0),
        assets: list.reduce((n, d) => n + d.assets.length, 0),
        clients: list.reduce((n, d) => n + d.clients.length, 0),
        products: list.reduce((n, d) => n + d.products.length, 0),
        invoices: list.reduce((n, d) => n + d.invoices.length, 0),
      });
      if (parsed.kind === 'full') {
        return { ok: true, kind: 'full', workspaceNames: parsed.workspaces.map((w) => w.workspace.name), counts: sum(parsed.workspaces.map((w) => w.data)) };
      }
      return { ok: true, kind: 'workspace', sourceName: parsed.workspace?.name ?? null, sourceKind: parsed.workspace?.kind ?? null, counts: sum([parsed.data]) };
    },

    /**
     * Restaura una copia de seguridad (después de validarla). Una copia de UN espacio sustituye los datos del espacio
     * abierto; una copia COMPLETA sustituye TODOS los espacios.
     * @param {string} text
     */
    importBackup(text) {
      return enqueue(async () => {
        const parsed = parseAnyBackup(text, { today: today() });
        if (!parsed.ok) return formFail(parsed.error);

        if (parsed.kind === 'full') {
          const snapshot = {
            profile: parsed.profile,
            // Si la copia no trae las categorías de fábrica, se añaden para que la app siga siendo usable.
            workspaces: parsed.workspaces.map(({ workspace, data }) => ({
              workspace,
              data: { ...data, categories: [...data.categories, ...missingBuiltInCategories(data.categories)] },
            })),
          };
          const failure = await tryWrite(() => root.replaceEverything(snapshot));
          if (failure) return failure;
          // Se abre el último espacio usado (o el predeterminado) de lo restaurado.
          state = { ...state, activeWorkspaceId: null };
          const reloaded = await reloadFromStorage({ lenient: true });
          if (reloaded) return reloaded;
          const all = snapshot.workspaces.map((w) => w.data);
          return {
            ok: /** @type {const} */ (true),
            kind: /** @type {const} */ ('full'),
            workspaces: snapshot.workspaces.length,
            counts: {
              movements: all.reduce((n, d) => n + d.movements.length, 0),
              goals: all.reduce((n, d) => n + d.goals.length, 0),
              debts: all.reduce((n, d) => n + d.debts.length, 0),
              assets: all.reduce((n, d) => n + d.assets.length, 0),
              clients: all.reduce((n, d) => n + d.clients.length, 0),
              products: all.reduce((n, d) => n + d.products.length, 0),
              invoices: all.reduce((n, d) => n + d.invoices.length, 0),
            },
          };
        }

        if (!state.activeWorkspaceId) return formFail('Primero elige o crea un espacio de trabajo.');
        if (!canManageWorkspace(state.workspaces.find((w) => w.id === state.activeWorkspaceId))) {
          return formFail('Esta copia reemplazaría todos los datos de un espacio que es de otra persona. Solo su dueño puede restaurar una copia sobre él.');
        }
        // Si el respaldo no trae las categorías de fábrica, se añaden para que la app siga siendo usable.
        const data = { ...parsed.data, categories: [...parsed.data.categories, ...missingBuiltInCategories(parsed.data.categories)] };
        const failure = await tryWrite(() => dataStore.replaceAll(data));
        if (failure) return failure;
        const id = state.activeWorkspaceId;
        state = {
          ...state,
          status: 'ready',
          data,
          profile: { ...state.profile, displayName: data.settings.displayName },
          workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, openingBalanceCents: data.settings.openingBalanceCents } : w)),
        };
        emit();
        return {
          ok: /** @type {const} */ (true),
          kind: /** @type {const} */ ('workspace'),
          counts: { movements: data.movements.length, goals: data.goals.length, debts: data.debts.length, assets: data.assets.length, clients: data.clients.length, products: data.products.length, invoices: data.invoices.length },
        };
      });
    },

    /**
     * Borra TODO (todos los espacios y el nombre) y vuelve al estado inicial: la próxima pantalla es la de
     * elegir modalidad.
     */
    clearAllData() {
      return enqueue(async () => {
        const failure = await tryWrite(() => root.clearEverything());
        if (failure) return failure;
        const [workspaces, profile] = await Promise.all([root.listWorkspaces(), root.getProfile()]);
        const active = pickActiveWorkspace(workspaces, profile);
        dataStore = active ? openStore(active.id) : NO_WORKSPACE;
        const data = active ? await dataStore.load() : { ...emptyData(), categories: defaultCategories() };
        state = { status: 'ready', error: '', data, workspaces, activeWorkspaceId: active?.id ?? null, profile };
        emit();
        return { ok: /** @type {const} */ (true) };
      });
    },
  };
}
