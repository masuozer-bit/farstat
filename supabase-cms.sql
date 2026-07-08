-- =====================================================================
-- Studiumm — Volles CMS (editierbare Seiteninhalte)
-- Voraussetzung: supabase-admin.sql wurde ausgeführt (public.is_admin()).
-- In Supabase: SQL Editor → New query → einfügen → Run. Idempotent.
--
-- Eine einfache Schlüssel/Wert-Tabelle: jedes Element auf den öffentlichen
-- Seiten mit data-cms="<key>" wird hieraus überschrieben. Öffentlich lesbar
-- (auch ohne Login), schreiben darf nur der Admin.
-- =====================================================================

create table if not exists public.site_content (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;

drop policy if exists "content public read" on public.site_content;
drop policy if exists "content admin write" on public.site_content;

-- Jeder (auch anonyme Besucher) darf die Inhalte lesen.
create policy "content public read" on public.site_content
  for select using (true);
-- Nur Admins dürfen Inhalte anlegen/ändern/löschen.
create policy "content admin write" on public.site_content
  for all using (public.is_admin()) with check (public.is_admin());

-- Lese-Rechte für anonyme und eingeloggte Rollen (PostgREST/REST-Zugriff).
grant select on public.site_content to anon, authenticated;

-- updated_at automatisch pflegen.
create or replace function public.touch_site_content()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_content_touch on public.site_content;
create trigger site_content_touch before update on public.site_content
  for each row execute function public.touch_site_content();
