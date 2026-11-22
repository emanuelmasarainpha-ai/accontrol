-- =============================================================================
-- Deshacer 0.20.0 (planes de cada cuenta).
-- OJO: borra la tabla de planes (quién tiene Premium o Negocio). No toca espacios ni datos financieros.
-- Deja la regla de los espacios como estaba en la 0.15.1 (sin la regla del plan).
-- =============================================================================

create or replace function private.workspace_guard() returns trigger
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
    -- No revivir con una versión anterior (o igual) al borrado.
    if old.deleted_at is not null and new.deleted_at is null and new.updated_at <= old.deleted_at then
      new.deleted_at := old.deleted_at;
    end if;
  end if;
  new.synced_at := now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_plan on auth.users;
drop function if exists private.grant_beta_plan();
drop function if exists private.plan_of(uuid);
drop table if exists private.billing_settings;
drop table if exists public.account_plans;
