-- =============================================================================
-- DESHACER la migración 20261120000100_product_pack (solo si hiciera falta).
-- Vuelve a dejar «products» como en la 0.17.4. Cómo: Supabase → SQL Editor → pegar este archivo → Run.
-- · Se PIERDEN las ofertas por cantidad guardadas en la nube (los productos y su precio normal siguen ahí).
-- · No borra ningún otro dato.
-- =============================================================================

alter table public.products drop constraint products_pack_together;
alter table public.products drop column pack_price_cents;
alter table public.products drop column pack_qty;
