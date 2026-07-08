-- =====================================================================
-- Studiumm — Karteikarten (Flashcards, Anki-artig)
-- Anleitung: Supabase-Projekt öffnen → linkes Menü "SQL Editor"
--            → "New query" → diesen gesamten Inhalt einfügen → "Run".
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- =====================================================================

-- ----------------------- Tabellen -----------------------------------

create table if not exists public.decks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cards (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  front      text not null,
  back       text not null,
  -- Spaced-Repetition-Zustand (vereinfachtes SM-2)
  due        date    not null default current_date,  -- nächster Fälligkeitstag
  interval   real    not null default 0,             -- aktuelles Intervall in Tagen
  ease       real    not null default 2.5,           -- Leichtigkeitsfaktor
  reps       integer not null default 0,             -- Anzahl Wiederholungen
  created_at timestamptz not null default now()
);

create index if not exists cards_deck_idx on public.cards(deck_id);
create index if not exists cards_due_idx  on public.cards(user_id, due);

-- ----------------------- Row Level Security -------------------------
-- Jeder Nutzer darf ausschließlich seine eigenen Zeilen sehen/ändern.

alter table public.decks enable row level security;
alter table public.cards enable row level security;

drop policy if exists "own decks" on public.decks;
drop policy if exists "own cards" on public.cards;

create policy "own decks" on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own cards" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
