-- =============================================================================
-- DESHACER la migración 20261119000100_product_pos (solo si hiciera falta).
-- Vuelve a dejar «products» como en la 0.16.3. Cómo: Supabase → SQL Editor → pegar este archivo → Run.
-- · Se PIERDEN las fotos y los grupos de los productos guardados en la nube (los del dispositivo siguen ahí).
-- · Los productos «sin control de stock» vuelven a ser productos normales (con stock 0).
-- · No borra ningún otro dato.
-- =============================================================================

drop trigger products_untrack on public.products;
drop function private.check_product_untrack();
drop trigger stock_entries_tracked on public.stock_entries;
drop function private.check_stock_entry_tracked();

alter table public.products drop column image_data;
alter table public.products drop column track_stock;
alter table public.products drop column group_name;
