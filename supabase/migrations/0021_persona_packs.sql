-- Panel & crowd packs (the §3.4 persona-set aggregator): persona_sets grows
-- the columns the pack UI needs. A PANEL pack seats leads (≤20, mirroring
-- MAX_SEATS); a CROWD pack seeds crowd members (≤200, the manual-crowd cap).
-- RLS: the existing pset_all policy (org-scoped, all commands) covers CRUD.

alter table persona_sets
  add column kind text not null default 'panel',        -- 'panel' | 'crowd'
  add column description text,
  add column created_by uuid references users(id),
  add column updated_at timestamptz not null default now();

create index persona_sets_org_updated on persona_sets (org_id, updated_at desc);
