// @ts-check
// =============================================================================
// GLOBO DE INFORMACIÓN DE LOS GRÁFICOS
// Un solo globo para toda la app. Los textos se insertan con textContent (nunca
// como HTML), porque los nombres de categorías los escribe el usuario.
// =============================================================================

/**
 * @typedef {Object} TipRow
 * @property {string} label
 * @property {string} value
 * @property {string} [swatch]  Nombre de clase de color (por ejemplo "swatch--income").
 */
/**
 * @typedef {Object} Tip
 * @property {string} title
 * @property {TipRow[]} rows
 */

/** @type {HTMLDivElement | null} */
let tipEl = null;

function ensure() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'tooltip';
  tipEl.setAttribute('role', 'presentation');
  tipEl.hidden = true;
  document.body.append(tipEl);
  return tipEl;
}

/**
 * @param {number} clientX @param {number} clientY @param {Tip} tip
 */
export function showTip(clientX, clientY, tip) {
  const el = ensure();
  el.replaceChildren();

  const title = document.createElement('div');
  title.className = 'tooltip__title';
  title.textContent = tip.title;
  el.append(title);

  for (const row of tip.rows) {
    const line = document.createElement('div');
    line.className = 'tooltip__row';
    if (row.swatch) {
      const key = document.createElement('span');
      key.className = `swatch ${row.swatch}`;
      line.append(key);
    }
    const value = document.createElement('strong');
    value.className = 'tooltip__value';
    value.textContent = row.value;
    const label = document.createElement('span');
    label.className = 'tooltip__label';
    label.textContent = row.label;
    line.append(value, label);
    el.append(line);
  }

  el.hidden = false;
  const margin = 12;
  const { width, height } = el.getBoundingClientRect();
  let left = clientX + margin;
  let top = clientY - height - margin;
  if (left + width > window.innerWidth - 8) left = clientX - width - margin;
  if (left < 8) left = 8;
  if (top < 8) top = clientY + margin;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}
