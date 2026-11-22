// @ts-check
// =============================================================================
// TU PLAN EN ESTA SESIÓN (0.20.0)
// -----------------------------------------------------------------------------
// Guarda el plan que vale ahora (Gratis, Premium o Negocio) para que las pantallas y el almacén lo consulten.
//   · Sin cuentas (modo local, pruebas) no hay planes: todo abierto ('business').
//   · Con cuenta: al abrir se usa lo último que se supo en este dispositivo (así funciona sin internet) y enseguida
//     se pregunta a la nube. Si nunca se supo, mientras tanto vale Gratis.
//   · La fecha de fin se respeta también sin internet (lo guardado incluye la fecha).
// Ojo, con honestidad: esto decide qué se ve en la pantalla; lo importante también lo exige la base de datos
// (crear espacios de Negocio). Lo demás se calcula en tu dispositivo.
// =============================================================================

import { effectivePlan } from '../domain/plans.js';

/** @typedef {import('../domain/plans.js').PlanId} PlanId */
/** @typedef {import('../domain/plans.js').PlanRow} PlanRow */

/** @type {PlanId} */
let current = 'business';
/** @type {PlanRow | null} */
let currentRow = null;
/** @type {Set<() => void>} */
const listeners = new Set();

/** El plan que vale ahora. @returns {PlanId} */
export const currentPlan = () => current;

/** Lo último que dijo la nube (para la pantalla «Tu plan»: origen y fecha de fin). */
export const currentPlanRow = () => currentRow;

/** @param {PlanId} plan @param {PlanRow | null} [row] */
export function setPlan(plan, row = currentRow) {
  const changed = plan !== current || row?.expiresAt !== currentRow?.expiresAt || row?.source !== currentRow?.source;
  current = plan;
  currentRow = row;
  if (changed) for (const listener of listeners) listener();
}

/** Avisa cuando cambia el plan (por ejemplo, la nube dice otra cosa). @param {() => void} listener */
export function onPlanChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @param {string} userId */
const cacheKey = (userId) => `accontrol.plan.v1:${userId}`;

/**
 * Lo último que se supo del plan en este dispositivo.
 * @param {Pick<Storage, 'getItem'> | null} storage @param {string} userId @returns {PlanRow | null}
 */
export function readCachedPlan(storage, userId) {
  try {
    const text = storage?.getItem(cacheKey(userId));
    const row = text ? JSON.parse(text) : null;
    return row && typeof row === 'object' ? row : null;
  } catch {
    return null;
  }
}

/**
 * Empieza la sesión con lo guardado en este dispositivo (sin guardado: Gratis).
 * @param {Pick<Storage, 'getItem'> | null} storage @param {string} userId @param {Date} [now]
 */
export function startPlan(storage, userId, now = new Date()) {
  const row = readCachedPlan(storage, userId);
  setPlan(effectivePlan(row, now), row);
}

/**
 * Pregunta a la nube y, si contesta, guarda y aplica. Sin conexión se queda con lo que había.
 * @param {{ getPlan: () => Promise<{ ok: true, row: PlanRow | null } | { ok: false }> }} cloud
 * @param {Pick<Storage, 'setItem'> | null} storage @param {string} userId @param {Date} [now]
 * @returns {Promise<boolean>} true si la nube contestó
 */
export async function refreshPlan(cloud, storage, userId, now = new Date()) {
  const reply = await cloud.getPlan().catch(() => /** @type {{ ok: false }} */ ({ ok: false }));
  if (!reply.ok) return false;
  try {
    storage?.setItem(cacheKey(userId), JSON.stringify(reply.row));
  } catch {
    // Sin almacenamiento: la próxima vez se pregunta otra vez a la nube.
  }
  setPlan(effectivePlan(reply.row, now), reply.row);
  return true;
}
