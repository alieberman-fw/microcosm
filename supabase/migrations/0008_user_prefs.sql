-- Per-user preferences (e.g. hiding the Home onboarding checklist; can be
-- re-enabled from Settings). Users may update their own row.
alter table users add column if not exists prefs jsonb not null default '{}'::jsonb;

create policy self_update on users for update
  using (id = auth.uid()) with check (id = auth.uid());
