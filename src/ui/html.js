// @ts-check
// =============================================================================
// PLANTILLAS HTML SEGURAS
// -----------------------------------------------------------------------------
// Todo texto que escribe el usuario (descripciones, nombres de metas...) puede
// contener símbolos como < o ", que un atacante podría usar para inyectar
// código en la pantalla (ataque "XSS"). Por eso NUNCA se pega texto directo en
// el HTML: se usa esta función, que "escapa" automáticamente cada valor.
//
// Uso:
//     html`<p class="title">${movement.description}</p>`
//
// Lo que va dentro de ${...} se convierte en texto inofensivo. Si el valor es
// otra plantilla `html`...`, se inserta tal cual (ya es segura). Siempre pon
// comillas a los atributos:  <div class="${x}">  y no  <div class=${x}>
// =============================================================================

export class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** @type {Record<string, string>} */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** @param {unknown} text */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
}

/** @param {unknown} value @returns {string} */
function renderValue(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) out += renderValue(values[i]);
  });
  return new SafeHtml(out);
}

/**
 * Marca un texto como confiable. SOLO para cosas que genera el propio programa
 * (por ejemplo, SVG armado con números). Nunca lo uses con texto del usuario.
 * @param {string} trusted
 */
export function raw(trusted) {
  return new SafeHtml(trusted);
}

/**
 * Pone una plantilla segura dentro de un elemento.
 * @param {Element} element @param {SafeHtml} content
 */
export function setHtml(element, content) {
  if (!(content instanceof SafeHtml)) {
    throw new TypeError('setHtml solo acepta plantillas html`...` (para evitar inyección de código).');
  }
  element.innerHTML = content.value;
}
