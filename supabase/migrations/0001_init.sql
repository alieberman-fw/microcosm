-- Microcosm initial schema — CLAUDE.md §9 data model, org-scoped with RLS.
-- Applied with: supabase db push (after `supabase link --project-ref <ref>`).

create extension if not exists vector;

-- ---------- core tenancy ----------
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'preview',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references orgs(id),
  role text not null default 'owner',
  email text,
  created_at timestamptz not null default now()
);

-- every signup gets a personal org (CLAUDE.md §9: org-scoped from day one)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  insert into orgs (name) values (coalesce(new.email, 'personal')) returning id into new_org;
  insert into users (id, org_id, role, email) values (new.id, new_org, 'owner', new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- current user's org (used by every RLS policy)
create or replace function public.user_org()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from users where id = auth.uid()
$$;

-- ---------- projects & simulations ----------
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null,
  created_at timestamptz not null default now()
);

create table simulations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  parent_id uuid references simulations(id),          -- scenario-fork lineage
  status text not null default 'draft',               -- draft|seeding|running|converged|synthesizing|done|failed
  brief jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  cost_actual numeric,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ---------- corpus ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  sim_id uuid references simulations(id),
  name text not null,
  storage_path text not null,
  parse_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table doc_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references documents(id) on delete cascade,
  content text not null,
  embedding vector(1536)
);

-- ---------- personas ----------
create table personas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),                    -- null = global library persona
  kind text not null,                                 -- expert|consumer|resident|stakeholder|adversarial
  spec jsonb not null,
  version int not null default 1,
  public boolean not null default false,
  source text not null default 'auto',                -- auto|library|marketplace|manual
  author_org uuid references orgs(id),
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table persona_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null,
  persona_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table sim_agents (
  sim_id uuid not null references simulations(id) on delete cascade,
  persona_id uuid references personas(id),
  agent_key text not null,                            -- stable key used in events
  spec_frozen jsonb not null,                         -- frozen copy at run time
  primary key (sim_id, agent_key)
);

-- ---------- transcript & events ----------
create table posts (
  id bigint generated always as identity primary key,
  sim_id uuid not null references simulations(id) on delete cascade,
  seq int not null,
  author text not null default 'agent',               -- agent|user
  agent_key text,
  user_id uuid references users(id),
  thread text,
  reply_to int,
  tag text not null default 'POST',                   -- POST|REPLY|FLIP|BURST|FLOOR
  mentions text[] not null default '{}',
  content text not null,
  cites jsonb not null default '[]'::jsonb,
  ts timestamptz not null default now(),
  unique (sim_id, seq)
);

create table events (
  id bigint generated always as identity primary key,
  sim_id uuid not null references simulations(id) on delete cascade,
  seq int not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);

create table tool_runs (
  id uuid primary key default gen_random_uuid(),
  sim_id uuid not null references simulations(id) on delete cascade,
  agent_key text,
  tool text not null,
  input jsonb,
  output jsonb,
  ts timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  sim_id uuid not null references simulations(id) on delete cascade,
  spec jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

-- calibration hooks from day one (CLAUDE.md principle 5)
create table outcomes (
  id uuid primary key default gen_random_uuid(),
  sim_id uuid not null references simulations(id),
  kind text not null,
  observed jsonb not null,
  recorded_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table orgs enable row level security;
alter table users enable row level security;
alter table projects enable row level security;
alter table simulations enable row level security;
alter table documents enable row level security;
alter table doc_chunks enable row level security;
alter table personas enable row level security;
alter table persona_sets enable row level security;
alter table sim_agents enable row level security;
alter table posts enable row level security;
alter table events enable row level security;
alter table tool_runs enable row level security;
alter table reports enable row level security;
alter table outcomes enable row level security;

create policy org_read on orgs for select using (id = public.user_org());
create policy self_read on users for select using (id = auth.uid());

create policy proj_all on projects for all
  using (org_id = public.user_org()) with check (org_id = public.user_org());

create policy sim_all on simulations for all
  using (project_id in (select id from projects where org_id = public.user_org()))
  with check (project_id in (select id from projects where org_id = public.user_org()));

create policy doc_all on documents for all
  using (project_id in (select id from projects where org_id = public.user_org()))
  with check (project_id in (select id from projects where org_id = public.user_org()));

create policy chunk_read on doc_chunks for select
  using (document_id in (select id from documents where project_id in
    (select id from projects where org_id = public.user_org())));

create policy persona_read on personas for select
  using (org_id is null or public or org_id = public.user_org());
create policy persona_write on personas for insert
  with check (org_id = public.user_org());
create policy persona_update on personas for update
  using (org_id = public.user_org());

create policy pset_all on persona_sets for all
  using (org_id = public.user_org()) with check (org_id = public.user_org());

create policy simagent_read on sim_agents for select
  using (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));

create policy posts_read on posts for select
  using (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));
create policy posts_user_write on posts for insert
  with check (author = 'user' and user_id = auth.uid() and sim_id in
    (select s.id from simulations s join projects p on s.project_id = p.id
     where p.org_id = public.user_org()));

create policy events_read on events for select
  using (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));

create policy tools_read on tool_runs for select
  using (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));

create policy reports_read on reports for select
  using (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));

create policy outcomes_all on outcomes for all
  using (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()))
  with check (sim_id in (select s.id from simulations s join projects p on s.project_id = p.id
    where p.org_id = public.user_org()));

-- engine writes via service_role (bypasses RLS by design)

-- ---------- storage ----------
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;

create policy doc_bucket_rw on storage.objects for all
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.user_org()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = public.user_org()::text);
