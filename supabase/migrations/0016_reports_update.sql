-- 3a report overhaul: the Plain English toggle caches its translation into
-- reports.spec.plain on first use — reports need an org-scoped UPDATE policy
-- (0013 added insert/delete only). The frozen findings are never edited; the
-- update path exists solely to attach derived views to the same version.

create policy reports_update on reports for update
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));
