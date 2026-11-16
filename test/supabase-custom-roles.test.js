// 0.16.1 (paso 2) — La migración de roles a medida: lee el archivo SQL y comprueba que dice lo mismo que la app.
// No habla con Supabase (las pruebas dentro de la base real se describen en docs/BASE_DE_DATOS.md).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CLOUD_KINDS } from '../src/data/cloudRows.js';
import { DEPENDENCIES, MODULE_IDS, MODULE_OF_KIND } from '../src/domain/permissions.js';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
const name = files.find((n) => n.includes('_custom_roles'));
/** Sin comentarios, en minúsculas y con un solo espacio entre palabras. @param {string} text */
const flatten = (text) => text.replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ');
const flat = name ? flatten(readFileSync(new URL(name, dir), 'utf8')) : '';
const undo = flatten(readFileSync(new URL('../supabase/rollback/20261118000100_custom_roles_deshacer.sql', import.meta.url), 'utf8'));
/** El cuerpo de una función de la migración. @param {string} fn */
const fnBody = (fn) => {
  const start = flat.indexOf(`function public.${fn}(`);
  return start < 0 ? '' : flat.slice(start, flat.indexOf('$$;', start));
};

describe('migración de roles a medida (0.16.1): permisos por módulo', () => {
  it('existe, va después de las invitaciones y crea la tabla de roles con RLS (solo lectura para miembros)', () => {
    assert.ok(name, 'falta la migración');
    assert.ok(files.indexOf(name) > files.findIndex((n) => n.includes('_invites')));
    assert.ok(flat.includes('create table public.workspace_roles'));
    assert.ok(flat.includes('alter table public.workspace_roles enable row level security'));
    assert.ok(flat.includes('grant select on public.workspace_roles to authenticated'));
    assert.ok(!/grant (insert|update|delete)[^;]*workspace_roles/.test(flat), 'nadie escribe directo en roles');
    assert.ok(flat.includes('check (private.valid_permissions(permissions))'));
  });

  it('los módulos y las dependencias de la base son los de la app (src/domain/permissions.js)', () => {
    for (const id of MODULE_IDS) assert.ok(flat.includes(`'${id}'`), id);
    const toMovements = MODULE_IDS.filter((id) => DEPENDENCIES[id].same?.includes('movements')).sort();
    assert.deepEqual(toMovements, ['debts', 'departments', 'goals', 'inventory', 'invoices'], 'si cambia la app, cambia también la base');
    for (const id of toMovements) assert.ok(flat.includes(`(lv ->> '${id}')::int`), `${id} → movimientos`);
    assert.deepEqual(DEPENDENCIES.invoices, { same: ['movements', 'inventory'], view: ['clients'] });
    assert.deepEqual(DEPENDENCIES.clients, { view: ['movements'] });
    assert.ok(flat.includes("if (lv ->> 'inventory')::int < (lv ->> 'invoices')::int then return false"));
    assert.ok(flat.includes("if (lv ->> 'invoices')::int > 0 and (lv ->> 'clients')::int < 1 then return false"));
    assert.ok(flat.includes("if (lv ->> 'clients')::int > 0 and (lv ->> 'movements')::int < 1 then return false"));
  });

  it('cada una de las 15 tablas de datos queda en el mismo módulo que en la app', () => {
    assert.equal(CLOUD_KINDS.length, 15);
    for (const kind of CLOUD_KINDS) {
      assert.ok(flat.includes(`array['${kind.table}', '${MODULE_OF_KIND[kind.key]}']`), `${kind.table} → ${MODULE_OF_KIND[kind.key]}`);
      assert.ok(flat.includes(`'${kind.table}'`), kind.table);
    }
  });

  it('reglas: ver ≥ 1, crear ≥ 2, cambiar ≥ 3 o ≥ 2 si lo creó esa persona; created_by lo pone el servidor y no cambia', () => {
    assert.ok(flat.includes('using (private.module_level(workspace_id, %l) >= 1)'));
    assert.ok(flat.includes('with check (private.module_level(workspace_id, %l) >= 2)'));
    // La condición «≥ 3, o ≥ 2 si es suyo» tiene que estar en las DOS mitades de la regla de cambiar: la fila que hay
    // (using) y la que queda (with check).
    const rule = 'private.module_level(workspace_id, %3$l) >= 3 or (private.module_level(workspace_id, %3$l) >= 2 and created_by = (select auth.uid()))';
    assert.ok(flat.includes(`using (${rule})`), 'using');
    assert.ok(flat.includes(`with check (${rule})`), 'with check');
    assert.ok(!flat.includes('%1$l'), 'el módulo es el 3.er valor del format, no el nombre de la regla');
    assert.ok(flat.includes('new.created_by := old.created_by'));
    assert.ok(flat.includes('new.created_by := (select auth.uid())'));
    assert.ok(flat.includes("when 'owner' then 3 when 'admin' then 3 when 'accountant' then 1"), 'los roles fijos quedan como en la 0.16.0');
  });

  it('las funciones exigen sesión y search_path vacío; las de roles, además, ser el dueño; un visitante no las llama', () => {
    for (const fn of ['create_workspace_role', 'update_workspace_role', 'delete_workspace_role', 'create_workspace_invite', 'accept_workspace_invite', 'list_workspace_members', 'set_workspace_member_role']) {
      const text = fnBody(fn);
      assert.ok(text, fn);
      assert.ok(text.includes("if uid is null then raise exception 'necesitas iniciar sesión.'"), `${fn} exige sesión`);
      assert.ok(text.includes("set search_path = ''"), `${fn} search_path`);
    }
    for (const fn of ['create_workspace_role', 'update_workspace_role', 'delete_workspace_role']) {
      assert.ok(fnBody(fn).includes('private.is_owner(ws)'), `${fn}: solo el dueño`);
    }
    assert.ok(fnBody('create_workspace_invite').includes("solo el dueño puede invitar con un rol a medida"));
    assert.ok(flat.includes('set_workspace_member_role(uuid, uuid, text, uuid) from public, anon;'));
    assert.ok(fnBody('create_workspace_role').includes('>= 10 then'), 'tope de 10 roles');
  });

  it('no borra datos: solo añade columnas vacías y reemplaza reglas y funciones', () => {
    assert.ok(!/delete from public\.(?!workspace_roles)/.test(flat), 'lo único que puede borrar es un rol a medida');
    assert.ok(!/drop table|drop column|truncate/.test(flat));
  });

  it('hay un archivo para deshacerla: vuelve a las reglas, funciones y restricciones de la 0.16.0', () => {
    assert.ok(undo.includes('private.is_member(workspace_id)') && undo.includes('private.can_write(workspace_id)'));
    assert.ok(undo.includes("set role = 'accountant', custom_role_id = null where role = 'custom'"), 'los roles a medida pasan a Contador (lo más seguro)');
    assert.ok(undo.includes('drop table public.workspace_roles'));
    assert.ok(undo.includes("check (role in ('admin', 'accountant'))"));
    for (const fn of ['create_workspace_invite(ws uuid, invite_role text)', 'accept_workspace_invite(invite_code text)', 'list_workspace_members(ws uuid)', 'set_workspace_member_role(ws uuid, member uuid, new_role text)']) {
      assert.ok(undo.includes(`create function public.${fn}`), fn);
    }
    assert.ok(!undo.includes('new.created_by'), 'la protección de registros vuelve a no tocar created_by');
  });
});
