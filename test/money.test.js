// Pruebas del dinero: leer lo que escribe el usuario y mostrarlo.
// Ejecutar con: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centsToInputValue, formatCompact, formatMoney, formatPercent, MAX_CENTS, moneyParts, parseMoney,
} from '../src/domain/money.js';

/** @param {string} text */
const cents = (text) => {
  const r = parseMoney(text);
  assert.ok(r.ok, `"${text}" debería ser válido: ${r.ok ? '' : r.error}`);
  return r.ok ? r.cents : NaN;
};

test('parseMoney: formatos válidos', () => {
  assert.equal(cents('1500'), 150000);
  assert.equal(cents('1500.5'), 150050);
  assert.equal(cents('1500.50'), 150050);
  assert.equal(cents('1500,50'), 150050); // coma decimal (teclado en español)
  assert.equal(cents('12,5'), 1250);
  assert.equal(cents('1,500'), 150000); // coma de miles
  assert.equal(cents('1,500.50'), 150050);
  assert.equal(cents('1,500,000'), 150000000);
  assert.equal(cents('0.99'), 99);
  assert.equal(cents('0'), 0);
  assert.equal(cents('  RD$ 2,000  '), 200000);
  assert.equal(cents('007'), 700);
});

test('parseMoney: nunca produce errores de decimales', () => {
  // 0.1 + 0.2 en punto flotante da 0.30000000000000004; en centavos enteros es exacto.
  assert.equal(cents('0.1') + cents('0.2'), cents('0.3'));
  assert.equal(cents('19.99') * 3, 5997);
  assert.ok(Number.isInteger(cents('1234567.89')));
});

test('parseMoney: rechaza lo ambiguo en lugar de adivinar', () => {
  for (const bad of ['1.500', '1.500.000', '1,5000', '1,50,0', '12.345', '1..5', ',5', '.5', '1.', '']) {
    assert.equal(parseMoney(bad).ok, false, `"${bad}" debería rechazarse`);
  }
});

test('parseMoney: rechaza texto, negativos y montos absurdos', () => {
  for (const bad of ['abc', '12a', '-5', '1e3', '1 2 x', '12345678901']) {
    assert.equal(parseMoney(bad).ok, false, `"${bad}" debería rechazarse`);
  }
  const negative = parseMoney('-5');
  assert.ok(!negative.ok && /negativo/.test(negative.error));
});

test('formatMoney', () => {
  assert.equal(formatMoney(150050), 'RD$ 1,500.50');
  assert.equal(formatMoney(0), 'RD$ 0.00');
  assert.equal(formatMoney(5), 'RD$ 0.05');
  assert.equal(formatMoney(-150050), '-RD$ 1,500.50');
  assert.equal(formatMoney(123456789012), 'RD$ 1,234,567,890.12');
  // Sin centavos se redondea al peso más cercano (antes se truncaba).
  assert.equal(formatMoney(150050, { decimals: false }), 'RD$ 1,501');
  assert.equal(formatMoney(150049, { decimals: false }), 'RD$ 1,500');
  assert.equal(formatMoney(99999, { decimals: false }), 'RD$ 1,000');
  assert.equal(formatMoney(-10, { decimals: false }), 'RD$ 0');
  assert.equal(formatMoney(150050, { sign: true }), '+RD$ 1,500.50');
  assert.equal(formatMoney(-150050, { sign: true }), '-RD$ 1,500.50');
});

test('moneyParts y centsToInputValue', () => {
  assert.deepEqual(moneyParts(-123456), { negative: true, symbol: 'RD$', whole: '1,234', fraction: '56' });
  assert.equal(centsToInputValue(150050), '1500.50');
  assert.equal(centsToInputValue(100), '1.00');
  // Ida y vuelta: lo que se muestra en el campo se puede volver a leer igual.
  assert.equal(cents(centsToInputValue(987654321)), 987654321);
});

test('formatCompact (ejes de gráficos)', () => {
  assert.equal(formatCompact(0), '0');
  assert.equal(formatCompact(85000), '850');
  assert.equal(formatCompact(500000), '5 mil');
  assert.equal(formatCompact(1250000), '12.5 mil');
  assert.equal(formatCompact(120000000), '1.2 M');
  assert.equal(formatCompact(-500000), '-5 mil');
});

test('formatPercent', () => {
  assert.equal(formatPercent(34), '34%');
  assert.equal(formatPercent(12.54), '12.5%');
  assert.equal(formatPercent(0), '0%');
});

test('MAX_CENTS es un entero seguro', () => {
  assert.ok(Number.isSafeInteger(MAX_CENTS * 1000));
});

test('parseMoney rechaza formas engañosas (revisión independiente)', () => {
  // Un primer grupo con ceros a la izquierda NO es un separador de miles válido.
  for (const bad of ['000,500', '0,500', '00,500', '01,500', '1 5 0 0', '1 500', '1,5000', '1,,500', ',500', '1,500,', '1.500,00']) {
    assert.equal(parseMoney(bad).ok, false, `"${bad}" debería rechazarse`);
  }
  // Lo que sí se acepta (incluido pegar lo que muestra la propia app).
  assert.deepEqual(parseMoney('RD$ 1,500.50'), { ok: true, cents: 150050 });
  assert.deepEqual(parseMoney('  $ 25,000 '), { ok: true, cents: 2500000 });
  assert.deepEqual(parseMoney('0,5'), { ok: true, cents: 50 });
  assert.deepEqual(parseMoney('999,999,999.99'), { ok: true, cents: 99_999_999_999 });
});

test('parseMoney nunca devuelve más que MAX_CENTS', () => {
  for (const big of ['1,000,000,000', '9999999999', '1000000000.00', '9,999,999,999.99']) {
    assert.equal(parseMoney(big).ok, false, `"${big}" debería rechazarse`);
  }
});

test('ida y vuelta: centsToInputValue -> parseMoney devuelve los mismos centavos', () => {
  const samples = [0, 1, 9, 10, 99, 100, 101, 999, 1000, 150050, 123456789, 99_999_999_999];
  for (let i = 0; i < 5000; i += 1) samples.push(Math.floor(Math.random() * 99_999_999_999));
  for (const c of samples) {
    if (c === 0) continue; // parseMoney('0.00') es válido como lectura; la validación de cada pantalla exige > 0
    const back = parseMoney(centsToInputValue(c));
    assert.deepEqual(back, { ok: true, cents: c }, `falló con ${c}`);
  }
});

test('formatCompact no muestra "-0" ni "1000 mil"', () => {
  assert.equal(formatCompact(-10), '0');
  assert.equal(formatCompact(99950), '1 mil');
  assert.equal(formatCompact(99_995_000), '1 M');
  assert.equal(formatCompact(-500000), '-5 mil');
});

test('formatPercent no redondea a 100% antes de llegar', () => {
  assert.equal(formatPercent(99.96), '99.9%');
  assert.equal(formatPercent(100), '100%');
  assert.equal(formatPercent(49.25), '49.3%');
  assert.equal(formatPercent(25), '25%');
});
