-- =============================================================================
-- Deshacer 0.18.6 (tasa automática): borra la tabla de tasas de referencia. Solo son tasas del mercado que se vuelven
-- a pedir al servicio; no hay datos de personas. Quita también la función «exchange-rates» desde el panel de Supabase
-- (Edge Functions → exchange-rates → Delete), o la app recibirá un error y pedirá escribir la tasa a mano.
-- =============================================================================

drop table if exists public.exchange_rates;
