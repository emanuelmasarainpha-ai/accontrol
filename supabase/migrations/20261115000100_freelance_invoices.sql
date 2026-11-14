-- =============================================================================
-- ACCONTROL · 0.14.5 · Facturas internas también en el espacio Freelancer
-- -----------------------------------------------------------------------------
-- En el dispositivo, una factura de Freelancer guarda la ficha de su cliente (clientId) y cada línea puede facturar un
-- servicio de ese cliente (serviceId, dentro de «lines»). Esta migración deja el esquema de la nube igual, para la
-- sincronización de la 0.15.0. NO cambia ni borra datos: añade una columna que puede ir vacía y una comprobación.
--
-- Reglas (las mismas que valida la app):
--   · client_id, si lo hay, es un cliente del MISMO espacio (llave foránea compuesta, como el resto de vínculos);
--   · cada serviceId de las líneas es un servicio vivo de ese espacio y de ese cliente, y no va junto con productId.
-- La regla de «no facturar un servicio por encima de su precio» depende de cobros y de otras facturas: la aplica la app
-- (y la copia de seguridad) al emitir; aquí no se repite.
-- Las políticas de seguridad por fila (RLS) de «invoices» no cambian: siguen valiendo para la tabla entera.
-- =============================================================================

alter table public.invoices add column client_id uuid;   -- null = cliente escrito a mano (Emprendedor y Empresa)

alter table public.invoices
  add constraint invoices_client_fk foreign key (workspace_id, client_id)
  references public.clients (workspace_id, id) deferrable initially deferred;

-- Líneas: [{"description":"…","quantity":1,"unitCents":500000,"productId":"…"?,"serviceId":"…"?}, …]
create function private.check_invoice_lines() returns trigger
language plpgsql set search_path = '' as $$
declare
  line jsonb;
begin
  for line in select value from jsonb_array_elements(new.lines) loop
    if line ? 'serviceId' then
      if line ? 'productId' then
        raise exception 'Una línea de factura lleva un producto o un servicio, no los dos.' using errcode = '23514';
      end if;
      if new.client_id is null or not exists (
        select 1 from public.services s
        where s.workspace_id = new.workspace_id
          and s.id::text = line ->> 'serviceId'
          and s.client_id = new.client_id
          and s.deleted_at is null
      ) then
        raise exception 'El servicio de una línea no existe en este espacio o no es del cliente de la factura.' using errcode = '23503';
      end if;
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger invoices_check_lines after insert or update of lines, client_id, workspace_id on public.invoices
  deferrable initially deferred for each row execute function private.check_invoice_lines();

create index invoices_client_idx on public.invoices (workspace_id, client_id) where client_id is not null;
