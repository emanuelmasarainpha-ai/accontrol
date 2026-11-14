// @ts-check
// =============================================================================
// GRÁFICOS (SVG propio, sin librerías)
// -----------------------------------------------------------------------------
// Cuatro gráficos, todos con la misma receta:
//   - se dibujan al ancho real del contenedor y se redibujan si cambia
//   - marcas finas, cuadrícula casi invisible, color que SIGUE a la entidad
//     (ingresos siempre verde, gastos siempre azul)
//   - globo de información al pasar el puntero, tocar o enfocar con el teclado
//   - cada gráfico tiene su "Ver como tabla" (ver components.js): ningún dato
//     depende de pasar el ratón por encima
//
//   columnChart  columnas agrupadas por mes (ingresos vs gastos)
//   lineChart    línea con área suave (evolución del dinero disponible)
//   hBarChart    barras horizontales ordenadas (gasto por categoría)
//   segmentBar   barra dividida en tramos (reparto de un total)
// =============================================================================

import { formatCompact, formatMoney, formatPercent } from '../domain/money.js';
import { niceTicks, rightRoundedBar, segmentLayout, topRoundedBar, truncate } from './chart-math.js';
import { escapeHtml } from './html.js';
import { hideTip, showTip } from './tooltip.js';

/** @typedef {import('./tooltip.js').Tip} Tip */

const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * Dibuja `render(width)` dentro del contenedor y lo repite cuando cambia el ancho.
 * Conecta también los globos de información.
 * @param {HTMLElement} container
 * @param {(width: number) => string} render devuelve el <svg> como texto
 * @param {Tip[]} tips globo de cada elemento marcado con data-tip="índice"
 * @returns {() => void} función para limpiar al salir de la pantalla
 */
function mountChart(container, render, tips) {
  let lastWidth = 0;
  const draw = () => {
    const width = Math.floor(container.clientWidth);
    if (width < 80) return; // oculto o aún sin tamaño
    lastWidth = width;
    container.innerHTML = render(width);
  };
  draw();

  const observer = new ResizeObserver(() => {
    if (Math.floor(container.clientWidth) !== lastWidth) draw();
  });
  observer.observe(container);

  /** @param {EventTarget | null} target */
  const hitOf = (target) => (target instanceof Element ? target.closest('[data-tip]') : null);

  /** @param {PointerEvent} event */
  const onPointer = (event) => {
    const hit = hitOf(event.target);
    const tip = hit ? tips[Number(hit.getAttribute('data-tip'))] : undefined;
    if (tip) showTip(event.clientX, event.clientY, tip);
    else hideTip();
  };
  /** @param {FocusEvent} event */
  const onFocus = (event) => {
    const hit = hitOf(event.target);
    const tip = hit ? tips[Number(hit.getAttribute('data-tip'))] : undefined;
    if (hit && tip) {
      const box = hit.getBoundingClientRect();
      showTip(box.left + box.width / 2, box.top + Math.min(40, box.height / 2), tip);
    }
  };

  container.addEventListener('pointermove', onPointer);
  container.addEventListener('pointerdown', onPointer);
  container.addEventListener('pointerleave', hideTip);
  container.addEventListener('focusin', onFocus);
  container.addEventListener('focusout', hideTip);

  return () => {
    observer.disconnect();
    container.removeEventListener('pointermove', onPointer);
    container.removeEventListener('pointerdown', onPointer);
    container.removeEventListener('pointerleave', hideTip);
    container.removeEventListener('focusin', onFocus);
    container.removeEventListener('focusout', hideTip);
    hideTip();
  };
}

/** Ancho que necesitan las marcas del eje vertical. @param {number[]} ticksPesos */
function axisWidth(ticksPesos) {
  const longest = Math.max(...ticksPesos.map((t) => formatCompact(t * 100).length));
  return Math.max(26, longest * 7 + 12);
}

// -----------------------------------------------------------------------------
// COLUMNAS AGRUPADAS
// -----------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {Object} spec
 * @param {string[]} spec.labels       Texto bajo cada grupo ("jun", "jul"...).
 * @param {string[]} spec.titles       Título del globo ("junio 2026").
 * @param {{ name: string, cls: string, values: number[] }[]} spec.series  `values` en centavos; `cls`: "income" | "expense" ...
 * @param {string} spec.ariaLabel
 * @param {number} [spec.height]
 */
export function columnChart(container, spec) {
  const height = spec.height ?? 232;
  const top = 10;
  const bottom = 26;
  const right = 4;
  const n = spec.labels.length;
  const maxValue = Math.max(0, ...spec.series.flatMap((s) => s.values)) / 100;
  const scale = niceTicks(0, maxValue, 4);

  /** @type {Tip[]} */
  const tips = spec.labels.map((_, i) => ({
    title: spec.titles[i],
    rows: spec.series.map((s) => ({ label: s.name, value: formatMoney(s.values[i]), swatch: `swatch--${s.cls}` })),
  }));

  const render = (/** @type {number} */ width) => {
    const left = axisWidth(scale.ticks);
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const y = (/** @type {number} */ v) => top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
    const band = plotW / n;
    const barW = Math.max(4, Math.min(24, (band * 0.62 - 2) / spec.series.length));
    const groupW = barW * spec.series.length + 2 * (spec.series.length - 1);

    let out = `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(spec.ariaLabel)}">`;

    for (const t of scale.ticks) {
      const ty = round(y(t));
      out += `<line class="chart__grid${t === 0 ? ' chart__grid--base' : ''}" x1="${left}" x2="${width - right}" y1="${ty}" y2="${ty}"/>`;
      out += `<text class="chart__axis" x="${left - 8}" y="${ty + 4}" text-anchor="end">${escapeHtml(formatCompact(t * 100))}</text>`;
    }

    for (let i = 0; i < n; i += 1) {
      const bandX = left + band * i;
      const cx = bandX + band / 2;
      const label = `${spec.titles[i]}: ${spec.series.map((s) => `${s.name} ${formatMoney(s.values[i])}`).join(', ')}`;
      out += `<g class="band" data-tip="${i}" tabindex="0" role="img" aria-label="${escapeHtml(label)}">`;
      out += `<rect class="band__bg" x="${round(bandX + 2)}" y="${top}" width="${round(band - 4)}" height="${plotH}" rx="6"/>`;
      spec.series.forEach((s, j) => {
        const value = s.values[i] / 100;
        const barH = y(0) - y(value);
        if (barH > 0) {
          const x = cx - groupW / 2 + j * (barW + 2);
          out += `<path class="mark mark--${s.cls}" d="${topRoundedBar(x, y(value), barW, barH, 4)}"/>`;
        }
      });
      out += `<text class="chart__axis chart__axis--x" x="${round(cx)}" y="${height - 8}" text-anchor="middle">${escapeHtml(spec.labels[i])}</text>`;
      out += '</g>';
    }
    return `${out}</svg>`;
  };

  return mountChart(container, render, tips);
}

// -----------------------------------------------------------------------------
// LÍNEA
// -----------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {Object} spec
 * @param {string[]} spec.labels
 * @param {string[]} spec.titles
 * @param {number[]} spec.values  En centavos; pueden ser negativos.
 * @param {string} spec.name      Nombre de la serie (para el globo).
 * @param {string} spec.cls       Color: "primary" | "income" ...
 * @param {string} spec.ariaLabel
 * @param {number} [spec.height]
 * @param {boolean} [spec.zeroBase]  true (por defecto): el eje incluye el 0. false: se ajusta a los datos (útil si los valores son grandes y casi iguales).
 */
export function lineChart(container, spec) {
  const height = spec.height ?? 208;
  const top = 22;
  const bottom = 26;
  const right = 14;
  const n = spec.labels.length;
  const pesos = spec.values.map((v) => v / 100);
  const zeroBase = spec.zeroBase !== false;
  const scale = zeroBase ? niceTicks(Math.min(0, ...pesos), Math.max(0, ...pesos), 4) : niceTicks(Math.min(...pesos), Math.max(...pesos), 4, { includeZero: false });

  /** @type {Tip[]} */
  const tips = spec.labels.map((_, i) => ({
    title: spec.titles[i],
    rows: [{ label: spec.name, value: formatMoney(spec.values[i]), swatch: `swatch--${spec.cls}` }],
  }));

  const render = (/** @type {number} */ width) => {
    const left = axisWidth(scale.ticks);
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const y = (/** @type {number} */ v) => top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;
    const band = plotW / n;
    const xs = pesos.map((_, i) => left + band * (i + 0.5));
    const ys = pesos.map((v) => y(v));

    let out = `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(spec.ariaLabel)}">`;
    for (const t of scale.ticks) {
      const ty = round(y(t));
      out += `<line class="chart__grid${t === 0 ? ' chart__grid--base' : ''}" x1="${left}" x2="${width - right}" y1="${ty}" y2="${ty}"/>`;
      out += `<text class="chart__axis" x="${left - 8}" y="${ty + 4}" text-anchor="end">${escapeHtml(formatCompact(t * 100))}</text>`;
    }

    const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${round(x)},${round(ys[i])}`).join('');
    const zeroY = round(zeroBase ? y(0) : y(scale.min));
    out += `<path class="area area--${spec.cls}" d="${linePath}L${round(xs[n - 1])},${zeroY}L${round(xs[0])},${zeroY}Z"/>`;
    out += `<path class="line line--${spec.cls}" d="${linePath}"/>`;

    for (let i = 0; i < n; i += 1) {
      const bandX = left + band * i;
      const label = `${spec.titles[i]}: ${spec.name} ${formatMoney(spec.values[i])}`;
      out += `<g class="band" data-tip="${i}" tabindex="0" role="img" aria-label="${escapeHtml(label)}">`;
      out += `<rect class="band__bg" x="${round(bandX + 2)}" y="${top - 8}" width="${round(band - 4)}" height="${plotH + 8}" rx="6"/>`;
      out += `<line class="crosshair" x1="${round(xs[i])}" x2="${round(xs[i])}" y1="${top - 8}" y2="${top + plotH}"/>`;
      out += `<circle class="dot dot--hover dot--${spec.cls}" cx="${round(xs[i])}" cy="${round(ys[i])}" r="4"/>`;
      out += `<text class="chart__axis chart__axis--x" x="${round(xs[i])}" y="${height - 8}" text-anchor="middle">${escapeHtml(spec.labels[i])}</text>`;
      out += '</g>';
    }

    // Último punto: marca con anillo del color de la superficie y su valor.
    const lastX = xs[n - 1];
    const lastY = ys[n - 1];
    out += `<circle class="dot dot--${spec.cls}" cx="${round(lastX)}" cy="${round(lastY)}" r="4"/>`;
    const labelText = formatMoney(spec.values[n - 1], { decimals: false });
    const placeBelow = lastY < top + 12;
    out += `<text class="chart__end-label" x="${round(Math.min(lastX, width - right))}" y="${round(placeBelow ? lastY + 20 : lastY - 10)}" text-anchor="end">${escapeHtml(labelText)}</text>`;
    return `${out}</svg>`;
  };

  return mountChart(container, render, tips);
}

// -----------------------------------------------------------------------------
// BARRAS HORIZONTALES
// -----------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {Object} spec
 * @param {{ label: string, valueCents: number, percent: number }[]} spec.items  Ya ordenados.
 * @param {string} spec.cls
 * @param {string} spec.ariaLabel
 */
export function hBarChart(container, spec) {
  const rowH = 46;
  const max = Math.max(1, ...spec.items.map((i) => i.valueCents));

  /** @type {Tip[]} */
  const tips = spec.items.map((item) => ({
    title: item.label,
    rows: [
      { label: 'del total', value: formatPercent(item.percent) },
      { label: 'monto', value: formatMoney(item.valueCents), swatch: `swatch--${spec.cls}` },
    ],
  }));

  const render = (/** @type {number} */ width) => {
    const height = rowH * spec.items.length;
    let out = `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(spec.ariaLabel)}">`;
    spec.items.forEach((item, i) => {
      const y0 = i * rowH;
      const valueText = formatMoney(item.valueCents);
      const percentText = formatPercent(item.percent);
      const reserved = (valueText.length + percentText.length + 2) * 7.4;
      const maxChars = Math.floor((width - reserved) / 7.2);
      const barW = Math.max(3, (item.valueCents / max) * width);
      const text = `${item.label}: ${valueText}, ${percentText} del total`;
      out += `<g class="band band--row" data-tip="${i}" tabindex="0" role="img" aria-label="${escapeHtml(text)}">`;
      out += `<rect class="band__bg" x="-4" y="${y0 + 2}" width="${width + 8}" height="${rowH - 6}" rx="6"/>`;
      out += `<text class="chart__row-label" x="0" y="${y0 + 17}">${escapeHtml(truncate(item.label, maxChars))}</text>`;
      out += `<text class="chart__row-value" x="${width}" y="${y0 + 17}" text-anchor="end">${escapeHtml(valueText)}<tspan class="chart__row-percent" dx="8">${escapeHtml(percentText)}</tspan></text>`;
      out += `<rect class="chart__track" x="0" y="${y0 + 26}" width="${width}" height="10" rx="5"/>`;
      out += `<path class="mark mark--${spec.cls}" d="${rightRoundedBar(0, y0 + 26, barW, 10, 4)}"/>`;
      out += '</g>';
    });
    return `${out}</svg>`;
  };

  return mountChart(container, render, tips);
}

// -----------------------------------------------------------------------------
// BARRA DIVIDIDA EN TRAMOS
// -----------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {Object} spec
 * @param {{ label: string, valueCents: number, cls: string }[]} spec.segments
 * @param {number} spec.totalCents  Lo que representa el 100% de la barra.
 * @param {string} spec.ariaLabel
 * @param {string} [spec.emptyText]  Texto cuando no hay nada que repartir.
 */
export function segmentBar(container, spec) {
  const height = 16;
  const total = spec.totalCents > 0 ? spec.totalCents : spec.segments.reduce((s, x) => s + x.valueCents, 0);

  /** @type {Tip[]} */
  const tips = spec.segments.map((s) => ({
    title: s.label,
    rows: [
      { label: 'del total', value: total > 0 ? formatPercent((s.valueCents / total) * 100) : '0%' },
      { label: 'monto', value: formatMoney(s.valueCents), swatch: `swatch--${s.cls}` },
    ],
  }));

  const render = (/** @type {number} */ width) => {
    const layout = segmentLayout(spec.segments.map((s) => s.valueCents), width, 2, 4);
    let out = `<svg class="chart chart--segments" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(spec.ariaLabel)}">`;
    out += `<rect class="chart__track" x="0" y="0" width="${width}" height="${height}" rx="6"/>`;
    spec.segments.forEach((s, i) => {
      const seg = layout[i];
      if (seg.width <= 0) return;
      const text = `${s.label}: ${formatMoney(s.valueCents)}`;
      out += `<rect class="mark mark--${s.cls} seg" data-tip="${i}" tabindex="0" role="img" aria-label="${escapeHtml(text)}" x="${round(seg.x)}" y="0" width="${round(seg.width)}" height="${height}" rx="6"/>`;
    });
    return `${out}</svg>`;
  };

  return mountChart(container, render, tips);
}
