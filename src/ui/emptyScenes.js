// @ts-check
// =============================================================================
// ESCENAS DE LAS PANTALLAS VACÍAS (0.20.7, pedido de la persona: una app más creativa y con movimiento)
// -----------------------------------------------------------------------------
// Cuando una pantalla todavía no tiene nada («Sin metas todavía», «Sin clientes»…), en vez del medallón sobrio
// sale una escena dibujada del tema, en el color del espacio abierto, con partes que se mueven solas sin parar:
// la flecha que tiembla en la diana, las barras que crecen, las monedas que caen en la cartera, las ventanas que
// se encienden… (clases sc-* en components.css). Se detienen con «reducir movimiento» o con «Imágenes en
// movimiento» apagado. Solo transform y opacity; sin estilos en línea. Decorativo (aria-hidden).
// Un ícono sin escena sigue con el medallón de antes (ui/components.js → emptyArt).
// =============================================================================

import { html, raw } from './html.js';

/** Moneda dorada. @param {number} cx @param {number} cy @param {number} r */
const coin = (cx, cy, r) => `<circle class="y" cx="${cx}" cy="${cy}" r="${r}"/><circle class="yl" cx="${cx}" cy="${cy}" r="${(r * 0.62).toFixed(1)}"/>`;

/** Destello de cuatro puntas que parpadea. @param {number} x @param {number} y @param {number} s @param {number} step */
const spark = (x, y, s, step) => `<g class="sc-blink sc-d${step}"><path class="y" d="M${x} ${y - s}l${s * 0.28} ${s * 0.72} ${s * 0.72} ${s * 0.28}-${s * 0.72} ${s * 0.28}L${x} ${y + s}l-${s * 0.28}-${s * 0.72}-${s * 0.72}-${s * 0.28} ${s * 0.72}-${s * 0.28}z"/></g>`;

/** Sombra en el piso. */
const ground = `<ellipse class="sh" cx="80" cy="110" rx="52" ry="6"/>`;

/** Las escenas (viewBox 160 × 120), por el ícono que pide cada pantalla vacía. @type {Readonly<Record<string, string>>} */
export const SCENES = Object.freeze({
  // Metas: una diana y la flecha clavada que tiembla.
  target: `${ground}<circle class="k" cx="74" cy="62" r="42"/><circle class="w" cx="74" cy="62" r="32"/><circle class="k" cx="74" cy="62" r="22"/><circle class="w" cx="74" cy="62" r="12"/><circle class="d" cx="74" cy="62" r="5"/>
    <g class="sc-wiggle sc-o-bl"><path class="ln" d="M74 62 122 18"/><path class="r" d="m118 12 12-6-2 13-9 3zm-4 14 10-3-3 12-11 3z"/></g>
    ${spark(26, 24, 8, 1)}${spark(136, 64, 6, 3)}`,
  // Estadísticas: barras que crecen una tras otra y la flecha de tendencia.
  chart: `${ground}<path class="ln ln--s" d="M28 104h108"/>
    <g class="sc-grow sc-o-bottom sc-d1"><rect class="s" x="34" y="66" width="18" height="38" rx="4"/></g>
    <g class="sc-grow sc-o-bottom sc-d2"><rect class="k" x="60" y="48" width="18" height="56" rx="4"/></g>
    <g class="sc-grow sc-o-bottom sc-d3"><rect class="s" x="86" y="58" width="18" height="46" rx="4"/></g>
    <g class="sc-grow sc-o-bottom sc-d4"><rect class="g" x="112" y="30" width="18" height="74" rx="4"/></g>
    <g class="sc-blink sc-d2"><path class="ln ln--y" d="M36 50 66 30l26 16 28-28"/><path class="y" d="m124 12-14 2 10 10z"/></g>`,
  // Movimientos: una cartera y monedas que caen dentro.
  swap: `${ground}<rect class="k" x="36" y="48" width="88" height="58" rx="12"/><rect class="d" x="36" y="48" width="88" height="16" rx="8"/><rect class="s" x="98" y="68" width="30" height="22" rx="7"/><circle class="d" cx="110" cy="79" r="4"/>
    <g class="sc-drop sc-d1">${coin(58, 30, 10)}</g><g class="sc-drop sc-d3">${coin(82, 20, 10)}</g><g class="sc-drop sc-d2">${coin(104, 32, 8)}</g>
    <g class="sc-bob"><path class="g" d="m18 60 8-10 8 10h-5v12h-6V60z"/></g><g class="sc-bob sc-d2"><path class="r" d="m142 70-8 10-8-10h5V58h6v12z"/></g>`,
  // Deudas: la tarjeta y el visto bueno de «pagado» que late.
  card: `${ground}<g class="sc-bob"><rect class="k" x="28" y="30" width="100" height="64" rx="11"/><rect class="d" x="28" y="44" width="100" height="12"/><rect class="y" x="40" y="66" width="18" height="12" rx="3"/><path class="lw" d="M68 72h44"/>
    <g class="sc-shine"><path class="w w--glint" d="M96 30h12L84 94H72z"/></g></g>
    <g class="sc-pulse"><circle class="g" cx="124" cy="88" r="16"/><path class="lw lw--thick" d="m116 88 6 6 10-11"/></g>
    ${spark(22, 26, 7, 2)}`,
  // Bancos y cuentas: el edificio del banco y la moneda que flota encima.
  bank: `${ground}<path class="k" d="M30 46 80 18l50 28z"/><rect class="d" x="30" y="96" width="100" height="10" rx="2"/><path class="k" d="M38 50h12v44H38zm22 0h12v44H60zm22 0h12v44H82zm22 0h12v44h-12z"/>
    <g class="sc-bob">${coin(80, 34, 8)}</g>${spark(20, 32, 7, 1)}${spark(142, 40, 6, 3)}`,
  // Inventario: una caja abierta con productos que saltan.
  box: `${ground}<g class="sc-bob sc-d1"><rect class="r" x="56" y="20" width="14" height="26" rx="5"/><rect class="d" x="59" y="15" width="8" height="7" rx="2"/></g>
    <g class="sc-bob sc-d3"><circle class="g" cx="94" cy="32" r="10"/><path class="d" d="M94 22c0-4 3-6 6-6-.3 3.4-2.4 5.4-6 6z"/></g>
    <g class="sc-bob sc-d2"><rect class="y" x="74" y="26" width="12" height="18" rx="3"/></g>
    <path class="s" d="M28 50 46 38h68l18 12z"/><path class="k" d="M34 50h92v50a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6z"/><path class="d" d="M34 50 22 64h44l12-14zm92 0 12 14H94l-12-14z"/><rect class="w" x="68" y="72" width="24" height="12" rx="3"/>`,
  // Empresa: edificios con ventanas que se encienden y una nube que pasa.
  building: `${ground}<g class="sc-fly"><path class="s" d="M112 22a9 9 0 0 1 17-3 7 7 0 1 1 3 13h-19a5 5 0 0 1-1-10z"/></g>
    <rect class="s" x="24" y="56" width="32" height="50" rx="3"/><rect class="k" x="56" y="28" width="44" height="78" rx="3"/><rect class="d" x="100" y="48" width="34" height="58" rx="3"/>
    <g class="sc-blink sc-d1"><rect class="y" x="64" y="38" width="10" height="9" rx="1.5"/><rect class="y" x="82" y="56" width="10" height="9" rx="1.5"/><rect class="y" x="108" y="60" width="8" height="8" rx="1.5"/></g>
    <g class="sc-blink sc-d3"><rect class="y" x="82" y="38" width="10" height="9" rx="1.5"/><rect class="y" x="64" y="74" width="10" height="9" rx="1.5"/><rect class="y" x="118" y="78" width="8" height="8" rx="1.5"/><rect class="y" x="32" y="66" width="8" height="8" rx="1.5"/></g>
    <rect class="w" x="70" y="90" width="16" height="16" rx="2"/>`,
  // Facturas: el recibo que flota, sus renglones y el sello de cobrado.
  receipt: `${ground}<g class="sc-bob"><path class="w w--paper" d="M46 14h68v86l-8.5-6-8.5 6-8.5-6-8.5 6-8.5-6-8.5 6-8.5-6-8.5 6z"/><rect class="k" x="56" y="26" width="30" height="7" rx="3.5"/>
    <path class="ln ln--s" d="M56 44h48M56 54h48M56 64h30"/><rect class="s" x="56" y="74" width="48" height="10" rx="3"/></g>
    <g class="sc-pulse"><circle class="g" cx="118" cy="86" r="15"/><path class="lw lw--thick" d="m111 86 5 5 9-10"/></g>
    <g class="sc-drop sc-d2">${coin(30, 40, 8)}</g>`,
  // Clientes: dos personas y un globo de diálogo con un corazón que late.
  user: `${ground}<circle class="s" cx="104" cy="50" r="15"/><path class="s" d="M76 106a28 28 0 0 1 56 0z"/>
    <g class="sc-bob"><circle class="k" cx="62" cy="48" r="17"/><path class="k" d="M30 106a32 32 0 0 1 64 0z"/></g>
    <g class="sc-pulse"><path class="w w--paper" d="M98 8h40a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-24l-10 8v-8h-6a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6z"/><path class="r" d="M118 31s-9-5-9-10.5a4.6 4.6 0 0 1 9-1.6 4.6 4.6 0 0 1 9 1.6c0 5.5-9 10.5-9 10.5z"/></g>
    ${spark(20, 40, 7, 2)}`,
  // Patrimonio: la casa con humo en la chimenea, el árbol que se mece y monedas apiladas.
  home: `${ground}<g class="sc-rise"><path class="ln ln--s" d="M98 22c-3-3 3-5 0-9"/><path class="ln ln--s" d="M106 20c-3-3 3-5 0-9"/></g>
    <rect class="d" x="96" y="28" width="10" height="18" rx="2"/><path class="k" d="M40 58 76 28l36 30v48H40z"/><path class="d" d="M34 60 76 24l42 36-4 4.5L76 32 38 64.5z"/><rect class="w" x="68" y="80" width="16" height="26" rx="2"/>
    <g class="sc-blink sc-d2"><rect class="y" x="50" y="66" width="12" height="11" rx="2"/><rect class="y" x="90" y="66" width="12" height="11" rx="2"/></g>
    <g class="sc-swing sc-o-bottom"><circle class="g" cx="134" cy="72" r="13"/><rect class="d" x="132" y="80" width="4" height="26" rx="2"/></g>
    <g class="sc-bob sc-d3">${coin(22, 92, 8)}${coin(22, 80, 8)}</g>`,
});

/**
 * La escena de un ícono, o null si no tiene (entonces se usa el medallón de siempre).
 * @param {string} iconName
 */
export function emptyScene(iconName) {
  const scene = Object.hasOwn(SCENES, iconName) ? SCENES[iconName] : null;
  if (!scene) return null;
  return html`<span class="scene" data-scene="${iconName}" aria-hidden="true"><svg viewBox="0 0 160 120" focusable="false">${raw(scene)}</svg></span>`;
}
