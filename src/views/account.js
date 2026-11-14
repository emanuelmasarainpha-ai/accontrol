// @ts-check
// =============================================================================
// CUENTA (en Ajustes): sesión abierta, cambiar contraseña, eliminar la cuenta
// -----------------------------------------------------------------------------
// Las pantallas no hablan con el servidor de cuentas: usan el objeto `account` que arma main.js.
// =============================================================================

import { PASSWORD_HINT } from '../domain/accounts.js';
import { eyeToggle } from '../ui/passwordToggle.js';
import { confirmDialog, openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

/** @typedef {import('../app/app.js').AccountApi} AccountApi */

/** @param {AccountApi | null} account */
export function accountPanel(account) {
  if (!account) {
    return html`<section class="panel" aria-labelledby="set-account">
      <h2 class="panel__title" id="set-account">Cuenta</h2>
      <p>Esta copia de ACCONTROL funciona <strong>sin cuenta</strong>: no está conectada a ningún servidor y todo se guarda solo en este dispositivo.</p>
    </section>`;
  }
  return html`<section class="panel" aria-labelledby="set-account">
    <h2 class="panel__title" id="set-account">Cuenta</h2>
    <p>Sesión iniciada como <strong data-account-email>${account.email}</strong>.</p>
    <ul class="plain-list">
      <li><strong>Tus datos:</strong> ${account.sync?.state().enabled
        ? html`se guardan <strong>en este dispositivo y en la nube</strong> (copia en la nube activada, más abajo).`
        : html`se guardan <strong>solo en este dispositivo</strong> mientras no actives la <strong>copia en la nube</strong> (más abajo). Ver tus datos en otro dispositivo llega en el siguiente paso de esta versión; hasta entonces, usa la copia de seguridad para pasar datos.`}</li>
      <li><strong>Al cerrar sesión</strong> los datos de este dispositivo se conservan: los verás de nuevo al entrar con esta misma cuenta. Otra cuenta que entre aquí no los ve.</li>
    </ul>
    <div class="actions actions--start">
      <button type="button" class="btn btn--ghost" data-action="account-password">${icon('lock', 18)}Cambiar contraseña</button>
      <button type="button" class="btn btn--primary" data-action="account-signout">Cerrar sesión</button>
    </div>
  </section>`;
}

/** @param {AccountApi | null} account */
export function accountDangerPanel(account) {
  if (!account) return '';
  return html`<section class="panel panel--danger" aria-labelledby="set-account-delete">
    <h2 class="panel__title" id="set-account-delete">Eliminar mi cuenta</h2>
    <p>Borra tu cuenta (<strong>${account.email}</strong>) y todo lo que tenga en el servidor. <strong>No borra los datos guardados en este dispositivo</strong>: para eso usa «Borrar todo», más arriba. No se puede deshacer.</p>
    <div class="actions actions--start">
      <button type="button" class="btn btn--danger" data-action="account-delete">${icon('trash', 18)}Eliminar mi cuenta</button>
    </div>
  </section>`;
}

/**
 * @param {AccountApi | null} account
 * @param {string | undefined} action  Valor de data-action
 * @returns {boolean} true si la acción era de la cuenta (y se atendió)
 */
export function runAccountAction(account, action) {
  if (!account || !action?.startsWith('account-')) return false;
  if (action === 'account-signout') void account.signOut();
  else if (action === 'account-password') openPasswordForm(account);
  else if (action === 'account-delete') void deleteAccount(account);
  else return false;
  return true;
}

/** Formulario «Cambiar contraseña»: contraseña actual, nueva y repetir la nueva. */
export function passwordForm() {
  return html`<form class="stack" data-form="password" novalidate>
      <div class="field" data-field="currentPassword">
        <label for="pw-current">Contraseña actual</label>
        <div class="input-row"><input id="pw-current" name="currentPassword" class="input" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" data-autofocus aria-describedby="pw-current-error" />${eyeToggle('pw-current', 'contraseña actual')}</div>
        <p class="field__error" id="pw-current-error" data-error-for="currentPassword" hidden></p>
      </div>
      <div class="field" data-field="password">
        <label for="pw-new">Contraseña nueva</label>
        <div class="input-row"><input id="pw-new" name="password" class="input" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" aria-describedby="pw-new-hint pw-new-error" />${eyeToggle('pw-new', 'contraseña nueva')}</div>
        <p class="hint" id="pw-new-hint">${PASSWORD_HINT}</p>
        <p class="field__error" id="pw-new-error" data-error-for="password" hidden></p>
      </div>
      <div class="field" data-field="password2">
        <label for="pw-new2">Repite la contraseña nueva</label>
        <div class="input-row"><input id="pw-new2" name="password2" class="input" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" aria-describedby="pw-new2-error" />${eyeToggle('pw-new2', 'contraseña repetida')}</div>
        <p class="field__error" id="pw-new2-error" data-error-for="password2" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">Guardar contraseña</button>
      </div>
    </form>`;
}

/**
 * Lo que pasa al pulsar «Guardar contraseña» (sin tocar la pantalla, para poder probarlo).
 * @param {AccountApi} account
 * @param {Record<string, string>} values  currentPassword, password, password2
 * @returns {Promise<{ ok: true } | { ok: false, errors: Record<string, string> }>}
 */
export async function submitPasswordChange(account, values) {
  const currentPassword = values.currentPassword ?? '';
  const newPassword = values.password ?? '';
  if (currentPassword === '') return { ok: false, errors: { currentPassword: 'Escribe tu contraseña actual.' } };
  if (newPassword !== (values.password2 ?? '')) return { ok: false, errors: { password2: 'Las dos contraseñas deben ser iguales.' } };
  const result = await account.changePassword({ currentPassword, newPassword });
  return result.ok ? result : { ok: false, errors: { [result.field ?? 'form']: result.error } };
}

/** @param {AccountApi} account */
function openPasswordForm(account) {
  openSheet({
    title: 'Cambiar contraseña',
    content: passwordForm(),
    onMount: (sheet, close) => {
      const form = sheet.querySelector('form');
      if (!(form instanceof HTMLFormElement)) return;
      let working = false;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (working) return;
        const values = readForm(form);
        clearErrors(form);
        working = true;
        setBusy(form, true);
        const result = await submitPasswordChange(account, values);
        working = false;
        setBusy(form, false);
        if (result.ok) {
          close();
          toast('Contraseña cambiada.');
        } else {
          showErrors(form, result.errors);
        }
      });
    },
  });
}

/** @param {AccountApi} account */
async function deleteAccount(account) {
  const ok = await confirmDialog({
    title: '¿Eliminar tu cuenta?',
    message: `Se borrará la cuenta ${account.email} y todo lo que tenga en el servidor, y no podrás volver a entrar con ella. Los datos guardados en este dispositivo no se borran. No se puede deshacer.`,
    confirmLabel: 'Eliminar mi cuenta',
    danger: true,
    requireText: 'ELIMINAR',
  });
  if (!ok) return;
  const result = await account.deleteAccount();
  // Al borrarse la cuenta la sesión se cierra y la página se recarga sola; solo se avisa si algo falló.
  if (!result.ok) toast(result.error, 'error');
}
