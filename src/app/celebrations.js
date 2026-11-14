// @ts-check
// =============================================================================
// CUÁNDO CELEBRAR: una meta recién cumplida o un logro recién conseguido
// -----------------------------------------------------------------------------
// Se compara lo que había antes con lo que hay después de cada cambio de datos, en el MISMO espacio:
//   · Los datos de demostración no cuentan (las metas DEMO se ignoran; los logros ya los ignoran).
//   · Al abrir la app o cambiar de espacio no se celebra nada: solo lo que se cumple mientras la usas.
//   · Si de golpe cambian muchos registros (importar una copia, cargar o borrar la demostración), no es algo que
//     acabas de lograr: se toma como el nuevo punto de partida, sin celebrar. Una acción tuya (guardar un aporte,
//     que a veces anota también un ingreso) cambia como mucho 2 registros. Cumplir una meta puede traer logros a
//     la vez: eso SÍ se celebra (una sola ráfaga).
// =============================================================================

import { goalProgress } from '../domain/goals.js';
import { celebrate } from '../ui/celebrate.js';
import { haptic } from '../ui/haptics.js';
import { toast } from '../ui/toast.js';
import { gamificationFor } from '../views/achievements.js';

/** Si cambian más registros que esto de una vez, es un cambio en bloque (importar, demostración): no se celebra. */
export const MAX_RECORDS_CHANGED = 3;

/** Cuántos avisos de celebración como mucho a la vez (los demás se resumen en uno). */
export const MAX_TOASTS = 2;

/**
 * @typedef {Object} Snapshot
 * @property {string | null} workspaceId
 * @property {number} records                    Cuántos registros hay en el espacio (todas las listas).
 * @property {Map<string, string>} goals         Metas cumplidas (id → nombre), sin las DEMO.
 * @property {Map<string, string>} achievements  Logros conseguidos (id → título).
 */

/**
 * Lo cumplido en este momento. Puro: recibe los datos ya calculados.
 * @param {string | null} workspaceId
 * @param {{ id: string, name: string, isDemo?: boolean, targetCents: number }[]} goals
 * @param {(goal: any) => boolean} isCompleted
 * @param {{ id: string, title: string, done: boolean }[]} achievements
 * @param {number} [records]
 * @returns {Snapshot}
 */
export function snapshotOf(workspaceId, goals, isCompleted, achievements, records = 0) {
  return {
    workspaceId,
    records,
    goals: new Map(goals.filter((g) => !g.isDemo && isCompleted(g)).map((g) => [g.id, g.name])),
    achievements: new Map(achievements.filter((a) => a.done).map((a) => [a.id, a.title])),
  };
}

/** Cuántos registros tiene un espacio (la suma de todas sus listas de datos). @param {Record<string, unknown>} data */
export function countRecords(data) {
  let total = 0;
  for (const value of Object.values(data)) if (Array.isArray(value)) total += value.length;
  return total;
}

/**
 * Qué hay que celebrar entre dos momentos. Puro.
 * @param {Snapshot | null} before @param {Snapshot} after
 * @returns {{ goals: string[], achievements: string[] }}
 */
export function celebrationsBetween(before, after) {
  const none = { goals: [], achievements: [] };
  if (!before || before.workspaceId !== after.workspaceId) return none;
  if (Math.abs(after.records - before.records) > MAX_RECORDS_CHANGED) return none;
  const goals = [...after.goals].filter(([id]) => !before.goals.has(id)).map(([, name]) => name);
  const achievements = [...after.achievements].filter(([id]) => !before.achievements.has(id)).map(([, title]) => title);
  return { goals, achievements };
}

/**
 * Los textos de los avisos: primero las metas, después los logros; como mucho MAX_TOASTS, y el resto resumido.
 * @param {{ goals: string[], achievements: string[] }} found
 * @returns {string[]}
 */
export function celebrationMessages(found) {
  const all = [
    ...found.goals.map((name) => `¡Meta cumplida: «${name}»! Lo lograste.`),
    ...found.achievements.map((title) => `Logro conseguido: «${title}».`),
  ];
  if (all.length <= MAX_TOASTS) return all;
  const rest = all.length - (MAX_TOASTS - 1);
  return [...all.slice(0, MAX_TOASTS - 1), `Y ${rest} más: míralos en Logros (Inicio → Tu nivel).`];
}

/**
 * Vigila los datos y celebra lo que se cumple mientras usas la app.
 * @param {ReturnType<typeof import('./store.js').createStore>} store
 */
export function watchCelebrations(store) {
  /** @type {Snapshot | null} */
  let last = null;
  const take = () => {
    const state = store.getState();
    if (state.status !== 'ready' || !state.activeWorkspaceId) return null;
    const today = store.today();
    return snapshotOf(
      state.activeWorkspaceId,
      state.data.goals,
      (goal) => goalProgress(goal, state.data.contributions, today).completed,
      gamificationFor(store).achievements,
      countRecords(state.data),
    );
  };
  last = take();
  return store.subscribe(() => {
    const now = take();
    if (!now) return;
    const found = celebrationsBetween(last, now);
    last = now;
    if (found.goals.length + found.achievements.length === 0) return;
    celebrate();
    haptic('success');
    for (const message of celebrationMessages(found)) toast(message);
  });
}
