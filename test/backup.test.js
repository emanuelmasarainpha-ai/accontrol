import test from 'node:test';
import assert from 'node:assert/strict';
import { backupFileName, createBackup, parseBackup } from '../src/domain/backup.js';
import { defaultCategories } from '../src/domain/categories.js';
import { buildDemoData } from '../src/domain/demo.js';
import { overallTotals } from '../src/domain/summaries.js';

const today = '2026-07-20';
const nowISO = '2026-07-20T12:00:00.000Z';

function sampleData() {
  const demo = buildDemoData(today, nowISO);
  return {
    categories: defaultCategories(),
    movements: demo.movements,
    goals: demo.goals,
    contributions: demo.contributions,
    debts: demo.debts,
    debtPayments: demo.debtPayments,
    assets: demo.assets,
    clients: [],
    services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [], departments: [],
    settings: { displayName: 'Ana', openingBalanceCents: 250_000 },
  };
}

test('exportar y volver a importar devuelve exactamente los mismos datos', () => {
  const data = sampleData();
  const json = JSON.stringify(createBackup(data, nowISO));
  const result = parseBackup(json);
  assert.ok(result.ok, result.ok ? '' : result.error);
  if (result.ok) assert.deepEqual(result.data, data);
});

test('el respaldo conserva los totales financieros', () => {
  const data = sampleData();
  const result = parseBackup(JSON.stringify(createBackup(data, nowISO)));
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(overallTotals(result.data, today), overallTotals(data, today));
});

test('rechaza archivos que no son respaldos', () => {
  assert.ok(!parseBackup('').ok);
  assert.ok(!parseBackup('no es json').ok);
  assert.ok(!parseBackup('[]').ok);
  assert.ok(!parseBackup('{"app":"otra-app"}').ok);
  assert.ok(!parseBackup('{"app":"accontrol","schemaVersion":1}').ok);
});

test('rechaza respaldos de una versión más nueva', () => {
  const backup = createBackup(sampleData(), nowISO);
  const r = parseBackup(JSON.stringify({ ...backup, schemaVersion: 99 }));
  assert.ok(!r.ok && /más nueva/.test(r.error));
});

/** @param {(b: any) => void} mutate */
function corrupt(mutate) {
  const backup = JSON.parse(JSON.stringify(createBackup(sampleData(), nowISO)));
  mutate(backup);
  return parseBackup(JSON.stringify(backup));
}

test('rechaza registros corruptos y dice cuál es el problema', () => {
  assert.ok(!corrupt((b) => { b.data.movements[0].amountCents = 12.5; }).ok); // decimal
  assert.ok(!corrupt((b) => { b.data.movements[0].amountCents = -5; }).ok); // negativo
  assert.ok(!corrupt((b) => { b.data.movements[0].amountCents = '100'; }).ok); // texto
  assert.ok(!corrupt((b) => { b.data.movements[0].date = '2026-02-30'; }).ok);
  assert.ok(!corrupt((b) => { b.data.movements[0].time = '25:00'; }).ok);
  assert.ok(!corrupt((b) => { b.data.movements[0].type = 'otro'; }).ok);
  assert.ok(!corrupt((b) => { b.data.movements[0].categoryId = 'no-existe'; }).ok);
  assert.ok(!corrupt((b) => { b.data.movements[0].classification = 'extraordinary'; b.data.movements[0].type = 'expense'; }).ok);
  assert.ok(!corrupt((b) => { b.data.contributions[0].goalId = 'no-existe'; }).ok);
  assert.ok(!corrupt((b) => { b.data.movements[1].id = b.data.movements[0].id; }).ok); // id repetido
  assert.ok(!corrupt((b) => { b.data.settings.openingBalanceCents = 1.5; }).ok);
  assert.ok(!corrupt((b) => { delete b.data.goals; }).ok);
  const r = corrupt((b) => { b.data.movements[2].amountCents = 0; });
  assert.ok(!r.ok && /Movimiento #3/.test(r.error), 'el mensaje debe indicar qué registro falla');
});

test('solo se copian los campos conocidos (no se cuelan campos extra)', () => {
  const r = corrupt((b) => { b.data.movements[0].hack = '<img src=x onerror=alert(1)>'; b.data.settings.rol = 'admin'; });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal('hack' in r.data.movements[0], false);
  assert.equal('rol' in r.data.settings, false);
});

test('nombre de archivo del respaldo', () => {
  assert.equal(backupFileName('2026-07-20'), 'accontrol-respaldo-2026-07-20.json');
});

// ---------------------------------------------------------------------------
// Revisión independiente: un respaldo editado a mano no puede saltarse las reglas de la app
// ---------------------------------------------------------------------------

/** @param {(d: any) => void} edit */
function tampered(edit, options) {
  const backup = JSON.parse(JSON.stringify(createBackup(sampleData(), nowISO)));
  edit(backup.data);
  return parseBackup(JSON.stringify(backup), options);
}

test('rechaza una meta con más retiros que aportes (fabricaría dinero)', () => {
  const result = tampered((d) => {
    d.goals = [{ id: 'g1', name: 'Meta', description: '', targetCents: 100_000, targetDate: '2027-01-01', createdAt: nowISO, updatedAt: nowISO }];
    d.contributions = [{ id: 'c1', goalId: 'g1', kind: 'withdrawal', amountCents: 500_000, date: '2026-07-01', time: '10:00', note: '', createdAt: nowISO, updatedAt: nowISO }];
    d.movements = [];
    d.debts = [];
    d.debtPayments = [];
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /retiros superan/);
});

test('rechaza saldo inicial negativo', () => {
  const result = tampered((d) => { d.settings.openingBalanceCents = -500; });
  assert.equal(result.ok, false);
});

test('rechaza movimientos y aportes con fecha futura cuando se indica "today"', () => {
  const future = tampered((d) => { d.movements[0].date = '2199-01-01'; }, { today });
  assert.equal(future.ok, false);
  assert.match(future.error, /fecha futura/);
  const futureContribution = tampered((d) => { d.contributions[0].date = '2199-01-01'; }, { today });
  assert.equal(futureContribution.ok, false);
  // Sin "today" no se revisa (las pruebas antiguas y otros usos siguen igual).
  assert.ok(tampered((d) => { d.movements[0].date = '2199-01-01'; }).ok);
});

test('rechaza fechas de registro (createdAt/updatedAt) que no son fechas ISO', () => {
  for (const bad of ['<img src=x onerror=alert(1)> 2020', 'foo 2020', '1', '2020']) {
    const result = tampered((d) => { d.movements[0].createdAt = bad; });
    assert.equal(result.ok, false, `"${bad}" debería rechazarse`);
  }
});

test('un elemento null dentro de una lista da un mensaje claro (no un error técnico)', () => {
  const result = tampered((d) => { d.movements.push(null); });
  assert.equal(result.ok, false);
  assert.ok(!/Cannot read/.test(result.error), result.error);
});

// ---------------------------------------------------------------- deudas (Etapa 3)

test('un respaldo de la versión 1 (sin deudas) se sigue pudiendo importar', () => {
  const old = JSON.parse(JSON.stringify(createBackup({ ...sampleData(), debts: [], debtPayments: [] }, nowISO)));
  old.schemaVersion = 1;
  delete old.data.debts;
  delete old.data.debtPayments;
  // Los movimientos de demostración ya incluyen los gastos de pagos de deuda; en un respaldo v1 no hay pagos.
  const r = parseBackup(JSON.stringify(old));
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) {
    assert.deepEqual(r.data.debts, []);
    assert.deepEqual(r.data.debtPayments, []);
  }
});

test('el respaldo conserva deudas y pagos', () => {
  const r = parseBackup(JSON.stringify(createBackup(sampleData(), nowISO)));
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.data.debts.length, 3);
    assert.equal(r.data.debtPayments.length, 3);
  }
});

test('rechaza deudas y pagos corruptos', () => {
  const bad = (mutate) => corrupt(mutate).ok === false;
  assert.ok(bad((b) => { b.data.debts[0].totalCents = 0; }));
  assert.ok(bad((b) => { b.data.debts[0].totalCents = 10.5; }));
  assert.ok(bad((b) => { b.data.debts[0].rateBp = -1; }));
  assert.ok(bad((b) => { b.data.debts[0].rateBp = 9_999_999; }));
  assert.ok(bad((b) => { b.data.debts[0].frequency = 'diaria'; }));
  assert.ok(bad((b) => { b.data.debts[0].collateralType = 'casa'; })); // garantía física con tipo personal
  assert.ok(bad((b) => { b.data.debts[0].firstDueDate = '2026-02-30'; }));
  assert.ok(bad((b) => { b.data.debts[0].finalDueDate = '2000-01-01'; })); // anterior a la primera cuota
  assert.ok(bad((b) => { b.data.debts[0].name = ''; }));
  assert.ok(bad((b) => { b.data.debts[1].id = b.data.debts[0].id; })); // id repetido
  assert.ok(bad((b) => { b.data.debtPayments[0].debtId = 'no-existe'; }));
  assert.ok(bad((b) => { b.data.debtPayments[0].amountCents = 0; }));
  assert.ok(bad((b) => { b.data.debtPayments[0].kind = 'otra'; }));
  assert.ok(bad((b) => { b.data.debtPayments[0].movementId = 'no-existe'; }));
  assert.ok(bad((b) => { b.data.debtPayments[1].movementId = b.data.debtPayments[0].movementId; })); // gasto compartido
  assert.ok(bad((b) => { b.data.debtPayments[0].amountCents += 100; })); // ya no coincide con su gasto
  assert.ok(bad((b) => { b.data.debtPayments[0].date = '2099-01-01'; }));
  assert.ok(bad((b) => { b.data.debts = {}; }));
});

test('rechaza pagos que superan lo que se debe', () => {
  const r = corrupt((b) => {
    const p = b.data.debtPayments[0];
    const debt = b.data.debts.find((d) => d.id === p.debtId);
    debt.totalCents = 10_000; // ahora la cuota ya pagada supera el saldo
  });
  assert.ok(!r.ok);
});

test('un gasto vinculado a un pago no puede ser un ingreso', () => {
  const r = corrupt((b) => {
    const p = b.data.debtPayments[0];
    const m = b.data.movements.find((x) => x.id === p.movementId);
    m.type = 'income';
    m.classification = 'fixed';
    m.categoryId = 'cat-inc-salario';
  });
  assert.ok(!r.ok);
});

// ---------------------------------------------------------------- activos (Etapa 4)

test('un respaldo de la versión 2 (sin activos) se sigue pudiendo importar', () => {
  const old = JSON.parse(JSON.stringify(createBackup({ ...sampleData(), assets: [] }, nowISO)));
  old.schemaVersion = 2;
  delete old.data.assets;
  const r = parseBackup(JSON.stringify(old));
  assert.ok(r.ok, r.ok ? '' : r.error);
  if (r.ok) assert.deepEqual(r.data.assets, []);
});

test('el respaldo conserva los activos con su historial de valores', () => {
  const r = parseBackup(JSON.stringify(createBackup(sampleData(), nowISO)));
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.data.assets.length, 3);
    assert.ok(r.data.assets.some((a) => a.valuations.length > 1));
  }
});

test('rechaza activos corruptos', () => {
  const bad = (mutate) => corrupt(mutate).ok === false;
  assert.ok(bad((b) => { b.data.assets[0].name = ''; }));
  assert.ok(bad((b) => { b.data.assets[0].category = 'barco'; }));
  assert.ok(bad((b) => { b.data.assets[0].category = 'toString'; }));
  assert.ok(bad((b) => { b.data.assets[0].subtype = 'land'; })); // tipo de otra categoría
  assert.ok(bad((b) => { b.data.assets[0].acquiredDate = '2026-02-30'; }));
  assert.ok(bad((b) => { b.data.assets[0].acquiredDate = '2999-01-01'; }));
  assert.ok(bad((b) => { b.data.assets[0].valuations = []; }));
  assert.ok(bad((b) => { b.data.assets[0].valuations = 'mucho'; }));
  assert.ok(bad((b) => { b.data.assets[0].valuations[0].valueCents = -1; }));
  assert.ok(bad((b) => { b.data.assets[0].valuations[0].valueCents = 1.5; }));
  assert.ok(bad((b) => { b.data.assets[0].valuations[0].valueCents = 99_999_999_999 + 1; }));
  assert.ok(bad((b) => { b.data.assets[0].valuations[0].date = '2001-01-01'; })); // el primero debe estar en la adquisición
  assert.ok(bad((b) => { b.data.assets[0].valuations.reverse(); })); // fuera de orden
  assert.ok(bad((b) => { b.data.assets[0].valuations.push({ ...b.data.assets[0].valuations[0] }); })); // fecha repetida
  assert.ok(bad((b) => { b.data.assets[0].valuations.push({ date: '2999-01-01', valueCents: 1 }); })); // fecha futura
  assert.ok(bad((b) => { b.data.assets[1].id = b.data.assets[0].id; })); // id repetido
  assert.ok(bad((b) => { b.data.assets = {}; }));
  assert.ok(bad((b) => { delete b.data.assets[0].createdAt; }));
});

test('un valor en 0 (activo vendido) sí es válido', () => {
  const r = corrupt((b) => {
    const land = b.data.assets.find((a) => a.name.startsWith('Terreno'));
    land.valuations.push({ date: '2026-07-20', valueCents: 0 });
  });
  assert.ok(r.ok, r.ok ? '' : r.error);
});

// ---- Versión 4: espacios de trabajo --------------------------------------------

import { createFullBackup, fullBackupFileName, parseAnyBackup } from '../src/domain/backup.js';

const wsRecord = (/** @type {string} */ id, /** @type {string} */ name, /** @type {Record<string, any>} */ over = {}) => ({
  id, kind: 'personal', name, currency: 'DOP', openingBalanceCents: 0, isDefault: false, createdAt: nowISO, updatedAt: nowISO, ...over,
});

function fullSnapshot() {
  const a = sampleData();
  const b = { ...sampleData(), movements: [], goals: [], contributions: [], debts: [], debtPayments: [], assets: [], clients: [], services: [], products: [], suppliers: [], stockEntries: [], invoices: [], invoicePayments: [] };
  return {
    profile: { displayName: 'Ana', lastWorkspaceId: 'ws-b' },
    workspaces: [
      { workspace: wsRecord('ws-a', 'Mi espacio personal', { isDefault: true, openingBalanceCents: 250_000 }), data: a },
      { workspace: wsRecord('ws-b', 'Mi negocio', { kind: 'entrepreneur', createdAt: '2026-07-21T00:00:00.000Z' }), data: { ...b, settings: { displayName: 'Ana', openingBalanceCents: 0 } } },
    ],
  };
}

test('copia completa: exportar e importar devuelve todos los espacios tal cual', () => {
  const snap = fullSnapshot();
  const json = JSON.stringify(createFullBackup(snap, nowISO));
  const result = parseAnyBackup(json);
  assert.ok(result.ok, result.ok ? '' : result.error);
  if (!result.ok || result.kind !== 'full') return assert.fail('debía ser una copia completa');
  assert.deepEqual(result.profile, snap.profile);
  assert.deepEqual(result.workspaces, snap.workspaces);
});

test('copia de un solo espacio: parseAnyBackup la reconoce y trae de qué espacio viene', () => {
  const data = sampleData();
  const json = JSON.stringify(createBackup(data, nowISO, { kind: 'freelancer', name: 'Diseño' }));
  const result = parseAnyBackup(json);
  assert.ok(result.ok);
  if (!result.ok || result.kind !== 'workspace') return assert.fail('debía ser de un espacio');
  assert.deepEqual(result.data, data);
  assert.deepEqual(result.workspace, { kind: 'freelancer', name: 'Diseño' });
  // Los respaldos viejos no traen el espacio de origen.
  const old = parseBackup(JSON.stringify(createBackup(data, nowISO)));
  assert.ok(old.ok && old.workspace === null);
});

test('un respaldo viejo (versión 3) se sigue pudiendo importar', () => {
  const json = JSON.stringify({ ...createBackup(sampleData(), nowISO), schemaVersion: 3 });
  assert.ok(parseAnyBackup(json).ok);
});

test('parseBackup (un espacio) rechaza una copia completa y explica cómo importarla', () => {
  const result = parseBackup(JSON.stringify(createFullBackup(fullSnapshot(), nowISO)));
  assert.ok(!result.ok);
  assert.match(result.ok ? '' : result.error, /completa/i);
});

test('copia completa: ningún id puede repetirse entre espacios', () => {
  const snap = fullSnapshot();
  const file = JSON.parse(JSON.stringify(createFullBackup(snap, nowISO)));
  file.workspaces[1].data.movements = [file.workspaces[0].data.movements[0]];
  const result = parseAnyBackup(JSON.stringify(file));
  assert.ok(!result.ok);
  assert.match(result.ok ? '' : result.error, /repetido/);
});

test('copia completa: rechaza modalidad, nombre, moneda y saldo inválidos o repetidos', () => {
  /** @param {(file: any) => void} mutate */
  const attempt = (mutate) => {
    const file = JSON.parse(JSON.stringify(createFullBackup(fullSnapshot(), nowISO)));
    mutate(file);
    return parseAnyBackup(JSON.stringify(file));
  };
  assert.ok(!attempt((f) => { f.workspaces[0].workspace.kind = 'admin'; }).ok);
  assert.ok(!attempt((f) => { f.workspaces[0].workspace.name = '   '; }).ok);
  assert.ok(!attempt((f) => { f.workspaces[1].workspace.name = 'mi espacio PERSONAL'; }).ok);
  // 0.18.3: hay más monedas, pero una que no existe (o que no usa centavos) se sigue rechazando.
  assert.ok(!attempt((f) => { f.workspaces[0].workspace.currency = 'XYZ'; }).ok);
  assert.ok(!attempt((f) => { f.workspaces[0].workspace.currency = 'CLP'; }).ok);
  assert.ok(!attempt((f) => { delete f.workspaces[0].workspace.currency; }).ok);
  const usd = attempt((f) => { f.workspaces[0].workspace.currency = 'USD'; });
  assert.ok(usd.ok && usd.kind === 'full' && usd.workspaces.some((w) => w.workspace.currency === 'USD'), 'una moneda de la lista se conserva');
  assert.ok(!attempt((f) => { f.workspaces[0].workspace.openingBalanceCents = -5; }).ok);
  assert.ok(!attempt((f) => { f.workspaces = []; }).ok);
  assert.ok(!attempt((f) => { delete f.profile; }).ok);
  assert.ok(!attempt((f) => { f.workspaces[0].data.movements[0].amountCents = 0; }).ok, 'los datos de cada espacio se validan como siempre');
});

test('copia completa: queda exactamente UN espacio predeterminado y el «último usado» debe existir', () => {
  const file = JSON.parse(JSON.stringify(createFullBackup(fullSnapshot(), nowISO)));
  file.workspaces[0].workspace.isDefault = true;
  file.workspaces[1].workspace.isDefault = true;
  file.profile.lastWorkspaceId = 'no-existe';
  const result = parseAnyBackup(JSON.stringify(file));
  assert.ok(result.ok && result.kind === 'full');
  if (result.ok && result.kind === 'full') {
    assert.deepEqual(result.workspaces.map((w) => w.workspace.isDefault), [true, false]);
    assert.equal(result.profile.lastWorkspaceId, null);
  }
  const none = JSON.parse(JSON.stringify(createFullBackup(fullSnapshot(), nowISO)));
  none.workspaces[0].workspace.isDefault = false;
  const r2 = parseAnyBackup(JSON.stringify(none));
  assert.ok(r2.ok && r2.kind === 'full' && r2.workspaces.filter((w) => w.workspace.isDefault).length === 1);
});

test('las categorías de fábrica no se pueden alterar desde el archivo y las propias no pueden hacerse pasar por de fábrica', () => {
  const data = sampleData();
  const file = JSON.parse(JSON.stringify(createBackup(data, nowISO)));
  const salary = file.data.categories.find((/** @type {any} */ c) => c.id === 'cat-inc-salario');
  salary.name = 'Sueldo editado';
  file.data.categories.push({ id: 'mi-cat', name: 'Gimnasio', kind: 'expense', defaultClassification: 'variable', builtIn: true });
  const result = parseBackup(JSON.stringify(file));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.data.categories.find((c) => c.id === 'cat-inc-salario')?.name, 'Salario');
  const mine = result.data.categories.find((c) => c.id === 'mi-cat');
  assert.equal(mine?.builtIn, false);
});

test('un movimiento no puede usar el id de una categoría de fábrica', () => {
  const file = JSON.parse(JSON.stringify(createBackup(sampleData(), nowISO)));
  file.data.movements[0].id = 'cat-exp-otros';
  assert.ok(!parseBackup(JSON.stringify(file)).ok);
});

test('nombres de archivo de la copia', () => {
  assert.equal(backupFileName('2026-07-05'), 'accontrol-respaldo-2026-07-05.json');
  assert.equal(backupFileName('2026-07-05', 'Mi Emprendimiento Ñandú'), 'accontrol-respaldo-mi-emprendimiento-nandu-2026-07-05.json');
  assert.equal(backupFileName('2026-07-05', '¡¡¡'), 'accontrol-respaldo-2026-07-05.json');
  assert.equal(fullBackupFileName('2026-07-05'), 'accontrol-respaldo-completo-2026-07-05.json');
});
