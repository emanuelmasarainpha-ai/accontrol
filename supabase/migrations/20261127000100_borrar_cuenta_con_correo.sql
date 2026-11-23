-- =============================================================================
-- ACCONTROL · 0.20.3 · Eliminar la cuenta pide confirmar por correo
-- -----------------------------------------------------------------------------
-- Pedido de la persona: para borrar la cuenta no basta con escribir «ELIMINAR»; hay que confirmar con un correo que
-- manda ACCONTROL. Así, quien tenga el teléfono desbloqueado o una sesión robada NO puede borrar la cuenta sin
-- tener también el correo.
--
-- Cómo: la app pide a Supabase un código de 6 dígitos al correo de la cuenta y, al escribirlo, Supabase abre una
-- sesión nueva que queda marcada en el token con el método «otp» y la hora (claim `amr`). Esta función solo borra si
-- el token de quien la llama tiene una confirmación «otp» (o «magiclink») de hace 15 minutos o menos.
--
-- Qué cambia: SOLO `public.delete_my_account()` (añade esa comprobación al principio). El resto de la función queda
-- igual que en la 0.16.0 (dueño de un espacio con otros miembros no puede borrar; borra en cascada).
-- No toca ningún dato.
--
-- Para deshacer: supabase/rollback/20261127000100_borrar_cuenta_con_correo_deshacer.sql
-- =============================================================================

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Necesitas iniciar sesión.' using errcode = '42501'; end if;
  -- 0.20.3: confirmación por correo de hace 15 minutos o menos.
  if not exists (
    select 1
    from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) as a(item)
    where a.item ->> 'method' in ('otp', 'magiclink')
      and (a.item ->> 'timestamp') ~ '^[0-9]+$'
      and (a.item ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 900
  ) then
    raise exception 'confirmar_por_correo: para eliminar tu cuenta, confirma primero con el código que te enviamos al correo.' using errcode = 'P0001';
  end if;
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
