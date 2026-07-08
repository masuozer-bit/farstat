-- =====================================================================
-- Studiumm — Terminplanung (Vorschläge + Verfügbarkeiten)
-- Voraussetzung: supabase-schema.sql, supabase-admin.sql UND
--                supabase-admin-phase2.sql wurden ausgeführt.
-- In Supabase: SQL Editor → New query → einfügen → Run. Idempotent.
--
-- Erweitert die Termine um einen Status (Vorschlag/Bestätigt/Abgelehnt)
-- und merkt sich, wer vorgeschlagen hat. Tutor UND Schüler können Termine
-- vorschlagen; die jeweils andere Seite nimmt an oder lehnt ab. Schüler
-- tragen außerdem ihre Verfügbarkeiten ein, die der Tutor einsehen kann.
-- =====================================================================

-- ----------------------- termine: Status + Herkunft -----------------
-- Werte (ASCII, damit keine Umlaut-Stolperfallen): die Anzeige bleibt deutsch.
--   status      : 'proposed' | 'confirmed' | 'declined'   (Default confirmed)
--   proposed_by : 'student'  | 'tutor'      | NULL (eigener Eintrag)
alter table public.termine add column if not exists status      text not null default 'confirmed';
alter table public.termine add column if not exists proposed_by text;

-- end_time: optionale Endzeit als 'HH:MM' (time/start bleibt in Spalte "time").
alter table public.termine add column if not exists end_time text;

alter table public.termine drop constraint if exists termine_status_chk;
alter table public.termine add constraint termine_status_chk
  check (status in ('proposed', 'confirmed', 'declined'));

alter table public.termine drop constraint if exists termine_proposed_by_chk;
alter table public.termine add constraint termine_proposed_by_chk
  check (proposed_by is null or proposed_by in ('student', 'tutor'));

-- ----------------------- termine: RLS für Admin ---------------------
-- Bisher (Phase 2) durfte der Admin Termine nur LESEN. Für die Terminplanung
-- muss er Termine für Schüler anlegen, annehmen/ablehnen und entfernen können.
drop policy if exists "admin read termine"   on public.termine;
drop policy if exists "admin manage termine" on public.termine;
create policy "admin manage termine" on public.termine
  for all using (public.is_admin()) with check (public.is_admin());

-- ----------------------- Verfügbarkeiten ----------------------------
-- weekday: 0 = Montag … 6 = Sonntag.  from_time/to_time als 'HH:MM'.
create table if not exists public.availabilities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  weekday    smallint not null,
  from_time  text not null,
  to_time    text not null,
  created_at timestamptz not null default now(),
  constraint availabilities_weekday_chk check (weekday between 0 and 6)
);

alter table public.availabilities enable row level security;

drop policy if exists "own availabilities"        on public.availabilities;
drop policy if exists "admin read availabilities" on public.availabilities;

-- Schüler verwalten ihre eigenen Verfügbarkeiten vollständig.
create policy "own availabilities" on public.availabilities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Admin darf alle Verfügbarkeiten lesen.
create policy "admin read availabilities" on public.availabilities
  for select using (public.is_admin());

create index if not exists availabilities_user_idx
  on public.availabilities (user_id, weekday);
