// 0.18.1 — Ajustes por secciones (General, Cuenta, Espacios y equipo, Almacenamiento y copias, Privacidad y seguridad, Acerca de).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SETTINGS_SECTIONS, sectionFromParams, visibleSections } from '../src/app/settingsSections.js';
import { stepsFor } from '../src/app/tourSteps.js';

const ALL_BLOCKS = ['account', 'profile', 'device', 'tour', 'categories', 'workspaces', 'details', 'members', 'cloud', 'backup', 'demo', 'danger', 'accountDanger', 'privacy', 'next'];

describe('Ajustes por secciones', () => {
  it('cada bloque de Ajustes está en una sola sección (no se pierde ni se repite nada)', () => {
    for (const hasAccount of [true, false]) {
      const blocks = visibleSections({ hasAccount }).flatMap((s) => s.blocks);
      const expected = hasAccount ? ALL_BLOCKS : ALL_BLOCKS.filter((b) => b !== 'accountDanger');
      assert.deepEqual([...blocks].sort(), [...expected].sort(), `con cuenta: ${hasAccount}`);
    }
  });
  it('las secciones que pidió la persona: General, Almacenamiento, Privacidad y seguridad…', () => {
    assert.deepEqual(SETTINGS_SECTIONS.map((s) => s.title), ['General', 'Cuenta', 'Espacios y equipo', 'Almacenamiento y copias', 'Privacidad y seguridad', 'Acerca de ACCONTROL']);
  });
  it('sin cuentas no hay sección «Cuenta»; el aviso «funciona sin cuenta» va en General', () => {
    const sections = visibleSections({ hasAccount: false });
    assert.ok(!sections.some((s) => s.id === 'cuenta'));
    assert.equal(sections.find((s) => s.id === 'general')?.blocks[0], 'account');
  });
  it('la dirección elige la sección; sin sección o con una que no existe, la lista', () => {
    assert.equal(sectionFromParams(['almacenamiento'], { hasAccount: true })?.title, 'Almacenamiento y copias');
    assert.equal(sectionFromParams([], { hasAccount: true }), null);
    assert.equal(sectionFromParams(['nada'], { hasAccount: true }), null);
    assert.equal(sectionFromParams(['cuenta'], { hasAccount: false }), null);
  });
  it('el recorrido guiado lleva a la sección donde está lo que señala', () => {
    for (const kind of ['personal', 'freelancer', 'entrepreneur', 'company']) {
      for (const step of stepsFor(kind)) {
        if (step.target.some((t) => 'mark' in t && t.mark === 'settings-backup')) assert.equal(step.route, 'ajustes/almacenamiento');
        if (step.target.some((t) => 'mark' in t && t.mark === 'settings-organization')) assert.equal(step.route, 'ajustes/espacios');
      }
    }
  });
  it('los enlaces que llevaban a Ajustes van directo a su sección', () => {
    assert.match(readFileSync(new URL('../src/views/cloud.js', import.meta.url), 'utf8'), /#\/ajustes\/almacenamiento/);
    assert.match(readFileSync(new URL('../src/views/workspaces.js', import.meta.url), 'utf8'), /href="#\/ajustes\/espacios"/);
    assert.doesNotMatch(readFileSync(new URL('../src/views/home.js', import.meta.url), 'utf8'), /href="#\/ajustes"/);
  });
});
