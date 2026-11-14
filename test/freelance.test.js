// Pruebas de las métricas del freelancer: cobrado, por cobrar, ranking, flujo, servicios más vendidos y dependencia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNotices } from '../src/domain/notices.js';
import { defaultCategories } from '../src/domain/categories.js';
import {
  CONCENTRATION_MIN_PAYMENTS, CONCENTRATION_THRESHOLD, RANGE_LABELS, clientConcentration, clientCosts, clientRanking, clientSummaries, freelancerFlow,
  paidByService, rangeBounds, receivables, summarizeService, topServices,
} from '../src/domain/freelance.js';

const NOW = '2026-11-03T10:00:00.000Z';
const TODAY = '2026-11-03';
const client = (id, firstName, over = {}) => ({ id, firstName, lastName: '', company: '', email: '', phone: '', country: '', notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over });
const service = (id, clientId, name, priceCents, status, over = {}) => ({ id, clientId, name, priceCents, estimatedDays: null, status, startDate: '', createdAt: NOW, updatedAt: NOW, ...over });
let seq = 0;
const income = (date, amountCents, link = {}) => ({ id: `m${++seq}`, type: 'income', amountCents, date, time: '10:00', description: 'Pago', classification: 'variable', categoryId: 'cat-inc-ventas', createdAt: NOW, updatedAt: NOW, ...link });
const expense = (date, amountCents) => ({ id: `m${++seq}`, type: 'expense', amountCents, date, time: '10:00', description: 'Gasto', classification: 'variable', categoryId: 'cat-exp-otros', createdAt: NOW, updatedAt: NOW });
/** @returns {any} */
const dataOf = (clients, services, movements) => ({ clients, services, movements });

// Escenario completo, calculado a mano (hoy = 2026-11-03):
//   Ana (c1): Logo $5,000 en proceso (cobró 2,500), Web $20,000 finalizado (cobró 25,000: de más)
//   Beto (c2): logo $3,000 pendiente (adelanto 1,000), Logo $4,000 cancelado, y un pago suelto de 4,000 en enero
//   Carla (c3): Web $10,000 en proceso, sin cobrar nada
//   Dani (c4): archivado, pagó 8,000 el 1-dic-2025 (año pasado)
function scenario() {
  const clients = [client('c1', 'Ana'), client('c2', 'Beto'), client('c3', 'Carla'), client('c4', 'Dani', { archived: true })];
  const services = [
    service('s1', 'c1', 'Logo', 500000, 'in_progress'),
    service('s2', 'c1', 'Web', 2000000, 'done'),
    service('s3', 'c2', 'logo', 300000, 'pending'),
    service('s4', 'c2', 'Logo', 400000, 'cancelled'),
    service('s5', 'c3', 'Web', 1000000, 'in_progress'),
  ];
  const movements = [
    income('2026-09-10', 100000, { clientId: 'c1', serviceId: 's1' }),
    income('2026-10-05', 150000, { clientId: 'c1', serviceId: 's1' }),
    income('2026-10-20', 2500000, { clientId: 'c1', serviceId: 's2' }),
    income('2026-01-15', 400000, { clientId: 'c2' }),
    income('2026-10-25', 100000, { clientId: 'c2', serviceId: 's3' }),
    income('2025-12-01', 800000, { clientId: 'c4' }),
    income('2026-11-01', 50000),
    expense('2026-11-02', 30000),
    expense('2026-10-10', 20000),
    expense('2025-12-15', 10000),
  ];
  return dataOf(clients, services, movements);
}

test('rangos: este año empieza el 1 de enero; todo el tiempo no tiene inicio', () => {
  assert.deepEqual(rangeBounds('year', TODAY), { from: '2026-01-01', to: TODAY });
  assert.deepEqual(rangeBounds('all', TODAY), { from: null, to: TODAY });
  assert.deepEqual(Object.keys(RANGE_LABELS), ['year', 'all']);
});

test('cobrado por servicio: solo ingresos vinculados y no futuros', () => {
  const paid = paidByService([
    income('2026-10-01', 1000, { serviceId: 's1', clientId: 'c1' }),
    income('2026-10-02', 500, { serviceId: 's1', clientId: 'c1' }),
    income('2026-12-01', 9999, { serviceId: 's1', clientId: 'c1' }), // futuro
    income('2026-10-03', 700),                                        // sin servicio
    { ...expense('2026-10-04', 300), serviceId: 's1' },              // un gasto nunca cuenta
  ], TODAY);
  assert.equal(paid.get('s1'), 1500);
  assert.equal(paid.size, 1);
});

test('servicio: por cobrar solo si está En proceso o Finalizado, nunca negativo', () => {
  const paid = new Map([['a', 100000], ['b', 900000]]);
  const cases = [
    ['in_progress', 'a', 500000, 400000, 20],
    ['done', 'a', 500000, 400000, 20],
    ['pending', 'a', 500000, 0, 20],
    ['cancelled', 'a', 500000, 0, 20],
    ['in_progress', 'b', 500000, 0, 100],   // pagó de más: no hay deuda y el avance se corta en 100
    ['done', 'zzz', 500000, 500000, 0],     // sin pagos
  ];
  for (const [status, id, price, owed, progress] of cases) {
    const r = summarizeService(service(id, 'c1', 'X', price, status), paid);
    assert.equal(r.owedCents, owed, `${status}/${id} por cobrar`);
    assert.equal(r.progressPercent, progress, `${status}/${id} avance`);
  }
  assert.equal(summarizeService(service('a', 'c1', 'X', 500000, 'done'), paid).paidCents, 100000);
});

test('clientes: cobrado, pagos, meses activos, último pago y por cobrar (este año)', () => {
  const rows = clientSummaries(scenario(), { range: 'year', today: TODAY });
  const by = Object.fromEntries(rows.map((r) => [r.client.id, r]));
  assert.equal(rows.length, 4, 'incluye archivados y clientes sin pagos');
  assert.equal(by.c1.incomeCents, 2750000);
  assert.equal(by.c1.payments, 3);
  assert.equal(by.c1.activeMonths, 2);
  assert.equal(by.c1.lastPaymentDate, '2026-10-20');
  assert.equal(by.c1.owedCents, 250000, 'Logo debe 2,500; Web cobrada de más no resta ni suma');
  assert.deepEqual(by.c1.services, { total: 2, pending: 0, inProgress: 1, done: 1, cancelled: 0 });
  assert.equal(by.c2.incomeCents, 500000);
  assert.equal(by.c2.activeMonths, 2);
  assert.equal(by.c2.lastPaymentDate, '2026-10-25');
  assert.equal(by.c2.owedCents, 0, 'pendiente y cancelado no se cuentan');
  assert.deepEqual(by.c2.services, { total: 2, pending: 1, inProgress: 0, done: 0, cancelled: 1 });
  assert.equal(by.c3.incomeCents, 0);
  assert.equal(by.c3.payments, 0);
  assert.equal(by.c3.lastPaymentDate, null);
  assert.equal(by.c3.owedCents, 1000000);
  assert.equal(by.c4.incomeCents, 0, 'su pago fue el año pasado');
  assert.equal(by.c4.lastPaymentDate, '2025-12-01', 'pero el último pago es de todo el tiempo');
  // Partes del total cobrado a clientes en el período: suman 100.
  assert.ok(Math.abs(by.c1.sharePercent - (2750000 / 3250000) * 100) < 1e-9);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.sharePercent, 0) - 100) < 1e-9);
});

test('clientes: todo el tiempo suma también el año pasado', () => {
  const by = Object.fromEntries(clientSummaries(scenario(), { range: 'all', today: TODAY }).map((r) => [r.client.id, r]));
  assert.equal(by.c4.incomeCents, 800000);
  assert.equal(by.c4.payments, 1);
  assert.equal(by.c4.activeMonths, 1);
  assert.equal(by.c1.incomeCents, 2750000);
});

test('clientes: lista ordenada (archivados al final) y sin datos no falla', () => {
  const rows = clientSummaries(scenario(), { range: 'year', today: TODAY });
  assert.deepEqual(rows.map((r) => r.client.id), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(clientSummaries(dataOf([], [], []), { range: 'year', today: TODAY }), []);
  const empty = clientSummaries(dataOf([client('c1', 'Ana')], [], []), { range: 'all', today: TODAY });
  assert.equal(empty[0].sharePercent, 0);
  assert.equal(empty[0].owedCents, 0);
});

test('clientes: ingresos futuros y vínculos rotos no cuentan', () => {
  const data = dataOf([client('c1', 'Ana')], [], [
    income('2026-10-01', 1000, { clientId: 'c1' }),
    income('2026-12-25', 5000, { clientId: 'c1' }),     // futuro
    income('2026-10-02', 7000, { clientId: 'fantasma' }), // cliente que no existe
    expense('2026-10-03', 400),
  ]);
  const [row] = clientSummaries(data, { range: 'all', today: TODAY });
  assert.equal(row.incomeCents, 1000);
  assert.equal(row.payments, 1);
  assert.equal(row.sharePercent, 100);
});

test('ranking: más rentable, más recurrente y mayor deuda', () => {
  const r = clientRanking(clientSummaries(scenario(), { range: 'year', today: TODAY }));
  assert.equal(r.mostProfitable?.client.id, 'c1');
  assert.equal(r.mostRecurrent?.client.id, 'c1', 'empata con Beto en meses (2) y gana por más pagos (3 contra 2)');
  assert.equal(r.mostOwing?.client.id, 'c3');
});

test('ranking: nadie cumple → null (sin pagos, sin deudas)', () => {
  const r = clientRanking(clientSummaries(dataOf([client('c1', 'Ana'), client('c2', 'Beto')], [], []), { range: 'year', today: TODAY }));
  assert.deepEqual(r, { mostProfitable: null, topPayer: null, mostRecurrent: null, mostOwing: null, atLoss: [] });
  assert.deepEqual(clientRanking([]), { mostProfitable: null, topPayer: null, mostRecurrent: null, mostOwing: null, atLoss: [] });
});

test('ranking: los empates se resuelven siempre igual (por pagos, luego monto, luego nombre)', () => {
  // Mismo monto y mismos meses y pagos: gana el nombre que va primero en español, sin depender del orden de entrada.
  const make = (order) => {
    const cs = order.map((n, i) => client(`c${i}`, n));
    const byName = Object.fromEntries(cs.map((c) => [c.firstName, c.id]));
    const ms = [income('2026-10-01', 1000, { clientId: byName.Zoila }), income('2026-10-01', 1000, { clientId: byName.Álvaro })];
    return clientRanking(clientSummaries(dataOf(cs, [], ms), { range: 'year', today: TODAY }));
  };
  assert.equal(make(['Zoila', 'Álvaro']).mostProfitable?.client.firstName, 'Álvaro');
  assert.equal(make(['Álvaro', 'Zoila']).mostProfitable?.client.firstName, 'Álvaro');
  assert.equal(make(['Zoila', 'Álvaro']).mostRecurrent?.client.firstName, 'Álvaro');
  // Más pagos pero menos dinero: el más rentable es el que más pagó, el más recurrente el de más meses.
  const cs = [client('a', 'Ana'), client('b', 'Beto')];
  const ms = [
    income('2026-08-01', 100, { clientId: 'a' }), income('2026-09-01', 100, { clientId: 'a' }), income('2026-10-01', 100, { clientId: 'a' }),
    income('2026-10-02', 5000, { clientId: 'b' }),
  ];
  const r = clientRanking(clientSummaries(dataOf(cs, [], ms), { range: 'year', today: TODAY }));
  assert.equal(r.mostProfitable?.client.id, 'b');
  assert.equal(r.mostRecurrent?.client.id, 'a');
});

test('servicios más vendidos: agrupa por nombre sin mayúsculas, ignora cancelados', () => {
  const top = topServices(scenario(), TODAY);
  assert.deepEqual(top, [
    { name: 'Web', count: 2, agreedCents: 3000000, paidCents: 2500000 },
    { name: 'Logo', count: 2, agreedCents: 800000, paidCents: 350000 },
  ]);
  assert.deepEqual(topServices(dataOf([], [], []), TODAY), []);
});

test('servicios más vendidos: orden por cantidad y nombre con el que se creó primero', () => {
  const svc = [
    service('a', 'c1', 'Fotos', 100, 'done', { createdAt: '2026-01-01T00:00:00.000Z' }),
    service('b', 'c1', 'FOTOS', 100, 'done', { createdAt: '2026-02-01T00:00:00.000Z' }),
    service('c', 'c1', 'Video', 100, 'done'),
    service('d', 'c1', 'Video', 100, 'cancelled'),
  ];
  const top = topServices(dataOf([], svc, []), TODAY);
  assert.deepEqual(top.map((t) => [t.name, t.count]), [['Fotos', 2], ['Video', 1]]);
});

test('flujo de caja: mes, año, todo el tiempo, sin cliente y últimos 6 meses', () => {
  const f = freelancerFlow(scenario(), TODAY);
  assert.equal(f.monthKey, '2026-11');
  assert.equal(f.monthIncomeCents, 50000);
  assert.equal(f.monthExpenseCents, 30000);
  assert.equal(f.monthNetCents, 20000);
  assert.equal(f.yearIncomeCents, 3300000);
  assert.equal(f.yearExpenseCents, 50000);
  assert.equal(f.yearNetCents, 3250000);
  assert.equal(f.allIncomeCents, 4100000);
  assert.equal(f.unlinkedIncomeCents, 50000);
  assert.deepEqual(f.series.map((s) => s.key), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(f.series.map((s) => s.incomeCents), [0, 0, 0, 100000, 2750000, 50000]);
  assert.deepEqual(f.series.map((s) => s.expenseCents), [0, 0, 0, 0, 20000, 30000]);
  assert.deepEqual(f.series.map((s) => s.netCents), [0, 0, 0, 100000, 2730000, 20000]);
});

test('flujo de caja: sin datos todo en cero y los movimientos futuros no cuentan', () => {
  const f = freelancerFlow(dataOf([], [], []), TODAY);
  assert.equal(f.monthNetCents, 0);
  assert.equal(f.series.length, 6);
  const g = freelancerFlow(dataOf([], [], [income('2026-11-20', 999), expense('2026-11-21', 111), income('2026-11-02', 10)]), TODAY);
  assert.equal(g.monthIncomeCents, 10);
  assert.equal(g.monthExpenseCents, 0);
  assert.equal(g.series[5].incomeCents, 10);
  assert.equal(g.allIncomeCents, 10);
});

test('flujo de caja al empezar el año: el año y la serie cruzan diciembre', () => {
  const data = dataOf([], [], [income('2025-12-20', 700), income('2026-01-02', 300), expense('2025-11-30', 50)]);
  const f = freelancerFlow(data, '2026-01-05');
  assert.equal(f.yearIncomeCents, 300);
  assert.equal(f.yearExpenseCents, 0);
  assert.equal(f.allIncomeCents, 1000);
  assert.deepEqual(f.series.map((s) => s.key), ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
  assert.deepEqual(f.series.map((s) => s.incomeCents), [0, 0, 0, 0, 700, 300]);
});

test('por cobrar: total y servicios que lo componen, de mayor a menor', () => {
  const r = receivables(scenario(), TODAY);
  assert.equal(r.totalCents, 1250000);
  assert.deepEqual(r.rows.map((x) => [x.service.id, x.owedCents]), [['s5', 1000000], ['s1', 250000]]);
  // Sin facturas: lo por cobrar sale solo de los servicios (0.14.5 añade la parte de facturas, aquí en cero).
  assert.equal(r.servicesCents, 1250000);
  assert.equal(r.invoicesCents, 0);
  assert.deepEqual(receivables(dataOf([], [], []), TODAY), { totalCents: 0, servicesCents: 0, invoicesCents: 0, rows: [], invoices: [] });
});

test('por cobrar: un pago posterior lo reduce y al cubrir el precio desaparece', () => {
  const data = scenario();
  data.movements.push(income('2026-11-02', 250000, { clientId: 'c1', serviceId: 's1' }));
  const r = receivables(data, TODAY);
  assert.equal(r.totalCents, 1000000);
  assert.deepEqual(r.rows.map((x) => x.service.id), ['s5']);
});

test('dependencia de un cliente: avisa con 60% o más y al menos 3 pagos vinculados', () => {
  const c = clientConcentration(scenario(), TODAY);
  assert.equal(c?.client.id, 'c1');
  assert.equal(c?.payments, 3);
  assert.ok(Math.abs((c?.percent ?? 0) - (2750000 / 4100000) * 100) < 1e-9);
  assert.equal(CONCENTRATION_THRESHOLD, 60);
  assert.equal(CONCENTRATION_MIN_PAYMENTS, 3);
});

test('dependencia: justo en el umbral avisa, un poco menos no', () => {
  const cs = [client('a', 'Ana'), client('b', 'Beto')];
  const exact = dataOf(cs, [], [income('2026-10-01', 300, { clientId: 'a' }), income('2026-10-02', 300, { clientId: 'a' }), income('2026-10-03', 400, { clientId: 'b' })]);
  assert.equal(clientConcentration(exact, TODAY)?.percent, 60);
  const below = dataOf(cs, [], [income('2026-10-01', 299, { clientId: 'a' }), income('2026-10-02', 300, { clientId: 'a' }), income('2026-10-03', 400, { clientId: 'b' })]);
  assert.equal(clientConcentration(below, TODAY), null);
});

test('dependencia: pocos pagos, ingresos sin cliente o datos viejos no avisan', () => {
  const cs = [client('a', 'Ana')];
  assert.equal(clientConcentration(dataOf(cs, [], [income('2026-10-01', 1000, { clientId: 'a' }), income('2026-10-02', 1000, { clientId: 'a' })]), TODAY), null, 'solo 2 pagos');
  assert.equal(clientConcentration(dataOf(cs, [], [income('2026-10-01', 100, { clientId: 'a' }), income('2026-10-02', 100, { clientId: 'a' }), income('2026-10-03', 100, { clientId: 'a' }), income('2026-10-04', 900)]), TODAY), null, 'el resto del dinero no tiene cliente');
  assert.equal(clientConcentration(dataOf(cs, [], []), TODAY), null);
  // Fuera de los últimos 12 meses no cuenta (el límite es el 1 de diciembre de 2025).
  const old = dataOf(cs, [], [income('2025-11-30', 1000, { clientId: 'a' }), income('2025-11-29', 1000, { clientId: 'a' }), income('2025-11-28', 1000, { clientId: 'a' })]);
  assert.equal(clientConcentration(old, TODAY), null);
  const edge = dataOf(cs, [], [income('2025-12-01', 1000, { clientId: 'a' }), income('2025-12-02', 1000, { clientId: 'a' }), income('2026-01-01', 1000, { clientId: 'a' })]);
  assert.equal(clientConcentration(edge, TODAY)?.percent, 100);
});

test('dependencia: los ingresos sin cliente no cuentan como pagos vinculados', () => {
  const cs = [client('a', 'Ana')];
  // 2 pagos de Ana (90% del dinero) + 2 ingresos sueltos: solo hay 2 pagos vinculados, aún no se avisa.
  const data = dataOf(cs, [], [income('2026-10-01', 1000, { clientId: 'a' }), income('2026-10-02', 1000, { clientId: 'a' }), income('2026-10-03', 100), income('2026-10-04', 100)]);
  assert.equal(clientConcentration(data, TODAY), null);
  data.movements.push(income('2026-10-05', 1000, { clientId: 'a' }));
  assert.equal(clientConcentration(data, TODAY)?.payments, 3);
});

test('dependencia: si el cliente fue borrado del respaldo, no falla', () => {
  const data = dataOf([], [], [income('2026-10-01', 100, { clientId: 'x' }), income('2026-10-02', 100, { clientId: 'x' }), income('2026-10-03', 100, { clientId: 'x' })]);
  assert.equal(clientConcentration(data, TODAY), null);
});

// ---- Avisos del Inicio ---------------------------------------------------------------------------

const withBase = (/** @type {any} */ d) => ({ ...d, categories: defaultCategories(), goals: [], contributions: [], debts: [], debtPayments: [], assets: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], settings: { displayName: '', openingBalanceCents: 0 } });

test('avisos: sin clientes no hay avisos de clientes (aunque haya ingresos)', () => {
  const data = withBase(dataOf([], [], [income('2026-11-01', 5000)]));
  assert.deepEqual(computeNotices(data, TODAY).filter((n) => /receivable|client/.test(n.id)), []);
});

test('avisos: servicio finalizado con saldo avisa (en proceso y pendiente no)', () => {
  const data = withBase(scenario());
  // En el escenario, el servicio finalizado (Web de Ana) está cobrado de más: no hay aviso.
  assert.ok(!computeNotices(data, TODAY).some((n) => n.id === 'receivable-done'));
  data.services.push(service('s9', 'c1', 'Banner', 300000, 'done'));
  data.services.push(service('s10', 'c2', 'Video', 900000, 'done'));
  const notice = computeNotices(data, TODAY).find((n) => n.id === 'receivable-done');
  assert.ok(notice);
  assert.match(notice.text, /RD\$ 12,000\.00 por cobrar de 2 servicios ya finalizados/);
  assert.equal(notice.level, 'info');
});

test('avisos: la dependencia de un cliente aparece con su nombre y nunca es crítica', () => {
  const data = withBase(scenario());
  const notice = computeNotices(data, TODAY).find((n) => n.id === 'client-concentration');
  assert.ok(notice);
  assert.match(notice.text, /«Ana» te pagó el 67 %/);
  assert.equal(notice.level, 'info');
  data.movements = data.movements.filter((m) => m.clientId !== 'c1');
  assert.ok(!computeNotices(data, TODAY).some((n) => n.id === 'client-concentration'));
});

// ---- Gastos cargados a clientes: neto, margen, ranking y avisos ----------------------------------

/** Un gasto cargado a un cliente. */
const costFor = (clientId, date, amountCents) => ({ ...expense(date, amountCents), clientId });
/** @param {any} rows @param {string} id */
const row = (rows, id) => rows.find((r) => r.client.id === id);

// Hoy = 2026-11-03. Este año:
//   Ana (c1): cobró 10,000 (3 pagos) y se le cargaron 2,500 → neto 7,500, margen 75 %
//   Beto (c2): cobró 4,000 y se le cargaron 4,000 → neto 0 (justo en cero, no es pérdida)
//   Carla (c3): cobró 0 y se le cargaron 3,000 → neto −3,000, sin margen
//   Dani (c4): cobró 3,000 y se le cargaron 5,000 → neto −2,000
//   Eli (c5): sin movimientos
function profitScenario() {
  const clients = ['Ana', 'Beto', 'Carla', 'Dani', 'Eli'].map((n, i) => client(`c${i + 1}`, n));
  const movements = [
    income('2026-03-01', 400000, { clientId: 'c1' }), income('2026-06-01', 300000, { clientId: 'c1' }), income('2026-10-01', 300000, { clientId: 'c1' }),
    costFor('c1', '2026-04-01', 100000), costFor('c1', '2026-10-15', 150000),
    income('2026-05-01', 400000, { clientId: 'c2' }), costFor('c2', '2026-05-02', 400000),
    costFor('c3', '2026-09-01', 300000),
    income('2026-08-01', 300000, { clientId: 'c4' }), costFor('c4', '2026-08-02', 500000),
    expense('2026-10-20', 70000), // gasto general: no es de nadie
  ];
  return dataOf(clients, [], movements);
}

test('rentabilidad por cliente: gastos, neto y margen se calculan con lo cargado a cada uno', () => {
  const rows = clientSummaries(profitScenario(), { range: 'year', today: TODAY });
  const ana = row(rows, 'c1');
  assert.deepEqual([ana.incomeCents, ana.expenseCents, ana.expenseCount, ana.netCents, ana.marginPercent], [1000000, 250000, 2, 750000, 75]);
  const beto = row(rows, 'c2');
  assert.deepEqual([beto.netCents, beto.marginPercent], [0, 0]);
  const carla = row(rows, 'c3');
  assert.deepEqual([carla.incomeCents, carla.expenseCents, carla.netCents, carla.marginPercent], [0, 300000, -300000, null], 'sin cobros no hay margen');
  assert.equal(row(rows, 'c4').netCents, -200000);
  const eli = row(rows, 'c5');
  assert.deepEqual([eli.expenseCents, eli.expenseCount, eli.netCents, eli.marginPercent], [0, 0, 0, null]);
});

test('rentabilidad: el gasto general (sin cliente) no se reparte entre clientes', () => {
  const data = profitScenario();
  const before = clientSummaries(data, { range: 'year', today: TODAY });
  const noGeneral = clientSummaries({ ...data, movements: data.movements.filter((m) => m.clientId || m.type === 'income') }, { range: 'year', today: TODAY });
  assert.deepEqual(before.map((r) => r.netCents), noGeneral.map((r) => r.netCents));
});

test('rentabilidad: el período manda (este año / todo el tiempo) y lo futuro no cuenta', () => {
  const data = profitScenario();
  data.movements.push(costFor('c1', '2025-12-10', 40000), costFor('c1', '2026-12-01', 99900000)); // año pasado y futuro
  const year = row(clientSummaries(data, { range: 'year', today: TODAY }), 'c1');
  const all = row(clientSummaries(data, { range: 'all', today: TODAY }), 'c1');
  assert.equal(year.expenseCents, 250000, 'el año pasado y el futuro no entran en «este año»');
  assert.equal(all.expenseCents, 290000, 'todo el tiempo suma el año pasado, pero nunca el futuro');
  assert.equal(all.expenseCount, 3);
});

test('rentabilidad: un gasto de un cliente que ya no existe no se cuenta como suyo', () => {
  const data = profitScenario();
  data.movements.push(costFor('borrado', '2026-10-02', 777000));
  const rows = clientSummaries(data, { range: 'year', today: TODAY });
  assert.equal(rows.reduce((s, r) => s + r.expenseCents, 0), 1450000, '2,500 + 4,000 + 3,000 + 5,000 + 0 (el huérfano no suma)');
});

test('ranking: «más rentable» es el mayor neto, no el que más paga; «el que más paga» sigue aparte', () => {
  const ms = [
    income('2026-10-01', 1000000, { clientId: 'c1' }), costFor('c1', '2026-10-02', 900000), // paga más, deja 1,000
    income('2026-10-01', 500000, { clientId: 'c2' }), // paga menos, deja 5,000
  ];
  const r = clientRanking(clientSummaries(dataOf([client('c1', 'Ana'), client('c2', 'Beto')], [], ms), { range: 'year', today: TODAY }));
  assert.equal(r.mostProfitable?.client.id, 'c2');
  assert.equal(r.topPayer?.client.id, 'c1');
});

test('ranking: sin gastos cargados, «más rentable» coincide con «el que más paga» (como antes)', () => {
  const r = clientRanking(clientSummaries(scenario(), { range: 'year', today: TODAY }));
  assert.equal(r.mostProfitable?.client.id, r.topPayer?.client.id);
  assert.deepEqual(r.atLoss, []);
});

test('ranking: si todos los clientes están en pérdida o en cero, nadie es «más rentable»', () => {
  const rows = clientSummaries(profitScenario(), { range: 'year', today: TODAY }).filter((r) => ['c2', 'c3', 'c4', 'c5'].includes(r.client.id));
  assert.equal(clientRanking(rows).mostProfitable, null);
});

test('ranking: «en pérdida» lista solo netos negativos, del que más pierde al que menos (cero no es pérdida)', () => {
  const r = clientRanking(clientSummaries(profitScenario(), { range: 'year', today: TODAY }));
  assert.deepEqual(r.atLoss.map((x) => x.client.id), ['c3', 'c4']);
});

test('ranking: empate de pérdidas se resuelve por nombre, siempre igual', () => {
  const mk = (order) => {
    const cs = order.map((n, i) => client(`k${i}`, n));
    const byName = Object.fromEntries(cs.map((c) => [c.firstName, c.id]));
    return clientRanking(clientSummaries(dataOf(cs, [], [costFor(byName.Zoila, '2026-10-01', 1000), costFor(byName.Álvaro, '2026-10-01', 1000)]), { range: 'year', today: TODAY })).atLoss.map((x) => x.client.firstName);
  };
  assert.deepEqual(mk(['Zoila', 'Álvaro']), ['Álvaro', 'Zoila']);
  assert.deepEqual(mk(['Álvaro', 'Zoila']), ['Álvaro', 'Zoila']);
});

test('costos: lo cargado a clientes + lo general = el total de gastos del período, y todo cuadra con el flujo', () => {
  const data = profitScenario();
  const c = clientCosts(data, { range: 'year', today: TODAY });
  assert.deepEqual(c, { assignedCents: 1450000, generalCents: 70000, totalCents: 1520000 });
  assert.equal(c.totalCents, freelancerFlow(data, TODAY).yearExpenseCents, 'es el mismo total de gastos que ve el flujo de caja');
});

test('costos: huérfanos y fuera de período cuentan donde corresponde', () => {
  const data = profitScenario();
  data.movements.push(costFor('borrado', '2026-10-02', 5000), costFor('c1', '2025-05-05', 9000), costFor('c1', '2026-12-25', 8000));
  assert.deepEqual(clientCosts(data, { range: 'year', today: TODAY }), { assignedCents: 1450000, generalCents: 75000, totalCents: 1525000 });
  assert.equal(clientCosts(data, { range: 'all', today: TODAY }).assignedCents, 1459000, 'todo el tiempo suma el 2025 pero no el futuro');
  assert.deepEqual(clientCosts(dataOf([], [], []), { range: 'year', today: TODAY }), { assignedCents: 0, generalCents: 0, totalCents: 0 });
});

test('cargar un gasto a un cliente no cambia el flujo de caja ni lo cobrado por servicio', () => {
  const base = scenario();
  const charged = { ...base, movements: base.movements.map((m) => (m.type === 'expense' && m.date === '2026-11-02' ? { ...m, clientId: 'c1' } : m)) };
  assert.deepEqual(freelancerFlow(charged, TODAY), freelancerFlow(base, TODAY));
  assert.deepEqual([...paidByService(charged.movements, TODAY)], [...paidByService(base.movements, TODAY)]);
  assert.equal(row(clientSummaries(charged, { range: 'year', today: TODAY }), 'c1').incomeCents, row(clientSummaries(base, { range: 'year', today: TODAY }), 'c1').incomeCents);
});

test('aviso «cliente en pérdida»: dice cuánto se gastó y cuánto pagó, y suma a los demás', () => {
  const notices = computeNotices(withBase(profitScenario()), TODAY);
  const n = notices.find((x) => x.id === 'client-at-loss');
  assert.ok(n, 'hay aviso');
  assert.equal(n.level, 'info', 'es informativo, no una alarma');
  assert.match(n.text, /Carla/);
  assert.match(n.text, /3,000/);
  assert.match(n.text, /otro cliente más/);
});

test('aviso «cliente en pérdida»: solo mira este año (lo que se perdió en años anteriores no avisa)', () => {
  // 2025: cobró 1,000 y se le cargaron 9,000. 2026: cobró 5,000 sin gastos. En todo el historial va en pérdida, este año no.
  const past = withBase(dataOf([client('c1', 'Ana')], [], [
    income('2025-03-01', 100000, { clientId: 'c1' }), costFor('c1', '2025-03-02', 900000), income('2026-05-01', 500000, { clientId: 'c1' }),
  ]));
  assert.ok(!computeNotices(past, TODAY).some((x) => x.id === 'client-at-loss'), 'este año va en positivo');
  const now = withBase(dataOf([client('c1', 'Ana')], [], [income('2026-05-01', 100000, { clientId: 'c1' }), costFor('c1', '2026-05-02', 900000)]));
  assert.ok(computeNotices(now, TODAY).some((x) => x.id === 'client-at-loss'), 'este año va en pérdida');
});

test('aviso «cliente en pérdida»: no aparece si ningún cliente gasta más de lo que paga', () => {
  const notices = computeNotices(withBase(scenario()), TODAY);
  assert.ok(!notices.some((x) => x.id === 'client-at-loss'));
});
