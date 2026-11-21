// @ts-check
// =============================================================================
// PAGOS EN OTRA MONEDA (0.18.5)
// -----------------------------------------------------------------------------
// Un ingreso o un gasto puede haberse pagado en otra moneda (por ejemplo, Netflix en dólares en un espacio en pesos).
// Se anota lo que se pagó (US$ 15.00) y la TASA de ese día (1 US$ = 60.50 RD$), y la app guarda las dos cosas:
//   · amountCents          — el monto YA CONVERTIDO a la moneda del espacio (RD$ 907.50). Es el que cuentan los totales,
//                            los reportes, las metas y todo lo demás, así nunca se suman pesos con dólares.
//   · originalCurrency     — la moneda en que se pagó (USD).
//   · originalAmountCents  — lo que se pagó, en centavos de esa moneda (1500).
//   · exchangeRateMicro    — la tasa × 1,000,000, como número entero (60.50 → 60,500,000). Así no hay decimales
//                            flotantes que redondeen mal; se admiten hasta 6 decimales (0.016529 para RD$ → US$).
// La tasa la escribe la persona: la app NO la trae de internet (eso necesita un servicio externo, ver docs/ROADMAP.md).
// =============================================================================

import { isCurrencyCode } from './currencies.js';
import { MAX_CENTS } from './money.js';

/** La tasa se guarda multiplicada por un millón (6 decimales). */
export const RATE_SCALE = 1_000_000;

/** La tasa más grande que se acepta (1 unidad = 1,000,000 de la otra). Evita errores de tecleo enormes. */
export const MAX_RATE_MICRO = 1_000_000 * RATE_SCALE;

/** Si la tasa se aleja más que esto de la última usada con esa moneda, se avisa (no se bloquea). */
export const ODD_RATE_RATIO = 0.25;

/**
 * Lee la tasa que escribió la persona: «60.50», «60,50», «0.016529». Se rechaza lo ambiguo («4,000»: ¿cuatro mil o
 * cuatro?) en lugar de adivinar.
 * @param {unknown} text
 * @returns {{ ok: true, micro: number } | { ok: false, error: string }}
 */
export function parseRate(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { ok: false, error: 'Escribe la tasa de cambio de ese día.' };
  // «0,016» sí es claro (decimal); «4,000» o «1,250.50» no.
  if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(raw)) {
    return { ok: false, error: 'Escribe la tasa sin separador de miles: 4000 o 4000.50.' };
  }
  const m = /^(\d{1,7})(?:[.,](\d{1,6}))?$/.exec(raw);
  if (!m) return { ok: false, error: `No se entiende «${raw}». Escribe la tasa así: 60.50 (hasta 6 decimales).` };
  const micro = Number(m[1]) * RATE_SCALE + Number((m[2] ?? '').padEnd(6, '0') || '0');
  if (micro <= 0) return { ok: false, error: 'La tasa debe ser mayor que cero.' };
  if (micro > MAX_RATE_MICRO) return { ok: false, error: 'La tasa es demasiado grande.' };
  return { ok: true, micro };
}

/**
 * Convierte lo pagado a la moneda del espacio, redondeando al centavo más cercano (la mitad, hacia arriba).
 * Con números grandes se usa BigInt para no perder centavos.
 * @param {number} originalCents @param {number} rateMicro
 */
export function convertCents(originalCents, rateMicro) {
  const product = BigInt(originalCents) * BigInt(rateMicro);
  const scale = BigInt(RATE_SCALE);
  return Number((product + scale / 2n) / scale);
}

/** 60500000 → «60.50»; 16529 → «0.016529» (al menos 2 decimales, sin ceros de más). @param {number} micro */
export function formatExchangeRate(micro) {
  const whole = Math.floor(micro / RATE_SCALE);
  const fraction = String(micro % RATE_SCALE).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${fraction}`;
}

/**
 * ¿El movimiento se pagó en otra moneda? Las tres piezas van juntas.
 * @param {{ originalCurrency?: string, originalAmountCents?: number, exchangeRateMicro?: number }} m
 */
export function hasForeign(m) {
  return isCurrencyCode(m.originalCurrency) && Number.isSafeInteger(m.originalAmountCents) && Number.isSafeInteger(m.exchangeRateMicro);
}

/**
 * La última tasa usada con esa moneda en este espacio (para proponerla), o null.
 * @param {readonly { date: string, time: string, createdAt: string, originalCurrency?: string, exchangeRateMicro?: number }[]} movements
 * @param {string} currency
 */
export function lastRateFor(movements, currency) {
  let best = null;
  for (const m of movements) {
    if (m.originalCurrency !== currency || !Number.isSafeInteger(m.exchangeRateMicro)) continue;
    if (!best || `${m.date}${m.time}${m.createdAt}` > `${best.date}${best.time}${best.createdAt}`) best = m;
  }
  return best ? /** @type {number} */ (best.exchangeRateMicro) : null;
}

/** ¿La tasa se aleja mucho de la última usada? (para avisar de un posible error de tecleo). @param {number} micro @param {number | null} last */
export function rateLooksOdd(micro, last) {
  if (!last) return false;
  return Math.abs(micro - last) / last > ODD_RATE_RATIO;
}

/**
 * Revisa lo pagado en otra moneda y lo convierte. `currency` vacío o igual a la del espacio = pago normal (null).
 * @param {{ currency?: unknown, amountCents: number, rateText?: unknown, baseCurrency: string }} input
 * @returns {{ ok: true, foreign: null } | { ok: true, foreign: { currency: import('./currencies.js').CurrencyCode, amountCents: number, rateMicro: number, convertedCents: number } } | { ok: false, errors: Record<string, string> }}
 */
export function checkForeign({ currency, amountCents, rateText, baseCurrency }) {
  if (currency === undefined || currency === null || currency === '' || currency === baseCurrency) return { ok: true, foreign: null };
  if (!isCurrencyCode(currency)) return { ok: false, errors: { currency: 'Elige una moneda de la lista.' } };
  const rate = parseRate(rateText);
  if (!rate.ok) return { ok: false, errors: { rate: rate.error } };
  const convertedCents = convertCents(amountCents, rate.micro);
  if (convertedCents < 1) return { ok: false, errors: { rate: 'Con esa tasa el monto queda en cero. Revisa la tasa.' } };
  if (convertedCents > MAX_CENTS) return { ok: false, errors: { rate: 'Con esa tasa el monto queda demasiado grande. Revisa la tasa.' } };
  return { ok: true, foreign: { currency, amountCents, rateMicro: rate.micro, convertedCents } };
}
