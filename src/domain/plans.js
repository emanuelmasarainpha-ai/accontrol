// @ts-check
// =============================================================================
// PLANES: Gratis, Premium y Negocio (0.20.0)
// -----------------------------------------------------------------------------
// Qué trae cada plan. Es una lista FIJA: la usan las pantallas (candados), el almacén (no guarda lo que tu plan no
// permite) y la base de datos repite lo importante (crear espacios de Negocio) con sus propias reglas.
//
// Reglas:
//   · Gratis: solo el espacio Personal, con lo básico (ingresos y gastos sin límite, presupuesto y resumen del mes,
//     hasta 2 metas y 2 deudas activas).
//   · Premium: todo lo de un espacio Personal sin límites (estadísticas, patrimonio, diagnóstico, calculadoras,
//     reportes, pagos en otra moneda).
//   · Negocio: lo de Premium más los espacios Freelancer, Emprendedor y Empresa.
//   · Dentro de un espacio Freelancer, Emprendedor o Empresa TODO está abierto: ese espacio solo existe porque su
//     dueño tiene Negocio (quien entra invitado no necesita pagar).
//   · Las copias de seguridad NUNCA se cobran: tus datos siempre se pueden sacar.
//
// Los precios son de referencia (docs/MONETIZACION.md); todavía NO se cobra nada (el botón dice «Próximamente»).
// =============================================================================

/** @typedef {'free' | 'premium' | 'business'} PlanId */
/** @typedef {'stats' | 'netWorth' | 'diagnosis' | 'calculators' | 'reports' | 'foreignCurrency' | 'businessSpaces'} Feature */
/** @typedef {'goals' | 'debts'} LimitedThing */
/** Lo que dice la nube del plan de una cuenta. @typedef {{ plan: PlanId, source: string, expiresAt: string | null }} PlanRow */

/** @type {readonly PlanId[]} */
export const PLAN_IDS = Object.freeze(['free', 'premium', 'business']);

/** Orden de los planes: uno más alto trae todo lo del anterior. */
const RANK = Object.freeze({ free: 0, premium: 1, business: 2 });

/**
 * Nombre, para quién es, precio de referencia y lo que trae cada plan (para la pantalla «Planes»).
 * @type {Readonly<Record<PlanId, { label: string, tagline: string, price: string, includes: readonly string[] }>>}
 */
export const PLANS = Object.freeze({
  free: {
    label: 'Gratis',
    tagline: 'Para empezar a ordenar tu dinero.',
    price: 'RD$0',
    includes: Object.freeze([
      'Espacio Personal',
      'Ingresos y gastos sin límite',
      'Presupuesto y resumen del mes',
      'Hasta 2 metas y 2 deudas activas',
      'Copias de seguridad',
    ]),
  },
  premium: {
    label: 'Premium',
    tagline: 'Control completo de tus finanzas personales.',
    price: 'US$3.99 al mes',
    includes: Object.freeze([
      'Todo lo de Gratis',
      'Metas y deudas sin límite',
      'Estadísticas, patrimonio neto y diagnóstico',
      'Calculadoras financieras',
      'Reportes en PDF, Excel y CSV',
      'Pagos en otra moneda y tasa automática',
    ]),
  },
  business: {
    label: 'Negocio',
    tagline: 'Para freelancers, colmados, emprendedores y empresas.',
    price: 'US$12.99 al mes',
    includes: Object.freeze([
      'Todo lo de Premium',
      'Espacios Freelancer, Emprendedor y Empresa',
      'Caja, ticket, lector de códigos e inventario',
      'Clientes, facturas internas y fiado',
      'Departamentos, miembros y roles a medida',
    ]),
  },
});

/** El plan más bajo que trae cada función. @type {Readonly<Record<Feature, PlanId>>} */
export const FEATURE_PLAN = Object.freeze({
  stats: 'premium',
  netWorth: 'premium',
  diagnosis: 'premium',
  calculators: 'premium',
  reports: 'premium',
  foreignCurrency: 'premium',
  businessSpaces: 'business',
});

/** El comienzo del aviso de cada función («Las estadísticas son» + « del plan Premium.»). @type {Readonly<Record<Feature, string>>} */
export const FEATURE_SUBJECT = Object.freeze({
  stats: 'Las estadísticas son',
  netWorth: 'El patrimonio neto es',
  diagnosis: 'El diagnóstico financiero es',
  calculators: 'Las calculadoras financieras son',
  reports: 'Descargar reportes es',
  foreignCurrency: 'Registrar pagos en otra moneda es',
  businessSpaces: 'Los espacios Freelancer, Emprendedor y Empresa son',
});

/** Cuántas metas y deudas ACTIVAS (sin cumplir / sin pagar) se pueden tener en el plan Gratis. */
export const FREE_LIMITS = Object.freeze({ goals: 2, debts: 2 });

/** Pantallas que pide cada función (las demás no tienen candado). @type {Readonly<Record<string, Feature>>} */
export const ROUTE_FEATURE = Object.freeze({
  estadisticas: 'stats',
  patrimonio: 'netWorth',
  diagnostico: 'diagnosis',
  calculadoras: 'calculators',
});

/** @param {unknown} value @returns {value is PlanId} */
export const isPlanId = (value) => typeof value === 'string' && Object.hasOwn(RANK, value);

/** @param {string | null | undefined} workspaceKind */
const isBusinessSpace = (workspaceKind) => typeof workspaceKind === 'string' && workspaceKind !== 'personal';

/**
 * ¿Puedes usar esta función? Dentro de un espacio de Negocio siempre (lo paga su dueño).
 * @param {PlanId} plan @param {Feature} feature @param {string | null} [workspaceKind]
 */
export function canUse(plan, feature, workspaceKind = null) {
  if (feature !== 'businessSpaces' && isBusinessSpace(workspaceKind)) return true;
  return RANK[plan] >= RANK[FEATURE_PLAN[feature]];
}

/**
 * ¿Puedes CREAR un espacio de este tipo? Personal, siempre; los demás, con Negocio.
 * @param {PlanId} plan @param {string} kind
 */
export const canCreateWorkspaceKind = (plan, kind) => kind === 'personal' || canUse(plan, 'businessSpaces');

/**
 * Cuántas metas o deudas activas puedes tener (null = sin límite).
 * @param {PlanId} plan @param {LimitedThing} thing @param {string | null} [workspaceKind]
 * @returns {number | null}
 */
export function limitFor(plan, thing, workspaceKind = null) {
  if (plan !== 'free' || isBusinessSpace(workspaceKind)) return null;
  return FREE_LIMITS[thing];
}

/** @param {Feature} feature */
export const requiredPlanLabel = (feature) => PLANS[FEATURE_PLAN[feature]].label;

/** Aviso cuando una función no está en tu plan. @param {Feature} feature */
export const featureMessage = (feature) => `${FEATURE_SUBJECT[feature]} del plan ${requiredPlanLabel(feature)}.`;

/** Aviso al llegar al límite del plan Gratis. @param {LimitedThing} thing */
export function limitMessage(thing) {
  const n = FREE_LIMITS[thing];
  return thing === 'goals'
    ? `En el plan Gratis puedes tener hasta ${n} metas activas. Con Premium, sin límite.`
    : `En el plan Gratis puedes tener hasta ${n} deudas activas. Con Premium, sin límite.`;
}

/**
 * El plan que vale HOY según lo que dice la nube: sin fila, con algo raro o vencido = Gratis.
 * @param {unknown} row @param {Date} now
 * @returns {PlanId}
 */
export function effectivePlan(row, now) {
  if (!row || typeof row !== 'object') return 'free';
  const { plan, expiresAt } = /** @type {Record<string, unknown>} */ (row);
  if (!isPlanId(plan)) return 'free';
  if (expiresAt !== null && expiresAt !== undefined) {
    const end = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(end) || end <= now.getTime()) return 'free';
  }
  return plan;
}
