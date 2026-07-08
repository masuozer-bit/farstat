-- =====================================================================
-- Studiumm — Karteikarten v2: FSRS-Scheduler + Lernpensum-Planung
-- Anleitung: Supabase → SQL Editor → New query → einfügen → Run.
-- Setzt supabase-flashcards.sql voraus. Idempotent (mehrfach ausführbar).
-- =====================================================================

-- ----------------------- Karten: FSRS-Zustand -----------------------
-- FSRS modelliert je Karte Difficulty (D) und Stability (S) statt eines
-- festen Ease-Faktors. state steuert neue vs. zu wiederholende Karten.
alter table public.cards add column if not exists state       text    not null default 'new';
alter table public.cards add column if not exists difficulty  real    not null default 0;
alter table public.cards add column if not exists stability   real    not null default 0;
alter table public.cards add column if not exists last_review date;
alter table public.cards add column if not exists lapses      integer not null default 0;

-- Alte Karten (aus v1) als „neu" behandeln, damit FSRS sie sauber initialisiert.
update public.cards set state = 'new'
  where state is null or (stability = 0 and (reps is null or reps = 0));

-- ----------------------- Stapel: Lernplanung ------------------------
alter table public.decks add column if not exists deadline    date;
alter table public.decks add column if not exists retention   real    not null default 0.9;   -- Ziel-Merkrate (0.80–0.97)
alter table public.decks add column if not exists new_per_day integer not null default 10;    -- neue Karten pro Tag
