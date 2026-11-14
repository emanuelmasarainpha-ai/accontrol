// @ts-check
// =============================================================================
// FORMULARIO DE DEPARTAMENTO (espacios Empresa)
// -----------------------------------------------------------------------------
// Crear y editar un departamento (nombre y presupuesto mensual); al editar, también archivarlo, reactivarlo o borrarlo.
// Solo habla con las acciones del store; las reglas viven en domain/departments.js.
// =============================================================================

import { departmentUsage } from '../domain/departments.js';
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
/** @typedef {import('../domain/types.js').Department} Department */

/**
 * @param {Store} store
 * @param {{ department?: Department | null }} [options]
 */
export function openDepartmentForm(store, { department = null } = {}) {
  const isEdit = department !== null;
  const expenses = department ? departmentUsage(store.getState().data, department.id).expenses : 0;

  openSheet({
    title: isEdit ? 'Editar departamento' : 'Nuevo departamento',
    content: html`<form class="stack" novalidate>
      <div class="field" data-field="name">
        <label for="dp-name">Nombre</label>
        <input id="dp-name" name="name" class="input" type="text" maxlength="${LIMITS.departmentName}" autocomplete="off" placeholder="Ej.: Ventas, Administración, Operaciones" value="${department?.name ?? ''}" ${isEdit ? '' : 'data-autofocus'} aria-describedby="name-error" />
        ${fieldError('name')}
      </div>
      ${moneyField({ id: 'dp-budget', name: 'budgetText', label: 'Presupuesto mensual de gastos (opcional)', value: department && department.monthlyBudgetCents > 0 ? centsToInputValue(department.monthlyBudgetCents) : '', errorKey: 'budget' })}

      <p class="hint">Con presupuesto, ACCONTROL te muestra cuánto lleva gastado el área cada mes y te avisa cuando se acerca al límite o se pasa. Sin presupuesto, solo se mide lo que gasta. Los meses anteriores se comparan con el presupuesto que tenga ahora.</p>
      ${isEdit && department?.archived ? html`<p class="hint">Está archivado: no se ofrece al registrar gastos y ya no tiene presupuesto que cumplir. Su historial se conserva.</p>` : ''}
      ${isEdit && expenses > 0 ? html`<p class="hint">Tiene ${expenses === 1 ? '1 gasto cargado' : `${expenses} gastos cargados`}: no se puede eliminar, pero sí archivar.</p>` : ''}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions ${isEdit ? 'actions--split' : ''}">
        ${isEdit
          ? html`<span class="actions__group actions__group--start">
              <button type="button" class="btn btn--ghost" data-archive>${department?.archived ? 'Reactivar' : 'Archivar'}</button>
              ${expenses === 0 ? html`<button type="button" class="btn btn--danger-ghost" data-delete>${icon('trash', 18)}Eliminar</button>` : ''}
            </span>`
          : ''}
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      bindMoneyPreview(sheet, 'dp-budget');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveDepartment({ name: v.name ?? '', budgetText: v.budgetText ?? '' }, department?.id ?? null);
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Cambios guardados.' : 'Departamento creado.');
      });

      const archiveButton = sheet.querySelector('[data-archive]');
      if (archiveButton && department) {
        archiveButton.addEventListener('click', async () => {
          const result = await store.setDepartmentArchived(department.id, !department.archived);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast(department.archived ? 'Departamento reactivado.' : 'Departamento archivado. Sus gastos se conservan.');
        });
      }

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && department) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '¿Eliminar este departamento?',
            message: `Se borrará «${department.name}». Solo se puede borrar un departamento sin gastos; si los tiene, archívalo. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteDepartment(department.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Departamento eliminado.');
          window.location.hash = '#/departamentos';
        });
      }
    },
  });
}
