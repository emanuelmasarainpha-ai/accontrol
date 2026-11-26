// 0.20.9 — El momento de fiesta al cumplir una meta o ganar un logro (src/ui/celebrate.js → celebrateMoment).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confettiPieces, partyMarkup, PARTY_MS } from '../src/ui/celebrate.js';

describe('momento de fiesta', () => {
  it('meta: trofeo y «¡Meta cumplida!»; logro: medalla y «¡Logro conseguido!»', () => {
    const goal = String(partyMarkup({ kind: 'goal', title: 'Viaje' }));
    assert.match(goal, /¡Meta cumplida!/);
    assert.match(goal, /party-clip-cup/);
    const badge = String(partyMarkup({ kind: 'achievement', title: 'Racha' }));
    assert.match(badge, /¡Logro conseguido!/);
    assert.match(badge, /party-clip-medal/);
  });
  it('el nombre que escribió la persona va escapado (no se puede colar código)', () => {
    const out = String(partyMarkup({ kind: 'goal', title: '<img src=x onerror=alert(1)>' }));
    assert.doesNotMatch(out, /<img/);
    assert.match(out, /&lt;img/);
  });
  it('el confeti cubre todo el ancho, cae entre 1.5 y 2.6 s y empieza escalonado', () => {
    let seed = 0.37;
    const random = () => (seed = (seed * 9301 + 49297) % 233280 / 233280);
    const pieces = confettiPieces(40, random);
    assert.equal(pieces.length, 40);
    assert.ok(Math.min(...pieces.map((p) => p.x)) <= 5 && Math.max(...pieces.map((p) => p.x)) >= 95);
    for (const p of pieces) {
      assert.ok(p.fall >= 1500 && p.fall <= 2600, `cae en ${p.fall} ms`);
      assert.ok(p.delay >= 0 && p.delay <= 500);
    }
  });
  it('se va sola en unos segundos y es decorativa; lo que se anuncia sigue siendo el aviso', () => {
    assert.ok(PARTY_MS >= 2000 && PARTY_MS <= 4000);
    const code = readFileSync(new URL('../src/ui/celebrate.js', import.meta.url), 'utf8');
    assert.match(code, /host\.setAttribute\('aria-hidden', 'true'\)/);
    assert.match(code, /if \(prefersReducedMotion\(\)\) return false;\n  document\.querySelector\('\.party'\)/);
    const watcher = readFileSync(new URL('../src/app/celebrations.js', import.meta.url), 'utf8');
    assert.match(watcher, /celebrateMoment\(/);
    assert.match(watcher, /toast\(message\)/);
  });
});
