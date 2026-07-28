-- §2b votes (docs/next-level-plan.md): per-round in-character endorsements.
-- A real table (not jsonb) so hover attribution, per-post counts, and report
-- queries stay one cheap indexed lookup. Org RLS follows the posts/events
-- pattern from 0012.

create table post_votes (
  sim_id uuid not null references simulations(id) on delete cascade,
  seq int not null,                -- the post being voted on (posts.seq within the sim)
  voter_key text not null,         -- sim_agents.agent_key of the voter
  voter_name text not null,        -- denormalized for hover attribution without joins
  voter_role text,
  vote smallint not null check (vote in (-1, 1)),
  ts timestamptz not null default now(),
  primary key (sim_id, seq, voter_key)
);

create index post_votes_sim on post_votes (sim_id);

alter table post_votes enable row level security;

create policy post_votes_read on post_votes for select
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy post_votes_write on post_votes for insert
  with check (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy post_votes_delete on post_votes for delete
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

-- the engine persists votes via UPSERT — the conflict path needs UPDATE or a
-- resumed slice would 42501 mid-run
create policy post_votes_update on post_votes for update
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));
