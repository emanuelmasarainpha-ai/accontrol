// @ts-check
// =============================================================================
// ROLES A MEDIDA: módulos, niveles y dependencias (0.16.1, paso 1)
// -----------------------------------------------------------------------------
// El dueño de un espacio compartido arma los roles de su empresa (por ejemplo «Cajero») marcando, para cada MÓDULO,
// un NIVEL de una lista fija. No hay permisos libres: así no salen combinaciones sin sentido y la base de datos puede
// aplicar exactamente las mismas reglas (paso 2).
//
//  · Niveles, de menos a más: Sin acceso → Ver → Registrar → Editar y borrar. Cada nivel incluye los anteriores.
//      - Ver: ve los datos del módulo (y puede descargar sus reportes: quien ve algo puede copiarlo igual).
//      - Registrar: crea registros nuevos y corrige o borra LOS SUYOS.
//      - Editar y borrar: cualquier registro del módulo.
//  · Dependencias: algunas acciones crean registros en otro módulo (un cobro de factura crea un ingreso en
//    Movimientos). Por eso, al dar un nivel en un módulo, se sube solo el nivel de los módulos de los que depende.
//  · Lo que NO es un permiso: cambiar el espacio (nombre, datos del negocio, saldo inicial) y administrar miembros
//    siguen siendo del Dueño (y del Administrador para invitar contadores).
// =============================================================================

/** @typedef {'none' | 'view' | 'create' | 'edit'} PermissionLevel */
/** @typedef {'movements' | 'goals' | 'debts' | 'assets' | 'clients' | 'inventory' | 'invoices' | 'departments'} ModuleId */
/** @typedef {Record<ModuleId, PermissionLevel>} Permissions */

/** @type {readonly PermissionLevel[]} */
export const LEVELS = Object.freeze(['none', 'view', 'create', 'edit']);

/** @type {Record<PermissionLevel, string>} */
export const LEVEL_NAMES = Object.freeze({ none: 'Sin acceso', view: 'Ver', create: 'Registrar', edit: 'Editar y borrar' });

/** @type {Record<PermissionLevel, string>} */
export const LEVEL_HELP = Object.freeze({
  none: 'No ve este módulo.',
  view: 'Ve los datos y descarga sus reportes.',
  create: 'Además, registra nuevos y corrige o borra los suyos.',
  edit: 'Además, corrige o borra cualquier registro.',
});

/**
 * Los módulos y los tipos de registro (claves de AppData / CLOUD_KINDS) que cubre cada uno.
 * @type {ReadonlyArray<{ id: ModuleId, label: string, kinds: readonly string[] }>}
 */
export const MODULES = Object.freeze([
  { id: 'movements', label: 'Movimientos y categorías', kinds: ['movements', 'categories'] },
  { id: 'goals', label: 'Metas y aportes', kinds: ['goals', 'contributions'] },
  { id: 'debts', label: 'Deudas y sus pagos', kinds: ['debts', 'debtPayments'] },
  { id: 'assets', label: 'Patrimonio (activos)', kinds: ['assets'] },
  { id: 'clients', label: 'Clientes y servicios', kinds: ['clients', 'services'] },
  { id: 'inventory', label: 'Inventario (productos, proveedores, compras y ventas)', kinds: ['products', 'suppliers', 'stockEntries'] },
  { id: 'invoices', label: 'Facturas y cobros', kinds: ['invoices', 'invoicePayments'] },
  { id: 'departments', label: 'Departamentos y presupuestos', kinds: ['departments'] },
]);

/** @type {readonly ModuleId[]} */
export const MODULE_IDS = Object.freeze(MODULES.map((m) => m.id));

/** A qué módulo pertenece cada tipo de registro. @type {Readonly<Record<string, ModuleId>>} */
export const MODULE_OF_KIND = Object.freeze(Object.fromEntries(MODULES.flatMap((m) => m.kinds.map((k) => [k, m.id]))));

/**
 * Dependencias: dar a un módulo el nivel N obliga a los de esta lista a tener al menos el mismo nivel N (`same`) o al
 * menos «Ver» (`view`).
 *  - Deudas, Metas, Inventario y Facturas crean o cambian movimientos (pago de deuda = gasto, aporte con dinero de fuera =
 *    ingreso, compra o venta = gasto o ingreso, cobro = ingreso).
 *  - Una factura puede sacar productos del stock (Emprendedor y Empresa) y se liga a un cliente (Freelancer).
 *  - Cargar un gasto a un departamento es cambiar el movimiento; para ver un área hay que ver sus gastos.
 * @type {Readonly<Record<ModuleId, { same?: readonly ModuleId[], view?: readonly ModuleId[] }>>}
 */
export const DEPENDENCIES = Object.freeze({
  movements: {},
  goals: { same: ['movements'] },
  debts: { same: ['movements'] },
  assets: {},
  clients: { view: ['movements'] },
  inventory: { same: ['movements'] },
  invoices: { same: ['movements', 'inventory'], view: ['clients'] },
  departments: { same: ['movements'] },
});

/** @param {PermissionLevel} level */
const rank = (level) => LEVELS.indexOf(level);
/** @param {PermissionLevel} a @param {PermissionLevel} b @returns {PermissionLevel} */
const higher = (a, b) => (rank(a) >= rank(b) ? a : b);

/** Todos los módulos en `level`. @param {PermissionLevel} level @returns {Permissions} */
export const allAt = (level) => /** @type {Permissions} */ (Object.fromEntries(MODULE_IDS.map((id) => [id, level])));

/** ¿El nivel `have` alcanza para `need`? @param {PermissionLevel} have @param {PermissionLevel} need */
export const atLeast = (have, need) => rank(have) >= rank(need);

/**
 * Deja unos permisos completos y coherentes: rellena lo que falte con «Sin acceso», descarta lo desconocido y sube las
 * dependencias. Devuelve también qué se subió y por qué (para explicarlo en pantalla).
 * @param {unknown} raw
 * @returns {{ permissions: Permissions, raised: Array<{ module: ModuleId, to: PermissionLevel, because: ModuleId }> }}
 */
export function normalizePermissions(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Permissions} */
  const permissions = allAt('none');
  for (const id of MODULE_IDS) {
    const value = source[id];
    if (typeof value === 'string' && LEVELS.includes(/** @type {PermissionLevel} */ (value))) permissions[id] = /** @type {PermissionLevel} */ (value);
  }
  /** @type {Array<{ module: ModuleId, to: PermissionLevel, because: ModuleId }>} */
  const raised = [];
  // Se repite hasta que nada cambie (Facturas sube Inventario, que a su vez sube Movimientos).
  for (let changed = true; changed;) {
    changed = false;
    for (const id of MODULE_IDS) {
      const level = permissions[id];
      if (level === 'none') continue;
      const deps = DEPENDENCIES[id];
      for (const [list, need] of /** @type {Array<[readonly ModuleId[] | undefined, PermissionLevel]>} */ ([[deps.same, level], [deps.view, 'view']])) {
        for (const dep of list ?? []) {
          if (!atLeast(permissions[dep], need)) {
            permissions[dep] = higher(permissions[dep], need);
            raised.push({ module: dep, to: permissions[dep], because: id });
            changed = true;
          }
        }
      }
    }
  }
  return { permissions, raised };
}

/** ¿Este rol puede hacer `level` en el módulo de este tipo de registro? @param {Permissions} permissions @param {string} kind @param {PermissionLevel} level */
export function allowsKind(permissions, kind, level) {
  const module = MODULE_OF_KIND[kind];
  return module ? atLeast(permissions[module], level) : false;
}

export const MAX_CUSTOM_ROLES = 10;
const RESERVED = ['dueño', 'dueno', 'administrador', 'contador'];

/**
 * El nombre de un rol: 1 a 30 caracteres, sin repetirse en el espacio (sin mirar mayúsculas) y distinto de los fijos.
 * @param {string} raw @param {{ existing: ReadonlyArray<{ id: string, name: string }>, exceptId?: string }} ctx
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateRoleName(raw, { existing, exceptId }) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Escribe un nombre para el rol, por ejemplo «Cajero».' };
  if (name.length > 30) return { ok: false, error: 'Máximo 30 caracteres.' };
  const key = name.toLocaleLowerCase('es');
  if (RESERVED.includes(key)) return { ok: false, error: `«${name}» ya existe como rol fijo. Elige otro nombre.` };
  if (existing.some((r) => r.id !== exceptId && r.name.toLocaleLowerCase('es') === key)) return { ok: false, error: 'Ya hay un rol con ese nombre en este espacio.' };
  return { ok: true, name };
}

/** ¿Da algún acceso? Un rol que no ve nada no sirve. @param {Permissions} permissions */
export const hasAnyAccess = (permissions) => MODULE_IDS.some((id) => permissions[id] !== 'none');

/**
 * Plantillas para empezar (se copian y se ajustan). Las de Administrador y Contador reproducen los roles fijos.
 * @type {ReadonlyArray<{ id: string, name: string, help: string, permissions: Permissions }>}
 */
export const TEMPLATES = Object.freeze([
  { id: 'cashier', name: 'Cajero', help: 'Registra ventas, cobros y gastos del día; ve clientes y productos.', permissions: normalizePermissions({ movements: 'create', inventory: 'create', invoices: 'create', clients: 'view' }).permissions },
  { id: 'manager', name: 'Encargado', help: 'Lleva el inventario, las facturas y los clientes; ve el resto.', permissions: normalizePermissions({ ...allAt('view'), movements: 'edit', inventory: 'edit', invoices: 'edit', clients: 'edit' }).permissions },
  { id: 'accountant-like', name: 'Como Contador', help: 'Ve todo, no registra nada.', permissions: allAt('view') },
  { id: 'admin-like', name: 'Como Administrador', help: 'Registra y edita todo.', permissions: allAt('edit') },
]);
