// @ts-check
// =============================================================================
// METAS DE AHORRO (documento maestro §4.5 y §11)
// -----------------------------------------------------------------------------
// Una meta tiene nombre, descripción, monto objetivo y fecha objetivo.
// Lo ahorrado NO se guarda en la meta: se calcula sumando sus aportes y
// restando sus retiros (así nunca hay dos números que puedan contradecirse).
// =============================================================================

import {
  addDays,
  addMonthsToDate,
  calendarDiff,
  daysBetween,
  describeTimeLeft,
  isValidISODate,
  isValidTime,
  toISODate,
} from './dates.js';
import { MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Goal} Goal */
/** @typedef {import('./types.js').Contribution} Contribution */

/** @type {Record<'short' | 'medium' | 'long', string>} */
export const HORIZON_LABELS = {
  short: 'Corto plazo',
  medium: 'Mediano plazo',
  long: 'Largo plazo',
};

/**
 * @typedef {Object} GoalInput
 * @property {string} name
 * @property {string} description
 * @property {string} targetText     Monto objetivo, como texto.
 * @property {string} targetDate
 */

/**
 * @param {GoalInput} input
 * @param {{ today: string, existing?: Goal | null }} context
 * @returns {{ ok: true, value: { name: string, description: string, targetCents: number, targetDate: string } } | { ok: false, errors: Record<string, string> }}
 */
export function validateGoal(input, { today, existing = null }) {
  /** @type {Record<string, string>} */
  const errors = {};

  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Ponle un nombre a tu meta.';
  else if (name.length > LIMITS.goalName) errors.name = `Máximo ${LIMITS.goalName} caracteres.`;

  const description = String(input.description ?? '').trim().replace(/\s+/g, ' ');
  if (description.length > LIMITS.goalDescription) {
    errors.description = `Máximo ${LIMITS.goalDescription} caracteres.`;
  }

  let targetCents = 0;
  const money = parseMoney(input.targetText);
  if (!money.ok) errors.target = money.error;
  else if (money.cents <= 0) errors.target = 'El monto objetivo debe ser mayor que cero.';
  else if (money.cents > MAX_CENTS) errors.target = 'El monto es demasiado grande.';
  else targetCents = money.cents;

  if (!isValidISODate(input.targetDate)) {
    errors.targetDate = 'Elige una fecha objetivo válida.';
  } else if (input.targetDate < today && input.targetDate !== existing?.targetDate) {
    errors.targetDate = 'La fecha objetivo no puede estar en el pasado.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, description, targetCents, targetDate: input.targetDate } };
}

/**
 * @typedef {Object} ContributionInput
 * @property {string} kind          "deposit" | "withdrawal"
 * @property {string} amountText
 * @property {string} date
 * @property {string} time
 * @property {string} note
 */

/**
 * @param {ContributionInput} input
 * @param {{ today: string, savedCents: number }} context
 *   savedCents = lo que la meta tiene ahora, SIN contar el aporte que se está editando.
 * @returns {{ ok: true, value: { kind: 'deposit' | 'withdrawal', amountCents: number, date: string, time: string, note: string } } | { ok: false, errors: Record<string, string> }}
 */
export function validateContribution(input, { today, savedCents }) {
  /** @type {Record<string, string>} */
  const errors = {};

  const kind = input.kind === 'deposit' || input.kind === 'withdrawal' ? input.kind : null;
  if (!kind) errors.kind = 'Elige si es un aporte o un retiro.';

  let amountCents = 0;
  const money = parseMoney(input.amountText);
  if (!money.ok) errors.amount = money.error;
  else if (money.cents <= 0) errors.amount = 'El monto debe ser mayor que cero.';
  else if (money.cents > MAX_CENTS) errors.amount = 'El monto es demasiado grande.';
  else amountCents = money.cents;

  if (!errors.amount && kind === 'withdrawal' && amountCents > savedCents) {
    errors.amount = 'No puedes retirar más de lo que tiene la meta.';
  }
  // Al editar un aporte, `savedCents` puede ser negativo si hay retiros que dependen de él.
  if (!errors.amount && kind === 'deposit' && savedCents + amountCents < 0) {
    errors.amount = 'Con ese monto la meta quedaría en negativo: hay retiros que dependen de este aporte.';
  }

  if (!isValidISODate(input.date)) errors.date = 'Elige una fecha válida.';
  else if (input.date > today) errors.date = 'La fecha no puede ser futura.';

  if (!isValidTime(input.time)) errors.time = 'Elige una hora válida.';

  const note = String(input.note ?? '').trim().replace(/\s+/g, ' ');
  if (note.length > LIMITS.note) errors.note = `Máximo ${LIMITS.note} caracteres.`;

  if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors };
  return { ok: true, value: { kind, amountCents, date: input.date, time: input.time, note } };
}

/**
 * Dinero que tiene una meta ahora mismo (aportes - retiros).
 * @param {string} goalId @param {Contribution[]} contributions
 * @param {string | null} [exceptId] Ignora un aporte (útil al editarlo).
 */
export function goalSavedCents(goalId, contributions, exceptId = null) {
  let total = 0;
  for (const c of contributions) {
    if (c.goalId !== goalId || c.id === exceptId) continue;
    total += c.kind === 'deposit' ? c.amountCents : -c.amountCents;
  }
  return total;
}

/**
 * Todo lo que la pantalla necesita saber de una meta.
 * @param {Goal} goal @param {Contribution[]} contributions @param {string} today
 */
export function goalProgress(goal, contributions, today) {
  const saved = Math.max(0, goalSavedCents(goal.id, contributions));
  const remaining = Math.max(0, goal.targetCents - saved);
  const percent = goal.targetCents > 0 ? Math.min(100, (saved / goal.targetCents) * 100) : 0;
  const completed = saved >= goal.targetCents;
  const daysLeft = daysBetween(today, goal.targetDate);
  const overdue = !completed && daysLeft < 0;

  /** @type {'short' | 'medium' | 'long'} */
  let horizon = 'short';
  if (daysLeft > 0) {
    // Documento §11: corto < 12 meses; mediano entre 1 y 5 años; largo > 5 años.
    const { months, days } = calendarDiff(today, goal.targetDate);
    if (months >= 60 && (months > 60 || days > 0)) horizon = 'long';
    else if (months >= 12) horizon = 'medium';
  }

  // Cuánto aportar por mes para llegar a tiempo (aritmética simple, no es IA).
  // Si falta menos de un mes, se pide todo lo que falta antes de la fecha.
  const monthsLeft = Math.max(1, daysLeft / 30.4375);
  // Se redondea HACIA ARRIBA al peso entero (nunca sugiere de menos), sin pasar de lo que falta.
  const monthlyNeededCents = !completed && daysLeft > 0 ? Math.min(remaining, Math.ceil(remaining / monthsLeft / 100) * 100) : 0;

  return {
    savedCents: saved,
    remainingCents: remaining,
    percent,
    completed,
    overdue,
    daysLeft,
    horizon,
    monthlyNeededCents,
    timeLeftText: completed ? 'Meta cumplida' : describeTimeLeft(today, goal.targetDate),
  };
}

/** Se promedian los aportes de los últimos 3 meses como máximo (menos si la meta es más nueva). */
export const PACE_MAX_MONTHS = 3;
/** Más allá de 100 años no se muestra una fecha: no tiene sentido. */
const MAX_PROJECTION_MONTHS = 1200;
const DAYS_PER_MONTH = 30.4375;

/**
 * @typedef {Object} GoalPace
 * @property {'completed' | 'no-data' | 'stalled' | 'on-track' | 'behind'} status
 *   completed = ya cumplida · no-data = la meta no tiene aportes · stalled = en el período no aportaste (o retiraste más de lo que aportaste)
 *   on-track = a este ritmo llegas a la fecha objetivo · behind = a este ritmo llegarías tarde (o la fecha ya pasó).
 * @property {number} windowMonths      Meses que se promediaron (1 a 3).
 * @property {string} windowStart       Primer día del período promediado.
 * @property {number} windowNetCents    Aportes - retiros en ese período.
 * @property {number} monthlyPaceCents  Promedio mensual (0 si no hay aportes netos).
 * @property {number} monthlyNeededCents  Lo que hace falta aportar al mes para llegar a tiempo (0 si ya no aplica).
 * @property {string | null} projectedDate  Fecha estimada de cumplimiento a este ritmo (null si no hay ritmo o es demasiado lejana).
 * @property {boolean} tooFar            true si a este ritmo tardarías más de 100 años.
 * @property {number | null} lateDays    Días de retraso frente a la fecha objetivo (solo con status "behind" y fecha estimada).
 */

/**
 * Tu ritmo de ahorro "actual" en una meta, comparado con lo que necesitas. Es aritmética sobre tus aportes
 * (promedio mensual de los últimos 3 meses, o de los meses que lleve la meta) y supone que seguirás aportando igual:
 * NO es una predicción ni una promesa.
 * @param {Goal} goal @param {Contribution[]} contributions @param {string} today
 * @returns {GoalPace}
 */
export function goalPace(goal, contributions, today) {
  const info = goalProgress(goal, contributions, today);
  const own = contributions.filter((c) => c.goalId === goal.id && c.date <= today);

  // Meses de historia de la meta: desde su creación o su primer aporte (lo que sea primero), entre 1 y 3.
  let first = toISODate(new Date(goal.createdAt));
  for (const c of own) if (c.date < first) first = c.date;
  const historyMonths = first >= today ? 0 : calendarDiff(first, today).months;
  const windowMonths = Math.min(PACE_MAX_MONTHS, Math.max(1, historyMonths));
  // La ventana son exactamente `windowMonths` meses terminando hoy (incluido hoy).
  const windowStart = addDays(addMonthsToDate(today, -windowMonths), 1);

  let windowNetCents = 0;
  for (const c of own) {
    if (c.date < windowStart) continue;
    windowNetCents += c.kind === 'deposit' ? c.amountCents : -c.amountCents;
  }
  const monthlyPaceCents = windowNetCents > 0 ? Math.round(windowNetCents / windowMonths) : 0;

  /** @type {GoalPace} */
  const base = {
    status: 'no-data', windowMonths, windowStart, windowNetCents, monthlyPaceCents,
    monthlyNeededCents: info.monthlyNeededCents, projectedDate: null, tooFar: false, lateDays: null,
  };
  if (info.completed) return { ...base, status: 'completed', monthlyNeededCents: 0 };
  if (own.length === 0) return base;
  if (monthlyPaceCents <= 0) return { ...base, status: 'stalled' };

  const monthsToGo = info.remainingCents / monthlyPaceCents;
  if (monthsToGo > MAX_PROJECTION_MONTHS) return { ...base, status: 'behind', tooFar: true };
  const projectedDate = addDays(today, Math.ceil(monthsToGo * DAYS_PER_MONTH));
  const late = projectedDate > goal.targetDate;
  return {
    ...base,
    status: late ? 'behind' : 'on-track',
    projectedDate,
    lateDays: late ? daysBetween(goal.targetDate, projectedDate) : null,
  };
}

/**
 * Meta principal de Inicio: la meta pendiente con la fecha objetivo más cercana.
 * @param {Goal[]} goals @param {Contribution[]} contributions
 * @returns {Goal | null}
 */
export function primaryGoal(goals, contributions) {
  const pending = goals.filter((g) => goalSavedCents(g.id, contributions) < g.targetCents);
  pending.sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.createdAt.localeCompare(b.createdAt));
  return pending[0] ?? null;
}
