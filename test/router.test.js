import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ROUTE, ROUTES, routeById, routeFromHash, routeParams } from '../src/app/router.js';

test('routeFromHash reconoce cada pantalla', () => {
  for (const route of ROUTES) {
    assert.equal(routeFromHash(`#/${route.id}`), route.id);
  }
});

test('routeFromHash vuelve a Inicio con rutas vacías o desconocidas', () => {
  assert.equal(routeFromHash(''), DEFAULT_ROUTE);
  assert.equal(routeFromHash('#'), DEFAULT_ROUTE);
  assert.equal(routeFromHash('#/'), DEFAULT_ROUTE);
  assert.equal(routeFromHash('#/no-existe'), DEFAULT_ROUTE);
  assert.equal(routeFromHash('#/__proto__'), DEFAULT_ROUTE);
});

test('routeFromHash ignora parámetros y subrutas', () => {
  assert.equal(routeFromHash('#/metas?x=1'), 'metas');
  assert.equal(routeFromHash('#/finanzas/algo'), 'finanzas');
});

test('routeById devuelve Inicio si no existe', () => {
  assert.equal(routeById('zzz').id, DEFAULT_ROUTE);
});

test('las cinco pantallas del documento maestro están en el menú principal', () => {
  const main = ROUTES.filter((r) => !r.secondary && !r.hidden).map((r) => r.label);
  assert.deepEqual(main, ['Inicio', 'Finanzas', 'Metas', 'Estadísticas', 'IA Financiera']);
});

test('Deudas es una subpantalla de Finanzas: existe pero no tiene botón propio en el menú', () => {
  const route = routeById('deudas');
  assert.equal(route.id, 'deudas');
  assert.equal(route.hidden, true);
  assert.equal(route.parent, 'finanzas');
  assert.equal(routeFromHash('#/deudas/abc-123'), 'deudas');
});

test('Resultados, Salud, Clientes e Inventario son pestañas de Finanzas: existen pero no tienen botón propio', () => {
  for (const id of ['resultados', 'salud', 'clientes', 'inventario']) {
    const route = routeById(id);
    assert.equal(route.id, id);
    assert.equal(route.hidden, true);
    assert.equal(route.parent, 'finanzas');
    assert.equal(routeFromHash(`#/${id}`), id);
  }
});

test('Logros es una pantalla de Inicio: existe pero no tiene botón propio en el menú', () => {
  const route = routeById('logros');
  assert.equal(route.id, 'logros');
  assert.equal(route.hidden, true);
  assert.equal(route.parent, 'inicio');
  assert.equal(routeFromHash('#/logros'), 'logros');
});

test('Diagnóstico es una pantalla de Estadísticas: existe pero no tiene botón propio en el menú', () => {
  const route = routeById('diagnostico');
  assert.equal(route.id, 'diagnostico');
  assert.equal(route.hidden, true);
  assert.equal(route.parent, 'estadisticas');
  assert.equal(routeFromHash('#/diagnostico'), 'diagnostico');
});

test('la ficha de un producto se abre en #/inventario/<id>', () => {
  assert.equal(routeFromHash('#/inventario/abc-123'), 'inventario');
  assert.deepEqual(routeParams('#/inventario/abc-123'), ['abc-123']);
  assert.deepEqual(routeParams('#/inventario'), []);
});

test('routeParams devuelve lo que viene después de la pantalla', () => {
  assert.deepEqual(routeParams('#/deudas'), []);
  assert.deepEqual(routeParams('#/deudas/'), []);
  assert.deepEqual(routeParams('#/deudas/abc-123'), ['abc-123']);
  assert.deepEqual(routeParams('#/deudas/abc?x=1'), ['abc']);
  assert.deepEqual(routeParams('#/deudas/a%20b'), ['a b']);
  assert.deepEqual(routeParams('#/deudas/%E0%A4%A'), ['%E0%A4%A'], 'una dirección mal escrita no rompe la app');
  assert.deepEqual(routeParams(''), []);
});
