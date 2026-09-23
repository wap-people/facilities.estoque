-- Login por e-mail + senha, com usuários cadastrados por um administrador.
-- A partir daqui, só tem acesso quem está em public.members com active = true
-- (antes era qualquer e-mail @wap.ind.br).

create table if not exists public.members (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  email      text        not null unique,
  full_name  text        not null default '',
  is_admin   boolean     not null default false,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  created_by uuid        null references auth.users(id) on delete set null
);
create index if not exists members_created_by_idx on public.members (created_by);

create or replace function private.is_allowed_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.active);
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.is_admin);
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

alter table public.members enable row level security;
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using ((select private.is_allowed_user()));
-- Sem policy de escrita: membros só são criados/alterados pela Edge Function
-- "admin-users" (que confere se quem chama é administrador).

-- Primeiro administrador: quando a conta abaixo for criada em
-- Authentication > Users, ela vira admin automaticamente.
create or replace function private.bootstrap_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) in ('rafael.veiber@wap.ind.br') then
    insert into public.members (user_id, email, full_name, is_admin, active)
    values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', 'Rafael Veiber'), true, true)
    on conflict (user_id) do update set is_admin = true, active = true;
  end if;
  return new;
end;
$$;
revoke all on function private.bootstrap_admin() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_bootstrap on auth.users;
create trigger on_auth_user_created_bootstrap after insert on auth.users
  for each row execute function private.bootstrap_admin();

-- Caso a conta já exista quando esta migração rodar:
insert into public.members (user_id, email, full_name, is_admin, active)
select u.id, lower(u.email), coalesce(u.raw_user_meta_data ->> 'full_name', 'Rafael Veiber'), true, true
from auth.users u where lower(u.email) = 'rafael.veiber@wap.ind.br'
on conflict (user_id) do update set is_admin = true, active = true;
