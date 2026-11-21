-- =============================================================================
-- Deshacer 0.18.5 (pagos en otra moneda): quita las tres columnas de «movements».
-- OJO: se pierde en la nube de qué moneda, por cuánto y a qué tasa se pagó cada movimiento (el monto ya convertido,
-- amount_cents, se conserva). No toca nada más.
-- =============================================================================

begin;

alter table public.movements drop constraint if exists movements_foreign_together;
alter table public.movements drop column if exists exchange_rate_micro;
alter table public.movements drop column if exists original_amount_cents;
alter table public.movements drop column if exists original_currency;

commit;
