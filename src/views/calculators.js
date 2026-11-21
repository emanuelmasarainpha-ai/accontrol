// @ts-check
// =============================================================================
// CALCULADORAS FINANCIERAS (documento maestro §8)
// -----------------------------------------------------------------------------
// #/calculadoras           -> la lista de las 9 calculadoras
// #/calculadoras/<id>      -> una calculadora, con resultados en vivo mientras escribes
//
// Cómo se calcula cada una (campos, validación, resultados) está en domain/calculators.js
// y las fórmulas en domain/finmath.js. Aquí solo se dibuja. Nada se guarda: las cifras que
// escribes viven en memoria mientras la app está abierta.
// =============================================================================

import {
  CALCULATORS, calculatorById, computeCalculator, defaultValues, resolveMode, suggestions,
} from '../domain/calculators.js';
import { currencySymbol } from '../domain/money.js';
import { isExportFormat, makeFile } from '../export/index.js';
import { saveFile } from '../ui/saveFile.js';
import { cellText, isNumericCell } from '../export/model.js';
import { calculatorReport } from '../export/reports.js';
import { columnChart } from '../ui/charts.js';
import { legend } from '../ui/components.js';
import { readForm } from '../ui/forms.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/calculators.js').Calculator} Calculator */
/** @typedef {import('../domain/calculators.js').FieldSpec} FieldSpec */
/** @typedef {import('../domain/calculators.js').CalcResult} CalcResult */

/** Lo que el usuario fue escribiendo en cada calculadora (se mantiene mientras la app está abierta). @type {Map<string, { mode: string, values: Record<string, string> }>} */
const memory = new Map();

const DEBOUNCE_MS = 140;

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderCalculators(store, ctx) {
  const calc = ctx.params[0] ? calculatorById(ctx.params[0]) : null;
  if (ctx.params[0] && !calc) return { html: unknownPage() };
  return calc ? renderOne(store, ctx, calc) : { html: listPage() };
}

// ------------------------------------------------------------------ la lista

function listPage() {
  return html`
    <a class="back-link" href="#/estadisticas">${icon('back', 16)}Estadísticas</a>
    <header class="page-header">
      <div>
        <h1 class="page-title">Calculadoras financieras</h1>
        <p class="page-subtitle">Aprende probando: cambia los números y mira qué pasa con tu dinero antes de decidir.</p>
      </div>
    </header>

    <ul class="calc-grid">${CALCULATORS.map(
      (c) => html`<li><a class="calc-card" href="#/calculadoras/${c.id}">
        <span class="calc-card__icon" aria-hidden="true">${icon('calculator', 22)}</span>
        <span class="calc-card__body">
          <span class="calc-card__title">${c.title}</span>
          <span class="calc-card__text">${c.summary}</span>
        </span>
      </a></li>`,
    )}</ul>

    <p class="panel__foot">Son simulaciones con tasas constantes, para entender consecuencias. No son asesoría financiera ni promesas de resultados, y no usan tus datos a menos que tú los escribas.</p>`;
}

function unknownPage() {
  return html`
    <a class="back-link" href="#/calculadoras">${icon('back', 16)}Calculadoras</a>
    <section class="panel">
      <h1 class="panel__title">Esa calculadora no existe</h1>
      <p class="muted">Elige una de la lista.</p>
      <a class="btn btn--primary" href="#/calculadoras">Ver las calculadoras</a>
    </section>`;
}

// ------------------------------------------------------------------ una calculadora

/**
 * @param {FieldSpec} f @param {Record<string, string>} values
 */
function fieldHtml(f, values) {
  const id = `cf-${f.id}`;
  const value = values[f.id] ?? '';
  const describedBy = `${f.hint ? `${id}-hint ` : ''}${id}-error`;
  /** @type {import('../ui/html.js').SafeHtml} */
  let control;
  if (f.type === 'money') {
    control = html`<div class="input-money">
      <span class="input-money__symbol" aria-hidden="true">${currencySymbol()}</span>
      <input id="${id}" name="${f.id}" class="input input--money" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${value}" aria-describedby="${describedBy}" />
    </div>`;
  } else if (f.type === 'percent' || f.type === 'number') {
    control = html`<div class="input-affix">
      <input id="${id}" name="${f.id}" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${value}" aria-describedby="${describedBy}" />
      <span class="input-affix__text" aria-hidden="true">${f.suffix ?? ''}</span>
    </div>`;
  } else if (f.type === 'duration') {
    const unit = values[`${f.id}Unit`] ?? f.defaultUnit ?? 'years';
    control = html`<div class="calc-duration">
      <input id="${id}" name="${f.id}" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${value}" aria-describedby="${describedBy}" />
      <select class="input" name="${f.id}Unit" aria-label="Unidad de tiempo para ${f.label}">
        <option value="years" ${unit === 'years' ? 'selected' : ''}>años</option>
        <option value="months" ${unit === 'months' ? 'selected' : ''}>meses</option>
      </select>
    </div>`;
  } else {
    const chosen = value || f.default || f.options?.[0]?.value || '';
    control = html`<select id="${id}" name="${f.id}" class="input" aria-describedby="${describedBy}">${(f.options ?? []).map(
      (o) => html`<option value="${o.value}" ${o.value === chosen ? 'selected' : ''}>${o.label}</option>`,
    )}</select>`;
  }
  return html`<div class="field" data-field="${f.id}">
    <label for="${id}">${f.label}${f.optional ? html` <span class="muted">(opcional)</span>` : ''}</label>
    ${control}
    ${f.hint ? html`<p class="hint" id="${id}-hint">${f.hint}</p>` : ''}
    <p class="field__error" id="${id}-error" data-error-for="${f.id}" hidden></p>
    <span data-suggest-for="${f.id}"></span>
  </div>`;
}

/**
 * La parte de resultados (se vuelve a dibujar cada vez que cambia algo).
 * @param {CalcResult} result
 */
function resultsHtml(result) {
  if (result.status === 'incomplete') {
    return html`<div class="calc-empty">${icon('calculator', 28)}<p>Completa los campos para ver el resultado. Se calcula mientras escribes.</p><p class="muted">¿No sabes por dónde empezar? Usa «Probar con un ejemplo».</p></div>`;
  }
  if (result.status === 'error') {
    const form = result.errors.form;
    return html`<div class="calc-empty">
      ${form ? html`<p class="notice notice--warn" role="alert">${icon('alert', 18)}<span>${form}</span></p>` : html`<p class="notice notice--warn" role="alert">${icon('alert', 18)}<span>Hay un dato que revisar. Mira el mensaje debajo del campo marcado.</span></p>`}
    </div>`;
  }
  const o = result.outcome;
  return html`
    <div class="calc-headline">
      <span class="calc-headline__label">${o.headline.label}</span>
      <strong class="calc-headline__value">${o.headline.value}</strong>
      ${o.headline.note ? html`<span class="calc-headline__note">${o.headline.note}</span>` : ''}
    </div>
    <p class="calc-sentence">${o.sentence}</p>
    <dl class="facts calc-facts">${o.items.map(
      (i) => html`<div><dt>${i.label}</dt><dd>${i.value}${i.note ? html`<span class="facts__note">${i.note}</span>` : ''}</dd></div>`,
    )}</dl>
    ${o.chart
      ? html`<div class="calc-chart">
          ${legend(o.chart.series.map((s) => ({ label: s.name, cls: s.cls })))}
          <div class="chart-host" id="calc-chart" role="presentation"></div>
        </div>`
      : ''}
    ${o.table ? tableHtml(o.table) : ''}
    <ul class="calc-notes">${o.notes.map((n) => html`<li>${n}</li>`)}</ul>
    <details class="table-view">
      <summary>Datos que usaste</summary>
      <dl class="facts calc-inputs">${o.inputs.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    </details>
    <div class="export" role="group" aria-label="Descargar este resultado">
      ${['pdf', 'xlsx', 'csv'].map((format) => html`<button type="button" class="btn btn--ghost btn--small" data-calc-export="${format}">${icon('download', 16)}${{ pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' }[format]}</button>`)}
    </div>`;
}

/** @param {import('../domain/calculators.js').ResultTable} t */
function tableHtml(t) {
  const long = t.rows.length > 24;
  return html`<details class="table-view" ${long ? '' : 'open'}>
    <summary>${long ? `Ver la tabla completa (${t.rows.length} filas)` : t.caption}</summary>
    <div class="table-view__scroll">
      <table class="table">
        <caption class="sr-only">${t.caption}</caption>
        <thead><tr>${t.headers.map((h, i) => html`<th scope="col" class="${i > 0 ? 'num' : ''}">${h}</th>`)}</tr></thead>
        <tbody>${t.rows.map((row) => html`<tr>${row.map((cell, i) => (i === 0 ? html`<th scope="row">${cellText(cell)}</th>` : html`<td class="${isNumericCell(cell) ? 'num' : ''}">${cellText(cell)}</td>`))}</tr>`)}</tbody>
        ${t.totals ? html`<tfoot><tr>${t.totals.map((cell, i) => (i === 0 ? html`<th scope="row">${cellText(cell)}</th>` : html`<td class="num">${cellText(cell)}</td>`))}</tr></tfoot>` : ''}
      </table>
    </div>
  </details>`;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} ctx
 * @param {Calculator} calc
 * @returns {import('../app/app.js').RenderedView}
 */
function renderOne(store, ctx, calc) {
  const saved = memory.get(calc.id);
  const mode = resolveMode(calc, saved?.mode);
  /** @type {Record<string, string>} */
  const values = { ...defaultValues(calc, mode), ...(saved?.values ?? {}) };
  memory.set(calc.id, { mode, values });
  const fields = calc.fields(mode);
  const suggest = suggestions(store.getState().data, store.today())[calc.id] ?? {};
  const first = computeCalculator(calc.id, mode, values);

  const page = html`
    <a class="back-link" href="#/calculadoras">${icon('back', 16)}Calculadoras</a>
    <header class="page-header">
      <div>
        <h1 class="page-title">${calc.title}</h1>
        <p class="page-subtitle">${calc.summary}</p>
      </div>
    </header>

    <div class="calc-layout">
      <section class="panel calc-form" aria-labelledby="calc-form-title">
        <h2 class="panel__title" id="calc-form-title">Tus datos</h2>
        <form id="calc-form" novalidate autocomplete="off">
          ${calc.modes
            ? html`<fieldset class="calc-modes">
                <legend>¿Qué quieres calcular?</legend>
                <div class="segmented" role="radiogroup">${calc.modes.map(
                  (md) => html`<label class="segmented__option"><input type="radio" name="mode" value="${md.id}" ${md.id === mode ? 'checked' : ''} /><span>${md.label}</span></label>`,
                )}</div>
              </fieldset>`
            : ''}
          ${fields.map((f) => fieldHtml(f, values))}
        </form>
        <div class="calc-actions">
          <button type="button" class="btn btn--ghost btn--small" data-calc="example">Probar con un ejemplo</button>
          <button type="button" class="btn btn--ghost btn--small" data-calc="clear">Borrar todo</button>
        </div>
      </section>

      <section class="panel calc-results" aria-labelledby="calc-results-title">
        <h2 class="panel__title" id="calc-results-title">Resultado</h2>
        <div id="calc-results" role="status" aria-live="polite">${resultsHtml(first)}</div>
      </section>
    </div>

    <section class="panel" aria-labelledby="calc-how">
      <h2 class="panel__title" id="calc-how">Cómo funciona</h2>
      <div class="calc-how">${calc.how.map((paragraph) => html`<p>${paragraph}</p>`)}</div>
    </section>

    <p class="panel__foot">Simulación educativa con tasas constantes. No es asesoría financiera ni una promesa de resultados.</p>`;

  return {
    html: page,
    mount(root, signal) {
      const form = /** @type {HTMLFormElement} */ (root.querySelector('#calc-form'));
      const results = /** @type {HTMLElement} */ (root.querySelector('#calc-results'));
      /** @type {Set<string>} Campos que el usuario ya tocó: solo a esos se les muestra el error. */
      const touched = new Set();
      /** @type {(() => void) | null} */
      let stopChart = null;
      /** @type {import('../domain/calculators.js').Outcome | null} */
      let outcome = first.status === 'ok' ? first.outcome : null;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null;

      const remember = () => {
        const read = readForm(form);
        const current = memory.get(calc.id);
        const next = { ...(current?.values ?? values) };
        for (const f of fields) {
          if (f.id in read) next[f.id] = read[f.id];
          if (f.type === 'duration' && `${f.id}Unit` in read) next[`${f.id}Unit`] = read[`${f.id}Unit`];
        }
        memory.set(calc.id, { mode, values: next });
        return next;
      };

      /** @param {Record<string, string>} errors */
      const paintErrors = (errors) => {
        for (const slot of /** @type {HTMLElement[]} */ ([...form.querySelectorAll('[data-error-for]')])) {
          const key = slot.dataset.errorFor ?? '';
          const message = touched.has(key) ? errors[key] : undefined;
          slot.textContent = message ?? '';
          slot.hidden = !message;
          const input = form.querySelector(`#cf-${key}`);
          if (message) input?.setAttribute('aria-invalid', 'true');
          else input?.removeAttribute('aria-invalid');
        }
      };

      const drawChart = () => {
        stopChart?.();
        stopChart = null;
        const host = results.querySelector('#calc-chart');
        if (outcome?.chart && host instanceof HTMLElement) stopChart = columnChart(host, outcome.chart);
      };

      const refresh = () => {
        const current = memory.get(calc.id)?.values ?? values;
        const result = computeCalculator(calc.id, mode, current);
        outcome = result.status === 'ok' ? result.outcome : null;
        stopChart?.();
        stopChart = null;
        results.innerHTML = resultsHtml(result).value;
        paintErrors(result.status === 'error' ? result.errors : {});
        drawChart();
      };

      const schedule = () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(refresh, DEBOUNCE_MS);
      };

      // Sugerencias con tus datos reales (un botón por campo; tú decides si lo usas).
      for (const [fieldId, s] of Object.entries(suggest)) {
        const slot = form.querySelector(`[data-suggest-for="${fieldId}"]`);
        if (slot) slot.innerHTML = html`<button type="button" class="link-btn" data-calc="suggest" data-field="${fieldId}" data-value="${s.value}">${s.label}</button>`.value;
      }

      form.addEventListener('submit', (event) => event.preventDefault(), { signal });
      form.addEventListener('input', () => { remember(); schedule(); }, { signal });
      form.addEventListener('change', (event) => {
        const target = /** @type {HTMLInputElement} */ (event.target);
        if (target.name === 'mode') {
          memory.set(calc.id, { mode: target.value, values: remember() });
          ctx.rerender();
          return;
        }
        remember();
        schedule();
      }, { signal });
      form.addEventListener('focusout', (event) => {
        const target = /** @type {HTMLInputElement} */ (event.target);
        if (target.name) {
          touched.add(target.name.replace(/Unit$/, ''));
          // Con mostrar los errores de los campos tocados basta: no hace falta recalcular todo.
          const result = computeCalculator(calc.id, mode, memory.get(calc.id)?.values ?? values);
          paintErrors(result.status === 'error' ? result.errors : {});
        }
      }, { signal });

      root.addEventListener('click', (event) => {
        const el = event.target instanceof Element ? event.target.closest('[data-calc], [data-calc-export]') : null;
        if (!(el instanceof HTMLElement)) return;

        if (el.dataset.calcExport) {
          const format = el.dataset.calcExport;
          if (!isExportFormat(format) || !outcome) return;
          try {
            const file = makeFile(calculatorReport(calc.title, outcome, store.today()), format, store.now());
            void saveFile(file, { done: `Listo: ${file.filename}.` });
          } catch (error) {
            toast('No se pudo crear el archivo. Intenta de nuevo.', 'error');
            console.error(error);
          }
          return;
        }

        const action = el.dataset.calc;
        if (action === 'example') {
          memory.set(calc.id, { mode, values: { ...defaultValues(calc, mode), ...calc.example } });
          ctx.rerender();
        } else if (action === 'clear') {
          memory.set(calc.id, { mode, values: defaultValues(calc, mode) });
          ctx.rerender();
        } else if (action === 'suggest' && el.dataset.field) {
          const next = remember();
          next[el.dataset.field] = el.dataset.value ?? '';
          memory.set(calc.id, { mode, values: next });
          ctx.rerender();
        }
      }, { signal });

      drawChart();
      if (timer !== null) clearTimeout(timer);
      signal.addEventListener('abort', () => {
        if (timer !== null) clearTimeout(timer);
        stopChart?.();
      }, { once: true });
      return () => stopChart?.();
    },
  };
}
