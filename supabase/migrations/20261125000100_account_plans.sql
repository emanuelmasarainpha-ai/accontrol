-- =============================================================================
-- ACCONTROL · 0.20.0 · Planes de cada cuenta (Gratis, Premium, Negocio)
-- -----------------------------------------------------------------------------
-- Qué hace:
--   1. Tabla `account_plans`: el plan de cada cuenta. Cada persona puede LEER solo su fila; NADIE puede escribirla
--      desde la app (no hay permisos de insert/update/delete para las cuentas). Solo la escribe el servidor: el panel
--      de Supabase, y más adelante las funciones que confirmen un pago (Google Play, la web). Así nadie se puede dar
--      un plan a sí mismo.
--      Sin fila = plan Gratis.
--   2. Prueba abierta (beta): mientras `private.billing_settings.beta_open` sea true, cada cuenta nueva recibe el plan
--      Negocio con origen 'beta' (la app todavía no salió y quienes la prueban necesitan todo abierto). Las cuentas
--      que ya existen reciben lo mismo. Al lanzar, se apaga con:
--          update private.billing_settings set beta_open = false, updated_at = now();
--      y se decide qué pasa con las filas 'beta' (por ejemplo, ponerles una fecha de fin).
--   3. Regla en la base: crear un espacio NUEVO Freelancer, Emprendedor o Empresa pide el plan Negocio. Los espacios
--      que ya existen NO se tocan (se pueden seguir actualizando y borrando aunque cambie el plan).
--
-- No borra ni cambia ningún dato que ya exista. Para deshacerla:
--   supabase/rollback/20261125000100_account_plans_deshacer.sql
-- =============================================================================

-- ------------------------------------------------------------------ el plan de cada cuenta
create table public.account_plans (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  plan        text not null check (plan in ('free', 'premium', 'business')),
  source      text not null check (source in ('beta', 'manual', 'google_play', 'web')),
  expires_at  timestamptz,
  note        text check (note is null or char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.account_plans is
  'Plan de cada cuenta. Sin fila = Gratis. expires_at null = sin fecha de fin. Solo el servidor escribe; cada cuenta lee la suya.';

alter table public.account_plans enable row level security;
grant select on public.account_plans to authenticated;
create policy account_plans_select on public.account_plans for select to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ el interruptor de la prueba abierta
create table private.billing_settings (
  id          boolean primary key default true check (id),
  beta_open   boolean not null default true,
  updated_at  timestamptz not null default now()
);
comment on table private.billing_settings is 'Una sola fila. beta_open = las cuentas nuevas reciben Negocio de prueba.';
revoke all on private.billing_settings from public, anon, authenticated;
insert into private.billing_settings default values;

-- ------------------------------------------------------------------ el plan que vale hoy
create function private.plan_of(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.plan from public.account_plans p
      where p.user_id = uid and (p.expires_at is null or p.expires_at > now())),
    'free'
  );
$$;
revoke all on function private.plan_of(uuid) from public, anon;
grant execute on function private.plan_of(uuid) to authenticated;   -- la usa la regla de los espacios

-- ------------------------------------------------------------------ prueba abierta: cuentas nuevas y las que ya existen
create function private.grant_beta_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select s.beta_open from private.billing_settings s where s.id), false) then
    insert into public.account_plans (user_id, plan, source, note)
    values (new.id, 'business', 'beta', 'Prueba abierta antes del lanzamiento')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.grant_beta_plan() from public, anon, authenticated;
create trigger on_auth_user_created_plan after insert on auth.users
  for each row execute function private.grant_beta_plan();

insert into public.account_plans (user_id, plan, source, note)
select u.id, 'business', 'beta', 'Prueba abierta antes del lanzamiento' from auth.users u
on conflict (user_id) do nothing;

-- ------------------------------------------------------------------ regla: espacios de Negocio nuevos
-- Igual que la versión de la 0.15.1 (no revivir lo borrado) más la regla del plan, solo para espacios NUEVOS.
create or replace function private.workspace_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.workspaces w where w.created_by = new.created_by and w.deleted_at is null) >= 20 then
      raise exception 'Máximo 20 espacios de trabajo por cuenta.' using errcode = 'P0001';
    end if;
    -- 0.20.0: Freelancer, Emprendedor y Empresa son del plan Negocio. «Crear o actualizar» pasa también por aquí,
    -- así que solo se mira si el espacio todavía NO existe (los que ya existen siguen funcionando igual).
    if new.kind <> 'personal' and new.deleted_at is null
       and not exists (select 1 from public.workspaces w where w.id = new.id)
       and private.plan_of(new.created_by) <> 'business' then
      raise exception 'Los espacios Freelancer, Emprendedor y Empresa son del plan Negocio.' using errcode = 'P0001';
    end if;
  else
    if new.id <> old.id or new.created_by <> old.created_by or new.kind <> old.kind then
      raise exception 'No se puede cambiar el id, el creador ni el tipo de un espacio.' using errcode = 'P0001';
    end if;
    -- No revivir con una versión anterior (o igual) al borrado.
    if old.deleted_at is not null and new.deleted_at is null and new.updated_at <= old.deleted_at then
      new.deleted_at := old.deleted_at;
    end if;
  end if;
  new.synced_at := now();
  return new;
end;
$$;
