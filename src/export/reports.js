// @ts-check
// =============================================================================
// REPORTES (qué se exporta)
// -----------------------------------------------------------------------------
// Construyen, a partir de tus datos, el contenido que luego se escribe como CSV,
// Excel o PDF (ver model.js). Aquí no hay cálculos nuevos: se usan los mismos
// que muestra la app, para que lo exportado coincida con lo que ves en pantalla.
//
// Honestidad: si hay datos de demostración, el reporte lo dice arriba y cada fila
// demo lleva la marca "DEMO".
// =============================================================================

import { ASSET_CATEGORIES, assetTypeLabel } from '../domain/assets.js';
import { SERVICE_STATUS_LABELS, clientFullName, sortServices } from '../domain/clients.js';
import { companyHealth } from '../domain/company.js';
import { baselineText, healthCards, healthSummaryText } from '../domain/companyCards.js';
import { DIAGNOSIS_THRESHOLDS, personalDiagnosis } from '../domain/diagnosis.js';
import { diagnosisBaselineText, diagnosisCards, diagnosisPriorities, diagnosisSummaryText, feasibilityText } from '../domain/diagnosisCards.js';
import { accumulatedProfit, monthlyResults, periodComparison, projectResults } from '../domain/business.js';
import { monthLabel, monthKeyOf, monthShortLabel } from '../domain/dates.js';
import { BUDGET_STATUS_LABELS, departmentHistory, departmentMonth, monthExpenses } from '../domain/departments.js';
import { kindHasOrganization, organizationLines } from '../domain/organization.js';
import {
  FREQUENCY_LABELS, RISK_LABELS, collateralLabel, debtPortfolio, formatRate,
} from '../domain/debts.js';
import {
  INVOICE_STATUS_LABELS, NOT_FISCAL_NOTE, billedByService, dueText, formatTaxPercent, invoiceActivity, invoiceLabel, invoicePosition, invoicePositions, invoiceReceivables,
} from '../domain/invoices.js';
import { STOCK_KIND_LABELS, inventorySummary, replayProduct, salesAnalysis, sortEntries, supplierTotals } from '../domain/inventory.js';
import { RANGE_LABELS, clientCosts, clientRanking, clientSummaries, paidByService, receivables, summarizeService } from '../domain/freelance.js';
import { formatMoney } from '../domain/money.js';
import { netWorthSummary } from '../domain/netWorth.js';
import { GRANULARITY_LABELS, netContributions, monthTotals, totalsByCategory, totalsByClassification, overallTotals } from '../domain/summaries.js';
import { CLASSIFICATION_LABELS, TYPE_LABELS } from '../domain/types.js';
import { date, int, money, pct, slugify } from './model.js';

/** @typedef {import('../domain/types.js').AppData} AppData */
/** @typedef {import('./model.js').Report} Report */
/** @typedef {import('./model.js').Cell} Cell */
/** @typedef {import('../domain/types.js').Workspace} Workspace */

const DEMO_NOTE = 'Este reporte incluye datos de demostración (marcados como DEMO). Son inventados y no representan dinero real.';

/** @param {{ isDemo?: boolean }} x */
const demoMark = (x) => (x.isDemo ? 'DEMO' : '');

/** @param {AppData} data */
const hasDemo = (data) =>
  data.movements.some((m) => m.isDemo) || data.goals.some((g) => g.isDemo) || data.contributions.some((c) => c.isDemo) ||
  data.debts.some((d) => d.isDemo) || data.debtPayments.some((p) => p.isDemo) || data.assets.some((a) => a.isDemo) ||
  data.clients.some((c) => c.isDemo) || data.services.some((s) => s.isDemo) ||
  data.products.some((p) => p.isDemo) || data.suppliers.some((s) => s.isDemo) || data.stockEntries.some((e) => e.isDemo) ||
  data.invoices.some((i) => i.isDemo) || data.invoicePayments.some((p) => p.isDemo) || (data.departments ?? []).some((d) => d.isDemo);

const RISK_TEXT = RISK_LABELS;

/**
 * Dice de qué espacio es el reporte (con varios espacios, un PDF sin nombre no se sabe de cuál es) y, en los
 * espacios de negocio con datos de organización, quién es el negocio. No toca las tablas ni los números.
 * @param {Report} report
 * @param {Workspace | null | undefined} workspace
 * @returns {Report}
 */
export function withWorkspaceHeader(report, workspace) {
  if (!workspace) return report;
  const lines = kindHasOrganization(workspace.kind) ? organizationLines(workspace.organization) : [];
  return {
    ...report,
    subtitle: `${report.subtitle} · Espacio: ${workspace.name}`,
    notes: [...lines, ...report.notes],
  };
}

/**
 * Reporte de un mes: resumen, categorías y todos los movimientos.
 * @param {AppData} data @param {string} monthKey @param {string} today
 * @returns {Report}
 */
export function monthReport(data, monthKey, today) {
  const totals = monthTotals(data.movements, monthKey);
  const saved = netContributions(data.contributions.filter((c) => c.date <= today), monthKey);
  const available = overallTotals(data, today).availableCents;

  const expenseByCat = totalsByCategory(data.movements, data.categories, 'expense', monthKey);
  const incomeByCat = totalsByCategory(data.movements, data.categories, 'income', monthKey);
  const catTable = (/** @type {typeof expenseByCat} */ rows) => ({
    type: /** @type {const} */ ('table'),
    headers: ['Categoría', 'Movimientos', 'Total', '% del total'],
    rows: rows.map((r) => [r.name, int(r.count), money(r.totalCents), pct(r.percent)]),
  });
  const classTable = (/** @type {'income' | 'expense'} */ type) => ({
    type: /** @type {const} */ ('table'),
    headers: ['Clasificación', 'Total', '% del total'],
    rows: totalsByClassification(data.movements, type, monthKey).map((r) => [CLASSIFICATION_LABELS[r.classification], money(r.totalCents), pct(r.percent)]),
  });

  /** @type {{ date: string, time: string, createdAt: string, cells: Cell[] }[]} */
  const lines = [];
  for (const m of data.movements) {
    if (monthKeyOf(m.date) !== monthKey || m.date > today) continue;
    const category = data.categories.find((c) => c.id === m.categoryId)?.name ?? 'Sin categoría';
    lines.push({
      date: m.date, time: m.time, createdAt: m.createdAt,
      cells: [date(m.date), m.time, TYPE_LABELS[m.type], category, CLASSIFICATION_LABELS[m.classification], m.description, money(m.type === 'income' ? m.amountCents : -m.amountCents), demoMark(m)],
    });
  }
  for (const c of data.contributions) {
    if (monthKeyOf(c.date) !== monthKey || c.date > today) continue;
    const goal = data.goals.find((g) => g.id === c.goalId)?.name ?? 'Meta eliminada';
    lines.push({
      date: c.date, time: c.time, createdAt: c.createdAt,
      cells: [date(c.date), c.time, c.kind === 'deposit' ? 'Ahorro' : 'Retiro de ahorro', 'Metas', '', `${goal}${c.note ? ` — ${c.note}` : ''}`, money(c.kind === 'deposit' ? -c.amountCents : c.amountCents), demoMark(c)],
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt));

  /** @type {import('./model.js').Sheet[]} */
  const sheets = [
    {
      name: 'Resumen',
      blocks: [
        {
          type: 'pairs',
          rows: [
            ['Ingresos del mes', money(totals.incomeCents)],
            ['Gastos del mes', money(totals.expenseCents)],
            ['Balance del mes (ingresos menos gastos)', money(totals.balanceCents)],
            ['Ahorro neto del mes (aportes menos retiros)', money(saved)],
            ['Dinero disponible hoy', money(available)],
          ],
        },
        { type: 'heading', text: 'Gastos por categoría' },
        catTable(expenseByCat),
        { type: 'heading', text: 'Ingresos por categoría' },
        catTable(incomeByCat),
        { type: 'heading', text: 'Gastos por clasificación' },
        classTable('expense'),
        { type: 'heading', text: 'Ingresos por clasificación' },
        classTable('income'),
      ],
    },
    {
      name: 'Movimientos',
      blocks: [
        {
          type: 'table',
          headers: ['Fecha', 'Hora', 'Tipo', 'Categoría', 'Clasificación', 'Descripción', 'Monto', 'Marca'],
          rows: lines.map((l) => l.cells),
        },
        { type: 'text', text: 'Los ingresos van en positivo; los gastos y los aportes a metas, en negativo.' },
      ],
    },
  ];

  return {
    title: `Reporte de ${monthLabel(monthKey)}`,
    subtitle: `ACCONTROL · hasta el ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets,
    fileBase: `accontrol-reporte-${monthKey}`,
    csvSheet: 'Movimientos',
  };
}

/**
 * Todas las deudas con su estado, y todos los pagos.
 * @param {AppData} data @param {string} today
 * @returns {Report}
 */
export function debtsReport(data, today) {
  const portfolio = debtPortfolio(data, today);

  const debtRows = portfolio.items.map(({ debt, status, risk }) => [
    debt.name,
    collateralLabel(debt.collateralKind, debt.collateralType),
    `${formatRate(debt.rateBp)} ${debt.rateBasis === 'annual' ? 'anual' : 'mensual'}`,
    FREQUENCY_LABELS[debt.frequency],
    money(debt.totalCents),
    money(status.balanceCents),
    money(status.interestPaidCents),
    money(status.interestRemainingCents),
    status.next ? date(status.next.date) : null,
    status.next ? money(status.next.paymentCents) : null,
    date(debt.finalDueDate),
    status.paid ? 'Pagada' : status.state === 'overdue' ? 'Vencida' : status.state === 'due-soon' ? 'Vence pronto' : 'Al día',
    status.paid ? '' : `${RISK_TEXT[risk.level]} (${risk.score})`,
    demoMark(debt),
  ]);

  const paymentRows = portfolio.items
    .flatMap(({ debt, status }) =>
      status.steps.map((step) => ({
        date: step.payment.date,
        time: step.payment.time,
        cells: /** @type {Cell[]} */ ([
          date(step.payment.date), step.payment.time, debt.name,
          step.payment.kind === 'regular' ? `Cuota ${step.installmentNumber}` : 'Abono extra',
          money(step.payment.amountCents), money(step.interestCents), money(step.principalCents), money(step.balanceAfterCents),
          demoMark(step.payment),
        ]),
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map((x) => x.cells);

  /** @type {import('./model.js').Sheet[]} */
  const sheets = [
    {
      name: 'Resumen',
      blocks: [
        {
          type: 'pairs',
          rows: [
            ['Total que debes', money(portfolio.totalOwedCents)],
            ['Pagas al mes (aproximado)', money(portfolio.monthlyServiceCents)],
            ['Deuda frente a ingresos', portfolio.debtToIncome === null ? 'Sin ingresos recientes' : pct(portfolio.debtToIncome * 100)],
            ['Riesgo promedio (0 a 100)', portfolio.avgRisk === null ? '—' : int(portfolio.avgRisk)],
            ['Intereses ya pagados', money(portfolio.interestPaidCents)],
            ['Intereses por pagar (si sigues el plan)', money(portfolio.interestRemainingCents)],
          ],
        },
        { type: 'text', text: 'Las cuotas son estimaciones con cuota fija (sistema francés). Tu entidad puede cobrar seguros o cargos que aquí no se incluyen. El riesgo se calcula con reglas fijas; no es inteligencia artificial.' },
      ],
    },
    {
      name: 'Deudas',
      blocks: [
        {
          type: 'table',
          headers: ['Deuda', 'Garantía', 'Tasa', 'Frecuencia', 'Monto original', 'Saldo', 'Interés pagado', 'Interés por pagar', 'Próxima cuota', 'Monto cuota', 'Vence', 'Estado', 'Riesgo', 'Marca'],
          rows: debtRows,
        },
      ],
    },
    {
      name: 'Pagos',
      blocks: [
        {
          type: 'table',
          headers: ['Fecha', 'Hora', 'Deuda', 'Tipo', 'Monto', 'A intereses', 'A capital', 'Saldo después', 'Marca'],
          rows: paymentRows,
        },
      ],
    },
  ];

  return {
    title: 'Reporte de deudas',
    subtitle: `ACCONTROL · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets,
    fileBase: `accontrol-deudas-${today}`,
    csvSheet: 'Deudas',
  };
}

/**
 * Clientes del Freelancer: resumen, un renglón por cliente (con su rentabilidad: gastos cargados, neto y margen), sus servicios,
 * los pagos recibidos y los gastos cargados a clientes.
 * Usa las mismas cuentas que la pantalla Clientes (domain/freelance.js).
 * @param {AppData} data @param {string} today
 * @returns {Report}
 */
export function clientsReport(data, today) {
  const year = clientSummaries(data, { range: 'year', today });
  const all = clientSummaries(data, { range: 'all', today });
  const allById = new Map(all.map((r) => [r.client.id, r]));
  const ranking = clientRanking(year);
  const costs = clientCosts(data, { range: 'year', today });
  const owed = receivables(data, today);
  const paid = paidByService(data.movements, today);
  const billed = billedByService(data.invoices);
  const invoiceOfMovement = new Map(data.invoicePayments.map((p) => [p.movementId, data.invoices.find((i) => i.id === p.invoiceId)]));
  const clientName = new Map(data.clients.map((c) => [c.id, clientFullName(c)]));
  const serviceName = new Map(data.services.map((s) => [s.id, s.name]));
  const name = (/** @type {{ client: import('../domain/types.js').Client } | null} */ r) => (r ? clientFullName(r.client) : '—');

  const clientRows = year.map((r) => {
    const total = /** @type {NonNullable<ReturnType<typeof allById.get>>} */ (allById.get(r.client.id));
    return /** @type {Cell[]} */ ([
      clientFullName(r.client), r.client.company, r.client.email, r.client.phone, r.client.country,
      r.client.archived ? 'Archivado' : 'Activo', int(r.services.total),
      money(r.incomeCents), money(r.expenseCents), money(r.netCents), r.marginPercent === null ? null : pct(r.marginPercent),
      money(total.incomeCents), money(total.expenseCents), money(total.netCents), int(total.payments),
      total.lastPaymentDate ? date(total.lastPaymentDate) : null, money(r.owedCents), demoMark(r.client),
    ]);
  });

  const serviceRows = data.clients.length === 0 ? [] : sortServices(data.services)
    .map((s) => ({ s, sum: summarizeService(s, paid, billed) }))
    .sort((a, b) => (clientName.get(a.s.clientId) ?? '').localeCompare(clientName.get(b.s.clientId) ?? '', 'es'))
    .map(({ s, sum }) => /** @type {Cell[]} */ ([
      clientName.get(s.clientId) ?? '', s.name, SERVICE_STATUS_LABELS[s.status], money(s.priceCents), money(sum.paidCents), money(sum.billedCents), money(sum.owedCents),
      s.startDate ? date(s.startDate) : null, s.estimatedDays === null ? null : int(s.estimatedDays), demoMark(s),
    ]));

  const paymentRows = data.movements
    .filter((m) => m.type === 'income' && m.clientId && m.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map((m) => /** @type {Cell[]} */ ([
      date(m.date), m.time, clientName.get(m.clientId ?? '') ?? '', m.serviceId ? serviceName.get(m.serviceId) ?? '' : invoiceOfMovement.get(m.id) ? `Cobro de ${invoiceLabel(/** @type {any} */ (invoiceOfMovement.get(m.id)))}` : 'Pago suelto', m.description, money(m.amountCents), demoMark(m),
    ]));

  const costRows = data.movements
    .filter((m) => m.type === 'expense' && m.clientId && m.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map((m) => /** @type {Cell[]} */ ([
      date(m.date), m.time, clientName.get(m.clientId ?? '') ?? '', m.description, money(m.amountCents), demoMark(m),
    ]));

  const yearCollected = year.reduce((sum, r) => sum + r.incomeCents, 0);
  const allCollected = all.reduce((sum, r) => sum + r.incomeCents, 0);
  const yearCosts = year.reduce((sum, r) => sum + r.expenseCents, 0);
  const allCosts = all.reduce((sum, r) => sum + r.expenseCents, 0);

  return {
    title: 'Reporte de clientes',
    subtitle: `ACCONTROL · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets: [
      {
        name: 'Resumen',
        blocks: [
          {
            type: 'pairs',
            rows: [
              [`Cobrado a clientes (${RANGE_LABELS.year.toLowerCase()})`, money(yearCollected)],
              ['Cobrado a clientes (todo el tiempo)', money(allCollected)],
              [`Gastos cargados a clientes (${RANGE_LABELS.year.toLowerCase()})`, money(yearCosts)],
              [`Neto de clientes (${RANGE_LABELS.year.toLowerCase()})`, money(yearCollected - yearCosts)],
              [`Gastos generales, sin cliente (${RANGE_LABELS.year.toLowerCase()})`, money(costs.generalCents)],
              ['Por cobrar (total)', money(owed.totalCents)],
              ['  De servicios sin facturar (En proceso y Finalizados)', money(owed.servicesCents)],
              ['  De facturas vigentes', money(owed.invoicesCents)],
              ['Clientes activos', int(data.clients.filter((c) => !c.archived).length)],
              ['Servicios en proceso', int(data.services.filter((s) => s.status === 'in_progress').length)],
              ['Cliente más rentable (este año)', name(ranking.mostProfitable)],
              ['Cliente más recurrente (este año)', name(ranking.mostRecurrent)],
              ['Mayor deuda pendiente', name(ranking.mostOwing)],
            ],
          },
          { type: 'text', text: '«Cobrado» es la suma de los ingresos vinculados a cada cliente. «Por cobrar» se cuenta de una sola fuente: lo que aún no has facturado de cada servicio En proceso o Finalizado (precio − cobrado directo − facturado; los Pendientes y Cancelados no cuentan) más el saldo de tus facturas vigentes. Lo facturado de un servicio lo cuenta su factura, nunca los dos. «Gastos cargados» son los que tú le cargaste a cada cliente (costos directos); «Neto» es lo cobrado menos esos gastos y «Margen» es el neto sobre lo cobrado. Los gastos generales (sin cliente) no se reparten entre clientes. «Más rentable» es el que más te deja (mayor neto); si no cargas gastos a clientes, es el que más pagó. «Más recurrente» es el que pagó en más meses distintos. Son cuentas con reglas fijas, no inteligencia artificial.' },
        ],
      },
      {
        name: 'Clientes',
        blocks: [
          {
            type: 'table',
            headers: ['Cliente', 'Empresa', 'Correo', 'Teléfono', 'País', 'Estado', 'Servicios', 'Cobrado este año', 'Gastos cargados este año', 'Neto este año', 'Margen este año', 'Cobrado total', 'Gastos cargados total', 'Neto total', 'Pagos', 'Último pago', 'Por cobrar', 'Marca'],
            rows: clientRows,
            totals: ['Total', '', '', '', '', '', null, money(yearCollected), money(yearCosts), money(yearCollected - yearCosts), null, money(allCollected), money(allCosts), money(allCollected - allCosts), null, null, money(year.reduce((sum, r) => sum + r.owedCents, 0)), ''],
          },
        ],
      },
      {
        name: 'Servicios',
        blocks: [
          { type: 'table', headers: ['Cliente', 'Servicio', 'Estado', 'Precio', 'Cobrado directo', 'Facturado', 'Por cobrar sin facturar', 'Inicio', 'Días estimados', 'Marca'], rows: serviceRows },
        ],
      },
      {
        name: 'Pagos',
        blocks: [
          { type: 'table', headers: ['Fecha', 'Hora', 'Cliente', 'Servicio', 'Descripción', 'Monto', 'Marca'], rows: paymentRows },
        ],
      },
      {
        name: 'Gastos de clientes',
        blocks: [
          { type: 'table', headers: ['Fecha', 'Hora', 'Cliente', 'Descripción', 'Monto', 'Marca'], rows: costRows },
        ],
      },
    ],
    fileBase: `accontrol-clientes-${today}`,
    csvSheet: 'Clientes',
  };
}

/**
 * Inventario (Emprendedor y Empresa): resumen, un renglón por producto con su stock y su valor, todos los movimientos de
 * stock, ventas y ganancia bruta por producto, y compras por proveedor. Usa las mismas cuentas que la pantalla Inventario
 * (domain/inventory.js).
 * @param {AppData} data @param {string} today
 * @returns {Report}
 */
export function inventoryReport(data, today) {
  const summary = inventorySummary(data);
  const monthKey = monthKeyOf(today);
  const month = salesAnalysis(data, `${monthKey}-01`, today);
  const year = salesAnalysis(data, `${today.slice(0, 4)}-01-01`, today);
  const productName = new Map(data.products.map((p) => [p.id, p.name]));
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  const hasMovements = new Set(data.stockEntries.map((e) => e.productId));
  /** @type {Map<string, number>} */
  const costOf = new Map();
  for (const p of data.products) {
    for (const r of replayProduct(data.stockEntries.filter((e) => e.productId === p.id)).rows) costOf.set(r.entry.id, r.costCents);
  }

  const situation = (/** @type {import('../domain/inventory.js').StockPosition} */ p) =>
    p.product.archived ? 'Archivado' : p.status === 'low' ? 'Stock bajo' : p.status === 'out' ? (hasMovements.has(p.product.id) ? 'Agotado' : 'Sin movimientos') : 'Bien';

  const productRows = summary.positions.map((p) => /** @type {Cell[]} */ ([
    p.product.name, p.product.sku, p.product.unit, situation(p), int(p.stock), money(p.avgCostCents), money(p.valueCents),
    p.product.priceCents > 0 ? money(p.product.priceCents) : null, p.product.minStock > 0 ? int(p.product.minStock) : null, demoMark(p.product),
  ]));

  const movementRows = sortEntries(data.stockEntries).map((e) => /** @type {Cell[]} */ ([
    date(e.date), e.time, productName.get(e.productId) ?? '', STOCK_KIND_LABELS[e.kind], int(e.quantity),
    e.kind === 'adjustment' && e.quantity < 0 ? null : money(e.unitCents), e.kind === 'adjustment' ? null : money(Math.abs(e.quantity) * e.unitCents),
    e.quantity < 0 ? money(costOf.get(e.id) ?? 0) : null, e.supplierId ? supplierName.get(e.supplierId) ?? '' : '', e.note, demoMark(e),
  ]));

  /** @param {ReturnType<typeof salesAnalysis>} a @returns {import('./model.js').TableBlock} */
  const salesTable = (a) => ({
    type: 'table',
    headers: ['Producto', 'Unidades vendidas', 'Ventas', 'Costo de lo vendido', 'Ganancia bruta', 'Margen', 'Marca'],
    rows: a.byProduct.map((r) => /** @type {Cell[]} */ ([r.product.name, int(r.units), money(r.revenueCents), money(r.costCents), money(r.profitCents), r.marginPercent === null ? null : pct(r.marginPercent), demoMark(r.product)])),
    totals: ['Total', int(a.units), money(a.revenueCents), money(a.costCents), money(a.profitCents), a.marginPercent === null ? null : pct(a.marginPercent), ''],
  });

  const supplierRows = supplierTotals(data).map((t) => /** @type {Cell[]} */ ([
    t.supplier.name, t.supplier.contact, t.supplier.email, t.supplier.phone, t.supplier.archived ? 'Archivado' : 'Activo',
    int(t.purchases), money(t.totalCents), t.lastDate ? date(t.lastDate) : null, demoMark(t.supplier),
  ]));

  return {
    title: 'Reporte de inventario',
    subtitle: `ACCONTROL · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets: [
      {
        name: 'Resumen',
        blocks: [
          {
            type: 'pairs',
            rows: [
              ['Valor del inventario (costo promedio)', money(summary.totalValueCents)],
              ['Unidades en stock (de todos los productos)', int(summary.totalUnits)],
              ['Productos activos', int(summary.activeProducts)],
              ['Productos con stock bajo o agotados', int(summary.alerts.length)],
              [`Ventas de ${monthLabel(monthKey)}`, money(month.revenueCents)],
              [`Costo de lo vendido en ${monthLabel(monthKey)}`, money(month.costCents)],
              [`Ganancia bruta de ${monthLabel(monthKey)}`, money(month.profitCents)],
              [`Margen de ${monthLabel(monthKey)}`, month.marginPercent === null ? 'Sin ventas' : pct(month.marginPercent)],
              [`Ganancia bruta de ${today.slice(0, 4)}`, money(year.profitCents)],
              ['Mermas del mes (costo de las unidades perdidas por ajustes)', money(month.shrinkCostCents)],
            ],
          },
          { type: 'text', text: 'El valor se calcula a costo promedio: lo comprado menos lo que ya salió, a lo que costaba en promedio cada unidad en ese momento. «Ganancia bruta» es lo vendido menos lo que costó la mercancía vendida; no descuenta gastos fijos. La pantalla Resultados cuenta el dinero cuando entra o sale (la compra como gasto y la venta como ingreso), por eso sus cifras no tienen por qué coincidir con las de esta ganancia bruta. Las cantidades son números enteros. Son cuentas con reglas fijas, no inteligencia artificial.' },
        ],
      },
      {
        name: 'Productos',
        blocks: [
          {
            type: 'table',
            headers: ['Producto', 'Código', 'Unidad', 'Situación', 'Stock', 'Costo promedio', 'Valor en stock', 'Precio de venta', 'Aviso en', 'Marca'],
            rows: productRows,
            totals: ['Total', '', '', '', null, null, money(summary.totalValueCents), null, null, ''],
          },
        ],
      },
      {
        name: 'Movimientos de stock',
        blocks: [
          { type: 'table', headers: ['Fecha', 'Hora', 'Producto', 'Tipo', 'Cantidad', 'Costo o precio por unidad', 'Total', 'Costo de lo que salió', 'Proveedor', 'Nota', 'Marca'], rows: movementRows },
        ],
      },
      {
        name: 'Ventas y ganancia',
        blocks: [
          { type: 'heading', text: `Ventas de ${monthLabel(monthKey)}` },
          salesTable(month),
          { type: 'heading', text: `Ventas de ${today.slice(0, 4)} (hasta hoy)` },
          salesTable(year),
        ],
      },
      {
        name: 'Proveedores',
        blocks: [
          { type: 'table', headers: ['Proveedor', 'Contacto', 'Correo', 'Teléfono', 'Estado', 'Compras', 'Total comprado', 'Última compra', 'Marca'], rows: supplierRows },
        ],
      },
    ],
    fileBase: `accontrol-inventario-${today}`,
    csvSheet: 'Productos',
  };
}

/**
 * Facturas internas (Emprendedor y Empresa): resumen de lo que te deben, todas las facturas, sus líneas, sus cobros y lo que
 * debe cada cliente. Usa las mismas cuentas que la pantalla Facturas (domain/invoices.js).
 * @param {AppData} data @param {string} today
 * @returns {Report}
 */
export function invoicesReport(data, today) {
  const positions = invoicePositions(data, today);
  const r = invoiceReceivables(data, today);
  const monthKey = monthKeyOf(today);
  const month = invoiceActivity(data, `${monthKey}-01`, today);
  const year = invoiceActivity(data, `${today.slice(0, 4)}-01-01`, today);
  const byId = new Map(data.invoices.map((i) => [i.id, i]));
  const live = positions.filter((p) => p.status !== 'void');
  const sum = (/** @type {(p: typeof positions[number]) => number} */ f) => live.reduce((n, p) => n + f(p), 0);

  const invoiceRows = positions.map((p) => /** @type {Cell[]} */ ([
    invoiceLabel(p.invoice), date(p.invoice.issueDate), p.invoice.customerName, p.invoice.customerTaxId, p.invoice.dueDate ? date(p.invoice.dueDate) : 'Sin vencimiento',
    INVOICE_STATUS_LABELS[p.status], p.status === 'overdue' ? int(p.daysOverdue) : null, money(p.subtotalCents), money(p.taxCents), money(p.totalCents),
    money(p.paidCents), money(p.balanceCents), demoMark(p.invoice),
  ]));
  const lineRows = positions.flatMap((p) => p.invoice.lines.map((l) => /** @type {Cell[]} */ ([
    invoiceLabel(p.invoice), p.invoice.customerName, l.description, l.productId ? data.products.find((x) => x.id === l.productId)?.name ?? 'Producto eliminado' : l.serviceId ? `Servicio: ${data.services.find((x) => x.id === l.serviceId)?.name ?? 'eliminado'}` : '',
    int(l.quantity), money(l.unitCents), money(l.quantity * l.unitCents), p.status === 'void' ? 'Anulada' : '', demoMark(p.invoice),
  ])));
  const paymentRows = [...data.invoicePayments]
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.id.localeCompare(b.id))
    .map((pay) => {
      const inv = byId.get(pay.invoiceId);
      return /** @type {Cell[]} */ ([date(pay.date), pay.time, inv ? invoiceLabel(inv) : '', inv?.customerName ?? '', money(pay.amountCents), pay.note, demoMark(pay)]);
    });
  const customerRows = r.customers.map((c) => /** @type {Cell[]} */ ([c.customerName, int(c.invoices), money(c.balanceCents), money(c.overdueCents), int(c.oldestDaysOverdue)]));

  return {
    title: 'Reporte de facturas',
    subtitle: `ACCONTROL · al ${today}`,
    notes: [NOT_FISCAL_NOTE, ...(hasDemo(data) ? [DEMO_NOTE] : [])],
    sheets: [
      {
        name: 'Resumen',
        blocks: [
          {
            type: 'pairs',
            rows: [
              ['Por cobrar (facturas con saldo)', money(r.totalCents)],
              ['Facturas con saldo', int(r.openCount)],
              ['Vencido', money(r.overdueCents)],
              ['Facturas vencidas', int(r.overdueCount)],
              ['Días de atraso de la más atrasada', int(r.oldestDaysOverdue)],
              [`Facturado en ${monthLabel(monthKey)}`, money(month.billedCents)],
              [`Cobrado en ${monthLabel(monthKey)}`, money(month.collectedCents)],
              [`Facturado en ${today.slice(0, 4)}`, money(year.billedCents)],
              [`Cobrado en ${today.slice(0, 4)}`, money(year.collectedCents)],
            ],
          },
          { type: 'heading', text: 'Cuánto lleva vencido lo que te deben' },
          {
            type: 'table',
            headers: ['Tramo', 'Por cobrar'],
            rows: [['Por vencer (o sin vencimiento)', money(r.aging.current)], ['1 a 30 días de atraso', money(r.aging.d1to30)], ['31 a 60 días de atraso', money(r.aging.d31to60)], ['Más de 60 días de atraso', money(r.aging.d61plus)]],
            totals: ['Total', money(r.totalCents)],
          },
          { type: 'text', text: 'Las facturas son documentos internos de control, no comprobantes fiscales. Lo facturado no es ingreso hasta que se cobra: cada cobro se anota como ingreso en Movimientos y en Resultados, por su fecha de cobro. Los días de atraso se cuentan desde el vencimiento; una factura sin vencimiento cuenta como «por vencer». Las facturas anuladas no suman. Son cuentas con reglas fijas, no inteligencia artificial.' },
        ],
      },
      {
        name: 'Facturas',
        blocks: [
          {
            type: 'table',
            headers: ['Número', 'Fecha', 'Cliente', 'RNC o cédula', 'Vence', 'Estado', 'Días de atraso', 'Subtotal', 'Impuesto', 'Total', 'Cobrado', 'Por cobrar', 'Marca'],
            rows: invoiceRows,
            totals: ['Total (sin anuladas)', null, '', '', null, '', null, money(sum((p) => p.subtotalCents)), money(sum((p) => p.taxCents)), money(sum((p) => p.totalCents)), money(sum((p) => p.paidCents)), money(sum((p) => p.balanceCents)), ''],
          },
        ],
      },
      {
        name: 'Líneas',
        blocks: [
          { type: 'table', headers: ['Factura', 'Cliente', 'Descripción', 'Producto o servicio', 'Cantidad', 'Precio por unidad', 'Total de la línea', 'Nota', 'Marca'], rows: lineRows },
        ],
      },
      {
        name: 'Cobros',
        blocks: [
          { type: 'table', headers: ['Fecha', 'Hora', 'Factura', 'Cliente', 'Monto', 'Nota', 'Marca'], rows: paymentRows },
        ],
      },
      {
        name: 'Por cliente',
        blocks: [
          { type: 'table', headers: ['Cliente', 'Facturas con saldo', 'Por cobrar', 'Vencido', 'Días de atraso (la más atrasada)'], rows: customerRows },
        ],
      },
    ],
    fileBase: `accontrol-facturas-${today}`,
    csvSheet: 'Facturas',
  };
}

/** Los valores largos no caben en una fila «etiqueta — valor» del PDF: se acortan con «…». @param {string} text */
const clip = (text) => (text.length > 70 ? `${text.slice(0, 69).trimEnd()}…` : text);

/**
 * Una factura (el PDF que se le entrega al cliente o se guarda): datos, líneas, totales y cobros.
 * Lleva siempre la leyenda de que es un documento interno, no un comprobante fiscal.
 * @param {AppData} data @param {import('../domain/types.js').Invoice} invoice @param {string} today
 * @returns {Report}
 */
export function invoiceReport(data, invoice, today) {
  const p = invoicePosition(invoice, data.invoicePayments, today);
  const label = invoiceLabel(invoice);
  /** @type {[string, Cell][]} */
  const details = [
    ['Estado', INVOICE_STATUS_LABELS[p.status]],
    ['Fecha', date(invoice.issueDate)],
    ['Vencimiento', invoice.dueDate ? date(invoice.dueDate) : 'Sin vencimiento'],
    ['Cliente', clip(invoice.customerName)],
  ];
  if (invoice.customerTaxId) details.push(['RNC o cédula', clip(invoice.customerTaxId)]);
  if (invoice.customerContact) details.push(['Contacto', clip(invoice.customerContact)]);

  /** @type {[string, Cell][]} */
  const totals = [
    ['Subtotal', money(p.subtotalCents)],
    [`Impuesto (${formatTaxPercent(invoice.taxRateBp)} %)`, money(p.taxCents)],
    ['Total', money(p.totalCents)],
    ['Cobrado', money(p.paidCents)],
    [p.status === 'void' ? 'Por cobrar (factura anulada)' : 'Por cobrar', money(p.balanceCents)],
  ];
  if (p.status === 'overdue') totals.push(['Días de atraso', int(p.daysOverdue)]);

  /** @type {import('./model.js').Block[]} */
  const blocks = [
    { type: 'pairs', rows: details },
    ...(invoice.notes ? /** @type {import('./model.js').Block[]} */ ([{ type: 'text', text: `Notas: ${invoice.notes}` }]) : []),
    {
      type: 'table',
      headers: ['Descripción', 'Cantidad', 'Precio por unidad', 'Total'],
      rows: invoice.lines.map((l) => /** @type {Cell[]} */ ([l.description, int(l.quantity), money(l.unitCents), money(l.quantity * l.unitCents)])),
    },
    { type: 'pairs', rows: totals },
  ];
  if (p.payments.length > 0) {
    blocks.push(
      { type: 'heading', text: 'Cobros recibidos' },
      { type: 'table', headers: ['Fecha', 'Monto', 'Nota'], rows: p.payments.map((pay) => /** @type {Cell[]} */ ([date(pay.date), money(pay.amountCents), pay.note])), totals: ['Total cobrado', money(p.paidCents), ''] },
    );
  }

  return {
    title: `Factura ${label}`,
    subtitle: `ACCONTROL · ${dueText(invoice)} · situación al ${today}`,
    notes: [NOT_FISCAL_NOTE, ...(p.status === 'void' ? ['Esta factura está ANULADA.'] : []), ...(invoice.isDemo ? [DEMO_NOTE] : [])],
    sheets: [{ name: 'Factura', blocks }],
    fileBase: `accontrol-factura-${slugify(label)}`,
    csvSheet: 'Factura',
  };
}

/**
 * Resultados del negocio (Emprendedor y Empresa): estado de resultados de un período, comparación con el período
 * anterior y con el mismo período del año anterior, categorías, últimos 6 meses y proyección.
 * Usa las mismas cuentas que la pantalla Resultados (domain/business.js).
 * @param {AppData} data @param {import('../domain/summaries.js').Granularity} granularity @param {string} monthKey Mes dentro del período. @param {string} today
 * @returns {Report}
 */
export function resultsReport(data, granularity, monthKey, today) {
  const comparison = periodComparison(data, granularity, monthKey, today);
  const { current, previous, yearAgo } = comparison;
  const bounds = current.period;
  const accumulated = accumulatedProfit(data, today);
  const projection = projectResults(data, today);
  const series = monthlyResults(data, today, 6);
  const nowKey = today.slice(0, 7);

  /** @param {number | null} value @returns {Cell} */
  const pctOrDash = (value) => (value === null ? '—' : pct(value));
  /** @param {import('../domain/business.js').Delta} d @returns {Cell} */
  const variation = (d) => (d.percent === null ? '—' : pct(d.percent));
  /** @param {import('../domain/business.js').ComparisonColumn | null} column @returns {Cell[][]} */
  const columnRows = (column) => {
    if (!column) return [];
    return [
      [money(column.statement.incomeCents), money(column.income.diffCents), variation(column.income)],
      [money(column.statement.expenseCents), money(column.expense.diffCents), variation(column.expense)],
      [money(column.statement.netCents), money(column.net.diffCents), variation(column.net)],
      [pctOrDash(column.statement.marginPercent), column.marginPoints === null ? '—' : `${column.marginPoints > 0 ? '+' : ''}${column.marginPoints.toFixed(1)} pts`, ''],
    ];
  };
  const prevRows = columnRows(previous);
  const yearRows = columnRows(yearAgo);
  const labels = ['Ingresos', 'Gastos', 'Beneficio neto', 'Margen (cambio en puntos)'];
  const currentCells = [money(current.incomeCents), money(current.expenseCents), money(current.netCents), pctOrDash(current.marginPercent)];
  const comparisonHeaders = ['Cifra', bounds.label, previous.statement.period.label, 'Cambio', 'Variación'];
  if (yearAgo) comparisonHeaders.push(yearAgo.statement.period.label, 'Cambio', 'Variación');
  const comparisonRows = labels.map((label, i) => /** @type {Cell[]} */ ([label, currentCells[i], ...prevRows[i], ...(yearAgo ? yearRows[i] : [])]));

  /** @param {import('../domain/business.js').CategoryRow[]} rows @param {number} total @returns {import('./model.js').TableBlock} */
  const categoryTable = (rows, total) => ({
    type: 'table',
    headers: ['Categoría', 'Monto', '% del total'],
    rows: rows.map((r) => [r.name, money(r.cents), pct(r.percent)]),
    totals: ['Total', money(total), rows.length > 0 ? pct(100) : null],
  });

  /** @type {import('./model.js').Block[]} */
  const projectionBlocks = [];
  if (projection.ok) {
    projectionBlocks.push({
      type: 'table',
      headers: ['Mes', 'Ingresos', 'Gastos', 'Beneficio', 'Beneficio (rango bajo)', 'Beneficio (rango alto)', 'Nota'],
      rows: projection.months.map((m) => [monthLabel(m.key), money(m.incomeCents), money(m.expenseCents), money(m.netCents), money(m.netLowCents), money(m.netHighCents), m.current ? 'Mes en curso (ya incluye lo registrado)' : '']),
      totals: ['Total de los meses proyectados', money(projection.totals.incomeCents), money(projection.totals.expenseCents), money(projection.totals.netCents), null, null, ''],
    });
    projectionBlocks.push({
      type: 'text',
      text: `Es una estimación, no una promesa: continúa la tendencia lineal de los últimos ${projection.basisMonths.length} meses completos (${monthLabel(projection.basisMonths[0])} a ${monthLabel(projection.basisMonths[projection.basisMonths.length - 1])}). El rango es el beneficio más/menos la variación típica de esos meses. Cada mes se proyecta con una recta por mínimos cuadrados (no es inteligencia artificial).`,
    });
    if (projection.reasons.length > 0) projectionBlocks.push({ type: 'text', text: `Poca firmeza: ${projection.reasons.join(' ')}` });
  } else {
    projectionBlocks.push({
      type: 'text',
      text: projection.reason === 'no-data'
        ? 'Todavía no hay movimientos, así que no se puede proyectar nada.'
        : `Todavía no hay suficiente historia para proyectar: hacen falta ${projection.needMonths} meses completos (tienes ${projection.haveMonths}). Prefiero no mostrar cifras que no se sostienen.`,
    });
  }

  /** @type {[string, Cell][]} */
  const summaryRows = [
    ['Período', bounds.label + (current.partial ? ' (en curso: solo cuenta hasta hoy)' : '')],
    ['Ingresos', money(current.incomeCents)],
    ['Gastos', money(current.expenseCents)],
    ['Beneficio neto', money(current.netCents)],
  ];
  if (current.debtPaymentsCents > 0) {
    summaryRows.push(['De los gastos, pagos de deudas', money(current.debtPaymentsCents)], ['Beneficio antes de pagos de deudas', money(current.netBeforeDebtCents)]);
  }
  summaryRows.push(
    ['Margen (beneficio ÷ ingresos)', pctOrDash(current.marginPercent)],
    ['Rentabilidad (beneficio ÷ gastos)', pctOrDash(current.profitabilityPercent)],
    [`Beneficio acumulado de ${accumulated.year}`, money(accumulated.yearToDateCents)],
    ['Beneficio acumulado desde el primer registro', money(accumulated.sinceStartCents)],
  );

  return {
    title: 'Reporte de resultados',
    subtitle: `ACCONTROL · ${GRANULARITY_LABELS[granularity]}: ${bounds.label} · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets: [
      {
        name: 'Resumen',
        blocks: [
          { type: 'pairs', rows: summaryRows },
          { type: 'text', text: 'Todo se cuenta por dinero que entró y salió (base de caja): el beneficio neto es ingresos menos gastos, igual que el flujo neto. Los pagos de deudas se cuentan como gasto porque incluyen el capital que devuelves, y por eso se muestran aparte. El margen es el beneficio entre los ingresos; la rentabilidad, el beneficio entre los gastos. Solo cuenta lo registrado hasta hoy.' },
        ],
      },
      { name: 'Comparación', blocks: [{ type: 'table', headers: comparisonHeaders, rows: comparisonRows }] },
      {
        name: 'Categorías',
        blocks: [
          { type: 'heading', text: 'Ingresos por categoría' },
          categoryTable(current.incomeByCategory, current.incomeCents),
          { type: 'heading', text: 'Gastos por categoría' },
          categoryTable(current.expenseByCategory, current.expenseCents),
        ],
      },
      {
        name: 'Últimos 6 meses',
        blocks: [
          {
            type: 'table',
            headers: ['Mes', 'Ingresos', 'Gastos', 'Beneficio', 'Margen', 'Estado'],
            rows: series.map((s) => [monthLabel(s.key), money(s.incomeCents), money(s.expenseCents), money(s.netCents), pctOrDash(s.marginPercent), s.key === nowKey ? 'En curso' : s.hasData ? '' : 'Sin movimientos']),
          },
        ],
      },
      { name: 'Proyección', blocks: projectionBlocks },
    ],
    fileBase: `accontrol-resultados-${bounds.key}-${today}`,
    csvSheet: 'Comparación',
  };
}

/**
 * Salud financiera de la empresa: las cinco señales con su nivel, su cifra, lo que significan y la regla de cada una.
 * Usa los mismos números y textos que la pantalla (domain/company.js y domain/companyCards.js).
 * @param {AppData} data @param {string} today
 * @returns {Report}
 */
export function healthReport(data, today) {
  const health = companyHealth(data, today);
  const cards = healthCards(health);
  return {
    title: 'Reporte de salud financiera',
    subtitle: `ACCONTROL · Empresa · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets: [
      {
        name: 'Resumen',
        blocks: [
          {
            type: 'pairs',
            rows: [
              ['Resumen', healthSummaryText(health)],
              ['Mes típico', baselineText(health)],
              ['Ingreso de un mes típico', money(health.baseline.incomeCents)],
              ['Costos fijos de un mes típico', money(health.baseline.fixedCents)],
              ['Costos variables de un mes típico', money(health.baseline.variableCents)],
              ['Cuotas de deuda al mes', money(health.baseline.debtServiceCents)],
              ['Dinero disponible', money(health.runway.cashCents)],
            ],
          },
          { type: 'text', text: 'Son cuentas con reglas fijas sobre lo que registraste en este espacio; no es inteligencia artificial ni asesoría contable. Los niveles Bien, Atención y Riesgo son reglas generales: cada negocio es distinto.' },
        ],
      },
      {
        name: 'Indicadores',
        blocks: [{
          type: 'table',
          headers: ['Indicador', 'Nivel', 'Cifra', 'Qué significa', 'Regla del nivel'],
          rows: cards.map((c) => [c.title, c.levelLabel, c.value, c.text, c.rule]),
        }],
      },
      {
        name: 'Detalle',
        blocks: cards.flatMap((c) => /** @type {import('./model.js').Block[]} */ ([
          { type: 'heading', text: `${c.title} · ${c.levelLabel}` },
          { type: 'table', headers: ['Concepto', 'Valor'], rows: c.details.length > 0 ? c.details.map((d) => [d.label, d.value]) : [['Sin detalle todavía', '—']] },
        ])),
      },
      {
        name: 'Cómo se calcula',
        blocks: [
          { type: 'text', text: 'Costos fijos: gastos clasificados como Fijo o Discrecional. Costos variables: los clasificados como Variable. Mes típico: promedio de los últimos 3 meses completos con movimientos (si solo hay el mes en curso, las cifras son parciales).' },
          { type: 'text', text: 'Punto de equilibrio = (costos fijos + cuotas de deuda) ÷ margen de contribución, donde el margen de contribución = (ingresos − costos variables) ÷ ingresos. Margen de seguridad = (ingresos − equilibrio) ÷ ingresos.' },
          { type: 'text', text: 'Meses de efectivo = dinero disponible ÷ lo que sale cada mes (costos + cuotas de deuda). Deuda sobre activos = lo que se debe ÷ (dinero registrado + activos). Peso de las cuotas = cuotas mensuales ÷ ingresos de un mes típico. Cuotas a 30 días: lo vencido más lo que vence en los próximos 30 días, frente al dinero disponible.' },
          { type: 'text', text: 'Todo es de base de caja y no incluye todavía inventario, facturas por cobrar ni cuentas por pagar a proveedores. Los pagos de deudas ya hechos no se cuentan como costos; se usan las cuotas que siguen por pagar.' },
        ],
      },
    ],
    fileBase: `accontrol-salud-financiera-${today}`,
    csvSheet: 'Indicadores',
  };
}

/**
 * Diagnóstico financiero y viabilidad de metas: los indicadores con su nivel y lo que falta para «Bien», y cada meta
 * pendiente con su viabilidad. Usa los mismos números y textos que la pantalla (domain/diagnosis.js y diagnosisCards.js).
 * @param {AppData} data @param {string} today
 * @returns {Report}
 */
export function diagnosisReport(data, today) {
  const d = personalDiagnosis(data, today);
  const cards = diagnosisCards(d);
  const priorities = diagnosisPriorities(d);
  const T = DIAGNOSIS_THRESHOLDS;
  const goals = d.feasibility.goals;
  return {
    title: 'Reporte de diagnóstico financiero',
    subtitle: `ACCONTROL · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets: [
      {
        name: 'Resumen',
        blocks: [
          {
            type: 'pairs',
            rows: [
              ['Resumen', diagnosisSummaryText(d)],
              ['Mes típico', diagnosisBaselineText(d)],
              ['Ingreso de un mes típico', money(d.baseline.incomeCents)],
              ['Gastos de un mes típico (sin pagos de deudas)', money(d.baseline.expenseCents)],
              ['Cuotas de deudas al mes', money(d.baseline.debtServiceCents)],
              ['Capacidad de ahorro al mes', d.capacityCents === null ? 'Sin datos' : money(d.capacityCents)],
              ['Dinero disponible (sin lo apartado en metas)', money(d.cashCents)],
              ['Qué mirar primero', priorities.length === 0 ? 'Nada en riesgo ni en atención con estas reglas.' : priorities.map((p) => `${p.title} (${p.levelLabel})`).join(', ')],
            ],
          },
          { type: 'text', text: 'Son cuentas con reglas fijas sobre lo que registraste en este espacio; no es inteligencia artificial, no predice nada y no es asesoría financiera. Los niveles Bien, Atención y Riesgo son reglas generales: cada persona y cada familia es distinta.' },
        ],
      },
      {
        name: 'Indicadores',
        blocks: [{
          type: 'table',
          headers: ['Indicador', 'Nivel', 'Cifra', 'Qué significa', 'Qué falta para «Bien»', 'Regla del nivel'],
          rows: cards.map((c) => [c.title, c.levelLabel, c.value, c.text, c.hint || '—', c.rule]),
        }],
      },
      {
        name: 'Detalle',
        blocks: cards.flatMap((c) => /** @type {import('./model.js').Block[]} */ ([
          { type: 'heading', text: `${c.title} · ${c.levelLabel}` },
          { type: 'table', headers: ['Concepto', 'Valor'], rows: c.details.length > 0 ? c.details.map((r) => [r.label, r.value]) : [['Sin detalle todavía', '—']] },
        ])),
      },
      {
        name: 'Metas',
        blocks: goals.length === 0
          ? [{ type: 'text', text: 'No hay metas pendientes que evaluar.' }]
          : [
            {
              type: 'table',
              headers: ['Meta', 'Fecha objetivo', 'Falta', 'Aporte mensual necesario', 'Le toca de tu capacidad', 'Viabilidad', 'Qué significa'],
              rows: goals.map((g) => {
                const t = feasibilityText(g, d.capacityCents);
                return [g.goal.name, date(g.goal.targetDate), money(g.progress.remainingCents), money(g.neededCents), money(g.allocatedCents), t.label, t.text];
              }),
              totals: ['Total', null, money(goals.reduce((sum, g) => sum + g.progress.remainingCents, 0)), money(d.feasibility.totalNeededCents), money(goals.reduce((sum, g) => sum + g.allocatedCents, 0)), null, null],
            },
            { type: 'text', text: 'Tu capacidad de ahorro (ingreso − gastos − cuotas de un mes típico) es una sola para todas las metas: se reparte por orden de fecha objetivo, y cada meta recibe como máximo lo que necesita aportar cada mes.' },
          ],
      },
      {
        name: 'Cómo se calcula',
        blocks: [
          { type: 'text', text: 'Mes típico: promedio de los últimos 3 meses completos con movimientos (si solo hay el mes en curso, las cifras son parciales). Los pagos de deudas se sacan de los gastos para no contarlos dos veces y se usan las cuotas mensuales de tus deudas activas.' },
          { type: 'text', text: `Tasa de ahorro = (ingreso − gastos − cuotas) ÷ ingreso. ${T.savings.good}% o más = Bien; ${T.savings.watch}% o más = Atención; menos = Riesgo.` },
          { type: 'text', text: `Colchón de emergencia = dinero disponible ÷ lo que sale cada mes (gastos + cuotas). ${T.emergency.good} meses o más = Bien; ${T.emergency.watch} o más = Atención; menos = Riesgo. No cuenta lo apartado en metas ni los activos.` },
          { type: 'text', text: `Peso de las deudas = cuotas mensuales ÷ ingreso. ${T.debtService.good}% o menos = Bien; hasta ${T.debtService.watch}% = Atención; más = Riesgo (los mismos cortes que usa Salud financiera en Empresa). Cuotas vencidas: ninguna = Bien; alguna = Riesgo.` },
          { type: 'text', text: 'Metas: una meta «Va al ritmo» si lo que aportas hoy (promedio de los últimos meses) alcanza a tiempo; si no, se compara lo que necesita aportar cada mes con lo que le toca de tu capacidad de ahorro. Patrimonio neto: lo que tienes (dinero y activos) menos lo que debes; Bien si es mayor que cero.' },
          { type: 'text', text: 'Todo se calcula con lo registrado en este espacio y supone que tus meses futuros se parecerán al mes típico: es una estimación, no una promesa.' },
        ],
      },
    ],
    fileBase: `accontrol-diagnostico-${today}`,
    csvSheet: 'Indicadores',
  };
}

/**
 * Detalle de una deuda: datos, tabla de amortización de lo que falta y pagos hechos.
 * @param {import('../domain/debts.js').DebtView} item @param {string} today
 * @returns {Report}
 */
export function amortizationReport(item, today) {
  const { debt, status, risk } = item;
  return {
    title: `Amortización: ${debt.name}`,
    subtitle: `ACCONTROL · al ${today}`,
    notes: debt.isDemo ? [DEMO_NOTE] : [],
    sheets: [
      {
        name: 'Deuda',
        blocks: [
          {
            type: 'pairs',
            rows: [
              ['Monto original', money(debt.totalCents)],
              ['Debes hoy', money(status.balanceCents)],
              ['Tasa de interés', `${formatRate(debt.rateBp)} ${debt.rateBasis === 'annual' ? 'anual' : 'mensual'}`],
              ['Frecuencia de pago', FREQUENCY_LABELS[debt.frequency]],
              ['Garantía', collateralLabel(debt.collateralKind, debt.collateralType)],
              ['Vencimiento final', date(debt.finalDueDate)],
              ['Intereses pagados', money(status.interestPaidCents)],
              ['Intereses por pagar', money(status.interestRemainingCents)],
              ['Riesgo', status.paid ? 'Pagada' : `${RISK_TEXT[risk.level]} (${risk.score} de 100)`],
            ],
          },
        ],
      },
      {
        name: 'Amortización',
        blocks: [
          {
            type: 'table',
            headers: ['N.º', 'Fecha', 'Cuota', 'Interés', 'Capital', 'Saldo'],
            rows: status.remaining.map((r) => [int(r.number), date(r.date), money(r.paymentCents), money(r.interestCents), money(r.principalCents), money(r.balanceAfterCents)]),
            totals: status.remaining.length > 0
              ? [
                  'Total', null,
                  money(status.remaining.reduce((s, r) => s + r.paymentCents, 0)),
                  money(status.remaining.reduce((s, r) => s + r.interestCents, 0)),
                  money(status.remaining.reduce((s, r) => s + r.principalCents, 0)),
                  null,
                ]
              : undefined,
          },
          { type: 'text', text: 'Cuotas que faltan, calculadas sobre lo que debes hoy. Si pagas de más o de menos, se recalculan; la fecha final no cambia.' },
        ],
      },
      {
        name: 'Pagos hechos',
        blocks: [
          {
            type: 'table',
            headers: ['Fecha', 'Hora', 'Tipo', 'Monto', 'A intereses', 'A capital', 'Saldo después'],
            rows: status.steps.map((s) => [
              date(s.payment.date), s.payment.time, s.payment.kind === 'regular' ? `Cuota ${s.installmentNumber}` : 'Abono extra',
              money(s.payment.amountCents), money(s.interestCents), money(s.principalCents), money(s.balanceAfterCents),
            ]),
          },
        ],
      },
    ],
    fileBase: `accontrol-amortizacion-${slugify(debt.name)}`,
    csvSheet: 'Amortización',
  };
}

/**
 * Reporte de una calculadora financiera: lo que escribiste, el resultado y (si hay) la tabla.
 * Los números son exactamente los que se ven en pantalla.
 * @param {string} title @param {import('../domain/calculators.js').Outcome} outcome @param {string} today
 * @returns {Report}
 */
export function calculatorReport(title, outcome, today) {
  /** @type {Cell[][]} */
  const rows = [
    ...outcome.inputs.map(([label, value]) => /** @type {Cell[]} */ (['Dato', label, value])),
    ['Resultado', outcome.headline.label, outcome.headline.value],
    ...outcome.items.map((item) => /** @type {Cell[]} */ (['Resultado', item.label, item.note ? `${item.value} (${item.note})` : item.value])),
  ];
  /** @type {Report['sheets']} */
  const sheets = [
    {
      name: 'Resumen',
      blocks: [
        { type: 'table', headers: ['Tipo', 'Concepto', 'Valor'], rows },
        { type: 'text', text: outcome.sentence },
        ...outcome.notes.map((text) => /** @type {import('./model.js').Block} */ ({ type: 'text', text })),
      ],
    },
  ];
  if (outcome.table) {
    sheets.push({
      name: outcome.table.caption.slice(0, 31),
      blocks: [{ type: 'table', headers: outcome.table.headers, rows: outcome.table.rows, totals: outcome.table.totals }],
    });
  }
  return {
    title: `Calculadora: ${title}`,
    subtitle: `ACCONTROL · ${today}`,
    notes: ['Simulación educativa con tasas constantes: no es asesoría financiera ni una promesa de resultados.'],
    sheets,
    fileBase: `accontrol-calculadora-${slugify(title)}`,
    csvSheet: outcome.table ? sheets[1].name : 'Resumen',
  };
}

/**
 * Reporte del patrimonio neto: resumen, activos, deudas y su evolución mes a mes.
 * Usa el mismo cálculo que la pantalla Patrimonio, así que los números coinciden.
 * @param {AppData} data @param {string} today
 * @returns {Report}
 */
export function netWorthReport(data, today) {
  const summary = netWorthSummary(data, today);
  const now = summary.now;
  /** @param {{ changeCents: number, percent: number | null } | null} change */
  const variation = (change) => {
    if (change === null) return 'Sin registros de esa fecha para comparar';
    const percent = change.percent === null ? '' : ` (${change.percent > 0 ? '+' : ''}${(Math.round(change.percent * 10) / 10).toString()} %)`;
    return `${formatMoney(change.changeCents, { sign: true })}${percent}`;
  };

  const assets = [...now.assets].sort((a, b) => b.valueCents - a.valueCents);
  /** @type {import('./model.js').Sheet[]} */
  const sheets = [
    {
      name: 'Resumen',
      blocks: [
        {
          type: 'pairs',
          rows: [
            ['Patrimonio neto', money(now.netWorthCents)],
            ['Activos totales', money(now.assetsCents)],
            ['  Dinero disponible', money(now.availableCents)],
            ['  Ahorrado en metas', money(now.savedCents)],
            ['  Activos registrados a mano', money(now.assetsManualCents)],
            ['Pasivos totales (lo que debes)', money(now.liabilitiesCents)],
            ['Variación este mes', variation(summary.monthly)],
            ['Variación en el año', variation(summary.annual)],
          ],
        },
        { type: 'text', text: 'Patrimonio neto = Activos - Pasivos. Los activos registrados a mano valen lo que tú estimaste: ACCONTROL no los consulta en ningún mercado. Una deuda cuenta desde que se registra (o desde su primer pago).' },
      ],
    },
    {
      name: 'Activos',
      blocks: [
        {
          type: 'table',
          headers: ['Activo', 'Categoría', 'Tipo', 'Adquirido', 'Valor hoy', ''],
          rows: assets.map(({ asset, valueCents }) => [asset.name, ASSET_CATEGORIES[asset.category].label, assetTypeLabel(asset), date(asset.acquiredDate), money(valueCents), demoMark(asset)]),
          totals: assets.length > 0 ? ['Total', null, null, null, money(now.assetsManualCents), null] : undefined,
        },
      ],
    },
    {
      name: 'Deudas',
      blocks: [
        {
          type: 'table',
          headers: ['Deuda', 'Debes hoy', ''],
          rows: now.debts.map(({ debt, balanceCents }) => [debt.name, money(balanceCents), demoMark(debt)]),
          totals: now.debts.length > 0 ? ['Total', money(now.liabilitiesCents), null] : undefined,
        },
      ],
    },
    {
      name: 'Evolución',
      blocks: [
        {
          type: 'table',
          headers: ['Mes', 'Activos', 'Pasivos', 'Patrimonio neto'],
          rows: summary.series.map((x) => [monthLabel(x.monthKey), money(x.point.assetsCents), money(x.point.liabilitiesCents), money(x.point.netWorthCents)]),
        },
        { type: 'text', text: 'Cierre de cada mes; el último punto es hoy.' },
      ],
    },
  ];
  return {
    title: 'Patrimonio neto',
    subtitle: `ACCONTROL · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    sheets,
    fileBase: `accontrol-patrimonio-${today}`,
    csvSheet: 'Evolución',
  };
}

/**
 * Reporte de departamentos de un mes: cada área frente a su presupuesto, el detalle de los gastos del mes con su departamento y
 * lo que gastó cada área en los últimos 6 meses. Usa los mismos cálculos que la pantalla (domain/departments.js).
 * @param {AppData} data @param {string} monthKey "AAAA-MM" @param {string} today
 * @returns {Report}
 */
export function departmentsReport(data, monthKey, today) {
  const month = departmentMonth(data, monthKey, today);
  const { operating } = monthExpenses(data, monthKey, today);
  const names = new Map(data.departments.map((d) => [d.id, d.name]));
  const categoryName = (/** @type {string} */ id) => data.categories.find((c) => c.id === id)?.name ?? 'Sin categoría';
  const unassignedCount = month.unassignedCount;

  const areaRows = month.rows.map((r) => /** @type {Cell[]} */ ([
    r.department.name + (r.department.archived ? ' (archivado)' : ''),
    r.budgetCents > 0 ? money(r.budgetCents) : null,
    money(r.spentCents),
    int(r.count),
    r.percent === null ? null : pct(r.percent),
    r.remainingCents === null ? null : money(r.remainingCents),
    BUDGET_STATUS_LABELS[r.status],
    r.paceCents === null ? null : money(r.paceCents),
    demoMark(r.department),
  ]));
  areaRows.push(['Sin departamento', null, money(month.unassignedCents), int(unassignedCount), null, null, '', null, '']);

  const expenseRows = [...operating]
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt))
    .map((m) => /** @type {Cell[]} */ ([
      date(m.date), m.time, m.description, categoryName(m.categoryId), (m.departmentId && names.get(m.departmentId)) || 'Sin departamento', money(m.amountCents), demoMark(m),
    ]));

  const histories = month.rows.map((r) => ({ row: r, series: departmentHistory(data, r.department.id, monthKey, today) }));
  const monthKeys = histories[0]?.series.map((h) => h.monthKey) ?? [];
  const historyRows = histories.map(({ row, series }) => /** @type {Cell[]} */ ([row.department.name, ...series.map((h) => money(h.spentCents))]));

  return {
    title: `Reporte de departamentos — ${monthLabel(monthKey)}`,
    subtitle: `ACCONTROL · al ${today}`,
    notes: hasDemo(data) ? [DEMO_NOTE] : [],
    fileBase: `accontrol-departamentos-${monthKey}`,
    csvSheet: 'Resumen',
    sheets: [
      {
        name: 'Resumen',
        blocks: [
          {
            type: 'pairs',
            rows: [
              [`Gasto operativo de ${monthLabel(monthKey)}`, money(month.totalSpentCents)],
              ['Cargado a departamentos', money(month.assignedCents)],
              ['Sin departamento', money(month.unassignedCents)],
              ['Presupuesto de las áreas con presupuesto', money(month.budgetTotalCents)],
              ['Gastado en esas áreas', money(month.budgetedSpentCents)],
              ['Excedido (suma de lo que se pasaron las áreas excedidas)', money(month.overCents)],
              ['Queda sin gastar en las áreas dentro de su presupuesto', money(month.leftCents)],
              ['Áreas excedidas', int(month.overCount)],
              ['Pagos de deudas del mes (no incluidos)', money(month.debtPaymentsCents)],
            ],
          },
          { type: 'heading', text: 'Cada área frente a su presupuesto' },
          {
            type: 'table',
            headers: ['Departamento', 'Presupuesto mensual', 'Gastado', 'Gastos', '% del presupuesto', 'Queda o excedido', 'Estado', 'Cierre estimado (ritmo)', 'Marca'],
            rows: areaRows,
            totals: ['Gasto operativo del mes', money(month.budgetTotalCents), money(month.totalSpentCents), int(month.rows.reduce((n, r) => n + r.count, 0) + unassignedCount), null, null, '', null, ''],
          },
          { type: 'text', text: 'Lo gastado por un área es la suma de los gastos que se le cargaron en Finanzas: cada gasto cuenta una sola vez. Los pagos de deudas no son gasto operativo y no se cargan a departamentos. Estado: «En orden» por debajo del 80 % del presupuesto, «Cerca del límite» del 80 % al 100 % y «Excedido» por encima del 100 %. Cada mes se compara con el presupuesto actual del área (no se guarda el historial de presupuestos); un área archivada no tiene presupuesto. El cierre estimado solo se calcula en el mes en curso, desde el día 5: es una proyección lineal (gasto hasta hoy ÷ días transcurridos × días del mes), no una promesa. Son cuentas con reglas fijas, no inteligencia artificial.' },
        ],
      },
      {
        name: 'Gastos',
        blocks: [
          {
            type: 'table',
            headers: ['Fecha', 'Hora', 'Descripción', 'Categoría', 'Departamento', 'Monto', 'Marca'],
            rows: expenseRows,
            totals: ['Total', null, '', '', '', money(month.totalSpentCents), ''],
          },
        ],
      },
      {
        name: 'Últimos 6 meses',
        blocks: [
          {
            type: 'table',
            headers: ['Departamento', ...monthKeys.map((k) => `${monthShortLabel(k)} ${k.slice(0, 4)}`)],
            rows: historyRows,
          },
          { type: 'text', text: 'Lo gastado por cada área en cada mes, sin pagos de deudas. Los gastos sin departamento no aparecen aquí.' },
        ],
      },
    ],
  };
}
