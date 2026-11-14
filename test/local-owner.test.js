import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { claimNameAdoption, LEGACY_OWNER_KEY, NAME_ADOPTED_PREFIX, resolveDatabaseName } from '../src/auth/localOwner.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)) };
}

describe('base de datos local de cada cuenta', () => {
  it('la primera cuenta se queda con la base de siempre y queda anotada', () => {
    const storage = memoryStorage();
    assert.equal(resolveDatabaseName(storage, A), 'accontrol');
    assert.equal(storage.map.get(LEGACY_OWNER_KEY), A);
  });

  it('la misma cuenta, otra vez: sigue con la base de siempre', () => {
    const storage = memoryStorage();
    resolveDatabaseName(storage, A);
    assert.equal(resolveDatabaseName(storage, A), 'accontrol');
  });

  it('otra cuenta en el mismo dispositivo recibe una base propia y NO le quita la de siempre a la primera', () => {
    const storage = memoryStorage();
    resolveDatabaseName(storage, A);
    assert.equal(resolveDatabaseName(storage, B), `accontrol-u-${B}`);
    assert.equal(storage.map.get(LEGACY_OWNER_KEY), A);
    assert.equal(resolveDatabaseName(storage, A), 'accontrol');
  });

  it('una anotación dañada se trata como "nadie todavía"', () => {
    const storage = memoryStorage({ [LEGACY_OWNER_KEY]: '../../x' });
    assert.equal(resolveDatabaseName(storage, B), 'accontrol');
    assert.equal(storage.map.get(LEGACY_OWNER_KEY), B);
  });

  it('sin almacenamiento, o con almacenamiento que falla, usa la base de siempre sin romperse', () => {
    assert.equal(resolveDatabaseName(null, A), 'accontrol');
    const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    assert.equal(resolveDatabaseName(broken, A), 'accontrol');
  });

  it('un identificador de cuenta raro nunca llega a ser nombre de base de datos', () => {
    assert.throws(() => resolveDatabaseName(memoryStorage({ [LEGACY_OWNER_KEY]: A }), '../evil'), /no válido/);
  });
});

describe('nombre de la cuenta en este dispositivo', () => {
  it('se concede una sola vez por cuenta', () => {
    const storage = memoryStorage();
    assert.equal(claimNameAdoption(storage, A), true);
    assert.equal(claimNameAdoption(storage, A), false);
    assert.equal(storage.map.has(`${NAME_ADOPTED_PREFIX}${A}`), true);
  });

  it('cada cuenta tiene su propia marca', () => {
    const storage = memoryStorage();
    assert.equal(claimNameAdoption(storage, A), true);
    assert.equal(claimNameAdoption(storage, B), true);
  });

  it('sin almacenamiento se concede (no se puede recordar), sin romperse', () => {
    assert.equal(claimNameAdoption(null, A), true);
  });
});
