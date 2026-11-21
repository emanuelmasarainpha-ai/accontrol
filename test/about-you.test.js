// 0.18.4 — «Sobre ti»: preguntas de bienvenida opcionales (sexo, rango de edad, nacionalidad) para estadísticas futuras.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGE_RANGES, aboutYouSummary, COUNTRY_CODES, countryName, countryOptions, emptyAboutYou, FIRST_COUNTRY, GENDERS, validateAboutYou,
} from '../src/domain/aboutYou.js';
import { createCloudStore } from '../src/data/cloudStore.js';
import { visibleSections } from '../src/app/settingsSections.js';

describe('las preguntas', () => {
  it('todo es opcional: vacío = «Prefiero no decirlo»', () => {
    assert.deepEqual(validateAboutYou({}), { ok: true, value: emptyAboutYou() });
    assert.deepEqual(validateAboutYou({ gender: '', ageRange: '', nationality: '' }), { ok: true, value: emptyAboutYou() });
  });
  it('acepta las opciones de las listas y rechaza lo demás (no adivina)', () => {
    assert.deepEqual(validateAboutYou({ gender: 'female', ageRange: '25_34', nationality: 'DO' }), { ok: true, value: { gender: 'female', ageRange: '25_34', nationality: 'DO' } });
    const bad = validateAboutYou({ gender: 'x', ageRange: '30', nationality: 'ZZ' });
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(!bad.ok ? bad.errors : {}).sort(), ['ageRange', 'gender', 'nationality']);
    assert.equal(validateAboutYou({ nationality: 'do' }).ok, false, 'el código va en mayúsculas, como en la base');
  });
  it('las listas: hombre y mujer, rangos de edad y países sin repetir', () => {
    assert.deepEqual(GENDERS.map((g) => g.label), ['Hombre', 'Mujer']);
    assert.equal(AGE_RANGES.length, 7);
    assert.equal(new Set(COUNTRY_CODES).size, COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) assert.match(code, /^[A-Z]{2}$/);
    assert.ok(COUNTRY_CODES.length >= 190);
  });
  it('República Dominicana va primero; los demás países por nombre en español', () => {
    const list = countryOptions();
    assert.equal(list[0].code, FIRST_COUNTRY);
    assert.equal(list.length, COUNTRY_CODES.length);
    assert.equal(countryName('DO'), 'República Dominicana');
    const rest = list.slice(1).map((c) => c.name);
    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, 'es')));
  });
  it('el resumen en palabras', () => {
    assert.equal(aboutYouSummary({ gender: 'male', ageRange: '25_34', nationality: 'DO' }), 'Hombre · De 25 a 34 años · República Dominicana');
    assert.equal(aboutYouSummary({ gender: null, ageRange: 'under_18', nationality: null }), 'Menos de 18 años');
    assert.equal(aboutYouSummary({ gender: null, ageRange: '65_plus', nationality: null }), '65 años o más');
    assert.equal(aboutYouSummary(emptyAboutYou()), 'Prefieres no decirlo');
  });
});

/** Una nube de mentira que recuerda lo que se le pidió. */
function fakeCloud(rows = /** @type {any[]} */ ([])) {
  /** @type {{ method: string, url: string, body: any, headers: any }[]} */
  const calls = [];
  const cloud = createCloudStore({
    url: 'https://p.supabase.co', publishableKey: 'k', getAccessToken: async () => 't', getUserId: () => 'u-1',
    fetch: async (/** @type {string} */ url, /** @type {any} */ init) => {
      calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
      const text = init.method === 'GET' ? JSON.stringify(rows) : '';
      return { ok: true, status: init.method === 'GET' ? 200 : 201, text: async () => text };
    },
  });
  return { cloud, calls };
}

describe('en la nube (tabla user_about)', () => {
  it('sin fila: todavía no se le preguntó', async () => {
    const { cloud, calls } = fakeCloud([]);
    assert.deepEqual(await cloud.getAboutYou(), { ok: true, about: null });
    assert.match(calls[0].url, /\/rest\/v1\/user_about\?select=gender%2Cage_range%2Cnationality&user_id=eq\.u-1$/);
  });
  it('con fila: sus respuestas (y algo raro se toma como «Prefiero no decirlo»)', async () => {
    assert.deepEqual(await fakeCloud([{ gender: 'male', age_range: '18_24', nationality: 'VE' }]).cloud.getAboutYou(), { ok: true, about: { gender: 'male', ageRange: '18_24', nationality: 'VE' } });
    assert.deepEqual(await fakeCloud([{ gender: 'otro', age_range: null, nationality: null }]).cloud.getAboutYou(), { ok: true, about: emptyAboutYou() });
  });
  it('guardar es una sola fila por cuenta (si ya existe, se actualiza)', async () => {
    const { cloud, calls } = fakeCloud();
    assert.deepEqual(await cloud.saveAboutYou({ gender: 'female', ageRange: '35_44', nationality: 'DO' }), { ok: true });
    const call = calls[0];
    assert.equal(call.method, 'POST');
    assert.match(call.url, /\/rest\/v1\/user_about\?on_conflict=user_id$/);
    assert.match(call.headers.Prefer, /resolution=merge-duplicates/);
    assert.equal(call.body.user_id, 'u-1');
    assert.deepEqual([call.body.gender, call.body.age_range, call.body.nationality], ['female', '35_44', 'DO']);
  });
  it('omitir guarda todo vacío (para no volver a preguntar) y algo inválido no se envía', async () => {
    const { cloud, calls } = fakeCloud();
    assert.ok((await cloud.saveAboutYou(emptyAboutYou())).ok);
    assert.deepEqual([calls[0].body.gender, calls[0].body.age_range, calls[0].body.nationality], [null, null, null]);
    const bad = await cloud.saveAboutYou(/** @type {any} */ ({ gender: 'x', ageRange: null, nationality: null }));
    assert.equal(bad.ok, false);
    assert.equal(calls.length, 1);
  });
});

describe('privacidad', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261122000100_about_you.sql', import.meta.url), 'utf8');
  it('tabla aparte de profiles, con RLS: cada cuenta solo su fila, y se borra con la cuenta', () => {
    assert.match(sql, /create table public\.user_about/);
    assert.match(sql, /alter table public\.user_about enable row level security/);
    for (const p of ['select', 'insert', 'update']) assert.match(sql, new RegExp(`create policy user_about_${p} on public\\.user_about for ${p} to authenticated`));
    assert.equal((sql.match(/user_id = \(select auth\.uid\(\)\)/g) ?? []).length, 4, 'las cuatro reglas miran la cuenta con sesión');
    assert.match(sql, /references auth\.users \(id\) on delete cascade/);
    assert.doesNotMatch(sql, /to anon|grant .* delete/i);
  });
  it('las mismas opciones que la app', () => {
    for (const a of AGE_RANGES) assert.ok(sql.includes(`'${a.value}'`), a.value);
    for (const g of GENDERS) assert.ok(sql.includes(`'${g.value}'`), g.value);
  });
  it('sin cuentas no aparece «Sobre ti» en Ajustes (no habría a dónde enviarlo)', () => {
    const blocks = (/** @type {boolean} */ hasAccount) => visibleSections({ hasAccount }).flatMap((s) => s.blocks);
    assert.ok(blocks(true).includes('aboutYou'));
    assert.ok(!blocks(false).includes('aboutYou'));
    assert.ok(visibleSections({ hasAccount: true }).find((s) => s.id === 'privacidad')?.blocks.includes('aboutYou'));
  });
});
