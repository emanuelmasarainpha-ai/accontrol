import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

describe('configuración de Supabase', () => {
  it('la dirección es https, de supabase.co y sin barra al final', () => {
    assert.match(SUPABASE_URL, /^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
  });

  it('la llave es PÚBLICA: tipo «publishable», o una llave antigua con rol «anon». Nunca una secreta', () => {
    const modern = SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_');
    let legacyAnon = false;
    if (!modern && SUPABASE_PUBLISHABLE_KEY.split('.').length === 3) {
      const payload = JSON.parse(Buffer.from(SUPABASE_PUBLISHABLE_KEY.split('.')[1], 'base64url').toString('utf8'));
      legacyAnon = payload.role === 'anon';
    }
    assert.ok(modern || legacyAnon, 'la llave debe ser sb_publishable_… o una llave JWT con role=anon');
    assert.doesNotMatch(SUPABASE_PUBLISHABLE_KEY, /^sb_secret_/);
  });

  it('la política de seguridad de index.html permite hablar con ESE proyecto y con ningún otro servidor', () => {
    const page = readFileSync(join(root, 'index.html'), 'utf8');
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(page)?.[1] ?? '';
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1].split(/\s+/) ?? [];
    assert.deepEqual(connect.sort(), ["'self'", SUPABASE_URL].sort());
    assert.match(csp, /script-src 'self'(;|$)/, 'sigue sin permitirse código de otros sitios');
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  });

  it('en el código de la app no aparece ninguna llave secreta ni la palabra service_role', () => {
    for (const file of sourceFiles(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /sb_secret_/, file);
      assert.doesNotMatch(text, /service_role/i, file);
    }
  });
});
