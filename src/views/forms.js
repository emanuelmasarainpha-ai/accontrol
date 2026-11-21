// @ts-check
// =============================================================================
// FORMULARIOS (ventanas para añadir y editar)
// -----------------------------------------------------------------------------
// Movimiento (ingreso/gasto), aporte a una meta, meta, categoría y el menú
// "Añadir". Todos reciben `store` y solo hablan con sus acciones: la validación
// y el guardado viven en el store y en domain/, no aquí.
// =============================================================================

import { categoriesOfKind } from '../domain/categories.js';
import { SERVICE_STATUS_LABELS, clientLabel, sortClients } from '../domain/clients.js';
import { currentTime, formatDate } from '../domain/dates.js';
import { paidByService, summarizeService } from '../domain/freelance.js';
import { billedByService } from '../domain/invoices.js';
import { goalProgress, goalSavedCents } from '../domain/goals.js';
import { centsToInputValue, formatMoney, formatMoneyIn, parseMoney } from '../domain/money.js';
import { CURRENCY_CODES, CURRENCIES, currencyInfo } from '../domain/currencies.js';
import { convertCents, crossRateMicro, formatExchangeRate, hasForeign, lastRateFor, parseRate, rateLooksOdd } from '../domain/exchange.js';
import { ratesClient } from '../data/ratesClient.js';
import { overallTotals } from '../domain/summaries.js';
import { CLASSIFICATIONS_BY_TYPE, CLASSIFICATION_LABELS, LIMITS } from '../domain/types.js';
import { $, $$ } from '../ui/dom.js';
import { choiceDialog, confirmDialog, openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { haptic } from '../ui/haptics.js';
import { toast } from '../ui/toast.js';
import { ACTION_MODULE, canEditData, permissionsOf } from '../domain/roles.js';
import { atLeast } from '../domain/permissions.js';
import { openAssetForm } from './asset-forms.js';
import { openCreditForm } from './fiado-forms.js';
import { openProductForm } from './inventory-forms.js';
import { openInvoiceForm } from './invoice-forms.js';
import { openDebtForm } from './debt-forms.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Movement} Movement */
/** @typedef {import('../domain/types.js').Contribution} Contribution */
/** @typedef {import('../domain/types.js').Goal} Goal */

/** Explicación breve de cada clasificación (documento maestro §4.1 y §4.2). */
const CLASSIFICATION_HINTS = {
  income: {
    fixed: 'Estable y recurrente: salario, pensión, alquiler recibido.',
    variable: 'Cambia cada vez: comisiones, ventas, propinas.',
    extraordinary: 'Poco frecuente: bonificaciones, premios, regalos, herencias.',
  },
  expense: {
    fixed: 'Obligación recurrente: alquiler, electricidad, agua, internet, transporte.',
    variable: 'Necesidad que cambia: alimentación, combustible, medicamentos.',
    discretionary: 'Según tus preferencias: ropa, restaurantes, entretenimiento, videojuegos.',
  },
};

// =============================================================================
// INGRESO / GASTO
// =============================================================================

/**
 * 0.18.5: «¿En qué moneda pagaste?» y, si no es la del espacio, la tasa de ese día.
 * @param {string} base @param {string} selected @param {string} rateText
 */
function foreignFields(base, selected, rateText) {
  const b = currencyInfo(base);
  const s = currencyInfo(selected);
  return html`<div class="field-row">
    <div class="field" data-field="currency">
      <label for="mv-currency">Moneda del pago</label>
      <select id="mv-currency" name="currency" class="input" aria-describedby="currency-error">
        <option value="${b.code}" ${selected === b.code ? 'selected' : ''}>${b.label} (${b.symbol})</option>
        ${CURRENCY_CODES.filter((c) => c !== b.code).map((c) => html`<option value="${c}" ${c === selected ? 'selected' : ''}>${CURRENCIES[c].label} (${CURRENCIES[c].symbol})</option>`)}
      </select>
      ${fieldError('currency')}
    </div>
    <div class="field" data-field="rate" data-fx-rate ${selected === b.code ? 'hidden' : ''}>
      <label for="mv-rate" data-fx-rate-label>Tasa: 1 ${s.symbol} = ¿cuántos ${b.symbol}?</label>
      <input id="mv-rate" name="rateText" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${rateText}" aria-describedby="mv-rate-hint rate-error" />
      <p class="hint" id="mv-rate-hint" data-fx-rate-hint>${ratesClient() ? 'La del día en que pagaste. Se pone sola con la tasa de referencia de ese día; si tu banco te cobró otra, cámbiala.' : 'La del día en que pagaste. La escribes tú: sin cuenta, la app no puede traerla de internet.'}</p>
      ${fieldError('rate')}
    </div>
  </div>`;
}

/**
 * Pone al día el formulario según la moneda elegida: el símbolo del monto, la tasa (propone la última usada con esa
 * moneda) y lo que se registrará en la moneda del espacio.
 * @param {HTMLElement} sheet @param {string} base @param {readonly Movement[]} movements
 */
function bindForeign(sheet, base, movements) {
  const currency = /** @type {HTMLSelectElement | null} */ (sheet.querySelector('#mv-currency'));
  const rate = /** @type {HTMLInputElement | null} */ (sheet.querySelector('#mv-rate'));
  const amount = /** @type {HTMLInputElement | null} */ (sheet.querySelector('#mv-amount'));
  const rateField = sheet.querySelector('[data-fx-rate]');
  const rateLabel = sheet.querySelector('[data-fx-rate-label]');
  const symbol = sheet.querySelector('#mv-amount')?.closest('.input-money')?.querySelector('.input-money__symbol');
  const preview = sheet.querySelector('[data-preview-for="mv-amount"]');
  const rateHint = sheet.querySelector('[data-fx-rate-hint]');
  const dateInput = /** @type {HTMLInputElement | null} */ (sheet.querySelector('#mv-date'));
  if (!currency || !rate || !amount || !(rateField instanceof HTMLElement) || !rateLabel || !symbol || !preview || !rateHint) return;
  const manualHint = rateHint.textContent ?? '';
  // Tocada = la escribió la persona (o es la de un movimiento que se está editando): ya no se cambia sola.
  let rateTouched = rate.value !== '';
  let request = 0;

  /** 0.18.6: la tasa de referencia del día del movimiento, si hay a quién preguntarle y la persona no escribió otra. */
  const autoRate = async () => {
    const client = ratesClient();
    const code = currency.value;
    if (!client || rateTouched || code === base) return;
    const mine = (request += 1);
    const day = dateInput?.value ?? '';
    rateHint.textContent = 'Buscando la tasa de referencia de ese día…';
    const result = await client.ratesFor(day);
    if (mine !== request || rateTouched || currency.value !== code) return; // ya cambió algo mientras llegaba
    const exact = result.ok ? crossRateMicro(result.rates, code, base) : null;
    // Más fácil de leer: 4 decimales si la tasa pasa de 1 (60.2327); las pequeñas (0.016602) conservan los 6.
    const micro = exact !== null && exact >= 1_000_000 ? Math.round(exact / 100) * 100 : exact;
    if (!result.ok || micro === null) {
      rateHint.textContent = `${result.ok ? 'No se pudo calcular la tasa.' : result.error} ${rate.value ? 'Se dejó la última que usaste.' : ''}`.trim();
      return;
    }
    rate.value = formatExchangeRate(micro);
    rateHint.textContent = `Tasa de referencia del ${formatDate(result.date)}${result.date !== day ? ' (la más reciente publicada)' : ''}, de ${result.source}. Si tu banco te cobró otra, cámbiala.`;
    update();
  };
  const update = () => {
    const code = currency.value;
    const isForeign = code !== base;
    rateField.hidden = !isForeign;
    symbol.textContent = currencyInfo(code).symbol;
    rateLabel.textContent = `Tasa: 1 ${currencyInfo(code).symbol} = ¿cuántos ${currencyInfo(base).symbol}?`;
    if (!isForeign) return;
    const paid = parseMoney(amount.value.trim());
    const r = parseRate(rate.value);
    if (!amount.value.trim() || !paid.ok) return; // el aviso del monto ya lo da la vista previa normal
    if (!r.ok) {
      preview.textContent = `${formatMoneyIn(paid.cents, code)}: escribe la tasa para saber cuánto es en ${currencyInfo(base).symbol}.`;
      return;
    }
    const last = lastRateFor(movements, code);
    const odd = rateLooksOdd(r.micro, last);
    preview.classList.toggle('hint--warn', odd);
    preview.textContent = `Se registrará ${formatMoneyIn(convertCents(paid.cents, r.micro), base)} (${formatMoneyIn(paid.cents, code)} a ${formatExchangeRate(r.micro)})`
      + (odd && last ? `. Ojo: la última vez usaste ${formatExchangeRate(last)}; revisa que la tasa esté bien.` : '');
  };
  currency.addEventListener('change', () => {
    if (currency.value !== base && !rateTouched) {
      const last = lastRateFor(movements, currency.value);
      rate.value = last ? formatExchangeRate(last) : '';
      rateHint.textContent = manualHint;
    }
    update();
    void autoRate();
  });
  dateInput?.addEventListener('change', () => void autoRate());
  rate.addEventListener('input', () => {
    rateTouched = rate.value !== '';
    request += 1; // lo que estuviera llegando ya no se pone encima de lo que escribió
    if (rateTouched) rateHint.textContent = manualHint;
    update();
  });
  amount.addEventListener('input', update);
  update();
}

/**
 * @param {Store} store
 * @param {{ type: 'income' | 'expense', movement?: Movement | null, clientId?: string | null, serviceId?: string | null }} options
 *   `clientId` / `serviceId`: vínculo con el que se abre un ingreso nuevo («Registrar pago» desde un cliente o servicio).
 */
export function openMovementForm(store, { type, movement = null, clientId = null, serviceId = null }) {
  const { data } = store.getState();
  const isEdit = movement !== null;
  const kind = movement ? movement.type : type;
  const categories = categoriesOfKind(data.categories, kind);
  const today = store.today();
  const initialCategory = movement ? movement.categoryId : '';
  const initialClass = movement ? movement.classification : CLASSIFICATIONS_BY_TYPE[kind][1];
  const hints = /** @type {Record<string, string>} */ (CLASSIFICATION_HINTS[kind]);
  const noun = kind === 'income' ? 'ingreso' : 'gasto';
  // 0.18.5: pagado en otra moneda. La moneda del espacio es la de siempre; con otra se pide la tasa del día.
  const baseCurrency = store.activeWorkspace()?.currency ?? 'DOP';
  const foreign = movement !== null && hasForeign(movement);

  // Cliente (en ingresos: de quién viene el pago; en gastos: a quién se le carga) y servicio (solo ingresos), si el espacio usa
  // clientes. Se ofrecen los clientes activos y el ya vinculado.
  const showClients = store.clientsEnabled();
  const showServices = showClients && kind === 'income';
  // Departamento (solo gastos, y solo si el espacio los usa). Se ofrecen los activos y el ya asignado, aunque esté archivado.
  const showDepartments = kind === 'expense' && store.departmentsEnabled();
  const linkedDepartment = movement?.departmentId ?? '';
  const departmentChoices = data.departments
    .filter((d) => !d.archived || d.id === linkedDepartment)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const linkedService = movement?.serviceId ?? serviceId ?? '';
  const linkedClient = movement?.clientId ?? clientId ?? data.services.find((x) => x.id === linkedService)?.clientId ?? '';
  const clientChoices = sortClients(data.clients).filter((c) => !c.archived || c.id === linkedClient);
  const paid = paidByService(data.movements.filter((m) => m.id !== movement?.id), store.today());
  const billed = billedByService(data.invoices);
  /** Servicios que se ofrecen para un cliente: los no cancelados y el ya vinculado. @param {string} forClient @param {string} selected */
  const serviceOptions = (forClient, selected) => [
    html`<option value="" ${selected === '' ? 'selected' : ''}>Sin servicio (pago suelto)</option>`,
    ...data.services
      .filter((x) => x.clientId === forClient && (x.status !== 'cancelled' || x.id === selected))
      .map((x) => html`<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${x.name} · ${SERVICE_STATUS_LABELS[x.status]}</option>`),
  ];
  /** Cuánto falta por cobrar de un servicio, en una línea. @param {string} id */
  const serviceHint = (id) => {
    const svc = data.services.find((x) => x.id === id);
    if (!svc) return '';
    const sum = summarizeService(svc, paid, billed);
    const left = Math.max(0, svc.priceCents - sum.paidCents - sum.billedCents);
    return sum.billedCents > 0
      ? `Precio ${formatMoney(svc.priceCents)} · cobrado ${formatMoney(sum.paidCents)} · facturado ${formatMoney(sum.billedCents)} (se cobra en su factura) · sin facturar ${formatMoney(left)}`
      : `Precio ${formatMoney(svc.priceCents)} · cobrado ${formatMoney(sum.paidCents)} · falta ${formatMoney(left)}`;
  };

  openSheet({
    title: isEdit ? `Editar ${noun}` : kind === 'income' ? 'Añadir ingreso' : 'Añadir gasto',
    content: html`<form class="stack" novalidate data-movement="${kind}">
      ${moneyField({ id: 'mv-amount', name: 'amountText', label: 'Monto', value: movement ? centsToInputValue(foreign ? /** @type {number} */ (movement.originalAmountCents) : movement.amountCents) : '', errorKey: 'amount', autofocus: !isEdit })}

      ${foreignFields(baseCurrency, foreign ? /** @type {string} */ (movement?.originalCurrency) : baseCurrency, foreign ? formatExchangeRate(/** @type {number} */ (movement?.exchangeRateMicro)) : '')}

      <div class="field-row">
        <div class="field" data-field="date">
          <label for="mv-date">Fecha</label>
          <input id="mv-date" name="date" class="input" type="date" max="${today}" value="${movement?.date ?? today}" required aria-describedby="date-error" />
          ${fieldError('date')}
        </div>
        <div class="field" data-field="time">
          <label for="mv-time">Hora</label>
          <input id="mv-time" name="time" class="input" type="time" value="${movement?.time ?? currentTime(store.now())}" required aria-describedby="time-error" />
          ${fieldError('time')}
        </div>
      </div>

      <div class="field" data-field="description">
        <label for="mv-description">Descripción</label>
        <input id="mv-description" name="description" class="input" type="text" maxlength="${LIMITS.description}" autocomplete="off" placeholder="${kind === 'income' ? 'Ej.: Entrenamiento personal' : 'Ej.: Protector solar'}" value="${movement?.description ?? ''}" aria-describedby="description-error" />
        ${fieldError('description')}
      </div>

      ${showClients
        ? html`<div class="field" data-field="client">
              <label for="mv-client">${kind === 'income' ? 'Cliente (opcional)' : 'Cargar a un cliente (opcional)'}</label>
              <select id="mv-client" name="clientId" class="input">
                <option value="" ${linkedClient ? '' : 'selected'}>${kind === 'income' ? 'Sin cliente' : 'Sin cliente (gasto general)'}</option>
                ${clientChoices.map((c) => html`<option value="${c.id}" ${c.id === linkedClient ? 'selected' : ''}>${clientLabel(c)}${c.archived ? ' (archivado)' : ''}</option>`)}
              </select>
              ${data.clients.length === 0
                ? html`<p class="hint">Aún no tienes clientes. Créalos en Finanzas → Clientes para saber ${kind === 'income' ? 'cuánto te paga cada uno' : 'cuánto te cuesta y cuánto te deja cada uno'}.</p>`
                : kind === 'expense'
                  ? html`<p class="hint">Si este gasto fue para trabajarle a un cliente (una licencia, un viaje, materiales), cárgaselo: así ves cuánto te deja de verdad. Los gastos generales, déjalos sin cliente.</p>`
                  : ''}
              ${fieldError('client')}
            </div>
            ${showServices
              ? html`<div class="field" data-field="service" ${linkedClient ? '' : 'hidden'} data-service-field>
                  <label for="mv-service">Servicio (opcional)</label>
                  <select id="mv-service" name="serviceId" class="input">${serviceOptions(linkedClient, linkedService)}</select>
                  <p class="hint" data-service-hint>${serviceHint(linkedService)}</p>
                  ${fieldError('service')}
                </div>`
              : ''}`
        : ''}

      ${showDepartments
        ? html`<div class="field" data-field="department">
              <label for="mv-department">Departamento (opcional)</label>
              <select id="mv-department" name="departmentId" class="input">
                <option value="" ${linkedDepartment ? '' : 'selected'}>Sin departamento</option>
                ${departmentChoices.map((d) => html`<option value="${d.id}" ${d.id === linkedDepartment ? 'selected' : ''}>${d.name}${d.archived ? ' (archivado)' : ''}</option>`)}
              </select>
              ${departmentChoices.length === 0 ? html`<p class="hint">Aún no tienes departamentos. Créalos en Finanzas → Departamentos para saber cuánto gasta cada área frente a su presupuesto.</p>` : ''}
              ${fieldError('department')}
            </div>`
        : ''}

      <div class="field" data-field="category">
        <label for="mv-category">Categoría</label>
        <select id="mv-category" name="categoryId" class="input" aria-describedby="category-error">
          <option value="" ${initialCategory ? '' : 'selected'} disabled>Elige una categoría</option>
          ${categories.map((c) => html`<option value="${c.id}" ${c.id === initialCategory ? 'selected' : ''}>${c.name}</option>`)}
          <option value="__new__">＋ Nueva categoría…</option>
        </select>
        <input id="mv-new-category" name="newCategoryName" class="input input--spaced" type="text" maxlength="${LIMITS.categoryName}" autocomplete="off" placeholder="Nombre de la nueva categoría" aria-label="Nombre de la nueva categoría" hidden />
        ${fieldError('category')}
      </div>

      <fieldset class="field" data-field="classification">
        <legend>Clasificación</legend>
        <div class="segmented" role="radiogroup">
          ${CLASSIFICATIONS_BY_TYPE[kind].map(
            (c) => html`<label class="segmented__option"><input type="radio" name="classification" value="${c}" ${c === initialClass ? 'checked' : ''} /><span>${CLASSIFICATION_LABELS[c]}</span></label>`,
          )}
        </div>
        <p class="hint" data-class-hint></p>
        ${fieldError('classification')}
      </fieldset>

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
      const select = /** @type {HTMLSelectElement} */ ($('#mv-category', sheet));
      const newName = /** @type {HTMLInputElement} */ ($('#mv-new-category', sheet));
      const hint = $('[data-class-hint]', sheet);
      let classTouched = isEdit;

      bindMoneyPreview(sheet, 'mv-amount');
      bindForeign(sheet, baseCurrency, data.movements.filter((m) => m.id !== movement?.id));

      // Cliente → servicio: al elegir otro cliente se ofrecen sus servicios.
      const clientSelect = /** @type {HTMLSelectElement | null} */ (sheet.querySelector('#mv-client'));
      const serviceSelect = /** @type {HTMLSelectElement | null} */ (sheet.querySelector('#mv-service'));
      const serviceField = sheet.querySelector('[data-service-field]');
      const serviceHintEl = sheet.querySelector('[data-service-hint]');
      if (clientSelect && serviceSelect && serviceField instanceof HTMLElement && serviceHintEl) {
        clientSelect.addEventListener('change', () => {
          setHtml(serviceSelect, html`${serviceOptions(clientSelect.value, '')}`);
          serviceField.hidden = clientSelect.value === '';
          serviceHintEl.textContent = '';
        });
        serviceSelect.addEventListener('change', () => {
          serviceHintEl.textContent = serviceHint(serviceSelect.value);
        });
      }

      const currentClass = () => /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="classification"]:checked'))?.value ?? '';
      const updateHint = () => {
        hint.textContent = hints[currentClass()] ?? '';
      };
      updateHint();

      for (const radio of $$('input[name="classification"]', sheet)) {
        radio.addEventListener('change', () => {
          classTouched = true;
          updateHint();
        });
      }

      select.addEventListener('change', () => {
        const isNew = select.value === '__new__';
        newName.hidden = !isNew;
        if (isNew) newName.focus();
        // La clasificación sugerida sigue a la categoría, salvo que el usuario ya eligió una.
        const picked = data.categories.find((c) => c.id === select.value);
        if (picked && !classTouched) {
          const radio = /** @type {HTMLInputElement | null} */ (form.querySelector(`input[name="classification"][value="${picked.defaultClassification}"]`));
          if (radio) radio.checked = true;
          updateHint();
        }
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const isNew = v.categoryId === '__new__';
        const result = await store.saveMovement(
          {
            type: kind,
            amountText: v.amountText ?? '',
            date: v.date ?? '',
            time: v.time ?? '',
            description: v.description ?? '',
            classification: v.classification ?? '',
            categoryId: isNew ? '' : v.categoryId ?? '',
            newCategoryName: isNew ? v.newCategoryName ?? '' : '',
            clientId: v.clientId ?? '',
            serviceId: v.serviceId ?? '',
            departmentId: v.departmentId ?? '',
            currency: v.currency ?? '',
            rateText: v.rateText ?? '',
          },
          movement?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        haptic('confirm');
        toast(isEdit ? 'Cambios guardados.' : kind === 'income' ? 'Ingreso guardado.' : 'Gasto guardado.');
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && movement) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: `¿Eliminar este ${noun}?`,
            message: `Se borrará «${movement.description}» por ${formatMoney(movement.amountCents)}. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteMovement(movement.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Movimiento eliminado.');
        });
      }
    },
  });
}

// =============================================================================
// APORTE / RETIRO DE UNA META
// =============================================================================

/**
 * @param {Store} store
 * @param {{ goalId?: string | null, contribution?: Contribution | null, kind?: 'deposit' | 'withdrawal' }} options
 */
export function openContributionForm(store, { goalId = null, contribution = null, kind = 'deposit' }) {
  const { data } = store.getState();
  const isEdit = contribution !== null;
  const lockedGoalId = contribution?.goalId ?? goalId;
  const today = store.today();
  const initialKind = contribution?.kind ?? kind;
  const initialGoalId = lockedGoalId ?? data.goals[0]?.id ?? '';

  openSheet({
    title: isEdit ? 'Editar movimiento de ahorro' : initialKind === 'withdrawal' ? 'Retirar de una meta' : 'Añadir ahorro',
    content: html`<form class="stack" novalidate>
      <div class="field" data-field="goal">
        <label for="ct-goal">Meta</label>
        ${lockedGoalId
          ? html`<p class="static-value">${data.goals.find((g) => g.id === lockedGoalId)?.name ?? 'Meta eliminada'}</p><input type="hidden" name="goalId" value="${lockedGoalId}" />`
          : html`<select id="ct-goal" name="goalId" class="input">${data.goals.map((g) => html`<option value="${g.id}" ${g.id === initialGoalId ? 'selected' : ''}>${g.name}</option>`)}</select>`}
        <p class="hint" data-goal-balance></p>
      </div>

      <fieldset class="field" data-field="kind">
        <legend>Tipo</legend>
        <div class="segmented" role="radiogroup">
          <label class="segmented__option"><input type="radio" name="kind" value="deposit" ${initialKind === 'deposit' ? 'checked' : ''} /><span>Aporte</span></label>
          <label class="segmented__option"><input type="radio" name="kind" value="withdrawal" ${initialKind === 'withdrawal' ? 'checked' : ''} /><span>Retiro</span></label>
        </div>
        ${fieldError('kind')}
      </fieldset>

      ${moneyField({ id: 'ct-amount', name: 'amountText', label: 'Monto', value: contribution ? centsToInputValue(contribution.amountCents) : '', errorKey: 'amount', autofocus: !isEdit })}
      <p class="hint hint--warn" data-available-warning hidden></p>

      <div class="field-row">
        <div class="field" data-field="date">
          <label for="ct-date">Fecha</label>
          <input id="ct-date" name="date" class="input" type="date" max="${today}" value="${contribution?.date ?? today}" required />
          ${fieldError('date')}
        </div>
        <div class="field" data-field="time">
          <label for="ct-time">Hora</label>
          <input id="ct-time" name="time" class="input" type="time" value="${contribution?.time ?? currentTime(store.now())}" required />
          ${fieldError('time')}
        </div>
      </div>

      <div class="field" data-field="note">
        <label for="ct-note">Nota (opcional)</label>
        <input id="ct-note" name="note" class="input" type="text" maxlength="${LIMITS.note}" autocomplete="off" value="${contribution?.note ?? ''}" />
        ${fieldError('note')}
      </div>

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
      const amountInput = /** @type {HTMLInputElement} */ ($('#ct-amount', sheet));
      const balanceHint = $('[data-goal-balance]', sheet);
      const warning = $('[data-available-warning]', sheet);
      bindMoneyPreview(sheet, 'ct-amount');

      const selectedGoalId = () => /** @type {HTMLInputElement | HTMLSelectElement} */ (form.elements.namedItem('goalId')).value;
      const selectedKind = () => /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="kind"]:checked'))?.value ?? 'deposit';

      const refresh = () => {
        const fresh = store.getState().data;
        const goal = fresh.goals.find((g) => g.id === selectedGoalId());
        const saved = goal ? goalSavedCents(goal.id, fresh.contributions, contribution?.id ?? null) : 0;
        balanceHint.textContent = goal ? `Esta meta tiene ${formatMoney(Math.max(0, saved))} ahorrados.` : '';

        // Aviso previo: un aporte que supera el dinero disponible (al guardar se pregunta el origen).
        warning.hidden = true;
        const parsed = parseMoney(amountInput.value);
        if (selectedKind() === 'deposit' && parsed.ok && parsed.cents > 0) {
          const withoutThis = { ...fresh, contributions: fresh.contributions.filter((c) => c.id !== contribution?.id) };
          const after = overallTotals(withoutThis, store.today()).availableCents - parsed.cents;
          const current = overallTotals(fresh, store.today()).availableCents;
          if (after < 0 && after < current) {
            const shortfall = Math.min(parsed.cents, -after);
            warning.textContent = `Este aporte supera tu dinero disponible por ${formatMoney(shortfall)}. Al guardar te preguntaremos si esa diferencia es dinero que aún no habías registrado.`;
            warning.hidden = false;
          }
        }
      };
      refresh();
      amountInput.addEventListener('input', refresh);
      for (const el of $$('input[name="kind"], select[name="goalId"]', sheet)) el.addEventListener('change', refresh);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        /** @type {import('../domain/goals.js').ContributionInput} */
        let input = { kind: v.kind ?? '', amountText: v.amountText ?? '', date: v.date ?? '', time: v.time ?? '', note: v.note ?? '' };
        const goalIdValue = v.goalId ?? '';
        let result = await store.saveContribution(goalIdValue, input, contribution?.id ?? null);

        // El aporte supera el dinero disponible: preguntamos de dónde sale la diferencia.
        if (!result.ok && result.needsFunds) {
          const { availableCents, shortfallCents } = result.needsFunds;
          const choice = await choiceDialog({
            title: '¿De dónde sale el resto del dinero?',
            message: `Tu dinero disponible es ${formatMoney(availableCents)} y quieres apartar ${formatMoney(availableCents + shortfallCents)}. Los ${formatMoney(shortfallCents)} que faltan, ¿son dinero que tienes pero todavía no habías registrado (un aporte externo a tu saldo)?`,
            choices: [
              { id: 'cover', primary: true, label: 'Sí, es dinero que no había registrado', note: `Se anotará un ingreso de ${formatMoney(shortfallCents)} y luego se hará el aporte completo.` },
              ...(availableCents > 0
                ? [{ id: 'partial', label: `No, aportar solo lo que tengo (${formatMoney(availableCents)})`, note: 'Tu saldo no cambia de otra forma: solo apartas lo que realmente está disponible.' }]
                : []),
              { id: 'cancel', label: 'Cancelar', note: 'Vuelves al formulario sin guardar nada.' },
            ],
          });
          if (choice === 'cover') {
            result = await store.saveContribution(goalIdValue, input, contribution?.id ?? null, { coverShortfall: true });
          } else if (choice === 'partial') {
            input = { ...input, amountText: centsToInputValue(availableCents) };
            result = await store.saveContribution(goalIdValue, input, contribution?.id ?? null);
          } else {
            setBusy(form, false);
            amountInput.focus();
            return;
          }
        }

        if (!handleResult(form, result)) return;
        close();
        const covered = result.ok && 'coveredCents' in result ? result.coveredCents : 0;
        haptic('confirm');
        toast(
          covered > 0
            ? `Ahorro guardado. Se registró un ingreso de ${formatMoney(covered)}.`
            : isEdit ? 'Cambios guardados.' : v.kind === 'withdrawal' ? 'Retiro guardado.' : 'Ahorro guardado.',
        );
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && contribution) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '¿Eliminar este movimiento de ahorro?',
            message: `Se borrará el ${contribution.kind === 'deposit' ? 'aporte' : 'retiro'} de ${formatMoney(contribution.amountCents)}. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteContribution(contribution.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Movimiento de ahorro eliminado.');
        });
      }
    },
  });
}

/** "Añadir ahorro" desde el menú: pide crear una meta primero si no hay ninguna. @param {Store} store */
export async function openAddSaving(store) {
  if (store.getState().data.goals.length === 0) {
    const create = await confirmDialog({
      title: 'Primero crea una meta',
      message: 'El ahorro se aparta para una meta concreta. Crea tu primera meta y luego podrás aportarle.',
      confirmLabel: 'Crear meta',
    });
    if (create) openGoalForm(store, { goal: null });
    return;
  }
  openContributionForm(store, {});
}

// =============================================================================
// META
// =============================================================================

/**
 * @param {Store} store
 * @param {{ goal: Goal | null }} options
 */
export function openGoalForm(store, { goal }) {
  const isEdit = goal !== null;
  const today = store.today();

  openSheet({
    title: isEdit ? 'Editar meta' : 'Nueva meta',
    content: html`<form class="stack" novalidate>
      <div class="field" data-field="name">
        <label for="goal-name">Nombre</label>
        <input id="goal-name" name="name" class="input" type="text" maxlength="${LIMITS.goalName}" autocomplete="off" placeholder="Ej.: Laptop nueva" value="${goal?.name ?? ''}" data-autofocus />
        ${fieldError('name')}
      </div>
      <div class="field" data-field="description">
        <label for="goal-description">Descripción (opcional)</label>
        <textarea id="goal-description" name="description" class="input input--area" rows="2" maxlength="${LIMITS.goalDescription}" placeholder="¿Para qué es esta meta?">${goal?.description ?? ''}</textarea>
        ${fieldError('description')}
      </div>
      ${moneyField({ id: 'goal-target', name: 'targetText', label: 'Monto objetivo', value: goal ? centsToInputValue(goal.targetCents) : '', errorKey: 'target' })}
      <div class="field" data-field="targetDate">
        <label for="goal-date">Fecha objetivo</label>
        <input id="goal-date" name="targetDate" class="input" type="date" ${goal && goal.targetDate < today ? '' : `min="${today}"`} value="${goal?.targetDate ?? ''}" />
        ${fieldError('targetDate')}
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions ${isEdit ? 'actions--split' : ''}">
        ${isEdit ? html`<button type="button" class="btn btn--danger-ghost" data-delete>${icon('trash', 18)}Eliminar</button>` : ''}
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">${isEdit ? 'Guardar' : 'Crear meta'}</button>
        </span>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      bindMoneyPreview(sheet, 'goal-target');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveGoal(
          { name: v.name ?? '', description: v.description ?? '', targetText: v.targetText ?? '', targetDate: v.targetDate ?? '' },
          goal?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Meta actualizada.' : 'Meta creada.');
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && goal) {
        deleteButton.addEventListener('click', async () => {
          const { data } = store.getState();
          const saved = goalProgress(goal, data.contributions, store.today()).savedCents;
          const count = data.contributions.filter((c) => c.goalId === goal.id).length;
          const ok = await confirmDialog({
            title: '¿Eliminar esta meta?',
            message:
              count > 0
                ? `Se borrará «${goal.name}» y sus ${count} movimientos de ahorro. ${formatMoney(saved)} volverán a tu dinero disponible. Esta acción no se puede deshacer.`
                : `Se borrará «${goal.name}». Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar meta',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteGoal(goal.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Meta eliminada.');
        });
      }
    },
  });
}

// =============================================================================
// CATEGORÍA PROPIA (se gestiona desde Ajustes)
// =============================================================================

/**
 * @param {Store} store
 * @param {{ category?: import('../domain/types.js').Category | null }} options
 */
export function openCategoryForm(store, { category = null }) {
  const isEdit = category !== null;
  openSheet({
    title: isEdit ? 'Renombrar categoría' : 'Nueva categoría',
    content: html`<form class="stack" novalidate>
      ${isEdit
        ? ''
        : html`<fieldset class="field" data-field="kind">
            <legend>¿Para qué tipo de movimiento?</legend>
            <div class="segmented" role="radiogroup">
              <label class="segmented__option"><input type="radio" name="kind" value="expense" checked /><span>Gastos</span></label>
              <label class="segmented__option"><input type="radio" name="kind" value="income" /><span>Ingresos</span></label>
            </div>
          </fieldset>
          <fieldset class="field" data-field="defaultClassification">
            <legend>Clasificación sugerida</legend>
            <div class="segmented" role="radiogroup" data-class-options></div>
            <p class="hint">Se propone al elegir esta categoría; en cada movimiento puedes cambiarla.</p>
          </fieldset>`}
      <div class="field" data-field="name">
        <label for="cat-name">Nombre</label>
        <input id="cat-name" name="name" class="input" type="text" maxlength="${LIMITS.categoryName}" autocomplete="off" value="${category?.name ?? ''}" data-autofocus />
        ${fieldError('name')}
      </div>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn--primary">Guardar</button>
      </div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));

      // Las opciones de clasificación dependen del tipo elegido.
      const optionsHost = sheet.querySelector('[data-class-options]');
      const renderClassOptions = () => {
        if (!optionsHost) return;
        const kind = /** @type {'income' | 'expense'} */ (/** @type {HTMLInputElement | null} */ (form.querySelector('input[name="kind"]:checked'))?.value ?? 'expense');
        setHtml(
          optionsHost,
          html`${CLASSIFICATIONS_BY_TYPE[kind].map(
            (c, i) => html`<label class="segmented__option"><input type="radio" name="defaultClassification" value="${c}" ${i === 1 ? 'checked' : ''} /><span>${CLASSIFICATION_LABELS[c]}</span></label>`,
          )}`,
        );
      };
      renderClassOptions();
      for (const radio of $$('input[name="kind"]', sheet)) radio.addEventListener('change', renderClassOptions);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveCategory(
          { name: v.name ?? '', kind: /** @type {any} */ (v.kind ?? 'expense'), defaultClassification: v.defaultClassification ?? 'variable' },
          category?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Categoría renombrada.' : 'Categoría creada.');
      });
    },
  });
}

// =============================================================================
// MENÚ "AÑADIR" (documento maestro §18)
// =============================================================================

/**
 * Menú «Añadir» (0.17.4): ingreso y gasto como dos tarjetas grandes arriba, lo demás en filas con el color del espacio y,
 * en Emprendedor y Empresa, los atajos del negocio (caja, fiar, factura, producto). Solo salen las opciones que tu rol
 * permite (y, por si acaso, cada una lleva su data-action: la guarda de permisos de app.js la detiene).
 * @param {Store} store
 */
export function openAddMenu(store) {
  const workspace = store.activeWorkspace();
  const perms = permissionsOf(workspace);
  const can = (/** @type {string} */ action) => {
    const module = ACTION_MODULE[action];
    return canEditData(workspace) && (!module || module === 'all' || atLeast(perms[module], 'create'));
  };
  /** @typedef {{ pick: string, action: string, icon: string, title: string, sub: string }} Item */
  /** @type {Item[]} */
  const main = [
    { pick: 'income', action: 'add-income', icon: 'arrowDown', title: 'Ingreso', sub: 'Dinero que entra' },
    { pick: 'expense', action: 'add-expense', icon: 'arrowUp', title: 'Gasto', sub: 'Dinero que sale' },
  ].filter((i) => can(i.action));
  /** @type {Item[]} */
  const more = [
    { pick: 'saving', action: 'add-saving', icon: 'target', title: 'Ahorro', sub: 'Aportar a una meta' },
    { pick: 'debt', action: 'new-debt', icon: 'card', title: 'Deuda', sub: 'Préstamo, tarjeta u otra deuda' },
    { pick: 'asset', action: 'new-asset', icon: 'bank', title: 'Activo', sub: 'Cuenta, inversión, vehículo, inmueble…' },
  ].filter((i) => can(i.action));
  const business = store.inventoryEnabled() && store.invoicesEnabled();
  /** @type {Item[]} */
  const shop = business
    ? [
        { pick: 'pos', action: 'pos-open', icon: 'receipt', title: 'Abrir caja', sub: 'Vender tocando los productos' },
        ...(store.fiadoEnabled() ? [{ pick: 'credit', action: 'credit-new', icon: 'user', title: 'Fiar', sub: 'Anotar lo que alguien te debe' }] : []),
        { pick: 'invoice', action: 'new-invoice', icon: 'copy', title: 'Nueva factura', sub: 'Con varias líneas e impuesto' },
        { pick: 'product', action: 'new-product', icon: 'box', title: 'Nuevo producto', sub: 'Con foto, precio y grupo' },
      ].filter((i) => can(i.action))
    : [];

  /** @param {Item} i */
  const row = (i) => html`<li class="add-row"><button type="button" class="add-row__btn" data-pick="${i.pick}" data-action="${i.action}">
    <span class="add-row__icon" aria-hidden="true">${icon(i.icon, 20)}</span>
    <span class="add-row__text"><strong>${i.title}</strong><small>${i.sub}</small></span>
    <span class="add-row__go" aria-hidden="true">${icon('chevronRight', 18)}</span>
  </button></li>`;

  const nothing = main.length + more.length + shop.length === 0;
  openSheet({
    title: '¿Qué quieres anotar?',
    content: html`<div class="add-menu">
      ${nothing ? html`<p class="muted">Con tu rol en este espacio no puedes registrar nada.</p>` : ''}
      ${main.length > 0
        ? html`<div class="add-hero">${main.map((i) => html`<button type="button" class="add-tile add-tile--${i.pick}" data-pick="${i.pick}" data-action="${i.action}">
            <span class="add-tile__icon" aria-hidden="true">${icon(i.icon, 26)}</span>
            <span class="add-tile__title">${i.title}</span>
            <span class="add-tile__sub">${i.sub}</span>
          </button>`)}</div>`
        : ''}
      ${more.length > 0 ? html`<ul class="add-list" aria-label="Más">${more.map(row)}</ul>` : ''}
      ${shop.length > 0
        ? html`<p class="add-menu__label" id="add-shop">Tu negocio</p><ul class="add-list" aria-labelledby="add-shop">${shop.map(row)}</ul>`
        : ''}
    </div>`,
    onMount: (sheet, close) => {
      for (const button of $$('[data-pick]', sheet)) {
        button.addEventListener('click', () => {
          const pick = button.getAttribute('data-pick');
          close();
          if (pick === 'income' || pick === 'expense') openMovementForm(store, { type: pick });
          else if (pick === 'debt') openDebtForm(store, { debt: null });
          else if (pick === 'asset') openAssetForm(store, { asset: null });
          else if (pick === 'pos') window.location.hash = '#/caja';
          else if (pick === 'credit') openCreditForm(store);
          else if (pick === 'invoice') openInvoiceForm(store);
          else if (pick === 'product') openProductForm(store);
          else void openAddSaving(store);
        });
      }
    },
  });
}
