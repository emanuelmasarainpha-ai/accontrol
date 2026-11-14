// @ts-check
// =============================================================================
// FORMULARIOS DE CLIENTES Y SERVICIOS (documento maestro §9)
// -----------------------------------------------------------------------------
// Cliente (crear / editar) y servicio (crear / editar / borrar). Solo hablan con las acciones del
// store; las reglas viven en domain/clients.js.
// =============================================================================

import { SERVICE_STATUSES, SERVICE_STATUS_LABELS, clientLabel, sortClients } from '../domain/clients.js';
import { centsToInputValue } from '../domain/money.js';
import { LIMITS } from '../domain/types.js';
import { $ } from '../ui/dom.js';
import { confirmDialog, openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Client} Client */
/** @typedef {import('../domain/types.js').Service} Service */

// =============================================================================
// CLIENTE
// =============================================================================

/**
 * @param {Store} store
 * @param {{ client: Client | null }} options
 */
export function openClientForm(store, { client }) {
  const isEdit = client !== null;
  /** @param {string} id @param {string} name @param {string} label @param {string} value @param {number} max @param {{ placeholder?: string, type?: string, autocomplete?: string, autofocus?: boolean }} [o] */
  const text = (id, name, label, value, max, { placeholder = '', type = 'text', autocomplete = 'off', autofocus = false } = {}) => html`<div class="field" data-field="${name}">
      <label for="${id}">${label}</label>
      <input id="${id}" name="${name}" class="input" type="${type}" maxlength="${max}" autocomplete="${autocomplete}" placeholder="${placeholder}" value="${value}" ${autofocus ? 'data-autofocus' : ''} />
      ${fieldError(name)}
    </div>`;

  openSheet({
    title: isEdit ? 'Editar cliente' : 'Nuevo cliente',
    content: html`<form class="stack" novalidate>
      <div class="field-row">
        ${text('cl-first', 'firstName', 'Nombre', client?.firstName ?? '', LIMITS.clientName, { placeholder: 'Ej.: Ana', autofocus: !isEdit })}
        ${text('cl-last', 'lastName', 'Apellido (opcional)', client?.lastName ?? '', LIMITS.clientName)}
      </div>
      ${text('cl-company', 'company', 'Empresa (opcional)', client?.company ?? '', LIMITS.clientCompany, { placeholder: 'Ej.: Estudio Sol' })}
      <div class="field-row">
        ${text('cl-email', 'email', 'Correo (opcional)', client?.email ?? '', LIMITS.clientEmail, { type: 'email', placeholder: 'nombre@ejemplo.com' })}
        ${text('cl-phone', 'phone', 'Teléfono (opcional)', client?.phone ?? '', LIMITS.clientPhone, { type: 'tel', placeholder: '+1 809 555 0100' })}
      </div>
      ${text('cl-country', 'country', 'País (opcional)', client?.country ?? '', LIMITS.clientCountry, { placeholder: 'Ej.: República Dominicana' })}
      ${text('cl-notes', 'notes', 'Notas (opcional)', client?.notes ?? '', LIMITS.clientNotes, { placeholder: 'Ej.: Paga a los 15 días' })}

      <p class="hint">Solo el nombre es obligatorio. Estos datos se quedan en este dispositivo y los ves solo tú.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions">
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveClient(
          {
            firstName: v.firstName ?? '', lastName: v.lastName ?? '', company: v.company ?? '', email: v.email ?? '',
            phone: v.phone ?? '', country: v.country ?? '', notes: v.notes ?? '',
          },
          client?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Cambios guardados.' : 'Cliente guardado.');
        if (!isEdit && result.ok) window.location.hash = `#/clientes/${result.client.id}`;
      });
    },
  });
}

// =============================================================================
// SERVICIO
// =============================================================================

/**
 * @param {Store} store
 * @param {{ clientId?: string | null, service?: Service | null }} options  `clientId`: el cliente al que se le crea el servicio.
 */
export function openServiceForm(store, { clientId = null, service = null }) {
  const { data } = store.getState();
  const isEdit = service !== null;
  const currentClientId = service?.clientId ?? clientId ?? '';
  const hasPayments = service ? data.movements.some((m) => m.serviceId === service.id) : false;
  // Se ofrecen los clientes activos (y el actual, aunque esté archivado).
  const choices = sortClients(data.clients).filter((c) => !c.archived || c.id === currentClientId);

  openSheet({
    title: isEdit ? 'Editar servicio' : 'Nuevo servicio',
    content: html`<form class="stack" novalidate>
      <div class="field" data-field="clientId">
        <label for="sv-client">Cliente</label>
        <select id="sv-client" name="clientId" class="input" ${hasPayments ? 'disabled' : ''}>
          ${currentClientId ? '' : html`<option value="" selected disabled>Elige un cliente</option>`}
          ${choices.map((c) => html`<option value="${c.id}" ${c.id === currentClientId ? 'selected' : ''}>${clientLabel(c)}${c.archived ? ' (archivado)' : ''}</option>`)}
        </select>
        ${hasPayments ? html`<input type="hidden" name="clientId" value="${currentClientId}" /><p class="hint">Ya tiene pagos registrados: no se puede pasar a otro cliente.</p>` : ''}
        ${fieldError('clientId')}
      </div>

      <div class="field" data-field="name">
        <label for="sv-name">Servicio</label>
        <input id="sv-name" name="name" class="input" type="text" maxlength="${LIMITS.serviceName}" autocomplete="off" placeholder="Ej.: Diseño de logo" value="${service?.name ?? ''}" ${isEdit ? '' : 'data-autofocus'} />
        ${fieldError('name')}
      </div>

      ${moneyField({ id: 'sv-price', name: 'priceText', label: 'Precio acordado', value: service ? centsToInputValue(service.priceCents) : '', errorKey: 'price' })}

      <div class="field-row">
        <div class="field" data-field="status">
          <label for="sv-status">Estado</label>
          <select id="sv-status" name="status" class="input">
            ${SERVICE_STATUSES.map((s) => html`<option value="${s}" ${s === (service?.status ?? 'in_progress') ? 'selected' : ''}>${SERVICE_STATUS_LABELS[s]}</option>`)}
          </select>
          ${fieldError('status')}
        </div>
        <div class="field" data-field="estimatedDays">
          <label for="sv-days">Duración estimada en días (opcional)</label>
          <input id="sv-days" name="estimatedDaysText" class="input" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Ej.: 15" value="${service?.estimatedDays ?? ''}" />
          ${fieldError('estimatedDays')}
        </div>
      </div>

      <div class="field" data-field="startDate">
        <label for="sv-start">Fecha de inicio (opcional)</label>
        <input id="sv-start" name="startDate" class="input" type="date" value="${service?.startDate ?? ''}" />
        ${fieldError('startDate')}
      </div>

      <p class="hint">«Por cobrar» cuenta lo que falta pagar de los servicios <strong>En proceso</strong> y <strong>Finalizados</strong>. Los pagos se registran como ingresos vinculados a este servicio.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions ${isEdit ? 'actions--split' : ''}">
        ${isEdit ? html`<button type="button" class="btn btn--danger-ghost" data-delete>${icon('trash', 18)}Eliminar</button>` : ''}
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      bindMoneyPreview(sheet, 'sv-price');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveService(
          {
            clientId: v.clientId ?? '', name: v.name ?? '', priceText: v.priceText ?? '',
            estimatedDaysText: v.estimatedDaysText ?? '', status: v.status ?? '', startDate: v.startDate ?? '',
          },
          service?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Cambios guardados.' : 'Servicio guardado.');
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && service) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '¿Eliminar este servicio?',
            message: `Se borrará «${service.name}». Si ya tiene pagos registrados no se puede borrar: en ese caso márcalo como Cancelado. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteService(service.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Servicio eliminado.');
        });
      }
    },
  });
}
