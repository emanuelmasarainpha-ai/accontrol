// @ts-check
// =============================================================================
// ESPACIOS DE TRABAJO: selector del menú, crear, renombrar y borrar
// -----------------------------------------------------------------------------
// Un espacio de trabajo es un conjunto de datos aislado (Personal, Freelancer,
// Emprendedor o Empresa). Aquí viven las pantallas para cambiar entre ellos y
// administrarlos. La pantalla de la primera vez está en onboarding.js.
// =============================================================================

import { routeParams } from '../app/router.js';
import { plural } from '../domain/dates.js';
import { canManageWorkspace, roleLabel, roleOf } from '../domain/roles.js';
import { KIND_INFO, availableKinds, ownedWorkspaceOfKind, suggestWorkspaceName, WORKSPACE_KINDS } from '../domain/workspaces.js';
import { confirmDialog, openSheet } from '../ui/dialog.js';
import { $, $$ } from '../ui/dom.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Workspace} Workspace */
/** @typedef {import('../domain/types.js').WorkspaceKind} WorkspaceKind */

/** «Compartido · Contador»: tu rol en un espacio de otra persona (vacío si es tuyo). @param {Workspace} w */
export const sharedLabel = (w) => (roleOf(w) === 'owner' ? '' : `Compartido · ${roleLabel(w)}`);

/** @param {WorkspaceKind} kind @param {number} [size] */
export const kindIcon = (kind, size = 20) => icon(KIND_INFO[kind].icon, size);

// ---- El botón del menú que muestra en qué espacio estás --------------------------

/**
 * Dibuja el botón «Espacio actual» (menú lateral y barra superior del celular).
 * @param {import('../app/store.js').AppState} state
 */
export function updateWorkspaceSwitchers(state) {
  const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null;
  for (const button of $$('[data-workspace-switch]')) {
    button.hidden = !active;
    if (!active) continue;
    const key = `${active.id}|${active.name}|${active.kind}|${roleOf(active)}`;
    if (button.dataset.rendered === key) continue;
    button.dataset.rendered = key;
    const shared = sharedLabel(active);
    button.setAttribute('aria-label', `Espacio de trabajo: ${active.name}${shared ? ` (${shared})` : ''}. Cambiar de espacio`);
    setHtml(
      button,
      html`<span class="ws-switch__icon">${kindIcon(active.kind, 18)}</span>
        <span class="ws-switch__text"><span class="ws-switch__name">${active.name}</span><span class="ws-switch__kind">${KIND_INFO[active.kind].label}${shared ? ` · ${roleLabel(active)}` : ''}</span></span>
        <span class="ws-switch__chev">${icon('chevronsUpDown', 16)}</span>`,
    );
  }
}

// ---- Menú: cambiar de espacio ----------------------------------------------------------

/** @param {Store} store */
export function openWorkspaceMenu(store) {
  const { workspaces, activeWorkspaceId } = store.getState();
  openSheet({
    title: 'Tus espacios de trabajo',
    content: html`<div class="stack">
      <p class="panel__sub">Cada espacio tiene sus propios movimientos, metas, deudas y patrimonio. Lo que registras en uno no aparece en otro.</p>
      <ul class="ws-list" role="list">
        ${workspaces.map((w) => workspaceOption(w, w.id === activeWorkspaceId))}
      </ul>
      <div class="actions actions--split">
        <a class="btn btn--ghost" href="#/ajustes/espacios" data-close>Administrar espacios</a>
        <button type="button" class="btn btn--primary" data-new-workspace>${icon('plus', 18)}Crear otro espacio</button>
      </div>
    </div>`,
    onMount: (sheet, close) => {
      sheet.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        if (target.closest('[data-new-workspace]')) {
          close();
          openCreateWorkspace(store);
          return;
        }
        const option = target.closest('[data-workspace-id]');
        if (option instanceof HTMLElement) {
          close();
          void switchTo(store, option.dataset.workspaceId ?? '');
        }
      });
    },
  });
}

/** @param {Workspace} w @param {boolean} current */
function workspaceOption(w, current) {
  return html`<li>
    <button type="button" class="ws-option" data-workspace-id="${w.id}" aria-current="${current ? 'true' : 'false'}">
      <span class="ws-option__icon">${kindIcon(w.kind, 20)}</span>
      <span class="ws-option__text">
        <span class="ws-option__name">${w.name}</span>
        <span class="ws-option__meta">${KIND_INFO[w.kind].label}${sharedLabel(w) ? ` · ${sharedLabel(w)}` : ''}${w.isDefault ? ' · Predeterminado' : ''}</span>
      </span>
      ${current ? html`<span class="ws-option__check" aria-label="Abierto ahora">${icon('check', 20)}</span>` : ''}
    </button>
  </li>`;
}

/** @param {Store} store @param {string} id */
async function switchTo(store, id) {
  if (id === store.getState().activeWorkspaceId) return;
  const result = await store.switchWorkspace(id);
  if (!result.ok) {
    toast(result.errors.form ?? 'No se pudo cambiar de espacio.', 'error');
    return;
  }
  goHomeIfDetailScreen();
  toast(`Abriste «${store.activeWorkspace()?.name ?? 'tu espacio'}».`, 'info');
}

/** Una pantalla de detalle (una deuda concreta) no existe en el otro espacio: se vuelve a Inicio. */
function goHomeIfDetailScreen() {
  if (routeParams(window.location.hash).length > 0) window.location.hash = '#/inicio';
}

// ---- Crear un espacio ------------------------------------------------------------------------

/**
 * Lista de las cuatro modalidades para elegir una (botones de opción). Las que ya tienes salen desactivadas, con el nombre
 * de tu espacio de ese tipo (0.17.4: uno de cada tipo por cuenta).
 * @param {WorkspaceKind | null} selected @param {readonly Workspace[]} [workspaces]
 */
export function kindChoices(selected, workspaces = []) {
  return html`<div class="kind-choices" role="radiogroup" aria-label="Modalidad">
    ${WORKSPACE_KINDS.map((kind) => {
      const info = KIND_INFO[kind];
      const taken = ownedWorkspaceOfKind(workspaces, kind);
      return html`<label class="kind-choice${taken ? ' kind-choice--taken' : ''}">
        <input type="radio" name="kind" value="${kind}" ${selected === kind && !taken ? 'checked' : ''} ${taken ? 'disabled' : ''} />
        <span class="kind-choice__body">
          <span class="kind-choice__icon">${icon(info.icon, 20)}</span>
          <span><strong>${info.label}</strong><small>${taken ? `Ya lo tienes: «${taken.name}»` : info.tagline}</small></span>
        </span>
      </label>`;
    })}
  </div>`;
}

/** @param {Store} store */
export function openCreateWorkspace(store) {
  const { workspaces } = store.getState();
  const free = availableKinds(workspaces);
  if (free.length === 0) {
    toast('Ya tienes un espacio de cada tipo (Personal, Freelancer, Emprendedor y Empresa). Solo se puede tener uno de cada uno.', 'info');
    return;
  }
  openSheet({
    title: 'Crear otro espacio',
    content: html`<form class="stack" data-form="new-workspace" novalidate>
      <div class="field" data-field="kind">
        <span class="field__label" id="nw-kind">¿Para qué lo vas a usar?</span>
        <p class="hint">Puedes tener un espacio de cada tipo.</p>
        ${kindChoices(null, workspaces)}
        <p class="field__error" data-error-for="kind" hidden></p>
      </div>
      <div class="field" data-field="name">
        <label for="nw-name">Nombre del espacio</label>
        <input id="nw-name" name="name" class="input" type="text" maxlength="40" autocomplete="off" aria-describedby="name-error" />
        <p class="field__error" id="name-error" data-error-for="name" hidden></p>
      </div>
      <p class="hint" data-kind-note hidden></p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">Crear espacio</button>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = $('form', sheet);
      if (!(form instanceof HTMLFormElement)) return;
      const nameInput = /** @type {HTMLInputElement} */ ($('#nw-name', sheet));
      const note = $('[data-kind-note]', sheet);
      let typedByUser = false;
      nameInput.addEventListener('input', () => { typedByUser = true; });
      form.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'kind') return;
        const kind = /** @type {WorkspaceKind} */ (event.target.value);
        if (!typedByUser) nameInput.value = suggestWorkspaceName(kind, store.getState().workspaces);
        note.hidden = kind === 'personal';
        note.textContent = kind === 'personal' ? '' : kindNote(kind);
        clearErrors(form);
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const values = readForm(form);
        const result = await store.createWorkspace({ kind: values.kind ?? '', name: values.name ?? '' });
        setBusy(form, false);
        if (!result.ok) {
          showErrors(form, result.errors);
          return;
        }
        close();
        goHomeIfDetailScreen();
        toast(`Espacio «${result.workspace.name}» creado. Ya lo tienes abierto.`);
      });
    },
  });
}

/** Aviso honesto sobre lo que cada modalidad incluye hoy. @param {WorkspaceKind} kind */
export function kindNote(kind) {
  const info = KIND_INFO[kind];
  return `Hoy incluye: ${info.included.join(', ').toLowerCase()}. Más adelante: ${info.soon.join(', ').toLowerCase()}.`;
}

// ---- Renombrar y borrar ---------------------------------------------------------------------------

/** @param {Store} store @param {string} id */
export function openRenameWorkspace(store, id) {
  const workspace = store.getState().workspaces.find((w) => w.id === id);
  if (!workspace) return;
  openSheet({
    title: 'Renombrar espacio',
    content: html`<form class="stack" data-form="rename-workspace" novalidate>
      <div class="field" data-field="name">
        <label for="rw-name">Nombre del espacio</label>
        <input id="rw-name" name="name" class="input" type="text" maxlength="40" autocomplete="off" value="${workspace.name}" data-autofocus aria-describedby="rw-error" />
        <p class="field__error" id="rw-error" data-error-for="name" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">Guardar nombre</button>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = $('form', sheet);
      if (!(form instanceof HTMLFormElement)) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const result = await store.renameWorkspace(id, readForm(form).name ?? '');
        setBusy(form, false);
        if (!result.ok) {
          showErrors(form, result.errors);
          return;
        }
        close();
        toast('Nombre actualizado.');
      });
    },
  });
}

/** @param {Store} store @param {string} id */
export async function deleteWorkspaceFlow(store, id) {
  const state = store.getState();
  const workspace = state.workspaces.find((w) => w.id === id);
  if (!workspace) return;
  const isOpen = id === state.activeWorkspaceId;
  const contents = isOpen
    ? `Tiene ${plural(state.data.movements.length, 'movimiento', 'movimientos')}, ${plural(state.data.goals.length, 'meta', 'metas')}, ${plural(state.data.debts.length, 'deuda', 'deudas')} y ${plural(state.data.assets.length, 'activo', 'activos')}.`
    : 'Se borrarán todos sus datos.';
  const ok = await confirmDialog({
    title: `¿Borrar el espacio «${workspace.name}»?`,
    message: `${contents} Se borra solo este espacio; los demás no se tocan. No se puede deshacer: exporta una copia antes si quieres conservarlo.`,
    confirmLabel: 'Borrar espacio',
    danger: true,
    requireText: 'BORRAR',
  });
  if (!ok) return;
  const result = await store.deleteWorkspace(id);
  if (result.ok) {
    goHomeIfDetailScreen();
    toast(`Espacio «${workspace.name}» borrado.`);
  } else {
    toast(result.errors.form ?? 'No se pudo borrar el espacio.', 'error');
  }
}

// ---- Panel de Ajustes ------------------------------------------------------------------------------

/**
 * @param {Store} store
 * @param {{ canShare?: boolean }} [options]  canShare: hay cuenta (se puede unir a espacios compartidos y salir de ellos).
 */
export function workspacesPanel(store, { canShare = false } = {}) {
  const { workspaces, activeWorkspaceId } = store.getState();
  const canDelete = workspaces.length > 1;
  const anyShared = workspaces.some((w) => !canManageWorkspace(w));
  return html`<section class="panel" aria-labelledby="set-workspaces">
    <div class="panel__head">
      <h2 class="panel__title" id="set-workspaces">Espacios de trabajo</h2>
      <span class="panel__head-actions">
        ${canShare ? html`<button type="button" class="btn btn--ghost btn--small" data-action="ws-join">${icon('user', 16)}Unirme con un código</button>` : ''}
        <button type="button" class="btn btn--ghost btn--small" data-action="ws-new">${icon('plus', 16)}Crear otro espacio</button>
      </span>
    </div>
    <p class="panel__sub">Cada espacio guarda sus datos por separado. El predeterminado es el que se abre si no recuerdo cuál usaste por última vez.</p>
    <ul class="ws-manage" role="list">
      ${workspaces.map((w) => {
        const open = w.id === activeWorkspaceId;
        return html`<li class="ws-manage__item">
          <span class="ws-option__icon">${kindIcon(w.kind, 20)}</span>
          <span class="ws-manage__text">
            <span class="ws-option__name">${w.name}</span>
            <span class="ws-option__meta">${KIND_INFO[w.kind].label}</span>
          </span>
          <span class="ws-manage__chips">
            ${open ? html`<span class="chip chip--good">Abierto</span>` : ''}
            ${w.isDefault ? html`<span class="chip">Predeterminado</span>` : ''}
            ${sharedLabel(w) ? html`<span class="chip chip--role">${sharedLabel(w)}</span>` : ''}
          </span>
          <span class="ws-manage__actions">
            ${open ? '' : html`<button type="button" class="btn btn--ghost btn--small" data-action="ws-open" data-id="${w.id}" aria-label="Abrir ${w.name}">Abrir</button>`}
            ${canManageWorkspace(w) ? html`<button type="button" class="btn btn--ghost btn--small" data-action="ws-rename" data-id="${w.id}" aria-label="Renombrar ${w.name}">Renombrar</button>` : ''}
            ${w.isDefault ? '' : html`<button type="button" class="btn btn--ghost btn--small" data-action="ws-default" data-id="${w.id}" aria-label="Hacer predeterminado ${w.name}">Predeterminado</button>`}
            ${canDelete && canManageWorkspace(w) ? html`<button type="button" class="btn btn--danger-ghost btn--small" data-action="ws-delete" data-id="${w.id}" aria-label="Borrar ${w.name}">Borrar</button>` : ''}
            ${canShare && !canManageWorkspace(w) ? html`<button type="button" class="btn btn--danger-ghost btn--small" data-action="ws-leave" data-id="${w.id}" aria-label="Salir de ${w.name}">Salir</button>` : ''}
          </span>
        </li>`;
      })}
    </ul>
    ${anyShared ? html`<p class="hint">Los espacios marcados como «Compartido» son de otra persona: solo su dueño puede renombrarlos o borrarlos. Como Administrador registras y editas sus datos; como Contador solo los ves.</p>` : ''}
  </section>`;
}

/**
 * Maneja los botones del panel. Devuelve true si el botón era de este panel.
 * @param {Store} store @param {HTMLElement} el
 */
export function runWorkspaceAction(store, el) {
  const id = el.dataset.id ?? '';
  switch (el.dataset.action) {
    case 'ws-new':
      openCreateWorkspace(store);
      return true;
    case 'ws-open':
      void switchTo(store, id);
      return true;
    case 'ws-rename':
      openRenameWorkspace(store, id);
      return true;
    case 'ws-default':
      void store.setDefaultWorkspace(id).then((r) => {
        if (r.ok) toast('Listo: ese espacio se abrirá primero.');
        else toast(r.errors.form ?? 'No se pudo cambiar.', 'error');
      });
      return true;
    case 'ws-delete':
      void deleteWorkspaceFlow(store, id);
      return true;
    default:
      return false;
  }
}
