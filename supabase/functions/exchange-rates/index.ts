// =============================================================================
// ACCONTROL · 0.18.6 · Función «exchange-rates»: la tasa de cambio de referencia de un día
// -----------------------------------------------------------------------------
// La app pide: POST { "date": "AAAA-MM-DD" }  →  { date, source, rates: { DOP: 60.23, EUR: 0.91, … } }
// `rates` dice cuántas unidades de cada moneda vale 1 US$ ese día; con eso la app calcula cualquier par.
//
// De dónde sale: «currency-api» (github.com/fawazahmed0/exchange-api): gratis, sin clave, licencia CC0, se publica una
// vez al día y guarda los días pasados. Primero se busca en jsDelivr y, si falla, en su copia de Cloudflare.
// Cada día se pide UNA sola vez: se guarda en la tabla public.exchange_rates y las siguientes veces sale de ahí.
//
// Seguridad: la llave de servidor (SUPABASE_SERVICE_ROLE_KEY) la pone Supabase en el entorno de la función; nunca
// está en la app ni en este archivo. La función solo escribe tasas numéricas revisadas de una fuente fija, y devuelve
// datos públicos del mercado (nada de ninguna persona). Son tasas de REFERENCIA: la de tu banco puede ser otra.
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Las monedas de la app (src/domain/currencies.js). */
const CODES = ['DOP', 'USD', 'EUR', 'MXN', 'COP', 'PEN', 'ARS', 'GTQ', 'HNL', 'NIO', 'CRC', 'PAB', 'BOB', 'UYU', 'BRL', 'HTG', 'CAD', 'GBP'];
const SOURCE = 'currency-api (fawazahmed0)';
/** El primer día que publica esta versión del servicio. */
const FIRST_DAY = '2024-03-02';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

type Day = { date: string; rates: Record<string, number> };

/** Pide un día al servicio (`latest` = el último publicado). null si no responde o si trae algo raro. */
async function fetchDay(tag: string): Promise<Day | null> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.json`,
    `https://${tag}.currency-api.pages.dev/v1/currencies/usd.json`,
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const body = await response.json();
      const date = typeof body?.date === 'string' && DATE_RE.test(body.date) ? body.date : null;
      if (!date || typeof body.usd !== 'object' || body.usd === null) continue;
      const rates: Record<string, number> = {};
      for (const code of CODES) {
        const value = Number(body.usd[code.toLowerCase()]);
        if (!Number.isFinite(value) || value <= 0) throw new Error(`Falta ${code}`);
        rates[code] = value;
      }
      rates.USD = 1;
      return { date, rates };
    } catch {
      // Se prueba la otra dirección.
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Usa POST.' }, 405);

  let wanted = '';
  try {
    const body = await req.json();
    wanted = typeof body?.date === 'string' ? body.date : '';
  } catch {
    return json({ error: 'La petición no se entiende.' }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  let date = DATE_RE.test(wanted) ? wanted : today;
  if (date > today) date = today;
  if (date < FIRST_DAY) return json({ error: 'No hay tasas de referencia de antes del 2 de marzo de 2024: escribe la tasa tú.' }, 404);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });

  /** Lo guardado de ese día (todas las monedas), o null. */
  const read = async (day: string): Promise<Day | null> => {
    const { data, error } = await admin.from('exchange_rates').select('currency, units_per_usd').eq('rate_date', day);
    if (error || !data || data.length < CODES.length) return null;
    const rates: Record<string, number> = {};
    for (const row of data) rates[row.currency] = Number(row.units_per_usd);
    return CODES.every((c) => rates[c] > 0) ? { date: day, rates } : null;
  };

  const cached = await read(date);
  if (cached) return json({ ...cached, source: SOURCE });

  // Lo de hoy puede no estar publicado todavía: entonces se usa el último día publicado (y se dice cuál es).
  let day = await fetchDay(date);
  if (!day && date === today) day = await fetchDay('latest');
  if (!day) {
    return date === today
      ? json({ error: 'El servicio de tasas no respondió. Escribe la tasa tú.' }, 502)
      : json({ error: 'El servicio no tiene la tasa de ese día. Escribe la tasa tú.' }, 404);
  }

  const again = day.date === date ? null : await read(day.date);
  if (again) return json({ ...again, source: SOURCE });

  const rows = CODES.map((currency) => ({ rate_date: day.date, currency, units_per_usd: day.rates[currency], source: SOURCE }));
  const { error } = await admin.from('exchange_rates').upsert(rows, { onConflict: 'rate_date,currency' });
  if (error) console.error('No se pudieron guardar las tasas:', error.message);
  return json({ ...day, source: SOURCE });
});
