-- =============================================================================
-- Deshacer 0.20.2 («Continuar con Google» solo para quien ya tiene cuenta).
-- PRIMERO apaga el gancho en el panel (Authentication → Hooks → «Before User Created»): si sigue encendido y la
-- función no existe, NADIE podría crear cuenta.
-- No toca ningún dato.
-- =============================================================================

drop function if exists public.hook_google_solo_cuentas(jsonb);
