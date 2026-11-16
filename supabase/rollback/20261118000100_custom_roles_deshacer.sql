-- =============================================================================
-- DESHACER la migración 20261118000100_custom_roles (solo si hiciera falta).
-- Vuelve a dejar la base como en la 0.16.0. Cómo: Supabase → SQL Editor → pegar este archivo → Run.
-- · Quien tenga un rol a medida pasa a CONTADOR (solo lectura: lo más seguro); las invitaciones pendientes con un rol
--   a medida se anulan. Se borran los roles a medida y la columna «quién lo creó» (created_by) de las 15 tablas.
-- · No borra ningún dato financiero.
-- =============================================================================

update public.workspace_members set role = 'accountant', custom_role_id = null where role = 'custom';
update public.workspace_invites set role = 'accountant', custom_role_id = null, revoked_at = coalesce(revoked_at, now()) where role = 'custom';

-- Reglas de las 15 tablas como en 20261111000300_security.sql.
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'departments', 'clients', 'services', 'movements', 'goals', 'contributions', 'debts',
    'debt_payments', 'assets', 'products', 'suppliers', 'invoices', 'stock_entries', 'invoice_payments'
  ] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format('drop policy %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(workspace_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.can_write(workspace_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.can_write(workspace_id)) with check (private.can_write(workspace_id))', t || '_update', t);
    execute format('alter table public.%I drop column created_by', t);
  end loop;
end $$;

-- Protección de registros como en 20261116000100_no_revive.sql.
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
  end if;
  new.synced_at := now();
  return new;
end;
$$;

drop function public.create_workspace_role(uuid, text, jsonb);
drop function public.update_workspace_role(uuid, text, jsonb);
drop function public.delete_workspace_role(uuid);
drop function public.create_workspace_invite(uuid, text, uuid);
drop function public.accept_workspace_invite(text);
drop function public.list_workspace_members(uuid);
drop function public.set_workspace_member_role(uuid, uuid, text, uuid);
drop function private.module_level(uuid, text);
drop function private.clean_role_name(uuid, text, uuid);

alter table public.workspace_members drop constraint workspace_members_custom_check, drop constraint workspace_members_role_check;
alter table public.workspace_members drop column custom_role_id;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'accountant', 'manager', 'cashier', 'employee'));
alter table public.workspace_invites drop constraint workspace_invites_custom_check, drop constraint workspace_invites_role_check;
alter table public.workspace_invites drop column custom_role_id;
alter table public.workspace_invites add constraint workspace_invites_role_check check (role in ('admin', 'accountant'));
drop table public.workspace_roles;
drop function private.valid_permissions(jsonb);
drop function private.level_rank(text);

-- Las funciones de la 0.16.0, copiadas tal cual de 20261117000100_invites.sql.
create function public.create_workspace_invite(ws uuid, invite_role text)
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
  if invite_role not in ('admin', 'accountant') then
    raise exception 'Rol no válido.' using errcode = '22023';
  end if;
  if invite_role = 'admin' and my_role <> 'owner' then
    raise exception 'Solo el dueño puede invitar administradores.' using errcode = '42501';
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
  insert into public.workspace_invites (workspace_id, code_hash, role, created_by, expires_at)
  values (ws, k, invite_role, uid, expires);
  code := substr(plain, 1, 4) || '-' || substr(plain, 5, 4) || '-' || substr(plain, 9, 4);
  expires_at := expires;
  return next;
end;
$$;

create function public.accept_workspace_invite(invite_code text)
returns table (workspace_id uuid, workspace_name text, role text)
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
  insert into public.workspace_members (workspace_id, user_id, role, is_default)
  values (inv.workspace_id, uid, inv.role, false);
  update public.workspace_invites set used_by = uid, used_at = now() where id = inv.id;
  workspace_id := inv.workspace_id;
  workspace_name := ws_name;
  role := inv.role;
  return next;
end;
$$;

create function public.list_workspace_members(ws uuid)
returns table (user_id uuid, role text, display_name text, email text, is_me boolean, joined_at timestamptz)
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
    select m.user_id, m.role, coalesce(p.display_name, ''),
           case when manager or m.user_id = uid then u.email::text else null end,
           m.user_id = uid, m.created_at
    from public.workspace_members m
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.workspace_id = ws
    order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
end;
$$;

create function public.set_workspace_member_role(ws uuid, member uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid and m.role = 'owner') then
    raise exception 'Solo el dueño puede cambiar roles.' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'accountant') then raise exception 'Rol no válido.' using errcode = '22023'; end if;
  if member = uid then raise exception 'No puedes cambiar tu propio rol.' using errcode = 'P0001'; end if;
  update public.workspace_members set role = new_role where workspace_id = ws and user_id = member and role <> 'owner';
  if not found then raise exception 'Esa persona no es miembro del espacio.' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.create_workspace_invite(uuid, text), public.accept_workspace_invite(text),
  public.list_workspace_members(uuid), public.set_workspace_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.create_workspace_invite(uuid, text), public.accept_workspace_invite(text),
  public.list_workspace_members(uuid), public.set_workspace_member_role(uuid, uuid, text) to authenticated;
