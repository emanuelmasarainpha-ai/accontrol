// @ts-check
// Cálculos puros de los gráficos (sin pantalla, para poder probarlos).

/**
 * Marcas "redondas" para un eje vertical: 0, 5 mil, 10 mil, 15 mil...
 * Por defecto incluye el cero; con `includeZero: false` el eje se ajusta a los datos (para ver cambios pequeños).
 * @param {number} minValue valor mínimo de los datos (en pesos, no centavos)
 * @param {number} maxValue valor máximo de los datos
 * @param {number} [targetCount] cuántas divisiones se desean aproximadamente
 * @param {{ includeZero?: boolean }} [options]
 * @returns {{ ticks: number[], min: number, max: number, step: number }}
 */
export function niceTicks(minValue, maxValue, targetCount = 4, { includeZero = true } = {}) {
  let lo = includeZero ? Math.min(0, minValue) : minValue;
  let hi = includeZero ? Math.max(0, maxValue) : maxValue;
  if (hi === lo) {
    // Datos planos: se abre el eje para que la línea quede en el medio.
    if (includeZero) hi = lo + 1;
    else {
      const pad = Math.max(1, Math.abs(lo) * 0.05);
      lo -= pad;
      hi += pad;
    }
  }

  const rawStep = (hi - lo) / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = factor * magnitude;

  const startIndex = Math.floor(lo / step + 1e-9);
  const endIndex = Math.ceil(hi / step - 1e-9);
  const ticks = [];
  for (let i = startIndex; i <= endIndex; i += 1) ticks.push(Math.round(i * step * 1e6) / 1e6);
  return { ticks, min: ticks[0], max: ticks[ticks.length - 1], step };
}

/**
 * Trazo de una columna con la punta superior redondeada y la base recta.
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r
 */
export function topRoundedBar(x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  const f = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  return (
    `M${f(x)},${f(y + h)}V${f(y + radius)}` +
    `Q${f(x)},${f(y)} ${f(x + radius)},${f(y)}H${f(x + w - radius)}` +
    `Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + radius)}V${f(y + h)}Z`
  );
}

/**
 * Trazo de una barra horizontal con la punta derecha redondeada y la base (izquierda) recta.
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r
 */
export function rightRoundedBar(x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, h / 2, w));
  const f = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  return (
    `M${f(x)},${f(y)}H${f(x + w - radius)}` +
    `Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + radius)}V${f(y + h - radius)}` +
    `Q${f(x + w)},${f(y + h)} ${f(x + w - radius)},${f(y + h)}H${f(x)}Z`
  );
}

/**
 * Recorta un texto largo con "…" según el ancho disponible (estimación por caracteres).
 * @param {string} text @param {number} maxChars
 */
export function truncate(text, maxChars) {
  if (maxChars < 2) return '';
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/**
 * Reparte un ancho entre segmentos con un hueco fijo entre ellos.
 * Los segmentos con valor > 0 siempre ocupan al menos `minWidth` para que se vean.
 * @param {number[]} values @param {number} totalWidth @param {number} gap @param {number} [minWidth]
 * @returns {{ x: number, width: number }[]} (los segmentos con valor 0 devuelven width 0)
 */
export function segmentLayout(values, totalWidth, gap, minWidth = 4) {
  const visible = values.filter((v) => v > 0).length;
  if (visible === 0) return values.map(() => ({ x: 0, width: 0 }));
  const usable = totalWidth - gap * (visible - 1);
  const sum = values.reduce((a, b) => a + (b > 0 ? b : 0), 0);

  // Primer reparto proporcional; los muy pequeños suben al mínimo y el resto se reduce.
  let widths = values.map((v) => (v > 0 ? (v / sum) * usable : 0));
  const tiny = widths.map((w, i) => values[i] > 0 && w < minWidth);
  if (tiny.some(Boolean)) {
    const reserved = tiny.filter(Boolean).length * minWidth;
    const bigSum = values.reduce((a, v, i) => (tiny[i] || v <= 0 ? a : a + v), 0);
    widths = widths.map((w, i) => (tiny[i] ? minWidth : values[i] > 0 ? (values[i] / bigSum) * (usable - reserved) : 0));
  }

  let x = 0;
  return widths.map((width) => {
    const segment = { x, width };
    if (width > 0) x += width + gap;
    return segment;
  });
}
