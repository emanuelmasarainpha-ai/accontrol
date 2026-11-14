// @ts-check
// =============================================================================
// DINERO: leer lo que escribe el usuario y mostrar montos
// -----------------------------------------------------------------------------
// Todo monto vive como ENTERO EN CENTAVOS (RD$ 1,500.50 -> 150050).
// Este archivo es el único lugar donde se convierte texto <-> centavos.
// =============================================================================

export const CURRENCY_SYMBOL = 'RD$';

/** Monto máximo permitido por registro: RD$ 999,999,999.99 (evita errores de tecleo). */
export const MAX_CENTS = 99_999_999_999;

/**
 * Convierte lo que el usuario escribió ("1500.50", "1,500.50", "12,5") en centavos.
 *
 * Formatos aceptados (cualquier otro se RECHAZA en lugar de adivinar):
 *   1500        1500.5      1500.50     1500,50 (coma decimal)
 *   1,500       1,500.50    1,500,000   (coma como separador de miles)
 * Rechazado por ambiguo: 1.500 (¿mil quinientos o uno con cinco?), 1.500.000
 *
 * @param {unknown} text
 * @returns {{ ok: true, cents: number } | { ok: false, error: string }}
 */
export function parseMoney(text) {
  // Se acepta que peguen "RD$ 1,500.50" (tal como lo muestra la app). Los espacios DENTRO de
  // los números se rechazan: "1 5 0 0" no es un monto que alguien escriba a propósito.
  const raw = String(text ?? '')
    .trim()
    .replace(/^RD\$\s*/i, '')
    .replace(/^\$\s*/, '');

  if (raw === '') return fail('Escribe un monto.');
  if (raw.startsWith('-')) {
    return fail('No uses signo negativo: el tipo (ingreso o gasto) ya indica la dirección.');
  }
  if (/[^0-9.,]/.test(raw)) return fail('Usa solo números. Ejemplo: 1500.50');

  /** @type {string} */
  let whole;
  let decimals = '';
  let m;

  if ((m = /^(\d+)$/.exec(raw))) {
    whole = m[1];
  } else if ((m = /^(\d+)[.,](\d{1,2})$/.exec(raw))) {
    whole = m[1];
    decimals = m[2];
  } else if ((m = /^([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(raw))) {
    whole = m[1].replace(/,/g, '');
    decimals = m[2] ?? '';
  } else {
    return fail(
      `No se entiende «${raw}». Escribe el monto así: 1500 o 1,500.50 (punto para los centavos).`,
    );
  }

  whole = whole.replace(/^0+(?=\d)/, '');
  if (whole.length > 10) return fail('El monto es demasiado grande.');

  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(decimals.padEnd(2, '0') || '0', 10);
  if (cents > MAX_CENTS) return fail('El monto es demasiado grande.');
  return { ok: true, cents };

  /** @param {string} error */
  function fail(error) {
    return { ok: /** @type {const} */ (false), error };
  }
}

/** @param {string} digits */
function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Parte un monto en trozos, útil para mostrar los centavos más pequeños.
 * @param {number} cents
 */
export function moneyParts(cents) {
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  return {
    negative: rounded < 0,
    symbol: CURRENCY_SYMBOL,
    whole: groupThousands(String(Math.floor(abs / 100))),
    fraction: String(abs % 100).padStart(2, '0'),
  };
}

/**
 * "RD$ 1,500.50". Negativos: "-RD$ 1,500.50".
 * @param {number} cents
 * @param {{ decimals?: boolean, sign?: boolean }} [options]
 *   decimals=false oculta los centavos; sign=true añade "+" a los positivos.
 */
export function formatMoney(cents, { decimals = true, sign = false } = {}) {
  if (!decimals) {
    // Sin centavos se REDONDEA al peso más cercano (RD$ 999.99 -> "RD$ 1,000"), no se trunca.
    const pesos = Math.round(Math.abs(Math.round(cents)) / 100);
    const prefix = pesos === 0 ? '' : cents < 0 ? '-' : sign ? '+' : '';
    return `${prefix}${CURRENCY_SYMBOL} ${groupThousands(String(pesos))}`;
  }
  const p = moneyParts(cents);
  const prefix = p.negative ? '-' : sign && cents > 0 ? '+' : '';
  return `${prefix}${p.symbol} ${p.whole}.${p.fraction}`;
}

/**
 * Versión corta para ejes de gráficos: 850, 5 mil, 12.5 mil, 1.2 M.
 * @param {number} cents
 */
export function formatCompact(cents) {
  const units = Math.abs(cents) / 100;
  let text;
  if (units < 999.5) text = String(Math.round(units));
  else if (units < 999_950) text = `${trimZero(units / 1000)} mil`;
  else text = `${trimZero(units / 1_000_000)} M`;
  return text === '0' || cents >= 0 ? text : `-${text}`;
}

/** @param {number} n */
function trimZero(n) {
  return n.toFixed(1).replace(/\.0$/, '');
}

/**
 * Para rellenar un campo de edición: 150050 -> "1500.50".
 * @param {number} cents
 */
export function centsToInputValue(cents) {
  const p = moneyParts(cents);
  return `${p.negative ? '-' : ''}${p.whole.replace(/,/g, '')}.${p.fraction}`;
}

/**
 * Porcentaje entero seguro (evita dividir entre cero).
 * @param {number} part
 * @param {number} total
 * @returns {number} 0 si total es 0.
 */
export function percentOf(part, total) {
  if (!total) return 0;
  return (part / total) * 100;
}

/**
 * Formatea un porcentaje: 34 -> "34%", 12.5 -> "12.5%".
 * @param {number} value
 */
export function formatPercent(value) {
  let rounded = Math.round(value * 10) / 10;
  if (value < 100 && rounded >= 100) rounded = 99.9; // "100%" solo cuando de verdad llegó al 100%
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
