// @ts-check
// =============================================================================
// FORMULARIOS DE DEUDAS (documento maestro §4.4 y §19)
// -----------------------------------------------------------------------------
// Deuda (crear / editar / borrar) y pago de una deuda (cuota o abono extra).
// Solo hablan con las acciones del store; las reglas y los cálculos viven en
// domain/debts.js. Aquí solo se muestra una vista previa de lo que se calculó.
// =============================================================================

import { addMonthsToDate, currentTime, formatDate } from '../domain/dates.js';
import {
  COLLATERAL_KIND_LABELS, COLLATERAL_OPTIONS, FREQUENCIES, FREQUENCY_LABELS,
  debtStatus, estimateDebt, previewPayment, rateToInputValue, validateDebt,
} from '../domain/debts.js';
import { centsToInputValue, formatMoney, parseMoney } from '../domain/money.js';
import { overallTotals } from '../domain/summaries.js';
import { LIMITS } from '../domain/types.js';
import { $, $$ } from '../ui/dom.js';
import { confirmDialog, openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html, setHtml } from '../ui/html.js';
import { haptic } from '../ui/haptics.js';
import { toast } from '../ui/toast.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Debt} Debt */
/** @typedef {import('../domain/types.js').DebtPayment} DebtPayment */

/** @param {import('../domain/types.js').CollateralKind} kind @param {string} selected */
const collateralOptions = (kind, selected) =>
  COLLATERAL_OPTIONS[kind].map((o) => html`<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${o.label}</option>`);

// =============================================================================
// DEUDA
// =============================================================================

/**
 * @param {Store} store
 * @param {{ debt: Debt | null }} options
 */
export function openDebtForm(store, { debt }) {
  const isEdit = debt !== null;
  const today = store.today();
  const { data } = store.getState();
  const payments = debt ? data.debtPayments.filter((p) => p.debtId === debt.id) : [];

  const kind = debt?.collateralKind ?? 'personal';
  const type = debt?.collateralType ?? 'prestamo-personal';
  const rateBasis = debt?.rateBasis ?? 'annual';
  const frequency = debt?.frequency ?? 'monthly';

  openSheet({
    title: isEdit ? 'Editar deuda' : 'Añadir deuda',
    content: html`<form class="stack" novalidate>
      <div class="field" data-field="name">
        <label for="db-name">Nombre de la deuda</label>
        <input id="db-name" name="name" class="input" type="text" maxlength="${LIMITS.debtName}" autocomplete="off" placeholder="Ej.: Préstamo del banco" value="${debt?.name ?? ''}" data-autofocus />
        ${fieldError('name')}
      </div>

      ${moneyField({ id: 'db-total', name: 'totalText', label: 'Monto adeudado', value: debt ? centsToInputValue(debt.totalCents) : '', errorKey: 'total' })}
      ${isEdit
        ? ''
        : html`<p class="hint">Si ya venías pagando esta deuda, escribe lo que debes hoy y la fecha de tu próxima cuota.</p>`}

      <div class="field-row">
        <div class="field" data-field="rate">
          <label for="db-rate">Tasa de interés (%)</label>
          <input id="db-rate" name="rateText" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="Ej.: 18 (puede ser 0)" value="${debt ? rateToInputValue(debt.rateBp) : ''}" />
          ${fieldError('rate')}
        </div>
        <fieldset class="field" data-field="rateBasis">
          <legend>La tasa es</legend>
          <div class="segmented" role="radiogroup">
            <label class="segmented__option"><input type="radio" name="rateBasis" value="annual" ${rateBasis === 'annual' ? 'checked' : ''} /><span>Anual</span></label>
            <label class="segmented__option"><input type="radio" name="rateBasis" value="monthly" ${rateBasis === 'monthly' ? 'checked' : ''} /><span>Mensual</span></label>
          </div>
          ${fieldError('rateBasis')}
        </fieldset>
      </div>

      <div class="field" data-field="frequency">
        <label for="db-frequency">Frecuencia de pago</label>
        <select id="db-frequency" name="frequency" class="input">
          ${FREQUENCIES.map((f) => html`<option value="${f}" ${f === frequency ? 'selected' : ''}>${FREQUENCY_LABELS[f]}</option>`)}
        </select>
        ${fieldError('frequency')}
      </div>

      <fieldset class="field" data-field="collateralKind">
        <legend>Tipo de respaldo</legend>
        <div class="segmented" role="radiogroup">
          ${/** @type {const} */ (['personal', 'physical']).map(
            (k) => html`<label class="segmented__option"><input type="radio" name="collateralKind" value="${k}" ${kind === k ? 'checked' : ''} /><span>${COLLATERAL_KIND_LABELS[k]}</span></label>`,
          )}
        </div>
        ${fieldError('collateralKind')}
      </fieldset>

      <div class="field" data-field="collateralType">
        <label for="db-collateral">¿Qué la respalda?</label>
        <select id="db-collateral" name="collateralType" class="input">${collateralOptions(kind, type)}</select>
        <p class="hint" data-collateral-hint></p>
        ${fieldError('collateralType')}
      </div>

      <div class="field-row">
        <div class="field" data-field="firstDueDate">
          <label for="db-first-date">Próxima cuota (fecha)</label>
          <input id="db-first-date" name="firstDueDate" class="input" type="date" value="${debt?.firstDueDate ?? addMonthsToDate(today, 1)}" required />
          ${fieldError('firstDueDate')}
        </div>
        <div class="field" data-field="firstDueTime">
          <label for="db-first-time">Hora</label>
          <input id="db-first-time" name="firstDueTime" class="input" type="time" value="${debt?.firstDueTime ?? '09:00'}" required />
          ${fieldError('firstDueTime')}
        </div>
      </div>

      <div class="field-row">
        <div class="field" data-field="finalDueDate">
          <label for="db-final-date">Vencimiento final (fecha)</label>
          <input id="db-final-date" name="finalDueDate" class="input" type="date" value="${debt?.finalDueDate ?? addMonthsToDate(today, 12)}" required />
          ${fieldError('finalDueDate')}
        </div>
        <div class="field" data-field="finalDueTime">
          <label for="db-final-time">Hora</label>
          <input id="db-final-time" name="finalDueTime" class="input" type="time" value="${debt?.finalDueTime ?? '09:00'}" required />
          ${fieldError('finalDueTime')}
        </div>
      </div>

      <div class="field" data-field="note">
        <label for="db-note">Nota (opcional)</label>
        <input id="db-note" name="note" class="input" type="text" maxlength="${LIMITS.debtNote}" autocomplete="off" value="${debt?.note ?? ''}" />
        ${fieldError('note')}
      </div>

      <div class="debt-preview" data-debt-preview aria-live="polite" hidden></div>
      ${payments.length > 0
        ? html`<p class="hint">Esta deuda tiene ${payments.length} ${payments.length === 1 ? 'pago registrado' : 'pagos registrados'}. Se conservan; las cuotas que faltan se recalculan sobre lo que aún debes.</p>`
        : ''}
      <p class="hint">Guardar una deuda no registra dinero recibido. Si el préstamo entró a tu cuenta, anótalo aparte como un ingreso.</p>

      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions ${isEdit ? 'actions--split' : ''}">
        ${isEdit ? html`<button type="button" class="btn btn--danger-ghost" data-delete>Eliminar</button>` : ''}
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      const preview = $('[data-debt-preview]', sheet);
      const collateralSelect = /** @type {HTMLSelectElement} */ ($('#db-collateral', sheet));
      const collateralHint = $('[data-collateral-hint]', sheet);
      bindMoneyPreview(sheet, 'db-total');

      /** @param {Record<string, string>} v */
      const toInput = (v) => ({
        name: v.name ?? '', note: v.note ?? '', totalText: v.totalText ?? '', rateText: v.rateText ?? '',
        rateBasis: v.rateBasis ?? '', frequency: v.frequency ?? '', collateralKind: v.collateralKind ?? '',
        collateralType: v.collateralType ?? '', firstDueDate: v.firstDueDate ?? '', firstDueTime: v.firstDueTime ?? '',
        finalDueDate: v.finalDueDate ?? '', finalDueTime: v.finalDueTime ?? '',
      });

      const refreshPreview = () => {
        collateralHint.textContent =
          collateralSelect.value === 'tarjeta'
            ? 'Una tarjeta no tiene cuotas fijas: ACCONTROL la trata como un plan de pagos iguales hasta la fecha final.'
            : '';
        const checked = validateDebt(toInput(readForm(form)));
        if (!checked.ok) {
          preview.hidden = true;
          preview.textContent = '';
          return;
        }
        const e = estimateDebt(checked.value);
        setHtml(
          preview,
          html`<p><strong>Con estos datos:</strong> ${e.installments} ${e.installments === 1 ? 'cuota' : 'cuotas'} de unos <strong>${formatMoney(e.paymentCents)}</strong>${e.lastPaymentCents !== e.paymentCents ? html` (la última, ${formatMoney(e.lastPaymentCents)})` : ''}.</p>
            <p>Intereses estimados: <strong>${formatMoney(e.interestCents)}</strong> · Total a pagar: <strong>${formatMoney(e.totalCents)}</strong>.</p>
            <p class="debt-preview__note">Es una estimación. Tu entidad puede cobrar seguros o cargos que aquí no se incluyen.</p>`,
        );
        preview.hidden = false;
      };

      // Al cambiar el tipo de respaldo, cambia la lista de opciones.
      for (const radio of $$('input[name="collateralKind"]', sheet)) {
        radio.addEventListener('change', () => {
          const picked = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="collateralKind"]:checked'))?.value;
          if (picked === 'physical' || picked === 'personal') setHtml(collateralSelect, html`${collateralOptions(picked, '')}`);
          refreshPreview();
        });
      }
      form.addEventListener('input', refreshPreview);
      form.addEventListener('change', refreshPreview);
      refreshPreview();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const result = await store.saveDebt(toInput(readForm(form)), debt?.id ?? null);
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Cambios guardados.' : 'Deuda guardada.');
        if (!isEdit && !window.location.hash.startsWith('#/deudas')) window.location.hash = '#/deudas';
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && debt) {
        deleteButton.addEventListener('click', async () => {
          const fresh = store.getState().data.debtPayments.filter((p) => p.debtId === debt.id);
          const paid = fresh.reduce((sum, p) => sum + p.amountCents, 0);
          const ok = await confirmDialog({
            title: '¿Eliminar esta deuda?',
            message:
              fresh.length === 0
                ? `Se borrará «${debt.name}». Esta acción no se puede deshacer.`
                : `Se borrará «${debt.name}» junto con sus ${fresh.length} ${fresh.length === 1 ? 'pago' : 'pagos'} y los gastos que se anotaron al pagarlos. Esos ${formatMoney(paid)} volverán a tu dinero disponible. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteDebt(debt.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Deuda eliminada.');
          if (window.location.hash.startsWith(`#/deudas/${debt.id}`)) window.location.hash = '#/deudas';
        });
      }
    },
  });
}

// =============================================================================
// PAGO DE UNA DEUDA
// =============================================================================

/**
 * @param {Store} store
 * @param {{ debtId: string, payment?: DebtPayment | null }} options
 */
export function openPaymentForm(store, { debtId, payment = null }) {
  const { data } = store.getState();
  const debt = data.debts.find((x) => x.id === debtId);
  if (!debt) {
    toast('Esa deuda ya no existe.', 'error');
    return;
  }
  const today = store.today();
  const isEdit = payment !== null;
  const payments = data.debtPayments.filter((p) => p.debtId === debtId);
  const status = debtStatus(debt, payments, today);
  if (!isEdit && status.paid) {
    toast('Esta deuda ya está pagada por completo.', 'info');
    return;
  }
  const prefill = !isEdit && status.next ? centsToInputValue(status.next.paymentCents) : '';
  const initialKind = payment?.kind ?? 'regular';

  openSheet({
    title: isEdit ? 'Editar pago' : 'Registrar pago',
    content: html`<form class="stack" novalidate>
      <div class="field">
        <span class="field__label">Deuda</span>
        <p class="static-value">${debt.name}</p>
        <p class="hint">Debes ${formatMoney(status.balanceCents)} ${isEdit ? 'ahora (con todos los pagos actuales)' : ''}.</p>
      </div>

      <fieldset class="field" data-field="kind">
        <legend>Tipo de pago</legend>
        <div class="segmented" role="radiogroup">
          <label class="segmented__option"><input type="radio" name="kind" value="regular" ${initialKind === 'regular' ? 'checked' : ''} /><span>Cuota</span></label>
          <label class="segmented__option"><input type="radio" name="kind" value="extra" ${initialKind === 'extra' ? 'checked' : ''} /><span>Abono extra</span></label>
        </div>
        <p class="hint" data-kind-hint></p>
        ${fieldError('kind')}
      </fieldset>

      ${moneyField({ id: 'pg-amount', name: 'amountText', label: 'Monto pagado', value: payment ? centsToInputValue(payment.amountCents) : prefill, errorKey: 'amount', autofocus: true })}
      <p class="hint" data-payment-split></p>
      <p class="hint hint--warn" data-available-warning hidden></p>

      <div class="field-row">
        <div class="field" data-field="date">
          <label for="pg-date">Fecha</label>
          <input id="pg-date" name="date" class="input" type="date" max="${today}" value="${payment?.date ?? today}" required />
          ${fieldError('date')}
        </div>
        <div class="field" data-field="time">
          <label for="pg-time">Hora</label>
          <input id="pg-time" name="time" class="input" type="time" value="${payment?.time ?? currentTime(store.now())}" required />
          ${fieldError('time')}
        </div>
      </div>

      <div class="field" data-field="note">
        <label for="pg-note">Nota (opcional)</label>
        <input id="pg-note" name="note" class="input" type="text" maxlength="${LIMITS.note}" autocomplete="off" value="${payment?.note ?? ''}" />
        ${fieldError('note')}
      </div>

      <p class="hint">Al guardar, el pago se anota también como un gasto en «Pago de deudas» y baja tu dinero disponible.</p>

      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>

      <div class="actions ${isEdit ? 'actions--split' : ''}">
        ${isEdit ? html`<button type="button" class="btn btn--danger-ghost" data-delete>Eliminar</button>` : ''}
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar pago</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      const amountInput = /** @type {HTMLInputElement} */ ($('#pg-amount', sheet));
      const kindHint = $('[data-kind-hint]', sheet);
      const split = $('[data-payment-split]', sheet);
      const warning = $('[data-available-warning]', sheet);
      bindMoneyPreview(sheet, 'pg-amount');

      const kindValue = () => /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="kind"]:checked'))?.value ?? 'regular';

      const refresh = () => {
        const v = readForm(form);
        const fresh = store.getState().data;
        const freshPayments = fresh.debtPayments.filter((p) => p.debtId === debtId);

        const next = status.next;
        kindHint.textContent =
          kindValue() === 'regular'
            ? next
              ? `Cuota estimada: ${formatMoney(next.paymentCents)} (interés ${formatMoney(next.interestCents)} y capital ${formatMoney(next.principalCents)}), vence el ${formatDate(next.date)}.`
              : ''
            : 'Un abono extra va completo al capital: baja lo que debes y los intereses que faltan.';

        split.classList.remove('hint--warn');
        warning.hidden = true;
        const result = previewPayment(
          { kind: v.kind ?? '', amountText: v.amountText ?? '', date: v.date ?? '', time: v.time ?? '', note: v.note ?? '' },
          { today, debt, payments: freshPayments, editingId: payment?.id ?? null },
        );
        if (result.ok) {
          split.textContent = `De este pago, ${formatMoney(result.interestCents)} van a intereses y ${formatMoney(result.principalCents)} a capital. Te quedarías debiendo ${formatMoney(result.balanceAfterCents)}.`;
          const parsed = parseMoney(v.amountText ?? '');
          if (parsed.ok) {
            const without = { ...fresh, movements: fresh.movements.filter((m) => m.id !== payment?.movementId) };
            const after = overallTotals(without, today).availableCents - parsed.cents;
            if (after < 0 && after < overallTotals(fresh, today).availableCents) {
              warning.textContent = `Después de este pago tu dinero disponible quedaría en ${formatMoney(after)}. Puedes guardarlo, pero revisa si falta registrar algún ingreso.`;
              warning.hidden = false;
            }
          }
        } else if (result.errors.amount && (v.amountText ?? '').trim() !== '' && parseMoney(v.amountText ?? '').ok) {
          split.textContent = result.errors.amount;
          split.classList.add('hint--warn');
        } else {
          split.textContent = '';
        }
      };

      let lastPrefill = prefill;
      for (const radio of $$('input[name="kind"]', sheet)) {
        radio.addEventListener('change', () => {
          // Si el monto es el de la cuota sugerida, lo ajustamos al cambiar de tipo.
          if (!isEdit) {
            if (kindValue() === 'extra' && amountInput.value === lastPrefill) amountInput.value = '';
            else if (kindValue() === 'regular' && amountInput.value.trim() === '' && prefill) amountInput.value = prefill;
            lastPrefill = prefill;
            amountInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          refresh();
        });
      }
      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      refresh();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveDebtPayment(
          debtId,
          { kind: v.kind ?? '', amountText: v.amountText ?? '', date: v.date ?? '', time: v.time ?? '', note: v.note ?? '' },
          payment?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        const after = store.getState().data;
        const freshDebt = after.debts.find((x) => x.id === debtId);
        const finished = freshDebt
          ? debtStatus(freshDebt, after.debtPayments.filter((p) => p.debtId === debtId), today).paid
          : false;
        haptic(finished ? 'success' : 'confirm');
        toast(finished ? '¡Deuda pagada por completo!' : isEdit ? 'Cambios guardados.' : 'Pago registrado y anotado como gasto.');
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && payment) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '¿Eliminar este pago?',
            message: `Se borrará el pago de ${formatMoney(payment.amountCents)} y el gasto que se anotó con él. Ese dinero volverá a tu disponible y la deuda subirá otra vez. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteDebtPayment(payment.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Pago eliminado.');
        });
      }
    },
  });
}
