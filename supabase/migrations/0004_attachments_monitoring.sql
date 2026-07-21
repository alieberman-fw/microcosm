-- Chat attachments + agent-interaction logging (monitoring surface).

alter table conversation_messages
  add column attachments jsonb not null default '[]'::jsonb;

create table agent_interactions (
  id bigint generated always as identity primary key,
  org_id uuid not null references orgs(id),
  user_id uuid references users(id),
  surface text not null,                -- conversation.reply | conversation.router | simulation.* | casting.*
  conversation_id uuid,
  sim_id uuid,
  agent_key text,
  agent_name text,
  model text not null,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  status text not null default 'ok',    -- ok | error
  error text,
  created_at timestamptz not null default now()
);

create index agent_interactions_org_time on agent_interactions (org_id, created_at desc);

alter table agent_interactions enable row level security;

create policy ai_read on agent_interactions for select
  using (org_id = public.user_org());
create policy ai_insert on agent_interactions for insert
  with check (org_id = public.user_org());
