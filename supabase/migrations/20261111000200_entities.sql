-- =============================================================================
-- ACCONTROL · Etapa 2 · Migración 2 de 4: tablas de datos (una por cada cosa que guarda la app)
-- -----------------------------------------------------------------------------
-- Cada tabla replica la entidad de src/domain/types.js y sus límites (los mismos que valida la app), de modo
-- que ni un cliente modificado puede guardar datos que ACCONTROL rechazaría.
--
-- Patrón común:
--   workspace_id  → espacio dueño del dato (si se borra el espacio se borra todo lo suyo)
--   id            → uuid generado en el dispositivo; llave primaria = (workspace_id, id)
--   created_at / updated_at → los pone el dispositivo (hora real del registro)
--   synced_at     → lo pone el servidor en cada escritura (cursor de sincronización)
--   deleted_at    → borrado lógico para que los demás dispositivos se enteren
--   is_demo       → dato de demostración (la app lo muestra etiquetado)
-- Los vínculos entre tablas son llaves foráneas COMPUESTAS (workspace_id, x_id): un dato nunca puede
-- apuntar a algo de otro espacio. Se verifican al final de cada transacción (DEFERRABLE INITIALLY DEFERRED).
-- =============================================================================

-- ----------------------------------------------------- categorías del sistema
-- Las 22 categorías que vienen con la app (iguales en todos los espacios). Solo lectura para todos.
create table public.builtin_categories (
  id                     text primary key check (char_length(id) between 1 and 80),
  name                   text not null check (char_length(btrim(name)) between 1 and 40),
  kind                   text not null check (kind in ('income', 'expense')),
  default_classification text not null check (default_classification in ('fixed', 'variable', 'extraordinary', 'discretionary'))
);
comment on table public.builtin_categories is 'Categorías incluidas con la app. Las categorías propias de cada espacio están en public.categories.';

-- ---------------------------------------------------------------- categorías
create table public.categories (
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  id                     text not null check (char_length(id) between 1 and 80),
  name                   text not null check (char_length(btrim(name)) between 1 and 40),
  kind                   text not null check (kind in ('income', 'expense')),
  default_classification text not null check (default_classification in ('fixed', 'variable', 'extraordinary', 'discretionary')),
  is_demo                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  synced_at              timestamptz not null default now(),
  deleted_at             timestamptz,
  primary key (workspace_id, id)
);
comment on table public.categories is 'Categorías creadas por la persona en un espacio (las del sistema están en builtin_categories).';

-- ------------------------------------------------------------- departamentos
create table public.departments (
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  id                   uuid not null,
  name                 text not null check (char_length(btrim(name)) between 1 and 40),
  monthly_budget_cents bigint not null default 0 check (monthly_budget_cents between 0 and 99999999999),
  archived             boolean not null default false,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  synced_at            timestamptz not null default now(),
  deleted_at           timestamptz,
  primary key (workspace_id, id)
);

-- ------------------------------------------------------------------- clientes
create table public.clients (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  first_name   text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_name    text not null default '' check (char_length(last_name) <= 60),
  company      text not null default '' check (char_length(company) <= 80),
  email        text not null default '' check (char_length(email) <= 80),
  phone        text not null default '' check (char_length(phone) <= 25),
  country      text not null default '' check (char_length(country) <= 60),
  notes        text not null default '' check (char_length(notes) <= 200),
  archived     boolean not null default false,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id)
);

-- ------------------------------------------------------------------ servicios
create table public.services (
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  id             uuid not null,
  client_id      uuid not null,
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  price_cents    bigint not null check (price_cents between 1 and 99999999999),
  estimated_days integer check (estimated_days between 1 and 3650),   -- null = no se indicó
  status         text not null check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  start_date     date check (start_date between '1900-01-01' and '2200-12-31'),  -- null = no se indicó
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  synced_at      timestamptz not null default now(),
  deleted_at     timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, client_id) references public.clients (workspace_id, id) deferrable initially deferred
);

-- ----------------------------------------------------------------- movimientos
create table public.movements (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  id            uuid not null,
  type          text not null check (type in ('income', 'expense')),
  amount_cents  bigint not null check (amount_cents between 1 and 99999999999),
  date          date not null check (date between '1900-01-01' and '2200-12-31'),
  time          text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  description   text not null default '' check (char_length(description) <= 80),
  classification text not null check (classification in ('fixed', 'variable', 'extraordinary', 'discretionary')),
  category_id   text not null check (char_length(category_id) between 1 and 80),
  client_id     uuid,
  service_id    uuid,
  department_id uuid,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (workspace_id, id),
  -- Reglas de la app: un gasto no lleva servicio ni un ingreso lleva departamento.
  check (service_id is null or type = 'income'),
  check (department_id is null or type = 'expense'),
  foreign key (workspace_id, client_id)     references public.clients (workspace_id, id)     deferrable initially deferred,
  foreign key (workspace_id, service_id)    references public.services (workspace_id, id)    deferrable initially deferred,
  foreign key (workspace_id, department_id) references public.departments (workspace_id, id) deferrable initially deferred
);

-- La categoría debe ser del sistema o de ESTE espacio, y del mismo tipo que el movimiento.
create function private.check_movement_category() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.builtin_categories b where b.id = new.category_id and b.kind = new.type)
     and not exists (select 1 from public.categories c
                     where c.workspace_id = new.workspace_id and c.id = new.category_id and c.kind = new.type) then
    raise exception 'La categoría no existe en este espacio o no corresponde al tipo de movimiento.' using errcode = '23503';
  end if;
  return null;
end;
$$;
create constraint trigger movements_check_category after insert or update of category_id, type, workspace_id on public.movements
  deferrable initially deferred for each row execute function private.check_movement_category();

-- ---------------------------------------------------------------------- metas
create table public.goals (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  description  text not null default '' check (char_length(description) <= 200),
  target_cents bigint not null check (target_cents between 1 and 99999999999),
  target_date  date not null check (target_date between '1900-01-01' and '2200-12-31'),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id)
);

create table public.contributions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  goal_id      uuid not null,
  kind         text not null check (kind in ('deposit', 'withdrawal')),
  amount_cents bigint not null check (amount_cents between 1 and 99999999999),
  date         date not null check (date between '1900-01-01' and '2200-12-31'),
  time         text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note         text not null default '' check (char_length(note) <= 120),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, goal_id) references public.goals (workspace_id, id) deferrable initially deferred
);

-- --------------------------------------------------------------------- deudas
create table public.debts (
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  id              uuid not null,
  name            text not null check (char_length(btrim(name)) between 1 and 60),
  note            text not null default '' check (char_length(note) <= 200),
  total_cents     bigint not null check (total_cents between 1 and 99999999999),
  rate_bp         integer not null check (rate_bp between 0 and 50000),
  rate_basis      text not null check (rate_basis in ('annual', 'monthly')),
  frequency       text not null check (frequency in ('monthly', 'bimonthly', 'quarterly', 'fourmonthly', 'semiannual')),
  collateral_kind text not null check (collateral_kind in ('physical', 'personal')),
  collateral_type text not null check (char_length(collateral_type) between 1 and 40),
  first_due_date  date not null check (first_due_date between '1900-01-01' and '2200-12-31'),
  first_due_time  text not null check (first_due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  final_due_date  date not null check (final_due_date between '1900-01-01' and '2200-12-31'),
  final_due_time  text not null check (final_due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  synced_at       timestamptz not null default now(),
  deleted_at      timestamptz,
  primary key (workspace_id, id),
  check (final_due_date >= first_due_date)
);

create table public.debt_payments (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  debt_id      uuid not null,
  kind         text not null check (kind in ('regular', 'extra')),
  amount_cents bigint not null check (amount_cents between 1 and 99999999999),
  date         date not null check (date between '1900-01-01' and '2200-12-31'),
  time         text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note         text not null default '' check (char_length(note) <= 120),
  movement_id  uuid not null,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, debt_id)     references public.debts (workspace_id, id)     deferrable initially deferred,
  foreign key (workspace_id, movement_id) references public.movements (workspace_id, id) deferrable initially deferred
);

-- -------------------------------------------------------------------- activos
create table public.assets (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  id            uuid not null,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  category      text not null check (category in ('cash', 'bank', 'investments', 'vehicles', 'realEstate', 'business', 'other')),
  subtype       text not null default '' check (char_length(subtype) <= 40),
  description   text not null default '' check (char_length(description) <= 200),
  acquired_date date not null check (acquired_date between '1900-01-01' and '2200-12-31'),
  -- Historial de valores: [{"date":"AAAA-MM-DD","valueCents":123}, …] (1 a 2000, el límite de la app).
  valuations    jsonb not null check (jsonb_typeof(valuations) = 'array'
                                      and jsonb_array_length(valuations) between 1 and 2000
                                      and pg_column_size(valuations) <= 400000),
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (workspace_id, id)
);

-- ------------------------------------------------------------------ inventario
create table public.products (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  sku          text not null default '' check (char_length(sku) <= 30),
  unit         text not null default '' check (char_length(unit) <= 20),
  price_cents  bigint not null default 0 check (price_cents between 0 and 99999999999),
  min_stock    integer not null default 0 check (min_stock between 0 and 1000000),
  notes        text not null default '' check (char_length(notes) <= 200),
  archived     boolean not null default false,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id)
);

create table public.suppliers (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  contact      text not null default '' check (char_length(contact) <= 60),
  email        text not null default '' check (char_length(email) <= 80),
  phone        text not null default '' check (char_length(phone) <= 25),
  notes        text not null default '' check (char_length(notes) <= 200),
  archived     boolean not null default false,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id)
);

-- -------------------------------------------------------------------- facturas
create table public.invoices (
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  id               uuid not null,
  number           integer not null check (number >= 1),
  customer_name    text not null check (char_length(btrim(customer_name)) between 1 and 80),
  customer_tax_id  text not null default '' check (char_length(customer_tax_id) <= 20),
  customer_contact text not null default '' check (char_length(customer_contact) <= 120),
  issue_date       date not null check (issue_date between '2000-01-01' and '2200-12-31'),
  due_date         date check (due_date between '2000-01-01' and '2200-12-31'),   -- null = se paga al recibirla
  -- Líneas: [{"description":"…","quantity":2,"unitCents":1500,"productId":"…"?}, …] (1 a 30, el límite de la app).
  lines            jsonb not null check (jsonb_typeof(lines) = 'array'
                                         and jsonb_array_length(lines) between 1 and 30
                                         and pg_column_size(lines) <= 60000),
  tax_rate_bp      integer not null default 0 check (tax_rate_bp between 0 and 10000),
  notes            text not null default '' check (char_length(notes) <= 300),
  voided_at        timestamptz,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  synced_at        timestamptz not null default now(),
  deleted_at       timestamptz,
  primary key (workspace_id, id),
  check (due_date is null or due_date >= issue_date)
);
-- El consecutivo no se repite dentro del espacio (las facturas de demostración llevan su propia serie).
create unique index invoices_number_uidx on public.invoices (workspace_id, is_demo, number);

create table public.stock_entries (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  product_id   uuid not null,
  kind         text not null check (kind in ('purchase', 'sale', 'adjustment')),
  quantity     integer not null check (quantity <> 0 and abs(quantity) <= 1000000),
  unit_cents   bigint not null default 0 check (unit_cents between 0 and 99999999999),
  date         date not null check (date between '1900-01-01' and '2200-12-31'),
  time         text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  supplier_id  uuid,
  movement_id  uuid,
  invoice_id   uuid,
  note         text not null default '' check (char_length(note) <= 120),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, product_id)  references public.products (workspace_id, id)  deferrable initially deferred,
  foreign key (workspace_id, supplier_id) references public.suppliers (workspace_id, id) deferrable initially deferred,
  foreign key (workspace_id, movement_id) references public.movements (workspace_id, id) deferrable initially deferred,
  foreign key (workspace_id, invoice_id)  references public.invoices (workspace_id, id)  deferrable initially deferred
);

create table public.invoice_payments (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  id           uuid not null,
  invoice_id   uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 99999999999),
  date         date not null check (date between '1900-01-01' and '2200-12-31'),
  time         text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  note         text not null default '' check (char_length(note) <= 120),
  movement_id  uuid not null,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, invoice_id)  references public.invoices (workspace_id, id)  deferrable initially deferred,
  foreign key (workspace_id, movement_id) references public.movements (workspace_id, id) deferrable initially deferred
);

-- ------------------------------------------------- triggers de servidor y índices
-- Todas las tablas de datos: synced_at lo pone el servidor y id/workspace_id no se pueden mover.
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'departments', 'clients', 'services', 'movements', 'goals', 'contributions', 'debts',
    'debt_payments', 'assets', 'products', 'suppliers', 'invoices', 'stock_entries', 'invoice_payments'
  ] loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function private.entity_guard()',
      t || '_guard', t);
    -- Cursor de sincronización: "dame lo que cambió después de X" dentro de un espacio.
    execute format('create index %I on public.%I (workspace_id, synced_at)', t || '_sync_idx', t);
  end loop;
end $$;

-- Un índice por cada llave foránea compuesta (acelera borrados en cascada y las consultas por vínculo).
create index services_client_idx          on public.services (workspace_id, client_id);
create index movements_client_idx         on public.movements (workspace_id, client_id)     where client_id is not null;
create index movements_service_idx        on public.movements (workspace_id, service_id)    where service_id is not null;
create index movements_department_idx     on public.movements (workspace_id, department_id) where department_id is not null;
create index movements_date_idx           on public.movements (workspace_id, date);
create index contributions_goal_idx       on public.contributions (workspace_id, goal_id);
create index debt_payments_debt_idx       on public.debt_payments (workspace_id, debt_id);
create index debt_payments_movement_idx   on public.debt_payments (workspace_id, movement_id);
create index stock_entries_product_idx    on public.stock_entries (workspace_id, product_id);
create index stock_entries_supplier_idx   on public.stock_entries (workspace_id, supplier_id) where supplier_id is not null;
create index stock_entries_movement_idx   on public.stock_entries (workspace_id, movement_id) where movement_id is not null;
create index stock_entries_invoice_idx    on public.stock_entries (workspace_id, invoice_id)  where invoice_id is not null;
create index invoice_payments_invoice_idx on public.invoice_payments (workspace_id, invoice_id);
create index invoice_payments_movement_idx on public.invoice_payments (workspace_id, movement_id);
