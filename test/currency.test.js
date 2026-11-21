// 0.18.3 — Moneda real, una por cuenta (sugerencia de la persona): se elige al empezar y se cambia en Ajustes → General.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENCIES, CURRENCY_CODES, currencyInfo, currencyLabel, isCurrencyCode } from '../src/domain/currencies.js';
import { currencyCode, currencySymbol, formatMoney, parseMoney, setMoneyCurrency } from '../src/domain/money.js';
import { accountCurrency, buildWorkspace } from '../src/domain/workspaces.js';
import { createBackup, parseAnyBackup } from '../src/domain/backup.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import { reportToXlsx } from '../src/export/xlsx.js';
import { textWidth } from '../src/export/pdf.js';
import { currencyMismatch } from '../src/views/settings.js';

const fixedNow = new Date(2026, 10, 20, 15, 30);
const TODAY = '2026-11-20';
const SHARED_ID = '7b0d5c1e-2f4a-4c1b-9a51-0d8f6a3e9c21';

function tickingClock() {
  let ticks = 0;
  return () => new Date(fixedNow.getTime() + (ticks += 1) * 1000);
}

afterEach(() => setMoneyCurrency('DOP'));

describe('la lista de monedas', () => {
  it('RD$ va primero; cada código y cada símbolo es único', () => {
    assert.equal(CURRENCY_CODES[0], 'DOP');
    assert.equal(new Set(CURRENCY_CODES).size, CURRENCY_CODES.length);
    const symbols = Object.values(CURRENCIES).map((c) => c.symbol);
    assert.equal(new Set(symbols).size, symbols.length, 'dos monedas con el mismo símbolo se confundirían');
    for (const code of CURRENCY_CODES) assert.equal(CURRENCIES[code].code, code);
  });
  it('solo monedas con centavos (los montos se guardan en centavos enteros)', () => {
    for (const code of ['CLP', 'PYG', 'JPY', 'XYZ', '', null, 'dop', '__proto__', 'toString']) assert.equal(isCurrencyCode(code), false, String(code));
    assert.equal(isCurrencyCode('USD'), true);
  });
  it('un código desconocido se muestra como RD$ (nunca rompe la pantalla)', () => {
    assert.equal(currencyInfo('XYZ').code, 'DOP');
    assert.equal(currencyLabel('USD'), 'Dólar estadounidense (US$)');
  });
});

describe('los montos se muestran con la moneda del espacio', () => {
  it('sin elegir nada, RD$ como siempre', () => {
    assert.equal(formatMoney(150050), 'RD$ 1,500.50');
    assert.equal(currencySymbol(), 'RD$');
  });
  it('con otra moneda cambia el símbolo, nunca la cantidad', () => {
    setMoneyCurrency('USD');
    assert.equal(formatMoney(150050), 'US$ 1,500.50');
    assert.equal(formatMoney(-150050), '-US$ 1,500.50');
    assert.equal(formatMoney(99_999, { decimals: false }), 'US$ 1,000');
    assert.equal(formatMoney(2500, { sign: true }), '+US$ 25.00');
    setMoneyCurrency('EUR');
    assert.equal(formatMoney(1000), '€ 10.00');
    assert.equal(currencyCode(), 'EUR');
    setMoneyCurrency('no-existe');
    assert.equal(formatMoney(1000), 'RD$ 10.00');
  });
  it('se aceptan montos pegados con el símbolo de cualquier moneda de la lista', () => {
    for (const [text, cents] of [['US$ 1,500.50', 150050], ['€1500', 150000], ['RD$ 20', 2000], ['rd$20', 2000], ['$ 5', 500], ['S/ 10.5', 1050], ['B/. 3', 300], ['COL$ 1,000', 100000], ['Q 7', 700]]) {
      const r = parseMoney(text);
      assert.ok(r.ok, text);
      assert.equal(r.ok && r.cents, cents, text);
    }
    assert.equal(parseMoney('US$ abc').ok, false);
    assert.equal(parseMoney('US$').ok, false);
    assert.equal(parseMoney('-US$ 5').ok, false, 'el signo negativo se sigue rechazando');
  });
  it('el Excel lleva el símbolo en el formato de los montos', () => {
    setMoneyCurrency('USD');
    const report = { title: 'T', subtitle: '', notes: [], fileBase: 'x', csvSheet: 'H', sheets: [{ name: 'H', blocks: [{ type: 'table', headers: ['A'], rows: [[{ money: 100 }]] }] }] };
    const text = new TextDecoder().decode(reportToXlsx(/** @type {any} */ (report)));
    assert.ok(text.includes('&quot;US$ &quot;#,##0.00'));
    assert.ok(!text.includes('RD$'));
  });
  it('en el PDF el colón (₡) sale como CRC, no como «?»', () => {
    assert.equal(textWidth('₡ 1,000', 10), textWidth('CRC 1,000', 10));
  });
});

describe('una moneda por cuenta', () => {
  const ws = (/** @type {any} */ over) => ({ ...buildWorkspace({ kind: 'personal', name: 'x' }, { id: 'a', nowISO: fixedNow.toISOString() }), ...over });

  it('la de tus espacios (el predeterminado primero); los compartidos contigo no cuentan', () => {
    assert.equal(accountCurrency([]), 'DOP');
    assert.equal(accountCurrency([ws({ currency: 'USD', role: 'admin' })]), 'DOP');
    assert.equal(accountCurrency([ws({ currency: 'EUR' }), ws({ currency: 'USD', isDefault: true })]), 'USD');
    assert.equal(accountCurrency([ws({ currency: 'MXN', role: 'accountant' }), ws({ currency: 'EUR' })]), 'EUR');
  });

  it('se elige al crear el primer espacio; los siguientes usan la misma', async () => {
    const root = createMemoryWorkspaceStore();
    const store = createStore(root, tickingClock());
    await store.init();
    assert.equal((await store.createWorkspace({ kind: 'personal', name: 'Mío', currency: 'XYZ' })).ok, false, 'moneda inventada');
    const first = await store.createWorkspace({ kind: 'personal', name: 'Mío', currency: 'USD' });
    assert.ok(first.ok && first.workspace.currency === 'USD');
    assert.equal(formatMoney(100), 'US$ 1.00', 'al abrir el espacio los montos ya salen en su moneda');
    const second = await store.createWorkspace({ kind: 'freelancer', name: 'Trabajo', currency: 'EUR' });
    assert.ok(second.ok && second.workspace.currency === 'USD', 'una por cuenta: el segundo usa la de la cuenta');
    assert.equal(store.accountCurrency(), 'USD');
  });

  it('cambiarla cambia todos tus espacios, no convierte montos y no toca los compartidos contigo', async () => {
    const root = createMemoryWorkspaceStore();
    const store = createStore(root, tickingClock());
    await store.init();
    assert.ok((await store.createWorkspace({ kind: 'personal', name: 'Mío' })).ok);
    assert.ok((await store.createWorkspace({ kind: 'freelancer', name: 'Trabajo' })).ok);
    assert.ok((await store.saveMovement({ type: 'income', amountText: '5000', date: TODAY, time: '09:00', description: 'Pago', classification: 'variable', categoryId: 'cat-inc-ventas' })).ok);
    const shared = { ...buildWorkspace({ kind: 'company', name: 'Empresa de Ana' }, { id: SHARED_ID, nowISO: fixedNow.toISOString() }), role: 'admin' };
    await root.createWorkspace(shared);
    await store.refresh();

    assert.equal((await store.setAccountCurrency('XYZ')).ok, false);
    const result = await store.setAccountCurrency('EUR');
    assert.ok(result.ok);
    assert.equal(result.ok && result.changed, 2);
    const saved = await root.listWorkspaces();
    assert.deepEqual(saved.filter((w) => w.id !== SHARED_ID).map((w) => w.currency), ['EUR', 'EUR']);
    assert.equal(saved.find((w) => w.id === SHARED_ID)?.currency, 'DOP', 'el compartido conserva la moneda de su dueño');
    assert.equal(store.getState().data.movements[0].amountCents, 500000, 'el monto no se convierte');
    assert.equal(formatMoney(store.getState().data.movements[0].amountCents), '€ 5,000.00');

    assert.ok((await store.switchWorkspace(SHARED_ID)).ok);
    assert.equal(formatMoney(100), 'RD$ 1.00', 'en el espacio compartido, la moneda de su dueño');
    assert.ok((await store.setAccountCurrency('EUR')).ok, 'misma moneda: nada que cambiar');
  });

  it('si solo tienes espacios compartidos contigo, no puedes cambiar la moneda de nadie', async () => {
    const root = createMemoryWorkspaceStore();
    const store = createStore(root, tickingClock());
    await store.init();
    await root.createWorkspace({ ...buildWorkspace({ kind: 'company', name: 'Empresa de Ana' }, { id: SHARED_ID, nowISO: fixedNow.toISOString() }), role: 'admin' });
    await store.refresh();
    const r = await store.setAccountCurrency('USD');
    assert.equal(r.ok, false);
    assert.equal((await root.listWorkspaces())[0].currency, 'DOP');
  });
});

describe('copias de seguridad con moneda', () => {
  const empty = () => /** @type {any} */ ({
    categories: [], movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [],
    products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], settings: { displayName: '', openingBalanceCents: 0 },
  });
  it('la copia de un espacio dice en qué moneda está; las viejas no lo dicen y siguen sirviendo', () => {
    const withCurrency = parseAnyBackup(JSON.stringify(createBackup(empty(), fixedNow.toISOString(), { kind: 'personal', name: 'Mío', currency: 'USD' })));
    assert.ok(withCurrency.ok && withCurrency.kind === 'workspace' && withCurrency.workspace?.currency === 'USD');
    const old = parseAnyBackup(JSON.stringify(createBackup(empty(), fixedNow.toISOString(), { kind: 'personal', name: 'Mío' })));
    assert.ok(old.ok && old.kind === 'workspace' && old.workspace?.currency === undefined);
  });
  it('al importar en un espacio con otra moneda se avisa que los montos no se convierten', () => {
    assert.match(currencyMismatch('USD', 'DOP'), /Dólar estadounidense \(US\$\).*Peso dominicano \(RD\$\).*NO se convierten/);
    assert.equal(currencyMismatch('USD', 'USD'), '');
    assert.equal(currencyMismatch(null, 'USD'), '');
  });
});

describe('la nube acepta las mismas monedas que la app', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/migrations/20261121000100_currencies.sql', import.meta.url), 'utf8');
  it('la lista de la migración es exactamente la de domain/currencies.js', () => {
    const list = /currency in \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    assert.deepEqual([...list.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]), CURRENCY_CODES);
  });
  it('solo amplía lo permitido: no toca datos', () => {
    assert.doesNotMatch(sql, /\b(update|delete|truncate|drop table|drop column)\b/i);
  });
});
