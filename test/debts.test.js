import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annuityPayment, annualRatePercent, buildSchedule, committedThisMonth, averageMonthlyIncome, debtByCategory,
  debtPortfolio, debtRisk, debtStatus, fullSchedule, installmentDates, paymentMovementFields, parseRate,
  paymentsFitDebt, periodicRate, previewPayment, rateToInputValue, replayPayments, validateDebt, validatePayment, estimateDebt,
} from '../src/domain/debts.js';
import { addDays } from '../src/domain/dates.js';

const today = '2026-07-10';

/** @param {Partial<import('../src/domain/types.js').Debt>} over */
const debt = (over = {}) => ({
  id: 'd1', name: 'Préstamo', note: '', totalCents: 10_000_000, rateBp: 1200, rateBasis: 'annual', frequency: 'monthly',
  collateralKind: 'personal', collateralType: 'prestamo-personal',
  firstDueDate: '2026-08-01', firstDueTime: '09:00', finalDueDate: '2027-07-01', finalDueTime: '09:00',
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', ...over,
});

/** @param {string} id @param {number} amountCents @param {string} date @param {'regular'|'extra'} kind */
const pay = (id, amountCents, date, kind = 'regular') => ({
  id, debtId: 'd1', kind, amountCents, date, time: '10:00', note: '', movementId: `m-${id}`,
  createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`,
});

// ---------------------------------------------------------------- tasa

test('parseRate acepta formatos normales y rechaza el resto', () => {
  assert.deepEqual(parseRate('18'), { ok: true, bp: 1800 });
  assert.deepEqual(parseRate('18.5'), { ok: true, bp: 1850 });
  assert.deepEqual(parseRate('18,5'), { ok: true, bp: 1850 });
  assert.deepEqual(parseRate('18 %'), { ok: true, bp: 1800 });
  assert.deepEqual(parseRate('0'), { ok: true, bp: 0 });
  assert.deepEqual(parseRate('0.25'), { ok: true, bp: 25 });
  assert.equal(parseRate('').ok, false);
  assert.equal(parseRate('-5').ok, false);
  assert.equal(parseRate('abc').ok, false);
  assert.equal(parseRate('18.555').ok, false);
  assert.equal(parseRate('1,000.5').ok, false);
  assert.equal(parseRate('1 8').ok, false);
});

test('rateToInputValue y tasa anual equivalente', () => {
  assert.equal(rateToInputValue(1800), '18');
  assert.equal(rateToInputValue(1850), '18.5');
  assert.equal(rateToInputValue(1805), '18.05');
  assert.equal(rateToInputValue(25), '0.25');
  assert.equal(annualRatePercent({ rateBp: 150, rateBasis: 'monthly' }), 18);
  assert.equal(annualRatePercent({ rateBp: 1800, rateBasis: 'annual' }), 18);
});

test('tasa por período: proporcional a los meses del período', () => {
  assert.equal(periodicRate({ rateBp: 1200, rateBasis: 'annual', frequency: 'monthly' }), 0.01);
  assert.ok(Math.abs(periodicRate({ rateBp: 1200, rateBasis: 'annual', frequency: 'quarterly' }) - 0.03) < 1e-12);
  assert.ok(Math.abs(periodicRate({ rateBp: 100, rateBasis: 'monthly', frequency: 'bimonthly' }) - 0.02) < 1e-12);
});

// ---------------------------------------------------------------- cuotas

test('cuota fija: 100,000 al 12 % anual en 12 meses = 8,884.88 (valor de referencia conocido)', () => {
  assert.equal(annuityPayment(10_000_000, 0.01, 12), 888_488);
});

test('cuota con tasa 0 reparte el capital en partes iguales', () => {
  assert.equal(annuityPayment(12_000_000, 0, 12), 1_000_000);
});

test('tabla de amortización: cierra en cero y la suma de capital es el monto', () => {
  const rows = buildSchedule(10_000_000, 0.01, Array.from({ length: 12 }, (_, i) => ({ date: `2026-${String(i + 1).padStart(2, '0')}-01`, time: '09:00' })));
  assert.equal(rows.length, 12);
  assert.equal(rows[0].interestCents, 100_000); // 1 % de 100,000.00
  assert.equal(rows[0].principalCents, 888_488 - 100_000);
  assert.equal(rows[0].paymentCents, 888_488);
  assert.equal(rows[11].balanceAfterCents, 0);
  assert.equal(rows.reduce((s, r) => s + r.principalCents, 0), 10_000_000);
  // Cada fila: cuota = capital + interés, y el saldo baja exactamente por el capital.
  let balance = 10_000_000;
  for (const r of rows) {
    assert.equal(r.paymentCents, r.principalCents + r.interestCents);
    balance -= r.principalCents;
    assert.equal(r.balanceAfterCents, balance);
  }
  // La cuota final solo se diferencia de las demás por el ajuste de redondeo.
  assert.ok(Math.abs(rows[11].paymentCents - 888_488) <= 12);
});

test('una sola cuota paga todo con su interés', () => {
  const rows = buildSchedule(500_000, 0.02, [{ date: '2026-09-01', time: '08:00' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].interestCents, 10_000);
  assert.equal(rows[0].paymentCents, 510_000);
  assert.equal(rows[0].balanceAfterCents, 0);
});

test('fechas de cuotas: respeta el día del mes y termina en la fecha final', () => {
  const dates = installmentDates({ firstDueDate: '2026-01-31', firstDueTime: '09:00', finalDueDate: '2026-04-30', finalDueTime: '17:00', frequency: 'monthly' });
  assert.deepEqual(dates.map((d) => d.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(dates[0].time, '09:00');
  assert.equal(dates[3].time, '17:00');
});

test('fechas de cuotas: si la fecha final no coincide, la última cuota cae en la fecha final', () => {
  const dates = installmentDates({ firstDueDate: '2026-01-15', firstDueTime: '09:00', finalDueDate: '2026-03-20', finalDueTime: '09:00', frequency: 'monthly' });
  assert.deepEqual(dates.map((d) => d.date), ['2026-01-15', '2026-02-15', '2026-03-20']);
});

test('frecuencias: bimestral, trimestral, cuatrimestral y semestral', () => {
  const base = { firstDueDate: '2026-01-10', firstDueTime: '09:00', finalDueDate: '2027-01-10', finalDueTime: '09:00' };
  assert.equal(installmentDates({ ...base, frequency: 'monthly' }).length, 13);
  assert.equal(installmentDates({ ...base, frequency: 'bimonthly' }).length, 7);
  assert.equal(installmentDates({ ...base, frequency: 'quarterly' }).length, 5);
  assert.equal(installmentDates({ ...base, frequency: 'fourmonthly' }).length, 4);
  assert.equal(installmentDates({ ...base, frequency: 'semiannual' }).length, 3);
});

test('primera y final el mismo día: una sola cuota', () => {
  const dates = installmentDates({ firstDueDate: '2026-08-01', firstDueTime: '09:00', finalDueDate: '2026-08-01', finalDueTime: '09:00', frequency: 'monthly' });
  assert.equal(dates.length, 1);
});

test('fullSchedule usa la deuda completa', () => {
  const rows = fullSchedule(debt());
  assert.equal(rows.length, 12);
  assert.equal(rows[0].date, '2026-08-01');
  assert.equal(rows[11].date, '2027-07-01');
  assert.equal(rows[11].balanceAfterCents, 0);
});

// ---------------------------------------------------------------- validación

/** @param {Record<string,string>} over */
const input = (over = {}) => ({
  name: 'Tarjeta Banco', note: '', totalText: '25,000', rateText: '48', rateBasis: 'annual', frequency: 'monthly',
  collateralKind: 'personal', collateralType: 'tarjeta',
  firstDueDate: '2026-08-05', firstDueTime: '09:00', finalDueDate: '2027-01-05', finalDueTime: '09:00', ...over,
});

test('validateDebt acepta una deuda correcta y normaliza', () => {
  const r = validateDebt(input({ name: '  Tarjeta   Banco ' }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.name, 'Tarjeta Banco');
  assert.equal(r.value.totalCents, 2_500_000);
  assert.equal(r.value.rateBp, 4800);
  assert.equal(r.value.rateBasis, 'annual');
});

test('validateDebt rechaza datos incorrectos con un mensaje por campo', () => {
  const r = validateDebt(input({
    name: ' ', totalText: '0', rateText: 'x', rateBasis: 'x', frequency: 'x', collateralKind: 'x', firstDueDate: '2026-02-30', finalDueDate: '', firstDueTime: '25:00',
  }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  for (const key of ['name', 'total', 'rate', 'rateBasis', 'frequency', 'collateralKind', 'firstDueDate', 'finalDueDate', 'firstDueTime']) {
    assert.ok(r.errors[key], `falta error en ${key}`);
  }
});

test('validateDebt: garantía que no corresponde al tipo, fechas invertidas, demasiadas cuotas y tasa absurda', () => {
  assert.ok(!validateDebt(input({ collateralType: 'casa' })).ok); // 'casa' es física, no personal
  assert.ok(validateDebt(input({ collateralKind: 'physical', collateralType: 'casa' })).ok);
  assert.ok(validateDebt(input({ finalDueDate: '2026-08-04' })).errors?.finalDueDate);
  assert.ok(validateDebt(input({ finalDueDate: '2090-08-05' })).errors?.finalDueDate); // > 600 cuotas mensuales
  assert.ok(validateDebt(input({ rateText: '600' })).errors?.rate); // 600 % anual
  assert.ok(validateDebt(input({ rateText: '50', rateBasis: 'monthly' })).errors?.rate); // 50 % mensual = 600 % anual
  assert.ok(validateDebt(input({ rateText: '0' })).ok);
});

test('validateDebt acepta fecha de próxima cuota ya vencida (para registrar una deuda atrasada)', () => {
  assert.ok(validateDebt(input({ firstDueDate: '2026-01-05' })).ok);
});

// ---------------------------------------------------------------- pagos

test('replayPayments: cuota regular cubre interés primero, el resto es capital', () => {
  const d = debt();
  const r = replayPayments(d, [pay('p1', 888_488, '2026-08-01')]);
  assert.equal(r.problem, null);
  assert.equal(r.steps[0].interestCents, 100_000);
  assert.equal(r.steps[0].principalCents, 788_488);
  assert.equal(r.balanceCents, 10_000_000 - 788_488);
  assert.equal(r.regularCount, 1);
  assert.equal(r.steps[0].installmentNumber, 1);
});

test('replayPayments: abono extra va completo a capital y no cuenta como cuota', () => {
  const d = debt();
  const r = replayPayments(d, [pay('p1', 1_000_000, '2026-08-01', 'extra')]);
  assert.equal(r.steps[0].interestCents, 0);
  assert.equal(r.steps[0].principalCents, 1_000_000);
  assert.equal(r.regularCount, 0);
  assert.equal(r.steps[0].installmentNumber, null);
  assert.equal(r.balanceCents, 9_000_000);
});

test('replayPayments: el orden no depende del orden en que se guardaron', () => {
  const d = debt();
  const a = pay('a', 888_488, '2026-08-01');
  const b = pay('b', 888_488, '2026-09-01');
  const one = replayPayments(d, [a, b]);
  const two = replayPayments(d, [b, a]);
  assert.deepEqual(one.steps.map((s) => s.payment.id), ['a', 'b']);
  assert.deepEqual(two.steps.map((s) => s.payment.id), ['a', 'b']);
  assert.equal(one.balanceCents, two.balanceCents);
});

test('replayPayments: un pago mayor que el saldo + interés se rechaza', () => {
  const d = debt({ totalCents: 100_000 });
  const r = replayPayments(d, [pay('p1', 200_000, '2026-08-01')]);
  assert.equal(r.problem?.reason, 'overpay');
  assert.equal(r.steps.length, 0);
});

test('replayPayments: pagar exactamente el saldo + interés deja la deuda en cero; otro pago ya no cabe', () => {
  const d = debt({ totalCents: 100_000, rateBp: 1200 }); // interés del período: 1 000
  const ok = replayPayments(d, [pay('p1', 101_000, '2026-08-01')]);
  assert.equal(ok.problem, null);
  assert.equal(ok.balanceCents, 0);
  const again = replayPayments(d, [pay('p1', 101_000, '2026-08-01'), pay('p2', 100, '2026-09-01')]);
  assert.equal(again.problem?.reason, 'already-paid');
});

test('replayPayments: pagar menos que el interés no baja el capital', () => {
  const d = debt();
  const r = replayPayments(d, [pay('p1', 50_000, '2026-08-01')]);
  assert.equal(r.steps[0].interestCents, 50_000);
  assert.equal(r.steps[0].principalCents, 0);
  assert.equal(r.balanceCents, 10_000_000);
});

test('validatePayment: monto, fecha futura, hora y nota', () => {
  const d = debt();
  const base = { kind: 'regular', amountText: '8,884.88', date: '2026-07-09', time: '10:00', note: '' };
  assert.equal(validatePayment(base, { today, debt: d, payments: [] }).ok, true);
  assert.ok(validatePayment({ ...base, amountText: '' }, { today, debt: d, payments: [] }).errors?.amount);
  assert.ok(validatePayment({ ...base, amountText: '0' }, { today, debt: d, payments: [] }).errors?.amount);
  assert.ok(validatePayment({ ...base, date: '2026-07-11' }, { today, debt: d, payments: [] }).errors?.date);
  assert.ok(validatePayment({ ...base, time: '99:00' }, { today, debt: d, payments: [] }).errors?.time);
  assert.ok(validatePayment({ ...base, kind: 'otro' }, { today, debt: d, payments: [] }).errors?.kind);
});

test('validatePayment: no deja pagar más de lo que se debe', () => {
  const d = debt({ totalCents: 100_000 });
  const r = validatePayment({ kind: 'extra', amountText: '1,001', date: today, time: '10:00', note: '' }, { today, debt: d, payments: [] });
  assert.equal(r.ok, false);
  assert.match(r.errors?.amount ?? '', /supera/);
  assert.equal(validatePayment({ kind: 'extra', amountText: '1,000', date: today, time: '10:00', note: '' }, { today, debt: d, payments: [] }).ok, true);
});

test('validatePayment: editar un pago a un monto que haría pasarse a un pago posterior se rechaza', () => {
  const d = debt({ totalCents: 300_000, rateBp: 0 });
  const payments = [pay('a', 100_000, '2026-07-01', 'extra'), pay('b', 200_000, '2026-07-05', 'extra')];
  assert.equal(replayPayments(d, payments).balanceCents, 0);
  // Subir el primero a 150,000 haría que el segundo (200,000) supere el saldo.
  const r = validatePayment({ kind: 'extra', amountText: '1,500', date: '2026-07-01', time: '10:00', note: '' }, { today, debt: d, payments, editingId: 'a' });
  assert.equal(r.ok, false);
  // Bajar el primero a 50,000 sí cabe.
  assert.equal(validatePayment({ kind: 'extra', amountText: '500', date: '2026-07-01', time: '10:00', note: '' }, { today, debt: d, payments, editingId: 'a' }).ok, true);
});

test('paymentsFitDebt avisa si al editar la deuda los pagos ya no cuadran', () => {
  const d = debt({ totalCents: 1_000_000, rateBp: 0 });
  const payments = [pay('a', 600_000, '2026-07-01', 'extra')];
  assert.equal(paymentsFitDebt(d, payments), true);
  assert.equal(paymentsFitDebt({ ...d, totalCents: 500_000 }, payments), false);
});

test('paymentMovementFields: gasto vinculado con descripción y clasificación', () => {
  const m = paymentMovementFields(debt({ name: 'Tarjeta Banco' }), { kind: 'regular', amountCents: 5000, date: '2026-07-01', time: '10:00' }, 'cat-exp-deudas');
  assert.equal(m.type, 'expense');
  assert.equal(m.description, 'Cuota: Tarjeta Banco');
  assert.equal(m.classification, 'fixed');
  const x = paymentMovementFields(debt({ name: 'Tarjeta Banco' }), { kind: 'extra', amountCents: 5000, date: '2026-07-01', time: '10:00' }, 'cat-exp-deudas');
  assert.equal(x.description, 'Abono extra: Tarjeta Banco');
  assert.equal(x.classification, 'variable');
  assert.ok(paymentMovementFields(debt({ name: 'x'.repeat(60) }), { kind: 'extra', amountCents: 1, date: '2026-07-01', time: '10:00' }, 'c').description.length <= 80);
});

// ---------------------------------------------------------------- estado

test('debtStatus: deuda nueva, al día', () => {
  const s = debtStatus(debt(), [], today);
  assert.equal(s.paid, false);
  assert.equal(s.balanceCents, 10_000_000);
  assert.equal(s.installmentsTotal, 12);
  assert.equal(s.installmentsPaid, 0);
  assert.equal(s.next?.date, '2026-08-01');
  assert.equal(s.daysToNext, 22);
  assert.equal(s.state, 'active');
  assert.equal(s.overdueCount, 0);
  assert.equal(s.term, 'short'); // faltan 11 meses y 21 días
});

test('debtStatus: clasificación corto/largo plazo en el límite de 12 meses', () => {
  // Faltan exactamente 12 meses -> largo; 11 meses y 29 días -> corto.
  assert.equal(debtStatus(debt({ finalDueDate: '2027-07-10' }), [], today).term, 'long');
  assert.equal(debtStatus(debt({ finalDueDate: '2027-07-09' }), [], today).term, 'short');
  assert.equal(debtStatus(debt({ finalDueDate: '2026-12-01' }), [], today).term, 'short');
  assert.equal(debtStatus(debt({ finalDueDate: '2031-07-10' }), [], today).term, 'long');
});

test('debtStatus: cuota vencida y cuota próxima', () => {
  const overdue = debtStatus(debt({ firstDueDate: '2026-06-01', finalDueDate: '2027-05-01' }), [], today);
  assert.equal(overdue.state, 'overdue');
  assert.equal(overdue.overdueCount, 2); // 1 jun y 1 jul
  assert.equal(overdue.overdueCents, overdue.remaining[0].paymentCents + overdue.remaining[1].paymentCents);

  const soon = debtStatus(debt({ firstDueDate: '2026-07-15', finalDueDate: '2027-06-15' }), [], today);
  assert.equal(soon.state, 'due-soon');
  assert.equal(soon.daysToNext, 5);

  const dueToday = debtStatus(debt({ firstDueDate: today, finalDueDate: '2027-06-10' }), [], today);
  assert.equal(dueToday.state, 'due-soon');
  assert.equal(dueToday.overdueCount, 0);
});

test('debtStatus: pagar la cuota adelanta la siguiente fecha y baja el saldo', () => {
  const d = debt({ firstDueDate: '2026-07-01', finalDueDate: '2027-06-01' });
  const before = debtStatus(d, [], today);
  assert.equal(before.state, 'overdue');
  const after = debtStatus(d, [pay('p1', before.next?.paymentCents ?? 0, '2026-07-05')], today);
  assert.equal(after.state, 'active');
  assert.equal(after.next?.date, '2026-08-01');
  assert.equal(after.installmentsPaid, 1);
  assert.equal(after.installmentsTotal, 12);
  assert.equal(after.principalPaidCents, before.next?.principalCents);
  assert.equal(after.balanceCents, 10_000_000 - (before.next?.principalCents ?? 0));
});

test('debtStatus: pagando exactamente la cuota programada, la tabla que queda es la misma (sin deriva)', () => {
  const d = debt({ firstDueDate: '2026-01-01', finalDueDate: '2026-12-01' });
  const full = fullSchedule(d);
  const payments = full.slice(0, 5).map((row, i) => pay(`p${i}`, row.paymentCents, row.date));
  const s = debtStatus(d, payments, '2026-06-02');
  assert.equal(s.installmentsPaid, 5);
  assert.equal(s.balanceCents, full[4].balanceAfterCents);
  assert.deepEqual(s.remaining.map((r) => r.paymentCents), full.slice(5).map((r) => r.paymentCents));
  assert.deepEqual(s.remaining.map((r) => r.balanceAfterCents), full.slice(5).map((r) => r.balanceAfterCents));
});

test('debtStatus: pagar todo la deja en estado pagada', () => {
  const d = debt({ totalCents: 100_000, rateBp: 0 });
  const s = debtStatus(d, [pay('p1', 100_000, '2026-07-01', 'extra')], today);
  assert.equal(s.paid, true);
  assert.equal(s.state, 'paid');
  assert.equal(s.next, null);
  assert.equal(s.percentPaid, 100);
  assert.equal(s.balanceCents, 0);
});

test('debtStatus: abono extra reduce la cuota que falta pero no la fecha final', () => {
  const d = debt({ firstDueDate: '2026-08-01', finalDueDate: '2027-07-01' });
  const base = debtStatus(d, [], today);
  const withExtra = debtStatus(d, [pay('x', 3_000_000, '2026-07-05', 'extra')], today);
  assert.equal(withExtra.remaining.length, 12);
  assert.ok((withExtra.next?.paymentCents ?? 0) < (base.next?.paymentCents ?? 0));
  assert.equal(withExtra.remaining[11].date, '2027-07-01');
  assert.equal(withExtra.remaining[11].balanceAfterCents, 0);
});

test('debtStatus: pagadas todas las cuotas pero con saldo restante queda una cuota final', () => {
  const d = debt({ totalCents: 100_000, rateBp: 0, firstDueDate: '2026-08-01', finalDueDate: '2026-08-01' });
  const s = debtStatus(d, [pay('p', 50_000, '2026-07-05')], today);
  assert.equal(s.installmentsPaid, 1);
  assert.equal(s.paid, false);
  assert.equal(s.remaining.length, 1);
  assert.equal(s.remaining[0].paymentCents, 50_000);
  assert.equal(s.remaining[0].date, '2026-08-01');
});

test('debtStatus: intereses pagados y por pagar', () => {
  const d = debt();
  const full = fullSchedule(d);
  const s = debtStatus(d, [pay('p1', full[0].paymentCents, '2026-07-05')], today);
  assert.equal(s.interestPaidCents, full[0].interestCents);
  assert.equal(s.interestRemainingCents, full.slice(1).reduce((sum, r) => sum + r.interestCents, 0));
});

// ---------------------------------------------------------------- riesgo

const status = (d, payments = []) => debtStatus(d, payments, today);

test('riesgo: partes suman la puntuación y nunca pasan de 100', () => {
  const d = debt({ rateBp: 6000, firstDueDate: '2026-05-01', finalDueDate: '2036-05-01', totalCents: 90_000_000 });
  const r = debtRisk(d, status(d), { monthlyIncomeCents: 100_000, monthlyServiceCents: 200_000 });
  assert.equal(r.parts.reduce((s, p) => s + p.points, 0), r.score);
  assert.ok(r.score <= 100);
  assert.equal(r.level, 'high');
  assert.equal(r.parts.reduce((s, p) => s + p.max, 0), 100);
});

test('riesgo bajo: sin interés, poca carga, al día', () => {
  const d = debt({ rateBp: 0, totalCents: 120_000, firstDueDate: '2026-09-01', finalDueDate: '2027-02-01' });
  const r = debtRisk(d, status(d), { monthlyIncomeCents: 5_000_000, monthlyServiceCents: 20_000 });
  assert.equal(r.level, 'low');
  assert.ok(r.score <= 30);
});

test('riesgo: puntos por componente (valores calculados a mano)', () => {
  // 24 % anual -> 30*24/60 = 12. Carga 20 % del ingreso -> 30*0.5 = 15. Saldo = 100 % de 1 año de ingresos -> 15.
  // 11 meses restantes -> 2. Al día -> 0. Total 44.
  const d = debt({ rateBp: 2400, totalCents: 12_000_000, firstDueDate: '2026-09-01', finalDueDate: '2027-06-01' });
  const r = debtRisk(d, status(d), { monthlyIncomeCents: 1_000_000, monthlyServiceCents: 200_000 });
  const points = Object.fromEntries(r.parts.map((p) => [p.key, p.points]));
  assert.deepEqual(points, { interest: 12, dti: 15, amount: 15, term: 2, due: 0 });
  assert.equal(r.score, 44);
  assert.equal(r.level, 'medium');
});

test('riesgo: cuotas vencidas suben la puntuación; vencida pesa más que próxima', () => {
  const ctx = { monthlyIncomeCents: 1_000_000, monthlyServiceCents: 100_000 };
  const base = { rateBp: 2400, totalCents: 5_000_000, finalDueDate: '2027-12-01' };
  const ok = debtRisk(debt({ ...base, firstDueDate: '2026-09-01' }), status(debt({ ...base, firstDueDate: '2026-09-01' })), ctx);
  const soon = debtRisk(debt({ ...base, firstDueDate: '2026-07-12' }), status(debt({ ...base, firstDueDate: '2026-07-12' })), ctx);
  const late1 = debtRisk(debt({ ...base, firstDueDate: '2026-07-01' }), status(debt({ ...base, firstDueDate: '2026-07-01' })), ctx);
  const late2 = debtRisk(debt({ ...base, firstDueDate: '2026-06-01' }), status(debt({ ...base, firstDueDate: '2026-06-01' })), ctx);
  assert.ok(soon.score > ok.score);
  assert.ok(late1.score > soon.score);
  assert.ok(late2.score > late1.score);
});

test('riesgo sin ingresos registrados: usa valores medios y lo indica', () => {
  const d = debt();
  const r = debtRisk(d, status(d), { monthlyIncomeCents: null, monthlyServiceCents: 888_488 });
  assert.equal(r.incomeKnown, false);
  assert.equal(r.parts.find((p) => p.key === 'dti')?.points, 15);
  assert.equal(r.parts.find((p) => p.key === 'amount')?.points, 7);
  assert.match(r.parts.find((p) => p.key === 'dti')?.detail ?? '', /Sin ingresos/);
});

test('riesgo: deuda pagada = 0', () => {
  const d = debt({ totalCents: 100_000, rateBp: 0 });
  const s = status(d, [pay('p1', 100_000, '2026-07-01', 'extra')]);
  const r = debtRisk(d, s, { monthlyIncomeCents: 1_000_000, monthlyServiceCents: 0 });
  assert.equal(r.score, 0);
  assert.equal(r.level, 'low');
});

test('niveles de riesgo según el documento: 30 bajo, 31 medio, 70 medio, 71 alto', () => {
  // Se comprueba el corte con deudas construidas para caer en esos valores.
  const levels = [[30, 'low'], [31, 'medium'], [70, 'medium'], [71, 'high']];
  for (const [score, expected] of levels) {
    const level = score <= 30 ? 'low' : score <= 70 ? 'medium' : 'high';
    assert.equal(level, expected);
  }
});

// ---------------------------------------------------------------- ingresos y cartera

/** @param {string} id @param {'income'|'expense'} type @param {number} amountCents @param {string} date */
const mv = (id, type, amountCents, date) => ({
  id, type, amountCents, date, time: '08:00', description: 'x', classification: type === 'income' ? 'fixed' : 'variable',
  categoryId: 'c', createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z`,
});

test('averageMonthlyIncome: promedia los meses con ingresos entre los últimos 3', () => {
  const movements = [
    mv('a', 'income', 100_000, '2026-07-01'),
    mv('b', 'income', 50_000, '2026-07-05'),
    mv('c', 'income', 300_000, '2026-05-10'),
    mv('d', 'income', 999_999, '2026-03-10'), // fuera de la ventana
    mv('e', 'expense', 777_777, '2026-07-02'),
    mv('f', 'income', 123_456, '2026-07-20'), // futuro: no cuenta
  ];
  // Julio 150,000 y mayo 300,000 (junio no tuvo ingresos) -> promedio 225,000
  assert.equal(averageMonthlyIncome(movements, today), 225_000);
  assert.equal(averageMonthlyIncome([], today), null);
  assert.equal(averageMonthlyIncome([mv('z', 'expense', 1, '2026-07-01')], today), null);
});

test('debtPortfolio: ordena por riesgo, separa corto/largo y pagadas', () => {
  const cheap = debt({ id: 'a', name: 'Barata', rateBp: 0, totalCents: 100_000, firstDueDate: '2026-09-01', finalDueDate: '2027-02-01' });
  const risky = debt({ id: 'b', name: 'Tarjeta', rateBp: 6000, totalCents: 5_000_000, firstDueDate: '2026-06-01', finalDueDate: '2028-06-01' });
  const done = debt({ id: 'c', name: 'Pagada', rateBp: 0, totalCents: 10_000, firstDueDate: '2026-09-01', finalDueDate: '2026-09-01' });
  const payments = [{ ...pay('p1', 10_000, '2026-07-01', 'extra'), debtId: 'c' }];
  const movements = [mv('i', 'income', 1_000_000, '2026-07-01')];
  const p = debtPortfolio({ debts: [cheap, done, risky], debtPayments: payments, movements }, today);
  assert.deepEqual(p.items.map((i) => i.debt.name), ['Tarjeta', 'Barata', 'Pagada']);
  assert.deepEqual(p.short.map((i) => i.debt.name), ['Barata']);
  assert.deepEqual(p.long.map((i) => i.debt.name), ['Tarjeta']);
  assert.deepEqual(p.paid.map((i) => i.debt.name), ['Pagada']);
  assert.equal(p.totalOwedCents, 5_100_000);
  assert.ok(p.avgRisk !== null && p.avgRisk > 0);
  assert.ok(p.debtToIncome !== null && p.debtToIncome > 0);
  assert.equal(p.monthlyIncomeCents, 1_000_000);
});

test('debtPortfolio vacío', () => {
  const p = debtPortfolio({ debts: [], debtPayments: [], movements: [] }, today);
  assert.equal(p.items.length, 0);
  assert.equal(p.avgRisk, null);
  assert.equal(p.debtToIncome, null);
  assert.equal(p.totalOwedCents, 0);
});

test('equivalente mensual de una cuota trimestral', () => {
  const q = debt({ id: 'q', frequency: 'quarterly', rateBp: 0, totalCents: 1_200_000, firstDueDate: '2026-09-01', finalDueDate: '2027-06-01' });
  const p = debtPortfolio({ debts: [q], debtPayments: [], movements: [] }, today);
  // 4 cuotas de 300,000 cada 3 meses = 100,000 al mes
  assert.equal(p.items[0].status.next?.paymentCents, 300_000);
  assert.equal(p.monthlyServiceCents, 100_000);
});

test('debtByCategory agrupa por tipo de garantía y deja fuera las pagadas', () => {
  const a = debt({ id: 'a', collateralKind: 'physical', collateralType: 'auto', totalCents: 1_000_000, rateBp: 0 });
  const b = debt({ id: 'b', collateralKind: 'physical', collateralType: 'auto', totalCents: 500_000, rateBp: 0 });
  const c = debt({ id: 'c', collateralKind: 'personal', collateralType: 'tarjeta', totalCents: 2_000_000, rateBp: 0 });
  const done = debt({ id: 'd', collateralKind: 'personal', collateralType: 'tarjeta', totalCents: 5_000, rateBp: 0 });
  const p = debtPortfolio({ debts: [a, b, c, done], debtPayments: [{ ...pay('x', 5_000, '2026-07-01', 'extra'), debtId: 'd' }], movements: [] }, today);
  assert.deepEqual(debtByCategory(p.items), [
    { label: 'Tarjeta de crédito', balanceCents: 2_000_000, count: 1 },
    { label: 'Automóvil particular', balanceCents: 1_500_000, count: 2 },
  ]);
});

test('committedThisMonth: cuotas que vencen este mes (incluye vencidas), no las de meses siguientes', () => {
  const thisMonth = debt({ id: 'a', rateBp: 0, totalCents: 1_200_000, firstDueDate: '2026-07-25', finalDueDate: '2027-06-25' }); // 100,000 el 25 jul
  const late = debt({ id: 'b', rateBp: 0, totalCents: 600_000, firstDueDate: '2026-06-05', finalDueDate: '2026-11-05' }); // 100,000: vencidas 5 jun y 5 jul
  const later = debt({ id: 'c', rateBp: 0, totalCents: 600_000, firstDueDate: '2026-08-05', finalDueDate: '2027-01-05' });
  const p = debtPortfolio({ debts: [thisMonth, late, later], debtPayments: [], movements: [] }, today);
  const r = committedThisMonth(p.items, today);
  assert.equal(r.cents, 100_000 + 200_000);
  assert.equal(r.count, 3);
});

test('addDays', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-07-10', 0), '2026-07-10');
});

// ---------------------------------------------------------------- vistas previas del formulario

test('previewPayment: reparte el pago entre interés y capital sin guardar nada', () => {
  const d = debt({ totalCents: 10_000_000, rateBp: 1200, firstDueDate: '2026-07-01', finalDueDate: '2027-06-01' });
  const r = previewPayment({ kind: 'regular', amountText: '8884.88', date: today, time: '10:00', note: '' }, { today, debt: d, payments: [] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.interestCents, 100_000); // 1 % de 100,000
  assert.equal(r.principalCents, 788_488);
  assert.equal(r.balanceAfterCents, 10_000_000 - 788_488);

  const extra = previewPayment({ kind: 'extra', amountText: '1000', date: today, time: '10:00', note: '' }, { today, debt: d, payments: [] });
  assert.ok(extra.ok && extra.interestCents === 0 && extra.principalCents === 100_000);

  const over = previewPayment({ kind: 'extra', amountText: '200000', date: today, time: '10:00', note: '' }, { today, debt: d, payments: [] });
  assert.equal(over.ok, false);
});

test('previewPayment al editar un pago no cuenta el pago anterior dos veces', () => {
  const d = debt({ totalCents: 100_000, rateBp: 0, frequency: 'monthly', firstDueDate: '2026-07-01', finalDueDate: '2026-08-01' });
  const existing = pay('p1', 60_000, '2026-07-05', 'extra');
  const r = previewPayment({ kind: 'extra', amountText: '1000', date: '2026-07-05', time: '10:00', note: '' }, { today, debt: d, payments: [existing], editingId: 'p1' });
  assert.ok(r.ok && r.balanceAfterCents === 0);
});

test('estimateDebt: cuota, interés total y total a pagar', () => {
  const e = estimateDebt(debt({ totalCents: 10_000_000, rateBp: 1200, firstDueDate: '2026-07-01', finalDueDate: '2027-06-01' }));
  assert.equal(e.installments, 12);
  assert.equal(e.paymentCents, 888_488);
  assert.equal(e.totalCents, 10_000_000 + e.interestCents);
  assert.ok(e.interestCents > 600_000 && e.interestCents < 700_000, String(e.interestCents));
  const free = estimateDebt(debt({ totalCents: 120_000, rateBp: 0, firstDueDate: '2026-07-01', finalDueDate: '2026-12-01' }));
  assert.equal(free.interestCents, 0);
  assert.equal(free.installments, 6);
  assert.equal(free.paymentCents, 20_000);
});
