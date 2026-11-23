-- =============================================================================
-- Deshacer 0.20.3 (eliminar la cuenta pide confirmar por correo).
-- Vuelve `public.delete_my_account()` a como estaba en la 0.16.0 (sin la confirmación por correo). No toca datos.
-- =============================================================================

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
