-- Casting Director (CLAUDE.md §3.2): the app writes the cast under the
-- user's session (RLS), so sim_agents needs org-scoped write policies to
-- match its existing read policy. spec_frozen is the run-time copy; the
-- engine will keep writing via service_role.

create policy simagent_write on sim_agents for insert
  with check (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));

create policy simagent_delete on sim_agents for delete
  using (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));
