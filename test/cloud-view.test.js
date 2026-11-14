import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountDangerPanel, accountPanel } from '../src/views/account.js';
import { clearAllActions, cloudPanel, remoteNotice, runCloudAction, syncStatusText } from '../src/views/cloud.js';

const status = (patch = {}) => ({ pending: 0, running: false, lastError: null, lastSuccessAt: null, nextRetryAt: null, ...patch });
const fakeSync = (enabled, st = status()) => ({
  state: () => ({ enabled, asked: false, status: st }),
  enable: async () => ({ ok: true, records: 0, workspaces: 1 }), syncNow: async () => {}, markAsked() {}, disableOnThisDevice() {},
  clearEverywhere: async () => ({ ok: true }), forget() {}, onChange: () => () => {},
});

describe('pantalla de la copia en la nube', () => {
  it('sin cuenta (modo local) no aparece', () => {
    assert.equal(cloudPanel(null), '');
    assert.equal(cloudPanel(undefined), '');
  });

  it('apagada: explica qué hace, dice que los DEMO no se suben y ofrece primero la copia de seguridad', () => {
    const panel = cloudPanel(fakeSync(false)).toString();
    assert.match(panel, /Copia en la nube/);
    assert.match(panel, /datos de demostración no se suben/);
    const backup = panel.indexOf('data-action="export-full"');
    const enable = panel.indexOf('data-action="cloud-enable"');
    assert.ok(backup > 0 && enable > backup, 'el botón de la copia de seguridad va antes que el de activar');
    assert.match(panel, /1\. Descargar copia de seguridad/);
    assert.match(panel, /2\. Activar copia en la nube/);
    assert.match(panel, /se juntan/, 'explica qué pasa si ya hay datos de otro dispositivo');
    assert.match(panel, /el cambio más reciente/);
    assert.doesNotMatch(panel, /siguiente paso/, 'ya no promete algo para después: bajar de la nube ya existe');
  });

  it('activada: dice que lo de otros dispositivos llega solo', () => {
    assert.match(cloudPanel(fakeSync(true)).toString(), /otros dispositivos llega aquí solo/);
  });

  it('avisos de lo que llega de otro dispositivo', () => {
    const base = { ok: true, applied: 0, conflicts: 0, addedWorkspaces: [], removedWorkspaces: [] };
    assert.equal(remoteNotice({ ...base, applied: 5 }), null, 'los cambios normales solo se ven, sin aviso');
    assert.match(remoteNotice({ ...base, conflicts: 1 }), /Un dato había cambiado en dos dispositivos: se quedó el cambio más reciente/);
    assert.match(remoteNotice({ ...base, conflicts: 3 }), /3 datos habían cambiado/);
    assert.match(remoteNotice({ ...base, addedWorkspaces: ['Casa'] }), /Llegó el espacio «Casa» desde tu otro dispositivo/);
    assert.match(remoteNotice({ ...base, removedWorkspaces: ['A', 'B'] }), /Se quitaron los espacios «A», «B» de este dispositivo porque se borró en otro/);
  });

  it('activada: muestra el estado y el botón «Sincronizar ahora»', () => {
    const panel = cloudPanel(fakeSync(true, status({ pending: 3 }))).toString();
    assert.match(panel, /Activada/);
    assert.match(panel, /id="cloud-status"/);
    assert.match(panel, /3 cambios por enviar/);
    assert.match(panel, /data-action="cloud-sync-now"/);
  });

  it('el estado se dice en palabras claras', () => {
    assert.equal(syncStatusText(status({ running: true })), 'Enviando cambios a la nube…');
    assert.equal(syncStatusText(status({ pending: 1 })), '1 cambio por enviar…');
    assert.match(syncStatusText(status({ lastSuccessAt: '2026-11-14T15:05:00.000Z' })), /^Todo enviado a la nube\. Último envío: /);
    const error = syncStatusText(status({ pending: 2, lastError: { code: 'network', status: 0, message: 'No hay conexión con la nube.' } }));
    assert.match(error, /No hay conexión/);
    assert.match(error, /Quedan 2 cambios por enviar; están guardados en este dispositivo/);
  });

  it('la hora del último envío no deja doble punto («p. m..»)', () => {
    for (const iso of ['2026-11-14T03:28:00.000Z', '2026-11-14T15:05:00.000Z']) {
      const text = syncStatusText(status({ lastSuccessAt: iso }));
      assert.doesNotMatch(text, /\.\.$/, text);
      assert.match(text, /\.$/);
    }
  });

  it('la sección «Cuenta» dice dónde están los datos según la copia en la nube', () => {
    const base = { email: 'ana@correo.com', signOut: async () => {}, changePassword: async () => ({ ok: true }), deleteAccount: async () => ({ ok: true }) };
    assert.match(accountPanel({ ...base, sync: fakeSync(false) }).toString(), /solo en este dispositivo<\/strong> mientras no actives la <strong>copia en la nube/);
    assert.match(accountPanel({ ...base, sync: fakeSync(true) }).toString(), /en este dispositivo y en la nube/);
    assert.match(accountDangerPanel(base).toString(), /usa «Borrar todo», más arriba/);
  });

  it('«Borrar todo»: sin copia en la nube, el botón de siempre; con ella, los dos botones', () => {
    assert.match(clearAllActions(null).toString(), /data-action="clear-all"/);
    assert.match(clearAllActions(fakeSync(false)).toString(), /data-action="clear-all"/);
    const two = clearAllActions(fakeSync(true)).toString();
    assert.doesNotMatch(two, /data-action="clear-all"/);
    assert.match(two, /data-action="clear-device"[^>]*>.*Borrar de este dispositivo/s);
    assert.match(two, /data-action="clear-everywhere"[^>]*>.*Borrar de todos mis dispositivos/s);
  });

  it('las acciones de la nube solo se atienden si hay cuenta', () => {
    const store = {};
    assert.equal(runCloudAction(null, 'cloud-sync-now', { store, rerender() {} }), false);
    assert.equal(runCloudAction(fakeSync(true), 'otra-cosa', { store, rerender() {} }), false);
    let synced = false;
    const s = { ...fakeSync(true), syncNow: async () => { synced = true; } };
    assert.equal(runCloudAction(s, 'cloud-sync-now', { store, rerender() {} }), true);
    assert.equal(synced, true);
  });
});
