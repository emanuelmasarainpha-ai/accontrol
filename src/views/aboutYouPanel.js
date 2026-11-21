// @ts-check
// =============================================================================
// «SOBRE TI» (0.18.4): la pregunta de bienvenida y el bloque de Ajustes → Privacidad y seguridad
// -----------------------------------------------------------------------------
// Se pregunta UNA vez por cuenta (también si la persona omite todo), sin interrumpir el recorrido guiado ni otra
// ventana. Todo es opcional. Las respuestas se pueden cambiar o dejar en «Prefiero no decirlo» en Ajustes.
// Las reglas y la lista de países están en domain/aboutYou.js; guardar y leer, en data/cloudStore.js.
// =============================================================================

import { AGE_RANGES, aboutYouSummary, countryOptions, emptyAboutYou, GENDERS, validateAboutYou } from '../domain/aboutYou.js';
import { openSheet } from '../ui/dialog.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html, setHtml } from '../ui/html.js';
import { toast } from '../ui/toast.js';

/** @typedef {import('../domain/aboutYou.js').AboutYou} AboutYou */
/** @typedef {{ ok: false, error: { message: string } }} Failure */
/**
 * Lo que necesita esta pantalla de la nube (en main.js sale de cloudStore).
 * @typedef {Object} AboutYouApi
 * @property {() => Promise<{ ok: true, about: AboutYou | null } | Failure>} get
 * @property {(about: AboutYou) => Promise<{ ok: true } | Failure>} save
 * @property {Storage | null} storage  Para recordar en este dispositivo que ya se preguntó (y no consultar la nube cada vez).
 * @property {string} userId
 */

const PURPOSE = 'Es opcional. Nos ayuda a saber quién usa ACCONTROL para mejorarla. Solo tu cuenta puede ver tus respuestas: para las estadísticas solo se cuentan totales, nunca los datos de una persona. Puedes cambiarlas cuando quieras en Ajustes → Privacidad y seguridad.';

/** @param {string} userId */
const askedKey = (userId) => `accontrol.aboutyou.asked:${userId}`;

/** @param {AboutYouApi} api */
function rememberAsked(api) {
  try {
    api.storage?.setItem(askedKey(api.userId), '1');
  } catch {
    // Sin almacenamiento: la próxima vez se consulta la nube, que también sabe que ya se preguntó.
  }
}

/** @param {AboutYouApi} api */
function alreadyAsked(api) {
  try {
    return api.storage?.getItem(askedKey(api.userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Las tres preguntas (cada una con «Prefiero no decirlo»).
 * @param {AboutYou} about @param {string} prefix  para que los id no se repitan entre la ventana y Ajustes
 */
export function aboutYouFields(about, prefix) {
  const none = html`<option value="">Prefiero no decirlo</option>`;
  return html`<div class="field" data-field="gender">
      <label for="${prefix}-gender">Sexo</label>
      <select id="${prefix}-gender" name="gender" class="input" aria-describedby="${prefix}-gender-error">
        ${none}${GENDERS.map((g) => html`<option value="${g.value}" ${about.gender === g.value ? 'selected' : ''}>${g.label}</option>`)}
      </select>
      <p class="field__error" id="${prefix}-gender-error" data-error-for="gender" hidden></p>
    </div>
    <div class="field" data-field="ageRange">
      <label for="${prefix}-age">Edad</label>
      <select id="${prefix}-age" name="ageRange" class="input" aria-describedby="${prefix}-age-error">
        ${none}${AGE_RANGES.map((a) => html`<option value="${a.value}" ${about.ageRange === a.value ? 'selected' : ''}>${a.label} años</option>`)}
      </select>
      <p class="field__error" id="${prefix}-age-error" data-error-for="ageRange" hidden></p>
    </div>
    <div class="field" data-field="nationality">
      <label for="${prefix}-nationality">Nacionalidad</label>
      <select id="${prefix}-nationality" name="nationality" class="input" aria-describedby="${prefix}-nationality-error">
        ${none}${countryOptions().map((c) => html`<option value="${c.code}" ${about.nationality === c.code ? 'selected' : ''}>${c.name}</option>`)}
      </select>
      <p class="field__error" id="${prefix}-nationality-error" data-error-for="nationality" hidden></p>
    </div>`;
}

/**
 * Pregunta una sola vez por cuenta. 'later' = ahora no se puede (hay otra ventana o todavía no hay espacio): se
 * vuelve a intentar después. 'done' = ya está (respondió, omitió, ya se había preguntado o la nube no contestó: en
 * ese caso se intenta la próxima vez que se abra la app).
 * @param {AboutYouApi | null} api @param {() => boolean} ready
 * @returns {Promise<'done' | 'later'>}
 */
export async function askAboutYouOnce(api, ready = () => true) {
  if (!api || alreadyAsked(api)) return 'done';
  if (!ready() || document.querySelector('dialog[open]')) return 'later';
  const current = await api.get();
  if (!current.ok) return 'done';
  if (current.about !== null) {
    rememberAsked(api);
    return 'done';
  }
  // Mientras se consultaba la nube pudo abrirse el recorrido u otra ventana.
  if (!ready() || document.querySelector('dialog[open]')) return 'later';
  await new Promise((resolve) => {
    let saved = false;
    const { element, close } = openSheet({
      title: 'Cuéntanos un poco de ti',
      content: html`<form class="stack" data-form="about-you" novalidate>
        <p>${PURPOSE}</p>
        ${aboutYouFields(emptyAboutYou(), 'ay')}
        <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
        <div class="actions">
          <button type="button" class="btn btn--ghost" data-skip>Omitir</button>
          <button type="submit" class="btn btn--primary">Guardar</button>
        </div>
      </form>`,
      // Cerrar con la X o con «atrás» cuenta como «Omitir»: no se vuelve a preguntar.
      onClose: () => {
        if (!saved) void api.save(emptyAboutYou()).then((r) => { if (r.ok) rememberAsked(api); });
        resolve(undefined);
      },
    });
    const form = element.querySelector('[data-form="about-you"]');
    if (!(form instanceof HTMLFormElement)) return;
    /** @param {AboutYou} about @param {string} done */
    const send = async (about, done) => {
      setBusy(form, true);
      const result = await api.save(about);
      setBusy(form, false);
      if (!result.ok) {
        showErrors(form, { form: `No se pudo guardar: ${result.error.message} Te lo preguntaré otra vez más adelante.` });
        return;
      }
      saved = true;
      rememberAsked(api);
      close();
      toast(done);
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearErrors(form);
      const checked = validateAboutYou(readForm(form));
      if (!checked.ok) {
        showErrors(form, checked.errors);
        return;
      }
      void send(checked.value, 'Gracias. Puedes cambiarlo en Ajustes → Privacidad y seguridad.');
    });
    form.querySelector('[data-skip]')?.addEventListener('click', () => {
      clearErrors(form);
      void send(emptyAboutYou(), 'Listo, no te lo volveré a preguntar.');
    });
  });
  return 'done';
}

/** El bloque de Ajustes → Privacidad y seguridad (las respuestas se cargan al abrirlo). @param {AboutYouApi | null} api */
export function aboutYouPanel(api) {
  if (!api) return '';
  return html`<section class="panel" aria-labelledby="set-about-you" data-about-you>
    <h2 class="panel__title" id="set-about-you">Sobre ti</h2>
    <p class="panel__sub">${PURPOSE.replace(' Puedes cambiarlas cuando quieras en Ajustes → Privacidad y seguridad.', '')}</p>
    <p class="storage-status" data-about-you-status role="status">Cargando tus respuestas…</p>
    <div data-about-you-form></div>
  </section>`;
}

/**
 * Carga las respuestas en el bloque y escucha el formulario.
 * @param {AboutYouApi | null} api @param {HTMLElement} root @param {AbortSignal} signal
 */
export function watchAboutYou(api, root, signal) {
  const panel = root.querySelector('[data-about-you]');
  if (!api || !panel) return;
  const status = panel.querySelector('[data-about-you-status]');
  const slot = panel.querySelector('[data-about-you-form]');
  void api.get().then((result) => {
    if (signal.aborted || !(slot instanceof HTMLElement) || !status) return;
    if (!result.ok) {
      status.textContent = `No se pudieron cargar: ${result.error.message}`;
      return;
    }
    const about = result.about ?? emptyAboutYou();
    status.textContent = result.about === null ? 'Todavía no has respondido.' : `Tus respuestas: ${aboutYouSummary(about)}.`;
    setHtml(slot, html`<form class="stack" data-form="about-you-settings" novalidate>
      ${aboutYouFields(about, 'set-ay')}
      <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
      <div class="actions actions--start">
        <button type="submit" class="btn btn--ghost">Guardar respuestas</button>
        <button type="button" class="btn btn--danger-ghost" data-about-you-clear>Borrar mis respuestas</button>
      </div>
    </form>`);
    const form = slot.querySelector('form');
    if (!(form instanceof HTMLFormElement)) return;
    /** @param {AboutYou} next @param {string} done */
    const send = async (next, done) => {
      setBusy(form, true);
      const saved = await api.save(next);
      setBusy(form, false);
      if (!saved.ok) {
        showErrors(form, { form: `No se pudo guardar: ${saved.error.message}` });
        return;
      }
      rememberAsked(api);
      status.textContent = `Tus respuestas: ${aboutYouSummary(next)}.`;
      toast(done);
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearErrors(form);
      const checked = validateAboutYou(readForm(form));
      if (!checked.ok) showErrors(form, checked.errors);
      else void send(checked.value, 'Respuestas guardadas.');
    }, { signal });
    form.querySelector('[data-about-you-clear]')?.addEventListener('click', () => {
      clearErrors(form);
      for (const select of form.querySelectorAll('select')) select.value = '';
      void send(emptyAboutYou(), 'Respuestas borradas: ahora dicen «Prefiero no decirlo».');
    }, { signal });
  });
}
