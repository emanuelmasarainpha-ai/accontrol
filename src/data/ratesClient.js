// @ts-check
// =============================================================================
// TASA DE REFERENCIA AUTOMÁTICA (0.18.6)
// -----------------------------------------------------------------------------
// Pide a la función «exchange-rates» de Supabase (supabase/functions/exchange-rates) cuántas unidades de cada moneda
// valía 1 US$ un día. La función la saca del servicio gratuito «currency-api» y la guarda; la app nunca habla con ese
// servicio directamente. Aquí no hay ninguna llave secreta: solo la publicable, la misma que usa el resto de la app.
// Lo que llega se recuerda en este dispositivo (los días pasados no cambian), así no se pide dos veces.
// Nunca lanza: si falla, devuelve { ok: false, error } y la persona escribe la tasa.
// =============================================================================

import { CURRENCY_CODES } from '../domain/currencies.js';

/** @typedef {{ ok: true, date: string, source: string, rates: Record<string, number> }} RatesDay */
/** @typedef {{ ok: false, error: string }} RatesFailure */
/** @typedef {{ ratesFor: (date: string) => Promise<RatesDay | RatesFailure> }} RatesClient */

const CACHE_PREFIX = 'accontrol.rates.v1:';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Revisa lo que contestó la función. null si trae algo raro.
 * @param {any} body @returns {RatesDay | null}
 */
export function readRatesReply(body) {
  if (!body || typeof body.date !== 'string' || !DATE_RE.test(body.date) || typeof body.rates !== 'object' || body.rates === null) return null;
  /** @type {Record<string, number>} */
  const rates = {};
  for (const code of CURRENCY_CODES) {
    const value = Number(body.rates[code]);
    if (!Number.isFinite(value) || value <= 0) return null;
    rates[code] = value;
  }
  return { ok: true, date: body.date, source: typeof body.source === 'string' ? body.source.slice(0, 80) : 'currency-api', rates };
}

/**
 * @param {{ url: string, publishableKey: string, fetch?: typeof fetch, storage?: Storage | null, timeoutMs?: number }} options
 * @returns {RatesClient}
 */
export function createRatesClient(options) {
  const base = options.url.replace(/\/+$/, '');
  const fetchFn = options.fetch ?? ((/** @type {any[]} */ ...args) => /** @type {any} */ (globalThis.fetch)(...args));
  const storage = options.storage ?? null;
  const timeoutMs = options.timeoutMs ?? 12_000;
  /** @type {Map<string, Promise<RatesDay | RatesFailure>>} */
  const memory = new Map();

  /** @param {string} date */
  const remembered = (date) => {
    try {
      const raw = storage?.getItem(CACHE_PREFIX + date);
      return raw ? readRatesReply(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  /** @param {string} date @returns {Promise<RatesDay | RatesFailure>} */
  async function ask(date) {
    const saved = remembered(date);
    if (saved) return saved;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchFn(`${base}/functions/v1/exchange-rates`, {
        method: 'POST',
        headers: { apikey: options.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
        credentials: 'omit', cache: 'no-store', signal: controller?.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) return { ok: false, error: typeof body?.error === 'string' ? body.error.slice(0, 200) : 'No se pudo traer la tasa. Escríbela tú.' };
      const day = readRatesReply(body);
      if (!day) return { ok: false, error: 'La tasa llegó incompleta. Escríbela tú.' };
      // Solo se recuerda si es justo el día pedido (lo de «hoy» puede ser aún el de ayer y mañana cambia).
      if (day.date === date) {
        try {
          storage?.setItem(CACHE_PREFIX + date, JSON.stringify(day));
        } catch {
          // Sin espacio: se volverá a pedir.
        }
      }
      return day;
    } catch {
      return { ok: false, error: 'Sin conexión: no se pudo traer la tasa. Escríbela tú.' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    ratesFor(date) {
      if (!DATE_RE.test(date)) return Promise.resolve({ ok: false, error: 'Elige primero la fecha.' });
      const pending = memory.get(date) ?? ask(date);
      memory.set(date, pending);
      // Un fallo no se recuerda: la próxima vez se intenta de nuevo.
      void pending.then((r) => { if (!r.ok) memory.delete(date); });
      return pending;
    },
  };
}

/** La que usa la app (null sin cuentas: no hay Supabase al que preguntar). @type {RatesClient | null} */
let current = null;

/** @param {RatesClient | null} client */
export function setRatesClient(client) {
  current = client;
}

export function ratesClient() {
  return current;
}
