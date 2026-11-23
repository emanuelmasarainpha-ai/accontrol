-- =============================================================================
-- ACCONTROL · 0.20.2 · «Continuar con Google» solo para quien ya tiene cuenta
-- -----------------------------------------------------------------------------
-- Pedido de la persona (como hace GitHub): una cuenta NUEVA se crea con correo y contraseña; después se puede entrar
-- con Google. Así nadie aparece con cuenta en ACCONTROL solo por haber tocado «Continuar con Google».
--
-- Qué hace: crea la función `public.hook_google_solo_cuentas`, para el gancho de Supabase «Before User Created»
-- (se llama justo antes de crear una cuenta). Si la cuenta nueva viene de Google (o de otro proveedor que no sea el
-- correo), la rechaza con el mensaje `sin_cuenta_google`, que la app reconoce y explica.
--
-- Qué NO cambia:
--   · Crear cuenta con correo y contraseña sigue igual.
--   · Quien YA tiene cuenta (creada con correo o con Google) sigue entrando con Google: si el correo coincide, Supabase
--     une Google a esa cuenta y no crea ninguna nueva (por eso este gancho no se llama).
--   · No toca ningún dato.
--
-- ⚠ La función sola no hace nada: hay que ENCENDER el gancho en el panel de Supabase
--   (Authentication → Hooks → «Before User Created» → Postgres → public.hook_google_solo_cuentas).
--
-- Para deshacer: apagar el gancho en el panel y ejecutar
--   supabase/rollback/20261126000100_google_solo_cuentas_deshacer.sql
-- =============================================================================

create or replace function public.hook_google_solo_cuentas(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  provider text := coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', 'email');
begin
  if provider <> 'email' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'sin_cuenta_google: esta cuenta de Google todavía no tiene cuenta en ACCONTROL. Primero crea tu cuenta con tu correo y una contraseña.'
    ));
  end if;
  return '{}'::jsonb;
end;
$$;

comment on function public.hook_google_solo_cuentas(jsonb) is
  'Gancho «Before User Created»: las cuentas nuevas solo con correo y contraseña; Google, solo para quien ya tiene cuenta.';

-- Solo el servidor de cuentas puede llamarla (nadie desde la app ni desde la API).
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_google_solo_cuentas(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_google_solo_cuentas(jsonb) from authenticated, anon, public;
