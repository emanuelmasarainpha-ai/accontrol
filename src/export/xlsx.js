// @ts-check
// =============================================================================
// EXCEL (.xlsx)
// -----------------------------------------------------------------------------
// Un .xlsx es un ZIP con archivos XML. Aquí se escribe a mano lo mínimo que Excel,
// LibreOffice y Google Sheets necesitan: libro, hojas, estilos (encabezado azul
// marino, montos con formato, fechas reales) y textos "en línea".
// Los textos nunca se guardan como fórmulas, así que no hay riesgo de que una
// descripción como "=1+1" se ejecute.
// =============================================================================

import { parseISO } from '../domain/dates.js';
import { currencySymbol } from '../domain/money.js';
import { cellText } from './model.js';
import { buildZip } from './zip.js';

/** @typedef {import('./model.js').Cell} Cell */
/** @typedef {import('./model.js').Report} Report */

/** Índices de estilo (ver stylesXml). */
const S = { normal: 0, header: 1, money: 2, date: 3, int: 4, pct: 5, title: 6, bold: 7, moneyBold: 8, note: 9, wrap: 10, intBold: 11, pctBold: 12 };

/**
 * Los estilos del libro. El formato de los montos lleva el símbolo de la moneda del espacio (0.18.3).
 * @param {string} symbol
 */
const stylesXml = (symbol) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;${xmlEscape(symbol)} &quot;#,##0.00;[Red]\\-&quot;${xmlEscape(symbol)} &quot;#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF15335C"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF525D70"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF15335C"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="1" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Quita caracteres que XML no admite y escapa los especiales. @param {string} text */
export function xmlEscape(text) {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". @param {number} index */
export function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Días desde 1899-12-30 (así cuenta Excel las fechas). @param {string} iso */
export function excelDateSerial(iso) {
  const { y, m, d } = parseISO(iso);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** @param {number} cents */
function centsToDecimal(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * @param {Cell} cell @param {boolean} bold
 * @returns {{ xml: (ref: string) => string, width: number }}
 */
function renderCell(cell, bold) {
  if (cell === null || cell === undefined || cell === '') return { xml: () => '', width: 0 };
  if (typeof cell === 'string') {
    const text = xmlEscape(cell);
    const style = bold ? S.bold : S.normal;
    return { xml: (ref) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`, width: cell.length };
  }
  if ('money' in cell) {
    const style = bold ? S.moneyBold : S.money;
    return { xml: (ref) => `<c r="${ref}" s="${style}"><v>${centsToDecimal(cell.money)}</v></c>`, width: cellText(cell).length };
  }
  if ('date' in cell) return { xml: (ref) => `<c r="${ref}" s="${S.date}"><v>${excelDateSerial(cell.date)}</v></c>`, width: 10 };
  if ('int' in cell) {
    const style = bold ? S.intBold : S.int;
    return { xml: (ref) => `<c r="${ref}" s="${style}"><v>${cell.int}</v></c>`, width: String(cell.int).length };
  }
  // Porcentaje: se guarda como texto "22.8 %" alineado a la derecha (evita confundir 22.8 con 2280 %).
  const text = xmlEscape(cellText(cell));
  const style = bold ? S.pctBold : S.pct;
  return { xml: (ref) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${text}</t></is></c>`, width: text.length };
}

/**
 * @param {import('./model.js').Sheet} sheet
 * @param {string[]} preface Líneas que van arriba (título del reporte, notas) solo en la primera hoja.
 * @param {string} title
 */
function sheetXml(sheet, preface, title) {
  /** @type {string[]} */
  const rows = [];
  /** @type {number[]} */
  const widths = [];
  let r = 0;

  /** @param {{ ref: number, cells: { xml: (ref: string) => string, width: number }[], height?: number }} row */
  const push = (row) => {
    r += 1;
    const cells = row.cells.map((c, i) => {
      if (c.width > 0) widths[i] = Math.max(widths[i] ?? 0, c.width);
      return c.xml(`${columnLetter(i)}${r}`);
    }).join('');
    rows.push(`<row r="${r}"${row.height ? ` ht="${row.height}" customHeight="1"` : ''}>${cells}</row>`);
  };
  const text = (/** @type {string} */ value, /** @type {number} */ style, /** @type {boolean} */ countWidth = false) => ({
    xml: (/** @type {string} */ ref) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`,
    width: countWidth ? value.length : 0,
  });
  const blank = () => push({ ref: r, cells: [] });

  if (title) {
    push({ ref: r, cells: [text(title, S.title)], height: 24 });
  }
  for (const line of preface) push({ ref: r, cells: [text(line, S.note)] });
  if (title || preface.length > 0) blank();

  for (const block of sheet.blocks) {
    if (block.type === 'heading') {
      push({ ref: r, cells: [text(block.text, S.bold)] });
    } else if (block.type === 'text') {
      push({ ref: r, cells: [text(block.text, S.note)] });
    } else if (block.type === 'pairs') {
      for (const [label, value] of block.rows) push({ ref: r, cells: [text(label, S.bold, true), renderCell(value, false)] });
    } else {
      push({ ref: r, cells: block.headers.map((h) => ({ ...text(h, S.header, true), width: h.length + 2 })), height: 22 });
      for (const row of block.rows) push({ ref: r, cells: row.map((c) => renderCell(c, false)) });
      if (block.totals) push({ ref: r, cells: block.totals.map((c) => renderCell(c, true)) });
    }
    blank();
  }

  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, Math.ceil((w ?? 0) * 1.15) + 2))}" customWidth="1"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows.join('')}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/** Nombre de hoja válido para Excel: máx. 31 caracteres, sin []:*?/\ y sin repetirse. @param {string} name @param {Set<string>} used */
export function safeSheetName(name, used) {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hoja';
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${n}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * @param {Report} report
 * @returns {Uint8Array}
 */
export function reportToXlsx(report) {
  const used = new Set();
  const names = report.sheets.map((s) => safeSheetName(s.name, used));
  const sheetFiles = report.sheets.map((sheet, i) =>
    sheetXml(sheet, i === 0 ? [report.subtitle, ...report.notes].filter(Boolean) : [], i === 0 ? report.title : sheet.name),
  );

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${report.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${report.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${report.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(report.title)}</dc:title><dc:creator>ACCONTROL</dc:creator></cp:coreProperties>`;

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: stylesXml(currencySymbol()) },
    ...sheetFiles.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
  ]);
}
