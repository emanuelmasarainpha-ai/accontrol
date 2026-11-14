import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amortizationSchedule, compoundGrowth, financialIndependence, futureValue, inflationImpact, loanMonths, loanPayment,
  loanPrincipal, monthsToTarget, presentValueAnnuity, presentValueFlows, presentValueLump, requiredContribution, roi,
  simpleInterest, COMPOUNDING, isCompounding,
} from '../src/domain/finmath.js';

/** Pesos -> centavos. @param {number} pesos */
const c = (pesos) => Math.round(pesos * 100);
/** Dos números en centavos difieren a lo sumo `tol` centavos. @param {number|null} a @param {number} b @param {number} tol @param {string} [msg] */
const near = (a, b, tol, msg = '') => {
  assert.notEqual(a, null, msg || 'no debía ser null');
  assert.ok(Math.abs(/** @type {number} */ (a) - b) <= tol, `${msg} esperado ${b} ± ${tol}, salió ${a}`);
};

// ------------------------------------------------------------------ interés simple

test('interés simple: I = C × tasa × tiempo', () => {
  const r = simpleInterest({ capitalCents: c(100_000), ratePercent: 10, years: 3 });
  assert.equal(r?.solved, 'interest');
  assert.equal(r?.interestCents, c(30_000));
  assert.equal(r?.totalCents, c(130_000));
});

test('interés simple: se puede despejar capital, tasa y tiempo (y vuelve al mismo resultado)', () => {
  const cap = simpleInterest({ interestCents: c(30_000), ratePercent: 10, years: 3 });
  assert.equal(cap?.solved, 'capital');
  assert.equal(cap?.capitalCents, c(100_000));
  const rate = simpleInterest({ capitalCents: c(100_000), interestCents: c(30_000), years: 3 });
  assert.equal(rate?.solved, 'rate');
  assert.equal(rate?.ratePercent, 10);
  const time = simpleInterest({ capitalCents: c(100_000), interestCents: c(30_000), ratePercent: 10 });
  assert.equal(time?.solved, 'time');
  assert.equal(time?.years, 3);
});

test('interés simple: pide exactamente tres datos y no divide entre cero', () => {
  assert.equal(simpleInterest({ capitalCents: 1, ratePercent: 1 }), null, 'faltan dos');
  assert.equal(simpleInterest({ capitalCents: 1, ratePercent: 1, years: 1, interestCents: 1 }), null, 'sobra uno: no hay nada que calcular');
  assert.equal(simpleInterest({ interestCents: 100, ratePercent: 0, years: 3 }), null, 'capital con tasa 0');
  assert.equal(simpleInterest({ capitalCents: 0, interestCents: 100, years: 3 }), null, 'tasa con capital 0');
  assert.equal(simpleInterest({ capitalCents: 100, interestCents: 100, ratePercent: 0 }), null, 'tiempo con tasa 0');
  assert.equal(simpleInterest({ capitalCents: Number.NaN, ratePercent: 1, years: 1 }), null);
  assert.equal(simpleInterest({ capitalCents: c(1000), ratePercent: 0, years: 5 })?.interestCents, 0, 'tasa 0 sí da interés 0');
});

// ------------------------------------------------------------------ interés compuesto

test('interés compuesto: capital inicial capitalizado cada mes (12 % anual, 1 año)', () => {
  const r = compoundGrowth({ principalCents: c(100_000), monthlyContributionCents: 0, annualRatePercent: 12, compoundsPerYear: 12, months: 12 });
  assert.equal(r?.futureValueCents, c(112_682.5));
  assert.equal(r?.contributedCents, c(100_000));
  assert.equal(r?.interestCents, c(12_682.5));
  near(r?.growthPercent ?? null, 12.6825, 0.001);
  near(r?.effectiveAnnualPercent ?? null, 12.6825, 0.001);
});

test('interés compuesto: capitalización anual 8 % por 5 años = 1.08^5', () => {
  const r = compoundGrowth({ principalCents: c(100_000), monthlyContributionCents: 0, annualRatePercent: 8, compoundsPerYear: 1, months: 60 });
  assert.equal(r?.futureValueCents, c(146_932.81));
});

test('interés compuesto: más capitalización rinde más (tasa efectiva anual)', () => {
  const eff = (/** @type {number} */ m) => compoundGrowth({ principalCents: c(1000), monthlyContributionCents: 0, annualRatePercent: 12, compoundsPerYear: m, months: 12 })?.effectiveAnnualPercent ?? 0;
  assert.ok(eff(1) < eff(2) && eff(2) < eff(4) && eff(4) < eff(12) && eff(12) < eff(365));
  near(eff(1), 12, 1e-9);
  near(eff(365), 12.7475, 0.001);
});

test('interés compuesto: aportes mensuales al final de cada mes (anualidad: 1,000 × 12 meses a 1 %)', () => {
  const r = compoundGrowth({ principalCents: 0, monthlyContributionCents: c(1000), annualRatePercent: 12, compoundsPerYear: 12, months: 12 });
  assert.equal(r?.futureValueCents, c(12_682.5));
  assert.equal(r?.contributedCents, c(12_000));
  assert.equal(r?.interestCents, c(682.5));
  assert.equal(r?.growthPercent !== null, true);
});

test('interés compuesto: coincide con la fórmula cerrada en un caso largo y con valor futuro', () => {
  const P = c(50_000);
  const PMT = c(5000);
  const i = 0.09 / 12;
  const n = 120;
  const expected = P * (1 + i) ** n + (PMT * ((1 + i) ** n - 1)) / i;
  const r = compoundGrowth({ principalCents: P, monthlyContributionCents: PMT, annualRatePercent: 9, compoundsPerYear: 12, months: n });
  near(r?.futureValueCents ?? null, Math.round(expected), 2);
  assert.equal(futureValue({ presentCents: P, paymentCents: PMT, annualRatePercent: 9, months: n }), r?.futureValueCents);
});

test('interés compuesto: tabla por año, con un último tramo si no son años completos', () => {
  const r = compoundGrowth({ principalCents: c(1000), monthlyContributionCents: c(100), annualRatePercent: 6, compoundsPerYear: 12, months: 30 });
  assert.deepEqual(r?.rows.map((x) => x.month), [12, 24, 30]);
  assert.ok(r && r.rows.every((x, k) => k === 0 || x.balanceCents > r.rows[k - 1].balanceCents));
  assert.ok(r && r.rows.every((x) => x.balanceCents === x.contributedCents + x.interestCents));
  assert.equal(r?.rows.at(-1)?.balanceCents, r?.futureValueCents);
  assert.equal(r?.rows[0].contributedCents, c(1000) + 12 * c(100));
});

test('interés compuesto: tasa 0 no crece y sin nada aportado no hay porcentaje de crecimiento', () => {
  const flat = compoundGrowth({ principalCents: c(1000), monthlyContributionCents: c(100), annualRatePercent: 0, compoundsPerYear: 12, months: 24 });
  assert.equal(flat?.futureValueCents, c(1000) + 24 * c(100));
  assert.equal(flat?.interestCents, 0);
  const none = compoundGrowth({ principalCents: 0, monthlyContributionCents: 0, annualRatePercent: 5, compoundsPerYear: 12, months: 12 });
  assert.equal(none?.growthPercent, null);
  assert.equal(none?.futureValueCents, 0);
});

test('interés compuesto: rechaza datos imposibles', () => {
  const ok = { principalCents: 100, monthlyContributionCents: 0, annualRatePercent: 5, compoundsPerYear: 12, months: 12 };
  assert.ok(compoundGrowth(ok));
  for (const bad of [{ months: 0 }, { months: 1.5 }, { months: 1201 }, { annualRatePercent: -1 }, { annualRatePercent: 1001 }, { principalCents: -1 }, { monthlyContributionCents: -5 }, { compoundsPerYear: 0 }, { months: Number.NaN }]) {
    assert.equal(compoundGrowth({ ...ok, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(compoundGrowth({ ...ok, principalCents: c(1_000_000), annualRatePercent: 1000, compoundsPerYear: 365, months: 1200 }), null, 'un resultado absurdo no se muestra');
});

test('capitalización: las opciones y su validación', () => {
  assert.deepEqual(Object.keys(COMPOUNDING), ['daily', 'monthly', 'quarterly', 'semiannual', 'annual']);
  assert.equal(isCompounding('monthly'), true);
  assert.equal(isCompounding('toString'), false);
});

// ------------------------------------------------------------------ préstamos

test('préstamo: cuota conocida (100,000 al 12 % a 12 meses = 8,884.88)', () => {
  assert.equal(loanPayment({ principalCents: c(100_000), annualRatePercent: 12, months: 12 }), c(8884.88));
});

test('préstamo: cuota conocida a 30 años (1,000,000 al 12 % = 10,286.13)', () => {
  assert.equal(loanPayment({ principalCents: c(1_000_000), annualRatePercent: 12, months: 360 }), c(10_286.13));
});

test('préstamo: sin interés la cuota es monto / meses', () => {
  assert.equal(loanPayment({ principalCents: c(12_000), annualRatePercent: 0, months: 12 }), c(1000));
  assert.equal(loanPrincipal({ paymentCents: c(1000), annualRatePercent: 0, months: 12 }), c(12_000));
  assert.equal(loanMonths({ principalCents: c(12_000), paymentCents: c(1000), annualRatePercent: 0 }), 12);
});

test('préstamo: monto, cuota y plazo son inversos entre sí', () => {
  const payment = loanPayment({ principalCents: c(250_000), annualRatePercent: 18, months: 48 });
  assert.ok(payment);
  near(loanPrincipal({ paymentCents: payment, annualRatePercent: 18, months: 48 }), c(250_000), 100);
  assert.equal(loanMonths({ principalCents: c(250_000), paymentCents: payment, annualRatePercent: 18 }), 48);
});

test('préstamo: duración con una cuota que no alcanza para los intereses es null', () => {
  // 100,000 al 12 % deja 1,000 de interés el primer mes.
  assert.equal(loanMonths({ principalCents: c(100_000), paymentCents: c(1000), annualRatePercent: 12 }), null);
  assert.equal(loanMonths({ principalCents: c(100_000), paymentCents: c(999), annualRatePercent: 12 }), null);
  assert.equal(loanMonths({ principalCents: c(100_000), paymentCents: c(1001), annualRatePercent: 12 }), null, 'tardaría más de 50 años');
  assert.equal(loanMonths({ principalCents: c(100_000), paymentCents: c(2000), annualRatePercent: 12 }), 70);
});

test('préstamo: rechaza datos imposibles', () => {
  assert.equal(loanPayment({ principalCents: 0, annualRatePercent: 12, months: 12 }), null);
  assert.equal(loanPayment({ principalCents: 100, annualRatePercent: -1, months: 12 }), null);
  assert.equal(loanPayment({ principalCents: 100, annualRatePercent: 12, months: 601 }), null);
  assert.equal(loanPayment({ principalCents: 100, annualRatePercent: 12, months: 0 }), null);
  assert.equal(loanPayment({ principalCents: 100, annualRatePercent: 12, months: 2.5 }), null);
  assert.equal(loanPrincipal({ paymentCents: 0, annualRatePercent: 12, months: 12 }), null);
});

// ------------------------------------------------------------------ amortización

test('amortización: primera fila, última fila y totales (100,000 al 12 % a 12 meses)', () => {
  const a = amortizationSchedule({ principalCents: c(100_000), annualRatePercent: 12, months: 12 });
  assert.ok(a);
  assert.equal(a.rows.length, 12);
  assert.equal(a.paymentCents, c(8884.88));
  assert.deepEqual(a.rows[0], { number: 1, paymentCents: c(8884.88), interestCents: c(1000), principalCents: c(7884.88), extraCents: 0, balanceCents: c(92_115.12) });
  assert.equal(a.rows.at(-1)?.balanceCents, 0);
  assert.equal(a.rows.reduce((s, r) => s + r.principalCents, 0), c(100_000), 'el capital pagado suma el préstamo');
  assert.equal(a.totalPaidCents, a.rows.reduce((s, r) => s + r.paymentCents, 0));
  assert.equal(a.totalPaidCents, c(100_000) + a.totalInterestCents);
  // 12 cuotas de 8,884.88 son 106,618.56: los intereses son ~6,618.56 (la última cuota ajusta unos centavos).
  near(a.totalInterestCents, c(6618.56), 12);
  for (const row of a.rows.slice(0, -1)) assert.equal(row.paymentCents, c(8884.88));
  near(a.rows.at(-1)?.paymentCents ?? null, c(8884.88), 20);
});

test('amortización: el saldo nunca es negativo y termina en 0 para muchas combinaciones', () => {
  for (const principal of [1000, 55_555.55, 2_500_000]) {
    for (const rate of [0, 3.5, 12, 36, 120]) {
      for (const months of [1, 2, 7, 36, 120, 600]) {
        const label = `${principal} al ${rate} % a ${months} meses`;
        const a = amortizationSchedule({ principalCents: c(principal), annualRatePercent: rate, months });
        if (a === null) {
          // Solo pasa cuando la cuota (redondeada al centavo) no baja el capital ni el primer mes:
          // préstamos de 50 años con tasas de 36 % o más, que casi solo pagan intereses.
          const payment = loanPayment({ principalCents: c(principal), annualRatePercent: rate, months }) ?? 0;
          assert.ok(rate >= 12 && months >= 120 && payment <= Math.round(c(principal) * rate / 1200) + 1, `sin tabla: ${label}`);
          continue;
        }
        // Si la cuota se redondea hacia arriba al centavo, el préstamo puede terminar unas cuotas antes del plazo
        // (sobre todo con préstamos diminutos o larguísimos, donde ese centavo pesa mucho).
        assert.ok(a.rows.length <= months, label);
        if (rate <= 12 && principal >= 50_000) assert.ok(a.rows.length >= months - 1, `${a.rows.length} filas: ${label}`);
        assert.equal(a.rows.at(-1)?.balanceCents, 0, label);
        assert.ok(a.rows.every((r) => r.balanceCents >= 0 && r.interestCents >= 0 && r.principalCents > 0), label);
        assert.equal(a.rows.reduce((s, r) => s + r.principalCents, 0), c(principal), label);
      }
    }
  }
});

test('amortización: un abono extra mensual acorta el préstamo y ahorra intereses', () => {
  const base = amortizationSchedule({ principalCents: c(300_000), annualRatePercent: 15, months: 60 });
  const extra = amortizationSchedule({ principalCents: c(300_000), annualRatePercent: 15, months: 60, extraCents: c(2000) });
  assert.ok(base && extra);
  assert.ok(extra.months < base.months, `${extra.months} < ${base.months}`);
  assert.ok(extra.totalInterestCents < base.totalInterestCents);
  assert.equal(extra.rows.at(-1)?.balanceCents, 0);
  assert.equal(extra.rows.reduce((s, r) => s + r.principalCents, 0), c(300_000));
  assert.equal(extra.rows[0].extraCents, c(2000));
  assert.equal(extra.rows[0].paymentCents, extra.paymentCents + c(2000));
  assert.equal(extra.paymentCents, base.paymentCents, 'la cuota fija no cambia: solo se acelera el pago');
});

test('amortización: un abono extra enorme paga todo en la primera cuota', () => {
  const a = amortizationSchedule({ principalCents: c(10_000), annualRatePercent: 12, months: 12, extraCents: c(1_000_000) });
  assert.equal(a?.months, 1);
  assert.equal(a?.rows[0].balanceCents, 0);
  assert.equal(a?.rows[0].paymentCents, c(10_000) + c(100), 'capital + un mes de interés');
});

test('amortización: con una cuota fija mayor a la calculada termina antes y la última cuota ajusta', () => {
  const a = amortizationSchedule({ principalCents: c(100_000), annualRatePercent: 12, months: 12, paymentCents: c(10_000) });
  assert.ok(a);
  assert.equal(a.paymentCents, c(10_000));
  assert.ok(a.rows.length < 12 && a.rows.length >= 10);
  assert.equal(a.rows.at(-1)?.balanceCents, 0);
  assert.ok((a.rows.at(-1)?.paymentCents ?? Infinity) <= c(10_000));
  assert.equal(a.rows.reduce((s, r) => s + r.principalCents, 0), c(100_000));
});

test('amortización: datos inválidos', () => {
  assert.equal(amortizationSchedule({ principalCents: 100, annualRatePercent: 12, months: 12, paymentCents: 0 }), null);
  assert.equal(amortizationSchedule({ principalCents: 0, annualRatePercent: 12, months: 12, paymentCents: 100 }), null);
  assert.equal(amortizationSchedule({ principalCents: 100, annualRatePercent: 12, months: 601, paymentCents: 100 }), null);
  assert.equal(amortizationSchedule({ principalCents: 0, annualRatePercent: 12, months: 12 }), null);
  assert.equal(amortizationSchedule({ principalCents: 100, annualRatePercent: 12, months: 12, extraCents: -1 }), null);
});

// ------------------------------------------------------------------ inflación

test('inflación: 10,000 con 5 % anual durante 10 años', () => {
  const r = inflationImpact({ amountCents: c(10_000), inflationPercent: 5, years: 10 });
  assert.equal(r?.futureCostCents, c(16_288.95));
  assert.equal(r?.purchasingPowerCents, c(6139.13));
  near(r?.lossPercent ?? null, 38.6087, 0.001);
  assert.equal(r?.realRatePercent, null);
});

test('inflación: el rendimiento real descuenta la inflación (y puede ser negativo)', () => {
  near(inflationImpact({ amountCents: c(1000), inflationPercent: 5, years: 1, savingsRatePercent: 8 })?.realRatePercent ?? null, 2.857, 0.001);
  assert.ok((inflationImpact({ amountCents: c(1000), inflationPercent: 5, years: 1, savingsRatePercent: 2 })?.realRatePercent ?? 0) < 0, 'ganar 2 % con 5 % de inflación es perder');
  assert.equal(inflationImpact({ amountCents: c(1000), inflationPercent: 5, years: 1, savingsRatePercent: 0 })?.realRatePercent !== null, true);
});

test('inflación: sin inflación nada cambia y los datos malos se rechazan', () => {
  const r = inflationImpact({ amountCents: c(500), inflationPercent: 0, years: 5 });
  assert.equal(r?.futureCostCents, c(500));
  assert.equal(r?.lossPercent, 0);
  assert.equal(inflationImpact({ amountCents: 0, inflationPercent: 5, years: 5 }), null);
  assert.equal(inflationImpact({ amountCents: 100, inflationPercent: 5, years: 0 }), null);
  assert.equal(inflationImpact({ amountCents: 100, inflationPercent: 5, years: 101 }), null);
  assert.equal(inflationImpact({ amountCents: 100, inflationPercent: -1, years: 5 }), null);
  assert.equal(inflationImpact({ amountCents: 100, inflationPercent: 5, years: 5, savingsRatePercent: -2 }), null);
});

// ------------------------------------------------------------------ valor futuro

test('valor futuro: un capital solo, y aportes solos', () => {
  assert.equal(futureValue({ presentCents: c(100_000), paymentCents: 0, annualRatePercent: 12, months: 12 }), c(112_682.5));
  assert.equal(futureValue({ presentCents: 0, paymentCents: c(1000), annualRatePercent: 12, months: 12 }), c(12_682.5));
  assert.equal(futureValue({ presentCents: c(500), paymentCents: c(100), annualRatePercent: 0, months: 10 }), c(1500));
});

test('valor futuro: el aporte necesario para una meta lleva justo a la meta', () => {
  const need = requiredContribution({ targetCents: c(500_000), presentCents: c(20_000), annualRatePercent: 8, months: 96 });
  assert.ok(need && need > 0);
  const reached = futureValue({ presentCents: c(20_000), paymentCents: need, annualRatePercent: 8, months: 96 });
  near(reached, c(500_000), 100 * 96 / 2 + 100, 'el redondeo del aporte al centavo mueve la meta unos centavos por mes');
  assert.ok((reached ?? 0) >= c(500_000) - 50, 'no se queda corto por más de unos centavos');
  assert.equal(requiredContribution({ targetCents: c(1000), presentCents: c(2000), annualRatePercent: 5, months: 12 }), 0, 'si ya tienes la meta, no hace falta aportar');
  assert.equal(requiredContribution({ targetCents: c(12_000), presentCents: 0, annualRatePercent: 0, months: 12 }), c(1000));
});

test('valor futuro: en cuántos meses llegas a la meta', () => {
  assert.equal(monthsToTarget({ targetCents: c(12_682.5), presentCents: 0, paymentCents: c(1000), annualRatePercent: 12 }), 12);
  assert.equal(monthsToTarget({ targetCents: c(12_000), presentCents: 0, paymentCents: c(1000), annualRatePercent: 0 }), 12);
  assert.equal(monthsToTarget({ targetCents: c(12_001), presentCents: 0, paymentCents: c(1000), annualRatePercent: 0 }), 13);
  assert.equal(monthsToTarget({ targetCents: c(1000), presentCents: c(1000), paymentCents: 0, annualRatePercent: 0 }), 0);
  assert.equal(monthsToTarget({ targetCents: c(1000), presentCents: 0, paymentCents: 0, annualRatePercent: 0 }), null, 'sin aportes ni rendimiento nunca llegas');
  assert.equal(monthsToTarget({ targetCents: c(1000), presentCents: 0, paymentCents: 0, annualRatePercent: 10 }), null, 'con capital 0 y sin aportes tampoco');
  assert.ok((monthsToTarget({ targetCents: c(2000), presentCents: c(1000), paymentCents: 0, annualRatePercent: 12 }) ?? 0) > 0, 'solo con rendimiento: se duplica en ~70 meses');
  assert.equal(monthsToTarget({ targetCents: c(2000), presentCents: c(1000), paymentCents: 0, annualRatePercent: 12 }), 70);
  assert.equal(monthsToTarget({ targetCents: c(1_000_000_000), presentCents: c(1), paymentCents: c(1), annualRatePercent: 0 }), null, 'más de 100 años');
});

test('valor futuro: meses a la meta y valor futuro son consistentes', () => {
  const months = monthsToTarget({ targetCents: c(200_000), presentCents: c(10_000), paymentCents: c(3000), annualRatePercent: 9 });
  assert.ok(months && months > 1);
  const at = futureValue({ presentCents: c(10_000), paymentCents: c(3000), annualRatePercent: 9, months });
  const before = futureValue({ presentCents: c(10_000), paymentCents: c(3000), annualRatePercent: 9, months: months - 1 });
  assert.ok((at ?? 0) >= c(200_000), 'al llegar a ese mes ya tienes la meta');
  assert.ok((before ?? Infinity) < c(200_000), 'un mes antes todavía no');
});

// ------------------------------------------------------------------ valor presente

test('valor presente: un pago futuro (10,000 en 3 años al 10 % = 7,513.15)', () => {
  assert.equal(presentValueLump({ futureCents: c(10_000), annualRatePercent: 10, years: 3 }), c(7513.15));
  assert.equal(presentValueLump({ futureCents: c(10_000), annualRatePercent: 0, years: 3 }), c(10_000));
});

test('valor presente: pagos mensuales iguales (1,000 × 12 meses al 12 % = 11,255.08)', () => {
  assert.equal(presentValueAnnuity({ paymentCents: c(1000), annualRatePercent: 12, months: 12 }), c(11_255.08));
});

test('valor presente: varios flujos por año', () => {
  const r = presentValueFlows({ flows: [{ year: 1, cents: c(1000) }, { year: 2, cents: c(1000) }, { year: 3, cents: c(1000) }], annualRatePercent: 10 });
  assert.equal(r?.presentValueCents, c(909.09) + c(826.45) + c(751.31));
  assert.equal(r?.totalFutureCents, c(3000));
  assert.equal(r?.discountCents, c(3000) - (r?.presentValueCents ?? 0));
  assert.deepEqual(r?.rows.map((x) => x.presentCents), [c(909.09), c(826.45), c(751.31)]);
  assert.equal(presentValueFlows({ flows: [{ year: 0, cents: c(500) }], annualRatePercent: 50 })?.presentValueCents, c(500), 'lo de hoy no se descuenta');
  assert.equal(presentValueFlows({ flows: [], annualRatePercent: 10 }), null);
  assert.equal(presentValueFlows({ flows: [{ year: -1, cents: 100 }], annualRatePercent: 10 }), null);
});

test('valor presente: descontar y capitalizar son operaciones inversas', () => {
  const pv = presentValueLump({ futureCents: c(50_000), annualRatePercent: 7, years: 5 });
  assert.ok(pv);
  const back = compoundGrowth({ principalCents: pv, monthlyContributionCents: 0, annualRatePercent: 7, compoundsPerYear: 1, months: 60 });
  near(back?.futureValueCents ?? null, c(50_000), 2);
});

// ------------------------------------------------------------------ ROI

test('ROI: ganancia, porcentaje, anualizado y real', () => {
  const r = roi({ investedCents: c(10_000), finalCents: c(15_000), costsCents: c(500), years: 2, inflationPercent: 5 });
  assert.equal(r?.gainCents, c(4500));
  near(r?.roiPercent ?? null, 45, 1e-9);
  near(r?.annualizedPercent ?? null, 20.4159, 0.001);
  near(r?.realAnnualizedPercent ?? null, 14.6818, 0.001);
});

test('ROI: una pérdida sale negativa y sin tiempo no hay anualizado', () => {
  const r = roi({ investedCents: c(10_000), finalCents: c(8000) });
  assert.equal(r?.gainCents, -c(2000));
  near(r?.roiPercent ?? null, -20, 1e-9);
  assert.equal(r?.annualizedPercent, null);
  assert.equal(r?.realAnnualizedPercent, null);
  const loss = roi({ investedCents: c(10_000), finalCents: c(8000), years: 2 });
  near(loss?.annualizedPercent ?? null, -10.5573, 0.001);
});

test('ROI: perderlo todo = -100 % y los datos malos se rechazan', () => {
  const r = roi({ investedCents: c(1000), finalCents: 0, years: 3 });
  near(r?.roiPercent ?? null, -100, 1e-9);
  near(r?.annualizedPercent ?? null, -100, 1e-9);
  assert.equal(roi({ investedCents: 0, finalCents: 100 }), null);
  assert.equal(roi({ investedCents: 100, finalCents: -1 }), null);
  assert.equal(roi({ investedCents: 100, finalCents: 100, years: 0 }), null);
  assert.equal(roi({ investedCents: 100, finalCents: 100, costsCents: -1 }), null);
  assert.equal(roi({ investedCents: 100, finalCents: 100, years: 2, inflationPercent: -3 }), null);
});

// ------------------------------------------------------------------ independencia financiera

test('independencia financiera: capital objetivo = gasto anual / tasa de retiro', () => {
  const r = financialIndependence({ monthlyExpenseCents: c(50_000), withdrawalRatePercent: 4, currentCents: 0, monthlyContributionCents: 0, annualReturnPercent: 0 });
  assert.equal(r?.targetCents, c(15_000_000));
  assert.equal(r?.missingCents, c(15_000_000));
  assert.equal(r?.reached, false);
  assert.equal(r?.monthsNeeded, null, 'sin aportes ni rendimiento nunca llegas');
  assert.equal(r?.contributionNeededCents, null, 'no se pidió un plazo');
});

test('independencia financiera: tiempo con aportes y rendimiento, y aporte para un plazo', () => {
  const base = { monthlyExpenseCents: c(50_000), withdrawalRatePercent: 4, currentCents: c(3_000_000), monthlyContributionCents: c(100_000), annualReturnPercent: 5 };
  const r = financialIndependence(base);
  assert.equal(r?.targetCents, c(15_000_000));
  assert.equal(r?.missingCents, c(12_000_000));
  assert.equal(r?.monthsNeeded, 89);
  const plan = financialIndependence({ ...base, targetYears: 10 });
  assert.ok(plan?.contributionNeededCents && plan.contributionNeededCents > 0);
  // Con ese aporte en 10 años se llega a la meta (con un margen de unos centavos por redondeo).
  const fv = futureValue({ presentCents: base.currentCents, paymentCents: plan.contributionNeededCents, annualRatePercent: 5, months: 120 });
  near(fv, c(15_000_000), 120 * 100);
  // Independiente: fórmula directa.
  const i = 0.05 / 12;
  const growth = (1 + i) ** 120;
  near(plan.contributionNeededCents, Math.round(((c(15_000_000) - base.currentCents * growth) * i) / (growth - 1)), 2);
});

test('independencia financiera: si ya tienes el capital, lo dice', () => {
  const r = financialIndependence({ monthlyExpenseCents: c(10_000), withdrawalRatePercent: 4, currentCents: c(4_000_000), monthlyContributionCents: 0, annualReturnPercent: 0, targetYears: 5 });
  assert.equal(r?.reached, true);
  assert.equal(r?.missingCents, 0);
  assert.equal(r?.monthsNeeded, 0);
  assert.equal(r?.contributionNeededCents, 0);
});

test('independencia financiera: datos imposibles', () => {
  const ok = { monthlyExpenseCents: c(10_000), withdrawalRatePercent: 4, currentCents: 0, monthlyContributionCents: c(100), annualReturnPercent: 3 };
  assert.ok(financialIndependence(ok));
  for (const bad of [{ monthlyExpenseCents: 0 }, { withdrawalRatePercent: 0 }, { withdrawalRatePercent: 101 }, { currentCents: -1 }, { annualReturnPercent: -2 }, { targetYears: 0 }, { targetYears: 101 }]) {
    assert.equal(financialIndependence({ ...ok, ...bad }), null, JSON.stringify(bad));
  }
});
