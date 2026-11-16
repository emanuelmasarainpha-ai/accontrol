-- =============================================================================
-- ACCONTROL · 0.17.0 · Productos para la caja: grupo, foto y «sin control de stock»
-- -----------------------------------------------------------------------------
-- Añade tres columnas a «products». NO cambia ni borra datos: cada producto que ya existe queda «sin grupo», «con control
-- de stock» y «sin foto», que es exactamente como funcionaba antes.
--
--   · group_name  — grupo para la caja («Bebidas», «Dulces»…); '' = sin grupo.
--   · track_stock — false = SIN CONTROL DE STOCK (por ejemplo gomitas sueltas): se vende, pero no se cuentan unidades.
--   · image_data  — foto en miniatura como texto «data:image/(webp|jpeg|png);base64,…» de hasta 40 000 caracteres
--                   (unos 30 KB). Solo JPG, PNG o WEBP: nunca SVG ni otros formatos, que pueden llevar código.
--
-- Reglas (las mismas que valida la app):
--   · un producto sin control de stock no tiene movimientos de stock vivos;
--   · un producto con movimientos de stock vivos no puede pasar a «sin control de stock».
-- Las políticas de seguridad por fila (RLS) de «products» y «stock_entries» no cambian.
-- Para deshacerla: supabase/rollback/20261119000100_product_pos_deshacer.sql
-- =============================================================================

alter table public.products add column group_name text not null default ''
  check (char_length(group_name) <= 30);

alter table public.products add column track_stock boolean not null default true;

alter table public.products add column image_data text not null default ''
  check (image_data = '' or (char_length(image_data) <= 40000 and image_data ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$'));

-- Movimiento de stock vivo de un producto sin control de stock: no.
create function private.check_stock_entry_tracked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is null and exists (
    select 1 from public.products p
    where p.workspace_id = new.workspace_id and p.id = new.product_id and p.track_stock = false
  ) then
    raise exception 'Ese producto no lleva control de stock: no puede tener compras, ventas ni ajustes de stock.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger stock_entries_tracked
  before insert or update on public.stock_entries
  for each row execute function private.check_stock_entry_tracked();

-- Pasar a «sin control de stock» un producto que tiene movimientos de stock vivos: no.
create function private.check_product_untrack() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.track_stock = false and old.track_stock = true and exists (
    select 1 from public.stock_entries e
    where e.workspace_id = new.workspace_id and e.product_id = new.id and e.deleted_at is null
  ) then
    raise exception 'Este producto ya tiene movimientos de stock: no puede pasar a «sin control de stock».' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger products_untrack
  before update on public.products
  for each row execute function private.check_product_untrack();
