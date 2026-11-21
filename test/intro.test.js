import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { INTRO_KEY, INTRO_TIMES, mixColor } from '../src/ui/intro.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('intro del logo al abrir la app', () => {
  it('theme-boot.js decide con la misma clave y respeta «reducir movimiento»', () => {
    const boot = read('src/theme-boot.js');
    assert.ok(boot.includes(`'${INTRO_KEY}'`), 'la clave de sessionStorage debe coincidir');
    assert.match(boot, /prefers-reduced-motion: reduce/);
    assert.match(boot, /classList\.add\('has-intro'\)/);
  });

  it('index.html trae el contenedor de la intro, sin estilos ni código en línea', () => {
    const page = read('index.html');
    assert.match(page, /<div class="intro" id="intro" aria-hidden="true"><\/div>/);
    assert.doesNotMatch(page, /<div class="intro"[^>]*style=/);
  });

  it('sin la clase has-intro la intro no se ve (si falla el JavaScript, la app no queda tapada)', () => {
    const css = read('src/styles/views.css');
    assert.match(css, /\.intro \{\s*display: none;\s*\}/);
    assert.match(css, /\.has-intro \.intro \{/);
  });

  it('la intro dura menos de 4 segundos y la salida va después de formarse el logo', () => {
    assert.ok(INTRO_TIMES.end <= 4000);
    assert.ok(INTRO_TIMES.exit[0] > INTRO_TIMES.word[1]);
    assert.ok(INTRO_TIMES.zoom[1] <= INTRO_TIMES.end);
  });

  it('la intro no escribe HTML (solo crea elementos) y saca las formas del ícono real', () => {
    const code = read('src/ui/intro.js');
    assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML/);
    assert.match(code, /icons\/icon\.svg/);
  });

  it('mixColor mezcla dos colores y tolera un color que no entiende', () => {
    assert.equal(mixColor('#000000', '#ffffff', 0), 'rgb(0,0,0)');
    assert.equal(mixColor('#000000', '#ffffff', 1), 'rgb(255,255,255)');
    assert.equal(mixColor('#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
    assert.equal(mixColor('#c9b3f0', 'rgb(1,2,3)', 1), 'rgb(201,179,240)');
  });
});
