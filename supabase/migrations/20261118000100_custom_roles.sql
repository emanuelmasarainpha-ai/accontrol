-- =============================================================================
-- ACCONTROL 0.16.1 — Roles a medida (el Dueño arma los roles de su empresa con permisos por módulo)
-- -----------------------------------------------------------------------------
-- · Tabla workspace_roles: nombre + permisos por módulo (8 módulos, nivel none/view/create/edit). Las MISMAS reglas que
--   src/domain/permissions.js: lista fija de módulos y niveles, y las dependencias se exigen (un rol incoherente no se
--   guarda). Hasta 10 por espacio. No en espacios Personal. Solo el Dueño los crea, cambia o borra (por funciones).
-- · Un miembro puede tener role = 'custom' con custom_role_id; las invitaciones también.
-- · Cada registro de las 15 tablas de datos guarda quién lo creó (created_by, lo pone el servidor y no se cambia).
-- · Las reglas de seguridad (RLS) de las 15 tablas miran el NIVEL del módulo de esa tabla:
--     ver ≥ 1 · crear ≥ 2 · cambiar: ≥ 3, o ≥ 2 si el registro lo creó esa persona («Registrar» corrige lo suyo).
--   Dueño y Administrador = 3 en todo, Contador = 1 en todo: para ellos nada cambia respecto de la 0.16.0.
-- · No modifica ni borra filas existentes (las nuevas columnas quedan vacías en lo ya guardado: lo antiguo no es «de»
--   nadie, así que un rol con solo «Registrar» no puede corregirlo; el Dueño y el Administrador, sí).
-- Se deshace con supabase/rollback/20261118000100_custom_roles_deshacer.sql.
-- =============================================================================

-- --------------------------------------------------------------- permisos válidos
-- Número de un nivel (none 0, view 1, create 2, edit 3); null si no es un nivel.
create function private.level_rank(level text) returns int
language sql immutable set search_path = '' as $$
  select case level when 'none' then 0 when 'view' then 1 when 'create' then 2 when 'edit' then 3 else null end;
$$;

-- ¿Son unos permisos completos y coherentes? Exactamente los 8 módulos, cada uno con un nivel, y las dependencias de
-- src/domain/permissions.js (DEPENDENCIES) cumplidas.
create function private.valid_permissions(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  mods constant text[] := array['movements', 'goals', 'debts', 'assets', 'clients', 'inventory', 'invoices', 'departments'];
  m text;
  lv jsonb := '{}'::jsonb;
  r int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p)) <> 8 then return false; end if;
  foreach m in array mods loop
    if jsonb_typeof(p -> m) is distinct from 'string' then return false; end if;
    r := private.level_rank(p ->> m);
    if r is null then return false; end if;
    lv := lv || jsonb_build_object(m, r);
  end loop;
  -- «same»: el módulo de la derecha necesita al menos el mismo nivel.
  if (lv ->> 'movements')::int < greatest((lv ->> 'goals')::int, (lv ->> 'debts')::int, (lv ->> 'inventory')::int,
                                           (lv ->> 'invoices')::int, (lv ->> 'departments')::int) then return false; end if;
  if (lv ->> 'inventory')::int < (lv ->> 'invoices')::int then return false; end if;
  -- «view»: con cualquier acceso a Facturas hay que ver Clientes; con cualquier acceso a Clientes, Movimientos.
  if (lv ->> 'invoices')::int > 0 and (lv ->> 'clients')::int < 1 then return false; end if;
  if (lv ->> 'clients')::int > 0 and (lv ->> 'movements')::int < 1 then return false; end if;
  return true;
end;
$$;
revoke all on function private.level_rank(text), private.valid_permissions(jsonb) from public, anon;

-- --------------------------------------------------------------- roles a medida
create table public.workspace_roles (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 30),
  permissions  jsonb not null check (private.valid_permissions(permissions)),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.workspace_roles is 'Roles a medida de un espacio (0.16.1). Permisos por módulo; solo se escriben por funciones.';
create unique index workspace_roles_name_idx on public.workspace_roles (workspace_id, lower(name));

alter table public.workspace_roles enable row level security;
-- Ver: cualquier miembro (cada persona necesita conocer los permisos de su rol). Escribir: solo por las funciones.
grant select on public.workspace_roles to authenticated;
create policy workspace_roles_select on public.workspace_roles for select to authenticated
  using (private.is_member(workspace_id));

-- --------------------------------------------------------------- miembros e invitaciones
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members
  add column custom_role_id uuid references public.workspace_roles (id) on delete restrict,
  add constraint workspace_members_role_check check (role in ('owner', 'admin', 'accountant', 'custom')),
  add constraint workspace_members_custom_check check ((role = 'custom') = (custom_role_id is not null));
create index workspace_members_custom_role_idx on public.workspace_members (custom_role_id) where custom_role_id is not null;

alter table public.workspace_invites drop constraint workspace_invites_role_check;
alter table public.workspace_invites
  add column custom_role_id uuid references public.workspace_roles (id) on delete restrict,
  add constraint workspace_invites_role_check check (role in ('admin', 'accountant', 'custom')),
  add constraint workspace_invites_custom_check check ((role = 'custom') = (custom_role_id is not null));
create index workspace_invites_custom_role_idx on public.workspace_invites (custom_role_id) where custom_role_id is not null;
grant select (custom_role_id) on public.workspace_invites to authenticated;

-- --------------------------------------------------------------- quién creó cada registro
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'departments', 'clients', 'services', 'movements', 'goals', 'contributions', 'debts',
    'debt_payments', 'assets', 'products', 'suppliers', 'invoices', 'stock_entries', 'invoice_payments'
  ] loop
    execute format('alter table public.%I add column created_by uuid', t);
  end loop;
end $$;

-- El servidor pone created_by al crear (la persona que llama) y no deja cambiarlo después. Lo demás, igual que antes.
create or replace function private.entity_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) ->> 'id' is distinct from to_jsonb(old) ->> 'id'
       or to_jsonb(new) ->> 'workspace_id' is distinct from to_jsonb(old) ->> 'workspace_id' then
      raise exception 'No se puede cambiar el id ni el espacio de un registro.' using errcode = 'P0001';
    end if;
    -- No revivir con una versión anterior (o igual) al borrado.
    if tg_table_name <> 'categories'
       and old.deleted_at is not null and new.deleted_at is null
       and new.updated_at <= old.deleted_at then
      new.deleted_at := old.deleted_at;
    end if;
    new.created_by := old.created_by;
  else
    new.created_by := (select auth.uid());
  end if;
  new.synced_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------------- nivel de cada persona en cada módulo
-- 0 sin acceso · 1 ver · 2 registrar · 3 editar y borrar. Dueño y Administrador 3; Contador 1; rol a medida, el suyo.
create function private.module_level(ws uuid, module text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case m.role
             when 'owner' then 3
             when 'admin' then 3
             when 'accountant' then 1
             when 'custom' then coalesce(private.level_rank(r.permissions ->> module), 0)
             else 0
           end
    from public.workspace_members m
    left join public.workspace_roles r on r.id = m.custom_role_id
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  ), 0);
$$;
revoke all on function private.module_level(uuid, text) from public, anon;
grant execute on function private.module_level(uuid, text) to authenticated;

-- Reglas nuevas de las 15 tablas (mismos nombres que antes; se reemplazan).
do $$
declare
  pair text[];
  t text;
  modname text;
begin
  foreach pair slice 1 in array array[
    array['categories', 'movements'], array['movements', 'movements'],
    array['goals', 'goals'], array['contributions', 'goals'],
    array['debts', 'debts'], array['debt_payments', 'debts'],
    array['assets', 'assets'],
    array['clients', 'clients'], array['services', 'clients'],
    array['products', 'inventory'], array['suppliers', 'inventory'], array['stock_entries', 'inventory'],
    array['invoices', 'invoices'], array['invoice_payments', 'invoices'],
    array['departments', 'departments']
  ] loop
    t := pair[1];
    modname := pair[2];
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format('drop policy %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.module_level(workspace_id, %L) >= 1)',
      t || '_select', t, modname);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.module_level(workspace_id, %L) >= 2)',
      t || '_insert', t, modname);
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (private.module_level(workspace_id, %3$L) >= 3 or (private.module_level(workspace_id, %3$L) >= 2 and created_by = (select auth.uid()))) '
      'with check (private.module_level(workspace_id, %3$L) >= 3 or (private.module_level(workspace_id, %3$L) >= 2 and created_by = (select auth.uid())))',
      t || '_update', t, modname);
  end loop;
end $$;

-- --------------------------------------------------------------- funciones de los roles (solo el Dueño)
-- Nombre limpio y válido, o error en español.
create function private.clean_role_name(ws uuid, raw text, except_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare n text := regexp_replace(btrim(coalesce(raw, '')), '\s+', ' ', 'g');
begin
  if n = '' then raise exception 'Escribe un nombre para el rol, por ejemplo «Cajero».' using errcode = 'P0001'; end if;
  if char_length(n) > 30 then raise exception 'El nombre del rol puede tener hasta 30 caracteres.' using errcode = 'P0001'; end if;
  if lower(n) in ('dueño', 'dueno', 'administrador', 'contador') then
    raise exception '«%» ya existe como rol fijo. Elige otro nombre.', n using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workspace_roles r where r.workspace_id = ws and lower(r.name) = lower(n) and r.id is distinct from except_id) then
    raise exception 'Ya hay un rol con ese nombre en este espacio.' using errcode = 'P0001';
  end if;
  return n;
end;
$$;
revoke all on function private.clean_role_name(uuid, text, uuid) from public, anon, authenticated;

create function public.create_workspace_role(ws uuid, role_name text, perms jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ws_kind text;
  ws_deleted timestamptz;
  new_id uuid;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  if not private.is_owner(ws) then raise exception 'Solo el dueño puede crear roles.' using errcode = '42501'; end if;
  select w.kind, w.deleted_at into ws_kind, ws_deleted from public.workspaces w where w.id = ws;
  if ws_kind = 'personal' then raise exception 'El espacio Personal no se comparte.' using errcode = 'P0001'; end if;
  if ws_deleted is not null then raise exception 'Ese espacio está borrado.' using errcode = 'P0001'; end if;
  if not private.valid_permissions(perms) then raise exception 'Los permisos del rol no son válidos.' using errcode = '22023'; end if;
  if (select count(*) from public.workspace_roles r where r.workspace_id = ws) >= 10 then
    raise exception 'Puedes tener hasta 10 roles a medida por espacio.' using errcode = 'P0001';
  end if;
  insert into public.workspace_roles (workspace_id, name, permissions)
  values (ws, private.clean_role_name(ws, role_name, null), perms)
  returning id into new_id;
  return new_id;
end;
$$;

create function public.update_workspace_role(role_id uuid, role_name text, perms jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ws uuid;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  select r.workspace_id into ws from public.workspace_roles r where r.id = role_id;
  if ws is null then raise exception 'Ese rol no existe.' using errcode = 'P0001'; end if;
  if not private.is_owner(ws) then raise exception 'Solo el dueño puede cambiar roles.' using errcode = '42501'; end if;
  if not private.valid_permissions(perms) then raise exception 'Los permisos del rol no son válidos.' using errcode = '22023'; end if;
  update public.workspace_roles
     set name = private.clean_role_name(ws, role_name, role_id), permissions = perms, updated_at = now()
   where id = role_id;
end;
$$;

create function public.delete_workspace_role(role_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  ws uuid;
  n int;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  select r.workspace_id into ws from public.workspace_roles r where r.id = role_id;
  if ws is null then raise exception 'Ese rol no existe.' using errcode = 'P0001'; end if;
  if not private.is_owner(ws) then raise exception 'Solo el dueño puede borrar roles.' using errcode = '42501'; end if;
  select count(*) into n from public.workspace_members m where m.custom_role_id = role_id;
  if n > 0 then
    raise exception 'Ese rol lo tiene% % persona%. Cámbiale% el rol antes de borrarlo.', case when n = 1 then '' else 'n' end, n, case when n = 1 then '' else 's' end, case when n = 1 then '' else 's' end
      using errcode = 'P0001';
  end if;
  -- Las invitaciones pendientes con ese rol se anulan; las ya usadas o anuladas se conservan sin el rol.
  update public.workspace_invites set revoked_at = coalesce(revoked_at, now()), role = 'accountant', custom_role_id = null
   where custom_role_id = role_id;
  delete from public.workspace_roles where id = role_id;
end;
$$;

-- --------------------------------------------------------------- invitar, aceptar, ver y cambiar con roles a medida
drop function public.create_workspace_invite(uuid, text);
-- Igual que en la 0.16.0, más: el Dueño puede invitar con uno de sus roles a medida (custom_role).
create function public.create_workspace_invite(ws uuid, invite_role text, custom_role uuid default null)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- sin 0/O, 1/I/L
  raw bytea;
  plain text := '';
  k text;
  i int;
  my_role text;
  ws_kind text;
  ws_deleted timestamptz;
  expires timestamptz := now() + interval '7 days';
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  select m.role into my_role from public.workspace_members m where m.workspace_id = ws and m.user_id = uid;
  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'Solo el dueño o un administrador del espacio puede invitar.' using errcode = '42501';
  end if;
  if invite_role not in ('admin', 'accountant', 'custom') then
    raise exception 'Rol no válido.' using errcode = '22023';
  end if;
  if invite_role = 'admin' and my_role <> 'owner' then
    raise exception 'Solo el dueño puede invitar administradores.' using errcode = '42501';
  end if;
  if invite_role = 'custom' then
    if my_role <> 'owner' then raise exception 'Solo el dueño puede invitar con un rol a medida.' using errcode = '42501'; end if;
    if custom_role is null or not exists (select 1 from public.workspace_roles r where r.id = custom_role and r.workspace_id = ws) then
      raise exception 'Ese rol no existe en este espacio.' using errcode = 'P0001';
    end if;
  elsif custom_role is not null then
    raise exception 'Rol no válido.' using errcode = '22023';
  end if;
  select w.kind, w.deleted_at into ws_kind, ws_deleted from public.workspaces w where w.id = ws;
  if ws_kind = 'personal' then raise exception 'El espacio Personal no se comparte.' using errcode = 'P0001'; end if;
  if ws_deleted is not null then raise exception 'Ese espacio está borrado.' using errcode = 'P0001'; end if;
  if (select count(*) from public.workspace_invites x
      where x.workspace_id = ws and x.used_at is null and x.revoked_at is null and x.expires_at > now()) >= 20 then
    raise exception 'Hay demasiadas invitaciones pendientes en este espacio. Anula alguna.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.workspace_members m where m.workspace_id = ws) >= 50 then
    raise exception 'El espacio ya tiene el máximo de 50 miembros.' using errcode = 'P0001';
  end if;
  raw := extensions.gen_random_bytes(12);
  for i in 0..11 loop
    plain := plain || substr(alphabet, (get_byte(raw, i) % length(alphabet)) + 1, 1);
  end loop;
  k := private.invite_hash(plain);
  insert into public.workspace_invites (workspace_id, code_hash, role, custom_role_id, created_by, expires_at)
  values (ws, k, invite_role, custom_role, uid, expires);
  code := substr(plain, 1, 4) || '-' || substr(plain, 5, 4) || '-' || substr(plain, 9, 4);
  expires_at := expires;
  return next;
end;
$$;

drop function public.accept_workspace_invite(text);
create function public.accept_workspace_invite(invite_code text)
returns table (workspace_id uuid, workspace_name text, role text, custom_role_id uuid, custom_role_name text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  inv public.workspace_invites%rowtype;
  ws_name text;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  select * into inv from public.workspace_invites x
  where x.code_hash = private.invite_hash(private.invite_normalize(invite_code))
  for update;
  if not found or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'El código no es válido o ya venció. Pide uno nuevo.' using errcode = 'P0001';
  end if;
  select w.name into ws_name from public.workspaces w where w.id = inv.workspace_id and w.deleted_at is null;
  if ws_name is null then
    raise exception 'El código no es válido o ya venció. Pide uno nuevo.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workspace_members m where m.workspace_id = inv.workspace_id and m.user_id = uid) then
    raise exception 'Ya perteneces a ese espacio.' using errcode = 'P0001';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, custom_role_id, is_default)
  values (inv.workspace_id, uid, inv.role, inv.custom_role_id, false);
  update public.workspace_invites set used_by = uid, used_at = now() where id = inv.id;
  workspace_id := inv.workspace_id;
  workspace_name := ws_name;
  role := inv.role;
  custom_role_id := inv.custom_role_id;
  custom_role_name := (select r.name from public.workspace_roles r where r.id = inv.custom_role_id);
  return next;
end;
$$;

drop function public.list_workspace_members(uuid);
create function public.list_workspace_members(ws uuid)
returns table (user_id uuid, role text, custom_role_id uuid, custom_role_name text, display_name text, email text, is_me boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  manager boolean;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid) then
    raise exception 'No perteneces a ese espacio.' using errcode = '42501';
  end if;
  manager := exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid and m.role in ('owner', 'admin'));
  return query
    select m.user_id, m.role, m.custom_role_id, r.name, coalesce(p.display_name, ''),
           case when manager or m.user_id = uid then u.email::text else null end,
           m.user_id = uid, m.created_at
    from public.workspace_members m
    left join public.workspace_roles r on r.id = m.custom_role_id
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.workspace_id = ws
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'custom' then 2 else 3 end, m.created_at;
end;
$$;

drop function public.set_workspace_member_role(uuid, uuid, text);
-- Cambia el rol de un miembro (solo el Dueño; Administrador, Contador o un rol a medida del espacio; no su propio rol).
create function public.set_workspace_member_role(ws uuid, member uuid, new_role text, custom_role uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid and m.role = 'owner') then
    raise exception 'Solo el dueño puede cambiar roles.' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'accountant', 'custom') then raise exception 'Rol no válido.' using errcode = '22023'; end if;
  if new_role = 'custom' and (custom_role is null or not exists (select 1 from public.workspace_roles r where r.id = custom_role and r.workspace_id = ws)) then
    raise exception 'Ese rol no existe en este espacio.' using errcode = 'P0001';
  end if;
  if new_role <> 'custom' and custom_role is not null then raise exception 'Rol no válido.' using errcode = '22023'; end if;
  if member = uid then raise exception 'No puedes cambiar tu propio rol.' using errcode = 'P0001'; end if;
  update public.workspace_members set role = new_role, custom_role_id = case when new_role = 'custom' then custom_role end
   where workspace_id = ws and user_id = member and role <> 'owner';
  if not found then raise exception 'Esa persona no es miembro del espacio.' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.create_workspace_role(uuid, text, jsonb), public.update_workspace_role(uuid, text, jsonb),
  public.delete_workspace_role(uuid), public.create_workspace_invite(uuid, text, uuid), public.accept_workspace_invite(text),
  public.list_workspace_members(uuid), public.set_workspace_member_role(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.create_workspace_role(uuid, text, jsonb), public.update_workspace_role(uuid, text, jsonb),
  public.delete_workspace_role(uuid), public.create_workspace_invite(uuid, text, uuid), public.accept_workspace_invite(text),
  public.list_workspace_members(uuid), public.set_workspace_member_role(uuid, uuid, text, uuid) to authenticated;
