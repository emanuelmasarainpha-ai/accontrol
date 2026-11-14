-- =============================================================================
-- ACCONTROL 0.16.0 — Compartir un espacio: invitaciones y miembros (roles Dueño, Administrador, Contador)
-- -----------------------------------------------------------------------------
-- · Se invita con un CÓDIGO que la persona dueña copia y envía (XXXX-XXXX-XXXX, 7 días, un solo uso).
--   En la base se guarda SOLO la huella SHA-256 del código, nunca el código.
-- · Roles en uso: owner (Dueño), admin (Administrador), accountant (Contador, solo lectura).
--   Las reglas de lectura/escritura de los datos ya existen (is_member / can_write): el Contador solo lee.
-- · El espacio Personal no se comparte.
-- · Nadie escribe directamente en workspace_invites ni en workspace_members: todo pasa por las funciones
--   de abajo, que comprueban quién llama y qué rol tiene.
-- · Eliminar la cuenta se niega si la persona es dueña de un espacio con otros miembros.
-- No modifica filas existentes.
-- =============================================================================

-- ¿Puede administrar miembros e invitaciones? (Dueño o Administrador)
create function private.can_manage(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;
revoke all on function private.can_manage(uuid) from public, anon;
grant execute on function private.can_manage(uuid) to authenticated;

-- ------------------------------------------------------------- invitaciones
create table public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  code_hash    text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  role         text not null check (role in ('admin', 'accountant')),
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz,
  revoked_at   timestamptz
);
comment on table public.workspace_invites is 'Invitaciones a un espacio. Solo la huella del código (SHA-256), nunca el código.';
create index workspace_invites_ws_idx on public.workspace_invites (workspace_id);
create index workspace_invites_created_by_idx on public.workspace_invites (created_by);
create index workspace_invites_used_by_idx on public.workspace_invites (used_by) where used_by is not null;

alter table public.workspace_invites enable row level security;
-- Ver: Dueño y Administrador del espacio (sin la huella del código). Escribir: solo por las funciones.
grant select (id, workspace_id, role, created_by, created_at, expires_at, used_by, used_at, revoked_at)
  on public.workspace_invites to authenticated;
create policy workspace_invites_select on public.workspace_invites for select to authenticated
  using (private.can_manage(workspace_id));

-- Huella de un código ya normalizado.
create function private.invite_hash(code text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(code, 'sha256'), 'hex');
$$;
revoke all on function private.invite_hash(text) from public, anon, authenticated;

-- Normaliza lo que escribe la persona: mayúsculas, sin guiones ni espacios.
create function private.invite_normalize(code text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;
revoke all on function private.invite_normalize(text) from public, anon, authenticated;

-- ----------------------------------------------------- funciones (RPC) públicas

-- Crea una invitación y devuelve el código UNA sola vez. Dueño: invita Administradores y Contadores.
-- Administrador: solo Contadores. No en espacios Personal ni borrados.
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

-- Acepta un código: la persona que llama pasa a ser miembro con el rol de la invitación.
-- Mensaje único para código inexistente, vencido, usado o anulado (no da pistas a quien adivina).
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

-- Anula una invitación pendiente (Dueño o Administrador; un Administrador solo las de Contador).
create function public.revoke_workspace_invite(invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  inv public.workspace_invites%rowtype;
  my_role text;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  select * into inv from public.workspace_invites x where x.id = invite;
  if not found then raise exception 'Esa invitación no existe.' using errcode = 'P0001'; end if;
  select m.role into my_role from public.workspace_members m where m.workspace_id = inv.workspace_id and m.user_id = uid;
  if my_role is null or my_role not in ('owner', 'admin') or (my_role = 'admin' and inv.role <> 'accountant') then
    raise exception 'No puedes anular esa invitación.' using errcode = '42501';
  end if;
  update public.workspace_invites set revoked_at = now() where id = invite and used_at is null and revoked_at is null;
end;
$$;

-- Miembros de un espacio (cualquier miembro puede verlos). El correo solo lo ven Dueño y Administrador.
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

-- Cambia el rol de un miembro (solo el Dueño; entre Administrador y Contador; no su propio rol).
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

-- Quita a un miembro. Dueño: a cualquiera menos a sí mismo. Administrador: solo a Contadores.
create function public.remove_workspace_member(ws uuid, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  my_role text;
  their_role text;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  select m.role into my_role from public.workspace_members m where m.workspace_id = ws and m.user_id = uid;
  select m.role into their_role from public.workspace_members m where m.workspace_id = ws and m.user_id = member;
  if their_role is null then raise exception 'Esa persona no es miembro del espacio.' using errcode = 'P0001'; end if;
  if member = uid then raise exception 'Para irte del espacio usa «Salir del espacio».' using errcode = 'P0001'; end if;
  if their_role = 'owner' or my_role is null
     or not (my_role = 'owner' or (my_role = 'admin' and their_role = 'accountant')) then
    raise exception 'No puedes quitar a esa persona.' using errcode = '42501';
  end if;
  delete from public.workspace_members where workspace_id = ws and user_id = member;
  update public.profiles set last_workspace_id = null where user_id = member and last_workspace_id = ws;
end;
$$;

-- Salir de un espacio compartido (cualquiera menos el Dueño).
create function public.leave_workspace(ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  my_role text;
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  select m.role into my_role from public.workspace_members m where m.workspace_id = ws and m.user_id = uid;
  if my_role is null then raise exception 'No perteneces a ese espacio.' using errcode = 'P0001'; end if;
  if my_role = 'owner' then raise exception 'El dueño no puede salir de su propio espacio.' using errcode = 'P0001'; end if;
  delete from public.workspace_members where workspace_id = ws and user_id = uid;
  update public.profiles set last_workspace_id = null where user_id = uid and last_workspace_id = ws;
end;
$$;

-- Eliminar la cuenta: se niega si eres dueño de un espacio (no borrado) que tiene otros miembros,
-- para no borrarles sus datos. (Antes, borraba en cascada los espacios creados por la persona.)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  if exists (
    select 1 from public.workspace_members mine
    join public.workspaces w on w.id = mine.workspace_id and w.deleted_at is null
    where mine.user_id = uid and mine.role = 'owner'
      and exists (select 1 from public.workspace_members other where other.workspace_id = mine.workspace_id and other.user_id <> uid)
  ) then
    raise exception 'Eres dueño de un espacio que tiene otros miembros. Quítalos (o borra ese espacio) antes de eliminar tu cuenta.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid;          -- cascada: perfil, espacios creados, membresías y datos
end;
$$;

revoke all on function public.create_workspace_invite(uuid, text), public.accept_workspace_invite(text),
  public.revoke_workspace_invite(uuid), public.list_workspace_members(uuid),
  public.set_workspace_member_role(uuid, uuid, text), public.remove_workspace_member(uuid, uuid),
  public.leave_workspace(uuid) from public, anon;
grant execute on function public.create_workspace_invite(uuid, text), public.accept_workspace_invite(text),
  public.revoke_workspace_invite(uuid), public.list_workspace_members(uuid),
  public.set_workspace_member_role(uuid, uuid, text), public.remove_workspace_member(uuid, uuid),
  public.leave_workspace(uuid) to authenticated;
