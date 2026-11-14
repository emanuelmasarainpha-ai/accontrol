// @ts-check
// =============================================================================
// DATOS DEL ESPACIO Y DE LA ORGANIZACIÓN (panel de Ajustes y formulario)
// -----------------------------------------------------------------------------
// Muestra el espacio abierto (nombre, modalidad, moneda) y, en Freelancer, Emprendedor y
// Empresa, los datos del negocio: nombre legal, RNC o cédula, actividad, contacto y
// dirección. Todo es opcional y lo escribe la persona; la app no lo verifica con ningún
// registro oficial. Esos datos salen en la cabecera de los reportes exportados.
// =============================================================================

import {
  ORGANIZATION_FIELDS, isOrganizationEmpty, kindHasOrganization, normalizeOrganization, organizationTitle,
} from '../domain/organization.js';
import { CURRENCY_INFO, KIND_INFO } from '../domain/workspaces.js';
import { openSheet } from '../ui/dialog.js';
import { $ } from '../ui/dom.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html } from '../ui/html.js';
import { toast } from '../ui/toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

/** @param {Store} store */
export function workspaceDetailsPanel(store) {
  const workspace = store.activeWorkspace();
  if (!workspace) return html``;
  const hasOrg = kindHasOrganization(workspace.kind);
  const org = normalizeOrganization(workspace.organization);
  const empty = isOrganizationEmpty(workspace.organization);
  const currency = CURRENCY_INFO[workspace.currency];
  const filled = ORGANIZATION_FIELDS.filter(({ key }) => org[key] !== '');

  return html`<section class="panel" aria-labelledby="set-space" data-tour="settings-organization">
    <div class="panel__head">
      <h2 class="panel__title" id="set-space">${hasOrg ? organizationTitle(workspace.kind) : 'Este espacio'}</h2>
      ${hasOrg
        ? html`<button type="button" class="btn btn--ghost btn--small" data-action="org-edit" data-id="${workspace.id}">${empty ? 'Completar datos' : 'Editar datos'}</button>`
        : ''}
    </div>
    <dl class="facts">
      <div><dt>Espacio</dt><dd>${workspace.name} · ${KIND_INFO[workspace.kind].label}</dd></div>
      <div>
        <dt>Moneda</dt>
        <dd>${currency.label} (${currency.symbol})<span class="facts__note">Cada espacio guarda su moneda. Por ahora el peso dominicano es la única disponible.</span></dd>
      </div>
      ${filled.map((f) => html`<div><dt>${f.label}</dt><dd>${org[f.key]}</dd></div>`)}
    </dl>
    ${hasOrg
      ? html`<p class="hint">${empty
          ? 'Aún no completaste los datos de este espacio. Son opcionales, y cuando los llenes saldrán en la cabecera de tus reportes en PDF y Excel.'
          : 'Estos datos los escribes tú: ACCONTROL no los verifica con ningún registro oficial. Salen en la cabecera de tus reportes en PDF y Excel.'}</p>`
      : html`<p class="hint">Los datos de organización (nombre legal, RNC, contacto) son para los espacios de negocio. Si creas uno de Freelancer, Emprendedor o Empresa, los completas ahí.</p>`}
  </section>`;
}

/** @param {Store} store @param {string} id */
export function openOrganizationForm(store, id) {
  const workspace = store.getState().workspaces.find((w) => w.id === id);
  if (!workspace || !kindHasOrganization(workspace.kind)) return;
  const org = normalizeOrganization(workspace.organization);

  openSheet({
    title: `${organizationTitle(workspace.kind)} de «${workspace.name}»`,
    content: html`<form class="stack" data-form="organization" novalidate>
      <p class="hint">Todo es opcional. Lo que escribas saldrá en la cabecera de tus reportes. ACCONTROL no lo verifica con ningún registro oficial.</p>
      ${ORGANIZATION_FIELDS.map(
        (f) => html`<div class="field" data-field="${f.key}">
          <label for="org-${f.key}">${f.label}</label>
          <input id="org-${f.key}" name="${f.key}" class="input" type="${f.type}" maxlength="${String(f.max)}" autocomplete="${f.autocomplete}" value="${org[f.key]}" ${f.key === 'legalName' ? 'data-autofocus' : ''} aria-describedby="org-${f.key}-hint org-${f.key}-error" />
          <p class="hint" id="org-${f.key}-hint" ${f.hint ? '' : 'hidden'}>${f.hint}</p>
          <p class="field__error" id="org-${f.key}-error" data-error-for="${f.key}" hidden></p>
        </div>`,
      )}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">Guardar datos</button>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = $('form', sheet);
      if (!(form instanceof HTMLFormElement)) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const result = await store.updateOrganization(id, readForm(form));
        setBusy(form, false);
        if (!result.ok) {
          showErrors(form, result.errors);
          return;
        }
        close();
        toast('Datos guardados.');
      });
    },
  });
}
