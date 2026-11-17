// @ts-check
// =============================================================================
// CAJA (PUNTO DE VENTA) — 0.17.1 (espacios Emprendedor y Empresa)
// -----------------------------------------------------------------------------
// Una pantalla táctil para vender rápido: se tocan los productos (con su foto), se arma el CARRITO, se elige cómo paga el
// cliente y se cobra. No hay datos nuevos: cada venta es una FACTURA INTERNA (con sus salidas de inventario) y, si se cobra
// en el momento, su COBRO con el ingreso, todo guardado en una sola operación. Si es fiado, queda la factura pendiente
// y aparece en «Fiado».
//
// El carrito es una lista de { productId, quantity, unitCents, pack } con cantidades enteras. Un producto que cuenta su stock no
// se puede poner en el carrito más veces de las que hay; uno «sin control de stock» no tiene ese tope.
//
// OFERTA POR CANTIDAD (0.17.5): si el producto se vende «2 por RD$15», cada grupo completo de 2 se cobra a RD$15 y lo que
// sobra, al precio de una unidad (7 panes = 3 × RD$15 + 1 × RD$8 = RD$53). En la factura, la oferta va en su propia línea
// con su precio por unidad (RD$7.50); si no se divide exacto (3 por RD$25 = 8.333…), se reparte en dos líneas de centavos
// enteros que suman justo lo de la oferta (2 × RD$8.33 + 1 × RD$8.34). Si en la venta se cambia el precio a mano, la
// oferta deja de aplicarse a esa línea.
// Todo en centavos enteros; el impuesto se calcula igual que en una factura (invoiceTotals).
// =============================================================================

import { cleanText } from './contact.js';
import { CREDIT_NOTE, foldName } from './fiado.js';
import { packLabel, productGroup, productPack, searchable, tracksStock, MAX_QUANTITY } from './inventory.js';
import { invoiceTotals, parseTaxPercent } from './invoices.js';
import { centsToInputValue, formatMoney, MAX_CENTS, parseMoney } from './money.js';
import { LIMITS } from './types.js';

/** @typedef {import('./types.js').Product} Product */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./inventory.js').StockPosition} StockPosition */

/** @typedef {{ qty: number, priceCents: number }} Pack */
/** @typedef {{ productId: string, quantity: number, unitCents: number, pack?: Pack | null }} CartLine */
/** Un tramo de una línea con un solo precio por unidad (lo que será una línea de la factura). @typedef {{ quantity: number, unitCents: number, offer: boolean }} Segment */
/** @typedef {'cash' | 'card' | 'transfer' | 'credit'} PaymentMethod */

/** @type {readonly { id: PaymentMethod, label: string }[]} */
export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Efectivo' },
  { id: 'card', label: 'Tarjeta' },
  { id: 'transfer', label: 'Transferencia' },
  { id: 'credit', label: 'Fiado' },
];

/** Cliente de las ventas cobradas en el momento cuando no se dice quién compra. */
export const WALK_IN_CUSTOMER = 'Cliente de mostrador';
/** Nota de las facturas que se cobran en la caja. */
export const POS_NOTE = 'Venta en caja';
/** Una venta en la caja tiene como mucho estas líneas de factura (como una factura). */
export const MAX_CART_LINES = 30;

/** @param {unknown} value @returns {value is PaymentMethod} */
export function isPaymentMethod(value) {
  return PAYMENT_METHODS.some((m) => m.id === value);
}

/** Etiqueta de un método de pago. @param {PaymentMethod} method */
export const methodLabel = (method) => PAYMENT_METHODS.find((m) => m.id === method)?.label ?? '';

// ---- Productos que se ofrecen -----------------------------------------------------------------------------------

/**
 * Los grupos que hay entre los productos que se venden (sin archivados), en orden alfabético; '' = «Sin grupo» si hay alguno.
 * @param {Product[]} products
 */
export function posGroups(products) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  let ungrouped = false;
  for (const p of products) {
    if (p.archived) continue;
    const g = productGroup(p);
    if (!g) ungrouped = true;
    else if (!seen.has(foldName(g))) seen.set(foldName(g), g);
  }
  const named = [...seen.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  return ungrouped && named.length > 0 ? [...named, ''] : named;
}

/**
 * Productos para la caja: activos, del grupo elegido (null = todos; '' = sin grupo) y que coincidan con la búsqueda (nombre,
 * código o grupo, sin tildes). Alfabéticos.
 * @param {StockPosition[]} positions @param {{ group: string | null, query: string }} filter
 */
export function posProducts(positions, { group, query }) {
  const needle = searchable(query.trim());
  return positions.filter((p) => {
    if (p.product.archived) return false;
    if (group !== null && foldName(productGroup(p.product)) !== foldName(group)) return false;
    return !needle || searchable(`${p.product.name} ${p.product.sku} ${productGroup(p.product)}`).includes(needle);
  });
}

/**
 * El producto cuyo código coincide EXACTO con lo escrito (lo que manda la pistola lectora), o, si la búsqueda deja uno solo,
 * ese. null si no hay uno claro.
 * @param {StockPosition[]} positions @param {string} text
 */
export function productForCode(positions, text) {
  const code = text.trim();
  if (!code) return null;
  const active = positions.filter((p) => !p.product.archived);
  const exact = active.filter((p) => p.product.sku && foldName(p.product.sku) === foldName(code));
  if (exact.length === 1) return exact[0];
  const found = posProducts(active, { group: null, query: code });
  return found.length === 1 ? found[0] : null;
}

// ---- Oferta por cantidad ----------------------------------------------------------------------------------------

/**
 * Parte una línea del carrito en tramos de un solo precio por unidad: la oferta (uno o dos tramos de centavos enteros que
 * suman exacto packs × precio de la oferta) y lo que sobra al precio normal. Sin oferta (o sin llegar a la cantidad), un tramo.
 * @param {CartLine} line @returns {Segment[]}
 */
export function lineSegments(line) {
  const pack = line.pack ?? null;
  if (!pack || line.quantity < pack.qty) return line.quantity > 0 ? [{ quantity: line.quantity, unitCents: line.unitCents, offer: false }] : [];
  const packs = Math.floor(line.quantity / pack.qty);
  const units = packs * pack.qty;
  const cents = packs * pack.priceCents;
  const base = Math.floor(cents / units);
  const extra = cents - base * units; // tantas unidades llevan un centavo más
  /** @type {Segment[]} */
  const out = [];
  if (units - extra > 0) out.push({ quantity: units - extra, unitCents: base, offer: true });
  if (extra > 0) out.push({ quantity: extra, unitCents: base + 1, offer: true });
  if (line.quantity > units) out.push({ quantity: line.quantity - units, unitCents: line.unitCents, offer: false });
  return out;
}

/** Lo que se cobra por una línea (con la oferta, si aplica). @param {CartLine} line */
export const lineTotalCents = (line) => lineSegments(line).reduce((sum, seg) => sum + seg.quantity * seg.unitCents, 0);

/** Cuánto se ahorra el cliente con la oferta en esta línea (0 si no aplica). @param {CartLine} line */
export const lineSavingsCents = (line) => (line.unitCents > 0 ? Math.max(0, line.quantity * line.unitCents - lineTotalCents(line)) : 0);

/** Cuántas líneas tendrá la factura de este carrito (cada producto con oferta puede ocupar hasta 3). @param {CartLine[]} cart */
export const cartInvoiceLines = (cart) => cart.reduce((n, l) => n + lineSegments(l).length, 0);

const TOO_MANY_LINES = `Esta venta llegó al máximo de ${MAX_CART_LINES} líneas de factura: cóbrala y empieza otra.`;

// ---- Carrito -----------------------------------------------------------------------------------------------------

/** Cuántas unidades hay disponibles para vender (Infinity si no cuenta su stock). @param {StockPosition} p */
export const availableUnits = (p) => (tracksStock(p.product) ? Math.max(p.stock, 0) : Infinity);

/**
 * Agrega una unidad de un producto (o una línea nueva con su precio).
 * @param {CartLine[]} cart @param {StockPosition} position
 * @returns {{ ok: true, cart: CartLine[] } | { ok: false, error: string }}
 */
export function addToCart(cart, position) {
  const { product } = position;
  if (product.archived) return { ok: false, error: `«${product.name}» está archivado.` };
  const line = cart.find((l) => l.productId === product.id);
  const next = (line?.quantity ?? 0) + 1;
  const available = availableUnits(position);
  if (next > available) {
    return { ok: false, error: available === 0 ? `«${product.name}» está agotado.` : `Solo quedan ${available} de «${product.name}».` };
  }
  if (next > MAX_QUANTITY) return { ok: false, error: 'Demasiadas unidades en una sola línea.' };
  const updated = line
    ? cart.map((l) => (l === line ? { ...l, quantity: next } : l))
    : [...cart, { productId: product.id, quantity: 1, unitCents: product.priceCents, pack: productPack(product) }];
  if (cartInvoiceLines(updated) > MAX_CART_LINES) return { ok: false, error: TOO_MANY_LINES };
  return { ok: true, cart: updated };
}

/**
 * Cambia la cantidad de una línea (0 la quita). No pasa de lo que hay en stock.
 * @param {CartLine[]} cart @param {string} productId @param {number} quantity @param {StockPosition | undefined} position
 * @returns {{ ok: true, cart: CartLine[] } | { ok: false, error: string }}
 */
export function setCartQuantity(cart, productId, quantity, position) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) return { ok: false, error: 'La cantidad debe ser un número entero.' };
  if (quantity === 0) return { ok: true, cart: cart.filter((l) => l.productId !== productId) };
  if (quantity > MAX_QUANTITY) return { ok: false, error: 'Demasiadas unidades en una sola línea.' };
  if (position && quantity > availableUnits(position)) {
    const available = availableUnits(position);
    return { ok: false, error: `Solo quedan ${available} de «${position.product.name}».` };
  }
  const updated = cart.map((l) => (l.productId === productId ? { ...l, quantity } : l));
  if (cartInvoiceLines(updated) > MAX_CART_LINES) return { ok: false, error: TOO_MANY_LINES };
  return { ok: true, cart: updated };
}

/**
 * Cambia el precio por unidad de una línea (por ejemplo, un producto sin precio o con descuento). Con un precio puesto a mano,
 * la oferta por cantidad deja de aplicarse a esa línea.
 * @param {CartLine[]} cart @param {string} productId @param {string} priceText
 * @returns {{ ok: true, cart: CartLine[] } | { ok: false, error: string }}
 */
export function setCartPrice(cart, productId, priceText) {
  const money = parseMoney(cleanText(priceText));
  if (!money.ok) return { ok: false, error: money.error };
  if (money.cents <= 0) return { ok: false, error: 'El precio debe ser mayor que cero.' };
  if (money.cents > MAX_CENTS) return { ok: false, error: 'El precio es demasiado grande.' };
  const updated = cart.map((l) => (l.productId === productId ? { ...l, unitCents: money.cents, pack: null } : l));
  if (cartInvoiceLines(updated) > MAX_CART_LINES) return { ok: false, error: TOO_MANY_LINES };
  return { ok: true, cart: updated };
}

/**
 * Quita del carrito lo que ya no existe o se archivó, y baja las cantidades a lo que hay en stock (por si otra persona
 * vendió mientras tanto). Devuelve también si cambió algo.
 * @param {CartLine[]} cart @param {StockPosition[]} positions
 */
export function reconcileCart(cart, positions) {
  const byId = new Map(positions.map((p) => [p.product.id, p]));
  /** @type {CartLine[]} */
  const out = [];
  for (const l of cart) {
    const p = byId.get(l.productId);
    if (!p || p.product.archived) continue;
    const q = Math.min(l.quantity, availableUnits(p));
    if (q > 0) out.push(q === l.quantity ? l : { ...l, quantity: q });
  }
  return { cart: out, changed: out.length !== cart.length || out.some((l, i) => l !== cart[i]) };
}

/** Totales del carrito con el impuesto (en centésimas de por ciento). @param {CartLine[]} cart @param {number} taxRateBp */
export function cartTotals(cart, taxRateBp) {
  const lines = cart.flatMap((l) => lineSegments(l).map((seg) => ({ description: '', quantity: seg.quantity, unitCents: seg.unitCents })));
  const totals = invoiceTotals({ lines, taxRateBp });
  return { ...totals, units: cart.reduce((s, l) => s + l.quantity, 0), savingsCents: cart.reduce((s, l) => s + lineSavingsCents(l), 0) };
}

// ---- Cobro ---------------------------------------------------------------------------------------------------------

/**
 * La devuelta en efectivo. Lo recibido debe cubrir el total.
 * @param {number} totalCents @param {string} receivedText
 * @returns {{ ok: true, receivedCents: number, changeCents: number } | { ok: false, error: string }}
 */
export function cashChange(totalCents, receivedText) {
  const text = cleanText(receivedText);
  if (!text) return { ok: true, receivedCents: totalCents, changeCents: 0 }; // pagó exacto
  const money = parseMoney(text);
  if (!money.ok) return { ok: false, error: money.error };
  if (money.cents > MAX_CENTS) return { ok: false, error: 'El monto es demasiado grande.' };
  if (money.cents < totalCents) return { ok: false, error: `Faltan ${formatMoney(totalCents - money.cents)}: lo recibido no cubre el total.` };
  return { ok: true, receivedCents: money.cents, changeCents: money.cents - totalCents };
}

/**
 * Montos que se proponen para cobrar rápido en efectivo: el total redondeado hacia arriba a 100, 500 y 1,000 pesos y los
 * billetes que lo cubren; los 3 más chicos, sin repetir y sin el total exacto (para eso se deja el campo vacío).
 * @param {number} totalCents
 */
export function quickCashOptions(totalCents) {
  const up = (/** @type {number} */ step) => Math.ceil(totalCents / step) * step;
  const bills = [5000, 10000, 20000, 50000, 100000, 200000].filter((b) => b >= totalCents);
  const all = [...new Set([up(10000), up(50000), up(100000), ...bills])].filter((x) => x > totalCents && x <= MAX_CENTS);
  return all.sort((x, y) => x - y).slice(0, 3);
}

/**
 * Lo que llega al cobrar.
 * @typedef {Object} SaleInput
 * @property {CartLine[]} cart
 * @property {PaymentMethod} method
 * @property {string} [customerName]   Obligatorio si es fiado; si no, «Cliente de mostrador».
 * @property {string} [receivedText]   Solo efectivo: cuánto entregó el cliente ('' = exacto).
 * @property {string} [taxText]        Porcentaje de impuesto ('' = sin impuesto).
 * @property {string} date
 */

/**
 * Valida la parte propia de la caja (método, cliente del fiado, efectivo) y prepara la factura. Las reglas de la factura
 * (stock, montos, fechas) las aplica después validateInvoice, como con cualquier factura.
 * @param {SaleInput} input @param {{ products: Product[] }} context
 * @returns {{ ok: true, invoiceInput: import('./invoices.js').InvoiceInput, method: PaymentMethod, totalCents: number, receivedCents: number, changeCents: number, note: string }
 *   | { ok: false, errors: Record<string, string> }}
 */
export function prepareSale(input, { products }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const cart = Array.isArray(input.cart) ? input.cart : [];
  if (cart.length === 0) errors.form = 'El carrito está vacío: toca un producto para agregarlo.';
  if (!isPaymentMethod(input.method)) errors.method = 'Elige cómo paga el cliente.';
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const l of cart) {
    const p = byId.get(l.productId);
    if (!p) { errors.form = 'Un producto del carrito ya no existe. Quítalo.'; break; }
    if (!Number.isSafeInteger(l.unitCents) || l.unitCents <= 0) { errors.form = `«${p.name}» no tiene precio: tócalo en el carrito y escribe cuánto cuesta.`; break; }
    if (!Number.isSafeInteger(l.quantity) || l.quantity < 1) { errors.form = `La cantidad de «${p.name}» no es válida.`; break; }
  }
  if (!errors.form && cartInvoiceLines(cart) > MAX_CART_LINES) errors.form = TOO_MANY_LINES;
  let taxRateBp = 0;
  const taxText = cleanText(input.taxText);
  if (taxText) {
    const bp = parseTaxPercent(taxText);
    if (bp === null) errors.tax = 'Escribe un porcentaje de 0 a 100.';
    else taxRateBp = bp;
  }
  const typed = cleanText(input.customerName);
  if (input.method === 'credit' && (!typed || foldName(typed) === foldName(WALK_IN_CUSTOMER))) errors.customerName = 'Para fiar, escribe el nombre de quien se lo lleva.';
  const customerName = typed || WALK_IN_CUSTOMER;

  const totalCents = cartTotals(cart, taxRateBp).totalCents;
  let receivedCents = totalCents;
  let changeCents = 0;
  if (input.method === 'cash' && !errors.form) {
    const cash = cashChange(totalCents, input.receivedText ?? '');
    if (!cash.ok) errors.received = cash.error;
    else ({ receivedCents, changeCents } = cash);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const method = /** @type {PaymentMethod} */ (input.method);
  const note = method === 'cash'
    ? changeCents > 0 ? `Efectivo · recibido ${formatMoney(receivedCents)} · devuelta ${formatMoney(changeCents)}` : 'Efectivo'
    : methodLabel(method);
  return {
    ok: true,
    method,
    totalCents,
    receivedCents,
    changeCents,
    note,
    invoiceInput: {
      customerName,
      customerTaxId: '',
      customerContact: '',
      issueDate: input.date,
      dueDate: '',
      taxText,
      notes: method === 'credit' ? CREDIT_NOTE : `${POS_NOTE} · ${methodLabel(method)}`,
      lines: cart.flatMap((l) => {
        const p = /** @type {Product} */ (byId.get(l.productId));
        return lineSegments(l).map((seg) => ({
          description: seg.offer && l.pack ? offerDescription(p.name, l.pack) : p.name,
          productId: p.id, serviceId: '', quantityText: String(seg.quantity), unitText: centsToInputValue(seg.unitCents),
        }));
      }),
    },
  };
}

/**
 * «Pan (oferta 2 por RD$15.00)», sin pasar del máximo de una línea de factura (se acorta el nombre si hace falta).
 * @param {string} name @param {Pack} pack
 */
export function offerDescription(name, pack) {
  const tail = ` (oferta ${packLabel(pack)})`;
  const room = LIMITS.invoiceLine - tail.length;
  return `${name.length > room ? `${name.slice(0, room - 1).trimEnd()}…` : name}${tail}`;
}

/** La categoría de ingresos de las ventas: «Ventas» si existe; si no, la primera de ingresos. @param {Category[]} categories */
export function salesCategory(categories) {
  const income = categories.filter((c) => c.kind === 'income');
  return income.find((c) => c.id === 'cat-inc-ventas') ?? income.find((c) => /^ventas?$/i.test(c.name)) ?? income[0] ?? null;
}
