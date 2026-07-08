-- =====================================================================
-- Studiumm — Chat (1:1 Tutor ↔ Schüler)
-- Voraussetzung: supabase-admin.sql wurde bereits ausgeführt.
-- In Supabase: SQL Editor → New query → einfügen → Run. Idempotent.
--
-- Modell: pro Schüler genau eine Unterhaltung mit dem Tutor-Team.
--   student_id = um wessen Unterhaltung es geht
--   sender_id  = wer die Nachricht geschrieben hat (Schüler ODER Admin)
-- =====================================================================

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists messages_student_time_idx
  on public.messages (student_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "messages read"   on public.messages;
drop policy if exists "messages insert" on public.messages;

-- Lesen: der Schüler seine eigene Unterhaltung, Admins alle.
create policy "messages read" on public.messages
  for select using (student_id = auth.uid() or public.is_admin());

-- Schreiben: immer als man selbst; Schüler nur in die eigene Unterhaltung,
-- Admins in jede.
create policy "messages insert" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and (student_id = auth.uid() or public.is_admin())
  );

-- Live-Updates: Tabelle in die Realtime-Publikation aufnehmen (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;
