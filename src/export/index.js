// @ts-check
// =============================================================================
// EXPORTAR (documento maestro §6): PDF, Excel y CSV
// -----------------------------------------------------------------------------
// `makeFile` convierte un reporte al formato elegido (puro, se prueba solo).
// `downloadFile` entrega el archivo al navegador. Todo ocurre en tu dispositivo:
// ningún dato sale a internet.
// =============================================================================

import { reportToCsv } from './csv.js';
import { buildPdf } from './pdf.js';
import { reportToXlsx } from './xlsx.js';

/** @typedef {import('./model.js').Report} Report */
/** @typedef {'pdf' | 'xlsx' | 'csv'} ExportFormat */

export const FORMAT_INFO = /** @type {const} */ ({
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  xlsx: { label: 'Excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { label: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8' },
});

/** @param {string} value @returns {value is ExportFormat} */
export const isExportFormat = (value) => value === 'pdf' || value === 'xlsx' || value === 'csv';

/**
 * @param {Report} report @param {ExportFormat} format @param {Date} now
 * @returns {{ filename: string, mime: string, bytes: Uint8Array }}
 */
export function makeFile(report, format, now) {
  const info = FORMAT_INFO[format];
  const filename = `${report.fileBase}.${info.ext}`;
  if (format === 'csv') return { filename, mime: info.mime, bytes: new TextEncoder().encode(reportToCsv(report)) };
  if (format === 'xlsx') return { filename, mime: info.mime, bytes: reportToXlsx(report) };
  return { filename, mime: info.mime, bytes: buildPdf(report, { generatedAt: now }) };
}

/** Entrega el archivo al navegador como una descarga. @param {{ filename: string, mime: string, bytes: Uint8Array }} file */
export function downloadFile({ filename, mime, bytes }) {
  const blob = new Blob([/** @type {BlobPart} */ (bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Se libera un poco después: algunos navegadores móviles necesitan el enlace vivo un instante.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
