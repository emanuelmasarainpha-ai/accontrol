// Textos de «Salud financiera»: dicen con palabras lo mismo que dicen los números (escenario de test/company.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories } from '../src/domain/categories.js';
import { companyHealth } from '../src/domain/company.js';
import { baselineText, formatMonths, healthCards, healthSummaryText } from '../src/domain/companyCards.js';

const TODAY = '2026-11-15';
let seq = 0;
const mv = (/** @type {'income'|'expense'} */ type, /** @type {string} */ date, /** @type {number} */ pesos, /** @type {any} */ classification = 'variable') => ({
  id: `m${++seq}`, type, amountCents: pesos * 100, date, time: '10:00', description: 'x', classification,
  categoryId: type === 'income' ? 'cat-inc-ventas' : 'cat-exp-otros', createdAt: '', updatedAt: '',
});
/** @returns {import('../src/domain/types.js').AppData} */
const dataOf = (movements = [], over = {}) => ({
  categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements, goals: [], contributions: [],
  debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], ...over,
});
const loan = {
  id: 'd1', name: 'Préstamo', note: '', totalCents: 1_200_000, rateBp: 0, rateBasis: /** @type {const} */ ('annual'), frequency: /** @type {const} */ ('monthly'),
  collateralKind: /** @type {const} */ ('personal'), collateralType: 'prestamo-personal',
  firstDueDate: '2026-11-25', firstDueTime: '09:00', finalDueDate: '2027-10-25', finalDueTime: '09:00', createdAt: '', updatedAt: '',
};
const healthy = () => [
  mv('income', '2026-08-05', 90000), mv('expense', '2026-08-06', 30000, 'fixed'), mv('expense', '2026-08-07', 20000),
  mv('income', '2026-09-05', 100000), mv('expense', '2026-09-06', 30000, 'fixed'), mv('expense', '2026-09-07', 30000),
  mv('income', '2026-10-05', 110000), mv('expense', '2026-10-06', 30000, 'fixed'), mv('expense', '2026-10-07', 6000, 'discretionary'), mv('expense', '2026-10-08', 40000),
];

test('formatMonths: menos de 1 mes, un decimal y singular', () => {
  assert.equal(formatMonths(0), 'menos de 1 mes');
  assert.equal(formatMonths(0.99), 'menos de 1 mes');
  assert.equal(formatMonths(1), '1.0 mes');
  assert.equal(formatMonths(1.84), '1.8 meses');
  assert.equal(formatMonths(12), '12.0 meses');
});

test('las cinco tarjetas, en orden, con su nivel y sus cifras', () => {
  const h = companyHealth(dataOf(healthy(), { debts: [loan] }), TODAY);
  const cards = healthCards(h);
  assert.deepEqual(cards.map((c) => c.id), ['breakEven', 'runway', 'leverage', 'debtService', 'obligations']);
  assert.deepEqual(cards.map((c) => c.levelLabel), ['Bien', 'Atención', 'Bien', 'Bien', 'Bien']);
  const [be, runway, lev, svc, ob] = cards;
  assert.equal(be.value, 'RD$ 47,142.86 al mes');
  assert.match(be.text, /costos fijos \(RD\$ 32,000\.00 al mes\) y tus cuotas de deuda \(RD\$ 1,000\.00 al mes\)/);
  assert.match(be.text, /ingresos podrían bajar un 52\.9\s?%/);
  assert.equal(runway.value, '1.8 meses');
  assert.match(runway.text, /no sale más de lo que entra/);
  assert.match(lev.text, /Debes RD\$ 12,000\.00 y tienes RD\$ 114,000\.00/);
  assert.match(svc.text, /RD\$ 1,000\.00 al mes: el 1\s?%/);
  assert.equal(ob.value, 'RD$ 1,000.00');
  assert.match(ob.text, /Hay 1 cuota por RD\$ 1,000\.00/);
  assert.match(ob.text, /sobran RD\$ 113,000\.00/);
  assert.equal(healthSummaryText(h), '1 en atención · 4 bien');
  assert.equal(baselineText(h), 'Mes típico: el promedio de tus últimos 3 meses completos con movimientos.');
  for (const c of cards) assert.ok(c.rule.length > 20 && c.text.length > 20, c.id);
});

test('negocio que pierde: los textos lo dicen sin suavizar y dan la diferencia', () => {
  const h = companyHealth(dataOf([
    mv('income', '2026-09-05', 20000), mv('expense', '2026-09-06', 25000, 'fixed'), mv('expense', '2026-09-07', 5000),
    mv('income', '2026-10-05', 20000), mv('expense', '2026-10-06', 25000, 'fixed'), mv('expense', '2026-10-07', 5000),
  ], { settings: { displayName: '', openingBalanceCents: 4_000_000 } }), TODAY);
  const [be, runway] = healthCards(h);
  assert.equal(be.level, 'risk');
  assert.match(be.text, /por debajo: con esos costos, hoy se pierde dinero/);
  assert.match(be.text, /RD\$ 13,333\.33 por debajo/);
  assert.equal(runway.value, 'menos de 1 mes');
  assert.match(runway.text, /sale más de lo que entra \(RD\$ 10,000\.00 de diferencia\)/);
  assert.match(runway.text, /duraría 2\.0 meses/);
  assert.equal(healthSummaryText(h), '2 en riesgo · 3 bien');
});

test('sin margen, sin ingresos y vacío: nada se inventa', () => {
  const noMargin = healthCards(companyHealth(dataOf([mv('income', '2026-10-05', 10000), mv('expense', '2026-10-06', 12000)]), TODAY))[0];
  assert.equal(noMargin.value, 'Sin margen');
  assert.match(noMargin.text, /por mucho que vendas/);
  const noIncome = healthCards(companyHealth(dataOf([mv('expense', '2026-10-06', 12000, 'fixed')]), TODAY))[0];
  assert.equal(noIncome.value, '—');
  assert.match(noIncome.text, /todavía no tiene ingresos/);

  const empty = companyHealth(dataOf(), TODAY);
  const cards = healthCards(empty);
  assert.ok(cards.every((c) => c.level === 'unknown' && c.levelLabel === 'Sin datos'));
  assert.ok(cards.every((c) => /Todavía no hay datos suficientes/.test(c.text)));
  assert.equal(healthSummaryText(empty), 'Todavía no hay datos para evaluar la empresa.');
  assert.equal(baselineText(empty), 'Aún no hay movimientos para calcular un mes típico.');
});

test('sin costos fijos ni cuotas: el equilibrio en cero se explica y se invita a clasificar los gastos que se repiten', () => {
  // Todos los gastos son variables: no hay nada fijo que cubrir, y la tarjeta no inventa un «margen» engañoso.
  const [be] = healthCards(companyHealth(dataOf([mv('income', '2026-10-05', 10000), mv('expense', '2026-10-06', 4000)]), TODAY));
  assert.equal(be.value, 'RD$ 0.00 al mes');
  assert.equal(be.level, 'good');
  assert.match(be.text, /No tienes costos fijos ni cuotas de deuda registrados/);
  assert.match(be.text, /clasifícalos como «Fijo»/);
  assert.doesNotMatch(be.text, /podrían bajar/);
  assert.doesNotMatch(be.text, /necesitas ingresar al menos/);
});

test('mes típico: con uno, dos o tres meses la frase es correcta', () => {
  const oneMonth = companyHealth(dataOf([mv('income', '2026-10-05', 1000), mv('expense', '2026-10-06', 400, 'fixed')]), TODAY);
  assert.equal(baselineText(oneMonth), 'Mes típico: tu último mes completo con movimientos.');
  const twoMonths = companyHealth(dataOf([mv('income', '2026-09-05', 1000), mv('income', '2026-10-05', 1000)]), TODAY);
  assert.equal(baselineText(twoMonths), 'Mes típico: el promedio de tus últimos 2 meses completos con movimientos.');
});

test('mes en curso solamente: el texto avisa que es parcial', () => {
  const h = companyHealth(dataOf([mv('income', '2026-11-02', 20000), mv('expense', '2026-11-03', 5000, 'fixed')]), TODAY);
  assert.match(baselineText(h), /cifras son parciales/);
});

test('cuotas vencidas: la tarjeta de 30 días las nombra y dice cuánto falta', () => {
  const h = companyHealth(dataOf([], { settings: { displayName: '', openingBalanceCents: 150_000 }, debts: [{ ...loan, firstDueDate: '2026-10-25', finalDueDate: '2027-09-25' }] }), TODAY);
  const ob = healthCards(h)[4];
  assert.equal(ob.level, 'risk');
  assert.match(ob.text, /Hay 2 cuotas por RD\$ 2,000\.00 \(RD\$ 1,000\.00 ya vencidas\)/);
  assert.match(ob.text, /no alcanza: faltan RD\$ 500\.00/);
  assert.ok(ob.details.some((d) => d.label === 'Falta para pagarlas' && d.value === 'RD$ 500.00'));
});
