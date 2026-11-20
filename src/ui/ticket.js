// @ts-check
// =============================================================================
// IMPRIMIR EL TICKET (0.17.2)
// Arma el ticket (domain/ticket.js) en un bloque propio y abre la ventana de imprimir del navegador. Mientras se imprime,
// la página marca <html data-print="ticket"> y los estilos de impresión (views.css) esconden todo lo demás y usan papel de
// 80 mm. Sin impresora, en esa misma ventana se elige «Guardar como PDF».
// En la app de Android (0.18.0) no hay ventana de imprimir: el ticket sale como PDF de 80 mm (export/ticketPdf.js) y se
// abre «Compartir» para mandarlo a la app de la impresora, a WhatsApp o a Drive.
// La gaveta de dinero se abre sola con muchas impresoras al imprimir (se configura en el controlador de la impresora).
// =============================================================================

import { isNativeApp } from '../app/platform.js';
import { buildTicket, TICKET_PAPER_MM } from '../domain/ticket.js';
import { buildTicketPdf, ticketFileName } from '../export/ticketPdf.js';
import { saveFile } from './saveFile.js';
import { html, setHtml } from './html.js';
import { toast } from './toast.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */
/** @typedef {import('../domain/ticket.js').Ticket} Ticket */

/** @param {Ticket} t */
export function ticketHtml(t) {
  return html`<div class="ticket">
    <p class="ticket__business">${t.business}</p>
    ${t.details.map((d) => html`<p class="ticket__small ticket__center">${d}</p>`)}
    <p class="ticket__title">${t.title}${t.isDemo ? ' (DEMO)' : ''}</p>
    ${t.isVoid ? html`<p class="ticket__title">*** ANULADA ***</p>` : ''}
    <p class="ticket__row"><span>${t.number}</span><span>${t.when}</span></p>
    <p class="ticket__small">Cliente: ${t.customer}</p>
    <hr class="ticket__rule" />
    ${t.lines.map((l) => html`<div class="ticket__line">
      <p class="ticket__name">${l.name}</p>
      <p class="ticket__row"><span>${l.quantity} × ${l.unit}</span><span>${l.total}</span></p>
    </div>`)}
    <hr class="ticket__rule" />
    <p class="ticket__row"><span>Subtotal</span><span>${t.subtotal}</span></p>
    ${t.tax ? html`<p class="ticket__row"><span>${t.tax.label}</span><span>${t.tax.amount}</span></p>` : ''}
    <p class="ticket__row ticket__total"><span>TOTAL</span><span>${t.total}</span></p>
    ${t.payments.map((p) => html`<p class="ticket__row"><span>Pagado</span><span>${p.amount}</span></p><p class="ticket__small">${p.label}</p>`)}
    ${t.pending ? html`<p class="ticket__row ticket__total"><span>PENDIENTE</span><span>${t.pending}</span></p>` : ''}
    <hr class="ticket__rule" />
    <p class="ticket__small ticket__center">${t.footer}</p>
    <p class="ticket__center">¡Gracias por su compra!</p>
  </div>`;
}

/**
 * Imprime el ticket de una factura.
 * @param {Store} store @param {string} invoiceId
 */
export function printTicket(store, invoiceId) {
  const { data } = store.getState();
  const invoice = data.invoices.find((i) => i.id === invoiceId);
  if (!invoice) { toast('Esa factura ya no existe.', 'error'); return; }
  const workspace = store.activeWorkspace();
  const ticket = buildTicket(invoice, data.invoicePayments, { workspaceName: workspace?.name ?? '', organization: workspace?.organization ?? null, today: store.today() });
  if (isNativeApp()) {
    const file = { filename: ticketFileName(ticket), mime: 'application/pdf', bytes: buildTicketPdf(ticket, { generatedAt: store.now() }) };
    void saveFile(file, { dialogTitle: 'Imprimir o enviar el ticket' });
    return;
  }
  document.getElementById('ticket-print')?.remove();
  const box = document.createElement('div');
  box.id = 'ticket-print';
  box.className = 'ticket-print';
  setHtml(box, ticketHtml(ticket));
  document.body.append(box);
  // El papel: 80 mm de ancho y el largo justo del ticket (así la impresora no gasta papel de más y el PDF sale del tamaño
  // del ticket). Se mide el ticket fuera de la vista y se pone el tamaño con una hoja de estilos construida (la política de
  // seguridad no deja crear etiquetas de estilo, pero sí esta forma).
  box.classList.add('ticket-print--measure');
  const heightMm = Math.ceil((box.getBoundingClientRect().height * 25.4) / 96) + 14;
  box.classList.remove('ticket-print--measure');
  /** @type {CSSStyleSheet | null} */
  let pageSheet = null;
  try {
    pageSheet = new CSSStyleSheet();
    pageSheet.replaceSync(`@page { size: ${TICKET_PAPER_MM}mm ${Math.max(heightMm, 60)}mm; margin: 4mm 4mm 6mm; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
  } catch {
    pageSheet = null; // navegador viejo: se imprime con el papel que diga la impresora
  }
  const root = document.documentElement;
  root.dataset.print = 'ticket';
  const done = () => {
    delete root.dataset.print;
    box.remove();
    if (pageSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== pageSheet);
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  try {
    window.print();
  } catch {
    done();
    toast('Este navegador no deja imprimir desde aquí.', 'error');
  }
}
