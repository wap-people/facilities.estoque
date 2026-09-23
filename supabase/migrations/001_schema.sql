-- =====================================================================
-- WAP | Estoque Facilities — schema do banco (Supabase / PostgreSQL)
-- Rode este arquivo UMA vez no SQL Editor do Supabase (ou via conector).
-- =====================================================================

-- ---------- quem pode usar o sistema ----------
-- Domínios de e-mail liberados. Para liberar outro domínio:
--   insert into public.allowed_domains (domain) values ('outrodominio.com.br');
create table if not exists public.allowed_domains (
  domain text primary key
);
insert into public.allowed_domains (domain) values ('wap.ind.br') on conflict do nothing;

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_domains d
    where lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2)) = lower(d.domain)
  );
$$;

-- ---------- unidades ----------
create table if not exists public.units (
  id    text primary key,
  label text not null,
  sort  int  not null default 0
);
insert into public.units (id, label, sort) values
  ('SM',       'WAP UN. SM',       1),
  ('AFP',      'WAP UN. AFP',      2),
  ('SERRA',    'WAP UN. SERRA',    3),
  ('LINHARES', 'WAP UN. LINHARES', 4),
  ('EUSEBIO',  'WAP UN. EUSÉBIO',  5)
on conflict (id) do update set label = excluded.label, sort = excluded.sort;

-- ---------- catálogo de itens (por unidade) ----------
create table if not exists public.products (
  unit_id         text        not null references public.units(id),
  code            text        not null,
  name            text        not null,
  category        text        not null,
  unit            text        not null default '',
  min_stock       numeric     not null default 0 check (min_stock >= 0),
  avg_consumption numeric     not null default 0 check (avg_consumption >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (unit_id, code)
);

-- ---------- contagens mensais ----------
create table if not exists public.counts (
  unit_id    text        not null,
  code       text        not null,
  month      text        not null check (month ~ '^\d{4}-\d{2}$'), -- 'AAAA-MM'
  qty        numeric     null check (qty is null or qty >= 0),     -- null = sem contagem
  updated_at timestamptz not null default now(),
  updated_by uuid        null references auth.users(id) on delete set null,
  primary key (unit_id, code, month),
  foreign key (unit_id, code) references public.products(unit_id, code) on update cascade on delete cascade
);
create index if not exists counts_unit_month_idx on public.counts (unit_id, month);

-- ---------- log de movimentações ----------
create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  unit_id     text        not null references public.units(id),
  type        text        not null check (type in ('count', 'add')),
  code        text        not null,
  name        text        not null default '',
  detail      text        not null default '',
  month       text        null,
  actor_id    uuid        null references auth.users(id) on delete set null,
  actor_name  text        null,
  actor_email text        null,
  created_at  timestamptz not null default now()
);
create index if not exists activity_unit_created_idx on public.activity (unit_id, created_at desc);

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------- segurança (RLS) ----------
-- Só usuários logados com e-mail de domínio liberado leem e escrevem.
alter table public.allowed_domains enable row level security;
alter table public.units           enable row level security;
alter table public.products        enable row level security;
alter table public.counts          enable row level security;
alter table public.activity        enable row level security;

drop policy if exists units_read on public.units;
create policy units_read on public.units for select to authenticated using (public.is_allowed_user());

drop policy if exists products_read   on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
create policy products_read   on public.products for select to authenticated using (public.is_allowed_user());
create policy products_insert on public.products for insert to authenticated with check (public.is_allowed_user());
create policy products_update on public.products for update to authenticated using (public.is_allowed_user()) with check (public.is_allowed_user());

drop policy if exists counts_read   on public.counts;
drop policy if exists counts_insert on public.counts;
drop policy if exists counts_update on public.counts;
create policy counts_read   on public.counts for select to authenticated using (public.is_allowed_user());
create policy counts_insert on public.counts for insert to authenticated with check (public.is_allowed_user());
create policy counts_update on public.counts for update to authenticated using (public.is_allowed_user()) with check (public.is_allowed_user());

drop policy if exists activity_read   on public.activity;
drop policy if exists activity_insert on public.activity;
create policy activity_read   on public.activity for select to authenticated using (public.is_allowed_user());
create policy activity_insert on public.activity for insert to authenticated
  with check (public.is_allowed_user() and actor_id = auth.uid());

-- Não há policy de DELETE: pelo site ninguém apaga itens, contagens ou histórico.

-- ---------- tempo real ----------
do $$
begin
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.counts;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.activity; exception when duplicate_object then null; end;
end $$;
