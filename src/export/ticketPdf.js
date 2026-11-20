// @ts-check
// =============================================================================
// TICKET EN PDF DE 80 mm (0.18.0)
// -----------------------------------------------------------------------------
// En la app de Android no existe la ventana de imprimir del navegador. Allí el ticket se entrega como un PDF del ancho del
// papel de las impresoras de tickets (80 mm) y del largo justo de su contenido; la persona lo envía con «Compartir» a la app
// de su impresora, a WhatsApp o a Drive. Lleva lo mismo que el ticket de la pantalla (domain/ticket.js), sin nada aparte.
// =============================================================================

import { TICKET_PAPER_MM } from '../domain/ticket.js';
import { assemble, Page, textWidth, wrapText } from './pdf.js';

/** @typedef {import('../domain/ticket.js').Ticket} Ticket */
/** @typedef {[number, number, number]} Color */

const MM = 72 / 25.4;
export const TICKET_PDF_WIDTH = TICKET_PAPER_MM * MM;
const SIDE = 4 * MM;
const TOP = 4 * MM;
const BOTTOM = 6 * MM;
const CONTENT = TICKET_PDF_WIDTH - SIDE * 2;
/** @type {Color} */ const BLACK = [0, 0, 0];
const SMALL = 7.5;
const BODY = 8.5;
const BIG = 11;

/**
 * @param {Ticket} t
 * @param {{ generatedAt?: Date }} [options]
 * @returns {Uint8Array}
 */
export function buildTicketPdf(t, { generatedAt = new Date() } = {}) {
  /** @type {((page: Page) => void)[]} */
  const draws = [];
  let y = TOP;

  /** @param {string} text @param {number} size @param {boolean} bold */
  const centered = (text, size, bold) => {
    for (const line of wrapText(text, CONTENT, size, bold)) {
      const at = y + size;
      draws.push((p) => p.text(SIDE + (CONTENT - textWidth(line, size, bold)) / 2, at, line, size, bold, BLACK));
      y += size * 1.35;
    }
  };
  /** @param {string} text @param {number} size @param {boolean} bold */
  const left = (text, size, bold) => {
    for (const line of wrapText(text, CONTENT, size, bold)) {
      const at = y + size;
      draws.push((p) => p.text(SIDE, at, line, size, bold, BLACK));
      y += size * 1.35;
    }
  };
  /** Texto a la izquierda y monto a la derecha, en la misma línea. @param {string} a @param {string} b @param {number} size @param {boolean} bold */
  const row = (a, b, size, bold) => {
    const right = textWidth(b, size, bold);
    const lines = wrapText(a, Math.max(CONTENT - right - 6, 20), size, bold);
    const at = y + size;
    draws.push((p) => p.text(SIDE + CONTENT - right, at, b, size, bold, BLACK));
    for (const line of lines) {
      const lineAt = y + size;
      draws.push((p) => p.text(SIDE, lineAt, line, size, bold, BLACK));
      y += size * 1.35;
    }
  };
  const rule = () => {
    const at = y + 3;
    draws.push((p) => p.hline(SIDE, SIDE + CONTENT, at, BLACK, 0.6));
    y += 7;
  };

  centered(t.business, BIG, true);
  for (const d of t.details) centered(d, SMALL, false);
  y += 2;
  centered(`${t.title}${t.isDemo ? ' (DEMO)' : ''}`, BODY, true);
  if (t.isVoid) centered('*** ANULADA ***', BODY, true);
  row(t.number, t.when, BODY, false);
  left(`Cliente: ${t.customer}`, SMALL, false);
  rule();
  for (const l of t.lines) {
    left(l.name, BODY, false);
    row(`${l.quantity} × ${l.unit}`, l.total, BODY, false);
  }
  rule();
  row('Subtotal', t.subtotal, BODY, false);
  if (t.tax) row(t.tax.label, t.tax.amount, BODY, false);
  row('TOTAL', t.total, BIG, true);
  for (const pay of t.payments) {
    row('Pagado', pay.amount, BODY, false);
    left(pay.label, SMALL, false);
  }
  if (t.pending) row('PENDIENTE', t.pending, BODY, true);
  rule();
  centered(t.footer, SMALL, false);
  centered('¡Gracias por su compra!', BODY, false);

  const pageH = Math.max(y + BOTTOM, 60 * MM);
  const page = new Page(pageH);
  for (const draw of draws) draw(page);
  return assemble([page], `${t.title} ${t.number}`, generatedAt, { pageW: TICKET_PDF_WIDTH, pageH, contentW: CONTENT, bottom: pageH - BOTTOM });
}

/** Nombre del archivo del ticket, sin caracteres que un sistema de archivos no acepte. @param {Ticket} t */
export function ticketFileName(t) {
  return `ticket-${t.number}`.replace(/[^\p{L}\p{N}._-]+/gu, '-') + '.pdf';
}
