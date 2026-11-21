-- =============================================================================
-- ACCONTROL · 0.18.4 · «Sobre ti»: preguntas de bienvenida (opcionales)
-- -----------------------------------------------------------------------------
-- Sexo, rango de edad y nacionalidad, para estadísticas futuras de quién usa la app. TODO es opcional:
-- null = «Prefiero no decirlo». Que exista la fila quiere decir «ya se le preguntó» (aunque haya omitido todo), así no
-- se le vuelve a preguntar en otro dispositivo.
--
-- Va en una tabla APARTE de «profiles» a propósito: los miembros de un espacio compartido pueden ver el nombre de los
-- demás, pero estos datos no los ve nadie más que su dueño (RLS: cada cuenta solo lee y cambia SU fila). Las
-- estadísticas (solo totales, nunca datos de una persona) llegarán con el panel administrativo (0.20.0) por medio de
-- una función que solo devuelva conteos.
--
-- Al eliminar la cuenta, su fila se borra sola (cascada desde auth.users). Esta migración NO toca ninguna tabla ni
-- dato que ya exista.
-- Para deshacerla: supabase/rollback/20261122000100_about_you_deshacer.sql
-- =============================================================================

create table public.user_about (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  gender       text check (gender in ('male', 'female')),
  age_range    text check (age_range in ('under_18', '18_24', '25_34', '35_44', '45_54', '55_64', '65_plus')),
  nationality  text check (nationality ~ '^[A-Z]{2}$'),
  answered_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.user_about is 'Respuestas opcionales de bienvenida (sexo, rango de edad, nacionalidad). null = prefiere no decirlo. Solo su dueño las ve.';

alter table public.user_about enable row level security;

grant select, insert, update on public.user_about to authenticated;

create policy user_about_select on public.user_about for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_about_insert on public.user_about for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_about_update on public.user_about for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
