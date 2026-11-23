// @ts-check
// =============================================================================
// CUENTA (en Ajustes): sesión abierta, cambiar contraseña, eliminar la cuenta
// -----------------------------------------------------------------------------
// Las pantallas no hablan con el servidor de cuentas: usan el objeto `account` que arma main.js.
// =============================================================================

import { PASSWORD_HINT } from '../domain/accounts.js';
import { passwordInput } from '../ui/passwordToggle.js';
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
        : html`se guardan <strong>solo en este dispositivo</strong> mientras no actives la <strong>copia en la nube</strong> (más abajo). Al activarla, tus otros dispositivos con esta cuenta ven los mismos datos.`}</li>
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
        ${passwordInput({ id: 'pw-current', name: 'currentPassword', autocomplete: 'current-password', describedBy: 'pw-current-error', label: 'contraseña actual', autofocus: true })}
        <p class="field__error" id="pw-current-error" data-error-for="currentPassword" hidden></p>
      </div>
      <div class="field" data-field="password">
        <label for="pw-new">Contraseña nueva</label>
        ${passwordInput({ id: 'pw-new', name: 'password', autocomplete: 'new-password', describedBy: 'pw-new-hint pw-new-error', label: 'contraseña nueva' })}
        <p class="hint" id="pw-new-hint">${PASSWORD_HINT}</p>
        <p class="field__error" id="pw-new-error" data-error-for="password" hidden></p>
      </div>
      <div class="field" data-field="password2">
        <label for="pw-new2">Repite la contraseña nueva</label>
        ${passwordInput({ id: 'pw-new2', name: 'password2', autocomplete: 'new-password', describedBy: 'pw-new2-error', label: 'contraseña repetida' })}
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

/** Segundos antes de poder pedir otro código (como al crear la cuenta). */
const RESEND_WAIT_MS = 60_000;

/**
 * Eliminar la cuenta (0.20.3, pedido de la persona): 1) aviso donde hay que escribir «ELIMINAR»; 2) ACCONTROL manda
 * un código al correo de la cuenta; 3) al escribirlo se borra. Sin acceso a ese correo no se puede borrar (el servidor
 * también lo exige: supabase/migrations/20261127000100_borrar_cuenta_con_correo.sql).
 * @param {AccountApi} account
 */
async function deleteAccount(account) {
  const ok = await confirmDialog({
    title: '¿Eliminar tu cuenta?',
    message: `Se borrará la cuenta ${account.email} y todo lo que tenga en el servidor, y no podrás volver a entrar con ella. Los datos guardados en este dispositivo no se borran. No se puede deshacer. Para confirmar, te enviaremos un código a tu correo.`,
    confirmLabel: 'Enviarme el código',
    danger: true,
    requireText: 'ELIMINAR',
  });
  if (!ok) return;
  const step = await askDeletionCode(account, Date.now());
  if (step.kind === 'error') {
    toast(step.error, 'error');
    return;
  }
  openDeletionCodeSheet(account, step.notice);
}

/** Cuándo se pidió el último código para eliminar, por correo (en esta pestaña). @type {Map<string, number>} */
const lastCodeAt = new Map();

/** Aviso cuando ya hay un código reciente en el correo. */
export const RECENT_CODE_NOTICE = 'Hace un momento te enviamos un código: usa ese (mira también en spam). Si no llegó, podrás pedir otro en un minuto.';

/**
 * Pide el código para eliminar SIN pasarse del límite de Supabase (un correo por dirección cada 60 s): si se pidió
 * hace menos de un minuto, no pide otro y avisa que use ese; si Supabase dice «espera», también sigue con el anterior.
 * @param {AccountApi} account
 * @param {number} nowMs
 * @returns {Promise<{ kind: 'sent', notice: string } | { kind: 'error', error: string }>}
 */
export async function askDeletionCode(account, nowMs) {
  const before = lastCodeAt.get(account.email);
  if (before !== undefined && nowMs - before < RESEND_WAIT_MS) return { kind: 'sent', notice: RECENT_CODE_NOTICE };
  const sent = await account.requestDeletionCode();
  if (sent.ok) {
    lastCodeAt.set(account.email, nowMs);
    return { kind: 'sent', notice: '' };
  }
  if (sent.rateLimited) return { kind: 'sent', notice: RECENT_CODE_NOTICE };
  return { kind: 'error', error: sent.error };
}

/** Solo para pruebas: olvida cuándo se pidieron los códigos. */
export function forgetDeletionCodes() {
  lastCodeAt.clear();
}

/**
 * Lo que pasa al escribir el código (sin tocar la pantalla, para poder probarlo): primero se comprueba el código y
 * solo si vale se borra la cuenta.
 * @param {AccountApi} account
 * @param {string} code
 * @returns {Promise<{ ok: true } | { ok: false, errors: Record<string, string> }>}
 */
export async function submitDeletionCode(account, code) {
  const confirmed = await account.confirmDeletionCode(code);
  if (!confirmed.ok) return { ok: false, errors: { code: confirmed.error } };
  const result = await account.deleteAccount();
  return result.ok ? result : { ok: false, errors: { form: result.error } };
}

/** Formulario «Confirma en tu correo» (0.20.3). @param {string} email @param {string} [notice] */
export function deletionCodeForm(email, notice = '') {
  return html`<form class="stack" data-form="delete-code" novalidate>
      <p>Te enviamos un correo a <strong>${email}</strong> con un <strong>código de 6 dígitos</strong> para confirmar que quieres <strong>eliminar tu cuenta</strong>. Si no lo ves, mira en spam.</p>
      ${notice ? html`<p class="hint" role="status" data-code-notice>${notice}</p>` : ''}
      <div class="field" data-field="code">
        <label for="del-code">Código del correo</label>
        <input id="del-code" name="code" class="input otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000-000" autocapitalize="none" spellcheck="false" aria-describedby="del-code-hint del-code-error" autofocus />
        <p class="hint" id="del-code-hint">El código vale unos minutos. Si tú no pediste eliminar tu cuenta, cierra esto y cambia tu contraseña.</p>
        <p class="field__error" id="del-code-error" data-error-for="code" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-resend-code disabled>Reenviar código</button>
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--danger">Eliminar mi cuenta</button>
      </div>
    </form>`;
}

/** @param {AccountApi} account @param {string} [notice] */
function openDeletionCodeSheet(account, notice = '') {
  openSheet({
    title: 'Confirma en tu correo',
    content: deletionCodeForm(account.email, notice),
    onMount: (sheet) => {
      const form = sheet.querySelector('form');
      const resend = sheet.querySelector('[data-resend-code]');
      if (!(form instanceof HTMLFormElement) || !(resend instanceof HTMLButtonElement)) return;
      const waitThenAllow = () => {
        resend.disabled = true;
        setTimeout(() => { resend.disabled = false; }, RESEND_WAIT_MS);
      };
      waitThenAllow();
      resend.addEventListener('click', async () => {
        waitThenAllow();
        const again = await account.requestDeletionCode();
        if (again.ok) lastCodeAt.set(account.email, Date.now());
        toast(again.ok ? 'Te enviamos otro código.' : again.rateLimited ? RECENT_CODE_NOTICE : again.error, again.ok ? undefined : 'error');
      });
      let working = false;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (working) return;
        clearErrors(form);
        working = true;
        setBusy(form, true);
        const result = await submitDeletionCode(account, readForm(form).code ?? '');
        working = false;
        // Al borrarse la cuenta la sesión se cierra y la página se recarga sola; solo se avisa si algo falló.
        if (!result.ok) {
          setBusy(form, false);
          showErrors(form, result.errors);
        }
      });
    },
  });
}
