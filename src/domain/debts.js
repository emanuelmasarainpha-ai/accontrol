// @ts-check
// =============================================================================
// DEUDAS (documento maestro §4.4 y §19)
// -----------------------------------------------------------------------------
// Aquí vive TODA la matemática de las deudas. No sabe de pantallas ni de
// almacenamiento: son funciones puras que se prueban solas.
//
// Qué se guarda y qué se calcula:
//   SE GUARDA:  la deuda tal como la registraste y cada pago que haces.
//   SE CALCULA: saldo, interés pagado, cuotas que faltan, vencidas, tabla de
//               amortización y riesgo. Se recalcula cada vez, así que editar o
//               borrar un pago nunca deja números viejos.
//
// Reglas de cálculo (están aquí para que no haya dudas):
//  1. Cuota fija (sistema francés): A = P·i / (1 − (1+i)^−n).
//     P = saldo, n = cuotas que faltan, i = tasa por período.
//  2. Tasa por período: la tasa que indicas es NOMINAL y se reparte de forma
//     proporcional (anual: ×(meses del período)/12; mensual: ×meses del período).
//  3. En cada cuota, interés = saldo × i (redondeado al centavo) y capital = cuota − interés.
//     La última cuota se ajusta para dejar el saldo exactamente en cero.
//  4. Cuotas: las fechas salen de la primera fecha de vencimiento sumando meses
//     según la frecuencia, sin pasar de la fecha final (la última cuota cae en la fecha final).
//  5. Un pago "regular" cubre primero el interés del período y el resto va a capital.
//     Un pago "extra" va completo a capital.
//  6. Si pagas de más o de menos, la fecha final no cambia: las cuotas que faltan se recalculan
//     sobre el saldo real.
//
// LÍMITES HONESTOS: los préstamos reales pueden tener seguros, cargos o cálculo
// de interés por días que aquí no se modelan; la cuota de ACCONTROL es una
// estimación. Una tarjeta de crédito no tiene cuotas fijas: aquí se trata como un
// plan de pago con cuotas fijas hasta la fecha final.
// =============================================================================

import {
  addMonthsToDate,
  calendarDiff,
  daysBetween,
  isValidISODate,
  isValidTime,
  monthKeyOf,
  addMonths,
} from './dates.js';
import { formatMoney, MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Debt} Debt */
/** @typedef {import('./types.js').DebtPayment} DebtPayment */
/** @typedef {import('./types.js').DebtFrequency} DebtFrequency */
/** @typedef {import('./types.js').CollateralKind} CollateralKind */
/** @typedef {import('./types.js').Movement} Movement */

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

/** Meses entre una cuota y la siguiente. @type {Record<DebtFrequency, number>} */
export const FREQUENCY_MONTHS = { monthly: 1, bimonthly: 2, quarterly: 3, fourmonthly: 4, semiannual: 6 };

/** @type {Record<DebtFrequency, string>} */
export const FREQUENCY_LABELS = {
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  fourmonthly: 'Cuatrimestral',
  semiannual: 'Semestral',
};

/** @type {DebtFrequency[]} */
export const FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'fourmonthly', 'semiannual'];

/** Garantías posibles (documento §4.4). @type {Record<CollateralKind, { id: string, label: string }[]>} */
export const COLLATERAL_OPTIONS = {
  physical: [
    { id: 'vivienda', label: 'Vivienda' },
    { id: 'casa', label: 'Casa' },
    { id: 'departamento', label: 'Departamento' },
    { id: 'terreno', label: 'Terreno' },
    { id: 'local', label: 'Local comercial' },
    { id: 'oficina', label: 'Oficina' },
    { id: 'bodega', label: 'Bodega' },
    { id: 'auto', label: 'Automóvil particular' },
    { id: 'moto', label: 'Motocicleta' },
    { id: 'vehiculo-comercial', label: 'Vehículo comercial' },
    { id: 'joyas', label: 'Joyas' },
    { id: 'oro', label: 'Oro' },
    { id: 'relojes', label: 'Relojes de lujo' },
    { id: 'arte', label: 'Arte' },
    { id: 'antiguedades', label: 'Antigüedades' },
    { id: 'electronicos', label: 'Electrónicos' },
    { id: 'maquinaria', label: 'Maquinaria' },
    { id: 'herramientas', label: 'Herramientas' },
  ],
  personal: [
    { id: 'tarjeta', label: 'Tarjeta de crédito' },
    { id: 'prestamo-personal', label: 'Préstamo personal' },
    { id: 'linea-credito', label: 'Línea de crédito' },
  ],
};

/** @type {Record<CollateralKind, string>} */
export const COLLATERAL_KIND_LABELS = { physical: 'Garantía física', personal: 'Garantía personal' };

/** @param {string} kind @param {string} type */
export function isValidCollateral(kind, type) {
  return (kind === 'physical' || kind === 'personal') && COLLATERAL_OPTIONS[kind].some((o) => o.id === type);
}

/** @param {CollateralKind} kind @param {string} type */
export function collateralLabel(kind, type) {
  return COLLATERAL_OPTIONS[kind]?.find((o) => o.id === type)?.label ?? 'Sin especificar';
}

export const MAX_INSTALLMENTS = 600;
/** Tasa anual máxima aceptada (equivalente): 500 %. */
export const MAX_ANNUAL_RATE_BP = 50_000;

/** @type {Record<'low' | 'medium' | 'high', string>} */
export const RISK_LABELS = { low: 'Riesgo bajo', medium: 'Riesgo medio', high: 'Riesgo alto' };

// ---------------------------------------------------------------------------
// Tasa y cuotas
// ---------------------------------------------------------------------------

/**
 * Lee una tasa escrita por el usuario: "18", "18.5", "18,5", "18 %". Devuelve centésimas de por ciento.
 * @param {unknown} text
 * @returns {{ ok: true, bp: number } | { ok: false, error: string }}
 */
export function parseRate(text) {
  const raw = String(text ?? '').trim().replace(/\s*%$/, '').trim();
  if (raw === '') return { ok: false, error: 'Escribe la tasa de interés (puede ser 0).' };
  if (raw.startsWith('-')) return { ok: false, error: 'La tasa no puede ser negativa.' };
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(raw);
  if (!m) return { ok: false, error: 'Escribe la tasa solo con números. Ejemplo: 18 o 18.5' };
  const bp = Number.parseInt(m[1], 10) * 100 + Number.parseInt((m[2] ?? '').padEnd(2, '0') || '0', 10);
  return { ok: true, bp };
}

/** 1850 -> "18.5" (para rellenar un campo de edición). @param {number} bp */
export function rateToInputValue(bp) {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** "18.5 %" @param {number} bp */
export function formatRate(bp) {
  return `${rateToInputValue(bp)} %`;
}

/** Tasa anual equivalente en % (la mensual se multiplica por 12). @param {Pick<Debt, 'rateBp' | 'rateBasis'>} debt */
export function annualRatePercent(debt) {
  return (debt.rateBasis === 'monthly' ? debt.rateBp * 12 : debt.rateBp) / 100;
}

/**
 * Tasa por período de pago, como fracción (0.015 = 1.5 %).
 * @param {Pick<Debt, 'rateBp' | 'rateBasis' | 'frequency'>} debt
 */
export function periodicRate(debt) {
  const months = FREQUENCY_MONTHS[debt.frequency];
  const perMonth = debt.rateBasis === 'monthly' ? debt.rateBp / 10_000 : debt.rateBp / 10_000 / 12;
  return perMonth * months;
}

/**
 * Fechas de las cuotas, desde la primera hasta la fecha final (la última cuota cae en la fecha final).
 * @param {Pick<Debt, 'firstDueDate' | 'firstDueTime' | 'finalDueDate' | 'finalDueTime' | 'frequency'>} debt
 * @returns {{ date: string, time: string }[]}
 */
export function installmentDates(debt) {
  const step = FREQUENCY_MONTHS[debt.frequency];
  /** @type {{ date: string, time: string }[]} */
  const out = [];
  for (let i = 0; i <= MAX_INSTALLMENTS; i += 1) {
    const date = addMonthsToDate(debt.firstDueDate, i * step);
    if (date > debt.finalDueDate) break;
    out.push({ date, time: debt.firstDueTime });
  }
  if (out.length === 0) return [{ date: debt.finalDueDate, time: debt.finalDueTime }];
  // La última cuota se muestra en la fecha final (y a su hora).
  out[out.length - 1] = { date: debt.finalDueDate, time: debt.finalDueTime };
  return out;
}

/**
 * Cuota fija. Con tasa 0 es simplemente el capital repartido en partes iguales.
 * @param {number} principalCents @param {number} rate tasa por período (fracción) @param {number} n cuotas
 */
export function annuityPayment(principalCents, rate, n) {
  if (n <= 0) return principalCents;
  if (rate === 0) return Math.round(principalCents / n);
  return Math.round((principalCents * rate) / (1 - (1 + rate) ** -n));
}

/**
 * @typedef {Object} ScheduleRow
 * @property {number} number       Número de cuota dentro de lo que falta (1, 2, 3...).
 * @property {string} date
 * @property {string} time
 * @property {number} paymentCents
 * @property {number} interestCents
 * @property {number} principalCents
 * @property {number} balanceAfterCents
 */

/**
 * Tabla de amortización de un saldo en las fechas dadas.
 * @param {number} balanceCents @param {number} rate @param {{ date: string, time: string }[]} dates
 * @returns {ScheduleRow[]}
 */
export function buildSchedule(balanceCents, rate, dates) {
  const n = dates.length;
  const payment = annuityPayment(balanceCents, rate, n);
  let balance = balanceCents;
  /** @type {ScheduleRow[]} */
  const rows = [];
  dates.forEach((when, index) => {
    const interest = Math.round(balance * rate);
    const principal = index === n - 1 ? balance : Math.min(balance, Math.max(0, payment - interest));
    balance -= principal;
    rows.push({
      number: index + 1,
      date: when.date,
      time: when.time,
      paymentCents: principal + interest,
      interestCents: interest,
      principalCents: principal,
      balanceAfterCents: balance,
    });
  });
  return rows;
}

/** Tabla de amortización completa de una deuda al registrarla. @param {Debt} debt */
export function fullSchedule(debt) {
  return buildSchedule(debt.totalCents, periodicRate(debt), installmentDates(debt));
}

/**
 * Resumen de lo que implica una deuda, para mostrarlo mientras se llena el formulario.
 * @param {Pick<Debt, 'totalCents' | 'rateBp' | 'rateBasis' | 'frequency' | 'firstDueDate' | 'firstDueTime' | 'finalDueDate' | 'finalDueTime'>} debt
 */
export function estimateDebt(debt) {
  const rows = buildSchedule(debt.totalCents, periodicRate(debt), installmentDates(debt));
  const interestCents = rows.reduce((sum, r) => sum + r.interestCents, 0);
  return {
    installments: rows.length,
    paymentCents: rows[0]?.paymentCents ?? debt.totalCents,
    lastPaymentCents: rows[rows.length - 1]?.paymentCents ?? debt.totalCents,
    interestCents,
    totalCents: debt.totalCents + interestCents,
  };
}

// ---------------------------------------------------------------------------
// Validación al registrar o editar una deuda
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DebtInput
 * @property {string} name
 * @property {string} note
 * @property {string} totalText
 * @property {string} rateText
 * @property {string} rateBasis
 * @property {string} frequency
 * @property {string} collateralKind
 * @property {string} collateralType
 * @property {string} firstDueDate
 * @property {string} firstDueTime
 * @property {string} finalDueDate
 * @property {string} finalDueTime
 */

/**
 * @typedef {Omit<Debt, 'id' | 'createdAt' | 'updatedAt' | 'isDemo'>} DebtFields
 */

/**
 * @param {DebtInput} input
 * @returns {{ ok: true, value: DebtFields } | { ok: false, errors: Record<string, string> }}
 */
export function validateDebt(input) {
  /** @type {Record<string, string>} */
  const errors = {};

  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Ponle un nombre a la deuda. Ejemplo: Tarjeta del banco';
  else if (name.length > LIMITS.debtName) errors.name = `Máximo ${LIMITS.debtName} caracteres.`;

  const note = String(input.note ?? '').trim().replace(/\s+/g, ' ');
  if (note.length > LIMITS.debtNote) errors.note = `Máximo ${LIMITS.debtNote} caracteres.`;

  let totalCents = 0;
  const money = parseMoney(input.totalText);
  if (!money.ok) errors.total = money.error;
  else if (money.cents <= 0) errors.total = 'El monto adeudado debe ser mayor que cero.';
  else if (money.cents > MAX_CENTS) errors.total = 'El monto es demasiado grande.';
  else totalCents = money.cents;

  const rateBasis = input.rateBasis === 'annual' || input.rateBasis === 'monthly' ? input.rateBasis : null;
  if (!rateBasis) errors.rateBasis = 'Elige si la tasa es anual o mensual.';

  let rateBp = 0;
  const rate = parseRate(input.rateText);
  if (!rate.ok) errors.rate = rate.error;
  else {
    rateBp = rate.bp;
    if (rateBasis && annualRatePercent({ rateBp, rateBasis }) * 100 > MAX_ANNUAL_RATE_BP) {
      errors.rate = 'La tasa es demasiado alta. Revisa si es anual o mensual.';
    }
  }

  const frequency = FREQUENCIES.find((f) => f === input.frequency) ?? null;
  if (!frequency) errors.frequency = 'Elige la frecuencia de pago.';

  const collateralKind = input.collateralKind === 'physical' || input.collateralKind === 'personal' ? input.collateralKind : null;
  if (!collateralKind) errors.collateralKind = 'Elige el tipo de respaldo.';
  else if (!isValidCollateral(collateralKind, input.collateralType)) errors.collateralType = 'Elige una opción de la lista.';

  if (!isValidISODate(input.firstDueDate)) errors.firstDueDate = 'Elige la fecha de la próxima cuota.';
  if (!isValidTime(input.firstDueTime)) errors.firstDueTime = 'Elige una hora válida.';
  if (!isValidISODate(input.finalDueDate)) errors.finalDueDate = 'Elige la fecha de vencimiento final.';
  if (!isValidTime(input.finalDueTime)) errors.finalDueTime = 'Elige una hora válida.';

  if (!errors.firstDueDate && !errors.finalDueDate) {
    if (input.finalDueDate < input.firstDueDate) {
      errors.finalDueDate = 'El vencimiento final no puede ser anterior a la próxima cuota.';
    } else if (frequency) {
      const count = installmentDates({
        firstDueDate: input.firstDueDate, firstDueTime: '00:00', finalDueDate: input.finalDueDate, finalDueTime: '00:00', frequency,
      }).length;
      if (count > MAX_INSTALLMENTS) errors.finalDueDate = `La deuda tendría más de ${MAX_INSTALLMENTS} cuotas. Revisa las fechas.`;
    }
  }

  if (Object.keys(errors).length > 0 || !rateBasis || !frequency || !collateralKind) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, note, totalCents, rateBp, rateBasis, frequency, collateralKind,
      collateralType: input.collateralType,
      firstDueDate: input.firstDueDate, firstDueTime: input.firstDueTime,
      finalDueDate: input.finalDueDate, finalDueTime: input.finalDueTime,
    },
  };
}

// ---------------------------------------------------------------------------
// Pagos: se repasan en orden cronológico
// ---------------------------------------------------------------------------

/** Orden cronológico estable. @param {DebtPayment} a @param {DebtPayment} b */
export function comparePayments(a, b) {
  return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * @typedef {Object} PaymentStep
 * @property {DebtPayment} payment
 * @property {number} interestCents
 * @property {number} principalCents
 * @property {number} balanceAfterCents
 * @property {number | null} installmentNumber  Cuota que cubre (solo pagos regulares).
 */

/**
 * @typedef {Object} PaymentProblem
 * @property {'overpay' | 'already-paid'} reason
 * @property {string} paymentId
 * @property {number} balanceCents    Saldo justo antes de ese pago.
 * @property {number} interestCents   Interés del período en ese momento (0 para abonos extra).
 */

/**
 * Repasa los pagos de una deuda del más antiguo al más reciente y calcula cuánto fue a interés y
 * cuánto a capital. Si un pago no cabe (supera lo que se debía), se detiene y lo informa en `problem`.
 * @param {Debt} debt @param {DebtPayment[]} payments
 */
export function replayPayments(debt, payments) {
  const rate = periodicRate(debt);
  const sorted = payments.filter((p) => p.debtId === debt.id).sort(comparePayments);
  let balance = debt.totalCents;
  let regularCount = 0;
  let interestPaid = 0;
  let principalPaid = 0;
  /** @type {PaymentStep[]} */
  const steps = [];
  /** @type {PaymentProblem | null} */
  let problem = null;

  for (const p of sorted) {
    const periodInterest = p.kind === 'regular' ? Math.round(balance * rate) : 0;
    if (balance <= 0) {
      problem = { reason: 'already-paid', paymentId: p.id, balanceCents: 0, interestCents: 0 };
      break;
    }
    const interest = Math.min(p.amountCents, periodInterest);
    const principal = p.amountCents - interest;
    if (principal > balance) {
      problem = { reason: 'overpay', paymentId: p.id, balanceCents: balance, interestCents: periodInterest };
      break;
    }
    balance -= principal;
    interestPaid += interest;
    principalPaid += principal;
    steps.push({
      payment: p,
      interestCents: interest,
      principalCents: principal,
      balanceAfterCents: balance,
      installmentNumber: p.kind === 'regular' ? regularCount + 1 : null,
    });
    if (p.kind === 'regular') regularCount += 1;
  }

  return { steps, balanceCents: balance, regularCount, interestPaidCents: interestPaid, principalPaidCents: principalPaid, problem };
}

/**
 * @typedef {Object} PaymentInput
 * @property {string} kind
 * @property {string} amountText
 * @property {string} date
 * @property {string} time
 * @property {string} note
 */

/**
 * El pago "tal como quedaría", para repasar la historia con él incluido.
 * @param {{ kind: 'regular' | 'extra', amountCents: number, date: string, time: string, note: string }} value
 * @param {Debt} debt @param {DebtPayment[]} payments @param {string | null} editingId
 */
function paymentCandidate(value, debt, payments, editingId) {
  const original = editingId ? payments.find((p) => p.id === editingId) : null;
  /** @type {DebtPayment} */
  const candidate = {
    id: editingId ?? '__nuevo__', debtId: debt.id, ...value,
    movementId: original?.movementId ?? '',
    // Un pago nuevo es el más reciente; uno editado conserva su lugar entre los de la misma fecha y hora.
    createdAt: original?.createdAt ?? '9999-12-31T23:59:59.999Z',
    updatedAt: '9999-12-31T23:59:59.999Z',
  };
  return { candidate, others: payments.filter((p) => p.id !== editingId) };
}

/**
 * @param {PaymentInput} input
 * @param {{ today: string, debt: Debt, payments: DebtPayment[], editingId?: string | null }} context
 * @returns {{ ok: true, value: { kind: 'regular' | 'extra', amountCents: number, date: string, time: string, note: string } } | { ok: false, errors: Record<string, string> }}
 */
export function validatePayment(input, { today, debt, payments, editingId = null }) {
  /** @type {Record<string, string>} */
  const errors = {};

  const kind = input.kind === 'regular' || input.kind === 'extra' ? input.kind : null;
  if (!kind) errors.kind = 'Elige si es una cuota o un abono extra.';

  let amountCents = 0;
  const money = parseMoney(input.amountText);
  if (!money.ok) errors.amount = money.error;
  else if (money.cents <= 0) errors.amount = 'El monto debe ser mayor que cero.';
  else if (money.cents > MAX_CENTS) errors.amount = 'El monto es demasiado grande.';
  else amountCents = money.cents;

  if (!isValidISODate(input.date)) errors.date = 'Elige una fecha válida.';
  else if (input.date > today) errors.date = 'La fecha no puede ser futura.';
  if (!isValidTime(input.time)) errors.time = 'Elige una hora válida.';

  const note = String(input.note ?? '').trim().replace(/\s+/g, ' ');
  if (note.length > LIMITS.note) errors.note = `Máximo ${LIMITS.note} caracteres.`;

  if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors };

  // ¿Cabe este pago? Se repasa toda la historia con el pago incluido.
  const { candidate, others } = paymentCandidate(
    { kind, amountCents, date: input.date, time: input.time, note }, debt, payments, editingId,
  );
  const candidateId = candidate.id;
  const replay = replayPayments(debt, [...others, candidate]);
  if (replay.problem) {
    const p = replay.problem;
    if (p.reason === 'already-paid') {
      errors.amount = 'Esta deuda ya está pagada por completo en esa fecha.';
    } else if (p.paymentId === candidateId) {
      errors.amount = kind === 'extra'
        ? `El abono supera lo que debías en esa fecha (${formatMoney(p.balanceCents)}).`
        : `El pago supera lo que debías en esa fecha (${formatMoney(p.balanceCents)} de saldo más ${formatMoney(p.interestCents)} de interés).`;
    } else {
      errors.amount = 'Con ese monto o esa fecha, un pago posterior de esta deuda superaría lo que se debe. Ajusta primero ese pago.';
    }
    return { ok: false, errors };
  }
  return { ok: true, value: { kind, amountCents, date: input.date, time: input.time, note } };
}

/**
 * ¿Siguen siendo válidos los pagos con estos términos de deuda? (Se usa al editar una deuda.)
 * @param {Debt} debt @param {DebtPayment[]} payments
 */
export function paymentsFitDebt(debt, payments) {
  return replayPayments(debt, payments).problem === null;
}

/**
 * Vista previa mientras se escribe el pago: cuánto iría a interés y a capital y cuánto quedaría de saldo.
 * No guarda nada.
 * @param {PaymentInput} input
 * @param {{ today: string, debt: Debt, payments: DebtPayment[], editingId?: string | null }} context
 * @returns {{ ok: true, interestCents: number, principalCents: number, balanceAfterCents: number } | { ok: false, errors: Record<string, string> }}
 */
export function previewPayment(input, context) {
  const checked = validatePayment(input, context);
  if (!checked.ok) return checked;
  const { debt, payments, editingId = null } = context;
  const { candidate, others } = paymentCandidate(checked.value, debt, payments, editingId);
  const replay = replayPayments(debt, [...others, candidate]);
  const step = replay.steps.find((x) => x.payment.id === candidate.id);
  return {
    ok: true,
    interestCents: step?.interestCents ?? 0,
    principalCents: step?.principalCents ?? 0,
    balanceAfterCents: step?.balanceAfterCents ?? replay.balanceCents,
  };
}

/**
 * Campos del gasto que se crea junto con un pago de deuda.
 * @param {Debt} debt @param {{ kind: 'regular' | 'extra', amountCents: number, date: string, time: string }} payment
 * @param {string} categoryId
 */
export function paymentMovementFields(debt, payment, categoryId) {
  const prefix = payment.kind === 'regular' ? 'Cuota' : 'Abono extra';
  return {
    type: /** @type {const} */ ('expense'),
    amountCents: payment.amountCents,
    date: payment.date,
    time: payment.time,
    description: `${prefix}: ${debt.name}`.slice(0, LIMITS.description),
    classification: /** @type {'fixed' | 'variable'} */ (payment.kind === 'regular' ? 'fixed' : 'variable'),
    categoryId,
  };
}

// ---------------------------------------------------------------------------
// Estado de una deuda (todo lo que la pantalla necesita)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DebtStatus
 * @property {number} balanceCents
 * @property {number} principalPaidCents
 * @property {number} interestPaidCents
 * @property {number} percentPaid
 * @property {boolean} paid
 * @property {number} installmentsTotal
 * @property {number} installmentsPaid
 * @property {ScheduleRow[]} remaining        Cuotas que faltan (con las fechas y montos recalculados).
 * @property {ScheduleRow | null} next
 * @property {number} overdueCount
 * @property {number} overdueCents
 * @property {number | null} daysToNext
 * @property {'paid' | 'overdue' | 'due-soon' | 'active'} state
 * @property {'short' | 'long'} term
 * @property {number} monthsLeft
 * @property {number} interestRemainingCents
 * @property {PaymentStep[]} steps
 * @property {PaymentProblem | null} problem
 */

/** Días de anticipación para avisar de una cuota. */
export const DUE_SOON_DAYS = 7;

/**
 * @param {Debt} debt @param {DebtPayment[]} payments @param {string} today
 * @returns {DebtStatus}
 */
export function debtStatus(debt, payments, today) {
  const rate = periodicRate(debt);
  const all = installmentDates(debt);
  const replay = replayPayments(debt, payments);
  const balance = replay.balanceCents;
  const paid = balance <= 0;

  /** @type {ScheduleRow[]} */
  let remaining = [];
  if (!paid) {
    let dates = all.slice(replay.regularCount);
    // Si ya pagaste todas las cuotas pero queda saldo, queda una cuota final en la fecha final.
    if (dates.length === 0) dates = [{ date: debt.finalDueDate, time: debt.finalDueTime }];
    remaining = buildSchedule(balance, rate, dates);
  }
  const next = remaining[0] ?? null;
  const overdueRows = remaining.filter((r) => r.date < today);
  const daysToNext = next ? daysBetween(today, next.date) : null;
  const monthsLeft = paid || debt.finalDueDate <= today ? 0 : calendarDiff(today, debt.finalDueDate).months;

  /** @type {DebtStatus['state']} */
  let state = 'active';
  if (paid) state = 'paid';
  else if (overdueRows.length > 0) state = 'overdue';
  else if (daysToNext !== null && daysToNext <= DUE_SOON_DAYS) state = 'due-soon';

  return {
    balanceCents: balance,
    principalPaidCents: replay.principalPaidCents,
    interestPaidCents: replay.interestPaidCents,
    percentPaid: debt.totalCents > 0 ? Math.min(100, (replay.principalPaidCents / debt.totalCents) * 100) : 0,
    paid,
    installmentsTotal: all.length,
    installmentsPaid: replay.regularCount,
    remaining,
    next,
    overdueCount: overdueRows.length,
    overdueCents: overdueRows.reduce((sum, r) => sum + r.paymentCents, 0),
    daysToNext,
    state,
    // Documento §4.4: corto plazo = menos de 12 meses; largo plazo = 12 meses o más.
    term: monthsLeft < 12 ? 'short' : 'long',
    monthsLeft,
    interestRemainingCents: remaining.reduce((sum, r) => sum + r.interestCents, 0),
    steps: replay.steps,
    problem: replay.problem,
  };
}

// ---------------------------------------------------------------------------
// Riesgo (0-100) — reglas fijas, NO inteligencia artificial
// ---------------------------------------------------------------------------

/**
 * Promedio mensual de ingresos: se promedian los meses CON ingresos entre los últimos 3
 * (el actual y los dos anteriores). Devuelve null si no hay ingresos registrados en ese período.
 * @param {Movement[]} movements @param {string} today
 * @returns {number | null}
 */
export function averageMonthlyIncome(movements, today) {
  const current = monthKeyOf(today);
  const keys = new Set([current, addMonths(current, -1), addMonths(current, -2)]);
  /** @type {Map<string, number>} */
  const perMonth = new Map();
  for (const m of movements) {
    if (m.type !== 'income' || m.date > today) continue;
    const key = monthKeyOf(m.date);
    if (!keys.has(key)) continue;
    perMonth.set(key, (perMonth.get(key) ?? 0) + m.amountCents);
  }
  if (perMonth.size === 0) return null;
  return Math.round([...perMonth.values()].reduce((a, b) => a + b, 0) / perMonth.size);
}

/**
 * @typedef {Object} RiskContext
 * @property {number | null} monthlyIncomeCents  Promedio mensual de ingresos (null = no hay datos).
 * @property {number} monthlyServiceCents        Lo que pagas al mes entre todas tus deudas activas.
 */

/**
 * @typedef {Object} RiskPart
 * @property {string} key
 * @property {string} label
 * @property {number} points
 * @property {number} max
 * @property {string} detail
 */

/**
 * Puntuación de riesgo de una deuda (documento §19: 0-30 bajo, 31-70 medio, 71-100 alto).
 * Suma cinco partes que dan 100 como máximo:
 *   Interés 30 · Relación deuda-ingresos 30 · Monto 15 · Tiempo restante 10 · Vencimientos 15
 * @param {Debt} debt @param {DebtStatus} status @param {RiskContext} ctx
 */
export function debtRisk(debt, status, ctx) {
  /** @type {RiskPart[]} */
  const parts = [];
  if (status.paid) {
    return { score: 0, level: /** @type {'low'} */ ('low'), parts, incomeKnown: ctx.monthlyIncomeCents !== null };
  }
  const income = ctx.monthlyIncomeCents && ctx.monthlyIncomeCents > 0 ? ctx.monthlyIncomeCents : null;

  // 1) Interés: 0 % = 0 puntos; 60 % anual o más = 30.
  const annual = annualRatePercent(debt);
  const interestPoints = Math.round(30 * Math.min(1, annual / 60));
  parts.push({ key: 'interest', label: 'Tasa de interés', points: interestPoints, max: 30, detail: `${annual % 1 === 0 ? annual : annual.toFixed(2)} % anual` });

  // 2) Relación deuda-ingresos: todo lo que pagas al mes / ingreso mensual. 40 % o más = 30 puntos.
  if (income) {
    const dti = ctx.monthlyServiceCents / income;
    parts.push({ key: 'dti', label: 'Relación deuda-ingresos', points: Math.round(30 * Math.min(1, dti / 0.4)), max: 30, detail: `Pagas ${Math.round(dti * 100)} % de tu ingreso mensual en deudas` });
  } else {
    parts.push({ key: 'dti', label: 'Relación deuda-ingresos', points: 15, max: 30, detail: 'Sin ingresos recientes registrados: se estima un valor medio' });
  }

  // 3) Monto: saldo frente a un año de ingresos. 100 % o más = 15 puntos.
  if (income) {
    const ratio = status.balanceCents / (income * 12);
    parts.push({ key: 'amount', label: 'Monto pendiente', points: Math.round(15 * Math.min(1, ratio)), max: 15, detail: `Equivale a ${Math.round(ratio * 100)} % de un año de ingresos` });
  } else {
    parts.push({ key: 'amount', label: 'Monto pendiente', points: 7, max: 15, detail: 'Sin ingresos recientes registrados: se estima un valor medio' });
  }

  // 4) Tiempo restante: cuanto más largo, más tiempo expuesto.
  const m = status.monthsLeft;
  const termPoints = m >= 60 ? 10 : m >= 24 ? 6 : m >= 12 ? 4 : 2;
  parts.push({ key: 'term', label: 'Tiempo restante', points: termPoints, max: 10, detail: m >= 12 ? `${Math.floor(m / 12)} año(s) y ${m % 12} mes(es)` : `${m} mes(es)` });

  // 5) Vencimientos: cuotas vencidas pesan mucho; una cuota muy cercana suma un poco.
  const duePoints = status.overdueCount >= 2 ? 15 : status.overdueCount === 1 ? 10 : status.state === 'due-soon' ? 3 : 0;
  parts.push({
    key: 'due', label: 'Vencimientos', points: duePoints, max: 15,
    detail: status.overdueCount > 0 ? `${status.overdueCount} cuota(s) vencida(s)` : status.state === 'due-soon' ? 'Cuota próxima a vencer' : 'Al día',
  });

  const score = Math.max(0, Math.min(100, parts.reduce((sum, p) => sum + p.points, 0)));
  const level = score <= 30 ? 'low' : score <= 70 ? 'medium' : 'high';
  return { score, level: /** @type {'low' | 'medium' | 'high'} */ (level), parts, incomeKnown: income !== null };
}

// ---------------------------------------------------------------------------
// Cartera completa de deudas
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DebtView
 * @property {Debt} debt
 * @property {DebtPayment[]} payments
 * @property {DebtStatus} status
 * @property {ReturnType<typeof debtRisk>} risk
 */

/**
 * Todas las deudas con su estado y riesgo, las más peligrosas primero (documento §19:
 * no se muestran por orden de creación). Las pagadas van al final.
 * @param {{ debts: Debt[], debtPayments: DebtPayment[], movements: Movement[] }} data @param {string} today
 */
export function debtPortfolio(data, today) {
  const income = averageMonthlyIncome(data.movements, today);

  const base = data.debts.map((debt) => {
    const payments = data.debtPayments.filter((p) => p.debtId === debt.id);
    return { debt, payments, status: debtStatus(debt, payments, today) };
  });

  // Lo que pagas al mes en total: cada cuota se lleva a su equivalente mensual.
  const monthlyServiceCents = base.reduce((sum, b) => {
    if (b.status.paid || !b.status.next) return sum;
    return sum + Math.round(b.status.next.paymentCents / FREQUENCY_MONTHS[b.debt.frequency]);
  }, 0);

  /** @type {RiskContext} */
  const ctx = { monthlyIncomeCents: income, monthlyServiceCents };
  /** @type {DebtView[]} */
  const items = base.map((b) => ({ ...b, risk: debtRisk(b.debt, b.status, ctx) }));

  items.sort((a, b) => {
    if (a.status.paid !== b.status.paid) return a.status.paid ? 1 : -1;
    if (a.status.paid) return a.debt.name.localeCompare(b.debt.name, 'es');
    return (
      b.risk.score - a.risk.score ||
      (a.status.next?.date ?? '').localeCompare(b.status.next?.date ?? '') ||
      a.debt.name.localeCompare(b.debt.name, 'es')
    );
  });

  const active = items.filter((i) => !i.status.paid);
  const totalOwedCents = active.reduce((sum, i) => sum + i.status.balanceCents, 0);
  const avgRisk = active.length > 0 ? Math.round(active.reduce((sum, i) => sum + i.risk.score, 0) / active.length) : null;

  return {
    items,
    active,
    short: active.filter((i) => i.status.term === 'short'),
    long: active.filter((i) => i.status.term === 'long'),
    paid: items.filter((i) => i.status.paid),
    totalOwedCents,
    interestPaidCents: items.reduce((sum, i) => sum + i.status.interestPaidCents, 0),
    interestRemainingCents: active.reduce((sum, i) => sum + i.status.interestRemainingCents, 0),
    monthlyServiceCents,
    monthlyIncomeCents: income,
    debtToIncome: income && income > 0 ? monthlyServiceCents / income : null,
    avgRisk,
    avgRiskLevel: avgRisk === null ? null : /** @type {'low' | 'medium' | 'high'} */ (avgRisk <= 30 ? 'low' : avgRisk <= 70 ? 'medium' : 'high'),
  };
}

/**
 * Deuda pendiente agrupada por tipo de garantía ("Deuda por categoría", documento §6).
 * @param {DebtView[]} items
 * @returns {{ label: string, balanceCents: number, count: number }[]}
 */
export function debtByCategory(items) {
  /** @type {Map<string, { label: string, balanceCents: number, count: number }>} */
  const map = new Map();
  for (const i of items) {
    if (i.status.paid) continue;
    const label = collateralLabel(i.debt.collateralKind, i.debt.collateralType);
    const entry = map.get(label) ?? { label, balanceCents: 0, count: 0 };
    entry.balanceCents += i.status.balanceCents;
    entry.count += 1;
    map.set(label, entry);
  }
  return [...map.values()].sort((a, b) => b.balanceCents - a.balanceCents || a.label.localeCompare(b.label, 'es'));
}

/**
 * Cuotas que vencen de hoy hasta el final del mes (incluye las ya vencidas): "dinero comprometido".
 * @param {DebtView[]} items @param {string} today
 */
export function committedThisMonth(items, today) {
  const monthKey = monthKeyOf(today);
  let total = 0;
  let count = 0;
  for (const i of items) {
    if (i.status.paid) continue;
    for (const row of i.status.remaining) {
      if (monthKeyOf(row.date) <= monthKey) {
        total += row.paymentCents;
        count += 1;
      }
    }
  }
  return { cents: total, count };
}
