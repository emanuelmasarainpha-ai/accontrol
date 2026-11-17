import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DEFAULT_CATEGORIES } from '../src/domain/categories.js';

// Estas pruebas leen los archivos SQL de supabase/migrations y comprueban reglas que NO deben romperse nunca.
// No hablan con Supabase: las pruebas contra la base real (usuarios falsos, otra cuenta, sin sesión) se hicieron
// aparte y están descritas en docs/BASE_DE_DATOS.md.

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();

/** SQL sin comentarios (-- hasta fin de línea), para no confundir una frase de ayuda con una instrucción. */
const sql = (name) => readFileSync(new URL(name, dir), 'utf8').replace(/--[^\n]*/g, '');
const all = files.map(sql).join('\n');
const allLower = all.toLowerCase();

const tables = [...all.matchAll(/create table public\.(\w+)/gi)].map((m) => m[1]);

describe('migraciones de Supabase: orden y contenido', () => {
  it('hay diez migraciones numeradas en orden y sin repetirse (5.ª facturas 0.14.5; 6.ª no revivir 0.15.1; 7.ª invitaciones 0.16.0; 8.ª roles a medida 0.16.1; 9.ª productos para la caja 0.17.0; 10.ª oferta por cantidad 0.17.5)', () => {
    assert.equal(files.length, 10);
    const versions = files.map((name) => name.split('_')[0]);
    assert.deepEqual(versions, [...versions].sort());
    assert.equal(new Set(versions).size, versions.length);
    for (const name of files) assert.match(name, /^\d{14}_[a-z_]+\.sql$/);
  });

  it('crea las 21 tablas esperadas (la 20.ª, invitaciones, en la 0.16.0; la 21.ª, roles a medida, en la 0.16.1)', () => {
    assert.equal(tables.length, 21);
    assert.equal(new Set(tables).size, 21);
    for (const expected of ['profiles', 'workspaces', 'workspace_members', 'builtin_categories', 'movements', 'goals', 'debts', 'invoices', 'invoice_payments']) {
      assert.ok(tables.includes(expected), `falta la tabla ${expected}`);
    }
  });
});

describe('migraciones de Supabase: seguridad', () => {
  it('TODAS las tablas tienen RLS activada', () => {
    for (const table of tables) {
      assert.match(allLower, new RegExp(`alter table public\\.${table}\\s+enable row level security`), `la tabla ${table} no activa RLS`);
    }
  });

  it('nadie recibe permiso de borrar filas (los borrados son «blandos» o pasan por funciones controladas)', () => {
    const grants = [...allLower.matchAll(/grant\s+([^;]*?)\s+on\s+[^;]*?\s+to\s+[^;]*;/g)].map((m) => m[0]);
    assert.ok(grants.length > 0);
    for (const grant of grants) {
      assert.doesNotMatch(grant, /\bdelete\b/, `permiso de borrado: ${grant}`);
      assert.doesNotMatch(grant, /\ball\b/, `permiso «all»: ${grant}`);
      assert.doesNotMatch(grant, /\btruncate\b/, `permiso de vaciar: ${grant}`);
    }
  });

  it('a «anon» (sin sesión) y a «public» no se les da nada: solo se les quita', () => {
    const grants = [...allLower.matchAll(/grant\s[^;]*;/g)].map((m) => m[0]);
    for (const grant of grants) {
      assert.doesNotMatch(grant, /\bto\b[^;]*\b(anon|public|service_role)\b/, `permiso peligroso: ${grant}`);
    }
  });

  it('toda función SECURITY DEFINER fija search_path vacío (evita que alguien la desvíe a otro esquema)', () => {
    const definers = [...allLower.matchAll(/language \w+(?: stable)? security definer([^$]*)\$\$/g)];
    assert.ok(definers.length >= 6, `solo se encontraron ${definers.length}`);
    for (const [whole] of definers) assert.match(whole, /set search_path = ''/, whole);
  });

  it('las políticas usan (select auth.uid()) y la única «using (true)» es la lista pública de categorías de fábrica', () => {
    // Fuera de (select auth.uid()), solo se permite como valor por defecto de una columna (default auth.uid()).
    const loose = allLower.replace(/\(select auth\.uid\(\)\)/g, '').replace(/default auth\.uid\(\)/g, '');
    assert.ok(!/\bauth\.uid\(\)/.test(loose), 'auth.uid() suelto en una política: usa (select auth.uid())');
    const open = [...allLower.matchAll(/create policy (\w+)[^;]*(?:using|with check) \(true\)/g)].map((m) => m[1]);
    assert.deepEqual(open, ['builtin_categories_select']);
  });

  it('el esquema private no se expone a anon ni a public', () => {
    assert.match(allLower, /revoke all on schema private from public, anon, authenticated/);
  });
});

describe('categorías de fábrica: la semilla de la base coincide con la app', () => {
  const seed = readFileSync(new URL('20261111000400_seed_categories.sql', dir), 'utf8');
  const rows = [...seed.matchAll(/\('([^']+)', '([^']+)', '(income|expense)', '(\w+)'\)/g)].map((m) => ({ id: m[1], name: m[2], kind: m[3], defaultClassification: m[4] }));

  it('tiene las mismas 22 categorías (id, nombre, tipo y clasificación) que src/domain/categories.js', () => {
    assert.equal(DEFAULT_CATEGORIES.length, 22);
    assert.deepEqual(
      rows,
      DEFAULT_CATEGORIES.map(({ id, name, kind, defaultClassification }) => ({ id, name, kind, defaultClassification })),
    );
  });
});

describe('migración 0.14.5: facturas en Freelancer', () => {
  const name = files.find((n) => n.endsWith('_freelance_invoices.sql'));
  const text = name ? sql(name).toLowerCase() : '';
  /** El SQL con los espacios juntados en uno (para buscar frases sin depender de saltos de línea). */
  const flat = text.replace(/\s+/g, ' ');
  const has = (/** @type {string} */ fragment) => assert.ok(flat.includes(fragment), `falta: ${fragment}`);

  it('existe y va después de las cuatro de la 0.14.0', () => {
    assert.ok(name, 'falta la migración');
    assert.equal(files.indexOf(/** @type {string} */ (name)), 4);
  });

  it('añade client_id (puede ir vacío) con llave foránea COMPUESTA al cliente del mismo espacio', () => {
    has('alter table public.invoices add column client_id uuid;');
    has('foreign key (workspace_id, client_id) references public.clients (workspace_id, id) deferrable initially deferred');
  });

  it('comprueba los servicios de las líneas: del mismo espacio, del cliente, vivos y sin producto a la vez', () => {
    has("create function private.check_invoice_lines() returns trigger language plpgsql set search_path = ''");
    has('s.workspace_id = new.workspace_id');
    has('s.client_id = new.client_id');
    has('s.deleted_at is null');
    has("line ? 'productid'");
    has('create constraint trigger invoices_check_lines after insert or update of lines, client_id, workspace_id on public.invoices');
  });

  it('no borra ni cambia datos ni permisos (solo añade)', () => {
    for (const word of ['drop ', 'delete ', 'truncate ', 'update public', 'grant ', 'revoke ', 'security definer']) {
      assert.ok(!flat.includes(word), `no debería tener «${word.trim()}»`);
    }
  });
});

/** El texto de una función, desde «function private.<nombre>()» hasta el primer «$$;», con espacios normalizados. */
function functionText(text, fname) {
  const lower = text.toLowerCase();
  const start = lower.indexOf(`function private.${fname}()`);
  if (start < 0) return '';
  const end = lower.indexOf('$$;', start);
  return text.slice(start, end + 3).replace(/\s+/g, ' ');
}

describe('migración no_revive (0.15.1): lo borrado no revive con una versión más vieja', () => {
  const name = files.find((n) => n.includes('_no_revive'));
  const body = name ? sql(name) : '';

  it('existe y solo reemplaza las dos funciones de los triggers (no toca filas ni permisos)', () => {
    assert.ok(name, 'falta la migración');
    assert.equal(body.split('$$;').map((x) => x.trim()).filter(Boolean).length, 2);
    const flat = body.toLowerCase().replace(/\s+/g, ' ');
    assert.equal((flat.match(/create or replace function private\./g) ?? []).length, 2);
    for (const word of ['drop ', 'delete from', 'truncate ', 'update public', 'alter table', 'grant ', 'revoke ', 'security definer']) {
      assert.ok(!flat.includes(word), `no debería tener «${word.trim()}»`);
    }
  });

  for (const guard of ['entity_guard', 'workspace_guard']) {
    it(`${guard}: conserva deleted_at si llega una versión con updated_at <= deleted_at (search_path vacío)`, () => {
      const f = functionText(body, guard);
      assert.ok(f, `falta ${guard}`);
      assert.ok(f.includes("set search_path = ''"));
      assert.ok(f.includes('old.deleted_at is not null and new.deleted_at is null and new.updated_at <= old.deleted_at'));
      assert.ok(f.includes('new.deleted_at := old.deleted_at;'));
      assert.ok(f.includes('new.synced_at := now();'));
    });
  }

  it('las categorías quedan fuera (la app no les pone updated_at)', () => {
    assert.ok(functionText(body, 'entity_guard').includes("tg_table_name <> 'categories'"));
    assert.ok(!functionText(body, 'workspace_guard').includes('categories'));
  });

  it('hay un archivo para deshacerla que deja las funciones exactamente como en la migración original', () => {
    const undo = readFileSync(new URL('../supabase/rollback/20261116000100_no_revive_deshacer.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
    for (const guard of ['entity_guard', 'workspace_guard']) {
      assert.ok(functionText(undo, guard), guard);
      assert.equal(functionText(undo, guard), functionText(sql(files[0]), guard), guard);
    }
  });
});


describe('migración de invitaciones (0.16.0): compartir un espacio con seguridad', () => {
  const name = files.find((n) => n.includes('_invites'));
  const body = name ? sql(name) : '';
  const flat = body.toLowerCase().replace(/\s+/g, ' ');

  it('existe, crea la tabla de invitaciones con RLS y solo deja leer columnas sin la huella del código', () => {
    assert.ok(name, 'falta la migración');
    assert.ok(flat.includes('create table public.workspace_invites'));
    assert.ok(flat.includes('alter table public.workspace_invites enable row level security'));
    assert.ok(flat.includes('grant select (id, workspace_id, role, created_by, created_at, expires_at, used_by, used_at, revoked_at) on public.workspace_invites to authenticated'));
    assert.ok(!/grant (insert|update|delete)[^;]*workspace_invites/.test(flat), 'nadie escribe directo en invitaciones');
    assert.ok(!/grant (insert|update|delete)[^;]*workspace_members/.test(flat), 'nadie escribe directo en miembros');
  });

  it('guarda solo la huella SHA-256 del código (64 hexadecimales) y el código usa un alfabeto sin letras confusas', () => {
    assert.ok(flat.includes("code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$')"));
    assert.ok(flat.includes("extensions.digest(code, 'sha256')"));
    assert.ok(flat.includes("'abcdefghjkmnpqrstuvwxyz23456789'"));
    assert.ok(flat.includes('extensions.gen_random_bytes(12)'));
  });

  it('solo se invitan Administradores y Contadores; el Personal no se comparte; vence en 7 días', () => {
    assert.ok(flat.includes("role in ('admin', 'accountant')"));
    assert.ok(flat.includes("ws_kind = 'personal'"));
    assert.ok(flat.includes("interval '7 days'"));
  });

  it('las 7 funciones públicas exigen sesión y no las puede llamar un visitante sin sesión', () => {
    const fns = ['create_workspace_invite', 'accept_workspace_invite', 'revoke_workspace_invite', 'list_workspace_members', 'set_workspace_member_role', 'remove_workspace_member', 'leave_workspace'];
    for (const fn of fns) {
      const start = flat.indexOf(`function public.${fn}(`);
      assert.ok(start >= 0, fn);
      const text = flat.slice(start, flat.indexOf('$$;', start));
      assert.ok(text.includes("if uid is null then raise exception 'necesitas iniciar sesión.'"), `${fn} exige sesión`);
      assert.ok(text.includes("set search_path = ''"), `${fn} search_path`);
    }
    assert.ok(flat.includes('leave_workspace(uuid) from public, anon;'));
  });

  it('eliminar la cuenta se niega si eres dueño de un espacio con otros miembros', () => {
    const start = flat.indexOf('create or replace function public.delete_my_account()');
    assert.ok(start >= 0);
    assert.ok(flat.slice(start).includes('other.user_id <> uid'));
  });
});
