// @ts-check
// =============================================================================
// ALMACÉN EN MEMORIA
// -----------------------------------------------------------------------------
// Cumple el mismo contrato que indexedDbStore.js pero sin guardar nada en disco.
// Se usa en las pruebas automáticas (Node no tiene IndexedDB).
// =============================================================================

import { defaultCategories } from '../domain/categories.js';
import { defaultSettings } from '../domain/settings.js';

/** @typedef {import('./dataStore.js').DataStore} DataStore */
/** @typedef {import('../domain/types.js').AppData} AppData */

/**
 * @param {Partial<AppData>} [initial]
 * @returns {DataStore & { failNextWrite: () => void }}
 */
export function createMemoryStore(initial = {}) {
  /** @type {Map<string, any>} */ let categories = new Map();
  /** @type {Map<string, any>} */ let movements = new Map();
  /** @type {Map<string, any>} */ let goals = new Map();
  /** @type {Map<string, any>} */ let contributions = new Map();
  /** @type {Map<string, any>} */ let debts = new Map();
  /** @type {Map<string, any>} */ let debtPayments = new Map();
  /** @type {Map<string, any>} */ let assets = new Map();
  /** @type {Map<string, any>} */ let clients = new Map();
  /** @type {Map<string, any>} */ let services = new Map();
  /** @type {Map<string, any>} */ let products = new Map();
  /** @type {Map<string, any>} */ let suppliers = new Map();
  /** @type {Map<string, any>} */ let stockEntries = new Map();
  /** @type {Map<string, any>} */ let invoices = new Map();
  /** @type {Map<string, any>} */ let invoicePayments = new Map();
  /** @type {Map<string, any>} */ let departments = new Map();
  let settings = defaultSettings();
  let seeded = false;
  let shouldFail = false;

  /** @param {any[]} list @param {Map<string, any>} map */
  const fill = (list, map) => { for (const r of list) map.set(r.id, structuredClone(r)); };

  function seed() {
    if (seeded) return;
    seeded = true;
    fill(initial.categories ?? defaultCategories(), categories);
    fill(initial.movements ?? [], movements);
    fill(initial.goals ?? [], goals);
    fill(initial.contributions ?? [], contributions);
    fill(initial.debts ?? [], debts);
    fill(initial.debtPayments ?? [], debtPayments);
    fill(initial.assets ?? [], assets);
    fill(initial.clients ?? [], clients);
    fill(initial.services ?? [], services);
    fill(initial.products ?? [], products);
    fill(initial.suppliers ?? [], suppliers);
    fill(initial.stockEntries ?? [], stockEntries);
    fill(initial.invoices ?? [], invoices);
    fill(initial.invoicePayments ?? [], invoicePayments);
    fill(initial.departments ?? [], departments);
    if (initial.settings) settings = structuredClone(initial.settings);
  }

  /** Simula un fallo de escritura (para probar que la app no muestra datos sin guardar). */
  async function guard() {
    if (shouldFail) {
      shouldFail = false;
      throw new Error('Fallo de escritura simulado');
    }
  }

  /** @param {import('./dataStore.js').Deletions} deletions */
  function removeAll(deletions) {
    for (const id of deletions.categoryIds ?? []) categories.delete(id);
    for (const id of deletions.movementIds ?? []) movements.delete(id);
    for (const id of deletions.goalIds ?? []) goals.delete(id);
    for (const id of deletions.contributionIds ?? []) contributions.delete(id);
    for (const id of deletions.debtIds ?? []) debts.delete(id);
    for (const id of deletions.debtPaymentIds ?? []) debtPayments.delete(id);
    for (const id of deletions.assetIds ?? []) assets.delete(id);
    for (const id of deletions.clientIds ?? []) clients.delete(id);
    for (const id of deletions.serviceIds ?? []) services.delete(id);
    for (const id of deletions.productIds ?? []) products.delete(id);
    for (const id of deletions.supplierIds ?? []) suppliers.delete(id);
    for (const id of deletions.stockEntryIds ?? []) stockEntries.delete(id);
    for (const id of deletions.invoiceIds ?? []) invoices.delete(id);
    for (const id of deletions.invoicePaymentIds ?? []) invoicePayments.delete(id);
    for (const id of deletions.departmentIds ?? []) departments.delete(id);
  }

  return {
    failNextWrite() { shouldFail = true; },

    async load() {
      seed();
      return {
        categories: [...categories.values()].map((r) => structuredClone(r)),
        movements: [...movements.values()].map((r) => structuredClone(r)),
        goals: [...goals.values()].map((r) => structuredClone(r)),
        contributions: [...contributions.values()].map((r) => structuredClone(r)),
        debts: [...debts.values()].map((r) => structuredClone(r)),
        debtPayments: [...debtPayments.values()].map((r) => structuredClone(r)),
        assets: [...assets.values()].map((r) => structuredClone(r)),
        clients: [...clients.values()].map((r) => structuredClone(r)),
        services: [...services.values()].map((r) => structuredClone(r)),
        products: [...products.values()].map((r) => structuredClone(r)),
        suppliers: [...suppliers.values()].map((r) => structuredClone(r)),
        stockEntries: [...stockEntries.values()].map((r) => structuredClone(r)),
        invoices: [...invoices.values()].map((r) => structuredClone(r)),
        invoicePayments: [...invoicePayments.values()].map((r) => structuredClone(r)),
        departments: [...departments.values()].map((r) => structuredClone(r)),
        settings: structuredClone(settings),
      };
    },

    async putMany(changes, deletions = {}) {
      seed();
      await guard();
      fill(changes.categories ?? [], categories);
      fill(changes.movements ?? [], movements);
      fill(changes.goals ?? [], goals);
      fill(changes.contributions ?? [], contributions);
      fill(changes.debts ?? [], debts);
      fill(changes.debtPayments ?? [], debtPayments);
      fill(changes.assets ?? [], assets);
      fill(changes.clients ?? [], clients);
      fill(changes.services ?? [], services);
      fill(changes.products ?? [], products);
      fill(changes.suppliers ?? [], suppliers);
      fill(changes.stockEntries ?? [], stockEntries);
      fill(changes.invoices ?? [], invoices);
      fill(changes.invoicePayments ?? [], invoicePayments);
      fill(changes.departments ?? [], departments);
      removeAll(deletions);
    },

    async deleteMany(deletions) {
      seed();
      await guard();
      removeAll(deletions);
    },
    async saveSettings(next) {
      seed();
      await guard();
      settings = structuredClone(next);
    },

    async replaceAll(data) {
      seed();
      await guard();
      categories = new Map(); movements = new Map(); goals = new Map(); contributions = new Map(); debts = new Map(); debtPayments = new Map(); assets = new Map(); clients = new Map(); services = new Map(); products = new Map(); suppliers = new Map(); stockEntries = new Map(); invoices = new Map(); invoicePayments = new Map(); departments = new Map();
      fill(data.categories, categories);
      fill(data.movements, movements);
      fill(data.goals, goals);
      fill(data.contributions, contributions);
      fill(data.debts, debts);
      fill(data.debtPayments, debtPayments);
      fill(data.assets, assets);
      fill(data.clients, clients);
      fill(data.services, services);
      fill(data.products, products);
      fill(data.suppliers, suppliers);
      fill(data.stockEntries, stockEntries);
      fill(data.invoices, invoices);
      fill(data.invoicePayments, invoicePayments);
      fill(data.departments ?? [], departments);
      settings = structuredClone(data.settings);
    },

    async clearAll() {
      seed();
      await guard();
      categories = new Map(); movements = new Map(); goals = new Map(); contributions = new Map(); debts = new Map(); debtPayments = new Map(); assets = new Map(); clients = new Map(); services = new Map(); products = new Map(); suppliers = new Map(); stockEntries = new Map(); invoices = new Map(); invoicePayments = new Map(); departments = new Map();
      fill(defaultCategories(), categories);
      settings = defaultSettings();
    },
  };
}
