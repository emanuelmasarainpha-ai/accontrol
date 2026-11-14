// @ts-check
// =============================================================================
// DATASTORE: el contrato de almacenamiento
// -----------------------------------------------------------------------------
// El resto de la app NO sabe dónde se guardan los datos: solo habla con un
// objeto que cumple este contrato. Hoy hay dos implementaciones:
//
//   indexedDbStore.js  -> guarda en el navegador (la que usa la app real)
//   memoryStore.js     -> guarda en memoria (para las pruebas automáticas)
//
// En la Etapa 2 se añadirá `supabaseStore.js` (nube) que cumple el MISMO
// contrato, y la app seguirá funcionando sin cambiar pantallas ni cálculos.
//
// Reglas del contrato:
//  - Cada método devuelve una Promesa. Si falla, la Promesa se rechaza: quien
//    llama NO debe mostrar el cambio como guardado.
//  - Cada método es atómico: o se guarda todo, o no se guarda nada.
//  - El almacén NO decide reglas de negocio (por ejemplo, borrar los aportes de
//    una meta): quien llama indica exactamente qué ids se borran.
// =============================================================================

/** @typedef {import('../domain/types.js').AppData} AppData */
/** @typedef {import('../domain/types.js').Movement} Movement */
/** @typedef {import('../domain/types.js').Goal} Goal */
/** @typedef {import('../domain/types.js').Contribution} Contribution */
/** @typedef {import('../domain/types.js').Debt} Debt */
/** @typedef {import('../domain/types.js').DebtPayment} DebtPayment */
/** @typedef {import('../domain/types.js').Asset} Asset */
/** @typedef {import('../domain/types.js').Client} Client */
/** @typedef {import('../domain/types.js').Service} Service */
/** @typedef {import('../domain/types.js').Product} Product */
/** @typedef {import('../domain/types.js').Supplier} Supplier */
/** @typedef {import('../domain/types.js').StockEntry} StockEntry */
/** @typedef {import('../domain/types.js').Invoice} Invoice */
/** @typedef {import('../domain/types.js').InvoicePayment} InvoicePayment */
/** @typedef {import('../domain/types.js').Department} Department */
/** @typedef {import('../domain/types.js').Category} Category */
/** @typedef {import('../domain/types.js').Settings} Settings */

/**
 * Registros a crear o reemplazar (según su id).
 * @typedef {Object} Changes
 * @property {Category[]} [categories]
 * @property {Movement[]} [movements]
 * @property {Goal[]} [goals]
 * @property {Contribution[]} [contributions]
 * @property {Debt[]} [debts]
 * @property {DebtPayment[]} [debtPayments]
 * @property {Asset[]} [assets]
 * @property {Client[]} [clients]
 * @property {Service[]} [services]
 * @property {Product[]} [products]
 * @property {Supplier[]} [suppliers]
 * @property {StockEntry[]} [stockEntries]
 * @property {Invoice[]} [invoices]
 * @property {InvoicePayment[]} [invoicePayments]
 * @property {Department[]} [departments]
 */

/**
 * Ids a borrar.
 * @typedef {Object} Deletions
 * @property {string[]} [categoryIds]
 * @property {string[]} [movementIds]
 * @property {string[]} [goalIds]
 * @property {string[]} [contributionIds]
 * @property {string[]} [debtIds]
 * @property {string[]} [debtPaymentIds]
 * @property {string[]} [assetIds]
 * @property {string[]} [clientIds]
 * @property {string[]} [serviceIds]
 * @property {string[]} [productIds]
 * @property {string[]} [supplierIds]
 * @property {string[]} [stockEntryIds]
 * @property {string[]} [invoiceIds]
 * @property {string[]} [invoicePaymentIds]
 * @property {string[]} [departmentIds]
 */

/**
 * @typedef {Object} DataStore
 * @property {() => Promise<AppData>} load
 *   Lee todo. En el primer uso crea las categorías de fábrica y los ajustes por defecto.
 * @property {(changes: Changes, deletions?: Deletions) => Promise<void>} putMany
 *   Crea o reemplaza registros y, si se indican, borra otros, todo en una sola operación atómica (anular una factura
 *   cambia la factura y borra sus salidas de stock: se hace todo o nada).
 * @property {(deletions: Deletions) => Promise<void>} deleteMany
 *   Borra registros, todos en una sola operación atómica.
 * @property {(settings: Settings) => Promise<void>} saveSettings
 * @property {(data: AppData) => Promise<void>} replaceAll
 *   Sustituye TODO por los datos dados (restaurar un respaldo).
 * @property {() => Promise<void>} clearAll
 *   Borra todo y vuelve al estado inicial (categorías de fábrica, ajustes vacíos).
 */

export {};
