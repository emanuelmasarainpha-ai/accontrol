// 0.18.2 — Copia de seguridad automática diaria a la hora elegida (sugerencia de la persona).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoFileName, copiesOf, copiesToPrune, copyLabel, createAutoBackup, isBackingOff, isDue, KEEP_COPIES, lastScheduledMoment,
  nativeTarget, ownerTag, parsePrefs, parseTime, RETRY_AFTER_MS,
} from '../src/app/autoBackup.js';
import { autoBackupStatus } from '../src/views/autoBackupPanel.js';

/** Fecha en hora local del teléfono. */
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe('reglas de la copia automática', () => {
  it('la hora se lee bien y rechaza lo que no es una hora', () => {
    assert.deepEqual(parseTime('21:00'), { h: 21, m: 0 });
    assert.deepEqual(parseTime('7:05'), { h: 7, m: 5 });
    for (const bad of ['24:00', '12:60', 'nueve', '', null, '21']) assert.equal(parseTime(bad), null, String(bad));
  });

  it('el último momento programado: hoy si ya llegó la hora, si no ayer', () => {
    assert.equal(lastScheduledMoment(at(2026, 11, 20, 22, 0), '21:00').getTime(), at(2026, 11, 20, 21, 0).getTime());
    assert.equal(lastScheduledMoment(at(2026, 11, 20, 20, 59), '21:00').getTime(), at(2026, 11, 19, 21, 0).getTime());
    assert.equal(lastScheduledMoment(at(2026, 12, 1, 8, 0), '21:00').getTime(), at(2026, 11, 30, 21, 0).getTime(), 'cambio de mes');
  });

  it('toca la copia si nunca se hizo o si la última es de antes de la hora de hoy', () => {
    const now = at(2026, 11, 20, 21, 30);
    assert.equal(isDue({ now, time: '21:00', lastRunISO: null }), true);
    assert.equal(isDue({ now, time: '21:00', lastRunISO: at(2026, 11, 20, 20, 0).toISOString() }), true, 'hecha antes de la hora');
    assert.equal(isDue({ now, time: '21:00', lastRunISO: at(2026, 11, 20, 21, 5).toISOString() }), false, 'ya hecha hoy');
    assert.equal(isDue({ now: at(2026, 11, 20, 9, 0), time: '21:00', lastRunISO: at(2026, 11, 19, 21, 1).toISOString() }), false, 'aún no es la hora de hoy');
  });

  it('app cerrada a la hora: al abrirla después se hace (la de ayer quedó pendiente)', () => {
    // Última copia anteayer; hoy se abre a las 8:00, antes de la hora: toca la de ayer a las 21:00.
    assert.equal(isDue({ now: at(2026, 11, 20, 8, 0), time: '21:00', lastRunISO: at(2026, 11, 18, 21, 0).toISOString() }), true);
  });

  it('tras un fallo espera 30 minutos antes de reintentar sola', () => {
    const t0 = at(2026, 11, 20, 21, 0);
    const later = (ms) => new Date(t0.getTime() + ms);
    assert.equal(isBackingOff({ now: later(60_000), lastError: 'sin permiso', lastAttemptISO: t0.toISOString() }), true);
    assert.equal(isBackingOff({ now: later(RETRY_AFTER_MS + 1), lastError: 'sin permiso', lastAttemptISO: t0.toISOString() }), false);
    assert.equal(isBackingOff({ now: later(60_000), lastError: null, lastAttemptISO: t0.toISOString() }), false);
  });

  it('nombres por cuenta, ordenados y con su fecha legible', () => {
    const tag = ownerTag('accontrol-user-abc');
    assert.match(tag, /^[0-9a-f]{8}$/);
    assert.notEqual(tag, ownerTag('accontrol-user-xyz'));
    const name = autoFileName(tag, at(2026, 11, 20, 21, 5));
    assert.equal(name, `accontrol-auto-${tag}-2026-11-20-2105.json`);
    assert.equal(copyLabel(name), '20 nov 2026 · 21:05');
  });

  it('cada cuenta solo ve y borra sus copias; se guardan las últimas 7', () => {
    const mine = ownerTag('A');
    const other = ownerTag('B');
    const names = [
      ...Array.from({ length: 9 }, (_, i) => autoFileName(mine, at(2026, 11, 10 + i, 21, 0))),
      autoFileName(other, at(2026, 11, 30, 21, 0)),
      'otra-cosa.json',
    ];
    const list = copiesOf(names, mine);
    assert.equal(list.length, 9);
    assert.ok(list[0].includes('2026-11-18'), 'la más nueva primero');
    const prune = copiesToPrune(names, mine);
    assert.equal(prune.length, 9 - KEEP_COPIES);
    assert.ok(prune.every((n) => n.includes(mine)), 'nunca toca las de otra cuenta');
    assert.ok(prune.some((n) => n.includes('2026-11-10')) && prune.some((n) => n.includes('2026-11-11')));
  });

  it('preferencias dañadas o viejas: valores seguros (apagada, 21:00)', () => {
    assert.deepEqual(parsePrefs(null), { enabled: false, time: '21:00', lastRunISO: null, lastError: null, lastAttemptISO: null });
    assert.equal(parsePrefs('{roto').enabled, false);
    assert.equal(parsePrefs('{"enabled":true,"time":"99:99"}').time, '21:00');
  });
});

/** Un almacén de copias en memoria y un `store` de mentira. */
function setup({ workspaces = 1, now = at(2026, 11, 20, 21, 30), failSave = false } = {}) {
  const files = new Map();
  const target = {
    where: 'la memoria de prueba',
    async list() { return [...files.keys()]; },
    async read(n) { if (!files.has(n)) throw new Error('no'); return files.get(n); },
    async save(n, json) { if (failSave) throw new Error('Sin permiso para guardar.'); files.set(n, json); },
    async remove(n) { files.delete(n); },
  };
  const prefs = new Map();
  const storage = { getItem: (k) => prefs.get(k) ?? null, setItem: (k, v) => prefs.set(k, v) };
  let exports = 0;
  const store = {
    getState: () => ({ workspaces: Array.from({ length: workspaces }) }),
    async exportFullBackup() { exports += 1; return { ok: true, fileName: 'x.json', json: '{"format":"accontrol-full"}' }; },
  };
  const clock = { now };
  const auto = createAutoBackup({ store, owner: 'cuenta-1', target, storage, now: () => clock.now });
  return { auto, files, clock, exports: () => exports };
}

describe('el programador de la copia automática', () => {
  it('apagada no hace nada; encendida hace la copia completa si toca', async () => {
    const { auto, files, exports } = setup();
    assert.equal(await auto.check(), null);
    assert.equal(files.size, 0);
    auto.setEnabled(true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(files.size, 1);
    assert.equal(exports(), 1);
    assert.equal(await auto.check(), null, 'ya hecha hoy: no repite');
    assert.equal(exports(), 1);
  });

  it('al día siguiente, a la hora, hace otra; nunca más de 7', async () => {
    const { auto, files, clock } = setup();
    auto.setEnabled(true);
    await new Promise((r) => setTimeout(r, 0));
    for (let day = 21; day <= 30; day += 1) {
      clock.now = at(2026, 11, day, 21, 1);
      await auto.check();
    }
    assert.equal(files.size, KEEP_COPIES);
    const list = await auto.list();
    assert.ok(list[0].includes('2026-11-30'));
  });

  it('sin espacios todavía no copia nada', async () => {
    const { auto, files } = setup({ workspaces: 0 });
    const result = await auto.runNow();
    assert.equal(result.ok, false);
    assert.equal(files.size, 0);
  });

  it('si falla, lo dice y no reintenta cada minuto', async () => {
    const { auto, clock } = setup({ failSave: true });
    const result = await auto.runNow();
    assert.deepEqual(result, { ok: false, error: 'Sin permiso para guardar.' });
    assert.equal(auto.prefs().lastError, 'Sin permiso para guardar.');
    auto.setEnabled(true);
    clock.now = new Date(clock.now.getTime() + 60_000);
    assert.equal(await auto.check(), null, 'en espera tras el fallo');
  });

  it('la hora mala no se guarda; borrar quita todas las copias de la cuenta', async () => {
    const { auto, files } = setup();
    assert.equal(auto.setTime('25:00'), false);
    assert.equal(auto.prefs().time, '21:00');
    assert.equal(auto.setTime('07:30'), true);
    await auto.runNow();
    files.set('accontrol-auto-ffffffff-2026-01-01-0000.json', 'de otra cuenta');
    await auto.clear();
    assert.deepEqual([...files.keys()], ['accontrol-auto-ffffffff-2026-01-01-0000.json']);
    await assert.rejects(auto.read('accontrol-auto-ffffffff-2026-01-01-0000.json'), /no es de esta cuenta/);
  });

  it('el estado se explica en palabras', () => {
    const now = at(2026, 11, 20, 10, 0);
    assert.match(autoBackupStatus(parsePrefs(null), now), /^Apagada\./);
    const on = { enabled: true, time: '21:00', lastRunISO: at(2026, 11, 19, 21, 0).toISOString(), lastError: null, lastAttemptISO: null };
    assert.match(autoBackupStatus(on, now), /Última copia: 19 nov 2026 · 21:00\. La próxima: hoy a las 21:00/);
    assert.match(autoBackupStatus({ ...on, lastError: 'Sin permiso.' }, now), /no se pudo: Sin permiso\./);
  });
});

describe('en la app de Android: Documentos/ACCONTROL', () => {
  it('escribe, lista, lee y borra con el complemento Filesystem', async () => {
    const calls = [];
    const cap = {
      async nativePromise(plugin, method, options) {
        calls.push([plugin, method, options]);
        if (method === 'readdir') return { files: [{ name: 'a.json' }, { name: 'b.json' }] };
        if (method === 'readFile') return { data: '{"x":1}' };
        return {};
      },
    };
    const target = nativeTarget(cap);
    await target.save('a.json', '{"x":1}');
    assert.deepEqual(calls[0], ['Filesystem', 'writeFile', { path: 'ACCONTROL/a.json', directory: 'DOCUMENTS', data: '{"x":1}', encoding: 'utf8', recursive: true }]);
    assert.deepEqual(await target.list(), ['a.json', 'b.json']);
    assert.equal(await target.read('a.json'), '{"x":1}');
    await target.remove('a.json');
    assert.deepEqual(calls.at(-1), ['Filesystem', 'deleteFile', { path: 'ACCONTROL/a.json', directory: 'DOCUMENTS' }]);
  });
  it('si la carpeta aún no existe, la lista está vacía (no es un error)', async () => {
    const target = nativeTarget({ nativePromise: async () => { throw new Error('does not exist'); } });
    assert.deepEqual(await target.list(), []);
  });
});
