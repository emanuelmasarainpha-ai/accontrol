import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPrecache } from '../tools/make-precache.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} dir @returns {string[]} */
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

test('precache lista todos los archivos de la app y solo archivos que existen', () => {
  const { files, version } = buildPrecache(ROOT);
  assert.match(version, /^[0-9a-f]{12}$/);
  assert.ok(files.includes('./'));
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('manifest.webmanifest'));

  for (const file of files.filter((f) => f !== './')) {
    assert.ok(existsSync(join(ROOT, file)), `no existe: ${file}`);
  }
  const sources = walk(join(ROOT, 'src')).map((f) => relative(ROOT, f).split(sep).join('/'));
  for (const source of sources) assert.ok(files.includes(source), `falta en el precache: ${source}`);
});

test('precache no incluye pruebas, herramientas ni el propio service worker', () => {
  const { files } = buildPrecache(ROOT);
  for (const file of files) {
    assert.ok(!file.startsWith('test/') && !file.startsWith('tools/') && !file.startsWith('node_modules/'), file);
    assert.notEqual(file, 'sw.js');
    assert.notEqual(file, 'precache.json');
  }
});

test('los íconos del manifest existen', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
});
