// 0.18.0 — Descargas e impresión dentro de la app de Android (Filesystem + Share) y ticket en PDF de 80 mm.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bytesToBase64, isShareCancel, safeFileName, shareFileNative } from '../src/app/nativeFiles.js';
import { buildTicketPdf, ticketFileName, TICKET_PDF_WIDTH } from '../src/export/ticketPdf.js';

/** Un «Capacitor» de prueba que anota cada llamada. */
function fakeCap({ shareError = null, uri = 'file:///data/user/0/com.accontrol.app/cache/compartir/x' } = {}) {
  const calls = [];
  return {
    calls,
    async nativePromise(plugin, method, options) {
      calls.push({ plugin, method, options });
      if (plugin === 'Filesystem' && method === 'writeFile') return { uri };
      if (plugin === 'Share' && shareError) throw shareError;
      return {};
    },
  };
}
const file = { filename: 'copia.json', mime: 'application/json', bytes: new TextEncoder().encode('{"a":1}') };

describe('archivos en la app de Android', () => {
  it('base64 exacto, también con archivos grandes', () => {
    assert.equal(bytesToBase64(new TextEncoder().encode('ACCONTROL ñ')), Buffer.from('ACCONTROL ñ').toString('base64'));
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    assert.equal(bytesToBase64(big), Buffer.from(big).toString('base64'));
  });
  it('el nombre nunca sale de la carpeta «compartir»', () => {
    assert.equal(safeFileName('../../etc/passwd'), '-..-etc-passwd');
    assert.equal(safeFileName(['a', 'b:c.pdf'].join(String.fromCharCode(92))), 'a-b-c.pdf');
    assert.equal(safeFileName('...'), 'archivo');
    assert.equal(safeFileName('reporte 2026.pdf'), 'reporte 2026.pdf');
  });
  it('vacía la carpeta, escribe en la caché privada y abre Compartir', async () => {
    const cap = fakeCap();
    assert.equal(await shareFileNative(cap, file, 'Guardar'), 'shared');
    assert.deepEqual(cap.calls.map((c) => `${c.plugin}.${c.method}`), ['Filesystem.rmdir', 'Filesystem.writeFile', 'Share.share']);
    const write = cap.calls[1].options;
    assert.equal(write.directory, 'CACHE');
    assert.equal(write.path, 'compartir/copia.json');
    assert.equal(Buffer.from(write.data, 'base64').toString(), '{"a":1}');
    assert.deepEqual(cap.calls[2].options.files, ['file:///data/user/0/com.accontrol.app/cache/compartir/x']);
  });
  it('cerrar Compartir no es un error; otro fallo sí', async () => {
    assert.equal(await shareFileNative(fakeCap({ shareError: new Error('Share canceled') }), file), 'cancelled');
    await assert.rejects(shareFileNative(fakeCap({ shareError: new Error('boom') }), file), /boom/);
    assert.equal(isShareCancel(new Error('User cancelled')), true);
    assert.equal(isShareCancel(new Error('boom')), false);
  });
  it('si no se pudo escribir, no se comparte nada', async () => {
    const cap = fakeCap({ uri: '' });
    await assert.rejects(shareFileNative(cap, file), /No se pudo guardar/);
    assert.equal(cap.calls.some((c) => c.plugin === 'Share'), false);
  });
  it('Android solo deja compartir la carpeta «compartir» de la caché', () => {
    const paths = readFileSync(new URL('../android/app/src/main/res/xml/file_paths.xml', import.meta.url), 'utf8');
    assert.match(paths, /<cache-path name="compartir" path="compartir\/" \/>/);
    assert.doesNotMatch(paths, /external-path|root-path|files-path/);
  });
});

describe('ticket en PDF de 80 mm', () => {
  const ticket = {
    business: 'Colmado La Esquina', details: ['RNC 101-00000-1', 'Tel. 809-555-0000'], title: 'Ticket de venta',
    number: 'F-0007', when: '20 nov 2026 · 10:15', customer: 'Consumidor final',
    lines: [{ quantity: 2, name: 'Pan de agua con un nombre muy largo que se parte en varias líneas', unit: 'RD$7.50', total: 'RD$15.00' }],
    subtotal: 'RD$15.00', tax: { label: 'ITBIS 18 %', amount: 'RD$2.70' }, total: 'RD$17.70',
    payments: [{ label: 'Efectivo · recibido RD$20.00 · devuelta RD$2.30', amount: 'RD$17.70' }],
    pending: null, isVoid: false, isDemo: false, footer: 'Documento interno de control. No es un comprobante fiscal.',
  };
  const pdf = new TextDecoder('latin1').decode(buildTicketPdf(ticket, { generatedAt: new Date('2026-11-20T10:15:00Z') }));
  const box = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf);

  it('es un PDF de una página de 80 mm de ancho', () => {
    assert.ok(pdf.startsWith('%PDF-1.4'));
    assert.ok(pdf.trimEnd().endsWith('%%EOF'));
    assert.equal(Number(box?.[1]).toFixed(2), (80 * 72 / 25.4).toFixed(2));
    assert.equal(Number(box?.[1]), TICKET_PDF_WIDTH);
    assert.match(pdf, /\/Count 1 /);
  });
  it('el largo crece con el contenido (al menos 60 mm)', () => {
    const many = { ...ticket, lines: Array.from({ length: 40 }, () => ticket.lines[0]) };
    const longPdf = new TextDecoder('latin1').decode(buildTicketPdf(many));
    const h = Number(/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/.exec(longPdf)?.[1]);
    assert.ok(h > Number(box?.[2]));
    assert.ok(Number(box?.[2]) >= 60 * 72 / 25.4 - 0.01);
  });
  it('lleva el total, el negocio y el aviso de que no es fiscal', () => {
    const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
    assert.ok(pdf.includes(hex('RD$17.70')));
    assert.ok(pdf.includes(hex('Colmado La Esquina')));
    assert.ok(pdf.includes(hex('No es un comprobante fiscal.')) || pdf.includes(hex('comprobante fiscal.')));
  });
  it('los datos DEMO y las anuladas se notan', () => {
    const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
    const demo = new TextDecoder('latin1').decode(buildTicketPdf({ ...ticket, isDemo: true, isVoid: true, number: 'DEMO-001' }));
    assert.ok(demo.includes(hex('Ticket de venta (DEMO)')));
    assert.ok(demo.includes(hex('*** ANULADA ***')));
  });
  it('nombre del archivo seguro', () => {
    assert.equal(ticketFileName(ticket), 'ticket-F-0007.pdf');
    assert.equal(ticketFileName({ ...ticket, number: 'DEMO/001' }), 'ticket-DEMO-001.pdf');
  });
});
