// Pruebas de clientes, servicios y del vínculo de los ingresos con ellos (documento maestro §9).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ESTIMATED_DAYS, SERVICE_STATUSES, SERVICE_STATUS_LABELS, applyClientEdit, applyServiceEdit, buildClient, buildService,
  clientFullName, clientLabel, clientUsage, isServiceStatus, sortClients, sortServices, validateClient, validateService,
} from '../src/domain/clients.js';
import { applyMovementEdit, buildMovement, validateMovement } from '../src/domain/movements.js';
import { defaultCategories } from '../src/domain/categories.js';
import { LIMITS } from '../src/domain/types.js';

const NOW = '2026-11-03T10:00:00.000Z';
const TODAY = '2026-11-03';
const client = (over = {}) => ({ id: 'c1', firstName: 'Ana', lastName: 'Pérez', company: 'Estudio Sol', email: '', phone: '', country: '', notes: '', archived: false, createdAt: NOW, updatedAt: NOW, ...over });
const service = (over = {}) => ({ id: 's1', clientId: 'c1', name: 'Logo', priceCents: 500000, estimatedDays: 10, status: 'in_progress', startDate: '2026-10-01', createdAt: NOW, updatedAt: NOW, ...over });
const okValue = (/** @type {any} */ r) => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };

// ---- Clientes ------------------------------------------------------------------------------------

test('cliente: solo el nombre es obligatorio; el resto sale vacío', () => {
  const v = okValue(validateClient({ firstName: '  Ana  ' }, { clients: [] }));
  assert.deepEqual(v, { firstName: 'Ana', lastName: '', company: '', email: '', phone: '', country: '', notes: '' });
  const r = validateClient({ firstName: '   ' }, { clients: [] });
  assert.ok(!r.ok && r.errors.firstName);
});

test('cliente: datos completos se limpian (espacios, correo sin espacios)', () => {
  const v = okValue(validateClient({ firstName: ' Ana ', lastName: ' de   la Cruz ', company: ' Sol  SRL ', email: ' ana @ sol.do ', phone: ' +1 809 555 0100 ', country: ' República  Dominicana ', notes: ' Paga  a tiempo ' }, { clients: [] }));
  assert.equal(v.lastName, 'de la Cruz');
  assert.equal(v.company, 'Sol SRL');
  assert.equal(v.email, 'ana@sol.do');
  assert.equal(v.phone, '+1 809 555 0100');
  assert.equal(v.country, 'República Dominicana');
  assert.equal(v.notes, 'Paga a tiempo');
});

test('cliente: correo y teléfono con formato razonable, máximos y errores por campo', () => {
  const r = validateClient({ firstName: 'A', email: 'mal', phone: '12' }, { clients: [] });
  assert.ok(!r.ok);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'phone']);
  const big = validateClient({ firstName: 'x'.repeat(LIMITS.clientName + 1), lastName: 'y'.repeat(LIMITS.clientName + 1), company: 'z'.repeat(LIMITS.clientCompany + 1), country: 'p'.repeat(LIMITS.clientCountry + 1), notes: 'n'.repeat(LIMITS.clientNotes + 1) }, { clients: [] });
  assert.ok(!big.ok);
  if (!big.ok) assert.deepEqual(Object.keys(big.errors).sort(), ['company', 'country', 'firstName', 'lastName', 'notes']);
  assert.ok(validateClient({ firstName: 'x'.repeat(LIMITS.clientName) }, { clients: [] }).ok);
});

test('cliente: no se repite el mismo nombre + apellido + empresa (sin importar mayúsculas ni tildes de caso)', () => {
  const clients = [client()];
  const dup = validateClient({ firstName: 'ANA', lastName: 'pérez', company: 'estudio sol' }, { clients });
  assert.ok(!dup.ok && /Ya tienes un cliente/.test(dup.errors.firstName));
  assert.ok(validateClient({ firstName: 'Ana', lastName: 'Pérez', company: 'Otra empresa' }, { clients }).ok, 'otra empresa = otro cliente');
  assert.ok(validateClient({ firstName: 'Ana', lastName: 'Pérez', company: 'Estudio Sol' }, { clients, exceptId: 'c1' }).ok, 'al editarse a sí mismo no choca');
});

test('cliente: construir, editar (conserva archivado, fechas y marca demo) y mostrar', () => {
  const built = buildClient(okValue(validateClient({ firstName: 'Ana', lastName: 'Pérez', company: 'Sol' }, { clients: [] })), { id: 'x', nowISO: NOW });
  assert.equal(built.archived, false);
  assert.equal(built.createdAt, NOW);
  assert.equal(clientFullName(built), 'Ana Pérez');
  assert.equal(clientLabel(built), 'Ana Pérez · Sol');
  assert.equal(clientLabel({ firstName: 'Luis', lastName: '', company: '' }), 'Luis');
  const edited = applyClientEdit({ ...built, archived: true, isDemo: true }, { firstName: 'Ana', lastName: 'Pérez', company: 'Sol SRL', email: '', phone: '', country: '', notes: '' }, '2026-12-01T00:00:00.000Z');
  assert.equal(edited.archived, true);
  assert.equal(edited.isDemo, true);
  assert.equal(edited.createdAt, NOW);
  assert.equal(edited.updatedAt, '2026-12-01T00:00:00.000Z');
  assert.equal(edited.company, 'Sol SRL');
});

test('clientes: orden alfabético con tildes y los archivados al final', () => {
  const list = [client({ id: '1', firstName: 'Zoila', lastName: '' , company: ''}), client({ id: '2', firstName: 'Álvaro', lastName: '', company: '', archived: true }), client({ id: '3', firstName: 'Beto', lastName: '', company: '' }), client({ id: '4', firstName: 'Ángel', lastName: '', company: '' })];
  assert.deepEqual(sortClients(list).map((c) => c.id), ['4', '3', '1', '2']);
});

test('clientUsage cuenta facturas (0.14.5), servicios, pagos (ingresos) y gastos cargados de un cliente', () => {
  const data = {
    services: [service(), service({ id: 's2' }), service({ id: 's3', clientId: 'c2' })],
    movements: [{ type: 'income', clientId: 'c1' }, { type: 'expense', clientId: 'c1' }, { type: 'expense', clientId: 'c1' }, { type: 'income', clientId: 'c2' }, { type: 'income' }],
  };
  // @ts-ignore datos mínimos de prueba
  assert.deepEqual(clientUsage(data, 'c1'), { invoices: 0, services: 2, payments: 1, expenses: 2 });
  // @ts-ignore
  assert.deepEqual(clientUsage(data, 'c2'), { invoices: 0, services: 1, payments: 1, expenses: 0 });
  // Con facturas (también anuladas): cuentan, para que el cliente no se pueda borrar.
  // @ts-ignore
  assert.equal(clientUsage({ ...data, invoices: [{ clientId: 'c1' }, { clientId: 'c1', voidedAt: 'x' }, {}] }, 'c1').invoices, 2);
  // @ts-ignore
  assert.deepEqual(clientUsage(data, 'nadie'), { invoices: 0, services: 0, payments: 0, expenses: 0 });
});

// ---- Servicios -----------------------------------------------------------------------------------

const sInput = (over = {}) => ({ clientId: 'c1', name: 'Logo', priceText: '5,000', estimatedDaysText: '10', status: 'in_progress', startDate: '2026-10-01', ...over });

test('servicio: los cuatro estados del documento maestro', () => {
  assert.deepEqual([...SERVICE_STATUSES], ['pending', 'in_progress', 'done', 'cancelled']);
  assert.deepEqual(Object.values(SERVICE_STATUS_LABELS), ['Pendiente', 'En proceso', 'Finalizado', 'Cancelado']);
  assert.ok(isServiceStatus('done') && !isServiceStatus('hecho') && !isServiceStatus(undefined));
});

test('servicio: datos válidos', () => {
  const v = okValue(validateService(sInput({ name: '  Diseño   de logo ' }), { clients: [client()] }));
  assert.deepEqual(v, { clientId: 'c1', name: 'Diseño de logo', priceCents: 500000, estimatedDays: 10, status: 'in_progress', startDate: '2026-10-01' });
});

test('servicio: duración y fecha de inicio son opcionales', () => {
  const v = okValue(validateService(sInput({ estimatedDaysText: '', startDate: '' }), { clients: [client()] }));
  assert.equal(v.estimatedDays, null);
  assert.equal(v.startDate, '');
});

test('servicio: errores por campo (cliente, nombre, precio, duración, estado, fecha)', () => {
  const r = validateService({ clientId: 'nadie', name: ' ', priceText: '0', estimatedDaysText: 'abc', status: 'raro', startDate: '2026-02-31' }, { clients: [client()] });
  assert.ok(!r.ok);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['clientId', 'estimatedDays', 'name', 'price', 'startDate', 'status']);
});

test('servicio: precio estricto, duración entera dentro de rango, nombre con máximo', () => {
  const c = [client()];
  for (const bad of ['', '-5', '0', 'cinco', '999999999999999']) assert.ok(!validateService(sInput({ priceText: bad }), { clients: c }).ok, `precio ${bad}`);
  for (const bad of ['0', '-1', '1.5', '3651', '12345', ' x']) assert.ok(!validateService(sInput({ estimatedDaysText: bad }), { clients: c }).ok, `días ${bad}`);
  assert.ok(validateService(sInput({ estimatedDaysText: String(MAX_ESTIMATED_DAYS) }), { clients: c }).ok);
  assert.ok(!validateService(sInput({ name: 'x'.repeat(LIMITS.serviceName + 1) }), { clients: c }).ok);
  assert.ok(validateService(sInput({ name: 'x'.repeat(LIMITS.serviceName) }), { clients: c }).ok);
  assert.ok(!validateService(sInput({ startDate: '1999-12-31' }), { clients: c }).ok);
  assert.ok(!validateService(sInput({ startDate: '2101-01-01' }), { clients: c }).ok);
  assert.ok(validateService(sInput({ startDate: '2027-03-01' }), { clients: c }).ok, 'puede empezar en el futuro (está Pendiente)');
});

test('servicio: con pagos registrados no se puede pasar a otro cliente', () => {
  const clients = [client(), client({ id: 'c2', firstName: 'Beto' })];
  const existing = service();
  const blocked = validateService(sInput({ clientId: 'c2' }), { clients, existing, linkedPayments: 2 });
  assert.ok(!blocked.ok && /pagos/.test(blocked.errors.clientId));
  assert.ok(validateService(sInput({ clientId: 'c2' }), { clients, existing, linkedPayments: 0 }).ok);
  assert.ok(validateService(sInput({ clientId: 'c1', name: 'Otro nombre' }), { clients, existing, linkedPayments: 2 }).ok, 'cambiar otras cosas sí');
});

test('servicio: construir, editar y ordenar (lo más reciente primero)', () => {
  const v = okValue(validateService(sInput(), { clients: [client()] }));
  const built = buildService(v, { id: 'n', nowISO: NOW });
  assert.equal(built.createdAt, NOW);
  const edited = applyServiceEdit({ ...built, isDemo: true }, { ...v, status: 'done' }, '2026-12-01T00:00:00.000Z');
  assert.equal(edited.status, 'done');
  assert.equal(edited.isDemo, true);
  assert.equal(edited.createdAt, NOW);
  const list = [service({ id: 'a', startDate: '2026-01-01' }), service({ id: 'b', startDate: '' , createdAt: '2026-06-01T00:00:00.000Z' }), service({ id: 'c', startDate: '2026-09-01' })];
  assert.deepEqual(sortServices(list).map((s) => s.id), ['c', 'b', 'a']);
});

// ---- Ingresos vinculados -------------------------------------------------------------------------

const categories = defaultCategories();
const incomeCategory = categories.find((c) => c.kind === 'income' && c.name.includes('Ventas')) ?? categories.find((c) => c.kind === 'income');
const expenseCategory = categories.find((c) => c.kind === 'expense');
const mInput = (over = {}) => ({ type: 'income', amountText: '1,000', date: TODAY, time: '10:00', description: 'Pago', classification: 'variable', categoryId: incomeCategory.id, ...over });
const ctx = { categories, today: TODAY, clients: [client(), client({ id: 'c2', firstName: 'Beto', lastName: '' , company: ''})], services: [service(), service({ id: 's2', clientId: 'c2' })] };

test('ingreso: sin cliente funciona como siempre', () => {
  const v = okValue(validateMovement(mInput(), ctx));
  assert.equal(v.clientId, '');
  assert.equal(v.serviceId, '');
  const m = buildMovement(v, { id: 'm', categoryId: incomeCategory.id, nowISO: NOW });
  assert.ok(!('clientId' in m) && !('serviceId' in m), 'no escribe campos vacíos');
});

test('ingreso: con cliente', () => {
  const v = okValue(validateMovement(mInput({ clientId: 'c1' }), ctx));
  assert.equal(v.clientId, 'c1');
  const m = buildMovement(v, { id: 'm', categoryId: incomeCategory.id, nowISO: NOW });
  assert.equal(m.clientId, 'c1');
  assert.ok(!('serviceId' in m));
});

test('ingreso: con servicio trae el cliente del servicio', () => {
  const v = okValue(validateMovement(mInput({ serviceId: 's1' }), ctx));
  assert.equal(v.serviceId, 's1');
  assert.equal(v.clientId, 'c1');
  assert.equal(okValue(validateMovement(mInput({ serviceId: 's1', clientId: 'c1' }), ctx)).clientId, 'c1');
});

test('ingreso: servicio de otro cliente, o cliente/servicio inexistente, se rechaza', () => {
  const wrong = validateMovement(mInput({ serviceId: 's2', clientId: 'c1' }), ctx);
  assert.ok(!wrong.ok && /no es de ese cliente/.test(wrong.errors.service));
  const noService = validateMovement(mInput({ serviceId: 'fantasma' }), ctx);
  assert.ok(!noService.ok && /ya no existe/.test(noService.errors.service));
  const noClient = validateMovement(mInput({ clientId: 'fantasma' }), ctx);
  assert.ok(!noClient.ok && /ya no existe/.test(noClient.errors.client));
  const orphan = validateMovement(mInput({ serviceId: 's1' }), { ...ctx, clients: [] });
  assert.ok(!orphan.ok && orphan.errors.client);
});

test('gasto: se puede cargar a un cliente (costo directo), pero no a un servicio', () => {
  const exp = (over = {}) => mInput({ type: 'expense', categoryId: expenseCategory.id, ...over });
  const v = okValue(validateMovement(exp({ clientId: 'c1' }), ctx));
  assert.equal(v.clientId, 'c1');
  assert.equal(v.serviceId, '');
  const m = buildMovement(v, { id: 'm', categoryId: expenseCategory.id, nowISO: NOW });
  assert.equal(m.clientId, 'c1');
  assert.ok(!('serviceId' in m));
  const withService = validateMovement(exp({ clientId: 'c1', serviceId: 's1' }), ctx);
  assert.ok(!withService.ok && /Solo los ingresos se vinculan a un servicio/.test(withService.errors.service));
  const onlyService = validateMovement(exp({ serviceId: 's1' }), ctx);
  assert.ok(!onlyService.ok && onlyService.errors.service);
  const ghost = validateMovement(exp({ clientId: 'fantasma' }), ctx);
  assert.ok(!ghost.ok && /ya no existe/.test(ghost.errors.client));
  // Sin clientes en el contexto (otras modalidades) también se rechaza, y un gasto sin cliente sigue funcionando.
  const noCtx = validateMovement(exp({ clientId: 'c1' }), { categories, today: TODAY });
  assert.ok(!noCtx.ok && noCtx.errors.client);
  const plain = okValue(validateMovement(exp(), ctx));
  assert.equal(plain.clientId, '');
});

test('gasto: al editarlo se cambia o se quita el cliente, y el resto del gasto no se toca', () => {
  const exp = (over = {}) => mInput({ type: 'expense', categoryId: expenseCategory.id, ...over });
  const base = buildMovement(okValue(validateMovement(exp({ clientId: 'c1' }), ctx)), { id: 'm', categoryId: expenseCategory.id, nowISO: NOW });
  const toOther = applyMovementEdit(base, okValue(validateMovement(exp({ clientId: 'c2', amountText: '2,000' }), ctx)), { categoryId: expenseCategory.id, nowISO: NOW });
  assert.equal(toOther.clientId, 'c2');
  assert.equal(toOther.amountCents, 200000);
  assert.equal(toOther.createdAt, base.createdAt);
  const none = applyMovementEdit(base, okValue(validateMovement(exp(), ctx)), { categoryId: expenseCategory.id, nowISO: NOW });
  assert.ok(!('clientId' in none), 'quitar el cliente borra el campo');
});

test('sin contexto de clientes (otras modalidades) un cliente cualquiera se rechaza', () => {
  const r = validateMovement(mInput({ clientId: 'c1' }), { categories, today: TODAY });
  assert.ok(!r.ok && r.errors.client);
});

test('editar un ingreso: cambia, agrega o quita el vínculo sin dejar restos', () => {
  const base = buildMovement(okValue(validateMovement(mInput({ serviceId: 's1' }), ctx)), { id: 'm', categoryId: incomeCategory.id, nowISO: NOW });
  assert.equal(base.serviceId, 's1');
  const toClientOnly = applyMovementEdit(base, okValue(validateMovement(mInput({ clientId: 'c2' }), ctx)), { categoryId: incomeCategory.id, nowISO: NOW });
  assert.equal(toClientOnly.clientId, 'c2');
  assert.ok(!('serviceId' in toClientOnly), 'el servicio anterior se quitó');
  const unlinked = applyMovementEdit(base, okValue(validateMovement(mInput(), ctx)), { categoryId: incomeCategory.id, nowISO: NOW });
  assert.ok(!('clientId' in unlinked) && !('serviceId' in unlinked));
  assert.equal(unlinked.id, 'm');
  assert.equal(unlinked.createdAt, NOW);
});
