-- =============================================================================
-- ACCONTROL · 0.17.5 · Oferta por cantidad en los productos («2 por RD$15», como el pan del colmado)
-- -----------------------------------------------------------------------------
-- Añade dos columnas a «products». NO cambia ni borra datos: cada producto que ya existe queda «sin oferta» (0 y 0),
-- que es exactamente como funcionaba antes.
--
--   · pack_qty         — cuántas unidades lleva la oferta (2 a 999); 0 = sin oferta.
--   · pack_price_cents — lo que cuestan esas unidades juntas, en centavos enteros; 0 = sin oferta.
--
-- Reglas (las mismas que valida la app): las dos van juntas (las dos en 0, o las dos con valor) y la oferta cuesta al
-- menos un centavo por unidad. Que salga más barata que comprar sueltas lo revisa la app al guardar.
-- Las políticas de seguridad por fila (RLS) de «products» no cambian.
-- Para deshacerla: supabase/rollback/20261120000100_product_pack_deshacer.sql
-- =============================================================================

alter table public.products add column pack_qty integer not null default 0
  check (pack_qty = 0 or pack_qty between 2 and 999);

alter table public.products add column pack_price_cents bigint not null default 0
  check (pack_price_cents between 0 and 99999999999);

alter table public.products add constraint products_pack_together
  check ((pack_qty = 0 and pack_price_cents = 0) or (pack_qty > 0 and pack_price_cents >= pack_qty));
