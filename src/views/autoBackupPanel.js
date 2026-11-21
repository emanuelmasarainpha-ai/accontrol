// @ts-check
// =============================================================================
// AJUSTES → ALMACENAMIENTO Y COPIAS → «COPIA AUTOMÁTICA» (0.18.2)
// Encender o apagar la copia diaria, elegir la hora, ver las copias guardadas (y guardarlas o compartirlas), hacer una ya
// y borrarlas. Las reglas y el almacenamiento están en app/autoBackup.js.
// =============================================================================

import { copyLabel, KEEP_COPIES, lastScheduledMoment, parseTime, RETRY_AFTER_MS } from '../app/autoBackup.js';
import { isNativeApp } from '../app/platform.js';
import { confirmDialog } from '../ui/dialog.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { saveFile } from '../ui/saveFile.js';
import { toast } from '../ui/toast.js';

/** @typedef {import('../app/autoBackup.js').AutoBackup} AutoBackup */

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0');

/**
 * Lo que dice el estado de la copia automática.
 * @param {import('../app/autoBackup.js').AutoBackupPrefs} prefs @param {Date} now
 */
export function autoBackupStatus(prefs, now) {
  const last = prefs.lastRunISO ? new Date(prefs.lastRunISO) : null;
  const lastText = last && !Number.isNaN(last.getTime())
    ? `Última copia: ${copyLabel(`-${last.getFullYear()}-${two(last.getMonth() + 1)}-${two(last.getDate())}-${two(last.getHours())}${two(last.getMinutes())}.json`)}.`
    : 'Todavía no se ha hecho ninguna copia automática.';
  if (!prefs.enabled) return `Apagada. ${lastText}`;
  if (prefs.lastError) return `La última vez no se pudo: ${prefs.lastError} Se vuelve a intentar sola en ${RETRY_AFTER_MS / 60_000} minutos, o pulsa «Hacer una copia ahora».`;
  const next = lastScheduledMoment(now, prefs.time);
  next.setDate(next.getDate() + 1);
  const sameDay = next.toDateString() === now.toDateString();
  return `${lastText} La próxima: ${sameDay ? 'hoy' : 'mañana'} a las ${prefs.time} (o al abrir la app si a esa hora está cerrada).`;
}

/** @param {AutoBackup | null} auto */
export function autoBackupPanel(auto) {
  if (!auto) return '';
  const prefs = auto.prefs();
  const native = isNativeApp();
  return html`<section class="panel" aria-labelledby="set-autobackup" data-autobackup>
    <h2 class="panel__title" id="set-autobackup">Copia automática</h2>
    <label class="switch-row" for="pref-autobackup">
      <span class="switch-row__text">
        <strong>Hacer una copia completa cada día</strong>
        <small>Todos tus espacios, igual que «Exportar copia completa», y se importa igual. Se guarda en ${auto.where}; se conservan las últimas ${KEEP_COPIES} y las más viejas se borran solas.</small>
      </span>
      <input type="checkbox" class="switch" id="pref-autobackup" data-autobackup-enabled ${prefs.enabled ? 'checked' : ''} />
    </label>
    <div class="field">
      <label for="autobackup-time">Hora de la copia</label>
      <input id="autobackup-time" class="input" type="time" value="${prefs.time}" data-autobackup-time aria-describedby="autobackup-time-hint" />
      <p class="hint" id="autobackup-time-hint">Si a esa hora la app está cerrada, la copia se hace en cuanto la abras. Ni el navegador ni la app pueden despertarse solos a una hora exacta.</p>
    </div>
    <p class="storage-status" data-autobackup-status role="status">${autoBackupStatus(prefs, new Date())}</p>
    <ul class="cat-list" data-autobackup-list aria-label="Copias automáticas guardadas"></ul>
    <div class="actions actions--start">
      <button type="button" class="btn btn--ghost" data-action="autobackup-now">${icon('download', 18)}Hacer una copia ahora</button>
      <button type="button" class="btn btn--danger-ghost" data-action="autobackup-clear">Borrar las copias automáticas</button>
    </div>
    <p class="hint">Las copias <strong>no están cifradas</strong>. ${native
      ? 'Quien use tu teléfono, o una app con permiso para ver tus archivos, podría abrirlas.'
      : 'Si borras los datos de este navegador, también se borran estas copias: guarda una fuera de vez en cuando o activa la copia en la nube.'}</p>
  </section>`;
}

/**
 * Pone al día el estado y la lista de copias.
 * @param {AutoBackup} auto @param {Element} panel
 */
async function refresh(auto, panel) {
  const status = panel.querySelector('[data-autobackup-status]');
  if (status) status.textContent = autoBackupStatus(auto.prefs(), new Date());
  const list = panel.querySelector('[data-autobackup-list]');
  if (!(list instanceof HTMLElement)) return;
  const names = await auto.list().catch(() => []);
  setHtml(list, html`${names.map(
    (name) => html`<li class="cat">
      <span class="cat__name">${copyLabel(name)}</span>
      <span class="cat__actions"><button type="button" class="btn btn--ghost btn--small" data-action="autobackup-save" data-name="${name}">${isNativeApp() ? 'Compartir' : 'Descargar'}</button></span>
    </li>`,
  )}`);
}

/**
 * Escucha el interruptor, la hora y los botones del bloque.
 * @param {AutoBackup | null} auto @param {HTMLElement} root @param {AbortSignal} signal
 */
export function watchAutoBackup(auto, root, signal) {
  const panel = root.querySelector('[data-autobackup]');
  if (!auto || !panel) return;
  void refresh(auto, panel);
  const stop = auto.onChange(() => void refresh(auto, panel));
  signal.addEventListener('abort', stop, { once: true });

  const enabled = panel.querySelector('[data-autobackup-enabled]');
  if (enabled instanceof HTMLInputElement) {
    enabled.addEventListener('change', () => {
      auto.setEnabled(enabled.checked);
      toast(enabled.checked ? `Copia automática encendida: cada día a las ${auto.prefs().time}.` : 'Copia automática apagada.');
    }, { signal });
  }
  const time = panel.querySelector('[data-autobackup-time]');
  if (time instanceof HTMLInputElement) {
    time.addEventListener('change', () => {
      if (!parseTime(time.value) || !auto.setTime(time.value)) {
        time.value = auto.prefs().time;
        toast('Esa hora no es válida.', 'error');
        return;
      }
      toast(`La copia automática será a las ${time.value}.`);
    }, { signal });
  }
}

/**
 * Los botones del bloque. Devuelve true si la acción era suya.
 * @param {AutoBackup | null} auto @param {HTMLElement} el
 */
export function runAutoBackupAction(auto, el) {
  if (!auto) return false;
  switch (el.dataset.action) {
    case 'autobackup-now':
      void (async () => {
        el.setAttribute('disabled', '');
        const result = await auto.runNow();
        el.removeAttribute('disabled');
        if (result.ok) toast(`Copia guardada en ${auto.where}.`);
        else toast(result.error, 'error');
      })();
      return true;
    case 'autobackup-save':
      void (async () => {
        const name = el.dataset.name ?? '';
        try {
          const json = await auto.read(name);
          await saveFile({ filename: name, mime: 'application/json', bytes: new TextEncoder().encode(json) }, { dialogTitle: 'Guardar la copia de seguridad' });
        } catch (error) {
          toast(error instanceof Error ? error.message : 'No se pudo abrir esa copia.', 'error');
        }
      })();
      return true;
    case 'autobackup-clear':
      void (async () => {
        const ok = await confirmDialog({
          title: '¿Borrar las copias automáticas?',
          message: `Se borran las copias automáticas de esta cuenta guardadas en ${auto.where}. Tus datos de la app no se tocan.`,
          confirmLabel: 'Borrar copias',
          danger: true,
        });
        if (!ok) return;
        try {
          await auto.clear();
          toast('Copias automáticas borradas.');
        } catch {
          toast('No se pudieron borrar todas. Inténtalo de nuevo.', 'error');
        }
      })();
      return true;
    default:
      return false;
  }
}
