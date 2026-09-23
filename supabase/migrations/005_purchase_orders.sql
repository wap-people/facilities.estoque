-- Pedidos de compra registrados (emitido → recebido) e seus itens.
-- Base do "consumo real" nos relatórios: contagem anterior + recebido no mês − contagem atual.

create table if not exists public.purchase_orders (
  id               bigint generated always as identity primary key,
  unit_id          text        not null references public.units(id) on update cascade,
  month            text        not null check (month ~ '^\d{4}-\d{2}$'), -- mês da contagem que originou o pedido
  status           text        not null default 'emitido' check (status in ('emitido', 'parcial', 'recebido', 'cancelado')),
  notes            text        not null default '',
  created_at       timestamptz not null default now(),
  created_by       uuid        null references auth.users(id) on delete set null,
  created_by_name  text        null,
  received_at      timestamptz null,
  received_by      uuid        null references auth.users(id) on delete set null,
  received_by_name text        null
);
create index if not exists purchase_orders_unit_created_idx on public.purchase_orders (unit_id, created_at desc);
create index if not exists purchase_orders_created_by_idx on public.purchase_orders (created_by);
create index if not exists purchase_orders_received_by_idx on public.purchase_orders (received_by);

create table if not exists public.purchase_order_items (
  order_id     bigint  not null references public.purchase_orders(id) on delete cascade,
  code         text    not null,
  name         text    not null default '',
  category     text    not null default '',
  unit         text    not null default '',
  qty_current  numeric null,                                  -- contado quando o pedido foi emitido
  min_stock    numeric not null default 0,
  qty_ordered  numeric not null check (qty_ordered > 0),
  qty_received numeric null check (qty_received is null or qty_received >= 0),
  primary key (order_id, code)
);

alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists po_read   on public.purchase_orders;
drop policy if exists po_insert on public.purchase_orders;
drop policy if exists po_update on public.purchase_orders;
drop policy if exists po_delete on public.purchase_orders;
create policy po_read   on public.purchase_orders for select to authenticated using ((select private.is_allowed_user()));
create policy po_insert on public.purchase_orders for insert to authenticated
  with check ((select private.is_allowed_user()) and created_by = (select auth.uid()));
create policy po_update on public.purchase_orders for update to authenticated
  using ((select private.is_allowed_user())) with check ((select private.is_allowed_user()));
create policy po_delete on public.purchase_orders for delete to authenticated using ((select private.is_admin()));

drop policy if exists poi_read   on public.purchase_order_items;
drop policy if exists poi_insert on public.purchase_order_items;
drop policy if exists poi_update on public.purchase_order_items;
drop policy if exists poi_delete on public.purchase_order_items;
create policy poi_read   on public.purchase_order_items for select to authenticated using ((select private.is_allowed_user()));
create policy poi_insert on public.purchase_order_items for insert to authenticated with check ((select private.is_allowed_user()));
create policy poi_update on public.purchase_order_items for update to authenticated
  using ((select private.is_allowed_user())) with check ((select private.is_allowed_user()));
create policy poi_delete on public.purchase_order_items for delete to authenticated using ((select private.is_admin()));

alter table public.activity drop constraint if exists activity_type_check;
alter table public.activity add constraint activity_type_check
  check (type in ('count', 'add', 'edit', 'delete', 'import', 'copy', 'order', 'receive'));

do $$
begin
  begin alter publication supabase_realtime add table public.purchase_orders; exception when duplicate_object then null; end;
end $$;
