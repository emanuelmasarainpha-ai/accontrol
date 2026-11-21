// @ts-check
// =============================================================================
// MONEDAS (0.18.3)
// -----------------------------------------------------------------------------
// Cada espacio de trabajo guarda su moneda. Todos los espacios de una cuenta usan la misma (se elige al empezar y se
// cambia en Ajustes → General). Los montos siguen guardándose en CENTAVOS ENTEROS (la centésima parte de la moneda),
// por eso aquí solo hay monedas que usan centavos: no están el peso chileno, el guaraní ni el yen, que no los usan.
// La app NO convierte montos de una moneda a otra: cambiar la moneda solo cambia el símbolo con el que se muestran.
// =============================================================================

/**
 * @typedef {'DOP' | 'USD' | 'EUR' | 'MXN' | 'COP' | 'PEN' | 'ARS' | 'GTQ' | 'HNL' | 'NIO' | 'CRC' | 'PAB' | 'BOB' | 'UYU'
 *   | 'BRL' | 'HTG' | 'CAD' | 'GBP'} CurrencyCode
 */

/** @typedef {{ code: CurrencyCode, symbol: string, label: string }} CurrencyInfo */

/**
 * Las monedas disponibles, en el orden en que se ofrecen. El símbolo es el que se ve delante de cada monto.
 * @type {Record<CurrencyCode, CurrencyInfo>}
 */
export const CURRENCIES = {
  DOP: { code: 'DOP', symbol: 'RD$', label: 'Peso dominicano' },
  USD: { code: 'USD', symbol: 'US$', label: 'Dólar estadounidense' },
  EUR: { code: 'EUR', symbol: '€', label: 'Euro' },
  MXN: { code: 'MXN', symbol: 'MX$', label: 'Peso mexicano' },
  COP: { code: 'COP', symbol: 'COL$', label: 'Peso colombiano' },
  PEN: { code: 'PEN', symbol: 'S/', label: 'Sol peruano' },
  ARS: { code: 'ARS', symbol: 'AR$', label: 'Peso argentino' },
  GTQ: { code: 'GTQ', symbol: 'Q', label: 'Quetzal guatemalteco' },
  HNL: { code: 'HNL', symbol: 'L', label: 'Lempira hondureño' },
  NIO: { code: 'NIO', symbol: 'C$', label: 'Córdoba nicaragüense' },
  CRC: { code: 'CRC', symbol: '₡', label: 'Colón costarricense' },
  PAB: { code: 'PAB', symbol: 'B/.', label: 'Balboa panameño' },
  BOB: { code: 'BOB', symbol: 'Bs', label: 'Boliviano' },
  UYU: { code: 'UYU', symbol: '$U', label: 'Peso uruguayo' },
  BRL: { code: 'BRL', symbol: 'R$', label: 'Real brasileño' },
  HTG: { code: 'HTG', symbol: 'G', label: 'Gourde haitiano' },
  CAD: { code: 'CAD', symbol: 'CA$', label: 'Dólar canadiense' },
  GBP: { code: 'GBP', symbol: '£', label: 'Libra esterlina' },
};

/** La moneda de siempre (y la de los espacios de antes de la 0.18.3). */
export const DEFAULT_CURRENCY = /** @type {const} */ ('DOP');

/** Los códigos, en el orden de la lista. */
export const CURRENCY_CODES = /** @type {CurrencyCode[]} */ (Object.keys(CURRENCIES));

/** @param {unknown} value @returns {value is CurrencyCode} */
export function isCurrencyCode(value) {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

/** La moneda con ese código, o el peso dominicano si el código no existe. @param {unknown} code */
export function currencyInfo(code) {
  return isCurrencyCode(code) ? CURRENCIES[code] : CURRENCIES[DEFAULT_CURRENCY];
}

/** «Dólar estadounidense (US$)». @param {unknown} code */
export function currencyLabel(code) {
  const c = currencyInfo(code);
  return `${c.label} (${c.symbol})`;
}
