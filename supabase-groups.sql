-- =====================================================================
-- Studiumm — Lerngruppen + Gruppen-Chat
-- Voraussetzung: supabase-admin.sql UND supabase-chat.sql wurden ausgeführt.
-- In Supabase: SQL Editor → New query → einfügen → Run. Idempotent.
-- =====================================================================

-- ----------------------- Tabellen -----------------------------------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id  uuid not null references auth.users(id)    on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ----------------------- Helfer (security definer) ------------------
create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.group_members where group_id = gid and user_id = auth.uid()
  );
$$;

-- ----------------------- RLS: groups / group_members ----------------
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "groups admin"        on public.groups;
drop policy if exists "groups member read"  on public.groups;
drop policy if exists "gm admin"            on public.group_members;
drop policy if exists "gm member read"      on public.group_members;

-- Admins verwalten Gruppen vollständig; Mitglieder dürfen ihre Gruppe lesen.
create policy "groups admin" on public.groups
  for all using (public.is_admin()) with check (public.is_admin());
create policy "groups member read" on public.groups
  for select using (public.is_group_member(id) or public.is_admin());

create policy "gm admin" on public.group_members
  for all using (public.is_admin()) with check (public.is_admin());
create policy "gm member read" on public.group_members
  for select using (public.is_group_member(group_id) or public.is_admin());

-- ----------------------- messages: Gruppen-Unterstützung ------------
alter table public.messages add column if not exists group_id uuid
  references public.groups(id) on delete cascade;
alter table public.messages add column if not exists sender_name text;
alter table public.messages alter column student_id drop not null;

-- Genau EINS von student_id / group_id muss gesetzt sein.
alter table public.messages drop constraint if exists messages_target_chk;
alter table public.messages add constraint messages_target_chk check (
  (student_id is not null and group_id is null)
  or (student_id is null and group_id is not null)
);

create index if not exists messages_group_time_idx
  on public.messages (group_id, created_at);

-- Absender-Name beim Einfügen automatisch setzen (vermeidet Profil-Lesezugriffe).
create or replace function public.set_message_sender_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sender_name is null then
    select coalesce(full_name, email) into new.sender_name
    from public.profiles where id = new.sender_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_sender_name on public.messages;
create trigger messages_sender_name before insert on public.messages
  for each row execute function public.set_message_sender_name();

-- Bestehende Nachrichten mit Absender-Namen nachfüllen
update public.messages m
set sender_name = coalesce(p.full_name, p.email)
from public.profiles p
where m.sender_id = p.id and m.sender_name is null;

-- ----------------------- RLS: messages (1:1 + Gruppe) ---------------
drop policy if exists "messages read"   on public.messages;
drop policy if exists "messages insert" on public.messages;

create policy "messages read" on public.messages for select using (
  (student_id is not null and (student_id = auth.uid() or public.is_admin()))
  or (group_id is not null and (public.is_group_member(group_id) or public.is_admin()))
);

create policy "messages insert" on public.messages for insert with check (
  sender_id = auth.uid() and (
    (student_id is not null and group_id is null and (student_id = auth.uid() or public.is_admin()))
    or (group_id is not null and student_id is null and (public.is_group_member(group_id) or public.is_admin()))
  )
);
