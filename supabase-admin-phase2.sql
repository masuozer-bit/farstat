-- =====================================================================
-- Studiumm — Admin-Bereich, Phase 2 (Schülerdaten einsehen)
-- Voraussetzung: supabase-admin.sql wurde bereits ausgeführt.
-- In Supabase: SQL Editor → New query → einfügen → Run. Idempotent.
--
-- Gibt Admins NUR-LESE-Zugriff auf die Daten aller Schüler. Bearbeiten/
-- Löschen bleibt weiterhin allein beim jeweiligen Schüler.
-- =====================================================================

drop policy if exists "admin read termine"    on public.termine;
drop policy if exists "admin read plan_lists" on public.plan_lists;
drop policy if exists "admin read plan_tasks" on public.plan_tasks;
drop policy if exists "admin read docs"       on public.docs;

create policy "admin read termine"    on public.termine    for select using (public.is_admin());
create policy "admin read plan_lists" on public.plan_lists for select using (public.is_admin());
create policy "admin read plan_tasks" on public.plan_tasks for select using (public.is_admin());
create policy "admin read docs"       on public.docs       for select using (public.is_admin());

-- Admin darf Schüler-Dateien herunterladen (Storage)
drop policy if exists "admin read files" on storage.objects;
create policy "admin read files" on storage.objects
  for select using (bucket_id = 'documents' and public.is_admin());
