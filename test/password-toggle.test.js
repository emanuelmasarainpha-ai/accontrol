// 0.14.6 — El ojo para mostrar u ocultar la contraseña: accesible, en todos los campos y solo con transform/opacity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { eyeToggle } from '../src/ui/passwordToggle.js';
import { passwordForm } from '../src/views/account.js';

const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('el ojo de la contraseña', () => {
  it('es un botón con nombre y estado: empieza oculto (ojo cerrado) y dice «Mostrar …»', () => {
    const out = eyeToggle('pw', 'contraseña').toString();
    assert.match(out, /^<button type="button" class="eye-toggle" data-password-toggle="pw" aria-pressed="false" aria-label="Mostrar contraseña"/);
    assert.match(out, /<svg class="eye"[^>]*aria-hidden="true"/);
    for (const part of ['eye__open', 'eye__closed', 'eye__trail']) assert.match(out, new RegExp(`class="${part}"`));
  });

  it('Cambiar contraseña también tiene un ojo por cada campo', () => {
    const out = passwordForm().toString();
    const fields = out.match(/type="password"/g)?.length ?? 0;
    assert.equal(fields, 3);
    assert.equal(out.match(/data-password-toggle=/g)?.length, fields);
  });

  it('oculta = ojo cerrado, visible = ojo abierto', () => {
    const flat = css.replace(/\s+/g, ' ');
    assert.ok(flat.includes(".eye__open { opacity: 0; transform: scaleY(0.2); }"));
    assert.ok(flat.includes(".eye-toggle[aria-pressed='true'] .eye__open { opacity: 1; transform: none; }"));
  });

  it('la estela de desenfoque tiene el desenfoque FIJO y solo anima transform y opacity, dentro de «sin reducir movimiento»', () => {
    const flat = css.replace(/\s+/g, ' ');
    assert.ok(flat.includes('.eye__trail { opacity: 0; filter: blur(2.2px); }'), 'desenfoque fijo');
    const frames = flat.match(/@keyframes eye-trail \{(.*?)\} \} /)?.[1] ?? '';
    assert.ok(frames.length > 0);
    assert.doesNotMatch(frames, /filter|blur/, 'el desenfoque no se anima');
    const block = flat.slice(flat.indexOf('.eye-toggle.is-moving .eye__trail'));
    assert.match(block, /^\.eye-toggle\.is-moving \.eye__trail \{ animation: eye-trail 280ms/);
  });

  it('el botón mide al menos 44 px', () => {
    const rule = css.match(/\.eye-toggle \{([^}]*)\}/)?.[1] ?? '';
    assert.match(rule, /min-width: var\(--tap\)/);
    assert.match(rule, /min-height: var\(--tap\)/);
  });
});
