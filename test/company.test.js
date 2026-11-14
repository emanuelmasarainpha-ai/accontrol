// Salud financiera de la empresa: cifras calculadas a mano (hoy = 2026-11-15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import {
  HEALTH_THRESHOLDS, companyHealth, costBaseline, healthEnabled, healthNotices, runwayLevel,
} from '../src/domain/company.js';

const TODAY = '2026-11-15';
let seq = 0;
/** @param {'income' | 'expense'} type @param {string} date @param {number} pesos @param {'fixed' | 'variable' | 'discretionary' | 'extraordinary'} [classification] @param {string} [id] */
const mv = (type, date, pesos, classification = 'variable', id = `m${++seq}`) => ({
  id, type, amountCents: pesos * 100, date, time: '10:00', description: 'x', classification,
  categoryId: type === 'income' ? 'cat-inc-ventas' : 'cat-exp-otros', createdAt: '', updatedAt: '',
});
/** @returns {import('../src/domain/types.js').AppData} */
const dataOf = (movements = [], over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements, goals: [], contributions: [],
  debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], ...over,
});
/** @param {Partial<import('../src/domain/types.js').Debt>} over */
const debtFixture = (over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 1_200_000, rateBp: 0, rateBasis: /** @type {const} */ ('annual'), frequency: /** @type {const} */ ('monthly'),
  collateralKind: /** @type {const} */ ('personal'), collateralType: 'prestamo-personal',
  firstDueDate: '2026-11-25', firstDueTime: '09:00', finalDueDate: '2027-10-25', finalDueTime: '09:00',
  createdAt: '', updatedAt: '', ...over,
}); // 12 cuotas de RD$ 1,000, sin interés

// Agosto–octubre: ingresos 90 / 100 / 110 mil; fijos 30 / 30 / 30 mil + 6 mil discrecional en octubre; variables 20 / 30 / 40 mil.
function healthyMovements() {
  return [
    mv('income', '2026-08-05', 90000), mv('expense', '2026-08-06', 30000, 'fixed'), mv('expense', '2026-08-07', 20000, 'variable'),
    mv('income', '2026-09-05', 100000), mv('expense', '2026-09-06', 30000, 'fixed'), mv('expense', '2026-09-07', 30000, 'variable'),
    mv('income', '2026-10-05', 110000), mv('expense', '2026-10-06', 30000, 'fixed'), mv('expense', '2026-10-07', 6000, 'discretionary'), mv('expense', '2026-10-08', 40000, 'variable'),
    mv('income', '2026-11-20', 9_999_999), // futuro: no cuenta
  ];
}

test('healthEnabled: solo el espacio Empresa', () => {
  assert.equal(healthEnabled('company'), true);
  for (const kind of /** @type {const} */ (['personal', 'freelancer', 'entrepreneur'])) assert.equal(healthEnabled(kind), false);
  assert.equal(healthEnabled(null), false);
  assert.equal(healthEnabled(undefined), false);
});

test('mes típico: fijos (con discrecionales) y variables de los últimos 3 meses completos, sin pagos de deudas', () => {
  const b = costBaseline(dataOf(healthyMovements()), TODAY);
  assert.deepEqual([b.hasData, b.partial, b.months], [true, false, 3]);
  assert.equal(b.incomeCents, 10_000_000); // (90 + 100 + 110) / 3 mil
  assert.equal(b.fixedCents, 3_200_000); // (30 + 30 + 36) / 3 mil
  assert.equal(b.variableCents, 3_000_000); // (20 + 30 + 40) / 3 mil

  // Un pago de deuda no cuenta como costo (ni fijo ni variable).
  const withDebtPayment = dataOf([...healthyMovements(), mv('expense', '2026-10-12', 5000, 'fixed', 'pagoDeuda')], {
    debtPayments: [{ id: 'p', debtId: 'd1', kind: 'regular', amountCents: 500_000, date: '2026-10-12', time: '10:00', note: '', movementId: 'pagoDeuda', createdAt: '', updatedAt: '' }],
  });
  assert.equal(costBaseline(withDebtPayment, TODAY).fixedCents, 3_200_000);
  // Un mes sin movimientos (julio) no entra al promedio y el mes en curso tampoco si hay meses completos.
  assert.equal(costBaseline(dataOf([...healthyMovements(), mv('income', '2026-11-02', 777)]), TODAY).incomeCents, 10_000_000);
});

test('negocio sano sin deudas: equilibrio, efectivo (Atención por poco colchón) y el resto en Bien', () => {
  const h = companyHealth(dataOf(healthyMovements()), TODAY);
  assert.equal(h.hasData, true);
  // Margen de contribución = (100 − 30) / 100 = 70 %; equilibrio = 32 mil / 0.7 = 45,714.29.
  assert.ok(h.breakEven.ok);
  assert.ok(Math.abs(/** @type {number} */ (h.breakEven.contributionPercent) - 70) < 1e-9);
  assert.equal(h.breakEven.operatingCents, 4_571_429);
  assert.equal(h.breakEven.withDebtCents, 4_571_429);
  assert.ok(Math.abs(/** @type {number} */ (h.breakEven.safetyPercent) - 54.2857142857) < 1e-6);
  // Disponible = 300 − 186 mil = 114 mil; sale 62 mil al mes → 1.84 meses; gana 38 mil al mes.
  assert.equal(h.runway.cashCents, 11_400_000);
  assert.equal(h.runway.monthlyOutflowCents, 6_200_000);
  assert.equal(h.runway.monthlyNetCents, 3_800_000);
  assert.ok(Math.abs(/** @type {number} */ (h.runway.coverageMonths) - 114 / 62) < 1e-9);
  assert.equal(h.runway.burnMonths, null);
  assert.equal(h.leverage.debtToAssetsPercent, 0);
  assert.equal(h.debtLoad.percentOfIncome, 0);
  assert.deepEqual(h.obligations, { dueCents: 0, count: 0, overdueCents: 0, coverCents: 11_400_000 });
  assert.deepEqual(h.levels, { breakEven: 'good', runway: 'watch', leverage: 'good', debtService: 'good', obligations: 'good' });
  assert.deepEqual(h.counts, { risk: 0, watch: 1, good: 4, unknown: 0 });
});

test('con una deuda: el equilibrio sube con la cuota, el efectivo cubre menos y se mide contra los activos', () => {
  const h = companyHealth(dataOf(healthyMovements(), { debts: [debtFixture()] }), TODAY);
  assert.equal(h.baseline.debtServiceCents, 100_000);
  assert.equal(h.breakEven.operatingCents, 4_571_429);
  assert.equal(h.breakEven.withDebtCents, 4_714_286); // (32 + 1) mil / 0.7
  assert.ok(Math.abs(/** @type {number} */ (h.breakEven.safetyPercent) - 52.8571428571) < 1e-6);
  assert.equal(h.runway.monthlyOutflowCents, 6_300_000);
  assert.ok(Math.abs(/** @type {number} */ (h.runway.coverageMonths) - 114 / 63) < 1e-9);
  // Debe 12 mil de 114 mil que tiene = 10.53 %; la cuota es 1 % de los ingresos.
  assert.equal(h.leverage.liabilitiesCents, 1_200_000);
  assert.equal(h.leverage.assetsCents, 11_400_000);
  assert.ok(Math.abs(/** @type {number} */ (h.leverage.debtToAssetsPercent) - (12 / 114) * 100) < 1e-9);
  assert.equal(h.debtLoad.monthlyServiceCents, 100_000);
  assert.ok(Math.abs(/** @type {number} */ (h.debtLoad.percentOfIncome) - 1) < 1e-9);
  // Vence una cuota de 1,000 el 25 de noviembre (dentro de 30 días); hay 114 mil.
  assert.deepEqual(h.obligations, { dueCents: 100_000, count: 1, overdueCents: 0, coverCents: 11_300_000 });
  assert.equal(h.levels.obligations, 'good');
});

test('negocio que pierde dinero: riesgo en equilibrio y en efectivo, y los avisos correspondientes', () => {
  // Septiembre y octubre: ingresan 20 mil, fijos 25 mil, variables 5 mil. Saldo inicial 40 mil → Disponible 20 mil.
  const d = dataOf([
    mv('income', '2026-09-05', 20000), mv('expense', '2026-09-06', 25000, 'fixed'), mv('expense', '2026-09-07', 5000, 'variable'),
    mv('income', '2026-10-05', 20000), mv('expense', '2026-10-06', 25000, 'fixed'), mv('expense', '2026-10-07', 5000, 'variable'),
  ], { settings: { displayName: '', openingBalanceCents: 4_000_000 } });
  const h = companyHealth(d, TODAY);
  // Margen de contribución 75 %; equilibrio = 25 mil / 0.75 = 33,333.33; seguridad = (20 − 33.33) / 20 = −66.67 %.
  assert.equal(h.breakEven.operatingCents, 3_333_333);
  assert.ok(Math.abs(/** @type {number} */ (h.breakEven.safetyPercent) + 66.6666667) < 1e-4);
  assert.equal(h.runway.cashCents, 2_000_000);
  assert.equal(h.runway.monthlyNetCents, -1_000_000);
  assert.ok(Math.abs(/** @type {number} */ (h.runway.coverageMonths) - 2 / 3) < 1e-9); // 20 mil / 30 mil al mes
  assert.equal(h.runway.burnMonths, 2); // pierde 10 mil al mes, le quedan 20 mil
  assert.equal(h.levels.breakEven, 'risk');
  assert.equal(h.levels.runway, 'risk');

  const notices = healthNotices(d, TODAY);
  assert.deepEqual(notices.map((n) => [n.id, n.level]), [['company-runway-low', 'critical'], ['company-below-breakeven', 'info']]);
  assert.match(notices[0].text, /menos de 1 mes/);
  assert.match(notices[0].text, /sale más dinero del que entra/);
});

test('el aviso de efectivo no dice que se pierde dinero si el negocio gana cada mes', () => {
  // Gana 38 mil al mes pero solo tiene 5 mil de efectivo (menos de 1 mes de gastos) → riesgo, sin la frase de pérdida.
  const d = dataOf(healthyMovements().slice(0, -1), { settings: { displayName: '', openingBalanceCents: -10_900_000 } });
  assert.equal(companyHealth(d, TODAY).runway.cashCents, 500_000);
  const notices = healthNotices(d, TODAY);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].id, 'company-runway-low');
  assert.equal(notices[0].level, 'critical');
  assert.doesNotMatch(notices[0].text, /sale más dinero del que entra/);
});

test('si el negocio queda exactamente en cero cada mes, el efectivo no se «agota» (no hay ritmo de pérdida)', () => {
  const h = companyHealth(dataOf([
    mv('income', '2026-09-05', 10000), mv('expense', '2026-09-06', 6000, 'fixed'), mv('expense', '2026-09-07', 4000, 'variable'),
    mv('income', '2026-10-05', 10000), mv('expense', '2026-10-06', 6000, 'fixed'), mv('expense', '2026-10-07', 4000, 'variable'),
  ], { settings: { displayName: '', openingBalanceCents: 500_000 } }), TODAY);
  assert.equal(h.runway.monthlyNetCents, 0);
  assert.equal(h.runway.burnMonths, null);
  assert.equal(h.runway.coverageMonths, 0.5);
});

test('niveles de los meses de efectivo: depende de si el negocio gana o pierde cada mes', () => {
  assert.equal(runwayLevel(0.5, 1000), 'risk');
  assert.equal(runwayLevel(0.99, -1), 'risk');
  assert.equal(runwayLevel(1, 0), 'watch');
  assert.equal(runwayLevel(2.9, 100), 'watch');
  assert.equal(runwayLevel(2.9, -100), 'risk');
  assert.equal(runwayLevel(3, 100), 'good');
  assert.equal(runwayLevel(3, -100), 'watch');
  assert.equal(runwayLevel(5.9, -100), 'watch');
  assert.equal(runwayLevel(6, -100), 'good');
  assert.equal(HEALTH_THRESHOLDS.runway.good, 6);
});

test('deuda sobre activos: 40 % es el límite de «Bien» y más de 60 % es riesgo', () => {
  // Disponible 100 mil (saldo inicial). Deuda de 40 / 50 / 70 mil → 40 % / 50 % / 70 %.
  const at = (/** @type {number} */ debtPesos) => companyHealth(dataOf([], {
    settings: { displayName: '', openingBalanceCents: 10_000_000 }, debts: [debtFixture({ totalCents: debtPesos * 100 })],
  }), TODAY);
  assert.equal(at(40000).levels.leverage, 'good');
  assert.equal(at(50000).levels.leverage, 'watch');
  assert.equal(at(60000).levels.leverage, 'watch');
  assert.equal(at(70000).levels.leverage, 'risk');
  // Sin ingresos que comparar, el peso de la cuota no se juzga (no se inventa un porcentaje).
  assert.equal(at(40000).debtLoad.percentOfIncome, null);
  assert.equal(at(40000).levels.debtService, 'unknown');
});

test('deuda mayor que los activos: la proporción no se calcula y es riesgo', () => {
  const h = companyHealth(dataOf([], { debts: [debtFixture()] }), TODAY); // sin efectivo ni activos
  assert.equal(h.leverage.debtToAssetsPercent, null);
  assert.equal(h.levels.leverage, 'risk');
});

test('peso de las cuotas sobre los ingresos: 20 % y 35 % son los cortes', () => {
  // Ingreso típico 100 mil (septiembre y octubre) y una deuda cuya cuota mensual es 10 / 30 / 40 mil.
  const withService = (/** @type {number} */ monthlyThousands) => companyHealth(dataOf([
    mv('income', '2026-09-05', 100000), mv('expense', '2026-09-06', 10000, 'fixed'),
    mv('income', '2026-10-05', 100000), mv('expense', '2026-10-06', 10000, 'fixed'),
  ], { debts: [debtFixture({ totalCents: monthlyThousands * 1000 * 12 * 100 })] }), TODAY);
  assert.equal(withService(10).levels.debtService, 'good'); // 10 %
  assert.equal(withService(20).levels.debtService, 'good'); // 20 % exacto
  assert.equal(withService(30).levels.debtService, 'watch');
  assert.equal(withService(40).levels.debtService, 'risk');
});

test('cuotas a 30 días: incluye lo vencido y compara con el Disponible', () => {
  // Primera cuota el 25 de octubre sin pagar (vencida) y la del 25 de noviembre (dentro de 30 días): 2 cuotas de 1,000.
  const debts = [debtFixture({ firstDueDate: '2026-10-25', finalDueDate: '2027-09-25' })];
  const at = (/** @type {number} */ openingPesos) => companyHealth(dataOf([], { settings: { displayName: '', openingBalanceCents: openingPesos * 100 }, debts }), TODAY);
  const h = at(1500);
  assert.deepEqual([h.obligations.dueCents, h.obligations.count, h.obligations.overdueCents], [200_000, 2, 100_000]);
  assert.equal(h.obligations.coverCents, 150_000 - 200_000);
  assert.equal(h.levels.obligations, 'risk'); // 1,500 < 2,000
  assert.equal(at(2500).levels.obligations, 'watch'); // alcanza, pero menos del doble
  assert.equal(at(4000).levels.obligations, 'good'); // 4,000 = 2 × 2,000
  // Una cuota de diciembre 20 (después de 30 días) no entra.
  const later = companyHealth(dataOf([], { settings: { displayName: '', openingBalanceCents: 100 }, debts: [debtFixture({ firstDueDate: '2026-12-20', finalDueDate: '2027-11-20' })] }), TODAY);
  assert.equal(later.obligations.count, 0);
  assert.equal(later.levels.obligations, 'good');
});

test('casos límite del punto de equilibrio: sin ingresos, sin margen y sin datos', () => {
  // Solo gastos: no se calcula (no se inventa), nivel «sin datos»; el efectivo (negativo) cubre 0 meses → riesgo.
  const noIncome = companyHealth(dataOf([mv('expense', '2026-10-05', 5000, 'fixed')]), TODAY);
  assert.deepEqual([noIncome.breakEven.ok, noIncome.breakEven.reason, noIncome.levels.breakEven], [false, 'no-income', 'unknown']);
  assert.equal(noIncome.runway.coverageMonths, 0);
  assert.equal(noIncome.levels.runway, 'risk');

  // Los costos variables se comen todo el ingreso: ninguna venta alcanza para cubrir los fijos.
  const noMargin = companyHealth(dataOf([mv('income', '2026-10-05', 10000), mv('expense', '2026-10-06', 12000, 'variable')]), TODAY);
  assert.deepEqual([noMargin.breakEven.ok, noMargin.breakEven.reason, noMargin.levels.breakEven], [false, 'no-margin', 'risk']);
  assert.equal(noMargin.breakEven.operatingCents, null);

  // Todo variable, sin fijos: el equilibrio es 0 y la seguridad 100 %.
  const noFixed = companyHealth(dataOf([mv('income', '2026-10-05', 10000), mv('expense', '2026-10-06', 4000, 'variable')]), TODAY);
  assert.equal(noFixed.breakEven.operatingCents, 0);
  assert.equal(noFixed.breakEven.safetyPercent, 100);

  // Vacío: ningún indicador se declara «bien».
  const empty = companyHealth(dataOf(), TODAY);
  assert.equal(empty.hasData, false);
  assert.deepEqual(empty.levels, { breakEven: 'unknown', runway: 'unknown', leverage: 'unknown', debtService: 'unknown', obligations: 'unknown' });
  assert.deepEqual(empty.counts, { risk: 0, watch: 0, good: 0, unknown: 5 });
  assert.deepEqual(healthNotices(dataOf(), TODAY), []);
});

test('solo el mes en curso: se calcula (parcial) pero no se emiten avisos', () => {
  const d = dataOf([mv('income', '2026-11-02', 20000), mv('expense', '2026-11-03', 25000, 'fixed')]);
  const h = companyHealth(d, TODAY);
  assert.deepEqual([h.hasData, h.partial, h.months], [true, true, 1]);
  assert.deepEqual(healthNotices(d, TODAY), []);
});
