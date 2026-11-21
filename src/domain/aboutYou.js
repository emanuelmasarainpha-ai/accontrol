// @ts-check
// =============================================================================
// «SOBRE TI» (0.18.4): las preguntas de bienvenida
// -----------------------------------------------------------------------------
// Sexo, rango de edad y nacionalidad, para estadísticas futuras de quién usa ACCONTROL (decisión de la persona,
// 2026-11-20). Todo es OPCIONAL: null = «Prefiero no decirlo». Se guardan en la nube, en una tabla que solo ve su
// dueño (supabase/migrations/20261122000100_about_you.sql). Sin cuentas no se pregunta: no habría a dónde enviarlo.
// La moneda NO va aquí: es de los espacios (domain/currencies.js) y se elige al crear el primero.
// =============================================================================

/** @typedef {'male' | 'female'} Gender */
/** @typedef {'under_18' | '18_24' | '25_34' | '35_44' | '45_54' | '55_64' | '65_plus'} AgeRange */
/** @typedef {{ gender: Gender | null, ageRange: AgeRange | null, nationality: string | null }} AboutYou */

/** @type {{ value: Gender, label: string }[]} */
export const GENDERS = [
  { value: 'male', label: 'Hombre' },
  { value: 'female', label: 'Mujer' },
];

/** @type {{ value: AgeRange, label: string }[]} */
export const AGE_RANGES = [
  { value: 'under_18', label: 'Menos de 18' },
  { value: '18_24', label: '18 a 24' },
  { value: '25_34', label: '25 a 34' },
  { value: '35_44', label: '35 a 44' },
  { value: '45_54', label: '45 a 54' },
  { value: '55_64', label: '55 a 64' },
  { value: '65_plus', label: '65 o más' },
];

/** Países (códigos ISO 3166-1 de dos letras). El nombre en español lo da el propio navegador (countryName). */
export const COUNTRY_CODES = [
  'AF', 'AL', 'DE', 'AD', 'AO', 'AG', 'SA', 'DZ', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ', 'BS', 'BD', 'BB', 'BH', 'BE', 'BZ',
  'BJ', 'BY', 'BO', 'BA', 'BW', 'BR', 'BN', 'BG', 'BF', 'BI', 'BT', 'CV', 'KH', 'CM', 'CA', 'QA', 'TD', 'CL', 'CN', 'CY',
  'CO', 'KM', 'CG', 'CD', 'KP', 'KR', 'CI', 'CR', 'HR', 'CU', 'CW', 'DK', 'DM', 'EC', 'EG', 'SV', 'AE', 'ER', 'SK', 'SI',
  'ES', 'US', 'EE', 'SZ', 'ET', 'PH', 'FI', 'FJ', 'FR', 'GA', 'GM', 'GE', 'GH', 'GD', 'GR', 'GT', 'GN', 'GQ', 'GW', 'GY',
  'HT', 'HN', 'HK', 'HU', 'IN', 'ID', 'IQ', 'IR', 'IE', 'IS', 'IL', 'IT', 'JM', 'JP', 'JO', 'KZ', 'KE', 'KG', 'KI', 'XK',
  'KW', 'LA', 'LS', 'LV', 'LB', 'LR', 'LY', 'LI', 'LT', 'LU', 'MK', 'MG', 'MY', 'MW', 'MV', 'ML', 'MT', 'MA', 'MH', 'MU',
  'MR', 'MX', 'FM', 'MD', 'MC', 'MN', 'ME', 'MZ', 'MM', 'NA', 'NR', 'NP', 'NI', 'NE', 'NG', 'NO', 'NZ', 'OM', 'NL', 'PK',
  'PW', 'PS', 'PA', 'PG', 'PY', 'PE', 'PL', 'PT', 'PR', 'GB', 'CF', 'CZ', 'DO', 'RW', 'RO', 'RU', 'WS', 'KN', 'SM', 'VC',
  'LC', 'ST', 'SN', 'RS', 'SC', 'SL', 'SG', 'SX', 'SY', 'SO', 'LK', 'ZA', 'SD', 'SS', 'SE', 'CH', 'SR', 'TH', 'TW', 'TZ',
  'TJ', 'TL', 'TG', 'TO', 'TT', 'TN', 'TM', 'TR', 'TV', 'UA', 'UG', 'UY', 'UZ', 'VU', 'VA', 'VE', 'VN', 'YE', 'DJ', 'ZM',
  'ZW',
];

/** La que va primero en la lista (la mayoría de quienes usan ACCONTROL hoy). */
export const FIRST_COUNTRY = 'DO';

/** @type {Intl.DisplayNames | null | undefined} */
let names;

/** El nombre del país en español («República Dominicana»); el código si el navegador no sabe nombrarlo. @param {string} code */
export function countryName(code) {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['es'], { type: 'region' });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Los países para la lista: República Dominicana primero y los demás por nombre. */
export function countryOptions() {
  const rest = COUNTRY_CODES.filter((c) => c !== FIRST_COUNTRY)
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return [{ code: FIRST_COUNTRY, name: countryName(FIRST_COUNTRY) }, ...rest];
}

/** Sin respuestas (todo «Prefiero no decirlo»). @returns {AboutYou} */
export function emptyAboutYou() {
  return { gender: null, ageRange: null, nationality: null };
}

/**
 * Revisa lo que viene del formulario o de la nube. Vacío = «Prefiero no decirlo» (null). Algo que no está en las
 * listas es un error (no se adivina).
 * @param {{ gender?: unknown, ageRange?: unknown, nationality?: unknown }} raw
 * @returns {{ ok: true, value: AboutYou } | { ok: false, errors: Record<string, string> }}
 */
export function validateAboutYou(raw) {
  /** @type {Record<string, string>} */
  const errors = {};
  const pick = (/** @type {unknown} */ v) => (v === undefined || v === null || v === '' ? null : v);
  const gender = pick(raw.gender);
  const ageRange = pick(raw.ageRange);
  const nationality = pick(raw.nationality);
  if (gender !== null && !GENDERS.some((g) => g.value === gender)) errors.gender = 'Elige una opción de la lista.';
  if (ageRange !== null && !AGE_RANGES.some((a) => a.value === ageRange)) errors.ageRange = 'Elige una opción de la lista.';
  if (nationality !== null && !(typeof nationality === 'string' && COUNTRY_CODES.includes(nationality))) errors.nationality = 'Elige un país de la lista.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      gender: /** @type {Gender | null} */ (gender),
      ageRange: /** @type {AgeRange | null} */ (ageRange),
      nationality: /** @type {string | null} */ (nationality),
    },
  };
}

/** «De 25 a 34 años», «Menos de 18 años», «65 años o más». @param {AgeRange | null} range */
function ageText(range) {
  if (range === null) return undefined;
  if (range === 'under_18') return 'Menos de 18 años';
  if (range === '65_plus') return '65 años o más';
  return `De ${range.replace('_', ' a ')} años`;
}

/** «Hombre · De 25 a 34 años · República Dominicana», o «Prefieres no decirlo». @param {AboutYou} about */
export function aboutYouSummary(about) {
  const parts = [
    GENDERS.find((g) => g.value === about.gender)?.label,
    ageText(about.ageRange),
    about.nationality ? countryName(about.nationality) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Prefieres no decirlo';
}
