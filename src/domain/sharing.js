// @ts-check
// =============================================================================
// COMPARTIR UN ESPACIO: quién puede invitar, cambiar roles, quitar o anular (0.16.0)
// -----------------------------------------------------------------------------
// Son las MISMAS reglas que aplican las funciones de la nube (migración 20261117000100_invites). Aquí solo deciden qué
// botones se muestran; aunque la pantalla se equivocara, la nube lo rechazaría.
// =============================================================================

import { ROLE_NAMES, roleOf } from './roles.js';

/** @typedef {import('./types.js').Workspace} Workspace */
/** @typedef {import('./types.js').WorkspaceRole} WorkspaceRole */
/** @typedef {'admin' | 'accountant'} InviteRole */

/** Letras del código: sin 0/O ni 1/I/L, para que no se confundan al dictarlo. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** ¿Se puede compartir este espacio? El Personal, nunca. @param {Workspace | null | undefined} w */
export const isShareable = (w) => Boolean(w) && w?.kind !== 'personal';

/**
 * Qué roles puedes dar al invitar: el Dueño, Administrador o Contador; el Administrador, solo Contador.
 * @param {Workspace | null | undefined} w @returns {InviteRole[]}
 */
export function invitableRoles(w) {
  if (!isShareable(w)) return [];
  const role = roleOf(w);
  if (role === 'owner') return ['admin', 'accountant'];
  if (role === 'admin') return ['accountant'];
  return [];
}

/**
 * Qué puedes hacer con un miembro de la lista.
 * @param {WorkspaceRole} myRole @param {{ role: WorkspaceRole, isMe: boolean }} member
 */
export function memberActions(myRole, member) {
  const other = !member.isMe && member.role !== 'owner';
  return {
    changeRole: other && myRole === 'owner',
    remove: other && (myRole === 'owner' || (myRole === 'admin' && member.role === 'accountant')),
  };
}

/** ¿Puedes anular esta invitación? (las de un rol a medida, solo el dueño) @param {WorkspaceRole} myRole @param {{ role: string }} invite */
export const canRevoke = (myRole, invite) => myRole === 'owner' || (myRole === 'admin' && invite.role === 'accountant');

/** Qué puede hacer cada rol, en una frase (para elegir al invitar). */
export const ROLE_HELP = Object.freeze({
  admin: 'Registra y edita todos los datos e invita contadores. No cambia el nombre ni el saldo inicial del espacio, ni lo borra.',
  accountant: 'Ve todo y descarga reportes. No registra ni cambia nada.',
});

/**
 * Deja un código como lo escribe la nube (XXXX-XXXX-XXXX), o null si no puede ser un código válido.
 * Acepta minúsculas, espacios y guiones de más (como llegue pegado de WhatsApp).
 * @param {string} text @returns {string | null}
 */
export function normalizeInviteCode(text) {
  const plain = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plain.length !== 12 || [...plain].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${plain.slice(0, 4)}-${plain.slice(4, 8)}-${plain.slice(8, 12)}`;
}

/**
 * El mensaje que la persona copia y envía ella misma (ACCONTROL no envía mensajes).
 * @param {{ workspaceName: string, code: string, role: InviteRole | 'custom', roleName?: string, expires: string }} input  `expires`: fecha ya escrita para
 *   leer; `roleName`: el nombre de un rol a medida («Cajero»).
 */
export function inviteMessage({ workspaceName, code, role, roleName, expires }) {
  return [
    `Te invito a «${workspaceName}» en ACCONTROL como ${roleName ?? ROLE_NAMES[role]}.`,
    '',
    `1. Entra en ACCONTROL con tu cuenta y activa la copia en la nube (Ajustes → Copia en la nube).`,
    `2. En Ajustes → Espacios de trabajo, pulsa «Unirme con un código» y escribe:`,
    '',
    code,
    '',
    `El código sirve una sola vez y vence el ${expires}. No lo compartas con nadie más.`,
  ].join('\n');
}
