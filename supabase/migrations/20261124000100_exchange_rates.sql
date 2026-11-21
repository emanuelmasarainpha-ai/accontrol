-- =============================================================================
-- ACCONTROL · 0.18.6 · Tasa de cambio automática (de referencia)
-- -----------------------------------------------------------------------------
-- Guarda, por día, cuántas unidades de cada moneda de la app vale 1 dólar estadounidense, tal como las publica el
-- servicio gratuito «currency-api» (github.com/fawazahmed0/exchange-api, licencia CC0, sin clave). Con eso se calcula la
-- tasa entre dos monedas cualesquiera (por ejemplo US$ → RD$, o € → RD$).
--
-- Solo la escribe y la lee la función «exchange-rates» (supabase/functions/exchange-rates), con su llave de servidor,
-- que vive en Supabase y nunca en la app. Por eso: RLS activado y NINGÚN permiso para anon ni authenticated.
-- Son datos públicos del mercado, no datos de ninguna persona. Esta migración no toca ninguna tabla que ya exista.
-- Para deshacerla: supabase/rollback/20261124000100_exchange_rates_deshacer.sql
-- =============================================================================

create table public.exchange_rates (
  rate_date      date not null,
  currency       text not null check (currency in ('DOP', 'USD', 'EUR', 'MXN', 'COP', 'PEN', 'ARS', 'GTQ', 'HNL', 'NIO', 'CRC', 'PAB', 'BOB', 'UYU', 'BRL', 'HTG', 'CAD', 'GBP')),
  units_per_usd  numeric(24, 10) not null check (units_per_usd > 0),
  source         text not null,
  fetched_at     timestamptz not null default now(),
  primary key (rate_date, currency)
);
comment on table public.exchange_rates is 'Tasas de referencia por día (unidades de cada moneda por 1 US$). Las escribe y lee solo la función exchange-rates.';

alter table public.exchange_rates enable row level security;
revoke all on public.exchange_rates from anon, authenticated;
