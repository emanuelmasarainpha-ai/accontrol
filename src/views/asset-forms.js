// @ts-check
// =============================================================================
// FORMULARIOS DE ACTIVOS (documento maestro §5)
// -----------------------------------------------------------------------------
// Activo (crear / editar / borrar) y actualización de su valor. Solo hablan con
// las acciones del store; las reglas viven en domain/assets.js.
// =============================================================================

import {
  ASSET_CATEGORIES, ASSET_CATEGORY_ORDER, assetCurrentValue, assetTypeLabel, isAssetCategory,
} from '../domain/assets.js';
import { formatDate } from '../domain/dates.js';
import { centsToInputValue, formatMoney } from '../domain/money.js';
import { LIMITS } from '../domain/types.js';
import { $, $$ } from '../ui/dom.js';
import { confirmDialog, openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html, setHtml } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { bindMoneyPreview, fieldError, handleResult, moneyField } from './form-parts.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/types.js').Asset} Asset */
/** @typedef {import('../domain/types.js').AssetCategory} AssetCategory */

/** @param {AssetCategory} category @param {string} selected */
const subtypeOptions = (category, selected) => [
  html`<option value="" ${selected === '' ? 'selected' : ''}>Sin especificar</option>`,
  ...Object.entries(ASSET_CATEGORIES[category].subtypes).map(
    ([key, label]) => html`<option value="${key}" ${key === selected ? 'selected' : ''}>${label}</option>`,
  ),
];

// =============================================================================
// ACTIVO
// =============================================================================

/**
 * @param {Store} store
 * @param {{ asset: Asset | null }} options
 */
export function openAssetForm(store, { asset }) {
  const isEdit = asset !== null;
  const today = store.today();
  const category = asset?.category ?? 'bank';

  openSheet({
    title: isEdit ? 'Editar activo' : 'Añadir activo',
    content: html`<form class="stack" novalidate>
      <div class="field" data-field="name">
        <label for="as-name">Nombre del activo</label>
        <input id="as-name" name="name" class="input" type="text" maxlength="${LIMITS.assetName}" autocomplete="off" placeholder="Ej.: Mi carro, Certificado del banco" value="${asset?.name ?? ''}" data-autofocus />
        ${fieldError('name')}
      </div>

      <div class="field-row">
        <div class="field" data-field="category">
          <label for="as-category">Categoría</label>
          <select id="as-category" name="category" class="input">
            ${ASSET_CATEGORY_ORDER.map((c) => html`<option value="${c}" ${c === category ? 'selected' : ''}>${ASSET_CATEGORIES[c].label}</option>`)}
          </select>
          ${fieldError('category')}
        </div>
        <div class="field" data-field="subtype">
          <label for="as-subtype">Tipo</label>
          <select id="as-subtype" name="subtype" class="input">${subtypeOptions(category, asset?.subtype ?? '')}</select>
          ${fieldError('subtype')}
        </div>
      </div>
      <p class="hint" data-category-hint>${ASSET_CATEGORIES[category].hint}</p>

      ${isEdit
        ? html`<p class="hint">Valor actual: <strong>${formatMoney(assetCurrentValue(asset, today))}</strong>. Para cambiarlo usa «Actualizar valor»: así tu historial no se reescribe.</p>`
        : moneyField({ id: 'as-value', name: 'valueText', label: 'Valor estimado hoy', value: '', errorKey: 'value' })}

      <div class="field" data-field="acquiredDate">
        <label for="as-date">Fecha de adquisición</label>
        <input id="as-date" name="acquiredDate" class="input" type="date" max="${today}" value="${asset?.acquiredDate ?? today}" required />
        ${fieldError('acquiredDate')}
      </div>

      <div class="field" data-field="description">
        <label for="as-desc">Descripción (opcional)</label>
        <input id="as-desc" name="description" class="input" type="text" maxlength="${LIMITS.assetDescription}" autocomplete="off" value="${asset?.description ?? ''}" />
        ${fieldError('description')}
      </div>

      <p class="hint">El dinero que ya registras con tus ingresos y gastos <strong>ya cuenta</strong> en tu patrimonio: no lo repitas aquí.</p>
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
      const categorySelect = /** @type {HTMLSelectElement} */ ($('#as-category', sheet));
      const subtypeSelect = /** @type {HTMLSelectElement} */ ($('#as-subtype', sheet));
      const hint = $('[data-category-hint]', sheet);
      if (!isEdit) bindMoneyPreview(sheet, 'as-value');

      categorySelect.addEventListener('change', () => {
        const picked = categorySelect.value;
        if (!isAssetCategory(picked)) return;
        setHtml(subtypeSelect, html`${subtypeOptions(picked, '')}`);
        hint.textContent = ASSET_CATEGORIES[picked].hint;
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveAsset(
          {
            name: v.name ?? '', category: v.category ?? '', subtype: v.subtype ?? '', description: v.description ?? '',
            valueText: v.valueText ?? '', acquiredDate: v.acquiredDate ?? '',
          },
          asset?.id ?? null,
        );
        if (!handleResult(form, result)) return;
        close();
        toast(isEdit ? 'Cambios guardados.' : 'Activo guardado.');
        if (!isEdit && !window.location.hash.startsWith('#/patrimonio')) window.location.hash = '#/patrimonio';
      });

      const deleteButton = sheet.querySelector('[data-delete]');
      if (deleteButton && asset) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '¿Eliminar este activo?',
            message: `Se borrará «${asset.name}» y su historial de valores. Tus ingresos, gastos y deudas no cambian. Si lo vendiste, mejor registra el ingreso y actualiza su valor a RD$ 0 en esa fecha: así tu historial se conserva. Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          const result = await store.deleteAsset(asset.id);
          if (!result.ok) {
            showErrors(form, result.errors);
            return;
          }
          close();
          toast('Activo eliminado.');
        });
      }
    },
  });
}

// =============================================================================
// ACTUALIZAR EL VALOR
// =============================================================================

/**
 * @param {Store} store
 * @param {{ assetId: string }} options
 */
export function openValuationForm(store, { assetId }) {
  const asset = store.getState().data.assets.find((a) => a.id === assetId);
  if (!asset) {
    toast('Ese activo ya no existe.', 'error');
    return;
  }
  const today = store.today();
  const current = assetCurrentValue(asset, today);

  /** @param {Asset} a */
  const historyList = (a) => html`<ul class="valuations">${[...a.valuations].reverse().map(
    (v) => html`<li class="valuation">
      <span class="valuation__date">${formatDate(v.date)}</span>
      <span class="valuation__value">${formatMoney(v.valueCents)}</span>
      ${v.date === a.acquiredDate
        ? html`<span class="valuation__tag">Adquisición</span>`
        : html`<button type="button" class="icon-btn icon-btn--small" data-delete-valuation="${v.date}" aria-label="Borrar el valor del ${formatDate(v.date)}">${icon('trash', 16)}</button>`}
    </li>`,
  )}</ul>`;

  openSheet({
    title: 'Actualizar valor',
    content: html`<form class="stack" novalidate>
      <p class="muted"><strong>${asset.name}</strong> · ${assetTypeLabel(asset)}<br />Valor actual: <strong>${formatMoney(current)}</strong></p>
      ${moneyField({ id: 'av-value', name: 'valueText', label: 'Nuevo valor', value: centsToInputValue(current), errorKey: 'value', autofocus: true })}
      <div class="field" data-field="date">
        <label for="av-date">¿Desde cuándo vale eso?</label>
        <input id="av-date" name="date" class="input" type="date" min="${asset.acquiredDate}" max="${today}" value="${today}" required />
        ${fieldError('date')}
      </div>
      <p class="hint">Se agrega al historial sin cambiar lo anterior. Si ya había un valor en esa fecha, se reemplaza. Si vendiste el activo, anota el ingreso y pon el valor en 0.</p>
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions">
        <span class="actions__group">
          <button type="button" class="btn btn--ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn--primary">Guardar valor</button>
        </span>
      </div>
      <h3 class="section-title section-title--small">Historial de valores</h3>
      <div data-history>${historyList(asset)}</div>
    </form>`,
    onMount: (sheet, close) => {
      const form = /** @type {HTMLFormElement} */ ($('form', sheet));
      const history = $('[data-history]', sheet);
      bindMoneyPreview(sheet, 'av-value');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        setBusy(form, true);
        const v = readForm(form);
        const result = await store.saveAssetValuation(assetId, { valueText: v.valueText ?? '', date: v.date ?? '' });
        if (!handleResult(form, result)) return;
        close();
        toast('Valor actualizado.');
      });

      history.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-delete-valuation]') : null;
        if (!target) return;
        const date = target.getAttribute('data-delete-valuation') ?? '';
        const ok = await confirmDialog({
          title: '¿Borrar este valor?',
          message: `Se quitará el valor del ${formatDate(date)} del historial. Tu patrimonio de esos meses se recalcula con el valor anterior.`,
          confirmLabel: 'Borrar',
          danger: true,
        });
        if (!ok) return;
        const result = await store.deleteAssetValuation(assetId, date);
        if (!result.ok) {
          showErrors(form, result.errors);
          return;
        }
        const fresh = store.getState().data.assets.find((a) => a.id === assetId);
        if (fresh) setHtml(history, historyList(fresh));
        toast('Valor borrado.');
      });
    },
  });
}
