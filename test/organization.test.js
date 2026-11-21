// Pruebas de los datos de la organización (Freelancer, Emprendedor, Empresa) y de su uso en copias y reportes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORGANIZATION_FIELDS, emptyOrganization, isOrganizationEmpty, kindHasOrganization, normalizeOrganization,
  organizationLines, organizationTitle, validateOrganization,
} from '../src/domain/organization.js';
import { CURRENCY_INFO, KIND_INFO, WORKSPACE_KINDS } from '../src/domain/workspaces.js';
import { createFullBackup, parseAnyBackup } from '../src/domain/backup.js';
import { withWorkspaceHeader } from '../src/export/reports.js';
import { monthReport } from '../src/export/reports.js';
import { buildPdf } from '../src/export/pdf.js';
import { reportToXlsx } from '../src/export/xlsx.js';
import { LIMITS } from '../src/domain/types.js';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';

const NOW = new Date(2026, 10, 3, 9, 0);
const TODAY = '2026-11-03';
const ok = (/** @type {any} */ r) => { assert.ok(r.ok, JSON.stringify(r)); return r.organization; };
const full = { legalName: 'Estudio Ruiz SRL', taxId: '1-31-12345-6', activity: 'Diseño gráfico', email: 'hola@ruiz.do', phone: '+1 (809) 555-0100', address: 'Santo Domingo' };

// ---- Dominio -------------------------------------------------------------------------------------

test('solo Freelancer, Emprendedor y Empresa llevan datos de organización', () => {
  assert.deepEqual(WORKSPACE_KINDS.filter(kindHasOrganization), ['freelancer', 'entrepreneur', 'company']);
  for (const kind of WORKSPACE_KINDS) assert.ok(organizationTitle(kind).length > 3);
});

test('seis campos, todos opcionales: el formulario se dibuja a partir de esta lista', () => {
  assert.deepEqual(ORGANIZATION_FIELDS.map((f) => f.key), ['legalName', 'taxId', 'activity', 'email', 'phone', 'address']);
  for (const f of ORGANIZATION_FIELDS) assert.ok(f.max > 0 && f.label.length > 3);
});

test('normalizar: recorta, junta espacios, quita caracteres de control y deja el RNC en mayúsculas sin espacios', () => {
  const org = normalizeOrganization({ legalName: '  Estudio \n  Ruiz\t SRL ', taxId: ' 1 31-ab 123 ', activity: 5, extra: 'se ignora', email: null });
  assert.equal(org.legalName, 'Estudio Ruiz SRL');
  assert.equal(org.taxId, '131-AB123');
  assert.equal(org.activity, '5');
  assert.equal(org.email, '');
  assert.deepEqual(Object.keys(org).sort(), ['activity', 'address', 'email', 'legalName', 'phone', 'taxId']);
  assert.deepEqual(normalizeOrganization(undefined), emptyOrganization());
  assert.deepEqual(normalizeOrganization('texto'), emptyOrganization());
});

test('validar: todo vacío es válido (no es obligatorio completar nada)', () => {
  const org = ok(validateOrganization({}));
  assert.ok(isOrganizationEmpty(org));
  assert.ok(isOrganizationEmpty(undefined) && isOrganizationEmpty(null));
});

test('validar: acepta datos completos y los devuelve limpios', () => {
  assert.deepEqual(ok(validateOrganization(full)), full);
});

test('validar: RNC o cédula con formato razonable (no se verifica contra ningún registro)', () => {
  for (const good of ['131123456', '1-31-12345-6', '00112345678', 'ABC-123']) assert.ok(validateOrganization({ taxId: good }).ok, good);
  for (const bad of ['12', '12$45678', '1'.repeat(21), 'ñandú123']) {
    const r = validateOrganization({ taxId: bad });
    assert.ok(!r.ok && r.errors.taxId, `${bad} debe rechazarse`);
  }
});

test('validar: correo', () => {
  assert.ok(validateOrganization({ email: 'a@b.co' }).ok);
  for (const bad of ['sin-arroba', 'a@b', 'a b@c.com', '@c.com', 'a@b.c']) {
    const r = validateOrganization({ email: bad });
    assert.ok(!r.ok && r.errors.email, `${bad} debe rechazarse`);
  }
});

test('validar: teléfono necesita al menos 7 números y solo símbolos de teléfono', () => {
  for (const good of ['8095550100', '+1 (809) 555-0100', '809.555.0100']) assert.ok(validateOrganization({ phone: good }).ok, good);
  for (const bad of ['12345', 'llámame', '809-555-01xx', '++--  ']) {
    const r = validateOrganization({ phone: bad });
    assert.ok(!r.ok && r.errors.phone, `${bad} debe rechazarse`);
  }
});

test('validar: máximos de longitud, con mensaje por cada campo', () => {
  const r = validateOrganization({ legalName: 'x'.repeat(LIMITS.orgLegalName + 1), activity: 'y'.repeat(LIMITS.orgActivity + 1), address: 'z'.repeat(LIMITS.orgAddress + 1) });
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.deepEqual(Object.keys(r.errors).sort(), ['activity', 'address', 'legalName']);
  assert.ok(validateOrganization({ legalName: 'x'.repeat(LIMITS.orgLegalName) }).ok, 'justo en el máximo sí');
});

test('un correo larguísimo da un solo error (no un segundo por el formato)', () => {
  const r = validateOrganization({ email: `${'a'.repeat(100)}@b.com` });
  assert.ok(!r.ok);
  if (!r.ok) assert.match(r.errors.email ?? '', /máximo/);
});

test('líneas para reportes: solo lo que esté lleno', () => {
  assert.deepEqual(organizationLines(full), [
    'Estudio Ruiz SRL · RNC/cédula: 1-31-12345-6',
    'Actividad: Diseño gráfico',
    'Contacto: hola@ruiz.do · +1 (809) 555-0100 · Santo Domingo',
  ]);
  assert.deepEqual(organizationLines({ ...emptyOrganization(), taxId: '123456789' }), ['RNC/cédula: 123456789']);
  assert.deepEqual(organizationLines(emptyOrganization()), []);
  assert.deepEqual(organizationLines(undefined), []);
});

test('moneda: RD$ sigue siendo la primera y la de siempre (0.18.3: hay más)', () => {
  assert.equal(Object.keys(CURRENCY_INFO)[0], 'DOP');
  assert.equal(CURRENCY_INFO.DOP.symbol, 'RD$');
  for (const kind of ['freelancer', 'entrepreneur', 'company']) {
    assert.ok(KIND_INFO[kind].included.some((t) => /reportes/.test(t)), `${kind}: ya incluye los datos en los reportes`);
    assert.ok(!KIND_INFO[kind].soon.some((t) => /^Datos de la organización/.test(t)), `${kind}: ya no figura como «próximamente»`);
  }
});

// ---- Store ---------------------------------------------------------------------------------------

async function business(kind = 'entrepreneur') {
  const root = createMemoryWorkspaceStore();
  let ticks = 0;
  const store = createStore(root, () => new Date(NOW.getTime() + (ticks += 1) * 1000));
  await store.init();
  assert.ok((await store.createWorkspace({ kind: 'personal', name: 'Mi espacio personal' })).ok);
  assert.ok((await store.createWorkspace({ kind, name: 'Mi negocio' })).ok);
  const id = /** @type {string} */ (store.getState().activeWorkspaceId);
  return { root, store, id };
}

test('store: guardar los datos de la organización los deja en el espacio, limpios', async () => {
  const { store, id, root } = await business();
  const r = await store.updateOrganization(id, { ...full, legalName: '  Estudio   Ruiz SRL ' });
  assert.ok(r.ok);
  assert.deepEqual(store.activeWorkspace()?.organization, full);
  assert.deepEqual((await root.listWorkspaces()).find((w) => w.id === id)?.organization, full, 'también quedó en el almacén');
});

test('store: guardar solo una parte funciona y vaciar todo borra los datos', async () => {
  const { store, id, root } = await business();
  assert.ok((await store.updateOrganization(id, { legalName: 'Solo nombre' })).ok);
  assert.equal(store.activeWorkspace()?.organization?.legalName, 'Solo nombre');
  assert.equal(store.activeWorkspace()?.organization?.taxId, '');
  assert.ok((await store.updateOrganization(id, {})).ok);
  assert.equal(store.activeWorkspace()?.organization, undefined);
  assert.ok(!('organization' in (await root.listWorkspaces()).find((w) => w.id === id)));
});

test('store: datos inválidos no se guardan y dicen qué campo falló', async () => {
  const { store, id, root } = await business();
  assert.ok((await store.updateOrganization(id, { legalName: 'Bien' })).ok);
  const r = await store.updateOrganization(id, { legalName: 'Cambiado', email: 'mal', phone: '1' });
  assert.ok(!r.ok);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'phone']);
  assert.equal(store.activeWorkspace()?.organization?.legalName, 'Bien', 'lo anterior no cambió');
  assert.equal((await root.listWorkspaces()).find((w) => w.id === id)?.organization?.legalName, 'Bien');
});

test('store: un espacio Personal no lleva datos de organización', async () => {
  const { store } = await business();
  const personal = /** @type {any} */ (store.getState().workspaces.find((w) => w.kind === 'personal'));
  const r = await store.updateOrganization(personal.id, full);
  assert.ok(!r.ok && /Personal/.test(r.errors.form));
  assert.equal(store.getState().workspaces.find((w) => w.id === personal.id)?.organization, undefined);
});

test('store: un espacio que ya no existe se rechaza', async () => {
  const { store } = await business();
  const r = await store.updateOrganization('ws-fantasma', full);
  assert.ok(!r.ok && /ya no existe/.test(r.errors.form));
});

test('store: cada espacio guarda los suyos (Freelancer y Empresa no se mezclan)', async () => {
  const { store, id } = await business('freelancer');
  assert.ok((await store.updateOrganization(id, { legalName: 'Mi trabajo' })).ok);
  assert.ok((await store.createWorkspace({ kind: 'company', name: 'Mi empresa' })).ok);
  const companyId = /** @type {string} */ (store.getState().activeWorkspaceId);
  assert.equal(store.activeWorkspace()?.organization, undefined, 'la empresa nueva empieza sin datos');
  assert.ok((await store.updateOrganization(companyId, { legalName: 'Empresa ABC SRL', taxId: '101010101' })).ok);
  const byId = (/** @type {string} */ i) => store.getState().workspaces.find((w) => w.id === i)?.organization;
  assert.equal(byId(id)?.legalName, 'Mi trabajo');
  assert.equal(byId(companyId)?.legalName, 'Empresa ABC SRL');
});

test('store: renombrar, hacer predeterminado y cambiar de espacio conservan los datos', async () => {
  const { store, id } = await business();
  assert.ok((await store.updateOrganization(id, full)).ok);
  assert.ok((await store.renameWorkspace(id, 'Otro nombre')).ok);
  assert.ok((await store.setDefaultWorkspace(id)).ok);
  const personal = /** @type {any} */ (store.getState().workspaces.find((w) => w.kind === 'personal'));
  assert.ok((await store.switchWorkspace(personal.id)).ok);
  assert.ok((await store.switchWorkspace(id)).ok);
  assert.deepEqual(store.activeWorkspace()?.organization, full);
});

test('store: un fallo al guardar no cambia nada (ni en pantalla ni en el almacén)', async () => {
  const { store, id, root } = await business();
  assert.ok((await store.updateOrganization(id, { legalName: 'Antes' })).ok);
  root.failNextWrite();
  const r = await store.updateOrganization(id, { legalName: 'Después' });
  assert.ok(!r.ok);
  assert.equal(store.activeWorkspace()?.organization?.legalName, 'Antes');
  assert.equal((await root.listWorkspaces()).find((w) => w.id === id)?.organization?.legalName, 'Antes');
});

test('store: si otra pestaña borró el espacio, no se escribe en uno que ya no existe', async () => {
  const { store: tab1, root, id } = await business();
  const tab2 = createStore(root, () => NOW);
  await tab2.init();
  const personal = /** @type {any} */ (tab1.getState().workspaces.find((w) => w.kind === 'personal'));
  await tab1.switchWorkspace(personal.id);
  assert.ok((await tab1.deleteWorkspace(id)).ok);
  const r = await tab2.updateOrganization(id, full);
  assert.ok(!r.ok && /ya no existe/.test(r.errors.form));
  assert.equal((await root.listWorkspaces()).length, 1);
});

test('el saldo y los datos del espacio no se mezclan con la organización (guardar una no toca lo otro)', async () => {
  const { store, id } = await business();
  assert.ok((await store.saveSettings({ displayName: 'Ana', openingText: '500' })).ok);
  assert.ok((await store.updateOrganization(id, { legalName: 'X' })).ok);
  assert.equal(store.getState().data.settings.openingBalanceCents, 50000);
  assert.equal(store.activeWorkspace()?.openingBalanceCents, 50000);
  assert.equal(store.activeWorkspace()?.name, 'Mi negocio');
});

// ---- Copias de seguridad -------------------------------------------------------------------------

test('copia completa: lleva los datos de organización y al restaurar vuelven iguales', async () => {
  const { store, id } = await business();
  assert.ok((await store.updateOrganization(id, full)).ok);
  const exported = await store.exportFullBackup();
  assert.ok(exported.ok);
  if (!exported.ok) return;
  const json = JSON.parse(exported.json);
  assert.deepEqual(json.workspaces[1].workspace.organization, full);
  assert.ok(!('organization' in json.workspaces[0].workspace), 'el espacio personal no lleva el campo');

  assert.ok((await store.clearAllData()).ok);
  assert.ok((await store.importBackup(exported.json)).ok);
  const restored = store.getState().workspaces.find((w) => w.name === 'Mi negocio');
  assert.deepEqual(restored?.organization, full);
});

test('copia completa: sin datos de organización no escribe el campo, y una copia vieja (sin el campo) se importa igual', async () => {
  const { store } = await business();
  const exported = await store.exportFullBackup();
  assert.ok(exported.ok);
  if (!exported.ok) return;
  assert.ok(!exported.json.includes('"organization"'));
  const parsed = parseAnyBackup(exported.json, TODAY);
  assert.ok(parsed.ok && parsed.kind === 'full');
  if (parsed.ok && parsed.kind === 'full') assert.ok(parsed.workspaces.every((w) => w.workspace.organization === undefined));
});

test('copia completa: datos de organización mal escritos rechazan la copia entera con el motivo', async () => {
  const { store, id } = await business();
  assert.ok((await store.updateOrganization(id, full)).ok);
  const exported = await store.exportFullBackup();
  assert.ok(exported.ok);
  if (!exported.ok) return;
  const make = (/** @type {(o: any) => void} */ change) => { const j = JSON.parse(exported.json); change(j.workspaces[1].workspace.organization); return JSON.stringify(j); };
  for (const [name, change] of /** @type {[string, (o: any) => void][]} */ ([
    ['correo', (o) => { o.email = 'mal'; }],
    ['teléfono', (o) => { o.phone = '1'; }],
    ['RNC', (o) => { o.taxId = '!!'; }],
    ['largo', (o) => { o.legalName = 'x'.repeat(500); }],
  ])) {
    const r = parseAnyBackup(make(change), TODAY);
    assert.ok(!r.ok && /organización/.test(r.error), `${name}: ${JSON.stringify(r)}`);
  }
  const notObject = JSON.parse(exported.json); notObject.workspaces[1].workspace.organization = 'texto';
  const r = parseAnyBackup(JSON.stringify(notObject), TODAY);
  assert.ok(!r.ok && /organización/.test(r.error));
});

test('copia completa: un espacio Personal con datos de organización en el archivo los descarta (no los guarda)', async () => {
  const { store } = await business();
  const exported = await store.exportFullBackup();
  assert.ok(exported.ok);
  if (!exported.ok) return;
  const j = JSON.parse(exported.json);
  j.workspaces[0].workspace.organization = full;
  const r = parseAnyBackup(JSON.stringify(j), TODAY);
  assert.ok(r.ok && r.kind === 'full');
  if (r.ok && r.kind === 'full') assert.equal(r.workspaces[0].workspace.organization, undefined);
});

test('createFullBackup: copia profunda (cambiar la copia no cambia el espacio)', () => {
  const workspace = { id: 'w1', kind: /** @type {const} */ ('company'), name: 'Empresa', currency: /** @type {const} */ ('DOP'), openingBalanceCents: 0, isDefault: true, organization: { ...full }, createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' };
  const data = { categories: [], movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], settings: { displayName: '', openingBalanceCents: 0 } };
  const backup = createFullBackup({ profile: { displayName: '', lastWorkspaceId: null }, workspaces: [{ workspace, data }] }, NOW.toISOString());
  backup.workspaces[0].workspace.organization.legalName = 'cambiado';
  assert.equal(workspace.organization.legalName, 'Estudio Ruiz SRL');
});

// ---- Reportes ------------------------------------------------------------------------------------

const emptyData = () => ({ categories: [], movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [], settings: { displayName: '', openingBalanceCents: 0 } });
const ws = (/** @type {any} */ over) => ({ id: 'w', kind: 'entrepreneur', name: 'Mi negocio', currency: 'DOP', openingBalanceCents: 0, isDefault: true, createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z', ...over });

test('reportes: la cabecera dice el espacio y, si hay datos, quién es el negocio; los números no cambian', () => {
  const base = monthReport(emptyData(), '2026-11', TODAY);
  const r = withWorkspaceHeader(base, ws({ organization: full }));
  assert.equal(r.subtitle, `${base.subtitle} · Espacio: Mi negocio`);
  assert.deepEqual(r.notes.slice(0, 3), organizationLines(full));
  assert.deepEqual(r.notes.slice(3), base.notes);
  assert.deepEqual(r.sheets, base.sheets, 'tablas y montos intactos');
  assert.equal(r.fileBase, base.fileBase);
});

test('reportes: espacio Personal, sin datos o sin espacio no añaden líneas de organización', () => {
  const base = monthReport(emptyData(), '2026-11', TODAY);
  assert.deepEqual(withWorkspaceHeader(base, ws({ kind: 'entrepreneur' })).notes, base.notes);
  const personal = withWorkspaceHeader(base, ws({ kind: 'personal', name: 'Mi espacio personal', organization: full }));
  assert.deepEqual(personal.notes, base.notes, 'un Personal nunca muestra datos de organización');
  assert.match(personal.subtitle, /Espacio: Mi espacio personal$/);
  assert.equal(withWorkspaceHeader(base, null), base);
  assert.equal(withWorkspaceHeader(base, undefined), base);
});

test('reportes: el PDF y el Excel muestran la cabecera sin romperse (con tildes, ñ y nombres largos)', () => {
  const org = { ...full, legalName: 'Ñandú & Compañía «Diseño» SRL', address: 'Av. Núñez de Cáceres #123, Santo Domingo' };
  const report = withWorkspaceHeader(monthReport(emptyData(), '2026-11', TODAY), ws({ name: 'N'.repeat(40), organization: org }));
  const pdf = buildPdf(report, { generatedAt: NOW });
  assert.ok(pdf.length > 500 && new TextDecoder('latin1').decode(pdf.slice(0, 5)) === '%PDF-');
  const xlsx = reportToXlsx(report);
  assert.ok(xlsx.length > 500);
  const text = new TextDecoder().decode(xlsx); // el .xlsx es un ZIP sin comprimir: el texto de las hojas se puede leer
  assert.ok(text.includes('Ñandú &amp; Compañía «Diseño» SRL'), 'razón social con tildes y símbolos escapados');
  assert.ok(text.includes('Espacio: ' + 'N'.repeat(40)));
  assert.ok(text.includes('Av. Núñez de Cáceres #123, Santo Domingo'));
});
