// 0.18.0 — La app de Android se comporta como una app: barra de estado, botón «atrás», ícono y arranque de ACCONTROL.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backAction, installBackButton, statusBarStyle } from '../src/app/nativeShell.js';

/** Ancho y alto de un PNG (leídos de su cabecera). */
function pngSize(path) {
  const b = readFileSync(new URL(`../${path}`, import.meta.url));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('barra de estado', () => {
  it('iconos oscuros con el tema claro y claros con el oscuro', () => {
    assert.equal(statusBarStyle('light'), 'LIGHT');
    assert.equal(statusBarStyle('dark'), 'DARK');
  });
});

describe('botón «atrás» de Android', () => {
  it('primero cierra la ventana abierta', () => {
    assert.equal(backAction({ dialogOpen: true, canGoBack: true, hash: '#/ajustes' }), 'close-dialog');
    assert.equal(backAction({ dialogOpen: true, canGoBack: false, hash: '#/inicio' }), 'close-dialog');
  });
  it('si no hay ventana, vuelve a la pantalla anterior', () => {
    assert.equal(backAction({ dialogOpen: false, canGoBack: true, hash: '#/facturas/abc' }), 'back');
  });
  it('sin pantalla anterior, va a Inicio', () => {
    assert.equal(backAction({ dialogOpen: false, canGoBack: false, hash: '#/caja' }), 'home');
  });
  it('en Inicio (o en la pantalla de entrar) manda la app al fondo, no la cierra', () => {
    assert.equal(backAction({ dialogOpen: false, canGoBack: true, hash: '#/inicio' }), 'minimize');
    assert.equal(backAction({ dialogOpen: false, canGoBack: false, hash: '' }), 'minimize');
  });
  it('se registra con el complemento App y, en Inicio, pide minimizar', async () => {
    const calls = [];
    let listener = null;
    const cap = {
      nativeCallback: (plugin, method, options, cb) => { calls.push([plugin, method, options]); listener = cb; },
      nativePromise: async (plugin, method) => { calls.push([plugin, method]); return {}; },
    };
    const saved = { document: globalThis.document, window: globalThis.window };
    globalThis.document = /** @type {any} */ ({ querySelectorAll: () => [] });
    globalThis.window = /** @type {any} */ ({ location: { hash: '#/inicio' }, history: { back() {} } });
    try {
      installBackButton(cap);
      listener({ canGoBack: false });
      await Promise.resolve();
    } finally {
      globalThis.document = saved.document;
      globalThis.window = saved.window;
    }
    assert.deepEqual(calls[0], ['App', 'addListener', { eventName: 'backButton' }]);
    assert.deepEqual(calls[1], ['App', 'minimizeApp']);
  });
});

describe('ícono y pantalla de arranque de ACCONTROL', () => {
  const res = 'android/app/src/main/res';
  it('el fondo del ícono adaptable y del arranque es el morado de ACCONTROL', () => {
    assert.match(readFileSync(new URL(`../${res}/values/ic_launcher_background.xml`, import.meta.url), 'utf8'), /#34204F/i);
    assert.match(readFileSync(new URL(`../${res}/values/styles.xml`, import.meta.url), 'utf8'), /windowSplashScreenBackground">@color\/ic_launcher_background/);
  });
  it('los íconos tienen el tamaño que pide Android en cada densidad', () => {
    const sizes = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [d, k] of Object.entries(sizes)) {
      assert.deepEqual(pngSize(`${res}/mipmap-${d}/ic_launcher.png`), [48 * k, 48 * k], d);
      assert.deepEqual(pngSize(`${res}/mipmap-${d}/ic_launcher_round.png`), [48 * k, 48 * k], d);
      assert.deepEqual(pngSize(`${res}/mipmap-${d}/ic_launcher_foreground.png`), [108 * k, 108 * k], d);
    }
  });
  it('la pantalla de arranque vertical es más alta que ancha y la horizontal al revés', () => {
    const [pw, ph] = pngSize(`${res}/drawable-port-xxhdpi/splash.png`);
    const [lw, lh] = pngSize(`${res}/drawable-land-xxhdpi/splash.png`);
    assert.ok(ph > pw && lw > lh);
  });
});
