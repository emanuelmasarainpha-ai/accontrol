// @ts-check
// =============================================================================
// DATOS DE LA ORGANIZACIÓN
// -----------------------------------------------------------------------------
// Los espacios Freelancer, Emprendedor y Empresa pueden guardar quién es el negocio:
// nombre legal, RNC o cédula, actividad, contacto y dirección. Son datos que escribe
// la persona y la app NO verifica (no consulta ningún registro oficial): por eso
// solo se revisa que el formato sea razonable, nunca que «exista» el RNC.
//
// Se muestran en Ajustes y en la cabecera de los reportes exportados, para que un PDF
// o un Excel del negocio diga de quién es.
// =============================================================================

import { EMAIL_ERROR, PHONE_ERROR, cleanText, isValidEmail, isValidPhone } from './contact.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Organization} Organization */
/** @typedef {import('./types.js').WorkspaceKind} WorkspaceKind */

/**
 * Los campos, descritos como datos: la pantalla se dibuja a partir de esta lista.
 * @type {readonly { key: keyof Organization, label: string, hint: string, max: number, type: 'text' | 'email' | 'tel', autocomplete: string, placeholder: string }[]}
 */
export const ORGANIZATION_FIELDS = [
  { key: 'legalName', label: 'Nombre legal o razón social', hint: 'Tal como aparece en tus documentos.', max: LIMITS.orgLegalName, type: 'text', autocomplete: 'organization', placeholder: '' },
  { key: 'taxId', label: 'RNC o cédula', hint: 'Opcional. Solo letras, números y guiones. La app no la verifica con ningún registro oficial.', max: LIMITS.orgTaxId, type: 'text', autocomplete: 'off', placeholder: '' },
  { key: 'activity', label: 'Actividad o sector', hint: 'Por ejemplo: diseño gráfico, venta de ropa, consultoría.', max: LIMITS.orgActivity, type: 'text', autocomplete: 'off', placeholder: '' },
  { key: 'email', label: 'Correo de contacto', hint: '', max: LIMITS.orgEmail, type: 'email', autocomplete: 'email', placeholder: '' },
  { key: 'phone', label: 'Teléfono de contacto', hint: '', max: LIMITS.orgPhone, type: 'tel', autocomplete: 'tel', placeholder: '' },
  { key: 'address', label: 'Dirección o ciudad', hint: '', max: LIMITS.orgAddress, type: 'text', autocomplete: 'street-address', placeholder: '' },
];

/** Título del panel según la modalidad. @type {Record<WorkspaceKind, string>} */
const TITLES = {
  personal: 'Datos personales',
  freelancer: 'Datos profesionales',
  entrepreneur: 'Datos del negocio',
  company: 'Datos de la organización',
};

/** @param {WorkspaceKind} kind */
export function organizationTitle(kind) {
  return TITLES[kind];
}

/** Solo los espacios que no son Personal llevan datos de organización. @param {WorkspaceKind} kind */
export function kindHasOrganization(kind) {
  return kind !== 'personal';
}

/** @returns {Organization} */
export function emptyOrganization() {
  return { legalName: '', taxId: '', activity: '', email: '', phone: '', address: '' };
}

const clean = cleanText;

/**
 * Deja un objeto con exactamente los seis campos de texto (lo que falte queda vacío). No valida.
 * @param {unknown} raw
 * @returns {Organization}
 */
export function normalizeOrganization(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const org = emptyOrganization();
  for (const { key } of ORGANIZATION_FIELDS) org[key] = clean(source[key]);
  org.taxId = org.taxId.replace(/\s+/g, '').toUpperCase();
  return org;
}

/** @param {Organization | undefined | null} org */
export function isOrganizationEmpty(org) {
  return !org || ORGANIZATION_FIELDS.every(({ key }) => clean(org[key]) === '');
}

/**
 * Revisa y limpia lo que escribió la persona. Todos los campos son opcionales; los que se llenan deben
 * tener un formato razonable. Devuelve un mensaje por cada campo con problema.
 * @param {unknown} raw
 * @returns {{ ok: true, organization: Organization } | { ok: false, errors: Partial<Record<keyof Organization, string>> }}
 */
export function validateOrganization(raw) {
  const org = normalizeOrganization(raw);
  /** @type {Partial<Record<keyof Organization, string>>} */
  const errors = {};

  for (const { key, label, max } of ORGANIZATION_FIELDS) {
    if (org[key].length > max) errors[key] = `${label}: máximo ${max} caracteres.`;
  }
  if (!errors.taxId && org.taxId && !/^[A-Z0-9-]{3,20}$/.test(org.taxId)) {
    errors.taxId = 'Usa solo letras, números y guiones (de 3 a 20 caracteres).';
  }
  if (!errors.email && org.email && !isValidEmail(org.email)) errors.email = EMAIL_ERROR;
  if (!errors.phone && org.phone && !isValidPhone(org.phone)) errors.phone = PHONE_ERROR;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, organization: org };
}

/**
 * Líneas de texto para la cabecera de un reporte. Solo lo que esté lleno; vacío si no hay nada.
 * @param {Organization | undefined | null} org
 * @returns {string[]}
 */
export function organizationLines(org) {
  if (!org) return [];
  const o = normalizeOrganization(org);
  /** @type {string[]} */
  const lines = [];
  const identity = [o.legalName, o.taxId ? `RNC/cédula: ${o.taxId}` : ''].filter(Boolean).join(' · ');
  if (identity) lines.push(identity);
  if (o.activity) lines.push(`Actividad: ${o.activity}`);
  const contact = [o.email, o.phone, o.address].filter(Boolean).join(' · ');
  if (contact) lines.push(`Contacto: ${contact}`);
  return lines;
}
