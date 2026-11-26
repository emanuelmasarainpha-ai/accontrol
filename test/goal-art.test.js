// 0.20.10 — Dibujos de las metas y de los tipos de espacio (src/domain/categoryArt.js, src/ui/categoryArt.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goalArtKey, workspaceArtKey } from '../src/domain/categoryArt.js';
import { ART, goalArt, workspaceArt } from '../src/ui/categoryArt.js';

describe('dibujo de cada meta', () => {
  it('por palabras del nombre o la descripción, sin tildes', () => {
    const cases = [
      ['Casa propia', 'rent'], ['Inicial del apartamento', 'rent'], ['Apto en Santiago', 'rent'], ['Carro nuevo', 'car'], ['Yipeta', 'car'],
      ['Viaje a Punta Cana', 'travel'], ['Vacaciones en familia', 'travel'], ['Maestría', 'education'],
      ['Fondo de emergencia', 'emergency'], ['Boda', 'wedding'], ['Casarnos en junio', 'wedding'],
      ['Llegada del bebé', 'baby'], ['Montar mi colmado', 'shop'], ['iPhone nuevo', 'phone'], ['Laptop', 'software'],
      ['Pagar la tarjeta', 'debt'], ['Regalos de Navidad', 'gift'], ['Retiro', 'pension'],
    ];
    for (const [name, key] of cases) assert.equal(goalArtKey({ name }), key, name);
    assert.equal(goalArtKey({ name: 'Ahorrar', description: 'para el carro' }), 'car');
  });
  it('si nada encaja, la alcancía', () => {
    assert.equal(goalArtKey({ name: 'Mi meta' }), 'savings');
    assert.equal(goalArtKey(undefined), 'savings');
  });
  it('todo dibujo que eligen metas y espacios existe y tiene color', () => {
    const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
    for (const key of ['car', 'emergency', 'wedding', 'baby', 'shop', 'wsPersonal', 'wsFreelancer', 'wsEntrepreneur', 'wsCompany']) {
      assert.ok(ART[key], key);
      assert.match(css, new RegExp(`\.ca--${key} \{ --ca: `), key);
    }
    assert.match(String(goalArt({ name: 'Viaje' })), /ca--travel/);
  });
});

describe('dibujo de cada tipo de espacio', () => {
  it('Personal, Freelancer, Emprendedor y Empresa, con el color de su tipo', () => {
    assert.equal(workspaceArtKey('personal'), 'wsPersonal');
    assert.equal(workspaceArtKey('freelancer'), 'wsFreelancer');
    assert.equal(workspaceArtKey('entrepreneur'), 'wsEntrepreneur');
    assert.equal(workspaceArtKey('company'), 'wsCompany');
    assert.match(String(workspaceArt('company', { size: 'lg' })), /ca ca--wsCompany ca--lg/);
  });
  it('la bienvenida y las metas los usan', () => {
    assert.match(readFileSync(new URL('../src/views/onboarding.js', import.meta.url), 'utf8'), /workspaceArt\(kind, \{ size: 'lg' \}\)/);
    assert.match(readFileSync(new URL('../src/views/goals.js', import.meta.url), 'utf8'), /\$\{goalArt\(goal\)\}/);
  });
});
