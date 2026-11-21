// 0.18.6 — Tasa de referencia automática: la función exchange-rates de Supabase (servicio gratuito currency-api).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crossRateMicro, formatExchangeRate } from '../src/domain/exchange.js';
import { createRatesClient, readRatesReply } from '../src/data/ratesClient.js';
import { CURRENCY_CODES } from '../src/domain/currencies.js';

const RATES = Object.fromEntries(CURRENCY_CODES.map((c) => [c, 1]));
Object.assign(RATES, { DOP: 60.23273591, EUR: 0.91022824, MXN: 19.1260373 });
const reply = (date) => ({ date, source: 'currency-api (fawazahmed0)', rates: RATES });

describe('la tasa entre dos monedas', () => {
  it('a partir de «unidades por 1 US$»', () => {
    assert.equal(formatExchangeRate(/** @type {number} */ (crossRateMicro(RATES, 'USD', 'DOP'))), '60.232736');
    assert.equal(crossRateMicro(RATES, 'EUR', 'DOP'), Math.round((60.23273591 / 0.91022824) * 1e6)); // 1 € ≈ 66.17 RD$
    assert.equal(crossRateMicro(RATES, 'DOP', 'USD'), 16602); // 1 RD$ ≈ 0.016602 US$
    assert.equal(crossRateMicro(RATES, 'USD', 'XYZ'), null);
    assert.equal(crossRateMicro({ USD: 1, DOP: 0 }, 'USD', 'DOP'), null);
  });
});

describe('lo que contesta la función', () => {
  it('se acepta solo si trae todas las monedas con números positivos', () => {
    assert.ok(readRatesReply(reply('2026-11-20')));
    assert.equal(readRatesReply({ ...reply('2026-11-20'), date: 'ayer' }), null);
    assert.equal(readRatesReply({ ...reply('2026-11-20'), rates: { ...RATES, CRC: -1 } }), null);
    const { GBP, ...missing } = RATES;
    assert.equal(readRatesReply({ ...reply('2026-11-20'), rates: missing }), null);
    assert.equal(readRatesReply(null), null);
  });
});

/** Un almacén en memoria y una red de mentira. */
function setup(answer) {
  const items = new Map();
  const storage = /** @type {Storage} */ (/** @type {unknown} */ ({ getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) }));
  const calls = [];
  const client = createRatesClient({
    url: 'https://p.supabase.co/', publishableKey: 'sb_publishable_x', storage,
    fetch: /** @type {any} */ (async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return answer(JSON.parse(init.body).date);
    }),
  });
  return { client, calls, items };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('pedir la tasa desde la app', () => {
  it('llama a la función con la llave publicable (nunca una secreta) y la fecha', async () => {
    const { client, calls } = setup((date) => ok(reply(date)));
    const r = await client.ratesFor('2026-11-10');
    assert.ok(r.ok && r.date === '2026-11-10' && r.rates.DOP === 60.23273591);
    assert.equal(calls[0].url, 'https://p.supabase.co/functions/v1/exchange-rates');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.apikey, 'sb_publishable_x');
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.deepEqual(calls[0].body, { date: '2026-11-10' });
  });
  it('cada día se pide una sola vez (se recuerda en el dispositivo)', async () => {
    const { client, calls, items } = setup((date) => ok(reply(date)));
    await client.ratesFor('2026-11-10');
    await client.ratesFor('2026-11-10');
    assert.equal(calls.length, 1);
    assert.ok(items.has('accontrol.rates.v1:2026-11-10'));
    // Otra pestaña o al volver a abrir la app: sale del dispositivo, sin pedirla.
    const again = createRatesClient({ url: 'https://p.supabase.co', publishableKey: 'k', storage: /** @type {any} */ ({ getItem: (k) => items.get(k) ?? null, setItem() {} }), fetch: /** @type {any} */ (async () => { throw new Error('no debería llamar'); }) });
    assert.ok((await again.ratesFor('2026-11-10')).ok);
  });
  it('si hoy todavía no está publicada llega la de ayer, y eso no se guarda como la de hoy', async () => {
    const { client, items } = setup(() => ok(reply('2026-11-20')));
    const r = await client.ratesFor('2026-11-21');
    assert.ok(r.ok && r.date === '2026-11-20');
    assert.equal(items.has('accontrol.rates.v1:2026-11-21'), false);
  });
  it('si falla, lo dice en palabras, no se recuerda y se puede intentar otra vez', async () => {
    let down = true;
    const { client, calls } = setup((date) => (down ? { ok: false, status: 502, json: async () => ({ error: 'El servicio de tasas no respondió. Escribe la tasa tú.' }) } : ok(reply(date))));
    const r = await client.ratesFor('2026-11-10');
    assert.deepEqual(r, { ok: false, error: 'El servicio de tasas no respondió. Escribe la tasa tú.' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    down = false;
    assert.ok((await client.ratesFor('2026-11-10')).ok);
    assert.equal(calls.length, 2);
  });
  it('sin conexión o con una fecha mala no se rompe nada', async () => {
    const offline = createRatesClient({ url: 'https://p.supabase.co', publishableKey: 'k', fetch: /** @type {any} */ (async () => { throw new TypeError('Failed to fetch'); }) });
    const r = await offline.ratesFor('2026-11-10');
    assert.equal(r.ok, false);
    assert.equal((await offline.ratesFor('')).ok, false);
  });
});

describe('la función y su tabla en Supabase', () => {
  const fn = readFileSync(new URL('../supabase/functions/exchange-rates/index.ts', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../supabase/migrations/20261124000100_exchange_rates.sql', import.meta.url), 'utf8');
  it('ninguna llave escrita: la de servidor la pone Supabase en el entorno', () => {
    assert.match(fn, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
    assert.doesNotMatch(fn, /sb_secret_|eyJhbGciOi|service_role['"]\s*:/);
  });
  it('las mismas monedas que la app, el servicio gratuito y su copia de respaldo', () => {
    const list = /const CODES = \[([^\]]*)\]/.exec(fn)?.[1] ?? '';
    assert.deepEqual([...list.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]), CURRENCY_CODES);
    assert.ok(fn.includes('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@'));
    assert.ok(fn.includes('.currency-api.pages.dev/v1/currencies/usd.json'));
  });
  it('la tabla: RLS sin permisos para nadie de fuera, y no toca otras tablas', () => {
    assert.match(sql, /create table public\.exchange_rates/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on public\.exchange_rates from anon, authenticated/);
    assert.doesNotMatch(sql, /\bgrant\b/i);
    assert.doesNotMatch(sql, /alter table public\.(?!exchange_rates)/);
  });
});
