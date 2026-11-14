import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_CATEGORIES, assetTypeLabel, assetValueAt, isAssetCategory, normalizeValuations, validateAsset, validateValuation,
} from '../src/domain/assets.js';
import { assetBreakdown, debtEvolution, monthEnd, netWorthAt, netWorthSummary } from '../src/domain/netWorth.js';
import { replayPayments } from '../src/domain/debts.js';
import { defaultSettings } from '../src/domain/settings.js';

const today = '2026-07-20';

/** @param {Partial<import('../src/domain/types.js').Asset>} over */
const asset = (over = {}) => ({
  id: 'a1', name: 'Carro', category: 'vehicles', subtype: 'car', description: '', acquiredDate: '2026-03-10',
  valuations: [{ date: '2026-03-10', valueCents: 50_000_000 }],
  createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z', ...over,
});

/** @param {Partial<import('../src/domain/types.js').Debt>} over */
const debt = (over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 10_000_000, rateBp: 1200, rateBasis: 'annual', frequency: 'monthly',
  collateralKind: 'personal', collateralType: 'prestamo-personal',
  firstDueDate: '2026-07-01', firstDueTime: '09:00', finalDueDate: '2027-06-01', finalDueTime: '09:00',
  createdAt: '2026-05-15T12:00:00.000Z', updatedAt: '2026-05-15T12:00:00.000Z', ...over,
});

/** @param {string} id @param {number} amountCents @param {string} date */
const pay = (id, amountCents, date) => ({
  id, debtId: 'd1', kind: /** @type {const} */ ('regular'), amountCents, date, time: '10:00', note: '', movementId: `m-${id}`,
  createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`,
});

/** @param {string} id @param {'income'|'expense'} type @param {number} amountCents @param {string} date */
const mv = (id, type, amountCents, date) => ({
  id, type, amountCents, date, time: '09:00', description: id, classification: /** @type {const} */ (type === 'income' ? 'fixed' : 'variable'),
  categoryId: 'c', createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`,
});

/** @param {string} id @param {'deposit'|'withdrawal'} kind @param {number} amountCents @param {string} date */
const contribution = (id, kind, amountCents, date) => ({
  id, goalId: 'g1', kind, amountCents, date, time: '09:00', note: '', createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`,
});

/** @param {Partial<import('../src/domain/types.js').AppData>} over @returns {import('../src/domain/types.js').AppData} */
const data = (over = {}) => ({
  categories: [], movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [],
  settings: defaultSettings(), ...over,
});

// ------------------------------------------------------------------ activos

test('categorías de activos: las 7 del documento y sus tipos', () => {
  assert.deepEqual(Object.keys(ASSET_CATEGORIES), ['cash', 'bank', 'investments', 'vehicles', 'realEstate', 'business', 'other']);
  assert.equal(isAssetCategory('vehicles'), true);
  assert.equal(isAssetCategory('toString'), false, 'no se aceptan nombres heredados de Object');
  assert.equal(isAssetCategory(5), false);
  assert.equal(assetTypeLabel(asset()), 'Automóvil');
  assert.equal(assetTypeLabel(asset({ subtype: '' })), 'Vehículos');
});

test('valor de un activo: 0 antes de adquirirlo y escalonado después', () => {
  const a = asset({ valuations: [{ date: '2026-03-10', valueCents: 100 }, { date: '2026-05-01', valueCents: 80 }] });
  assert.equal(assetValueAt(a, '2026-03-09'), 0);
  assert.equal(assetValueAt(a, '2026-03-10'), 100);
  assert.equal(assetValueAt(a, '2026-04-30'), 100);
  assert.equal(assetValueAt(a, '2026-05-01'), 80);
  assert.equal(assetValueAt(a, '2030-01-01'), 80);
});

test('normalizeValuations: ordena y deja el último valor de cada fecha', () => {
  assert.deepEqual(
    normalizeValuations([{ date: '2026-05-01', valueCents: 5 }, { date: '2026-03-01', valueCents: 3 }, { date: '2026-05-01', valueCents: 6 }]),
    [{ date: '2026-03-01', valueCents: 3 }, { date: '2026-05-01', valueCents: 6 }],
  );
});

test('validateAsset: campos obligatorios y límites', () => {
  const ok = { name: '  Mi   carro ', category: 'vehicles', subtype: 'car', description: '', valueText: '500,000', acquiredDate: '2026-03-10' };
  const r = validateAsset(ok, { today });
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.value, { name: 'Mi carro', category: 'vehicles', subtype: 'car', description: '', acquiredDate: '2026-03-10', valueCents: 50_000_000 });

  /** @param {Partial<typeof ok>} over */
  const bad = (over) => validateAsset({ ...ok, ...over }, { today });
  assert.equal(bad({ name: ' ' }).ok, false);
  assert.equal(bad({ name: 'x'.repeat(61) }).ok, false);
  assert.equal(bad({ category: 'banco' }).ok, false);
  assert.equal(bad({ subtype: 'boat' }).ok, false, 'tipo que no es de la categoría');
  assert.equal(bad({ valueText: '0' }).ok, false);
  assert.equal(bad({ valueText: 'abc' }).ok, false);
  assert.equal(bad({ valueText: '1,000,000,000' }).ok, false);
  assert.equal(bad({ acquiredDate: '2026-07-21' }).ok, false, 'fecha futura');
  assert.equal(bad({ acquiredDate: '1800-01-01' }).ok, false);
  assert.equal(bad({ acquiredDate: '2026-02-30' }).ok, false);
  assert.equal(bad({ description: 'x'.repeat(201) }).ok, false);
  assert.equal(bad({ subtype: '' }).ok, true, 'el tipo es opcional');
});

test('validateAsset al editar: no pide valor y protege los valores ya registrados', () => {
  const existing = asset({ valuations: [{ date: '2026-03-10', valueCents: 100 }, { date: '2026-05-01', valueCents: 80 }] });
  const input = { name: 'Carro', category: 'vehicles', subtype: 'car', description: '', valueText: '', acquiredDate: '2026-03-10' };
  assert.ok(validateAsset(input, { today, existing }).ok, 'sin valor al editar');
  assert.ok(validateAsset({ ...input, acquiredDate: '2026-01-01' }, { today, existing }).ok, 'adelantar la adquisición está bien');
  const late = validateAsset({ ...input, acquiredDate: '2026-06-01' }, { today, existing });
  assert.equal(late.ok, false, 'no puede quedar después de un valor ya registrado');
});

test('validateValuation: fecha entre la adquisición y hoy; el valor puede ser 0', () => {
  const a = asset();
  assert.deepEqual(validateValuation({ valueText: '450,000', date: '2026-07-01' }, { today, asset: a }), { ok: true, value: { date: '2026-07-01', valueCents: 45_000_000 } });
  assert.ok(validateValuation({ valueText: '0', date: '2026-07-01' }, { today, asset: a }).ok, 'vendido: vale 0');
  assert.equal(validateValuation({ valueText: '1', date: '2026-03-09' }, { today, asset: a }).ok, false);
  assert.equal(validateValuation({ valueText: '1', date: '2026-07-21' }, { today, asset: a }).ok, false);
  assert.equal(validateValuation({ valueText: '-5', date: '2026-07-01' }, { today, asset: a }).ok, false);
  assert.equal(validateValuation({ valueText: '1', date: '' }, { today, asset: a }).ok, false);
});

// ------------------------------------------------------------------ patrimonio

test('fin de mes', () => {
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(monthEnd('2026-12'), '2026-12-31');
});

test('sin ningún registro: el patrimonio es el saldo inicial', () => {
  const d = data({ settings: { displayName: '', openingBalanceCents: 123_00 } });
  const s = netWorthSummary(d, today);
  assert.equal(s.now.netWorthCents, 123_00);
  assert.equal(s.hasAnything, false);
  assert.equal(s.monthly, null);
  assert.equal(s.annual, null);
  assert.equal(s.series.length, 1);
});

test('patrimonio = dinero registrado + activos - deudas (y ahorrar en una meta no lo cambia)', () => {
  const d = data({
    settings: { displayName: '', openingBalanceCents: 1_000_00 },
    movements: [mv('i', 'income', 10_000_00, '2026-07-01'), mv('e', 'expense', 2_500_00, '2026-07-05'), mv('futuro', 'income', 99_000_00, '2026-08-01')],
    contributions: [contribution('c1', 'deposit', 3_000_00, '2026-07-06'), contribution('c2', 'withdrawal', 500_00, '2026-07-07')],
    assets: [asset()],
    debts: [debt()],
  });
  const p = netWorthAt(d, today);
  assert.equal(p.moneyCents, 1_000_00 + 10_000_00 - 2_500_00, 'dinero = saldo + ingresos - gastos (lo futuro no cuenta)');
  assert.equal(p.savedCents, 2_500_00);
  assert.equal(p.availableCents, p.moneyCents - p.savedCents);
  assert.equal(p.assetsManualCents, 50_000_000);
  assert.equal(p.liabilitiesCents, 10_000_000);
  assert.equal(p.assetsCents, p.moneyCents + 50_000_000);
  assert.equal(p.netWorthCents, p.moneyCents + 50_000_000 - 10_000_000);

  const without = netWorthAt({ ...d, contributions: [] }, today);
  assert.equal(without.netWorthCents, p.netWorthCents, 'apartar dinero para una meta no cambia el patrimonio');
  assert.notEqual(without.availableCents, p.availableCents);
});

test('un activo cuenta desde su fecha de adquisición y cambia con cada valor registrado', () => {
  const a = asset({ valuations: [{ date: '2026-03-10', valueCents: 100_00 }, { date: '2026-06-01', valueCents: 70_00 }] });
  const d = data({ assets: [a] });
  assert.equal(netWorthAt(d, '2026-03-09').netWorthCents, 0);
  assert.equal(netWorthAt(d, '2026-03-10').netWorthCents, 100_00);
  assert.equal(netWorthAt(d, '2026-05-31').netWorthCents, 100_00);
  assert.equal(netWorthAt(d, '2026-06-01').netWorthCents, 70_00);
});

test('deuda: cuenta desde que se registra, baja solo con la parte de capital y nunca pasa de 0', () => {
  const payments = [pay('p1', 1_500_000, '2026-07-01')];
  const d = data({ debts: [debt()], debtPayments: payments });
  const step = replayPayments(debt(), payments).steps[0];
  assert.ok(step.interestCents > 0 && step.principalCents > 0);

  assert.equal(netWorthAt(d, '2026-05-14').liabilitiesCents, 0, 'antes de registrarla no existe');
  assert.equal(netWorthAt(d, '2026-05-15').liabilitiesCents, 10_000_000);
  assert.equal(netWorthAt(d, '2026-06-30').liabilitiesCents, 10_000_000);
  assert.equal(netWorthAt(d, '2026-07-01').liabilitiesCents, 10_000_000 - step.principalCents, 'solo el capital reduce la deuda');
});

test('un pago de deuda baja el patrimonio solo por los intereses (el gasto vinculado y el capital se compensan)', () => {
  const payments = [pay('p1', 1_500_000, '2026-07-01')];
  const base = data({ settings: { displayName: '', openingBalanceCents: 50_000_000 }, debts: [debt()] });
  const before = netWorthAt(base, '2026-06-30').netWorthCents;
  const after = netWorthAt({ ...base, debtPayments: payments, movements: [mv('m-p1', 'expense', 1_500_000, '2026-07-01')] }, '2026-07-01').netWorthCents;
  const { interestCents } = replayPayments(debt(), payments).steps[0];
  assert.equal(before - after, interestCents);
});

test('una deuda con pagos anteriores a su registro cuenta desde su primer pago', () => {
  const old = debt({ createdAt: '2026-07-15T12:00:00.000Z' });
  const d = data({ debts: [old], debtPayments: [pay('p1', 1_000_000, '2026-06-01')] });
  assert.ok(netWorthAt(d, '2026-06-01').liabilitiesCents > 0);
  assert.equal(netWorthAt(d, '2026-05-31').liabilitiesCents, 0);
});

test('resumen: variación mensual, anual y serie de cierres de mes', () => {
  const d = data({
    settings: { displayName: '', openingBalanceCents: 1_000_00 },
    movements: [
      mv('a', 'income', 5_000_00, '2025-07-10'), // hace más de un año: da base para la variación anual
      mv('b', 'income', 1_000_00, '2026-05-10'),
      mv('c', 'expense', 400_00, '2026-06-20'),
      mv('d', 'income', 2_000_00, '2026-07-05'),
    ],
  });
  const s = netWorthSummary(d, today);
  assert.equal(s.hasAnything, true);
  assert.equal(s.now.netWorthCents, 1_000_00 + 5_000_00 + 1_000_00 - 400_00 + 2_000_00);
  const juneEnd = netWorthAt(d, '2026-06-30').netWorthCents;
  assert.equal(s.monthly?.changeCents, s.now.netWorthCents - juneEnd);
  assert.equal(s.monthly?.changeCents, 2_000_00);
  assert.ok(Math.abs((s.monthly?.percent ?? 0) - (2_000_00 / juneEnd) * 100) < 1e-9);
  const yearAgo = netWorthAt(d, '2025-07-31').netWorthCents;
  assert.equal(s.annual?.changeCents, s.now.netWorthCents - yearAgo);
  assert.equal(s.series.length, 12);
  assert.equal(s.series[0].monthKey, '2025-08');
  assert.equal(s.series.at(-1)?.monthKey, '2026-07');
  assert.deepEqual(s.series.at(-1)?.point, s.now, 'el último punto es "hoy"');
  assert.equal(s.series.find((x) => x.monthKey === '2026-06')?.point.netWorthCents, juneEnd, 'cierre de mes');
});

test('resumen: sin historial suficiente no se inventa la variación', () => {
  const recent = data({ movements: [mv('a', 'income', 100_00, '2026-07-05')] });
  const s = netWorthSummary(recent, today);
  assert.equal(s.monthly, null, 'el primer registro es de este mes: no hay mes anterior');
  assert.equal(s.annual, null);
  assert.equal(s.series.length, 1, 'la serie empieza en el primer registro');

  const half = data({ movements: [mv('a', 'income', 100_00, '2026-03-05')] });
  const h = netWorthSummary(half, today);
  assert.ok(h.monthly);
  assert.equal(h.annual, null, 'aún no hay un año');
  assert.equal(h.series.length, 5);
});

test('variación porcentual: sin base positiva no hay porcentaje', () => {
  const d = data({ movements: [mv('a', 'expense', 100_00, '2026-06-05'), mv('b', 'income', 500_00, '2026-07-05')] });
  const s = netWorthSummary(d, today);
  assert.ok(s.monthly);
  assert.equal(s.monthly.percent, null, 'el mes anterior cerró en negativo');
  assert.equal(s.monthly.changeCents, 500_00);
});

test('desglose por categoría de activo', () => {
  const d = data({
    assets: [
      asset({ id: 'a1', category: 'vehicles', valuations: [{ date: '2026-03-10', valueCents: 100_00 }] }),
      asset({ id: 'a2', name: 'Casa', category: 'realEstate', subtype: 'house', valuations: [{ date: '2026-03-10', valueCents: 900_00 }] }),
      asset({ id: 'a3', name: 'Otro carro', category: 'vehicles', valuations: [{ date: '2026-03-10', valueCents: 50_00 }] }),
    ],
  });
  const b = assetBreakdown(netWorthAt(d, today));
  assert.deepEqual(b.map((x) => [x.key, x.valueCents, x.count]), [['realEstate', 900_00, 1], ['vehicles', 150_00, 2]]);
});

test('evolución de la deuda total: cada cierre de mes, coherente con el patrimonio', () => {
  // Deuda de 100,000 registrada el 15 de mayo; capital pagado: 8,000 el 1 de julio.
  const d = data({ debts: [debt()], debtPayments: [pay('p1', 9_000_00, '2026-07-01')] });
  const evo = debtEvolution(d, today);
  assert.deepEqual(evo.map((e) => e.monthKey), ['2026-05', '2026-06', '2026-07']);
  assert.equal(evo[0].owedCents, 10_000_000);
  assert.equal(evo[1].owedCents, 10_000_000);
  assert.ok(evo[2].owedCents < 10_000_000 && evo[2].owedCents > 9_000_000, 'bajó solo por el capital pagado, no por los intereses');
  assert.deepEqual(evo.map((e) => e.activeCount), [1, 1, 1]);
  const summary = netWorthSummary(d, today);
  assert.deepEqual(evo.map((e) => e.owedCents), summary.series.map((s) => s.point.liabilitiesCents));
  assert.equal(evo.at(-1)?.owedCents, summary.now.liabilitiesCents);
});

test('evolución de la deuda total: sin deudas todo es 0 y una deuda saldada deja de contar', () => {
  assert.ok(debtEvolution(data({ movements: [mv('a', 'income', 100_00, '2026-05-05')] }), today).every((e) => e.owedCents === 0 && e.activeCount === 0));
  const paid = data({ debts: [debt({ totalCents: 1_000_00 })], debtPayments: [pay('p1', 1_000_00 + 10_00, '2026-06-20')] }); // capital 1,000 + 1 mes de interés (1 %)
  const evo = debtEvolution(paid, today);
  assert.equal(evo.at(-1)?.owedCents, 0);
  assert.equal(evo.at(-1)?.activeCount, 0);
});
