// @ts-check
// =============================================================================
// PDF
// -----------------------------------------------------------------------------
// Escritor de PDF a mano (sin librerías): páginas A4 (vertical; horizontal si una tabla es muy ancha), texto en Helvetica (una de
// las 14 fuentes que todo lector de PDF ya trae, por eso no se incrusta) y tablas
// que se parten en varias páginas repitiendo el encabezado.
//
// Todos los textos se escriben en hexadecimal, así que ningún carácter del usuario
// ((, ), \ ...) puede romper el archivo. Las letras con tilde y la ñ salen bien
// (codificación WinAnsi). Lo que WinAnsi no tiene (emojis, otros alfabetos) se
// muestra como "?".
// =============================================================================

import { cellText, isNumericCell } from './model.js';
import { HELVETICA, HELVETICA_BOLD, WINANSI_EXTRA } from './pdf-metrics.js';

/** @typedef {import('./model.js').Report} Report */
/** @typedef {import('./model.js').Cell} Cell */

const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const MARGIN = 40;
const FOOTER_H = 30;

/**
 * Medidas de la página. Una tabla muy ancha pasa todo el documento a hoja horizontal.
 * @typedef {Object} Geometry
 * @property {number} pageW
 * @property {number} pageH
 * @property {number} contentW
 * @property {number} bottom
 */

/** @param {boolean} landscape @returns {Geometry} */
function geometry(landscape) {
  const pageW = landscape ? A4_LONG : A4_SHORT;
  const pageH = landscape ? A4_SHORT : A4_LONG;
  return { pageW, pageH, contentW: pageW - MARGIN * 2, bottom: pageH - MARGIN - FOOTER_H };
}

/** @typedef {[number, number, number]} Color */
/** @type {Color} */ const NAVY = [0.082, 0.2, 0.361];
/** @type {Color} */ const INK = [0.08, 0.1, 0.16];
/** @type {Color} */ const MUTED = [0.32, 0.36, 0.44];
/** @type {Color} */ const WHITE = [1, 1, 1];
/** @type {Color} */ const STRIPE = [0.955, 0.965, 0.98];
/** @type {Color} */ const RULE = [0.84, 0.86, 0.9];
/** @type {Color} */ const NOTE_BG = [0.925, 0.945, 0.98];

// ---------------------------------------------------------------------------
// Texto: codificación y medidas
// ---------------------------------------------------------------------------

/** Byte WinAnsi de un carácter (63 = "?" si no existe). @param {string} ch */
export function winAnsiCode(ch) {
  const cp = ch.codePointAt(0) ?? 63;
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 160 && cp <= 255) return cp;
  if (cp === 0x2212) return 45; // signo menos "−" -> guion
  return WINANSI_EXTRA[/** @type {keyof typeof WINANSI_EXTRA} */ (cp)] ?? 63;
}

/** @param {string} text @returns {number[]} */
function toBytes(text) {
  return [...text.replace(/[\r\n\t]+/g, ' ')].map(winAnsiCode);
}

/** @param {number} code @param {boolean} bold */
function charWidth(code, bold) {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  return table[code - 32] ?? 556;
}

/** Ancho del texto en puntos. @param {string} text @param {number} size @param {boolean} [bold] */
export function textWidth(text, size, bold = false) {
  let total = 0;
  for (const code of toBytes(text)) total += charWidth(code, bold);
  return (total * size) / 1000;
}

/**
 * Parte un texto en líneas que quepan en `maxWidth` (parte palabras demasiado largas).
 * @param {string} text @param {number} maxWidth @param {number} size @param {boolean} [bold]
 * @returns {string[]}
 */
export function wrapText(text, maxWidth, size, bold = false) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return [''];
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of clean.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    let rest = word;
    while (textWidth(rest, size, bold) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// Páginas y dibujo
// ---------------------------------------------------------------------------

/** @param {number} x */
const num = (x) => (Math.round(x * 100) / 100).toString();
/** @param {Color} c */
const rgb = (c) => `${num(c[0])} ${num(c[1])} ${num(c[2])}`;
/** @param {number[]} bytes */
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

export class Page {
  /** @param {number} pageH */
  constructor(pageH) {
    this.pageH = pageH;
    /** @type {string[]} */
    this.ops = [];
  }

  /** @param {number} x @param {number} top Distancia desde arriba hasta la línea base. @param {string} text @param {number} size @param {boolean} bold @param {Color} color */
  text(x, top, text, size, bold, color) {
    if (text === '') return;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(x)} ${num(this.pageH - top)} Td <${hex(toBytes(text))}> Tj ET`);
  }

  /** @param {number} x @param {number} top @param {number} w @param {number} h @param {Color} color */
  rect(x, top, w, h, color) {
    this.ops.push(`${rgb(color)} rg ${num(x)} ${num(this.pageH - top - h)} ${num(w)} ${num(h)} re f`);
  }

  /** @param {number} x1 @param {number} x2 @param {number} top @param {Color} color @param {number} [width] */
  hline(x1, x2, top, color, width = 0.5) {
    this.ops.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(this.pageH - top)} m ${num(x2)} ${num(this.pageH - top)} l S`);
  }
}

class Layout {
  /** @param {Geometry} geom */
  constructor(geom) {
    this.geom = geom;
    /** @type {Page[]} */
    this.pages = [];
    this.top = MARGIN;
    this.page = this.addPage();
  }

  addPage() {
    const page = new Page(this.geom.pageH);
    this.pages.push(page);
    this.page = page;
    this.top = MARGIN;
    return page;
  }

  /** Si no cabe `height`, pasa a una página nueva. @param {number} height */
  ensure(height) {
    if (this.top + height > this.geom.bottom) {
      this.addPage();
      return true;
    }
    return false;
  }
}

/**
 * Medidas naturales de las columnas de una tabla:
 *  - natural: ancho para que cada celda quede en una sola línea;
 *  - floors: ancho mínimo sin partir ninguna palabra (los números, su ancho completo).
 * @param {string[]} headers @param {Cell[][]} rows @param {Cell[] | undefined} totals @param {number} size @param {number} pad
 */
function columnMetrics(headers, rows, totals, size, pad) {
  const all = totals ? [...rows, totals] : rows;
  const natural = headers.map((h, i) => {
    let w = textWidth(h, size, true);
    for (const row of all) w = Math.max(w, textWidth(cellText(row[i] ?? null), size, row === totals));
    return w + pad * 2 + 2;
  });
  const numeric = headers.map((_, i) => rows.some((r) => isNumericCell(r[i] ?? null)));
  const floors = headers.map((h, i) => {
    if (numeric[i]) return natural[i];
    let longest = 0;
    for (const word of h.split(/\s+/)) longest = Math.max(longest, textWidth(word, size, true));
    for (const row of all) {
      for (const word of cellText(row[i] ?? null).split(/\s+/)) longest = Math.max(longest, textWidth(word, size, row === totals));
    }
    // Una palabra extrema (una dirección larga, por ejemplo) no puede dictar el ancho de la columna: se corta.
    return Math.min(natural[i], Math.min(longest, MAX_WORD_FLOOR) + pad * 2 + 2);
  });
  return { natural, floors, numeric };
}

/** Tamaños de letra de las tablas, del más cómodo al más pequeño. */
const TABLE_SIZES = [8.5, 7.5, 6.8];
const TABLE_SIZE = TABLE_SIZES[0];
const TABLE_PAD = 5;
/** Ancho máximo (puntos) que una sola palabra puede exigirle a una columna (unos 20 caracteres). */
const MAX_WORD_FLOOR = 82;

/** ¿Alguna tabla necesitaría partir palabras en una hoja vertical? @param {Report} report */
function needsLandscape(report) {
  const portrait = geometry(false).contentW;
  for (const sheet of report.sheets) {
    for (const block of sheet.blocks) {
      if (block.type !== 'table') continue;
      const { floors } = columnMetrics(block.headers, block.rows, block.totals, TABLE_SIZE, TABLE_PAD);
      if (floors.reduce((a, b) => a + b, 0) > portrait + 0.5) return true;
    }
  }
  return false;
}

/**
 * Mayor tamaño de letra con el que la tabla cabe sin partir palabras ni montos.
 * @param {import('./model.js').TableBlock} block @param {number} contentW
 */
function fitTableSize(block, contentW) {
  for (const size of TABLE_SIZES) {
    const pad = size < TABLE_SIZE ? TABLE_PAD - 1 : TABLE_PAD;
    const { floors } = columnMetrics(block.headers, block.rows, block.totals, size, pad);
    if (floors.reduce((a, b) => a + b, 0) <= contentW + 0.5) return { size, pad };
  }
  const size = TABLE_SIZES[TABLE_SIZES.length - 1];
  return { size, pad: TABLE_PAD - 1 };
}

/**
 * Anchos de columna de una tabla para un ancho disponible.
 * @param {ReturnType<typeof columnMetrics>} metrics @param {number} contentW
 */
function columnWidths({ natural, floors, numeric }, contentW) {
  const sum = natural.reduce((a, b) => a + b, 0);

  if (sum <= contentW) {
    const extra = contentW - sum;
    // El sobrante se reparte entre las columnas de texto (o entre todas si no hay).
    const textCols = natural.map((_, i) => i).filter((i) => !numeric[i]);
    const targets = textCols.length > 0 ? textCols : natural.map((_, i) => i);
    const base = targets.reduce((s, i) => s + natural[i], 0);
    return natural.map((w, i) => (targets.includes(i) ? w + (extra * w) / base : w));
  }

  // No cabe: cada columna conserva su mínimo y el espacio que sobra se reparte en
  // proporción a lo que a cada una le falta para quedar en una sola línea.
  const floorSum = floors.reduce((a, b) => a + b, 0);
  if (floorSum >= contentW) return floors.map((w) => (w * contentW) / floorSum);
  const wants = natural.map((w, i) => w - floors[i]);
  const wantSum = wants.reduce((a, b) => a + b, 0);
  const room = contentW - floorSum;
  return floors.map((w, i) => w + (wantSum > 0 ? (room * wants[i]) / wantSum : 0));
}

/**
 * @param {Layout} doc @param {import('./model.js').TableBlock} block
 */
function drawTable(doc, block) {
  if (block.rows.length === 0 && !block.totals) {
    doc.ensure(24);
    doc.page.text(MARGIN + 4, doc.top + 10, 'No hay registros.', 9, false, MUTED);
    doc.top += 26;
    return;
  }
  const CONTENT_W = doc.geom.contentW;
  const { size, pad } = fitTableSize(block, CONTENT_W);
  const lineH = size * 1.3;
  const vpad = 4;
  const widths = columnWidths(columnMetrics(block.headers, block.rows, block.totals, size, pad), CONTENT_W);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const numeric = block.headers.map((_, i) => block.rows.some((r) => isNumericCell(r[i] ?? null)));

  /** @param {Cell} cell @param {number} i @param {boolean} bold */
  const linesOf = (cell, i, bold) => wrapText(cellText(cell), widths[i] - pad * 2, size, bold);

  const drawHeader = () => {
    const headLines = block.headers.map((h, i) => wrapText(h, widths[i] - pad * 2, size, true));
    const h = Math.max(...headLines.map((l) => l.length)) * lineH + vpad * 2;
    doc.page.rect(MARGIN, doc.top, CONTENT_W, h, NAVY);
    headLines.forEach((lines, i) => {
      lines.forEach((line, k) => {
        const x = numeric[i] ? xs[i] + widths[i] - pad - textWidth(line, size, true) : xs[i] + pad;
        doc.page.text(x, doc.top + vpad + size + k * lineH - 1, line, size, true, WHITE);
      });
    });
    doc.top += h;
  };

  /** @param {Cell[]} row @param {boolean} bold */
  const rowHeight = (row, bold) => Math.max(1, ...block.headers.map((_, i) => linesOf(row[i] ?? null, i, bold).length)) * lineH + vpad * 2;

  /** @param {Cell[]} row @param {boolean} stripe @param {boolean} bold */
  const drawRow = (row, stripe, bold) => {
    const h = rowHeight(row, bold);
    if (stripe) doc.page.rect(MARGIN, doc.top, CONTENT_W, h, STRIPE);
    block.headers.forEach((_, i) => {
      const cell = row[i] ?? null;
      linesOf(cell, i, bold).forEach((line, k) => {
        const right = isNumericCell(cell);
        const x = right ? xs[i] + widths[i] - pad - textWidth(line, size, bold) : xs[i] + pad;
        doc.page.text(x, doc.top + vpad + size + k * lineH - 1, line, size, bold, INK);
      });
    });
    doc.page.hline(MARGIN, MARGIN + CONTENT_W, doc.top + h, RULE, 0.4);
    doc.top += h;
  };

  // El encabezado nunca queda solo al final de una página: se exige espacio para la primera fila.
  const firstRow = block.rows[0] ?? block.totals ?? [];
  const headH = Math.max(...block.headers.map((h, i) => wrapText(h, widths[i] - pad * 2, size, true).length)) * lineH + vpad * 2;
  doc.ensure(headH + rowHeight(firstRow, false));
  drawHeader();
  block.rows.forEach((row, index) => {
    if (doc.ensure(rowHeight(row, false))) drawHeader();
    drawRow(row, index % 2 === 1, false);
  });
  if (block.totals) {
    if (doc.ensure(rowHeight(block.totals, true))) drawHeader();
    drawRow(block.totals, false, true);
  }
  doc.top += 10;
}

/**
 * @param {Report} report
 * @param {{ generatedAt?: Date }} [options]
 * @returns {Uint8Array}
 */
export function buildPdf(report, { generatedAt = new Date() } = {}) {
  const geom = geometry(needsLandscape(report));
  const CONTENT_W = geom.contentW;
  const doc = new Layout(geom);

  // ---- Portada del reporte --------------------------------------------------------
  for (const line of wrapText(report.title, CONTENT_W, 20, true)) {
    doc.page.text(MARGIN, doc.top + 20, line, 20, true, NAVY);
    doc.top += 26;
  }
  if (report.subtitle) {
    doc.page.text(MARGIN, doc.top + 10, report.subtitle, 10.5, false, MUTED);
    doc.top += 18;
  }
  if (report.notes.length > 0) {
    const noteLines = report.notes.flatMap((n) => wrapText(n, CONTENT_W - 20, 9, false));
    const h = noteLines.length * 12 + 14;
    doc.page.rect(MARGIN, doc.top + 4, CONTENT_W, h, NOTE_BG);
    noteLines.forEach((line, i) => doc.page.text(MARGIN + 10, doc.top + 4 + 15 + i * 12 - 3, line, 9, false, NAVY));
    doc.top += h + 12;
  }
  doc.top += 6;

  // ---- Contenido -------------------------------------------------------------------
  const showSheetNames = report.sheets.length > 1;
  for (const sheet of report.sheets) {
    if (showSheetNames) {
      doc.ensure(60);
      doc.page.text(MARGIN, doc.top + 14, sheet.name, 14, true, NAVY);
      doc.page.hline(MARGIN, MARGIN + CONTENT_W, doc.top + 20, NAVY, 1);
      doc.top += 32;
    }
    for (const block of sheet.blocks) {
      if (block.type === 'heading') {
        doc.ensure(40);
        doc.page.text(MARGIN, doc.top + 11.5, block.text, 11.5, true, INK);
        doc.top += 20;
      } else if (block.type === 'text') {
        for (const line of wrapText(block.text, CONTENT_W, 9, false)) {
          doc.ensure(13);
          doc.page.text(MARGIN, doc.top + 9, line, 9, false, MUTED);
          doc.top += 12;
        }
        doc.top += 6;
      } else if (block.type === 'pairs') {
        for (const [label, value] of block.rows) {
          doc.ensure(18);
          const valueText = cellText(value);
          doc.page.text(MARGIN + 4, doc.top + 12, label, 9.5, false, INK);
          doc.page.text(MARGIN + CONTENT_W - 4 - textWidth(valueText, 9.5, true), doc.top + 12, valueText, 9.5, true, INK);
          doc.page.hline(MARGIN, MARGIN + CONTENT_W, doc.top + 17, RULE, 0.4);
          doc.top += 17;
        }
        doc.top += 12;
      } else {
        drawTable(doc, block);
      }
    }
  }

  // ---- Pie de cada página ------------------------------------------------------------
  const stamp = generatedAt.toISOString().slice(0, 16).replace('T', ' ');
  doc.pages.forEach((page, i) => {
    page.hline(MARGIN, MARGIN + CONTENT_W, geom.pageH - MARGIN - FOOTER_H + 8, RULE, 0.5);
    page.text(MARGIN, geom.pageH - MARGIN - FOOTER_H + 22, `ACCONTROL · ${report.title}`, 8, false, MUTED);
    const right = `Generado ${stamp} UTC · Página ${i + 1} de ${doc.pages.length}`;
    page.text(MARGIN + CONTENT_W - textWidth(right, 8), geom.pageH - MARGIN - FOOTER_H + 22, right, 8, false, MUTED);
  });

  return assemble(doc.pages, report.title, generatedAt, geom);
}

// ---------------------------------------------------------------------------
// Estructura del archivo PDF
// ---------------------------------------------------------------------------

/** @param {string} s */
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0x7f));

/** Texto Unicode para el diccionario Info (UTF-16 con BOM, en hexadecimal). @param {string} text */
function utf16Hex(text) {
  let out = 'FEFF';
  for (let i = 0; i < text.length; i += 1) out += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${out.toUpperCase()}>`;
}

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0');

/**
 * @param {Page[]} pages @param {string} title @param {Date} when @param {Geometry} geom
 * @returns {Uint8Array}
 */
export function assemble(pages, title, when, geom) {
  const created = `D:${when.getUTCFullYear()}${two(when.getUTCMonth() + 1)}${two(when.getUTCDate())}${two(when.getUTCHours())}${two(when.getUTCMinutes())}${two(when.getUTCSeconds())}Z`;
  /** @type {string[]} */
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title ${utf16Hex(title)} /Creator (ACCONTROL) /Producer (ACCONTROL) /CreationDate (${created}) >>`;
  pages.forEach((page, i) => {
    const stream = page.ops.join('\n');
    objects[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${geom.pageW} ${geom.pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + i * 2} 0 R >>`;
    objects[7 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  /** @type {Uint8Array[]} */
  const chunks = [Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let offset = chunks[0].length;
  /** @type {number[]} */
  const offsets = [];
  for (let n = 1; n < objects.length; n += 1) {
    offsets[n] = offset;
    const chunk = ascii(`${n} 0 obj\n${objects[n]}\nendobj\n`);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(ascii(xref));

  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
