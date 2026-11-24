// 0.20.4 — Instalar ACCONTROL desde el navegador (src/app/install.js y el panel de Ajustes → General).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installKind, isAppleMobile } from '../src/app/install.js';
import { installPanel } from '../src/views/settings.js';

const base = { native: false, standalone: false, installed: false, hasPrompt: false, ios: false };

describe('qué se ofrece para instalar', () => {
  it('en la app de Android no hay nada que instalar', () => {
    assert.equal(installKind({ ...base, native: true, hasPrompt: true }), 'native');
    assert.equal(String(installPanel('native')), '');
  });
  it('ya instalada (abierta como app o recién instalada): solo lo dice, sin botón', () => {
    assert.equal(installKind({ ...base, standalone: true, hasPrompt: true }), 'installed');
    assert.equal(installKind({ ...base, installed: true }), 'installed');
    const html = String(installPanel('installed'));
    assert.match(html, /ya está instalada/);
    assert.doesNotMatch(html, /data-action="install-app"/);
  });
  it('con el aviso del navegador (Chrome, Edge, Android): botón «Instalar ACCONTROL»', () => {
    assert.equal(installKind({ ...base, hasPrompt: true }), 'prompt');
    assert.match(String(installPanel('prompt')), /data-action="install-app"/);
  });
  it('iPhone y iPad: los pasos de Safari (Compartir → Añadir a pantalla de inicio)', () => {
    assert.equal(installKind({ ...base, ios: true }), 'ios');
    assert.match(String(installPanel('ios')), /Añadir a pantalla de inicio/);
  });
  it('otro navegador sin aviso: los pasos desde el menú', () => {
    assert.equal(installKind(base), 'manual');
    const html = String(installPanel('manual'));
    assert.match(html, /Chrome o Edge/);
    assert.doesNotMatch(html, /data-action="install-app"/);
  });
  it('reconoce iPhone, iPad (aunque diga ser Mac) y deja fuera Mac y Android', () => {
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), true);
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
  });
});
