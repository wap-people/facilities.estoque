-- Move a checagem de domínio para um schema privado (fora da API pública),
-- conforme recomendação do Security Advisor do Supabase.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_allowed_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_domains d
    where lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2)) = lower(d.domain)
  );
$$;
revoke all on function private.is_allowed_user() from public, anon;
grant execute on function private.is_allowed_user() to authenticated;

drop policy if exists units_read on public.units;
create policy units_read on public.units for select to authenticated using ((select private.is_allowed_user()));
drop policy if exists products_read on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
create policy products_read   on public.products for select to authenticated using ((select private.is_allowed_user()));
create policy products_insert on public.products for insert to authenticated with check ((select private.is_allowed_user()));
create policy products_update on public.products for update to authenticated using ((select private.is_allowed_user())) with check ((select private.is_allowed_user()));
drop policy if exists counts_read on public.counts;
drop policy if exists counts_insert on public.counts;
drop policy if exists counts_update on public.counts;
create policy counts_read   on public.counts for select to authenticated using ((select private.is_allowed_user()));
create policy counts_insert on public.counts for insert to authenticated with check ((select private.is_allowed_user()));
create policy counts_update on public.counts for update to authenticated using ((select private.is_allowed_user())) with check ((select private.is_allowed_user()));
drop policy if exists activity_read on public.activity;
drop policy if exists activity_insert on public.activity;
create policy activity_read   on public.activity for select to authenticated using ((select private.is_allowed_user()));
create policy activity_insert on public.activity for insert to authenticated
  with check ((select private.is_allowed_user()) and actor_id = (select auth.uid()));

drop function if exists public.is_allowed_user();
