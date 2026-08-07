-- Report magic links (pre-5a feature batch): named, expiring, revocable
-- VIEW-ONLY share links for a simulation's report. Org members manage them
-- under RLS (scoped through sim → project → org, same shape as reports_*);
-- the PUBLIC /r/<token> route reads with the service role only, after
-- validating expiry/revocation — anon carries no policy here at all.

create table report_links (
  id uuid primary key default gen_random_uuid(),
  sim_id uuid not null references simulations(id) on delete cascade,
  token text not null unique,
  name text not null,
  created_by uuid references users(id),
  expires_at timestamptz,                -- null = never expires
  revoked_at timestamptz,                -- set = dead immediately
  created_at timestamptz not null default now()
);

create index report_links_sim on report_links (sim_id, created_at desc);
create index report_links_token on report_links (token);

alter table report_links enable row level security;

create policy report_links_select on report_links for select
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy report_links_insert on report_links for insert
  with check (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy report_links_update on report_links for update
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy report_links_delete on report_links for delete
  using (sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));
