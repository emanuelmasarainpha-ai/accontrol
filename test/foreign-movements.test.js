// 0.18.5 — Ingresos y gastos pagados en otra moneda (sugerencia de la persona): lo pagado + la tasa del día, guardado
// convertido a la moneda del espacio.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkForeign, convertCents, formatExchangeRate, hasForeign, lastRateFor, MAX_RATE_MICRO, parseRate, rateLooksOdd,
} from '../src/domain/exchange.js';
import { formatMoneyIn, formatMoney } from '../src/domain/money.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { createBackup, parseBackup } from '../src/domain/backup.js';
import { fromRow, toRow } from '../src/data/cloudRows.js';
import { foreignNote } from '../src/ui/components.js';
import { CURRENCY_CODES } from '../src/domain/currencies.js';

const fixedNow = new Date(2026, 10, 20, 15, 30);
const TODAY = '2026-11-20';
function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}

describe('la tasa de cambio', () => {
  it('se lee con punto o coma decimal y hasta 6 decimales', () => {
    assert.deepEqual(parseRate('60.50'), { ok: true, micro: 60_500_000 });
    assert.deepEqual(parseRate('60,5'), { ok: true, micro: 60_500_000 });
    assert.deepEqual(parseRate('0.016529'), { ok: true, micro: 16_529 });
    assert.deepEqual(parseRate('0,016'), { ok: true, micro: 16_000 });
    assert.deepEqual(parseRate(' 4000 '), { ok: true, micro: 4_000_000_000 });
  });
  it('rechaza lo ambiguo, lo vacío, el cero y lo enorme (no adivina)', () => {
    for (const bad of ['4,000', '1,250.50', '', 'sesenta', '0', '0.0000001', '-5', '60.5.1', '2000000']) {
      assert.equal(parseRate(bad).ok, false, bad);
    }
    assert.match(/** @type {any} */ (parseRate('4,000')).error, /sin separador de miles/);
  });
  it('convierte al centavo más cercano, sin perder centavos con montos grandes', () => {
    assert.equal(convertCents(1500, 60_500_000), 90_750); // US$ 15.00 × 60.50 = RD$ 907.50
    assert.equal(convertCents(999, 60_123_456), 60_063); // 9.99 × 60.123456 = 600.633... → 600.63
    assert.equal(convertCents(1, 500_000), 1); // 0.005 → medio centavo hacia arriba
    assert.equal(convertCents(1, 499_999), 0);
    assert.equal(convertCents(99_999_999_999, MAX_RATE_MICRO), 99_999_999_999_000_000, 'BigInt: exacto aunque sea enorme');
  });
  it('se escribe con al menos 2 decimales y sin ceros de más', () => {
    assert.equal(formatExchangeRate(60_500_000), '60.50');
    assert.equal(formatExchangeRate(16_529), '0.016529');
    assert.equal(formatExchangeRate(4_000_000_000), '4000.00');
  });
  it('propone la última tasa usada con esa moneda y avisa si la nueva se aleja mucho', () => {
    const ms = [
      { date: '2026-11-01', time: '10:00', createdAt: 'a', originalCurrency: 'USD', exchangeRateMicro: 59_000_000 },
      { date: '2026-11-10', time: '09:00', createdAt: 'b', originalCurrency: 'USD', exchangeRateMicro: 60_500_000 },
      { date: '2026-11-15', time: '09:00', createdAt: 'c', originalCurrency: 'EUR', exchangeRateMicro: 70_000_000 },
      { date: '2026-11-18', time: '09:00', createdAt: 'd' },
    ];
    assert.equal(lastRateFor(ms, 'USD'), 60_500_000);
    assert.equal(lastRateFor(ms, 'MXN'), null);
    assert.equal(rateLooksOdd(62_000_000, 60_500_000), false);
    assert.equal(rateLooksOdd(6_050_000, 60_500_000), true, 'un cero de menos');
    assert.equal(rateLooksOdd(6_050_000, null), false);
  });
  it('en la moneda del espacio no hay conversión', () => {
    assert.deepEqual(checkForeign({ currency: 'DOP', amountCents: 100, rateText: '', baseCurrency: 'DOP' }), { ok: true, foreign: null });
    assert.deepEqual(checkForeign({ currency: '', amountCents: 100, baseCurrency: 'DOP' }), { ok: true, foreign: null });
    assert.equal(checkForeign({ currency: 'XYZ', amountCents: 100, rateText: '60', baseCurrency: 'DOP' }).ok, false);
    assert.equal(checkForeign({ currency: 'USD', amountCents: 1, rateText: '0.001', baseCurrency: 'DOP' }).ok, false, 'queda en cero');
  });
});

/** @param {Record<string, string>} over */
const expense = (over = {}) => ({
  type: 'expense', amountText: '15', date: TODAY, time: '14:30', description: 'Netflix', classification: 'variable', categoryId: 'cat-exp-otros', ...over,
});

async function withSpace(currency = 'DOP') {
  const root = createMemoryWorkspaceStore();
  const store = createStore(root, tickingClock());
  await store.init();
  assert.ok((await store.createWorkspace({ kind: 'personal', name: 'Mío', currency })).ok);
  return { root, store };
}

describe('registrar un gasto pagado en dólares', () => {
  it('guarda lo pagado y la tasa, y el monto convertido es el que cuenta', async () => {
    const { store } = await withSpace();
    const r = await store.saveMovement(expense({ currency: 'USD', rateText: '60.50' }));
    assert.ok(r.ok);
    const m = store.getState().data.movements[0];
    assert.equal(m.amountCents, 90_750);
    assert.equal(m.originalCurrency, 'USD');
    assert.equal(m.originalAmountCents, 1500);
    assert.equal(m.exchangeRateMicro, 60_500_000);
    assert.equal(foreignNote(m), 'US$ 15.00 a 60.50');
    assert.equal(formatMoney(m.amountCents), 'RD$ 907.50');
  });
  it('sin tasa, o con una tasa mala, no se guarda y lo dice en la tasa', async () => {
    const { store } = await withSpace();
    const r = await store.saveMovement(expense({ currency: 'USD', rateText: '' }));
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.errors.rate : '', /tasa/);
    const r2 = await store.saveMovement(expense({ currency: 'USD', rateText: '4,000' }));
    assert.equal(r2.ok, false);
    assert.equal(store.getState().data.movements.length, 0);
  });
  it('en la moneda del espacio todo es como antes (sin campos nuevos)', async () => {
    const { store } = await withSpace();
    assert.ok((await store.saveMovement(expense({ currency: 'DOP', rateText: '60' }))).ok);
    const m = store.getState().data.movements[0];
    assert.equal(m.amountCents, 1500);
    assert.equal(hasForeign(m), false);
    assert.equal('originalCurrency' in m, false);
  });
  it('al editar: se puede cambiar la tasa o volver a la moneda del espacio (los campos se quitan)', async () => {
    const { store } = await withSpace();
    assert.ok((await store.saveMovement(expense({ currency: 'USD', rateText: '60.50' }))).ok);
    const id = store.getState().data.movements[0].id;
    assert.ok((await store.saveMovement(expense({ currency: 'USD', rateText: '61' }), id)).ok);
    assert.equal(store.getState().data.movements[0].amountCents, 91_500);
    assert.ok((await store.saveMovement(expense({ amountText: '900', currency: 'DOP' }), id)).ok);
    const m = store.getState().data.movements[0];
    assert.equal(m.amountCents, 90_000);
    assert.equal(hasForeign(m), false);
    assert.equal('exchangeRateMicro' in m, false);
  });
  it('en un espacio en dólares se puede registrar en pesos (la tasa va al revés)', async () => {
    const { store } = await withSpace('USD');
    assert.ok((await store.saveMovement(expense({ amountText: '1000', currency: 'DOP', rateText: '0.016529' }))).ok);
    const m = store.getState().data.movements[0];
    assert.equal(m.amountCents, 1653); // RD$ 1,000 × 0.016529 = US$ 16.529 → 16.53
    assert.equal(formatMoneyIn(m.amountCents, 'USD'), 'US$ 16.53');
  });
});

describe('copias y nube', () => {
  /** Un espacio con un gasto en dólares, para copiarlo. */
  async function sample() {
    const { store } = await withSpace();
    assert.ok((await store.saveMovement(expense({ currency: 'USD', rateText: '60.50' }))).ok);
    return store.getState().data;
  }
  it('la copia de seguridad lo conserva tal cual', async () => {
    const data = await sample();
    const back = parseBackup(JSON.stringify(createBackup(data, fixedNow.toISOString())));
    assert.ok(back.ok);
    const m = back.ok ? back.data.movements[0] : null;
    assert.deepEqual([m?.originalCurrency, m?.originalAmountCents, m?.exchangeRateMicro, m?.amountCents], ['USD', 1500, 60_500_000, 90_750]);
  });
  it('una copia con el pago a medias o con montos que no cuadran se rechaza', async () => {
    const data = await sample();
    /** @param {(m: any) => void} mutate */
    const attempt = (mutate) => {
      const file = JSON.parse(JSON.stringify(createBackup(data, fixedNow.toISOString())));
      mutate(file.data.movements[0]);
      return parseBackup(JSON.stringify(file));
    };
    assert.equal(attempt((m) => { delete m.exchangeRateMicro; }).ok, false, 'incompleto');
    assert.equal(attempt((m) => { m.amountCents = 99_999; }).ok, false, 'no cuadra con lo pagado × la tasa');
    assert.equal(attempt((m) => { m.originalCurrency = 'XYZ'; }).ok, false);
    assert.equal(attempt((m) => { m.exchangeRateMicro = 0; }).ok, false);
  });
  it('a la nube viaja en tres columnas; los movimientos normales las mandan vacías', async () => {
    const data = await sample();
    const m = data.movements[0];
    const row = toRow('movements', m, 'ws');
    assert.deepEqual([row.original_currency, row.original_amount_cents, row.exchange_rate_micro], ['USD', 1500, 60_500_000]);
    assert.deepEqual(fromRow('movements', { ...row, synced_at: null, deleted_at: null }).record.exchangeRateMicro, 60_500_000);
    const { originalCurrency, originalAmountCents, exchangeRateMicro, ...plain } = m;
    const plainRow = toRow('movements', plain, 'ws');
    assert.deepEqual([plainRow.original_currency, plainRow.original_amount_cents, plainRow.exchange_rate_micro], [null, null, null]);
    assert.equal('originalCurrency' in fromRow('movements', { ...plainRow, synced_at: null, deleted_at: null }).record, false);
  });
  it('la migración: solo añade columnas, van juntas y con la misma lista de monedas', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261123000100_foreign_movements.sql', import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /\b(update|delete|truncate|drop)\b/i);
    assert.match(sql, /movements_foreign_together/);
    const list = /original_currency in \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    assert.deepEqual([...list.matchAll(/'([A-Z]{3})'/g)].map((x) => x[1]), CURRENCY_CODES);
  });
});
