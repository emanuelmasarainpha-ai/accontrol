// @ts-check
// =============================================================================
// ESPACIOS DE TRABAJO
// -----------------------------------------------------------------------------
// Un espacio de trabajo es un conjunto de datos aislado: «Mi espacio personal»,
// «Mi emprendimiento», «Empresa ABC»... Un ingreso de un espacio nunca aparece en
// otro, y cada espacio tiene su propio saldo inicial.
//
// Para los cálculos (`domain/`) un espacio es simplemente otro `AppData`: por eso
// patrimonio, deudas, estadísticas, calculadoras y exportación funcionan igual en
// todos. Lo que cambia es QUÉ datos se cargan (eso lo decide la capa `data/`).
//
// Hoy el "usuario" es el propio dispositivo (no hay cuentas hasta la Etapa 2). Por eso
// los roles, los empleados y las invitaciones NO existen todavía: sin un servidor que
// los haga cumplir, serían de mentira.
// =============================================================================

import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Workspace} Workspace */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */
/** @typedef {import('./types.js').Profile} Profile */

/** Id fijo del primer espacio de quien ya tenía datos antes de que existieran los espacios. */
export const PERSONAL_WORKSPACE_ID = 'ws-personal';

/** @type {readonly WorkspaceKind[]} */
export const WORKSPACE_KINDS = ['personal', 'freelancer', 'entrepreneur', 'company'];

/**
 * Textos de cada modalidad (tarjetas de la pantalla de inicio y del selector).
 * `included` = lo que YA existe hoy en ese espacio; `soon` = lo planificado. No se mezclan,
 * para no prometer lo que todavía no está construido.
 * @type {Record<WorkspaceKind, { label: string, defaultName: string, tagline: string, icon: string, included: string[], soon: string[] }>}
 */
export const KIND_INFO = {
  personal: {
    label: 'Personal',
    defaultName: 'Mi espacio personal',
    tagline: 'Tus finanzas personales',
    icon: 'user',
    included: ['Ingresos y gastos', 'Presupuesto', 'Deudas', 'Metas de ahorro', 'Patrimonio neto', 'Diagnóstico financiero y viabilidad de cada meta', 'Logros, rachas y niveles', 'Estadísticas y calculadoras'],
    soon: ['IA financiera personal'],
  },
  freelancer: {
    label: 'Freelancer',
    defaultName: 'Mi espacio freelancer',
    tagline: 'Para profesionales independientes',
    icon: 'briefcase',
    included: ['Ingresos y gastos profesionales', 'Clientes y servicios, con lo cobrado y lo que te deben', 'Ranking de clientes y flujo de caja', 'Gastos cargados a cada cliente: cuánto te deja de verdad', 'Facturas internas a tus clientes, ligadas a sus servicios, con cobros parciales y PDF', 'Recordatorio de cobro listo para copiar y enviar tú', 'Datos profesionales en los reportes', 'Diagnóstico financiero y viabilidad de cada meta', 'Logros, rachas y niveles', 'Estadísticas y calculadoras', 'Exportar a PDF, Excel y CSV'],
    soon: ['Envío automático de recordatorios (con las notificaciones)'],
  },
  entrepreneur: {
    label: 'Emprendedor',
    defaultName: 'Mi emprendimiento',
    tagline: 'Para pequeños negocios',
    icon: 'store',
    included: ['Ingresos y gastos del negocio, separados de los personales', 'Estado de resultados con beneficio, margen y rentabilidad', 'Comparación con el mes anterior y el año anterior', 'Proyección de ingresos, gastos y beneficio', 'Inventario: productos, stock, proveedores, compras y ventas', 'Margen por producto y avisos de stock bajo', 'Facturas internas con cobros parciales, cuentas por cobrar y PDF de cada factura', 'Recordatorio de cobro listo para copiar y enviar tú', 'Datos del negocio en los reportes', 'Diagnóstico financiero y viabilidad de cada meta', 'Logros, rachas y niveles', 'Estadísticas y calculadoras', 'Exportar a PDF, Excel y CSV'],
    soon: ['IA financiera del negocio'],
  },
  company: {
    label: 'Empresa',
    defaultName: 'Mi empresa',
    tagline: 'Para organizaciones',
    icon: 'building',
    included: ['Ingresos y gastos del espacio', 'Estado de resultados, comparación y proyección', 'Salud financiera: punto de equilibrio, meses de efectivo y peso de la deuda', 'Inventario: productos, stock, proveedores, compras y ventas', 'Facturas internas con cobros parciales, cuentas por cobrar y PDF de cada factura', 'Recordatorio de cobro listo para copiar y enviar tú', 'Departamentos con presupuesto mensual y gastos por área', 'Datos de la organización en los reportes', 'Viabilidad de cada meta de ahorro', 'Logros, rachas y niveles', 'Estadísticas y exportación'],
    soon: ['Empleados, roles e invitaciones (llegan con las cuentas)', 'Sucursales'],
  },
};

/**
 * Monedas que existen. Cada espacio guarda la suya, pero hoy solo hay pesos dominicanos (RD$): ampliar la
 * lista exige también cambiar cómo se muestran y se suman los montos en toda la app.
 * @type {Record<'DOP', { code: 'DOP', symbol: string, label: string }>}
 */
export const CURRENCY_INFO = {
  DOP: { code: 'DOP', symbol: 'RD$', label: 'Peso dominicano' },
};

/** @param {unknown} value @returns {value is WorkspaceKind} */
export function isWorkspaceKind(value) {
  return typeof value === 'string' && /** @type {readonly string[]} */ (WORKSPACE_KINDS).includes(value);
}

// ---- Un espacio de cada tipo por cuenta (0.17.4) ------------------------------------------------------------------
// Cada cuenta puede ser DUEÑA de un solo espacio de cada tipo (uno Personal, uno Freelancer, uno Emprendedor y uno
// Empresa). Los espacios de otras personas a los que te invitaron no cuentan: son de su dueño. Si ya había más de uno de
// un tipo (de antes de esta regla), se conservan con sus datos; solo no se pueden crear más.

/**
 * Tu espacio (del que eres dueño) de ese tipo, o null si no tienes.
 * @param {readonly { kind: string, name: string, role?: string }[]} workspaces @param {string} kind
 */
export function ownedWorkspaceOfKind(workspaces, kind) {
  return workspaces.find((w) => w.kind === kind && (w.role ?? 'owner') === 'owner') ?? null;
}

/** Los tipos de espacio que todavía puedes crear. @param {readonly { kind: string, name: string, role?: string }[]} workspaces */
export function availableKinds(workspaces) {
  return WORKSPACE_KINDS.filter((k) => !ownedWorkspaceOfKind(workspaces, k));
}

/** El aviso cuando ya tienes uno de ese tipo. @param {{ kind: WorkspaceKind, name: string }} existing */
export function oneOfEachMessage(existing) {
  return `Ya tienes un espacio ${KIND_INFO[existing.kind].label} («${existing.name}»). Solo puedes tener uno de cada tipo: ábrelo desde tus espacios.`;
}

/** @returns {Profile} */
export function defaultProfile() {
  return { displayName: '', lastWorkspaceId: null };
}

/** @param {unknown} raw @returns {string} */
export function normalizeWorkspaceName(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/** @param {string} text */
const fold = (text) => text.toLocaleLowerCase('es');

/**
 * Valida el nombre de un espacio: no vacío, no muy largo y que no se repita (sin importar mayúsculas).
 * @param {unknown} raw
 * @param {{ existing: Workspace[], exceptId?: string | null }} context
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateWorkspaceName(raw, { existing, exceptId = null }) {
  const name = normalizeWorkspaceName(raw);
  if (!name) return { ok: false, error: 'Ponle un nombre a tu espacio.' };
  if (name.length > LIMITS.workspaceName) return { ok: false, error: `Máximo ${LIMITS.workspaceName} caracteres.` };
  if (existing.some((w) => w.id !== exceptId && fold(w.name) === fold(name))) {
    return { ok: false, error: 'Ya tienes un espacio con ese nombre.' };
  }
  return { ok: true, name };
}

/**
 * Nombre sugerido para un espacio nuevo: «Mi emprendimiento», «Mi emprendimiento 2», ...
 * @param {WorkspaceKind} kind @param {Workspace[]} existing
 */
export function suggestWorkspaceName(kind, existing) {
  const base = KIND_INFO[kind].defaultName;
  const taken = new Set(existing.map((w) => fold(w.name)));
  if (!taken.has(fold(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(fold(candidate)) && candidate.length <= LIMITS.workspaceName) return candidate;
  }
  return base;
}

/**
 * Arma el registro de un espacio nuevo (sin guardarlo).
 * @param {{ kind: WorkspaceKind, name: string, isDefault?: boolean, openingBalanceCents?: number }} input
 * @param {{ id: string, nowISO: string }} context
 * @returns {Workspace}
 */
export function buildWorkspace({ kind, name, isDefault = false, openingBalanceCents = 0 }, { id, nowISO }) {
  return { id, kind, name, currency: 'DOP', openingBalanceCents, isDefault, createdAt: nowISO, updatedAt: nowISO };
}

/** Del más viejo al más nuevo (el orden en que se crearon). @param {Workspace[]} list */
export function sortWorkspaces(list) {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Espacio con el que se abre la app: el último usado, si existe; si no, el predeterminado; si no, el primero.
 * @param {Workspace[]} workspaces @param {Profile} profile
 * @returns {Workspace | null}
 */
export function pickActiveWorkspace(workspaces, profile) {
  if (workspaces.length === 0) return null;
  const last = workspaces.find((w) => w.id === profile.lastWorkspaceId);
  if (last) return last;
  const sorted = sortWorkspaces(workspaces);
  return sorted.find((w) => w.isDefault) ?? sorted[0];
}

/**
 * Al actualizar una instalación que ya existía: ¿tiene datos del usuario? Si sí, sus datos pasan a
 * «Mi espacio personal»; si no (solo las categorías de fábrica), se trata como instalación nueva y
 * verá la pantalla de elegir modalidad.
 * @param {{ records: number, displayName?: string, openingBalanceCents?: number }} found
 */
export function hasUserData({ records, displayName = '', openingBalanceCents = 0 }) {
  return records > 0 || displayName.trim() !== '' || openingBalanceCents > 0;
}

/**
 * Plan de la actualización de una instalación vieja (sin espacios): si tiene datos del usuario, crea
 * «Mi espacio personal» con TODO lo que ya había y lo deja como predeterminado y último usado; si no,
 * no crea nada (la persona verá la pantalla de elegir modalidad).
 * @param {{ records: number, displayName?: string, openingBalanceCents?: number }} found
 * @param {string} nowISO
 * @returns {{ workspace: Workspace, profile: Profile } | null}
 */
export function planLegacyMigration(found, nowISO) {
  if (!hasUserData(found)) return null;
  const workspace = buildWorkspace(
    { kind: 'personal', name: KIND_INFO.personal.defaultName, isDefault: true, openingBalanceCents: found.openingBalanceCents ?? 0 },
    { id: PERSONAL_WORKSPACE_ID, nowISO },
  );
  return { workspace, profile: { displayName: found.displayName ?? '', lastWorkspaceId: workspace.id } };
}

/**
 * Deja un espacio como predeterminado y a los demás no.
 * @param {Workspace[]} workspaces @param {string} id @param {string} nowISO
 * @returns {Workspace[]}
 */
export function withDefault(workspaces, id, nowISO) {
  return workspaces.map((w) => (w.isDefault === (w.id === id) ? w : { ...w, isDefault: w.id === id, updatedAt: nowISO }));
}

/**
 * Qué espacio queda como predeterminado cuando se borra el que lo era (el más antiguo que quede).
 * @param {Workspace[]} remaining
 * @returns {string | null}
 */
export function nextDefaultId(remaining) {
  if (remaining.length === 0 || remaining.some((w) => w.isDefault)) return null;
  return sortWorkspaces(remaining)[0].id;
}
