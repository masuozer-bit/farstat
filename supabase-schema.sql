-- =====================================================================
-- Studiumm — Datenbank-Schema für Supabase
-- Anleitung: Supabase-Projekt öffnen → linkes Menü "SQL Editor"
--            → "New query" → diesen gesamten Inhalt einfügen → "Run".
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- =====================================================================

-- ----------------------- Tabellen -----------------------------------

create table if not exists public.termine (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  date       date not null,
  time       text,
  title      text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title      text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_tasks (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.plan_lists(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  text       text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.docs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name         text not null,
  size         bigint not null default 0,
  type         text,
  storage_path text not null,
  created_at   timestamptz not null default now()
);

-- ----------------------- Row Level Security -------------------------
-- Jeder Nutzer darf ausschließlich seine eigenen Zeilen sehen/ändern.

alter table public.termine    enable row level security;
alter table public.plan_lists enable row level security;
alter table public.plan_tasks enable row level security;
alter table public.docs       enable row level security;

drop policy if exists "own termine"    on public.termine;
drop policy if exists "own plan_lists" on public.plan_lists;
drop policy if exists "own plan_tasks" on public.plan_tasks;
drop policy if exists "own docs"       on public.docs;

create policy "own termine" on public.termine
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own plan_lists" on public.plan_lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own plan_tasks" on public.plan_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own docs" on public.docs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------- Storage (Dokumente) ------------------------
-- Privater Bucket "documents"; Dateipfad beginnt mit der user-id:  <uid>/<datei>

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "own files select" on storage.objects;
drop policy if exists "own files insert" on storage.objects;
drop policy if exists "own files delete" on storage.objects;

create policy "own files select" on storage.objects
  for select using (
    bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own files insert" on storage.objects
  for insert with check (
    bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own files delete" on storage.objects
  for delete using (
    bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text
  );
