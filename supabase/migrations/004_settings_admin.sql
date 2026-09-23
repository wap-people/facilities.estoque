-- Página Configurações: novos tipos de movimentação, exclusão de itens e
-- cadastro de unidades (somente administradores).
alter table public.activity drop constraint if exists activity_type_check;
alter table public.activity add constraint activity_type_check
  check (type in ('count', 'add', 'edit', 'delete', 'import', 'copy'));

drop policy if exists products_delete on public.products;
create policy products_delete on public.products for delete to authenticated using ((select private.is_admin()));

drop policy if exists units_insert on public.units;
drop policy if exists units_update on public.units;
create policy units_insert on public.units for insert to authenticated with check ((select private.is_admin()));
create policy units_update on public.units for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.units add constraint units_id_format check (id ~ '^[A-Z0-9_]{1,30}$') not valid;
