import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { CLOUD_KINDS } from '../src/data/cloudRows.js';
import { createCloudStore, PUSH_ORDER } from '../src/data/cloudStore.js';
import {
  buildCompanyDemo, buildDemoData, buildDepartmentDemo, buildFreelancerDemo, buildFreelancerInvoiceDemo, buildInventoryDemo, buildInvoiceDemo,
} from '../src/domain/demo.js';
import { createMockAuthServer } from '../tools/mock-auth-server.mjs';

const URL_ = 'https://proyecto.supabase.co';
const T = '2026-11-13';
const N = '2026-11-13T12:00:00.000Z';

/** Quita la marca DEMO: así los registros de las demostraciones sirven como datos «reales» de prueba. */
const real = (list) => list.map(({ isDemo, ...r }) => r);
const canonical = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));

function companyData() {
  const personal = buildDemoData(T, N);
  const company = buildCompanyDemo(T, N);
  const inventory = buildInventoryDemo(T, N);
  const invoices = buildInvoiceDemo(T, N);
  const dept = buildDepartmentDemo([...company.movements, ...inventory.movements], T, N);
  return {
    categories: [{ id: randomUUID(), name: 'Mascotas', kind: 'expense', defaultClassification: 'variable', builtIn: false }],
    movements: real([...personal.movements, ...invoices.movements, ...dept.movements]),
    goals: real(personal.goals), contributions: real(personal.contributions),
    debts: real([...personal.debts, ...company.debts]), debtPayments: real([...personal.debtPayments, ...company.debtPayments]),
    assets: real([...personal.assets, ...company.assets]), products: real(inventory.products), suppliers: real(inventory.suppliers),
    stockEntries: real(inventory.stockEntries), invoices: real(invoices.invoices), invoicePayments: real(invoices.invoicePayments),
    departments: real(dept.departments), clients: [], services: [],
  };
}

function freelancerData() {
  const fr = buildFreelancerDemo(T, N);
  const fi = buildFreelancerInvoiceDemo(fr, T, N);
  return {
    categories: [], movements: real([...fr.movements, ...fi.movements]), clients: real(fr.clients), services: real(fr.services),
    invoices: real(fi.invoices), invoicePayments: real(fi.invoicePayments),
    goals: [], contributions: [], debts: [], debtPayments: [], assets: [], products: [], suppliers: [], stockEntries: [], departments: [],
  };
}

const countsOf = (data) => Object.fromEntries(CLOUD_KINDS.map((k) => [k.key, data[k.key].length]));

function workspace(kind, name, extra = {}) {
  return { id: randomUUID(), kind, name, currency: 'DOP', openingBalanceCents: 150000, isDefault: false, createdAt: N, updatedAt: N, ...extra };
}

/** Un servidor simulado con dos cuentas, y un almacén de la nube para cada una. */
async function setup(storeOptions = {}) {
  const mock = createMockAuthServer();
  const accounts = {};
  for (const email of ['ana@correo.com', 'beto@correo.com']) {
    const r = await mock.handle({ method: 'POST', url: `${URL_}/auth/v1/signup`, headers: { apikey: 'k' }, body: JSON.stringify({ email, password: 'Vela9Lima!' }) });
    let token = r.body.access_token;
    const userId = r.body.user.id;
    accounts[email.split('@')[0]] = {
      userId,
      setToken: (t) => { token = t; },
      store: createCloudStore({ url: URL_, publishableKey: 'k', getAccessToken: async () => token, getUserId: () => userId, fetch: mock.fetch, ...storeOptions }),
    };
  }
  return { mock, ...accounts };
}

describe('almacén de la nube: espacios', () => {
  it('crea espacios; el primero queda como predeterminado; los datos de la organización van y vuelven', async () => {
    const { ana } = await setup();
    const personal = workspace('personal', 'Mi espacio personal');
    const empresa = workspace('company', 'Empresa ABC', { organization: { legalName: 'ABC SRL', taxId: '1-01-00000-1', activity: 'Comercio', email: '', phone: '809-555-0100', address: 'Santiago' } });
    assert.deepEqual(await ana.store.saveWorkspaces([personal, empresa]), { ok: true });
    const list = await ana.store.listWorkspaces();
    assert.equal(list.ok, true);
    assert.equal(list.workspaces.length, 2);
    const byId = Object.fromEntries(list.workspaces.map((w) => [w.workspace.id, w]));
    assert.deepEqual(byId[personal.id].workspace, { ...personal, isDefault: true });
    assert.deepEqual(byId[empresa.id].workspace, empresa);
    assert.equal(byId[empresa.id].deletedAt, null);
  });

  it('cambia el predeterminado y guarda el perfil', async () => {
    const { mock, ana } = await setup();
    const a = workspace('personal', 'A');
    const b = workspace('freelancer', 'B');
    await ana.store.saveWorkspaces([a, b]);
    assert.deepEqual(await ana.store.setDefaultWorkspace(b.id), { ok: true });
    const list = await ana.store.listWorkspaces();
    assert.deepEqual(list.workspaces.filter((w) => w.workspace.isDefault).map((w) => w.workspace.id), [b.id]);
    assert.deepEqual(await ana.store.saveProfile({ displayName: 'Ana', lastWorkspaceId: b.id }), { ok: true });
    assert.equal(mock.data.profiles.get(ana.userId).display_name, 'Ana');
    assert.equal(mock.data.profiles.get(ana.userId).last_workspace_id, b.id);
  });

  it('una cuenta no ve ni puede cambiar los espacios de otra', async () => {
    const { ana, beto } = await setup();
    const a = workspace('personal', 'De Ana');
    await ana.store.saveWorkspaces([a]);
    assert.deepEqual((await beto.store.listWorkspaces()).workspaces, []);
    const hack = await beto.store.saveWorkspaces([{ ...a, name: 'Robado' }]);
    assert.equal(hack.ok, false);
    assert.equal(hack.error.code, 'forbidden');
    assert.equal((await ana.store.listWorkspaces()).workspaces[0].workspace.name, 'De Ana');
  });
});

describe('almacén de la nube: subir y contar', () => {
  it('sube TODO un espacio Empresa y uno Freelancer (15 tipos) y la nube cuenta exactamente lo mismo', async () => {
    const { ana } = await setup();
    const empresa = workspace('company', 'Empresa');
    const freelance = workspace('freelancer', 'Freelance');
    await ana.store.saveWorkspaces([empresa, freelance]);
    for (const [ws, data] of [[empresa, companyData()], [freelance, freelancerData()]]) {
      const pushed = await ana.store.push(ws.id, data);
      assert.equal(pushed.ok, true, JSON.stringify(pushed));
      assert.equal(pushed.sent, Object.values(countsOf(data)).reduce((a, b) => a + b, 0));
      assert.equal(pushed.skippedDemo, 0);
      const counted = await ana.store.countLive(ws.id);
      assert.deepEqual(counted, { ok: true, counts: countsOf(data) });
    }
  });

  it('los datos de DEMOSTRACIÓN nunca se suben (ni las categorías de fábrica)', async () => {
    const { mock, ana } = await setup();
    const ws = workspace('personal', 'P');
    await ana.store.saveWorkspaces([ws]);
    const demo = buildDemoData(T, N);
    const mine = { ...real([demo.movements[0]])[0], id: randomUUID(), description: 'Almuerzo' };
    const pushed = await ana.store.push(ws.id, {
      movements: [...demo.movements, mine], goals: demo.goals,
      categories: [{ id: 'cat-exp-otros', name: 'Otros', kind: 'expense', defaultClassification: 'variable', builtIn: true }],
    });
    assert.equal(pushed.ok, true);
    assert.equal(pushed.sent, 1);
    assert.equal(pushed.skippedDemo, demo.movements.length + demo.goals.length);
    assert.deepEqual(mock.data.live('movements', ws.id).map((r) => r.description), ['Almuerzo']);
    assert.equal(mock.data.live('goals', ws.id).length, 0);
    assert.equal(mock.data.live('categories', ws.id).length, 0);
    for (const t of Object.keys(mock.data.tables)) for (const r of mock.data.tables[t].values()) assert.equal(r.is_demo, false, t);
  });

  it('subir lo mismo dos veces no duplica nada (se puede reintentar sin miedo)', async () => {
    const { ana } = await setup();
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    await ana.store.push(ws.id, data);
    await ana.store.push(ws.id, data);
    assert.deepEqual((await ana.store.countLive(ws.id)).counts, countsOf(data));
  });

  it('sube en orden de dependencia: si un pago apunta a un movimiento que no existe, la nube lo rechaza', async () => {
    const { ana } = await setup();
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    // Solo los pagos, sin las deudas ni los movimientos a los que apuntan:
    const r = await ana.store.push(ws.id, { debtPayments: data.debtPayments });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'rejected');
    assert.match(r.error.message, /rechazó un dato/);
    assert.match(r.error.detail, /foreign key/);
    // El orden de subida pone a cada tipo después de los tipos a los que apunta.
    const before = (a, b) => assert.ok(PUSH_ORDER.indexOf(a) < PUSH_ORDER.indexOf(b), `${a} antes que ${b}`);
    before('clients', 'services'); before('services', 'movements'); before('departments', 'movements'); before('categories', 'movements');
    before('goals', 'contributions'); before('debts', 'debtPayments'); before('movements', 'debtPayments');
    before('products', 'stockEntries'); before('suppliers', 'stockEntries'); before('invoices', 'stockEntries'); before('movements', 'stockEntries');
    before('clients', 'invoices'); before('services', 'invoices'); before('invoices', 'invoicePayments'); before('movements', 'invoicePayments');
    assert.equal(new Set(PUSH_ORDER).size, 15);
  });

  it('sube en tandas: con tandas de 7, un espacio grande llega completo', async () => {
    const { mock, ana } = await setup({ batchSize: 7 });
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    const r = await ana.store.push(ws.id, data);
    assert.equal(r.ok, true);
    assert.deepEqual((await ana.store.countLive(ws.id)).counts, countsOf(data));
    assert.ok(mock.count('POST /rest/v1/movements') >= Math.ceil(data.movements.length / 7));
  });

  it('no deja escribir en el espacio de otra cuenta', async () => {
    const { ana, beto } = await setup();
    const ws = workspace('personal', 'De Ana');
    await ana.store.saveWorkspaces([ws]);
    const r = await beto.store.push(ws.id, { goals: real(buildDemoData(T, N).goals) });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'forbidden');
  });
});

describe('almacén de la nube: bajar', () => {
  it('baja todo un espacio y cada registro llega igual a como se subió (más quién lo creó, que pone la nube)', async () => {
    const { ana } = await setup();
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    await ana.store.push(ws.id, data);
    const pulled = await ana.store.pull(ws.id);
    assert.equal(pulled.ok, true);
    for (const kind of CLOUD_KINDS) {
      const got = new Map(pulled.changes[kind.key].map((c) => [c.record.id, c.record]));
      assert.equal(got.size, data[kind.key].length, kind.key);
      // 0.16.1: cada registro trae createdBy (la cuenta que lo subió); lo demás, igual que se subió.
      for (const r of data[kind.key]) assert.deepEqual(got.get(r.id), { ...canonical(r), createdBy: ana.userId }, `${kind.key} ${r.id}`);
      assert.ok(pulled.changes[kind.key].every((c) => c.deletedAt === null));
    }
  });

  it('con el cursor solo baja lo que cambió después', async () => {
    const { ana } = await setup();
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    await ana.store.push(ws.id, data);
    const first = await ana.store.pull(ws.id);
    const again = await ana.store.pull(ws.id, first.cursors);
    assert.equal(Object.values(again.changes).flat().length, 0, 'sin cambios, no baja nada');
    const edited = { ...data.goals[0], name: 'Laptop nueva', updatedAt: '2026-11-14T10:00:00.000Z' };
    await ana.store.push(ws.id, { goals: [edited] });
    const third = await ana.store.pull(ws.id, again.cursors);
    assert.deepEqual(Object.values(third.changes).flat().map((c) => c.record.name), ['Laptop nueva']);
  });

  it('páginas pequeñas con muchas filas a la misma hora: cada fila llega una sola vez', async () => {
    const { mock, ana } = await setup({ pageSize: 5 });
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    await ana.store.push(ws.id, data);
    // Todos los movimientos de la tanda comparten la misma marca synced_at (como now() en una transacción).
    assert.equal(new Set(mock.data.live('movements', ws.id).map((r) => r.synced_at)).size, 1);
    const pulled = await ana.store.pull(ws.id);
    const ids = pulled.changes.movements.map((c) => c.record.id);
    assert.equal(ids.length, data.movements.length);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('el cursor guarda la hora EXACTA del servidor (microsegundos), no la recortada', async () => {
    const { mock, ana } = await setup();
    const ws = workspace('personal', 'P');
    await ana.store.saveWorkspaces([ws]);
    await ana.store.push(ws.id, { goals: real(buildDemoData(T, N).goals) });
    const pulled = await ana.store.pull(ws.id);
    const serverStamp = mock.data.live('goals', ws.id)[0].synced_at;
    assert.match(serverStamp, /\.\d{6}\+00:00$/);
    assert.equal(pulled.cursors.goals.syncedAt, serverStamp);
  });

  it('los borrados se marcan: la nube deja de contarlos y los otros dispositivos los bajan como borrados', async () => {
    const { ana } = await setup();
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    await ana.store.push(ws.id, data);
    const start = await ana.store.pull(ws.id);
    const goal = data.goals[0];
    const contribs = data.contributions.filter((c) => c.goalId === goal.id).map((c) => c.id);
    const r = await ana.store.push(ws.id, {}, { goalIds: [goal.id], contributionIds: contribs }, '2026-11-14T09:00:00.000Z');
    assert.deepEqual(r, { ok: true, sent: 0, skippedDemo: 0, deleted: 1 + contribs.length });
    const counted = await ana.store.countLive(ws.id);
    assert.equal(counted.counts.goals, data.goals.length - 1);
    assert.equal(counted.counts.contributions, data.contributions.length - contribs.length);
    const after = await ana.store.pull(ws.id, start.cursors);
    const gone = after.changes.goals.find((c) => c.record.id === goal.id);
    assert.equal(gone.deletedAt, '2026-11-14T09:00:00.000Z');
    assert.equal(after.changes.contributions.length, contribs.length);
  });

  it('otra cuenta no baja nada de un espacio ajeno', async () => {
    const { ana, beto } = await setup();
    const ws = workspace('company', 'E');
    await ana.store.saveWorkspaces([ws]);
    await ana.store.push(ws.id, companyData());
    const pulled = await beto.store.pull(ws.id);
    assert.equal(pulled.ok, true);
    assert.equal(Object.values(pulled.changes).flat().length, 0);
  });
});

describe('almacén de la nube: errores (nunca lanza; mensajes en español)', () => {
  it('sin sesión no envía nada', async () => {
    const { mock, ana } = await setup();
    ana.setToken(null);
    const before = mock.calls.length;
    const r = await ana.store.pull(randomUUID());
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'session');
    assert.match(r.error.message, /sesión venció/);
    assert.equal(mock.calls.length, before);
  });

  it('una sesión que el servidor ya no acepta da error de sesión', async () => {
    const { ana } = await setup();
    ana.setToken('token-viejo');
    const r = await ana.store.listWorkspaces();
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'session');
  });

  it('sin internet: error de red con un mensaje que tranquiliza (los datos siguen en el dispositivo)', async () => {
    const { mock, ana } = await setup();
    mock.offline = true;
    const r = await ana.store.push(randomUUID(), { goals: real(buildDemoData(T, N).goals) });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'network');
    assert.match(r.error.message, /siguen guardados en este dispositivo/);
  });

  it('si la nube tarda demasiado, se corta y lo dice', async () => {
    const { mock, ana } = await setup({ timeoutMs: 30 });
    mock.delayMs = 200;
    const r = await ana.store.listWorkspaces();
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'timeout');
  });

  it('un fallo del servidor (5xx) se distingue de un dato rechazado', async () => {
    const { mock, ana } = await setup();
    mock.failNext = { status: 503, body: { message: 'Service Unavailable' } };
    const r = await ana.store.listWorkspaces();
    assert.equal(r.error.code, 'server');
  });

  it('un registro incompleto no se envía: falla antes de tocar la red', async () => {
    const { mock, ana } = await setup();
    const ws = workspace('personal', 'P');
    await ana.store.saveWorkspaces([ws]);
    const before = mock.calls.length;
    const { name, ...broken } = real(buildDemoData(T, N).goals)[0];
    const r = await ana.store.push(ws.id, { goals: [broken] });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'rejected');
    assert.match(r.error.detail, /Falta «name»/);
    assert.equal(mock.calls.length, before);
  });

  it('manda la llave pública y la sesión en cada petición, nunca otra llave', async () => {
    const { mock, ana } = await setup();
    const ws = workspace('personal', 'P');
    await ana.store.saveWorkspaces([ws]);
    await ana.store.pull(ws.id);
    const data = mock.calls.filter((c) => c.path.startsWith('/rest/v1/'));
    assert.ok(data.length > 0);
    assert.ok(data.every((c) => c.apikey === 'k' && typeof c.token === 'string' && c.token.startsWith('access-')));
  });
});

describe('regla de la nube: lo borrado no revive con una versión más vieja (migración no_revive)', () => {
  const later = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

  it('registros: una versión anterior al borrado sigue borrada; una posterior lo revive', async () => {
    const { ana, mock } = await setup();
    const ws = workspace('personal', 'Casa');
    await ana.store.saveWorkspaces([ws]);
    const data = companyData();
    const move = { ...data.movements[0], updatedAt: N };
    assert.equal((await ana.store.push(ws.id, { movements: [move] })).ok, true);
    const deletedAt = later(N, 60_000);
    assert.equal((await ana.store.push(ws.id, {}, { movementIds: [move.id] }, deletedAt)).ok, true);
    // Una edición hecha ANTES del borrado (llega tarde): sigue borrado.
    await ana.store.push(ws.id, { movements: [{ ...move, description: 'vieja', updatedAt: later(N, 30_000) }] });
    assert.equal(mock.data.live('movements', ws.id).some((m) => m.id === move.id), false, 'una versión vieja no revive');
    // Igual al borrado: tampoco.
    await ana.store.push(ws.id, { movements: [{ ...move, updatedAt: deletedAt }] });
    assert.equal(mock.data.live('movements', ws.id).some((m) => m.id === move.id), false);
    // Una edición POSTERIOR al borrado: revive.
    await ana.store.push(ws.id, { movements: [{ ...move, description: 'nueva', updatedAt: later(N, 90_000) }] });
    const alive = mock.data.live('movements', ws.id).find((m) => m.id === move.id);
    assert.equal(alive?.description, 'nueva');
  });

  it('espacios: igual que los registros', async () => {
    const { ana } = await setup();
    const ws = workspace('personal', 'Casa');
    await ana.store.saveWorkspaces([ws]);
    await ana.store.markWorkspacesDeleted([ws.id], later(N, 60_000));
    await ana.store.saveWorkspaces([{ ...ws, updatedAt: later(N, 30_000) }]);
    let list = await ana.store.listWorkspaces();
    assert.notEqual(list.ok && list.workspaces.find((w) => w.workspace.id === ws.id)?.deletedAt, null, 'versión vieja: sigue borrado');
    await ana.store.saveWorkspaces([{ ...ws, updatedAt: later(N, 90_000) }]);
    list = await ana.store.listWorkspaces();
    assert.equal(list.ok && list.workspaces.find((w) => w.workspace.id === ws.id)?.deletedAt, null, 'versión nueva: revive');
  });

  it('categorías: no llevan fecha de modificación en la app, así que siguen pudiendo volver (como antes)', async () => {
    const { ana, mock } = await setup();
    const ws = workspace('personal', 'Casa');
    await ana.store.saveWorkspaces([ws]);
    const cat = { id: randomUUID(), name: 'Mascotas', kind: 'expense', defaultClassification: 'variable', builtIn: false };
    await ana.store.push(ws.id, { categories: [cat] });
    await ana.store.push(ws.id, {}, { categoryIds: [cat.id] }, later(N, 60_000));
    await ana.store.push(ws.id, { categories: [cat] });
    assert.ok(mock.data.live('categories', ws.id).some((c) => c.id === cat.id));
  });
});
