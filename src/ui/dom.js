// @ts-check
// Pequeñas ayudas para buscar elementos de la pantalla sin repetir código.

/**
 * Busca UN elemento y lanza un error claro si no existe (así TypeScript sabe que no es null).
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {T}
 */
export function $(selector, root = document) {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`No se encontró el elemento «${selector}» en la pantalla.`);
  return /** @type {T} */ (found);
}

/**
 * Busca VARIOS elementos.
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {T[]}
 */
export function $$(selector, root = document) {
  return /** @type {T[]} */ ([...root.querySelectorAll(selector)]);
}

/**
 * Busca hacia arriba el elemento con `data-action` que recibió el clic.
 * @param {EventTarget | null} target
 * @returns {HTMLElement | null}
 */
export function actionTarget(target) {
  return target instanceof Element ? target.closest('[data-action]') : null;
}
