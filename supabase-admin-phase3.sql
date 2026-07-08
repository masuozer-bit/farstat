-- =====================================================================
-- Studiumm — Admin-Bereich, Phase 3
-- Termin-Absagen · Benachrichtigungen · Zahlungen
-- Voraussetzung: supabase-schema.sql, supabase-admin.sql,
--                supabase-admin-phase2.sql UND supabase-scheduling.sql.
-- In Supabase: SQL Editor → New query → einfügen → Run. Idempotent.
--
-- Inhalt:
--   1) Termine: Status 'cancelled' + Absage-Zeitpunkt; Löschen nur Admin,
--      Schüler dürfen nur noch absagen (UPDATE), nicht mehr löschen.
--   2) notifications: In-App-Benachrichtigungen (Glocke), per Trigger gefüllt.
--   3) payments: Zahlungs-Konto pro Schüler, vom Admin verwaltet.
-- =====================================================================

-- =====================================================================
-- 1) TERMINE — Absage-Status + Löschen nur für Admin
-- =====================================================================

-- Absage-Felder: wann und von wem (student/tutor) abgesagt wurde.
alter table public.termine add column if not exists cancelled_at timestamptz;
alter table public.termine add column if not exists cancelled_by text;

-- Status um 'cancelled' erweitern (ersetzt den Check aus supabase-scheduling.sql).
alter table public.termine drop constraint if exists termine_status_chk;
alter table public.termine add constraint termine_status_chk
  check (status in ('proposed', 'confirmed', 'declined', 'cancelled'));

alter table public.termine drop constraint if exists termine_cancelled_by_chk;
alter table public.termine add constraint termine_cancelled_by_chk
  check (cancelled_by is null or cancelled_by in ('student', 'tutor'));

-- RLS umbauen: die bisherige FOR-ALL-Policy "own termine" erlaubte Schülern auch
-- das endgültige Löschen. Wir ersetzen sie durch select/insert/update OHNE delete.
-- Endgültiges Löschen läuft damit nur noch über "admin manage termine" (FOR ALL,
-- aus supabase-scheduling.sql).
drop policy if exists "own termine"        on public.termine;
drop policy if exists "own termine read"   on public.termine;
drop policy if exists "own termine insert" on public.termine;
drop policy if exists "own termine update" on public.termine;

create policy "own termine read" on public.termine
  for select using (auth.uid() = user_id);
create policy "own termine insert" on public.termine
  for insert with check (auth.uid() = user_id);
create policy "own termine update" on public.termine
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- 2) NOTIFICATIONS — In-App-Benachrichtigungen
-- =====================================================================
-- Empfänger = user_id. Einträge entstehen ausschließlich über den Trigger
-- (security definer), deshalb gibt es bewusst KEINE Insert-Policy für Clients.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  termin_id  uuid,                       -- lose Referenz, darf verwaisen
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "own notifications read"   on public.notifications;
drop policy if exists "own notifications update" on public.notifications;
drop policy if exists "own notifications delete" on public.notifications;

-- Jeder sieht/ändert/löscht nur seine eigenen Benachrichtigungen.
create policy "own notifications read" on public.notifications
  for select using (user_id = auth.uid());
create policy "own notifications update" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications delete" on public.notifications
  for delete using (user_id = auth.uid());

-- Realtime-Publikation (idempotent), damit die Glocke live aktualisiert.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- ----------------------- Trigger-Funktion ---------------------------
-- Erstellt automatisch Benachrichtigungen bei Terminänderungen. Läuft als
-- security definer, damit sie für die jeweils ANDERE Seite (Schüler ODER alle
-- Admins) schreiben darf, ohne dass Clients fremde Zeilen anlegen können.
create or replace function public.notify_termin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recip   text;            -- 'student' | 'admin'
  ttl     text;
  whentxt text;
begin
  whentxt := to_char(NEW.date, 'DD.MM.YYYY') ||
             coalesce(' · ' || nullif(NEW.time, ''), '');

  if TG_OP = 'INSERT' then
    if NEW.status = 'proposed' then
      ttl := 'Neuer Terminvorschlag';
      if NEW.proposed_by = 'student' then recip := 'admin';
      else recip := 'student'; end if;
    else
      return NEW;  -- eigene bestätigte Einträge usw. lösen nichts aus
    end if;

  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    if NEW.status = 'confirmed' then
      ttl := 'Termin angenommen';
      -- Empfänger ist die vorschlagende Seite (sie wartet auf Antwort).
      if OLD.proposed_by = 'student' then recip := 'student';
      else recip := 'admin'; end if;
    elsif NEW.status = 'declined' then
      ttl := 'Termin abgelehnt';
      if OLD.proposed_by = 'student' then recip := 'student';
      else recip := 'admin'; end if;
    elsif NEW.status = 'cancelled' then
      ttl := 'Termin abgesagt';
      -- Empfänger ist die jeweils andere Seite.
      if NEW.cancelled_by = 'student' then recip := 'admin';
      else recip := 'student'; end if;
    else
      return NEW;
    end if;

  else
    return NEW;
  end if;

  if recip = 'student' then
    insert into public.notifications (user_id, type, title, body, termin_id)
    values (NEW.user_id, NEW.status, ttl, NEW.title || ' · ' || whentxt, NEW.id);
  else
    insert into public.notifications (user_id, type, title, body, termin_id)
    select id, NEW.status, ttl, NEW.title || ' · ' || whentxt, NEW.id
    from public.profiles where is_admin;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_termin_ins on public.termine;
create trigger trg_notify_termin_ins
  after insert on public.termine
  for each row execute function public.notify_termin_change();

drop trigger if exists trg_notify_termin_upd on public.termine;
create trigger trg_notify_termin_upd
  after update on public.termine
  for each row execute function public.notify_termin_change();

-- =====================================================================
-- 3) PAYMENTS — Zahlungs-Konto pro Schüler (Admin verwaltet)
-- =====================================================================
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  amount     numeric(10, 2),
  due_date   date,
  paid       boolean not null default false,
  paid_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payments_user_idx
  on public.payments (user_id, created_at);

alter table public.payments enable row level security;

drop policy if exists "payments student read" on public.payments;
drop policy if exists "payments admin manage" on public.payments;

-- Schüler dürfen ihre eigenen Zahlungen sehen (Transparenz), aber nicht ändern.
create policy "payments student read" on public.payments
  for select using (user_id = auth.uid() or public.is_admin());
-- Nur Admins legen an, haken ab und löschen.
create policy "payments admin manage" on public.payments
  for all using (public.is_admin()) with check (public.is_admin());
