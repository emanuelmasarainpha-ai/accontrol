// 0.20.7 — Escenas animadas de las pantallas vacías (src/ui/emptyScenes.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SCENES, emptyScene } from '../src/ui/emptyScenes.js';
import { emptyState } from '../src/ui/components.js';

const viewsDir = new URL('../src/views/', import.meta.url);
const usedIcons = new Set();
for (const file of readdirSync(viewsDir)) {
  const text = readFileSync(new URL(file, viewsDir), 'utf8');
  for (const m of text.matchAll(/emptyState\(\{\s*icon:\s*'([a-zA-Z]+)'/g)) usedIcons.add(m[1]);
}

describe('escenas de las pantallas vacías', () => {
  it('cada ícono que usan las pantallas vacías tiene su escena', () => {
    assert.ok(usedIcons.size >= 8, `solo se encontraron ${usedIcons.size} íconos (¿cambió la forma de llamar a emptyState?)`);
    for (const name of usedIcons) assert.ok(SCENES[name], `falta la escena de «${name}»`);
  });
  it('cada escena tiene algo que se mueve y nada de estilos en línea', () => {
    for (const [name, svg] of Object.entries(SCENES)) {
      assert.match(svg, /class="sc-(bob|drop|pulse|blink|rise|swing|wiggle|fly|grow|shine)/, `${name} sin movimiento`);
      assert.doesNotMatch(svg, /style=/, name);
    }
  });
  it('la pantalla vacía usa la escena (decorativa); un ícono sin escena sigue con el medallón', () => {
    const withScene = String(emptyState({ icon: 'target', title: 'Sin metas', text: 'x' }));
    assert.match(withScene, /<span class="scene" data-scene="target" aria-hidden="true">/);
    assert.doesNotMatch(withScene, /empty__rosette/);
    const without = String(emptyState({ icon: 'info', title: 'Nada', text: 'x' }));
    assert.match(without, /empty__glyph/);
    assert.equal(emptyScene('nope'), null);
  });
});
