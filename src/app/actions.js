// @ts-check
// =============================================================================
// ACCIONES COMUNES
// -----------------------------------------------------------------------------
// Botones con `data-action="..."` que funcionan igual en cualquier pantalla
// (añadir, editar, cargar demostración...). Las acciones propias de una
// pantalla (cambiar de mes, filtrar...) las maneja esa pantalla.
// =============================================================================

import { clientLabel } from '../domain/clients.js';
import { debtPortfolio } from '../domain/debts.js';
import { STOCK_KIND_LABELS } from '../domain/inventory.js';
import { invoiceLabel } from '../domain/invoices.js';
import { formatMoney } from '../domain/money.js';
import { GRANULARITIES } from '../domain/summaries.js';
import { isExportFormat, makeFile } from '../export/index.js';
import { saveFile } from '../ui/saveFile.js';
import { amortizationReport, clientsReport, debtsReport, departmentsReport, diagnosisReport, healthReport, inventoryReport, invoiceReport, invoicesReport, monthReport, netWorthReport, resultsReport, withWorkspaceHeader } from '../export/reports.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { openAssetForm, openValuationForm } from '../views/asset-forms.js';
import { openClientForm, openServiceForm } from '../views/client-forms.js';
import { openDepartmentForm } from '../views/department-forms.js';
import { openDebtForm, openPaymentForm } from '../views/debt-forms.js';
import { openProductForm, openStockForm, openSupplierForm } from '../views/inventory-forms.js';
import { copyInvoiceReminder, openInvoiceEditForm, openInvoiceForm, openInvoicePaymentForm } from '../views/invoice-forms.js';
import { copyStatement, openCreditForm, openCustomerPaymentForm } from '../views/fiado-forms.js';
import { printTicket } from '../ui/ticket.js';
import { openWorkspaceMenu } from '../views/workspaces.js';
import {
  openAddMenu, openAddSaving, openContributionForm, openGoalForm, openMovementForm,
} from '../views/forms.js';

/** @typedef {ReturnType<typeof import('./store.js').createStore>} Store */

/**
 * @param {Store} store
 * @param {string} name   valor de data-action
 * @param {HTMLElement} element  el botón pulsado
 * @returns {boolean} true si la acción era común y ya se manejó
 */
export function runCommonAction(store, name, element) {
  const { data } = store.getState();

  switch (name) {
    case 'add-menu':
      openAddMenu(store);
      return true;
    case 'workspace-menu':
      openWorkspaceMenu(store);
      return true;
    case 'add-income':
      openMovementForm(store, { type: 'income' });
      return true;
    case 'add-expense':
      openMovementForm(store, { type: 'expense' });
      return true;
    case 'add-saving':
      void openAddSaving(store);
      return true;
    case 'new-goal':
      openGoalForm(store, { goal: null });
      return true;
    case 'new-asset':
      openAssetForm(store, { asset: null });
      return true;
    case 'asset-edit': {
      const asset = data.assets.find((a) => a.id === element.dataset.id);
      if (asset) openAssetForm(store, { asset });
      return true;
    }
    case 'asset-value':
      openValuationForm(store, { assetId: element.dataset.id ?? '' });
      return true;
    case 'new-debt':
      openDebtForm(store, { debt: null });
      return true;
    case 'debt-pay':
      openPaymentForm(store, { debtId: element.dataset.id ?? '' });
      return true;
    case 'debt-edit': {
      const debt = data.debts.find((x) => x.id === element.dataset.id);
      if (debt) openDebtForm(store, { debt });
      return true;
    }
    case 'debt-payment-edit': {
      const payment = data.debtPayments.find((p) => p.id === element.dataset.id);
      if (payment) openPaymentForm(store, { debtId: payment.debtId, payment });
      return true;
    }
    case 'new-client':
      openClientForm(store, { client: null });
      return true;
    case 'client-edit': {
      const client = data.clients.find((c) => c.id === element.dataset.id);
      if (client) openClientForm(store, { client });
      return true;
    }
    case 'new-service':
      openServiceForm(store, { clientId: element.dataset.client ?? null });
      return true;
    case 'service-edit': {
      const service = data.services.find((x) => x.id === element.dataset.id);
      if (service) openServiceForm(store, { service });
      return true;
    }
    case 'client-pay':
      // «Registrar pago» de un cliente o de uno de sus servicios: un ingreso con el vínculo ya puesto.
      openMovementForm(store, { type: 'income', clientId: element.dataset.client || null, serviceId: element.dataset.service || null });
      return true;
    case 'client-expense':
      // «Registrar gasto» desde la ficha de un cliente: un gasto con el cliente ya elegido.
      openMovementForm(store, { type: 'expense', clientId: element.dataset.client || null });
      return true;
    case 'client-archive':
      void archiveClient(store, element.dataset.id ?? '', element.dataset.archived === 'true');
      return true;
    case 'client-delete':
      void deleteClient(store, element.dataset.id ?? '');
      return true;
    case 'service-delete':
      void deleteService(store, element.dataset.id ?? '');
      return true;
    case 'new-product':
      openProductForm(store);
      return true;
    case 'product-edit': {
      const product = data.products.find((x) => x.id === element.dataset.id);
      if (product) openProductForm(store, { product });
      return true;
    }
    case 'product-archive':
      void archiveProduct(store, element.dataset.id ?? '', element.dataset.archived === 'true');
      return true;
    case 'product-delete':
      void deleteProduct(store, element.dataset.id ?? '');
      return true;
    case 'new-supplier':
      openSupplierForm(store);
      return true;
    case 'supplier-edit': {
      const supplier = data.suppliers.find((x) => x.id === element.dataset.id);
      if (supplier) openSupplierForm(store, { supplier });
      return true;
    }
    case 'stock-buy':
      openStockForm(store, { kind: 'purchase', productId: element.dataset.product ?? '' });
      return true;
    case 'stock-sell':
      openStockForm(store, { kind: 'sale', productId: element.dataset.product ?? '' });
      return true;
    case 'stock-adjust':
      openStockForm(store, { kind: 'adjustment', productId: element.dataset.product ?? '' });
      return true;
    case 'stock-delete':
      void deleteStockEntry(store, element.dataset.id ?? '');
      return true;
    case 'new-department':
      openDepartmentForm(store);
      return true;
    case 'department-edit': {
      const department = data.departments.find((x) => x.id === element.dataset.id);
      if (department) openDepartmentForm(store, { department });
      return true;
    }
    case 'new-invoice':
      // Desde la ficha de un cliente o de un servicio (Freelancer), la factura se abre ya con ellos elegidos.
      openInvoiceForm(store, { clientId: element.dataset.clientId ?? '', serviceId: element.dataset.serviceId ?? '' });
      return true;
    case 'invoice-ticket':
      printTicket(store, element.dataset.id ?? '');
      return true;
    case 'pos-open':
      window.location.hash = '#/caja';
      return true;
    case 'credit-new':
      // Desde la ficha de un cliente del fiado, ya con su nombre y su teléfono.
      openCreditForm(store, { customerName: element.dataset.name ?? '', customerContact: element.dataset.contact ?? '' });
      return true;
    case 'credit-pay':
      openCustomerPaymentForm(store, { key: element.dataset.key ?? '' });
      return true;
    case 'credit-statement':
      void copyStatement(store, element.dataset.key ?? '');
      return true;
    case 'invoice-reminder':
      void copyInvoiceReminder(store, element.dataset.id ?? '');
      return true;
    case 'invoice-edit': {
      const invoice = data.invoices.find((x) => x.id === element.dataset.id);
      if (invoice) openInvoiceEditForm(store, { invoice });
      return true;
    }
    case 'invoice-pay':
      openInvoicePaymentForm(store, { invoiceId: element.dataset.id ?? '' });
      return true;
    case 'invoice-void':
      void voidInvoice(store, element.dataset.id ?? '');
      return true;
    case 'invoice-payment-delete':
      void deleteInvoicePayment(store, element.dataset.id ?? '');
      return true;
    case 'edit-movement': {
      // El ingreso de un cobro de factura se maneja desde la factura.
      const collected = data.invoicePayments.find((p) => p.movementId === element.dataset.id);
      if (collected) {
        window.location.hash = `#/facturas/${collected.invoiceId}`;
        toast('Este ingreso es el cobro de una factura. Elimínalo desde la ficha de la factura.', 'info');
        return true;
      }
      // El gasto de una compra o el ingreso de una venta de inventario se maneja desde el producto.
      const stock = data.stockEntries.find((e) => e.movementId === element.dataset.id);
      if (stock) {
        window.location.hash = `#/inventario/${stock.productId}`;
        toast('Este movimiento viene de una compra o una venta de inventario. Elimínalo desde el historial del producto.', 'info');
        return true;
      }
      // El gasto de un pago de deuda no se edita suelto: se edita el pago, y el gasto se actualiza solo.
      const linked = data.debtPayments.find((p) => p.movementId === element.dataset.id);
      if (linked) {
        window.location.hash = `#/deudas/${linked.debtId}`;
        toast('Este gasto es el pago de una deuda. Edítalo desde el detalle de la deuda.', 'info');
        return true;
      }
      const movement = data.movements.find((m) => m.id === element.dataset.id);
      if (movement) openMovementForm(store, { type: movement.type, movement });
      return true;
    }
    case 'edit-contribution': {
      const contribution = data.contributions.find((c) => c.id === element.dataset.id);
      if (contribution) openContributionForm(store, { contribution });
      return true;
    }
    case 'export':
      runExport(store, element);
      return true;
    case 'go':
      window.location.hash = `#/${element.dataset.route ?? 'inicio'}`;
      return true;
    case 'reload':
      window.location.reload();
      return true;
    case 'load-demo':
      void loadDemo(store);
      return true;
    case 'remove-demo':
      void removeDemo(store);
      return true;
    default:
      return false;
  }
}

/** @param {Store} store @param {string} id @param {boolean} archived */
async function archiveClient(store, id, archived) {
  const result = await store.setClientArchived(id, archived);
  if (result.ok) toast(archived ? 'Cliente archivado. Su historial se conserva.' : 'Cliente reactivado.');
  else toast(result.errors.form ?? 'No se pudo guardar el cambio.', 'error');
}

/** @param {Store} store @param {string} id */
async function deleteClient(store, id) {
  const client = store.getState().data.clients.find((c) => c.id === id);
  if (!client) return;
  const ok = await confirmDialog({
    title: '¿Eliminar este cliente?',
    message: `Se borrará «${clientLabel(client)}». Solo se puede borrar un cliente que no tenga servicios ni pagos; si los tiene, archívalo. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  const result = await store.deleteClient(id);
  if (result.ok) {
    toast('Cliente eliminado.');
    window.location.hash = '#/clientes';
  } else toast(result.errors.form ?? 'No se pudo eliminar.', 'error');
}

/** @param {Store} store @param {string} id */
async function deleteService(store, id) {
  const service = store.getState().data.services.find((x) => x.id === id);
  if (!service) return;
  const ok = await confirmDialog({
    title: '¿Eliminar este servicio?',
    message: `Se borrará «${service.name}». Si ya tiene pagos registrados no se puede borrar: márcalo como Cancelado. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  const result = await store.deleteService(id);
  if (result.ok) toast('Servicio eliminado.');
  else toast(result.errors.form ?? 'No se pudo eliminar.', 'error');
}

/** @param {Store} store @param {string} id @param {boolean} archived */
async function archiveProduct(store, id, archived) {
  const result = await store.setProductArchived(id, archived);
  if (result.ok) toast(archived ? 'Producto archivado. Su historial se conserva.' : 'Producto reactivado.');
  else toast(result.errors.form ?? 'No se pudo guardar el cambio.', 'error');
}

/** @param {Store} store @param {string} id */
async function deleteProduct(store, id) {
  const product = store.getState().data.products.find((x) => x.id === id);
  if (!product) return;
  const ok = await confirmDialog({
    title: '¿Eliminar este producto?',
    message: `Se borrará «${product.name}». Solo se puede borrar un producto sin compras, ventas ni ajustes; si los tiene, archívalo. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  const result = await store.deleteProduct(id);
  if (result.ok) {
    toast('Producto eliminado.');
    window.location.hash = '#/inventario';
  } else toast(result.errors.form ?? 'No se pudo eliminar.', 'error');
}

/** @param {Store} store @param {string} id */
async function deleteStockEntry(store, id) {
  const { data } = store.getState();
  const entry = data.stockEntries.find((e) => e.id === id);
  if (!entry) return;
  const product = data.products.find((x) => x.id === entry.productId);
  const units = Math.abs(entry.quantity);
  const movement = entry.movementId ? data.movements.find((m) => m.id === entry.movementId) : null;
  const what = entry.kind === 'adjustment' ? `este ajuste de ${entry.quantity > 0 ? '+' : '−'}${units}` : `esta ${STOCK_KIND_LABELS[entry.kind].toLowerCase()} de ${units} × ${product?.name ?? 'producto'}`;
  const ok = await confirmDialog({
    title: '¿Eliminar este movimiento de stock?',
    message: `Se borrará ${what}${movement ? ` y también ${entry.kind === 'purchase' ? 'el gasto' : 'el ingreso'} de ${formatMoney(movement.amountCents)} que se anotó en Movimientos` : ''}. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  const result = await store.deleteStockEntry(id);
  if (result.ok) toast('Movimiento eliminado.');
  else toast(result.errors.form ?? 'No se pudo eliminar.', 'error');
}

/** @param {Store} store @param {string} id */
async function voidInvoice(store, id) {
  const { data } = store.getState();
  const invoice = data.invoices.find((i) => i.id === id);
  if (!invoice) return;
  const stockBack = data.stockEntries.filter((e) => e.invoiceId === id).length > 0;
  const ok = await confirmDialog({
    title: '¿Anular esta factura?',
    message: `Se anulará la factura ${invoiceLabel(invoice)} de ${invoice.customerName}. Conserva su número, pero deja de contar como vigente${stockBack ? ' y las unidades de inventario vuelven al stock' : ''}. No se puede deshacer: si te equivocaste, emite otra.`,
    confirmLabel: 'Anular factura',
    danger: true,
  });
  if (!ok) return;
  const result = await store.voidInvoice(id);
  if (result.ok) toast(`Factura ${invoiceLabel(invoice)} anulada.`);
  else toast(result.errors.form ?? 'No se pudo anular.', 'error');
}

/** @param {Store} store @param {string} id */
async function deleteInvoicePayment(store, id) {
  const { data } = store.getState();
  const payment = data.invoicePayments.find((p) => p.id === id);
  if (!payment) return;
  const invoice = data.invoices.find((i) => i.id === payment.invoiceId);
  const ok = await confirmDialog({
    title: '¿Eliminar este cobro?',
    message: `Se borrará el cobro de ${formatMoney(payment.amountCents)}${invoice ? ` de la factura ${invoiceLabel(invoice)}` : ''} y también el ingreso que se anotó en Movimientos. La factura vuelve a deber ese monto. Esta acción no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  const result = await store.deleteInvoicePayment(id);
  if (result.ok) toast('Cobro eliminado.');
  else toast(result.errors.form ?? 'No se pudo eliminar.', 'error');
}

/** @param {Store} store */
async function loadDemo(store) {
  const result = await store.loadDemoData();
  if (result.ok) toast('Datos de demostración cargados. Todos llevan la etiqueta DEMO.', 'info');
  else toast(result.errors.form, 'error');
}

/** @param {Store} store */
async function removeDemo(store) {
  const ok = await confirmDialog({
    title: '¿Borrar los datos de demostración?',
    message: 'Se borrarán solo los registros marcados como DEMO. Lo que hayas registrado tú no se toca.',
    confirmLabel: 'Borrar demostración',
    danger: true,
  });
  if (!ok) return;
  const result = await store.removeDemoData();
  if (result.ok) toast('Datos de demostración borrados.');
  else toast(result.errors.form, 'error');
}

/**
 * Genera y descarga un reporte (PDF, Excel o CSV) con los datos que hay ahora en pantalla.
 * @param {Store} store @param {HTMLElement} element
 */
function runExport(store, element) {
  const format = element.dataset.format ?? '';
  const kind = element.dataset.kind;
  if (!isExportFormat(format)) return;
  const { data } = store.getState();
  const today = store.today();
  try {
    /** @type {import('../export/model.js').Report | null} */
    let report = null;
    if (kind === 'month') report = monthReport(data, element.dataset.month || today.slice(0, 7), today);
    else if (kind === 'debts') report = debtsReport(data, today);
    else if (kind === 'networth') report = netWorthReport(data, today);
    else if (kind === 'clients') report = clientsReport(data, today);
    else if (kind === 'health') report = healthReport(data, today);
    else if (kind === 'diagnosis') report = diagnosisReport(data, today);
    else if (kind === 'inventory') report = inventoryReport(data, today);
    else if (kind === 'invoices') report = invoicesReport(data, today);
    else if (kind === 'departments') report = departmentsReport(data, element.dataset.month || today.slice(0, 7), today);
    else if (kind === 'invoice') {
      const invoice = data.invoices.find((i) => i.id === element.dataset.id);
      if (invoice) report = invoiceReport(data, invoice, today);
    }
    else if (kind === 'results') {
      const granularity = GRANULARITIES.find((g) => g === element.dataset.granularity) ?? 'month';
      report = resultsReport(data, granularity, element.dataset.month || today.slice(0, 7), today);
    }
    else if (kind === 'debt') {
      const item = debtPortfolio(data, today).items.find((i) => i.debt.id === element.dataset.id);
      if (item) report = amortizationReport(item, today);
    }
    if (!report) {
      toast('No se encontró lo que querías exportar.', 'error');
      return;
    }
    const file = makeFile(withWorkspaceHeader(report, store.activeWorkspace()), format, store.now());
    void saveFile(file, { done: `Listo: ${file.filename}.` });
  } catch (error) {
    toast('No se pudo crear el archivo. Intenta de nuevo.', 'error');
    console.error(error);
  }
}
