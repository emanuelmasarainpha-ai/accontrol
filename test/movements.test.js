import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories, validateCategoryName } from '../src/domain/categories.js';
import { applyMovementEdit, buildMovement, compareNewestFirst, validateMovement } from '../src/domain/movements.js';

const categories = defaultCategories();
const today = '2026-07-10';

/** Entrada válida base; cada prueba cambia solo lo que necesita. */
const base = () => ({
  type: 'expense', amountText: '800', date: '2026-07-06', time: '14:30',
  description: 'Protector solar', classification: 'variable', categoryId: 'cat-exp-salud',
});

/** @param {any} input */
const run = (input) => validateMovement(input, { categories, today });

test('un movimiento válido se acepta y se limpia', () => {
  const r = run({ ...base(), description: '  Protector   solar ' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.amountCents, 80000);
  assert.equal(r.value.description, 'Protector solar');
  assert.equal(r.value.categoryId, 'cat-exp-salud');
});

test('campos obligatorios del documento §4.1/§4.2', () => {
  const r = run({ ...base(), amountText: '', date: '', time: '', description: '  ', categoryId: '' });
  assert.ok(!r.ok);
  if (r.ok) return;
  for (const field of ['amount', 'date', 'time', 'description', 'category']) {
    assert.ok(r.errors[field], `falta el error de ${field}`);
  }
});

test('el monto debe ser mayor que cero y razonable', () => {
  assert.ok(!run({ ...base(), amountText: '0' }).ok);
  assert.ok(!run({ ...base(), amountText: '1.500' }).ok);
  assert.ok(!run({ ...base(), amountText: '1000000000' }).ok); // más de RD$ 999,999,999.99
  assert.ok(run({ ...base(), amountText: '999999999.99' }).ok);
});

test('no se permiten fechas futuras ni imposibles; hoy sí', () => {
  assert.ok(!run({ ...base(), date: '2026-07-11' }).ok);
  assert.ok(!run({ ...base(), date: '2026-02-30' }).ok);
  assert.ok(run({ ...base(), date: '2026-07-10' }).ok);
});

test('la clasificación debe corresponder al tipo', () => {
  assert.ok(!run({ ...base(), classification: 'extraordinary' }).ok); // un gasto no es extraordinario
  assert.ok(run({ ...base(), classification: 'discretionary' }).ok);
  const income = { ...base(), type: 'income', categoryId: 'cat-inc-salario', classification: 'fixed' };
  assert.ok(run(income).ok);
  assert.ok(!run({ ...income, classification: 'discretionary' }).ok); // un ingreso no es discrecional
});

test('la categoría debe existir y ser del mismo tipo', () => {
  assert.ok(!run({ ...base(), categoryId: 'no-existe' }).ok);
  assert.ok(!run({ ...base(), categoryId: 'cat-inc-salario' }).ok); // categoría de ingreso en un gasto
});

test('categoría nueva: nombre válido y sin duplicados', () => {
  const r = run({ ...base(), categoryId: '', newCategoryName: '  Mascotas ' });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.newCategoryName, 'Mascotas');
  assert.ok(!run({ ...base(), categoryId: '', newCategoryName: 'ropa' }).ok); // ya existe "Ropa"
  assert.ok(!validateCategoryName('x'.repeat(41), 'expense', categories).ok);
  // El mismo nombre en otro tipo sí se permite ("Alquiler" existe en gastos y "Alquiler recibido" en ingresos).
  assert.ok(validateCategoryName('Alquiler', 'income', categories).ok);
});

test('la descripción tiene límite', () => {
  assert.ok(!run({ ...base(), description: 'x'.repeat(81) }).ok);
  assert.ok(run({ ...base(), description: 'x'.repeat(80) }).ok);
});

test('buildMovement y applyMovementEdit', () => {
  const v = run(base());
  assert.ok(v.ok);
  if (!v.ok) return;
  const created = buildMovement(v.value, { id: 'id-1', categoryId: 'cat-exp-salud', nowISO: '2026-07-10T10:00:00.000Z' });
  assert.equal(created.id, 'id-1');
  assert.equal(created.createdAt, created.updatedAt);

  const v2 = run({ ...base(), amountText: '950' });
  assert.ok(v2.ok);
  if (!v2.ok) return;
  const edited = applyMovementEdit({ ...created, isDemo: true }, v2.value, { categoryId: 'cat-exp-salud', nowISO: '2026-07-11T10:00:00.000Z' });
  assert.equal(edited.id, 'id-1');
  assert.equal(edited.amountCents, 95000);
  assert.equal(edited.createdAt, '2026-07-10T10:00:00.000Z'); // la creación no cambia
  assert.equal(edited.updatedAt, '2026-07-11T10:00:00.000Z');
  assert.equal(edited.isDemo, true);
});

test('compareNewestFirst ordena por fecha, luego hora, luego creación', () => {
  const rows = [
    { date: '2026-07-05', time: '09:00', createdAt: 'a' },
    { date: '2026-07-06', time: '08:00', createdAt: 'b' },
    { date: '2026-07-06', time: '20:00', createdAt: 'c' },
    { date: '2026-07-06', time: '20:00', createdAt: 'd' },
  ];
  assert.deepEqual(rows.sort(compareNewestFirst).map((r) => r.createdAt), ['d', 'c', 'b', 'a']);
});
