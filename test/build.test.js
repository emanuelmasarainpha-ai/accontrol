import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('build: publica solo la app (sin pruebas, documentos ni migraciones) y con precache al día', () => {
  const parent = mkdtempSync(join(tmpdir(), 'accontrol-build-'));
  try {
    const out = join(parent, 'dist');
    const result = build(out, ROOT);
    assert.deepEqual(readdirSync(out).sort(), ['icons', 'index.html', 'manifest.webmanifest', 'precache.json', 'src', 'sw.js']);
    for (const privado of ['test', 'docs', 'supabase', 'tools', 'node_modules', 'CLAUDE.md', 'package.json', '.mcp.json']) {
      assert.equal(existsSync(join(out, privado)), false, `no debe publicarse: ${privado}`);
    }
    const precache = JSON.parse(readFileSync(join(out, 'precache.json'), 'utf8'));
    assert.equal(precache.version, result.version);
    assert.equal(precache.files.length, result.files);
    // Cada archivo que el modo sin conexión pide existe en lo publicado.
    for (const file of precache.files) if (file !== './') assert.ok(existsSync(join(out, file)), `falta ${file}`);
    assert.ok(existsSync(join(out, 'src/main.js')));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('build: se niega a vaciar la carpeta del proyecto o una que la contenga', () => {
  assert.throws(() => build(ROOT, ROOT), /no permitida/);
  assert.throws(() => build(join(ROOT, '..'), ROOT), /no permitida/);
});
