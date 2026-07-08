-- =====================================================================
-- Studiumm — Admin-Bereich, Phase 4
-- Geteilte Materialien · Wiederkehrende Terminserien
-- Voraussetzung: supabase-schema.sql, supabase-admin.sql,
--                supabase-admin-phase2.sql, supabase-scheduling.sql,
--                supabase-groups.sql UND supabase-admin-phase3.sql.
-- In Supabase: SQL Editor → New query → einfügen → Run. Idempotent.
--
-- Hinweis (Passwort vergessen): braucht KEINE Migration. Nur in
--   Auth → URL Configuration die Redirect-URL
--   https://studiumm.vercel.app/passwort-neu.html  (+ ggf. localhost)
--   zur Allowlist hinzufügen.
-- =====================================================================

-- =====================================================================
-- TEIL A — GETEILTE MATERIALIEN
-- =====================================================================

-- Privater Bucket für Tutor-Materialien (Pfad: <material_id>/<datei>).
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

create table if not exists public.materials (
  id           uuid primary key default gen_random_uuid(),
  uploaded_by  uuid references auth.users(id) on delete set null default auth.uid(),
  name         text not null,
  size         bigint not null default 0,
  type         text,
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.material_shares (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  student_id  uuid references auth.users(id)  on delete cascade,
  group_id    uuid references public.groups(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- genau EINS von student_id / group_id muss gesetzt sein
  constraint material_shares_target_chk check (
    (student_id is not null and group_id is null)
    or (student_id is null and group_id is not null)
  )
);

create index if not exists material_shares_material_idx on public.material_shares (material_id);
create index if not exists material_shares_student_idx  on public.material_shares (student_id);
create index if not exists material_shares_group_idx    on public.material_shares (group_id);

-- Darf der aktuelle Nutzer dieses Material sehen? (Admin oder direkt/Gruppe geteilt)
create or replace function public.can_read_material(mid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.material_shares s
    where s.material_id = mid
      and (
        s.student_id = auth.uid()
        or (s.group_id is not null and public.is_group_member(s.group_id))
      )
  );
$$;

alter table public.materials       enable row level security;
alter table public.material_shares enable row level security;

drop policy if exists "materials read"        on public.materials;
drop policy if exists "materials admin manage" on public.materials;
drop policy if exists "shares admin manage"   on public.material_shares;

create policy "materials read" on public.materials
  for select using (public.can_read_material(id));
create policy "materials admin manage" on public.materials
  for all using (public.is_admin()) with check (public.is_admin());

-- Shares verwaltet nur der Admin; Schüler brauchen keinen Direktzugriff,
-- Sichtbarkeit läuft über can_read_material (security definer).
create policy "shares admin manage" on public.material_shares
  for all using (public.is_admin()) with check (public.is_admin());

-- Storage-Policies für den materials-Bucket
drop policy if exists "materials files read"   on storage.objects;
drop policy if exists "materials files write"  on storage.objects;
drop policy if exists "materials files delete" on storage.objects;

create policy "materials files read" on storage.objects
  for select using (
    bucket_id = 'materials'
    and public.can_read_material(((storage.foldername(name))[1])::uuid)
  );
create policy "materials files write" on storage.objects
  for insert with check (bucket_id = 'materials' and public.is_admin());
create policy "materials files delete" on storage.objects
  for delete using (bucket_id = 'materials' and public.is_admin());

-- =====================================================================
-- TEIL B — WIEDERKEHRENDE TERMINSERIEN
-- =====================================================================

alter table public.termine add column if not exists series_id uuid;
create index if not exists termine_series_idx on public.termine (series_id);

-- Trigger so anpassen, dass Serien-Zeilen KEINE Einzel-Benachrichtigungen
-- auslösen (sonst N-facher Spam). Serien-Notifications kommen aus den RPCs.
create or replace function public.notify_termin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recip   text;
  ttl     text;
  whentxt text;
begin
  -- Serien werden ausschließlich über propose_series / update_series gemeldet.
  if NEW.series_id is not null then
    return NEW;
  end if;

  whentxt := to_char(NEW.date, 'DD.MM.YYYY') ||
             coalesce(' · ' || nullif(NEW.time, ''), '');

  if TG_OP = 'INSERT' then
    if NEW.status = 'proposed' then
      ttl := 'Neuer Terminvorschlag';
      if NEW.proposed_by = 'student' then recip := 'admin';
      else recip := 'student'; end if;
    else
      return NEW;
    end if;

  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    if NEW.status = 'confirmed' then
      ttl := 'Termin angenommen';
      if OLD.proposed_by = 'student' then recip := 'student';
      else recip := 'admin'; end if;
    elsif NEW.status = 'declined' then
      ttl := 'Termin abgelehnt';
      if OLD.proposed_by = 'student' then recip := 'student';
      else recip := 'admin'; end if;
    elsif NEW.status = 'cancelled' then
      ttl := 'Termin abgesagt';
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

-- Eine Notification an alle Admins (Hilfsroutine).
create or replace function public.notify_admins(p_type text, p_title text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body)
  select id, p_type, p_title, p_body from public.profiles where is_admin;
$$;

-- ----------------------- propose_series ------------------------------
-- Legt eine Terminserie als Vorschlag an (nur Admin) und benachrichtigt den
-- Schüler GENAU EINMAL. Gibt die series_id zurück.
create or replace function public.propose_series(
  p_student uuid, p_title text, p_dates date[], p_time text, p_end text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sid uuid := gen_random_uuid();
  d   date;
  n   int := 0;
  whenrange text;
begin
  if not public.is_admin() then
    raise exception 'Nur Administratoren dürfen Terminserien vorschlagen.';
  end if;
  if p_dates is null or array_length(p_dates, 1) is null then
    raise exception 'Keine Termine in der Serie.';
  end if;

  foreach d in array p_dates loop
    insert into public.termine (user_id, date, time, end_time, title, status, proposed_by, series_id)
    values (p_student, d, nullif(p_time, ''), nullif(p_end, ''), p_title, 'proposed', 'tutor', sid);
    n := n + 1;
  end loop;

  whenrange := coalesce(nullif(p_time, '') || coalesce('–' || nullif(p_end, ''), '') || ' Uhr · ', '');
  insert into public.notifications (user_id, type, title, body)
  values (p_student, 'series_proposed', 'Neue Terminserie vorgeschlagen',
          p_title || ' · ' || whenrange || n || ' Termine');

  return sid;
end;
$$;

-- ----------------------- update_series -------------------------------
-- accept | decline | cancel auf eine ganze Serie (p_date null) oder einen
-- einzelnen Termin der Serie (p_date gesetzt). Schreibt genau EINE Notification.
create or replace function public.update_series(
  p_series uuid, p_action text, p_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_student uuid;
  v_title   text;
  is_student boolean;
  is_admin_caller boolean := public.is_admin();
  scope_txt text;
begin
  select user_id, min(title) into v_student, v_title
  from public.termine where series_id = p_series group by user_id;

  if v_student is null then
    raise exception 'Serie nicht gefunden.';
  end if;

  is_student := (auth.uid() = v_student);
  if not (is_student or is_admin_caller) then
    raise exception 'Keine Berechtigung für diese Serie.';
  end if;

  scope_txt := case when p_date is null then 'ganze Serie'
                    else to_char(p_date, 'DD.MM.YYYY') end;

  if p_action = 'accept' then
    update public.termine set status = 'confirmed'
    where series_id = p_series and status = 'proposed'
      and (p_date is null or date = p_date);
    perform public.notify_admins('series', 'Terminserie angenommen',
            coalesce(v_title, 'Terminserie') || ' · ' || scope_txt);

  elsif p_action = 'decline' then
    update public.termine set status = 'declined'
    where series_id = p_series and status = 'proposed'
      and (p_date is null or date = p_date);
    perform public.notify_admins('series', 'Terminserie abgelehnt',
            coalesce(v_title, 'Terminserie') || ' · ' || scope_txt);

  elsif p_action = 'cancel' then
    update public.termine
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = case when is_student then 'student' else 'tutor' end
    where series_id = p_series and status in ('proposed', 'confirmed')
      and (p_date is null or date = p_date)
      and (p_date is not null or date >= current_date);   -- ganze Serie: nur zukünftige
    if is_student then
      perform public.notify_admins('series', 'Terminserie abgesagt',
              coalesce(v_title, 'Terminserie') || ' · ' || scope_txt);
    else
      insert into public.notifications (user_id, type, title, body)
      values (v_student, 'series', 'Terminserie abgesagt',
              coalesce(v_title, 'Terminserie') || ' · ' || scope_txt);
    end if;

  else
    raise exception 'Unbekannte Aktion: %', p_action;
  end if;
end;
$$;
