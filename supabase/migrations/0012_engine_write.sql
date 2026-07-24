-- Engine v1 (CLAUDE.md §6): the run orchestrator executes inside the user's
-- session (RLS), so agent posts and run events need org-scoped write
-- policies. Delete policies support re-running a simulation cleanly.

create policy posts_agent_write on posts for insert
  with check (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy posts_delete on posts for delete
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy events_write on events for insert
  with check (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy events_delete on events for delete
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));
