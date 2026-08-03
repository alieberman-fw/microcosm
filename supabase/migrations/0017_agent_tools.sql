-- 3d · Agent tools v1 (docs/next-level-plan.md §3d)
-- tool_runs exists since 0001 (id, sim_id, agent_key, tool, input, output, ts)
-- with a select policy only — the engine now WRITES it, and runs are deletable
-- with their sim. Plus: per-participant tool access in Conversations and
-- per-message metadata (searches + web sources) for the chat source chips.

create index if not exists tool_runs_sim_idx on tool_runs (sim_id, ts);

create policy tool_runs_write on tool_runs for insert
  with check (sim_id in
    (select s.id from simulations s join projects p on p.id = s.project_id
     where p.org_id = public.user_org()));

create policy tool_runs_delete on tool_runs for delete
  using (sim_id in
    (select s.id from simulations s join projects p on p.id = s.project_id
     where p.org_id = public.user_org()));

alter table conversations add column if not exists tool_overrides jsonb not null default '{}'::jsonb;
alter table conversation_messages add column if not exists meta jsonb;
