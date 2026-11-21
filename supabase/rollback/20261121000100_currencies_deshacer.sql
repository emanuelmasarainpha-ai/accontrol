-- =============================================================================
-- Deshacer 0.18.3 (monedas): vuelve a aceptar solo 'DOP'.
-- NO convierte ni borra nada. Si algún espacio ya usa otra moneda, este script FALLA a propósito (y no cambia nada):
-- primero hay que decidir con su dueño qué hacer con ese espacio.
-- =============================================================================

begin;

alter table public.workspaces drop constraint workspaces_currency_check;

alter table public.workspaces add constraint workspaces_currency_check check (currency in ('DOP'));

commit;
