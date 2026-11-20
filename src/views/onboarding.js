// @ts-check
// =============================================================================
// PRIMERA VEZ: «¿Cómo deseas utilizar ACCONTROL?»
// -----------------------------------------------------------------------------
// Aparece cuando no existe ningún espacio de trabajo: la primera vez que abres la
// app, en un navegador nuevo y después de «Borrar todos mis datos».
// Paso 1: elegir la modalidad. Paso 2: ponerle nombre al espacio.
// Quien ya usaba ACCONTROL puede restaurar una copia de seguridad desde aquí.
// =============================================================================

import { KIND_INFO, suggestWorkspaceName, WORKSPACE_KINDS } from '../domain/workspaces.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { kindIcon } from './workspaces.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').WorkspaceKind} WorkspaceKind */

/** La modalidad elegida en el paso 1 (null = todavía no eligió). Vive aquí mientras dura la pantalla. @type {WorkspaceKind | null} */
let chosen = null;

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderOnboarding(store, ctx) {
  const page = chosen ? nameStep(chosen) : kindStep();

  return {
    html: page,
    mount(root, signal) {
      root.addEventListener(
        'click',
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;
          const card = target.closest('[data-kind]');
          if (card instanceof HTMLElement) {
            chosen = /** @type {WorkspaceKind} */ (card.dataset.kind);
            ctx.rerender();
            return;
          }
          if (target.closest('[data-step="back"]')) {
            chosen = null;
            ctx.rerender();
            return;
          }
          if (target.closest('[data-step="restore"]')) {
            const input = root.querySelector('#onboarding-file');
            if (input instanceof HTMLInputElement) input.click();
          }
        },
        { signal },
      );

      const file = root.querySelector('#onboarding-file');
      if (file instanceof HTMLInputElement) {
        file.addEventListener(
          'change',
          async () => {
            const picked = file.files?.[0];
            file.value = '';
            if (picked) await restoreFromFile(store, picked);
          },
          { signal },
        );
      }

      const form = root.querySelector('[data-form="onboarding"]');
      if (form instanceof HTMLFormElement && chosen) {
        const kind = chosen;
        form.addEventListener(
          'submit',
          async (event) => {
            event.preventDefault();
            clearErrors(form);
            setBusy(form, true);
            const result = await store.createWorkspace({ kind, name: readForm(form).name ?? '' });
            setBusy(form, false);
            if (!result.ok) {
              showErrors(form, result.errors);
              return;
            }
            chosen = null;
            window.location.hash = '#/inicio';
            toast(`Listo: «${result.workspace.name}» está abierto.`);
          },
          { signal },
        );
        const input = form.querySelector('input[name="name"]');
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      }
    },
  };
}

/** Paso 1: las cuatro tarjetas. */
function kindStep() {
  return html`<section class="welcome" aria-labelledby="welcome-title">
    <header class="welcome__head">
      <img class="welcome__mark" src="icons/icon.svg" alt="" width="56" height="56" />
      <h1 class="welcome__title" id="welcome-title">¿Cómo deseas utilizar ACCONTROL?</h1>
      <p class="welcome__sub">Elige la modalidad que mejor describe lo que quieres controlar. Cada espacio guarda sus datos por separado y podrás crear más cuando quieras.</p>
    </header>

    <div class="kind-grid">
      ${WORKSPACE_KINDS.map((kind) => kindCard(kind))}
    </div>

    <p class="welcome__note">¿Te invitaron a una empresa? Unirse con una invitación llegará con los roles: hoy cada cuenta trabaja solo con sus propios espacios.</p>

    <div class="welcome__restore">
      <p>¿Ya usabas ACCONTROL?</p>
      <button type="button" class="btn btn--ghost" data-step="restore">${icon('upload', 18)}Restaurar una copia de seguridad</button>
      <input type="file" id="onboarding-file" accept="application/json,.json" hidden />
    </div>
  </section>`;
}

/** @param {WorkspaceKind} kind */
function kindCard(kind) {
  const info = KIND_INFO[kind];
  return html`<button type="button" class="kind-card" data-kind="${kind}">
    <span class="kind-card__icon">${kindIcon(kind, 26)}</span>
    <span class="kind-card__title">${info.label}</span>
    <span class="kind-card__tagline">${info.tagline}</span>
    <span class="kind-card__label">Incluye hoy</span>
    <ul class="kind-card__list">${info.included.map((x) => html`<li>${x}</li>`)}</ul>
    <span class="kind-card__label kind-card__label--soon">Llegará después</span>
    <ul class="kind-card__list kind-card__list--soon">${info.soon.map((x) => html`<li>${x}</li>`)}</ul>
    <span class="kind-card__cta">Elegir ${info.label}${icon('chevronRight', 18)}</span>
  </button>`;
}

/** Paso 2: el nombre del espacio. @param {WorkspaceKind} kind */
function nameStep(kind) {
  const info = KIND_INFO[kind];
  return html`<section class="welcome welcome--form" aria-labelledby="welcome-title">
    <button type="button" class="btn btn--ghost btn--small" data-step="back">${icon('back', 16)}Cambiar modalidad</button>
    <header class="welcome__head">
      <span class="kind-card__icon">${kindIcon(kind, 26)}</span>
      <h1 class="welcome__title" id="welcome-title">Ponle nombre a tu espacio</h1>
      <p class="welcome__sub">Modalidad: <strong>${info.label}</strong>. ${info.tagline}.</p>
    </header>
    <form class="panel stack" data-form="onboarding" novalidate>
      <div class="field" data-field="name">
        <label for="onb-name">Nombre del espacio</label>
        <input id="onb-name" name="name" class="input" type="text" maxlength="40" autocomplete="off" value="${suggestWorkspaceName(kind, [])}" aria-describedby="onb-hint name-error" />
        <p class="hint" id="onb-hint">Puedes cambiarlo después en Ajustes → Espacios y equipo.</p>
        <p class="field__error" id="name-error" data-error-for="name" hidden></p>
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions"><button type="submit" class="btn btn--primary btn--block">Empezar</button></div>
    </form>
  </section>`;
}

/**
 * Restaura una copia de seguridad desde la pantalla de la primera vez.
 * @param {Store} store @param {File} file
 */
async function restoreFromFile(store, file) {
  let text = '';
  try {
    text = await file.text();
  } catch {
    toast('No se pudo leer el archivo.', 'error');
    return;
  }
  const inspected = store.inspectBackup(text);
  if (!inspected.ok) {
    toast(inspected.error, 'error');
    return;
  }
  if (inspected.kind === 'workspace') {
    // La copia de un solo espacio necesita un espacio donde caer: se crea uno como el de origen.
    const kind = inspected.sourceKind ?? 'personal';
    const made = await store.createWorkspace({ kind, name: inspected.sourceName ?? KIND_INFO[kind].defaultName });
    if (!made.ok) {
      toast(made.errors.form ?? made.errors.kind ?? made.errors.name ?? 'No se pudo crear el espacio para la copia.', 'error');
      return;
    }
  }
  const result = await store.importBackup(text);
  if (result.ok) {
    window.location.hash = '#/inicio';
    toast('Copia restaurada.');
  } else {
    toast(result.errors.form ?? 'No se pudo restaurar la copia.', 'error');
  }
}
