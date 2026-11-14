-- =============================================================================
-- ACCONTROL · Etapa 2 · Migración 3 de 4: seguridad (RLS, permisos y funciones de borrado)
-- -----------------------------------------------------------------------------
-- Principios:
--   1. RLS activo en TODAS las tablas. Sin política = sin acceso.
--   2. El rol `anon` (visitante sin sesión) no puede tocar nada.
--   3. El rol `authenticated` solo lee/escribe filas de espacios donde es miembro; escribe solo si su rol
--      lo permite (hoy: dueño y administrador).
--   4. NADIE puede hacer DELETE directo: los datos se marcan con deleted_at. El borrado definitivo pasa
--      por funciones que verifican quién eres y qué puedes borrar.
--   5. Las políticas usan (select auth.uid()) para que Postgres lo evalúe una sola vez por consulta.
-- =============================================================================

-- Punto de partida limpio: se quita todo y se otorga solo lo necesario.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.can_write(uuid) to authenticated;

-- Dueño del espacio (para acciones que solo él puede hacer, como borrarlo).
create function private.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
revoke all on function private.is_owner(uuid) from public, anon;
grant execute on function private.is_owner(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS: activar
alter table public.profiles           enable row level security;
alter table public.workspaces         enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.builtin_categories enable row level security;
alter table public.categories         enable row level security;
alter table public.departments        enable row level security;
alter table public.clients            enable row level security;
alter table public.services           enable row level security;
alter table public.movements          enable row level security;
alter table public.goals              enable row level security;
alter table public.contributions      enable row level security;
alter table public.debts              enable row level security;
alter table public.debt_payments      enable row level security;
alter table public.assets             enable row level security;
alter table public.products           enable row level security;
alter table public.suppliers          enable row level security;
alter table public.invoices           enable row level security;
alter table public.stock_entries      enable row level security;
alter table public.invoice_payments   enable row level security;

-- ------------------------------------------------------------------ perfiles
-- Cada persona ve y edita SOLO su propio perfil. El perfil se crea solo (trigger de auth.users).
grant select, insert (user_id, display_name, last_workspace_id), update (display_name, last_workspace_id)
  on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid())
              and (last_workspace_id is null or private.is_member(last_workspace_id)));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and (last_workspace_id is null or private.is_member(last_workspace_id)));

create function private.touch_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_profile();

-- ---------------------------------------------------------------- espacios
-- Ver: los miembros (y quien lo creó, para que "insertar y leer" funcione antes de que exista su membresía).
-- Crear: cualquiera con sesión, siempre como suyo. Editar: solo el dueño. Borrar: no hay DELETE directo.
grant select, insert, update on public.workspaces to authenticated;

create policy workspaces_select on public.workspaces for select to authenticated
  using (created_by = (select auth.uid()) or private.is_member(id));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy workspaces_update on public.workspaces for update to authenticated
  using (private.is_owner(id))
  with check (private.is_owner(id));

-- -------------------------------------------------------------- membresías
-- Solo lectura de las propias; se crean con el espacio y cambian con las funciones de abajo (y, en la
-- etapa de roles, con la función de invitaciones).
grant select on public.workspace_members to authenticated;
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

-- Cada persona tiene como máximo UN espacio predeterminado.
create unique index workspace_members_one_default_uidx on public.workspace_members (user_id) where is_default;

-- ------------------------------------------------------- categorías del sistema
grant select on public.builtin_categories to authenticated;
create policy builtin_categories_select on public.builtin_categories for select to authenticated using (true);

-- ------------------------------------------------- tablas de datos del espacio
-- select = miembros; insert/update = quienes pueden escribir. Sin DELETE.
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'departments', 'clients', 'services', 'movements', 'goals', 'contributions', 'debts',
    'debt_payments', 'assets', 'products', 'suppliers', 'invoices', 'stock_entries', 'invoice_payments'
  ] loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_member(workspace_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.can_write(workspace_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.can_write(workspace_id)) with check (private.can_write(workspace_id))',
      t || '_update', t);
  end loop;
end $$;

-- ----------------------------------------------------- funciones (RPC) públicas
-- Se llaman desde la app con supabase.rpc / POST /rest/v1/rpc/<nombre>. Todas exigen sesión.

-- Cambia el espacio que se abre primero. Solo entre espacios donde la persona es miembro.
create function public.set_default_workspace(ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid) then
    raise exception 'No perteneces a ese espacio.' using errcode = '42501';
  end if;
  update public.workspace_members set is_default = false where user_id = uid and is_default;
  update public.workspace_members set is_default = true  where user_id = uid and workspace_id = ws;
end;
$$;

-- Borra DEFINITIVAMENTE un espacio y todo lo que contiene. Solo su dueño.
create function public.delete_workspace_permanently(ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = uid and m.role = 'owner') then
    raise exception 'Solo el dueño del espacio puede borrarlo.' using errcode = '42501';
  end if;
  delete from public.workspaces where id = ws;   -- arrastra en cascada todos sus datos y membresías
  -- Si era el predeterminado, el espacio más antiguo que quede pasa a serlo.
  if not exists (select 1 from public.workspace_members m where m.user_id = uid and m.is_default) then
    update public.workspace_members set is_default = true
    where (workspace_id, user_id) = (
      select m.workspace_id, m.user_id from public.workspace_members m
      where m.user_id = uid order by m.created_at, m.workspace_id limit 1);
  end if;
end;
$$;

-- Borra la cuenta de quien la llama y todos sus datos. Es irreversible.
-- OJO (etapa de roles): cuando existan espacios compartidos, habrá que traspasar o conservar los espacios
-- con otros miembros en lugar de borrarlos con el creador.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  delete from auth.users where id = uid;          -- cascada: perfil, espacios creados, membresías y datos
end;
$$;

revoke all on function public.set_default_workspace(uuid), public.delete_workspace_permanently(uuid),
  public.delete_my_account() from public, anon;
grant execute on function public.set_default_workspace(uuid), public.delete_workspace_permanently(uuid),
  public.delete_my_account() to authenticated;
