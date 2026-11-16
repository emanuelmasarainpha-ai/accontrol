// @ts-check
// =============================================================================
// DATOS DE DEMOSTRACIÓN
// -----------------------------------------------------------------------------
// Son datos INVENTADOS para ver cómo luce la app con información. Todos llevan
// `isDemo: true`, la app los marca con la etiqueta "DEMO" y se pueden borrar
// con un botón sin tocar tus datos reales. Nunca se cargan solos: el usuario
// debe pedirlo.
//
// Son deterministas (misma fecha de entrada = mismos datos) y NUNCA tienen
// fechas futuras.
// =============================================================================

import { addDays, addMonths, addMonthsToDate, daysInMonth, monthKeyOf, parseISO } from './dates.js';
import { DEBT_CATEGORY_ID } from './categories.js';
import { buildSchedule, installmentDates, paymentMovementFields, periodicRate } from './debts.js';
import { buildStockEntry, buildStockMovement } from './inventory.js';
import { buildInvoice, buildInvoicePayment, buildPaymentMovement } from './invoices.js';
import { newId } from './ids.js';

/** @typedef {import('./types.js').Movement} Movement */
/** @typedef {import('./types.js').Goal} Goal */
/** @typedef {import('./types.js').Contribution} Contribution */
/** @typedef {import('./types.js').Debt} Debt */
/** @typedef {import('./types.js').DebtPayment} DebtPayment */
/** @typedef {import('./types.js').Asset} Asset */
/** @typedef {import('./types.js').Product} Product */
/** @typedef {import('./types.js').Supplier} Supplier */
/** @typedef {import('./types.js').StockEntry} StockEntry */
/** @typedef {import('./types.js').Invoice} Invoice */
/** @typedef {import('./types.js').InvoicePayment} InvoicePayment */
/** @typedef {import('./types.js').Department} Department */

/**
 * Plantilla: [día del mes, hora, tipo, categoría, clasificación, descripción, monto en pesos]
 * @type {Array<[number, string, 'income' | 'expense', string, string, string, number]>}
 */
const MONTH_TEMPLATE = [
  [1, '08:30', 'income', 'cat-inc-salario', 'fixed', 'Salario (demostración)', 48000],
  [1, '19:00', 'expense', 'cat-exp-alquiler', 'fixed', 'Alquiler (demostración)', 15000],
  [3, '12:40', 'expense', 'cat-exp-alimentacion', 'variable', 'Supermercado (demostración)', 3200],
  [4, '07:50', 'expense', 'cat-exp-transporte', 'fixed', 'Transporte (demostración)', 1800],
  [6, '20:15', 'expense', 'cat-exp-restaurantes', 'discretionary', 'Cena fuera (demostración)', 1450],
  [8, '10:00', 'expense', 'cat-exp-electricidad', 'fixed', 'Factura de luz (demostración)', 2300],
  [9, '15:20', 'income', 'cat-inc-comisiones', 'variable', 'Comisiones (demostración)', 6500],
  [11, '09:10', 'expense', 'cat-exp-internet', 'fixed', 'Internet (demostración)', 1500],
  [12, '18:45', 'expense', 'cat-exp-entretenimiento', 'discretionary', 'Cine y salida (demostración)', 1200],
  [14, '11:30', 'expense', 'cat-exp-alimentacion', 'variable', 'Supermercado (demostración)', 2750],
  [16, '13:05', 'expense', 'cat-exp-combustible', 'variable', 'Combustible (demostración)', 2400],
  [18, '17:30', 'expense', 'cat-exp-ropa', 'discretionary', 'Ropa (demostración)', 2900],
  [20, '10:45', 'expense', 'cat-exp-salud', 'variable', 'Farmacia (demostración)', 980],
  [22, '16:00', 'income', 'cat-inc-ventas', 'variable', 'Ventas (demostración)', 4200],
  [24, '14:20', 'expense', 'cat-exp-alimentacion', 'variable', 'Supermercado (demostración)', 3050],
  [26, '21:10', 'expense', 'cat-exp-restaurantes', 'discretionary', 'Almuerzo con amigos (demostración)', 1650],
];

/**
 * @param {string} today "AAAA-MM-DD"
 * @param {string} nowISO
 * @returns {{ movements: Movement[], goals: Goal[], contributions: Contribution[], debts: Debt[], debtPayments: DebtPayment[], assets: Asset[] }}
 */
export function buildDemoData(today, nowISO) {
  const { d: todayDay } = parseISO(today);
  const thisMonth = monthKeyOf(today);
  /** @type {Movement[]} */
  const movements = [];

  for (let back = 0; back < 5; back += 1) {
    const monthKey = addMonths(thisMonth, -back);
    const [y, m] = monthKey.split('-').map(Number);
    const lastDay = daysInMonth(y, m);
    // Variación pequeña y estable entre meses para que los gráficos no sean planos.
    const factor = 1 + ((back * 7) % 5 - 2) * 0.04;

    for (const [day, time, type, categoryId, classification, description, pesos] of MONTH_TEMPLATE) {
      if (day > lastDay) continue;
      if (back === 0 && day > todayDay) continue; // nada de fechas futuras
      const isFixed = classification === 'fixed' || categoryId === 'cat-inc-salario';
      const amountCents = Math.round(pesos * 100 * (isFixed ? 1 : factor));
      movements.push({
        id: newId(),
        type,
        amountCents,
        date: `${monthKey}-${String(day).padStart(2, '0')}`,
        time,
        description,
        classification: /** @type {any} */ (classification),
        categoryId,
        createdAt: nowISO,
        updatedAt: nowISO,
        isDemo: true,
      });
    }
  }

  const laptopId = newId();
  const emergencyId = newId();
  /** @type {Goal[]} */
  const goals = [
    {
      id: laptopId,
      name: 'Laptop nueva (demostración)',
      description: 'Meta de ejemplo a corto plazo.',
      targetCents: 6_500_000,
      targetDate: addMonthsFrom(today, 8),
      createdAt: nowISO,
      updatedAt: nowISO,
      isDemo: true,
    },
    {
      id: emergencyId,
      name: 'Fondo de emergencia (demostración)',
      description: 'Meta de ejemplo a mediano plazo.',
      targetCents: 20_000_000,
      targetDate: addMonthsFrom(today, 24),
      createdAt: nowISO,
      updatedAt: nowISO,
      isDemo: true,
    },
  ];

  /** @type {Contribution[]} */
  const contributions = [];
  for (let back = 0; back < 4; back += 1) {
    const monthKey = addMonths(thisMonth, -back);
    const date = back === 0 ? today : `${monthKey}-05`;
    contributions.push(contribution(laptopId, 'deposit', 800_000, date, '09:00', nowISO));
    if (back > 0) contributions.push(contribution(emergencyId, 'deposit', 1_200_000, date, '09:05', nowISO));
  }

  // ---- Deudas de demostración (con pagos y su gasto vinculado) -----------------
  const { debts, debtPayments, paymentMovements } = buildDemoDebts(today, nowISO);
  movements.push(...paymentMovements);

  // ---- Activos de demostración (con historial de valores) ---------------------
  /**
   * @param {string} name @param {import('./types.js').AssetCategory} category @param {string} subtype
   * @param {string} acquiredDate @param {[string, number][]} values  [fecha, valor en pesos]
   * @returns {Asset}
   */
  const demoAsset = (name, category, subtype, acquiredDate, values) => ({
    id: newId(), name, category, subtype, description: 'Activo de ejemplo.', acquiredDate,
    valuations: values.map(([date, pesos]) => ({ date, valueCents: pesos * 100 })),
    createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  const at = (/** @type {number} */ monthsBack) => addMonthsFrom(today, -monthsBack);
  const assets = [
    demoAsset('Automóvil (demostración)', 'vehicles', 'car', at(4), [[at(4), 650_000], [at(2), 625_000], [at(0), 610_000]]),
    demoAsset('Certificado financiero (demostración)', 'investments', 'certificates', at(3), [[at(3), 100_000], [at(2), 101_000], [at(1), 102_000], [at(0), 103_000]]),
    demoAsset('Terreno (demostración)', 'realEstate', 'land', at(4), [[at(4), 1_200_000]]),
  ];

  return { movements, goals, contributions, debts, debtPayments, assets };
}

/**
 * Tres deudas de ejemplo: un préstamo personal con 3 cuotas pagadas, una tarjeta con cuota por vencer
 * y un préstamo de motocicleta a largo plazo. Los pagos usan la cuota exacta de la tabla de amortización.
 * @param {string} today @param {string} nowISO
 */
function buildDemoDebts(today, nowISO) {
  // Las deudas de ejemplo se "registraron" hace unos meses, para que el historial del patrimonio sea coherente.
  const registeredAt = `${addMonthsFrom(today, -4)}T12:00:00.000Z`;
  /** @type {Debt[]} */
  const debts = [];
  /** @type {DebtPayment[]} */
  const debtPayments = [];
  /** @type {Movement[]} */
  const paymentMovements = [];

  /** Mantiene el día de las cuotas entre 1 y 28 para que todos los meses tengan esa fecha. @param {string} iso */
  const safeDay = (iso) => {
    const { d } = parseISO(iso);
    return d <= 28 ? iso : `${iso.slice(0, 8)}28`;
  };

  /** @param {Omit<Debt, 'id' | 'note' | 'createdAt' | 'updatedAt' | 'isDemo' | 'firstDueTime' | 'finalDueTime'>} fields */
  const makeDebt = (fields) => {
    /** @type {Debt} */
    const debt = {
      id: newId(), note: 'Deuda de ejemplo para ver cómo funciona la pantalla.', firstDueTime: '09:00', finalDueTime: '17:00',
      createdAt: registeredAt, updatedAt: registeredAt, isDemo: true, ...fields,
    };
    debts.push(debt);
    return debt;
  };

  // 1) Préstamo personal: 12 cuotas mensuales, 3 ya pagadas, la próxima en 9 días.
  const nextA = safeDay(addDays(today, 9));
  const loan = makeDebt({
    name: 'Préstamo personal (demostración)', totalCents: 3_000_000, rateBp: 2400, rateBasis: 'annual', frequency: 'monthly',
    collateralKind: 'personal', collateralType: 'prestamo-personal',
    firstDueDate: addMonthsToDate(nextA, -3), finalDueDate: addMonthsToDate(nextA, 8),
  });
  const loanRows = buildSchedule(loan.totalCents, periodicRate(loan), installmentDates(loan));
  loanRows.slice(0, 3).forEach((row) => {
    const payment = demoPayment(loan, row.paymentCents, row.date, '09:30', nowISO);
    debtPayments.push(payment.payment);
    paymentMovements.push(payment.movement);
  });

  // 2) Tarjeta de crédito: 6 cuotas, sin pagos todavía, la primera vence en 3 días.
  makeDebt({
    name: 'Tarjeta de crédito (demostración)', totalCents: 2_500_000, rateBp: 4800, rateBasis: 'annual', frequency: 'monthly',
    collateralKind: 'personal', collateralType: 'tarjeta',
    firstDueDate: safeDay(addDays(today, 3)), finalDueDate: addMonthsToDate(safeDay(addDays(today, 3)), 5),
  });

  // 3) Motocicleta: cuotas trimestrales durante 2 años (largo plazo), la primera en 40 días.
  const firstC = safeDay(addDays(today, 40));
  makeDebt({
    name: 'Préstamo de motocicleta (demostración)', totalCents: 12_000_000, rateBp: 1500, rateBasis: 'annual', frequency: 'quarterly',
    collateralKind: 'physical', collateralType: 'moto',
    firstDueDate: firstC, finalDueDate: addMonthsToDate(firstC, 21),
  });

  return { debts, debtPayments, paymentMovements };
}

/**
 * @param {Debt} debt @param {number} amountCents @param {string} date @param {string} time @param {string} nowISO
 * @returns {{ payment: DebtPayment, movement: Movement }}
 */
function demoPayment(debt, amountCents, date, time, nowISO) {
  const movementId = newId();
  const fields = paymentMovementFields(debt, { kind: 'regular', amountCents, date, time }, 'cat-exp-deudas');
  return {
    movement: { id: movementId, ...fields, createdAt: nowISO, updatedAt: nowISO, isDemo: true },
    payment: {
      id: newId(), debtId: debt.id, kind: 'regular', amountCents, date, time, note: 'Pago de demostración',
      movementId, createdAt: nowISO, updatedAt: nowISO, isDemo: true,
    },
  };
}

/**
 * @param {string} goalId @param {'deposit' | 'withdrawal'} kind @param {number} amountCents
 * @param {string} date @param {string} time @param {string} nowISO
 * @returns {Contribution}
 */
function contribution(goalId, kind, amountCents, date, time, nowISO) {
  return {
    id: newId(), goalId, kind, amountCents, date, time,
    note: 'Aporte de demostración', createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  };
}

/** @param {string} iso @param {number} months */
function addMonthsFrom(iso, months) {
  const { d } = parseISO(iso);
  const key = addMonths(monthKeyOf(iso), months);
  const [y, m] = key.split('-').map(Number);
  return `${key}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, '0')}`;
}

/**
 * Demostración del módulo Freelancer: cuatro clientes inventados con sus servicios (en todos los estados) y los pagos
 * vinculados, más un gasto mensual de herramientas (general, sin cliente) y varios gastos cargados a clientes (hosting, licencias,
 * impresión…) para ver la rentabilidad real de cada uno: uno de ellos (Carla, que aún no paga) tiene más gastos que cobros.
 * Sirve para ver el ranking, lo «por cobrar» y el flujo de caja. Nunca hay fechas futuras.
 * @param {string} today "AAAA-MM-DD" @param {string} nowISO
 * @returns {{ clients: import('./types.js').Client[], services: import('./types.js').Service[], movements: Movement[] }}
 */
export function buildFreelancerDemo(today, nowISO) {
  const { d: todayDay } = parseISO(today);
  const thisMonth = monthKeyOf(today);
  /** Fecha de un día de hace `back` meses (el mes actual nunca pasa de hoy). @param {number} back @param {number} day */
  const on = (back, day) => `${addMonths(thisMonth, -back)}-${String(back === 0 ? Math.min(day, todayDay) : Math.min(day, 28)).padStart(2, '0')}`;

  /** @param {string} firstName @param {string} lastName @param {string} company @param {string} notes @returns {import('./types.js').Client} */
  const client = (firstName, lastName, company, notes) => ({
    id: newId(), firstName, lastName, company: `${company} (demostración)`, email: '', phone: '', country: 'República Dominicana',
    notes, archived: false, createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  const ana = client('Ana', 'Pérez', 'Estudio Sol', 'Cliente de ejemplo: paga puntual cada mes.');
  const beto = client('Beto', 'Gómez', 'Café Norte', 'Cliente de ejemplo: proyecto grande con pagos por partes.');
  const carla = client('Carla', 'Díaz', 'Boutique Carla', 'Cliente de ejemplo: aún no empieza.');
  const dani = client('Dani', 'Ruiz', 'Taller Ruiz', 'Cliente de ejemplo: proyecto ya terminado y pagado.');

  /** @param {import('./types.js').Client} c @param {string} name @param {number} pesos @param {import('./types.js').ServiceStatus} status @param {string} startDate @param {number | null} days @returns {import('./types.js').Service} */
  const service = (c, name, pesos, status, startDate, days) => ({
    id: newId(), clientId: c.id, name, priceCents: pesos * 100, estimatedDays: days, status, startDate,
    createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  const maint = [3, 2, 1].map((back) => service(ana, 'Mantenimiento web', 6000, 'done', on(back, 1), 30));
  const maintNow = service(ana, 'Mantenimiento web', 6000, 'in_progress', on(0, 1), 30);
  const logo = service(ana, 'Rediseño de logo', 15000, 'done', on(4, 5), 15);
  const shop = service(beto, 'Tienda en línea', 60000, 'in_progress', on(2, 5), 45);
  const campaign = service(carla, 'Campaña de redes', 18000, 'pending', '', 20);
  const photos = service(carla, 'Fotografía de producto', 8000, 'cancelled', on(1, 10), 5);
  const brand = service(dani, 'Identidad de marca', 25000, 'done', on(3, 3), 25);
  const services = [...maint, maintNow, logo, shop, campaign, photos, brand];

  /** @type {Movement[]} */
  const movements = [];
  /** @param {import('./types.js').Client} c @param {import('./types.js').Service} svc @param {string} date @param {number} pesos @param {string} time */
  const pay = (c, svc, date, pesos, time) => movements.push({
    id: newId(), type: 'income', amountCents: pesos * 100, date, time, description: `Pago de ${svc.name} (demostración)`,
    classification: 'variable', categoryId: 'cat-inc-ventas', clientId: c.id, serviceId: svc.id,
    createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  [3, 2, 1].forEach((back, i) => pay(ana, maint[i], on(back, 10), 6000, '10:15'));
  pay(ana, logo, on(4, 12), 15000, '11:00');
  pay(beto, shop, on(2, 8), 20000, '09:40');
  pay(beto, shop, on(1, 8), 10000, '09:45');
  pay(beto, shop, on(0, 3), 5000, '09:50');
  pay(dani, brand, on(3, 6), 15000, '14:00');
  pay(dani, brand, on(2, 6), 10000, '14:05');

  for (let back = 0; back < 5; back += 1) {
    movements.push({
      id: newId(), type: 'expense', amountCents: 180_000, date: on(back, 12), time: '08:00', description: 'Herramientas y suscripciones (demostración)',
      classification: 'fixed', categoryId: 'cat-exp-otros', createdAt: nowISO, updatedAt: nowISO, isDemo: true,
    });
  }
  /** Un gasto cargado a un cliente (costo directo de trabajarle). @param {import('./types.js').Client} c @param {string} date @param {number} pesos @param {string} what */
  const cost = (c, date, pesos, what) => movements.push({
    id: newId(), type: 'expense', amountCents: pesos * 100, date, time: '16:20', description: `${what} (demostración)`,
    classification: 'variable', categoryId: 'cat-exp-otros', clientId: c.id, createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  cost(ana, on(3, 2), 1500, 'Licencia de plantilla para el sitio de Estudio Sol');
  cost(beto, on(2, 6), 4500, 'Plugin de pagos para la tienda de Café Norte');
  for (const back of [2, 1, 0]) cost(beto, on(back, 7), 2400, 'Hosting y dominio de la tienda de Café Norte');
  cost(carla, on(1, 15), 3500, 'Fotos de stock para la campaña de Boutique Carla');
  cost(dani, on(3, 9), 2000, 'Impresión de materiales de la marca de Taller Ruiz');
  return { clients: [ana, beto, carla, dani], services, movements: movements.filter((m) => m.date <= today) };
}


/**
 * Lo que se suma a la demostración de negocio en un espacio Empresa: un préstamo para capital de trabajo (3 cuotas ya
 * pagadas, con su gasto vinculado, y la próxima en 9 días) y un activo de equipos. Así «Salud financiera» tiene deudas
 * y activos que medir. Todo con `isDemo`.
 * @param {string} today "AAAA-MM-DD" @param {string} nowISO
 * @returns {{ debts: Debt[], debtPayments: DebtPayment[], movements: Movement[], assets: Asset[] }}
 */
export function buildCompanyDemo(today, nowISO) {
  const registeredAt = `${addMonthsFrom(today, -4)}T12:00:00.000Z`;
  const { d } = parseISO(addDays(today, 9));
  const next = d <= 28 ? addDays(today, 9) : `${addDays(today, 9).slice(0, 8)}28`;
  /** @type {Debt} */
  const loan = {
    id: newId(), name: 'Préstamo de capital de trabajo (demostración)', note: 'Deuda de ejemplo para ver cómo funciona la pantalla.',
    totalCents: 15_000_000, rateBp: 1800, rateBasis: 'annual', frequency: 'monthly',
    collateralKind: 'personal', collateralType: 'prestamo-personal',
    firstDueDate: addMonthsToDate(next, -3), firstDueTime: '09:00', finalDueDate: addMonthsToDate(next, 8), finalDueTime: '17:00',
    createdAt: registeredAt, updatedAt: registeredAt, isDemo: true,
  };
  const rows = buildSchedule(loan.totalCents, periodicRate(loan), installmentDates(loan));
  /** @type {DebtPayment[]} */
  const debtPayments = [];
  /** @type {Movement[]} */
  const movements = [];
  rows.slice(0, 3).forEach((row) => {
    const p = demoPayment(loan, row.paymentCents, row.date, '09:30', nowISO);
    debtPayments.push(p.payment);
    movements.push(p.movement);
  });
  const at = (/** @type {number} */ monthsBack) => addMonthsFrom(today, -monthsBack);
  /** @type {Asset} */
  const equipment = {
    id: newId(), name: 'Equipos y mobiliario (demostración)', category: 'other', subtype: 'equipment', description: 'Activo de ejemplo.',
    acquiredDate: at(6), valuations: [{ date: at(6), valueCents: 25_000_000 }, { date: at(1), valueCents: 23_000_000 }],
    createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  };
  return { debts: [loan], debtPayments, movements, assets: [equipment] };
}

/**
 * Departamentos de ejemplo de una empresa y el reparto de sus gastos de demostración entre ellos. Recibe TODOS los movimientos
 * de demostración ya armados y los devuelve iguales, salvo que los gastos de operación llevan su departamento:
 *   - Administración (presupuesto RD$ 24,000): alquiler, electricidad, agua e internet.
 *   - Operaciones (RD$ 60,000): transporte, combustible, compra de mercancía y compras de inventario.
 *   - Ventas (RD$ 20,000): el pago al ayudante.
 *   - Mercadeo (sin presupuesto): sin gastos todavía, para ver cómo se muestra un área sin presupuesto.
 * Los pagos de deudas no se reparten (no son gasto operativo) y el combustible del mes en curso queda sin asignar, para que se vea
 * la lista de «gastos sin departamento». Todo con `isDemo`.
 * @param {Movement[]} movements @param {string} today "AAAA-MM-DD" @param {string} nowISO
 * @returns {{ departments: Department[], movements: Movement[] }}
 */
export function buildDepartmentDemo(movements, today, nowISO) {
  /** @param {string} name @param {number} pesos @returns {Department} */
  const department = (name, pesos) => ({
    id: newId(), name, monthlyBudgetCents: pesos * 100, archived: false, createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  const admin = department('Administración', 24000);
  const operations = department('Operaciones', 60000);
  const sales = department('Ventas', 20000);
  const marketing = department('Mercadeo', 0);
  const thisMonth = monthKeyOf(today);

  /** @param {Movement} m @returns {Department | null} */
  const owner = (m) => {
    if (m.type !== 'expense' || m.categoryId === DEBT_CATEGORY_ID) return null;
    if (['cat-exp-alquiler', 'cat-exp-electricidad', 'cat-exp-agua', 'cat-exp-internet'].includes(m.categoryId)) return admin;
    if (m.description.startsWith('Pago a ayudante')) return sales;
    if (m.categoryId === 'cat-exp-combustible' && monthKeyOf(m.date) === thisMonth) return null;
    if (['cat-exp-transporte', 'cat-exp-combustible'].includes(m.categoryId) || m.description.startsWith('Compra')) return operations;
    return null;
  };

  return {
    departments: [admin, operations, sales, marketing],
    movements: movements.map((m) => {
      const dep = owner(m);
      return dep ? { ...m, departmentId: dep.id } : m;
    }),
  };
}

/**
 * Lo que se suma a la demostración de un negocio (Emprendedor o Empresa): cuatro productos de una tienda de ropa inventada,
 * dos proveedores y tres meses de compras y ventas, cada una con su gasto o ingreso (porque así se registran de verdad).
 * Queda un producto con stock bajo y otro agotado para que se vean los avisos. Desde la 0.17.0 llevan grupo (Ropa, Accesorios)
 * y hay un quinto, «Caramelos sueltos», SIN CONTROL DE STOCK (no tiene compras ni ventas de stock). El stock nunca es negativo y no hay fechas
 * futuras. Todo con `isDemo`.
 * @param {string} today "AAAA-MM-DD" @param {string} nowISO
 * @returns {{ products: Product[], suppliers: Supplier[], stockEntries: StockEntry[], movements: Movement[] }}
 */
export function buildInventoryDemo(today, nowISO) {
  const { d: todayDay } = parseISO(today);
  const thisMonth = monthKeyOf(today);
  /** Fecha de un día de hace `back` meses (el mes actual nunca pasa de hoy). @param {number} back @param {number} day */
  const on = (back, day) => `${addMonths(thisMonth, -back)}-${String(back === 0 ? Math.min(day, todayDay) : Math.min(day, 28)).padStart(2, '0')}`;

  /** @param {string} name @param {string} contact @param {string} email @param {string} phone @returns {Supplier} */
  const supplier = (name, contact, email, phone) => ({
    id: newId(), name, contact, email, phone, notes: 'Proveedor de ejemplo.', archived: false, createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  const textiles = supplier('Textiles del Caribe', 'Marta Peña', 'ventas@textiles-ejemplo.test', '809-555-0140');
  const rivera = supplier('Importadora Rivera', 'Luis Rivera', 'pedidos@rivera-ejemplo.test', '809-555-0188');

  /** @param {string} name @param {string} sku @param {number} pricePesos @param {number} minStock @param {string} groupName @param {boolean} [trackStock] @returns {Product} */
  const product = (name, sku, pricePesos, minStock, groupName, trackStock = true) => ({
    id: newId(), name, sku, unit: 'unidad', priceCents: pricePesos * 100, minStock, notes: 'Producto de ejemplo.',
    archived: false, groupName, trackStock, imageData: '', createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });
  const shirt = product('Camisa de algodón', 'CAM-001', 1200, 10, 'Ropa');
  const jeans = product('Pantalón de mezclilla', 'PAN-002', 2400, 6, 'Ropa');
  const cap = product('Gorra', 'GOR-003', 600, 8, 'Accesorios');
  const belt = product('Cinturón de cuero', 'CIN-004', 900, 5, 'Accesorios');
  const candy = product('Caramelos sueltos', 'CAR-005', 10, 0, 'Dulces', false);

  /** @type {StockEntry[]} */
  const stockEntries = [];
  /** @type {Movement[]} */
  const movements = [];
  /**
   * @param {'purchase' | 'sale' | 'adjustment'} kind @param {Product} item @param {number} back @param {number} day @param {string} time
   * @param {number} units Siempre positivo (el ajuste se pasa con `sign`). @param {number} pesos Costo o precio por unidad. @param {Supplier | null} [from]
   */
  const add = (kind, item, back, day, time, units, pesos, from = null) => {
    const quantity = kind === 'purchase' ? units : -units;
    const value = {
      kind, productId: item.id, quantity, unitCents: kind === 'adjustment' ? 0 : pesos * 100, date: on(back, day),
      supplierId: from?.id ?? '', categoryId: kind === 'purchase' ? 'cat-exp-otros' : kind === 'sale' ? 'cat-inc-ventas' : '', departmentId: '', note: '',
    };
    /** @type {Movement | null} */
    let movement = null;
    if (kind !== 'adjustment') {
      const category = /** @type {any} */ ({ id: value.categoryId, defaultClassification: 'variable' });
      movement = buildStockMovement(value, item, category, { id: newId(), time, nowISO, isDemo: true });
      movement.description = `${movement.description} (demostración)`;
      movements.push(movement);
    }
    stockEntries.push({ ...buildStockEntry(value, { id: newId(), time, nowISO, movementId: movement?.id }), isDemo: true });
  };

  // Las compras van repartidas en lotes pequeños (no una sola compra enorme) para que, junto con las ventas, el dinero de
  // cada mes quede parecido al de la tienda inventada: así la demostración de negocio no se vuelve una pérdida.
  // Camisas: quedan 7 (aviso de stock bajo: el mínimo es 10).
  add('purchase', shirt, 2, 3, '10:00', 20, 600, textiles);
  add('sale', shirt, 2, 20, '15:00', 12, 1200);
  add('purchase', shirt, 1, 5, '10:00', 20, 650, textiles);
  add('sale', shirt, 1, 10, '15:00', 10, 1200);
  add('sale', shirt, 1, 25, '15:00', 5, 1200);
  add('sale', shirt, 0, 10, '15:00', 6, 1200);
  // Pantalones: quedan 11.
  add('purchase', jeans, 2, 5, '10:30', 10, 1300, rivera);
  add('sale', jeans, 2, 22, '15:00', 5, 2400);
  add('purchase', jeans, 1, 8, '10:30', 12, 1350, rivera);
  add('sale', jeans, 1, 12, '15:30', 4, 2400);
  add('sale', jeans, 0, 8, '15:30', 2, 2400);
  // Gorras: una merma de 2 y quedan 6 (stock bajo: el mínimo es 8).
  add('purchase', cap, 2, 5, '11:00', 15, 300, textiles);
  add('sale', cap, 1, 9, '16:00', 5, 600);
  add('adjustment', cap, 1, 28, '12:00', 2, 0);
  add('sale', cap, 0, 6, '16:00', 2, 600);
  // Cinturones: se agotan.
  add('purchase', belt, 1, 3, '11:30', 8, 450, rivera);
  add('sale', belt, 1, 20, '16:30', 3, 900);
  add('sale', belt, 0, 5, '16:30', 5, 900);

  return { products: [shirt, jeans, cap, belt, candy], suppliers: [textiles, rivera], stockEntries, movements };
}

/**
 * Lo que se suma a la demostración de un negocio (Emprendedor o Empresa): cinco facturas internas de clientes inventados, con
 * todos los estados (cobrada, con cobro parcial y vencida, vigente con vencimiento, sin vencimiento y anulada), cada cobro
 * con su ingreso. Llevan su propia numeración (DEMO-001…) y no mueven el inventario de demostración (sus líneas son texto libre).
 * Nunca hay fechas futuras salvo algún vencimiento. Todo con `isDemo`.
 * @param {string} today "AAAA-MM-DD" @param {string} nowISO
 * @returns {{ invoices: Invoice[], invoicePayments: InvoicePayment[], movements: Movement[] }}
 */
export function buildInvoiceDemo(today, nowISO) {
  const { d: todayDay } = parseISO(today);
  const thisMonth = monthKeyOf(today);
  /** Fecha de un día de hace `back` meses (el mes actual nunca pasa de hoy). @param {number} back @param {number} day */
  const on = (back, day) => `${addMonths(thisMonth, -back)}-${String(back === 0 ? Math.min(day, todayDay) : Math.min(day, 28)).padStart(2, '0')}`;

  /** @type {Invoice[]} */
  const invoices = [];
  /** @type {InvoicePayment[]} */
  const invoicePayments = [];
  /** @type {Movement[]} */
  const movements = [];
  let number = 0;

  /**
   * @param {string} customerName @param {string} issueDate @param {number | null} dueDays Días de plazo (null = sin vencimiento).
   * @param {number} taxRateBp @param {Array<[string, number, number]>} lines [descripción, unidades, precio por unidad en pesos]
   * @param {{ taxId?: string, contact?: string, voidedAt?: string }} [more]
   */
  const invoice = (customerName, issueDate, dueDays, taxRateBp, lines, more = {}) => {
    number += 1;
    const made = buildInvoice({
      customerName, customerTaxId: more.taxId ?? '', customerContact: more.contact ?? '', issueDate,
      dueDate: dueDays === null ? '' : addDays(issueDate, dueDays), taxRateBp, notes: 'Factura de ejemplo.',
      lines: lines.map(([description, quantity, pesos]) => ({ description, quantity, unitCents: pesos * 100 })),
    }, { id: newId(), number, nowISO, isDemo: true });
    const final = more.voidedAt ? { ...made, voidedAt: more.voidedAt } : made;
    invoices.push(final);
    return final;
  };
  /** @param {Invoice} owner @param {string} date @param {string} time @param {number} pesos */
  const collect = (owner, date, time, pesos) => {
    const category = /** @type {any} */ ({ id: 'cat-inc-ventas', defaultClassification: 'variable' });
    const value = { amountCents: pesos * 100, date, categoryId: category.id, note: '' };
    const movement = buildPaymentMovement(value, owner, category, { id: newId(), time, nowISO, isDemo: true });
    movement.description = `${movement.description} (demostración)`.slice(0, 80);
    movements.push(movement);
    invoicePayments.push(buildInvoicePayment(value, { id: newId(), invoiceId: owner.id, time, nowISO, movementId: movement.id, isDemo: true }));
  };

  // Cobrada completa (con impuesto): 30 × 450 = 13,500 + 18 % = 15,930.
  const colegio = invoice('Colegio San Rafael', on(2, 8), 15, 1800, [['Uniformes escolares (lote)', 30, 450]], { contact: 'compras@colegio-ejemplo.test' });
  collect(colegio, on(2, 20), '11:00', 15930);
  // Con cobro parcial y vencida: 28,000 + 4,000 = 32,000 + 18 % = 37,760; se cobraron 20,000 y faltan 17,760.
  const hotel = invoice('Hotel Playa Azul', on(1, 4), 15, 1800, [['Camisas bordadas', 40, 700], ['Bordado de logo', 1, 4000]], { taxId: '101-00000-0' });
  collect(hotel, on(1, 15), '10:30', 20000);
  // Vigente, con plazo de 30 días y sin impuesto: 50 × 350 = 17,500.
  invoice('Gimnasio Vitalidad', on(1, 20), 30, 0, [['Gorras con logo', 50, 350]]);
  // Sin vencimiento (al contado), sin cobrar: 8,000.
  invoice('Ferretería El Tornillo', on(0, 3), null, 0, [['Pedido especial', 1, 8000]]);
  // Anulada.
  invoice('Cliente de prueba', on(1, 12), null, 0, [['Pedido cancelado', 1, 5000]], { voidedAt: `${on(1, 13)}T12:00:00.000Z` });

  return { invoices, invoicePayments, movements };
}

/**
 * Demostración de un espacio de negocio (Emprendedor o Empresa): ocho meses de ventas y gastos de una tienda inventada,
 * con ventas que crecen, un mes más flojo y el primer mes en pérdida. Solo movimientos: sirve para ver el estado de
 * resultados, la comparación y la proyección. Nunca hay fechas futuras.
 * @param {string} today "AAAA-MM-DD" @param {string} nowISO
 * @returns {Movement[]}
 */
export function buildBusinessDemo(today, nowISO) {
  const { d: todayDay } = parseISO(today);
  const thisMonth = monthKeyOf(today);
  /** Fecha de un día de hace `back` meses (el mes actual nunca pasa de hoy). @param {number} back @param {number} day */
  const on = (back, day) => `${addMonths(thisMonth, -back)}-${String(back === 0 ? Math.min(day, todayDay) : Math.min(day, 28)).padStart(2, '0')}`;

  /** @type {Movement[]} */
  const movements = [];
  /** @param {number} back @param {number} day @param {string} time @param {'income' | 'expense'} type @param {string} categoryId @param {'fixed' | 'variable' | 'extraordinary' | 'discretionary'} classification @param {string} description @param {number} pesos */
  const add = (back, day, time, type, categoryId, classification, description, pesos) => movements.push({
    id: newId(), type, amountCents: Math.round(pesos) * 100, date: on(back, day), time, description: `${description} (demostración)`,
    classification, categoryId, createdAt: nowISO, updatedAt: nowISO, isDemo: true,
  });

  for (let back = 7; back >= 0; back -= 1) {
    const i = 7 - back; // 0 = el mes más antiguo
    const sales = 60000 + 7000 * i - (i === 4 ? 15000 : 0); // un mes más flojo en la mitad
    add(back, 5, '10:00', 'income', 'cat-inc-ventas', 'variable', 'Ventas de la semana 1', sales * 0.3);
    add(back, 12, '10:00', 'income', 'cat-inc-ventas', 'variable', 'Ventas de la semana 2', sales * 0.25);
    add(back, 19, '10:00', 'income', 'cat-inc-ventas', 'variable', 'Ventas de la semana 3', sales * 0.3);
    add(back, 26, '10:00', 'income', 'cat-inc-ventas', 'variable', 'Ventas de la semana 4', sales * 0.15);
    add(back, 1, '08:00', 'expense', 'cat-exp-alquiler', 'fixed', 'Alquiler del local', 18000);
    add(back, 4, '08:30', 'expense', 'cat-exp-transporte', 'fixed', 'Transporte de pedidos', 1800);
    add(back, 8, '09:00', 'expense', 'cat-exp-electricidad', 'fixed', 'Electricidad del local', 3200);
    add(back, 11, '09:00', 'expense', 'cat-exp-internet', 'fixed', 'Internet y teléfono', 1500);
    add(back, 14, '11:00', 'expense', 'cat-exp-otros', 'variable', 'Compra de mercancía', sales * 0.38);
    add(back, 15, '17:00', 'expense', 'cat-exp-otros', 'fixed', 'Pago a ayudante', 12000);
    add(back, 16, '13:00', 'expense', 'cat-exp-combustible', 'variable', 'Combustible de reparto', 2400);
  }
  return movements.filter((m) => m.date <= today);
}

/**
 * Facturas de demostración del espacio FREELANCER (0.14.5), ligadas a los clientes y servicios de la demostración y
 * respetando la regla de una sola fuente (ninguna factura pasa de lo que le queda por facturar a su servicio):
 *  - Beto, «Tienda en línea» (60,000; ya cobró 35,000 directo, quedan 25,000): factura de un hito de 15,000 + 18 % = 17,700,
 *    con un cobro parcial de 5,000 y VENCIDA (para ver el recordatorio de cobro);
 *  - Ana, «Mantenimiento web» del mes (6,000, sin cobrar): factura de 6,000 sin impuesto, POR VENCER;
 *  - Dani: una asesoría suelta (sin servicio) de 4,000, COBRADA.
 * Llevan su propia numeración (DEMO-001…), su cliente y `isDemo`. Cada cobro crea su ingreso con el cliente.
 * @param {{ clients: import('./types.js').Client[], services: import('./types.js').Service[] }} freelance  La demostración de buildFreelancerDemo.
 * @param {string} today @param {string} nowISO
 * @returns {{ invoices: Invoice[], invoicePayments: InvoicePayment[], movements: Movement[] }}
 */
export function buildFreelancerInvoiceDemo(freelance, today, nowISO) {
  const { d: todayDay } = parseISO(today);
  const thisMonth = monthKeyOf(today);
  /** @param {number} back @param {number} day */
  const on = (back, day) => `${addMonths(thisMonth, -back)}-${String(back === 0 ? Math.min(day, todayDay) : Math.min(day, 28)).padStart(2, '0')}`;
  const byName = (/** @type {string} */ firstName) => freelance.clients.find((c) => c.firstName === firstName);
  const serviceOf = (/** @type {string | undefined} */ clientId, /** @type {string} */ name, /** @type {string} */ status) =>
    freelance.services.find((s) => s.clientId === clientId && s.name === name && s.status === status);

  /** @type {Invoice[]} */
  const invoices = [];
  /** @type {InvoicePayment[]} */
  const invoicePayments = [];
  /** @type {Movement[]} */
  const movements = [];
  let number = 0;
  /**
   * @param {import('./types.js').Client} client @param {string} issueDate @param {number} dueDays @param {number} taxRateBp
   * @param {Array<[string, number, string | undefined]>} lines [descripción, pesos, servicio]
   */
  const invoice = (client, issueDate, dueDays, taxRateBp, lines) => {
    number += 1;
    const made = buildInvoice({
      clientId: client.id, customerName: `${client.firstName} ${client.lastName}`.trim(), customerTaxId: '', customerContact: '', issueDate,
      dueDate: addDays(issueDate, dueDays), taxRateBp, notes: 'Factura de ejemplo.',
      lines: lines.map(([description, pesos, serviceId]) => ({ description, quantity: 1, unitCents: pesos * 100, ...(serviceId ? { serviceId } : {}) })),
    }, { id: newId(), number, nowISO, isDemo: true });
    invoices.push(made);
    return made;
  };
  /** @param {Invoice} owner @param {string} date @param {number} pesos */
  const collect = (owner, date, pesos) => {
    const category = /** @type {any} */ ({ id: 'cat-inc-ventas', defaultClassification: 'variable' });
    const value = { amountCents: pesos * 100, date, categoryId: category.id, note: '' };
    const movement = buildPaymentMovement(value, owner, category, { id: newId(), time: '12:00', nowISO, isDemo: true });
    movement.description = `${movement.description} (demostración)`.slice(0, 80);
    movements.push(movement);
    invoicePayments.push(buildInvoicePayment(value, { id: newId(), invoiceId: owner.id, time: '12:00', nowISO, movementId: movement.id, isDemo: true }));
  };

  const beto = byName('Beto');
  const ana = byName('Ana');
  const dani = byName('Dani');
  const shop = serviceOf(beto?.id, 'Tienda en línea', 'in_progress');
  const maintNow = serviceOf(ana?.id, 'Mantenimiento web', 'in_progress');
  if (beto && shop) {
    const milestone = invoice(beto, on(1, 10), 15, 1800, [['Tienda en línea: hito 2 (catálogo y pagos)', 15000, shop.id]]);
    collect(milestone, on(1, 20), 5000);
  }
  if (ana && maintNow) invoice(ana, on(0, 1), 30, 0, [['Mantenimiento web del mes', 6000, maintNow.id]]);
  if (dani) {
    const advice = invoice(dani, on(2, 15), 15, 0, [['Asesoría de redes sociales (2 horas)', 4000, undefined]]);
    collect(advice, on(2, 25), 4000);
  }
  return { invoices, invoicePayments, movements: movements.filter((m) => m.date <= today) };
}
