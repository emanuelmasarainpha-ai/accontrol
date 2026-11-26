// 0.20.6 — Dibujos de las categorías (src/domain/categoryArt.js, src/ui/categoryArt.js) e «Imágenes en movimiento».
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CATEGORIES } from '../src/domain/categories.js';
import { BUSINESS_CATEGORY_SUGGESTIONS } from '../src/domain/business.js';
import { categoryArtKey, foldText } from '../src/domain/categoryArt.js';
import { ART, ART_LABELS, artTile, categoryArt } from '../src/ui/categoryArt.js';
import { ART_MOTION_KEY, artMotionEnabled, setArtMotion } from '../src/ui/artMotion.js';
import { movementRow } from '../src/ui/components.js';

const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

describe('qué dibujo lleva cada categoría', () => {
  it('cada categoría de fábrica tiene el suyo, y no se repiten (salvo «otros»)', () => {
    const keys = DEFAULT_CATEGORIES.map((c) => categoryArtKey(c));
    assert.equal(categoryArtKey(DEFAULT_CATEGORIES.find((c) => c.id === 'cat-exp-alimentacion')), 'food');
    assert.equal(categoryArtKey(DEFAULT_CATEGORIES.find((c) => c.id === 'cat-inc-salario')), 'salary');
    assert.equal(new Set(keys).size, keys.length, 'dos categorías de fábrica con el mismo dibujo');
  });
  it('las categorías del negocio tienen dibujo propio (no el genérico)', () => {
    for (const s of BUSINESS_CATEGORY_SUGGESTIONS) {
      const key = categoryArtKey({ name: s.name, kind: s.kind });
      assert.notEqual(key, s.kind === 'income' ? 'incomeOther' : 'expenseOther', s.name);
    }
    assert.equal(categoryArtKey({ name: 'Comisiones bancarias', kind: 'expense' }), 'bank');
    assert.equal(categoryArtKey({ name: 'Servicios profesionales', kind: 'expense' }), 'professional');
    assert.equal(categoryArtKey({ name: 'Nómina y colaboradores', kind: 'expense' }), 'payroll');
  });
  it('las que crea la persona, por palabras del nombre (sin tildes ni mayúsculas)', () => {
    const cases = [
      ['Comida del colmado', 'food'], ['GASOLINA', 'fuel'], ['Netflix', 'entertainment'], ['Luz', 'electricity'],
      ['Farmacia', 'health'], ['Uber', 'transport'], ['Colegio de los niños', 'education'], ['Veterinario', 'pets'],
      ['Café de la mañana', 'coffee'], ['Recarga celular', 'phone'], ['Vacaciones', 'travel'], ['Nómina', 'salary'],
      ['Préstamo del banco', 'bank'], ['Pedidos Ya', 'restaurant'], ['Fondo de emergencia', 'savings'],
    ];
    for (const [name, key] of cases) assert.equal(categoryArtKey({ name, kind: 'expense' }), key, name);
  });
  it('sin palabras conocidas o sin categoría: moneda (ingreso) o bolsa (gasto)', () => {
    assert.equal(categoryArtKey({ name: 'Cosas varias', kind: 'expense' }), 'expenseOther');
    assert.equal(categoryArtKey({ name: 'Cosas varias', kind: 'income' }), 'incomeOther');
    assert.equal(categoryArtKey(undefined, 'income'), 'incomeOther');
    assert.equal(categoryArtKey(null), 'expenseOther');
  });
  it('quita tildes y espacios de más', () => {
    assert.equal(foldText('  Alimentación   y  Café '), 'alimentacion y cafe');
  });
});

describe('los dibujos', () => {
  it('cada dibujo tiene su nombre, su color en el CSS y algo que se mueve', () => {
    for (const key of Object.keys(ART)) {
      assert.ok(ART_LABELS[/** @type {keyof typeof ART_LABELS} */ (key)], key);
      // Color propio (#hex) o, en los tipos de espacio (0.20.10), el color de ese tipo (var(--personal)…).
      assert.match(css, new RegExp(`\\.ca--${key} \\{ --ca: (#[0-9a-f]{6}|var\\(--[a-z]+\\)); \\}`), `${key} sin color`);
      assert.match(ART[/** @type {keyof typeof ART} */ (key)], /class="ca-(bob|spin|swing|drop|pulse|blink|rise|shine|wiggle|fly)/, `${key} sin movimiento`);
    }
  });
  it('todo dibujo que elige la regla existe', () => {
    const names = ['Salario', 'Comida', 'xyz', 'Impuestos', 'Gimnasio', 'Mascota', 'Ahorro', 'Software', 'Equipos'];
    for (const name of names) for (const kind of ['income', 'expense']) assert.ok(ART[categoryArtKey({ name, kind })], name);
  });
  it('es decorativo (aria-hidden) y sin estilos escritos en el HTML (la política de seguridad no los deja)', () => {
    const out = String(artTile('food'));
    assert.match(out, /class="ca ca--food ca--md" data-art="food" aria-hidden="true"/);
    for (const svg of Object.values(ART)) assert.doesNotMatch(svg, /style=/);
  });
  it('la fila de un movimiento lleva el dibujo de su categoría', () => {
    const m = { id: 'm1', type: 'expense', amountCents: 50000, description: 'Compra', date: '2026-11-25', time: '10:00', classification: 'variable', categoryId: 'cat-exp-alimentacion' };
    const out = String(movementRow(/** @type {any} */ (m), DEFAULT_CATEGORIES.find((c) => c.id === 'cat-exp-alimentacion')));
    assert.match(out, /ca--food/);
    assert.match(String(categoryArt(undefined, 'income')), /ca--incomeOther/);
  });
});

describe('«Imágenes en movimiento»', () => {
  it('encendido por defecto; se apaga y se recuerda', () => {
    const memory = new Map();
    const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
    assert.equal(artMotionEnabled(storage), true);
    assert.equal(setArtMotion(false, storage), true);
    assert.equal(memory.get(ART_MOTION_KEY), 'off');
    assert.equal(artMotionEnabled(storage), false);
    setArtMotion(true, storage);
    assert.equal(artMotionEnabled(storage), true);
  });
  it('apagado, el CSS deja quietos los dibujos', () => {
    assert.match(css, /:root:not\(\[data-art-motion='off'\]\) \.ca \.ca-bob \{ animation:/);
  });
});
