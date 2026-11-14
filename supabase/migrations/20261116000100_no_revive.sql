-- =============================================================================
-- ACCONTROL 0.15.1 — Lo borrado no revive con una versión más vieja que su borrado
-- -----------------------------------------------------------------------------
-- La sincronización sigue la regla «gana el cambio más reciente». Hasta ahora el servidor aceptaba que un
-- dispositivo «reviviera» un registro marcado como borrado (deleted_at) con una versión ANTERIOR al borrado: pasaba
-- si ese dispositivo editaba el registro en los mismos 1–2 segundos en que otro lo borraba.
--
-- Desde esta migración, al ACTUALIZAR una fila que está marcada como borrada:
--   · si la versión que llega tiene updated_at <= deleted_at, la fila SIGUE borrada (se conserva deleted_at);
--   · si la versión es posterior al borrado, revive (como antes).
-- La fila igual cambia su synced_at, así el dispositivo que la envió se entera en la siguiente revisión y converge.
--
-- Las categorías quedan fuera: la app no les pone fecha de modificación (updated_at), así que no hay con qué comparar.
-- La app (0.15.1) marca con la hora actual lo que se conserva al «juntar» y lo que se restaura de una copia.
--
-- No modifica ninguna fila existente: solo cambia las dos funciones de los triggers que ya existen.
-- Para deshacerla: volver a crear las dos funciones como estaban en 20261111000100_tenancy.sql.
-- =============================================================================

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
