// @ts-check
// =============================================================================
// FECHAS Y HORAS
// -----------------------------------------------------------------------------
// Las fechas se guardan como texto "AAAA-MM-DD" y las horas como "HH:mm", en la
// hora local del usuario. Los meses se identifican con una "clave de mes":
// "2026-07". Nunca se mezclan zonas horarias.
// =============================================================================

export const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** @param {number} n @param {number} [len] */
const pad = (n, len = 2) => String(n).padStart(len, '0');

/** @param {Date} d */
export function toISODate(d) {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fecha de hoy, hora local. @param {Date} [now] */
export function todayISO(now = new Date()) {
  return toISODate(now);
}

/** Hora actual "HH:mm". @param {Date} [now] */
export function currentTime(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Mes actual "AAAA-MM". @param {Date} [now] */
export function currentMonthKey(now = new Date()) {
  return toISODate(now).slice(0, 7);
}

/** "2026-07-05" -> "2026-07" @param {string} iso */
export function monthKeyOf(iso) {
  return iso.slice(0, 7);
}

/** @param {string} iso @returns {{y:number, m:number, d:number}} */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** @param {number} y @param {number} m 1-12 */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * ¿Es una fecha real del calendario? ("2026-02-30" NO lo es.)
 * @param {unknown} value
 */
export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseISO(value);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** @param {unknown} value */
export function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** @param {unknown} value */
export function isValidMonthKey(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * Suma (o resta) meses a una clave de mes. addMonths("2026-01", -1) -> "2025-12"
 * @param {string} monthKey @param {number} delta
 */
export function addMonths(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/**
 * Los últimos `count` meses terminando en `endKey`, del más antiguo al más reciente.
 * @param {string} endKey @param {number} count
 */
export function monthKeysEndingAt(endKey, count) {
  return Array.from({ length: count }, (_, i) => addMonths(endKey, i - (count - 1)));
}

/** "2026-07" -> "julio 2026" @param {string} monthKey */
export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-07" -> "julio" @param {string} monthKey */
export function monthName(monthKey) {
  return MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1];
}

/** "2026-07" -> "jul" (con año si es enero: "ene 27") @param {string} monthKey */
export function monthShortLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return m === 1 ? `${MONTH_SHORT[0]} ${String(y).slice(2)}` : MONTH_SHORT[m - 1];
}

/** "2026-07-05" -> "5 jul 2026" @param {string} iso */
export function formatDate(iso) {
  const { y, m, d } = parseISO(iso);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

/** "2026-07-05" -> "domingo 5 de julio" @param {string} iso */
export function formatDateLong(iso) {
  const { y, m, d } = parseISO(iso);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} de ${MONTH_NAMES[m - 1]}`;
}

/** Días entre dos fechas (positivo si `to` es posterior). @param {string} from @param {string} to */
export function daysBetween(from, to) {
  const a = parseISO(from);
  const b = parseISO(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/**
 * Suma meses a una fecha; si el día no existe en el mes destino usa el último
 * ("31 ene" + 1 mes = "28 feb").
 * @param {string} iso @param {number} months
 */
export function addMonthsToDate(iso, months) {
  const { y, m, d } = parseISO(iso);
  const key = addMonths(`${pad(y, 4)}-${pad(m)}`, months);
  const [ny, nm] = key.split('-').map(Number);
  return `${key}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/**
 * Suma (o resta) días a una fecha. addDays("2026-01-31", 1) -> "2026-02-01"
 * @param {string} iso @param {number} days
 */
export function addDays(iso, days) {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * Diferencia de calendario en meses completos + días. Requiere from <= to.
 * @param {string} from @param {string} to
 * @returns {{ months: number, days: number }}
 */
export function calendarDiff(from, to) {
  const a = parseISO(from);
  const b = parseISO(to);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  while (months > 0 && addMonthsToDate(from, months) > to) months -= 1;
  const days = daysBetween(addMonthsToDate(from, months), to);
  return { months, days };
}

/**
 * Texto de tiempo restante: "Quedan 3 meses y 12 días", "Vence hoy", "Venció hace 5 días".
 * @param {string} today @param {string} target
 */
export function describeTimeLeft(today, target) {
  if (target === today) return 'Vence hoy';
  if (target < today) {
    const days = daysBetween(target, today);
    return `Venció hace ${plural(days, 'día', 'días')}`;
  }
  const { months, days } = calendarDiff(today, target);
  const parts = [];
  if (months > 0) parts.push(plural(months, 'mes', 'meses'));
  if (days > 0) parts.push(plural(days, 'día', 'días'));
  const singleUnit = parts.length === 1 && (months === 1 || (months === 0 && days === 1));
  return `${singleUnit ? 'Queda' : 'Quedan'} ${parts.join(' y ')}`;
}

/**
 * @param {number} n @param {string} one @param {string} many
 */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Saludo según la hora (0-23). @param {number} hour */
export function greetingFor(hour) {
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
