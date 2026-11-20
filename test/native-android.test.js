// 0.18.0 — App nativa de Android (la misma app web envuelta con Capacitor).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emailReturnAddress, isNativeApp } from '../src/app/platform.js';

describe('¿navegador o app nativa?', () => {
  it('en el navegador (sin Capacitor) no es la app nativa', () => {
    assert.equal(isNativeApp({}), false);
    assert.equal(isNativeApp(undefined), false);
  });
  it('dentro de la app de Android sí lo es', () => {
    assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => true } }), true);
  });
  it('Capacitor en modo web, raro o que falla no cuenta como nativa', () => {
    assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => false } }), false);
    assert.equal(isNativeApp({ Capacitor: {} }), false);
    assert.equal(isNativeApp({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }), false);
  });
  it('los correos vuelven a la página en el navegador y a la dirección de Supabase en la app nativa', () => {
    const loc = { origin: 'https://accontrol.example', pathname: '/' };
    assert.equal(emailReturnAddress(loc, false), 'https://accontrol.example/');
    assert.equal(emailReturnAddress(loc, true), '');
  });
});

describe('proyecto de Android', () => {
  const config = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'));
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

  it('usa lo que prepara `npm run build` (solo los archivos públicos, sin pruebas ni migraciones)', () => {
    assert.equal(config.webDir, 'dist');
    assert.equal(config.appId, 'com.accontrol.app');
  });
  it('no deja depurar la app desde fuera ni mezclar http con https', () => {
    assert.equal(config.android.webContentsDebuggingEnabled, false);
    assert.equal(config.android.allowMixedContent, false);
  });
  it('los datos financieros no salen en la copia automática de Android', () => {
    assert.match(manifest, /android:allowBackup="false"/);
    assert.doesNotMatch(manifest, /android:allowBackup="true"/);
  });
  it('pide solo internet y cámara (lector de códigos), y la cámara no es obligatoria', () => {
    const perms = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(perms, ['android.permission.CAMERA', 'android.permission.INTERNET']);
    assert.match(manifest, /android\.hardware\.camera" android:required="false"/);
  });
  it('Gradle 9 o más nuevo (el Java 25 de Android Studio no funciona con Gradle 8)', () => {
    const wrapper = readFileSync(new URL('../android/gradle/wrapper/gradle-wrapper.properties', import.meta.url), 'utf8');
    const major = Number(/gradle-(\d+)\./.exec(wrapper)?.[1]);
    assert.ok(major >= 9, `Gradle ${major}`);
  });
  it('ninguna llave secreta dentro de la configuración nativa', () => {
    const text = JSON.stringify(config) + manifest;
    assert.doesNotMatch(text, /service_role|sb_secret_/i);
  });
});
