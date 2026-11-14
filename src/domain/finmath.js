// @ts-check
// =============================================================================
// MATEMÁTICA FINANCIERA (documento maestro §8)
// -----------------------------------------------------------------------------
// Funciones puras: reciben números y devuelven números (nada de pantalla, nada
// guardado). Convenciones, iguales en todo el archivo:
//
//   - Montos en CENTAVOS enteros (como en el resto de la app). Los resultados se
//     redondean al centavo más cercano.
//   - Tasas en PORCENTAJE: 12 significa 12 %.
//   - Tiempo en AÑOS (puede ser decimal) o en MESES enteros, según la función.
//   - Cuando algo no se puede calcular (por ejemplo, una cuota que nunca termina de
//     pagar el préstamo) la función devuelve `null`: nunca NaN ni Infinity.
//
// Supuestos que la pantalla le explica al usuario:
//   - Préstamos y ahorros mensuales usan tasa nominal anual / 12 (igual que Deudas).
//   - Los aportes se hacen al FINAL de cada mes.
//   - Todo es una simulación con una tasa constante: la vida real no lo es.
// =============================================================================

/** Plazo máximo de un préstamo en la calculadora: 50 años (la tabla de amortización tendría 600 filas). */
export const MAX_LOAN_MONTHS = 600;
/** Plazo máximo de ahorro/inversión: 100 años. */
export const MAX_INVEST_MONTHS = 1200;
/** Tasa anual máxima aceptada (porcentaje). Evita números absurdos que desbordan. */
export const MAX_RATE_PERCENT = 1000;

/** Cuántas veces al año se capitalizan los intereses (interés compuesto). */
export const COMPOUNDING = /** @type {const} */ ({
  daily: { perYear: 365, label: 'Diaria' },
  monthly: { perYear: 12, label: 'Mensual' },
  quarterly: { perYear: 4, label: 'Trimestral' },
  semiannual: { perYear: 2, label: 'Semestral' },
  annual: { perYear: 1, label: 'Anual' },
});

/** @param {unknown} v @returns {v is keyof typeof COMPOUNDING} */
export function isCompounding(v) {
  return typeof v === 'string' && Object.hasOwn(COMPOUNDING, v);
}

/** Un resultado mayor a esto (10 billones de pesos) ya no tiene sentido mostrarlo. */
const MAX_RESULT_CENTS = 1e15;

/** Redondea a centavo entero; devuelve null si el número no es válido o es absurdamente grande.
 * @param {number} value @returns {number | null} */
function cents(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return Math.abs(rounded) > MAX_RESULT_CENTS ? null : rounded;
}

/** @param {number} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Tasa mensual como fracción (12 % anual -> 0.01). @param {number} annualPercent */
const monthlyRate = (annualPercent) => annualPercent / 100 / 12;

// ------------------------------------------------------------------ interés simple

/**
 * @typedef {Object} SimpleInterestResult
 * @property {'interest' | 'capital' | 'rate' | 'time'} solved   Lo que se calculó.
 * @property {number} capitalCents
 * @property {number} ratePercent   Anual.
 * @property {number} years
 * @property {number} interestCents
 * @property {number} totalCents    Capital + interés.
 */

/**
 * Interés simple:  I = C × (tasa / 100) × t.  Se calcula lo que falte (deja UNO de los cuatro sin definir).
 * @param {{ capitalCents?: number, ratePercent?: number, years?: number, interestCents?: number }} input
 * @returns {SimpleInterestResult | null}
 */
export function simpleInterest(input) {
  const { capitalCents, ratePercent, years, interestCents } = input;
  const known = [capitalCents, ratePercent, years, interestCents].filter((v) => v !== undefined);
  if (known.length !== 3 || !known.every(isNum)) return null;

  /** @type {SimpleInterestResult['solved']} */
  let solved = 'interest';
  let C = capitalCents ?? 0;
  let r = ratePercent ?? 0;
  let t = years ?? 0;
  let I = interestCents ?? 0;

  if (interestCents === undefined) {
    I = C * (r / 100) * t;
  } else if (capitalCents === undefined) {
    solved = 'capital';
    if (!(r > 0 && t > 0)) return null;
    C = I / ((r / 100) * t);
  } else if (ratePercent === undefined) {
    solved = 'rate';
    if (!(C > 0 && t > 0)) return null;
    r = (I / (C * t)) * 100;
  } else {
    solved = 'time';
    if (!(C > 0 && r > 0)) return null;
    t = I / (C * (r / 100));
  }

  const capital = cents(C);
  const interest = cents(I);
  if (capital === null || interest === null || !isNum(r) || !isNum(t)) return null;
  return { solved, capitalCents: capital, ratePercent: r, years: t, interestCents: interest, totalCents: capital + interest };
}

// ------------------------------------------------------------------ interés compuesto

/**
 * @typedef {Object} GrowthRow
 * @property {number} month           Mes en que se mide (12, 24...; el último puede no ser múltiplo de 12).
 * @property {number} contributedCents  Todo lo que pusiste hasta ese mes (capital inicial + aportes).
 * @property {number} interestCents   Intereses acumulados.
 * @property {number} balanceCents    Total.
 */

/**
 * @typedef {Object} CompoundResult
 * @property {number} futureValueCents
 * @property {number} contributedCents   Capital inicial + todos los aportes.
 * @property {number} interestCents      Valor futuro - lo aportado.
 * @property {number | null} growthPercent  Intereses / lo aportado (null si no aportaste nada).
 * @property {number} effectiveAnnualPercent  Tasa efectiva anual (lo que realmente rinde en un año con esa capitalización).
 * @property {GrowthRow[]} rows
 */

/**
 * Crecimiento con interés compuesto y aportes mensuales (al final de cada mes).
 * Capital inicial:  C × (1 + tasa/m)^(m × años), con m = veces que se capitaliza al año.
 * Los aportes ganan interés con la tasa mensual equivalente (1 + tasa/m)^(m/12) - 1.
 * @param {{ principalCents: number, monthlyContributionCents: number, annualRatePercent: number, compoundsPerYear: number, months: number }} input
 * @returns {CompoundResult | null}
 */
export function compoundGrowth({ principalCents, monthlyContributionCents, annualRatePercent, compoundsPerYear, months }) {
  if (![principalCents, monthlyContributionCents, annualRatePercent, compoundsPerYear, months].every(isNum)) return null;
  if (principalCents < 0 || monthlyContributionCents < 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (!Number.isInteger(months) || months < 1 || months > MAX_INVEST_MONTHS || compoundsPerYear < 1) return null;

  const periodRate = annualRatePercent / 100 / compoundsPerYear;
  const i = (1 + periodRate) ** (compoundsPerYear / 12) - 1; // tasa mensual equivalente
  const effectiveAnnualPercent = ((1 + periodRate) ** compoundsPerYear - 1) * 100;

  /** @type {GrowthRow[]} */
  const rows = [];
  let balance = principalCents;
  let contributed = principalCents;
  for (let month = 1; month <= months; month += 1) {
    balance = balance * (1 + i) + monthlyContributionCents;
    contributed += monthlyContributionCents;
    if (month % 12 === 0 || month === months) {
      const b = cents(balance);
      if (b === null) return null;
      rows.push({ month, contributedCents: contributed, interestCents: b - contributed, balanceCents: b });
    }
  }
  const futureValueCents = rows[rows.length - 1].balanceCents;
  const interestCents = futureValueCents - contributed;
  return {
    futureValueCents,
    contributedCents: contributed,
    interestCents,
    growthPercent: contributed > 0 ? (interestCents / contributed) * 100 : null,
    effectiveAnnualPercent,
    rows,
  };
}

// ------------------------------------------------------------------ préstamos y amortización

/**
 * Cuota fija mensual de un préstamo (sistema francés, igual que en Deudas):
 *   cuota = monto × i / (1 - (1 + i)^-n),  i = tasa anual / 12.
 * @param {{ principalCents: number, annualRatePercent: number, months: number }} input @returns {number | null}
 */
export function loanPayment({ principalCents, annualRatePercent, months }) {
  if (![principalCents, annualRatePercent, months].every(isNum)) return null;
  if (principalCents <= 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (!Number.isInteger(months) || months < 1 || months > MAX_LOAN_MONTHS) return null;
  const i = monthlyRate(annualRatePercent);
  if (i === 0) return cents(principalCents / months);
  return cents((principalCents * i) / (1 - (1 + i) ** -months));
}

/**
 * Cuánto te prestan por una cuota dada:  monto = cuota × (1 - (1 + i)^-n) / i.
 * @param {{ paymentCents: number, annualRatePercent: number, months: number }} input @returns {number | null}
 */
export function loanPrincipal({ paymentCents, annualRatePercent, months }) {
  if (![paymentCents, annualRatePercent, months].every(isNum)) return null;
  if (paymentCents <= 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (!Number.isInteger(months) || months < 1 || months > MAX_LOAN_MONTHS) return null;
  const i = monthlyRate(annualRatePercent);
  if (i === 0) return cents(paymentCents * months);
  return cents((paymentCents * (1 - (1 + i) ** -months)) / i);
}

/**
 * En cuántos meses se paga un préstamo con una cuota dada. null si la cuota no alcanza ni para los intereses
 * del primer mes (el saldo nunca bajaría) o si tardaría más de 50 años.
 * @param {{ principalCents: number, paymentCents: number, annualRatePercent: number }} input @returns {number | null}
 */
export function loanMonths({ principalCents, paymentCents, annualRatePercent }) {
  if (![principalCents, paymentCents, annualRatePercent].every(isNum)) return null;
  if (principalCents <= 0 || paymentCents <= 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  const i = monthlyRate(annualRatePercent);
  /** @type {number} */
  let n;
  if (i === 0) n = principalCents / paymentCents;
  else {
    const ratio = (principalCents * i) / paymentCents;
    if (ratio >= 1) return null;
    n = -Math.log(1 - ratio) / Math.log(1 + i);
  }
  const rounded = Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : Math.ceil(n);
  return rounded >= 1 && rounded <= MAX_LOAN_MONTHS ? rounded : null;
}

/**
 * @typedef {Object} AmortizationRow
 * @property {number} number         Cuota número.
 * @property {number} paymentCents   Lo que pagas ese mes (cuota + abono extra).
 * @property {number} interestCents
 * @property {number} principalCents Capital que se paga (incluye el abono extra).
 * @property {number} extraCents     Parte del pago que es abono extra a capital.
 * @property {number} balanceCents   Lo que queda por pagar.
 */

/**
 * @typedef {Object} AmortizationResult
 * @property {number} paymentCents   Cuota fija (sin abono extra).
 * @property {AmortizationRow[]} rows
 * @property {number} totalPaidCents
 * @property {number} totalInterestCents
 * @property {number} months         Cuántas cuotas se pagan de verdad (menos que el plazo si hay abono extra).
 */

/**
 * Tabla de amortización: cada mes los intereses son saldo × tasa mensual y el resto de la cuota baja el capital.
 * Con un abono extra mensual el préstamo termina antes. La última cuota se ajusta para dejar el saldo en 0.
 * `paymentCents` (opcional) fija la cuota en vez de calcularla: sirve cuando la cuota ya la dio el usuario.
 * @param {{ principalCents: number, annualRatePercent: number, months: number, extraCents?: number, paymentCents?: number }} input
 * @returns {AmortizationResult | null}
 */
export function amortizationSchedule({ principalCents, annualRatePercent, months, extraCents = 0, paymentCents }) {
  if (![principalCents, annualRatePercent, months].every(isNum)) return null;
  if (principalCents <= 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (!Number.isInteger(months) || months < 1 || months > MAX_LOAN_MONTHS) return null;
  const payment = paymentCents ?? loanPayment({ principalCents, annualRatePercent, months });
  if (payment === null || !isNum(payment) || payment <= 0 || !isNum(extraCents) || extraCents < 0) return null;
  const i = monthlyRate(annualRatePercent);

  /** @type {AmortizationRow[]} */
  const rows = [];
  let balance = principalCents;
  let totalPaid = 0;
  let totalInterest = 0;
  for (let number = 1; balance > 0 && number <= months; number += 1) {
    const interest = Math.round(balance * i);
    const isLast = number === months;
    // La última cuota del plazo salda lo que quede (absorbe los redondeos de centavos).
    const wanted = isLast ? balance + interest : Math.min(payment + extraCents, balance + interest);
    const paid = Math.min(wanted, balance + interest);
    const principal = paid - interest;
    if (principal <= 0 && !isLast) return null; // la cuota no cubre los intereses: no pasa con cuotas calculadas, solo es una protección
    const extra = isLast ? 0 : Math.max(0, paid - Math.min(payment, balance + interest));
    balance -= principal;
    totalPaid += paid;
    totalInterest += interest;
    rows.push({ number, paymentCents: paid, interestCents: interest, principalCents: principal, extraCents: extra, balanceCents: balance });
  }
  if (balance !== 0) return null;
  return { paymentCents: payment, rows, totalPaidCents: totalPaid, totalInterestCents: totalInterest, months: rows.length };
}

// ------------------------------------------------------------------ inflación

/**
 * @typedef {Object} InflationResult
 * @property {number} futureCostCents       Lo que costará dentro de `years` algo que hoy cuesta `amount`.
 * @property {number} purchasingPowerCents  Lo que valdrán, en pesos de hoy, `amount` pesos de dentro de `years`.
 * @property {number} lossPercent           Cuánto poder de compra pierdes (0 a 100).
 * @property {number | null} realRatePercent  Rendimiento real de tu ahorro (descontada la inflación). null si no diste una tasa.
 */

/**
 * Efecto de la inflación:  costo futuro = monto × (1 + π)^años;  poder de compra = monto / (1 + π)^años.
 * Rendimiento real = (1 + tasa del ahorro) / (1 + π) - 1.
 * @param {{ amountCents: number, inflationPercent: number, years: number, savingsRatePercent?: number | null }} input
 * @returns {InflationResult | null}
 */
export function inflationImpact({ amountCents, inflationPercent, years, savingsRatePercent = null }) {
  if (![amountCents, inflationPercent, years].every(isNum)) return null;
  if (amountCents <= 0 || inflationPercent < 0 || inflationPercent > MAX_RATE_PERCENT || years <= 0 || years > 100) return null;
  const factor = (1 + inflationPercent / 100) ** years;
  const futureCostCents = cents(amountCents * factor);
  const purchasingPowerCents = cents(amountCents / factor);
  if (futureCostCents === null || purchasingPowerCents === null) return null;
  let realRatePercent = null;
  if (savingsRatePercent !== null) {
    if (!isNum(savingsRatePercent) || savingsRatePercent < 0 || savingsRatePercent > MAX_RATE_PERCENT) return null;
    realRatePercent = ((1 + savingsRatePercent / 100) / (1 + inflationPercent / 100) - 1) * 100;
  }
  return { futureCostCents, purchasingPowerCents, lossPercent: (1 - 1 / factor) * 100, realRatePercent };
}

// ------------------------------------------------------------------ valor futuro

/**
 * Valor futuro de un capital más aportes mensuales (al final de cada mes), con la tasa nominal anual / 12:
 *   VF = C × (1 + i)^n + aporte × ((1 + i)^n - 1) / i
 * @param {{ presentCents: number, paymentCents: number, annualRatePercent: number, months: number }} input @returns {number | null}
 */
export function futureValue({ presentCents, paymentCents, annualRatePercent, months }) {
  if (![presentCents, paymentCents, annualRatePercent, months].every(isNum)) return null;
  if (presentCents < 0 || paymentCents < 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (!Number.isInteger(months) || months < 1 || months > MAX_INVEST_MONTHS) return null;
  const i = monthlyRate(annualRatePercent);
  if (i === 0) return cents(presentCents + paymentCents * months);
  const growth = (1 + i) ** months;
  return cents(presentCents * growth + (paymentCents * (growth - 1)) / i);
}

/**
 * Aporte mensual necesario para llegar a una meta en `months` meses. 0 si tu capital ya la alcanza solo.
 * @param {{ targetCents: number, presentCents: number, annualRatePercent: number, months: number }} input @returns {number | null}
 */
export function requiredContribution({ targetCents, presentCents, annualRatePercent, months }) {
  if (![targetCents, presentCents, annualRatePercent, months].every(isNum)) return null;
  if (targetCents <= 0 || presentCents < 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (!Number.isInteger(months) || months < 1 || months > MAX_INVEST_MONTHS) return null;
  const i = monthlyRate(annualRatePercent);
  const growth = (1 + i) ** months;
  const missing = targetCents - presentCents * growth;
  if (missing <= 0) return 0;
  return cents(i === 0 ? missing / months : (missing * i) / (growth - 1));
}

/**
 * En cuántos meses llegas a una meta con un capital y un aporte mensual. 0 si ya la alcanzaste;
 * null si no llegarías nunca (sin aportes ni rendimiento) o tardarías más de 100 años.
 * @param {{ targetCents: number, presentCents: number, paymentCents: number, annualRatePercent: number }} input @returns {number | null}
 */
export function monthsToTarget({ targetCents, presentCents, paymentCents, annualRatePercent }) {
  if (![targetCents, presentCents, paymentCents, annualRatePercent].every(isNum)) return null;
  if (targetCents <= 0 || presentCents < 0 || paymentCents < 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (presentCents >= targetCents) return 0;
  const i = monthlyRate(annualRatePercent);
  /** @type {number} */
  let n;
  if (i === 0) {
    if (paymentCents <= 0) return null;
    n = (targetCents - presentCents) / paymentCents;
  } else {
    const top = targetCents * i + paymentCents;
    const bottom = presentCents * i + paymentCents;
    if (bottom <= 0) return null;
    n = Math.log(top / bottom) / Math.log(1 + i);
  }
  if (!Number.isFinite(n)) return null;
  const rounded = Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : Math.ceil(n);
  return rounded >= 1 && rounded <= MAX_INVEST_MONTHS ? rounded : null;
}

// ------------------------------------------------------------------ valor presente

/**
 * Valor presente de un pago futuro único:  VP = VF / (1 + tasa)^años  (tasa de descuento anual).
 * @param {{ futureCents: number, annualRatePercent: number, years: number }} input @returns {number | null}
 */
export function presentValueLump({ futureCents, annualRatePercent, years }) {
  if (![futureCents, annualRatePercent, years].every(isNum)) return null;
  if (futureCents <= 0 || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT || years <= 0 || years > 100) return null;
  return cents(futureCents / (1 + annualRatePercent / 100) ** years);
}

/**
 * Valor presente de pagos mensuales iguales (al final de cada mes), con descuento = tasa anual / 12:
 *   VP = pago × (1 - (1 + i)^-n) / i
 * @param {{ paymentCents: number, annualRatePercent: number, months: number }} input @returns {number | null}
 */
export function presentValueAnnuity({ paymentCents, annualRatePercent, months }) {
  return loanPrincipal({ paymentCents, annualRatePercent, months });
}

/**
 * @typedef {Object} FlowsResult
 * @property {number} presentValueCents  Suma de lo que valen hoy todos los flujos.
 * @property {number} totalFutureCents   Suma de los flujos sin descontar.
 * @property {number} discountCents      Lo que "pierdes" por esperar (sin descontar - valor presente).
 * @property {{ year: number, futureCents: number, presentCents: number }[]} rows
 */

/**
 * Valor presente de varios flujos futuros (uno por año):  VP = Σ flujo / (1 + tasa)^año.
 * @param {{ flows: { year: number, cents: number }[], annualRatePercent: number }} input @returns {FlowsResult | null}
 */
export function presentValueFlows({ flows, annualRatePercent }) {
  if (!isNum(annualRatePercent) || annualRatePercent < 0 || annualRatePercent > MAX_RATE_PERCENT) return null;
  if (flows.length === 0) return null;
  /** @type {FlowsResult['rows']} */
  const rows = [];
  let present = 0;
  let total = 0;
  for (const f of flows) {
    if (!isNum(f.year) || !isNum(f.cents) || f.year < 0 || f.year > 100 || f.cents < 0) return null;
    const p = cents(f.cents / (1 + annualRatePercent / 100) ** f.year);
    if (p === null) return null;
    rows.push({ year: f.year, futureCents: f.cents, presentCents: p });
    present += p;
    total += f.cents;
  }
  return { presentValueCents: present, totalFutureCents: total, discountCents: total - present, rows };
}

// ------------------------------------------------------------------ retorno de inversión (ROI)

/**
 * @typedef {Object} RoiResult
 * @property {number} gainCents            Valor final - lo invertido - costos (puede ser negativo).
 * @property {number} roiPercent           Ganancia / lo invertido.
 * @property {number | null} annualizedPercent  Rendimiento anual equivalente (null si no diste el tiempo).
 * @property {number | null} realAnnualizedPercent  Ese rendimiento anual descontada la inflación (null si faltan datos).
 */

/**
 * ROI = (valor final - inversión - costos) / inversión.
 * Anualizado = ((valor final - costos) / inversión)^(1 / años) - 1.
 * El ROI no mide el RIESGO: dos inversiones con el mismo ROI pueden ser muy distintas en lo que arriesgaban.
 * @param {{ investedCents: number, finalCents: number, costsCents?: number, years?: number | null, inflationPercent?: number | null }} input
 * @returns {RoiResult | null}
 */
export function roi({ investedCents, finalCents, costsCents = 0, years = null, inflationPercent = null }) {
  if (![investedCents, finalCents, costsCents].every(isNum)) return null;
  if (investedCents <= 0 || finalCents < 0 || costsCents < 0) return null;
  const gainCents = cents(finalCents - investedCents - costsCents);
  if (gainCents === null) return null;

  let annualizedPercent = null;
  let realAnnualizedPercent = null;
  if (years !== null) {
    if (!isNum(years) || years <= 0 || years > 100) return null;
    const net = Math.max(0, finalCents - costsCents);
    annualizedPercent = ((net / investedCents) ** (1 / years) - 1) * 100;
    if (inflationPercent !== null) {
      if (!isNum(inflationPercent) || inflationPercent < 0 || inflationPercent > MAX_RATE_PERCENT) return null;
      realAnnualizedPercent = ((1 + annualizedPercent / 100) / (1 + inflationPercent / 100) - 1) * 100;
    }
  }
  return { gainCents, roiPercent: (gainCents / investedCents) * 100, annualizedPercent, realAnnualizedPercent };
}

// ------------------------------------------------------------------ independencia financiera

/**
 * @typedef {Object} IndependenceResult
 * @property {number} targetCents          Capital que necesitas: gasto anual / tasa de retiro.
 * @property {number} missingCents         Lo que te falta (0 si ya lo tienes).
 * @property {boolean} reached             Ya tienes el capital objetivo.
 * @property {number | null} monthsNeeded  Meses para llegar con tu aporte y rendimiento (0 si ya llegaste; null si no llegarías).
 * @property {number | null} contributionNeededCents  Aporte mensual para llegar en `targetYears` (null si no pediste ese cálculo).
 */

/**
 * Independencia financiera (regla del 4 %): capital objetivo = gasto anual / tasa de retiro.
 * Es una regla práctica, no una garantía: los mercados no rinden parejo y los gastos cambian.
 * Usa un rendimiento REAL (descontada la inflación) para que el resultado esté en pesos de hoy.
 * @param {{ monthlyExpenseCents: number, withdrawalRatePercent: number, currentCents: number, monthlyContributionCents: number, annualReturnPercent: number, targetYears?: number | null }} input
 * @returns {IndependenceResult | null}
 */
export function financialIndependence({ monthlyExpenseCents, withdrawalRatePercent, currentCents, monthlyContributionCents, annualReturnPercent, targetYears = null }) {
  if (![monthlyExpenseCents, withdrawalRatePercent, currentCents, monthlyContributionCents, annualReturnPercent].every(isNum)) return null;
  if (monthlyExpenseCents <= 0 || withdrawalRatePercent <= 0 || withdrawalRatePercent > 100) return null;
  if (currentCents < 0 || monthlyContributionCents < 0 || annualReturnPercent < 0 || annualReturnPercent > MAX_RATE_PERCENT) return null;

  const targetCents = cents((monthlyExpenseCents * 12) / (withdrawalRatePercent / 100));
  if (targetCents === null) return null;
  const reached = currentCents >= targetCents;
  const monthsNeeded = monthsToTarget({ targetCents, presentCents: currentCents, paymentCents: monthlyContributionCents, annualRatePercent: annualReturnPercent });

  let contributionNeededCents = null;
  if (targetYears !== null) {
    if (!isNum(targetYears) || targetYears <= 0 || targetYears > 100) return null;
    const months = Math.round(targetYears * 12);
    if (months < 1) return null;
    contributionNeededCents = requiredContribution({ targetCents, presentCents: currentCents, annualRatePercent: annualReturnPercent, months });
    if (contributionNeededCents === null) return null;
  }
  return { targetCents, missingCents: Math.max(0, targetCents - currentCents), reached, monthsNeeded, contributionNeededCents };
}
