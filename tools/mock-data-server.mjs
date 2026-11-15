// =============================================================================
// BASE DE DATOS SIMULADA — SOLO PARA PRUEBAS (0.15.0)
// -----------------------------------------------------------------------------
// Imita la parte de la API de datos de Supabase (PostgREST) que usa la sincronización, con las reglas que importan:
//   · sin sesión válida no se lee ni se escribe nada (401);
//   · cada cuenta solo ve los espacios de los que es miembro y solo escribe en los suyos (403, como RLS);
//   · un registro no puede apuntar a otro que no existe en el mismo espacio (409, llave foránea);
//   · columnas desconocidas se rechazan (400); las columnas salen de los archivos de supabase/migrations/;
//   · el servidor pone `synced_at` (con microsegundos, igual para todo lo de una misma petición, como now()).
// NO es Postgres: no comprueba los CHECK de rango ni los triggers de facturas. Eso se prueba contra la base real.
// =============================================================================
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

/** Columnas de cada tabla, leídas de las migraciones (no del código de la app). */
function readColumns() {
  const sql = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(MIGRATIONS + f, 'utf8')).join('\n');
  /** @type {Record<string, string[]>} */
  const columns = {};
  for (const m of sql.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    columns[m[1]] = m[2].split('\n').map((l) => l.trim())
      .filter((l) => /^[a-z_]+\s+(uuid|text|bigint|integer|date|timestamptz|boolean|jsonb)\b/.test(l)).map((l) => l.split(/\s+/)[0]);
  }
  for (const m of sql.matchAll(/alter table public\.(\w+) add column (\w+)/g)) columns[m[1]].push(m[2]);
  return columns;
}

const ENTITY_TABLES = ['categories', 'departments', 'clients', 'services', 'movements', 'goals', 'contributions', 'debts', 'debt_payments',
  'assets', 'products', 'suppliers', 'invoices', 'stock_entries', 'invoice_payments'];

/** Llaves foráneas compuestas (mismo espacio) que la base real comprueba al terminar cada petición. */
const FOREIGN = {
  services: { client_id: 'clients' },
  movements: { client_id: 'clients', service_id: 'services', department_id: 'departments' },
  contributions: { goal_id: 'goals' },
  debt_payments: { debt_id: 'debts', movement_id: 'movements' },
  stock_entries: { product_id: 'products', supplier_id: 'suppliers', movement_id: 'movements', invoice_id: 'invoices' },
  invoices: { client_id: 'clients' },
  invoice_payments: { invoice_id: 'invoices', movement_id: 'movements' },
};

/**
 * @param {{ now?: () => number, emailOf?: (userId: string) => string | null }} [options]
 */
export function createMockDataServer(options = {}) {
  const nowMs = options.now ?? (() => Date.now());
  const COLUMNS = readColumns();
  /** @type {Map<string, Record<string, any>>} */
  const workspaces = new Map();
  /** @type {Array<{ workspace_id: string, user_id: string, role: string, is_default: boolean, created_at: string }>} */
  const members = [];
  /** @type {Map<string, { user_id: string, display_name: string, last_workspace_id: string | null }>} */
  const profiles = new Map();
  /** Invitaciones (0.16.0): como en la base real, solo la huella del código. */
  /** @type {Array<{ id: string, workspace_id: string, code_hash: string, role: string, created_by: string, created_at: string, expires_at: string, used_by: string | null, used_at: string | null, revoked_at: string | null }>} */
  const invites = [];
  const emailOf = options.emailOf ?? (() => null);
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const hashCode = (/** @type {string} */ c) => createHash('sha256').update(c).digest('hex');
  const normalize = (/** @type {unknown} */ c) => String(c ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const roleOf = (/** @type {string} */ userId, /** @type {string} */ ws) => members.find((m) => m.user_id === userId && m.workspace_id === ws)?.role ?? null;
  const P0001 = (/** @type {string} */ message) => ({ status: 400, body: { code: 'P0001', message } });
  const DENIED = (/** @type {string} */ message) => ({ status: 403, body: { code: '42501', message } });
  const INVALID = 'El código no es válido o ya venció. Pide uno nuevo.';

  /** Las funciones (RPC) de compartir, con las mismas reglas que 20261117000100_invites.sql. */
  function shareRpc(name, uid, body) {
    const now = nowMs();
    const iso = new Date(now).toISOString();
    if (name === 'create_workspace_invite') {
      const ws = body?.ws;
      const want = body?.invite_role;
      const mine = roleOf(uid, ws);
      if (mine !== 'owner' && mine !== 'admin') return DENIED('Solo el dueño o un administrador del espacio puede invitar.');
      if (want !== 'admin' && want !== 'accountant') return { status: 400, body: { code: '22023', message: 'Rol no válido.' } };
      if (want === 'admin' && mine !== 'owner') return DENIED('Solo el dueño puede invitar administradores.');
      const w = workspaces.get(ws);
      if (w?.kind === 'personal') return P0001('El espacio Personal no se comparte.');
      if (w?.deleted_at) return P0001('Ese espacio está borrado.');
      if (invites.filter((x) => x.workspace_id === ws && !x.used_at && !x.revoked_at && Date.parse(x.expires_at) > now).length >= 20) {
        return P0001('Hay demasiadas invitaciones pendientes en este espacio. Anula alguna.');
      }
      const bytes = randomBytes(12);
      const plain = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
      const expires = new Date(now + 7 * 86_400_000).toISOString();
      invites.push({ id: randomUUID(), workspace_id: ws, code_hash: hashCode(plain), role: want, created_by: uid, created_at: iso, expires_at: expires, used_by: null, used_at: null, revoked_at: null });
      return reply(200, [{ code: plain.slice(0, 4) + '-' + plain.slice(4, 8) + '-' + plain.slice(8), expires_at: expires }]);
    }
    if (name === 'accept_workspace_invite') {
      const inv = invites.find((x) => x.code_hash === hashCode(normalize(body?.invite_code)));
      if (!inv || inv.used_at || inv.revoked_at || Date.parse(inv.expires_at) <= now) return P0001(INVALID);
      const w = workspaces.get(inv.workspace_id);
      if (!w || w.deleted_at) return P0001(INVALID);
      if (roleOf(uid, inv.workspace_id)) return P0001('Ya perteneces a ese espacio.');
      members.push({ workspace_id: inv.workspace_id, user_id: uid, role: inv.role, is_default: false, created_at: iso });
      inv.used_by = uid;
      inv.used_at = iso;
      return reply(200, [{ workspace_id: inv.workspace_id, workspace_name: w.name, role: inv.role }]);
    }
    if (name === 'revoke_workspace_invite') {
      const inv = invites.find((x) => x.id === body?.invite);
      if (!inv) return P0001('Esa invitación no existe.');
      const mine = roleOf(uid, inv.workspace_id);
      if (!(mine === 'owner' || (mine === 'admin' && inv.role === 'accountant'))) return DENIED('No puedes anular esa invitación.');
      if (!inv.used_at && !inv.revoked_at) inv.revoked_at = iso;
      return reply(204, null);
    }
    if (name === 'list_workspace_members') {
      const ws = body?.ws;
      const mine = roleOf(uid, ws);
      if (!mine) return DENIED('No perteneces a ese espacio.');
      const manager = mine === 'owner' || mine === 'admin';
      const order = { owner: 0, admin: 1, accountant: 2 };
      const list = members.filter((m) => m.workspace_id === ws)
        .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.created_at.localeCompare(b.created_at))
        .map((m) => ({
          user_id: m.user_id, role: m.role, display_name: profiles.get(m.user_id)?.display_name ?? '',
          email: manager || m.user_id === uid ? emailOf(m.user_id) : null, is_me: m.user_id === uid, joined_at: m.created_at,
        }));
      return reply(200, list);
    }
    if (name === 'set_workspace_member_role') {
      if (roleOf(uid, body?.ws) !== 'owner') return DENIED('Solo el dueño puede cambiar roles.');
      if (body?.new_role !== 'admin' && body?.new_role !== 'accountant') return { status: 400, body: { code: '22023', message: 'Rol no válido.' } };
      if (body?.member === uid) return P0001('No puedes cambiar tu propio rol.');
      const m = members.find((x) => x.workspace_id === body?.ws && x.user_id === body?.member && x.role !== 'owner');
      if (!m) return P0001('Esa persona no es miembro del espacio.');
      m.role = body.new_role;
      return reply(204, null);
    }
    if (name === 'remove_workspace_member') {
      const mine = roleOf(uid, body?.ws);
      const theirs = roleOf(body?.member, body?.ws);
      if (!theirs) return P0001('Esa persona no es miembro del espacio.');
      if (body?.member === uid) return P0001('Para irte del espacio usa «Salir del espacio».');
      if (theirs === 'owner' || !(mine === 'owner' || (mine === 'admin' && theirs === 'accountant'))) return DENIED('No puedes quitar a esa persona.');
      members.splice(members.findIndex((x) => x.workspace_id === body.ws && x.user_id === body.member), 1);
      const prof = profiles.get(body.member);
      if (prof?.last_workspace_id === body.ws) prof.last_workspace_id = null;
      return reply(204, null);
    }
    if (name === 'leave_workspace') {
      const mine = roleOf(uid, body?.ws);
      if (!mine) return P0001('No perteneces a ese espacio.');
      if (mine === 'owner') return P0001('El dueño no puede salir de su propio espacio.');
      members.splice(members.findIndex((x) => x.workspace_id === body.ws && x.user_id === uid), 1);
      const prof = profiles.get(uid);
      if (prof?.last_workspace_id === body.ws) prof.last_workspace_id = null;
      return reply(204, null);
    }
    return null;
  }
  /** @type {Record<string, Map<string, Record<string, any>>>} */
  const tables = Object.fromEntries(ENTITY_TABLES.map((t) => [t, new Map()]));
  let lastStampUs = 0;

  /** Una marca de tiempo por petición, siempre creciente, con microsegundos: "2026-11-14T02:40:01.123456+00:00". */
  function stamp() {
    lastStampUs = Math.max(lastStampUs + 1, nowMs() * 1000);
    const ms = Math.floor(lastStampUs / 1000);
    const us = String(lastStampUs % 1000).padStart(3, '0');
    return new Date(ms).toISOString().replace('Z', `${us}+00:00`);
  }

  const reply = (status, body) => ({ status, body });
  const isMember = (userId, ws) => members.some((m) => m.user_id === userId && m.workspace_id === ws);
  const canWrite = (userId, ws) => members.some((m) => m.user_id === userId && m.workspace_id === ws && ['owner', 'admin'].includes(m.role));
  const RLS = (table) => reply(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });

  /** Filtros de PostgREST que usa la app: col=eq.x, gt, in.(a,b), is.null, y el or=(…) del cursor. */
  function parseFilters(params) {
    /** @type {Array<(row: Record<string, any>) => boolean>} */
    const tests = [];
    for (const [key, raw] of params.entries()) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(key)) continue;
      if (key === 'or') {
        const m = /^\(synced_at\.gt\."([^"]+)",and\(synced_at\.eq\."([^"]+)",id\.gt\.([0-9a-f-]+)\)\)$/.exec(raw);
        if (!m) throw Object.assign(new Error(`or no admitido: ${raw}`), { status: 400 });
        tests.push((r) => r.synced_at > m[1] || (r.synced_at === m[2] && r.id > m[3]));
        continue;
      }
      const m = /^(eq|gt|in|is)\.(.*)$/.exec(raw);
      if (!m) throw Object.assign(new Error(`filtro no admitido: ${key}=${raw}`), { status: 400 });
      const [, op, value] = m;
      if (op === 'eq') tests.push((r) => String(r[key]) === value);
      else if (op === 'gt') tests.push((r) => r[key] > value);
      else if (op === 'is' && value === 'null') tests.push((r) => r[key] === null || r[key] === undefined);
      else if (op === 'in') {
        const set = new Set(value.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')));
        tests.push((r) => set.has(String(r[key])));
      } else throw Object.assign(new Error(`filtro no admitido: ${key}=${raw}`), { status: 400 });
    }
    return (row) => tests.every((t) => t(row));
  }

  function sortAndLimit(rows, params) {
    const order = params.get('order');
    if (order) {
      // Como PostgREST: «columna» o «columna.asc» de menor a mayor; «columna.desc» de mayor a menor.
      const keys = order.split(',').map((o) => ({ k: o.split('.')[0], dir: o.split('.')[1] === 'desc' ? -1 : 1 }));
      rows.sort((a, b) => {
        for (const { k, dir } of keys) {
          if (a[k] < b[k]) return -dir;
          if (a[k] > b[k]) return dir;
        }
        return 0;
      });
    }
    const limit = Number(params.get('limit') ?? Infinity);
    return rows.slice(0, limit);
  }

  function unknownColumn(table, row) {
    const bad = Object.keys(row).find((c) => !COLUMNS[table].includes(c));
    return bad ? reply(400, { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` }) : null;
  }

  /**
   * Como el trigger de la base real (migración 20261116000100_no_revive): un registro borrado no revive con una
   * versión anterior (o igual) a su borrado; sigue borrado. Las categorías no llevan updated_at de la app: no se aplica.
   */
  function noRevive(table, old, next) {
    if (table === 'categories' || !old?.deleted_at || next.deleted_at !== null) return next;
    if (Date.parse(next.updated_at) <= Date.parse(old.deleted_at)) return { ...next, deleted_at: old.deleted_at };
    return next;
  }

  // ---------------------------------------------------------------- espacios
  function upsertWorkspaces(user, rows) {
    for (const row of rows) {
      const bad = unknownColumn('workspaces', row);
      if (bad) return bad;
      const old = workspaces.get(row.id);
      if (old && old.created_by !== user.id) return RLS('workspaces');
      if (old && row.kind && row.kind !== old.kind) return reply(400, { code: 'P0001', message: 'No se puede cambiar el id, el creador ni el tipo de un espacio.' });
    }
    const now = stamp();
    for (const row of rows) {
      const old = workspaces.get(row.id);
      if (old) {
        Object.assign(old, noRevive('workspaces', old, { ...old, ...row }), { synced_at: now });
        continue;
      }
      const owned = [...workspaces.values()].filter((w) => w.created_by === user.id && !w.deleted_at).length;
      if (owned >= 20) return reply(400, { code: 'P0001', message: 'Máximo 20 espacios de trabajo por cuenta.' });
      workspaces.set(row.id, { currency: 'DOP', opening_balance_cents: 0, organization: null, deleted_at: null, ...row, created_by: user.id, synced_at: now });
      const hasDefault = members.some((m) => m.user_id === user.id && m.is_default);
      members.push({ workspace_id: row.id, user_id: user.id, role: 'owner', is_default: !hasDefault, created_at: now });
    }
    return reply(201, null);
  }

  // ---------------------------------------------------------------- datos de los espacios
  function upsertEntities(user, table, rows) {
    for (const row of rows) {
      const bad = unknownColumn(table, row);
      if (bad) return bad;
      if (!row.workspace_id || !row.id) return reply(400, { code: '23502', message: 'null value in column "id" or "workspace_id"' });
      if (!canWrite(user.id, row.workspace_id)) return RLS(table);
    }
    // Llaves foráneas: el destino debe existir en el mismo espacio (ya guardado o en esta misma petición).
    const pending = new Set(rows.map((r) => `${r.workspace_id}|${r.id}`));
    for (const row of rows) {
      for (const [col, target] of Object.entries(FOREIGN[table] ?? {})) {
        const ref = row[col];
        if (ref === null || ref === undefined) continue;
        const key = `${row.workspace_id}|${ref}`;
        const exists = tables[target].has(key) || (target === table && pending.has(key));
        if (!exists) return reply(409, { code: '23503', message: `insert or update on table "${table}" violates foreign key constraint "${table}_${col}_fk"` });
      }
    }
    const now = stamp();
    for (const row of rows) {
      const key = `${row.workspace_id}|${row.id}`;
      const old = tables[table].get(key);
      tables[table].set(key, old ? { ...noRevive(table, old, { ...old, ...row }), synced_at: now } : { deleted_at: null, ...row, synced_at: now });
    }
    return reply(201, null);
  }

  function patchEntities(user, table, params, body) {
    const bad = unknownColumn(table, body);
    if (bad) return bad;
    const match = parseFilters(params);
    const rows = [...tables[table].values()].filter(match);
    if (rows.some((r) => !canWrite(user.id, r.workspace_id))) return RLS(table);
    const now = stamp();
    for (const r of rows) Object.assign(r, body, { synced_at: now });
    return reply(204, null);
  }

  const server = {
    workspaces, members, profiles, tables, invites,
    /** ¿Es dueño de un espacio vivo con otros miembros? (delete_my_account se niega). @param {string} userId */
    ownsSharedWorkspace(userId) {
      return members.some((mine) => mine.user_id === userId && mine.role === 'owner' && !workspaces.get(mine.workspace_id)?.deleted_at
        && members.some((o) => o.workspace_id === mine.workspace_id && o.user_id !== userId));
    },
    /** Crea el perfil de una cuenta nueva (en Supabase lo hace un trigger al registrarse). @param {string} userId */
    ensureProfile(userId) {
      if (!profiles.has(userId)) profiles.set(userId, { user_id: userId, display_name: '', last_workspace_id: null });
    },
    /** Borra todo lo de una cuenta (en Supabase, la cascada de delete_my_account). @param {string} userId */
    deleteUser(userId) {
      const own = [...workspaces.values()].filter((w) => w.created_by === userId).map((w) => w.id);
      for (const id of own) workspaces.delete(id);
      for (const t of Object.values(tables)) for (const [k, r] of t) if (own.includes(r.workspace_id)) t.delete(k);
      for (let i = members.length - 1; i >= 0; i -= 1) if (members[i].user_id === userId || own.includes(members[i].workspace_id)) members.splice(i, 1);
      profiles.delete(userId);
    },
    /** Filas vivas (sin borrar) de una tabla en un espacio. @param {string} table @param {string} ws */
    live(table, ws) {
      return [...tables[table].values()].filter((r) => r.workspace_id === ws && !r.deleted_at);
    },

    /**
     * @param {{ method: string, path: string, params: URLSearchParams, headers: Record<string, string>, body: any, user: { id: string } | null }} req
     */
    handle(req) {
      const { method, path, params, headers, body, user } = req;
      if (!user) return reply(401, { code: 'PGRST301', message: 'JWT expired' });
      server.ensureProfile(user.id);
      const table = path.replace('/rest/v1/', '');
      try {
        if (method === 'POST' && table.startsWith('rpc/')) {
          const shared = shareRpc(table.slice(4), user.id, body);
          if (shared) return shared;
        }
        if (table === 'workspace_invites' && method === 'GET') {
          const match = parseFilters(params);
          const visible = invites.filter((x) => ['owner', 'admin'].includes(roleOf(user.id, x.workspace_id) ?? '') && match(x));
          return reply(200, sortAndLimit(visible.map(({ code_hash: _h, ...rest }) => ({ ...rest })), params));
        }
        if (method === 'POST' && table === 'rpc/set_default_workspace') {
          if (!isMember(user.id, body?.ws)) return reply(403, { code: '42501', message: 'No perteneces a ese espacio.' });
          for (const m of members) if (m.user_id === user.id) m.is_default = m.workspace_id === body.ws;
          return reply(204, null);
        }
        const rows = Array.isArray(body) ? body : body ? [body] : [];
        const upsert = /resolution=merge-duplicates/.test(headers.prefer ?? headers.Prefer ?? '');
        if (table === 'workspaces') {
          if (method === 'GET') {
            const match = parseFilters(params);
            return reply(200, sortAndLimit([...workspaces.values()].filter((w) => (w.created_by === user.id || isMember(user.id, w.id)) && match(w)).map((w) => ({ ...w })), params));
          }
          if (method === 'POST') {
            // «Crear solo si no existe» (ON CONFLICT DO NOTHING): las filas que ya existen no se tocan, ni su deleted_at.
            if (/resolution=ignore-duplicates/.test(headers.prefer ?? headers.Prefer ?? '')) return upsertWorkspaces(user, rows.filter((r) => !workspaces.has(r.id)));
            if (!upsert && rows.some((r) => workspaces.has(r.id))) return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint "workspaces_pkey"' });
            return upsertWorkspaces(user, rows);
          }
          if (method === 'PATCH') {
            const bad = unknownColumn('workspaces', body);
            if (bad) return bad;
            if (body.kind || body.id || body.created_by) return reply(400, { code: 'P0001', message: 'No se puede cambiar el id, el creador ni el tipo de un espacio.' });
            const match = parseFilters(params);
            // RLS: solo se actualizan los del dueño (los demás ni se ven para actualizar).
            const now = stamp();
            for (const w of workspaces.values()) if (w.created_by === user.id && match(w)) Object.assign(w, body, { synced_at: now });
            return reply(204, null);
          }
        }
        if (table === 'workspace_members' && method === 'GET') {
          const match = parseFilters(params);
          return reply(200, members.filter((m) => m.user_id === user.id && match(m)).map((m) => ({ ...m })));
        }
        if (table === 'profiles') {
          const own = profiles.get(user.id);
          if (method === 'GET') return reply(200, [{ ...own }]);
          if (method === 'PATCH') {
            const bad = unknownColumn('profiles', body);
            if (bad) return bad;
            if (params.get('user_id') !== `eq.${user.id}`) return reply(200, null);
            Object.assign(own, body);
            return reply(204, null);
          }
        }
        if (ENTITY_TABLES.includes(table)) {
          if (method === 'GET') {
            const match = parseFilters(params);
            const visible = [...tables[table].values()].filter((r) => isMember(user.id, r.workspace_id) && match(r)).map((r) => ({ ...r }));
            return reply(200, sortAndLimit(visible, params));
          }
          if (method === 'POST') {
            if (!upsert && rows.some((r) => tables[table].has(`${r.workspace_id}|${r.id}`))) {
              return reply(409, { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` });
            }
            return upsertEntities(user, table, rows);
          }
          if (method === 'PATCH') return patchEntities(user, table, params, body);
        }
        return reply(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` });
      } catch (error) {
        return reply(/** @type {any} */ (error).status ?? 500, { code: 'PGRST100', message: String(/** @type {any} */ (error).message) });
      }
    },
  };
  return server;
}
