// @ts-check
// =============================================================================
// COPIA EN LA NUBE: PANTALLA (0.15.0, pasos 5 y 6)
// -----------------------------------------------------------------------------
// La sección «Copia en la nube» de Ajustes, el estado de la sincronización, la pregunta que se hace UNA vez y los
// dos botones de «Borrar todo» cuando la copia está activa, el ofrecimiento de traer los datos a un dispositivo vacío
// y los avisos de lo que llega de otros dispositivos. No sabe nada del servidor: habla con SyncApi.
// =============================================================================

import { ROLE_NAMES } from '../domain/roles.js';
import { confirmDialog } from '../ui/dialog.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

/** @typedef {import('../sync/syncController.js').SyncApi} SyncApi */
/** @typedef {import('../sync/syncEngine.js').SyncStatus} SyncStatus */
/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/** Hora corta: «3:05 p. m.». @param {string} iso */
function shortTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** @param {number} n */
const changesText = (n) => (n === 1 ? '1 cambio' : `${n} cambios`);

/**
 * Una frase con el estado de la sincronización.
 * @param {SyncStatus} status
 */
export function syncStatusText(status) {
  if (status.running) return 'Enviando cambios a la nube…';
  if (status.lastError) {
    const pending = status.pending > 0 ? ` Quedan ${changesText(status.pending)} por enviar; están guardados en este dispositivo.` : '';
    return `${status.lastError.message}${pending}`;
  }
  if (status.pending > 0) return `${changesText(status.pending)} por enviar…`;
  if (status.lastSuccessAt) return `Todo enviado a la nube. Último envío: ${shortTime(status.lastSuccessAt).replace(/\.$/, '')}.`;
  return 'Activada: cada cambio se envía a la nube poco después de guardarlo.';
}

/**
 * @param {SyncApi | null | undefined} sync
 */
export function cloudPanel(sync) {
  if (!sync) return '';
  const { enabled, status } = sync.state();
  if (!enabled) {
    return html`<section class="panel" aria-labelledby="set-cloud" id="cloud-panel" data-cloud="off">
      <h2 class="panel__title" id="set-cloud">Copia en la nube</h2>
      <p>Guarda tus espacios en tu cuenta para no perderlos si este dispositivo se daña o se pierde. Viajan por una conexión cifrada y solo tu cuenta puede leerlos. <strong>Los datos de demostración no se suben.</strong></p>
      <ol class="plain-list">
        <li>Descarga una copia de seguridad, por si acaso.</li>
        <li>Activa la copia en la nube: subo tus datos y al final compruebo que la nube tiene exactamente lo mismo que este dispositivo.</li>
      </ol>
      <div class="actions actions--start">
        <button type="button" class="btn btn--ghost" data-action="export-full">${icon('download', 18)}1. Descargar copia de seguridad</button>
        <button type="button" class="btn btn--primary" data-action="cloud-enable">${icon('upload', 18)}2. Activar copia en la nube</button>
      </div>
      <p class="hint">¿Ya usas ACCONTROL con esta cuenta en otro dispositivo? Al activarla aquí se juntan: verás los espacios de los dos. Si un mismo dato cambió en los dos, se queda el cambio más reciente.</p>
    </section>`;
  }
  return html`<section class="panel" aria-labelledby="set-cloud" id="cloud-panel" data-cloud="on">
    <h2 class="panel__title" id="set-cloud">Copia en la nube <span class="chip chip--good">Activada</span></h2>
    <p class="cloud-status" id="cloud-status" role="status" aria-live="polite">${syncStatusText(status)}</p>
    <div class="actions actions--start">
      <button type="button" class="btn btn--ghost" data-action="cloud-sync-now">${icon('upload', 18)}Sincronizar ahora</button>
    </div>
    <p class="hint">Cada cambio se guarda primero en este dispositivo y se envía solo poco después. Sin internet, espera y se envía cuando vuelva la conexión. Lo que cambies en tus otros dispositivos llega aquí solo: al abrir la app y cada pocos minutos. Los datos de demostración no se suben.</p>
  </section>`;
}

/**
 * Actualiza el texto del estado sin redibujar la pantalla. Devuelve cómo dejar de escuchar.
 * @param {SyncApi | null | undefined} sync @param {HTMLElement} root @param {() => void} rerender
 */
export function watchCloudPanel(sync, root, rerender) {
  if (!sync) return () => {};
  let wasEnabled = sync.state().enabled;
  return sync.onChange(() => {
    const { enabled, status } = sync.state();
    if (enabled !== wasEnabled) {
      wasEnabled = enabled;
      rerender();
      return;
    }
    const el = root.querySelector('#cloud-status');
    if (el) el.textContent = syncStatusText(status);
  });
}

/**
 * @param {SyncApi | null | undefined} sync
 * @param {string | undefined} action
 * @param {{ store: Store, rerender: () => void, button?: HTMLElement }} ctx
 * @returns {boolean} true si la acción era de la nube (y se atendió)
 */
export function runCloudAction(sync, action, ctx) {
  if (!sync || !action?.startsWith('cloud-') && action !== 'clear-device' && action !== 'clear-everywhere') return false;
  if (action === 'cloud-enable') void enableCloud(sync, ctx);
  else if (action === 'cloud-sync-now') void sync.syncNow();
  else if (action === 'clear-device') void clearDevice(sync, ctx.store);
  else if (action === 'clear-everywhere') void clearEverywhere(sync, ctx.store);
  else return false;
  return true;
}

/** @param {SyncApi} sync @param {{ store: Store, rerender: () => void, button?: HTMLElement }} ctx */
async function enableCloud(sync, ctx) {
  const n = ctx.store.getState().workspaces.length;
  // ¿La cuenta ya tiene espacios en la nube (de otro dispositivo)? Entonces se avisa de que se juntarán.
  const remote = await sync.inspectCloud();
  if (!remote.ok) {
    toast(`${remote.message} No se activó la copia en la nube.`, 'error');
    return;
  }
  const r = remote.workspaces.length;
  const join = r > 0
    ? ` Tu cuenta ya tiene en la nube ${r === 1 ? 'un espacio' : `${r} espacios`} (${quoteList(remote.workspaces)}): se juntarán con los de aquí. Si un mismo dato cambió en los dos lados, se queda el cambio más reciente.`
    : '';
  const ok = await confirmDialog({
    title: '¿Activar la copia en la nube?',
    message: `Voy a subir ${n === 1 ? 'tu espacio' : `tus ${n} espacios`} con sus datos reales (los de demostración no) y luego compruebo que llegaron completos.${join} Si todavía no descargaste una copia de seguridad, cancela y usa primero el botón 1.`,
    confirmLabel: r > 0 ? 'Activar y juntar mis datos' : 'Activar y subir mis datos',
  });
  if (!ok) return;
  const button = ctx.button;
  if (button) {
    button.setAttribute('disabled', '');
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Subiendo y comprobando…';
  }
  const result = await sync.enable();
  if (result.ok) {
    const down = result.downloaded > 0 ? ` ${result.downloaded === 1 ? 'Llegó 1 registro' : `Llegaron ${result.downloaded} registros`} de la nube.` : '';
    const both = result.conflicts > 0 ? ` ${conflictText(result.conflicts)}` : '';
    const shared = result.sharedAdded.length > 0
      ? ` ${result.sharedAdded.length === 1 ? 'Ya tienes acceso al espacio compartido' : 'Ya tienes acceso a los espacios compartidos'} ${quoteList(result.sharedAdded)}: lo verás en tu lista de espacios.`
      : '';
    toast(`Copia en la nube activada: ${result.records === 1 ? '1 registro subido' : `${result.records} registros subidos`} y comprobados.${down}${shared}${both}`);
    if (result.downloaded + result.addedWorkspaces.length + result.sharedAdded.length > 0) await ctx.store.refresh();
  } else {
    toast(result.message, 'error');
  }
  ctx.rerender();
}

/** @param {SyncApi} sync @param {Store} store */
async function clearDevice(sync, store) {
  const ok = await confirmDialog({
    title: '¿Borrar tus datos de este dispositivo?',
    message: 'Se eliminarán de ESTE dispositivo todos tus espacios y lo que contienen, y este dispositivo dejará de sincronizar. Tus datos siguen guardados en la nube: para traerlos de vuelta, activa otra vez la copia en la nube.',
    confirmLabel: 'Borrar de este dispositivo',
    danger: true,
    requireText: 'BORRAR',
  });
  if (!ok) return;
  // Primero se apaga la sincronización: así el borrado local NO se envía a la nube.
  sync.disableOnThisDevice();
  const result = await store.clearAllData();
  if (result.ok) toast('Tus datos se borraron de este dispositivo. En la nube siguen guardados.');
  else toast(result.errors.form ?? 'No se pudo borrar.', 'error');
}

/**
 * Aviso para los espacios que otras personas comparten contigo: no son tuyos, así que no se borran en la nube.
 * @param {Store} store
 */
function sharedNote(store) {
  const shared = store.getState().workspaces.filter((w) => w.role);
  if (shared.length === 0) return '';
  return ` Los espacios que otras personas comparten contigo (${shared.map((w) => `«${w.name}»`).join(', ')}) NO se borran: son de su dueño y volverán a aparecer mientras sigas siendo miembro.`;
}

/** @param {SyncApi} sync @param {Store} store */
async function clearEverywhere(sync, store) {
  const ok = await confirmDialog({
    title: '¿Borrar tus datos de TODOS tus dispositivos?',
    message: `Se eliminarán todos tus espacios y lo que contienen, en este dispositivo y en la nube (y por lo tanto en tus otros dispositivos). Necesitas conexión a internet. No se puede deshacer.${sharedNote(store)}`,
    confirmLabel: 'Borrar de todos mis dispositivos',
    danger: true,
    requireText: 'BORRAR',
  });
  if (!ok) return;
  // Primero la nube: si no hay conexión, no se borra nada en ningún lado.
  const cloud = await sync.clearEverywhere();
  if (!cloud.ok) {
    toast(cloud.message, 'error');
    return;
  }
  const result = await store.clearAllData();
  if (result.ok) toast('Tus datos se borraron de este dispositivo y de la nube.');
  else toast(result.errors.form ?? 'Se borró en la nube, pero no en este dispositivo. Vuelve a intentarlo.', 'error');
}

/**
 * El panel «Borrar todo»: con la copia en la nube activa, dos botones; si no, el de siempre.
 * @param {SyncApi | null | undefined} sync
 */
export function clearAllActions(sync) {
  if (!sync?.state().enabled) {
    return html`<button type="button" class="btn btn--danger" data-action="clear-all">${icon('trash', 18)}Borrar todos mis datos</button>`;
  }
  return html`<button type="button" class="btn btn--danger" data-action="clear-device">${icon('trash', 18)}Borrar de este dispositivo</button>
    <button type="button" class="btn btn--danger" data-action="clear-everywhere">${icon('trash', 18)}Borrar de todos mis dispositivos</button>`;
}

/**
 * La pregunta que se hace UNA sola vez por cuenta y dispositivo: «¿Guardar tus datos en la nube?».
 * No interrumpe un recorrido guiado, otra ventana abierta ni la pantalla de elegir modalidad: en ese caso devuelve
 * 'later' y quien llama vuelve a intentarlo más tarde.
 * @param {SyncApi | null | undefined} sync
 * @param {() => boolean} [ready] true cuando ya hay un espacio abierto en pantalla.
 * @returns {Promise<'done' | 'later'>}
 */
export async function askAboutCloudOnce(sync, ready = () => true) {
  if (!sync) return 'done';
  const { enabled, asked } = sync.state();
  if (enabled || asked) return 'done';
  if (!ready() || document.querySelector('dialog[open]')) return 'later';
  sync.markAsked();
  const yes = await confirmDialog({
    title: '¿Guardar tus datos en la nube?',
    message: 'Con la copia en la nube tus espacios quedan guardados en tu cuenta, por si este dispositivo se daña o se pierde. Tú decides: se activa en Ajustes → «Copia en la nube», donde antes te ofrezco descargar una copia de seguridad. No volveré a preguntarte.',
    confirmLabel: 'Sí, ver cómo',
    cancelLabel: 'Ahora no',
  });
  if (!yes) return 'done';
  window.location.hash = '#/ajustes';
  // Cuando Ajustes esté dibujado, se lleva la vista a la sección.
  setTimeout(() => document.getElementById('cloud-panel')?.scrollIntoView({ block: 'start' }), 350);
  return 'done';
}

/** @param {number} n */
export const conflictText = (n) =>
  n === 1
    ? 'Un dato había cambiado en dos dispositivos: se quedó el cambio más reciente.'
    : `${n} datos habían cambiado en dos dispositivos: en cada uno se quedó el cambio más reciente.`;

/** @param {string[]} names */
function quoteList(names) {
  return names.map((x) => `«${x}»`).join(', ');
}

/**
 * El aviso cuando llega algo de otro dispositivo (null si no hace falta decir nada: los cambios normales solo se ven).
 * @param {import('../sync/pull.js').PullResult} result
 * @returns {string | null}
 */
export function remoteNotice(result) {
  /** @type {string[]} */
  const parts = [];
  if (result.addedWorkspaces.length > 0) {
    parts.push(`${result.addedWorkspaces.length === 1 ? 'Llegó el espacio' : 'Llegaron los espacios'} ${quoteList(result.addedWorkspaces)} desde tu otro dispositivo.`);
  }
  if (result.removedWorkspaces.length > 0) {
    parts.push(`${result.removedWorkspaces.length === 1 ? 'Se quitó el espacio' : 'Se quitaron los espacios'} ${quoteList(result.removedWorkspaces)} de este dispositivo porque se borró en otro.`);
  }
  const shared = result.sharedAdded ?? [];
  if (shared.length > 0) {
    parts.push(`${shared.length === 1 ? 'Ya tienes acceso al espacio compartido' : 'Ya tienes acceso a los espacios compartidos'} ${quoteList(shared)}.`);
  }
  const lost = result.lostAccess ?? [];
  if (lost.length > 0) {
    parts.push(`Ya no tienes acceso ${lost.length === 1 ? 'al espacio' : 'a los espacios'} ${quoteList(lost)} (te quitaron o su dueño lo borró): se quitó de este dispositivo.`);
  }
  for (const change of result.roleChanges ?? []) parts.push(`Tu rol en «${change.name}» ahora es ${ROLE_NAMES[change.role]}.`);
  if (result.conflicts > 0) parts.push(conflictText(result.conflicts));
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Nombre de cada rol para mostrar (0.16.0). Vive en domain/roles.js; se reexporta para quien ya lo importaba de aquí. */
export { ROLE_NAMES };

/**
 * En un dispositivo SIN espacios y con la copia apagada: si la cuenta tiene espacios en la nube, ofrece traerlos
 * (antes de que la persona cree uno nuevo vacío). Devuelve 'restored', 'declined' o 'none' (no había nada, o no se
 * pudo preguntar a la nube).
 * @param {SyncApi | null | undefined} sync
 * @param {Store} store
 * @param {string} [accountEmail]  correo de la cuenta abierta: se muestra para que se vea de quién es la nube
 * @returns {Promise<'restored' | 'declined' | 'none'>}
 */
export async function offerCloudRestore(sync, store, accountEmail = '') {
  if (!sync || sync.state().enabled || store.getState().workspaces.length > 0) return 'none';
  const remote = await sync.inspectCloud();
  if (!remote.ok || remote.workspaces.length === 0) return 'none';
  if (store.getState().workspaces.length > 0) return 'none'; // mientras tanto la persona ya creó uno
  const n = remote.workspaces.length;
  const yes = await confirmDialog({
    title: 'Tus datos están en la nube',
    message: `${accountEmail ? `La cuenta ${accountEmail}` : 'Tu cuenta'} tiene ${n === 1 ? 'un espacio guardado' : `${n} espacios guardados`} en la nube (${quoteList(remote.workspaces)}). ¿Los traigo a este dispositivo? Desde ese momento este dispositivo también sincroniza.`,
    confirmLabel: 'Traer mis datos',
    cancelLabel: 'Empezar de cero aquí',
  });
  if (!yes) return 'declined';
  const result = await sync.enable();
  if (!result.ok) {
    toast(result.message, 'error');
    return 'none';
  }
  await store.refresh();
  toast(`Listo: ${result.workspaces === 1 ? 'tu espacio está' : `tus ${result.workspaces} espacios están`} en este dispositivo y sincronizando.`);
  return 'restored';
}
