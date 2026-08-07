-- The report AI analyst (pre-5a feature batch): threaded chats scoped to a
-- simulation's report, riding the existing conversations infrastructure —
-- plus the artifacts the analyst generates (styled HTML documents in
-- Storage). Analyst threads are SIDE conversations: they never enter the
-- run transcript and are excluded from the Conversations sidebar by kind.

alter table conversations
  add column kind text not null default 'chat',   -- 'chat' | 'analyst'
  add column sim_id uuid references simulations(id) on delete cascade;

create index conversations_analyst on conversations (sim_id, updated_at desc)
  where kind = 'analyst';

-- artifacts: analyst-generated documents ("regenerate focusing on X").
-- Self-contained HTML files in the documents bucket under the org's folder;
-- RLS scopes through sim -> project -> org like reports/report_links.
create table report_artifacts (
  id uuid primary key default gen_random_uuid(),
  sim_id uuid not null references simulations(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  name text not null,
  storage_path text not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index report_artifacts_sim on report_artifacts (sim_id, created_at desc);

alter table report_artifacts enable row level security;

create policy report_artifacts_select on report_artifacts for select
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy report_artifacts_insert on report_artifacts for insert
  with check (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy report_artifacts_update on report_artifacts for update
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy report_artifacts_delete on report_artifacts for delete
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));
