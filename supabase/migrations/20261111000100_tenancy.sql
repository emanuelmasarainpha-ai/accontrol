-- =============================================================================
-- ACCONTROL · Etapa 2 · Migración 1 de 4: usuarios, espacios de trabajo y pertenencia
-- -----------------------------------------------------------------------------
-- Modelo: una persona (auth.users) tiene un perfil y puede pertenecer a varios ESPACIOS DE TRABAJO
-- (Personal, Freelancer, Emprendedor, Empresa). Todo dato financiero cuelga de un espacio y solo lo ven
-- los miembros de ese espacio. La seguridad la hace la base de datos (RLS), no la pantalla.
--
-- Convenciones de todo el esquema:
--   · Montos en CENTAVOS (bigint), igual que la app. Fechas `date`, horas texto "HH:mm".
--   · Los ids los genera el dispositivo (UUID v4), así funcionan sin internet.
--   · `synced_at` lo pone SIEMPRE el servidor (trigger): es el cursor para sincronizar.
--   · Nada se borra con DELETE desde la app: se marca `deleted_at` (para que los otros dispositivos
--     se enteren). El borrado real lo hacen funciones con permisos explícitos (ver migración 3).
--   · Las funciones auxiliares viven en el esquema `private`, que la API NO expone.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;   -- las políticas RLS llaman a private.is_member(...)

-- Lo que se cree después en `public` NO se da a anon/authenticated por defecto: cada permiso es explícito.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- ------------------------------------------------------------------ perfiles
create table public.profiles (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  display_name      text not null default '' check (char_length(display_name) <= 40),
  last_workspace_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.profiles is 'Datos de la persona (no de un espacio): nombre para el saludo y último espacio usado.';

-- Al crearse una cuenta en Supabase Auth se crea su perfil automáticamente.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 40))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Perfiles de cuentas que ya existieran antes de esta migración.
insert into public.profiles (user_id) select id from auth.users on conflict (user_id) do nothing;

-- ---------------------------------------------------------- espacios de trabajo
create table public.workspaces (
  id                    uuid primary key,
  kind                  text not null check (kind in ('personal', 'freelancer', 'entrepreneur', 'company')),
  name                  text not null check (char_length(btrim(name)) between 1 and 40),
  currency              text not null default 'DOP' check (currency in ('DOP')),
  opening_balance_cents bigint not null default 0 check (opening_balance_cents between 0 and 99999999999),
  organization          jsonb check (organization is null
                                     or (jsonb_typeof(organization) = 'object' and pg_column_size(organization) <= 2000)),
  created_by            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  synced_at             timestamptz not null default now(),
  deleted_at            timestamptz
);
comment on table public.workspaces is 'Un conjunto de datos aislado (Mi espacio personal, Mi emprendimiento, Empresa ABC…).';
create index workspaces_created_by_idx on public.workspaces (created_by);

alter table public.profiles
  add constraint profiles_last_workspace_fk foreign key (last_workspace_id)
  references public.workspaces (id) on delete set null;
create index profiles_last_workspace_idx on public.profiles (last_workspace_id) where last_workspace_id is not null;

-- Quién pertenece a cada espacio y con qué rol. Hoy solo se crean filas 'owner' (al crear el espacio);
-- los demás roles existen en el esquema pero NO se usan hasta la etapa de roles e invitaciones.
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'admin', 'accountant', 'manager', 'cashier', 'employee')),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
comment on table public.workspace_members is 'Pertenencia a espacios. is_default = el espacio que se abre primero para esa persona.';
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ------------------------------------------------------------ funciones de permisos
-- SECURITY DEFINER: leen workspace_members sin pasar por su propia RLS (evita recursión infinita).
create function private.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

-- Quién puede ESCRIBIR datos del espacio. Hoy: dueño y administrador. Los demás roles quedan de solo
-- lectura hasta que la etapa de roles defina qué puede hacer cada uno.
create function private.can_write(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_member(uuid), private.can_write(uuid) from public, anon;
grant execute on function private.is_member(uuid), private.can_write(uuid) to authenticated;

-- ------------------------------------------------------------------- triggers
-- Marca de sincronización puesta por el servidor y llaves que no se pueden cambiar.
create function private.entity_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) ->> 'id' is distinct from to_jsonb(old) ->> 'id'
       or to_jsonb(new) ->> 'workspace_id' is distinct from to_jsonb(old) ->> 'workspace_id' then
      raise exception 'No se puede cambiar el id ni el espacio de un registro.' using errcode = 'P0001';
    end if;
  end if;
  new.synced_at := now();
  return new;
end;
$$;

create function private.workspace_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.workspaces w where w.created_by = new.created_by and w.deleted_at is null) >= 20 then
      raise exception 'Máximo 20 espacios de trabajo por cuenta.' using errcode = 'P0001';
    end if;
  else
    if new.id <> old.id or new.created_by <> old.created_by or new.kind <> old.kind then
      raise exception 'No se puede cambiar el id, el creador ni el tipo de un espacio.' using errcode = 'P0001';
    end if;
  end if;
  new.synced_at := now();
  return new;
end;
$$;
create trigger workspaces_guard before insert or update on public.workspaces
  for each row execute function private.workspace_guard();

-- Quien crea un espacio queda como su dueño; el primero que crea es su espacio predeterminado.
create function private.add_owner_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role, is_default)
  values (
    new.id, new.created_by, 'owner',
    not exists (select 1 from public.workspace_members m where m.user_id = new.created_by)
  );
  return new;
end;
$$;
create trigger workspaces_add_owner after insert on public.workspaces
  for each row execute function private.add_owner_membership();
