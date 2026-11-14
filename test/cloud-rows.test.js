import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CLOUD_KINDS, cloudKind, fromRow, toRow, toSnake, workspaceFromRow, workspaceToRow } from '../src/data/cloudRows.js';
import {
  buildCompanyDemo, buildDemoData, buildDepartmentDemo, buildFreelancerDemo, buildFreelancerInvoiceDemo, buildInventoryDemo, buildInvoiceDemo,
} from '../src/domain/demo.js';

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-11-13';
const NOW = '2026-11-13T12:00:00.000Z';

// ---------------------------------------------------------------- columnas reales de la nube (de las migraciones)
const SQL = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')).join('\n');
/** @type {Record<string, string[]>} */
const COLUMNS = {};
for (const m of SQL.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
  COLUMNS[m[1]] = m[2].split('\n').map((l) => l.trim())
    .filter((l) => /^[a-z_]+\s+(uuid|text|bigint|integer|date|timestamptz|boolean|jsonb)\b/.test(l)).map((l) => l.split(/\s+/)[0]);
}
for (const m of SQL.matchAll(/alter table public\.(\w+) add column (\w+)/g)) COLUMNS[m[1]].push(m[2]);

/** Lo que la app considera igual: sin campos undefined y sin isDemo:false. */
function canonical(record) {
  return Object.fromEntries(Object.entries(record).filter(([k, v]) => v !== undefined && !(k === 'isDemo' && v === false)));
}

/** Como devuelve Postgres por la API: fechas-hora con microsegundos y +00:00, y enteros grandes a veces como texto. */
function asPostgres(row, key) {
  const kind = cloudKind(key);
  const out = { ...row, synced_at: '2026-11-14 02:40:01.123456+00', deleted_at: null };
  for (const f of kind.timestamps ?? []) if (out[toSnake(f)]) out[toSnake(f)] = out[toSnake(f)].replace('Z', '000+00:00');
  for (const f of kind.integers ?? []) if (typeof out[toSnake(f)] === 'number') out[toSnake(f)] = String(out[toSnake(f)]);
  return out;
}

// ---------------------------------------------------------------- todos los registros de las demostraciones
function allDemoRecords() {
  const personal = buildDemoData(TODAY, NOW);
  const freelance = buildFreelancerDemo(TODAY, NOW);
  const freelanceInv = buildFreelancerInvoiceDemo(freelance, TODAY, NOW);
  const company = buildCompanyDemo(TODAY, NOW);
  const inventory = buildInventoryDemo(TODAY, NOW);
  const invoices = buildInvoiceDemo(TODAY, NOW);
  const departments = buildDepartmentDemo([...company.movements, ...inventory.movements], TODAY, NOW);
  return {
    categories: [{ id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Mascotas', kind: 'expense', defaultClassification: 'variable', builtIn: false }],
    movements: [...personal.movements, ...freelance.movements, ...inventory.movements, ...invoices.movements, ...departments.movements],
    goals: personal.goals, contributions: personal.contributions,
    debts: [...personal.debts, ...company.debts], debtPayments: [...personal.debtPayments, ...company.debtPayments],
    assets: [...personal.assets, ...company.assets],
    clients: freelance.clients, services: freelance.services,
    products: inventory.products, suppliers: inventory.suppliers, stockEntries: inventory.stockEntries,
    invoices: [...invoices.invoices, ...freelanceInv.invoices], invoicePayments: [...invoices.invoicePayments, ...freelanceInv.invoicePayments],
    departments: departments.departments,
  };
}

describe('traductor app ⇄ nube: coincide con el esquema de Supabase', () => {
  it('los 15 tipos de registro de la app tienen su tabla, y no hay tipos de más', () => {
    assert.equal(CLOUD_KINDS.length, 15);
    for (const kind of CLOUD_KINDS) assert.ok(COLUMNS[kind.table], `falta la tabla ${kind.table}`);
  });

  it('cada columna de cada tabla viaja (y nada más): si alguien añade una columna o un campo, esta prueba falla', () => {
    const managedByServer = ['workspace_id', 'synced_at', 'deleted_at'];
    for (const kind of CLOUD_KINDS) {
      const sent = new Set([...kind.fields.map(toSnake), ...(kind.noDemo ? [] : ['is_demo'])]);
      // Las categorías propias no tienen fechas ni marca DEMO en la app: la nube pone las suyas por defecto.
      const ignored = kind.key === 'categories' ? ['created_at', 'updated_at', 'is_demo'] : [];
      const expected = COLUMNS[kind.table].filter((c) => !managedByServer.includes(c) && !ignored.includes(c));
      assert.deepEqual([...sent].sort(), [...expected].sort(), kind.table);
    }
  });
});

describe('traductor app ⇄ nube: ida y vuelta', () => {
  const data = allDemoRecords();

  it('hay registros de demostración de los 15 tipos para probar', () => {
    for (const kind of CLOUD_KINDS) assert.ok(data[kind.key].length > 0, `sin muestras de ${kind.key}`);
  });

  for (const kind of CLOUD_KINDS) {
    it(`${kind.key}: registro → fila → registro no cambia nada (con el formato real de Postgres)`, () => {
      for (const record of data[kind.key]) {
        const row = toRow(kind.key, record, WS);
        assert.equal(row.workspace_id, WS);
        const back = fromRow(kind.key, asPostgres(row, kind.key));
        assert.deepEqual(back.record, canonical(record), `${kind.key} ${record.id}`);
        assert.equal(back.deletedAt, null);
        assert.equal(back.syncedAt, '2026-11-14T02:40:01.123Z');
      }
    });
  }

  it('los datos de demostración llevan is_demo = true en la nube; los reales, false', () => {
    const demo = data.movements[0];
    assert.equal(demo.isDemo, true);
    assert.equal(toRow('movements', demo, WS).is_demo, true);
    const real = { ...demo, isDemo: undefined };
    assert.equal(toRow('movements', real, WS).is_demo, false);
    assert.equal('isDemo' in fromRow('movements', toRow('movements', real, WS)).record, false);
  });
});

describe('traductor app ⇄ nube: casos especiales', () => {
  const movement = {
    id: '11111111-1111-4111-8111-111111111111', type: 'expense', amountCents: 45000, date: '2026-11-13', time: '07:44',
    description: 'Almuerzo', classification: 'variable', categoryId: 'food', createdAt: NOW, updatedAt: NOW,
  };

  it('un campo opcional ausente viaja como null y vuelve ausente', () => {
    const row = toRow('movements', movement, WS);
    assert.equal(row.client_id, null);
    assert.equal(row.department_id, null);
    assert.equal(row.amount_cents, 45000);
    assert.deepEqual(fromRow('movements', row).record, movement);
  });

  it('las fechas vacías ("") viajan como null y vuelven como ""', () => {
    const invoice = allDemoRecords().invoices.find((i) => i.dueDate === '') ?? { ...allDemoRecords().invoices[0], dueDate: '' };
    const row = toRow('invoices', invoice, WS);
    assert.equal(row.due_date, null);
    assert.equal(fromRow('invoices', row).record.dueDate, '');
    const service = { ...allDemoRecords().services[0], startDate: '', estimatedDays: null };
    const srow = toRow('services', service, WS);
    assert.equal(srow.start_date, null);
    assert.equal(srow.estimated_days, null);
    assert.equal(fromRow('services', srow).record.startDate, '');
    assert.equal(fromRow('services', srow).record.estimatedDays, null);
  });

  it('una factura anulada conserva su fecha de anulación', () => {
    const invoice = { ...allDemoRecords().invoices[0], voidedAt: '2026-11-10T15:30:00.000Z' };
    assert.equal(fromRow('invoices', toRow('invoices', invoice, WS)).record.voidedAt, '2026-11-10T15:30:00.000Z');
  });

  it('las categorías de fábrica no se suben; las propias sí y vuelven como propias', () => {
    assert.throws(() => toRow('categories', { id: 'food', name: 'Alimentación', kind: 'expense', defaultClassification: 'variable', builtIn: true }, WS), /fábrica/);
    const own = { id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Mascotas', kind: 'expense', defaultClassification: 'variable', builtIn: false };
    const row = toRow('categories', own, WS);
    assert.equal('built_in' in row, false);
    assert.equal('is_demo' in row, false);
    assert.deepEqual(fromRow('categories', row).record, own);
  });

  it('un borrado en la nube llega como deletedAt (marca), con el registro completo', () => {
    const row = { ...toRow('movements', movement, WS), deleted_at: '2026-11-14T03:00:00+00:00' };
    const back = fromRow('movements', row);
    assert.equal(back.deletedAt, '2026-11-14T03:00:00.000Z');
    assert.equal(back.record.id, movement.id);
  });

  it('nunca adivina: rechaza montos con decimales, números como texto raro y fechas-hora inválidas', () => {
    assert.throws(() => toRow('movements', { ...movement, amountCents: 450.5 }, WS), /entero/);
    assert.throws(() => fromRow('movements', { ...toRow('movements', movement, WS), amount_cents: '45abc' }), /entero/);
    assert.throws(() => toRow('movements', { ...movement, updatedAt: 'ayer' }, WS), /fecha-hora/);
  });

  it('si falta un campo obligatorio, falla en lugar de subir un registro incompleto', () => {
    const { description, ...broken } = movement;
    assert.throws(() => toRow('movements', broken, WS), /Falta «description»/);
    assert.throws(() => fromRow('movements', { ...toRow('movements', movement, WS), description: null }), /sin «description»/);
  });

  it('los campos que la nube manda de más (columnas futuras) no entran en la app', () => {
    const row = { ...toRow('movements', movement, WS), columna_nueva: 'x' };
    assert.equal('columnaNueva' in fromRow('movements', row).record, false);
    assert.equal('workspaceId' in fromRow('movements', row).record, false);
  });

  it('un tipo desconocido es un error claro', () => {
    assert.throws(() => toRow('empleados', {}, WS), /desconocido/);
  });
});

describe('traductor app ⇄ nube: espacios de trabajo', () => {
  const base = { id: WS, kind: 'company', name: 'Empresa ABC', currency: 'DOP', openingBalanceCents: 2500000, isDefault: true, createdAt: NOW, updatedAt: NOW };
  const org = { legalName: 'ABC SRL', taxId: '1-01-00000-1', activity: 'Comercio', email: 'hola@abc.test', phone: '809-555-0100', address: 'Santiago' };

  it('las columnas que se envían existen en la tabla workspaces (y created_by lo pone el servidor)', () => {
    const sent = Object.keys(workspaceToRow(base));
    for (const c of sent) assert.ok(COLUMNS.workspaces.includes(c), c);
    assert.equal(sent.includes('created_by'), false);
    assert.equal(sent.includes('is_default'), false, 'el predeterminado es de la persona, no del espacio');
  });

  it('ida y vuelta: sin organización y con organización', () => {
    assert.deepEqual(workspaceFromRow(workspaceToRow(base), true).workspace, base);
    const withOrg = { ...base, isDefault: false, organization: org };
    const row = workspaceToRow(withOrg);
    assert.deepEqual(row.organization, org);
    assert.deepEqual(workspaceFromRow({ ...row, created_at: '2026-11-13 12:00:00+00', updated_at: '2026-11-13T12:00:00.000000+00:00' }, false).workspace, withOrg);
  });

  it('la organización solo lleva sus seis campos de texto; lo que sobre o falte se arregla', () => {
    const row = workspaceToRow({ ...base, organization: { ...org, colado: 'x', phone: undefined } });
    assert.deepEqual(Object.keys(row.organization).sort(), ['activity', 'address', 'email', 'legalName', 'phone', 'taxId']);
    assert.equal(row.organization.phone, '');
    const back = workspaceFromRow({ ...workspaceToRow(base), organization: { legalName: 'X', raro: 1 } }, false).workspace;
    assert.deepEqual(back.organization, { legalName: 'X', taxId: '', activity: '', email: '', phone: '', address: '' });
  });

  it('un espacio borrado en la nube llega con su marca; uno sin datos básicos se rechaza', () => {
    assert.equal(workspaceFromRow({ ...workspaceToRow(base), deleted_at: '2026-11-14T00:00:00+00:00' }, false).deletedAt, '2026-11-14T00:00:00.000Z');
    assert.throws(() => workspaceFromRow({ ...workspaceToRow(base), name: '' }, false), /sin «name»/);
    assert.throws(() => workspaceToRow({ ...base, openingBalanceCents: 10.5 }), /entero/);
  });
});
