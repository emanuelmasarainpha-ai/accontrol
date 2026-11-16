// @ts-check
// =============================================================================
// MIEMBROS DE UN ESPACIO (0.16.0, paso 5)
// -----------------------------------------------------------------------------
// En Ajustes, para el espacio abierto: quién está, invitar con un código que copias y envías tú, cambiar el rol,
// quitar a alguien y anular invitaciones. Y, en «Espacios de trabajo», unirte a un espacio con un código o salir de uno
// que te compartieron. Todo pasa por la nube (account.sync.share); sin la copia en la nube activada no se comparte.
// =============================================================================

import { todayISO, formatDate } from '../domain/dates.js';
import { ROLE_NAMES, roleLabel, roleOf } from '../domain/roles.js';
import {
  hasAnyAccess, LEVEL_HELP, LEVEL_NAMES, LEVELS, MAX_CUSTOM_ROLES, MODULES, normalizePermissions, permissionSummary, TEMPLATES, validateRoleName,
} from '../domain/permissions.js';
import { canRevoke, invitableRoles, inviteMessage, isShareable, memberActions, normalizeInviteCode, ROLE_HELP } from '../domain/sharing.js';
import { confirmDialog, openSheet } from '../ui/dialog.js';
import { $ } from '../ui/dom.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { haptic } from '../ui/haptics.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../sync/syncController.js').SyncApi} SyncApi */
/** @typedef {import('../sync/syncController.js').Member} Member */
/** @typedef {import('../sync/syncController.js').Invite} Invite */
/** @typedef {import('../sync/syncController.js').RoleDefinition} RoleDefinition */
/** @typedef {import('../domain/permissions.js').Permissions} Permissions */
/** @typedef {import('../domain/types.js').Workspace} Workspace */

/** Fecha y hora de la nube → «21 nov 2026» (en la hora de este dispositivo). @param {string} at */
const day = (at) => formatDate(todayISO(new Date(at)));
/** «14 nov 2026, 10:32» (para distinguir dos invitaciones del mismo día). @param {string} at */
const moment = (at) => `${day(at)}, ${new Date(at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}`;

/**
 * Lo último que se leyó de cada espacio: así, si la pantalla se vuelve a dibujar (pasa a menudo), la lista no parpadea
 * ni se pide otra vez a la nube cada vez.
 * @type {Map<string, { at: number, members: Member[], invites: Invite[], roles: RoleDefinition[] }>}
 */
const cache = new Map();
const FRESH_MS = 20_000;

// ---- Panel de Ajustes -------------------------------------------------------------------------------------------

/**
 * La sección «Miembros» del espacio abierto. Sin cuenta no aparece.
 * @param {Store} store @param {SyncApi | null | undefined} sync
 */
export function membersPanel(store, sync) {
  const workspace = store.activeWorkspace();
  if (!sync || !workspace) return '';
  const head = html`<h2 class="panel__title" id="set-members">Miembros de «${workspace.name}»</h2>`;
  if (!isShareable(workspace)) {
    return html`<section class="panel" aria-labelledby="set-members" data-members="personal">
      ${head}
      <p class="panel__sub">El espacio Personal es solo tuyo y no se comparte. Para trabajar con otras personas (un socio, tu contador) crea un espacio Freelancer, Emprendedor o Empresa.</p>
    </section>`;
  }
  if (!sync.state().enabled) {
    return html`<section class="panel" aria-labelledby="set-members" data-members="off">
      ${head}
      <p class="panel__sub">Para invitar a otras personas a este espacio, primero activa la <strong>copia en la nube</strong> (más abajo, en «Copia en la nube»): lo compartido viaja por la nube.</p>
    </section>`;
  }
  const roles = invitableRoles(workspace);
  return html`<section class="panel" aria-labelledby="set-members" data-members="on">
    <div class="panel__head">
      ${head}
      ${roles.length > 0 ? html`<button type="button" class="btn btn--ghost btn--small" data-action="member-invite">${icon('plus', 16)}Invitar</button>` : ''}
    </div>
    <p class="panel__sub">${roleOf(workspace) === 'owner'
      ? 'Eres el dueño. Invita con un código que copias y envías tú (ACCONTROL no envía mensajes). Cada código sirve una vez y vence en 7 días.'
      : `Estás aquí como ${roleLabel(workspace)}. El espacio es de su dueño.`}</p>
    <div data-members-body aria-live="polite">${cachedBody(workspace)}</div>
  </section>`;
}

/** @param {Workspace} workspace */
function cachedBody(workspace) {
  const hit = cache.get(workspace.id);
  return hit ? listBody(workspace, hit.members, hit.invites, hit.roles) : html`<p class="muted" role="status">Cargando miembros…</p>`;
}

/**
 * @param {Workspace} workspace @param {Member[]} members @param {Invite[]} invites @param {RoleDefinition[]} roles
 */
function listBody(workspace, members, invites, roles) {
  const myRole = roleOf(workspace);
  const roleName = (/** @type {string | null} */ id) => roles.find((r) => r.id === id)?.name ?? ROLE_NAMES.custom;
  return html`<ul class="member-list" role="list">
      ${members.map((m) => {
        const can = memberActions(myRole, m);
        const name = m.displayName || m.email || 'Aún sin nombre en su perfil';
        return html`<li class="member" data-member="${m.userId}">
          <span class="member__who">
            <span class="member__name">${name}${m.isMe ? html` <span class="muted">(tú)</span>` : ''}</span>
            ${m.email && m.email !== name ? html`<span class="member__mail">${m.email}</span>` : ''}
          </span>
          <span class="member__actions">
            ${can.changeRole
              ? html`<label class="sr-only" for="role-${m.userId}">Rol de ${name}</label>
                <select id="role-${m.userId}" class="input input--small" data-member-role data-user="${m.userId}" data-name="${name}">
                  <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Administrador</option>
                  <option value="accountant" ${m.role === 'accountant' ? 'selected' : ''}>Contador</option>
                  ${roles.map((r) => html`<option value="custom:${r.id}" ${m.role === 'custom' && m.customRoleId === r.id ? 'selected' : ''}>${r.name}</option>`)}
                </select>`
              : html`<span class="chip${m.role === 'owner' ? ' chip--good' : ''}">${m.role === 'custom' ? m.customRoleName ?? ROLE_NAMES.custom : ROLE_NAMES[m.role]}</span>`}
            ${can.remove ? html`<button type="button" class="btn btn--danger-ghost btn--small" data-action="member-remove" data-user="${m.userId}" data-name="${name}">Quitar</button>` : ''}
          </span>
        </li>`;
      })}
    </ul>
    ${invites.length > 0
      ? html`<h3 class="indicator-group__title">Invitaciones pendientes</h3>
        <ul class="member-list" role="list">
          ${invites.map((i) => html`<li class="member" data-invite="${i.id}">
            <span class="member__who"><span class="member__name">${i.role === 'custom' ? roleName(i.customRoleId) : ROLE_NAMES[i.role]}</span><span class="member__mail">Creada el ${moment(i.createdAt)} · vence el ${day(i.expiresAt)}</span></span>
            <span class="member__actions">${canRevoke(myRole, i) ? html`<button type="button" class="btn btn--ghost btn--small" data-action="invite-revoke" data-id="${i.id}">Anular</button>` : ''}</span>
          </li>`)}
        </ul>`
      : ''}
    ${myRole === 'owner' ? rolesSection(roles) : ''}`;
}

/**
 * Los roles a medida del espacio (solo el dueño los ve y los cambia).
 * @param {RoleDefinition[]} roles
 */
function rolesSection(roles) {
  return html`<div class="panel__head roles-head">
      <h3 class="indicator-group__title">Roles a medida</h3>
      ${roles.length < MAX_CUSTOM_ROLES ? html`<button type="button" class="btn btn--ghost btn--small" data-action="role-new">${icon('plus', 16)}Nuevo rol</button>` : ''}
    </div>
    <p class="hint">Arma los roles de tu empresa (por ejemplo «Cajero») eligiendo qué puede hacer en cada parte de la app. Hasta ${MAX_CUSTOM_ROLES} roles.</p>
    ${roles.length > 0
      ? html`<ul class="member-list" role="list">
        ${roles.map((r) => html`<li class="member" data-role="${r.id}">
          <span class="member__who"><span class="member__name">${r.name}</span><span class="member__mail">${permissionSummary(r.permissions)}</span></span>
          <span class="member__actions">
            <button type="button" class="btn btn--ghost btn--small" data-action="role-edit" data-id="${r.id}">Editar</button>
            <button type="button" class="btn btn--danger-ghost btn--small" data-action="role-delete" data-id="${r.id}" data-name="${r.name}">Borrar</button>
          </span>
        </li>`)}
      </ul>`
      : html`<p class="muted">Todavía no hay roles a medida.</p>`}`;
}

/**
 * Carga la lista (si hace falta) y conecta los cambios de rol. Lo llama Ajustes al montar.
 * @param {HTMLElement} root @param {Store} store @param {SyncApi | null | undefined} sync @param {AbortSignal} signal
 */
export function watchMembers(root, store, sync, signal) {
  const panel = root.querySelector('[data-members="on"]');
  const workspace = store.activeWorkspace();
  if (!sync || !panel || !workspace) return;
  const hit = cache.get(workspace.id);
  if (!hit || Date.now() - hit.at > FRESH_MS) void reloadMembers(root, store, sync);
  panel.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.hasAttribute('data-member-role')) return;
    void changeRole(root, store, sync, select);
  }, { signal });
}

/** @param {HTMLElement} root @param {Store} store @param {SyncApi} sync */
async function reloadMembers(root, store, sync) {
  const workspace = store.activeWorkspace();
  if (!workspace) return;
  const result = await sync.share.list(workspace.id);
  const body = root.querySelector('[data-members-body]');
  if (!(body instanceof HTMLElement) || !body.isConnected || store.activeWorkspace()?.id !== workspace.id) return;
  if (!result.ok) {
    setHtml(body, html`<p class="field__error" role="alert">${result.message}</p>`);
    return;
  }
  // Los roles a medida solo hacen falta para administrar (dueño); los demás no los ven aquí.
  const listed = roleOf(workspace) === 'owner' ? await sync.share.roles(workspace.id) : { ok: true, roles: [] };
  const roles = listed.ok ? listed.roles : [];
  if (!body.isConnected || store.activeWorkspace()?.id !== workspace.id) return;
  cache.set(workspace.id, { at: Date.now(), members: result.members, invites: result.invites, roles });
  setHtml(body, listBody(workspace, result.members, result.invites, roles));
}

/** @param {HTMLElement} root @param {Store} store @param {SyncApi} sync @param {HTMLSelectElement} select */
async function changeRole(root, store, sync, select) {
  const workspace = store.activeWorkspace();
  if (!workspace) return;
  const custom = select.value.startsWith('custom:') ? select.value.slice(7) : null;
  const role = custom ? 'custom' : select.value === 'admin' ? 'admin' : 'accountant';
  const label = custom ? select.selectedOptions[0]?.textContent ?? ROLE_NAMES.custom : ROLE_NAMES[role];
  select.disabled = true;
  const result = await sync.share.setRole(workspace.id, select.dataset.user ?? '', role, custom);
  if (result.ok) toast(`Listo: ${select.dataset.name ?? 'esa persona'} ahora es ${label}. Lo verá en cuanto su app se sincronice.`);
  else toast(result.message, 'error');
  await reloadMembers(root, store, sync);
}

// ---- Botones ------------------------------------------------------------------------------------------------------

/**
 * Maneja los botones de compartir (de Miembros y de Espacios de trabajo). Devuelve true si era uno de ellos.
 * @param {{ store: Store, sync: SyncApi | null | undefined, root: HTMLElement }} ctx @param {HTMLElement} el
 */
export function runShareAction({ store, sync, root }, el) {
  switch (el.dataset.action) {
    case 'member-invite':
      if (sync) openInvite(store, sync, root);
      return true;
    case 'member-remove':
      if (sync) void removeMember(root, store, sync, el.dataset.user ?? '', el.dataset.name ?? 'esta persona');
      return true;
    case 'invite-revoke':
      if (sync) void revokeInvite(root, store, sync, el.dataset.id ?? '');
      return true;
    case 'role-new':
      if (sync) openRoleEditor(store, sync, root, null);
      return true;
    case 'role-edit':
      if (sync) openRoleEditor(store, sync, root, el.dataset.id ?? null);
      return true;
    case 'role-delete':
      if (sync) void deleteRole(root, store, sync, el.dataset.id ?? '', el.dataset.name ?? 'este rol');
      return true;
    case 'ws-join':
      openJoin(store, sync, root);
      return true;
    case 'ws-leave':
      void leaveWorkspace(store, sync, el.dataset.id ?? '');
      return true;
    default:
      return false;
  }
}

/** @param {Store} store @param {SyncApi} sync @param {HTMLElement} root */
function openInvite(store, sync, root) {
  const workspace = store.activeWorkspace();
  const roles = invitableRoles(workspace);
  if (!workspace || roles.length === 0) return;
  const custom = roleOf(workspace) === 'owner' ? cache.get(workspace.id)?.roles ?? [] : [];
  openSheet({
    title: `Invitar a «${workspace.name}»`,
    content: html`<form class="stack" data-form="invite" novalidate>
      <fieldset class="field" data-field="role">
        <legend class="field__label">¿Qué podrá hacer?</legend>
        <div class="kind-choices" role="radiogroup">
          ${roles.map((r, i) => html`<label class="kind-choice">
            <input type="radio" name="role" value="${r}" ${i === roles.length - 1 ? 'checked' : ''} />
            <span class="kind-choice__body"><span><strong>${ROLE_NAMES[r]}</strong><small>${ROLE_HELP[r]}</small></span></span>
          </label>`)}
          ${custom.map((r) => html`<label class="kind-choice">
            <input type="radio" name="role" value="custom:${r.id}" />
            <span class="kind-choice__body"><span><strong>${r.name}</strong><small>${permissionSummary(r.permissions)}</small></span></span>
          </label>`)}
        </div>
        ${roles.length === 1 ? html`<p class="hint">Como Administrador solo puedes invitar contadores; los administradores los invita el dueño.</p>` : ''}
      </fieldset>
      <p class="hint">Se crea un código que sirve <strong>una sola vez</strong> y vence en <strong>7 días</strong>. Lo copias y se lo envías tú (por WhatsApp o correo). Quien lo reciba necesita su propia cuenta de ACCONTROL.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">Crear código</button>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = $('form', sheet);
      if (!(form instanceof HTMLFormElement)) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const picked = readForm(form).role ?? '';
        const customId = picked.startsWith('custom:') ? picked.slice(7) : null;
        const role = customId ? 'custom' : picked === 'admin' ? 'admin' : 'accountant';
        const result = await sync.share.invite(workspace.id, role, customId);
        setBusy(form, false);
        if (!result.ok) {
          showErrors(form, { form: result.message });
          return;
        }
        close();
        void reloadMembers(root, store, sync);
        showCode(workspace.name, role, result.code, day(result.expiresAt), custom.find((r) => r.id === customId)?.name);
      });
    },
  });
}

/**
 * Muestra el código recién creado. Solo se ve AHORA: la nube guarda únicamente su huella.
 * @param {string} workspaceName @param {'admin' | 'accountant' | 'custom'} role @param {string} code @param {string} expires
 * @param {string} [roleName]  El nombre de un rol a medida.
 */
function showCode(workspaceName, role, code, expires, roleName) {
  const message = inviteMessage({ workspaceName, code, role, roleName, expires });
  openSheet({
    title: 'Código de invitación',
    content: html`<div class="stack">
      <p>Invitación como <strong>${roleName ?? ROLE_NAMES[role]}</strong> a «${workspaceName}». Vence el ${expires} y sirve una sola vez.</p>
      <p class="invite-code" data-invite-code>${code}</p>
      <p class="hint"><strong>Cópialo ahora:</strong> por seguridad, este código no se vuelve a mostrar. Si lo pierdes, anúlalo y crea otro.</p>
      <label for="invite-text">Mensaje para enviar</label>
      <textarea id="invite-text" class="input input--area" rows="8" readonly>${message}</textarea>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Listo</button>
        <button type="button" class="btn btn--primary" data-copy-invite>${icon('copy', 18)}Copiar mensaje</button>
      </div>
    </div>`,
    onMount: (sheet) => {
      sheet.querySelector('[data-copy-invite]')?.addEventListener('click', async () => {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
          await navigator.clipboard.writeText(message);
          haptic('confirm');
          toast('Mensaje copiado. Pégalo en WhatsApp o en tu correo y envíalo tú: ACCONTROL no lo envía.');
        } catch {
          const area = /** @type {HTMLTextAreaElement | null} */ (sheet.querySelector('#invite-text'));
          area?.focus();
          area?.select();
          toast('Tu navegador no dejó copiarlo solo: el mensaje quedó seleccionado, cópialo tú.', 'info');
        }
      });
    },
  });
}

/** @param {HTMLElement} root @param {Store} store @param {SyncApi} sync @param {string} userId @param {string} name */
async function removeMember(root, store, sync, userId, name) {
  const workspace = store.activeWorkspace();
  if (!workspace) return;
  const ok = await confirmDialog({
    title: `¿Quitar a ${name}?`,
    message: `Dejará de ver «${workspace.name}» en sus dispositivos en cuanto su app se sincronice. Lo que registró se queda en el espacio. Para volver necesitará otra invitación.`,
    confirmLabel: 'Quitar',
    danger: true,
  });
  if (!ok) return;
  const result = await sync.share.remove(workspace.id, userId);
  if (result.ok) toast(`${name} ya no es miembro de «${workspace.name}».`);
  else toast(result.message, 'error');
  await reloadMembers(root, store, sync);
}

/** @param {HTMLElement} root @param {Store} store @param {SyncApi} sync @param {string} inviteId */
async function revokeInvite(root, store, sync, inviteId) {
  const ok = await confirmDialog({
    title: '¿Anular esta invitación?',
    message: 'El código dejará de servir aunque ya lo hayas enviado.',
    confirmLabel: 'Anular',
    danger: true,
  });
  if (!ok) return;
  const result = await sync.share.revoke(inviteId);
  if (result.ok) toast('Invitación anulada.');
  else toast(result.message, 'error');
  await reloadMembers(root, store, sync);
}

/** @param {Store} store @param {SyncApi | null | undefined} sync @param {HTMLElement} root */
function openJoin(store, sync, root) {
  if (!sync || !sync.state().enabled) {
    openSheet({
      title: 'Unirme con un código',
      content: html`<div class="stack">
        <p>Para unirte a un espacio que te compartieron, primero activa la <strong>copia en la nube</strong>: el espacio llega a tu dispositivo a través de ella.</p>
        <div class="actions">
          <button type="button" class="btn btn--ghost" data-close>Cerrar</button>
          ${sync ? html`<button type="button" class="btn btn--primary" data-go-cloud>Ir a «Copia en la nube»</button>` : ''}
        </div>
      </div>`,
      onMount: (sheet, close) => {
        sheet.querySelector('[data-go-cloud]')?.addEventListener('click', () => {
          close();
          root.querySelector('#cloud-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      },
    });
    return;
  }
  openSheet({
    title: 'Unirme con un código',
    content: html`<form class="stack" data-form="join" novalidate>
      <div class="field" data-field="code">
        <label for="join-code">Código de invitación</label>
        <input id="join-code" name="code" class="input invite-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="XXXX-XXXX-XXXX" data-autofocus aria-describedby="join-hint code-error" />
        <p class="hint" id="join-hint">Te lo envía el dueño o un administrador del espacio. Sirve una sola vez.</p>
        <p class="field__error" id="code-error" data-error-for="code" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">Unirme</button>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = $('form', sheet);
      if (!(form instanceof HTMLFormElement)) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        const code = normalizeInviteCode(readForm(form).code ?? '');
        if (!code) {
          showErrors(form, { code: 'Revisa el código: son 12 letras y números, como XXXX-XXXX-XXXX.' });
          return;
        }
        setBusy(form, true);
        const result = await sync.share.join(code);
        if (!result.ok) {
          setBusy(form, false);
          showErrors(form, { form: result.message });
          return;
        }
        await store.refresh();
        const opened = await store.switchWorkspace(result.workspaceId);
        setBusy(form, false);
        close();
        toast(opened.ok
          ? `Te uniste a «${result.workspaceName}» como ${result.roleName}. Ya lo tienes abierto.`
          : `Te uniste a «${result.workspaceName}» como ${result.roleName}. Aparecerá en tu lista de espacios en cuanto termine de llegar.`);
      });
    },
  });
}

/** @param {Store} store @param {SyncApi | null | undefined} sync @param {string} id */
async function leaveWorkspace(store, sync, id) {
  const workspace = store.getState().workspaces.find((w) => w.id === id);
  if (!workspace || !sync) return;
  const ok = await confirmDialog({
    title: `¿Salir de «${workspace.name}»?`,
    message: 'Dejarás de ver este espacio y sus datos en todos tus dispositivos. No se borra nada: los datos siguen siendo de su dueño. Para volver necesitarás otra invitación.',
    confirmLabel: 'Salir del espacio',
    danger: true,
  });
  if (!ok) return;
  const result = await sync.share.leave(id);
  if (!result.ok) {
    toast(result.message, 'error');
    return;
  }
  cache.delete(id);
  await store.refresh();
  toast(`Saliste de «${workspace.name}».`);
}

// ---- Roles a medida (0.16.1) ---------------------------------------------------------------------------------------

/**
 * Crear o editar un rol a medida: nombre, una plantilla para empezar y el nivel de cada módulo. Lo que un módulo necesita
 * de otro se sube solo, y se explica.
 * @param {Store} store @param {SyncApi} sync @param {HTMLElement} root @param {string | null} roleId  null = nuevo.
 */
function openRoleEditor(store, sync, root, roleId) {
  const workspace = store.activeWorkspace();
  if (!workspace) return;
  const roles = cache.get(workspace.id)?.roles ?? [];
  const current = roleId ? roles.find((r) => r.id === roleId) ?? null : null;
  if (roleId && !current) return;
  const start = current?.permissions ?? TEMPLATES[0].permissions;
  /** @param {string} id @param {string} level */
  const option = (id, level) => html`<option value="${level}" ${start[/** @type {import('../domain/permissions.js').ModuleId} */ (id)] === level ? 'selected' : ''}>${LEVEL_NAMES[/** @type {import('../domain/permissions.js').PermissionLevel} */ (level)]}</option>`;
  openSheet({
    title: current ? `Editar el rol «${current.name}»` : 'Nuevo rol',
    content: html`<form class="stack" data-form="role" novalidate>
      <div class="field" data-field="name">
        <label for="role-name">Nombre del rol</label>
        <input id="role-name" name="name" class="input" type="text" maxlength="30" autocomplete="off" value="${current?.name ?? ''}" placeholder="Por ejemplo: Cajero" data-autofocus aria-describedby="role-name-error" />
        <p class="field__error" id="role-name-error" data-error-for="name" hidden></p>
      </div>
      ${current ? '' : html`<div class="field">
        <span class="field__label">Empezar desde</span>
        <div class="chips-row">${TEMPLATES.map((t) => html`<button type="button" class="chip chip--button" data-template="${t.id}" title="${t.help}">${t.name}</button>`)}</div>
      </div>`}
      <fieldset class="field role-grid">
        <legend class="field__label">¿Qué puede hacer en cada parte?</legend>
        ${MODULES.map((m) => html`<label class="role-grid__row" for="perm-${m.id}">
          <span class="role-grid__module">${m.label}</span>
          <select id="perm-${m.id}" name="perm-${m.id}" class="input input--small">${LEVELS.map((l) => option(m.id, l))}</select>
        </label>`)}
      </fieldset>
      <p class="hint">${LEVELS.map((l) => html`<strong>${LEVEL_NAMES[l]}</strong>: ${LEVEL_HELP[l]} `)}</p>
      <p class="hint role-raised" data-raised role="status" hidden></p>
      <p class="hint">Cambiar el rol de alguien o borrar el espacio sigue siendo cosa del dueño. Los cambios le llegan a quien tenga el rol en cuanto su app se sincronice.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">${current ? 'Guardar cambios' : 'Crear rol'}</button>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = $('form', sheet);
      if (!(form instanceof HTMLFormElement)) return;
      const raisedNote = /** @type {HTMLElement} */ ($('[data-raised]', sheet));
      /** Lee las casillas, sube lo que haga falta y lo explica. @returns {Permissions} */
      const sync_ = () => {
        const values = readForm(form);
        const raw = Object.fromEntries(MODULES.map((m) => [m.id, values[`perm-${m.id}`] ?? 'none']));
        const { permissions, raised } = normalizePermissions(raw);
        for (const m of MODULES) {
          const select = /** @type {HTMLSelectElement | null} */ (form.querySelector(`#perm-${m.id}`));
          if (select && select.value !== permissions[m.id]) select.value = permissions[m.id];
        }
        const label = (/** @type {string} */ id) => MODULES.find((m) => m.id === id)?.label ?? id;
        raisedNote.hidden = raised.length === 0;
        raisedNote.textContent = raised.length === 0 ? '' : raised
          .map((r) => `«${label(r.module)}» pasó a «${LEVEL_NAMES[r.to]}» porque «${label(r.because)}» lo necesita.`).join(' ');
        return permissions;
      };
      form.addEventListener('change', (event) => {
        if (event.target instanceof HTMLSelectElement) sync_();
      });
      sheet.querySelectorAll('[data-template]').forEach((button) => button.addEventListener('click', () => {
        const t = TEMPLATES.find((x) => x.id === /** @type {HTMLElement} */ (button).dataset.template);
        if (!t) return;
        for (const m of MODULES) {
          const select = /** @type {HTMLSelectElement | null} */ (form.querySelector(`#perm-${m.id}`));
          if (select) select.value = t.permissions[m.id];
        }
        const name = /** @type {HTMLInputElement} */ (form.querySelector('#role-name'));
        if (!name.value.trim() && !t.id.endsWith('-like')) name.value = t.name;
        sync_();
      }));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        const permissions = sync_();
        const named = validateRoleName(readForm(form).name ?? '', { existing: roles, exceptId: current?.id });
        if (!named.ok) {
          showErrors(form, { name: named.error });
          return;
        }
        if (!hasAnyAccess(permissions)) {
          showErrors(form, { form: 'Elige al menos una parte de la app que este rol pueda ver.' });
          return;
        }
        setBusy(form, true);
        const result = current
          ? await sync.share.updateRole(current.id, named.name, permissions)
          : await sync.share.createRole(workspace.id, named.name, permissions);
        setBusy(form, false);
        if (!result.ok) {
          showErrors(form, { form: result.message });
          return;
        }
        close();
        toast(current ? `Rol «${named.name}» guardado. Quien lo tenga lo verá en cuanto su app se sincronice.` : `Rol «${named.name}» creado. Ya puedes invitar con él o asignárselo a alguien.`);
        await reloadMembers(root, store, sync);
      });
    },
  });
}

/** @param {HTMLElement} root @param {Store} store @param {SyncApi} sync @param {string} roleId @param {string} name */
async function deleteRole(root, store, sync, roleId, name) {
  const ok = await confirmDialog({
    title: `¿Borrar el rol «${name}»?`,
    message: 'Las invitaciones pendientes con este rol dejarán de servir. Si alguien lo tiene, primero cámbiale el rol.',
    confirmLabel: 'Borrar rol',
    danger: true,
  });
  if (!ok) return;
  const result = await sync.share.deleteRole(roleId);
  if (result.ok) toast(`Rol «${name}» borrado.`);
  else toast(result.message, 'error');
  await reloadMembers(root, store, sync);
}
