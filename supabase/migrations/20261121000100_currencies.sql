-- =============================================================================
-- ACCONTROL · 0.18.3 · Moneda real, una por cuenta
-- -----------------------------------------------------------------------------
-- Hasta ahora «workspaces.currency» solo aceptaba 'DOP' (peso dominicano). Esta migración solo AMPLÍA la lista de
-- monedas permitidas (la misma que src/domain/currencies.js). NO cambia ni borra datos: todos los espacios que ya
-- existen siguen en 'DOP'. Los montos se siguen guardando en centavos enteros, por eso solo hay monedas con centavos.
-- Las políticas de seguridad por fila (RLS) de «workspaces» no cambian: solo el dueño cambia su espacio.
-- Para deshacerla: supabase/rollback/20261121000100_currencies_deshacer.sql
-- =============================================================================

alter table public.workspaces drop constraint workspaces_currency_check;

alter table public.workspaces add constraint workspaces_currency_check
  check (currency in ('DOP', 'USD', 'EUR', 'MXN', 'COP', 'PEN', 'ARS', 'GTQ', 'HNL', 'NIO', 'CRC', 'PAB', 'BOB', 'UYU', 'BRL', 'HTG', 'CAD', 'GBP'));
