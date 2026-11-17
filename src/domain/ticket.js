// @ts-check
// =============================================================================
// TICKET DE VENTA (0.17.2)
// -----------------------------------------------------------------------------
// Lo que lleva el ticket que se imprime en una impresora de tickets de 80 mm (o se guarda en PDF desde la ventana de
// imprimir): el negocio, el número y la fecha, cada producto (cantidad × precio), los totales con el ITBIS, cómo se pagó y,
// si es fiado, lo que queda pendiente. Sale SIEMPRE de la factura y de sus cobros: no se guarda nada aparte.
// Es un documento INTERNO: no es un comprobante fiscal (lo dice al pie).
// =============================================================================

import { formatDate } from './dates.js';
import { formatTaxPercent, invoiceLabel, invoicePosition, lineTotalCents } from './invoices.js';
import { formatMoney } from './money.js';

/** @typedef {import('./types.js').Invoice} Invoice */
/** @typedef {import('./types.js').InvoicePayment} InvoicePayment */
/** @typedef {import('./types.js').Organization} Organization */

/** Ancho de papel para el que se arma el ticket. */
export const TICKET_PAPER_MM = 80;
export const TICKET_FOOTER = 'Documento interno de control. No es un comprobante fiscal.';

/**
 * @typedef {Object} Ticket
 * @property {string} business            Nombre del negocio (razón social o nombre del espacio).
 * @property {string[]} details           RNC, teléfono y dirección, los que haya.
 * @property {string} title               «Ticket de venta» o «Ticket de fiado».
 * @property {string} number              F-0001 (o DEMO-001).
 * @property {string} when                «16 nov 2026 · 15:30».
 * @property {string} customer
 * @property {{ quantity: number, name: string, unit: string, total: string }[]} lines
 * @property {string} subtotal
 * @property {{ label: string, amount: string } | null} tax
 * @property {string} total
 * @property {{ label: string, amount: string }[]} payments  Cada cobro con su nota (por ejemplo «Efectivo · recibido … · devuelta …»).
 * @property {string | null} pending        Lo que queda por pagar (fiado o cobro parcial), o null.
 * @property {boolean} isVoid
 * @property {boolean} isDemo
 * @property {string} footer
 */

/**
 * Arma el ticket de una factura.
 * @param {Invoice} invoice @param {InvoicePayment[]} allPayments
 * @param {{ workspaceName: string, organization?: Organization | null, today: string }} context
 * @returns {Ticket}
 */
export function buildTicket(invoice, allPayments, { workspaceName, organization = null, today }) {
  const p = invoicePosition(invoice, allPayments, today);
  const details = [
    organization?.taxId ? `RNC ${organization.taxId}` : '',
    organization?.phone ? `Tel. ${organization.phone}` : '',
    organization?.address ?? '',
  ].filter(Boolean);
  const time = p.payments[0]?.time ?? '';
  const isCredit = p.payments.length === 0 && p.balanceCents > 0;
  return {
    business: organization?.legalName || workspaceName || 'Mi negocio',
    details,
    title: isCredit ? 'Ticket de fiado' : 'Ticket de venta',
    number: invoiceLabel(invoice),
    when: time ? `${formatDate(invoice.issueDate)} · ${time}` : formatDate(invoice.issueDate),
    customer: invoice.customerName,
    lines: invoice.lines.map((l) => ({ quantity: l.quantity, name: l.description, unit: formatMoney(l.unitCents), total: formatMoney(lineTotalCents(l)) })),
    subtotal: formatMoney(p.subtotalCents),
    tax: invoice.taxRateBp > 0 ? { label: `ITBIS ${formatTaxPercent(invoice.taxRateBp)} %`, amount: formatMoney(p.taxCents) } : null,
    total: formatMoney(p.totalCents),
    payments: p.payments.map((x) => ({ label: x.note || 'Cobro', amount: formatMoney(x.amountCents) })),
    pending: p.balanceCents > 0 ? formatMoney(p.balanceCents) : null,
    isVoid: p.status === 'void',
    isDemo: invoice.isDemo === true,
    footer: TICKET_FOOTER,
  };
}
