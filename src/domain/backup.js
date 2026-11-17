// @ts-check
// =============================================================================
// COPIA DE SEGURIDAD (exportar / importar)
// -----------------------------------------------------------------------------
// Por ahora tus datos viven solo en este dispositivo, así que la copia de
// seguridad es tu red de protección (y la forma de pasar datos del celular a
// la computadora). Es un archivo JSON legible.
//
// Hay dos tipos de copia:
//  - de UN espacio de trabajo (la que ya existía; los respaldos viejos son de este tipo), y
//  - COMPLETA: todos tus espacios y tu nombre (`kind: "full"`, desde la versión 4).
//
// Al IMPORTAR no se confía en el archivo: cada registro se revisa campo por
// campo y solo se copian los campos conocidos. Si algo no cuadra, no se
// importa nada y se explica por qué.
// =============================================================================

import {
  annualRatePercent, FREQUENCIES, installmentDates, isValidCollateral, MAX_ANNUAL_RATE_BP, MAX_INSTALLMENTS, paymentsFitDebt,
} from './debts.js';
import { isAssetCategory, isValidSubtype, MIN_ASSET_DATE } from './assets.js';
import { isServiceStatus, MAX_ESTIMATED_DAYS, MAX_SERVICE_DATE, MIN_SERVICE_DATE } from './clients.js';
import { isValidEmail, isValidPhone } from './contact.js';
import { isStockKind, isValidProductImage, MAX_PACK_QTY, MAX_QUANTITY, replayProduct } from './inventory.js';
import { billedByService, invoiceTotals, MAX_DUE_DAYS, MAX_TAX_BP, MIN_INVOICE_DATE } from './invoices.js';
import { defaultCategories } from './categories.js';
import { addDays, isValidISODate, isValidTime } from './dates.js';
import { MAX_CENTS } from './money.js';
import { CLASSIFICATIONS_BY_TYPE, LIMITS, SCHEMA_VERSION } from './types.js';
import { isOrganizationEmpty, kindHasOrganization, normalizeOrganization, validateOrganization } from './organization.js';
import { isWorkspaceKind, normalizeWorkspaceName, sortWorkspaces } from './workspaces.js';

/** @typedef {import('./types.js').AppData} AppData */
/** @typedef {import('./types.js').Classification} Classification */
/** @typedef {import('./types.js').Workspace} Workspace */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */
/** @typedef {import('./types.js').Profile} Profile */

export const BACKUP_APP_ID = 'accontrol';

/** Máximo de valores registrados por activo. */
const MAX_VALUATIONS = 2000;

/** Tamaño máximo de archivo de respaldo aceptado (protege contra archivos enormes). */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** Las categorías de fábrica, por id: su definición siempre la manda la app, no el archivo. */
const FACTORY = new Map(defaultCategories().map((c) => [c.id, c]));

/** @param {AppData} data */
function dataSections(data) {
  return {
    categories: data.categories,
    movements: data.movements,
    goals: data.goals,
    contributions: data.contributions,
    debts: data.debts,
    debtPayments: data.debtPayments,
    assets: data.assets,
    clients: data.clients,
    services: data.services,
    products: data.products,
    suppliers: data.suppliers,
    stockEntries: data.stockEntries,
    invoices: data.invoices,
    invoicePayments: data.invoicePayments,
    departments: data.departments,
  };
}

/**
 * Copia de UN espacio de trabajo. `workspace` (tipo y nombre) es solo informativo: al importar se
 * muestra de qué espacio viene, pero los datos se restauran en el espacio que la persona tenga abierto.
 * @param {AppData} data
 * @param {string} nowISO
 * @param {{ kind: WorkspaceKind, name: string }} [workspace]
 */
export function createBackup(data, nowISO, workspace) {
  return {
    app: BACKUP_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO,
    ...(workspace ? { workspace: { kind: workspace.kind, name: workspace.name } } : {}),
    data: { ...dataSections(data), settings: data.settings },
  };
}

/**
 * Copia COMPLETA: todos los espacios y el nombre de la persona. El saldo inicial de cada espacio viaja en
 * su registro (no se repite dentro de los datos).
 * @param {{ profile: Profile, workspaces: { workspace: Workspace, data: AppData }[] }} snapshot
 * @param {string} nowISO
 */
export function createFullBackup(snapshot, nowISO) {
  return {
    app: BACKUP_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    kind: 'full',
    exportedAt: nowISO,
    profile: { displayName: snapshot.profile.displayName, lastWorkspaceId: snapshot.profile.lastWorkspaceId },
    workspaces: snapshot.workspaces.map(({ workspace, data }) => ({
      workspace: {
        id: workspace.id, kind: workspace.kind, name: workspace.name, currency: workspace.currency,
        openingBalanceCents: workspace.openingBalanceCents, isDefault: workspace.isDefault,
        ...(kindHasOrganization(workspace.kind) && !isOrganizationEmpty(workspace.organization)
          ? { organization: normalizeOrganization(workspace.organization) }
          : {}),
        createdAt: workspace.createdAt, updatedAt: workspace.updatedAt,
      },
      data: dataSections(data),
    })),
  };
}

/**
 * Nombre de archivo sugerido: accontrol-respaldo-2026-07-05.json
 * (con `label`: accontrol-respaldo-mi-negocio-2026-07-05.json)
 * @param {string} today @param {string} [label]
 */
export function backupFileName(today, label) {
  const slug = label ? slugify(label) : '';
  return `accontrol-respaldo-${slug ? `${slug}-` : ''}${today}.json`;
}

/** Nombre de archivo de la copia completa. @param {string} today */
export function fullBackupFileName(today) {
  return `accontrol-respaldo-completo-${today}.json`;
}

/** @param {string} text */
function slugify(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

/**
 * Lee el archivo y comprueba lo básico (es de ACCONTROL, no es de una versión más nueva).
 * @param {string} text
 * @returns {{ ok: true, parsed: Record<string, any> } | { ok: false, error: string }}
 */
function readEnvelope(text) {
  if (typeof text !== 'string' || text.length === 0) return fail('El archivo está vacío.');
  if (text.length > MAX_BACKUP_BYTES) return fail('El archivo es demasiado grande.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('El archivo no es un respaldo válido (no se pudo leer como JSON).');
  }

  if (!isObject(parsed) || parsed.app !== BACKUP_APP_ID) {
    return fail('Este archivo no es un respaldo de ACCONTROL.');
  }
  if (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion > SCHEMA_VERSION) {
    return fail('Este respaldo viene de una versión más nueva de ACCONTROL. Actualiza la app e inténtalo de nuevo.');
  }
  return { ok: true, parsed };
}

/**
 * Lee y valida el respaldo de UN espacio (el formato de siempre). Un respaldo puede haberse editado a mano,
 * así que se exigen las mismas reglas que la app aplica al registrar datos (si no, se podría "fabricar" dinero).
 * @param {string} text Contenido del archivo.
 * @param {{ today?: string }} [options]  `today` ("AAAA-MM-DD"): si se indica, se rechazan registros con fecha futura.
 * @returns {{ ok: true, data: AppData, workspace: { kind: WorkspaceKind, name: string } | null } | { ok: false, error: string }}
 */
export function parseBackup(text, { today } = {}) {
  const envelope = readEnvelope(text);
  if (!envelope.ok) return envelope;
  const { parsed } = envelope;
  if (parsed.kind === 'full') {
    return fail('Este archivo es una copia COMPLETA (todos tus espacios). Impórtala con «Restaurar copia completa».');
  }
  if (!isObject(parsed.data)) return fail('El respaldo no contiene datos.');
  try {
    const data = validateData(parsed.data, { today, ids: new Set() });
    return { ok: true, data, workspace: readWorkspaceHint(parsed.workspace) };
  } catch (error) {
    return fail(`Respaldo no válido. ${error instanceof Error ? error.message : ''}`.trim());
  }
}

/**
 * Lee cualquiera de los dos tipos de copia.
 * @param {string} text
 * @param {{ today?: string }} [options]
 * @returns {{ ok: true, kind: 'workspace', data: AppData, workspace: { kind: WorkspaceKind, name: string } | null }
 *   | { ok: true, kind: 'full', profile: Profile, workspaces: { workspace: Workspace, data: AppData }[] }
 *   | { ok: false, error: string }}
 */
export function parseAnyBackup(text, { today } = {}) {
  const envelope = readEnvelope(text);
  if (!envelope.ok) return envelope;
  if (envelope.parsed.kind !== 'full') {
    const single = parseBackup(text, { today });
    return single.ok ? { ok: true, kind: 'workspace', data: single.data, workspace: single.workspace } : single;
  }
  try {
    return { ok: true, kind: 'full', ...validateFull(envelope.parsed, today) };
  } catch (error) {
    return fail(`Respaldo no válido. ${error instanceof Error ? error.message : ''}`.trim());
  }
}

/** Tipo y nombre del espacio de origen (solo informativo): si no es válido, simplemente se ignora. @param {unknown} raw */
function readWorkspaceHint(raw) {
  if (!isObject(raw) || !isWorkspaceKind(raw.kind) || typeof raw.name !== 'string') return null;
  const name = normalizeWorkspaceName(raw.name);
  return name && name.length <= LIMITS.workspaceName ? { kind: raw.kind, name } : null;
}

/**
 * @param {Record<string, any>} parsed
 * @param {string | undefined} today
 * @returns {{ profile: Profile, workspaces: { workspace: Workspace, data: AppData }[] }}
 */
function validateFull(parsed, today) {
  if (!isObject(parsed.profile)) throw new Error('Falta el perfil en la copia.');
  const displayName = parsed.profile.displayName;
  if (typeof displayName !== 'string' || displayName.length > LIMITS.displayName) throw new Error('Perfil: nombre no válido.');
  if (!Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) throw new Error('La copia no trae ningún espacio de trabajo.');
  if (parsed.workspaces.length > LIMITS.maxWorkspaces) throw new Error(`La copia trae más de ${LIMITS.maxWorkspaces} espacios.`);

  /** @type {Set<string>} */
  const ids = new Set(); // ids de TODOS los registros de TODOS los espacios: ninguno se puede repetir
  /** @type {Set<string>} */
  const workspaceIds = new Set();
  /** @type {Set<string>} */
  const names = new Set();

  /** @type {{ workspace: Workspace, data: AppData }[]} */
  const workspaces = parsed.workspaces.map((/** @type {any} */ entry, /** @type {number} */ i) => {
    const w = `Espacio #${i + 1}`;
    record(entry, w);
    const raw = entry.workspace;
    record(raw, w);
    text_(raw.id, w, 'id', 80);
    if (workspaceIds.has(raw.id)) throw new Error(`${w}: el identificador «${raw.id}» está repetido.`);
    workspaceIds.add(raw.id);
    if (!isWorkspaceKind(raw.kind)) throw new Error(`${w}: modalidad no válida.`);
    const name = normalizeWorkspaceName(raw.name);
    if (!name || name.length > LIMITS.workspaceName) throw new Error(`${w}: nombre no válido.`);
    if (names.has(name.toLocaleLowerCase('es'))) throw new Error(`${w}: el nombre «${name}» está repetido.`);
    names.add(name.toLocaleLowerCase('es'));
    if (raw.currency !== 'DOP') throw new Error(`${w}: moneda no válida.`);
    if (!Number.isSafeInteger(raw.openingBalanceCents) || raw.openingBalanceCents < 0 || raw.openingBalanceCents > MAX_CENTS) {
      throw new Error(`${w}: saldo inicial no válido.`);
    }
    if (typeof raw.isDefault !== 'boolean') throw new Error(`${w}: marca de predeterminado no válida.`);
    // Los datos de la organización son opcionales (las copias anteriores no los traen) y solo existen en espacios
    // que no son Personal. Si vienen mal escritos, se rechaza la copia con el motivo, como el resto de los campos.
    /** @type {import('./types.js').Organization | undefined} */
    let organization;
    if (raw.organization !== undefined) {
      record(raw.organization, `${w}: datos de la organización`);
      const checked = validateOrganization(raw.organization);
      if (!checked.ok) throw new Error(`${w}: datos de la organización no válidos (${Object.values(checked.errors).join(' ')})`);
      if (kindHasOrganization(raw.kind) && !isOrganizationEmpty(checked.organization)) organization = checked.organization;
    }
    record(entry.data, w);
    const data = validateData(
      { ...entry.data, settings: { displayName, openingBalanceCents: raw.openingBalanceCents } },
      { today, ids },
    );
    /** @type {Workspace} */
    const workspace = {
      id: raw.id, kind: raw.kind, name, currency: 'DOP', openingBalanceCents: raw.openingBalanceCents,
      isDefault: raw.isDefault, ...(organization ? { organization } : {}),
      createdAt: iso(raw.createdAt, w), updatedAt: iso(raw.updatedAt, w),
    };
    return { workspace, data };
  });

  // Exactamente un espacio predeterminado: si el archivo trae ninguno o varios, queda el más antiguo marcado.
  const flagged = sortWorkspaces(workspaces.map((x) => x.workspace)).find((w) => w.isDefault);
  const defaultId = flagged ? flagged.id : sortWorkspaces(workspaces.map((x) => x.workspace))[0].id;
  for (const entry of workspaces) entry.workspace = { ...entry.workspace, isDefault: entry.workspace.id === defaultId };

  const last = parsed.profile.lastWorkspaceId;
  const lastWorkspaceId = typeof last === 'string' && workspaceIds.has(last) ? last : null;
  return { profile: { displayName, lastWorkspaceId }, workspaces };
}

/**
 * Valida y limpia los datos de un espacio. Lanza un Error con el motivo si algo no cuadra.
 * @param {Record<string, any>} d
 * @param {{ today?: string, ids: Set<string> }} options  `ids`: los ids ya usados (en la copia completa se comparte entre espacios)
 * @returns {AppData}
 */
function validateData(d, { today, ids }) {
  for (const key of ['categories', 'movements', 'goals', 'contributions']) {
    if (!Array.isArray(d[key])) throw new Error(`Falta la sección «${key}» en el respaldo.`);
  }
  // Las deudas llegaron en la versión 2 del formato: un respaldo anterior simplemente no las trae.
  // Los activos llegaron en la versión 3, los clientes y servicios en la 5, el inventario en la 6, las facturas en la 7 y los
  // departamentos en la 8: un respaldo anterior tampoco los trae.
  for (const key of ['debts', 'debtPayments', 'assets', 'clients', 'services', 'products', 'suppliers', 'stockEntries', 'invoices', 'invoicePayments', 'departments']) {
    if (d[key] !== undefined && !Array.isArray(d[key])) throw new Error(`La sección «${key}» del respaldo no es válida.`);
  }
  if (!isObject(d.settings)) throw new Error('Faltan los ajustes en el respaldo.');

  /** @param {string} id @param {string} where */
  const uniqueId = (id, where) => {
    // Los ids de las categorías de fábrica son de todos los espacios: ningún otro registro puede usarlos.
    if (ids.has(id) || FACTORY.has(id)) throw new Error(`${where}: el identificador «${id}» está repetido.`);
    ids.add(id);
  };
  /** @type {Set<string>} */
  const seenFactory = new Set();

  const categories = d.categories.map((/** @type {any} */ c, /** @type {number} */ i) => {
    const w = `Categoría #${i + 1}`;
    record(c, w);
    text_(c.id, w, 'id', 80);
    const factory = FACTORY.get(c.id);
    if (factory) {
      if (seenFactory.has(c.id)) throw new Error(`${w}: el identificador «${c.id}» está repetido.`);
      seenFactory.add(c.id);
    } else {
      uniqueId(c.id, w);
    }
    text_(c.name, w, 'nombre', LIMITS.categoryName);
    oneOf(c.kind, ['income', 'expense'], w, 'tipo');
    oneOf(c.defaultClassification, CLASSIFICATIONS_BY_TYPE[c.kind], w, 'clasificación');
    // Las categorías de fábrica siempre valen lo que dice la app (un archivo editado no puede cambiarlas),
    // y ninguna categoría propia puede hacerse pasar por "de fábrica".
    if (factory) return { ...factory };
    return { id: c.id, name: c.name, kind: c.kind, defaultClassification: c.defaultClassification, builtIn: false };
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // ---- Clientes y servicios (módulo Freelancer, versión 5) ------------------
  const clients = (d.clients ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Cliente #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    text_(x.firstName, w, 'nombre', LIMITS.clientName);
    optionalText(x.lastName, w, 'apellido', LIMITS.clientName);
    optionalText(x.company, w, 'empresa', LIMITS.clientCompany);
    optionalText(x.email, w, 'correo', LIMITS.clientEmail);
    if (x.email !== '' && !isValidEmail(x.email)) throw new Error(`${w}: correo no válido.`);
    optionalText(x.phone, w, 'teléfono', LIMITS.clientPhone);
    if (x.phone !== '' && !isValidPhone(x.phone)) throw new Error(`${w}: teléfono no válido.`);
    optionalText(x.country, w, 'país', LIMITS.clientCountry);
    optionalText(x.notes, w, 'notas', LIMITS.clientNotes);
    if (typeof x.archived !== 'boolean') throw new Error(`${w}: marca de archivado no válida.`);
    return {
      id: x.id, firstName: x.firstName, lastName: x.lastName, company: x.company, email: x.email, phone: x.phone,
      country: x.country, notes: x.notes, archived: x.archived, createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  const clientIds = new Set(clients.map((c) => c.id));

  const services = (d.services ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Servicio #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    if (!clientIds.has(x.clientId)) throw new Error(`${w}: pertenece a un cliente que no existe en el respaldo.`);
    text_(x.name, w, 'nombre', LIMITS.serviceName);
    cents(x.priceCents, w);
    if (x.estimatedDays !== null && (!Number.isSafeInteger(x.estimatedDays) || x.estimatedDays < 1 || x.estimatedDays > MAX_ESTIMATED_DAYS)) {
      throw new Error(`${w}: duración estimada no válida.`);
    }
    if (!isServiceStatus(x.status)) throw new Error(`${w}: estado no válido.`);
    if (x.startDate !== '' && (!isValidISODate(x.startDate) || x.startDate < MIN_SERVICE_DATE || x.startDate > MAX_SERVICE_DATE)) {
      throw new Error(`${w}: fecha de inicio no válida.`);
    }
    return {
      id: x.id, clientId: x.clientId, name: x.name, priceCents: x.priceCents, estimatedDays: x.estimatedDays,
      status: x.status, startDate: x.startDate, createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  const serviceById = new Map(services.map((x) => [x.id, x]));

  // ---- Departamentos (módulo Empresa, versión 8) ---------------------------
  const departments = (d.departments ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Departamento #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    text_(x.name, w, 'nombre', LIMITS.departmentName);
    // El presupuesto puede ser 0 (= sin presupuesto), a diferencia de los montos de dinero registrados.
    if (!Number.isSafeInteger(x.monthlyBudgetCents) || x.monthlyBudgetCents < 0 || x.monthlyBudgetCents > MAX_CENTS) {
      throw new Error(`${w}: presupuesto mensual no válido.`);
    }
    if (typeof x.archived !== 'boolean') throw new Error(`${w}: marca de archivado no válida.`);
    return {
      id: x.id, name: x.name, monthlyBudgetCents: x.monthlyBudgetCents, archived: x.archived,
      createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  if (departments.length > LIMITS.maxDepartments) throw new Error(`Hay más de ${LIMITS.maxDepartments} departamentos en el respaldo.`);
  const seenDepartmentNames = new Set();
  for (const dep of departments) {
    const key = dep.name.toLocaleLowerCase('es');
    if (seenDepartmentNames.has(key)) throw new Error(`Departamento «${dep.name}»: el nombre está repetido.`);
    seenDepartmentNames.add(key);
  }
  const departmentIds = new Set(departments.map((x) => x.id));

  const movements = d.movements.map((/** @type {any} */ m, /** @type {number} */ i) => {
    const w = `Movimiento #${i + 1}`;
    record(m, w);
    text_(m.id, w, 'id', 80);
    uniqueId(m.id, w);
    oneOf(m.type, ['income', 'expense'], w, 'tipo');
    cents(m.amountCents, w);
    dateAndTime(m, w, today);
    text_(m.description, w, 'descripción', LIMITS.description);
    oneOf(m.classification, CLASSIFICATIONS_BY_TYPE[m.type], w, 'clasificación');
    const cat = categoryById.get(m.categoryId);
    if (!cat) throw new Error(`${w}: usa una categoría que no existe en el respaldo.`);
    if (cat.kind !== m.type) throw new Error(`${w}: su categoría no corresponde a su tipo.`);
    // Vínculo con un cliente (un ingreso, o un gasto cargado a ese cliente) y con un servicio (solo ingresos): deben existir
    // en el respaldo y coincidir entre sí.
    const hasClient = m.clientId !== undefined;
    const hasService = m.serviceId !== undefined;
    if (hasClient || hasService) {
      if (hasService && m.type !== 'income') throw new Error(`${w}: solo un ingreso puede estar vinculado a un servicio.`);
      if (!hasClient || !clientIds.has(m.clientId)) throw new Error(`${w}: está vinculado a un cliente que no existe en el respaldo.`);
      if (hasService) {
        const linkedService = serviceById.get(m.serviceId);
        if (!linkedService) throw new Error(`${w}: está vinculado a un servicio que no existe en el respaldo.`);
        if (linkedService.clientId !== m.clientId) throw new Error(`${w}: su servicio no es de su cliente.`);
      }
    }
    // Departamento al que se carga un gasto: debe existir en el respaldo.
    const hasDepartment = m.departmentId !== undefined;
    if (hasDepartment) {
      if (m.type !== 'expense') throw new Error(`${w}: solo un gasto puede estar cargado a un departamento.`);
      if (typeof m.departmentId !== 'string' || !departmentIds.has(m.departmentId)) throw new Error(`${w}: está cargado a un departamento que no existe en el respaldo.`);
    }
    return {
      id: m.id, type: m.type, amountCents: m.amountCents, date: m.date, time: m.time,
      description: m.description, classification: m.classification, categoryId: m.categoryId,
      createdAt: iso(m.createdAt, w), updatedAt: iso(m.updatedAt, w),
      ...(hasClient ? { clientId: m.clientId } : {}),
      ...(hasService ? { serviceId: m.serviceId } : {}),
      ...(hasDepartment ? { departmentId: m.departmentId } : {}),
      ...(m.isDemo === true ? { isDemo: true } : {}),
    };
  });

  const goals = d.goals.map((/** @type {any} */ g, /** @type {number} */ i) => {
    const w = `Meta #${i + 1}`;
    record(g, w);
    text_(g.id, w, 'id', 80);
    uniqueId(g.id, w);
    text_(g.name, w, 'nombre', LIMITS.goalName);
    if (typeof g.description !== 'string' || g.description.length > LIMITS.goalDescription) {
      throw new Error(`${w}: descripción no válida.`);
    }
    cents(g.targetCents, w);
    if (!isValidISODate(g.targetDate)) throw new Error(`${w}: fecha objetivo no válida.`);
    return {
      id: g.id, name: g.name, description: g.description, targetCents: g.targetCents,
      targetDate: g.targetDate, createdAt: iso(g.createdAt, w), updatedAt: iso(g.updatedAt, w),
      ...(g.isDemo === true ? { isDemo: true } : {}),
    };
  });
  const goalIds = new Set(goals.map((g) => g.id));

  const contributions = d.contributions.map((/** @type {any} */ c, /** @type {number} */ i) => {
    const w = `Aporte #${i + 1}`;
    record(c, w);
    text_(c.id, w, 'id', 80);
    uniqueId(c.id, w);
    if (!goalIds.has(c.goalId)) throw new Error(`${w}: pertenece a una meta que no existe en el respaldo.`);
    oneOf(c.kind, ['deposit', 'withdrawal'], w, 'tipo');
    cents(c.amountCents, w);
    dateAndTime(c, w, today);
    if (typeof c.note !== 'string' || c.note.length > LIMITS.note) throw new Error(`${w}: nota no válida.`);
    return {
      id: c.id, goalId: c.goalId, kind: c.kind, amountCents: c.amountCents, date: c.date, time: c.time,
      note: c.note, createdAt: iso(c.createdAt, w), updatedAt: iso(c.updatedAt, w),
      ...(c.isDemo === true ? { isDemo: true } : {}),
    };
  });

  // ---- Deudas y sus pagos (Etapa 3) ----------------------------------------
  const debts = (d.debts ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Deuda #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    text_(x.name, w, 'nombre', LIMITS.debtName);
    if (typeof x.note !== 'string' || x.note.length > LIMITS.debtNote) throw new Error(`${w}: nota no válida.`);
    cents(x.totalCents, w);
    oneOf(x.rateBasis, ['annual', 'monthly'], w, 'tipo de tasa');
    if (!Number.isSafeInteger(x.rateBp) || x.rateBp < 0 || annualRatePercent(x) * 100 > MAX_ANNUAL_RATE_BP) {
      throw new Error(`${w}: tasa de interés no válida.`);
    }
    oneOf(x.frequency, FREQUENCIES, w, 'frecuencia de pago');
    oneOf(x.collateralKind, ['physical', 'personal'], w, 'tipo de respaldo');
    if (!isValidCollateral(x.collateralKind, x.collateralType)) throw new Error(`${w}: garantía no válida.`);
    if (!isValidISODate(x.firstDueDate) || !isValidISODate(x.finalDueDate) || x.finalDueDate < x.firstDueDate) {
      throw new Error(`${w}: fechas de vencimiento no válidas.`);
    }
    if (!isValidTime(x.firstDueTime) || !isValidTime(x.finalDueTime)) throw new Error(`${w}: hora de vencimiento no válida.`);
    if (installmentDates(x).length > MAX_INSTALLMENTS) throw new Error(`${w}: tiene demasiadas cuotas.`);
    return {
      id: x.id, name: x.name, note: x.note, totalCents: x.totalCents, rateBp: x.rateBp, rateBasis: x.rateBasis,
      frequency: x.frequency, collateralKind: x.collateralKind, collateralType: x.collateralType,
      firstDueDate: x.firstDueDate, firstDueTime: x.firstDueTime, finalDueDate: x.finalDueDate, finalDueTime: x.finalDueTime,
      createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  const debtIds = new Set(debts.map((x) => x.id));
  const movementById = new Map(movements.map((m) => [m.id, m]));
  /** @type {Set<string>} */
  const linkedMovementIds = new Set();

  const debtPayments = (d.debtPayments ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Pago de deuda #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    if (!debtIds.has(x.debtId)) throw new Error(`${w}: pertenece a una deuda que no existe en el respaldo.`);
    oneOf(x.kind, ['regular', 'extra'], w, 'tipo');
    cents(x.amountCents, w);
    dateAndTime(x, w, today);
    if (typeof x.note !== 'string' || x.note.length > LIMITS.note) throw new Error(`${w}: nota no válida.`);
    // Cada pago tiene su gasto vinculado: así el dinero disponible y las estadísticas cuadran con la deuda.
    const linked = movementById.get(x.movementId);
    if (!linked || linked.type !== 'expense') throw new Error(`${w}: su gasto vinculado no existe en el respaldo.`);
    if (linkedMovementIds.has(x.movementId)) throw new Error(`${w}: comparte su gasto vinculado con otro pago.`);
    linkedMovementIds.add(x.movementId);
    if (linked.amountCents !== x.amountCents || linked.date !== x.date) {
      throw new Error(`${w}: no coincide con su gasto vinculado (monto o fecha).`);
    }
    return {
      id: x.id, debtId: x.debtId, kind: x.kind, amountCents: x.amountCents, date: x.date, time: x.time, note: x.note,
      movementId: x.movementId, createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  // Los pagos de cada deuda deben caber en lo que se debía (como al registrarlos en la app).
  for (const debt of debts) {
    if (!paymentsFitDebt(debt, debtPayments.filter((p) => p.debtId === debt.id))) {
      throw new Error(`Deuda «${debt.name}»: sus pagos superan lo que se debe.`);
    }
  }

  // ---- Activos (Etapa 4) ---------------------------------------------------
  const assets = (d.assets ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Activo #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    text_(x.name, w, 'nombre', LIMITS.assetName);
    if (!isAssetCategory(x.category)) throw new Error(`${w}: categoría no válida.`);
    if (typeof x.subtype !== 'string' || !isValidSubtype(x.category, x.subtype)) throw new Error(`${w}: tipo no válido.`);
    if (typeof x.description !== 'string' || x.description.length > LIMITS.assetDescription) throw new Error(`${w}: descripción no válida.`);
    if (!isValidISODate(x.acquiredDate) || x.acquiredDate < MIN_ASSET_DATE) throw new Error(`${w}: fecha de adquisición no válida.`);
    if (today && x.acquiredDate > today) throw new Error(`${w}: tiene fecha de adquisición futura (${x.acquiredDate}).`);
    if (!Array.isArray(x.valuations) || x.valuations.length === 0 || x.valuations.length > MAX_VALUATIONS) {
      throw new Error(`${w}: sus valores registrados no son válidos.`);
    }
    /** @type {string | null} */
    let previous = null;
    const valuations = x.valuations.map((/** @type {any} */ v) => {
      record(v, w);
      if (!isValidISODate(v.date) || v.date < x.acquiredDate) throw new Error(`${w}: un valor tiene fecha no válida.`);
      if (today && v.date > today) throw new Error(`${w}: un valor tiene fecha futura (${v.date}).`);
      if (previous !== null && v.date <= previous) throw new Error(`${w}: sus valores deben estar en orden y sin fechas repetidas.`);
      if (!Number.isSafeInteger(v.valueCents) || v.valueCents < 0 || v.valueCents > MAX_CENTS) throw new Error(`${w}: un valor no es válido.`);
      previous = v.date;
      return { date: v.date, valueCents: v.valueCents };
    });
    if (valuations[0].date !== x.acquiredDate) throw new Error(`${w}: su primer valor debe estar en la fecha de adquisición.`);
    return {
      id: x.id, name: x.name, category: x.category, subtype: x.subtype, description: x.description,
      acquiredDate: x.acquiredDate, valuations, createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });

  // ---- Inventario (versión 6): productos, proveedores y movimientos de stock -----------------------------------
  const products = (d.products ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Producto #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    text_(x.name, w, 'nombre', LIMITS.productName);
    optionalText(x.sku, w, 'código', LIMITS.productSku);
    text_(x.unit, w, 'unidad', LIMITS.productUnit);
    if (!Number.isSafeInteger(x.priceCents) || x.priceCents < 0 || x.priceCents > MAX_CENTS) throw new Error(`${w}: precio no válido.`);
    if (!Number.isSafeInteger(x.minStock) || x.minStock < 0 || x.minStock > MAX_QUANTITY) throw new Error(`${w}: stock mínimo no válido.`);
    optionalText(x.notes, w, 'notas', LIMITS.productNotes);
    if (typeof x.archived !== 'boolean') throw new Error(`${w}: marca de archivado no válida.`);
    // 0.17.0: grupo, «sin control de stock» y foto (las copias de antes no los traen).
    if (x.groupName !== undefined) optionalText(x.groupName, w, 'grupo', LIMITS.productGroup);
    if (x.trackStock !== undefined && typeof x.trackStock !== 'boolean') throw new Error(`${w}: marca de control de stock no válida.`);
    if (x.imageData !== undefined && !isValidProductImage(x.imageData)) throw new Error(`${w}: la foto no es una imagen JPG, PNG o WEBP válida.`);
    // 0.17.5: oferta por cantidad. Las dos van juntas (0 y 0 = sin oferta) y la oferta sale más barata que las sueltas.
    if ((x.packQty !== undefined) !== (x.packPriceCents !== undefined)) throw new Error(`${w}: la oferta por cantidad está incompleta.`);
    if (x.packQty !== undefined) {
      const none = x.packQty === 0 && x.packPriceCents === 0;
      const valid = Number.isSafeInteger(x.packQty) && x.packQty >= 2 && x.packQty <= MAX_PACK_QTY
        && Number.isSafeInteger(x.packPriceCents) && x.packPriceCents >= x.packQty && x.packPriceCents <= MAX_CENTS;
      if (!none && !valid) throw new Error(`${w}: la oferta por cantidad no es válida.`);
    }
    return {
      id: x.id, name: x.name, sku: x.sku, unit: x.unit, priceCents: x.priceCents, minStock: x.minStock, notes: x.notes,
      archived: x.archived, createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      // Tal cual: si el producto los traía, se conservan; si no (copias de antes de la 0.17.0), no se inventan.
      ...(x.groupName !== undefined ? { groupName: x.groupName } : {}),
      ...(x.trackStock !== undefined ? { trackStock: x.trackStock } : {}),
      ...(x.imageData !== undefined ? { imageData: x.imageData } : {}),
      ...(x.packQty !== undefined ? { packQty: x.packQty, packPriceCents: x.packPriceCents } : {}),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  const productIds = new Set(products.map((x) => x.id));

  const suppliers = (d.suppliers ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Proveedor #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    text_(x.name, w, 'nombre', LIMITS.supplierName);
    optionalText(x.contact, w, 'contacto', LIMITS.supplierContact);
    optionalText(x.email, w, 'correo', LIMITS.supplierEmail);
    if (x.email !== '' && !isValidEmail(x.email)) throw new Error(`${w}: correo no válido.`);
    optionalText(x.phone, w, 'teléfono', LIMITS.supplierPhone);
    if (x.phone !== '' && !isValidPhone(x.phone)) throw new Error(`${w}: teléfono no válido.`);
    optionalText(x.notes, w, 'notas', LIMITS.supplierNotes);
    if (typeof x.archived !== 'boolean') throw new Error(`${w}: marca de archivado no válida.`);
    return {
      id: x.id, name: x.name, contact: x.contact, email: x.email, phone: x.phone, notes: x.notes, archived: x.archived,
      createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  const supplierIds = new Set(suppliers.map((x) => x.id));

  // ---- Facturas internas (versión 7): facturas y sus cobros --------------------------------------------------
  /** @type {Set<string>} */
  const seenNumbers = new Set();
  const invoices = (d.invoices ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Factura #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    if (!Number.isSafeInteger(x.number) || x.number < 1) throw new Error(`${w}: número no válido.`);
    // Las facturas de demostración llevan su propia serie (DEMO-001…): el consecutivo se repite solo entre series distintas.
    const series = `${x.isDemo === true ? 'demo' : 'real'}:${x.number}`;
    if (seenNumbers.has(series)) throw new Error(`${w}: el número ${x.number} está repetido.`);
    seenNumbers.add(series);
    text_(x.customerName, w, 'cliente', LIMITS.customerName);
    optionalText(x.customerTaxId, w, 'RNC del cliente', LIMITS.customerTaxId);
    optionalText(x.customerContact, w, 'contacto del cliente', LIMITS.customerContact);
    if (x.customerContact !== '' && !isValidEmail(x.customerContact.replace(/\s+/g, '')) && !isValidPhone(x.customerContact)) {
      throw new Error(`${w}: contacto del cliente no válido.`);
    }
    if (!isValidISODate(x.issueDate) || x.issueDate < MIN_INVOICE_DATE) throw new Error(`${w}: fecha no válida.`);
    if (today && x.issueDate > today) throw new Error(`${w}: tiene fecha futura (${x.issueDate}). ACCONTROL solo registra lo que ya ocurrió.`);
    if (x.dueDate !== '' && (!isValidISODate(x.dueDate) || x.dueDate < x.issueDate || x.dueDate > addDays(x.issueDate, MAX_DUE_DAYS))) {
      throw new Error(`${w}: vencimiento no válido.`);
    }
    if (!Number.isSafeInteger(x.taxRateBp) || x.taxRateBp < 0 || x.taxRateBp > MAX_TAX_BP) throw new Error(`${w}: impuesto no válido.`);
    optionalText(x.notes, w, 'notas', LIMITS.invoiceNotes);
    // Freelancer (0.14.5): la ficha del cliente, si la lleva, debe existir en el respaldo.
    if (x.clientId !== undefined && (typeof x.clientId !== 'string' || !clientIds.has(x.clientId))) throw new Error(`${w}: está vinculada a un cliente que no existe en el respaldo.`);
    if (!Array.isArray(x.lines) || x.lines.length === 0 || x.lines.length > LIMITS.invoiceLines) throw new Error(`${w}: sus líneas no son válidas.`);
    const lines = x.lines.map((/** @type {any} */ l, /** @type {number} */ j) => {
      const wl = `${w}, línea ${j + 1}`;
      record(l, wl);
      text_(l.description, wl, 'descripción', LIMITS.invoiceLine);
      if (!Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QUANTITY) throw new Error(`${wl}: cantidad no válida.`);
      if (!Number.isSafeInteger(l.unitCents) || l.unitCents < 1 || l.unitCents > MAX_CENTS) throw new Error(`${wl}: precio no válido.`);
      if (l.quantity * l.unitCents > MAX_CENTS) throw new Error(`${wl}: el total es demasiado grande.`);
      if (l.productId !== undefined && !productIds.has(l.productId)) throw new Error(`${wl}: usa un producto que no existe en el respaldo.`);
      if (l.serviceId !== undefined) {
        const svc = typeof l.serviceId === 'string' ? serviceById.get(l.serviceId) : undefined;
        if (!svc) throw new Error(`${wl}: factura un servicio que no existe en el respaldo.`);
        if (l.productId !== undefined) throw new Error(`${wl}: lleva un producto y un servicio a la vez.`);
        if (svc.clientId !== x.clientId) throw new Error(`${wl}: su servicio no es del cliente de la factura.`);
      }
      return {
        description: l.description, quantity: l.quantity, unitCents: l.unitCents,
        ...(l.productId !== undefined ? { productId: l.productId } : {}),
        ...(l.serviceId !== undefined ? { serviceId: l.serviceId } : {}),
      };
    });
    if (invoiceTotals({ lines, taxRateBp: x.taxRateBp }).totalCents > MAX_CENTS) throw new Error(`${w}: el total es demasiado grande.`);
    if (x.voidedAt !== undefined) iso(x.voidedAt, `${w} (anulación)`);
    return {
      id: x.id, number: x.number, ...(x.clientId !== undefined ? { clientId: x.clientId } : {}),
      customerName: x.customerName, customerTaxId: x.customerTaxId, customerContact: x.customerContact,
      issueDate: x.issueDate, dueDate: x.dueDate, lines, taxRateBp: x.taxRateBp, notes: x.notes,
      ...(x.voidedAt !== undefined ? { voidedAt: x.voidedAt } : {}),
      createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  const invoiceById = new Map(invoices.map((x) => [x.id, x]));
  // Regla de una sola fuente (0.14.5): lo facturado de un servicio en facturas vigentes nunca pasa de su precio.
  for (const [serviceId, billedCents] of billedByService(invoices)) {
    const svc = /** @type {NonNullable<ReturnType<typeof serviceById.get>>} */ (serviceById.get(serviceId));
    if (billedCents > svc.priceCents) throw new Error(`Servicio «${svc.name}»: sus facturas vigentes suman más que su precio.`);
  }

  const invoicePayments = (d.invoicePayments ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Cobro de factura #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    const invoice = invoiceById.get(x.invoiceId);
    if (!invoice) throw new Error(`${w}: pertenece a una factura que no existe en el respaldo.`);
    if (invoice.voidedAt !== undefined) throw new Error(`${w}: su factura está anulada (una factura anulada no tiene cobros).`);
    cents(x.amountCents, w);
    dateAndTime(x, w, today);
    if (x.date < invoice.issueDate) throw new Error(`${w}: es anterior a la fecha de su factura.`);
    optionalText(x.note, w, 'nota', LIMITS.paymentNote);
    // Cada cobro tiene su ingreso vinculado: así el dinero disponible y los resultados cuadran con la factura.
    const linked = movementById.get(x.movementId);
    if (!linked || linked.type !== 'income') throw new Error(`${w}: su ingreso vinculado no existe en el respaldo.`);
    if (linkedMovementIds.has(x.movementId)) throw new Error(`${w}: comparte su ingreso vinculado con otro registro.`);
    linkedMovementIds.add(x.movementId);
    if (linked.amountCents !== x.amountCents || linked.date !== x.date) throw new Error(`${w}: no coincide con su ingreso vinculado (monto o fecha).`);
    return {
      id: x.id, invoiceId: x.invoiceId, amountCents: x.amountCents, date: x.date, time: x.time, note: x.note,
      movementId: x.movementId, createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  // Los cobros de una factura no pueden superar su total (como al registrarlos en la app).
  for (const invoice of invoices) {
    const paid = invoicePayments.filter((p) => p.invoiceId === invoice.id).reduce((sum, p) => sum + p.amountCents, 0);
    if (paid > invoiceTotals(invoice).totalCents) throw new Error(`Factura ${invoice.number}: sus cobros superan su total.`);
  }

  const stockEntries = (d.stockEntries ?? []).map((/** @type {any} */ x, /** @type {number} */ i) => {
    const w = `Movimiento de stock #${i + 1}`;
    record(x, w);
    text_(x.id, w, 'id', 80);
    uniqueId(x.id, w);
    if (!productIds.has(x.productId)) throw new Error(`${w}: pertenece a un producto que no existe en el respaldo.`);
    if (!isStockKind(x.kind)) throw new Error(`${w}: tipo no válido.`);
    if (!Number.isSafeInteger(x.quantity) || x.quantity === 0 || Math.abs(x.quantity) > MAX_QUANTITY) throw new Error(`${w}: cantidad no válida.`);
    if (x.kind === 'purchase' && x.quantity < 0) throw new Error(`${w}: una compra no puede restar unidades.`);
    if (x.kind === 'sale' && x.quantity > 0) throw new Error(`${w}: una venta no puede sumar unidades.`);
    if (!Number.isSafeInteger(x.unitCents) || x.unitCents < 0 || x.unitCents > MAX_CENTS) throw new Error(`${w}: monto por unidad no válido.`);
    if ((x.kind === 'purchase' || x.kind === 'sale') && x.unitCents === 0) throw new Error(`${w}: el monto por unidad debe ser mayor que cero.`);
    if (x.kind === 'adjustment' && x.quantity < 0 && x.unitCents !== 0) throw new Error(`${w}: un ajuste que resta no lleva monto por unidad.`);
    if (Math.abs(x.quantity) * x.unitCents > MAX_CENTS) throw new Error(`${w}: el total es demasiado grande.`);
    dateAndTime(x, w, today);
    optionalText(x.note, w, 'nota', LIMITS.stockNote);
    const hasSupplier = x.supplierId !== undefined;
    if (hasSupplier) {
      if (x.kind !== 'purchase') throw new Error(`${w}: solo una compra puede tener proveedor.`);
      if (!supplierIds.has(x.supplierId)) throw new Error(`${w}: pertenece a un proveedor que no existe en el respaldo.`);
    }
    // Una venta puede venir de una factura interna: sale con ella, no lleva movimiento de dinero (el dinero entra al cobrar)
    // y existe solo mientras la factura esté vigente.
    const hasInvoice = x.invoiceId !== undefined;
    if (hasInvoice) {
      if (x.kind !== 'sale') throw new Error(`${w}: solo una venta puede venir de una factura.`);
      const owner = invoiceById.get(x.invoiceId);
      if (!owner) throw new Error(`${w}: pertenece a una factura que no existe en el respaldo.`);
      if (owner.voidedAt !== undefined) throw new Error(`${w}: su factura está anulada (sus salidas de stock se devuelven al anularla).`);
      if (x.date !== owner.issueDate) throw new Error(`${w}: no coincide con la fecha de su factura.`);
      if (x.movementId !== undefined) throw new Error(`${w}: una venta de factura no lleva su propio movimiento de dinero.`);
    }
    // Compras y ventas llevan su movimiento de dinero (gasto o ingreso), con el mismo monto y fecha; los ajustes no.
    const hasMovement = x.movementId !== undefined;
    if (x.kind === 'adjustment') {
      if (hasMovement) throw new Error(`${w}: un ajuste no mueve dinero.`);
    } else if (hasInvoice) {
      // sin movimiento propio (ya comprobado arriba)
    } else {
      const linked = movementById.get(x.movementId);
      if (!linked || linked.type !== (x.kind === 'purchase' ? 'expense' : 'income')) throw new Error(`${w}: su movimiento de dinero no existe en el respaldo.`);
      if (linkedMovementIds.has(x.movementId)) throw new Error(`${w}: comparte su movimiento de dinero con otro registro.`);
      linkedMovementIds.add(x.movementId);
      if (linked.amountCents !== Math.abs(x.quantity) * x.unitCents || linked.date !== x.date) {
        throw new Error(`${w}: no coincide con su movimiento de dinero (monto o fecha).`);
      }
    }
    return {
      id: x.id, productId: x.productId, kind: x.kind, quantity: x.quantity, unitCents: x.unitCents, date: x.date, time: x.time,
      ...(hasSupplier ? { supplierId: x.supplierId } : {}),
      ...(hasMovement ? { movementId: x.movementId } : {}),
      ...(hasInvoice ? { invoiceId: x.invoiceId } : {}),
      note: x.note, createdAt: iso(x.createdAt, w), updatedAt: iso(x.updatedAt, w),
      ...(x.isDemo === true ? { isDemo: true } : {}),
    };
  });
  // El stock de un producto no puede haber sido negativo en ningún momento: sería mercancía que nunca existió.
  for (const product of products) {
    const problem = replayProduct(stockEntries.filter((e) => e.productId === product.id)).firstNegative;
    if (problem) throw new Error(`Producto «${product.name}»: sus salidas superan lo que había en stock (${problem.entry.date}).`);
  }
  // Un producto sin control de stock (0.17.0) no tiene movimientos de stock.
  for (const product of products) {
    if (product.trackStock === false && stockEntries.some((e) => e.productId === product.id)) {
      throw new Error(`Producto «${product.name}»: no lleva control de stock, pero tiene movimientos de stock.`);
    }
  }
  const untracked = new Set(products.filter((p) => p.trackStock === false).map((p) => p.id));
  // Cada factura vigente sacó del inventario exactamente lo que dicen sus líneas con producto (y nada más), menos las de
  // productos sin control de stock, que no sacan unidades.
  for (const invoice of invoices) {
    /** @type {Map<string, { units: number, cents: number }>} */
    const wanted = new Map();
    for (const line of invoice.lines) {
      if (!line.productId || untracked.has(line.productId)) continue;
      const row = wanted.get(line.productId) ?? { units: 0, cents: 0 };
      row.units += line.quantity;
      row.cents += line.quantity * line.unitCents;
      wanted.set(line.productId, row);
    }
    /** @type {Map<string, { units: number, cents: number }>} */
    const taken = new Map();
    for (const e of stockEntries) {
      if (e.invoiceId !== invoice.id) continue;
      const row = taken.get(e.productId) ?? { units: 0, cents: 0 };
      row.units += -e.quantity;
      row.cents += -e.quantity * e.unitCents;
      taken.set(e.productId, row);
    }
    const expected = invoice.voidedAt === undefined ? wanted : new Map();
    const same = expected.size === taken.size && [...expected].every(([id, row]) => taken.get(id)?.units === row.units && taken.get(id)?.cents === row.cents);
    if (!same) throw new Error(`Factura ${invoice.number}: sus salidas de inventario no coinciden con sus líneas.`);
  }

  // Los pagos de deudas no se cargan a un departamento (no son gasto operativo): un respaldo editado a mano no puede decir lo contrario.
  const debtMovementIds = new Set(debtPayments.map((p) => p.movementId));
  for (const m of movements) {
    if (m.departmentId !== undefined && debtMovementIds.has(m.id)) throw new Error(`Movimiento «${m.description}»: un pago de deuda no se carga a un departamento.`);
    if (m.clientId !== undefined && m.type === 'expense' && debtMovementIds.has(m.id)) throw new Error(`Movimiento «${m.description}»: un pago de deuda no se carga a un cliente.`);
  }

  const s = d.settings;
  if (typeof s.displayName !== 'string' || s.displayName.length > LIMITS.displayName) {
    throw new Error('Ajustes: nombre no válido.');
  }
  if (!Number.isSafeInteger(s.openingBalanceCents) || s.openingBalanceCents < 0 || s.openingBalanceCents > MAX_CENTS) {
    throw new Error('Ajustes: saldo inicial no válido.');
  }

  // Una meta no puede tener más retiros que aportes: sería dinero que nunca existió
  // (y haría subir "Disponible" sin que el usuario haya ingresado nada).
  for (const goal of goals) {
    const saved = contributions
      .filter((c) => c.goalId === goal.id)
      .reduce((sum, c) => sum + (c.kind === 'deposit' ? c.amountCents : -c.amountCents), 0);
    if (saved < 0) throw new Error(`Meta «${goal.name}»: sus retiros superan lo aportado.`);
  }

  return {
    categories,
    movements,
    goals,
    contributions,
    debts,
    debtPayments,
    assets,
    clients,
    services,
    products,
    suppliers,
    stockEntries,
    invoices,
    invoicePayments,
    departments,
    settings: { displayName: s.displayName, openingBalanceCents: s.openingBalanceCents },
  };
}

// ---- utilidades de validación (privadas) -----------------------------------

/** @param {string} error */
function fail(error) {
  return { ok: /** @type {const} */ (false), error };
}

/** @param {unknown} v @returns {v is Record<string, any>} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @param {string} where @param {string} field @param {number} max */
function text_(v, where, field, max) {
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) {
    throw new Error(`${where}: ${field} no válido.`);
  }
}

/** Texto que puede estar vacío (pero siempre es texto, con máximo). @param {unknown} v @param {string} where @param {string} field @param {number} max */
function optionalText(v, where, field, max) {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${where}: ${field} no válido.`);
}

/** @param {unknown} v @param {readonly string[]} allowed @param {string} where @param {string} field */
function oneOf(v, allowed, where, field) {
  if (typeof v !== 'string' || !allowed.includes(v)) throw new Error(`${where}: ${field} no válido.`);
}

/** @param {unknown} v @param {string} where */
function cents(v, where) {
  if (!Number.isSafeInteger(v) || /** @type {number} */ (v) <= 0 || /** @type {number} */ (v) > MAX_CENTS) {
    throw new Error(`${where}: monto no válido.`);
  }
}

/** @param {any} r @param {string} where @param {string | undefined} today */
function dateAndTime(r, where, today) {
  if (!isValidISODate(r.date)) throw new Error(`${where}: fecha no válida.`);
  if (today && r.date > today) {
    throw new Error(`${where}: tiene fecha futura (${r.date}). ACCONTROL solo registra movimientos de hoy o anteriores.`);
  }
  if (!isValidTime(r.time)) throw new Error(`${where}: hora no válida.`);
}

/** @param {unknown} v @param {string} where */
function iso(v, where) {
  if (typeof v !== 'string' || !ISO_DATE_TIME.test(v) || Number.isNaN(Date.parse(v))) {
    throw new Error(`${where}: fecha de registro no válida.`);
  }
  return v;
}

/** Fecha-hora completa tal como la escribe Date#toISOString (por ejemplo 2026-07-05T14:30:00.000Z). */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** @param {unknown} v @param {string} where */
function record(v, where) {
  if (!isObject(v)) throw new Error(`${where}: no es un registro válido.`);
}
