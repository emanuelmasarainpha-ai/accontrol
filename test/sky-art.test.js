// 0.20.8 — El cielo del saludo de Inicio (src/ui/skyArt.js y dayPhase en src/domain/dates.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayPhase, greetingFor } from '../src/domain/dates.js';
import { SKIES, skyArt } from '../src/ui/skyArt.js';

describe('el cielo del saludo', () => {
  it('mañana de 5 a 11, tarde de 12 a 18 y noche el resto, igual que el saludo', () => {
    const expected = { morning: 'Buenos días', afternoon: 'Buenas tardes', night: 'Buenas noches' };
    for (let hour = 0; hour < 24; hour += 1) assert.equal(greetingFor(hour), expected[dayPhase(hour)], `${hour} h`);
    assert.equal(dayPhase(4), 'night');
    assert.equal(dayPhase(5), 'morning');
    assert.equal(dayPhase(11), 'morning');
    assert.equal(dayPhase(12), 'afternoon');
    assert.equal(dayPhase(18), 'afternoon');
    assert.equal(dayPhase(19), 'night');
  });
  it('cada cielo tiene algo que se mueve, es decorativo y sin estilos en línea', () => {
    for (const phase of /** @type {const} */ (['morning', 'afternoon', 'night'])) {
      assert.match(SKIES[phase], /class="sk-(spin|blink|bob|drift|fly)/, phase);
      assert.doesNotMatch(SKIES[phase], /style=/, phase);
      assert.match(String(skyArt(phase)), new RegExp(`class="sky sky--${phase}" data-sky="${phase}" aria-hidden="true"`));
    }
  });
  it('Inicio pone el cielo de la misma hora que el saludo', () => {
    const home = readFileSync(new URL('../src/views/home.js', import.meta.url), 'utf8');
    assert.match(home, /greetingFor\(hour\)/);
    assert.match(home, /skyArt\(dayPhase\(hour\)\)/);
  });
});
