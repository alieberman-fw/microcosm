-- Report engine (CLAUDE.md §8): synthesis runs in the user's session (RLS),
-- so reports need org-scoped write policies alongside the existing read.

create policy reports_write on reports for insert
  with check (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy reports_delete on reports for delete
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));
