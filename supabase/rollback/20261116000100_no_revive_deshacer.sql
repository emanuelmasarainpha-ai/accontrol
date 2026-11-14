-- =============================================================================
-- DESHACER la migración 20261116000100_no_revive (solo si hiciera falta).
-- Vuelve a dejar las dos funciones exactamente como en 20261111000100_tenancy.sql. No toca ninguna fila.
-- Cómo: Supabase → SQL Editor → pegar este archivo → Run.
-- =============================================================================

create or replace function private.entity_guard() returns trigger
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
  end if;
  new.synced_at := now();
  return new;
end;
$$;
