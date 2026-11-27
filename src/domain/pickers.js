// @ts-check
// =============================================================================
// LAS CUENTAS DE LOS SELECTORES PROPIOS (0.20.12): hora, calendario y listas
// -----------------------------------------------------------------------------
// Sin pantalla: convertir «16:24» en «4:24 p. m.», armar la cuadrícula de un mes (semanas de lunes a domingo),
// moverse de mes y saber qué días se pueden elegir. La parte visual está en ui/picker.js.
// Las fechas se manejan como texto «AAAA-MM-DD» y con Date.UTC, para que la zona horaria no mueva un día.
// =============================================================================

export const MONTHS = Object.freeze(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']);
/** Cabecera del calendario: la semana empieza el lunes. */
export const WEEKDAYS_SHORT = Object.freeze(['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']);
const WEEKDAYS_LONG = Object.freeze(['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']);

/** @typedef {{ hour: number, minute: number }} TimeParts  hour 0-23 */
/** @typedef {{ year: number, month: number, day: number }} DateParts  month 0-11 */

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** «HH:MM» (como lo guarda un campo de hora) → partes; null si no es una hora. @param {string | null | undefined} value @returns {TimeParts | null} */
export function parseTimeValue(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** Partes → «HH:MM». @param {number} hour @param {number} minute */
export function timeValue(hour, minute) {
  return `${pad(hour)}:${pad(minute)}`;
}

/** 0-23 → reloj de 12 horas. @param {number} hour */
export function to12h(hour) {
  return { hour12: hour % 12 === 0 ? 12 : hour % 12, pm: hour >= 12 };
}

/** Reloj de 12 horas → 0-23. @param {number} hour12 1-12 @param {boolean} pm */
export function from12h(hour12, pm) {
  return (hour12 % 12) + (pm ? 12 : 0);
}

/** Sumar o restar minutos sin salirse del día (23:59 + 1 → 00:00). @param {TimeParts} time @param {number} delta @returns {TimeParts} */
export function nudgeTime({ hour, minute }, delta) {
  const total = (((hour * 60 + minute + delta) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/** «4:24 p. m.» @param {TimeParts} time */
export function timeLabel({ hour, minute }) {
  const { hour12, pm } = to12h(hour);
  return `${hour12}:${pad(minute)} ${pm ? 'p. m.' : 'a. m.'}`;
}

/** «AAAA-MM-DD» → partes; null si no es una fecha real. @param {string | null | undefined} value @returns {DateParts | null} */
export function parseDateValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Partes → «AAAA-MM-DD». @param {number} year @param {number} month 0-11 @param {number} day */
export function dateValue(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad(month + 1)}-${pad(day)}`;
}

/** @param {number} year @param {number} month 0-11 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Un mes más o menos. @param {number} year @param {number} month @param {number} delta @returns {{ year: number, month: number }} */
export function shiftMonth(year, month, delta) {
  const index = year * 12 + month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

/**
 * La cuadrícula de un mes: cuántos huecos van antes del día 1 (la semana empieza el lunes) y cuántos días tiene.
 * @param {number} year @param {number} month 0-11
 */
export function monthGrid(year, month) {
  const sundayFirst = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return { offset: (sundayFirst + 6) % 7, days: daysInMonth(year, month) };
}

/** ¿Se puede elegir ese día? (min y max como los del campo; vacíos = sin tope). @param {string} value @param {string} [min] @param {string} [max] */
export function dateAllowed(value, min = '', max = '') {
  return (!min || value >= min) && (!max || value <= max);
}

/** ¿Algún día de ese mes se puede elegir? (para apagar las flechas del calendario). @param {number} year @param {number} month @param {string} [min] @param {string} [max] */
export function monthAllowed(year, month, min = '', max = '') {
  return dateAllowed(dateValue(year, month, daysInMonth(year, month)), min, '') && dateAllowed(dateValue(year, month, 1), '', max);
}

/** «jueves, 26 de noviembre de 2026». @param {DateParts} date */
export function longDateLabel({ year, month, day }) {
  const weekday = WEEKDAYS_LONG[new Date(Date.UTC(year, month, day)).getUTCDay()];
  return `${weekday}, ${day} de ${MONTHS[month]} de ${year}`;
}

/** La fecha de hoy (del aparato) como «AAAA-MM-DD». @param {Date} [now] */
export function todayValue(now = new Date()) {
  return dateValue(now.getFullYear(), now.getMonth(), now.getDate());
}

/** El día anterior a una fecha «AAAA-MM-DD». @param {string} value */
export function previousDay(value) {
  const d = parseDateValue(value);
  if (!d) return '';
  const t = new Date(Date.UTC(d.year, d.month, d.day - 1));
  return dateValue(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/** De «Dólar estadounidense (US$)», el símbolo «US$» (para la burbuja de la lista de monedas). @param {string} label */
export function currencySymbolOf(label) {
  return /\(([^()]+)\)\s*$/.exec(label)?.[1] ?? '';
}
