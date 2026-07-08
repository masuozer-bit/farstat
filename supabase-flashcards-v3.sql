-- =====================================================================
-- Studiumm — Karteikarten v3: Ordner (Stapel gruppieren)
-- Anleitung: Supabase → SQL Editor → New query → einfügen → Run.
-- Setzt supabase-flashcards.sql + -v2.sql voraus. Idempotent.
-- =====================================================================

create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Jeder Stapel kann in genau einem Ordner liegen (oder in keinem).
-- Wird der Ordner gelöscht, bleiben die Stapel erhalten (folder_id -> NULL).
alter table public.decks
  add column if not exists folder_id uuid references public.folders(id) on delete set null;

create index if not exists decks_folder_idx on public.decks(folder_id);

-- ----------------------- Row Level Security -------------------------
alter table public.folders enable row level security;
drop policy if exists "own folders" on public.folders;
create policy "own folders" on public.folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
