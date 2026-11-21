// @ts-check
// =============================================================================
// CALCULADORAS FINANCIERAS (documento maestro §8)
// -----------------------------------------------------------------------------
// Aquí se describe CADA calculadora: qué campos pide, cómo se validan y qué
// resultados muestra. Los números salen de finmath.js (probado contra valores
// conocidos); la pantalla (views/calculators.js) solo dibuja lo que este archivo
// devuelve. Nada se guarda: son simulaciones que se recalculan al escribir.
//
// Filosofía del documento: "que el usuario comprenda las consecuencias financieras
// de sus decisiones antes de tomar una acción". Por eso cada resultado trae una
// frase en lenguaje común y cada calculadora explica su fórmula.
// =============================================================================

import { plural } from './dates.js';
import {
  amortizationSchedule, COMPOUNDING, compoundGrowth, financialIndependence, futureValue, inflationImpact,
  isCompounding, loanMonths, loanPayment, loanPrincipal, MAX_INVEST_MONTHS, MAX_LOAN_MONTHS, MAX_RATE_PERCENT,
  monthsToTarget, presentValueAnnuity, presentValueFlows, presentValueLump, requiredContribution, roi, simpleInterest,
} from './finmath.js';
import { centsToInputValue, formatMoney, parseMoney } from './money.js';
import { statsIndicators } from './summaries.js';

/** @typedef {import('./types.js').AppData} AppData */

/**
 * @typedef {Object} FieldSpec
 * @property {string} id
 * @property {string} label
 * @property {'money' | 'percent' | 'number' | 'duration' | 'select'} type
 *   money = monto (en la moneda del espacio) · percent = porcentaje · number = número (años...) · duration = número + unidad (años o meses) · select = lista
 * @property {boolean} [optional]    Si se deja vacío no pasa nada (vale 0 o "no aplica").
 * @property {boolean} [allowZero]   Acepta 0 (por defecto los campos deben ser mayores que cero).
 * @property {number} [max]          Máximo (porcentajes: 1000; números: 100).
 * @property {number} [maxMonths]    Máximo de una duración, en meses.
 * @property {string} [suffix]       Texto fijo después del número ("%", "años").
 * @property {string} [hint]         Ayuda debajo del campo.
 * @property {string} [default]      Valor inicial.
 * @property {string} [defaultUnit]  Unidad inicial de una duración ("years" o "months").
 * @property {{ value: string, label: string }[]} [options]
 */

/** @typedef {{ label: string, value: string, note?: string }} ResultItem */
/** @typedef {import('../export/model.js').Cell} Cell */
/** @typedef {{ caption: string, headers: string[], rows: Cell[][], totals?: Cell[] }} ResultTable */
/** @typedef {{ labels: string[], titles: string[], series: { name: string, cls: string, values: number[] }[], ariaLabel: string }} ResultChart */

/**
 * @typedef {Object} Outcome
 * @property {ResultItem} headline   El resultado principal.
 * @property {ResultItem[]} items    El resto de los números.
 * @property {string} sentence       Qué significa, en una frase.
 * @property {string[]} notes        Supuestos y advertencias de ESTE cálculo.
 * @property {ResultTable} [table]
 * @property {ResultChart} [chart]
 * @property {[string, string][]} inputs   Lo que escribió el usuario, ya interpretado (para mostrarlo y exportarlo).
 */

/**
 * @typedef {Object} Parsed
 * @property {(id: string) => number | undefined} money    Monto en centavos.
 * @property {(id: string) => number | undefined} num      Número o porcentaje.
 * @property {(id: string) => number | undefined} months   Duración en meses.
 * @property {(id: string) => string | undefined} text     Opción elegida.
 */

/**
 * @typedef {Object} Calculator
 * @property {string} id
 * @property {string} title
 * @property {string} summary             Una línea para la lista.
 * @property {{ id: string, label: string }[]} [modes]   "¿Qué quieres calcular?"
 * @property {(mode: string) => FieldSpec[]} fields
 * @property {string[]} how               Cómo funciona (fórmula y significado).
 * @property {Record<string, string>} example   Valores de ejemplo para probar.
 * @property {(p: Parsed, mode: string) => ({ ok: true, outcome: Omit<Outcome, 'inputs'> } | { ok: false, error: string })} compute
 */

// ------------------------------------------------------------------ formato

/** @param {number} cents */
const m = (cents) => formatMoney(cents);
/** @param {number} cents */
const m0 = (cents) => formatMoney(cents, { decimals: false });
/** 12.5 -> "12.5%"; 7 -> "7%"; hasta 2 decimales. @param {number} value */
const pct = (value) => `${Math.round(value * 100) / 100}%`;

/**
 * "27 meses" -> "2 años y 3 meses".
 * @param {number} months
 */
export function durationText(months) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(plural(years, 'año', 'años'));
  if (rest > 0 || years === 0) parts.push(plural(rest, 'mes', 'meses'));
  return parts.join(' y ');
}

/** Años (pueden ser decimales) como texto: 3 -> "3 años", 2.5 -> "2 años y 6 meses", 2.37 -> "2.37 años". @param {number} years */
function yearsText(years) {
  const months = years * 12;
  if (Math.abs(months - Math.round(months)) < 0.01) return durationText(Math.round(months));
  return `${Math.round(years * 100) / 100} años`;
}

// ------------------------------------------------------------------ lectura y validación de campos

/**
 * Lee un número escrito por una persona: 12, 12.5, 12,5 o 12 %. Rechaza lo ambiguo.
 * @param {string} text
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parseNumberText(text) {
  const raw = String(text ?? '').trim().replace(/\s*%$/, '');
  if (!/^\d{1,9}([.,]\d{1,6})?$/.test(raw)) return { ok: false, error: 'Escribe un número. Ejemplo: 12.5' };
  return { ok: true, value: Number(raw.replace(',', '.')) };
}

/**
 * Convierte lo escrito en cada campo. Los vacíos obligatorios se anotan en `missing` (sin mensaje de error:
 * todavía no terminó de escribir); lo mal escrito va en `errors` con su mensaje.
 * @param {FieldSpec[]} fields @param {Record<string, string>} values
 */
function parseFields(fields, values) {
  /** @type {Map<string, number | string>} */
  const store = new Map();
  /** @type {Record<string, string>} */
  const errors = {};
  /** @type {string[]} */
  const missing = [];

  for (const f of fields) {
    const raw = String(values[f.id] ?? '').trim();

    if (f.type === 'select') {
      const chosen = raw || f.default || f.options?.[0]?.value || '';
      if (!f.options?.some((o) => o.value === chosen)) errors[f.id] = 'Elige una de las opciones.';
      else store.set(f.id, chosen);
      continue;
    }
    if (raw === '') {
      if (!f.optional) missing.push(f.id);
      continue;
    }

    if (f.type === 'money') {
      const r = parseMoney(raw);
      if (!r.ok) errors[f.id] = r.error;
      else if (r.cents === 0 && !f.allowZero) errors[f.id] = 'Debe ser mayor que cero.';
      else store.set(f.id, r.cents);
      continue;
    }

    const n = parseNumberText(raw);
    if (!n.ok) {
      errors[f.id] = n.error;
      continue;
    }
    if (f.type === 'percent' || f.type === 'number') {
      const max = f.max ?? (f.type === 'percent' ? MAX_RATE_PERCENT : 100);
      if (n.value === 0 && !f.allowZero) errors[f.id] = 'Debe ser mayor que cero.';
      else if (n.value > max) errors[f.id] = `No puede pasar de ${max}${f.type === 'percent' ? '%' : ''}.`;
      else store.set(f.id, n.value);
      continue;
    }

    // duration: número + unidad (años o meses), guardado en meses.
    const unit = values[`${f.id}Unit`] === 'months' ? 'months' : 'years';
    const maxMonths = f.maxMonths ?? MAX_INVEST_MONTHS;
    if (unit === 'months' && !Number.isInteger(n.value)) {
      errors[f.id] = 'En meses escribe un número entero.';
      continue;
    }
    const months = Math.round((unit === 'months' ? n.value : n.value * 12));
    if (months < 1) errors[f.id] = 'Debe durar al menos 1 mes.';
    else if (months > maxMonths) errors[f.id] = `El máximo es ${durationText(maxMonths)}.`;
    else store.set(f.id, months);
  }

  /** @type {Parsed} */
  const accessors = {
    money: (id) => (typeof store.get(id) === 'number' ? /** @type {number} */ (store.get(id)) : undefined),
    num: (id) => (typeof store.get(id) === 'number' ? /** @type {number} */ (store.get(id)) : undefined),
    months: (id) => (typeof store.get(id) === 'number' ? /** @type {number} */ (store.get(id)) : undefined),
    text: (id) => (typeof store.get(id) === 'string' ? /** @type {string} */ (store.get(id)) : undefined),
  };
  return { accessors, errors, missing, store };
}

/**
 * Lo que escribió el usuario, ya interpretado ("Tiempo: 2 años y 3 meses").
 * @param {FieldSpec[]} fields @param {Map<string, number | string>} store
 * @returns {[string, string][]}
 */
function inputsSummary(fields, store) {
  /** @type {[string, string][]} */
  const out = [];
  for (const f of fields) {
    const v = store.get(f.id);
    if (v === undefined) continue;
    if (f.type === 'select') out.push([f.label, f.options?.find((o) => o.value === v)?.label ?? String(v)]);
    else if (typeof v !== 'number') continue;
    else if (f.type === 'money') out.push([f.label, m(v)]);
    else if (f.type === 'duration') out.push([f.label, durationText(v)]);
    else out.push([f.label, f.type === 'percent' ? pct(v) : `${v}${f.suffix ? ` ${f.suffix}` : ''}`]);
  }
  return out;
}

// ------------------------------------------------------------------ piezas para describir campos

/** @param {string} id @param {string} label @param {Partial<FieldSpec>} [o] @returns {FieldSpec} */
const moneyField = (id, label, o = {}) => ({ id, label, type: 'money', ...o });
/** @param {string} id @param {string} label @param {Partial<FieldSpec>} [o] @returns {FieldSpec} */
const percentField = (id, label, o = {}) => ({ id, label, type: 'percent', suffix: '%', ...o });
/** @param {string} id @param {string} label @param {Partial<FieldSpec>} [o] @returns {FieldSpec} */
const durationField = (id, label, o = {}) => ({ id, label, type: 'duration', ...o });

/** @param {string} reason @returns {{ ok: false, error: string }} */
const fail = (reason) => ({ ok: false, error: reason });

const SIMULATION_NOTE = 'Es una simulación con tasas constantes: la vida real no es tan pareja. No es asesoría financiera ni una promesa de resultados.';

// ------------------------------------------------------------------ 1. interés simple

/** @type {Calculator} */
const simpleCalc = {
  id: 'interes-simple',
  title: 'Interés simple',
  summary: 'Cuánto interés genera un capital con una tasa fija, sin reinvertir lo ganado.',
  modes: [
    { id: 'interest', label: 'Interés generado' },
    { id: 'capital', label: 'Capital inicial' },
    { id: 'rate', label: 'Tasa' },
    { id: 'time', label: 'Tiempo' },
  ],
  fields(mode) {
    const capital = moneyField('capital', 'Capital inicial');
    const interest = moneyField('interest', 'Interés generado');
    const rate = percentField('rate', 'Tasa de interés anual', { hint: 'Por ejemplo, 10 para 10 % al año.' });
    const time = durationField('time', 'Tiempo', { maxMonths: 1200 });
    if (mode === 'capital') return [interest, { ...rate, allowZero: false }, time];
    if (mode === 'rate') return [capital, interest, time];
    if (mode === 'time') return [capital, interest, { ...rate, allowZero: false }];
    return [capital, { ...rate, allowZero: true }, time];
  },
  how: [
    'Fórmula: Interés = Capital × Tasa × Tiempo (con la tasa anual y el tiempo en años).',
    'En el interés simple, los intereses NO se reinvierten: cada año ganas exactamente lo mismo. Por eso crece en línea recta.',
    'Se usa en préstamos cortos, algunos pagarés y para entender la base de todo lo demás. Compáralo con el interés compuesto para ver cuánto cambia el resultado con los años.',
  ],
  example: { capital: '100000', interest: '30000', rate: '10', time: '3', timeUnit: 'years' },
  compute(p) {
    const r = simpleInterest({ capitalCents: p.money('capital'), ratePercent: p.num('rate'), years: p.months('time') === undefined ? undefined : /** @type {number} */ (p.months('time')) / 12, interestCents: p.money('interest') });
    if (!r) return fail('Con esos datos no se puede calcular. Revisa que ninguno sea cero donde hace falta dividir.');
    /** @type {Record<SimpleSolved, ResultItem>} */
    const all = {
      capital: { label: 'Capital inicial', value: m(r.capitalCents) },
      rate: { label: 'Tasa anual', value: pct(r.ratePercent) },
      time: { label: 'Tiempo', value: yearsText(r.years) },
      interest: { label: 'Interés generado', value: m(r.interestCents) },
    };
    const headline = all[r.solved];
    const items = Object.entries(all).filter(([k]) => k !== r.solved).map(([, v]) => v);
    items.push({ label: 'Total al final', value: m(r.totalCents), note: 'Capital + interés' });
    const perYear = r.years > 0 ? Math.round(r.interestCents / r.years) : 0;
    return {
      ok: true,
      outcome: {
        headline,
        items,
        sentence: `Con ${m0(r.capitalCents)} al ${pct(r.ratePercent)} anual durante ${yearsText(r.years)}, el interés simple genera ${m(r.interestCents)}: terminas con ${m(r.totalCents)}.`,
        notes: [
          `Ganas lo mismo cada año (${m(perYear)}), porque los intereses no se reinvierten.`,
          'La tasa se toma como anual. Si tu tasa es mensual, multiplícala por 12 antes de escribirla.',
        ],
      },
    };
  },
};
/** @typedef {'capital' | 'rate' | 'time' | 'interest'} SimpleSolved */

// ------------------------------------------------------------------ 2. interés compuesto

/** @type {Calculator} */
const compoundCalc = {
  id: 'interes-compuesto',
  title: 'Interés compuesto',
  summary: 'Cuánto crece tu dinero cuando los intereses también generan intereses, con aportes cada mes.',
  fields() {
    return [
      moneyField('principal', 'Capital inicial', { optional: true, allowZero: true, hint: 'Lo que tienes hoy para empezar. Puede ser 0.' }),
      moneyField('monthly', 'Aporte mensual', { optional: true, allowZero: true, hint: 'Lo que añades cada mes, al final del mes.' }),
      percentField('rate', 'Tasa de interés anual', { allowZero: true }),
      {
        id: 'compounding', label: 'Frecuencia de capitalización', type: 'select', default: 'monthly',
        options: Object.entries(COMPOUNDING).map(([value, c]) => ({ value, label: `${c.label} (${c.perYear} ${c.perYear === 1 ? 'vez' : 'veces'} al año)` })),
        hint: 'Cada cuánto se suman los intereses al capital.',
      },
      durationField('time', 'Tiempo', { defaultUnit: 'years', maxMonths: MAX_INVEST_MONTHS }),
    ];
  },
  how: [
    'Capital inicial: C × (1 + tasa ÷ m)^(m × años), donde m es cuántas veces al año se suman los intereses.',
    'Cada aporte mensual también gana interés desde el mes siguiente, con la tasa mensual equivalente.',
    'La magia está en el tiempo: al principio casi todo es lo que tú pones; al final, el interés puede superar tus aportes. Por eso empezar temprano pesa tanto.',
  ],
  example: { principal: '100000', monthly: '5000', rate: '8', compounding: 'monthly', time: '10', timeUnit: 'years' },
  compute(p) {
    const principal = p.money('principal') ?? 0;
    const monthly = p.money('monthly') ?? 0;
    const rate = p.num('rate') ?? 0;
    const compounding = p.text('compounding') ?? 'monthly';
    const months = p.months('time') ?? 0;
    if (principal + monthly === 0) return fail('Escribe un capital inicial, un aporte mensual o los dos.');
    if (!isCompounding(compounding)) return fail('Elige la frecuencia de capitalización.');
    const r = compoundGrowth({ principalCents: principal, monthlyContributionCents: monthly, annualRatePercent: rate, compoundsPerYear: COMPOUNDING[compounding].perYear, months });
    if (!r) return fail('El resultado sería demasiado grande para mostrarlo. Prueba con menos tiempo o una tasa menor.');

    const rowLabel = (/** @type {number} */ month) => (month % 12 === 0 ? `Año ${month / 12}` : `Mes ${month}`);
    const step = Math.max(1, Math.ceil(r.rows.length / 20));
    const sampled = r.rows.filter((_, i) => i % step === step - 1 || i === r.rows.length - 1);
    const parts = [];
    if (principal > 0) parts.push(`empiezas con ${m0(principal)}`);
    if (monthly > 0) parts.push(`aportas ${m0(monthly)} cada mes`);
    return {
      ok: true,
      outcome: {
        headline: { label: 'Valor futuro', value: m(r.futureValueCents) },
        items: [
          { label: 'Total que pones tú', value: m(r.contributedCents), note: 'Capital inicial + todos los aportes' },
          { label: 'Intereses generados', value: m(r.interestCents) },
          { label: 'Crecimiento sobre lo aportado', value: r.growthPercent === null ? '—' : pct(r.growthPercent) },
          { label: 'Tasa efectiva anual', value: pct(r.effectiveAnnualPercent), note: `Lo que realmente rinde en un año con capitalización ${COMPOUNDING[compounding].label.toLowerCase()}` },
        ],
        sentence: `Si ${parts.join(' y ')} durante ${durationText(months)} con un ${pct(rate)} anual, tendrías ${m0(r.futureValueCents)}: ${m0(r.contributedCents)} salen de tu bolsillo y ${m0(r.interestCents)} los genera el interés.`,
        notes: [
          'Los aportes se suponen al final de cada mes y ganan interés desde el mes siguiente, con la tasa mensual equivalente. El capital inicial sigue la fórmula exacta.',
          SIMULATION_NOTE,
        ],
        table: {
          caption: 'Crecimiento del dinero',
          headers: ['Tiempo', 'Lo que pones tú', 'Intereses', 'Total'],
          rows: r.rows.map((row) => [rowLabel(row.month), { money: row.contributedCents }, { money: row.interestCents }, { money: row.balanceCents }]),
        },
        chart: {
          labels: sampled.map((row) => (row.month % 12 === 0 ? `A${row.month / 12}` : `M${row.month}`)),
          titles: sampled.map((row) => rowLabel(row.month)),
          series: [
            { name: 'Lo que pones tú', cls: 'expense', values: sampled.map((row) => row.contributedCents) },
            { name: 'Total con intereses', cls: 'income', values: sampled.map((row) => row.balanceCents) },
          ],
          ariaLabel: `Lo que pones tú frente al total con intereses, durante ${durationText(months)}`,
        },
      },
    };
  },
};

// ------------------------------------------------------------------ 3. préstamo

const LOAN_NOTE = 'La tasa se toma como nominal anual dividida entre 12, igual que en Deudas. No incluye comisiones, seguros ni cargos que cobre la entidad: el costo real puede ser mayor.';

/** @type {Calculator} */
const loanCalc = {
  id: 'prestamo',
  title: 'Préstamo',
  summary: 'Cuota mensual, intereses totales, duración o monto que puedes financiar.',
  modes: [
    { id: 'payment', label: 'Cuota mensual' },
    { id: 'principal', label: 'Monto financiado' },
    { id: 'term', label: 'Duración' },
  ],
  fields(mode) {
    const amount = moneyField('amount', 'Monto del préstamo');
    const payment = moneyField('payment', 'Cuota mensual');
    const rate = percentField('rate', 'Tasa de interés anual', { allowZero: true });
    const term = durationField('term', 'Plazo', { maxMonths: MAX_LOAN_MONTHS, hint: 'Hasta 50 años.' });
    if (mode === 'principal') return [payment, rate, term];
    if (mode === 'term') return [amount, payment, rate];
    return [amount, rate, term];
  },
  how: [
    'Cuota = Monto × i ÷ (1 − (1 + i)^−n), con i = tasa anual ÷ 12 y n = número de cuotas (sistema francés: cuota fija).',
    'Cada mes se pagan primero los intereses del saldo; lo que sobra baja el capital. Por eso al principio casi toda la cuota es interés.',
    'Un plazo más largo baja la cuota pero sube mucho los intereses totales. Pruébalo: cambia el plazo y mira la fila «Intereses totales».',
  ],
  example: { amount: '500000', payment: '12000', rate: '14', term: '5', termUnit: 'years' },
  compute(p, mode) {
    const rate = p.num('rate') ?? 0;
    /** @type {number} */
    let principal;
    /** @type {number} */
    let payment;
    /** @type {number} */
    let months;

    if (mode === 'principal') {
      payment = p.money('payment') ?? 0;
      months = p.months('term') ?? 0;
      const got = loanPrincipal({ paymentCents: payment, annualRatePercent: rate, months });
      if (got === null) return fail('Con esos datos no se puede calcular el monto.');
      principal = got;
    } else if (mode === 'term') {
      principal = p.money('amount') ?? 0;
      payment = p.money('payment') ?? 0;
      const got = loanMonths({ principalCents: principal, paymentCents: payment, annualRatePercent: rate });
      if (got === null) {
        const firstInterest = Math.round((principal * rate) / 1200);
        return fail(payment <= firstInterest
          ? `Esa cuota no alcanza ni para los intereses del primer mes (${m(firstInterest)}): la deuda nunca bajaría. Sube la cuota.`
          : 'Con esa cuota tardarías más de 50 años en pagarlo. Sube la cuota.');
      }
      months = got;
    } else {
      principal = p.money('amount') ?? 0;
      months = p.months('term') ?? 0;
      const got = loanPayment({ principalCents: principal, annualRatePercent: rate, months });
      if (got === null) return fail('Con esos datos no se puede calcular la cuota.');
      payment = got;
    }

    // Totales: con la tabla de amortización (exactos al centavo). Si la tabla no se puede armar, se estiman.
    const schedule = amortizationSchedule({ principalCents: principal, annualRatePercent: rate, months, paymentCents: mode === 'term' ? payment : undefined });
    const totalPaid = schedule ? schedule.totalPaidCents : payment * months;
    const totalInterest = schedule ? schedule.totalInterestCents : totalPaid - principal;
    const paidMonths = schedule ? schedule.months : months;
    const per100 = principal > 0 ? Math.round((totalInterest / principal) * 10_000) : 0;

    /** @type {Record<string, ResultItem>} */
    const heads = {
      payment: { label: 'Cuota mensual', value: m(payment) },
      principal: { label: 'Monto que puedes financiar', value: m(principal) },
      term: { label: 'Duración', value: durationText(paidMonths) },
    };
    const items = [
      mode === 'payment' ? null : { label: 'Cuota mensual', value: m(payment) },
      mode === 'principal' ? null : { label: 'Monto financiado', value: m(principal) },
      mode === 'term' ? null : { label: 'Duración', value: durationText(months), note: plural(months, 'cuota', 'cuotas') },
      { label: 'Total a pagar', value: m(totalPaid), note: 'Todas las cuotas sumadas' },
      { label: 'Intereses totales', value: m(totalInterest) },
      { label: `Intereses por cada ${m0(10_000)} prestados`, value: m(per100), note: 'Lo que cuesta el crédito' },
    ].filter((x) => x !== null);
    return {
      ok: true,
      outcome: {
        headline: heads[mode] ?? heads.payment,
        items: /** @type {ResultItem[]} */ (items),
        sentence: `Un préstamo de ${m0(principal)} al ${pct(rate)} anual a ${durationText(paidMonths)} se paga con cuotas de ${m(payment)}: en total devuelves ${m0(totalPaid)}, o sea ${m0(totalInterest)} de intereses.`,
        notes: [LOAN_NOTE, 'Para ver mes a mes cuánto va a intereses y cuánto a capital, usa la calculadora de Amortización.'],
      },
    };
  },
};

// ------------------------------------------------------------------ 4. amortización

/** @type {Calculator} */
const amortizationCalc = {
  id: 'amortizacion',
  title: 'Amortización',
  summary: 'La tabla completa de cuotas, intereses y capital pendiente. Prueba qué pasa si abonas extra.',
  fields() {
    return [
      moneyField('amount', 'Monto del préstamo'),
      percentField('rate', 'Tasa de interés anual', { allowZero: true }),
      durationField('term', 'Plazo', { maxMonths: MAX_LOAN_MONTHS, hint: 'Hasta 50 años.' }),
      moneyField('extra', 'Abono extra cada mes (opcional)', { optional: true, allowZero: true, hint: 'Dinero que pagas de más a capital. Mira cuánto tiempo e intereses te ahorras.' }),
    ];
  },
  how: [
    'Cada mes: Interés = Saldo × tasa mensual; Capital pagado = Cuota − Interés; Saldo nuevo = Saldo − Capital pagado.',
    'Mientras el saldo es alto, los intereses son altos y el capital baja despacio. Con el tiempo se invierte.',
    'Un abono extra va directo a capital: el saldo baja más rápido, los intereses del mes siguiente son menores y terminas antes.',
  ],
  example: { amount: '300000', rate: '15', term: '3', termUnit: 'years', extra: '2000' },
  compute(p) {
    const principal = p.money('amount') ?? 0;
    const rate = p.num('rate') ?? 0;
    const months = p.months('term') ?? 0;
    const extra = p.money('extra') ?? 0;
    const base = amortizationSchedule({ principalCents: principal, annualRatePercent: rate, months });
    if (!base) return fail('Con esa tasa y ese plazo la cuota casi solo cubre intereses y la tabla no se puede armar al centavo. Prueba con un plazo más corto.');
    const plan = extra > 0 ? amortizationSchedule({ principalCents: principal, annualRatePercent: rate, months, extraCents: extra }) : base;
    if (!plan) return fail('No se pudo armar la tabla con ese abono extra.');

    const withExtra = extra > 0;
    const headers = withExtra ? ['N.º', 'Cuota', 'Abono extra', 'Interés', 'Capital', 'Saldo'] : ['N.º', 'Cuota', 'Interés', 'Capital', 'Saldo'];
    const rows = plan.rows.map((r) => (withExtra
      ? [{ int: r.number }, { money: r.paymentCents }, { money: r.extraCents }, { money: r.interestCents }, { money: r.principalCents }, { money: r.balanceCents }]
      : [{ int: r.number }, { money: r.paymentCents }, { money: r.interestCents }, { money: r.principalCents }, { money: r.balanceCents }]));
    const principalSum = plan.rows.reduce((s, r) => s + r.principalCents, 0);
    const extraSum = plan.rows.reduce((s, r) => s + r.extraCents, 0);
    /** @type {Cell[]} */
    const totals = withExtra
      ? ['Total', { money: plan.totalPaidCents }, { money: extraSum }, { money: plan.totalInterestCents }, { money: principalSum }, null]
      : ['Total', { money: plan.totalPaidCents }, { money: plan.totalInterestCents }, { money: principalSum }, null];

    /** @type {ResultItem[]} */
    const items = [
      { label: 'Cuotas que pagarás', value: String(plan.months), note: withExtra ? `en vez de ${base.months}` : durationText(plan.months) },
      { label: 'Total a pagar', value: m(plan.totalPaidCents) },
      { label: 'Intereses totales', value: m(plan.totalInterestCents) },
    ];
    let sentence = `Con cuotas de ${m(base.paymentCents)}, un préstamo de ${m0(principal)} al ${pct(rate)} anual cuesta ${m0(base.totalInterestCents)} de intereses en ${durationText(base.months)}.`;
    if (withExtra) {
      const savedInterest = base.totalInterestCents - plan.totalInterestCents;
      const savedMonths = base.months - plan.months;
      items.push(
        { label: 'Intereses que te ahorras', value: m(savedInterest), note: 'Frente a pagar solo la cuota' },
        { label: 'Tiempo que te ahorras', value: savedMonths > 0 ? durationText(savedMonths) : 'Ninguno' },
      );
      sentence = `Pagando ${m0(extra)} extra cada mes, terminas en ${durationText(plan.months)} (${savedMonths > 0 ? `${durationText(savedMonths)} antes` : 'sin ganar tiempo'}) y te ahorras ${m0(savedInterest)} de intereses.`;
    }
    return {
      ok: true,
      outcome: {
        headline: { label: 'Cuota mensual', value: m(base.paymentCents) },
        items,
        sentence,
        notes: [LOAN_NOTE, 'La última cuota se ajusta unos centavos para que el saldo termine exactamente en cero.'],
        table: { caption: 'Tabla de amortización', headers, rows, totals },
      },
    };
  },
};

// ------------------------------------------------------------------ 5. inflación

/** @type {Calculator} */
const inflationCalc = {
  id: 'inflacion',
  title: 'Inflación',
  summary: 'Cuánto poder de compra pierde tu dinero con los años y cuánto costará lo de hoy.',
  fields() {
    return [
      moneyField('amount', 'Monto de hoy'),
      percentField('inflation', 'Inflación anual esperada', { allowZero: true, hint: 'El promedio que crees que tendrán los precios cada año.' }),
      durationField('time', 'Dentro de', { maxMonths: 1200 }),
      percentField('savings', 'Tasa que te paga tu ahorro (opcional)', { optional: true, allowZero: true, hint: 'Para saber si tu dinero le gana a la inflación.' }),
    ];
  },
  how: [
    'Lo que hoy cuesta M costará M × (1 + inflación)^años dentro de ese tiempo.',
    'Y M de dentro de ese tiempo comprarán solo lo que hoy compran M ÷ (1 + inflación)^años.',
    'Rendimiento real = (1 + tasa de tu ahorro) ÷ (1 + inflación) − 1. Si es negativo, aunque tu saldo crezca, cada vez compras menos.',
  ],
  example: { amount: '10000', inflation: '5', time: '10', timeUnit: 'years', savings: '3' },
  compute(p) {
    const amount = p.money('amount') ?? 0;
    const inflation = p.num('inflation') ?? 0;
    const months = p.months('time') ?? 0;
    const savings = p.num('savings');
    const years = months / 12;
    const r = inflationImpact({ amountCents: amount, inflationPercent: inflation, years, savingsRatePercent: savings ?? null });
    if (!r) return fail('Con esos datos no se puede calcular.');
    /** @type {ResultItem[]} */
    const items = [
      { label: `Lo que hoy cuesta ${m0(amount)} costará`, value: m(r.futureCostCents), note: `dentro de ${durationText(months)}` },
      { label: `${m0(amount)} de entonces comprarán lo que hoy compran`, value: m(r.purchasingPowerCents), note: 'Su poder de compra en dinero de hoy' },
    ];
    if (r.realRatePercent !== null) {
      items.push({
        label: 'Rendimiento real de tu ahorro',
        value: pct(r.realRatePercent),
        note: r.realRatePercent < 0 ? 'Negativo: tu dinero pierde poder de compra aunque crezca' : 'Tu dinero le gana a la inflación',
      });
    }
    return {
      ok: true,
      outcome: {
        headline: { label: 'Pérdida de poder adquisitivo', value: pct(r.lossPercent) },
        items,
        sentence: `Con ${pct(inflation)} de inflación anual, dentro de ${durationText(months)} lo que hoy cuesta ${m0(amount)} costará ${m0(r.futureCostCents)}, y tu dinero perderá ${pct(r.lossPercent)} de su poder de compra.`,
        notes: [
          'La inflación real cambia cada año y varía según lo que compres (alimentos, vivienda, transporte). Usa un promedio razonable.',
          SIMULATION_NOTE,
        ],
      },
    };
  },
};

// ------------------------------------------------------------------ 6. valor futuro

/** @type {Calculator} */
const futureCalc = {
  id: 'valor-futuro',
  title: 'Valor futuro',
  summary: 'Para inversiones, fondos de ahorro o jubilación: cuánto tendrás, cuánto aportar o cuánto tardas.',
  modes: [
    { id: 'value', label: '¿Cuánto tendré?' },
    { id: 'payment', label: '¿Cuánto aportar?' },
    { id: 'time', label: '¿Cuánto tardo?' },
  ],
  fields(mode) {
    const present = moneyField('present', 'Lo que ya tienes', { optional: true, allowZero: true });
    const payment = moneyField('payment', 'Aporte mensual', { optional: true, allowZero: true });
    const target = moneyField('target', 'Meta que quieres alcanzar');
    const rate = percentField('rate', 'Rendimiento anual esperado', { allowZero: true, hint: 'Tasa nominal anual; se aplica dividida entre 12 cada mes.' });
    const time = durationField('time', 'Tiempo', { maxMonths: MAX_INVEST_MONTHS });
    if (mode === 'payment') return [target, present, rate, time];
    if (mode === 'time') return [target, present, payment, rate];
    return [present, payment, rate, time];
  },
  how: [
    'Valor futuro = Capital × (1 + i)^n + Aporte × ((1 + i)^n − 1) ÷ i, con i = rendimiento anual ÷ 12 y n = meses.',
    'Los aportes se hacen al final de cada mes. Para saber el aporte necesario o el tiempo, se despeja esa misma fórmula.',
    'Para la jubilación conviene usar un rendimiento real (después de inflación) para que el resultado esté en dinero de hoy.',
  ],
  example: { present: '20000', payment: '3000', target: '500000', rate: '8', time: '10', timeUnit: 'years' },
  compute(p, mode) {
    const rate = p.num('rate') ?? 0;
    const present = p.money('present') ?? 0;
    const payment = p.money('payment') ?? 0;

    if (mode === 'payment') {
      const target = p.money('target') ?? 0;
      const months = p.months('time') ?? 0;
      const need = requiredContribution({ targetCents: target, presentCents: present, annualRatePercent: rate, months });
      if (need === null) return fail('Con esos datos no se puede calcular.');
      const paidIn = present + need * months;
      return {
        ok: true,
        outcome: {
          headline: { label: 'Aporte mensual necesario', value: m(need) },
          items: [
            { label: 'Meta', value: m(target) },
            { label: 'Total que pondrías tú', value: m(paidIn), note: 'Lo que ya tienes + todos los aportes' },
            { label: 'Intereses que ayudarían', value: m(Math.max(0, target - paidIn)) },
          ],
          sentence: need === 0
            ? `Con lo que ya tienes (${m0(present)}) y un ${pct(rate)} anual, llegas a ${m0(target)} en ${durationText(months)} sin aportar más.`
            : `Para llegar a ${m0(target)} en ${durationText(months)} con un ${pct(rate)} anual necesitas aportar ${m0(need)} cada mes.`,
          notes: ['El aporte se redondea al centavo, así que la meta puede quedar unos centavos arriba o abajo.', SIMULATION_NOTE],
        },
      };
    }

    if (mode === 'time') {
      const target = p.money('target') ?? 0;
      if (present + payment === 0 && rate === 0) return fail('Escribe lo que ya tienes o un aporte mensual.');
      const months = monthsToTarget({ targetCents: target, presentCents: present, paymentCents: payment, annualRatePercent: rate });
      if (months === null) return fail('Con esos datos no llegarías a la meta (o tardarías más de 100 años). Sube el aporte o el rendimiento.');
      const fv = months > 0 ? futureValue({ presentCents: present, paymentCents: payment, annualRatePercent: rate, months }) : present;
      const paidIn = present + payment * months;
      return {
        ok: true,
        outcome: {
          headline: { label: 'Tiempo para llegar a tu meta', value: months === 0 ? 'Ya la alcanzaste' : durationText(months) },
          items: [
            { label: 'Tendrás', value: m(fv ?? target), note: 'Al terminar ese mes' },
            { label: 'Total que pones tú', value: m(paidIn) },
            { label: 'Intereses generados', value: m(Math.max(0, (fv ?? target) - paidIn)) },
          ],
          sentence: months === 0
            ? `Lo que ya tienes (${m0(present)}) alcanza la meta de ${m0(target)}.`
            : `Con ${m0(present)} hoy y ${m0(payment)} al mes a un ${pct(rate)} anual llegas a ${m0(target)} en ${durationText(months)}.`,
          notes: [SIMULATION_NOTE],
        },
      };
    }

    const months = p.months('time') ?? 0;
    if (present + payment === 0) return fail('Escribe lo que ya tienes, un aporte mensual o los dos.');
    const fv = futureValue({ presentCents: present, paymentCents: payment, annualRatePercent: rate, months });
    if (fv === null) return fail('El resultado sería demasiado grande para mostrarlo.');
    const paidIn = present + payment * months;
    return {
      ok: true,
      outcome: {
        headline: { label: 'Valor futuro', value: m(fv) },
        items: [
          { label: 'Total que pones tú', value: m(paidIn), note: 'Lo que ya tienes + todos los aportes' },
          { label: 'Intereses generados', value: m(fv - paidIn) },
        ],
        sentence: `Con ${m0(present)} hoy y ${m0(payment)} al mes durante ${durationText(months)} a un ${pct(rate)} anual tendrías ${m0(fv)}.`,
        notes: [SIMULATION_NOTE],
      },
    };
  },
};

// ------------------------------------------------------------------ 7. valor presente

/** @type {Calculator} */
const presentCalc = {
  id: 'valor-presente',
  title: 'Valor presente',
  summary: 'Cuánto vale hoy un dinero que recibirás en el futuro (descontar flujos).',
  modes: [
    { id: 'lump', label: 'Un pago futuro' },
    { id: 'periodic', label: 'Pagos mensuales' },
    { id: 'flows', label: 'Varios años' },
  ],
  fields(mode) {
    const rate = percentField('rate', 'Tasa de descuento anual', { allowZero: true, hint: 'Lo que ganarías con ese dinero en otra parte, o la inflación.' });
    if (mode === 'periodic') return [moneyField('payment', 'Pago mensual'), rate, durationField('time', 'Durante', { maxMonths: MAX_LOAN_MONTHS })];
    if (mode === 'flows') {
      return [
        rate,
        ...[1, 2, 3, 4, 5].map((y) => moneyField(`y${y}`, `Dinero que recibirás dentro de ${y} ${y === 1 ? 'año' : 'años'}`, { optional: true, allowZero: true })),
      ];
    }
    return [moneyField('future', 'Dinero que recibirás'), rate, durationField('time', 'Dentro de', { maxMonths: 1200 })];
  },
  how: [
    'Valor presente = Dinero futuro ÷ (1 + tasa)^años. Es el camino inverso del interés compuesto.',
    'El dinero de hoy vale más que el de mañana: puedes invertirlo y crecerá, y la inflación come el poder de compra del que llega tarde.',
    'Sirve para comparar: ¿me conviene recibir 90,000 hoy o 100,000 dentro de un año? Descuenta el segundo y compara.',
  ],
  example: { future: '100000', payment: '5000', rate: '8', time: '5', timeUnit: 'years', y1: '10000', y2: '10000', y3: '10000', y4: '10000', y5: '60000' },
  compute(p, mode) {
    const rate = p.num('rate') ?? 0;
    if (mode === 'flows') {
      const flows = [1, 2, 3, 4, 5].map((y) => ({ year: y, cents: p.money(`y${y}`) ?? 0 })).filter((f) => f.cents > 0);
      if (flows.length === 0) return fail('Escribe el dinero de al menos un año.');
      const r = presentValueFlows({ flows, annualRatePercent: rate });
      if (!r) return fail('Con esos datos no se puede calcular.');
      return {
        ok: true,
        outcome: {
          headline: { label: 'Valor presente', value: m(r.presentValueCents) },
          items: [
            { label: 'Suma de lo que recibirás', value: m(r.totalFutureCents), note: 'Sin descontar' },
            { label: 'Lo que «pierdes» por esperar', value: m(r.discountCents) },
          ],
          sentence: `Recibir ${m0(r.totalFutureCents)} repartidos en los próximos años equivale hoy a ${m0(r.presentValueCents)}, con una tasa de descuento de ${pct(rate)} anual.`,
          notes: ['Cada flujo se descuenta por los años que falta para recibirlo.', SIMULATION_NOTE],
          table: {
            caption: 'Valor de cada flujo hoy',
            headers: ['Año', 'Recibirás', 'Vale hoy'],
            rows: r.rows.map((row) => [`Año ${row.year}`, { money: row.futureCents }, { money: row.presentCents }]),
            totals: ['Total', { money: r.totalFutureCents }, { money: r.presentValueCents }],
          },
        },
      };
    }
    if (mode === 'periodic') {
      const payment = p.money('payment') ?? 0;
      const months = p.months('time') ?? 0;
      const pv = presentValueAnnuity({ paymentCents: payment, annualRatePercent: rate, months });
      if (pv === null) return fail('Con esos datos no se puede calcular (el máximo son 50 años).');
      return {
        ok: true,
        outcome: {
          headline: { label: 'Valor presente', value: m(pv) },
          items: [
            { label: 'Suma de lo que recibirás', value: m(payment * months), note: `${plural(months, 'pago', 'pagos')} de ${m(payment)}` },
            { label: 'Lo que «pierdes» por esperar', value: m(payment * months - pv) },
          ],
          sentence: `Recibir ${m0(payment)} al mes durante ${durationText(months)} equivale hoy a ${m0(pv)} con un descuento de ${pct(rate)} anual.`,
          notes: ['Los pagos se suponen al final de cada mes y se descuentan con la tasa anual ÷ 12.', SIMULATION_NOTE],
        },
      };
    }
    const future = p.money('future') ?? 0;
    const months = p.months('time') ?? 0;
    const pv = presentValueLump({ futureCents: future, annualRatePercent: rate, years: months / 12 });
    if (pv === null) return fail('Con esos datos no se puede calcular.');
    return {
      ok: true,
      outcome: {
        headline: { label: 'Valor presente', value: m(pv) },
        items: [
          { label: 'Dinero futuro', value: m(future), note: `Dentro de ${durationText(months)}` },
          { label: 'Lo que «pierdes» por esperar', value: m(future - pv) },
          { label: `Cada ${m0(100)} futuro vale hoy`, value: m(Math.round((pv / future) * 100)), note: `Por cada ${m(100)} que llegará` },
        ],
        sentence: `${m0(future)} que recibirás dentro de ${durationText(months)} valen hoy ${m0(pv)} con un descuento de ${pct(rate)} anual.`,
        notes: [SIMULATION_NOTE],
      },
    };
  },
};

// ------------------------------------------------------------------ 8. ROI

/** @type {Calculator} */
const roiCalc = {
  id: 'roi',
  title: 'Retorno de inversión (ROI)',
  summary: 'Qué tan rentable fue (o sería) una inversión, y cuánto podrías perder.',
  fields() {
    return [
      moneyField('invested', 'Lo que inviertes'),
      moneyField('final', 'Valor final', { allowZero: true, hint: 'Lo que recibes al final (con la ganancia incluida).' }),
      moneyField('costs', 'Costos o comisiones (opcional)', { optional: true, allowZero: true }),
      durationField('time', 'Tiempo (opcional)', { optional: true, maxMonths: 1200, hint: 'Con el tiempo se calcula el rendimiento por año.' }),
      percentField('inflation', 'Inflación anual (opcional)', { optional: true, allowZero: true, hint: 'Con tiempo e inflación se calcula el rendimiento real.' }),
      moneyField('worst', 'Valor final si te va mal (opcional)', { optional: true, allowZero: true, hint: 'El peor caso que consideres razonable. Sirve para ver el riesgo.' }),
    ];
  },
  how: [
    'ROI = (Valor final − Inversión − Costos) ÷ Inversión.',
    'Con el tiempo: rendimiento anual = ((Valor final − Costos) ÷ Inversión)^(1 ÷ años) − 1. Así puedes comparar inversiones de plazos distintos.',
    'El ROI NO mide el riesgo: dos inversiones con el mismo ROI pueden arriesgar cosas muy distintas. Por eso puedes escribir un «peor caso» y ver cuánto podrías perder frente a lo que podrías ganar.',
  ],
  example: { invested: '100000', final: '140000', costs: '2000', time: '3', timeUnit: 'years', inflation: '5', worst: '70000' },
  compute(p) {
    const invested = p.money('invested') ?? 0;
    const final = p.money('final') ?? 0;
    const costs = p.money('costs') ?? 0;
    const months = p.months('time');
    const inflation = p.num('inflation');
    const worst = p.money('worst');
    const years = months === undefined ? null : months / 12;
    const r = roi({ investedCents: invested, finalCents: final, costsCents: costs, years, inflationPercent: years === null ? null : (inflation ?? null) });
    if (!r) return fail('Con esos datos no se puede calcular.');

    /** @type {ResultItem[]} */
    const items = [{ label: r.gainCents >= 0 ? 'Ganancia neta' : 'Pérdida neta', value: m(r.gainCents), note: 'Valor final − inversión − costos' }];
    if (r.annualizedPercent !== null) items.push({ label: 'Rendimiento por año', value: pct(r.annualizedPercent), note: 'El equivalente si hubiera rendido igual cada año' });
    if (r.realAnnualizedPercent !== null) {
      items.push({ label: 'Rendimiento real por año', value: pct(r.realAnnualizedPercent), note: r.realAnnualizedPercent < 0 ? 'Después de inflación pierde poder de compra' : 'Después de inflación' });
    }
    /** @type {string[]} */
    const notes = ['El ROI mide cuánto ganaste, no cuánto arriesgaste. Compara siempre con otras opciones y con el peor caso.'];
    if (inflation !== undefined && years === null) notes.push('Para calcular el rendimiento real también indica el tiempo.');

    if (worst !== undefined) {
      const bad = roi({ investedCents: invested, finalCents: worst, costsCents: costs });
      if (bad) {
        items.push({ label: 'ROI si te va mal', value: pct(bad.roiPercent) });
        if (bad.gainCents < 0) {
          const loss = -bad.gainCents;
          items.push({ label: 'Lo máximo que perderías en ese caso', value: m(loss) });
          if (r.gainCents > 0) {
            items.push({ label: 'Relación ganancia / pérdida', value: `${Math.round((r.gainCents / loss) * 100) / 100} a 1`, note: 'Por cada unidad que podrías perder, lo que podrías ganar' });
          }
        } else notes.push('En el «peor caso» que escribiste igual ganas: revisa si de verdad es el peor escenario posible.');
      }
    }
    return {
      ok: true,
      outcome: {
        headline: { label: 'ROI', value: pct(r.roiPercent), note: r.gainCents >= 0 ? 'Rentabilidad total' : 'Pérdida total' },
        items,
        sentence: `Invertir ${m0(invested)} y terminar con ${m0(final)}${costs > 0 ? ` (con ${m0(costs)} de costos)` : ''} ${r.gainCents >= 0 ? 'te deja' : 'te hace perder'} ${m0(Math.abs(r.gainCents))}: un ROI de ${pct(r.roiPercent)}.`,
        notes: [...notes, SIMULATION_NOTE],
      },
    };
  },
};

// ------------------------------------------------------------------ 9. independencia financiera

/** @type {Calculator} */
const independenceCalc = {
  id: 'independencia',
  title: 'Independencia financiera',
  summary: 'Cuánto capital necesitas para vivir de tus inversiones y en cuánto tiempo podrías lograrlo.',
  fields() {
    return [
      moneyField('expense', 'Gasto mensual que quieres cubrir', { hint: 'Lo que necesitarías cada mes para vivir.' }),
      percentField('withdrawal', 'Retiro anual seguro', { default: '4', max: 20, hint: 'La regla práctica del 4 %: cada año retiras ese porcentaje del capital.' }),
      moneyField('current', 'Capital que ya tienes invertido', { optional: true, allowZero: true }),
      moneyField('contribution', 'Aporte mensual', { optional: true, allowZero: true }),
      percentField('return', 'Rendimiento anual real esperado', { default: '5', allowZero: true, hint: 'Descontada la inflación, para que el resultado esté en dinero de hoy.' }),
      { id: 'years', label: 'Quieres lograrlo en (años, opcional)', type: 'number', optional: true, max: 100, suffix: 'años', hint: 'Para saber cuánto tendrías que aportar al mes.' },
    ];
  },
  how: [
    'Capital necesario = Gasto anual ÷ porcentaje de retiro. Con 4 %: gastas 50,000 al mes → 600,000 al año → necesitas 15,000,000.',
    'Después se calcula en cuánto tiempo llegas con tu capital, tu aporte mensual y el rendimiento, con la misma fórmula del valor futuro.',
    'La regla del 4 % es una regla práctica, no una garantía: los mercados no rinden parejo, los gastos cambian y en otros países o plazos más largos el porcentaje seguro puede ser menor.',
  ],
  example: { expense: '50000', withdrawal: '4', current: '800000', contribution: '25000', return: '5', years: '15' },
  compute(p) {
    const expense = p.money('expense') ?? 0;
    const withdrawal = p.num('withdrawal') ?? 4;
    const current = p.money('current') ?? 0;
    const contribution = p.money('contribution') ?? 0;
    const annualReturn = p.num('return') ?? 0;
    const years = p.num('years');
    const r = financialIndependence({
      monthlyExpenseCents: expense, withdrawalRatePercent: withdrawal, currentCents: current,
      monthlyContributionCents: contribution, annualReturnPercent: annualReturn, targetYears: years ?? null,
    });
    if (!r) return fail('Con esos datos no se puede calcular.');

    /** @type {ResultItem[]} */
    const items = [
      { label: 'Lo que te falta', value: r.reached ? 'Nada: ya lo tienes' : m(r.missingCents) },
      {
        label: 'Con tu aporte actual llegarías en',
        value: r.reached ? 'Ya llegaste' : r.monthsNeeded === null ? 'No llegarías con este aporte' : durationText(r.monthsNeeded),
        note: r.monthsNeeded === null && !r.reached ? 'Sube el aporte, el rendimiento o prueba con otro plazo' : undefined,
      },
    ];
    if (r.contributionNeededCents !== null && years !== undefined) {
      items.push({
        label: `Aporte mensual para lograrlo en ${yearsText(years)}`,
        value: r.contributionNeededCents === 0 ? 'Con lo que tienes ya alcanza' : m(r.contributionNeededCents),
      });
    }
    return {
      ok: true,
      outcome: {
        headline: { label: 'Capital que necesitas', value: m(r.targetCents), note: `Gasto anual ${m0(expense * 12)} ÷ ${pct(withdrawal)}` },
        items,
        sentence: `Para cubrir ${m0(expense)} al mes retirando ${pct(withdrawal)} al año necesitas unos ${m0(r.targetCents)} invertidos.${r.monthsNeeded !== null && !r.reached ? ` Con tu aporte y un ${pct(annualReturn)} real anual llegarías en ${durationText(r.monthsNeeded)}.` : ''}`,
        notes: [
          'Es un cálculo orientativo. Los rendimientos no están garantizados y los gastos cambian con los años: no es asesoría financiera.',
          'Usa un rendimiento REAL (después de inflación) y el gasto de hoy; así todo queda en dinero de hoy.',
        ],
      },
    };
  },
};

// ------------------------------------------------------------------ lista y ejecución

/** @type {Calculator[]} */
export const CALCULATORS = [
  simpleCalc, compoundCalc, loanCalc, amortizationCalc, inflationCalc, futureCalc, presentCalc, roiCalc, independenceCalc,
];

/** @param {string} id */
export function calculatorById(id) {
  return CALCULATORS.find((c) => c.id === id) ?? null;
}

/** Modo válido de una calculadora (el primero si no se reconoce). @param {Calculator} calc @param {string | undefined} mode */
export function resolveMode(calc, mode) {
  if (!calc.modes) return '';
  return calc.modes.some((x) => x.id === mode) ? /** @type {string} */ (mode) : calc.modes[0].id;
}

/**
 * Valores iniciales de los campos (los que traen un valor por defecto).
 * @param {Calculator} calc @param {string} mode
 * @returns {Record<string, string>}
 */
export function defaultValues(calc, mode) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of calc.fields(mode)) {
    if (f.default !== undefined) out[f.id] = f.default;
    if (f.type === 'duration') out[`${f.id}Unit`] = f.defaultUnit ?? 'years';
  }
  return out;
}

/**
 * @typedef {{ status: 'ok', outcome: Outcome }
 *   | { status: 'incomplete', missing: string[] }
 *   | { status: 'error', errors: Record<string, string> }} CalcResult
 */

/**
 * Calcula con lo que hay escrito ahora. "incomplete" = todavía faltan campos (no es un error);
 * "error" = algo está mal escrito o no se puede calcular con esos datos.
 * @param {string} id @param {string | undefined} mode @param {Record<string, string>} values
 * @returns {CalcResult}
 */
export function computeCalculator(id, mode, values) {
  const calc = calculatorById(id);
  if (!calc) return { status: 'error', errors: { form: 'Esa calculadora no existe.' } };
  const resolved = resolveMode(calc, mode);
  const fields = calc.fields(resolved);
  const parsed = parseFields(fields, values);
  if (Object.keys(parsed.errors).length > 0) return { status: 'error', errors: parsed.errors };
  if (parsed.missing.length > 0) return { status: 'incomplete', missing: parsed.missing };
  const result = calc.compute(parsed.accessors, resolved);
  if (!result.ok) return { status: 'error', errors: { form: result.error } };
  return { status: 'ok', outcome: { ...result.outcome, inputs: inputsSummary(fields, parsed.store) } };
}

/**
 * Valores que se pueden sugerir con los datos reales del usuario (siempre es el usuario quien decide usarlos).
 * @param {AppData} data @param {string} today
 * @returns {Record<string, Record<string, { label: string, value: string }>>}
 */
export function suggestions(data, today) {
  /** @type {Record<string, Record<string, { label: string, value: string }>>} */
  const out = {};
  const monthKey = today.slice(0, 7);
  const avg = statsIndicators(data, monthKey, today).expense.avgMonthlyCents;
  if (avg !== null && avg > 0) {
    out.independencia = { expense: { label: `Usar mi gasto mensual promedio (${m0(avg)})`, value: centsToInputValue(avg) } };
  }
  return out;
}
