// @ts-check
// =============================================================================
// INVENTARIO, PROVEEDORES, COMPRAS Y VENTAS (espacios Emprendedor y Empresa)
// -----------------------------------------------------------------------------
// Un PRODUCTO es algo que compras y vendes. Su STOCK no se guarda: se calcula siempre
// sumando sus MOVIMIENTOS DE STOCK (compras entran, ventas salen, ajustes de cualquier
// signo), así no se puede desincronizar. Las cantidades son siempre números ENTEROS.
//
// El dinero no se duplica: una compra o una venta crea, junto con su movimiento de stock,
// un gasto o un ingreso normal (Finanzas). Así cuenta una sola vez en «Disponible», en los
// resultados y en los reportes; y se borran juntos.
//
// VALORACIÓN por COSTO PROMEDIO: cada compra sube el valor del inventario por lo que costó;
// cada venta (o merma) baja el valor en proporción a las unidades que salen, al costo
// promedio de ese momento. Todo en centavos enteros: el valor del inventario es siempre la
// suma de lo comprado menos lo que ya salió, sin decimales perdidos.
//
// Regla de oro: en ningún momento del tiempo el stock puede ser negativo. Se comprueba al
// registrar, también para fechas pasadas, y al borrar (no se borra una compra que ya se vendió).
// =============================================================================

import { EMAIL_ERROR, PHONE_ERROR, cleanText, isValidEmail, isValidPhone } from './contact.js';
import { formatDate, isValidISODate } from './dates.js';
import { MAX_CENTS, parseMoney } from './money.js';
import { CLASSIFICATIONS_BY_TYPE, LIMITS } from './types.js';

/** @typedef {import('./types.js').Product} Product */
/** @typedef {import('./types.js').Supplier} Supplier */
/** @typedef {import('./types.js').StockEntry} StockEntry */
/** @typedef {import('./types.js').StockKind} StockKind */
/** @typedef {import('./types.js').Movement} Movement */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').Department} Department */
/** @typedef {import('./types.js').AppData} AppData */

/** @type {readonly StockKind[]} */
export const STOCK_KINDS = ['purchase', 'sale', 'adjustment'];

/** @type {Record<StockKind, string>} */
export const STOCK_KIND_LABELS = { purchase: 'Compra', sale: 'Venta', adjustment: 'Ajuste' };

/** Máximo de unidades en un solo movimiento de stock. */
export const MAX_QUANTITY = 1_000_000;
export const MIN_STOCK_DATE = '2000-01-01';
export const DEFAULT_UNIT = 'unidad';

/** @param {unknown} value @returns {value is StockKind} */
export function isStockKind(value) {
  return typeof value === 'string' && /** @type {readonly string[]} */ (STOCK_KINDS).includes(value);
}

/**
 * ¿Se ofrece el inventario en este espacio? En Emprendedor y Empresa siempre; en los demás, solo si ya hay datos de inventario
 * (por ejemplo, si se restauró una copia que los traía), para que nunca queden datos escondidos.
 * @param {string | null | undefined} workspaceKind @param {Pick<AppData, 'products' | 'suppliers' | 'stockEntries'>} data
 */
export function inventoryEnabled(workspaceKind, data) {
  return workspaceKind === 'entrepreneur' || workspaceKind === 'company' || data.products.length > 0 || data.suppliers.length > 0 || data.stockEntries.length > 0;
}

/** @param {string} text */
const fold = (text) => text.toLocaleLowerCase('es');

// ---- Campos de la caja (0.17.0): los productos de antes no los tienen, y eso significa «como siempre» ----------

/** ¿Se cuentan las unidades de este producto? (ausente = sí) @param {Pick<Product, 'trackStock'>} p */
export const tracksStock = (p) => p.trackStock !== false;
/** Su grupo ('' = sin grupo). @param {Pick<Product, 'groupName'>} p */
export const productGroup = (p) => p.groupName ?? '';
/** Su foto ('' = sin foto). @param {Pick<Product, 'imageData'>} p */
export const productImage = (p) => p.imageData ?? '';

/** Solo fotos JPG, PNG o WEBP en base64 (nunca SVG ni otros formatos, que pueden llevar código). */
const IMAGE_PATTERN = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** ¿Es una foto que se puede guardar? ('' = sin foto, también vale) @param {unknown} value */
export function isValidProductImage(value) {
  return value === '' || (typeof value === 'string' && value.length <= LIMITS.productImage && IMAGE_PATTERN.test(value));
}

/** Los grupos que ya usas (para sugerirlos), en orden alfabético y sin repetir. @param {Product[]} products */
export function productGroups(products) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const p of sortProducts(products)) {
    const g = productGroup(p);
    if (g && !seen.has(fold(g))) seen.set(fold(g), g);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/** a ÷ b redondeado al entero más cercano (mitades hacia arriba), sin perder precisión en números grandes. @param {number} a @param {number} b */
function roundDiv(a, b) {
  const num = BigInt(a);
  const den = BigInt(b);
  return Number((num * 2n + den) / (den * 2n));
}

/** valor × cantidad ÷ stock, redondeado, sin desbordar. @param {number} value @param {number} qty @param {number} stock */
function proportion(value, qty, stock) {
  return Number((BigInt(value) * BigInt(qty) * 2n + BigInt(stock)) / (BigInt(stock) * 2n));
}

// ---- Productos ------------------------------------------------------------------------------------

/**
 * Lo que llega del formulario (todo es texto).
 * @typedef {Object} ProductInput
 * @property {string} name @property {string} [sku] @property {string} [unit] @property {string} [priceText]
 * @property {string} [minStockText] @property {string} [notes]
 * @property {string} [groupText]    0.17.0: grupo para la caja.
 * @property {boolean} [trackStock]  0.17.0: false = sin control de stock (por defecto, true).
 * @property {string} [imageData]    0.17.0: foto ya reducida por la pantalla ('' = sin foto).
 */

/** @typedef {Pick<Product, 'name' | 'sku' | 'unit' | 'priceCents' | 'minStock' | 'notes'> & { groupName: string, trackStock: boolean, imageData: string }} ProductValue */

/**
 * Valida un producto. Solo el nombre es obligatorio. No se permiten dos productos con el mismo nombre ni el mismo código.
 * @param {ProductInput} input
 * Un producto que ya tiene movimientos de stock no puede pasar a «sin control de stock» (sus unidades quedarían sin explicar).
 * @param {{ products: Product[], exceptId?: string | null, stockEntries?: number }} context  stockEntries: cuántos movimientos de stock tiene.
 * @returns {{ ok: true, value: ProductValue } | { ok: false, errors: Record<string, string> }}
 */
export function validateProduct(input, { products, exceptId = null, stockEntries = 0 }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const name = cleanText(input.name);
  const sku = cleanText(input.sku);
  const unit = cleanText(input.unit) || DEFAULT_UNIT;
  const notes = cleanText(input.notes);

  if (!name) errors.name = 'Ponle un nombre al producto.';
  else if (name.length > LIMITS.productName) errors.name = `Máximo ${LIMITS.productName} caracteres.`;
  else if (products.some((p) => p.id !== exceptId && fold(p.name) === fold(name))) errors.name = 'Ya tienes un producto con ese nombre.';

  if (sku.length > LIMITS.productSku) errors.sku = `Máximo ${LIMITS.productSku} caracteres.`;
  else if (sku && products.some((p) => p.id !== exceptId && p.sku && fold(p.sku) === fold(sku))) errors.sku = 'Ya tienes un producto con ese código.';

  if (unit.length > LIMITS.productUnit) errors.unit = `Máximo ${LIMITS.productUnit} caracteres.`;
  if (notes.length > LIMITS.productNotes) errors.notes = `Máximo ${LIMITS.productNotes} caracteres.`;

  let priceCents = 0;
  const priceText = cleanText(input.priceText);
  if (priceText) {
    const money = parseMoney(priceText);
    if (!money.ok) errors.price = money.error;
    else if (money.cents > MAX_CENTS) errors.price = 'El monto es demasiado grande.';
    else priceCents = money.cents;
  }

  let minStock = 0;
  const minText = cleanText(input.minStockText);
  if (minText) {
    if (!/^\d{1,7}$/.test(minText) || Number(minText) > MAX_QUANTITY) errors.minStock = `Escribe un número entero de 0 a ${MAX_QUANTITY.toLocaleString('en-US')}, o déjalo vacío.`;
    else minStock = Number(minText);
  }

  const groupName = cleanText(input.groupText);
  if (groupName.length > LIMITS.productGroup) errors.group = `Máximo ${LIMITS.productGroup} caracteres.`;

  const trackStock = input.trackStock !== false;
  if (!trackStock && stockEntries > 0) {
    errors.trackStock = 'Este producto ya tiene compras, ventas o ajustes de stock: no puede pasar a «sin control de stock». Archívalo y crea otro sin control.';
  }
  // Sin control de stock no hay aviso de stock bajo.
  if (!trackStock) minStock = 0;

  const imageData = input.imageData ?? '';
  if (!isValidProductImage(imageData)) errors.image = 'Esa foto no se puede guardar. Elige otra (JPG, PNG o WEBP).';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, sku, unit, priceCents, minStock, notes, groupName, trackStock, imageData } };
}

/** @param {ProductValue} value @param {{ id: string, nowISO: string }} extra @returns {Product} */
export function buildProduct(value, { id, nowISO }) {
  return { id, ...value, archived: false, createdAt: nowISO, updatedAt: nowISO };
}

/** Conserva id, fecha de creación, archivado y marca de demostración. @param {Product} existing @param {ProductValue} value @param {string} nowISO @returns {Product} */
export function applyProductEdit(existing, value, nowISO) {
  return { ...existing, ...value, updatedAt: nowISO };
}

/** Alfabético (sin importar tildes ni mayúsculas); los archivados al final. @param {Product[]} list */
export function sortProducts(list) {
  return [...list].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/**
 * Cuánto está usado un producto: solo se borra si no tiene movimientos de stock ni aparece en una factura (aunque esté anulada).
 * @param {Pick<AppData, 'stockEntries'> & Partial<Pick<AppData, 'invoices'>>} data @param {string} productId
 */
export function productUsage(data, productId) {
  return {
    entries: data.stockEntries.filter((e) => e.productId === productId).length,
    invoices: (data.invoices ?? []).filter((i) => i.lines.some((l) => l.productId === productId)).length,
  };
}

// ---- Proveedores ----------------------------------------------------------------------------------

/**
 * @typedef {Object} SupplierInput
 * @property {string} name @property {string} [contact] @property {string} [email] @property {string} [phone] @property {string} [notes]
 */

/** @typedef {Pick<Supplier, 'name' | 'contact' | 'email' | 'phone' | 'notes'>} SupplierValue */

/**
 * Valida un proveedor. Solo el nombre es obligatorio; no se repite el nombre.
 * @param {SupplierInput} input
 * @param {{ suppliers: Supplier[], exceptId?: string | null }} context
 * @returns {{ ok: true, value: SupplierValue } | { ok: false, errors: Record<string, string> }}
 */
export function validateSupplier(input, { suppliers, exceptId = null }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const name = cleanText(input.name);
  const contact = cleanText(input.contact);
  const email = cleanText(input.email).replace(/\s+/g, '');
  const phone = cleanText(input.phone);
  const notes = cleanText(input.notes);

  if (!name) errors.name = 'Escribe el nombre del proveedor.';
  else if (name.length > LIMITS.supplierName) errors.name = `Máximo ${LIMITS.supplierName} caracteres.`;
  else if (suppliers.some((s) => s.id !== exceptId && fold(s.name) === fold(name))) errors.name = 'Ya tienes un proveedor con ese nombre.';
  if (contact.length > LIMITS.supplierContact) errors.contact = `Máximo ${LIMITS.supplierContact} caracteres.`;
  if (email.length > LIMITS.supplierEmail) errors.email = `Máximo ${LIMITS.supplierEmail} caracteres.`;
  else if (email && !isValidEmail(email)) errors.email = EMAIL_ERROR;
  if (phone.length > LIMITS.supplierPhone) errors.phone = `Máximo ${LIMITS.supplierPhone} caracteres.`;
  else if (phone && !isValidPhone(phone)) errors.phone = PHONE_ERROR;
  if (notes.length > LIMITS.supplierNotes) errors.notes = `Máximo ${LIMITS.supplierNotes} caracteres.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, contact, email, phone, notes } };
}

/** @param {SupplierValue} value @param {{ id: string, nowISO: string }} extra @returns {Supplier} */
export function buildSupplier(value, { id, nowISO }) {
  return { id, ...value, archived: false, createdAt: nowISO, updatedAt: nowISO };
}

/** @param {Supplier} existing @param {SupplierValue} value @param {string} nowISO @returns {Supplier} */
export function applySupplierEdit(existing, value, nowISO) {
  return { ...existing, ...value, updatedAt: nowISO };
}

/** Alfabético; los archivados al final. @param {Supplier[]} list */
export function sortSuppliers(list) {
  return [...list].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/** Cuánto está usado un proveedor: solo se borra si no tiene compras. @param {Pick<AppData, 'stockEntries'>} data @param {string} supplierId */
export function supplierUsage(data, supplierId) {
  return { purchases: data.stockEntries.filter((e) => e.supplierId === supplierId).length };
}

// ---- Cálculo del stock y del valor (la parte delicada) --------------------------------------------

/** Orden cronológico estable: fecha, hora, creación e id. @param {StockEntry[]} entries */
export function sortEntries(entries) {
  return [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * @typedef {Object} ReplayRow
 * @property {StockEntry} entry
 * @property {number} stockAfter       Unidades que quedan después de este movimiento.
 * @property {number} valueAfterCents  Valor del inventario de este producto después de este movimiento.
 * @property {number} costCents        Lo que costaron las unidades que salieron (0 si el movimiento suma).
 */

/**
 * @typedef {Object} Replay
 * @property {ReplayRow[]} rows
 * @property {number} stock
 * @property {number} valueCents
 * @property {{ entry: StockEntry, available: number } | null} firstNegative  Primer movimiento que deja el stock en negativo, si lo hay.
 */

/**
 * Recorre en orden los movimientos de UN producto y va llevando el stock y su valor a costo promedio.
 * @param {StockEntry[]} entries Los de un solo producto, en cualquier orden.
 * @returns {Replay}
 */
export function replayProduct(entries) {
  /** @type {ReplayRow[]} */
  const rows = [];
  let stock = 0;
  let value = 0;
  /** @type {Replay['firstNegative']} */
  let firstNegative = null;
  for (const entry of sortEntries(entries)) {
    let costCents = 0;
    if (entry.quantity > 0) {
      stock += entry.quantity;
      value += entry.quantity * entry.unitCents;
    } else {
      const out = -entry.quantity;
      if (out > stock && !firstNegative) firstNegative = { entry, available: Math.max(stock, 0) };
      if (stock > 0) costCents = out >= stock ? value : proportion(value, out, stock);
      stock -= out;
      value -= costCents;
    }
    rows.push({ entry, stockAfter: stock, valueAfterCents: value, costCents });
  }
  return { rows, stock, valueCents: value, firstNegative };
}

/** @param {StockEntry[]} entries @returns {Map<string, StockEntry[]>} */
function groupByProduct(entries) {
  /** @type {Map<string, StockEntry[]>} */
  const map = new Map();
  for (const e of entries) {
    const list = map.get(e.productId);
    if (list) list.push(e);
    else map.set(e.productId, [e]);
  }
  return map;
}

/**
 * @typedef {Object} StockPosition
 * @property {Product} product
 * @property {number} stock
 * @property {number} valueCents
 * @property {number} avgCostCents   Costo promedio por unidad (0 si no hay stock).
 * @property {'ok' | 'low' | 'out' | 'untracked'} status  out = sin unidades; low = en el nivel de aviso o por debajo (solo si el producto
 *   tiene aviso); untracked = sin control de stock (0.17.0: no se cuentan sus unidades).
 */

/**
 * Stock, valor y estado de cada producto (los archivados incluidos), en el orden de `sortProducts`.
 * @param {Pick<AppData, 'products' | 'stockEntries'>} data
 * @returns {StockPosition[]}
 */
export function stockPositions(data) {
  const grouped = groupByProduct(data.stockEntries);
  return sortProducts(data.products).map((product) => {
    const replay = replayProduct(grouped.get(product.id) ?? []);
    const stock = replay.stock;
    /** @type {StockPosition['status']} */
    let status = 'ok';
    if (!tracksStock(product)) status = 'untracked';
    else if (stock <= 0) status = 'out';
    else if (product.minStock > 0 && stock <= product.minStock) status = 'low';
    return { product, stock, valueCents: replay.valueCents, avgCostCents: stock > 0 ? roundDiv(replay.valueCents, stock) : 0, status };
  });
}

// ---- Filtros de la lista de productos (0.16.2) ---------------------------------------------------

/** @typedef {'active' | 'low' | 'out' | 'in_stock' | 'untracked' | 'archived'} ProductFilter */

/** @type {readonly { id: ProductFilter, label: string }[]} */
export const PRODUCT_FILTERS = [
  { id: 'active', label: 'Todos' },
  { id: 'low', label: 'Stock bajo' },
  { id: 'out', label: 'Agotados' },
  { id: 'in_stock', label: 'Con stock' },
  { id: 'untracked', label: 'Sin conteo' },
  { id: 'archived', label: 'Archivados' },
];

/** @param {unknown} value @returns {value is ProductFilter} */
export function isProductFilter(value) {
  return PRODUCT_FILTERS.some((f) => f.id === value);
}

/** Texto sin tildes y en minúsculas, para buscar «cafe» y encontrar «Café». @param {string} text */
export const searchable = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');

/**
 * ¿Entra esta posición en el filtro? Los productos archivados solo aparecen en «Archivados».
 *  - Stock bajo: productos con aviso (stock mínimo > 0) que están en el aviso o por debajo, incluidos los agotados (igual que el aviso de arriba).
 *  - Agotados: sin unidades (0 o menos), tengan aviso o no.
 *  - Con stock: al menos una unidad.
 * @param {StockPosition} p @param {ProductFilter} filter
 */
export function matchesProductFilter(p, filter) {
  if (filter === 'archived') return p.product.archived;
  if (p.product.archived) return false;
  // Sin control de stock (0.17.0): no están bajos, ni agotados, ni con stock: tienen su propio filtro.
  if (filter === 'untracked') return p.status === 'untracked';
  if (p.status === 'untracked') return filter === 'active';
  if (filter === 'low') return p.product.minStock > 0 && p.stock <= p.product.minStock;
  if (filter === 'out') return p.stock <= 0;
  if (filter === 'in_stock') return p.stock > 0;
  return true;
}

/**
 * Filtra y busca (por nombre, código o notas, sin mirar tildes ni mayúsculas). Conserva el orden recibido.
 * @param {StockPosition[]} positions @param {{ filter: ProductFilter, query: string }} options
 */
export function filterStockPositions(positions, { filter, query }) {
  const needle = searchable(query.trim());
  return positions.filter(
    (p) => matchesProductFilter(p, filter) && (!needle || searchable(`${p.product.name} ${p.product.sku} ${p.product.notes}`).includes(needle)),
  );
}

/** Cuántos productos hay en cada filtro (para mostrarlo en los botones). @param {StockPosition[]} positions */
export function productFilterCounts(positions) {
  /** @type {Record<ProductFilter, number>} */
  const counts = { active: 0, low: 0, out: 0, in_stock: 0, untracked: 0, archived: 0 };
  for (const p of positions) for (const f of PRODUCT_FILTERS) if (matchesProductFilter(p, f.id)) counts[f.id] += 1;
  return counts;
}

/**
 * Resumen general del inventario (los productos archivados con stock siguen contando en el valor).
 * @param {Pick<AppData, 'products' | 'stockEntries'>} data
 */
export function inventorySummary(data) {
  const positions = stockPositions(data);
  const active = positions.filter((p) => !p.product.archived);
  // Aviso de stock bajo: solo productos activos que pidieron aviso (stock mínimo > 0).
  const alerts = active.filter((p) => p.status !== 'untracked' && p.product.minStock > 0 && p.stock <= p.product.minStock);
  return {
    positions,
    totalValueCents: positions.reduce((sum, p) => sum + p.valueCents, 0),
    totalUnits: positions.reduce((sum, p) => sum + Math.max(p.stock, 0), 0),
    activeProducts: active.length,
    outCount: active.filter((p) => p.status === 'out').length,
    alerts,
  };
}

// ---- Ventas y margen ------------------------------------------------------------------------------

/**
 * @typedef {Object} ProductSales
 * @property {Product} product
 * @property {number} units          Unidades vendidas.
 * @property {number} revenueCents   Lo vendido (cantidad × precio de cada venta).
 * @property {number} costCents      Lo que costaron esas unidades (costo promedio del momento).
 * @property {number} profitCents    Ventas menos costo.
 * @property {number | null} marginPercent  Ganancia ÷ ventas (null si no hubo ventas).
 */

/**
 * Ventas, costo de lo vendido y ganancia bruta entre dos fechas (ambas incluidas). Las mermas (ajustes que restan) se suman aparte.
 * Es una vista del producto: Resultados sigue contando el dinero cuando entra y sale (base de caja).
 * @param {Pick<AppData, 'products' | 'stockEntries'>} data @param {string} from @param {string} to
 */
export function salesAnalysis(data, from, to) {
  const grouped = groupByProduct(data.stockEntries);
  /** @type {ProductSales[]} */
  const byProduct = [];
  let shrinkCostCents = 0;
  let shrinkUnits = 0;
  for (const product of data.products) {
    const replay = replayProduct(grouped.get(product.id) ?? []);
    let units = 0;
    let revenue = 0;
    let cost = 0;
    for (const row of replay.rows) {
      const e = row.entry;
      if (e.date < from || e.date > to) continue;
      if (e.kind === 'sale') {
        units += -e.quantity;
        revenue += -e.quantity * e.unitCents;
        cost += row.costCents;
      } else if (e.quantity < 0) {
        shrinkCostCents += row.costCents;
        shrinkUnits += -e.quantity;
      }
    }
    if (units > 0) {
      byProduct.push({ product, units, revenueCents: revenue, costCents: cost, profitCents: revenue - cost, marginPercent: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null });
    }
  }
  byProduct.sort((a, b) => b.revenueCents - a.revenueCents || a.product.name.localeCompare(b.product.name, 'es', { sensitivity: 'base' }) || a.product.id.localeCompare(b.product.id));
  const revenueCents = byProduct.reduce((s, r) => s + r.revenueCents, 0);
  const costCents = byProduct.reduce((s, r) => s + r.costCents, 0);
  return {
    byProduct,
    units: byProduct.reduce((s, r) => s + r.units, 0),
    revenueCents,
    costCents,
    profitCents: revenueCents - costCents,
    marginPercent: revenueCents > 0 ? ((revenueCents - costCents) / revenueCents) * 100 : null,
    shrinkCostCents,
    shrinkUnits,
  };
}

/**
 * Compras por proveedor: cuántas y cuánto se les compró.
 * @param {Pick<AppData, 'suppliers' | 'stockEntries'>} data
 */
export function supplierTotals(data) {
  return sortSuppliers(data.suppliers).map((supplier) => {
    const purchases = data.stockEntries.filter((e) => e.kind === 'purchase' && e.supplierId === supplier.id);
    return {
      supplier,
      purchases: purchases.length,
      totalCents: purchases.reduce((sum, e) => sum + e.quantity * e.unitCents, 0),
      lastDate: purchases.reduce((last, e) => (e.date > last ? e.date : last), ''),
    };
  });
}

// ---- Registrar un movimiento de stock -------------------------------------------------------------

/**
 * Lo que llega del formulario de compra, venta o ajuste (todo es texto).
 * @typedef {Object} StockInput
 * @property {string} kind
 * @property {string} productId
 * @property {string} quantityText   Compra y venta: entero positivo. Ajuste: entero con signo («5», «+5», «-3»).
 * @property {string} [unitText]     Compra: costo por unidad. Venta: precio por unidad. Ajuste que suma: costo por unidad.
 * @property {string} date
 * @property {string} [supplierId]   Solo compras ("" = sin proveedor).
 * @property {string} [categoryId]   Compra: categoría del gasto. Venta: categoría del ingreso.
 * @property {string} [departmentId] Solo compras: a qué departamento se carga el gasto ("" = ninguno).
 * @property {string} [note]
 */

/**
 * @typedef {Object} ValidStock
 * @property {StockKind} kind
 * @property {string} productId
 * @property {number} quantity      Con signo.
 * @property {number} unitCents
 * @property {string} date
 * @property {string} supplierId    "" si no hay.
 * @property {string} categoryId    "" en los ajustes.
 * @property {string} departmentId  "" si no hay (solo las compras pueden llevarlo).
 * @property {string} note
 */

/**
 * @param {StockInput} input
 * @param {{ products: Product[], suppliers: Supplier[], categories: Category[], entries: StockEntry[], today: string, time: string, nowISO: string, departments?: Department[] }} context
 *   `time` y `nowISO` son los que tendrá el movimiento al guardarse: el orden entre movimientos del mismo día depende de ellos,
 *   así que la comprobación del stock usa exactamente los mismos.
 * @returns {{ ok: true, value: ValidStock } | { ok: false, errors: Record<string, string> }}
 */
export function validateStockEntry(input, { products, suppliers, categories, entries, today, time, nowISO, departments = [] }) {
  /** @type {Record<string, string>} */
  const errors = {};

  const kind = isStockKind(input.kind) ? input.kind : null;
  if (!kind) errors.kind = 'Elige si es una compra, una venta o un ajuste.';

  const product = products.find((p) => p.id === input.productId);
  if (!product) errors.product = 'Elige un producto.';
  else if (product.archived) errors.product = 'Ese producto está archivado: reactívalo para comprar o vender.';
  else if (!tracksStock(product)) errors.product = `«${product.name}» no lleva control de stock: sus ventas se cobran en una factura o en la caja, y lo que compras para él se anota como un gasto.`;

  // Cantidad: entero; las compras y ventas son positivas (la venta sale sola con signo negativo); el ajuste puede ser + o -.
  const quantityText = cleanText(input.quantityText);
  let quantity = 0;
  if (!/^[+-]?\d{1,8}$/.test(quantityText)) {
    errors.quantity = kind === 'adjustment'
      ? 'Escribe un número entero, por ejemplo 5 para sumar o -3 para restar.'
      : 'Escribe un número entero de unidades, por ejemplo 12.';
  } else {
    const n = Number(quantityText);
    if (n === 0) errors.quantity = 'La cantidad no puede ser cero.';
    else if (kind !== 'adjustment' && n < 0) errors.quantity = 'Escribe la cantidad sin signo: la venta resta sola.';
    else if (Math.abs(n) > MAX_QUANTITY) errors.quantity = `Máximo ${MAX_QUANTITY.toLocaleString('en-US')} unidades por movimiento.`;
    else quantity = kind === 'sale' ? -Math.abs(n) : n;
  }

  // Costo o precio por unidad.
  let unitCents = 0;
  const unitText = cleanText(input.unitText);
  const needsUnit = kind === 'purchase' || kind === 'sale' || (kind === 'adjustment' && quantity > 0);
  if (needsUnit) {
    const label = kind === 'sale' ? 'precio de venta' : 'costo';
    const money = parseMoney(unitText);
    if (!unitText) errors.unit = `Escribe el ${label} por unidad.`;
    else if (!money.ok) errors.unit = money.error;
    else if (money.cents > MAX_CENTS) errors.unit = 'El monto es demasiado grande.';
    else if (money.cents <= 0 && kind !== 'adjustment') errors.unit = `El ${label} por unidad debe ser mayor que cero.`;
    else unitCents = money.cents;
    if (!errors.unit && !errors.quantity && Math.abs(quantity) * unitCents > MAX_CENTS) errors.unit = 'El total es demasiado grande.';
  }

  if (!isValidISODate(input.date)) errors.date = 'Elige una fecha válida.';
  else if (input.date > today) errors.date = 'La fecha no puede ser futura: registra solo lo que ya ocurrió.';
  else if (input.date < MIN_STOCK_DATE) errors.date = 'Esa fecha está fuera de rango.';

  // Proveedor: solo en compras.
  let supplierId = '';
  const wantedSupplier = String(input.supplierId ?? '');
  if (wantedSupplier) {
    if (kind !== 'purchase') errors.supplier = 'Solo las compras llevan proveedor.';
    else if (!suppliers.some((s) => s.id === wantedSupplier)) errors.supplier = 'Ese proveedor ya no existe.';
    else supplierId = wantedSupplier;
  }

  // Categoría del gasto o del ingreso: obligatoria en compras y ventas.
  let categoryId = '';
  if (kind === 'purchase' || kind === 'sale') {
    const wantedKind = kind === 'purchase' ? 'expense' : 'income';
    const found = categories.find((c) => c.id === input.categoryId);
    if (!found) errors.category = 'Elige una categoría.';
    else if (found.kind !== wantedKind) errors.category = 'Esa categoría no corresponde a este movimiento.';
    else categoryId = found.id;
  } else if (input.categoryId) {
    errors.category = 'Los ajustes no mueven dinero, así que no llevan categoría.';
  }

  // Departamento: solo en compras (el gasto se carga a esa área).
  let departmentId = '';
  const wantedDepartment = String(input.departmentId ?? '');
  if (wantedDepartment) {
    if (kind !== 'purchase') errors.department = 'Solo las compras se cargan a un departamento.';
    else if (!departments.some((d) => d.id === wantedDepartment)) errors.department = 'Ese departamento ya no existe.';
    else departmentId = wantedDepartment;
  }

  const note = cleanText(input.note);
  if (note.length > LIMITS.stockNote) errors.note = `Máximo ${LIMITS.stockNote} caracteres.`;

  // Regla de oro: el stock no puede quedar negativo en ningún momento (tampoco en fechas posteriores).
  if (kind && product && !errors.quantity && !errors.date && !errors.product) {
    const draft = /** @type {StockEntry} */ ({
      id: '~nuevo', productId: product.id, kind, quantity, unitCents, date: input.date, time, note, createdAt: nowISO, updatedAt: nowISO,
    });
    const problem = replayProduct([...entries.filter((e) => e.productId === product.id), draft]).firstNegative;
    if (problem) errors.quantity = negativeMessage(product, problem, problem.entry.id === draft.id);
  }

  if (Object.keys(errors).length > 0 || !kind) return { ok: false, errors };
  return { ok: true, value: { kind, productId: input.productId, quantity, unitCents, date: input.date, supplierId, categoryId, departmentId, note } };
}

/** @param {Product} product @param {{ entry: StockEntry, available: number }} problem @param {boolean} isNew */
export function negativeMessage(product, problem, isNew) {
  const units = (/** @type {number} */ n) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`;
  const date = formatDate(problem.entry.date);
  return isNew
    ? `No alcanza el stock de «${product.name}»: el ${date} solo hay ${units(problem.available)}.`
    : `Con esa fecha, el stock de «${product.name}» quedaría en negativo el ${date} (solo habría ${units(problem.available)} para una salida de ${units(-problem.entry.quantity)}).`;
}

/**
 * ¿Se puede borrar este movimiento sin dejar el stock en negativo en algún momento? Devuelve el motivo si no.
 * @param {StockEntry[]} entries Todos los movimientos de stock. @param {string} entryId @param {Product[]} products
 * @returns {string | null}
 */
export function deletionProblem(entries, entryId, products) {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return null;
  const rest = entries.filter((e) => e.productId === entry.productId && e.id !== entryId);
  const problem = replayProduct(rest).firstNegative;
  if (!problem) return null;
  const product = products.find((p) => p.id === entry.productId);
  return `No se puede borrar: ese movimiento ya respalda otras salidas de «${product?.name ?? 'este producto'}». Si lo borras, el stock quedaría en negativo el ${formatDate(problem.entry.date)}.`;
}

/** Descripción del gasto o ingreso que acompaña a una compra o venta (máximo `LIMITS.description` caracteres). @param {StockKind} kind @param {number} quantity @param {string} productName */
export function stockMovementDescription(kind, quantity, productName) {
  const text = `${STOCK_KIND_LABELS[kind]}: ${Math.abs(quantity)} × ${productName}`;
  return text.length > LIMITS.description ? `${text.slice(0, LIMITS.description - 1).trimEnd()}…` : text;
}

/**
 * El movimiento de dinero que acompaña a una compra (gasto) o a una venta (ingreso).
 * @param {ValidStock} value @param {Product} product @param {Category} category
 * @param {{ id: string, time: string, nowISO: string, isDemo?: boolean }} extra
 * @returns {Movement}
 */
export function buildStockMovement(value, product, category, { id, time, nowISO, isDemo }) {
  const type = value.kind === 'purchase' ? 'expense' : 'income';
  const wanted = category.defaultClassification;
  const classification = CLASSIFICATIONS_BY_TYPE[type].includes(wanted) ? wanted : 'variable';
  return {
    id,
    type,
    amountCents: Math.abs(value.quantity) * value.unitCents,
    date: value.date,
    time,
    description: stockMovementDescription(value.kind, value.quantity, product.name),
    classification,
    categoryId: category.id,
    createdAt: nowISO,
    updatedAt: nowISO,
    ...(value.departmentId ? { departmentId: value.departmentId } : {}),
    ...(isDemo ? { isDemo: true } : {}),
  };
}

/**
 * @param {ValidStock} value @param {{ id: string, time: string, nowISO: string, movementId?: string }} extra
 * @returns {StockEntry}
 */
export function buildStockEntry(value, { id, time, nowISO, movementId }) {
  return {
    id,
    productId: value.productId,
    kind: value.kind,
    quantity: value.quantity,
    unitCents: value.kind === 'adjustment' && value.quantity < 0 ? 0 : value.unitCents,
    date: value.date,
    time,
    ...(value.supplierId ? { supplierId: value.supplierId } : {}),
    ...(movementId ? { movementId } : {}),
    note: value.note,
    createdAt: nowISO,
    updatedAt: nowISO,
  };
}

/** Lo más reciente primero. @param {StockEntry[]} list */
export function sortEntriesNewestFirst(list) {
  return sortEntries(list).reverse();
}

// ---- Avisos ---------------------------------------------------------------------------------------

/**
 * Aviso de stock bajo (reglas fijas, no IA): productos activos con aviso configurado cuyo stock llegó al mínimo.
 * @param {Pick<AppData, 'products' | 'stockEntries'>} data
 * @returns {{ id: string, level: 'critical' | 'info', text: string }[]}
 */
export function inventoryNotices(data) {
  const { alerts } = inventorySummary(data);
  if (alerts.length === 0) return [];
  const names = alerts.slice(0, 3).map((a) => `«${a.product.name}»`);
  const list = alerts.length <= 3
    ? names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0]
    : `${names.join(', ')} y ${alerts.length - 3} más`;
  const out = alerts.some((a) => a.stock <= 0);
  return [{
    id: 'inventory-low-stock',
    level: out ? 'critical' : 'info',
    text: `${alerts.length === 1 ? 'Stock bajo en un producto' : `Stock bajo en ${alerts.length} productos`}: ${list}.${out ? ' Hay productos agotados.' : ''} Mira «Inventario».`,
  }];
}
