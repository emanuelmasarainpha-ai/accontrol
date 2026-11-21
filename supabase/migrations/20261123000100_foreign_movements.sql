-- =============================================================================
-- ACCONTROL · 0.18.5 · Ingresos y gastos pagados en otra moneda
-- -----------------------------------------------------------------------------
-- Añade tres columnas OPCIONALES a «movements». NO cambia ni borra datos: todos los movimientos que ya existen quedan
-- con las tres en null, que quiere decir «pagado en la moneda del espacio», exactamente como antes.
--
--   · original_currency     — la moneda en que se pagó (la misma lista que workspaces.currency).
--   · original_amount_cents — lo pagado, en centavos de esa moneda.
--   · exchange_rate_micro   — la tasa de ese día × 1,000,000 (60.50 → 60500000), entera para no redondear mal.
--
-- amount_cents sigue siendo el monto en la moneda del espacio (ya convertido): totales, reportes y metas no cambian.
-- Las tres van juntas (las tres en null, o las tres con valor). La app comprueba además que
-- amount_cents = lo pagado × la tasa (redondeado al centavo).
-- Las políticas de seguridad por fila (RLS) de «movements» no cambian.
-- Para deshacerla: supabase/rollback/20261123000100_foreign_movements_deshacer.sql
-- =============================================================================

alter table public.movements add column original_currency text
  check (original_currency in ('DOP', 'USD', 'EUR', 'MXN', 'COP', 'PEN', 'ARS', 'GTQ', 'HNL', 'NIO', 'CRC', 'PAB', 'BOB', 'UYU', 'BRL', 'HTG', 'CAD', 'GBP'));

alter table public.movements add column original_amount_cents bigint
  check (original_amount_cents between 1 and 99999999999);

alter table public.movements add column exchange_rate_micro bigint
  check (exchange_rate_micro between 1 and 1000000000000);

alter table public.movements add constraint movements_foreign_together check (
  (original_currency is null and original_amount_cents is null and exchange_rate_micro is null)
  or (original_currency is not null and original_amount_cents is not null and exchange_rate_micro is not null)
);
