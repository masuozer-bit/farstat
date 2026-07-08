-- =====================================================================
-- Studiumm — Admin-Bereich, Phase 1 (Rollen + Profile)
-- In Supabase: SQL Editor → New query → einfügen → Run.
-- Idempotent: mehrfaches Ausführen ist gefahrlos.
-- =====================================================================

-- ----------------------- profiles-Tabelle ---------------------------
-- Ein Profil pro Account; hält Name, E-Mail und das Admin-Flag.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------- Auto-Profil bei Registrierung --------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Bereits registrierte Nutzer nachtragen
insert into public.profiles (id, full_name, email)
select id, raw_user_meta_data->>'full_name', email
from auth.users
on conflict (id) do nothing;

-- ----------------------- Admin-Check (ohne RLS-Rekursion) -----------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  );
$$;

-- ----------------------- RLS für profiles ---------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles read"        on public.profiles;
drop policy if exists "profiles admin write"  on public.profiles;

-- Jeder darf sein eigenes Profil lesen; Admins dürfen alle lesen.
create policy "profiles read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Nur Admins dürfen Profile ändern (z. B. weitere Admins ernennen).
-- (Normale Nutzer können sich so NICHT selbst zum Admin machen.)
create policy "profiles admin write" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());


-- =====================================================================
-- >>> DICH SELBST ZUM ADMIN MACHEN <<<
-- Trage unten die E-Mail ein, mit der DU dich auf der Seite registriert
-- hast, und führe diese eine Zeile aus:
-- =====================================================================
-- update public.profiles set is_admin = true where email = 'deine-email@example.com';

-- Zur Kontrolle: zeigt alle Konten + Admin-Status
-- select email, full_name, is_admin, created_at from public.profiles order by created_at;
