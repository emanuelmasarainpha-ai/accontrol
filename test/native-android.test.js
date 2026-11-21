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
  it('pide solo internet, cámara (lector de códigos) y, en Android 10 o más viejo, archivos (copia automática)', () => {
    const perms = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(perms, ['android.permission.CAMERA', 'android.permission.INTERNET', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE']);
    for (const p of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) assert.match(manifest, new RegExp(`${p}" android:maxSdkVersion="29"`), p);
    assert.match(manifest, /android\.hardware\.camera" android:required="false"/);
  });
  it('Gradle 9 o más nuevo (el Java 25 de Android Studio no funciona con Gradle 8)', () => {
    const wrapper = readFileSync(new URL('../android/gradle/wrapper/gradle-wrapper.properties', import.meta.url), 'utf8');
    const major = Number(/gradle-(\d+)\./.exec(wrapper)?.[1]);
    assert.ok(major >= 9, `Gradle ${major}`);
  });
  it('en Windows compila fuera de OneDrive (OneDrive bloquea los archivos y Gradle no los puede borrar)', () => {
    const build = readFileSync(new URL('../android/build.gradle', import.meta.url), 'utf8');
    assert.ok(build.includes("System.getenv('LOCALAPPDATA')"));
    assert.ok(build.includes('layout.buildDirectory = new File(localAppData, "accontrol-android-build/'));
  });
  it('ninguna llave secreta dentro de la configuración nativa', () => {
    const text = JSON.stringify(config) + manifest;
    assert.doesNotMatch(text, /service_role|sb_secret_/i);
  });
});

describe('APK para instalar (firmado)', async () => {
  const { apkName } = await import('../tools/android-apk.mjs');
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  const appGradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');

  it('el archivo lleva la versión de la app', () => {
    assert.equal(apkName('0.17.5'), 'ACCONTROL-0.17.5.apk');
    assert.throws(() => apkName('1.0'));
    assert.throws(() => apkName('../../x'));
  });
  it('la firma nunca entra al repositorio', () => {
    for (const line of ['*.jks', '*.keystore', 'firma.properties']) assert.ok(gitignore.split(/\r?\n/).includes(line), line);
  });
  it('la firma se lee de fuera del proyecto, sin contraseñas escritas en el código', () => {
    assert.ok(appGradle.includes("'.accontrol-firma/firma.properties'"));
    assert.doesNotMatch(appGradle, /storePassword\s+['"]/);
  });
  it('la versión de Android sale de package.json y crece sola', () => {
    assert.ok(appGradle.includes('versionCode appVersionCode'));
    assert.ok(appGradle.includes('versionName appVersion'));
  });
});
