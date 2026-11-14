import test from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, rightRoundedBar, segmentLayout, topRoundedBar, truncate } from '../src/ui/chart-math.js';

test('niceTicks: marcas redondas que cubren los datos e incluyen el cero', () => {
  assert.deepEqual(niceTicks(0, 56000).ticks, [0, 20000, 40000, 60000]);
  assert.deepEqual(niceTicks(0, 100).ticks, [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(0, 0).ticks, [0, 0.25, 0.5, 0.75, 1]);
  const withNegatives = niceTicks(-3000, 12000);
  assert.ok(withNegatives.min <= -3000 && withNegatives.max >= 12000);
  assert.ok(withNegatives.ticks.includes(0));
});

test('niceTicks: nunca deja datos fuera del eje', () => {
  for (const max of [1, 7, 99, 1234, 56789, 1_234_567, 987_654_321]) {
    const t = niceTicks(0, max);
    assert.ok(t.max >= max, `max ${t.max} < ${max}`);
    assert.ok(t.ticks.length >= 2 && t.ticks.length <= 8, `${t.ticks.length} marcas para ${max}`);
    assert.equal(t.min, 0);
  }
});

test('topRoundedBar y rightRoundedBar generan trazos válidos', () => {
  assert.match(topRoundedBar(10, 20, 24, 100, 4), /^M10,120V24Q10,20 14,20H30Q34,20 34,24V120Z$/);
  // Una barra más baja que el radio no se deforma.
  assert.match(topRoundedBar(0, 0, 24, 2, 4), /^M0,2V2Q0,0/);
  assert.match(rightRoundedBar(0, 0, 100, 10, 4), /^M0,0H96Q100,0 100,4V6Q100,10 96,10H0Z$/);
});

test('truncate', () => {
  assert.equal(truncate('Restaurantes', 20), 'Restaurantes');
  assert.equal(truncate('Salud y medicamentos', 10), 'Salud y m…');
  assert.equal(truncate('abc', 1), '');
});

test('segmentLayout: ancho total exacto, huecos fijos y mínimos visibles', () => {
  const layout = segmentLayout([50, 30, 20], 300, 2);
  const used = layout.reduce((s, l) => s + l.width, 0) + 2 * 2;
  assert.ok(Math.abs(used - 300) < 1e-9);
  assert.equal(layout[0].x, 0);
  assert.ok(Math.abs(layout[1].x - (layout[0].width + 2)) < 1e-9);

  // Un segmento diminuto sigue viéndose; el que vale 0 no ocupa espacio.
  const tiny = segmentLayout([1000, 1, 0], 300, 2, 4);
  assert.equal(tiny[1].width, 4);
  assert.equal(tiny[2].width, 0);
  assert.ok(Math.abs(tiny.reduce((s, l) => s + l.width, 0) + 2 - 300) < 1e-9);

  assert.deepEqual(segmentLayout([0, 0], 300, 2), [{ x: 0, width: 0 }, { x: 0, width: 0 }]);
});

test('niceTicks sin cero: el eje se ajusta a los datos', () => {
  const t = niceTicks(1_800_000, 2_000_000, 4, { includeZero: false });
  assert.ok(t.min <= 1_800_000 && t.max >= 2_000_000, 'cubre los datos');
  assert.ok(t.min > 0, 'ya no arranca en cero');
  assert.ok(t.ticks.length >= 3 && t.ticks.length <= 8);
  // Con el cero (por defecto) sigue igual que antes.
  assert.equal(niceTicks(1_800_000, 2_000_000).min, 0);
});

test('niceTicks sin cero: datos planos no rompen el eje', () => {
  const t = niceTicks(500, 500, 4, { includeZero: false });
  assert.ok(t.min < 500 && t.max > 500);
  assert.ok(Number.isFinite(t.step) && t.step > 0);
  const negatives = niceTicks(-300, -100, 4, { includeZero: false });
  assert.ok(negatives.min <= -300 && negatives.max >= -100);
});
