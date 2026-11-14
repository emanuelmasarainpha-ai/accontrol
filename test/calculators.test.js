import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALCULATORS, calculatorById, computeCalculator, defaultValues, durationText, parseNumberText, resolveMode, suggestions,
} from '../src/domain/calculators.js';
import { defaultSettings } from '../src/domain/settings.js';

/** @param {string} id @param {string | undefined} mode @param {Record<string, string>} values */
function run(id, mode, values) {
  const calc = calculatorById(id);
  assert.ok(calc, `calculadora ${id}`);
  return computeCalculator(id, mode, { ...defaultValues(calc, resolveMode(calc, mode)), ...values });
}
/** Todos los números del resultado son finitos (JSON.stringify convertiría NaN en null y lo taparía). @param {unknown} value @returns {boolean} */
function allFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFinite);
  if (value && typeof value === 'object') return Object.values(value).every(allFinite);
  return true;
}
/** @param {ReturnType<typeof computeCalculator>} r */
function ok(r) {
  assert.equal(r.status, 'ok', JSON.stringify(r));
  return /** @type {import('../src/domain/calculators.js').Outcome} */ (r.status === 'ok' ? r.outcome : null);
}
/** @param {import('../src/domain/calculators.js').Outcome} o @param {string} label */
const item = (o, label) => [o.headline, ...o.items].find((i) => i.label === label);

// ------------------------------------------------------------------ lectura de números y tiempos

test('parseNumberText: acepta 12, 12.5, 12,5 y 12 %; rechaza lo ambiguo', () => {
  for (const [text, value] of [['12', 12], ['12.5', 12.5], ['12,5', 12.5], [' 8 % ', 8], ['0.25', 0.25]]) {
    assert.deepEqual(parseNumberText(text), { ok: true, value });
  }
  for (const bad of ['', 'abc', '1,234.5', '1.2.3', '-5', '12x', '1e5', '1 2']) assert.equal(parseNumberText(bad).ok, false, bad);
});

test('durationText: años y meses en español', () => {
  assert.equal(durationText(1), '1 mes');
  assert.equal(durationText(12), '1 año');
  assert.equal(durationText(18), '1 año y 6 meses');
  assert.equal(durationText(27), '2 años y 3 meses');
  assert.equal(durationText(120), '10 años');
});

test('toda calculadora tiene id único, título, explicación y un ejemplo que funciona en cada uno de sus modos', () => {
  assert.equal(new Set(CALCULATORS.map((c) => c.id)).size, 9);
  assert.deepEqual(CALCULATORS.map((c) => c.id), [
    'interes-simple', 'interes-compuesto', 'prestamo', 'amortizacion', 'inflacion', 'valor-futuro', 'valor-presente', 'roi', 'independencia',
  ]);
  for (const calc of CALCULATORS) {
    assert.ok(calc.title && calc.summary && calc.how.length >= 2, calc.id);
    for (const mode of calc.modes?.map((x) => x.id) ?? [undefined]) {
      const o = ok(run(calc.id, mode, calc.example));
      assert.ok(o.headline.value && o.sentence.endsWith('.'), `${calc.id}/${mode}`);
      assert.ok(o.inputs.length > 0, `${calc.id}/${mode}: muestra lo que escribiste`);
      assert.ok(allFinite(o), `${calc.id}/${mode}: sin NaN ni Infinity`);
      assert.ok(![o.headline, ...o.items].some((i) => /NaN|Infinity|undefined|null/.test(i.value)), `${calc.id}/${mode}: textos sin valores raros`);
    }
  }
});

test('campos: vacío obligatorio = incompleto (sin error); mal escrito = error en ese campo', () => {
  const none = run('interes-simple', 'interest', {});
  assert.equal(none.status, 'incomplete');
  assert.deepEqual(none.status === 'incomplete' ? none.missing : [], ['capital', 'rate', 'time']);

  const bad = run('interes-simple', 'interest', { capital: '10x', rate: '5', time: '2' });
  assert.equal(bad.status, 'error');
  assert.ok(bad.status === 'error' && bad.errors.capital);

  const zero = run('interes-simple', 'capital', { interest: '1000', rate: '0', time: '2' });
  assert.ok(zero.status === 'error' && zero.errors.rate === 'Debe ser mayor que cero.', 'para despejar el capital la tasa no puede ser 0');
  assert.equal(run('interes-simple', 'interest', { capital: '1000', rate: '0', time: '2' }).status, 'ok', 'pero ganar 0 de interés es una respuesta válida');

  const months = run('interes-simple', 'interest', { capital: '1000', rate: '5', time: '2.5', timeUnit: 'months' });
  assert.ok(months.status === 'error' && months.errors.time === 'En meses escribe un número entero.');
  const huge = run('prestamo', 'payment', { amount: '1000', rate: '10', term: '51', termUnit: 'years' });
  assert.ok(huge.status === 'error' && /máximo es 50 años/.test(huge.errors.term));
  const bigRate = run('inflacion', undefined, { amount: '1000', inflation: '5000', time: '1' });
  assert.ok(bigRate.status === 'error' && /No puede pasar de 1000%/.test(bigRate.errors.inflation));
  assert.equal(run('prestamo', 'payment', { amount: '1.500', rate: '10', term: '1' }).status, 'error', 'monto ambiguo (¿mil quinientos o uno con cinco?)');
});

test('tiempo: se puede dar en años o en meses y se muestra interpretado', () => {
  const years = ok(run('interes-simple', 'interest', { capital: '12000', rate: '10', time: '1.5' }));
  const months = ok(run('interes-simple', 'interest', { capital: '12000', rate: '10', time: '18', timeUnit: 'months' }));
  assert.equal(item(years, 'Interés generado')?.value, 'RD$ 1,800.00');
  assert.equal(item(months, 'Interés generado')?.value, 'RD$ 1,800.00');
  assert.ok(months.inputs.some(([k, v]) => k === 'Tiempo' && v === '1 año y 6 meses'));
});

// ------------------------------------------------------------------ interés simple

test('interés simple: los cuatro modos se calculan y se cruzan', () => {
  const base = { capital: '100000', interest: '30000', rate: '10', time: '3' };
  const a = ok(run('interes-simple', 'interest', base));
  assert.equal(a.headline.label, 'Interés generado');
  assert.equal(a.headline.value, 'RD$ 30,000.00');
  assert.equal(item(a, 'Total al final')?.value, 'RD$ 130,000.00');
  assert.match(a.sentence, /RD\$ 100,000 al 10% anual durante 3 años.*RD\$ 30,000\.00.*RD\$ 130,000\.00/);

  assert.equal(ok(run('interes-simple', 'capital', base)).headline.value, 'RD$ 100,000.00');
  assert.equal(ok(run('interes-simple', 'rate', base)).headline.value, '10%');
  assert.equal(ok(run('interes-simple', 'time', base)).headline.value, '3 años');
  const t = ok(run('interes-simple', 'time', { capital: '100000', interest: '25000', rate: '10' }));
  assert.equal(t.headline.value, '2 años y 6 meses');
});

// ------------------------------------------------------------------ interés compuesto

test('interés compuesto: valor futuro, aportado e intereses cuadran con la fórmula', () => {
  const o = ok(run('interes-compuesto', undefined, { principal: '100000', monthly: '5000', rate: '8', time: '10' }));
  const i = 0.08 / 12;
  const expected = 100_000 * (1 + i) ** 120 + (5000 * ((1 + i) ** 120 - 1)) / i;
  const shown = Number(o.headline.value.replace(/[^\d.]/g, ''));
  assert.ok(Math.abs(shown - expected) < 0.05, `${shown} vs ${expected}`);
  assert.equal(item(o, 'Total que pones tú')?.value, 'RD$ 700,000.00');
  assert.equal(o.table?.rows.length, 10);
  assert.equal(o.table?.rows[0][0], 'Año 1');
  assert.equal(o.chart?.series.length, 2);
  assert.equal(o.chart?.labels.length, 10);
});

test('interés compuesto: con mucho tiempo el gráfico se resume en ~20 columnas pero la tabla trae todo', () => {
  const o = ok(run('interes-compuesto', undefined, { principal: '1000', monthly: '100', rate: '6', time: '60' }));
  assert.equal(o.table?.rows.length, 60);
  assert.ok((o.chart?.labels.length ?? 99) <= 20);
  assert.equal(o.chart?.labels.at(-1), 'A60', 'siempre incluye el último año');
});

test('interés compuesto: pide al menos capital o aporte y capitalizar más rinde más', () => {
  const empty = run('interes-compuesto', undefined, { principal: '0', monthly: '', rate: '5', time: '5' });
  assert.ok(empty.status === 'error' && /capital inicial, un aporte mensual/.test(empty.errors.form));
  const yearly = ok(run('interes-compuesto', undefined, { principal: '1000', rate: '12', compounding: 'annual', time: '1' }));
  const daily = ok(run('interes-compuesto', undefined, { principal: '1000', rate: '12', compounding: 'daily', time: '1' }));
  assert.equal(yearly.headline.value, 'RD$ 1,120.00');
  assert.ok(Number(daily.headline.value.replace(/[^\d.]/g, '')) > 1127);
  assert.equal(item(daily, 'Tasa efectiva anual')?.value, '12.75%');
});

// ------------------------------------------------------------------ préstamo y amortización

test('préstamo: la cuota de 100,000 al 12 % a 12 meses es 8,884.88 y los totales cuadran', () => {
  const o = ok(run('prestamo', 'payment', { amount: '100000', rate: '12', term: '12', termUnit: 'months' }));
  assert.equal(o.headline.label, 'Cuota mensual');
  assert.equal(o.headline.value, 'RD$ 8,884.88');
  const total = Number(item(o, 'Total a pagar')?.value.replace(/[^\d.]/g, ''));
  const interest = Number(item(o, 'Intereses totales')?.value.replace(/[^\d.]/g, ''));
  assert.ok(Math.abs(total - 106_618.56) < 0.2);
  assert.ok(Math.abs(total - interest - 100_000) < 0.005, 'total = capital + intereses');
  assert.equal(item(o, 'Duración')?.value, '1 año');
});

test('préstamo: monto financiado y duración con una cuota dada', () => {
  const principal = ok(run('prestamo', 'principal', { payment: '8884.88', rate: '12', term: '12', termUnit: 'months' }));
  assert.equal(principal.headline.label, 'Monto que puedes financiar');
  assert.ok(Math.abs(Number(principal.headline.value.replace(/[^\d.]/g, '')) - 100_000) < 1);
  const term = ok(run('prestamo', 'term', { amount: '100000', payment: '2000', rate: '12' }));
  assert.equal(term.headline.label, 'Duración');
  assert.equal(term.headline.value, '5 años y 10 meses');
});

test('préstamo: una cuota que no cubre los intereses se explica con el número', () => {
  const low = run('prestamo', 'term', { amount: '100000', payment: '900', rate: '12' });
  assert.ok(low.status === 'error' && /ni para los intereses del primer mes \(RD\$ 1,000\.00\)/.test(low.errors.form));
  const long = run('prestamo', 'term', { amount: '100000', payment: '1001', rate: '12' });
  assert.ok(long.status === 'error' && /más de 50 años/.test(long.errors.form));
});

test('amortización: tabla completa con totales, y el abono extra ahorra tiempo e intereses', () => {
  const base = ok(run('amortizacion', undefined, { amount: '100000', rate: '12', term: '12', termUnit: 'months' }));
  assert.equal(base.table?.rows.length, 12);
  assert.deepEqual(base.table?.headers, ['N.º', 'Cuota', 'Interés', 'Capital', 'Saldo']);
  assert.equal(base.table?.totals?.[0], 'Total');
  assert.deepEqual(base.table?.rows[0], [{ int: 1 }, { money: 888_488 }, { money: 100_000 }, { money: 788_488 }, { money: 9_211_512 }]);
  assert.equal(item(base, 'Intereses que te ahorras'), undefined, 'sin abono extra no hay ahorro que mostrar');

  const extra = ok(run('amortizacion', undefined, { amount: '300000', rate: '15', term: '3', extra: '5000' }));
  assert.deepEqual(extra.table?.headers, ['N.º', 'Cuota', 'Abono extra', 'Interés', 'Capital', 'Saldo']);
  assert.ok((extra.table?.rows.length ?? 99) < 36);
  assert.ok(Number(item(extra, 'Intereses que te ahorras')?.value.replace(/[^\d.]/g, '')) > 0);
  assert.match(extra.sentence, /Pagando RD\$ 5,000 extra cada mes, terminas en/);
});

test('amortización: con tasa y plazo extremos explica por qué no hay tabla', () => {
  const r = run('amortizacion', undefined, { amount: '1000', rate: '120', term: '50', termUnit: 'years' });
  assert.ok(r.status === 'error' && /plazo más corto/.test(r.errors.form));
});

// ------------------------------------------------------------------ inflación, valor futuro, valor presente

test('inflación: pérdida de poder adquisitivo y rendimiento real', () => {
  const o = ok(run('inflacion', undefined, { amount: '10000', inflation: '5', time: '10', savings: '3' }));
  assert.equal(o.headline.value, '38.61%');
  assert.equal(item(o, 'Lo que hoy cuesta RD$ 10,000 costará')?.value, 'RD$ 16,288.95');
  assert.equal(item(o, 'RD$ 10,000 de entonces comprarán lo que hoy compran')?.value, 'RD$ 6,139.13');
  const real = item(o, 'Rendimiento real de tu ahorro');
  assert.equal(real?.value, '-1.9%');
  assert.match(real?.note ?? '', /pierde poder de compra/);
  assert.equal(item(ok(run('inflacion', undefined, { amount: '10000', inflation: '5', time: '10' })), 'Rendimiento real de tu ahorro'), undefined);
});

test('valor futuro: ¿cuánto tendré?, ¿cuánto aportar? y ¿cuánto tardo?', () => {
  const value = ok(run('valor-futuro', 'value', { present: '0', payment: '1000', rate: '12', time: '12', timeUnit: 'months' }));
  assert.equal(value.headline.value, 'RD$ 12,682.50');
  assert.equal(item(value, 'Intereses generados')?.value, 'RD$ 682.50');

  const need = ok(run('valor-futuro', 'payment', { target: '12682.50', rate: '12', time: '12', timeUnit: 'months' }));
  assert.equal(need.headline.value, 'RD$ 1,000.00');
  const already = ok(run('valor-futuro', 'payment', { target: '1000', present: '5000', rate: '5', time: '2' }));
  assert.equal(already.headline.value, 'RD$ 0.00');
  assert.match(already.sentence, /sin aportar más/);

  const time = ok(run('valor-futuro', 'time', { target: '12000', payment: '1000', rate: '0' }));
  assert.equal(time.headline.value, '1 año');
  const never = run('valor-futuro', 'time', { target: '12000', present: '0', payment: '', rate: '0' });
  assert.equal(never.status, 'error');
  const nowhere = run('valor-futuro', 'time', { target: '900000000', present: '1', payment: '1', rate: '0' });
  assert.ok(nowhere.status === 'error' && /no llegarías a la meta/.test(nowhere.errors.form));
});

test('valor presente: un pago, pagos mensuales y varios años', () => {
  const lump = ok(run('valor-presente', 'lump', { future: '10000', rate: '10', time: '3' }));
  assert.equal(lump.headline.value, 'RD$ 7,513.15');
  const periodic = ok(run('valor-presente', 'periodic', { payment: '1000', rate: '12', time: '12', timeUnit: 'months' }));
  assert.equal(periodic.headline.value, 'RD$ 11,255.08');
  const flows = ok(run('valor-presente', 'flows', { rate: '10', y1: '1000', y2: '1000', y3: '1000' }));
  assert.equal(flows.headline.value, 'RD$ 2,486.85');
  assert.equal(flows.table?.rows.length, 3, 'solo los años con dinero');
  const none = run('valor-presente', 'flows', { rate: '10', y1: '0', y2: '' });
  assert.ok(none.status === 'error' && /al menos un año/.test(none.errors.form));
});

// ------------------------------------------------------------------ ROI e independencia financiera

test('ROI: ganancia, rendimiento anual, real y riesgo en el peor caso', () => {
  const o = ok(run('roi', undefined, { invested: '100000', final: '140000', costs: '2000', time: '3', inflation: '5', worst: '70000' }));
  assert.equal(o.headline.value, '38%');
  assert.equal(item(o, 'Ganancia neta')?.value, 'RD$ 38,000.00');
  assert.equal(item(o, 'Rendimiento por año')?.value, '11.33%');
  assert.ok(item(o, 'Rendimiento real por año'));
  assert.equal(item(o, 'ROI si te va mal')?.value, '-32%');
  assert.equal(item(o, 'Lo máximo que perderías en ese caso')?.value, 'RD$ 32,000.00');
  assert.equal(item(o, 'Relación ganancia / pérdida')?.value, '1.19 a 1');
  assert.ok(o.notes.some((n) => /no lo que arriesgaste|no cuánto arriesgaste/.test(n)), 'avisa que el ROI no mide riesgo');
});

test('ROI: una pérdida se llama pérdida; sin tiempo no hay rendimiento por año', () => {
  const o = ok(run('roi', undefined, { invested: '10000', final: '8000' }));
  assert.equal(o.headline.value, '-20%');
  assert.equal(item(o, 'Pérdida neta')?.value, '-RD$ 2,000.00');
  assert.equal(item(o, 'Rendimiento por año'), undefined);
  assert.match(o.sentence, /te hace perder RD\$ 2,000/);
  const noTime = ok(run('roi', undefined, { invested: '10000', final: '12000', inflation: '4' }));
  assert.ok(noTime.notes.some((n) => /indica el tiempo/.test(n)));
});

test('independencia financiera: capital objetivo, tiempo y aporte para un plazo', () => {
  const o = ok(run('independencia', undefined, { expense: '50000', current: '3000000', contribution: '100000', return: '5', years: '10' }));
  assert.equal(o.headline.value, 'RD$ 15,000,000.00');
  assert.equal(item(o, 'Lo que te falta')?.value, 'RD$ 12,000,000.00');
  assert.equal(item(o, 'Con tu aporte actual llegarías en')?.value, '7 años y 5 meses');
  assert.ok(item(o, 'Aporte mensual para lograrlo en 10 años'));
  assert.ok(o.notes.some((n) => /no es asesoría financiera/.test(n)));
  assert.deepEqual(Object.fromEntries(Object.entries(defaultValues(calculatorById('independencia') ?? CALCULATORS[0], '')).filter(([k]) => ['withdrawal', 'return'].includes(k))), { withdrawal: '4', return: '5' });
});

test('independencia financiera: ya lo tienes / no llegas con ese aporte', () => {
  const done = ok(run('independencia', undefined, { expense: '10000', current: '4000000', return: '0' }));
  assert.equal(item(done, 'Lo que te falta')?.value, 'Nada: ya lo tienes');
  assert.equal(item(done, 'Con tu aporte actual llegarías en')?.value, 'Ya llegaste');
  const stuck = ok(run('independencia', undefined, { expense: '10000', current: '1000', contribution: '', return: '0' }));
  assert.equal(item(stuck, 'Con tu aporte actual llegarías en')?.value, 'No llegarías con este aporte');
  assert.equal(run('independencia', undefined, { expense: '10000', withdrawal: '25', return: '0' }).status, 'error', 'retiro anual máximo 20 %');
});

// ------------------------------------------------------------------ sugerencias con datos reales

test('sugerencias: el gasto promedio real del usuario, si existe', () => {
  /** @type {import('../src/domain/types.js').AppData} */
  const data = {
    categories: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], settings: defaultSettings(),
    movements: [
      { id: 'a', type: 'expense', amountCents: 20_000_00, date: '2026-06-10', time: '10:00', description: 'x', classification: 'variable', categoryId: 'c', createdAt: '', updatedAt: '' },
      { id: 'b', type: 'expense', amountCents: 30_000_00, date: '2026-07-10', time: '10:00', description: 'x', classification: 'variable', categoryId: 'c', createdAt: '', updatedAt: '' },
    ],
  };
  const s = suggestions(data, '2026-07-20');
  assert.equal(s.independencia?.expense.value, '25000.00');
  assert.match(s.independencia?.expense.label ?? '', /RD\$ 25,000/);
  assert.deepEqual(suggestions({ ...data, movements: [] }, '2026-07-20'), {});
});

test('computeCalculator: calculadora desconocida y modo desconocido', () => {
  const r = computeCalculator('no-existe', undefined, {});
  assert.ok(r.status === 'error' && r.errors.form);
  const mode = computeCalculator('prestamo', 'xxx', { amount: '100000', rate: '12', term: '12', termUnit: 'months' });
  assert.equal(mode.status, 'ok', 'un modo desconocido usa el primero');
  assert.equal(resolveMode(calculatorById('prestamo') ?? CALCULATORS[0], '__proto__'), 'payment');
});
