-- =============================================================================
-- Deshacer 0.18.4 («Sobre ti»): borra la tabla de respuestas de bienvenida.
-- OJO: borra las respuestas que hayan dado las personas (sexo, rango de edad, nacionalidad). No toca nada más.
-- =============================================================================

drop table if exists public.user_about;
